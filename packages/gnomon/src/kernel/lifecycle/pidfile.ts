/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 1, G-DMN-01) — one daemon per user.
 *
 * `<home>/gnomon.pid` holds `daemonPid:v1 {pid, startedAt, socketPath}` and is
 * created O_EXCL: that create IS the lock. On EEXIST the holder is probed with
 * signal 0 — a live holder refuses, a dead holder is cleaned and the create
 * re-raced. Lifted (copied, never imported) from
 * packages/warpline/src/daemon/lifecycle.ts:1-14 and its acquire/release, with
 * two hardenings over the original:
 *   - a pidfile that exists but has no content yet is a racer mid-write, not
 *     residue: wait for its content before judging it;
 *   - stale residue is removed by rename-then-verify-inode, so a racer that
 *     already reclaimed the lock never has its fresh pidfile unlinked by us.
 * The pid is a diagnostic, never a security claim (the pidfile is same-user
 * writable, S29-K6).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LifecycleRefusal } from './refusal.js';

export const DAEMON_PIDFILE_SCHEMA = 'daemonPid:v1' as const;
export const PIDFILE_NAME = 'gnomon.pid';

export interface DaemonPidfile {
  schemaVersion: typeof DAEMON_PIDFILE_SCHEMA;
  pid: number;
  startedAt: string;
  socketPath: string;
}

const ACQUIRE_ATTEMPTS = 5;
/** How long an empty pidfile is given to receive its content (a racer mid-write). */
const EMPTY_GRACE_MS = 1000;
const POLL_MS = 25;

export function pidPathOf(home: string): string {
  return path.join(home, PIDFILE_NAME);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type PidRead = { kind: 'missing' } | { kind: 'empty' } | { kind: 'invalid' } | { kind: 'ok'; pidfile: DaemonPidfile };

function readPidPath(pp: string): PidRead {
  let raw: string;
  try {
    raw = fs.readFileSync(pp, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'invalid' };
  }
  if (raw.length === 0) return { kind: 'empty' };
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonPidfile>;
    if (
      parsed &&
      parsed.schemaVersion === DAEMON_PIDFILE_SCHEMA &&
      Number.isInteger(parsed.pid) &&
      (parsed.pid as number) > 0 &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.socketPath === 'string'
    ) {
      return { kind: 'ok', pidfile: parsed as DaemonPidfile };
    }
  } catch {
    /* fall through */
  }
  return { kind: 'invalid' };
}

export function readPidfile(home: string): DaemonPidfile | null {
  const r = readPidPath(pidPathOf(home));
  return r.kind === 'ok' ? r.pidfile : null;
}

/** Is a pid alive (signal 0 probe)? EPERM counts as alive — someone owns it. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type DaemonState =
  | { state: 'running'; pidfile: DaemonPidfile }
  | { state: 'stale'; pidfile: DaemonPidfile | null }
  | { state: 'stopped' };

/** Lifecycle view from disk: running (live pid), stale (residue) or stopped. */
export function daemonState(home: string, socketPath?: string): DaemonState {
  const r = readPidPath(pidPathOf(home));
  if (r.kind === 'ok') return pidAlive(r.pidfile.pid) ? { state: 'running', pidfile: r.pidfile } : { state: 'stale', pidfile: r.pidfile };
  if (r.kind !== 'missing') return { state: 'stale', pidfile: null };
  if (socketPath && fs.existsSync(socketPath)) return { state: 'stale', pidfile: null };
  return { state: 'stopped' };
}

/*
 * The socket is NOT touched here (T-2026-10-19-009 item 2): a stale socket is
 * reclaimed by #socket's listenSocket only after a connect probe proves its
 * holder dead (ECONNREFUSED; a timeout or EPERM declines), and the public name
 * is removed only by the owning server's close(). The old unlinkStaleSocket
 * deleted on "can't tell", and releaseDaemonLock unlinked the socket AFTER the
 * pidfile, so a successor that won the lock in between lost its socket.
 */

/** Remove the judged-dead pidfile only if it is still the same inode we judged. */
function removeIfSameInode(pp: string, ino: number): void {
  const aside = `${pp}.stale.${process.pid}.${Date.now()}`;
  try {
    fs.renameSync(pp, aside);
  } catch {
    return; // a racer already moved it
  }
  let movedIno = -1;
  try {
    movedIno = fs.lstatSync(aside).ino;
  } catch {
    return;
  }
  if (movedIno === ino) {
    try {
      fs.unlinkSync(aside);
    } catch {
      /* best-effort */
    }
    return;
  }
  // We moved a racer's FRESH pidfile: put it back (link fails if yet another racer won).
  try {
    fs.linkSync(aside, pp);
  } catch {
    /* another holder exists; the next attempt will see it */
  }
  try {
    fs.unlinkSync(aside);
  } catch {
    /* best-effort */
  }
}

export interface AcquireOptions {
  socketPath: string;
  now?: () => string;
}

/**
 * Acquire the single-instance lock for `pid`. Returns the pidfile written.
 * Throws LifecycleRefusal('already-running') for a live holder and
 * ('lock-race') if the create keeps losing.
 */
export function acquireDaemonLock(home: string, pid: number, opts: AcquireOptions): DaemonPidfile {
  const pp = pidPathOf(home);
  const now = opts.now ?? (() => new Date().toISOString());
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
    const row: DaemonPidfile = { schemaVersion: DAEMON_PIDFILE_SCHEMA, pid, startedAt: now(), socketPath: opts.socketPath };
    let fd: number | null = null;
    try {
      fd = fs.openSync(pp, 'wx', 0o600); // O_CREAT | O_EXCL — the atomic acquire
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (fd !== null) {
      try {
        fs.writeSync(fd, `${JSON.stringify(row)}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      // Won. A socket left by a crashed predecessor is reclaimed by listenSocket after a connect probe proves it dead.
      return row;
    }

    // EEXIST: judge the holder. An empty file is a racer mid-write — wait for it.
    let ino: number;
    try {
      ino = fs.lstatSync(pp).ino;
    } catch {
      continue; // vanished between create and stat — re-race
    }
    let read = readPidPath(pp);
    const deadline = Date.now() + EMPTY_GRACE_MS;
    while (read.kind === 'empty' && Date.now() < deadline) {
      sleepSync(POLL_MS);
      read = readPidPath(pp);
    }
    if (read.kind === 'missing') continue;
    if (read.kind === 'ok' && pidAlive(read.pidfile.pid)) {
      throw new LifecycleRefusal(
        'already-running',
        `daemon already running (pid ${read.pidfile.pid}); exactly one per user`,
        { pid: read.pidfile.pid, startedAt: read.pidfile.startedAt },
      );
    }
    // Dead holder or unreadable residue: clean (inode-checked) and re-race.
    removeIfSameInode(pp, ino);
  }
  throw new LifecycleRefusal('lock-race', 'could not acquire the pidfile (persistent race)');
}

/** Release the lock — unlinks the pidfile ONLY if it is ours. The socket is the server's (its close() removes only its own inode). */
export function releaseDaemonLock(home: string, owner: Pick<DaemonPidfile, 'pid' | 'startedAt' | 'socketPath'>): boolean {
  const pf = readPidfile(home);
  if (!pf || pf.pid !== owner.pid || pf.startedAt !== owner.startedAt) return false;
  try {
    fs.unlinkSync(pidPathOf(home));
  } catch {
    /* already gone */
  }
  return true;
}
