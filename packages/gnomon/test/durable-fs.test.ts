/**
 * #kernel-log durable-write seam (src/kernel/log/anchor.ts fsyncFile /
 * fsyncDir; T-2026-10-17-011, S34-28). Unmarked: runs on every platform,
 * Windows CI included — the 'r+' reopen there must neither create a missing
 * file nor touch an existing one's bytes.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fsyncDir, fsyncFile, isBenignDirFsyncError } from '../src/kernel/log/anchor.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gnomon-dfs-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('#kernel-log fsyncFile', () => {
  it('a missing path throws ENOENT and creates nothing', () => {
    const p = path.join(tmp(), 'absent.db');
    expect(() => fsyncFile(p)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
    expect(existsSync(p)).toBe(false);
  });

  it('an existing file is flushed with its bytes unchanged', () => {
    const p = path.join(tmp(), 'seg.db');
    const bytes = Buffer.from([0, 1, 2, 0xff, 0x0d, 0x0a, 0x7f]);
    writeFileSync(p, bytes);
    fsyncFile(p);
    expect(readFileSync(p).equals(bytes)).toBe(true);
  });
});

describe('#kernel-log fsyncDir (S34-28)', () => {
  it('an existing directory flushes (or is skipped on win32) without throwing', () => {
    expect(() => fsyncDir(tmp())).not.toThrow();
  });

  it('only "unsupported" errors are benign; EIO, EACCES, ENOENT and code-less errors are rethrown', () => {
    const e = (code?: string) => Object.assign(new Error(code ?? 'x'), code ? { code } : {});
    for (const c of ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EBADF']) expect(isBenignDirFsyncError(e(c)), c).toBe(true);
    for (const c of ['EIO', 'EACCES', 'ENOENT', 'EPERM', 'ENOSPC']) expect(isBenignDirFsyncError(e(c)), c).toBe(false);
    expect(isBenignDirFsyncError(e())).toBe(false);
    expect(isBenignDirFsyncError(undefined)).toBe(false);
  });
});
