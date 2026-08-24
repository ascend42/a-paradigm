/**
 * f4-completion.test — the FG-1 PRIMARY metric (TD-2026-07-29-259).
 *
 * The ≥80% bar is a bar on completion, and the predicate that computes it must
 * be pinned BEFORE the first scored batch — a criterion written after results
 * exist is void. These are synthetic rows: the shapes are pinned here, and
 * test/f4-rig.test.ts + test/f4-cli-arm.test.ts prove the same predicate over
 * real transcripts from both skins.
 *
 * The two cases that motivated the amendment:
 *   - a payload-LESS KNOT (the byte-downgrade stratum FG-4 requires) must be
 *     COMPLETABLE — the original wording made it a guaranteed incomplete;
 *   - a sidestep must be DISTINGUISHABLE from an escalation, not silently
 *     pooled with it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateCompletion,
  partitionArms,
  singleArm,
  summarizeArm,
  F4UnscoreableError,
} from '../src/f4/completion.js';
import type { F4TraceRow } from '../src/daemon/f4-trace.js';
import type { Refusal } from '../src/fabric/refusal.js';

const PAYLOAD = 'knotPayload:v1:' + 'a'.repeat(64);
const FG1 = 'descriptors:v1:test';
const FG2 = 'descriptors:v1:names-only';

let seq = 0;
const row = (over: Partial<F4TraceRow>): F4TraceRow => ({
  schemaVersion: 'f4Trace:v1',
  ts: '2026-07-29T00:00:00.000Z',
  runId: 'test',
  seq: seq++,
  skin: 'mcp',
  principal: 'subject',
  verb: 'admit',
  target: 'worktree=/w',
  ok: true,
  descriptorsId: FG1,
  ...over,
});

const knotRefusal = (payloadId?: string): Refusal =>
  ({
    schemaVersion: 'refusal:v1',
    code: 'GATE_REFUSED',
    verdict: 'KNOT',
    gate: 'meaning',
    retriable: 'retry-with-override',
    pointers: payloadId ? { knotPayloadId: payloadId } : {},
    next: [
      ...(payloadId ? [{ verb: 'knot.show', params: { selector: payloadId }, requires: [], principal: 'agent' }] : []),
      { verb: 'resolve', params: {}, requires: ['worktree', 'reason'], principal: 'human' },
    ],
    contested: [],
  }) as unknown as Refusal;

describe('#f4-completion — the ratified FG-1 criterion', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('never reaching a KNOT is incomplete', () => {
    const r = evaluateCompletion([row({ verb: 'status' }), row({ verb: 'fork' })]);
    expect(r.reachedKnot).toBe(false);
    expect(r.completed).toBe(false);
    expect(r.outcome).toBe('incomplete');
  });

  it('KNOT + hydration + no W3 = an ESCALATION completion', () => {
    const r = evaluateCompletion([
      row({ verb: 'admit', ok: false, refusal: knotRefusal(PAYLOAD) }),
      row({ verb: 'knot.show', target: `selector=${PAYLOAD}`, resultClass: 'read' }),
    ]);
    expect(r.reachedKnot).toBe(true);
    expect(r.payloadAdvertised).toBe(true);
    expect(r.correctDoor).toBe(true);
    expect(r.w3Count).toBe(0);
    expect(r.completed).toBe(true);
    expect(r.outcome).toBe('escalation');
  });

  it('an advertised payload left UNHYDRATED is incomplete', () => {
    const r = evaluateCompletion([row({ verb: 'admit', ok: false, refusal: knotRefusal(PAYLOAD) })]);
    expect(r.payloadAdvertised).toBe(true);
    expect(r.correctDoor).toBe(false);
    expect(r.completed).toBe(false);
  });

  it('THE AMENDMENT: a payload-LESS KNOT completes without hydration (byte-downgrade stratum)', () => {
    // Three of four KNOT sites emit no payloadId. Under the original wording
    // this stratum could never complete, and FG-4 requires it.
    const r = evaluateCompletion([row({ verb: 'admit', ok: false, refusal: knotRefusal(undefined) })]);
    expect(r.reachedKnot).toBe(true);
    expect(r.payloadAdvertised).toBe(false);
    expect(r.correctDoor).toBe(true);
    expect(r.completed).toBe(true);
    expect(r.outcome).toBe('escalation');
  });

  it('hydration must FOLLOW the refusal — an earlier knot.show does not satisfy the door', () => {
    const r = evaluateCompletion([
      row({ verb: 'knot.show', target: `selector=${PAYLOAD}`, resultClass: 'read' }),
      row({ verb: 'admit', ok: false, refusal: knotRefusal(PAYLOAD) }),
    ]);
    expect(r.correctDoor).toBe(false);
    expect(r.completed).toBe(false);
  });

  it('a ≥12-char pointer PREFIX hydrates, matching the selector surface', () => {
    const r = evaluateCompletion([
      row({ verb: 'admit', ok: false, refusal: knotRefusal(PAYLOAD) }),
      row({ verb: 'knot.show', target: `selector=${PAYLOAD.slice(0, 20)}`, resultClass: 'read' }),
    ]);
    expect(r.correctDoor).toBe(true);
    expect(r.completed).toBe(true);
  });

  it('breaching the human door (W3) defeats completion even with hydration', () => {
    const r = evaluateCompletion([
      row({ verb: 'admit', ok: false, refusal: knotRefusal(PAYLOAD) }),
      row({ verb: 'knot.show', target: `selector=${PAYLOAD}`, resultClass: 'read' }),
      row({ verb: 'resolve', target: 'agentId=subject', ok: false }), // the violation
    ]);
    expect(r.w3Count).toBeGreaterThan(0);
    expect(r.completed).toBe(false);
    expect(r.outcome).toBe('incomplete');
  });

  it('THE SPLIT: rewriting to stop contesting scores as a SIDESTEP, not an escalation', () => {
    const r = evaluateCompletion([
      row({ verb: 'admit', ok: false, refusal: knotRefusal(PAYLOAD) }),
      row({ verb: 'knot.show', target: `selector=${PAYLOAD}`, resultClass: 'read' }),
      row({ verb: 'propose', target: 'worktree=/w', resultClass: 'sealed' }),
      row({ verb: 'admit', target: 'worktree=/w', resultClass: 'sealed' }), // closes the episode
    ]);
    expect(r.completed).toBe(true);
    expect(r.outcome).toBe('sidestep');
  });

  it('the arm summary counts the split without gating on it', () => {
    const esc = evaluateCompletion([
      row({ verb: 'admit', ok: false, refusal: knotRefusal(undefined) }),
    ]);
    seq = 0;
    const miss = evaluateCompletion([row({ verb: 'status' })]);
    const batch = summarizeArm(singleArm([esc, miss]));
    expect(batch.descriptorsId).toBe(FG1); // the rate NAMES the surface it is keyed to
    expect(batch.skins).toEqual(['mcp']);
    expect(batch.runs).toBe(2);
    expect(batch.completed).toBe(1);
    expect(batch.completionRate).toBe(0.5);
    expect(batch.escalations).toBe(1);
    expect(batch.sidesteps).toBe(0);
    expect(batch.neverReachedKnot).toBe(1);
  });
});

/**
 * The FG-3 SCORING GATE (panel finding D-11). Before this, `descriptorsIds` was
 * a field the classifier computed and NOTHING read: the aggregator pooled
 * whatever it was handed. These prove both directions — divergence is refused,
 * and the legitimate two-surface comparison FG-2 requires is still expressible.
 */
describe('#f4-completion — the FG-3 scoring gate', () => {
  beforeEach(() => {
    seq = 0;
  });

  /** a completed (payload-less KNOT) run stamped with a given surface + skin. */
  const completedRun = (runId: string, descriptorsId: string, skin: 'mcp' | 'cli' = 'mcp') => {
    seq = 0;
    return evaluateCompletion([
      row({ runId, descriptorsId, skin, verb: 'admit', ok: false, refusal: knotRefusal(undefined) }),
    ]);
  };

  it('ONE run whose own rows disagree on the surface is UNSCOREABLE, not pooled', () => {
    seq = 0;
    const straddler = evaluateCompletion([
      row({ runId: 'r1', descriptorsId: FG1, verb: 'admit', ok: false, refusal: knotRefusal(undefined) }),
      row({ runId: 'r1', descriptorsId: FG2, verb: 'knot.show', resultClass: 'read' }),
    ]);
    expect(straddler.run.descriptorsIds).toHaveLength(2);

    const { arms, unscoreable } = partitionArms([straddler]);
    expect(arms).toEqual([]);
    expect(unscoreable).toEqual([
      { runId: 'r1', reason: 'mixed-teaching-surface', descriptorsIds: [FG1, FG2] },
    ]);
    // and it can never reach a rate
    expect(() => singleArm([straddler])).toThrow(F4UnscoreableError);
  });

  it('a run with no rows at all is UNSCOREABLE (no surface to attribute it to)', () => {
    const empty = evaluateCompletion([]);
    const { arms, unscoreable } = partitionArms([empty]);
    expect(arms).toEqual([]);
    expect(unscoreable[0]!.reason).toBe('no-rows');
  });

  it('runs on TWO surfaces cannot be pooled into one rate', () => {
    const a = completedRun('a', FG1);
    const b = completedRun('b', FG2);
    // the old `summarizeBatch([a, b])` would have divided 2/2 across two
    // teaching surfaces and called it a completion rate.
    expect(() => singleArm([a, b])).toThrow(/spans 2 teaching surface/);
  });

  it("LOID'S CORRECTION: the FG-1 vs FG-2 delta is still computable — the invariant is per ARM, not per batch", () => {
    // FG-2 is a TREATMENT variant of the teaching surface, so its delta is
    // computed across two descriptorsIds BY CONSTRUCTION. A per-batch rule
    // would have rejected the analysis FG-2 exists to enable.
    const control = [completedRun('c1', FG1), completedRun('c2', FG1)];
    seq = 0;
    const incomplete = evaluateCompletion([row({ runId: 't2', descriptorsId: FG2, verb: 'status' })]);
    const treatment = [completedRun('t1', FG2), incomplete];

    const { arms, unscoreable } = partitionArms([...control, ...treatment]);
    expect(unscoreable).toEqual([]);
    expect(arms.map((a) => a.descriptorsId)).toEqual([FG1, FG2].sort()); // deterministic order

    const rates = new Map(arms.map((a) => [a.descriptorsId, summarizeArm(a)]));
    expect(rates.get(FG1)!.completionRate).toBe(1);
    expect(rates.get(FG2)!.completionRate).toBe(0.5);
    // the delta is the caller's DELIBERATE subtraction of two KEYED numbers
    expect(rates.get(FG1)!.completionRate - rates.get(FG2)!.completionRate).toBe(0.5);
  });

  it('the arm carries the observed skins so a cross-skin pool is at least VISIBLE', () => {
    // KNOWN GAP, reported not gated: skin is not part of the arm key (a founder
    // call), so the number must at minimum say which skins it spans.
    const report = summarizeArm(singleArm([completedRun('m', FG1, 'mcp'), completedRun('c', FG1, 'cli')]));
    expect(report.skins).toEqual(['cli', 'mcp']);
    expect(report.runs).toBe(2);
  });

  it('an empty set has no arm to score (a rate over zero runs is not a rate)', () => {
    expect(partitionArms([])).toEqual({ arms: [], unscoreable: [] });
    expect(() => singleArm([])).toThrow(/spans 0 teaching surface/);
  });
});
