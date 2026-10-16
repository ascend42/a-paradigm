/**
 * #brain-walk — hardened directory walk.
 *
 * - lstat only; symlinks are NEVER followed (a symlink whose realpath leaves the
 *   root is refused; one that stays inside is skipped — its target is walked anyway).
 * - hard-blocked paths are refused (never recorded) even under an allow-listed root.
 * - dot-directories (.git, .obsidian, .trash, …) and node_modules are skipped.
 * - caps: max_files (truncates, flagged).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hardBlockReason, nameZoneGate, realpathNative } from './config.js';
import { isInside } from './atomic.js';
import type { BrainGate, BrainOptions } from './types.js';

export interface WalkEntry {
  /** POSIX root-relative path. */
  relpath: string;
  abs: string;
  size: number;
  mtimeMs: number;
  ino: number;
  /** Device id — with ino, pins the exact file lstat saw (TOCTOU check at read time). */
  dev: number;
  ext: string;
}

export interface WalkResult {
  files: WalkEntry[];
  /** Root-relative directories whose name implies a sensitive zone. */
  nameZones: Array<{ folder: string; gate: BrainGate }>;
  refused: number;
  truncated: boolean;
}

const SKIP_DIRS = new Set(['node_modules']);

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function walkRoot(root: string, maxFiles: number, opts?: BrainOptions): WalkResult {
  const realRoot = realpathNative(root);
  const files: WalkEntry[] = [];
  const nameZones: Array<{ folder: string; gate: BrainGate }> = [];
  let refused = 0;
  let truncated = false;

  const stack: string[] = [realRoot];
  while (stack.length) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    names.sort();
    for (const name of names) {
      const abs = path.join(dir, name);
      if (hardBlockReason(abs, opts)) { refused++; continue; }
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        // Never follow. Count escapes as refused.
        try {
          const target = realpathNative(abs);
          if (!isInside(target, realRoot)) refused++;
        } catch {
          refused++;
        }
        continue;
      }
      const rel = toPosix(path.relative(realRoot, abs));
      if (st.isDirectory()) {
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
        const gate = nameZoneGate(name);
        if (gate) nameZones.push({ folder: rel, gate });
        stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      if (files.length >= maxFiles) { truncated = true; continue; }
      files.push({
        relpath: rel,
        abs,
        size: st.size,
        mtimeMs: st.mtimeMs,
        ino: st.ino,
        dev: st.dev,
        ext: path.extname(name).toLowerCase(),
      });
    }
  }
  files.sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
  return { files, nameZones, refused, truncated };
}

/**
 * TOCTOU-safe read: open with O_NOFOLLOW (a file swapped for a symlink after
 * the walk's lstat fails to open), fstat the fd and require the SAME inode +
 * device the walk saw, then read from that fd only. Returns 'changed' when the
 * file is no longer the one that was walked.
 */
export function readVerified(e: Pick<WalkEntry, 'abs' | 'ino' | 'dev'>, maxBytes: number): Buffer | 'changed' | 'too-large' {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = fs.openSync(e.abs, flags);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENOENT') return 'changed';
    throw err;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.ino !== e.ino || st.dev !== e.dev) return 'changed';
    if (st.size > maxBytes) return 'too-large';
    const buf = Buffer.allocUnsafe(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return off === st.size ? buf : buf.subarray(0, off);
  } finally {
    fs.closeSync(fd);
  }
}
