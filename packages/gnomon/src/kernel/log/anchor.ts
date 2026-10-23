/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2 "Signatures and anchors", §16 "Chain anchor" row,
 * G-LOG-06) — the chain-head anchors.
 *
 * The head `{log, segment, seq, hash, at}` is written to TWO anchors: the file
 * `<home>/head` and the OS keystore item `gnomon-head` (Keychain generic
 * password on macOS / Credential Manager generic credential on Windows), the
 * latter written by the signed helper with no presence. WHEN each is written
 * (coalesced bulk cadence, forced for critical kinds, lag bounds on open) is
 * the policy in anchor-policy.ts (research 33, P8-D82).
 *
 * PR-4 ships `FileAnchorStore`. `KeystoreAnchorStore` is the SEAM for the
 * helper-backed anchor: until the helper exists (probes P04/P02, M1.3) it
 * reports `unavailable` and the log records that honestly in its open report
 * rather than pretending a second anchor exists.
 *
 * File anchor durability: written as tmp + rename (atomic: a reader sees the
 * old or the new head, never a torn one; pwrite in place is rejected, S33-05)
 * and NOT fsynced per write — on
 * macOS node's fsync is F_FULLFSYNC (~5 ms, measured), which alone would
 * blow the 5 ms p99 append budget. It is fsynced at genesis, rotation and
 * close. After a process crash the anchor may therefore LAG the db (the
 * commit's write() completed before the anchor was written); the log accepts
 * a lagging anchor only if the row at the anchor's seq has the anchor's hash
 * and the lag is within FILE_ANCHOR_MAX_LAG. After a POWER LOSS or panic an
 * anchor CAN be ahead of the db (the drive cache writes back in any order;
 * research 33 S33-10) — open reports that as INTEGRITY_BROKEN{truncated} and
 * classifies the cause from the keystore anchor's `boot` (kernel-log.ts). The
 * anchor written by a clean close carries `closed: true`; any lag behind a
 * closed anchor is INTEGRITY_BROKEN{anchor-lag} (S33-07).
 *
 * `boot` (S33-10, P8-D83): every anchor records the boot session it was
 * written in (boot.ts). Only the KEYSTORE copy (and its `closed`) is
 * authoritative for classification; the file copy is informational.
 *
 * `AnchorStore.write` may return a Promise: the helper-backed keystore store
 * (P04) talks to the helper over XPC/IPC. The log serialises keystore writes
 * so a slow write can never land after (and roll back) a newer one.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { helperOpSync, kernelWin32Helper } from '../../platform/win32/helper-client.js';

export const HEAD_SCHEMA = 'gnomonHead:v1' as const;

export interface HeadAnchor {
  schemaVersion: typeof HEAD_SCHEMA;
  log: string;
  segment: number;
  /** 0 = genesis, no row yet; `hash` is then the genesis prev. */
  seq: number;
  hash: string;
  at: string;
  /** Written only by a clean close (S33-07 clean-close marker); cleared durably on the next open. */
  closed?: true;
  /** S33-10: boot session the anchor was written in (`kern.bootsessionuuid` / `boot_id` / `unknown`). Absent on pre-D83 anchors. */
  boot?: string;
}

export type AnchorReadResult = { state: 'present'; head: HeadAnchor } | { state: 'absent' } | { state: 'unavailable'; why: string } | { state: 'malformed'; why: string };

export interface AnchorStore {
  readonly name: 'file' | 'keystore';
  read(): AnchorReadResult;
  /** `durable` = fsync before returning (genesis, rotation, close). May be async (helper IPC, P04). */
  write(head: HeadAnchor, durable: boolean): void | Promise<void>;
}

function isHead(v: unknown): v is HeadAnchor {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  return (
    h.schemaVersion === HEAD_SCHEMA &&
    typeof h.log === 'string' &&
    Number.isSafeInteger(h.segment) &&
    Number.isSafeInteger(h.seq) &&
    (h.seq as number) >= 0 &&
    typeof h.hash === 'string' &&
    typeof h.at === 'string' &&
    (h.closed === undefined || h.closed === true) &&
    (h.boot === undefined || typeof h.boot === 'string')
  );
}

export class FileAnchorStore implements AnchorStore {
  readonly name = 'file' as const;
  readonly path: string;

  constructor(home: string) {
    this.path = path.join(home, 'head');
  }

  read(): AnchorReadResult {
    let text: string;
    try {
      text = fs.readFileSync(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
      throw err;
    }
    try {
      const v: unknown = JSON.parse(text);
      return isHead(v) ? { state: 'present', head: v } : { state: 'malformed', why: 'not a gnomonHead:v1 record' };
    } catch {
      return { state: 'malformed', why: 'not JSON' };
    }
  }

  write(head: HeadAnchor, durable: boolean): void {
    const tmp = `${this.path}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(head)}\n`);
      if (durable) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (durable) {
      renameWriteThrough(tmp, this.path);
      fsyncDir(path.dirname(this.path));
    } else fs.renameSync(tmp, this.path);
  }
}

/**
 * The helper-backed keystore anchor (`gnomon-head`). SEAM ONLY in PR-4: the
 * signed helper that owns the Keychain / Credential Manager item does not
 * exist yet, so reads report `unavailable` and writes are no-ops. Never
 * falls back to a second file — a second file in the same home would add no
 * protection against a same-user rewrite (§3.2 scope statement).
 */
export class KeystoreAnchorStore implements AnchorStore {
  readonly name = 'keystore' as const;
  read(): AnchorReadResult {
    return { state: 'unavailable', why: 'helper-backed keystore anchor pending probes P04/P02 (M1.3)' };
  }
  write(): void {
    /* helper pending: nothing to write to */
  }
}

/*
 * Durable-write platform seam (T-2026-10-17-011, Gnomon CI Windows hygiene).
 * The ONE place the log decides how to fsync a PATH: every reopen-to-flush
 * in #kernel-log goes through fsyncFile / fsyncDir. (FileAnchorStore.write
 * fsyncs the handle it wrote through — opened 'w', so already writable.)
 *
 * Windows: node's fsync is FlushFileBuffers, which needs a handle opened with
 * GENERIC_WRITE — on a read-only ('r') handle it fails ERROR_ACCESS_DENIED,
 * surfaced as `EPERM: operation not permitted, fsync`. So a file is opened
 * 'r+' there (the flush itself is unchanged). A DIRECTORY cannot be opened
 * for a flush on Windows, so the directory fsync is skipped on win32 by
 * design, not swallowed. node's renameSync (MoveFileEx) does not pass
 * MOVEFILE_WRITE_THROUGH, so on win32 a rename that must be durable goes
 * through renameWriteThrough: gnomon-helper `fs.rename-durable`
 * (MoveFileExW with MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING), which
 * returns only once the rename is on disk (W3; closes the S34-27 residual for
 * the log's own renames).
 *
 * macOS / Linux: a file is opened 'r' and fsync(2)ed (unchanged), and the
 * directory is opened 'r' and fsync(2)ed so a rename inside it is durable.
 * A directory fsync the filesystem does not SUPPORT (isBenignDirFsyncError)
 * is a no-op; any other error (EIO, EACCES, ENOENT, …) is rethrown
 * (S34-28 — previously every error was swallowed).
 */
const IS_WIN32 = process.platform === 'win32';

/** fsync a file by path (Windows: an 'r+' handle, which FlushFileBuffers requires). */
export function fsyncFile(file: string): void {
  const fd = fs.openSync(file, IS_WIN32 ? 'r+' : 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Rename `from` over `to` so that, together with the caller's fsyncDir of the
 * parent(s), the rename is durable. Platform registry (G-WIN-05: no inline
 * branch): win32 asks the kernel's pinned helper for a write-through rename
 * (a failure throws, as an fsync EIO does: never a silent non-durable rename);
 * everywhere else renameSync, made durable by the caller's fsyncDir.
 */
export const RENAME_WRITE_THROUGH_TIMEOUT_MS = 3_000;

const WRITE_THROUGH_RENAMES: Readonly<Partial<Record<NodeJS.Platform, (from: string, to: string) => void>>> = Object.freeze({
  win32: (from: string, to: string): void => {
    // a short bound (Aegis W3 review): this blocks the event loop, and a rotation makes up to three of these
    helperOpSync(kernelWin32Helper(), 'fs.rename-durable', { from: path.resolve(from), to: path.resolve(to) }, RENAME_WRITE_THROUGH_TIMEOUT_MS);
  },
});

export function renameWriteThrough(from: string, to: string): void {
  (WRITE_THROUGH_RENAMES[process.platform] ?? fs.renameSync)(from, to);
}

/**
 * Errors that mean "this filesystem does not support fsync on a directory"
 * (Linux EINVAL on some FUSE/network mounts, ENOTSUP/EOPNOTSUPP, EISDIR, EBADF
 * where a read-only directory handle cannot be flushed). Only these leave
 * fsyncDir a no-op; the rename stays atomic.
 */
const BENIGN_DIR_FSYNC_CODES = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EBADF']);

/** True for an error that only says the directory fsync is unsupported (S34-28). */
export function isBenignDirFsyncError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && BENIGN_DIR_FSYNC_CODES.has(code);
}

/**
 * fsync a directory so a rename inside it is durable. Skipped on win32 (see
 * the seam note above). On POSIX an unsupported directory fsync is a no-op
 * (isBenignDirFsyncError); every other error — EIO above all — is rethrown.
 */
export function fsyncDir(dir: string): void {
  if (IS_WIN32) return;
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    if (!isBenignDirFsyncError(err)) throw err;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
