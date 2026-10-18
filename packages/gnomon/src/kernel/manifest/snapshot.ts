/**
 * @symbol #manifest-loader
 *
 * #manifest-loader snapshot copier + `packageHash` (spec §3.6, §4.3, §12.1,
 * §12.5, §16 "Linked mod snapshot"; S22-H6, S25-H2, S25-L4, A24-3).
 *
 * A mod NEVER runs from its source folder. Install and link copy the folder
 * into `<home>/mods/<name>/pinned/<packageHash hex>/` (owner-only, read-only
 * after the copy), and `packageHash` is computed over THE COPY:
 *
 *   packageHash = "sha256:" + hex(sha256(canonicalJson({
 *     schema: "gnomon-package-tree:v1",
 *     files: [[posixPath, sha256hex(bytes), size], …]   // sorted by path (UTF-16 code units)
 *   })))
 *
 * Exact bytes (no CRLF normalisation — what is hashed is what loads). `.git`
 * (at any depth) is skipped UNREAD (the kernel never runs git in a linked
 * folder). The copier REFUSES, before any card is raised
 * (`mod.snapshot.refused{name, reason, path}` + `manifest.refuse{code:'SNAPSHOT'}`):
 *   symlink · junction (Node's lstat reports junctions as symbolic links) ·
 *   hardlink (`nlink > 1`) · `.node` native addon · a path resolving outside
 *   the folder · a special file (fifo, socket, device) · two paths that differ
 *   only by case (they would collide on a case-insensitive filesystem).
 * Each file is opened without following links where the OS supports it and
 * re-checked by fstat (same dev/ino, still a single-link regular file), so a
 * swap between the walk and the read is refused, not followed.
 *
 * Lockfile rule (§12.5): a `node_modules/` at the package root needs an npm
 * lockfile (`package-lock.json` / `npm-shrinkwrap.json`), else
 * `manifest.refuse{code:'LOCKFILE'}`; the install card lists every
 * `package@version` from it. Other lockfile formats are refused (fail closed:
 * the card must be able to list every package without a parser dependency).
 * No postinstall anywhere: lifecycle install scripts in the package's
 * `package.json` are refused (`POSTINSTALL`).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, ulid } from '@a-company/gnomon-contracts';
import { ManifestRefusal, type ManifestEventSink } from './refusal.js';

export const PACKAGE_TREE_SCHEMA = 'gnomon-package-tree:v1' as const;
export const NPM_LOCKFILES = Object.freeze(['package-lock.json', 'npm-shrinkwrap.json']);
export const OTHER_LOCKFILES = Object.freeze(['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock']);
export const LIFECYCLE_INSTALL_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall', 'prepare']);

export type SnapshotRefusalReason = 'symlink' | 'hardlink' | 'native-addon' | 'escape' | 'special-file' | 'case-collision' | 'not-a-folder' | 'changed-during-copy';

export interface TreeFile {
  /** posix path relative to the package root */
  path: string;
  sha256: string;
  size: number;
}

export interface PackageTree {
  files: TreeFile[];
  packageHash: string;
  /** `package@version` from the npm lockfile when node_modules is present. */
  packages: string[];
  lockfile: string | null;
}

const O_NOFOLLOW: number = fs.constants.O_NOFOLLOW ?? 0;

export function computePackageHash(files: readonly TreeFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const body = canonicalJson({ schema: PACKAGE_TREE_SCHEMA, files: sorted.map((f) => [f.path, f.sha256, f.size]) });
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/** The hex part of a `sha256:<hex>` hash (the snapshot directory name). */
export function hashHex(h: string): string {
  const m = /^sha256:([0-9a-f]{64})$/.exec(h);
  if (!m) throw new TypeError(`#manifest-loader: not a sha256:<hex> hash: ${h}`);
  return m[1]!;
}

function refuseSnapshot(reason: SnapshotRefusalReason, relPath: string, name: string, emit: ManifestEventSink): never {
  emit('mod.snapshot.refused', { name, reason, path: relPath });
  emit('manifest.refuse', { name, code: 'SNAPSHOT', reason, path: relPath });
  throw new ManifestRefusal('SNAPSHOT', `snapshot copier refused ${relPath} (${reason})`, { name, snapshotReason: reason, path: relPath });
}

interface WalkEntry {
  rel: string;
  abs: string;
  stat: fs.Stats;
}

/** Walk a source folder applying every copier refusal; returns regular files only. */
function walkSource(root: string, name: string, emit: ManifestEventSink): WalkEntry[] {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(root);
    if (!fs.statSync(realRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    refuseSnapshot('not-a-folder', '.', name, emit);
  }
  const out: WalkEntry[] = [];
  const folded = new Map<string, string>();
  const visit = (dirAbs: string, dirRel: string): void => {
    const names = fs.readdirSync(dirAbs).sort();
    for (const n of names) {
      if (n === '.git') continue; // skipped unread (S25-L4)
      const abs = path.join(dirAbs, n);
      const rel = dirRel === '' ? n : `${dirRel}/${n}`;
      const key = rel.normalize('NFC').toLowerCase();
      const prior = folded.get(key);
      if (prior !== undefined) refuseSnapshot('case-collision', rel, name, emit);
      folded.set(key, rel);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) refuseSnapshot('symlink', rel, name, emit);
      if (st.isDirectory()) {
        visit(abs, rel);
        continue;
      }
      if (!st.isFile()) refuseSnapshot('special-file', rel, name, emit);
      if (st.nlink > 1) refuseSnapshot('hardlink', rel, name, emit);
      if (n.toLowerCase().endsWith('.node')) refuseSnapshot('native-addon', rel, name, emit);
      const real = fs.realpathSync.native(abs);
      const within = path.relative(realRoot, real);
      if (within === '' || within.startsWith('..') || path.isAbsolute(within)) refuseSnapshot('escape', rel, name, emit);
      out.push({ rel, abs, stat: st });
    }
  };
  visit(realRoot, '');
  return out;
}

/** Read one file once, refusing a swap since the walk (dev/ino/nlink/type re-checked by fstat). */
function readChecked(e: WalkEntry, name: string, emit: ManifestEventSink): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(e.abs, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    refuseSnapshot('changed-during-copy', e.rel, name, emit);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink > 1 || st.ino !== e.stat.ino || st.dev !== e.stat.dev) refuseSnapshot('changed-during-copy', e.rel, name, emit);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function sha256Hex(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

/** The lockfile rule and the package list (§12.5). */
function lockfileRule(files: Map<string, Buffer>, hasNodeModules: boolean, name: string, emit: ManifestEventSink): { lockfile: string | null; packages: string[] } {
  if (!hasNodeModules) return { lockfile: null, packages: [] };
  const lock = NPM_LOCKFILES.find((f) => files.has(f));
  if (!lock) {
    const other = OTHER_LOCKFILES.find((f) => files.has(f));
    emit('manifest.refuse', { name, code: 'LOCKFILE', ...(other ? { lockfile: other } : {}) });
    throw new ManifestRefusal('LOCKFILE', other ? `node_modules with ${other}: only an npm lockfile can be listed on the card` : 'node_modules without a lockfile', { name, ...(other ? { lockfile: other } : {}) });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(files.get(lock)!.toString('utf8'));
  } catch {
    emit('manifest.refuse', { name, code: 'LOCKFILE', lockfile: lock });
    throw new ManifestRefusal('LOCKFILE', `${lock} does not parse`, { name, lockfile: lock });
  }
  const pk = (parsed as { packages?: Record<string, { version?: unknown }> }).packages;
  const packages = Object.entries(pk ?? {})
    .filter(([k]) => k.startsWith('node_modules/'))
    .map(([k, v]) => `${k.slice(k.lastIndexOf('node_modules/') + 13)}@${typeof v?.version === 'string' ? v.version : '?'}`)
    .sort();
  return { lockfile: lock, packages };
}

function postinstallRule(files: Map<string, Buffer>, name: string, emit: ManifestEventSink): void {
  const pj = files.get('package.json');
  if (!pj) return;
  let scripts: unknown;
  try {
    scripts = (JSON.parse(pj.toString('utf8')) as { scripts?: unknown }).scripts;
  } catch {
    return; // not our manifest; the kernel never runs npm
  }
  if (scripts && typeof scripts === 'object') {
    const hit = LIFECYCLE_INSTALL_SCRIPTS.filter((s) => s in (scripts as Record<string, unknown>));
    if (hit.length) {
      emit('manifest.refuse', { name, code: 'POSTINSTALL', scripts: hit });
      throw new ManifestRefusal('POSTINSTALL', `package.json lifecycle install scripts are refused (${hit.join(', ')})`, { name, scripts: hit });
    }
  }
}

/** Hash a source folder in place (no copy) under the copier's refusals — the "full rehash". */
export function hashSourceTree(root: string, name: string, emit: ManifestEventSink): PackageTree & { bytes: Map<string, Buffer> } {
  const entries = walkSource(root, name, emit);
  const bytes = new Map<string, Buffer>();
  const files: TreeFile[] = [];
  for (const e of entries) {
    const b = readChecked(e, name, emit);
    bytes.set(e.rel, b);
    files.push({ path: e.rel, sha256: sha256Hex(b), size: b.length });
  }
  const hasNodeModules = entries.some((e) => e.rel.startsWith('node_modules/'));
  const { lockfile, packages } = lockfileRule(bytes, hasNodeModules, name, emit);
  postinstallRule(bytes, name, emit);
  return { files: files.sort((a, b) => (a.path < b.path ? -1 : 1)), packageHash: computePackageHash(files), packages, lockfile, bytes };
}

/** Hash a pinned snapshot directory (no refusals needed beyond a plain walk; integrity = equality). */
export function hashPinnedTree(dir: string): TreeFile[] {
  const files: TreeFile[] = [];
  const visit = (abs: string, rel: string): void => {
    for (const n of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, n);
      const r = rel === '' ? n : `${rel}/${n}`;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) visit(a, r);
      else if (st.isFile()) {
        const b = fs.readFileSync(a);
        files.push({ path: r, sha256: sha256Hex(b), size: b.length });
      } else files.push({ path: r, sha256: 'not-a-file', size: -1 }); // never matches a real hash
    }
  };
  visit(dir, '');
  return files;
}

export function modDir(home: string, name: string): string {
  return path.join(home, 'mods', name);
}
export function pinnedDir(home: string, name: string, packageHash: string): string {
  return path.join(modDir(home, name), 'pinned', hashHex(packageHash));
}

function mkdirOwner(p: string): void {
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
}

/** Make a read-only tree writable again and remove it (snapshots are 0500/0400). */
export function removeTree(p: string): void {
  if (!fs.existsSync(p)) return;
  const unlock = (a: string): void => {
    const st = fs.lstatSync(a);
    if (st.isDirectory()) {
      fs.chmodSync(a, 0o700);
      for (const n of fs.readdirSync(a)) unlock(path.join(a, n));
    } else if (st.isFile()) fs.chmodSync(a, 0o600);
  };
  unlock(p);
  fs.rmSync(p, { recursive: true, force: true });
}

export interface SnapshotResult extends PackageTree {
  dir: string;
  /** false when an identical snapshot was already pinned (content-addressed reuse). */
  created: boolean;
}

/**
 * Copy `source` into a content-addressed snapshot for mod `name`. The copy is
 * hashed after it is written (packageHash is over the copy, §12.5), then
 * renamed into `pinned/<hex>/` and made read-only.
 */
export function snapshotFolder(home: string, source: string, name: string, emit: ManifestEventSink): SnapshotResult {
  const tree = hashSourceTree(source, name, emit);
  const staging = path.join(home, 'mods', '.staging', ulid());
  mkdirOwner(staging);
  try {
    for (const f of tree.files) {
      const dst = path.join(staging, ...f.path.split('/'));
      mkdirOwner(path.dirname(dst));
      fs.writeFileSync(dst, tree.bytes.get(f.path)!, { mode: 0o600, flag: 'wx' });
    }
    const copied = hashPinnedTree(staging);
    const packageHash = computePackageHash(copied);
    if (packageHash !== tree.packageHash) refuseSnapshot('changed-during-copy', '.', name, emit);
    const dst = pinnedDir(home, name, packageHash);
    if (fs.existsSync(dst)) {
      removeTree(staging);
      return { ...strip(tree), dir: dst, created: false };
    }
    mkdirOwner(path.dirname(dst));
    for (const f of copied) fs.chmodSync(path.join(staging, ...f.path.split('/')), 0o400);
    fs.renameSync(staging, dst);
    lockDirs(dst);
    return { ...strip(tree), dir: dst, created: true };
  } catch (err) {
    removeTree(staging);
    throw err;
  }
}

function strip(t: PackageTree & { bytes?: unknown }): PackageTree {
  return { files: t.files, packageHash: t.packageHash, packages: t.packages, lockfile: t.lockfile };
}

function lockDirs(dir: string): void {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n);
    if (fs.lstatSync(a).isDirectory()) lockDirs(a);
  }
  fs.chmodSync(dir, 0o500);
}

/* ── tree diff (re-approve card, `gnomon mod diff`) ───────────────────────── */

export interface TreeDiff {
  added: Array<{ path: string; sha256: string }>;
  changed: Array<{ path: string; from: string; to: string }>;
  removed: Array<{ path: string; sha256: string }>;
}

export function diffTrees(prev: readonly TreeFile[], next: readonly TreeFile[]): TreeDiff {
  const a = new Map(prev.map((f) => [f.path, f.sha256]));
  const b = new Map(next.map((f) => [f.path, f.sha256]));
  const out: TreeDiff = { added: [], changed: [], removed: [] };
  for (const [p, h] of b) {
    const old = a.get(p);
    if (old === undefined) out.added.push({ path: p, sha256: h });
    else if (old !== h) out.changed.push({ path: p, from: old, to: h });
  }
  for (const [p, h] of a) if (!b.has(p)) out.removed.push({ path: p, sha256: h });
  const by = (x: { path: string }, y: { path: string }) => (x.path < y.path ? -1 : 1);
  out.added.sort(by);
  out.changed.sort(by);
  out.removed.sort(by);
  return out;
}
