/**
 * #warplined-lifecycle — exactly ONE daemon per fabric: the pidfile lock, the
 * socket path, stale-instance recovery, and the stop verb's mechanics.
 *
 *   - `.warpline/daemon.sock`  — the UNIX domain socket (mode 0600)
 *   - `.warpline/daemon.pid`   — {pid, startedAt, socketPath}, created O_EXCL
 *
 * Single-instance rule: the pidfile is the lock. Acquisition is an atomic
 * O_EXCL create; on EEXIST the holder's pid is probed (`kill(pid, 0)`) — a live
 * holder refuses the new start, a dead holder (crash residue) is cleaned up
 * (pidfile + stale socket unlinked) and the create re-raced. A stale SOCKET
 * with no pidfile (crash between unlinks) is likewise removed before listen.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { warplineDirOf } from '../fabric/fabric.js';

export const DAEMON_PIDFILE_SCHEMA = 'daemonPid:v1' as const;

export interface DaemonPidfile {
  schemaVersion: typeof DAEMON_PIDFILE_SCHEMA;
  pid: number;
  startedAt: string;
  socketPath: string;
}

/** sun_path is ~104 bytes on macOS (108 on Linux) — a socket path beyond this
 * fails to bind. Deep monorepo roots overflow it easily. */
const SUN_PATH_SAFE = 100;

/**
 * The daemon socket for a fabric. Default `.warpline/daemon.sock` under the
 * root; when that would overflow the OS socket-path limit, a deterministic
 * per-root socket in os.tmpdir() (`warplined-<sha256(root)[0..16]>.sock`) is
 * used instead — every side (server, client, status, stop) derives the SAME
 * path from the root, and the pidfile records it besides.
 */
export function socketPathOf(root: string): string {
  const preferred = path.join(warplineDirOf(root), 'daemon.sock');
  if (Buffer.byteLength(preferred, 'utf8') <= SUN_PATH_SAFE) return preferred;
  const key = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `warplined-${key}.sock`);
}

export function pidPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'daemon.pid');
}

export function readPidfile(root: string): DaemonPidfile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pidPathOf(root), 'utf8')) as DaemonPidfile;
    if (parsed && typeof parsed.pid === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Is a pid alive (signal 0 probe)? EPERM counts as alive — someone owns it. */
export function pidAlive(pid: number): boolean {
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

/** Lifecycle view: running (live pid), stale (dead pid residue or an orphaned
 * socket), or stopped (nothing on disk). */
export function daemonState(root: string): DaemonState {
  const pf = readPidfile(root);
  if (pf) return pidAlive(pf.pid) ? { state: 'running', pidfile: pf } : { state: 'stale', pidfile: pf };
  // No pidfile — an existing socket is crash residue (or an unrelated file).
  if (fs.existsSync(socketPathOf(root))) return { state: 'stale', pidfile: null };
  return { state: 'stopped' };
}

/**
 * Acquire the single-instance lock: O_EXCL-create the pidfile for `pid`.
 * A live holder throws; dead residue (pidfile with a dead pid, or an orphaned
 * socket) is cleaned and the create re-raced. Returns the socket path to bind.
 */
export function acquireDaemonLock(root: string, pid: number, opts: { socketPath?: string; now?: string } = {}): string {
  const sock = opts.socketPath ?? socketPathOf(root);
  const pp = pidPathOf(root);
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const row: DaemonPidfile = {
      schemaVersion: DAEMON_PIDFILE_SCHEMA,
      pid,
      startedAt: opts.now ?? new Date().toISOString(),
      socketPath: sock,
    };
    let fd: number | null = null;
    try {
      fd = fs.openSync(pp, 'wx'); // O_CREAT | O_EXCL — atomic acquire
      fs.writeSync(fd, JSON.stringify(row) + '\n');
      // Won the lock — clear any orphaned socket left by a crashed predecessor
      // (it lost its pidfile first, so reaching here means no live holder).
      try {
        fs.unlinkSync(sock);
      } catch {
        /* none — the common case */
      }
      return sock;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const holder = readPidfile(root);
      if (holder && pidAlive(holder.pid)) {
        throw new Error(
          `warpline: daemon already running (pid ${holder.pid}, socket ${holder.socketPath}) — exactly one daemon per fabric`,
        );
      }
      // Dead holder (or unreadable residue): clean and re-race.
      try {
        fs.unlinkSync(pp);
      } catch {
        /* a racer already cleaned it */
      }
      if (holder?.socketPath) {
        try {
          fs.unlinkSync(holder.socketPath);
        } catch {
          /* already gone */
        }
      }
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* best-effort */
        }
      }
    }
  }
  throw new Error('warpline: daemon lock — could not acquire the pidfile (persistent race)');
}

/** Release the lock — unlinks pidfile + socket, ONLY if the pidfile is ours. */
export function releaseDaemonLock(root: string, pid: number): void {
  const pf = readPidfile(root);
  if (pf && pf.pid !== pid) return; // not ours — a newer daemon owns it
  try {
    fs.unlinkSync(pidPathOf(root));
  } catch {
    /* already gone */
  }
  const sock = pf?.socketPath ?? socketPathOf(root);
  try {
    fs.unlinkSync(sock);
  } catch {
    /* already gone */
  }
}

/**
 * Stop the daemon for `root`: SIGTERM the pidfile holder and wait for the
 * pidfile to disappear (the daemon's clean-shutdown path unlinks it). Dead
 * residue is cleaned inline. Returns what happened.
 */
export async function stopDaemon(
  root: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ stopped: boolean; reason: string; pid?: number }> {
  const st = daemonState(root);
  if (st.state === 'stopped') return { stopped: false, reason: 'not running' };
  if (st.state === 'stale') {
    releaseDaemonLock(root, st.pidfile?.pid ?? -1);
    return { stopped: false, reason: 'stale residue cleaned (daemon was not running)', ...(st.pidfile ? { pid: st.pidfile.pid } : {}) };
  }
  const pid = st.pidfile.pid;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    releaseDaemonLock(root, pid);
    return { stopped: false, reason: 'holder vanished before SIGTERM — residue cleaned', pid };
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  while (Date.now() < deadline) {
    if (!readPidfile(root) || !pidAlive(pid)) {
      if (readPidfile(root)?.pid === pid) releaseDaemonLock(root, pid); // died without cleanup
      return { stopped: true, reason: 'terminated', pid };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { stopped: false, reason: `pid ${pid} did not exit within ${opts.timeoutMs ?? 5000}ms (still running)`, pid };
}
