/**
 * f4-classifier.test — the W1-W4 wasted-turn taxonomy as pure code
 * (T-2026-07-21-005; Loid Q4). Synthetic f4Trace rows exercise each rule and
 * each allowance; every predicate must be decidable from refusal:v1 enums/ids
 * alone (the no-prose rule applied to the classifier itself).
 */

import { describe, it, expect } from 'vitest';
import { classifyRun } from '../src/f4/classifier.js';
import { refuse, type Refusal } from '../src/fabric/refusal.js';
import type { F4TraceRow } from '../src/daemon/f4-trace.js';

let seq = 0;
function row(over: Partial<F4TraceRow> & { verb: string }): F4TraceRow {
  return {
    schemaVersion: 'f4Trace:v1',
    ts: '2026-07-22T00:00:00.000Z',
    runId: 'run-1',
    seq: seq++,
    skin: 'mcp',
    principal: 'mcp',
    target: null,
    ok: true,
    descriptorsId: 'descriptors:v1:test',
    ...over,
  };
}

const breach = (): Refusal =>
  refuse({
    code: 'CLAIM_BREACH',
    verdict: 'CLAIM-BREACH',
    gate: 'claim',
    pointers: { claimId: 'claim:v1:aaaa', proposedStateId: 'state:v0:bbbb' },
    next: [
      // mirrors the real claimNextSteps ladder (D-6a: `claim`, never the
      // nested `claimedSymbols`, which is a param of no skin)
      { verb: 'propose', params: {}, requires: ['intent', 'worktree', 'claim'], principal: 'agent' },
      { verb: 'admit', params: { native: 'true', claim: 'claim:v1:aaaa', acceptBreach: 'true' }, requires: [], principal: 'human' },
    ],
    override: { flag: 'acceptBreach', principal: 'human' },
  });

const knot = (): Refusal =>
  refuse({
    code: 'GATE_REFUSED',
    verdict: 'KNOT',
    gate: 'meaning',
    pointers: { knotPayloadId: 'knotPayload:v1:cccc', proposedStateId: 'state:v0:dddd' },
    next: [
      { verb: 'knot.show', params: { selector: 'knotPayload:v1:cccc' }, requires: [], principal: 'agent' },
      { verb: 'resolve', params: { agentId: 'mcp' }, requires: ['worktree', 'reason'], principal: 'human' },
    ],
  });

describe('classifyRun — episodes', () => {
  it('no refusals ⇒ no episodes, median null', () => {
    seq = 0;
    const r = classifyRun([row({ verb: 'status' }), row({ verb: 'fork' }), row({ verb: 'propose' })]);
    expect(r.episodes).toEqual([]);
    expect(r.medianWastedPerRecovery).toBeNull();
    expect(r.totalCalls).toBe(3);
  });

  it('an episode closes when the SAME verb completes without that refusal code', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: breach() }),
      row({ verb: 'propose', target: 'worktree=/w' }), // ladder step — productive
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:eeee' }), // recovered
    ]);
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0]!.closedAtSeq).toBe(2);
    expect(r.wastedPerEpisode).toEqual([0]);
    expect(r.medianWastedPerRecovery).toBe(0);
    expect(r.unresolvedEpisodes).toBe(0);
  });

  it('a run ending mid-recovery reports the unresolved episode', () => {
    seq = 0;
    const r = classifyRun([row({ verb: 'admit', refusal: knot() })]);
    expect(r.unresolvedEpisodes).toBe(1);
    expect(r.episodes[0]!.closedAtSeq).toBeNull();
  });
});

describe('W1 — identical-repeat', () => {
  it('an identical repeat under retriable≠retry-identical is wasted', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: breach() }),
      row({ verb: 'admit', target: 'worktree=/w', refusal: breach() }), // same call, same outcome
    ]);
    expect(r.episodes[0]!.wasted).toEqual([{ seq: 1, verb: 'admit', rule: 'W1' }]);
  });

  it('retry-identical grants exactly ONE productive repeat', () => {
    seq = 0;
    const engine = refuse({ code: 'ENGINE' }); // retry-identical by table
    const r = classifyRun([
      row({ verb: 'propose', target: 'worktree=/w', refusal: engine, ok: false }),
      row({ verb: 'propose', target: 'worktree=/w', refusal: engine, ok: false }), // repeat 1 — productive
      row({ verb: 'propose', target: 'worktree=/w', refusal: engine, ok: false }), // repeat 2 — wasted
    ]);
    expect(r.episodes[0]!.wasted.map((w) => w.rule)).toEqual(['W1']);
  });

  it('a CORRECTED retry (same verb, different target) is never W1', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:aaaa', refusal: breach() }),
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:ffff' }), // widened claim — closes
    ]);
    expect(r.wastedPerEpisode).toEqual([0]);
  });
});

describe('W2 — next-ignored (and its allowances)', () => {
  it('a call outside the ladder is wasted; ladder steps and the retry goal are not', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: breach() }),
      row({ verb: 'grade.report' }), // not in ladder, no pointer, not orientation → W2
      row({ verb: 'propose' }), // ladder — productive
    ]);
    expect(r.episodes[0]!.wasted).toEqual([{ seq: 1, verb: 'grade.report', rule: 'W2' }]);
  });

  it('the FIRST hydration of a refusal pointer is productive; the repeat is wasted', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: knot() }),
      row({ verb: 'knot.show', target: 'selector=knotPayload:v1:cccc' }), // hydration — productive
      row({ verb: 'knot.show', target: 'selector=knotPayload:v1:cccc' }), // repeat — W2
    ]);
    expect(r.episodes[0]!.wasted).toEqual([{ seq: 2, verb: 'knot.show', rule: 'W2' }]);
  });

  it('one status/refs.list re-orientation per episode is free; the second is wasted', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: breach() }),
      row({ verb: 'status' }), // orientation allowance
      row({ verb: 'status' }), // W2
    ]);
    expect(r.episodes[0]!.wasted).toEqual([{ seq: 2, verb: 'status', rule: 'W2' }]);
  });
});

describe('W3 — escalation-violation', () => {
  it('attempting the FOREIGN human verb after a KNOT is wasted', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: knot() }),
      row({ verb: 'resolve', target: 'agentId=mcp', ok: false, refusal: refuse({ code: 'FORBIDDEN' }) }),
    ]);
    expect(r.episodes[0]!.wasted).toEqual([{ seq: 1, verb: 'resolve', rule: 'W3' }]);
  });

  it('setting acceptBreach in the target is wasted even on the retry verb', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', refusal: breach() }),
      row({ verb: 'admit', target: 'worktree=/w acceptBreach', ok: false, refusal: refuse({ code: 'FORBIDDEN' }) }),
    ]);
    expect(r.episodes[0]!.wasted[0]).toEqual({ seq: 1, verb: 'admit', rule: 'W3' });
  });

  it('re-admitting WITHOUT flags after a breach (the honest widened-claim retry) is never W3', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:aaaa', refusal: breach() }),
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:ffff' }),
    ]);
    expect(r.wastedPerEpisode).toEqual([0]);
  });
});

describe('W4 — surface-miss', () => {
  it('a BAD_REQUEST/UNKNOWN_VERB refusal is ITSELF wasted, on its own episode', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w', ok: false, refusal: refuse({ code: 'BAD_REQUEST', next: [{ verb: 'fork', params: {}, requires: [], principal: 'agent' }, { verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' }] }) }),
      row({ verb: 'fork' }),
      row({ verb: 'propose' }),
      row({ verb: 'admit', target: 'worktree=/w' }), // closes (no refusal)
    ]);
    expect(r.surfaceMisses).toBe(1);
    expect(r.episodes[0]!.wasted).toEqual([{ seq: 0, verb: 'admit', rule: 'W4' }]);
    expect(r.episodes[0]!.closedAtSeq).toBe(3);
    expect(r.medianWastedPerRecovery).toBe(1);
  });
});

describe('report invariants', () => {
  it('a valid single-arm run reports exactly one skin and one descriptorsId', () => {
    seq = 0;
    const r = classifyRun([row({ verb: 'status' }), row({ verb: 'fork' })]);
    expect(r.skins).toEqual(['mcp']);
    expect(r.descriptorsIds).toEqual(['descriptors:v1:test']);
  });

  it('median over multiple episodes', () => {
    seq = 0;
    const r = classifyRun([
      // E1: breach with one W2
      row({ verb: 'admit', target: 'a', refusal: breach() }),
      row({ verb: 'grade.report' }), // W2
      row({ verb: 'admit', target: 'b' }), // closes E1
      // E2: knot, clean recovery
      row({ verb: 'admit', target: 'c', refusal: knot() }),
      row({ verb: 'knot.show', target: 'selector=knotPayload:v1:cccc' }),
    ]);
    expect(r.wastedPerEpisode).toEqual([1, 0]);
    expect(r.medianWastedPerRecovery).toBe(0.5);
  });
});

/**
 * D-13 — the panel's claim that the instrument PUNISHES compliance with its own
 * CLAIM_BREACH ladder. Verified, NOT fixed: the fix belongs on one of two sides
 * (retriability, or the classifier exemption) and that is a founder call.
 *
 * The mechanism is real and unchanged here: `CLAIM_BREACH` defaults to
 * `retry-with-override` (refusal.ts RETRIABLE_FOR), `claimRefusal` never
 * overrides it, and the W1 ladder-progress exemption fires ONLY on
 * `retry-corrected` (classifier.ts) — so ladder progress buys a CLAIM_BREACH
 * episode nothing. These two cases pin exactly where that does and does not
 * bite, so a later fix on either side has a before-picture.
 */
describe('D-13 — retry-with-override never grants the ladder-progress exemption', () => {
  it('the COMPLIANT recovery is unpunished — widening the claim moves `target`', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:aaaa', ok: false, refusal: breach() }),
      row({ verb: 'propose', target: 'worktree=/w', resultClass: 'sealed' }), // the ladder step
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:bbbb', resultClass: 'sealed' }),
    ]);
    // Widening the claim mints a NEW claimId, and `claim` rides `target` on
    // BOTH skins (mcp/server.ts targetOfParams; cli.ts admitTarget) — so the
    // re-admit is not an identical repeat and W1 never fires.
    expect(r.episodes[0]!.wasted).toEqual([]);
    expect(r.medianWastedPerRecovery).toBe(0);
  });

  it('THE RESIDUE: an identical re-admit is W1 even after full ladder progress', () => {
    seq = 0;
    const r = classifyRun([
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:aaaa', ok: false, refusal: breach() }),
      row({ verb: 'propose', target: 'worktree=/w', resultClass: 'sealed' }), // ladder progress
      row({ verb: 'admit', target: 'worktree=/w claim=claim:v1:aaaa', ok: false }), // unchanged
    ]);
    // Had the code been `retry-corrected`, ladderProgress would have exempted
    // this. It is `retry-with-override`, so it does not. Whether that is right
    // depends on whether re-admitting the ADVERTISED claimId can ever be the
    // correct recovery — the open question D-13 hands the founder.
    expect(r.episodes[0]!.wasted.map((w) => w.rule)).toEqual(['W1']);
  });
});
