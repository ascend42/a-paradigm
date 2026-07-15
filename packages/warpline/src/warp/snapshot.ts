/**
 * #warp-store (M1a) — SNAPSHOT: walk a directory, write every blob + tree to the
 * native object store, and return the root `treeId` (byte identity) plus the
 * shadow git-sha1 OID (native-object-store-design.md §1.5, §2.4, §4).
 *
 * Byte-faithful and git-parity in ONE filesystem walk:
 *   - regular file → 100644, or 100755 when any exec bit is set
 *   - symlink      → 120000; the blob bytes ARE the link target (git's convention)
 *   - directory    → 40000 subtree, recursed; EMPTY dirs are omitted (git parity)
 *   - .git / .warpline / node_modules are ALWAYS skipped (any depth), and the walk
 *     honors .warplineignore / .gitignore at the root (T-031 — see ignore-rules.ts)
 * Names use the RAW on-disk bytes (not NFC) so the shadow OID matches git exactly.
 * Gitlinks (160000) can't be detected from a plain fs walk — a submodule dir reads
 * as a subtree; native representation + ref-sourced snapshots land with M1b backfill.
 *
 * The shadow `gitOid` MUST equal `git rev-parse <ref>^{tree}` for a clean worktree —
 * a free, total byte-faithfulness proof against git during coexistence (§2.4).
 *
 * DELTA-NATIVE (T-2026-07-04-003): ref snapshots are batched (one `cat-file
 * --batch` stream, not one spawn per file) and, given a VERIFIED SnapshotAnchor
 * (strandSnapshotAnchor), INCREMENTAL — a `git diff --raw` overlay onto the
 * anchor's native tree via writeMergedTree, byte-identical to the full walk and
 * fail-OPEN to it. This is what makes a warm `admit` on a real monorepo run in
 * seconds instead of minutes (see bench/bench-admit.mts).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitBlobOid } from './blob.js';
import { gitTreeOid, type TreeEntry, type GitTreeEntry, type TreeMode } from './tree.js';
import { ObjectStore } from './object-store.js';
import { catFileBatch, diffRaw, lsTree, revParseTree, type GitOptions } from '../git/git-exec.js';
import { WORKTREE_REF } from '../absorb.js';
import { loadIgnoreMatcher, type IgnoreMatcher } from './ignore-rules.js';
import type { MergeRecipe, Strand } from '../fabric/strand.js';

export interface SnapshotResult {
  /** native root tree id (byte identity of the whole directory). */
  treeId: string;
  /** shadow git-sha1 tree OID — equals `git rev-parse <ref>^{tree}` for a clean tree. */
  gitOid: string;
  /** number of entries in the root tree (0 = empty). */
  entryCount: number;
}

/**
 * Snapshot a directory tree into `store`; returns the root ids.
 *
 * IGNORE SEMANTICS (T-031 / HIGH-3): the worktree walk honors `.warplineignore`
 * (preferred) or `.gitignore` (fallback) at the snapshot root, and ALWAYS skips
 * .git/.warpline/node_modules at any depth (see ignore-rules.ts) — so a worktree
 * pick/admit never ingests dependency trees or secrets into the permanent no-gc
 * object store. Ignored directories are pruned (gitignore semantics: no
 * re-inclusion inside an excluded directory). The shadow gitOid consequently
 * equals `git rev-parse <ref>^{tree}` for a CLEAN tree whose ignores match git's.
 */
export function snapshotDir(store: ObjectStore, dir: string): SnapshotResult {
  return walk(store, dir, '', loadIgnoreMatcher(dir));
}

function walk(store: ObjectStore, dir: string, rel: string, ignored: IgnoreMatcher): SnapshotResult {
  const native: TreeEntry[] = [];
  const git: GitTreeEntry[] = [];

  for (const name of fs.readdirSync(dir)) {
    const relPath = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (ignored(relPath, st.isDirectory())) continue;

    if (st.isSymbolicLink()) {
      const target = Buffer.from(fs.readlinkSync(full), 'utf8'); // link target IS the blob
      native.push({ mode: '120000', name, id: store.putBlob(target) });
      git.push({ mode: '120000', name, sha1: gitBlobOid(target) });
    } else if (st.isDirectory()) {
      const child = walk(store, full, relPath, ignored);
      if (child.entryCount === 0) continue; // git does not track empty directories
      native.push({ mode: '40000', name, id: child.treeId });
      git.push({ mode: '40000', name, sha1: child.gitOid });
    } else if (st.isFile()) {
      const bytes = fs.readFileSync(full);
      const mode: TreeMode = st.mode & 0o111 ? '100755' : '100644';
      native.push({ mode, name, id: store.putBlob(bytes) });
      git.push({ mode, name, sha1: gitBlobOid(bytes) });
    }
    // sockets/fifos/other special files are skipped (not representable in a tree)
  }

  return { treeId: store.putTree(native), gitOid: gitTreeOid(git), entryCount: native.length };
}

/* ── M1b: ref snapshots + the compositional merged-tree builder ─────────────── */

/** One byte change to overlay on a base tree: new/edited bytes+mode, or null=delete. */
export type PathChange = { content: Buffer; mode: string } | null;

interface Trie {
  files: Map<string, PathChange>;
  dirs: Map<string, Trie>;
}
const emptyTrie = (): Trie => ({ files: new Map(), dirs: new Map() });

function insertChange(trie: Trie, parts: string[], i: number, val: PathChange): void {
  if (i === parts.length - 1) {
    trie.files.set(parts[i], val);
    return;
  }
  let sub = trie.dirs.get(parts[i]);
  if (!sub) {
    sub = emptyTrie();
    trie.dirs.set(parts[i], sub);
  }
  insertChange(sub, parts, i + 1, val);
}

function buildTree(store: ObjectStore, baseTreeId: string | null, node: Trie): string {
  const map = new Map<string, TreeEntry>((baseTreeId ? store.getTree(baseTreeId) : []).map((e) => [e.name, e]));
  for (const [name, val] of node.files) {
    if (val === null) map.delete(name);
    else map.set(name, { mode: val.mode as TreeMode, name, id: store.putBlob(val.content) });
  }
  for (const [name, child] of node.dirs) {
    const existing = map.get(name);
    const childBase = existing && existing.mode === '40000' ? existing.id : null;
    const childId = buildTree(store, childBase, child);
    if (store.getTree(childId).length === 0) map.delete(name); // empty dir → drop (git parity)
    else map.set(name, { mode: '40000', name, id: childId });
  }
  return store.putTree([...map.values()]);
}

/**
 * Build a native tree from a base tree + per-path byte changes — the COMPOSITIONAL
 * construction (review amendment A2): unchanged subtrees are reused untouched
 * (so it is naturally incremental, A3), and the changed bytes come straight from
 * the caller (raw merge output / cat-file), NEVER the git-archive temp dir. `null`
 * base + all-files-as-changes builds a whole tree from scratch (used by snapshotRef).
 */
export function writeMergedTree(
  store: ObjectStore,
  baseTreeId: string | null,
  changes: Map<string, PathChange>,
): string {
  const root = emptyTrie();
  for (const [full, val] of changes) insertChange(root, full.split('/'), 0, val);
  return buildTree(store, baseTreeId, root);
}

/**
 * A verified byte anchor for an INCREMENTAL ref snapshot (T-2026-07-04-003):
 * `treeId` MUST be the native snapshot (`snapshotRef`) of `ref`'s tree. Callers
 * derive it from a sealed strand's `binding.treeId` + `provenance.gitCommit`,
 * verified via `binding.gitOid === rev-parse <commit>^{tree}` (see admit/pick).
 */
export interface SnapshotAnchor {
  /** a git ref/sha whose native snapshot is already in the store. */
  ref: string;
  /** the native treeId `snapshotRef(store, ref)` produced for that ref. */
  treeId: string;
}

/**
 * A VERIFIED incremental-snapshot anchor off a sealed strand (T-2026-07-04-003,
 * byte layer): usable ONLY when the strand's binding.treeId provably IS the
 * native snapshot of its provenance.gitCommit's tree —
 *   - not a merge strand (its gitCommit is one parent, NOT the merged tree),
 *   - binding.gitOid present (ref-sealed; worktree/backfilled seals carry null
 *     because their native tree is ignore-filtered vs the git tree),
 *   - gitOid still equals `rev-parse <gitCommit>^{tree}` (guards a gc'd/rewritten
 *     ref — verification failure falls back to the full snapshot, never a wrong tree),
 *   - the native tree is actually present in the object store.
 * Returns undefined when any leg fails — fail OPEN to the full snapshot.
 */
export async function strandSnapshotAnchor(
  strand: Strand | undefined,
  store: ObjectStore,
  opts: GitOptions,
): Promise<SnapshotAnchor | undefined> {
  if (!strand || strand.merged) return undefined;
  const treeId = strand.binding?.treeId;
  const gitOid = strand.binding?.gitOid;
  const commit = strand.provenance?.gitCommit;
  if (!treeId || !gitOid || !commit || !store.has(treeId)) return undefined;
  const actual = await revParseTree(commit, opts).catch(() => null);
  return actual === gitOid ? { ref: commit, treeId } : undefined;
}

/**
 * Snapshot a git REF's tree natively (§1.5).
 *
 * PERF (T-2026-07-04-003, byte layer): two paths, byte-identical results —
 *   - FULL: `ls-tree -r` inventory + ONE `cat-file --batch` stream for all blobs
 *     (previously one `git show` spawn per file — O(minutes) on a real monorepo).
 *   - INCREMENTAL (when a verified `base` anchor is supplied and its tree is in
 *     the store): `git diff --raw base.ref ref` → batch-read only the changed
 *     blobs → overlay onto `base.treeId` via `writeMergedTree` (compositional —
 *     unchanged subtrees reused untouched). Falls OPEN to the full path on any
 *     anomaly (missing base tree, diff failure) — never fail-closed on the cache.
 *
 * T-033 (root-ignore symmetry): a repo may TRACK files under .warpline/ (this repo
 * tracks its own fabric ledger) — but snapshotDir skips .git/.warpline, and
 * restoreTree REFUSES to write those names (RESTORE_FORBIDDEN). A ref snapshot
 * must therefore skip them too, or the hook's `--ref HEAD` seal binds a tree that
 * (a) never matches the worktree snapshot of the same content and (b) can never
 * be restored. Skipped at any depth, matching restoreTree's per-level guard —
 * IDENTICALLY on both the full and incremental paths (the equivalence tests pin
 * full-treeId === incremental-treeId, including tracked-.warpline fixtures).
 */
export async function snapshotRef(
  store: ObjectStore,
  ref: string,
  opts: GitOptions = {},
  base?: SnapshotAnchor,
): Promise<string> {
  if (base && store.has(base.treeId)) {
    try {
      return await snapshotRefIncremental(store, ref, base, opts);
    } catch {
      // Fail OPEN: the full snapshot is the source of truth. (A submodule in the
      // diff throws here AND on the full path below — consistent fail-closed.)
    }
  }
  return snapshotRefFull(store, ref, opts);
}

/** The FULL path: whole-tree inventory + one batched blob read. */
async function snapshotRefFull(store: ObjectStore, ref: string, opts: GitOptions): Promise<string> {
  const entries = await lsTree(ref, opts);
  const kept = entries.filter((e) => !e.path.split('/').some((part) => RESTORE_FORBIDDEN.has(part))); // T-033
  for (const e of kept) {
    if (e.type === 'commit' || e.mode === '160000') {
      throw new Error(`warpline: snapshotRef — submodule/gitlink at ${e.path} not yet supported (T-2026-07-01-018)`);
    }
  }
  const blobs = await catFileBatch(kept.map((e) => e.sha), opts);
  const changes = new Map<string, PathChange>();
  for (const e of kept) changes.set(e.path, { content: blobs.get(e.sha)!, mode: e.mode });
  return writeMergedTree(store, null, changes);
}

/**
 * The INCREMENTAL path: overlay only the base→ref byte changes onto the base's
 * native tree. Correct by construction WHEN base.treeId === snapshotRef(base.ref)
 * (the caller's anchor-verification contract): git reports exactly the path set
 * that differs, and writeMergedTree reuses every untouched subtree.
 */
async function snapshotRefIncremental(
  store: ObjectStore,
  ref: string,
  base: SnapshotAnchor,
  opts: GitOptions,
): Promise<string> {
  const raw = await diffRaw(base.ref, ref, opts);
  const changes = new Map<string, PathChange>();
  const pending: Array<{ path: string; sha: string; mode: string }> = [];
  for (const e of raw) {
    if (e.path.split('/').some((part) => RESTORE_FORBIDDEN.has(part))) continue; // T-033 parity
    if (e.status === 'D') {
      changes.set(e.path, null);
      continue;
    }
    if (e.newMode === '160000') {
      throw new Error(`warpline: snapshotRef — submodule/gitlink at ${e.path} not yet supported (T-2026-07-01-018)`);
    }
    pending.push({ path: e.path, sha: e.newSha, mode: e.newMode });
  }
  const blobs = await catFileBatch(pending.map((p) => p.sha), opts);
  for (const p of pending) changes.set(p.path, { content: blobs.get(p.sha)!, mode: p.mode });
  return writeMergedTree(store, base.treeId, changes);
}

/**
 * Snapshot the state a strand is being sealed from — worktree (fs) or a git ref.
 * `base` (optional) enables the incremental ref path; ignored for a worktree.
 */
export async function snapshotState(
  store: ObjectStore,
  ref: string,
  cwd: string,
  opts: GitOptions = {},
  base?: SnapshotAnchor,
): Promise<string> {
  return ref === WORKTREE_REF ? snapshotDir(store, cwd).treeId : snapshotRef(store, ref, opts, base);
}

/**
 * Capture the durable bytes of a materialized CLEAN merge: snapshot the three
 * parents (native, git-independent) and build the merged result COMPOSITIONALLY
 * from the base tree + the merge's own byte changes (A2). Returns the re-derivable
 * recipe; `recipe.result` is the strand's binding.treeId.
 *
 * PERF (T-2026-07-04-003): `baseAnchor` (optional, verified by the caller) makes
 * the base snapshot incremental; the base tree just built is BY CONSTRUCTION the
 * native snapshot of `baseRef`, so ours/theirs anchor on it — their snapshots
 * cost only their own diffs from the fork base, not the whole universe.
 */
export async function captureMerge(
  store: ObjectStore,
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  files: Map<string, PathChange>,
  opts: GitOptions = {},
  baseAnchor?: SnapshotAnchor,
): Promise<MergeRecipe> {
  const base = await snapshotRef(store, baseRef, opts, baseAnchor);
  const fork: SnapshotAnchor = { ref: baseRef, treeId: base };
  const ours = await snapshotRef(store, oursRef, opts, fork);
  const theirs = await snapshotRef(store, theirsRef, opts, fork);
  const result = writeMergedTree(store, base, files);
  // Pin the exact merge algorithm version — folded INTO the v2 pickId (Judge).
  return { algo: 'warpline-merge3-v1', base, ours, theirs, result };
}

/**
 * Component names a restored tree must NEVER contain — restoring one would
 * overwrite a real git repo (`.git`) or Warpline's own store (`.warpline`). A
 * tree entry carrying such a name is a forged/corrupt tree, not a restorable state.
 */
const RESTORE_FORBIDDEN = new Set(['.git', '.warpline']);

/**
 * PATH-HARDENING (Aegis C3, CVE-2021-21300 class): assert a tree entry name is a
 * single, safe path component before it is ever joined to a destination. This is
 * the security boundary of `restore` — it writes attacker/corruption-influenceable
 * tree bytes to disk. A violation means a FORGED or CORRUPT tree, so we FAIL CLOSED
 * (throw, aborting the whole restore) rather than skip-and-continue: a partially
 * restored tree from a tampered object is not a recoverable state.
 */
function assertSafeEntryName(name: string): void {
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    path.isAbsolute(name) ||
    /^[a-zA-Z]:/.test(name) // Windows drive-letter absolute (C:...)
  ) {
    throw new Error(
      `warpline: refusing to restore — tree entry name is not a safe single path component: ` +
        `${JSON.stringify(name)} (forged or corrupt tree; path-traversal blocked)`,
    );
  }
  if (RESTORE_FORBIDDEN.has(name)) {
    throw new Error(
      `warpline: refusing to restore — tree entry name "${name}" would overwrite a real repo/VCS ` +
        `directory (forged or corrupt tree)`,
    );
  }
}

/**
 * Restore a native tree to `dest` byte-faithfully with git ABSENT (the primitive
 * behind the `warpline restore` verb; selector resolution is #restore). Mirrors
 * materialize.ts §4. Returns the count of entries written (files + dirs + symlinks
 * + gitlinks, recursively) for the caller's report.
 *
 * SECURITY (Aegis C3): every entry name is validated as a safe single component
 * (assertSafeEntryName) and the whole restore fails closed on the first violation.
 * SYMLINK/TRAVERSAL SAFETY (defense in depth): the PARENT dir we write into must be
 * a real directory and NOT a symlink; and we never write THROUGH a pre-existing
 * symlink at a target path (an attacker-planted link could escape `dest`). A symlink
 * ENTRY is created (it lives inside `dest`) but is never traversed — and because a
 * mode-120000 entry is always a LEAF, it structurally cannot carry children.
 */
export function restoreTree(store: ObjectStore, treeId: string, dest: string): number {
  fs.mkdirSync(dest, { recursive: true });
  // The dir we are about to write INTO must be a real directory, never a symlink —
  // otherwise a symlinked parent would let writes land outside the intended root.
  const parent = fs.lstatSync(dest);
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error(
      `warpline: refusing to restore into ${dest} — not a real directory (symlink or non-dir)`,
    );
  }
  let count = 0;
  for (const e of store.getTree(treeId)) {
    assertSafeEntryName(e.name); // FAIL CLOSED before any path is joined/written
    const full = path.join(dest, e.name);
    // Never write through a symlink already occupying this path (traversal escape).
    let existing: fs.Stats | undefined;
    try {
      existing = fs.lstatSync(full);
    } catch {
      existing = undefined; // ENOENT — nothing there, the normal case
    }
    if (existing?.isSymbolicLink()) {
      throw new Error(
        `warpline: refusing to restore ${e.name} — a symlink already occupies ${full} ` +
          `(never write through a symlink)`,
      );
    }
    count++;
    if (e.mode === '40000') {
      count += restoreTree(store, e.id, full);
    } else if (e.mode === '120000') {
      if (existing) fs.rmSync(full, { force: true }); // --force overlay: replace, never write through a linked inode
      const target = store.getBlob(e.id).toString('utf8');
      fs.symlinkSync(target, full);
    } else if (e.mode === '160000') {
      fs.mkdirSync(full, { recursive: true }); // gitlink: no bytes to fabricate
    } else if (e.mode === '100644' || e.mode === '100755') {
      // Break any pre-existing HARDLINK before writing — write a FRESH inode so a
      // --force overlay can never overwrite the content of a file hardlinked OUTSIDE
      // dest (lstat cannot distinguish a hardlink from a plain file; unlink does).
      if (existing) fs.rmSync(full, { force: true });
      fs.writeFileSync(full, store.getBlob(e.id));
      fs.chmodSync(full, e.mode === '100755' ? 0o755 : 0o644);
    } else {
      // Fail closed on any unknown/forged mode rather than coercing it to a file.
      throw new Error(`warpline: refusing to restore ${e.name} — unknown tree entry mode ${e.mode}`);
    }
  }
  return count;
}
