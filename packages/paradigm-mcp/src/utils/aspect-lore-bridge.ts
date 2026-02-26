/**
 * Aspect-Lore Bridge — Links aspects to lore decision records
 *
 * Materializes links between the aspect graph (SQLite) and lore entries
 * (YAML files in .paradigm/lore/entries/). Links are stored in the
 * `lore_links` table and can be queried by aspect or by symbol.
 *
 * Also infers graph edges between aspects that share lore entries,
 * building connections from historical decision records.
 */

import type { Database, QueryExecResult } from 'sql.js';
import { loadLoreEntries, loadLoreEntry } from './lore-loader.js';
import type { LoreEntry } from './lore-loader.js';

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

/** Lightweight summary of a lore entry (no full content) */
export interface LoreSummary {
  id: string;
  title?: string;
  summary?: string;
  timestamp?: string;
  symbolsTouched?: string[];
}

// ────────────────────────────────────────────────────────
// Regex for extracting lore IDs from free text
// ────────────────────────────────────────────────────────

/** Matches lore ID patterns like L-2026-01-15-002 */
const LORE_ID_PATTERN = /L-\d{4}-\d{2}-\d{2}-\d{3}/g;

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

/**
 * Materialize links between aspects and lore entries.
 *
 * Scans all lore entries and creates rows in the `lore_links` table based on:
 * 1. **Explicit references** — lore IDs found in the aspect's `enforcement` text
 * 2. **Symbol overlap** — the lore entry's `symbols_touched` intersects with
 *    symbols referenced by the aspect (via edges or applies-to stored in edges)
 *
 * This function is idempotent: it clears existing lore_links before rebuilding.
 * Call it during materialization, after aspects and edges have been populated.
 *
 * @param db - An already-opened sql.js Database instance
 * @param rootDir - Project root directory (contains .paradigm/)
 * @returns Number of links created
 */
export async function materializeLoreLinks(db: Database, rootDir: string): Promise<number> {
  // Clear existing links for a clean rebuild
  db.run('DELETE FROM lore_links');

  // Load all lore entries from disk
  const loreEntries = await loadLoreEntries(rootDir);
  if (loreEntries.length === 0) {
    return 0;
  }

  // Build a map from symbol -> lore entry IDs that touch that symbol
  const symbolToLore = buildSymbolToLoreMap(loreEntries);

  // Build a map from lore ID -> LoreEntry for fast lookup
  const loreById = new Map<string, LoreEntry>();
  for (const entry of loreEntries) {
    loreById.set(entry.id, entry);
  }

  // Collect all (aspect_id, lore_id) pairs to insert
  const links = new Set<string>();

  // 1. Explicit lore references from the enforcement field
  const aspectRows = db.exec('SELECT id, enforcement FROM aspects');
  if (aspectRows.length > 0) {
    const { columns, values } = aspectRows[0];
    const idIdx = columns.indexOf('id');
    const enfIdx = columns.indexOf('enforcement');

    for (const row of values) {
      const aspectId = String(row[idIdx]);
      const enforcement = row[enfIdx];

      if (enforcement && typeof enforcement === 'string') {
        const matches = enforcement.match(LORE_ID_PATTERN);
        if (matches) {
          for (const loreId of matches) {
            if (loreById.has(loreId)) {
              links.add(`${aspectId}\0${loreId}`);
            }
          }
        }
      }
    }
  }

  // 2. Symbol overlap: find aspects connected to symbols that lore entries touch
  //    An aspect "references" a symbol if:
  //    - The aspect itself IS a symbol (its id prefixed with ~)
  //    - The aspect has edges to/from other symbols
  const edgeRows = db.exec('SELECT source, target FROM edges');
  if (edgeRows.length > 0 && aspectRows.length > 0) {
    // Build a map from aspect_id -> set of connected symbols
    const aspectSymbols = buildAspectSymbolMap(db, edgeRows);

    // For each aspect, check if any of its connected symbols appear in lore
    for (const [aspectId, symbols] of aspectSymbols) {
      for (const symbol of symbols) {
        const loreIds = symbolToLore.get(symbol);
        if (loreIds) {
          for (const loreId of loreIds) {
            links.add(`${aspectId}\0${loreId}`);
          }
        }
      }
    }
  }

  // Insert all collected links
  if (links.size === 0) {
    return 0;
  }

  const stmt = db.prepare('INSERT OR IGNORE INTO lore_links (aspect_id, lore_id) VALUES (?, ?)');
  try {
    for (const key of links) {
      const [aspectId, loreId] = key.split('\0');
      stmt.bind([aspectId, loreId]);
      stmt.step();
      stmt.reset();
    }
  } finally {
    stmt.free();
  }

  return links.size;
}

/**
 * Get lore summaries linked to a specific aspect.
 *
 * Queries the `lore_links` table for the given aspect, then loads each
 * referenced lore entry from disk and returns a lightweight summary.
 *
 * @param db - An already-opened sql.js Database instance
 * @param rootDir - Project root directory (contains .paradigm/)
 * @param aspectId - The aspect identifier (e.g., "token-expiry-24h")
 * @returns Array of lore summaries, deduplicated by ID
 */
export async function getLoreForAspect(
  db: Database,
  rootDir: string,
  aspectId: string,
): Promise<LoreSummary[]> {
  const result = db.exec('SELECT lore_id FROM lore_links WHERE aspect_id = ?', [aspectId]);
  if (result.length === 0 || result[0].values.length === 0) {
    return [];
  }

  const loreIds = result[0].values.map((row) => String(row[0]));
  return loadLoreSummaries(rootDir, loreIds);
}

/**
 * Get lore summaries linked to any aspect that references the given symbols.
 *
 * Finds all aspects connected to the provided symbols (via edges), then
 * collects lore entries linked to those aspects. Results are deduplicated.
 *
 * @param db - An already-opened sql.js Database instance
 * @param rootDir - Project root directory (contains .paradigm/)
 * @param symbols - Array of symbol identifiers to search for
 * @returns Array of lore summaries, deduplicated by ID
 */
export async function getLoreForSymbols(
  db: Database,
  rootDir: string,
  symbols: string[],
): Promise<LoreSummary[]> {
  if (symbols.length === 0) {
    return [];
  }

  // Find all aspects connected to these symbols via edges
  const placeholders = symbols.map(() => '?').join(', ');
  const aspectResult = db.exec(
    `SELECT DISTINCT source AS aspect_id FROM edges WHERE target IN (${placeholders})
     UNION
     SELECT DISTINCT target AS aspect_id FROM edges WHERE source IN (${placeholders})`,
    [...symbols, ...symbols],
  );

  // Also include aspects whose IDs directly match the symbols (with ~ prefix stripped)
  const aspectIds = new Set<string>();
  for (const symbol of symbols) {
    // If the symbol is an aspect reference (starts with ~), strip the prefix
    const stripped = symbol.startsWith('~') ? symbol.slice(1) : symbol;
    // Check if this aspect exists
    const existsResult = db.exec('SELECT id FROM aspects WHERE id = ?', [stripped]);
    if (existsResult.length > 0 && existsResult[0].values.length > 0) {
      aspectIds.add(stripped);
    }
  }

  if (aspectResult.length > 0) {
    for (const row of aspectResult[0].values) {
      const id = String(row[0]);
      // Only include if the id corresponds to an actual aspect
      const existsResult = db.exec('SELECT id FROM aspects WHERE id = ?', [id]);
      if (existsResult.length > 0 && existsResult[0].values.length > 0) {
        aspectIds.add(id);
      }
    }
  }

  if (aspectIds.size === 0) {
    return [];
  }

  // Get lore links for all found aspects
  const aspectPlaceholders = Array.from(aspectIds).map(() => '?').join(', ');
  const loreResult = db.exec(
    `SELECT DISTINCT lore_id FROM lore_links WHERE aspect_id IN (${aspectPlaceholders})`,
    Array.from(aspectIds),
  );

  if (loreResult.length === 0 || loreResult[0].values.length === 0) {
    return [];
  }

  const loreIds = loreResult[0].values.map((row) => String(row[0]));
  return loadLoreSummaries(rootDir, loreIds);
}

/**
 * Infer `related-to` edges between aspects that share lore entries.
 *
 * When a lore entry's `symbols_touched` mentions multiple symbols, and those
 * symbols have corresponding aspects, this function creates inferred
 * `related-to` edges between those aspects (origin='learned', weight=0.3).
 *
 * This builds graph connections from historical decision records — if two
 * aspects were relevant to the same decision, they are likely related.
 *
 * @param db - An already-opened sql.js Database instance
 * @param rootDir - Project root directory (contains .paradigm/)
 * @returns Number of edges inferred
 */
export async function inferLoreEdges(db: Database, rootDir: string): Promise<number> {
  const loreEntries = await loadLoreEntries(rootDir);
  if (loreEntries.length === 0) {
    return 0;
  }

  // Build a set of all known aspect IDs for fast lookup
  const aspectIdsResult = db.exec('SELECT id FROM aspects');
  const knownAspects = new Set<string>();
  if (aspectIdsResult.length > 0) {
    for (const row of aspectIdsResult[0].values) {
      knownAspects.add(String(row[0]));
    }
  }

  if (knownAspects.size < 2) {
    return 0;
  }

  // For each lore entry, find aspect symbols in symbols_touched
  // and create pairwise related-to edges between them
  const now = new Date().toISOString();
  let edgesInferred = 0;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO edges (source, target, relation, weight, origin, created_at)
     VALUES (?, ?, 'related-to', 0.3, 'learned', ?)`,
  );

  try {
    for (const entry of loreEntries) {
      if (!entry.symbols_touched || entry.symbols_touched.length < 2) {
        continue;
      }

      // Collect aspect IDs from symbols_touched
      const aspectsInEntry: string[] = [];
      for (const symbol of entry.symbols_touched) {
        // Aspects are referenced with ~ prefix; strip it to get the aspect ID
        const stripped = symbol.startsWith('~') ? symbol.slice(1) : symbol;
        if (knownAspects.has(stripped)) {
          aspectsInEntry.push(stripped);
        }
      }

      // Create pairwise edges (both directions handled by UNIQUE constraint)
      for (let i = 0; i < aspectsInEntry.length; i++) {
        for (let j = i + 1; j < aspectsInEntry.length; j++) {
          // Use alphabetical ordering for consistent source/target
          const [source, target] = aspectsInEntry[i] < aspectsInEntry[j]
            ? [aspectsInEntry[i], aspectsInEntry[j]]
            : [aspectsInEntry[j], aspectsInEntry[i]];

          stmt.bind([source, target, now]);
          stmt.step();
          stmt.reset();
          edgesInferred++;
        }
      }
    }
  } finally {
    stmt.free();
  }

  return edgesInferred;
}

// ────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────

/**
 * Build a map from symbol name to the set of lore entry IDs that touch it.
 */
function buildSymbolToLoreMap(entries: LoreEntry[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!entry.symbols_touched) continue;

    for (const symbol of entry.symbols_touched) {
      let set = map.get(symbol);
      if (!set) {
        set = new Set();
        map.set(symbol, set);
      }
      set.add(entry.id);
    }
  }

  return map;
}

/**
 * Build a map from aspect_id to the set of symbols it is connected to
 * via the edges table.
 */
function buildAspectSymbolMap(
  db: Database,
  edgeRows: QueryExecResult[],
): Map<string, Set<string>> {
  // Get the set of all aspect IDs
  const aspectIdsResult = db.exec('SELECT id FROM aspects');
  const knownAspects = new Set<string>();
  if (aspectIdsResult.length > 0) {
    for (const row of aspectIdsResult[0].values) {
      knownAspects.add(String(row[0]));
    }
  }

  const map = new Map<string, Set<string>>();

  if (edgeRows.length === 0) return map;

  const { columns, values } = edgeRows[0];
  const srcIdx = columns.indexOf('source');
  const tgtIdx = columns.indexOf('target');

  for (const row of values) {
    const source = String(row[srcIdx]);
    const target = String(row[tgtIdx]);

    // If source is an aspect, target is a connected symbol
    if (knownAspects.has(source)) {
      let set = map.get(source);
      if (!set) {
        set = new Set();
        map.set(source, set);
      }
      set.add(target);
      // Also add the prefixed version (~aspect) since lore may reference it that way
      set.add(`~${source}`);
    }

    // If target is an aspect, source is a connected symbol
    if (knownAspects.has(target)) {
      let set = map.get(target);
      if (!set) {
        set = new Set();
        map.set(target, set);
      }
      set.add(source);
      set.add(`~${target}`);
    }
  }

  return map;
}

/**
 * Load lore entries by ID and convert them to lightweight summaries.
 * Deduplicates by lore ID.
 */
async function loadLoreSummaries(rootDir: string, loreIds: string[]): Promise<LoreSummary[]> {
  const seen = new Set<string>();
  const summaries: LoreSummary[] = [];

  for (const loreId of loreIds) {
    if (seen.has(loreId)) continue;
    seen.add(loreId);

    const entry = await loadLoreEntry(rootDir, loreId);
    if (entry) {
      summaries.push(toLoreSummary(entry));
    }
  }

  return summaries;
}

/**
 * Convert a full lore entry to a lightweight summary.
 */
function toLoreSummary(entry: LoreEntry): LoreSummary {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    timestamp: entry.timestamp,
    symbolsTouched: entry.symbols_touched,
  };
}
