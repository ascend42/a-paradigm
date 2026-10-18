/**
 * M1.12 slice 3 — `gnomon replay` (spec §2.1 G-KRN-01, §19.1 M1.12 falsifier
 * "replay diverges"): verifyLog + a deterministic fold → projection hash.
 * Platform-independent (a KernelLog in a temp home; no daemon, no socket).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Tagged } from '@a-company/gnomon-contracts';
import { foldReplay, KeyRing, replayLog, SoftwareEd25519Signer, type KernelLog } from '../src/kernel/log/index.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { runReplayCommand } from '../src/cli/replay-cli.js';

const KERNEL = kernelPrincipalOf();
const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
const homes: string[] = [];
const logs: KernelLog[] = [];
afterEach(async () => {
  for (const l of logs.splice(0)) await l.close().catch(() => undefined);
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

async function fixture(opts: { badTurn?: boolean } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'gnomon-replay-'));
  homes.push(home);
  const key = SoftwareEd25519Signer.generate('kernel');
  recordKernelPub(home, key.publicKeyPem);
  const ring = new KeyRing();
  ring.addEd25519(key.publicKeyPem);
  const log = openKernelLog({ home, kernelPrincipal: KERNEL, signer: key, keyRing: ring });
  logs.push(log);
  const text = 'write out.txt';
  await log.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { hsid: HSID } });
  await log.append({ kind: 'session.spawned', principal: KERNEL, session: HSID, payload: { hsid: HSID, phase: 'running', layersHash: sha256Tagged('layers'), gitHash: sha256Tagged('git') } });
  await log.append({ kind: 'session.inject', principal: KERNEL, session: HSID, payload: { hsid: HSID, origin: 'client', hash: sha256Tagged(text), bytes: Buffer.byteLength(text) } });
  await log.append({ kind: 'turn.sent', principal: KERNEL, session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/1`, permitId: 'pmt:1', contentHash: opts.badTurn ? sha256Tagged('other bytes') : sha256Tagged(text) } });
  await log.close();
  return { home, ring, key };
}

const opts = (f: { ring: KeyRing; key: SoftwareEd25519Signer }) => ({ keyRing: f.ring, kernelPrincipal: KERNEL, kernelKeyIds: [f.key.keyId] });
const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: { write: (s: string) => (out.push(s), true) }, stderr: { write: (s: string) => (err.push(s), true) } } };
};

describe('gnomon replay (G-KRN-01): verify, then a deterministic fold', () => {
  it('two replays of one log give the same projection hash; the fold reproduces the kernel-controlled inputs and records host hashes', async () => {
    const f = await fixture();
    const a = replayLog(f.home, opts(f));
    const b = replayLog(f.home, opts(f));
    expect(a.verify.failures).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.projectionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b.projectionHash).toBe(a.projectionHash);
    const s = a.projection!.sessions[HSID]!;
    expect(s.inputs.map((i) => i.kind)).toEqual(['session.inject', 'turn.sent']);
    expect(s.inputs[0]).toMatchObject({ origin: 'client', hash: sha256Tagged('write out.txt'), bytes: 13 });
    expect(s.host).toEqual([{ seq: expect.any(Number), kind: 'session.spawned', hashes: { gitHash: sha256Tagged('git'), layersHash: sha256Tagged('layers') } }]);
    expect(replayLog(f.home, { ...opts(f), expect: a.projectionHash! }).ok).toBe(true);
  });

  it('falsifier: a turn sent with bytes never logged is a divergence; a wrong --expect is refused; a tampered row fails verify and is never folded', async () => {
    const bad = await fixture({ badTurn: true });
    const r = replayLog(bad.home, opts(bad));
    expect(r.ok).toBe(false);
    expect(r.divergences.map((d) => d.reason)).toEqual(['input-mismatch']);

    const f = await fixture();
    expect(replayLog(f.home, { ...opts(f), expect: `sha256:${'0'.repeat(64)}` })).toMatchObject({ ok: false, expected: { matches: false } });

    // rows the trusted kernel key did not sign (the chain's triggers forbid rewriting rows in place, L1):
    // verify fails and nothing is folded
    const other = SoftwareEd25519Signer.generate('kernel');
    const ring = new KeyRing();
    ring.addEd25519(other.publicKeyPem);
    const t = replayLog(f.home, { keyRing: ring, kernelPrincipal: KERNEL, kernelKeyIds: [other.keyId] });
    expect(t.ok).toBe(false);
    expect(t.projection).toBeUndefined();
  });

  it('the fold is order- and content-sensitive (any change to a folded row moves the hash), and string inject bytes are re-hashed', () => {
    const row = (seq: number, kind: string, payload: Record<string, unknown>) => ({ seq, kind, hash: `h${seq}`, envelope: JSON.stringify({ log: 'log:x', kind, payload }) });
    const rows = [row(1, 'session.inject', { hsid: HSID, origin: 'kernel', hash: sha256Tagged('abc'), bytes: 'abc' }), row(2, 'turn.sent', { hsid: HSID, contentHash: sha256Tagged('abc') })];
    const base = foldReplay(rows);
    expect(base.divergences).toEqual([]);
    const changed = foldReplay([rows[0]!, row(2, 'turn.sent', { hsid: HSID, contentHash: sha256Tagged('abc'), turn: 't2' })]);
    expect(JSON.stringify(changed.projection)).not.toBe(JSON.stringify(base.projection));
    const lying = foldReplay([row(1, 'session.inject', { hsid: HSID, origin: 'kernel', hash: sha256Tagged('abc'), bytes: 'abd' })]);
    expect(lying.divergences.map((d) => d.reason)).toEqual(['inject-bytes-mismatch']);
  });

  it('CLI: prints the projection hash; --expect mismatch and divergence are REFUSED INTEGRITY_BROKEN with exit 1; usage errors exit 64', async () => {
    const f = await fixture();
    const ok = io();
    expect(await runReplayCommand([f.home, '--json'], ok.io)).toBe(0);
    const hash = (JSON.parse(ok.out.join('')) as { projectionHash: string }).projectionHash;
    expect(hash).toBe(replayLog(f.home, opts(f)).projectionHash);
    const same = io();
    expect(await runReplayCommand([f.home, '--expect', hash], same.io)).toBe(0);
    expect(same.out.join('')).toContain(`REPLAYED  ${hash}`);
    const wrong = io();
    expect(await runReplayCommand([f.home, '--expect', `sha256:${'1'.repeat(64)}`], wrong.io)).toBe(1);
    expect(wrong.err.join('')).toContain('REFUSED  INTEGRITY_BROKEN  replay-diverged');
    const bad = await fixture({ badTurn: true });
    const div = io();
    expect(await runReplayCommand([bad.home], div.io)).toBe(1);
    expect(div.err.join('')).toContain('replay-diverged');
    const use = io();
    expect(await runReplayCommand(['relative/home'], use.io)).toBe(64);
    expect(await runReplayCommand([f.home, '--expect', 'nope'], use.io)).toBe(64);
    // the chain is untouched by a replay (read-only)
    const db = new DatabaseSync(path.join(f.home, 'kernel.db'), { readOnly: true });
    try {
      expect((db.prepare('SELECT count(*) AS n FROM chain').get() as { n: number }).n).toBeGreaterThanOrEqual(4);
    } finally {
      db.close();
    }
  });
});
