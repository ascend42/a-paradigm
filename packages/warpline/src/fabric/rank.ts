/**
 * #rank — DIRECT-CONTESTED vs RIPPLE-ONLY ranking, as an engine function
 * (T-2026-07-03-002; lifted out of the CLI in SP1b of `refusal:v1`).
 *
 * WHY THIS IS ENGINE, NOT PRESENTATION. Ground truth over 275 real merges (18
 * divergeMeaningOnly hits) proved flag VOLUME inversely predicts payoff: ≤6-symbol
 * flag sets were 50% churn-validated, while every ≥10-symbol set — including seven
 * 48-176-symbol avalanches rippling out of ~2 genuinely contested units via
 * essence transitivity (Merkle-by-target) — was 0%. So "which of these flags is
 * the actual contest?" is a JUDGMENT the engine owes every consumer, not a
 * rendering choice one consumer makes. The CLI was the only caller while the CLI
 * was the only surface; a #refusal must rank identically, so the rule moves here
 * and both project it (G3).
 *
 * The ranking is DATA ONLY: knot / dangle / autoClean / verdict semantics do not
 * move (a policy change would invalidate the committed base-rate evidence). An
 * ABSENT `direct` flag reads as DIRECT — unknown is surfaced, never silently
 * collapsed into the ripple bucket that consumers are entitled to hide.
 *
 * Pure and SILENT: no I/O, no clock, no console (cli.ts is the only file allowed
 * to write to stdout).
 */

import type { Knot, Dangle } from '../predict.js';

/** Anything carrying #predict's own-content-changed flag. */
type Rankable = Pick<Knot, 'direct'> | Pick<Dangle, 'direct'>;

/**
 * The rank of one contested unit. DIRECT ⟺ at least one side changed the unit's
 * OWN content; RIPPLE ⟺ the essence shifted only via edge-target transitivity.
 * Absent flag ⇒ 'direct' (conservative: unknown is surfaced).
 */
export function rankOf(x: Rankable): 'direct' | 'ripple' {
  return (x.direct ?? true) ? 'direct' : 'ripple';
}

/** The partitioned knot set — direct-contested named, ripple-only collapsible. */
export interface RankedVerdicts {
  direct: Knot[];
  ripple: Knot[];
}

/**
 * Partition knots into DIRECT-CONTESTED vs RIPPLE-ONLY, preserving input order
 * within each bucket. Behaviourally identical to the `partitionKnots` this
 * replaces — the CLI's anti-avalanche display and #refusal's contested cap are
 * now the same judgment applied twice.
 */
export function rankVerdicts(knots: readonly Knot[]): RankedVerdicts {
  const direct: Knot[] = [];
  const ripple: Knot[] = [];
  for (const k of knots) (rankOf(k) === 'direct' ? direct : ripple).push(k);
  return { direct, ripple };
}
