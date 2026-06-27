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
 * Library code: no console output.
 */

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

/** Run `fn` while holding the fabric lock (acquire → fn → release, always). */
export async function withFabricLock<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
  const lp = lockPath(root);
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  const deadline = Date.now() + TIMEOUT_MS;
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = fs.openSync(lp, 'wx'); // O_CREAT | O_EXCL — atomic acquire
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Held — steal if stale, else back off until the deadline.
      let stale = true;
      try {
        stale = Date.now() - fs.statSync(lp).mtimeMs > STALE_MS;
      } catch {
        stale = true; // lock vanished between open and stat → retry immediately
      }
      if (stale) {
        try {
          fs.unlinkSync(lp);
        } catch {
          /* someone else stole it — retry */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          'warpline: fabric lock timeout — another writer is holding .warpline/refs/.lock',
        );
      }
      await sleep(RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* best-effort */
    }
    try {
      fs.unlinkSync(lp);
    } catch {
      /* best-effort */
    }
  }
}
