/**
 * Iteration Loop Types
 *
 * Types for the stateless iteration-loop primitive (TD-2026-06-09-522).
 *
 * The loop runs the SAME specialist across multiple rounds (re-review /
 * iterate-with-same-role) WITHOUT warm/persistent subagents. Each round is a
 * fresh spawn; continuity is carried entirely by a typed `IterationDelta`
 * threaded into the next round's task.
 *
 * Three ratified guardrails are encoded here:
 *  1. Typed delta contract carries the convergence verdict as a TYPED field —
 *     never inferred from free-text relay parsing.
 *  2. `maxRounds` is REQUIRED (no implicit infinite default); exhausting it
 *     without convergence yields a structured `unresolved` result.
 *  3. Belief-revision is a typed field (`corrections`) so round-boundary
 *     promotion fires only when the agent's belief actually changed.
 */

import type { SpawnResult } from './agent-spawner.js';
import type { TokenUsage } from './agent-provider.js';

/** Convergence signal emitted by the iterating agent. */
export type IterationVerdict = 'approved' | 'changes-requested';

/**
 * The continuity contract threaded between rounds. In stateless mode this
 * object IS the memory — a fresh agent has nothing else from prior rounds.
 *
 * It is also the canonical source for belief-revision promotion: `corrections`
 * (not `whatChanged`) gates whether the round produced a learnable insight.
 */
export interface IterationDelta {
  /** Convergence signal. Loop converges when `approved` (+ openThreads empty in single-role). */
  verdict: IterationVerdict;
  /** Progress made this round. Non-empty on most productive rounds. */
  whatChanged: string[];
  /** Settled claims a later round must NOT re-litigate. */
  alreadyVerified: string[];
  /** Unresolved items the next round must address. */
  openThreads: string[];
  /** Belief revisions ONLY (was-X, now-Y). Drives round-boundary promotion. */
  corrections: string[];
}

export type IterationMode = 'single-role' | 'ping-pong';

export interface IterationOptions {
  /** REQUIRED — hard cap on rounds. No implicit infinite default. */
  maxRounds: number;
  /** `single-role`: one specialist iterates on its own output.
   *  `ping-pong`: `iterateAgent` fixes (odd rounds), `reviewAgent` re-reviews (even rounds). */
  mode: IterationMode;
  /** The specialist that iterates (e.g. 'builder'). */
  iterateAgent: string;
  /** Required iff mode === 'ping-pong'. The reviewing specialist (e.g. 'reviewer'). */
  reviewAgent?: string;
  workingDirectory?: string;
  mcpServerPath?: string;
  /** Observability hook fired after each round completes. */
  onRound?: (round: IterationRoundResult) => void;
}

export interface IterationRoundResult {
  round: number;
  agent: string;
  spawnResult: SpawnResult;
  /** Parsed delta, or null if the agent emitted no parseable verdict block. */
  delta: IterationDelta | null;
  /** Whether this round's belief revision was promoted to the learning loop. */
  promoted: boolean;
}

export interface IterationLoopResult {
  converged: boolean;
  rounds: IterationRoundResult[];
  finalDelta: IterationDelta | null;
  totalTokens: TokenUsage;
  /** Present iff `converged === false`. The last attempt is NEVER returned as a pass. */
  unresolved?: {
    reason: 'max-rounds' | 'unparseable-verdict' | 'spawn-failed';
    roundsRun: number;
    openThreads: string[];
  };
}
