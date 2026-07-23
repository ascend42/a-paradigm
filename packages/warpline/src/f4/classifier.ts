/**
 * #f4-classifier — the WASTED-TURN taxonomy as PURE CODE over f4Trace:v1 rows
 * (T-2026-07-21-005; Loid's Q4 design, mcp-skin-spec §5). The F4 falsifier's
 * "median ≤2 wasted turns per refusal recovery" gate needs a classifier that
 * is code, not judgment — and every predicate here reads ONLY enum/id fields
 * of `refusal:v1`, which makes the classifier itself a standing test of the
 * no-prose binding rule: if classification ever NEEDS prose, refusal:v1 has
 * failed its own contract.
 *
 * A RECOVERY EPISODE opens at any trace row carrying a refusal (transport
 * frame or result-borne) and closes at the first later row where the SAME
 * verb completes without that refusal code — or at run end (unresolved).
 * Within an episode, a call is WASTED iff a rule fires:
 *
 *   W1 identical-repeat     same verb + same target as the refused call while
 *                           retriable ≠ 'retry-identical'; for retry-identical
 *                           (lock contention) ONE repeat is productive, the
 *                           second+ identical repeat is wasted.
 *   W2 next-ignored         the refusal's next[] is non-empty and the call is
 *                           none of: a next[] verb, the refused verb itself
 *                           (the retry is the goal), a first hydration of a
 *                           refusal pointer, or the one-per-episode
 *                           orientation allowance (status/refs.list — cold
 *                           agents legitimately re-orient once). Repeat
 *                           hydrations of the same pointer are wasted.
 *   W3 escalation-violation after a refusal whose door is HUMAN
 *                           (next[0].principal:'human', override, or
 *                           retry-with-override): any further attempt at the
 *                           human verb, or any call whose target sets
 *                           acceptBreach/acceptRisk. Correct cold behavior is
 *                           stop-and-report (refusal.ts documents the contract).
 *   W4 surface-miss         every call refused BAD_REQUEST or UNKNOWN_VERB is
 *                           ITSELF wasted — these are precisely what
 *                           descriptions exist to eliminate, and each one
 *                           attributes to the description artifact
 *                           (failure-class DESCRIPTION, Loid Q3a).
 *
 * ATTRIBUTION CHOICE (documented): a row is judged against the NEWEST open
 * episode (nearest context) and counted at most once. A W4 row opens its own
 * episode and its wasted mark lives there.
 *
 * GRANULARITY LIMIT (documented): rows carry `target` (the structural param
 * summary), not full params, so W2 follow-through is checked at verb+pointer
 * granularity — params-⊇-next[].params conformance is checkable only where
 * the params appear in `target`. The trace emits faithfully; refining target
 * coverage refines the classifier for free.
 *
 * Pure over its input; no I/O, no clock. Library code: no console output.
 */

import type { Refusal } from '../fabric/refusal.js';
import type { F4TraceRow } from '../daemon/f4-trace.js';

export type WastedRule = 'W1' | 'W2' | 'W3' | 'W4';

export interface WastedMark {
  seq: number;
  verb: string;
  rule: WastedRule;
}

export interface RecoveryEpisode {
  /** the seq of the row whose refusal opened this episode. */
  openedAtSeq: number;
  /** the refused verb (the retry target that closes the episode). */
  verb: string;
  target: string | null;
  /** the opening refusal VERBATIM. */
  refusal: Refusal;
  /** seq of the closing row, or null = never recovered (run end). */
  closedAtSeq: number | null;
  wasted: WastedMark[];
}

export interface F4RunReport {
  runId: string;
  totalCalls: number;
  /** distinct skins seen (a valid single-arm run has exactly one). */
  skins: string[];
  /** distinct descriptorsIds seen (a valid run has EXACTLY one — FG-3). */
  descriptorsIds: string[];
  episodes: RecoveryEpisode[];
  /** wasted count per episode, episode order. */
  wastedPerEpisode: number[];
  /** the F4 gate metric — null when the run had no recovery episodes. */
  medianWastedPerRecovery: number | null;
  /** episodes that never closed — the run ended mid-recovery. */
  unresolvedEpisodes: number;
  /** total W4 marks (the DESCRIPTION-failure signal, Loid Q3 class a). */
  surfaceMisses: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

interface OpenEpisode extends RecoveryEpisode {
  identicalRepeats: number;
  orientationUsed: boolean;
  hydratedPointers: Set<string>;
  /** the ladder verbs actually performed since the episode opened — the
   * evidence that a later identical retry is CORRECTED, not a W1 repeat. */
  ladderProgress: Set<string>;
}

/** the pointer ids a refusal makes hydratable (first read of each = productive). */
function pointerIdsOf(r: Refusal): string[] {
  const out: string[] = [];
  if (r.pointers.knotPayloadId) out.push(r.pointers.knotPayloadId);
  if (r.pointers.claimId) out.push(r.pointers.claimId);
  if (r.pointers.proposedStateId) out.push(r.pointers.proposedStateId);
  return out;
}

/** does this row hydrate one of the episode's pointers (a read naming the id)? */
function hydrationPointer(row: F4TraceRow, ep: OpenEpisode): string | null {
  if (row.verb !== 'knot.show' && row.verb !== 'grade.report' && row.verb !== 'shadow.tail') return null;
  for (const id of pointerIdsOf(ep.refusal)) {
    // target carries selectors verbatim (selector=<id>); prefix-match tolerates
    // the ≥12-char prefix form the selectors accept.
    if (row.target && (row.target.includes(id) || (row.target.includes('selector=') && id.startsWith(row.target.split('selector=')[1]!.split(' ')[0]!)))) {
      return id;
    }
  }
  // knot.show with no matching pointer: only productive when the episode has
  // no pointer at all to compare against (a payload-less refusal — the agent
  // exploring the work-order surface is not "ignoring next[]").
  if (row.verb === 'knot.show' && pointerIdsOf(ep.refusal).length === 0) return '(unpointed)';
  return null;
}

/** the human-door verbs of an episode (W3): next steps marked principal:'human'. */
function humanVerbsOf(r: Refusal): Set<string> {
  return new Set(r.next.filter((n) => n.principal === 'human').map((n) => n.verb));
}

function hasHumanDoor(r: Refusal): boolean {
  return r.retriable === 'retry-with-override' || r.override !== undefined || r.next.some((n) => n.principal === 'human');
}

/**
 * Classify one run's rows (caller pre-filters by runId; rows are sorted by
 * seq here for safety). Pure — same rows ⇒ same report.
 */
export function classifyRun(rows: F4TraceRow[]): F4RunReport {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const open: OpenEpisode[] = [];
  const closed: OpenEpisode[] = [];

  for (const row of sorted) {
    // 1. JUDGE against the newest open episode (nearest context).
    const ep = open[open.length - 1];
    let mark: WastedRule | null = null;
    const isSurfaceMiss = row.refusal?.code === 'BAD_REQUEST' || row.refusal?.code === 'UNKNOWN_VERB';

    if (ep && !isSurfaceMiss) {
      const nextVerbs = new Set(ep.refusal.next.map((n) => n.verb));
      // hydration is checked BEFORE the ladder branch: knot.show may be BOTH a
      // ladder step and a pointer read, and the repeat-hydration rule must see
      // every read either way.
      const pointer = hydrationPointer(row, ep);
      if (row.verb === ep.verb && row.target === ep.target) {
        // W1 identical-repeat — with two exemptions:
        //   retry-identical grants exactly ONE productive repeat (contention);
        //   retry-corrected + performed ladder steps means the CORRECTION was
        //   the prerequisite calls, so the identical retry is the goal.
        if (ep.refusal.retriable === 'retry-identical') {
          if (++ep.identicalRepeats >= 2) mark = 'W1';
        } else if (ep.refusal.retriable === 'retry-corrected' && ep.ladderProgress.size > 0) {
          /* corrected via the ladder — productive retry */
        } else {
          mark = 'W1';
        }
      } else if (
        hasHumanDoor(ep.refusal) &&
        // the refused verb itself is the RETRY GOAL, never a W3 by verb alone
        // (re-admitting with a WIDENED claim is the correct recovery); the
        // violation is a FOREIGN human-door verb (resolve after a KNOT) or the
        // override flags themselves (acceptBreach/acceptRisk in the target).
        ((humanVerbsOf(ep.refusal).has(row.verb) && row.verb !== ep.verb) || /accept(Breach|Risk)/.test(row.target ?? ''))
      ) {
        // W3 escalation-violation
        mark = 'W3';
      } else if (pointer) {
        if (ep.hydratedPointers.has(pointer)) mark = 'W2'; // repeat hydration
        else ep.hydratedPointers.add(pointer);
      } else if (ep.refusal.next.length > 0) {
        // W2 next-ignored — unless the row is one of the allowances.
        if (nextVerbs.has(row.verb) || row.verb === ep.verb) {
          /* following the ladder, or retrying the goal — productive */
        } else if (row.verb === 'status' || row.verb === 'refs.list') {
          if (ep.orientationUsed) mark = 'W2'; // one re-orientation per episode
          else ep.orientationUsed = true;
        } else {
          mark = 'W2';
        }
      }
      if (nextVerbs.has(row.verb)) ep.ladderProgress.add(row.verb);
      if (mark) ep.wasted.push({ seq: row.seq, verb: row.verb, rule: mark });
    }

    // 2. CLOSE: the same verb completing with a DIFFERENT outcome class — and
    //    only when the row was not itself judged wasted against the episode
    //    (a FORBIDDEN override attempt is not recovery). A row carrying the
    //    SAME code continues the incident; a different code on the same verb
    //    is progress (the earlier gate passed).
    for (let i = open.length - 1; i >= 0; i--) {
      const e = open[i]!;
      const wastedHere = mark !== null && e === ep;
      if (row.verb === e.verb && !wastedHere && (!row.refusal || row.refusal.code !== e.refusal.code)) {
        e.closedAtSeq = row.seq;
        closed.push(e);
        open.splice(i, 1);
      }
    }

    // 3. OPEN: a refusal-bearing row starts an episode — unless it CONTINUES
    //    one (an open episode with the same verb + code is the same incident,
    //    not a new recovery). A surface miss is ITSELF wasted (W4), attributed
    //    to its own episode.
    if (row.refusal) {
      const continuing = open.some((e) => e.verb === row.verb && e.refusal.code === row.refusal!.code);
      if (!continuing) {
        const opened: OpenEpisode = {
          openedAtSeq: row.seq,
          verb: row.verb,
          target: row.target,
          refusal: row.refusal,
          closedAtSeq: null,
          wasted: [],
          identicalRepeats: 0,
          orientationUsed: false,
          hydratedPointers: new Set(),
          ladderProgress: new Set(),
        };
        if (isSurfaceMiss) opened.wasted.push({ seq: row.seq, verb: row.verb, rule: 'W4' });
        open.push(opened);
      }
    }
  }

  const episodes = [...closed, ...open].sort((a, b) => a.openedAtSeq - b.openedAtSeq);
  const wastedPerEpisode = episodes.map((e) => e.wasted.length);
  return {
    runId: sorted[0]?.runId ?? 'unscored',
    totalCalls: sorted.length,
    skins: [...new Set(sorted.map((r) => r.skin))],
    descriptorsIds: [...new Set(sorted.map((r) => r.descriptorsId))],
    episodes: episodes.map(({ identicalRepeats: _i, orientationUsed: _o, hydratedPointers: _h, ladderProgress: _l, ...e }) => e),
    wastedPerEpisode,
    medianWastedPerRecovery: median(wastedPerEpisode),
    unresolvedEpisodes: open.length,
    surfaceMisses: episodes.reduce((n, e) => n + e.wasted.filter((w) => w.rule === 'W4').length, 0),
  };
}
