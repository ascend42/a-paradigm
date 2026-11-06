/**
 * #fabric-writer — the per-worktree WRITER ID (W2 findings B2, M5, I5).
 *
 * Every git worktree that seals gets 128 random bits, stored at
 * `<per-worktree git-dir>/warpline/writer-id` (created O_EXCL, so two racing
 * first seals agree on one id). The id names this worktree's own ledger ref,
 * `refs/warpline/writers/<id>`, and is written into every mirror commit's tree, so
 * the canonical branch records WHO may advance it.
 *
 * Why random and per git-dir: a linked worktree's git-dir
 * (`.git/worktrees/<name>/`) is deleted by `git worktree remove`, so re-adding a
 * worktree under the same name gets a NEW id and can never inherit (or collide
 * with) the old worktree's ref — the W1 `refComponent` name reuse is gone.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const WRITER_ID = /^[0-9a-f]{32}$/;

let linkImpl: (from: string, to: string) => void = (a, b) => fs.linkSync(a, b);
/** Test seam (final N5): replace the hard-link primitive (e.g. to simulate EPERM on a no-link filesystem). */
export function __setWriterLinkForTest(fn: ((from: string, to: string) => void) | null): void {
  linkImpl = fn ?? ((a, b) => fs.linkSync(a, b));
}

export function writerIdPath(gitDir: string): string {
  return path.join(gitDir, 'warpline', 'writer-id');
}

/** This worktree's writer id, or null when it has never sealed into a mirror. Throws on a corrupt id file. */
export function readWriterId(gitDir: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(writerIdPath(gitDir), 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (!WRITER_ID.test(raw)) {
    throw new Error(
      `warpline: writer id at ${writerIdPath(gitDir)} is malformed ("${raw.slice(0, 40)}") — refusing to guess ` +
        `which ledger ref this worktree owns.`,
    );
  }
  return raw;
}

/** Read or mint (O_EXCL) this worktree's writer id. */
export function ensureWriterId(gitDir: string): string {
  const existing = readWriterId(gitDir);
  if (existing !== null) return existing;
  const p = writerIdPath(gitDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const id = randomBytes(16).toString('hex');
  // (review 14) write a complete temp file, then LINK it into place: link is
  // atomic and fails on EEXIST, so a crash never leaves an empty writer-id and
  // two racing first seals agree on one id.
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o644);
  try {
    fs.writeSync(fd, `${id}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    try {
      linkImpl(tmp, p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // (final N5) filesystems without hard links: an O_EXCL write of the complete id
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'EOPNOTSUPP') throw err;
      const fd2 = fs.openSync(p, 'wx', 0o644);
      try {
        fs.writeSync(fd2, `${id}\n`);
        fs.fsyncSync(fd2);
      } finally {
        fs.closeSync(fd2);
      }
    }
    return id;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    for (let i = 0; i < 50; i++) {
      try {
        const won = readWriterId(gitDir);
        if (won !== null) return won;
      } catch {
        /* the winner's file is mid-link — retry */
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** The worktree's own ledger ref (never pushed). */
export function writerRef(writerId: string): string {
  return `refs/warpline/writers/${writerId}`;
}

export function isWriterId(s: string): boolean {
  return WRITER_ID.test(s);
}
