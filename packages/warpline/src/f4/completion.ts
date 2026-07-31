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
 * SCORING GATE (2026-07-31 panel, D-11): the aggregator below refuses to pool
 * runs served by different teaching surfaces — see the FG-3 SCORING GATE block.
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

/* ── the FG-3 SCORING GATE (F4 instrument panel D-11, 2026-07-31) ─────────────
 *
 * FG-3 says a scored run is served by EXACTLY ONE teaching surface, and
 * `classifyRun` has always REPORTED `descriptorsIds` so a reader could check
 * it. Nothing ever did. The aggregator took a bare `F4CompletionReport[]`,
 * never looked at an id, and would pool runs served by two different teaching
 * surfaces into one rate — the pre-registration anchor was a FIELD, not a GATE,
 * and the number it protects could be produced without it.
 *
 * The gate is structural rather than advisory, because advisory is exactly what
 * just failed: an `F4Arm` cannot be constructed outside this module, and a rate
 * can only be computed FROM an arm. A pooled cross-id rate is therefore not
 * discouraged — it is unrepresentable.
 *
 * WHAT AN ARM IS (and why not "a batch"). The invariant is one id per RUN and
 * per ARM, never per batch: FG-2 is a TREATMENT variant of the teaching
 * surface, so an FG-1-vs-FG-2 delta is computed across two descriptorsIds BY
 * CONSTRUCTION, and a naive per-batch rule would reject the very analysis FG-2
 * exists to enable. `partitionArms` therefore SPLITS rather than refuses:
 * divergent ids yield two arms with two keyed rates, and the delta is the
 * caller's deliberate subtraction of two numbers that each name their surface.
 *
 * SCOPE, held deliberately narrow. The key is `descriptorsId` and nothing else.
 * This builds no id, no tuple and no partition of the frozen surface — pre-
 * freeze item 2 (teachingId / scoringId / instrumentId) is an OPEN founder
 * decision and is not pre-empted here. Nor is there any comparison against a
 * pinned literal: the freeze is unbuilt, so the only thing this can honestly
 * assert is INTERNAL divergence. When a pin exists it becomes one more check on
 * an arm, not a redesign of one.
 *
 * KNOWN GAP, reported not gated: `skin` is NOT part of the key, so two runs on
 * different skins with the same teaching id land in ONE arm. The bar says
 * otherwise (roadmap-native-first.md: "Runs on the MCP skin AND the CLI skin; a
 * pass on one is not a pass"), so `F4BatchReport.skins` carries the observed
 * set and a cross-skin pool is at least VISIBLE in the number. Widening the key
 * is a one-line change; it is a founder call, not this fix's.
 *
 * `classifyRun` and `evaluateCompletion` stay PURE and total — the gate lives
 * at the aggregation boundary, so re-scoring the durable row archive after a
 * scorer fix still costs zero runs.
 */

/** Brand: an `F4Arm` can only come from `partitionArms` / `singleArm`. */
declare const armBrand: unique symbol;

/**
 * A SCOREABLE set: runs that agree on the teaching surface that served them.
 * The only input `summarizeArm` accepts.
 */
export interface F4Arm {
  /** the ONE teaching-surface content address every row of every run carried. */
  readonly descriptorsId: string;
  readonly reports: readonly F4CompletionReport[];
  readonly [armBrand]: true;
}

/** Why a run cannot be scored at all — excluded, never silently pooled. */
export type F4UnscoreableReason =
  /** no trace rows: there is no surface to attribute the run to. */
  | 'no-rows'
  /** ONE run's rows disagree on descriptorsId — the FG-3 per-run invariant. */
  | 'mixed-teaching-surface';

export interface F4Unscoreable {
  runId: string;
  reason: F4UnscoreableReason;
  descriptorsIds: readonly string[];
}

export interface F4Partition {
  /** one arm per distinct descriptorsId, sorted by id for determinism. */
  arms: readonly F4Arm[];
  /** runs excluded from every arm, with the reason. */
  unscoreable: readonly F4Unscoreable[];
}

/** Thrown by `singleArm` when the caller's one-arm assumption does not hold. */
export class F4UnscoreableError extends Error {
  constructor(
    message: string,
    readonly partition: F4Partition,
  ) {
    super(message);
    this.name = 'F4UnscoreableError';
  }
}

/**
 * Split reports into scoreable arms. TOTAL — never throws; a run that cannot be
 * attributed to a surface lands in `unscoreable` rather than in a rate.
 *
 * Reads the ids off `report.run.descriptorsIds`, which `classifyRun` already
 * collects — no upstream signature changed to make this possible.
 */
export function partitionArms(reports: readonly F4CompletionReport[]): F4Partition {
  const byId = new Map<string, F4CompletionReport[]>();
  const unscoreable: F4Unscoreable[] = [];

  for (const report of reports) {
    const ids = report.run.descriptorsIds;
    const reason: F4UnscoreableReason | null =
      ids.length === 0 ? 'no-rows' : ids.length > 1 ? 'mixed-teaching-surface' : null;
    if (reason) {
      unscoreable.push({ runId: report.runId, reason, descriptorsIds: [...ids] });
      continue;
    }
    const id = ids[0]!;
    const bucket = byId.get(id) ?? [];
    bucket.push(report);
    byId.set(id, bucket);
  }

  const arms = [...byId.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([descriptorsId, armReports]) => ({ descriptorsId, reports: armReports }) as unknown as F4Arm);

  return { arms, unscoreable };
}

/**
 * The single-arm ASSERTION: the caller believes this set is one arm (the FG-1
 * confirmatory shape). Returns it, or throws — the set is UNSCOREABLE. Use
 * `partitionArms` directly for a multi-arm analysis (the FG-2 delta).
 */
export function singleArm(reports: readonly F4CompletionReport[]): F4Arm {
  const partition = partitionArms(reports);
  if (partition.unscoreable.length > 0) {
    const detail = partition.unscoreable.map((u) => `${u.runId}:${u.reason}`).join(', ');
    throw new F4UnscoreableError(
      `F4 scoring refused — ${partition.unscoreable.length} run(s) cannot be attributed to one teaching surface (${detail}). ` +
        'FG-3 requires exactly one descriptorsId per run.',
      partition,
    );
  }
  if (partition.arms.length !== 1) {
    const keys = partition.arms.map((a) => a.descriptorsId).join(' | ');
    throw new F4UnscoreableError(
      `F4 scoring refused — this set spans ${partition.arms.length} teaching surface(s) (${keys || 'none'}); ` +
        'one rate across two surfaces is not a measurement. Score each arm and report the delta.',
      partition,
    );
  }
  return partition.arms[0]!;
}

export interface F4BatchReport {
  /** the teaching surface this rate is KEYED to — a rate without it is unreadable. */
  descriptorsId: string;
  /** the skins observed across the arm. REPORTED, not gated (see KNOWN GAP). */
  skins: string[];
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
 * Aggregate ONE arm. Deliberately does NOT decide pass/fail: the bar's
 * arithmetic (n, confidence interval, per-family conjunction) is a
 * pre-registration item, not a property of the code that counts.
 *
 * Takes an `F4Arm` and not a report array — that is the whole gate. The
 * previous `summarizeBatch(readonly F4CompletionReport[])` is DELETED rather
 * than deprecated: an ungated alias beside a gate is how the second carrier
 * survives (Arky's Q4 rule, applied to the aggregator).
 */
export function summarizeArm(arm: F4Arm): F4BatchReport {
  const { reports } = arm;
  const completed = reports.filter((r) => r.completed).length;
  return {
    descriptorsId: arm.descriptorsId,
    skins: [...new Set(reports.flatMap((r) => r.run.skins))].sort(),
    runs: reports.length,
    completed,
    completionRate: reports.length === 0 ? 0 : completed / reports.length,
    escalations: reports.filter((r) => r.outcome === 'escalation').length,
    sidesteps: reports.filter((r) => r.outcome === 'sidestep').length,
    neverReachedKnot: reports.filter((r) => !r.reachedKnot).length,
  };
}
