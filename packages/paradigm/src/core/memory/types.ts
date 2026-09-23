/**
 * #memory-steward-types — the scoring + routing contract for the Memory Steward
 * (Memory Steward A1, TD-2026-09-19-110).
 *
 * A `MemoryScore` is a scored ParsedMemoryEntry (from @a-company/premise-core's
 * A0 scan). A `MemoryFinding` is a durable, deduplicable suggestion derived from
 * a score — the thing a later pass surfaces to the user (or routes into habits /
 * decisions / tasks / lore). Both are pure data; no I/O lives here.
 */

import type { ParsedMemoryEntry } from '@a-company/premise-core';

export type { ParsedMemoryEntry };

/**
 * A scored native-memory entry. `score` is a normalized 0..1 STALENESS estimate
 * (0 = fresh/valuable, 1 = stale/prunable). The component fields are surfaced so
 * downstream passes (and tests) can see WHY an entry scored the way it did.
 */
export interface MemoryScore {
  entry: ParsedMemoryEntry;
  /** Age in days, derived from the entry's mtimeMs. */
  ageDays: number;
  /** Per-type decay multiplier — status/project fast, feedback/reference/user slow. */
  typeDecayWeight: number;
  /** 0..1 penalty from the A0 graph-validity verdict. */
  graphPenalty: number;
  /** Composite 0..1 staleness score. */
  score: number;
  /** Near-duplicate cluster id, if this entry belongs to one (from clusterEntries). */
  clusterId?: string;
}

/** The action the Steward suggests for a scored entry. */
export type MemorySuggestion =
  | 'prune'
  | 'route:habits'
  | 'route:decisions'
  | 'route:task'
  | 'route:lore'
  | 'merge'
  | 'pin';

/**
 * A durable, deduplicable finding. `target` gives a stable dedup key (file, plus
 * the first dead symbol when relevant) so a later idempotent pass never
 * re-proposes the same action. `expiresAt` is an anti-nag TTL (~14 days).
 */
export interface MemoryFinding {
  /** Absolute path of the source memory file. */
  entryFile: string;
  suggestion: MemorySuggestion;
  rationale: string;
  target: { file: string; symbol?: string };
  /** ISO timestamp; the finding should be suppressed/re-evaluated after this. */
  expiresAt: string;
}
