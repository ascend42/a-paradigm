/**
 * Warpline web types — a STRUCTURAL mirror of the engine's exported shapes
 * (`@a-company/warpline`'s OracleRecord, Knot, Dangle, Justification, Prediction).
 *
 * The platform-ui is a separate Vite package and does not depend on the engine
 * package directly, so we re-declare the read-only fields the viewer binds. The
 * field names track the engine VERBATIM (oracle.ts / predict.ts / justification.ts)
 * so the UI binds real OracleRecord fields, not an invented shape:
 *
 *   - Knot.{stableKey, symbol, essenceA, essenceB, conflictingSlots}
 *   - Dangle.{fromKey, fromSymbol, edgeKind, danglingTargetSymbol, retiredBy}
 *   - convergence.{agreeClean, agreeConflict, divergeGitOnly, divergeMeaningOnly,
 *                  score, verdict}
 *   - gitReality.{conflicted, conflictSymbols, conflictPaths}
 *   - justifications.{A,B}.{actor, intent}
 *
 * NOTE on the spec's `danglingTargetEssence`: the engine field is actually named
 * `danglingTargetSymbol` (predict.ts). It carries the retired target's identity —
 * exactly the "target essence" the spec's DangleRender labels — so the viewer
 * reads `danglingTargetSymbol` and presents it as the dangling target. No new
 * field is invented.
 */

export interface Knot {
  stableKey: string;
  symbol: string;
  essenceA?: string;
  essenceB?: string;
  conflictingSlots: string[];
  /**
   * DIRECT-CONTESTED vs RIPPLE-ONLY ranking (engine predict.ts, T-2026-07-03-002):
   * true = a side changed the unit's OWN content; false = flagged only via
   * edge-target essence transitivity (avalanche). Absent (older records) ⇒ direct.
   */
  direct?: boolean;
}

export interface Dangle {
  fromKey: string;
  fromSymbol: string;
  edgeKind: string;
  /** The retired target's identity — the "target essence" the void is labeled with. */
  danglingTargetSymbol: string;
  retiredBy: 'A' | 'B';
  /** Same ranking signal as Knot.direct (structurally true for dangles). */
  direct?: boolean;
}

export interface OraclePrediction {
  autoClean: string[];
  knots: Knot[];
  dangling: Dangle[];
}

export interface GitReality {
  conflicted: boolean;
  conflictSymbols: string[];
  conflictPaths: string[];
}

export interface Convergence {
  agreeClean: string[];
  agreeConflict: string[];
  divergeGitOnly: string[];
  divergeMeaningOnly: string[];
  /**
   * KNOT-SIZE RANKING (engine oracle.ts, T-2026-07-03-002, additive): the
   * divergeMeaningOnly flag set partitioned into direct-contested (own content
   * changed on ≥1 side) vs ripple-only (essence-transitivity avalanche).
   * knotSize = directContested.length is the ranking/threshold key. Optional —
   * absent on records written before the ranking shipped.
   */
  directContested?: string[];
  rippleOnly?: string[];
  knotSize?: number;
  flagCount?: number;
  score: number;
  verdict: 'CONVERGENT' | 'DIVERGENT';
}

export interface Justification {
  actor: string;
  intent: string;
  // other engine fields exist but the viewer only binds actor + intent
  [key: string]: unknown;
}

export interface OracleRecord {
  schemaVersion?: number;
  ts: string;
  repo?: string;
  branchA: string;
  branchB: string;
  mergeBase: string;
  stateIds?: { base: string; A: string; B: string };
  prediction: OraclePrediction;
  gitReality: GitReality;
  convergence: Convergence;
  justifications: { A: Justification; B: Justification };
}

/** GET /api/warpline/refs shape. */
export interface RefsResponse {
  head: string;
  branches: string[];
}
