// @gnomon-platform: darwin, linux
/**
 * #approval-broker / #kernel-log — slice A2 of T-2026-10-19-001 (P8-D98, broker honesty):
 *   - decisionSig v2: an `answer` binds its text (answerDigest) in the decisionSig and the presence binding;
 *   - replay verifies both layouts, with a per-log cutover marker row (see replay.ts header);
 *   - an effect failure is one approval.effect.failed row, never approval.suspect.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DECISION_SIG_DESCRIPTOR, DECISION_SIG_V2_DECISIONS, RefusedError, validateKindPayload } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { answerDigest, approveMessage, decisionMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer, usesDecisionV2 } from '../src/kernel/log/signer.js';
import { checkDecisionSigs, replayLog } from '../src/kernel/log/replay.js';
import type { KernelLog } from '../src/kernel/log/index.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { mintTestPresence, openKernelLog } from '../src/kernel/testing.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const KERNEL_P = 'p:abcdefgh/kernel';
const GUI = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };

function approvals() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  return { ring, keyId, publicKey, privateKey, key: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)) };
}
const signMsg = (privateKey: KeyObject, message: string) => cryptoSign('sha256', signaturePreimage('approve', message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');

function rig(effect?: () => Promise<void>) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const seen: Array<Record<string, string>> = [];
  const touching: PresenceProvider = {
    prove: async (req) => {
      seen.push({ ...req.binding });
      return mintTestPresence(req.purpose, { bind: req.binding });
    },
  };
  const ak = approvals();
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL_P, log: async (kind, payload) => void rows.push({ kind, payload }), approvals: ak.key, presence: touching, guiSessions: () => 1 });
  return { broker, rows, seen, ak, effect };
}

async function refusal(p: Promise<unknown>) {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  return (e as RefusedError).refusal;
}

describe('decisionSig v2 layout (P8-D98)', () => {
  it('the descriptor vector matches signer decisionMessage byte for byte, and the v2 decisions are the descriptor ones', () => {
    const v = DECISION_SIG_DESCRIPTOR.v2.vector;
    const ours = decisionMessage({ ...v.inputs });
    expect(Buffer.from(ours, 'utf8').equals(Buffer.from(v.message, 'utf8'))).toBe(true);
    expect(signaturePreimage('approve', ours).equals(Buffer.from(`gnomon:approve:v1\n${v.message}`, 'utf8'))).toBe(true);
    expect(ours.split('\n')[0]).toBe(DECISION_SIG_DESCRIPTOR.v2.marker);
    expect([...DECISION_SIG_V2_DECISIONS]).toEqual([...DECISION_SIG_DESCRIPTOR.v2.decisions]);
    for (const d of ['allow', 'deny', 'always', 'install', 'withdraw']) expect(usesDecisionV2(d)).toBe(false);
    // no ambiguity: an answer without a digest, or a v1 decision with one, throws (never a silent layout)
    expect(() => decisionMessage({ cardId: 'card:x', decision: 'answer', cardContentHash: 'sha256:c', approverPrincipalId: HUMAN })).toThrow();
    expect(() => decisionMessage({ cardId: 'card:x', decision: 'allow', cardContentHash: 'sha256:c', approverPrincipalId: HUMAN, answerDigest: answerDigest('x') })).toThrow();
    expect(decisionMessage({ cardId: 'card:x', decision: 'allow', cardContentHash: 'sha256:c', approverPrincipalId: HUMAN })).toBe(approveMessage({ cardId: 'card:x', decision: 'allow', cardContentHash: 'sha256:c', approverPrincipalId: HUMAN }));
  });
});

describe('#approval-broker answer binding (P8-D98)', () => {
  const askUser = (b: ApprovalBroker) => b.raise({ kind: 'ask-user', requestedBy: AGENT, attended: true, detail: { q: 'colour?' }, lines: ['colour?'], privateNote: true });

  it('FALSIFIER: an answer rewritten on the wire fails decisionSig (AUTH bad-signature), and a v1 sig for an answer is refused', async () => {
    const r = rig();
    const c = await askUser(r.broker);
    const signed = decisionMessage({ cardId: c.cardId, decision: 'answer', cardContentHash: c.contentHash, approverPrincipalId: HUMAN, answerDigest: answerDigest('Blue') });
    const rewritten = await refusal(r.broker.approve(GUI as never, { cardId: c.cardId, decision: 'answer', note: 'Red', decisionSig: signMsg(r.ak.privateKey, signed) }));
    expect(rewritten).toMatchObject({ code: 'AUTH', data: { reason: 'bad-signature' } });
    const v1 = await refusal(r.broker.approve(GUI as never, { cardId: c.cardId, decision: 'answer', note: 'Blue', decisionSig: signMsg(r.ak.privateKey, approveMessage({ cardId: c.cardId, decision: 'answer', cardContentHash: c.contentHash, approverPrincipalId: HUMAN })) }));
    expect(v1).toMatchObject({ code: 'AUTH', data: { reason: 'bad-signature' } });
    const noText = await refusal(r.broker.approve(GUI as never, { cardId: c.cardId, decision: 'answer', decisionSig: signMsg(r.ak.privateKey, signed) }));
    expect(noText).toMatchObject({ code: 'BAD_REQUEST' });
    expect(r.rows.filter((x) => x.kind === 'approval.decide')).toEqual([]);
    expect(r.seen).toEqual([]); // every refusal came before presence
    // the honest answer decides; the presence binding carried the same answerDigest the row's noteHash records
    const ok = await r.broker.approve(GUI as never, { cardId: c.cardId, decision: 'answer', note: 'Blue', decisionSig: signMsg(r.ak.privateKey, signed) });
    expect(ok.state).toBe('decided');
    const decide = r.rows.find((x) => x.kind === 'approval.decide')!.payload;
    expect(decide.noteHash).toBe(answerDigest('Blue'));
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatchObject({ action: 'approval.decide', cardId: c.cardId, decision: 'answer', answerDigest: answerDigest('Blue') });
    expect(r.broker.bindingFor(c.cardId, 'answer', 'Blue').binding).toMatchObject({ answerDigest: answerDigest('Blue') });
  });
});

describe('#approval-broker approval.effect.failed (P8-D98)', () => {
  it('FALSIFIER: an effect failure writes exactly one approval.effect.failed and no approval.suspect; the card stays pending', async () => {
    const r = rig();
    const c = await r.broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'ls' }, lines: ['Bash: ls'], tool: 'Bash', toolInput: { command: 'ls' }, decisions: ['allow', 'deny'] as never, effect: async () => Promise.reject(new Error('disk full: secret path /x')) });
    const sig = signMsg(r.ak.privateKey, approveMessage({ cardId: c.cardId, decision: 'allow', cardContentHash: c.contentHash, approverPrincipalId: HUMAN }));
    await expect(r.broker.approve(GUI as never, { cardId: c.cardId, decision: 'allow', decisionSig: sig })).rejects.toThrow('disk full');
    const failed = r.rows.filter((x) => x.kind === 'approval.effect.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload).toEqual({ cardId: c.cardId, decision: 'allow', effect: 'permission', reason: 'effect-threw' });
    expect(validateKindPayload('approval.effect.failed', failed[0]!.payload)).toEqual([]);
    expect(r.rows.filter((x) => x.kind === 'approval.suspect')).toEqual([]);
    expect(JSON.stringify(failed[0]!.payload)).not.toContain('disk full'); // a code, never free text
    expect(r.broker.card(c.cardId)!.state).toBe('pending');
  });
});

describe('#kernel-log replay verifies both decisionSig layouts (P8-D98 cutover)', () => {
  const KERNEL = kernelPrincipalOf();
  const homes: string[] = [];
  const logs: KernelLog[] = [];
  afterEach(async () => {
    for (const l of logs.splice(0)) await l.close().catch(() => undefined);
    for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
  });

  const CH = `sha256:${'c'.repeat(64)}`;
  const card = (n: number) => `card:01J0000000000000000000000${n}`;

  /** A real chained, kernel-signed log of approval.decide rows; `rows` builds each payload from the approvals signer. */
  async function logOf(build: (a: ReturnType<typeof approvals>) => Array<{ kind: string; payload: Record<string, unknown> }>) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'gnomon-dsig-'));
    homes.push(home);
    const key = SoftwareEd25519Signer.generate('kernel');
    recordKernelPub(home, key.publicKeyPem);
    const a = approvals();
    a.ring.addEd25519(key.publicKeyPem);
    const log = openKernelLog({ home, kernelPrincipal: KERNEL, signer: key, keyRing: a.ring });
    logs.push(log);
    for (const r of build(a)) await log.append({ kind: r.kind, principal: KERNEL, payload: r.payload });
    await log.close();
    const opts = { keyRing: a.ring, kernelPrincipal: KERNEL, kernelKeyIds: [key.keyId], decisionKeys: { keyIdsFor: (p: string) => (p === HUMAN ? [a.keyId] : []) } };
    return { home, opts };
  }
  const decide = (a: ReturnType<typeof approvals>, cardId: string, decision: string, layout: 'v1' | 'v2', answer?: string, recorded = answer) => {
    const msg =
      layout === 'v1'
        ? approveMessage({ cardId, decision, cardContentHash: CH, approverPrincipalId: HUMAN })
        : decisionMessage({ cardId, decision, cardContentHash: CH, approverPrincipalId: HUMAN, answerDigest: answerDigest(answer!) });
    return { kind: 'approval.decide', payload: { cardId, decision, by: HUMAN, decisionSig: signMsg(a.privateKey, msg), presence: 'fresh', via: 'gui', contentHash: CH, ...(recorded !== undefined ? { noteHash: answerDigest(recorded), noteBytes: Buffer.byteLength(recorded) } : {}) } };
  };

  it('FALSIFIER: historical v1 rows (allow and answer) still verify; no cutover is claimed', async () => {
    const f = await logOf((a) => [decide(a, card(1), 'allow', 'v1'), decide(a, card(2), 'answer', 'v1', 'Blue')]);
    const r = replayLog(f.home, f.opts);
    expect(r).toMatchObject({ ok: true, decisionSigs: 'verified', divergences: [] });
    expect(r.decisionCutoverSeq).toBeUndefined();
  });

  it('FALSIFIER: a v1 layout claiming answer after the cutover (first v2 answer) is refused', async () => {
    const f = await logOf((a) => [decide(a, card(1), 'answer', 'v1', 'old'), decide(a, card(2), 'answer', 'v2', 'Blue'), decide(a, card(3), 'answer', 'v1', 'Red')]);
    const r = replayLog(f.home, f.opts);
    expect(r.ok).toBe(false);
    expect(r.decisionCutoverSeq).toBeDefined();
    expect(r.divergences).toHaveLength(1);
    expect(r.divergences[0]).toMatchObject({ reason: 'decision-sig-v1-after-cutover' });
    expect(r.divergences[0]!.seq).toBeGreaterThan(r.decisionCutoverSeq!);
  });

  it('a P8-D98-only kind is a cutover marker too: a v1 answer after approval.effect.failed is refused', async () => {
    const f = await logOf((a) => [{ kind: 'approval.effect.failed', payload: { cardId: card(1), decision: 'allow', effect: 'permission', reason: 'effect-threw' } }, decide(a, card(2), 'answer', 'v1', 'Red')]);
    const r = replayLog(f.home, f.opts);
    expect(r.ok).toBe(false);
    expect(r.divergences.map((d) => d.reason)).toEqual(['decision-sig-v1-after-cutover']);
  });

  it('FALSIFIER: an answer whose recorded digest was rewritten fails (verifies over neither layout); a v2 sig on a non-answer is refused', async () => {
    const f = await logOf((a) => [decide(a, card(1), 'answer', 'v2', 'Blue', 'Red'), { kind: 'approval.decide', payload: { ...decide(a, card(2), 'answer', 'v2', 'x').payload, decision: 'allow' } }]);
    const r = replayLog(f.home, f.opts);
    expect(r.ok).toBe(false);
    expect(r.divergences.map((d) => d.reason)).toEqual(['decision-sig-bad', 'decision-sig-bad']);
  });

  it('fail closed: an approver with no key or a row with no decisionSig is unverifiable; without decisionKeys the report says unchecked', async () => {
    const f = await logOf((a) => [{ kind: 'approval.decide', payload: { ...decide(a, card(1), 'allow', 'v1').payload, by: 'p:abcdefgh/other' } }, { kind: 'approval.decide', payload: { cardId: card(2), decision: 'deny', by: HUMAN, contentHash: CH } }]);
    const r = replayLog(f.home, f.opts);
    expect(r.divergences.map((d) => d.reason)).toEqual(['decision-sig-unverifiable', 'decision-sig-unverifiable']);
    const { decisionKeys: _k, ...plain } = f.opts;
    expect(replayLog(f.home, plain)).toMatchObject({ ok: true, decisionSigs: 'unchecked' });
    // the pure check agrees with the integrated one
    expect(checkDecisionSigs([], f.opts.keyRing, f.opts.decisionKeys).divergences).toEqual([]);
  });
});
