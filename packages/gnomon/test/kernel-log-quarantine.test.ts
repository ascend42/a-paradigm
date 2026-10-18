// @gnomon-platform: darwin, linux
/**
 * #kernel-log `gnomon log quarantine` (spec §19.1 release gate (a), §A.6;
 * P8-D84, P8-D89; T-2026-10-17-009(a), Aegis S34-07/08). The whole home moves
 * aside intact as evidence; the new log's genesis is the kernel-signed
 * reserved daemon.log.quarantined naming the quarantined log id and head.
 * Crash injection at every step of the move (internal test entry); refused
 * while the daemon is running; never deletes; re-quarantine of a quarantined
 * home. Every case here builds or completes a quarantined home, which records
 * the kernel pub into an owner-only `keys/` dir that #identity checks with
 * POSIX modes; on Windows owner-only is an ACL via the helper of the Windows
 * parity phase (P8-D78, spec §16), so this file is registered darwin/linux
 * (test/platform-registry.ts). The platform-independent quarantine logic
 * (the step list, the keystore tripwire, Windows-valid evidence names) runs
 * everywhere in test/kernel-log-quarantine-names.test.ts.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readKernelPubs, recordKernelPub } from '../src/kernel/identity/index.js';
import { acquireDaemonLock, DAEMON_PIDFILE_SCHEMA, pidPathOf, releaseDaemonLock } from '../src/kernel/lifecycle/index.js';
import {
  completePendingQuarantine,
  FileAnchorStore,
  KernelLog,
  KeyRing,
  LogRefusal,
  QUARANTINE_JOURNAL,
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
    expect(id).toMatchObject({ source: 'file-anchor', head: { seq: 2 } });
    const r = await quarantineLog(opts(home));
    expect(genesisRow(home).payload.quarantinedHead).toEqual(id.head);
    expect(existsSync(path.join(r.evidencePath, 'head'))).toBe(true);
  });

  it('re-quarantine of a quarantined home: the second genesis names the first successor; both evidence dirs survive', async () => {
    const { parent, home } = await fixture(1);
    const first = await quarantineLog(opts(home));
    const second = await quarantineLog(opts(home));
    expect(second.quarantined).toMatchObject({ log: first.newLogId, head: { seq: 1, hash: first.genesis.hash, segment: 1 }, source: 'db', disagree: false });
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
    expect(p).toEqual({ completed: { staging: at.staging, evidence: at.evidence, newLog: expect.any(String) }, abandoned: [], conflict: null, lockResidue: null });
    expect(genesisRow(home).payload.evidencePath).toBe(at.evidence);
    expect(verifyHome(home)).toMatchObject({ ok: true, kernelBinding: 'ok' });
    expect(completePendingQuarantine(home)).toEqual({ completed: null, abandoned: [], conflict: null, lockResidue: null });
  });

  it('crash after moved, then a re-run: it completes the interrupted quarantine and says so (no second move)', async () => {
    const { parent, home } = await fixture();
    await expect(quarantineWithSteps(opts(home), crashAt('moved'))).rejects.toThrow();
    const r = await quarantineLog(opts(home));
    expect(r).toMatchObject({ outcome: 'completed-pending', home });
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
    expect(completePendingQuarantine(home)).toEqual({ completed: null, abandoned: [], conflict: null, lockResidue: null });
  });
});

/** A crash between the two renames: evidence + verified staging, no home. */
async function crashedBetweenRenames(): Promise<{ parent: string; home: string; staging: string; evidence: string }> {
  const { parent, home } = await fixture();
  let at: { staging?: string; evidence?: string } = {};
  await expect(
    quarantineWithSteps(opts(home), (s, a) => {
      at = a;
      if (s === 'moved') throw new Error('crash');
    }),
  ).rejects.toThrow();
  return { parent, home, staging: at.staging!, evidence: at.evidence! };
}

describe('#kernel-log quarantine: the unsigned journal is checked before an install (round 2, Aegis 2)', () => {
  it('a planted staging dir whose journal names a bogus evidence ("/") is abandoned, never installed', async () => {
    const { parent, home } = await fixture(1);
    renameSync(home, path.join(parent, 'elsewhere'));
    const staging = path.join(parent, '.gnomon.quarantine-20261018T000000Z-abcdef01.new');
    mkdirSync(staging);
    writeFileSync(
      path.join(staging, QUARANTINE_JOURNAL),
      JSON.stringify({ schemaVersion: 'gnomonQuarantineJournal:v1', home, evidence: '/', staging, quarantinedLog: 'log:x', newLog: 'log:y', at: '' }),
    );
    expect(completePendingQuarantine(home)).toEqual({ completed: null, abandoned: [staging], conflict: null, lockResidue: null });
    expect(existsSync(home)).toBe(false);
  });

  it('a symlinked (junction) staging dir is abandoned', async () => {
    const c = await crashedBetweenRenames();
    const real = path.join(c.parent, 'real-staging');
    renameSync(c.staging, real);
    symlinkSync(real, c.staging, 'junction');
    expect(completePendingQuarantine(c.home)).toEqual({ completed: null, abandoned: [c.staging], conflict: null, lockResidue: null });
    expect(existsSync(c.home)).toBe(false);
  });

  it('a journal whose newLog does not match the staging genesis is abandoned', async () => {
    const c = await crashedBetweenRenames();
    const jf = path.join(c.staging, QUARANTINE_JOURNAL);
    const j = JSON.parse(readFileSync(jf, 'utf8')) as Record<string, unknown>;
    writeFileSync(jf, JSON.stringify({ ...j, newLog: 'log:01JAAAAAAAAAAAAAAAAAAAAAAA' }));
    expect(completePendingQuarantine(c.home)).toEqual({ completed: null, abandoned: [c.staging], conflict: null, lockResidue: null });
    expect(existsSync(c.home)).toBe(false);
  });

  it('a journal naming a quarantined log the evidence does not hold is abandoned', async () => {
    const c = await crashedBetweenRenames();
    const jf = path.join(c.staging, QUARANTINE_JOURNAL);
    const j = JSON.parse(readFileSync(jf, 'utf8')) as Record<string, unknown>;
    writeFileSync(jf, JSON.stringify({ ...j, quarantinedLog: 'log:01JBBBBBBBBBBBBBBBBBBBBBBB' }));
    expect(completePendingQuarantine(c.home).completed).toBeNull();
    expect(existsSync(c.home)).toBe(false);
  });
});

describe('#kernel-log quarantine: every head source, the lock, busy homes (round 2)', () => {
  it('a truncated db (file anchor ahead) quarantines the HIGHEST head; every observed head is in the journal', async () => {
    const { home } = await fixture(2);
    const fa = new FileAnchorStore(home);
    const h = (fa.read() as { head: Parameters<FileAnchorStore['write']>[0] }).head;
    const ahead = { ...h, seq: h.seq + 2, hash: `sha256:${'ab'.repeat(32)}` };
    fa.write(ahead, true);
    const id = readQuarantineIdentity(home)!;
    expect(id).toMatchObject({ source: 'file-anchor', disagree: true, head: { seq: 4, hash: ahead.hash, segment: 1 } });
    expect(id.observed.map((o) => [o.source, o.seq])).toEqual([['db', 2], ['file-anchor', 4]]);
    const r = await quarantineLog(opts(home));
    expect(genesisRow(home).payload.quarantinedHead).toEqual({ seq: 4, hash: ahead.hash, segment: 1 });
    const j = JSON.parse(readFileSync(path.join(home, QUARANTINE_JOURNAL), 'utf8')) as { observedHeads: unknown[]; evidenceName: string };
    expect(j.observedHeads).toHaveLength(2);
    expect(j.evidenceName).toBe(path.basename(r.evidencePath));
  });

  it('an unclean stop (kernel.db + -wal + -shm left behind) is read from a copy: the evidence stays byte-identical, the WAL rows count', async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-q-'));
    parents.push(parent);
    const live = path.join(parent, 'live');
    mkdirSync(live, { mode: 0o700 });
    const log = KernelLog.open({ home: live, kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate('kernel'), checkpointIdleMs: 60_000 });
    for (let i = 0; i < 3; i++) await log.append({ kind: 'session.open', principal: KP });
    const home = path.join(parent, '.gnomon');
    cpSync(live, home, { recursive: true }); // the state a killed daemon leaves
    await log.close();
    expect(existsSync(path.join(home, 'kernel.db-wal'))).toBe(true);
    const before = tree(home);
    const r = await quarantineLog(opts(home));
    expect(tree(r.evidencePath)).toEqual(before);
    expect(r).toMatchObject({ outcome: 'quarantined', quarantined: { head: { seq: 3 } } });
  });

  it('holds the daemon lock from identity read to the move, then releases it through the evidence path', async () => {
    const { home } = await fixture(1);
    const before = tree(home);
    let evidence = '';
    const r = await quarantineWithSteps(opts(home), (s, at) => {
      if (s === 'staged') {
        expect(existsSync(pidPathOf(home))).toBe(true);
        expect(() => acquireDaemonLock(home, process.pid, { socketPath: path.join(home, 'x.sock') })).toThrow(/already running/);
      }
      if (s === 'moved') {
        evidence = at.evidence!;
        expect(existsSync(pidPathOf(evidence))).toBe(false);
      }
    });
    expect(r.evidencePath).toBe(evidence);
    expect(tree(evidence)).toEqual(before);
    expect(existsSync(pidPathOf(home))).toBe(false);
  });

  it('a busy home (EPERM/EBUSY/EACCES on the move) refuses ENGINE home-busy; nothing moved, lock released, staging named', async () => {
    const { home } = await fixture(1);
    const before = tree(home);
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      const e = await refusal(
        quarantineWithSteps(opts(home), () => undefined, {
          rename: (a, b) => {
            if (a === home) throw Object.assign(new Error(code), { code });
            fs.renameSync(a, b);
          },
        }),
      );
      expect([e.refusal.code, e.reason]).toEqual(['ENGINE', 'home-busy']);
      expect(existsSync(String(e.refusal.data?.staging))).toBe(true);
      expect(tree(home)).toEqual(before);
    }
  });

  it('staging installed by another process in the gap (ENOENT on step 5) is reported installedBy another-process', async () => {
    const { home } = await fixture(1);
    const r = await quarantineWithSteps(opts(home), (s) => {
      if (s === 'moved') expect(completePendingQuarantine(home).completed).not.toBeNull(); // a daemon start
    });
    expect(r).toMatchObject({ outcome: 'quarantined', installedBy: 'another-process' });
    expect(genesisRow(home).kind).toBe('daemon.log.quarantined');
  });
});

describe('#kernel-log quarantine round 3: keystore tripwire, stale pidfile, lock residue, unreadable dbs, busy install', () => {
  it('a non-default home and an evidence dir never consult the keystore anchor', async () => {
    const { home } = await fixture(1);
    expect(readQuarantineIdentity(home)!.observed.map((o) => o.source)).not.toContain('keystore-anchor');
    const r = await quarantineLog(opts(home));
    expect(readQuarantineIdentity(r.evidencePath, { keystore: false })!.observed.map((o) => o.source)).toEqual(['db', 'file-anchor']);
  });

  it("a dead daemon's stale pidfile is deleted from the evidence by the lock, but its bytes are kept in the journal", async () => {
    const { home } = await fixture(1);
    const stale = `${JSON.stringify({ schemaVersion: DAEMON_PIDFILE_SCHEMA, pid: 2147483646, startedAt: '2026-10-18T00:00:00.000Z', socketPath: path.join(home, 'gnomon.sock') })}\n`;
    writeFileSync(pidPathOf(home), stale);
    const before = tree(home);
    const r = await quarantineLog(opts(home));
    const j = JSON.parse(readFileSync(path.join(home, QUARANTINE_JOURNAL), 'utf8')) as { stalePidfile?: string };
    expect(Buffer.from(j.stalePidfile!, 'base64').toString('utf8')).toBe(stale);
    const { [path.basename(pidPathOf(home))]: _gone, ...rest } = before;
    expect(tree(r.evidencePath)).toEqual(rest);
  });

  it('a crash between the step-4 rename and the lock release leaves our pidfile in the evidence; completePendingQuarantine reports it as lockResidue', async () => {
    const { home } = await fixture(1);
    let at: { staging?: string; evidence?: string } = {};
    let lockBytes: Buffer | undefined;
    await expect(
      quarantineWithSteps(opts(home), (s, a) => {
        if (s === 'evidence-renamed') {
          at = a;
          lockBytes = readFileSync(pidPathOf(a.evidence!));
          throw new Error('crash');
        }
      }),
    ).rejects.toThrow();
    writeFileSync(pidPathOf(at.evidence!), lockBytes!); // a real crash never ran the release
    const p = completePendingQuarantine(home);
    expect(p.completed?.staging).toBe(at.staging);
    expect(p.lockResidue).toBe(pidPathOf(at.evidence!));
    expect(existsSync(pidPathOf(at.evidence!))).toBe(true); // reported, never deleted
  });

  it('a db that cannot be copied is reported unreadable (not silently dropped); the file anchor still names the head', async () => {
    const { parent, home } = await fixture(2);
    renameSync(path.join(home, 'kernel.db'), path.join(parent, 'aside.db'));
    mkdirSync(path.join(home, 'kernel.db')); // a directory where the db should be: the copy fails
    const id = readQuarantineIdentity(home)!;
    expect(id.unreadable).toEqual([{ source: 'db', reason: expect.stringMatching(/^copy failed: E[A-Z]+$/) }]);
    expect(id).toMatchObject({ source: 'file-anchor', head: { seq: 2 } });
  });

  it('EPERM/EBUSY on the step-5 install refuses ENGINE install-busy (retry); the pending install then finishes', async () => {
    const { home } = await fixture(1);
    let staging = '';
    const e = await refusal(
      quarantineWithSteps(
        opts(home),
        (s, a) => {
          if (a.staging) staging = a.staging;
        },
        {
          rename: (a, b) => {
            if (a === staging && b === home) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
            fs.renameSync(a, b);
          },
        },
      ),
    );
    expect([e.refusal.code, e.reason]).toEqual(['ENGINE', 'install-busy']);
    expect(existsSync(home)).toBe(false);
    expect(completePendingQuarantine(home).completed?.staging).toBe(staging);
    expect(genesisRow(home).kind).toBe('daemon.log.quarantined');
  });
});
