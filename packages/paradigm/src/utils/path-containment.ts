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
