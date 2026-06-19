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
 *   3. For each attributed entry (deduped one revision per (entryId, orchestrationId)):
 *        - append a field-failures.jsonl row,
 *        - reviseDown (bumps appliedAndBrokeCount + lowers confidence),
 *        - back-bind the matching `pending` certification → `overturned`.
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
  /** Number of entries revised down (deduped). */
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
  for (const prior of readFieldFailures(rootDir)) {
    for (const priorEntryId of prior.attributedEntryIds) {
      revised.add(`${priorEntryId}::${prior.orchestrationId}`);
    }
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

    for (const ref of matchingRefs) {
      const agent = ref.agentId;
      for (const entryId of ref.notebookEntryIds) {
        const dedupeKey = `${entryId}::${orchestrationId}`;
        if (revised.has(dedupeKey)) continue; // one revision per (entry, orchestration)
        revised.add(dedupeKey);

        const failureId = makeFailureId(orchestrationId, entryId);

        // 1. field-failures.jsonl row (the LEFT side of the loop's ledger).
        const row: FieldFailureRow = {
          ts: new Date().toISOString(),
          orchestrationId,
          agent,
          signal,
          severity,
          attributedEntryIds: [entryId],
          symbols,
          detail,
          sourceEvent: `verdict:${verdict.verdict}`,
        };
        appendFieldFailure(rootDir, row);
        result.failuresRecorded++;

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

        // 4. SCENARIO: the break becomes a reusable breaking test-case probe
        //    (origin: field-failure). This is the structural answer to the
        //    same-family-blindspot kill shot — the field, not a same-lens peer,
        //    generates the probe. Dedupe on origin_ref (the failure id) so a
        //    second postflight pass over the same break does NOT spam the bank.
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
      entriesRevised: result.entriesRevised,
      certsOverturned: result.certsOverturned,
      scenariosCreated: result.scenariosCreated,
    });
  }

  return result;
}
