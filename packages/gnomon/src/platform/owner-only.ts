/**
 * @symbol #gnomon-kernel
 *
 * Owner-only, per platform (spec §16 "Home dir + modes", G-WIN-02).
 *
 *   POSIX  a directory is 0700 and a file 0600 (mode & 0o077 === 0), owned by our uid — read back after chmod.
 *   win32  file modes mean nothing (lstat reports 0o666; chmod toggles the read-only bit only). The helper applies
 *          a PROTECTED owner-only DACL (`D:P(A;OICI;FA;;;<user SID>)`, inheritance from the parent removed) and the
 *          kernel accepts it only from the read-back. Everything created below a verified root inherits that ACE,
 *          so a path inside a verified root is owner-only without a helper round trip per file (a same-user
 *          process could re-ACL it, as it could chmod on POSIX: the threat boundary is the OS user, §15.1). A path
 *          outside every verified root is read back through the helper (`acl.read`).
 *
 * The verified roots are per process and are only ever added by ownerOnlyDir after a successful read-back.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { currentUid } from '../kernel/lifecycle/home.js';
import { helperOpSync, kernelWin32Helper, type Win32HelperPin } from './win32/helper-client.js';

const IS_WIN = process.platform === 'win32';
const verifiedRoots = new Set<string>();

const fold = (p: string): string => (IS_WIN ? p.toLowerCase() : p);

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function underVerifiedRoot(p: string): boolean {
  const real = fold(realOrSelf(p));
  for (const r of verifiedRoots) {
    const root = fold(r);
    if (real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return true;
  }
  return false;
}

export class OwnerOnlyError extends Error {
  constructor(
    readonly target: string,
    message: string,
  ) {
    super(message);
    this.name = 'OwnerOnlyError';
  }
}

/** Test seam: the helper the win32 branch uses (default: the kernel's pinned helper). */
let helperForTests: Win32HelperPin | null = null;
export function setOwnerOnlyHelperForTests(pin: Win32HelperPin | null): void {
  helperForTests = pin;
}
const helper = (): Win32HelperPin => helperForTests ?? kernelWin32Helper();

/**
 * Make `dir` owner-only and READ IT BACK; on win32 it becomes a verified root (everything below inherits).
 * Throws OwnerOnlyError when the read-back is not owner-only.
 */
export function ownerOnlyDir(dir: string): void {
  if (!IS_WIN) {
    if ((fs.lstatSync(dir).mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
    const st = fs.lstatSync(dir);
    if ((st.mode & 0o777) !== 0o700) throw new OwnerOnlyError(dir, `${dir} mode ${(st.mode & 0o777).toString(8)} is not 700`);
    return;
  }
  const real = fs.realpathSync.native(dir);
  const r = helperOpSync(helper(), 'acl.owner-only', { path: real, kind: 'dir' });
  if (r.ownerOnly !== true) throw new OwnerOnlyError(dir, `${dir} DACL read back is not owner-only (${String(r.sddl ?? '?')})`);
  verifiedRoots.add(real);
}

/**
 * Is `p` owner-only? (`st` is the caller's lstat, so POSIX callers keep one stat.) Never throws for a readable path.
 * `strict` (key and identity material, Aegis M3): on win32 the DACL is ALWAYS read back for this very file, never
 * inferred from a verified root (a hard link, a file renamed in with its own DACL, an explicit or protected child
 * keep their DACL), and a file with more than one link is refused on every platform.
 */
export function isOwnerOnly(p: string, st: fs.Stats = fs.lstatSync(p), o: { strict?: boolean } = {}): boolean {
  if (o.strict && st.isFile() && st.nlink > 1) return false;
  if (!IS_WIN) {
    const uid = currentUid();
    return (uid === null || st.uid === uid) && (st.mode & 0o077) === 0;
  }
  if (!o.strict && underVerifiedRoot(p)) return true;
  try {
    return helperOpSync(helper(), 'acl.read', { path: realOrSelf(p) }).ownerOnly === true;
  } catch {
    return false;
  }
}

/** Make a file owner-only: chmod 0600 on POSIX; on win32 a no-op inside a verified root, else the helper's DACL. */
export function ownerOnlyFile(file: string): void {
  if (!IS_WIN) {
    fs.chmodSync(file, 0o600);
    return;
  }
  if (underVerifiedRoot(file)) return;
  const r = helperOpSync(helper(), 'acl.owner-only', { path: fs.realpathSync.native(file), kind: 'file' });
  if (r.ownerOnly !== true) throw new OwnerOnlyError(file, `${file} DACL read back is not owner-only`);
}

/** How a mode-style refusal reads per platform ("mode 644" on POSIX, "DACL" on win32). */
export function ownerOnlyWhat(st: fs.Stats): string {
  return IS_WIN ? 'DACL' : `mode ${(st.mode & 0o777).toString(8)}`;
}

/** Test seam. */
export function clearVerifiedRootsForTests(): void {
  verifiedRoots.clear();
}
