/**
 * #identity TD-2026-10-20-514 (G-ID-09, G-ID-10; Aegis C1–C3, C7): the decision.sign rules in TS
 * (src/kernel/identity/decision-batch.ts) against the SHARED vectors the Swift helper is tested with
 * (gnomon-contracts/test/fixtures/decision-batch-vectors.json), and HelperApprovalsKey.signDecisionBatch over the
 * counting fake: one evaluation, every signature verified, a lying helper refused. Platform-independent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { BatchRefusal, checkDecisionBatch, decisionRowV2, HardwarePresenceDenied, HardwareRootAuthority, HelperApprovalsKey, intentOf, outstandingPresenceChallenges } from '../src/kernel/identity/index.js';
import { decisionMessage } from '../src/kernel/log/signer.js';
import { CountingFakeHelper, FakeHelper } from './helper-fake.js';

import { createHash } from 'node:crypto';
import { presenceModeRowHash, ROW_TABLE_KINDS, ROW_TABLE_MIN_HELPER } from '../src/kernel/identity/decision-batch.js';

describe('helper 1.11.0 row tables (TD-2026-10-29-746 / -894, G-HLP-03/04)', () => {
  it('presence.mode and kernel-custody need helper 1.11.0 and are in the closed table', () => {
    expect(ROW_TABLE_MIN_HELPER['presence.mode']).toBe('1.11.0');
    expect(ROW_TABLE_MIN_HELPER['kernel-custody']).toBe('1.11.0');
    expect(ROW_TABLE_KINDS).toEqual(expect.arrayContaining(['presence.mode', 'kernel-custody']));
  });

  it('the presence.mode row hash is sha256 of the exact signed root message (what click.open presents)', () => {
    const v = V.vectors.find((x) => x.name === 'presence.mode: switch Touch ID off')!;
    expect(v.error).toBeNull();
    const msg = Buffer.from(v.root[1]!, 'utf8');
    expect(presenceModeRowHash(msg)).toBe(`sha256:${createHash('sha256').update(msg).digest('hex')}`);
  });
});

type Vector = { name: string; approvals: string[]; root: string[]; intent: string | null; error: string | null; shown?: string };
const V = JSON.parse(readFileSync(new URL('../../gnomon-contracts/test/fixtures/decision-batch-vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[] };

describe('decision.sign shared vectors (the TS mirror of the helper)', () => {
  it('every vector: the same verdict and, when signed, the same line byte-exact', () => {
    expect(V.vectors.length).toBeGreaterThanOrEqual(40);
    for (const v of V.vectors) {
      let code: string | null = null;
      let line: string | undefined;
      try {
        if (v.intent === null) throw new BatchRefusal('bad-request', 'no intent');
        line = checkDecisionBatch(v.approvals.map((s) => Buffer.from(s)), v.root.map((s) => Buffer.from(s)), Buffer.from(v.intent)).line;
      } catch (e) {
        if (!(e instanceof BatchRefusal)) throw e;
        code = e.code;
      }
      expect(code, v.name).toBe(v.error);
      if (code === null) expect(line, v.name).toBe(v.shown);
    }
  });
});

const HUMAN = 'p:abcdefgh/matt';
const GEN = 'test0001';
const CARD = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const H = `sha256:${'a'.repeat(64)}`;
const MH = `sha256:${'c'.repeat(64)}`;

function rig(opts: ConstructorParameters<typeof FakeHelper>[1] = {}) {
  const helper = new CountingFakeHelper(GEN, opts);
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { throw new Error('the once seam is never called on the batch path'); } });
  const grants = [
    { schemaVersion: 'grantRow:v1', kind: 'grant.trust', createdAt: '2026-10-20T12:00:00.000Z', manifestHash: MH, tier: 'community', cardId: CARD },
    { schemaVersion: 'grantRow:v2', kind: 'grant.install', createdAt: '2026-10-20T12:00:00.000Z', name: 'acme.diff-lens', manifestHash: MH, packageHash: `sha256:${'e'.repeat(64)}`, cardId: CARD, source: 'package' },
  ];
  const intent = grants.map(intentOf);
  const dec = decisionRowV2({ cardId: CARD, cardKind: 'install', decision: 'install', contentHash: H, approver: HUMAN, rootRows: intent });
  const message = decisionMessage({ cardId: CARD, decision: 'install', cardContentHash: H, approverPrincipalId: HUMAN });
  const req = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', approver: HUMAN, message, prompt: 'Gnomon: install acme.diff-lens', presence: { purpose: 'mod.install' as const, binding: { action: 'mod.install', cardId: CARD, contentHash: H, decision: 'install' } }, rows: [dec, ...grants], intent, root };
  return { helper, approvals, root, req };
}

describe('HelperApprovalsKey.signDecisionBatch', () => {
  it('G-ID-09: ONE evaluation returns the decisionSig, a bound token and a verified root signature per row', async () => {
    const r = rig();
    expect(await r.approvals.decisionBatchAvailable()).toBe(true);
    const out = await r.approvals.signDecisionBatch(r.req);
    expect(r.helper.evaluations).toBe(1);
    expect(out.token).not.toBeNull();
    expect(out.decisionSig).toBeTypeOf('string');
    expect(out.rootSigs).toHaveLength(3);
    r.req.rows.forEach((row, i) => expect(r.root.verifyRow(out.rootSigs[i]!.signer, row, out.rootSigs[i]!.sig)).toBe(true));
    expect(out.shown).toContain('install acme.diff-lens from package');
  });

  it('a helper below 1.8.0 is not offered the batch (the path comes from info.version only)', async () => {
    const helper = new FakeHelper(GEN);
    const a = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
    expect(await a.decisionBatchAvailable()).toBe(false);
  });

  it('G-ID-10 falsifiers: a bad root signature, a wrong key, a replaced line or a declined prompt return nothing and burn the challenge', async () => {
    for (const opts of [{ corruptSig: 3 }, { wrongKey: true }, { shown: 'Gnomon Helper: something else' }, { shown: null }, { touch: false }]) {
      const before = outstandingPresenceChallenges();
      const r = rig(opts);
      await expect(r.approvals.signDecisionBatch(r.req)).rejects.toBeInstanceOf(HardwarePresenceDenied);
      expect(outstandingPresenceChallenges()).toBe(before);
    }
  });

  it('a batch the rules refuse never reaches the prompt (C1: a row the card never showed)', async () => {
    const r = rig();
    const extra = { schemaVersion: 'grantRow:v1', kind: 'grant.egress', createdAt: '2026-10-20T12:00:00.000Z', manifestHash: MH, hosts: ['evil.example.com'], cardId: CARD };
    await expect(r.approvals.signDecisionBatch({ ...r.req, rows: [r.req.rows[0]!, r.req.rows[1]!, extra, r.req.rows[2]!] })).rejects.toThrow(/refused before any prompt/);
    expect(r.helper.evaluations).toBe(0);
    // and the fake helper (the helper's rules) refuses it too when the kernel's pre-check is bypassed
    const msgs = (rows: unknown[]) => rows.map((x) => Buffer.from(`gnomon:row-sig:v1\n${canonicalJson(x)}`).toString('base64'));
    expect(() => r.helper.handle({ op: 'decision.sign', gen: GEN, reason: 'x', approvals: [], root: msgs([r.req.rows[0], r.req.rows[1], extra, r.req.rows[2]]), intent: Buffer.from(canonicalJson(r.req.intent)).toString('base64') })).toThrow(/batch-refused/);
    expect(r.helper.evaluations).toBe(0);
  });
});
