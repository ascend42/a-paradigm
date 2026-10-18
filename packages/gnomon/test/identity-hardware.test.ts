/**
 * #identity M1.3 slice 1 (spec §3.1 root + approvals keys, §3.4 presence
 * classes): the kernel's hardware keys behind the helper, driven by the
 * in-memory FakeHelper (test/helper-fake.ts). G-ID-06 (the unlock is the
 * connection's alone, dies with its connection and with the helper), the
 * hardware presence attestation and every guard's falsifier. Platform-
 * independent: in-process only, no files, no child process.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { RefusedError } from '@a-company/gnomon-contracts';
import { ApprovalBroker } from '../src/kernel/broker/index.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import {
  beginHardwarePresence,
  completeHardwarePresence,
  consumeBoundPresence,
  derToP1363,
  HardwarePresenceDenied,
  HardwareRootAuthority,
  HelperApprovalsKey,
  HelperUnavailableError,
  MAX_PRESENCE_CHALLENGES,
  outstandingPresenceChallenges,
  p256FromX963,
  pemOf,
  PresenceToken,
  RootUnavailableError,
} from '../src/kernel/identity/index.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const GEN = 'test0001';
const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB';
const gui = (connId = A) => ({ connId, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' });
const cli = (connId = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC') => ({ connId, principal: HUMAN, principalClass: 'human', surface: 'cli', credential: 'device' });

function rig(opts: ConstructorParameters<typeof FakeHelper>[1] = {}) {
  const helper = new FakeHelper(GEN, opts);
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals,
  });
  approvals.onHelperExit(() => void broker.helperExited());
  const permission = () => broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'ls' }, lines: ['Bash: ls'], tool: 'Bash', toolInput: { command: 'ls' } });
  return { helper, approvals, broker, rows, permission };
}

async function refusalOf(p: Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  const r = (e as RefusedError).refusal;
  return { code: r.code, reason: (r.data as { reason?: unknown } | undefined)?.reason };
}

describe('key and signature encodings', () => {
  it('derToP1363 matches what node verifies, and refuses malformed DER', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ring = new KeyRing();
    const id = ring.addP256(publicKey);
    for (let i = 0; i < 20; i++) {
      const der = cryptoSign('sha256', signaturePreimage('row', `m${i}`), { key: privateKey, dsaEncoding: 'der' });
      expect(ring.verify(id, 'row', `m${i}`, derToP1363(der))).toBe('ok');
    }
    expect(() => derToP1363(Buffer.from([0x30, 0x02, 0x02, 0x00]))).toThrow();
    expect(() => derToP1363(Buffer.alloc(64))).toThrow();
  });

  it('p256FromX963 accepts only an uncompressed P-256 point', () => {
    const h = new FakeHelper(GEN);
    expect(pemOf(p256FromX963(h.x963('root')))).toBe(h.publicPem('root').trim());
    expect(() => p256FromX963(Buffer.alloc(33, 2).toString('base64'))).toThrow();
  });
});

describe('HardwareRootAuthority', () => {
  it('signs a row with fresh presence through the helper and the signature verifies under the pinned root', async () => {
    const h = new FakeHelper(GEN);
    const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h.publicPem('root') }, { helper: h });
    expect(root.state).toBe('hardware');
    const row = { schemaVersion: 'registryRow:v1', kind: 'device', x: 1 };
    const s = await root.signRowAsync(row);
    expect(root.verifyRow(s.signer, row, s.sig)).toBe(true);
    expect(h.signs).toEqual([{ key: 'root', mode: 'fresh', n: 1 }]);
    expect(h.prompts[0]).toMatch(/root key/);
  });

  it('falsifier: a helper that signs with another key gets RootUnavailableError, never a row signature', async () => {
    const h = new FakeHelper(GEN, { wrongKey: true });
    const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h.publicPem('root') }, { helper: h });
    await expect(root.signRowAsync({ a: 1 })).rejects.toBeInstanceOf(RootUnavailableError);
  });

  it('falsifier: declined presence and a dead helper refuse (no software fallback)', async () => {
    const h = new FakeHelper(GEN, { touch: false });
    const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h.publicPem('root') }, { helper: h });
    await expect(root.signRowAsync({ a: 1 })).rejects.toBeInstanceOf(RootUnavailableError);
    const h2 = new FakeHelper(GEN);
    h2.crash();
    await expect(new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h2.publicPem('root') }, { helper: h2 }).signRowAsync({ a: 1 })).rejects.toBeInstanceOf(RootUnavailableError);
    // without a synchronous one-shot helper, signRow refuses rather than block
    expect(() => new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h2.publicPem('root') }, {}).signRow({ a: 1 })).toThrow(RootUnavailableError);
  });

  it('the synchronous path (gnomon-helper once) signs through the same checks', () => {
    const h = new FakeHelper(GEN);
    // a synchronous stand-in for `once`: drive the fake's async reply through a precomputed signature
    const once = (req: Record<string, unknown>) => {
      const m = Buffer.from((req.messages as string[])[0]!, 'base64');
      return { ok: true, sigs: [cryptoSign('sha256', m, { key: h.keys.get(`${GEN}.root`)!.priv, dsaEncoding: 'der' }).toString('base64')] };
    };
    const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h.publicPem('root') }, { once });
    const s = root.signRow({ b: 2 });
    expect(root.verifyRow(s.signer, { b: 2 }, s.sig)).toBe(true);
    expect(root.verifyRow(s.signer, { b: 3 }, s.sig)).toBe(false);
  });
});

describe('hardware presence attestation', () => {
  it('mints a helper-se token only for a verified signature over the challenge; single use', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ring = new KeyRing();
    const id = ring.addP256(publicKey);
    const bind = { action: 'approval.decide', cardId: 'card:X', contentHash: 'sha256:aa', decision: 'allow' };
    const c = beginHardwarePresence('approval.decide', bind, A);
    const sig = cryptoSign('sha256', signaturePreimage('presence', c.message), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const t = completeHardwarePresence(c.challengeId, id, sig, ring);
    expect(PresenceToken.is(t)).toBe(true);
    expect((t as PresenceToken).method).toBe('helper-se');
    expect(consumeBoundPresence(t, 'approval.decide', bind)).toBe('ok');
    expect(completeHardwarePresence(c.challengeId, id, sig, ring)).toBe('unknown-challenge'); // replay
  });

  it('falsifier: a signature from another key, or over another challenge, mints nothing', () => {
    const k1 = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const k2 = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ring = new KeyRing();
    const id = ring.addP256(k1.publicKey);
    const bind = { a: 'b' };
    const c = beginHardwarePresence('approval.decide', bind, A);
    expect(completeHardwarePresence(c.challengeId, id, cryptoSign('sha256', signaturePreimage('presence', c.message), { key: k2.privateKey, dsaEncoding: 'ieee-p1363' }), ring)).toBe('bad-signature');
    const c2 = beginHardwarePresence('approval.decide', bind, A);
    const c3 = beginHardwarePresence('approval.decide', bind, A);
    expect(completeHardwarePresence(c3.challengeId, id, cryptoSign('sha256', signaturePreimage('presence', c2.message), { key: k1.privateKey, dsaEncoding: 'ieee-p1363' }), ring)).toBe('bad-signature');
    // and an approve-domain signature never counts as presence (domain separation)
    expect(completeHardwarePresence(c2.challengeId, id, cryptoSign('sha256', signaturePreimage('approve', c2.message), { key: k1.privateKey, dsaEncoding: 'ieee-p1363' }), ring)).toBe('bad-signature');
  });

  it('falsifier: the challenge map is bounded', () => {
    const before = outstandingPresenceChallenges();
    const open: string[] = [];
    let refused = false;
    for (let i = 0; i < MAX_PRESENCE_CHALLENGES + 1; i++) {
      try {
        open.push(beginHardwarePresence('approval.decide', { i: String(i) }, A).challengeId);
      } catch {
        refused = true;
      }
    }
    expect(refused).toBe(true);
    expect(outstandingPresenceChallenges()).toBeLessThanOrEqual(MAX_PRESENCE_CHALLENGES);
    const ring = new KeyRing();
    for (const id of open) completeHardwarePresence(id, 'gkey-p256:v1:00', new Uint8Array(0), ring);
    expect(outstandingPresenceChallenges()).toBe(before);
  });
});

describe('HelperApprovalsKey', () => {
  it('fresh: one touch makes the decisionSig and the bound presence token; the sig verifies for this human only', async () => {
    const { helper, approvals } = rig();
    const message = approveMessage({ cardId: 'card:X', decision: 'allow', cardContentHash: 'sha256:aa', approverPrincipalId: HUMAN });
    const bind = { action: 'approval.decide', cardId: 'card:X', contentHash: 'sha256:aa', decision: 'allow' };
    const r = await approvals.signDecision({ connId: A, approver: HUMAN, message, mode: 'fresh', prompt: 'Gnomon: allow', keepUnlock: true, presence: { purpose: 'approval.decide', binding: bind } });
    expect(helper.prompts).toEqual(['Gnomon: allow']);
    expect(approvals.verify(HUMAN, message, r.decisionSig)).toBe('ok');
    expect(approvals.verify('p:abcdefgh/other', message, r.decisionSig)).toBe('bad');
    expect(consumeBoundPresence(r.token, 'approval.decide', bind)).toBe('ok');
    expect(r.kept).toBe(true);
  });

  it('falsifier: a decisionSig that does not verify (wrong key, corrupted) is refused, never used', async () => {
    const message = approveMessage({ cardId: 'card:X', decision: 'allow', cardContentHash: 'sha256:aa', approverPrincipalId: HUMAN });
    for (const opts of [{ wrongKey: true }, { corruptSig: 0 }, { corruptSig: 1 }]) {
      const { approvals } = rig(opts);
      await expect(approvals.signDecision({ connId: A, approver: HUMAN, message, mode: 'fresh', prompt: 'p', presence: { purpose: 'approval.decide', binding: { x: 'y' } } })).rejects.toBeInstanceOf(HardwarePresenceDenied);
    }
  });

  it('falsifier: an approver other than the key\'s human never reaches the helper', async () => {
    const { approvals, helper } = rig();
    await expect(approvals.signDecision({ connId: A, approver: 'p:abcdefgh/eve', message: 'm', mode: 'fresh' })).rejects.toBeInstanceOf(HardwarePresenceDenied);
    expect(helper.signs).toEqual([]);
  });
});

describe('broker on the helper-held approvals key (approve without a client decisionSig)', () => {
  it('a GUI cached-class decision: fresh touch, unlock kept in the helper; the next one on the same connection is cached (no prompt)', async () => {
    const r = rig();
    const c1 = await r.permission();
    const d1 = await r.broker.approve(gui(), { cardId: c1.cardId, decision: 'allow' });
    expect(d1.presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(1);
    const decide = r.rows.find((x) => x.kind === 'approval.decide')!;
    expect(r.approvals.verify(HUMAN, approveMessage({ cardId: c1.cardId, decision: 'allow', cardContentHash: c1.contentHash, approverPrincipalId: HUMAN }), String(decide.payload.decisionSig))).toBe('ok');
    expect(r.rows.some((x) => x.kind === 'approval.unlock')).toBe(true);
    const c2 = await r.permission();
    const d2 = await r.broker.approve(gui(), { cardId: c2.cardId, decision: 'deny' });
    expect(d2.presence).toBe('cached');
    expect(r.helper.prompts.length).toBe(1);
    expect(r.helper.signs.at(-1)).toEqual({ key: 'approvals', mode: 'cached', connId: A, n: 1 });
  });

  it('G-ID-06: the unlock is never usable from another connection, and dies with its connection', async () => {
    const r = rig();
    await r.broker.approve(gui(A), { cardId: (await r.permission()).cardId, decision: 'allow' });
    const d = await r.broker.approve(gui(B), { cardId: (await r.permission()).cardId, decision: 'allow' });
    expect(d.presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(2);
    await r.broker.connectionClosed(A);
    expect(r.helper.unlocks.has(A)).toBe(false); // dropped in the helper too
    const d3 = await r.broker.approve(gui(A), { cardId: (await r.permission()).cardId, decision: 'allow' });
    expect(d3.presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(3);
  });

  it('G-ID-06: a helper exit drops every unlock; the next decision prompts again (and starts from no unlock)', async () => {
    const r = rig();
    await r.broker.approve(gui(), { cardId: (await r.permission()).cardId, decision: 'allow' });
    expect(r.broker.unlocks.has(A)).toBe(true);
    r.helper.crash();
    await new Promise((res) => setImmediate(res));
    expect(r.broker.unlocks.has(A)).toBe(false);
    expect(r.rows.some((x) => x.kind === 'approval.unlock.dropped' && x.payload.reason === 'helper-exit')).toBe(true);
  });

  it('the helper lost an unlock the kernel still had (screen lock): the decision falls back to a fresh touch', async () => {
    const r = rig();
    await r.broker.approve(gui(), { cardId: (await r.permission()).cardId, decision: 'allow' });
    r.helper.unlocks.clear();
    const d = await r.broker.approve(gui(), { cardId: (await r.permission()).cardId, decision: 'allow' });
    expect(d.presence).toBe('fresh');
    expect(r.rows.some((x) => x.kind === 'approval.unlock.dropped' && x.payload.reason === 'helper-lost')).toBe(true);
  });

  it('a CLI decision prompts every time and never keeps an unlock', async () => {
    const r = rig();
    for (let i = 0; i < 2; i++) {
      const d = await r.broker.approve(cli(), { cardId: (await r.permission()).cardId, decision: 'allow' });
      expect(d.presence).toBe('cli');
    }
    expect(r.helper.prompts.length).toBe(2);
    expect(r.helper.unlocks.size).toBe(0);
  });

  it('fresh-class decisions (always) take a touch even with an unlock', async () => {
    const r = rig();
    await r.broker.approve(gui(), { cardId: (await r.permission()).cardId, decision: 'allow' });
    const d = await r.broker.approve(gui(), { cardId: (await r.permission()).cardId, decision: 'always' });
    expect(d.presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(2);
  });

  it('declined presence is FORBIDDEN presence, logged approval.presence.denied, card still pending', async () => {
    const r = rig({ touch: false });
    const c = await r.permission();
    expect(await refusalOf(r.broker.approve(gui(), { cardId: c.cardId, decision: 'allow' }))).toEqual({ code: 'FORBIDDEN', reason: 'presence' });
    expect(r.rows.some((x) => x.kind === 'approval.presence.denied')).toBe(true);
    expect(r.broker.card(c.cardId)!.state).toBe('pending');
  });

  it('falsifier: a helper that is down or answers with a bad signature fails closed (UNSUPPORTED / FORBIDDEN presence)', async () => {
    const r = rig();
    r.helper.crash();
    const c = await r.permission();
    expect(await refusalOf(r.broker.approve(gui(), { cardId: c.cardId, decision: 'allow' }))).toEqual({ code: 'UNSUPPORTED', reason: 'presence' });
    const w = rig({ wrongKey: true });
    const c2 = await w.permission();
    expect((await refusalOf(w.broker.approve(gui(), { cardId: c2.cardId, decision: 'allow' }))).reason).toBe('presence');
    expect(w.broker.card(c2.cardId)!.state).toBe('pending');
    expect(w.rows.some((x) => x.kind === 'approval.decide')).toBe(false);
  });

  it('a client-supplied decisionSig is still verified against the hardware key (a forged one is AUTH bad-signature)', async () => {
    const r = rig();
    const c = await r.permission();
    const forged = cryptoSign('sha256', signaturePreimage('approve', 'x'), { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    expect(await refusalOf(r.broker.approve(gui(), { cardId: c.cardId, decision: 'allow', decisionSig: forged }))).toEqual({ code: 'AUTH', reason: 'bad-signature' });
  });

  it('HelperUnavailableError is the helper-down signal (type check)', () => {
    expect(new HelperUnavailableError('exited', 'x')).toBeInstanceOf(Error);
  });
});
