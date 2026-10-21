/**
 * @symbol #manifest-loader
 *
 * #manifest-loader root-row write discipline (TD-2026-10-20-514, Aegis C5):
 *
 *   withHomeFileLock   a CROSS-PROCESS lock file (`<home>/<name>.lock`, O_CREAT|O_EXCL, holder pid inside) around
 *                      re-check + write + fsync + read-back of an append-only root-signed file (grants.jsonl,
 *                      voice/enrolments.jsonl). The daemon and CLI `once` writers take the same lock. A holder
 *                      whose pid is gone is a stale lock; an empty holder (being created) is live for 10 s. A stale
 *                      lock is broken by rename + inode/content re-check, never a bare delete (Aegis F1). Short critical sections only: nobody holds
 *                      it across a presence prompt (rows are signed first and re-checked under the lock).
 *   repairTornTail     inside the lock: a non-empty file whose last byte is not \n (a torn earlier append) gets a
 *                      \n first, so the next row never fuses with a partial line.
 *   beginRootDecision  ONE in-flight root decision per home (prepare → commit): a second is refused at once with
 *                      ENGINE{why: busy} and never queued. The release is idempotent and the broker calls it in a
 *                      finally.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { refuse, RefusedError } from '@a-company/gnomon-contracts';
import { ManifestRefusal } from './refusal.js';

const LOCK_WAIT_MS = 5_000;
const LOCK_STEP_MS = 20;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Aegis F1: an empty or unparsable holder is a lock being created (O_EXCL open, then its write): live this long. */
export const LOCK_UNWRITTEN_GRACE_MS = 10_000;

/** Test seams for withHomeFileLock (never set in production). */
export interface LockOptions {
  waitMs?: number;
  /** called after a lock is judged stale, before it is broken (a race test plays the other breaker here) */
  beforeBreak?: (file: string) => void;
}

function holderPid(content: string): number {
  const m = /^(\d+):[0-9a-f]+$/.exec(content) ?? /^(\d+)$/.exec(content);
  return m ? Number(m[1]) : NaN;
}

/**
 * Break a stale lock without ever deleting a live one (Aegis F1): rename it to a unique name, then confirm that what
 * was moved is the SAME file judged stale (inode + content). Anything else (another breaker removed it and a live
 * holder created a fresh one in between) is put back with a no-clobber link and left alone.
 */
function breakStale(file: string, seen: { ino: number; content: string }): void {
  const moved = `${file}.stale-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    fs.renameSync(file, moved);
  } catch {
    return; // gone already: the caller retries the open
  }
  let same = false;
  try {
    same = fs.statSync(moved).ino === seen.ino && fs.readFileSync(moved, 'utf8') === seen.content;
  } catch {
    same = false;
  }
  if (!same) {
    try {
      fs.linkSync(moved, file); // no-clobber restore of a lock that was not the stale one
    } catch {
      /* a new lock exists already: it is the one that counts */
    }
  }
  fs.rmSync(moved, { force: true });
}

/** Run `fn` holding the cross-process lock `<home>/<name>.lock`. Throws GRANT{busy} after LOCK_WAIT_MS. */
export function withHomeFileLock<T>(home: string, name: string, fn: () => T, opts: LockOptions = {}): T {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, `${name}.lock`);
  const me = `${process.pid}:${randomBytes(8).toString('hex')}`; // unique per acquisition, so release removes only its own
  const deadline = Date.now() + (opts.waitMs ?? LOCK_WAIT_MS);
  for (;;) {
    try {
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try {
        fs.writeSync(fd, me);
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let content: string;
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue; // released between open and read
      }
      const holder = holderPid(content);
      // Aegis F1: no pid yet (between the holder's O_EXCL open and its write) is LIVE until the file is old
      const stale = Number.isNaN(holder) ? Date.now() - st.mtimeMs > LOCK_UNWRITTEN_GRACE_MS : !alive(holder);
      if (stale) {
        opts.beforeBreak?.(file);
        breakStale(file, { ino: st.ino, content });
        continue;
      }
      if (Date.now() >= deadline) throw new ManifestRefusal('GRANT', `${name} is being written by another process (${Number.isNaN(holder) ? 'a lock being created' : `pid ${holder}`}); try again`, { lock: name, busy: true });
      Atomics.wait(sleeper, 0, 0, LOCK_STEP_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (fs.readFileSync(file, 'utf8') === me) fs.rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  }
}

/** Aegis C5a: the bytes to write before the next row — "\n" when the file is non-empty and does not end in one. */
export function tornTailPrefix(file: string): string {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return '';
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, size - 1);
    return b[0] === 0x0a ? '' : '\n';
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Append `lines` (each without its \n) to `file` in ONE write + fsync, repairing a torn tail first; on the file's
 * first creation the directory is fsynced too (Aegis N4, POSIX only). Call inside withHomeFileLock.
 */
export function appendLinesDurably(file: string, lines: readonly string[]): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const created = !fs.existsSync(file);
  const payload = `${tornTailPrefix(file)}${lines.map((l) => `${l}\n`).join('')}`;
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (created && process.platform !== 'win32') {
    try {
      const d = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(d);
      } finally {
        fs.closeSync(d);
      }
    } catch {
      /* best effort: the file itself is fsynced */
    }
  }
}

const inFlight = new Set<string>();

/** The one in-flight root decision of a home was taken: refused at once, never queued (Aegis C5d). */
export function rootDecisionBusy(home: string): RefusedError {
  return new RefusedError(refuse({ code: 'ENGINE', data: { reason: 'internal', why: 'busy' } }), `#manifest-loader: another root decision for this home is in flight (${path.basename(home)}); decide it first`);
}

/** Take the home's ONE in-flight root decision slot. Returns an idempotent release; throws ENGINE{why: busy}. */
export function beginRootDecision(home: string): () => void {
  const key = path.resolve(home);
  if (inFlight.has(key)) throw rootDecisionBusy(home);
  inFlight.add(key);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight.delete(key);
  };
}
