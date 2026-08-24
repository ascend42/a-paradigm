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
 * acquire). Bounded retry with backoff; a lock whose holder is presumed gone is
 * stolen. Paired with the writeSelvage CAS as defense-in-depth.
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
 * ─────────────────────────────────────────────────────────────────────────────
 * D-C (soundness audit 2026-07-31, Arky) — LIVENESS WAS A 30-SECOND WALL CLOCK.
 *
 * The mtime was stamped ONCE at acquire and staleness was `now - mtime > 30s`,
 * so a holder that merely took longer than 30 seconds was presumed crashed and
 * robbed — silently, with no notice to the victim, which is the enabling
 * condition for the two CRITICAL multi-writer findings (D-A/D-B: two writers in
 * the critical section at once, then a blind CAS). Exceeding 30s is not exotic:
 * `readFabric`, three `loadState`, `materializeMergedStateNative`,
 * `buildKnotPayload` and `restoreTree` all run INSIDE this lock, measured at
 * 1.7s for a 4,000-file CLEAN merge — so ~70k files, a laptop suspend, SIGSTOP,
 * a breakpoint, a throttled CI container or an NFS worktree all cross it.
 * *vs git:* `lockfile.c` has no timeout and no steal at all.
 *
 * The fix is a LIVENESS PREDICATE with three tiers, replacing the single clock:
 *
 *   1. HEARTBEAT — while a holder holds, an unref'd interval refreshes the
 *      lockfile's mtime every HEARTBEAT_MS, so mtime means "last seen alive",
 *      not "acquired at". The mechanism has the property that matters: the
 *      timer lives in the holder's own event loop, so a CRASHED holder stops
 *      refreshing instantly and its lock still goes stale (a written expiry
 *      timestamp would have the same property; a *sidecar daemon* refreshing on
 *      the holder's behalf would NOT, which is why it is not one).
 *
 *   2. PID LIVENESS — the heartbeat alone is NOT sufficient, and this is the
 *      part the audit's framing missed: the critical section is largely
 *      SYNCHRONOUS (`restoreTree` in warp/snapshot.ts is a sync recursive
 *      walk), and a synchronous block STARVES the timer. A heartbeat-only fix
 *      would still rob the exact holder the finding is about. So a stealer also
 *      asks whether the holder is still ALIVE: the lockfile records `<pid>` and
 *      the host, and when the host matches, `process.kill(pid, 0)` answers
 *      definitively. A provably-alive holder is NEVER robbed at the 30s tier —
 *      that is the D-C fix. A provably-DEAD holder is stolen IMMEDIATELY (no
 *      30s wait), which is strictly better crash recovery than before.
 *
 *   3. HARD CEILING — `alive` must not become `un-stealable`, or a recycled pid
 *      (crashed holder's pid reused by an unrelated process) would wedge the
 *      fabric forever. Past HARD_STALE_MS the lock is stolen regardless of
 *      liveness. A ghost lock is never refreshed, so it always clears; a real
 *      holder's heartbeat keeps mtime fresh and never trips it.
 *
 * A holder on a DIFFERENT host over a shared filesystem cannot be probed, so it
 * falls back to tier 1 + 3 alone — i.e. exactly the pre-fix predicate, now with
 * a heartbeat under it. Nothing regresses; the escape is preserved everywhere.
 *
 * THE VICTIM IS TOLD (D-C, second half). A robbed holder used to keep writing.
 * `fabricLockIsHeld` re-reads the owner token synchronously — it needs no timer
 * and therefore works even inside a blocked event loop — and `withFabricLock`
 * checks it before returning, converting silent multi-writer corruption into a
 * loud fail-closed throw. `assertFabricLockHeld` is exported so a critical
 * section may ALSO check immediately before its mutating write and refuse
 * BEFORE the bytes land, which is strictly better than detecting afterwards.
 *
 * KNOWN, NOT FIXED HERE: `restoreTree` runs inside the lock while touching only
 * the agent's private worktree, never the fabric — moving it out would shorten
 * the critical section materially. That call site is `native.ts:711`, outside
 * this module's ownership; recorded as a recommendation.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Library code: no console output.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { warplineDirOf } from './fabric.js';

/** How often a live holder refreshes the lockfile mtime ("still here"). */
export const HEARTBEAT_MS = 5_000;
/** Missed beats before a holder we cannot prove alive is presumed crashed. */
const STALE_BEATS = 6;
/**
 * No heartbeat for this long AND not provably alive → steal. Unchanged at 30s
 * from the pre-D-C constant, but the PREDICATE under it changed: it is now "six
 * missed heartbeats from a holder we cannot prove is running", not "held longer
 * than thirty seconds".
 */
export const STALE_MS = HEARTBEAT_MS * STALE_BEATS; // 30_000
/**
 * The un-wedge ceiling: no heartbeat for this long → steal even from a holder
 * that probes ALIVE. Guards against a crashed holder's pid being recycled by an
 * unrelated long-lived process, which would otherwise hold the fabric forever.
 * A real holder refreshes mtime whenever its event loop breathes, so only a
 * holder blocked synchronously for ten unbroken minutes can trip this — roughly
 * 1.4M files at the measured 4,000-files-per-1.7s restore rate.
 */
export const HARD_STALE_MS = 600_000;
const RETRY_MS = 40;
const TIMEOUT_MS = 20_000;

/** Sanitized once at load: the lockfile is whitespace-delimited. */
const HOST = os.hostname().replace(/\s+/g, '_');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function lockPath(root: string): string {
  return path.join(warplineDirOf(root), 'refs', '.lock');
}

/** An acquired fabric lock: the path + the owner token that must match to release. */
export interface FabricLockHandle {
  path: string;
  /** `<pid>:<random>` — the first token on the lockfile's first line. */
  token: string;
  /**
   * @internal The unref'd heartbeat interval. Cleared by releaseFabricLock, and
   * by the beat itself the moment it finds the lock is no longer ours.
   */
  heartbeat?: NodeJS.Timeout;
  /**
   * @internal Latched by the heartbeat when it observes the lock was stolen.
   * Advisory only — `fabricLockIsHeld` is the authoritative (timer-free) check.
   */
  stolen?: boolean;
}

/** What the lockfile's first line says about its holder. */
interface LockMeta {
  token: string;
  pid: number | null;
  host: string | null;
}

/**
 * Parse the lockfile's first line: `<pid>:<random> <iso> host=<hostname>`.
 * A lockfile written before D-C has no `host=` field → host null → unprobeable,
 * which correctly degrades to the mtime tiers rather than guessing.
 */
function readLockMeta(lp: string): LockMeta | null {
  let line: string;
  try {
    line = fs.readFileSync(lp, 'utf8').split('\n')[0] ?? '';
  } catch {
    return null; // gone or unreadable
  }
  const parts = line.trim().split(/\s+/);
  const token = parts[0] ?? '';
  if (!token) return null; // created but not yet written — NOT evidence of anything
  const pidRaw = Number.parseInt(token.split(':')[0] ?? '', 10);
  const pid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null;
  const hostField = parts.find((p) => p.startsWith('host='));
  const host = hostField ? hostField.slice('host='.length) || null : null;
  return { token, pid, host };
}

/**
 * Is the recorded holder still running? Only answerable for a holder on THIS
 * host: a pid read off a shared filesystem names a process on someone else's
 * machine, and probing it here would be a coin flip.
 *
 * `process.kill(pid, 0)` sends no signal — it only asks whether the pid exists.
 * EPERM means it exists and belongs to another user, which is still ALIVE.
 */
function holderLiveness(meta: LockMeta | null): 'alive' | 'dead' | 'unknown' {
  if (!meta || meta.pid === null || meta.host === null || meta.host !== HOST) return 'unknown';
  if (meta.pid === process.pid) return 'alive';
  try {
    process.kill(meta.pid, 0);
    return 'alive';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'alive';
  }
}

/** Age of the last heartbeat, or null when the lockfile is gone. */
function lockAgeMs(lp: string): number | null {
  try {
    return Date.now() - fs.statSync(lp).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * THE D-C LIVENESS PREDICATE — "is the recorded holder presumed gone?" — and
 * the single place the three tiers in the module header are decided. Exported
 * because it is both the test seam for a policy that is otherwise only
 * observable through a 20-second acquire timeout, and a genuine operator
 * diagnostic ("would the next writer take this lock?").
 *
 * `null` means the lockfile vanished under us: neither steal nor back off, just
 * re-race the O_EXCL create.
 */
export function lockHolderPresumedGone(lp: string): boolean | null {
  const age = lockAgeMs(lp);
  if (age === null) return null;
  if (age > HARD_STALE_MS) return true; // tier 3 — the un-wedge ceiling
  const liveness = holderLiveness(readLockMeta(lp));
  if (liveness === 'alive') return false; // tier 2 — a live holder is NEVER presumed crashed
  if (liveness === 'dead') return true; // tier 2 — provably gone: steal now, don't wait out the TTL
  return age > STALE_MS; // tier 1 — unprobeable holder: six missed heartbeats
}

/**
 * Start the heartbeat. The interval is UNREF'd so it can never keep a
 * short-lived CLI process alive, and it stops itself the instant the lock is no
 * longer ours (never refresh another holder's lockfile).
 */
function startHeartbeat(handle: FabricLockHandle): void {
  const timer = setInterval(() => {
    if (readLockMeta(handle.path)?.token !== handle.token) {
      handle.stolen = true;
      clearInterval(timer);
      return;
    }
    try {
      const now = new Date();
      fs.utimesSync(handle.path, now, now);
    } catch {
      /* best-effort — a failed touch just means this beat did not land */
    }
  }, HEARTBEAT_MS);
  timer.unref?.();
  handle.heartbeat = timer;
}

/**
 * Do we still hold this lock? A synchronous re-read of the owner token — no
 * timer involved, so it is authoritative even when the event loop is blocked by
 * the very synchronous work that starves the heartbeat.
 */
export function fabricLockIsHeld(handle: FabricLockHandle): boolean {
  return readLockMeta(handle.path)?.token === handle.token;
}

/**
 * Fail closed if this lock was stolen while we held it. Call it immediately
 * before a mutating write to refuse BEFORE the bytes land — a stolen lock plus
 * a blind CAS is what produces permanent corruption (Arky D-A/D-B).
 */
export function assertFabricLockHeld(handle: FabricLockHandle): void {
  if (fabricLockIsHeld(handle)) return;
  throw new Error(
    `warpline: fabric lock STOLEN while held — another writer presumed this holder crashed and took ${handle.path}. ` +
      `This critical section was NOT serialized; refusing to continue (fail closed).`,
  );
}

/**
 * Acquire the fabric lock (exported for tests + composition; most callers want
 * withFabricLock). Bounded retry; steals a lock whose holder is presumed gone by
 * atomically renaming it aside so exactly ONE stealer claims it.
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
      fs.writeSync(fd, `${token} ${new Date().toISOString()} host=${HOST}\n`);
      const handle: FabricLockHandle = { path: lp, token };
      startHeartbeat(handle);
      return handle;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Held — steal only if the holder is presumed gone, else back off.
      const steal = lockHolderPresumedGone(lp);
      if (steal === null) continue; // lock vanished → re-race the create
      if (steal) {
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
        // Name the holder: with a live holder now un-stealable at the 30s tier,
        // `rm` of this path is the operator's escape and they need to know WHO.
        const meta = readLockMeta(lp);
        const age = lockAgeMs(lp);
        const who = meta
          ? `held by pid ${meta.pid ?? '?'} on ${meta.host ?? 'an unknown host'}`
          : 'holder unknown';
        throw new Error(
          `warpline: fabric lock timeout — another writer is holding ${lp} ` +
            `(${who}, last heartbeat ${age === null ? '?' : Math.round(age / 1000)}s ago). ` +
            `If that holder is genuinely gone, remove the lockfile.`,
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
 * Release a fabric lock — stops the heartbeat, then unlinks ONLY when the
 * on-disk owner token is still `handle.token`. If the lock was stolen while we
 * ran, the file now belongs to the new holder and must be left alone
 * (best-effort: a read failure means the file is gone or unreadable, and we
 * never unlink what we cannot attribute).
 */
export function releaseFabricLock(handle: FabricLockHandle): void {
  if (handle.heartbeat) {
    clearInterval(handle.heartbeat);
    handle.heartbeat = undefined;
  }
  try {
    const owner = fs.readFileSync(handle.path, 'utf8').split(' ')[0]?.trim();
    if (owner !== handle.token) return; // stolen — the new holder's lock, not ours
    fs.unlinkSync(handle.path);
  } catch {
    /* best-effort — already gone, or unreadable (never unlink unattributed) */
  }
}

/**
 * Run `fn` while holding the fabric lock (acquire → fn → release, always).
 *
 * D-C: if the lock was stolen while `fn` ran, this THROWS instead of returning
 * the result. Whatever `fn` wrote was not serialized against the thief, and a
 * caller that returns success over that is exactly the silent corruption the
 * audit named. A section that wants to refuse BEFORE writing calls
 * `assertFabricLockHeld` itself.
 */
export async function withFabricLock<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
  const handle = await acquireFabricLock(root);
  try {
    const result = await fn();
    assertFabricLockHeld(handle);
    return result;
  } finally {
    releaseFabricLock(handle);
  }
}
