/**
 * Aspect Search — Three-tier fuzzy search engine with learning
 *
 * Provides search over the aspect graph SQLite database using a three-tier
 * strategy:
 *   Tier 1: Learned mappings from search_weights (highest confidence)
 *   Tier 2: FTS5 full-text search via aspects_fts virtual table
 *   Tier 3: Fuzzy fallback using Levenshtein distance
 *
 * The engine learns from user confirmations: when a user selects a result,
 * the query-to-aspect mapping is reinforced. Unselected alternatives decay.
 */

import type { Database } from 'sql.js';
import type { AspectSearchResult } from '../types/aspect-graph.js';

// ============================================
// Stop Words
// ============================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'how', 'does', 'what', 'why', 'when', 'where',
  'do', 'can', 'will', 'should', 'would', 'could', 'are', 'was', 'were',
  'been', 'being', 'have', 'has', 'had', 'this', 'that', 'it', 'its',
  'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by', 'from',
  'or', 'and', 'but', 'not',
]);

/** Decay factor applied to non-selected learned mappings on confirmation */
const DECAY_FACTOR = 0.95;

/** Minimum fuzzy score threshold for tier-3 results */
const FUZZY_SCORE_THRESHOLD = 0.3;

/** Default result limit */
const DEFAULT_LIMIT = 10;

// ============================================
// Levenshtein Distance
// ============================================

/**
 * Compute the Levenshtein edit distance between two strings.
 * Classic dynamic programming approach, O(n*m) time and space.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Edge cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Build distance matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

// ============================================
// Query Normalization
// ============================================

/**
 * Normalize a search query for consistent matching.
 *
 * - Lowercases all text
 * - Removes stop words (the, a, an, is, how, does, etc.)
 * - Sorts remaining tokens alphabetically
 * - Joins with space
 *
 * @param query - Raw search query string
 * @returns Normalized query suitable for learned-mapping lookup
 *
 * @example
 * normalizeQuery("how does pricing work") // => "pricing work"
 * normalizeQuery("What is the token expiry") // => "expiry token"
 */
export function normalizeQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));

  tokens.sort();
  return tokens.join(' ');
}

// ============================================
// FTS5 Detection
// ============================================

/**
 * Check if the FTS5 virtual table `aspects_fts` exists and is usable.
 *
 * @param db - Open sql.js Database instance
 * @returns true if FTS5 search is available
 */
export function hasFts5(db: Database): boolean {
  try {
    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'aspects_fts'"
    );
    return result.length > 0 && result[0].values.length > 0;
  } catch {
    return false;
  }
}

// ============================================
// Three-Tier Search
// ============================================

/**
 * Search aspects using a three-tier strategy with learning.
 *
 * **Tier 1 — Learned mappings:** Queries the `search_weights` table by
 * normalized query prefix match, joined with aspects, ordered by weight DESC.
 * Returns immediately if results are found.
 *
 * **Tier 2 — FTS5 full-text:** If FTS5 is available, matches against the
 * `aspects_fts` virtual table. Returns if results are found.
 *
 * **Tier 3 — Fuzzy fallback:** Loads all aspect IDs and descriptions, uses
 * Levenshtein distance to find closest matches (score > 0.3).
 *
 * Category and severity filters are applied at each tier. Results are limited
 * to the specified count (default 10).
 *
 * @param db - Open sql.js Database instance
 * @param query - Search query string
 * @param options - Optional filters and limit
 * @returns Array of search results with tier, score, and aspect metadata
 */
export function searchAspects(
  db: Database,
  query: string,
  options?: {
    category?: string;
    severity?: string;
    limit?: number;
  }
): AspectSearchResult[] {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const normalized = normalizeQuery(query);

  if (normalized.length === 0) {
    return [];
  }

  // Tier 1: Learned mappings
  const tier1 = searchTier1Learned(db, normalized, options);
  if (tier1.length > 0) {
    return tier1.slice(0, limit);
  }

  // Tier 2: FTS5 full-text search
  if (hasFts5(db)) {
    const tier2 = searchTier2Fts(db, normalized, options);
    if (tier2.length > 0) {
      return tier2.slice(0, limit);
    }
  }

  // Tier 3: Fuzzy fallback
  const tier3 = searchTier3Fuzzy(db, normalized, options);
  return tier3.slice(0, limit);
}

// ============================================
// Tier 1: Learned Mappings
// ============================================

/**
 * Search using learned query-to-aspect mappings from the search_weights table.
 */
function searchTier1Learned(
  db: Database,
  normalized: string,
  options?: { category?: string; severity?: string }
): AspectSearchResult[] {
  try {
    let sql = `
      SELECT
        a.id, a.description, a.category, a.severity, a.tags,
        sw.weight,
        (SELECT COUNT(*) FROM anchors anc WHERE anc.aspect_id = a.id) AS anchor_count
      FROM search_weights sw
      JOIN aspects a ON sw.aspect_id = a.id
      WHERE sw.query_normalized LIKE ? || '%'
    `;
    const params: (string | number)[] = [normalized];

    if (options?.category) {
      sql += ' AND a.category = ?';
      params.push(options.category);
    }
    if (options?.severity) {
      sql += ' AND a.severity = ?';
      params.push(options.severity);
    }

    sql += ' ORDER BY sw.weight DESC';

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const results: AspectSearchResult[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        id: string;
        description: string;
        category: string;
        severity: string;
        tags: string | null;
        weight: number;
        anchor_count: number;
      };

      results.push({
        id: row.id,
        description: row.description,
        category: row.category || undefined,
        severity: row.severity || undefined,
        score: row.weight,
        tier: 1,
        tags: row.tags ? parseTags(row.tags) : undefined,
        anchorCount: row.anchor_count,
      });
    }

    stmt.free();
    return results;
  } catch {
    // Table may not exist yet; fall through to next tier
    return [];
  }
}

// ============================================
// Tier 2: FTS5 Full-Text Search
// ============================================

/**
 * Search using FTS5 full-text index on aspects.
 */
function searchTier2Fts(
  db: Database,
  normalized: string,
  options?: { category?: string; severity?: string }
): AspectSearchResult[] {
  try {
    // Build FTS5 match expression: each token becomes a prefix match
    const ftsQuery = normalized
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"*`)
      .join(' ');

    if (ftsQuery.length === 0) {
      return [];
    }

    let sql = `
      SELECT
        a.id, a.description, a.category, a.severity, a.tags,
        rank AS fts_rank,
        (SELECT COUNT(*) FROM anchors anc WHERE anc.aspect_id = a.id) AS anchor_count
      FROM aspects_fts fts
      JOIN aspects a ON fts.rowid = a.rowid
      WHERE aspects_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (options?.category) {
      sql += ' AND a.category = ?';
      params.push(options.category);
    }
    if (options?.severity) {
      sql += ' AND a.severity = ?';
      params.push(options.severity);
    }

    sql += ' ORDER BY rank';

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const results: AspectSearchResult[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        id: string;
        description: string;
        category: string;
        severity: string;
        tags: string | null;
        fts_rank: number;
        anchor_count: number;
      };

      // FTS5 rank is negative (lower = better match); convert to positive score
      const score = Math.abs(row.fts_rank);

      results.push({
        id: row.id,
        description: row.description,
        category: row.category || undefined,
        severity: row.severity || undefined,
        score,
        tier: 2,
        tags: row.tags ? parseTags(row.tags) : undefined,
        anchorCount: row.anchor_count,
      });
    }

    stmt.free();
    return results;
  } catch {
    // FTS5 query error; fall through to fuzzy
    return [];
  }
}

// ============================================
// Tier 3: Fuzzy Fallback (Levenshtein)
// ============================================

/**
 * Fuzzy search using Levenshtein distance against all aspect IDs and descriptions.
 */
function searchTier3Fuzzy(
  db: Database,
  normalized: string,
  options?: { category?: string; severity?: string }
): AspectSearchResult[] {
  try {
    let sql = `
      SELECT
        a.id, a.description, a.category, a.severity, a.tags,
        (SELECT COUNT(*) FROM anchors anc WHERE anc.aspect_id = a.id) AS anchor_count
      FROM aspects a
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (options?.category) {
      sql += ' AND a.category = ?';
      params.push(options.category);
    }
    if (options?.severity) {
      sql += ' AND a.severity = ?';
      params.push(options.severity);
    }

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const candidates: Array<{
      id: string;
      description: string;
      category: string;
      severity: string;
      tags: string | null;
      anchorCount: number;
    }> = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        id: string;
        description: string;
        category: string;
        severity: string;
        tags: string | null;
        anchor_count: number;
      };
      candidates.push({
        id: row.id,
        description: row.description,
        category: row.category,
        severity: row.severity,
        tags: row.tags,
        anchorCount: row.anchor_count,
      });
    }

    stmt.free();

    // Score each candidate using Levenshtein distance
    const scored: AspectSearchResult[] = [];

    for (const candidate of candidates) {
      const bestScore = computeFuzzyScore(normalized, candidate.id, candidate.description);

      if (bestScore > FUZZY_SCORE_THRESHOLD) {
        scored.push({
          id: candidate.id,
          description: candidate.description,
          category: candidate.category || undefined,
          severity: candidate.severity || undefined,
          score: bestScore,
          tier: 3,
          tags: candidate.tags ? parseTags(candidate.tags) : undefined,
          anchorCount: candidate.anchorCount,
        });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored;
  } catch {
    return [];
  }
}

/**
 * Compute the best fuzzy score for a query against an aspect's ID and description.
 *
 * Compares the normalized query against:
 * - The aspect ID (without ~ prefix)
 * - Each word in the description
 *
 * Score = 1 / (1 + distance). Higher is better. Max is 1.0 (exact match).
 */
function computeFuzzyScore(normalized: string, aspectId: string, description: string): number {
  // Strip the ~ prefix from the aspect ID for comparison
  const cleanId = aspectId.startsWith('~') ? aspectId.slice(1) : aspectId;

  // Collect all comparison targets: the ID itself and each description word
  const targets: string[] = [cleanId.toLowerCase()];

  const descWords = description
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  targets.push(...descWords);

  // Compare each query token against each target, take the best match per token
  const queryTokens = normalized.split(/\s+/).filter((t) => t.length > 0);

  if (queryTokens.length === 0) {
    return 0;
  }

  let totalScore = 0;

  for (const token of queryTokens) {
    let bestTokenScore = 0;

    for (const target of targets) {
      const dist = levenshtein(token, target);
      const score = 1 / (1 + dist);

      if (score > bestTokenScore) {
        bestTokenScore = score;
      }
    }

    totalScore += bestTokenScore;
  }

  // Average score across all query tokens
  return totalScore / queryTokens.length;
}

// ============================================
// Learning / Confirmation
// ============================================

/**
 * Record a confirmed search result, reinforcing the query-to-aspect mapping.
 *
 * This is the learning feedback loop:
 * - Logs the search event to `search_log`
 * - UPSERTs the `search_weights` entry: if the mapping exists, weight += 1.0
 *   and hit_count++; otherwise inserts with weight=1.0 and hit_count=1
 * - Decays all other mappings for the same normalized query by multiplying
 *   their weight by 0.95, so that unselected alternatives gradually fade
 *
 * @param db - Open sql.js Database instance
 * @param query - The original (unnormalized) search query
 * @param aspectId - The aspect ID the user selected/confirmed
 */
export function confirmSearch(db: Database, query: string, aspectId: string): void {
  const normalized = normalizeQuery(query);
  const now = new Date().toISOString();

  // Log the search event
  try {
    db.run(
      `INSERT INTO search_log (query, results, selected, timestamp)
       VALUES (?, ?, ?, ?)`,
      [query, JSON.stringify([aspectId]), aspectId, now]
    );
  } catch {
    // search_log table may not exist; continue with weight update
  }

  // UPSERT search weight: reinforce this mapping
  try {
    db.run(
      `INSERT INTO search_weights (query_normalized, aspect_id, weight, hit_count, last_hit)
       VALUES (?, ?, 1.0, 1, ?)
       ON CONFLICT(query_normalized, aspect_id) DO UPDATE SET
         weight = weight + 1.0,
         hit_count = hit_count + 1,
         last_hit = ?`,
      [normalized, aspectId, now, now]
    );
  } catch {
    // search_weights table may not exist; skip learning
    return;
  }

  // Decay competing mappings for the same normalized query
  try {
    db.run(
      `UPDATE search_weights
       SET weight = weight * ?
       WHERE query_normalized = ? AND aspect_id != ?`,
      [DECAY_FACTOR, normalized, aspectId]
    );
  } catch {
    // Best-effort decay
  }
}

// ============================================
// Statistics
// ============================================

/**
 * Get aggregate search statistics from the database.
 *
 * @param db - Open sql.js Database instance
 * @returns Object with total searches, unique queries, and learned mapping counts
 */
export function getSearchStats(db: Database): {
  totalSearches: number;
  uniqueQueries: number;
  learnedMappings: number;
} {
  let totalSearches = 0;
  let uniqueQueries = 0;
  let learnedMappings = 0;

  try {
    const searchLogResult = db.exec('SELECT COUNT(*) FROM search_log');
    if (searchLogResult.length > 0 && searchLogResult[0].values.length > 0) {
      totalSearches = (searchLogResult[0].values[0][0] as number) || 0;
    }
  } catch {
    // search_log table may not exist
  }

  try {
    const uniqueResult = db.exec('SELECT COUNT(DISTINCT query) FROM search_log');
    if (uniqueResult.length > 0 && uniqueResult[0].values.length > 0) {
      uniqueQueries = (uniqueResult[0].values[0][0] as number) || 0;
    }
  } catch {
    // search_log table may not exist
  }

  try {
    const weightsResult = db.exec('SELECT COUNT(*) FROM search_weights');
    if (weightsResult.length > 0 && weightsResult[0].values.length > 0) {
      learnedMappings = (weightsResult[0].values[0][0] as number) || 0;
    }
  } catch {
    // search_weights table may not exist
  }

  return { totalSearches, uniqueQueries, learnedMappings };
}

// ============================================
// Helpers
// ============================================

/**
 * Parse a JSON-encoded tags string into an array.
 * Returns undefined if parsing fails or the value is null/empty.
 */
function parseTags(tagsJson: string): string[] | undefined {
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return undefined;
  } catch {
    // Tags might be comma-separated instead of JSON
    const parts = tagsJson.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    return parts.length > 0 ? parts : undefined;
  }
}
