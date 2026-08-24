/**
 * lock-heartbeat.test — soundness audit 2026-07-31, Arky **D-C**: mutual
 * exclusion was a 30-second WALL CLOCK with no heartbeat and no notice to the
 * victim. `lock.ts` stamped the lockfile mtime ONCE at acquire and judged
 * staleness as `now - mtime > 30_000`, so a holder that merely took longer than
 * thirty seconds was presumed crashed and silently robbed — the enabling
 * condition for D-A/D-B (two writers in the critical section, then a blind CAS).
 * Everything below runs inside that lock: readFabric, three loadState,
 * materializeMergedStateNative, buildKnotPayload and a synchronous restoreTree
 * (measured 1.7s for 4,000 files).
 *
 * The fix has three tiers and a victim channel, and this file pins all four:
 *   1. HEARTBEAT — an unref'd interval refreshes mtime, so mtime means "last
 *      seen alive". A crashed process's timer stops with it.
 *   2. PID LIVENESS — a synchronous critical section STARVES that timer, so a
 *      stealer also probes `process.kill(pid, 0)` on a same-host holder. A live
 *      holder is never presumed crashed; a dead one is stolen IMMEDIATELY.
 *   3. HARD CEILING — past HARD_STALE_MS the lock is stolen regardless, so a
 *      recycled pid can never wedge the fabric forever. The escape survives.
 *   4. THE VICTIM IS TOLD — fabricLockIsHeld / assertFabricLockHeld, and
 *      withFabricLock throws rather than returning work done under a stolen
 *      lock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  acquireFabricLock,
  releaseFabricLock,
  withFabricLock,
  fabricLockIsHeld,
  assertFabricLockHeld,
  lockHolderPresumedGone,
  HEARTBEAT_MS,
  STALE_MS,
  HARD_STALE_MS,
  type FabricLockHandle,
} from '../src/fabric/lock.js';
import { warplineDirOf } from '../src/fabric/fabric.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function lockPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'refs', '.lock');
}

/** Age the lockfile as if its holder last beat `ms` ago. */
function backdate(lp: string, ms: number): void {
  const then = new Date(Date.now() - ms);
  fs.utimesSync(lp, then, then);
}

function ageMs(lp: string): number {
  return Date.now() - fs.statSync(lp).mtimeMs;
}

/** Plant a lockfile attributed to `pid` on `host`, last beat `ageMs` ago. */
function plant(root: string, pid: number, opts: { host?: string; ageMs?: number } = {}): string {
  const lp = lockPathOf(root);
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  const host = opts.host ?? os.hostname().replace(/\s+/g, '_');
  fs.writeFileSync(lp, `${pid}:cafebabe ${new Date().toISOString()} host=${host}\n`, 'utf8');
  backdate(lp, opts.ageMs ?? 0);
  return lp;
}

/** A pid that provably exited — spawnSync reaps it before it returns. */
function deadPid(): number {
  const p = spawnSync(process.execPath, ['-e', '']).pid;
  if (typeof p !== 'number') throw new Error('could not obtain a reaped pid');
  return p;
}

describe('#fabric-lock D-C — the heartbeat', () => {
  let root: string;
  let handle: FabricLockHandle | null;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-hb-'));
    handle = null;
  });
  afterEach(() => {
    if (handle) releaseFabricLock(handle);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refreshes the lockfile mtime while the holder still holds it', async () => {
    handle = await acquireFabricLock(root);
    // Pretend the holder acquired long ago — pre-fix this was a permanent,
    // un-refreshable stamp and the next writer would rob it at 30s.
    backdate(handle.path, STALE_MS + 10_000);
    expect(ageMs(handle.path)).toBeGreaterThan(STALE_MS);

    await sleep(HEARTBEAT_MS + 1_500);

    // The beat landed: mtime is "last seen alive", not "acquired at".
    expect(ageMs(handle.path)).toBeLessThan(HEARTBEAT_MS + 1_000);
    expect(handle.stolen).not.toBe(true);
  }, 20_000);

  it('runs on an UNREF’d timer — it can never hold a short-lived CLI open', async () => {
    handle = await acquireFabricLock(root);
    expect(handle.heartbeat).toBeDefined();
    // The property that makes "a crashed process stops beating" safe to rely on
    // is that the beat lives in the HOLDER's own event loop; unref keeps that
    // from turning every `warpline` invocation into a process that never exits.
    expect(handle.heartbeat!.hasRef()).toBe(false);
  });

  it('stops the instant the lock is no longer ours — never refreshes a thief’s lockfile', async () => {
    handle = await acquireFabricLock(root);
    // A thief takes the lock and is slow; our beat must not keep ITS file fresh
    // (which would extend a stranger's lease using our clock).
    fs.writeFileSync(handle.path, `999999:deadbeef ${new Date().toISOString()} host=elsewhere\n`, 'utf8');
    backdate(handle.path, STALE_MS + 10_000);

    await sleep(HEARTBEAT_MS + 1_500);

    expect(ageMs(handle.path)).toBeGreaterThan(STALE_MS);
    expect(handle.stolen).toBe(true);
  }, 20_000);

  it('release stops the heartbeat', async () => {
    const h = await acquireFabricLock(root);
    expect(h.heartbeat).toBeDefined();
    releaseFabricLock(h);
    expect(h.heartbeat).toBeUndefined();
  });
});

describe('#fabric-lock D-C — the liveness predicate (is the holder presumed gone?)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-live-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('the POLICY CONSTANTS are pinned to absolute values, not read off the source under test', () => {
    // Every other case in this describe expresses its ages RELATIVE to these
    // constants — which makes them a derived side. If a change moved STALE_MS
    // to 1ms, those tests would move with it and keep passing over a lock with
    // no protection at all. This is the authority: the numbers themselves.
    expect(HEARTBEAT_MS).toBe(5_000);
    expect(STALE_MS).toBe(30_000); // = 6 missed beats, not "held longer than 30s"
    expect(HARD_STALE_MS).toBe(600_000); // the un-wedge ceiling
    expect(STALE_MS % HEARTBEAT_MS).toBe(0); // staleness is counted in whole beats
    expect(HARD_STALE_MS).toBeGreaterThan(STALE_MS); // tier 3 is above tier 1, never below
  });

  it('a LIVE same-host holder is never presumed gone, however ancient its mtime', () => {
    // THE D-C FIX. Pre-fix this returned true at 30s and the admit was sealed
    // out from under a running holder.
    const lp = plant(root, process.pid, { ageMs: STALE_MS + 10_000 });
    expect(lockHolderPresumedGone(lp)).toBe(false);
  });

  it('a provably DEAD holder is presumed gone IMMEDIATELY — no waiting out the TTL', () => {
    const lp = plant(root, deadPid(), { ageMs: 0 });
    expect(lockHolderPresumedGone(lp)).toBe(true);
  });

  it('an unprobeable (foreign-host) holder still falls back to the mtime TTL — the escape is preserved', () => {
    const fresh = plant(root, 999_999, { host: 'some-other-box', ageMs: 1_000 });
    expect(lockHolderPresumedGone(fresh)).toBe(false);
    backdate(fresh, STALE_MS + 1_000);
    expect(lockHolderPresumedGone(fresh)).toBe(true);
  });

  it('past the HARD ceiling even a live holder is stolen — a recycled pid must not wedge the fabric', () => {
    const lp = plant(root, process.pid, { ageMs: HARD_STALE_MS + 1_000 });
    expect(lockHolderPresumedGone(lp)).toBe(true);
  });

  it('a vanished lockfile is neither steal nor back-off (null → re-race the create)', () => {
    expect(lockHolderPresumedGone(lockPathOf(root))).toBe(null);
  });

  it('cross-process: a real foreign LIVE holder is spared; the moment it dies the lock is takeable', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid!;
    const lp = plant(root, pid, { ageMs: STALE_MS + 10_000 });

    // Ancient mtime, ALIVE process, a different process than this one: spared.
    expect(lockHolderPresumedGone(lp)).toBe(false);

    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGKILL');
    await exited;
    // Give the OS a beat to reap the zombie so kill(pid,0) reports ESRCH.
    for (let i = 0; i < 40 && lockHolderPresumedGone(lp) !== true; i++) await sleep(50);

    expect(lockHolderPresumedGone(lp)).toBe(true);
    // And crash recovery is IMMEDIATE, not a 30-second wait.
    const t0 = Date.now();
    const h = await acquireFabricLock(root);
    expect(Date.now() - t0).toBeLessThan(2_000);
    releaseFabricLock(h);
  }, 20_000);
});

describe('#fabric-lock D-C — the victim is told', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-victim-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** A thief replaces the lockfile with its own token, exactly as a steal does. */
  function rob(lp: string): void {
    fs.writeFileSync(lp, `123456:th1ef ${new Date().toISOString()} host=thief\n`, 'utf8');
  }

  it('fabricLockIsHeld is true while held and false once robbed', async () => {
    const h = await acquireFabricLock(root);
    expect(fabricLockIsHeld(h)).toBe(true);
    rob(h.path);
    expect(fabricLockIsHeld(h)).toBe(false);
    releaseFabricLock(h);
  });

  it('assertFabricLockHeld is silent while held and throws STOLEN once robbed', async () => {
    const h = await acquireFabricLock(root);
    expect(() => assertFabricLockHeld(h)).not.toThrow();
    rob(h.path);
    expect(() => assertFabricLockHeld(h)).toThrow(/fabric lock STOLEN while held/);
    releaseFabricLock(h);
  });

  it('withFabricLock THROWS rather than returning work done under a stolen lock', async () => {
    // Pre-fix the victim was robbed silently and returned success over a
    // critical section that was never serialized — a stolen lock plus a blind
    // CAS is what produces permanent corruption (D-A/D-B).
    await expect(
      withFabricLock(root, () => {
        rob(lockPathOf(root));
        return 42;
      }),
    ).rejects.toThrow(/fabric lock STOLEN while held/);
  });

  it('the robbed holder’s release leaves the thief’s lockfile alone', async () => {
    const h = await acquireFabricLock(root);
    rob(h.path);
    releaseFabricLock(h);
    expect(fs.existsSync(h.path)).toBe(true);
    expect(fs.readFileSync(h.path, 'utf8').startsWith('123456:th1ef ')).toBe(true);
  });

  // ── CONTROL (non-regression, NOT a red-first case) ──────────────────────────
  it('CONTROL: an uncontended withFabricLock still returns fn’s value and clears the lockfile', async () => {
    const lp = lockPathOf(root);
    const v = await withFabricLock(root, () => {
      expect(fs.existsSync(lp)).toBe(true);
      return 'ok';
    });
    expect(v).toBe('ok');
    expect(fs.existsSync(lp)).toBe(false);
  });
});
