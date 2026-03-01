/**
 * Aspect Graph - SQLite graph engine for the Aspect Graph system (v3.5)
 *
 * Stores aspects, code anchors, edges, and traversal metadata in a local
 * SQLite database (.paradigm/aspect-graph.db) powered by sql.js.
 *
 * Provides:
 * - Full rebuild from aggregated SymbolEntry[] (materialize)
 * - Weighted BFS ripple traversal across edges + symbol index references
 * - Heatmap tracking for aspect access frequency
 * - Drift detection for code anchor integrity
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type { SymbolEntry, SymbolIndex } from '@a-company/premise-core';
import type {
  RippleNode,
  AspectRow,
  AnchorRow,
  EdgeRow,
  HeatmapRow,
  HeatmapAccessType,
  DriftResult,
} from '../types/aspect-graph.js';

export type { Database };

/** Local alias -- CodeAnchor is defined in premise-core but not re-exported */
type CodeAnchor = NonNullable<SymbolEntry['anchors']>[number];

// ─── sql.js singleton ────────────────────────────────────────────────

/** Cached sql.js SqlJsStatic instance (async init only once) */
let cachedSQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (!cachedSQL) {
    cachedSQL = await initSqlJs();
  }
  return cachedSQL;
}

// ─── Schema ──────────────────────────────────────────────────────────

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS aspects (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT DEFAULT 'rule',
    severity TEXT DEFAULT 'medium',
    value TEXT,
    enforcement TEXT,
    defined_in TEXT NOT NULL,
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS anchors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aspect_id TEXT NOT NULL REFERENCES aspects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    content_hash TEXT,
    normalized_hash TEXT,
    materialized_at_commit TEXT,
    last_verified TEXT,
    drifted INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_anchors_file ON anchors(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_anchors_aspect ON anchors(aspect_id)`,

  `CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    relation TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    origin TEXT DEFAULT 'explicit',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)`,

  `CREATE TABLE IF NOT EXISTS lore_links (
    aspect_id TEXT NOT NULL,
    lore_id TEXT NOT NULL,
    PRIMARY KEY (aspect_id, lore_id)
  )`,

  `CREATE TABLE IF NOT EXISTS search_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    results_returned TEXT NOT NULL,
    selected_result TEXT,
    timestamp TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_search_query ON search_log(query)`,

  `CREATE TABLE IF NOT EXISTS search_weights (
    query_normalized TEXT NOT NULL,
    aspect_id TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    hit_count INTEGER DEFAULT 1,
    last_hit TEXT NOT NULL,
    PRIMARY KEY (query_normalized, aspect_id)
  )`,

  `CREATE TABLE IF NOT EXISTS heatmap (
    aspect_id TEXT NOT NULL,
    access_type TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    last_accessed TEXT NOT NULL,
    PRIMARY KEY (aspect_id, access_type)
  )`,
];

const FTS_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS aspects_fts USING fts5(id, description, enforcement, tags)`;

// ─── Query helpers ───────────────────────────────────────────────────

/**
 * Execute a parameterized SELECT and collect all rows as typed objects.
 */
function queryRows<T>(db: Database, sql: string, params?: SqlValue[]): T[] {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }

  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }

  stmt.free();
  return rows;
}

/**
 * Execute a parameterized SELECT returning the first row or null.
 */
function queryOne<T>(db: Database, sql: string, params?: SqlValue[]): T | null {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }

  let result: T | null = null;
  if (stmt.step()) {
    result = stmt.getAsObject() as unknown as T;
  }

  stmt.free();
  return result;
}

// ─── Database lifecycle ──────────────────────────────────────────────

/**
 * Open or create the Aspect Graph SQLite database.
 *
 * Creates all tables if they do not exist. The database file is stored at
 * `<rootDir>/.paradigm/aspect-graph.db`.
 *
 * @param rootDir - Absolute path to the project root directory
 * @returns The sql.js Database instance
 */
export async function openAspectGraph(rootDir: string): Promise<Database> {
  const SQL = await getSqlJs();
  const dbDir = path.join(rootDir, '.paradigm');
  const dbPath = path.join(dbDir, 'aspect-graph.db');

  let db: Database;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new SQL.Database();
  }

  // Create core tables
  for (const stmt of SCHEMA_STATEMENTS) {
    db.run(stmt);
  }

  // Try to create FTS5 virtual table (may not be available in all sql.js builds)
  try {
    db.run(FTS_SQL);
  } catch {
    // FTS5 not available in this sql.js build -- degrade gracefully
  }

  return db;
}

/**
 * Save and close the Aspect Graph database.
 *
 * Exports the in-memory database to disk before closing.
 *
 * @param db - The sql.js Database instance
 * @param rootDir - Absolute path to the project root directory (for save path)
 */
export function closeAspectGraph(db: Database, rootDir?: string): void {
  if (rootDir) {
    const dbDir = path.join(rootDir, '.paradigm');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'aspect-graph.db');
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
  db.close();
}

// ─── Materialization ─────────────────────────────────────────────────

/**
 * Rebuild the aspect graph from aggregated symbol entries.
 *
 * Clears all existing data and re-populates aspects, anchors, edges, and
 * the FTS5 index from the provided SymbolEntry array (filtered to type='aspect').
 *
 * @param db - The sql.js Database instance
 * @param symbols - All SymbolEntry objects from the aggregated index
 * @param rootDir - Optional project root for git HEAD resolution (Layer 2 drift detection)
 */
export function materializeAspects(db: Database, symbols: SymbolEntry[], rootDir?: string): void {
  const aspects = symbols.filter((s) => s.type === 'aspect');
  const now = new Date().toISOString();

  // Record current git HEAD for Layer 2 drift detection
  let headCommit: string | null = null;
  try {
    headCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    // Not a git repo or git not available — skip Layer 2 support
  }

  // Clear existing data (full rebuild)
  db.run('DELETE FROM anchors');
  db.run('DELETE FROM edges');
  db.run('DELETE FROM aspects');

  // Clear FTS if available
  try {
    db.run('DELETE FROM aspects_fts');
  } catch {
    // FTS not available
  }

  for (const entry of aspects) {
    const data = (entry.data ?? {}) as Record<string, unknown>;

    const category = inferCategory(data, entry);
    const severity = inferSeverity(data, entry);
    const value = data.value != null ? String(data.value) : null;
    const enforcement = entry.enforcement ?? (data.enforcement != null ? String(data.enforcement) : null);
    const tags = entry.tags ? JSON.stringify(entry.tags) : null;

    // INSERT aspect
    db.run(
      `INSERT INTO aspects (id, description, category, severity, value, enforcement, defined_in, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.symbol,
        entry.description ?? '',
        category,
        severity,
        value,
        enforcement,
        entry.filePath,
        tags,
        entry.created ?? now,
        entry.modified ?? now,
      ]
    );

    // INSERT anchors
    if (entry.anchors) {
      for (const anchor of entry.anchors) {
        const { startLine, endLine } = resolveAnchorLines(anchor);
        const hashes = computeAnchorHash(anchor, null);

        db.run(
          `INSERT INTO anchors (aspect_id, file_path, start_line, end_line, content_hash, normalized_hash, materialized_at_commit, last_verified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.symbol, anchor.path, startLine, endLine, hashes.exact, hashes.normalized, headCommit, now]
        );
      }
    }

    // INSERT explicit edges from data.edges array
    const explicitEdges = data.edges as Array<{
      source?: string;
      target?: string;
      relation?: string;
      weight?: number;
      origin?: string;
    }> | undefined;

    if (Array.isArray(explicitEdges)) {
      for (const edge of explicitEdges) {
        db.run(
          `INSERT INTO edges (source, target, relation, weight, origin, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            edge.source ?? entry.symbol,
            edge.target ?? '',
            edge.relation ?? 'related-to',
            edge.weight ?? 1.0,
            edge.origin ?? 'explicit',
            now,
          ]
        );
      }
    }

    // INSERT inferred edges from appliesTo references
    if (entry.appliesTo) {
      for (const target of entry.appliesTo) {
        db.run(
          `INSERT INTO edges (source, target, relation, weight, origin, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [entry.symbol, target, 'related-to', 0.5, 'inferred', now]
        );
      }
    }

    // Rebuild FTS5 index entry
    try {
      db.run(
        `INSERT INTO aspects_fts (id, description, enforcement, tags)
         VALUES (?, ?, ?, ?)`,
        [entry.symbol, entry.description ?? '', enforcement ?? '', tags ?? '']
      );
    } catch {
      // FTS not available
    }
  }
}

// ─── Queries ─────────────────────────────────────────────────────────

/**
 * Get a single aspect by its ID (e.g., "~token-expiry-24h").
 *
 * @param db - The sql.js Database instance
 * @param aspectId - The aspect symbol identifier
 * @returns The aspect row or null if not found
 */
export function getAspect(db: Database, aspectId: string): AspectRow | null {
  return queryOne<AspectRow>(db, 'SELECT * FROM aspects WHERE id = ?', [aspectId]);
}

/**
 * Get all anchors for a given aspect.
 *
 * @param db - The sql.js Database instance
 * @param aspectId - The aspect symbol identifier
 * @returns Array of anchor rows
 */
export function getAnchorsForAspect(db: Database, aspectId: string): AnchorRow[] {
  return queryRows<AnchorRow>(db, 'SELECT * FROM anchors WHERE aspect_id = ?', [aspectId]);
}

/**
 * Get all edges where the given symbol is the source.
 *
 * @param db - The sql.js Database instance
 * @param symbol - The source symbol identifier
 * @returns Array of edge rows
 */
export function getEdgesFrom(db: Database, symbol: string): EdgeRow[] {
  return queryRows<EdgeRow>(db, 'SELECT * FROM edges WHERE source = ?', [symbol]);
}

/**
 * Get all edges where the given symbol is the target.
 *
 * @param db - The sql.js Database instance
 * @param symbol - The target symbol identifier
 * @returns Array of edge rows
 */
export function getEdgesTo(db: Database, symbol: string): EdgeRow[] {
  return queryRows<EdgeRow>(db, 'SELECT * FROM edges WHERE target = ?', [symbol]);
}

/**
 * Get all edges in both directions for a given symbol.
 *
 * @param db - The sql.js Database instance
 * @param symbol - The symbol identifier
 * @returns Array of edge rows (source or target matches)
 */
export function getAllEdgesFor(db: Database, symbol: string): EdgeRow[] {
  return queryRows<EdgeRow>(
    db,
    'SELECT * FROM edges WHERE source = ? OR target = ?',
    [symbol, symbol]
  );
}

/**
 * Find all aspects that reference a given symbol.
 *
 * Looks through edges and appliesTo references. Also returns the symbol
 * itself if it is an aspect.
 *
 * @param db - The sql.js Database instance
 * @param symbol - The symbol identifier to search for
 * @returns Array of aspect IDs that reference this symbol
 */
export function getAspectsForSymbol(db: Database, symbol: string): string[] {
  const aspectIds = new Set<string>();

  // If the symbol itself is an aspect, include it
  const selfAspect = getAspect(db, symbol);
  if (selfAspect) {
    aspectIds.add(symbol);
  }

  // Find aspects that have edges targeting this symbol
  const edgesTo = getEdgesTo(db, symbol);
  for (const edge of edgesTo) {
    const aspect = getAspect(db, edge.source);
    if (aspect) {
      aspectIds.add(edge.source);
    }
  }

  // Find aspects that have edges from this symbol
  const edgesFrom = getEdgesFrom(db, symbol);
  for (const edge of edgesFrom) {
    const aspect = getAspect(db, edge.target);
    if (aspect) {
      aspectIds.add(edge.target);
    }
  }

  return Array.from(aspectIds);
}

// ─── Recursive Ripple ────────────────────────────────────────────────

/** Internal queue item for BFS traversal */
interface QueueItem {
  symbol: string;
  depth: number;
  path: string[];
  relation: string;
  weight: number;
}

/**
 * Weighted BFS traversal across the aspect graph and symbol index.
 *
 * Starting from `startSymbol`, follows edges in the graph and references
 * in the symbol index. Uses a visited set, maximum depth, minimum weight
 * threshold, and queue size limit to bound the traversal.
 *
 * @param db - The sql.js Database instance
 * @param startSymbol - The symbol to start traversal from
 * @param index - The project's SymbolIndex for reference lookups
 * @param maxDepth - Maximum traversal depth (default 5)
 * @param minWeight - Minimum accumulated weight to continue traversal (default 0.1)
 * @returns Array of RippleNode sorted by weight descending
 */
export function recursiveRipple(
  db: Database,
  startSymbol: string,
  index: SymbolIndex,
  maxDepth = 5,
  minWeight = 0.1
): RippleNode[] {
  const visited = new Set<string>();
  const results: RippleNode[] = [];
  const QUEUE_LIMIT = 1000;

  const queue: QueueItem[] = [
    {
      symbol: startSymbol,
      depth: 0,
      path: [startSymbol],
      relation: 'origin',
      weight: 1.0,
    },
  ];

  while (queue.length > 0 && results.length < QUEUE_LIMIT) {
    const current = queue.shift()!;

    if (visited.has(current.symbol)) continue;
    if (current.depth > maxDepth) continue;
    if (current.weight < minWeight) continue;

    visited.add(current.symbol);

    // Gather aspects attached to this symbol
    const aspects = getAspectsForSymbol(db, current.symbol);

    // Gather anchors for this symbol's aspects
    const anchors: Array<{ path: string; startLine: number; endLine: number; aspect: string }> = [];
    for (const aspectId of aspects) {
      const aspectAnchors = getAnchorsForAspect(db, aspectId);
      for (const anchor of aspectAnchors) {
        anchors.push({
          path: anchor.file_path,
          startLine: anchor.start_line,
          endLine: anchor.end_line,
          aspect: aspectId,
        });
      }
    }

    results.push({
      symbol: current.symbol,
      depth: current.depth,
      path: current.path,
      relation: current.relation,
      weight: current.weight,
      aspects,
      anchors: anchors.length > 0 ? anchors : undefined,
    });

    // Follow graph edges
    const edges = getAllEdgesFor(db, current.symbol);
    for (const edge of edges) {
      const neighbor = edge.source === current.symbol ? edge.target : edge.source;
      if (!visited.has(neighbor)) {
        const newWeight = current.weight * edge.weight;
        if (newWeight >= minWeight) {
          queue.push({
            symbol: neighbor,
            depth: current.depth + 1,
            path: [...current.path, neighbor],
            relation: edge.relation,
            weight: newWeight,
          });
        }
      }
    }

    // Follow symbol index references
    const entry = findSymbolEntry(index, current.symbol);
    if (entry) {
      for (const ref of entry.references) {
        if (!visited.has(ref)) {
          const newWeight = current.weight * 0.5; // index references have implicit 0.5 weight
          if (newWeight >= minWeight) {
            queue.push({
              symbol: ref,
              depth: current.depth + 1,
              path: [...current.path, ref],
              relation: 'references',
              weight: newWeight,
            });
          }
        }
      }

      for (const ref of entry.referencedBy) {
        if (!visited.has(ref)) {
          const newWeight = current.weight * 0.5;
          if (newWeight >= minWeight) {
            queue.push({
              symbol: ref,
              depth: current.depth + 1,
              path: [...current.path, ref],
              relation: 'referenced-by',
              weight: newWeight,
            });
          }
        }
      }
    }
  }

  // Sort by weight descending
  results.sort((a, b) => b.weight - a.weight);

  return results;
}

// ─── Heatmap ─────────────────────────────────────────────────────────

/**
 * Increment the heatmap counter for an aspect and access type.
 *
 * Uses an UPSERT pattern to insert or increment the counter.
 *
 * @param db - The sql.js Database instance
 * @param aspectId - The aspect symbol identifier
 * @param accessType - The type of access (search, ripple, navigate, direct)
 */
export function incrementHeatmap(
  db: Database,
  aspectId: string,
  accessType: HeatmapAccessType
): void {
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO heatmap (aspect_id, access_type, count, last_accessed)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(aspect_id, access_type)
     DO UPDATE SET count = count + 1, last_accessed = ?`,
    [aspectId, accessType, now, now]
  );
}

/**
 * Get top-N heatmap entries, optionally filtered by access type.
 *
 * @param db - The sql.js Database instance
 * @param limit - Maximum number of entries to return (default 20)
 * @param accessType - Optional filter by access type
 * @returns Array of heatmap rows sorted by count descending
 */
export function getHeatmap(
  db: Database,
  limit = 20,
  accessType?: string
): HeatmapRow[] {
  if (accessType) {
    return queryRows<HeatmapRow>(
      db,
      'SELECT * FROM heatmap WHERE access_type = ? ORDER BY count DESC LIMIT ?',
      [accessType, limit]
    );
  }

  return queryRows<HeatmapRow>(
    db,
    'SELECT * FROM heatmap ORDER BY count DESC LIMIT ?',
    [limit]
  );
}

// ─── Drift Detection ─────────────────────────────────────────────────

/**
 * Check if code at anchor locations has changed since last materialization.
 *
 * Reads the actual files at anchor line ranges, computes a SHA-256 hash of
 * the content, and compares against the stored content_hash. Optionally
 * scoped to a single aspect.
 *
 * @param db - The sql.js Database instance
 * @param rootDir - Absolute path to the project root directory
 * @param aspectId - Optional aspect ID to scope the check
 * @param autoHeal - Auto-update anchors for high-confidence shifts (default: true)
 * @returns Array of drift results for each anchor
 */
export function checkDrift(
  db: Database,
  rootDir: string,
  aspectId?: string,
  autoHeal: boolean = true,
): DriftResult[] {
  const anchorRows: AnchorRow[] = aspectId
    ? queryRows<AnchorRow>(db, 'SELECT * FROM anchors WHERE aspect_id = ?', [aspectId])
    : queryRows<AnchorRow>(db, 'SELECT * FROM anchors');

  const results: DriftResult[] = [];

  for (const anchor of anchorRows) {
    const absolutePath = path.isAbsolute(anchor.file_path)
      ? anchor.file_path
      : path.join(rootDir, anchor.file_path);

    if (!fs.existsSync(absolutePath)) {
      results.push({
        aspectId: anchor.aspect_id,
        path: anchor.file_path,
        startLine: anchor.start_line,
        endLine: anchor.end_line,
        status: 'missing',
        resolvedBy: 'none',
        exists: false,
        drifted: true,
      });
      continue;
    }

    try {
      const fileContent = fs.readFileSync(absolutePath, 'utf8');
      const lines = fileContent.split('\n');
      const startIdx = Math.max(0, anchor.start_line - 1);
      const endIdx = Math.min(lines.length, anchor.end_line);
      const sliceContent = lines.slice(startIdx, endIdx).join('\n');
      const currentExactHash = crypto.createHash('sha256').update(sliceContent).digest('hex');

      // Layer 1a: Exact hash match
      if (anchor.content_hash != null && currentExactHash === anchor.content_hash) {
        results.push({
          aspectId: anchor.aspect_id,
          path: anchor.file_path,
          startLine: anchor.start_line,
          endLine: anchor.end_line,
          status: 'clean',
          resolvedBy: 'exact-hash',
          exists: true,
          drifted: false,
        });

        if (anchor.drifted === 1) {
          db.run('UPDATE anchors SET drifted = 0 WHERE id = ?', [anchor.id]);
        }
        continue;
      }

      // Layer 1b: Normalized hash match (cosmetic change only)
      const currentNormalizedHash = crypto.createHash('sha256').update(normalizeForHash(sliceContent)).digest('hex');

      if (anchor.normalized_hash != null && currentNormalizedHash === anchor.normalized_hash) {
        // Cosmetic drift — whitespace/formatting changed but content is the same
        // Auto-heal: update the exact hash to the current value
        db.run('UPDATE anchors SET content_hash = ?, drifted = 0 WHERE id = ?', [currentExactHash, anchor.id]);

        results.push({
          aspectId: anchor.aspect_id,
          path: anchor.file_path,
          startLine: anchor.start_line,
          endLine: anchor.end_line,
          status: 'cosmetic',
          resolvedBy: 'normalized-hash',
          exists: true,
          drifted: false,
        });
        continue;
      }

      // No hash stored yet (first check after materialization without rootDir)
      if (anchor.content_hash == null && anchor.normalized_hash == null) {
        // Store both hashes now
        db.run(
          'UPDATE anchors SET content_hash = ?, normalized_hash = ?, drifted = 0 WHERE id = ?',
          [currentExactHash, currentNormalizedHash, anchor.id]
        );

        results.push({
          aspectId: anchor.aspect_id,
          path: anchor.file_path,
          startLine: anchor.start_line,
          endLine: anchor.end_line,
          status: 'clean',
          resolvedBy: 'exact-hash',
          exists: true,
          drifted: false,
        });
        continue;
      }

      // Layer 2: Git-aware line mapping
      // If we have a materialization commit, check if lines just shifted
      let resolvedByGit = false;
      if (anchor.materialized_at_commit) {
        const mapping = computeLineShift(
          rootDir,
          anchor.file_path,
          anchor.materialized_at_commit,
          anchor.start_line,
          anchor.end_line,
        );

        if (mapping) {
          // Lines shifted — read content at the new location and verify
          const shiftedStartIdx = Math.max(0, mapping.currentStart - 1);
          const shiftedEndIdx = Math.min(lines.length, mapping.currentEnd);
          const shiftedContent = lines.slice(shiftedStartIdx, shiftedEndIdx).join('\n');
          const shiftedExactHash = crypto.createHash('sha256').update(shiftedContent).digest('hex');

          if (anchor.content_hash != null && shiftedExactHash === anchor.content_hash) {
            // Content matches at the shifted location — auto-heal
            const healed = autoHeal;

            if (healed) {
              // Update DB with new line numbers
              db.run(
                'UPDATE anchors SET start_line = ?, end_line = ?, drifted = 0 WHERE id = ?',
                [mapping.currentStart, mapping.currentEnd, anchor.id]
              );

              // Look up the .purpose file that defines this aspect
              const aspectRow = queryRows<{ defined_in: string }>(
                db,
                'SELECT defined_in FROM aspects WHERE id = ?',
                [anchor.aspect_id]
              );
              if (aspectRow.length > 0) {
                healAnchorInPurposeFile(
                  rootDir,
                  aspectRow[0].defined_in,
                  anchor.file_path,
                  anchor.start_line,
                  anchor.end_line,
                  mapping.currentStart,
                  mapping.currentEnd,
                );
              }
            }

            results.push({
              aspectId: anchor.aspect_id,
              path: anchor.file_path,
              startLine: healed ? mapping.currentStart : anchor.start_line,
              endLine: healed ? mapping.currentEnd : anchor.end_line,
              status: 'shifted',
              resolvedBy: 'git-line-mapping',
              exists: true,
              drifted: false,
              suggestedStart: mapping.currentStart,
              suggestedEnd: mapping.currentEnd,
              autoHealed: healed,
            });
            resolvedByGit = true;
          } else {
            // Lines shifted but content also changed — check normalized hash at shifted location
            const shiftedNormalized = crypto.createHash('sha256').update(normalizeForHash(shiftedContent)).digest('hex');
            if (anchor.normalized_hash != null && shiftedNormalized === anchor.normalized_hash) {
              // Shifted + cosmetic change
              if (autoHeal) {
                const shiftedNewHash = crypto.createHash('sha256').update(shiftedContent).digest('hex');
                db.run(
                  'UPDATE anchors SET start_line = ?, end_line = ?, content_hash = ?, drifted = 0 WHERE id = ?',
                  [mapping.currentStart, mapping.currentEnd, shiftedNewHash, anchor.id]
                );

                const aspectRow = queryRows<{ defined_in: string }>(
                  db,
                  'SELECT defined_in FROM aspects WHERE id = ?',
                  [anchor.aspect_id]
                );
                if (aspectRow.length > 0) {
                  healAnchorInPurposeFile(
                    rootDir,
                    aspectRow[0].defined_in,
                    anchor.file_path,
                    anchor.start_line,
                    anchor.end_line,
                    mapping.currentStart,
                    mapping.currentEnd,
                  );
                }
              }

              results.push({
                aspectId: anchor.aspect_id,
                path: anchor.file_path,
                startLine: autoHeal ? mapping.currentStart : anchor.start_line,
                endLine: autoHeal ? mapping.currentEnd : anchor.end_line,
                status: 'shifted',
                resolvedBy: 'git-line-mapping',
                exists: true,
                drifted: false,
                suggestedStart: mapping.currentStart,
                suggestedEnd: mapping.currentEnd,
                autoHealed: autoHeal,
              });
              resolvedByGit = true;
            }
          }
        }
      }

      if (resolvedByGit) continue;

      // Real drift — content genuinely changed (future: Layer 3 content search)
      db.run('UPDATE anchors SET drifted = 1 WHERE id = ?', [anchor.id]);

      results.push({
        aspectId: anchor.aspect_id,
        path: anchor.file_path,
        startLine: anchor.start_line,
        endLine: anchor.end_line,
        status: 'modified',
        resolvedBy: 'none',
        exists: true,
        currentContent: sliceContent,
        drifted: true,
      });
    } catch {
      results.push({
        aspectId: anchor.aspect_id,
        path: anchor.file_path,
        startLine: anchor.start_line,
        endLine: anchor.end_line,
        status: 'modified',
        resolvedBy: 'none',
        exists: true,
        drifted: true,
      });
    }
  }

  return results;
}

// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Resolve a CodeAnchor's lines field into a startLine/endLine pair.
 */
function resolveAnchorLines(anchor: CodeAnchor): { startLine: number; endLine: number } {
  const { lines } = anchor;

  if (typeof lines === 'number') {
    // Single line
    return { startLine: lines, endLine: lines };
  }

  if (Array.isArray(lines)) {
    if (lines.length === 2) {
      // Range: [start, end] per CodeAnchor type definition
      return { startLine: lines[0], endLine: lines[1] };
    }
    // Multiple lines: use min/max
    return {
      startLine: Math.min(...lines),
      endLine: Math.max(...lines),
    };
  }

  return { startLine: 1, endLine: 1 };
}

// ─── Layer 2: Git-aware line mapping ────────────────────────────────

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface LineMapping {
  originalStart: number;
  originalEnd: number;
  currentStart: number;
  currentEnd: number;
}

/**
 * Parse unified diff output into structured hunks.
 * Handles the @@ -oldStart,oldCount +newStart,newCount @@ format.
 */
export function parseUnifiedDiffHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

  let match: RegExpExecArray | null;
  while ((match = hunkPattern.exec(diffOutput)) !== null) {
    hunks.push({
      oldStart: parseInt(match[1], 10),
      oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
      newStart: parseInt(match[3], 10),
      newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
    });
  }

  return hunks;
}

/**
 * Compute how an anchor's line range shifted based on git diff hunks.
 * Returns null if a hunk overlaps the anchor (content was modified in-place).
 */
export function computeLineShift(
  rootDir: string,
  filePath: string,
  fromCommit: string,
  originalStart: number,
  originalEnd: number,
): LineMapping | null {
  let diff: string;
  try {
    diff = execSync(
      `git diff ${fromCommit}..HEAD --unified=0 -- "${filePath}"`,
      { cwd: rootDir, encoding: 'utf8', timeout: 5000 }
    );
  } catch {
    return null; // git not available or file not tracked
  }

  if (!diff.trim()) {
    // No changes to this file since commit — lines haven't shifted
    return { originalStart, originalEnd, currentStart: originalStart, currentEnd: originalEnd };
  }

  const hunks = parseUnifiedDiffHunks(diff);
  let offset = 0;

  for (const hunk of hunks) {
    const hunkOldEnd = hunk.oldStart + hunk.oldCount;

    // Hunk is entirely before the anchor — accumulate offset
    if (hunkOldEnd <= originalStart) {
      offset += (hunk.newCount - hunk.oldCount);
      continue;
    }

    // Hunk overlaps the anchor range — can't just shift, content was modified
    if (hunk.oldStart < originalEnd) {
      return null;
    }

    // Hunk is after the anchor — stop accumulating
    break;
  }

  if (offset === 0) return null; // No shift needed

  return {
    originalStart,
    originalEnd,
    currentStart: originalStart + offset,
    currentEnd: originalEnd + offset,
  };
}

/**
 * Update anchor line numbers in a .purpose file.
 * Performs a surgical string replacement of the anchor reference.
 */
export function healAnchorInPurposeFile(
  rootDir: string,
  purposeFilePath: string,
  anchorFilePath: string,
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): boolean {
  const absolutePurpose = path.isAbsolute(purposeFilePath)
    ? purposeFilePath
    : path.join(rootDir, purposeFilePath);

  if (!fs.existsSync(absolutePurpose)) return false;

  try {
    const content = fs.readFileSync(absolutePurpose, 'utf8');

    // Build the old anchor string: "file.ts:15-35" or "file.ts:15"
    const oldAnchor = oldStart === oldEnd
      ? `${anchorFilePath}:${oldStart}`
      : `${anchorFilePath}:${oldStart}-${oldEnd}`;
    const newAnchor = newStart === newEnd
      ? `${anchorFilePath}:${newStart}`
      : `${anchorFilePath}:${newStart}-${newEnd}`;

    if (!content.includes(oldAnchor)) return false;

    const updated = content.replace(oldAnchor, newAnchor);
    fs.writeFileSync(absolutePurpose, updated, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize content before hashing to ignore cosmetic changes.
 * Strips trailing whitespace, removes blank lines, and collapses internal whitespace.
 */
function normalizeForHash(content: string): string {
  return content
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    .map(line => line.replace(/\s+/g, ' '))
    .join('\n');
}

/**
 * Compute SHA-256 hashes of an anchor's content for drift detection.
 * Returns both exact and normalized hashes, or null if the file cannot be read.
 */
function computeAnchorHash(anchor: CodeAnchor, rootDir: string | null): { exact: string | null; normalized: string | null } {
  if (!rootDir) return { exact: null, normalized: null };

  const absolutePath = path.isAbsolute(anchor.path)
    ? anchor.path
    : path.join(rootDir, anchor.path);

  if (!fs.existsSync(absolutePath)) return { exact: null, normalized: null };

  try {
    const fileContent = fs.readFileSync(absolutePath, 'utf8');
    const lines = fileContent.split('\n');
    const { startLine, endLine } = resolveAnchorLines(anchor);
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(lines.length, endLine);
    const sliceContent = lines.slice(startIdx, endIdx).join('\n');
    const exact = crypto.createHash('sha256').update(sliceContent).digest('hex');
    const normalized = crypto.createHash('sha256').update(normalizeForHash(sliceContent)).digest('hex');
    return { exact, normalized };
  } catch {
    return { exact: null, normalized: null };
  }
}

/**
 * Infer the aspect category from its data and entry properties.
 *
 * Priority: explicit data.category > description heuristic > default 'rule'
 */
function inferCategory(data: Record<string, unknown>, entry: SymbolEntry): string {
  if (typeof data.category === 'string') return data.category;

  const desc = (entry.description ?? '').toLowerCase();

  if (/\b(must|require|always)\b/.test(desc)) return 'rule';
  if (/\b(decided|chose)\b/.test(desc)) return 'decision';
  if (/\b(limit|cannot)\b/.test(desc)) return 'constraint';
  if (/\b(set to|configured|value)\b/.test(desc)) return 'configuration';

  return 'rule';
}

/**
 * Infer the aspect severity from its data and entry tags.
 *
 * Priority: explicit data.severity > tag heuristic > default 'medium'
 */
function inferSeverity(data: Record<string, unknown>, entry: SymbolEntry): string {
  if (typeof data.severity === 'string') return data.severity;

  const tags = entry.tags ?? [];

  if (tags.includes('critical')) return 'critical';
  if (tags.includes('security') || tags.includes('compliance')) return 'high';

  return 'medium';
}

/**
 * Look up a symbol entry in the index by its symbol string.
 */
function findSymbolEntry(index: SymbolIndex, symbol: string): SymbolEntry | undefined {
  for (const entry of index.entries.values()) {
    if (entry.symbol === symbol) {
      return entry;
    }
  }
  return undefined;
}
