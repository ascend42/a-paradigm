/**
 * #memory-steward-score — scoring + finding derivation for the Memory Steward
 * (Memory Steward A1, TD-2026-09-19-110). Pure functions only.
 *
 * `scoreEntry` turns a ParsedMemoryEntry into a normalized 0..1 STALENESS score
 * by composing three signals:
 *   - AGE: how long since the file was last touched (mtimeMs), normalized
 *     against a horizon and weighted by the entry's type-decay rate;
 *   - TYPE DECAY: project/status memory decays FAST (its truth expires), while
 *     feedback/reference/user memory is durable and decays slowly;
 *   - GRAPH PENALTY: how much of what the entry references no longer exists
 *     (from the A0 graph-validity verdict).
 *
 * `deriveFinding` maps a score to a suggested, deduplicable action.
 *
 * Age/window constants are RE-DEFINED here (mirroring
 * packages/paradigm-mcp/src/utils/decay.ts) rather than imported — the CLI core
 * must not depend on paradigm-mcp.
 */

import type { MemoryEntryType, ParsedMemoryEntry } from '@a-company/premise-core';
import type { MemoryFinding, MemoryScore, MemorySuggestion } from './types.js';

// ── Constants (re-defined locally; see decay.ts) ────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Age horizon (days) at which the age signal saturates to 1.0 for a fast-decay
 * entry. ~90d ≈ one quarter — a project-status note older than a quarter is
 * almost certainly stale. Chosen a notch above decay.ts's 14/30d windows because
 * this scores DURABILITY, not survival.
 */
const AGE_HORIZON_DAYS = 90;

/** Anti-nag TTL for a derived finding (mirrors decay.ts SURVIVAL_WINDOW_DAYS). */
const FINDING_TTL_DAYS = 14;

/**
 * Per-type decay weight. Higher = decays faster = age counts for more.
 *   project  — status/plans; truth expires quickly.
 *   unknown  — the MEMORY.md index and untyped notes; medium.
 *   feedback — durable habits/rules; slow.
 *   reference/user — durable knowledge/preferences; slowest.
 */
const TYPE_DECAY_WEIGHT: Record<MemoryEntryType, number> = {
  project: 1.0,
  unknown: 0.6,
  feedback: 0.3,
  reference: 0.2,
  user: 0.2,
};

/** Graph-validity verdict → 0..1 penalty. */
const GRAPH_PENALTY: Record<ParsedMemoryEntry['graphValidity']['verdict'], number> = {
  'provably-stale': 1.0,
  'partly-stale': 0.5,
  valid: 0,
};

// Composite weighting: the graph is the stronger, more objective signal.
const W_GRAPH = 0.6;
const W_AGE = 0.4;

export interface ScoreOptions {
  /** Override "now" (ms). Test seam. */
  now?: number;
}

/** Compute the composite staleness score for a parsed memory entry. */
export function scoreEntry(entry: ParsedMemoryEntry, opts: ScoreOptions = {}): MemoryScore {
  const now = opts.now ?? Date.now();
  const ageDays = Math.max(0, (now - entry.mtimeMs) / MS_PER_DAY);

  const typeDecayWeight = TYPE_DECAY_WEIGHT[entry.type] ?? TYPE_DECAY_WEIGHT.unknown;
  const graphPenalty = GRAPH_PENALTY[entry.graphValidity.verdict] ?? 0;

  // Age contribution: saturating ramp to the horizon, scaled by how fast this
  // type decays. A durable (low-weight) entry barely ages; a status entry ages fast.
  const ageComponent = clamp01(ageDays / AGE_HORIZON_DAYS);
  const ageScore = ageComponent * typeDecayWeight;

  const score = clamp01(W_GRAPH * graphPenalty + W_AGE * ageScore);

  return { entry, ageDays, typeDecayWeight, graphPenalty, score };
}

/**
 * Derive a routing/pruning finding from a scored entry, or null when no
 * confident suggestion applies (the Steward stays quiet rather than nag).
 *
 * Priority:
 *   1. provably-stale        → prune
 *   2. near-duplicate        → merge
 *   3. type feedback         → route:habits (tips/rules belong in the habits system)
 *   4. type project          → route:task   (status/plans belong in the task DAG)
 *   5. type reference + cites a decision (TD-…) → route:decisions (durable "why")
 *   6. durable + fresh + valid (reference/user, low score) → pin
 *   else null
 */
export function deriveFinding(score: MemoryScore, opts: ScoreOptions = {}): MemoryFinding | null {
  const { entry } = score;
  const now = opts.now ?? Date.now();
  const expiresAt = new Date(now + FINDING_TTL_DAYS * MS_PER_DAY).toISOString();
  const firstDeadSymbol = entry.graphValidity.deadSymbols[0];
  const target = firstDeadSymbol
    ? { file: entry.file, symbol: firstDeadSymbol }
    : { file: entry.file };

  const make = (suggestion: MemorySuggestion, rationale: string): MemoryFinding => ({
    entryFile: entry.file,
    suggestion,
    rationale,
    target,
    expiresAt,
  });

  // 1. provably-stale → prune — but ONLY for status-like types (project/unknown).
  // Durable guidance (feedback tips, user preferences, reference pointers) does
  // not lose its value when a symbol it cites is renamed — that reference needs
  // UPDATING, not deleting — so those types fall through to routing/refresh even
  // when provably-stale. The dead symbol still annotates the rationale + target.
  const PRUNABLE_TYPES = new Set<ParsedMemoryEntry['type']>(['project', 'unknown']);
  if (entry.graphValidity.verdict === 'provably-stale' && PRUNABLE_TYPES.has(entry.type)) {
    return make(
      'prune',
      `Every referenced symbol/file is gone (${entry.graphValidity.deadSymbols.length} dead symbols, ${entry.graphValidity.deadFiles.length} dead files); this status note no longer describes anything real.`,
    );
  }

  // 2. near-duplicate → merge
  if (score.clusterId) {
    return make('merge', `Near-duplicate of other entries in cluster ${score.clusterId}.`);
  }

  // 3. feedback → route into the habits system
  if (entry.type === 'feedback') {
    return make('route:habits', 'Feedback/tip memory belongs in the habits system.');
  }

  // 4. project → route into the task DAG
  if (entry.type === 'project') {
    return make('route:task', 'Project/status memory belongs in the task DAG, not native memory.');
  }

  // 5. reference that cites a decision → route into the decision store
  if (entry.type === 'reference' && mentionsDecision(entry.body)) {
    return make('route:decisions', 'References a durable decision (TD-…); belongs in the decision store.');
  }

  // 6. durable, fresh, still-valid knowledge → pin
  if (
    (entry.type === 'reference' || entry.type === 'user') &&
    entry.graphValidity.verdict === 'valid' &&
    score.score < 0.2
  ) {
    return make('pin', 'High-value durable knowledge that still resolves; pin to protect from decay.');
  }

  return null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const DECISION_RE = /\bTD-\d{4}-\d{2}-\d{2}-\d+\b/;

function mentionsDecision(body: string): boolean {
  return DECISION_RE.test(body);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
