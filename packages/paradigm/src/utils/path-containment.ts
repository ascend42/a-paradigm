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

/**
 * Like resolveInsideRoot, but for paths that may not exist yet. Resolves `p`
 * against baseDir, takes the realpath of the longest existing prefix (so a
 * symlink anywhere on the way is followed), appends the missing tail, and
 * returns the result only if it is inside baseDir. A dangling symlink, a NUL
 * byte, or anything that lands outside returns null.
 */
export function resolveContained(baseDir: string, p: string, opts: ContainOptions = {}): string | null {
  try {
    if (typeof p !== 'string' || p === '' || p.includes('\0')) return null;
    const root = fs.realpathSync(baseDir);
    let existing = path.resolve(root, p);
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
    const real = path.join(fs.realpathSync(existing), ...tail);
    const rel = path.relative(root, real);
    if (rel === '') return opts.allowRoot ? real : null;
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return real;
  } catch {
    return null;
  }
}
