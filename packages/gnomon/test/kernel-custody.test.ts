/**
 * #kernel-custody + #log-anchor (TD-2026-10-29-746 slice S2; G-ID-14, G-ID-15). The helper is a fake transport that
 * answers kernel.cert with a cert signed by a software P-256 key exactly as KernelCert.swift builds it, and keeps an
 * anchor like Anchor.swift. Platform-independent (temp homes, no keychain).
 */
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '@a-company/gnomon-contracts';
import {
  custodyOf,
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  HelperLogAnchor,
  kernelCertRefusal,
  KernelPubSealed,
  kernelPubPath,
  migrationCardLines,
  migrationRows,
  readKernelPubs,
  readKernelSeal,
  recordKernelPub,
  requestKernelCert,
  writeKernelSeal,
  type HelperTransport,
  type KernelCertRecord,
} from '../src/kernel/identity/index.js';
import { KernelLog } from '../src/kernel/log/index.js';
import { KeyRing, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';

const BOOT = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const LOG = 'log:01HZZZZZZZZZZZZZZZZZZZZZZA';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const home = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gnomon-custody-'));
  dirs.push(d);
  const h = path.join(d, '.gnomon');
  mkdirSync(h, { mode: 0o700 });
  return h;
};

function certKey(): { priv: KeyObject; x963: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = publicKey.export({ format: 'jwk' });
  return { priv: privateKey, x963: Buffer.concat([Buffer.from([4]), Buffer.from(j.x!, 'base64url'), Buffer.from(j.y!, 'base64url')]) };
}
const tag = (b: Buffer): string => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/** A cert as KernelCert.swift issues it. */
function issue(ck: { priv: KeyObject; x963: Buffer }, s: SoftwareEd25519Signer, o: { logId?: string; boot?: string; now?: number } = {}): KernelCertRecord {
  const now = o.now ?? Date.now();
  const row = { schemaVersion: 'gnomon-kernel-cert:v1', kernelKeyId: s.keyId, pub: s.publicKeyPem, logId: o.logId ?? LOG, boot: o.boot ?? BOOT, pid: 4242, pidVersion: 7, callerCdhash: 'ab'.repeat(20), startedAt: new Date(now - 1000).toISOString(), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 3600_000).toISOString() };
  const msg = Buffer.from(`gnomon:kernel-cert:v1\n${canonicalJson(row)}`, 'utf8');
  return { cert: msg.toString('base64'), sig: cryptoSign('sha256', msg, { key: ck.priv, dsaEncoding: 'der' }).toString('base64'), certKey: ck.x963.toString('base64'), certKeyId: tag(ck.x963) };
}

/** A fake helper: kernel.cert + anchor.read/write with the helper's verdict and refusal rules (no genesis check). */
function fakeHelper(o: { version?: string; ck?: { priv: KeyObject; x963: Buffer }; anchor?: { logId: string; seq: number; hash: string } | null } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  let stored = o.anchor ?? null;
  const refuse = (code: string): never => {
    throw Object.assign(new Error(code), { code });
  };
  const t: HelperTransport = {
    alive: true,
    version: o.version ?? '1.11.1',
    onExit: () => undefined,
    close: async () => undefined,
    async request(req) {
      sent.push(req);
      if (req.op === 'kernel.cert') {
        return { ...issueFor(req), boot: BOOT };
      }
      if (req.op === 'anchor.read') {
        if (!stored) return { empty: true, verdict: 'empty' };
        const v = stored.logId !== req.logId ? 'other-log' : (req.seq as number) < stored.seq ? 'rollback' : req.seq === stored.seq ? (req.hash === stored.hash ? 'ok' : 'fork') : 'ahead';
        return { ...stored, empty: false, verdict: v };
      }
      if (req.op === 'anchor.write') {
        const h = { logId: req.logId as string, seq: req.seq as number, hash: req.hash as string };
        if (stored && stored.logId !== h.logId && !req.newLog) refuse('anchor-log');
        if (stored && stored.logId === h.logId && h.seq < stored.seq) refuse('anchor-rollback');
        stored = h;
        return { written: true };
      }
      return refuse('bad-request');
    },
  };
  const ck = o.ck ?? certKey();
  function issueFor(req: Record<string, unknown>): KernelCertRecord {
    const row = { schemaVersion: 'gnomon-kernel-cert:v1', kernelKeyId: req.kernelKeyId, pub: req.pub, logId: req.logId, boot: BOOT, pid: 1, pidVersion: 1, callerCdhash: 'ab'.repeat(20), startedAt: new Date().toISOString(), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    const msg = Buffer.from(`gnomon:kernel-cert:v1\n${canonicalJson(row)}`, 'utf8');
    return { cert: msg.toString('base64'), sig: cryptoSign('sha256', msg, { key: ck.priv, dsaEncoding: 'der' }).toString('base64'), certKey: ck.x963.toString('base64'), certKeyId: tag(ck.x963) };
  }
  return { t, sent, ck, stored: () => stored };
}

describe('kernel cert (G-ID-14): the TS mirror of the helper verifier, bound to the kernel key', () => {
  it('accepts a cert for this key, boot, log and time; refuses another of any', () => {
    const ck = certKey();
    const s = SoftwareEd25519Signer.generate();
    const now = Date.now();
    const c = issue(ck, s, { now });
    const base = { kernelKeyId: s.keyId, publicKeyPem: s.publicKeyPem, boot: BOOT, logId: LOG, now };
    expect(kernelCertRefusal(c, base)).toBeNull();
    expect(kernelCertRefusal(c, { ...base, boot: '11111111-2222-3333-4444-555555555555' })).toMatch(/another boot/);
    expect(kernelCertRefusal(c, { ...base, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZB' })).toMatch(/another log/);
    expect(kernelCertRefusal(c, { ...base, now: now + 25 * 3600_000 })).toMatch(/expired/);
    const other = SoftwareEd25519Signer.generate();
    expect(kernelCertRefusal(c, { ...base, kernelKeyId: other.keyId, publicKeyPem: other.publicKeyPem })).toMatch(/another kernel key/);
    expect(kernelCertRefusal({ ...c, sig: issue(certKey(), s, { now }).sig }, base)).toMatch(/not signed/);
    expect(kernelCertRefusal(c, { ...base, certKey: certKey().x963.toString('base64') })).toMatch(/registered/);
    expect(kernelCertRefusal({ ...c, certKeyId: 'sha256:00' }, base)).toMatch(/cert key id/);
  });

  it('requestKernelCert: only a SEA with helper >= 1.11.0 asks; no cert is never a failure', async () => {
    const s = SoftwareEd25519Signer.generate();
    const h = fakeHelper();
    expect((await requestKernelCert({ helper: h.t, signer: s, logId: LOG, sea: false, boot: () => BOOT })).why).toBe('not-sea');
    expect((await requestKernelCert({ helper: null, signer: s, logId: LOG, sea: true, boot: () => BOOT })).why).toBe('no-helper');
    expect((await requestKernelCert({ helper: fakeHelper({ version: '1.10.0' }).t, signer: s, logId: LOG, sea: true, boot: () => BOOT })).why).toBe('helper-old');
    expect(h.sent).toEqual([]);
    const ok = await requestKernelCert({ helper: h.t, signer: s, logId: LOG, sea: true, boot: () => BOOT });
    expect(ok.cert?.certKeyId).toBe(tag(h.ck.x963));
    expect(h.sent[0]).toMatchObject({ op: 'kernel.cert', kernelKeyId: s.keyId, pub: s.publicKeyPem, logId: LOG });
    expect((await requestKernelCert({ helper: h.t, signer: s, logId: LOG, sea: true, boot: () => '11111111-2222-3333-4444-555555555555' })).why).toBe('bad-cert');
  });
});

describe('the seal (G-ID-14): kernel-pub.jsonl after the migration card', () => {
  const sealed = (h: string, ck: { priv: KeyObject; x963: Buffer }, legacy: string[], root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK)) => {
    const s0 = SoftwareEd25519Signer.generate();
    const m = migrationRows({ cert: issue(ck, s0), legacyKeyIds: legacy, currentKeyId: s0.keyId, head: { log: LOG, seq: 9, hash: `sha256:${'1'.repeat(64)}` }, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    const [k, l] = m.rows.map((r) => ({ ...r, createdAt: '2026-10-29T00:00:00.000Z' }));
    writeKernelSeal(h, { row: k!, ...root.signRow(k) }, { row: l!, ...root.signRow(l) }, m.keyIds);
    return root;
  };

  it('before the seal: every entry is partial and appends are as before', () => {
    const h = home();
    const a = SoftwareEd25519Signer.generate();
    recordKernelPub(h, a.publicKeyPem);
    expect(readKernelPubs(h, { seal: null })).toEqual([{ keyId: a.keyId, publicKeyPem: a.publicKeyPem, custody: 'partial' }]);
    expect(readKernelPubs(h)).toEqual([{ keyId: a.keyId, publicKeyPem: a.publicKeyPem }]);
  });

  it('FALSIFIER: after the seal an uncertified append is refused, a forged line is not trusted, legacy stays legacy, a certified key is certified', () => {
    const h = home();
    const ck = certKey();
    const legacy = SoftwareEd25519Signer.generate();
    recordKernelPub(h, legacy.publicKeyPem);
    const root = sealed(h, ck, [legacy.keyId]);
    const seal = readKernelSeal(h, root);
    expect(seal.state).toBe('sealed');
    const s = seal.state === 'sealed' ? seal.seal : null;
    const forger = SoftwareEd25519Signer.generate();
    expect(() => recordKernelPub(h, forger.publicKeyPem)).toThrow(KernelPubSealed);
    // a same-user process appends its own line by hand, or with a cert from ANOTHER cert key
    writeFileSync(kernelPubPath(h), `${JSON.stringify({ keyId: forger.keyId, publicKeyPem: forger.publicKeyPem, at: 'x', cert: issue(certKey(), forger) })}\n`, { flag: 'a' });
    const now = SoftwareEd25519Signer.generate();
    recordKernelPub(h, now.publicKeyPem, new Date(), { cert: issue(ck, now) });
    const got = readKernelPubs(h, { seal: s });
    expect(got.map((e) => [e.keyId, e.custody])).toEqual([
      [legacy.keyId, 'legacy'],
      [now.keyId, 'certified'],
    ]);
  });

  it('FALSIFIER: a seal not signed by the root, or with rows from two decisions, does not verify', () => {
    const h = home();
    const ck = certKey();
    sealed(h, ck, ['gkey:v1:' + 'a'.repeat(64)]);
    expect(readKernelSeal(h, new DevTestRootAuthority(DEV_TEST_ROOT_ACK)).state).toBe('invalid');
    expect(readKernelSeal(home(), new DevTestRootAuthority(DEV_TEST_ROOT_ACK)).state).toBe('none');
  });

  it('M-4: the migration rows seal EVERY legacy key by digest and count, pass the row table, never empty; the card says it plainly', async () => {
    const { rowTableRefusal, legacyKeysDigest } = await import('../src/kernel/identity/decision-batch.js');
    const ck = certKey();
    const s = SoftwareEd25519Signer.generate();
    const ids = Array.from({ length: 200 }, (_, i) => `gkey:v1:${i.toString(16).padStart(64, '0')}`);
    const m = migrationRows({ cert: issue(ck, s), legacyKeyIds: ids, currentKeyId: s.keyId, head: { log: LOG, seq: 3, hash: `sha256:${'2'.repeat(64)}` }, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect(m.keyIds.length).toBe(200);
    expect(m.rows[1]).toMatchObject({ schemaVersion: 'gnomon-kernel-legacy:v2', keyCount: 200, keysDigest: legacyKeysDigest(ids) });
    expect(rowTableRefusal('kernel-custody', m.rows.map((r) => ({ ...r, createdAt: '2026-10-29T00:00:00.000Z' })))).toBeNull();
    expect(migrationRows({ cert: issue(ck, s), legacyKeyIds: [], currentKeyId: s.keyId, head: { log: LOG, seq: 0, hash: `sha256:${'2'.repeat(64)}` }, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }).keyIds).toEqual([s.keyId]);
    const lines = migrationCardLines({ legacyKeys: 200, certKeyId: tag(ck.x963), sinceLastVerified: 2 }).join('\n');
    expect(lines).toMatch(/one time/);
    expect(lines).toMatch(/partial/);
    expect(lines).toMatch(/Not now/);
    expect(lines).toMatch(/2 of them were recorded since the last verified start/);
  });

  it('FALSIFIER (M-4): a seal file whose key list is not the signed digest or count does not verify', async () => {
    const { readFileSync } = await import('node:fs');
    const { kernelCustodyPath } = await import('../src/kernel/identity/index.js');
    const h = home();
    const a = `gkey:v1:${'a'.repeat(64)}`;
    const root = sealed(h, certKey(), [a]);
    expect(readKernelSeal(h, root).state).toBe('sealed');
    const doc = JSON.parse(readFileSync(kernelCustodyPath(h), 'utf8'));
    doc.legacyKeyIds = [a, `gkey:v1:${'b'.repeat(64)}`].sort();
    writeFileSync(kernelCustodyPath(h), JSON.stringify(doc));
    expect(readKernelSeal(h, root)).toMatchObject({ state: 'invalid', why: expect.stringMatching(/digest or count/) });
  });

  it('custody is full only with a cert, a seal of that cert key and no anchor quarantine', () => {
    const ck = certKey();
    const cert = issue(ck, SoftwareEd25519Signer.generate());
    const seal = { state: 'sealed' as const, seal: { certKey: cert.certKey, certKeyId: cert.certKeyId, legacyKeyIds: new Set<string>(), logId: LOG, headSeq: 1, headHash: 'x', cardId: 'c' } };
    expect(custodyOf({ cert }, seal, false).custody).toBe('full');
    expect(custodyOf({ cert }, seal, true).custody).toBe('partial');
    expect(custodyOf({ cert: null, why: 'not-sea' }, seal, false).custody).toBe('partial');
    expect(custodyOf({ cert }, { state: 'none' }, false).custody).toBe('partial');
    expect(custodyOf({ cert: issue(certKey(), SoftwareEd25519Signer.generate()) }, seal, false).custody).toBe('partial');
  });
});

describe('H-1: the seal on the anchored log cannot be rolled back', () => {
  const KP = 'p:00000000/kernel';
  async function sealedHome() {
    const { resolveCustody, sealRowPayload, KERNEL_SEAL_ROW_KIND } = await import('../src/kernel/identity/index.js');
    const h = home();
    const ck = certKey();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const legacy = SoftwareEd25519Signer.generate();
    recordKernelPub(h, legacy.publicKeyPem);
    const signer = SoftwareEd25519Signer.generate('kernel');
    const log = KernelLog.open({ home: h, kernelPrincipal: KP, signer, keyRing: new KeyRing(), kernelKeyIds: [signer.keyId] });
    const m = migrationRows({ cert: issue(ck, signer), legacyKeyIds: [legacy.keyId], currentKeyId: signer.keyId, head: { log: log.logId, seq: log.head().seq, hash: log.head().hash }, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    const [k, l] = m.rows.map((r) => ({ ...r, createdAt: '2026-10-29T00:00:00.000Z' }));
    writeKernelSeal(h, { row: k!, ...root.signRow(k) }, { row: l!, ...root.signRow(l) }, m.keyIds);
    const r0 = resolveCustody(h, root);
    expect(r0).toMatchObject({ mode: 'sealed', heal: true });
    await log.append({ kind: KERNEL_SEAL_ROW_KIND, principal: KP, payload: sealRowPayload(h, (r0 as { seal: never }).seal) });
    await log.close();
    expect(resolveCustody(h, root)).toMatchObject({ mode: 'sealed' });
    expect(resolveCustody(h, root).heal).toBeUndefined();
    return { h, ck, root, legacy, resolveCustody };
  }

  it('FALSIFIER: delete the seal, append a key: the forged key does not verify, legacy keys stop verifying, no migration card (tampered)', async () => {
    const { kernelCustodyPath } = await import('../src/kernel/identity/index.js');
    const { h, ck, root, legacy, resolveCustody } = await sealedHome();
    rmSync(kernelCustodyPath(h));
    const forger = SoftwareEd25519Signer.generate();
    recordKernelPub(h, forger.publicKeyPem, new Date(), { sealed: false }); // the forger appends with the file gone
    const r = resolveCustody(h, root);
    expect(r.mode).toBe('tampered'); // the daemon never offers the migration card in this mode, only the tamper card
    const trusted = readKernelPubs(h, { seal: r.seal }).map((e) => e.keyId);
    expect(trusted).not.toContain(forger.keyId);
    expect(trusted).not.toContain(legacy.keyId);
    // a key certified under the LOGGED cert key is still trusted
    const good = SoftwareEd25519Signer.generate();
    recordKernelPub(h, good.publicKeyPem, new Date(), { cert: issue(ck, good) });
    expect(readKernelPubs(h, { seal: resolveCustody(h, root).seal }).map((e) => e.keyId)).toEqual([good.keyId]);
  });

  it('FALSIFIER: a replaced seal file (another valid seal) or an invalid one is tampered, never all-partial', async () => {
    const { kernelCustodyPath } = await import('../src/kernel/identity/index.js');
    const { h, root, resolveCustody } = await sealedHome();
    writeFileSync(kernelCustodyPath(h), '{"schemaVersion":"gnomon-kernel-custody-doc:v1"}');
    expect(resolveCustody(h, root).mode).toBe('tampered');
    const h2 = home();
    writeFileSync(path.join(h2, 'keys.tmp'), '');
    mkdirSync(path.join(h2, 'keys'), { mode: 0o700 });
    writeFileSync(kernelCustodyPath(h2), 'not json');
    const r2 = resolveCustody(h2, root);
    expect(r2.mode).toBe('tampered');
    expect(r2.seal).not.toBeNull();
  });
});

describe('H-2: a legacy key is kernel-authored only up to the seal', () => {
  const KP = 'p:00000000/kernel';
  it('FALSIFIER: a legacy-key row past headSeq, or under another log id, is not kernel-authored; labels per row', async () => {
    const h = home();
    const a = SoftwareEd25519Signer.generate('kernel');
    const ring = new KeyRing();
    ring.addEd25519(a.publicKeyPem);
    const l1 = KernelLog.open({ home: h, kernelPrincipal: KP, signer: a, keyRing: ring, kernelKeyIds: [a.keyId] });
    for (let i = 0; i < 4; i++) await l1.append({ kind: 'session.open', principal: KP });
    const logId = l1.logId;
    await l1.close();
    const b = SoftwareEd25519Signer.generate('kernel');
    const l2 = KernelLog.open({ home: h, kernelPrincipal: KP, signer: b, keyRing: ring, kernelKeyIds: [a.keyId], kernelKeyBounds: { [a.keyId]: { maxSeq: 2, logId } }, kernelKeyLabels: { [a.keyId]: 'legacy', [b.keyId]: 'certified' } });
    expect(l2.isKernelKey(a.keyId, 2)).toBe(true);
    expect(l2.isKernelKey(a.keyId, 3)).toBe(false);
    expect(l2.isKernelKey(a.keyId)).toBe(false); // no seq: fail closed
    expect(l2.rowCustody(a.keyId, 1)).toBe('legacy');
    expect(l2.rowCustody(a.keyId, 4)).toBeNull();
    expect(l2.rowCustody(b.keyId, 9)).toBe('certified');
    const v = l2.verify();
    expect(v.failures.filter((f) => f.code === 'kernel-key').map((f) => f.seq)).toEqual([3, 4]);
    await l2.close();
    const l3 = KernelLog.open({ home: h, kernelPrincipal: KP, signer: b, keyRing: ring, kernelKeyIds: [a.keyId], kernelKeyBounds: { [a.keyId]: { maxSeq: 99, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZB' } } });
    expect(l3.isKernelKey(a.keyId, 1)).toBe(false);
    await l3.close();
  });
});

describe('log anchor (G-ID-15): read, compare, advance, quarantine; never newLog on its own', () => {
  const KP = 'p:00000000/kernel';
  async function logWith(rows: number): Promise<{ log: KernelLog; h: string }> {
    const h = home();
    const signer = SoftwareEd25519Signer.generate('kernel');
    const log = KernelLog.open({ home: h, kernelPrincipal: KP, signer, keyRing: new KeyRing(), kernelKeyIds: [signer.keyId] });
    for (let i = 0; i < rows; i++) await log.append({ kind: 'session.open', principal: KP });
    return { log, h };
  }
  const ref = (log: KernelLog) => ({ logId: log.head().log, seq: log.head().seq, hash: log.head().hash });
  const noNewLog = (sent: Array<Record<string, unknown>>) => expect(sent.filter((r) => r.newLog !== undefined || r.genesis !== undefined)).toEqual([]);

  it('empty: the head is written (no newLog); ok and verified ahead keep tracking and advance', async () => {
    const { log } = await logWith(3);
    const f = fakeHelper();
    const a = new HelperLogAnchor({ helper: f.t, log });
    expect((await a.start()).state).toBe('tracking');
    expect(f.stored()).toEqual(ref(log));
    await log.append({ kind: 'session.open', principal: KP });
    await a.tick();
    expect(f.stored()!.seq).toBe(log.head().seq);
    const b = new HelperLogAnchor({ helper: f.t, log });
    expect(await b.start()).toMatchObject({ state: 'tracking', verdict: 'ok' });
    const anchored = ref(log);
    await log.append({ kind: 'session.open', principal: KP });
    const c = new HelperLogAnchor({ helper: f.t, log });
    expect(await c.start()).toMatchObject({ state: 'tracking', verdict: 'ahead', anchored });
    expect(f.stored()!.seq).toBe(log.head().seq);
    noNewLog(f.sent);
    await log.close();
  });

  it('FALSIFIER: a log behind, forked from or other than the anchored head is quarantined and the anchor is never written', async () => {
    const { log } = await logWith(4);
    const head = ref(log);
    const behind = fakeHelper({ anchor: { ...head, seq: head.seq + 5 } });
    const a = new HelperLogAnchor({ helper: behind.t, log });
    expect(await a.start()).toMatchObject({ state: 'quarantine', verdict: 'rollback', resolve: 'run gnomon log quarantine' });
    await a.tick();
    expect(behind.stored()!.seq).toBe(head.seq + 5);
    const fork = fakeHelper({ anchor: { ...head, hash: `sha256:${'9'.repeat(64)}` } });
    expect((await new HelperLogAnchor({ helper: fork.t, log }).start()).verdict).toBe('fork');
    // ahead, but the anchored seq has another hash in this log: the chain does not reach it
    const forkAhead = fakeHelper({ anchor: { logId: head.logId, seq: 2, hash: `sha256:${'9'.repeat(64)}` } });
    expect(await new HelperLogAnchor({ helper: forkAhead.t, log }).start()).toMatchObject({ state: 'quarantine', verdict: 'fork' });
    const other = fakeHelper({ anchor: { logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZB', seq: 50, hash: `sha256:${'8'.repeat(64)}` } });
    const q = new HelperLogAnchor({ helper: other.t, log });
    expect(await q.start()).toMatchObject({ state: 'quarantine', verdict: 'other-log', resolve: 'card' });
    expect(q.quarantineRow()).toEqual({ from: { logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZB', seq: 50, hash: `sha256:${'8'.repeat(64)}` }, to: head.logId });
    for (const f of [behind, fork, forkAhead, other]) noNewLog(f.sent);
    // only the allowed card moves it, with newLog
    expect(await q.afterQuarantineDecision()).toBe(true);
    expect(other.sent.at(-1)).toMatchObject({ op: 'anchor.write', newLog: true, logId: head.logId });
    expect(q.status().state).toBe('tracking');
    await q.stop();
    await log.close();
  });

  it('FALSIFIER (M-6): ahead, but a row after the anchored head is not signed by a trusted key: quarantine fork, no write', async () => {
    const h = home();
    const a = SoftwareEd25519Signer.generate('kernel');
    const ring = new KeyRing();
    const l1 = KernelLog.open({ home: h, kernelPrincipal: KP, signer: a, keyRing: ring, kernelKeyIds: [a.keyId] });
    for (let i = 0; i < 2; i++) await l1.append({ kind: 'session.open', principal: KP });
    const anchored = ref(l1);
    await l1.close();
    const x = SoftwareEd25519Signer.generate('kernel'); // a key the next start does not trust
    const l2 = KernelLog.open({ home: h, kernelPrincipal: KP, signer: x, keyRing: new KeyRing(), kernelKeyIds: [x.keyId] });
    await l2.append({ kind: 'session.open', principal: KP });
    await l2.close();
    const b = SoftwareEd25519Signer.generate('kernel');
    const r3 = new KeyRing();
    r3.addEd25519(a.publicKeyPem);
    const l3 = KernelLog.open({ home: h, kernelPrincipal: KP, signer: b, keyRing: r3, kernelKeyIds: [a.keyId] });
    const f = fakeHelper({ anchor: anchored });
    expect(await new HelperLogAnchor({ helper: f.t, log: l3 }).start()).toMatchObject({ state: 'quarantine', verdict: 'fork' });
    expect(f.stored()).toEqual(anchored);
    expect(l3.signaturesVerifyAfter(l3.head().seq)).toEqual({ ok: true });
    await l3.close();
  });

  it('M-7: a narrowing row is anchored before its append resolves; any other row waits for the cadence', async () => {
    const { log } = await logWith(1);
    const f = fakeHelper();
    const a = new HelperLogAnchor({ helper: f.t, log, cadenceMs: 60_000 });
    await a.start();
    log.setAnchorHook((e) => a.hookFor(e));
    const r1 = await log.append({ kind: 'session.open', principal: KP });
    expect(f.stored()!.seq).toBeLessThan(r1.seq);
    const r2 = await log.append({ kind: 'approval.rule.revoked', principal: KP, payload: { ruleId: 'card:01J00000000000000000000001', repoKey: `sha256:${'a'.repeat(64)}`, tool: 'Bash', connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA' } });
    expect(f.stored()!.seq).toBe(r2.seq);
    log.setAnchorHook(null);
    await a.stop();
    await log.close();
  });

  it('no helper, or one older than 1.11.0: unavailable, nothing sent', async () => {
    const { log } = await logWith(1);
    expect((await new HelperLogAnchor({ helper: null, log }).start()).state).toBe('unavailable');
    const old = fakeHelper({ version: '1.10.0' });
    expect((await new HelperLogAnchor({ helper: old.t, log }).start()).state).toBe('unavailable');
    expect(old.sent).toEqual([]);
    await log.close();
  });

  it('M-2: the genesis route needs helper 1.11.1, a tracking anchor and an old log that verifies; it signs the genesis with the kernel key', async () => {
    const { log } = await logWith(2);
    const { log: next } = await logWith(1);
    const signer = SoftwareEd25519Signer.generate('kernel');
    const old = fakeHelper({ version: '1.11.0' });
    const a = new HelperLogAnchor({ helper: old.t, log });
    await a.start();
    expect(await a.moveToNewLog({ oldLog: log, newHead: ref(next), signer })).toMatchObject({ ok: false, why: expect.stringMatching(/1\.11\.1/) });
    const f = fakeHelper();
    const b = new HelperLogAnchor({ helper: f.t, log });
    await b.start();
    expect(await b.moveToNewLog({ oldLog: next, newHead: ref(next), signer })).toMatchObject({ ok: false }); // "old" log is another log
    expect(await b.moveToNewLog({ oldLog: log, newHead: ref(next), signer })).toEqual({ ok: true });
    const w = f.sent.at(-1)!;
    expect(w).toMatchObject({ op: 'anchor.write', newLog: true, logId: next.head().log });
    const genesis = Buffer.from(w.genesis as string, 'base64').toString('utf8');
    expect(JSON.parse(genesis)).toEqual({ schemaVersion: 'gnomon-log-genesis:v1', logId: next.head().log, prev: ref(log) });
    const { createPublicKey, verify } = await import('node:crypto');
    expect(verify(null, Buffer.from(`gnomon:log-genesis:v1\n${genesis}`), createPublicKey(signer.publicKeyPem), Buffer.from(w.genesisSig as string, 'base64'))).toBe(true);
    await log.close();
    await next.close();
  });
});
