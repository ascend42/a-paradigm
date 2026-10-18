/**
 * #kernel-log `gnomon log quarantine` (spec §19.1 release gate (a), §A.6;
 * P8-D84, P8-D89; T-2026-10-17-009(a), Aegis S34-07/08). The whole home moves
 * aside intact as evidence; the new log's genesis is the kernel-signed
 * reserved daemon.log.quarantined naming the quarantined log id and head.
 * Crash injection at every step of the move (internal test entry); refused
 * while the daemon is running; never deletes; re-quarantine of a quarantined
 * home; evidence names valid on every platform. Platform-independent.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readKernelPubs, recordKernelPub } from '../src/kernel/identity/index.js';
import { acquireDaemonLock, releaseDaemonLock } from '../src/kernel/lifecycle/index.js';
import {
  completePendingQuarantine,
  evidenceNameFor,
  KernelLog,
  KeyRing,
  LogRefusal,
  QUARANTINE_JOURNAL,
  QUARANTINE_STEPS,
  quarantineLog,
  readQuarantineIdentity,
  SoftwareEd25519Signer,
  verifyLog,
  type QuarantineOptions,
  type QuarantineStep,
} from '../src/kernel/log/index.js';
import { quarantineWithSteps } from '../src/kernel/testing.js';

const KP = 'p:00000000/kernel';
const parents: string[] = [];

afterEach(() => {
  for (const p of parents.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** A home `<tmp>/.gnomon` holding a closed log with `rows` session rows. */
async function fixture(rows = 3): Promise<{ parent: string; home: string }> {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-q-'));
  parents.push(parent);
  const home = path.join(parent, '.gnomon');
  mkdirSync(home, { mode: 0o700 });
  const signer = SoftwareEd25519Signer.generate('kernel');
  recordKernelPub(home, signer.publicKeyPem); // as the daemon does, so the evidence verifies with its own keys
  const log = KernelLog.open({ home, kernelPrincipal: KP, signer, keyRing: keyRingOf(home), kernelKeyIds: [signer.keyId] });
  for (let i = 0; i < rows; i++) await log.append({ kind: 'session.open', principal: KP });
  await log.close();
  return { parent, home };
}

/** relative path → sha256 of every file under `dir` (the evidence must be byte-identical). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else out[path.relative(dir, f).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(f)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const opts = (home: string, signer = SoftwareEd25519Signer.generate('kernel')): QuarantineOptions => ({ home, signer, kernelPrincipal: KP, authorizedBy: 'interactive-confirm' });

async function refusal(p: Promise<unknown>): Promise<LogRefusal> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(LogRefusal);
  return e as LogRefusal;
}

function genesisRow(home: string): { seq: number; kind: string; principal: string; sig: string | null; payload: Record<string, unknown> } {
  const db = new DatabaseSync(path.join(home, 'kernel.db'), { readOnly: true });
  try {
    const r = db.prepare('SELECT seq, kind, principal, sig, envelope FROM chain ORDER BY seq LIMIT 1').get() as { seq: number; kind: string; principal: string; sig: string | null; envelope: string };
    return { seq: r.seq, kind: r.kind, principal: r.principal, sig: r.sig, payload: (JSON.parse(r.envelope) as { payload: Record<string, unknown> }).payload };
  } finally {
    db.close();
  }
}

function keyRingOf(home: string): KeyRing {
  const ring = new KeyRing();
  for (const k of readKernelPubs(home)) ring.addEd25519(k.publicKeyPem);
  return ring;
}

function verifyHome(home: string) {
  const ring = keyRingOf(home);
  const pubs = readKernelPubs(home);
  return verifyLog(home, { keyRing: ring, kernelPrincipal: KP, kernelKeyIds: pubs.map((k) => k.keyId) });
}

describe('#kernel-log quarantine: evidence intact, new log with a signed genesis row (T-2026-10-17-009(a))', () => {
  it('moves the whole home aside byte-identical and starts a new log whose genesis names the quarantined log id + head; it verifies', async () => {
    const { parent, home } = await fixture();
    const before = tree(home);
    const id = readQuarantineIdentity(home)!;
    expect(id).toMatchObject({ source: 'db', head: { seq: 3, segment: 1 } });
    const signer = SoftwareEd25519Signer.generate('kernel');
    const r = await quarantineLog(opts(home, signer));
    expect(path.dirname(r.evidencePath)).toBe(parent); // a sibling: same volume, atomic rename
    expect(tree(r.evidencePath)).toEqual(before); // nothing changed, nothing deleted
    expect(r.quarantined).toEqual(id);
    expect(r.newLogId).not.toBe(id.log); // a NEW log, never an in-place downgrade
    const g = genesisRow(home);
    expect(g).toMatchObject({ seq: 1, kind: 'daemon.log.quarantined', principal: KP });
    expect(g.sig).toBeTruthy();
    expect(g.payload).toEqual({ quarantinedLog: id.log, quarantinedHead: id.head, evidencePath: r.evidencePath, authorizedBy: 'interactive-confirm' });
    expect(r.genesis.seq).toBe(1);
    expect(readKernelPubs(home).map((k) => k.keyId)).toEqual([signer.keyId]);
    const v = verifyHome(home);
    expect(v).toMatchObject({ ok: true, kernelBinding: 'ok', rows: 1 });
    expect(verifyHome(r.evidencePath).ok).toBe(true); // the evidence still verifies on its own
    // the new log opens and continues; the reserved kind is never appendable
    const log = KernelLog.open({ home, kernelPrincipal: KP, signer });
    await expect(log.append({ kind: 'daemon.log.quarantined', principal: KP, payload: {} })).rejects.toMatchObject({ reason: 'reserved-kind' });
    await log.append({ kind: 'session.open', principal: KP });
    await log.close();
    expect(verifyHome(home)).toMatchObject({ ok: true, kernelBinding: 'ok', rows: 2 });
    expect(existsSync(path.join(home, QUARANTINE_JOURNAL))).toBe(true); // the journal stays as a record
  });

  it('daemon.log.quarantined is only ever a genesis row: createQuarantineSuccessor refuses an existing log, keyless refuses', async () => {
    const { home } = await fixture(1);
    const p = { quarantinedLog: 'log:x', quarantinedHead: { seq: 1, hash: 'sha256:00', segment: 1 }, evidencePath: '/e', authorizedBy: 'interactive-confirm' as const };
    const e = await refusal(KernelLog.createQuarantineSuccessor({ home, kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate() }, p));
    expect([e.refusal.code, e.reason]).toEqual(['BAD_REQUEST', 'not-genesis']);
    const k = await refusal(quarantineLog({ ...opts(home), signer: null }));
    expect([k.refusal.code, k.reason]).toEqual(['FORBIDDEN', 'kernel-key-required']);
    expect(readQuarantineIdentity(home)?.head.seq).toBe(1); // untouched
  });

  it('refuses while the daemon is running (pidfile names a live process); nothing moves', async () => {
    const { home } = await fixture(1);
    const before = tree(home);
    const pid = acquireDaemonLock(home, process.pid, { socketPath: path.join(home, 'gnomon.sock') });
    const withPid = tree(home);
    try {
      const e = await refusal(quarantineLog(opts(home)));
      expect([e.refusal.code, e.reason]).toEqual(['FORBIDDEN', 'daemon-running']);
      expect(tree(home)).toEqual(withPid);
      expect(readdirSync(path.dirname(home))).toEqual(['.gnomon']);
    } finally {
      releaseDaemonLock(home, pid);
    }
    expect(tree(home)).toEqual(before);
  });

  it('refuses a missing home and a home with no log', async () => {
    const { parent } = await fixture(0);
    expect((await refusal(quarantineLog(opts(path.join(parent, 'nope'))))).reason).toBe('not-a-home');
    const empty = path.join(parent, 'empty');
    mkdirSync(empty);
    expect((await refusal(quarantineLog(opts(empty))).then((e) => e.reason))).toBe('nothing-to-quarantine');
  });

  it('a home whose kernel.db is missing (missing-db) is quarantined from its head anchor', async () => {
    const { parent, home } = await fixture(2);
    renameSync(path.join(home, 'kernel.db'), path.join(parent, 'lost.db')); // simulate the missing db (test setup)
    const id = readQuarantineIdentity(home)!;
    expect(id).toMatchObject({ source: 'anchor', head: { seq: 2 } });
    const r = await quarantineLog(opts(home));
    expect(genesisRow(home).payload.quarantinedHead).toEqual(id.head);
    expect(existsSync(path.join(r.evidencePath, 'head'))).toBe(true);
  });

  it('re-quarantine of a quarantined home: the second genesis names the first successor; both evidence dirs survive', async () => {
    const { parent, home } = await fixture(1);
    const first = await quarantineLog(opts(home));
    const second = await quarantineLog(opts(home));
    expect(second.quarantined).toEqual({ log: first.newLogId, head: { seq: 1, hash: first.genesis.hash, segment: 1 }, source: 'db' });
    expect(second.evidencePath).not.toBe(first.evidencePath);
    expect(existsSync(first.evidencePath) && existsSync(second.evidencePath)).toBe(true);
    expect(genesisRow(second.evidencePath).payload.evidencePath).toBe(first.evidencePath);
    expect(verifyHome(second.evidencePath)).toMatchObject({ ok: true, kernelBinding: 'ok' });
    expect(verifyHome(home)).toMatchObject({ ok: true, kernelBinding: 'ok' });
    expect(readdirSync(parent).filter((n) => n.startsWith('.gnomon')).sort()).toHaveLength(3);
  });
});

describe('#kernel-log quarantine crash safety: a crash at any step leaves the old home intact, or the evidence + a complete new home', () => {
  const crashAt = (step: QuarantineStep) => (s: QuarantineStep) => {
    if (s === step) throw new Error(`crash after ${s}`);
  };

  it.each(['identity-read', 'staging-created', 'staged'] as const)('crash after %s: the old home is intact; a re-run quarantines; staging is left, never deleted', async (step) => {
    const { home } = await fixture();
    const before = tree(home);
    let staging: string | undefined;
    await expect(
      quarantineWithSteps(opts(home), (s, at) => {
        staging = at.staging ?? staging;
        crashAt(step)(s);
      }),
    ).rejects.toThrow(`crash after ${step}`);
    expect(tree(home)).toEqual(before);
    expect(readdirSync(path.dirname(home)).filter((n) => n.includes('.quarantine-') && !n.endsWith('.new'))).toEqual([]);
    const r = await quarantineLog(opts(home));
    expect(tree(r.evidencePath)).toEqual(before);
    expect(genesisRow(home).kind).toBe('daemon.log.quarantined');
    if (staging) {
      expect(r.abandoned).toEqual([staging]);
      expect(existsSync(staging)).toBe(true);
    }
  });

  it('crash after moved (between the two renames): evidence complete, staging complete; completePendingQuarantine installs it', async () => {
    const { home } = await fixture();
    const before = tree(home);
    let at: { staging?: string; evidence?: string } = {};
    await expect(
      quarantineWithSteps(opts(home), (s, a) => {
        at = a;
        crashAt('moved')(s);
      }),
    ).rejects.toThrow('crash after moved');
    expect(existsSync(home)).toBe(false);
    expect(tree(at.evidence!)).toEqual(before);
    expect(existsSync(path.join(at.staging!, QUARANTINE_JOURNAL))).toBe(true);
    const p = completePendingQuarantine(home);
    expect(p).toEqual({ completed: at.staging, abandoned: [], conflict: null });
    expect(genesisRow(home).payload.evidencePath).toBe(at.evidence);
    expect(verifyHome(home)).toMatchObject({ ok: true, kernelBinding: 'ok' });
    expect(completePendingQuarantine(home)).toEqual({ completed: null, abandoned: [], conflict: null });
  });

  it('crash after moved, then a re-run: it completes the interrupted quarantine and says so (no second move)', async () => {
    const { parent, home } = await fixture();
    await expect(quarantineWithSteps(opts(home), crashAt('moved'))).rejects.toThrow();
    const e = await refusal(quarantineLog(opts(home)));
    expect([e.refusal.code, e.reason]).toEqual(['ENGINE', 'quarantine-pending']);
    expect(genesisRow(home).kind).toBe('daemon.log.quarantined');
    expect(readdirSync(parent).filter((n) => n.includes('.quarantine-'))).toHaveLength(1);
  });

  it('a home created in the gap is a conflict: nothing is overwritten, quarantine refuses quarantine-pending', async () => {
    const { home } = await fixture();
    let at: { staging?: string; evidence?: string } = {};
    await expect(
      quarantineWithSteps(opts(home), (s, a) => {
        at = a;
        crashAt('moved')(s);
      }),
    ).rejects.toThrow();
    mkdirSync(home);
    expect(completePendingQuarantine(home)).toMatchObject({ completed: null, conflict: at.staging });
    expect((await refusal(quarantineLog(opts(home)))).reason).toBe('quarantine-pending');
    expect(existsSync(at.staging!) && existsSync(at.evidence!)).toBe(true);
  });

  it('crash after installed: the quarantine is complete', async () => {
    const { home } = await fixture();
    await expect(quarantineWithSteps(opts(home), crashAt('installed'))).rejects.toThrow();
    expect(genesisRow(home).kind).toBe('daemon.log.quarantined');
    expect(completePendingQuarantine(home)).toEqual({ completed: null, abandoned: [], conflict: null });
  });

  it('every step is covered', () => {
    expect([...QUARANTINE_STEPS]).toEqual(['identity-read', 'staging-created', 'staged', 'moved', 'installed']);
  });
});

describe('#kernel-log quarantine evidence names are valid on every platform (Windows path rules)', () => {
  it('stamp has no Windows-reserved character, no trailing dot/space; the evidence is a sibling of the home', () => {
    const n = evidenceNameFor('.gnomon', new Date('2026-10-18T01:02:03.456Z'), 'deadbeef');
    expect(n).toBe('.gnomon.quarantine-20261018T010203Z-deadbeef');
    expect(n).not.toMatch(/[<>:"/\\|?*]/);
    expect(n).not.toMatch(/[. ]$/);
    expect(evidenceNameFor('gnomon', new Date()).length).toBeLessThan(64);
    expect(() => evidenceNameFor('bad:name', new Date())).toThrow(RangeError);
    expect(() => evidenceNameFor('trailing', new Date(), 'x.')).toThrow(RangeError);
  });
});
