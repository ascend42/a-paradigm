/**
 * #warp-durable — the ONE fsync discipline for every Warpline write that a verb
 * later claims succeeded (soundness audit C-7 + C-15).
 *
 * THE PROBLEM C-7 NAMED. `tmp` + `rename` is atomic against PROCESS DEATH: a
 * reader never sees a half-written file. It is NOT durable against POWER LOSS.
 * Without an fsync on the staging fd before the rename, the rename can reach
 * stable storage while the DATA it publishes has not — the file is atomically
 * published as garbage (or zeroes). Without an fsync on the PARENT DIRECTORY
 * after the rename, the rename itself is only a page-cache fact and can be lost
 * outright. The ledger append (`appendFileSync`) had neither. So
 * `PICK sealed → exit 0` was a claim about the page cache, not about the disk;
 * git has hardened loose objects by default since 2.36 (`core.fsync`), and the
 * bar here is git-parity.
 *
 * WHAT IS COVERED (the durable write path):
 *   - the ledger append              — fabric.ts appendStrand / rewriteFabric
 *   - both tip pointers              — fabric.ts writeSelvage (legacy stateId)
 *                                      and refs.ts writeRef (refs/heads/*)
 *   - the per-agent scratch ref      — scratch.ts writeScratchRef
 *   - loose objects                  — object-store.ts writeLoose
 * Deliberately NOT covered: the worktree INDEX (`worktree-index.ts` is a
 * self-declared cache whose corrupt read simply forces a cold walk — paying
 * ~4 ms to harden a rebuildable 54 MB file is a bad trade) and the shadow /
 * grade / audit sidecars (observational telemetry; losing the last row of an
 * observation log is not a false success claim).
 *
 * ═══ THE DESIGN CALL, MADE EXPLICITLY (C-7 asked for it in writing) ═══
 *
 * 1. macOS `fsync()` vs `F_FULLFSYNC`. Apple's `fsync(2)` does not flush the
 *    DRIVE's own write cache; only `fcntl(F_FULLFSYNC)` does, at ~50-100x the
 *    cost. Git exposes the choice (`core.fsyncMethod`) rather than deciding
 *    silently. WE DO NOT GET THE CHOICE, and that is worth stating rather than
 *    implying: Node has no `fcntl` binding, and libuv's `uv__fs_fsync` on
 *    `__APPLE__` already issues `F_FULLFSYNC`, falling back to `F_BARRIERFSYNC`
 *    then plain `fsync` only when the filesystem rejects it. So on macOS
 *    `fs.fsyncSync` IS the hardware flush. Measured on the author's APFS SSD:
 *    3.66 ms for a file fsync and 3.79 ms for a directory fsync, against
 *    0.17 ms for the whole unhardened tmp+rename — i.e. the ~50x signature of
 *    F_FULLFSYNC, not the ~0.05 ms of a page-cache fsync. `fdatasyncSync`
 *    measured identically (3.80 ms), confirming libuv routes it to the same
 *    place, so there is no cheaper Node-reachable rung. THE CHOICE IS THEREFORE
 *    "hardware flush, or nothing" — hence the escape hatch below is a real knob
 *    and not a nicety.
 *
 * 2. Cost, and the escape. The cost IS material (see #4), so a `core.fsync`-style
 *    escape exists and DEFAULTS TO SAFE:
 *
 *      WARPLINE_FSYNC=all   (default, and the value used when the variable is
 *                            absent, empty, or UNRECOGNIZED — an unparseable
 *                            durability setting must fail SAFE, never silently
 *                            off)
 *      WARPLINE_FSYNC=none  every fsync in this module becomes a no-op; the
 *                            tmp+rename atomicity and the unique staging names
 *                            are UNCHANGED. For benchmarks, CI, and throwaway
 *                            fabrics.
 *
 *    It is an ENVIRONMENT variable and deliberately NOT a `.warpline/config.json`
 *    key: config.json lives INSIDE the directory this module hardens, so making
 *    the durability of `.warpline/` depend on a file in `.warpline/` inverts the
 *    bootstrap — the toggle would be less durable than the thing it governs.
 *    `setFsyncPolicy()` is the programmatic seam for a future explicit CLI flag.
 *
 * 3. What fsync does NOT buy. It does not make an APPEND atomic. A torn tail
 *    line on a full disk (audit C-13) is a separate defect and this module does
 *    not close it. The guarantee added here is exactly: WHEN A DURABLE WRITE
 *    RETURNS, ITS BYTES AND ITS DIRECTORY ENTRY ARE ON THE MEDIUM.
 *
 * 4. Measured on a realistic seal (`warpline pick`, this repo's own fabric
 *    shape) — see the numbers reported with the C-7 change. Micro-benchmark,
 *    200 iterations each, same APFS volume:
 *       tmp+rename, no fsync ............ 0.17 ms
 *       + fsync(file) ................... 3.66 ms
 *       + fsync(file) + fsync(dir) ...... 7.44 ms
 *       appendFileSync, no fsync ........ 0.05 ms
 *       append + fsync .................. 3.07 ms
 *
 * ═══ C-15: staging names are UNIQUE ═══
 *
 * `tmpNameFor` is the single source of the staging name: `<target>.tmp.<pid>.<n>`
 * — the pattern object-store.ts and stake-git.ts already used correctly, now
 * shared so a fixed `${p}.tmp` cannot reappear. A SHARED staging name defeats
 * the very CAS the ref writers publish: the CAS runs BEFORE the write, so two
 * writers that both pass it then race on one `${p}.tmp`, and A can rename B's
 * bytes into place and return SUCCESS while B's rename fails ENOENT (Arky D-B,
 * demonstrated). The staging fd is opened `wx` (O_EXCL) so even a name
 * collision refuses instead of clobbering.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The `core.fsync`-style policy: harden every covered write, or none of them. */
export type FsyncPolicy = 'all' | 'none';

/** Programmatic override; null ⇒ resolve from the environment on every call. */
let policyOverride: FsyncPolicy | null = null;

/**
 * The active policy. Read from `WARPLINE_FSYNC` on EVERY call (no caching — one
 * getenv is free next to a 3.7 ms hardware flush, and a cached policy would make
 * the escape hatch untestable and order-dependent). Anything unrecognized reads
 * as `all`: a durability toggle must fail SAFE.
 */
export function fsyncPolicy(): FsyncPolicy {
  if (policyOverride !== null) return policyOverride;
  const raw = (process.env.WARPLINE_FSYNC ?? '').trim().toLowerCase();
  if (raw === 'none' || raw === 'off' || raw === '0' || raw === 'false') return 'none';
  return 'all';
}

/**
 * Force the policy for this process (`null` restores environment resolution).
 * The seam a future `warpline --fsync=none` flag writes through; tests use it to
 * prove the escape hatch changes nothing but the fsyncs.
 */
export function setFsyncPolicy(policy: FsyncPolicy | null): void {
  policyOverride = policy;
}

let tmpSeq = 0;

/**
 * The UNIQUE staging name for `target` (C-15). Per-process-unique by pid and
 * within-process-unique by an incrementing counter, so no two writers — in this
 * process or any other — can ever stage to the same path.
 */
export function tmpNameFor(target: string): string {
  return `${target}.tmp.${process.pid}.${tmpSeq++}`;
}

/** Does `name` look like staging residue rather than a real file? (C-15 listRefs). */
export function isTmpResidue(name: string): boolean {
  return /\.tmp(\.|$)/.test(name);
}

/**
 * fsync a DIRECTORY so a rename/create inside it is itself durable — the half
 * that is usually forgotten, and without which the atomically-published file can
 * simply not be there after a power loss.
 *
 * TOLERANCE, DELIBERATELY NARROW. A blanket catch here would be the worst kind
 * of bug: durability that silently is not there. So exactly two things are
 * tolerated, and only where the platform genuinely offers nothing stronger.
 *
 *   1. OPENING the directory fails ON WINDOWS ONLY. Windows cannot open a
 *      directory as a file (EISDIR/EPERM/EACCES) and has no directory-fsync
 *      concept at all. On POSIX a directory Warpline just wrote into is
 *      openable, so an open failure there is a REAL error and PROPAGATES —
 *      including ENOENT, EACCES and EMFILE, each of which means something is
 *      wrong rather than "this platform can't".
 *   2. fsync of the directory fd returns EINVAL/ENOTSUP/ENOSYS — the documented
 *      "this filesystem does not implement fsync on a directory" answer from
 *      some network and virtual filesystems. EIO, ENOSPC, EBADF and everything
 *      else PROPAGATE: those are failures to harden, not absences of the
 *      feature, and a caller must not be told the write is durable.
 */
export function syncDir(dir: string): void {
  if (fsyncPolicy() === 'none') return;
  let fd: number;
  try {
    fd = fs.openSync(dir, 'r');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const noDirFsyncOnThisPlatform =
      process.platform === 'win32' && (code === 'EISDIR' || code === 'EPERM' || code === 'EACCES');
    if (noDirFsyncOnThisPlatform) return;
    throw err;
  }
  try {
    fs.fsyncSync(fd);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EINVAL' || code === 'ENOTSUP' || code === 'ENOSYS') return;
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}

export interface DurableWriteOptions {
  /** File mode for the staging file (default 0o666 & ~umask, i.e. node's default). */
  mode?: number;
  /**
   * fsync the parent directory after the rename (default true). Only pass false
   * where the caller hardens the directory itself once for a batch of writes.
   */
  syncParent?: boolean;
}

/**
 * Publish `data` at `target` ATOMICALLY and DURABLY: mkdir -p, write to a unique
 * `wx` staging file, fsync it, rename, fsync the parent directory. On a rename
 * failure the staging file is removed rather than left as residue.
 *
 * This is the replacement for every hand-rolled `writeFileSync(tmp); rename(tmp)`
 * in the package.
 */
export function atomicWriteSync(
  target: string,
  data: string | Buffer,
  opts: DurableWriteOptions = {},
): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = tmpNameFor(target);
  const fd = fs.openSync(tmp, 'wx', opts.mode);
  try {
    fs.writeFileSync(fd, data);
    // BEFORE the rename: otherwise the rename can be durable while the bytes are not.
    if (fsyncPolicy() === 'all') fs.fsyncSync(fd);
  } catch (err) {
    fs.closeSync(fd);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* residue cleanup is best-effort — the original failure is what matters */
    }
    throw err;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort */
    }
    throw err;
  }
  if (opts.syncParent !== false) syncDir(dir);
}

/**
 * Append `data` to `target` durably: the bytes are on the medium before this
 * returns, and the directory entry too when the append CREATED the file.
 *
 * NOT atomic — see the module header, point 3. A short write still tears the
 * tail (audit C-13); what this adds is that a RETURNED append is not merely a
 * page-cache fact.
 */
export function appendDurableSync(target: string, data: string | Buffer): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const created = !fs.existsSync(target);
  const fd = fs.openSync(target, 'a');
  try {
    fs.writeFileSync(fd, data);
    if (fsyncPolicy() === 'all') fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (created) syncDir(dir);
}
