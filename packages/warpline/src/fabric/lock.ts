/**
 * #fabric-lock — a cross-process advisory lock around the fabric's read-decide-
 * write critical section. The audit (Reviewer C1, Arky) found the selvage advance
 * has NO synchronization: two `admit`/`pick`/`resolve` — and the post-commit hook
 * BACKGROUNDS its seal — can interleave readSelvage→…→writeSelvage and lose a
 * write (a strand appended that isn't the tip; two strands sharing a seq). The
 * in-process #repo-lock only guards the git<2.38 merge-tree fallback, so this
 * needs a real on-disk lock (the hook runs cross-process).
 *
 * Mechanism: an O_EXCL lockfile under .warpline/refs/.lock (atomic create =
 * acquire). Bounded retry with backoff; a stale lock (holder crashed) is stolen
 * after STALE_MS. Paired with the writeSelvage CAS as defense-in-depth.
 *
 * OWNERSHIP (M2 trust floor, item 4 — Judge): the lockfile carries an OWNER TOKEN
 * (pid + random) written at acquire. Release unlinks ONLY if the on-disk token is
 * still ours — after a steal, the old (slow) holder's release must never delete
 * the new holder's lockfile, or a third writer acquires alongside the second
 * (cascading multi-holder). The steal itself CLAIMS the stale lockfile by
 * atomically renaming it aside (exactly one stealer wins the rename; losers see
 * ENOENT and re-race the O_EXCL create) — never a blind unlink, which could
 * delete a lock a faster stealer just acquired.
 *
 * Library code: no console output.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf } from './fabric.js';

const STALE_MS = 30_000; // a held lock older than this is presumed crashed → steal
const RETRY_MS = 40;
const TIMEOUT_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function lockPath(root: string): string {
  return path.join(warplineDirOf(root), 'refs', '.lock');
}

/** An acquired fabric lock: the path + the owner token that must match to release. */
export interface FabricLockHandle {
  path: string;
  /** `<pid>:<random>` — the first token on the lockfile's first line. */
  token: string;
}

/**
 * Acquire the fabric lock (exported for tests + composition; most callers want
 * withFabricLock). Bounded retry; steals a stale lock by atomically renaming it
 * aside so exactly ONE stealer claims it.
 */
export async function acquireFabricLock(root: string): Promise<FabricLockHandle> {
  const lp = lockPath(root);
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  const token = `${process.pid}:${randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + TIMEOUT_MS;

  for (;;) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(lp, 'wx'); // O_CREAT | O_EXCL — atomic acquire
      fs.writeSync(fd, `${token} ${new Date().toISOString()}\n`);
      return { path: lp, token };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Held — steal if stale, else back off until the deadline.
      let stale = true;
      try {
        stale = Date.now() - fs.statSync(lp).mtimeMs > STALE_MS;
      } catch {
        stale = false; // lock vanished between open and stat → just re-race the create
      }
      if (stale) {
        // CLAIM the stale lockfile atomically: exactly one stealer wins this rename
        // (the losers get ENOENT and loop back to the O_EXCL create). A blind unlink
        // here could delete a DIFFERENT lock a faster stealer already re-created.
        const claimed = `${lp}.stale.${process.pid}.${randomBytes(4).toString('hex')}`;
        try {
          fs.renameSync(lp, claimed);
          fs.unlinkSync(claimed);
        } catch {
          /* someone else claimed it — re-race the create */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          'warpline: fabric lock timeout — another writer is holding .warpline/refs/.lock',
        );
      }
      await sleep(RETRY_MS);
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
}

/**
 * Release a fabric lock — unlinks ONLY when the on-disk owner token is still
 * `handle.token`. If the lock was stolen while we ran, the file now belongs to
 * the new holder and must be left alone (best-effort: a read failure means the
 * file is gone or unreadable, and we never unlink what we cannot attribute).
 */
export function releaseFabricLock(handle: FabricLockHandle): void {
  try {
    const owner = fs.readFileSync(handle.path, 'utf8').split(' ')[0]?.trim();
    if (owner !== handle.token) return; // stolen — the new holder's lock, not ours
    fs.unlinkSync(handle.path);
  } catch {
    /* best-effort — already gone, or unreadable (never unlink unattributed) */
  }
}

/** Run `fn` while holding the fabric lock (acquire → fn → release, always). */
export async function withFabricLock<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
  const handle = await acquireFabricLock(root);
  try {
    return await fn();
  } finally {
    releaseFabricLock(handle);
  }
}
