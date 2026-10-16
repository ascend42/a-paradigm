/**
 * #brain-atomic — tiny local atomic-write helper (no warpline dependency).
 * Write to a sibling temp file, fsync, rename. Mode 0o600 (owner-only).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export function atomicWriteFileSync(target: string, data: string | Buffer): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * darwin (APFS/HFS+ default) and win32 filesystems are case-insensitive and
 * normalization-insensitive: `~/library`, `~/Library` and an NFD-spelled path
 * all name the same directory. Every security comparison folds on those
 * platforms so a differently-spelled path cannot slip past a hard-block.
 */
export const FOLD_PATHS = process.platform === 'darwin' || process.platform === 'win32';

/** Canonical form for path COMPARISON (never for I/O): NFC, and lowercased where the FS folds case. */
export function foldPath(p: string, fold: boolean = FOLD_PATHS): string {
  const n = p.normalize('NFC');
  return fold ? n.toLowerCase() : n;
}

/** True when `child` is `parent` or inside it (both absolute, resolved). Case/NFC-folded on darwin/win32. */
export function isInside(child: string, parent: string, fold: boolean = FOLD_PATHS): boolean {
  const rel = path.relative(foldPath(parent, fold), foldPath(child, fold));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
