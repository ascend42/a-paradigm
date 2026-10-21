/**
 * @symbol #manifest-loader
 *
 * #manifest-loader root-row write discipline (TD-2026-10-20-514, Aegis C5):
 *
 *   withHomeFileLock   a CROSS-PROCESS lock file (`<home>/<name>.lock`, O_CREAT|O_EXCL, holder pid inside) around
 *                      re-check + write + fsync + read-back of an append-only root-signed file (grants.jsonl,
 *                      voice/enrolments.jsonl). The daemon and CLI `once` writers take the same lock. A holder
 *                      whose pid is gone is a stale lock and is broken. Short critical sections only: nobody holds
 *                      it across a presence prompt (rows are signed first and re-checked under the lock).
 *   repairTornTail     inside the lock: a non-empty file whose last byte is not \n (a torn earlier append) gets a
 *                      \n first, so the next row never fuses with a partial line.
 *   beginRootDecision  ONE in-flight root decision per home (prepare → commit): a second is refused at once with
 *                      ENGINE{why: busy} and never queued. The release is idempotent and the broker calls it in a
 *                      finally.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
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

/** Run `fn` holding the cross-process lock `<home>/<name>.lock`. Throws GRANT{busy} after LOCK_WAIT_MS. */
export function withHomeFileLock<T>(home: string, name: string, fn: () => T): T {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, `${name}.lock`);
  const me = String(process.pid);
  const deadline = Date.now() + LOCK_WAIT_MS;
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
      let holder = NaN;
      try {
        holder = Number(fs.readFileSync(file, 'utf8'));
      } catch {
        continue; // released between open and read
      }
      if (!alive(holder)) {
        fs.rmSync(file, { force: true }); // stale: its writer is gone
        continue;
      }
      if (Date.now() >= deadline) throw new ManifestRefusal('GRANT', `${name} is being written by another process (pid ${holder}); try again`, { lock: name, busy: true });
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
