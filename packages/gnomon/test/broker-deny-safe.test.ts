/**
 * #approval-broker deny-safe semantics (spec §3.4; T-2026-10-19-009 item 5,
 * Orca audit Adopt 5), one explicit falsifier each:
 *   1. an undecodable request is denied (never allowed, never left hanging);
 *   2. a cancel settles to "no answer" with the card into deny, never allow;
 *   3. a late answer finds no prompt (refused before presence, no decide row).
 * The behaviour already existed (supervisor.ts control-cancel /
 * permission-malformed, broker.ts expire / approve re-checks); these tests pin
 * it. Platform-independent: the darwin session rig in
 * test/permission-session.test.ts covers the same paths end to end.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { parseStreamLine, permissionDenyLine } from '../src/adapters/claude-code/adapter.js';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { answerFor } from '../src/kernel/supervisor/permission.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';

const HUMAN = 'p:abcdefgh/matt';
const GUI = { connId: 'conn:1', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' } as const;
const CAN_USE_TOOL = { type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: '/w/x', content: 'hi' }, tool_use_id: 'toolu_1' } };

function rig() {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const presence: PresenceProvider = { prove: async (req) => (prompts.push(req.prompt.text), mintTestPresence(req.purpose, { bind: req.binding })) };
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    presence,
  });
  const sig = (cardId: string, decision: string) => cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: broker.card(cardId)!.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const raise = () => broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/s-01hzzzzz', attended: true, detail: { tool: 'Write' }, lines: ['x'], decisions: ['allow', 'deny'] });
  const decides = () => rows.filter((r) => r.kind === 'approval.decide');
  return { broker, rows, prompts, sig, raise, decides };
}

async function refused(p: Promise<unknown>): Promise<{ code: string; reason: unknown; state: unknown }> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  const r = (e as RefusedError).refusal;
  return { code: r.code, reason: r.data?.reason, state: (r.data as { state?: unknown } | undefined)?.state };
}

describe('§3.4 deny-safe broker (Orca Adopt 5)', () => {
  it('FALSIFIER 1: an undecodable request is denied — never allowed, never a pending allow', async () => {
    // the wire: a good id with an undecodable body is answered deny (permission-malformed); a bad id cannot be answered at all
    expect(parseStreamLine(JSON.stringify({ ...CAN_USE_TOOL, request: { ...CAN_USE_TOOL.request, input: 'not an object' } }))).toMatchObject({ kind: 'permission-malformed', requestId: 'req-1' });
    expect(parseStreamLine(JSON.stringify({ ...CAN_USE_TOOL, request_id: 'bad id!' })).kind).toBe('malformed');
    expect(parseStreamLine('{"type":"control_request","request_id":"req-1","request":').kind).toBe('malformed');
    // the line the supervisor writes for permission-malformed (supervisor.ts) is a deny control_response for that id
    expect(JSON.parse(permissionDenyLine('req-1', 'Denied: the permission request was malformed.'))).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'deny', message: 'Denied: the permission request was malformed.' } },
    });
    // the decision: anything but a decoded allow / approve-plan is deny
    for (const d of ['', 'ALLOW', 'allow ', 'always-maybe', 'null', 'undefined', '{"allow":true}']) expect(answerFor('permission', d).behavior).toBe('deny');
    expect(answerFor('plan', 'allow').behavior).toBe('deny');
    // the broker: an undecodable approve is refused and settles nothing; an unknown card's decision is deny
    const r = rig();
    const { cardId } = await r.raise();
    for (const bad of [null, 'allow', ['allow'], { cardId, decision: 'yes' }, { cardId, decision: 'allow', decisionSig: 7 }, { cardId, decision: 'allow', extra: 1 }]) {
      expect((await refused(r.broker.approve(GUI as never, bad as never))).code).toBe('BAD_REQUEST');
    }
    expect(r.broker.card(cardId)!.state).toBe('pending');
    expect(r.decides()).toEqual([]);
    expect(r.prompts).toEqual([]);
    expect(await r.broker.decisionOf('card:01HZZZZZZZZZZZZZZZZZZZZZZZ')).toBe('deny');
  });

  it('FALSIFIER 2: a cancel settles with no allow — the waiter gets deny and the session answer is deny or nothing', async () => {
    const r = rig();
    const { cardId } = await r.raise();
    const waiting = r.broker.decisionOf(cardId);
    expect(parseStreamLine('{"type":"control_cancel_request","request_id":"req-1"}')).toEqual({ kind: 'control-cancel', type: 'control_cancel_request', requestId: 'req-1' });
    expect(await r.broker.expire(cardId, 'cancelled')).toBe(true);
    const d = await waiting;
    expect(d).toBe('deny');
    expect(answerFor('permission', d).behavior).toBe('deny');
    expect(r.broker.card(cardId)!.state).toBe('expired');
    expect(r.rows.filter((x) => x.kind === 'approval.expire').map((x) => x.payload)).toEqual([expect.objectContaining({ cardId, into: 'deny', why: 'cancelled' })]);
    expect(await r.broker.expire(cardId, 'cancelled')).toBe(false); // settles once
    expect(r.decides()).toEqual([]);
  });

  it('FALSIFIER 3: a late answer finds no prompt — refused before presence, no decide row, the outcome stays deny', async () => {
    const r = rig();
    const { cardId } = await r.raise();
    await r.broker.expire(cardId, 'cancelled');
    const late = await refused(r.broker.approve(GUI as never, { cardId, decision: 'allow', decisionSig: r.sig(cardId, 'allow') }));
    expect(late.code).toBe('BAD_REQUEST'); // "not decidable": the prompt is gone
    expect(late.state).toBe('expired'); // refused BECAUSE the card settled, not for some other bad-params
    expect(r.prompts).toEqual([]); // no presence prompt was ever shown for it
    expect(r.decides()).toEqual([]);
    expect(await r.broker.decisionOf(cardId)).toBe('deny');
    // a card the broker never held: NOT_FOUND, never a fresh prompt
    expect((await refused(r.broker.approve(GUI as never, { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', decision: 'allow', decisionSig: 'AAAA' }))).code).toBe('NOT_FOUND');
    expect(r.prompts).toEqual([]);
  });

  it('FALSIFIER 3 positive control: the same sig() on a PENDING card gets past the signature check (to presence and a decide row)', async () => {
    const r = rig();
    const { cardId } = await r.raise();
    await r.broker.approve(GUI as never, { cardId, decision: 'allow', decisionSig: r.sig(cardId, 'allow') });
    expect(r.prompts.length).toBe(1); // presence was asked: the signature was accepted
    expect(r.decides().length).toBe(1);
    expect(r.broker.card(cardId)!.state).toBe('decided');
  });
});
