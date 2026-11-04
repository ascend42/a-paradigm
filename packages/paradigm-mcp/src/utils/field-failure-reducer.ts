/**
 * The Classroom — fail-side reducer (TD-2026-06-19-007).
 *
 * This is the keystone that makes the learning loop REAL rather than asserted.
 * The apply side already existed: notebook-refs.jsonl records which entries were
 * injected into which agent under which orchestrationId; incrementApplied bumps
 * appliedCount. This reducer closes the loop:
 *
 *   1. Read the session's field signals (MVP: `dismissed`/`revised` verdicts —
 *      the cheapest signal, recognized by ambient.ts VERDICT_TRIGGERS).
 *   2. JOIN each break to the notebook application receipt BY orchestrationId →
 *      the set of attributedEntryIds. You CANNOT attribute a break to an entry
 *      that was never loaded — this is both correctness and the anti-grief guard.
 *   3. ATTRIBUTION (T-2026-11-03-002, ruling 4). Scope: a verdict that names
 *      its agent considers only that agent's receipts; one that names no agent
 *      considers every agent's. Take the union of injected entry ids in scope
 *      (a brief injects up to 5):
 *        - exactly ONE entry → ATTRIBUTABLE: append a field-failures.jsonl row,
 *          reviseDown (bumps appliedAndBrokeCount + lowers confidence), and
 *          back-bind the matching `pending` certification → `overturned`.
 *        - MORE than one → CONFOUNDED: the break cannot be pinned on any one
 *          entry. Append ONE row listing every injected id with
 *          `attribution: 'confounded'`; NO reviseDown, NO overturn.
 *      Either way a scenario is seeded per injected entry (step 4): a probe that
 *      targets one entry is exactly what can later split a confound.
 *      Deduped one attribution per (entryId, orchestrationId) AND per
 *      (orchestrationId, agent), durably: a re-run never double-records a break
 *      or rewrites an attributable (hurt) row as confounded.
 *
 * Runs at postflight. All I/O best-effort: a failure here must never break the
 * session. Returns a small summary for the caller / tests.
 */

import { log } from './mcp-logger.js';
import { reviseDown } from './notebook-loader.js';
import { getNotebookReferences, readSessionWorkLog } from './session-work-log.js';
import {
  appendFieldFailure,
  readFieldFailures,
  overturnCertification,
  makeFailureId,
  type FieldFailureRow,
  type FieldFailureSignal,
} from './field-failures.js';
import {
  recordScenarioFromFailureSync,
  scenarioIdForFailure,
} from './scenario-loader.js';
import type { SessionWorkEntry, NotebookReferenceEntry } from './session-work-log.js';

/**
 * The fail-side verdicts the MVP attributes. MIRRORS ambient.ts VERDICT_TRIGGERS:
 * `dismissed`/`revised` are the breaks; `accepted`/`deferred` are not.
 */
const FAILURE_VERDICTS = new Set(['dismissed', 'revised']);

export interface FieldFailureReducerResult {
  /** Number of field-failures rows written this pass. */
  failuresRecorded: number;
  /** Of `failuresRecorded`, the rows written `attribution: 'confounded'` (no revision, no overturn). */
  failuresConfounded: number;
  /** Number of entries revised down (deduped; attributable breaks only). */
  entriesRevised: number;
  /** Number of certifications flipped pending → overturned. */
  certsOverturned: number;
  /**
   * Number of scenario-bank rows created from breaks this pass (origin:
   * field-failure). The field generates the probe a same-family peer could not.
   */
  scenariosCreated: number;
}

/**
 * Map a verdict to its field-failure signal. Both `dismissed` and `revised` are
 * the cheapest reviewer-reject signal; `human-override` rides the same channel
 * when the verdict was explicitly flagged as an override.
 */
function signalForVerdict(v: SessionWorkEntry): FieldFailureSignal {
  // If a future override channel sets this, prefer it; otherwise reviewer-reject.
  const reason = (v.reason || '').toLowerCase();
  if (reason.includes('override') || reason.includes('human-override')) return 'human-override';
  return 'reviewer-reject';
}

function severityForVerdict(v: SessionWorkEntry): 'low' | 'medium' | 'high' {
  // A dismissal (rejected outright) bites harder than a revision (corrected).
  return v.verdict === 'dismissed' ? 'high' : 'medium';
}

/**
 * Run the field-failure reducer over the current session.
 *
 * @param rootDir project root.
 * @param _sessionId reserved — the MVP reduces over the live session log + refs;
 *   a future form scopes by session id (cross-session durable verdicts).
 */
export function runFieldFailureReducer(
  rootDir: string,
  _sessionId?: string
): FieldFailureReducerResult {
  const result: FieldFailureReducerResult = {
    failuresRecorded: 0,
    failuresConfounded: 0,
    entriesRevised: 0,
    certsOverturned: 0,
    scenariosCreated: 0,
  };

  let verdicts: SessionWorkEntry[];
  let refs: NotebookReferenceEntry[];
  try {
    verdicts = readSessionWorkLog(rootDir).filter(
      e => e.type === 'user-verdict' && e.verdict && FAILURE_VERDICTS.has(e.verdict),
    );
    refs = getNotebookReferences(rootDir);
  } catch (err) {
    log.component('#field-failure-reducer').warn('failed to read session inputs', {
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  if (verdicts.length === 0 || refs.length === 0) return result;

  // Index application receipts by orchestrationId. A receipt WITHOUT a key is
  // unattributable (pre-Classroom) — drop it; the join key is mandatory.
  const refsByOrch = new Map<string, NotebookReferenceEntry[]>();
  for (const ref of refs) {
    if (!ref.orchestrationId) continue;
    const list = refsByOrch.get(ref.orchestrationId) ?? [];
    list.push(ref);
    refsByOrch.set(ref.orchestrationId, list);
  }

  // Dedupe guard: at most one revision per (entryId, orchestrationId), and the
  // guard must be DURABLE — a second postflight pass over the same un-consumed
  // session log must NOT compound the revision. field-failures.jsonl is the
  // ledger: a row already written for `makeFailureId(orch, entry)` means that
  // break was already attributed, so we seed the dedupe set from it. Without this
  // the in-memory set (which is per-call) only guards within a single pass.
  const revised = new Set<string>();
  // Pair-level guard (Judge I5): a legacy attributable row listed only
  // injected[0], so the entry-level guard alone would see the other injected ids
  // as fresh and re-record the same break as confounded. Any prior row for an
  // (orchestrationId, agent) pair means that pair's break is already recorded.
  const recordedPairs = new Set<string>();
  for (const prior of readFieldFailures(rootDir)) {
    for (const priorEntryId of prior.attributedEntryIds ?? []) {
      revised.add(`${priorEntryId}::${prior.orchestrationId}`);
    }
    recordedPairs.add(`${prior.orchestrationId}::${prior.agent}`);
  }

  for (const verdict of verdicts) {
    const orchestrationId = verdict.orchestrationId;
    if (!orchestrationId) continue; // unkeyed verdict cannot join

    const matchingRefs = refsByOrch.get(orchestrationId);
    if (!matchingRefs || matchingRefs.length === 0) continue; // no real join → no attribution

    const signal = signalForVerdict(verdict);
    const severity = severityForVerdict(verdict);
    const symbols = verdict.symbols ?? [];
    const detail = verdict.reason || verdict.revisionDelta || `${verdict.verdict} verdict`;

    // Ruling 4: a verdict that names its agent is judged on that agent's
    // receipts only. A verdict that names no agent pertains to the whole
    // orchestration, so confounding is judged on the UNION of every agent's
    // injected entries: two agents with one entry each is still two suspects.
    const scopedRefs = verdict.agent
      ? matchingRefs.filter(ref => ref.agentId === verdict.agent)
      : matchingRefs;
    if (scopedRefs.length === 0) continue; // the named agent loaded nothing here

    // Union the injected entry ids per agent: one agent may have several
    // prompt-load receipts under the same orchestration.
    const injectedByAgent = new Map<string, string[]>();
    const union: string[] = [];
    for (const ref of scopedRefs) {
      const ids = injectedByAgent.get(ref.agentId) ?? [];
      for (const id of ref.notebookEntryIds) {
        if (!ids.includes(id)) ids.push(id);
        if (!union.includes(id)) union.push(id);
      }
      injectedByAgent.set(ref.agentId, ids);
    }
    // Confounding is judged on the FULL injected set in scope, never on what is
    // left after dedupe: a second pass must not see one remaining id and pin the
    // break on it.
    const confounded = union.length > 1;

    for (const [agent, injected] of injectedByAgent) {
      if (injected.length === 0) continue;
      if (recordedPairs.has(`${orchestrationId}::${agent}`)) continue; // already recorded (I5)
      const fresh = injected.filter(id => !revised.has(`${id}::${orchestrationId}`));
      if (fresh.length === 0) continue; // already attributed (durable dedupe)
      for (const id of injected) revised.add(`${id}::${orchestrationId}`);
      recordedPairs.add(`${orchestrationId}::${agent}`);

      // 1. field-failures.jsonl row (the LEFT side of the loop's ledger).
      const row: FieldFailureRow = {
        ts: new Date().toISOString(),
        orchestrationId,
        agent,
        signal,
        severity,
        attributedEntryIds: confounded ? [...injected] : [injected[0]],
        symbols,
        detail,
        sourceEvent: `verdict:${verdict.verdict}`,
        ...(confounded ? { attribution: 'confounded' as const, suspects: [...union] } : {}),
      };
      appendFieldFailure(rootDir, row);
      result.failuresRecorded++;
      if (confounded) result.failuresConfounded++;

      for (const entryId of confounded ? fresh : [injected[0]]) {
        const failureId = makeFailureId(orchestrationId, entryId);

        if (!confounded) {
          // 2. reviseDown — bumps appliedAndBrokeCount + lowers confidence (latest-wins).
          const didRevise = reviseDown(
            agent,
            entryId,
            { failureId, signal, detail, severity },
            rootDir,
          );
          if (didRevise) result.entriesRevised++;

          // 3. back-bind the cert: pending → overturned.
          const flipped = overturnCertification(rootDir, entryId, failureId);
          if (flipped) result.certsOverturned++;
        }

        // 4. SCENARIO: the break becomes a reusable breaking test-case probe
        //    (origin: field-failure). This is the structural answer to the
        //    same-family-blindspot kill shot — the field, not a same-lens peer,
        //    generates the probe. Kept for confounded breaks too: a per-entry
        //    probe is what can later tell the suspects apart. Dedupe on
        //    origin_ref (the failure id) so a second postflight pass over the
        //    same break does NOT spam the bank.
        const scenarioId = scenarioIdForFailure(failureId);
        const created = recordScenarioFromFailureSync(rootDir, {
          id: scenarioId,
          scenario: detail,
          probes: [{ agent, learning_ref: entryId, claim: detail }],
          origin: 'field-failure',
          origin_ref: failureId,
          expected: { must: 'survive' },
        });
        if (created) result.scenariosCreated++;
      }
    }
  }

  if (result.failuresRecorded > 0) {
    log.flow('$classroom-fail-loop').info('field-failure reducer pass complete', {
      failuresRecorded: result.failuresRecorded,
      failuresConfounded: result.failuresConfounded,
      entriesRevised: result.entriesRevised,
      certsOverturned: result.certsOverturned,
      scenariosCreated: result.scenariosCreated,
    });
  }

  return result;
}
