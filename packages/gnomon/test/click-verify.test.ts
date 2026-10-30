/**
 * #identity Aegis S2 M-1 (TD-2026-10-29-894, helper 1.11.0 click key): the VERIFIER side of the click key, before the
 * click key itself ships (S4). Every signature check in the kernel goes through KeyRing.verify, so the click rule runs on
 * every approval and row verify path; replay rebuilds a click decision's approve:v2 preimage from the LOGGED card, so
 * its card kind and class are the card record's. Tested with the shared click-approve vectors and a real P-256 key.
 */
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { clickApproveMessage, clickCardRefusal, clickClassOf, clickKindOf } from '../src/kernel/identity/decision-batch.js';
import { clickKeyId, KeyRing, SIGNATURE_DOMAINS, type SignatureDomain } from '../src/kernel/log/signer.js';
import { checkDecisionSigs } from '../src/kernel/log/replay.js';

const CV = JSON.parse(readFileSync(new URL('../../gnomon-contracts/test/fixtures/click-approve-vectors.json', import.meta.url), 'utf8')) as { vectors: Array<{ name: string; message: string; refused: string | null }> };
const HUMAN = 'p:abcdefgh/matt';
const H = `sha256:${'a'.repeat(64)}`;

function clickKey(): { priv: KeyObject; x963: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = publicKey.export({ format: 'jwk' });
  return { priv: privateKey, x963: Buffer.concat([Buffer.from([4]), Buffer.from(j.x!, 'base64url'), Buffer.from(j.y!, 'base64url')]) };
}
/** DER ECDSA over the exact bytes, as SecKeyCreateSignature(.ecdsaSignatureMessageX962SHA256) makes it. */
const der = (priv: KeyObject, bytes: Buffer): Buffer => cryptoSign('sha256', bytes, { key: priv, dsaEncoding: 'der' });
/** The signer.ts domain whose preimage these bytes are (first line), and the message after it. */
function split(bytes: Buffer): { domain: SignatureDomain; message: string } | null {
  const s = bytes.toString('utf8');
  const i = s.indexOf('\n');
  const d = Object.entries(SIGNATURE_DOMAINS).find(([, v]) => v === s.slice(0, i));
  return d ? { domain: d[0] as SignatureDomain, message: s.slice(i + 1) } : null;
}

describe('KeyRing click keys (Aegis S2 M-1): the click rule runs inside every verify', () => {
  it('a click key id is click: + 32 hex of sha256(X9.63), as the helper mints it', () => {
    const k = clickKey();
    const ring = new KeyRing();
    expect(ring.addClick(k.x963)).toBe(`click:${createHash('sha256').update(k.x963).digest('hex').slice(0, 32)}`);
    expect(clickKeyId(k.x963)).toMatch(/^click:[0-9a-f]{32}$/);
    expect(() => ring.addClick(Buffer.alloc(33))).toThrow(/X9\.63/);
  });

  it('FALSIFIER: on every shared vector a REAL click signature verifies exactly when the click rule allows it', () => {
    const k = clickKey();
    const ring = new KeyRing();
    const id = ring.addClick(k.x963);
    let checked = 0;
    for (const v of CV.vectors) {
      const bytes = Buffer.from(v.message, 'utf8');
      const sp = split(bytes);
      if (!sp) continue;
      checked++;
      expect(ring.verify(id, sp.domain, sp.message, der(k.priv, bytes)), v.name).toBe(v.refused === null ? 'ok' : 'bad');
    }
    expect(checked).toBeGreaterThanOrEqual(CV.vectors.length - 1);
  });

  it('FALSIFIER: a click key never verifies a root row or an event, whatever the signature; other keys are not judged by the rule', () => {
    const k = clickKey();
    const ring = new KeyRing();
    const id = ring.addClick(k.x963);
    const row = canonicalJson({ schemaVersion: 'gnomon-presence-mode:v1', mode: 'off', cardId: 'card:x', createdAt: '2026-10-29T00:00:00.000Z' });
    expect(ring.verify(id, 'row', row, der(k.priv, Buffer.from(`gnomon:row-sig:v1\n${row}`)))).toBe('bad');
    expect(ring.verify(id, 'event', H, der(k.priv, Buffer.from(`gnomon:event-sig:v1\n${H}`)))).toBe('bad');
    expect(ring.verify(id, 'approve', `card:x\nallow\n${H}\n${HUMAN}`, der(k.priv, Buffer.from(`gnomon:approve:v1\ncard:x\nallow\n${H}\n${HUMAN}`)))).toBe('bad');
    expect(ring.verify('click:0123', 'approveClick', 'x', Buffer.alloc(64))).toBe('unknown-key');
    expect(ring.verify(`click:${'0'.repeat(32)}`, 'approveClick', 'x', Buffer.alloc(64))).toBe('unknown-key');
  });
});

describe('clickCardRefusal (Aegis S2 M-1): the preimage names the actual card record', () => {
  const card = { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', kind: 'permission', contentHash: H };
  const m = (o: Partial<Parameters<typeof clickApproveMessage>[0]> = {}) => clickApproveMessage({ cardId: card.cardId, cardKind: 'permission', cardClass: 'reversible', decision: 'allow', contentHash: H, approver: HUMAN, ...o });
  it('accepts the card it names', () => {
    expect(clickCardRefusal(m(), card)).toBeNull();
    expect(clickCardRefusal(m({ cardClass: 'irreversible' }), { ...card, flags: ['irreversible'] })).toBeNull();
  });
  it('FALSIFIER: another kind, class, card or content hash than the record is refused', () => {
    expect(clickCardRefusal(m({ cardKind: 'plan' }), card)).toMatch(/card kind/);
    expect(clickCardRefusal(m({ cardClass: 'destructive' }), card)).toMatch(/card class/);
    expect(clickCardRefusal(m(), { ...card, flags: ['irreversible'] })).toMatch(/card class/); // a reversible claim on an irreversible card
    expect(clickCardRefusal(m({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZY' }), card)).toMatch(/another card/);
    expect(clickCardRefusal(m({ contentHash: `sha256:${'b'.repeat(64)}` }), card)).toMatch(/content hash/);
  });
  it('FALSIFIER: a root action raised on an allowlisted card kind is still a root kind (voice enrolment on a strictness card, grant actions)', () => {
    expect(clickKindOf({ kind: 'strictness', detail: { op: 'voice.enrol' } })).toBe('voice.enrol');
    expect(clickKindOf({ kind: 'grant', detail: { action: 'kernel-custody' } })).toBe('kernel-custody');
    expect(clickKindOf({ kind: 'grant', detail: { action: 'log.quarantine' } })).toBe('log.quarantine');
    const enrol = { cardId: card.cardId, kind: 'strictness', contentHash: H, detail: { op: 'voice.enrol' } };
    expect(clickCardRefusal(m({ cardKind: 'strictness' }), enrol)).toMatch(/card kind/);
    expect(clickCardRefusal(m({ cardKind: 'voice.enrol' }), enrol)).toMatch(/root card/);
    expect(clickClassOf({})).toBe('reversible');
  });
});

describe('replay checkDecisionSigs (Aegis S2 M-1): a click decision verifies only against its logged card', () => {
  const cardId = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const env = (seq: number, kind: string, payload: Record<string, unknown>) => ({ seq, kind, hash: H, envelope: canonicalJson({ kind, payload }) });
  const setup = (card: Record<string, unknown>) => {
    const k = clickKey();
    const ring = new KeyRing();
    const id = ring.addClick(k.x963);
    const sign = (kind: string, cls: string, decision = 'allow') => der(k.priv, clickApproveMessage({ cardId, cardKind: kind, cardClass: cls, decision, contentHash: H, approver: HUMAN })).toString('base64');
    const req = env(1, 'approval.request', { card: { cardId, contentHash: H, ...card } });
    const decide = (sig: string, extra: Record<string, unknown> = {}, decision = 'allow') => env(2, 'approval.decide', { cardId, decision, by: HUMAN, contentHash: H, decisionSig: sig, clickKeyId: id, ...extra });
    const run = (rows: ReturnType<typeof env>[]) => checkDecisionSigs(rows, ring, { keyIdsFor: () => [] }).divergences.map((d) => d.reason);
    return { sign, req, decide, run };
  };

  it('a click on a permission card verifies', () => {
    const t = setup({ kind: 'permission' });
    expect(t.run([t.req, t.decide(t.sign('permission', 'reversible'))])).toEqual([]);
  });

  it('FALSIFIER: a click signed for another kind or class than the logged card never verifies', () => {
    const t = setup({ kind: 'permission', flags: ['irreversible'] });
    expect(t.run([t.req, t.decide(t.sign('permission', 'reversible'))])).toEqual(['decision-sig-bad']);
    expect(t.run([t.req, t.decide(t.sign('plan', 'irreversible'))])).toEqual(['decision-sig-bad']);
    expect(t.run([t.req, t.decide(t.sign('permission', 'irreversible'), { cardKind: 'plan' })])).toEqual(['decision-sig-click-refused']);
    expect(t.run([t.req, t.decide(t.sign('permission', 'irreversible'))])).toEqual([]);
  });

  it('FALSIFIER: a click on a root card, an always on an irreversible card, or with no logged card never verifies', () => {
    const root = setup({ kind: 'grant', detail: { action: 'kernel-custody' } });
    expect(root.run([root.req, root.decide(root.sign('kernel-custody', 'reversible'))])).toEqual(['decision-sig-click-refused']);
    const irr = setup({ kind: 'permission', flags: ['irreversible'] });
    expect(irr.run([irr.req, irr.decide(irr.sign('permission', 'irreversible', 'always'), {}, 'always')])).toEqual(['decision-sig-click-refused']);
    expect(irr.run([irr.decide(irr.sign('permission', 'irreversible'))])).toEqual(['decision-sig-unverifiable']);
  });
});
