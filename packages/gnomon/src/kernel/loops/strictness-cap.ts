/**
 * @symbol #loop-strictness
 *
 * #loop-strictness: a loop's EFFECTIVE autonomy under its repo's strictness level and run mode (docs/specs/
 * gnomon-loops.md §3.3 "Law 5 and strictness"; docs/specs/gnomon.md §3.4; build plan step 9, M2.11-lite; Aegis M2:
 * re-evaluated at EVERY node and again at land). Pure functions; the runner asks its `strictness` port for the repo's
 * cap {level, mode} each time and folds it through `effectiveAutonomy`.
 *
 *   L3, or the repo's effective run mode `manual`: nothing runs (FORBIDDEN{strictness-paused}); a running loop pauses
 *       before its next node (`loop.paused{reason:'strictness'}`; resuming is fresh presence).
 *   L2: effective autonomy = min(declared, propose): the `ask` ceiling wins, act nodes run as propose and land
 *       nothing alone. Concurrency 1 per repo.
 *   L1: concurrency STRICTNESS_CONCURRENCY.L1 (2, spec §3.4 root config `strictness.concurrency`) per repo; gate-class and kernel-high-risk lands need the second reviewer (`reviewer:security`,
 *       8.1), so in 8.0 such a land becomes propose with `secondReviewer: true` recorded.
 *   L0: as declared.
 * Gate-class paths never land without a card at any level (gnomon-loops.md §3.2).
 */
import type { RunMode, StrictnessLevel } from '@a-company/gnomon-contracts';

/** spec §3.4 root config `strictness.concurrency` defaults (provisional, OPEN 20): L1 2, L2 1. */
export const STRICTNESS_CONCURRENCY = Object.freeze({ L1: 2, L2: 1 });

export type LoopAutonomyLevel = 'observe' | 'propose' | 'act';
const AUTONOMY_RANK: Readonly<Record<LoopAutonomyLevel, number>> = Object.freeze({ observe: 0, propose: 1, act: 2 });

/** The repo's cap, as the runner reads it at each node: its level and its effective run mode. */
export interface RepoCap {
  level: StrictnessLevel;
  mode: RunMode;
}

export interface EffectiveAutonomy {
  /** the loop's declared autonomy */
  declared: LoopAutonomyLevel;
  /** min(declared, the repo cap) */
  autonomy: LoopAutonomyLevel;
  level: StrictnessLevel;
  mode: RunMode;
  /** L3 or manual: no run starts, a running one pauses */
  paused: boolean;
  /** the per-repo concurrency cap the level sets (null: the global `loops.concurrency.repo`) */
  concurrency: number | null;
  /** L1 and above: gate-class and kernel-high-risk lands take the second reviewer */
  secondReviewer: boolean;
  /** the GUI's line, e.g. "act → propose (L2)"; null when nothing is capped */
  capReason: string | null;
}

const asAutonomy = (v: unknown): LoopAutonomyLevel => (v === 'act' || v === 'propose' || v === 'observe' ? v : 'observe');

/** A missing or unreadable cap is the strictest: L3, manual (fail safe). */
export const FAIL_SAFE_CAP: Readonly<RepoCap> = Object.freeze({ level: 'L3', mode: 'manual' });
/** No strictness port (tests, older wiring): as declared. */
export const OPEN_CAP: Readonly<RepoCap> = Object.freeze({ level: 'L0', mode: 'auto-edits' });

export function effectiveAutonomy(loop: { autonomy?: unknown }, repo: RepoCap): EffectiveAutonomy {
  const declared = asAutonomy(loop.autonomy ?? 'act');
  const base = { declared, level: repo.level, mode: repo.mode };
  if (repo.level === 'L3' || repo.mode === 'manual') {
    const why = repo.level === 'L3' ? 'L3' : 'manual';
    return { ...base, autonomy: 'observe', paused: true, concurrency: 0, secondReviewer: true, capReason: `${declared} → paused (${why})` };
  }
  if (repo.level === 'L2') {
    const autonomy: LoopAutonomyLevel = AUTONOMY_RANK[declared] > AUTONOMY_RANK.propose ? 'propose' : declared;
    return { ...base, autonomy, paused: false, concurrency: STRICTNESS_CONCURRENCY.L2, secondReviewer: true, capReason: autonomy !== declared ? `${declared} → ${autonomy} (L2)` : null };
  }
  if (repo.level === 'L1') {
    return { ...base, autonomy: declared, paused: false, concurrency: STRICTNESS_CONCURRENCY.L1, secondReviewer: true, capReason: declared === 'act' ? 'act; gate-class and high-risk lands → propose (L1)' : null };
  }
  return { ...base, autonomy: declared, paused: false, concurrency: null, secondReviewer: false, capReason: null };
}

export type LandDecision = { land: true } | { land: false; as: 'propose' | 'none'; reason: string; secondReviewer?: true };

/**
 * May a node's change land alone (step 11 calls this at land, with the cap re-read)? Gate-class paths never land
 * without a card; at L2 or below act autonomy nothing lands alone; at L1 a gate-class or kernel-high-risk land needs
 * the second reviewer (8.1), so it becomes propose with the requirement recorded.
 */
export function landDecision(eff: EffectiveAutonomy, change: { gateClass?: boolean; highRisk?: boolean }): LandDecision {
  if (eff.paused) return { land: false, as: 'none', reason: 'strictness-paused' };
  if (eff.autonomy !== 'act') return { land: false, as: 'propose', reason: eff.capReason ?? `autonomy ${eff.autonomy}` };
  if (eff.secondReviewer && (change.gateClass || change.highRisk)) {
    return { land: false, as: 'propose', reason: `second reviewer required at ${eff.level} (the reviewer profile is not in this release yet)`, secondReviewer: true };
  }
  if (change.gateClass) return { land: false, as: 'propose', reason: 'gate-class paths never land without a card' };
  return { land: true };
}
