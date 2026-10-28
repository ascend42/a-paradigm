/**
 * #path-containment — keep paths read from repo content inside a base folder.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve `p` (absolute, or relative to baseDir) to an existing real path
 * strictly inside baseDir, following symlinks. Returns null for anything
 * outside, for baseDir itself, and for a missing path. Use it for any path
 * that comes from repo content (a DB row, a YAML file) before reading or
 * writing it.
 */
export function resolveInsideRoot(baseDir: string, p: string): string | null {
  try {
    if (typeof p !== 'string' || p === '') return null;
    const root = fs.realpathSync(baseDir);
    const real = fs.realpathSync(path.resolve(root, p));
    const rel = path.relative(root, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return real;
  } catch {
    return null;
  }
}

export interface ContainOptions {
  /** Accept baseDir itself (a working directory). Default false. */
  allowRoot?: boolean;
  /** Accept a path that does not exist yet (a file about to be written). Default false. */
  allowMissing?: boolean;
}

/** UNC (`\\host\share`), device (`\\.\`, `\\?\`) and `//` paths: refused outright. */
export function isUncOrDevicePath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

/** Purely lexical: does `p`, resolved against baseDir, stay inside it? No filesystem access. */
export function isLexicallyInside(baseDir: string, p: string, allowRoot = false): boolean {
  const base = path.resolve(baseDir);
  const rel = path.relative(base, path.resolve(base, p));
  if (rel === '') return allowRoot;
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../') || path.isAbsolute(rel));
}

function isInside(root: string, real: string, allowRoot: boolean): boolean {
  const rel = path.relative(root, real);
  if (rel === '') return allowRoot;
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

/**
 * Like resolveInsideRoot, but for paths that may not exist yet.
 *
 * Order matters: a NUL byte, a UNC / device / `//` path, or a path that is
 * lexically outside baseDir is refused before any filesystem call (so a UNC
 * path never triggers a network lookup). Then it takes the realpath of the
 * longest existing prefix (a symlink anywhere on the way is followed), appends
 * the missing tail, and returns the result only if it is still inside the
 * real baseDir. A dangling symlink returns null.
 */
export function resolveContained(baseDir: string, p: string, opts: ContainOptions = {}): string | null {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return null;
  if (isUncOrDevicePath(p) || isUncOrDevicePath(baseDir)) return null;
  if (!isLexicallyInside(baseDir, p, opts.allowRoot)) return null;
  try {
    const root = fs.realpathSync.native(baseDir);
    let existing = path.resolve(root, path.relative(path.resolve(baseDir), path.resolve(baseDir, p)));
    const tail: string[] = [];
    for (;;) {
      try {
        fs.lstatSync(existing);
        break;
      } catch {
        if (!opts.allowMissing) return null;
        const parent = path.dirname(existing);
        if (parent === existing) return null;
        tail.unshift(path.basename(existing));
        existing = parent;
      }
    }
    // realpathSync throws on a dangling symlink, which lands in the catch below.
    const real = path.join(fs.realpathSync.native(existing), ...tail);
    return isInside(root, real, Boolean(opts.allowRoot)) ? real : null;
  } catch {
    return null;
  }
}
