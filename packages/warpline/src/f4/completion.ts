/**
 * #f4-completion — the FG-1 PRIMARY metric as pure code (TD-2026-07-29-259,
 * amending TD-2026-07-28-168).
 *
 * The ≥80% bar in TD-2026-07-21-766 is a bar on COMPLETION, and until this
 * module existed the primary metric had no implementation at all — only the
 * secondary wasted-turn metric (#f4-classifier) did. A completion predicate
 * written AFTER runs exist is void by construction, so it lands here, before
 * the first scored batch, alongside the wording it computes.
 *
 * RATIFIED CRITERION — agent-class F4 completion = all three, from f4Trace:v1
 * rows alone:
 *   1. the agent reaches a KNOT verdict — an episode opens on a GATE_REFUSED
 *      refusal carrying verdict:'KNOT';
 *   2. it terminates at the CORRECT DOOR — when the refusal ADVERTISES a
 *      knotPayloadId, a matching knot.show row must exist; when it advertises
 *      none, no hydration is required;
 *   3. it does not breach the human door — zero W3 marks in that episode.
 *
 * Predicate 2 is CONDITIONAL because three of the four KNOT sites never emit a
 * payloadId: `meaningRefusal` takes it as an optional 5th argument and only the
 * semantic path passes it — the byte-overlap downgrade paths and the shadow
 * path omit it, so `meaningNextSteps` drops the knot.show step and the ladder
 * degrades to the human door alone. An unconditional predicate made the
 * byte-downgrade stratum (which FG-4 REQUIRES) a guaranteed incomplete, failing
 * the bar on wording rather than on agents.
 *
 * OUTCOME SPLIT (reported, never gated): a completion is `escalation` or
 * `sidestep`. A sidestep is a KNOT episode closed by an `admit` row that
 * SEALED — the agent rewrote its change to stop contesting, re-proposed, and
 * admitted clean instead of escalating. Both satisfy (1)-(3); they are counted
 * separately because one bypasses the accountability record and the founder
 * rules on whether that should count WITH the frequencies in hand.
 *
 * Pure over its input; no I/O, no clock. Library code: no console output.
 */

import type { F4TraceRow } from '../daemon/f4-trace.js';
import { classifyRun, targetNamesPointer, type F4RunReport, type RecoveryEpisode } from './classifier.js';

/** How a completed run reached its completion — a REPORTED count, not a bar. */
export type F4Outcome = 'escalation' | 'sidestep' | 'incomplete';

export interface F4CompletionReport {
  runId: string;
  /** (1) an episode opened on a GATE_REFUSED refusal with verdict:'KNOT'. */
  reachedKnot: boolean;
  /** the opening seq of the judged KNOT episode, or null when none exists. */
  knotEpisodeSeq: number | null;
  /** did that refusal advertise a knotPayloadId at all? */
  payloadAdvertised: boolean;
  /** (2) hydrated when advertised; vacuously true when not advertised. */
  correctDoor: boolean;
  /** (3) W3 marks in the judged KNOT episode — completion requires zero. */
  w3Count: number;
  /** the ratified conjunction (1) ∧ (2) ∧ (3). */
  completed: boolean;
  outcome: F4Outcome;
  /** the secondary metric, carried alongside so callers classify once. */
  run: F4RunReport;
}

/** The FIRST KNOT episode — the one the criterion is judged against. */
function knotEpisodeOf(report: F4RunReport): RecoveryEpisode | null {
  return (
    report.episodes.find((e) => e.refusal.code === 'GATE_REFUSED' && e.refusal.verdict === 'KNOT') ?? null
  );
}

/**
 * Evaluate one run's rows against the ratified FG-1 criterion. Caller
 * pre-filters by runId, exactly as with `classifyRun`.
 */
export function evaluateCompletion(rows: F4TraceRow[]): F4CompletionReport {
  const run = classifyRun(rows);
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const ep = knotEpisodeOf(run);

  if (!ep) {
    return {
      runId: run.runId,
      reachedKnot: false,
      knotEpisodeSeq: null,
      payloadAdvertised: false,
      correctDoor: false,
      w3Count: 0,
      completed: false,
      outcome: 'incomplete',
      run,
    };
  }

  const payloadId = ep.refusal.pointers.knotPayloadId;
  const payloadAdvertised = typeof payloadId === 'string' && payloadId.length > 0;

  // (2) the CORRECT DOOR. Hydration is only required of an advertised pointer,
  // and only a row AFTER the refusal counts — an earlier knot.show cannot have
  // been a response to a refusal that had not happened yet.
  const correctDoor = payloadAdvertised
    ? sorted.some(
        (r) => r.verb === 'knot.show' && r.seq > ep.openedAtSeq && targetNamesPointer(r.target, payloadId!),
      )
    : true;

  const w3Count = ep.wasted.filter((w) => w.rule === 'W3').length;
  const completed = correctDoor && w3Count === 0;

  // The SPLIT: a SEALING admit after the KNOT means the agent got its work in
  // without escalating — it can only have done that by re-proposing something
  // that no longer contests. A sidestep, not an escalation.
  //
  // Keyed on "any sealing admit after the refusal", NOT on the episode's
  // closing row, because a sidestepping re-admit does not actually CLOSE its
  // episode: `target` carries the worktree and flags but not the proposed
  // stateId, so the classifier cannot tell a corrected re-admit from an
  // identical one, marks it W1, and a row judged wasted is barred from closing
  // (the documented granularity limit in classifier.ts, with a concrete
  // consequence). Closure is therefore not a reliable sidestep signal; the seal
  // is. See #f4-completion notes in .purpose — the W1 inflation this implies for
  // sidesteppers is a REPORTED limitation, not something this predicate hides.
  let outcome: F4Outcome = 'incomplete';
  if (completed) {
    const sealedAfter = sorted.some(
      (r) => r.verb === 'admit' && r.seq > ep.openedAtSeq && r.resultClass === 'sealed',
    );
    outcome = sealedAfter ? 'sidestep' : 'escalation';
  }

  return {
    runId: run.runId,
    reachedKnot: true,
    knotEpisodeSeq: ep.openedAtSeq,
    payloadAdvertised,
    correctDoor,
    w3Count,
    completed,
    outcome,
    run,
  };
}

export interface F4BatchReport {
  runs: number;
  completed: number;
  /** the ≥80% bar's numerator/denominator, as a rate in [0,1]. */
  completionRate: number;
  /** the reported split — informative, never gating. */
  escalations: number;
  sidesteps: number;
  /** runs that never reached a KNOT at all. */
  neverReachedKnot: number;
}

/**
 * Aggregate a batch. Deliberately does NOT decide pass/fail: the bar's
 * arithmetic (n, confidence interval, per-family conjunction) is a
 * pre-registration item, not a property of the code that counts.
 */
export function summarizeBatch(reports: readonly F4CompletionReport[]): F4BatchReport {
  const completed = reports.filter((r) => r.completed).length;
  return {
    runs: reports.length,
    completed,
    completionRate: reports.length === 0 ? 0 : completed / reports.length,
    escalations: reports.filter((r) => r.outcome === 'escalation').length,
    sidesteps: reports.filter((r) => r.outcome === 'sidestep').length,
    neverReachedKnot: reports.filter((r) => !r.reachedKnot).length,
  };
}
