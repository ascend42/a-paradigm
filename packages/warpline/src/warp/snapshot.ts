/**
 * #warp-store (M1a) — SNAPSHOT: walk a directory, write every blob + tree to the
 * native object store, and return the root `treeId` (byte identity) plus the
 * shadow git-sha1 OID (native-object-store-design.md §1.5, §2.4, §4).
 *
 * Byte-faithful and git-parity in ONE filesystem walk:
 *   - regular file → 100644, or 100755 when any exec bit is set
 *   - symlink      → 120000; the blob bytes ARE the link target (git's convention)
 *   - directory    → 40000 subtree, recursed; EMPTY dirs are omitted (git parity)
 *   - .git / .warpline are skipped at the root
 * Names use the RAW on-disk bytes (not NFC) so the shadow OID matches git exactly.
 * Gitlinks (160000) can't be detected from a plain fs walk — a submodule dir reads
 * as a subtree; native representation + ref-sourced snapshots land with M1b backfill.
 *
 * The shadow `gitOid` MUST equal `git rev-parse <ref>^{tree}` for a clean worktree —
 * a free, total byte-faithfulness proof against git during coexistence (§2.4).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitBlobOid } from './blob.js';
import { gitTreeOid, type TreeEntry, type GitTreeEntry, type TreeMode } from './tree.js';
import { ObjectStore } from './object-store.js';
import { gitShowBuffer, lsTree, type GitOptions } from '../git/git-exec.js';
import { WORKTREE_REF } from '../absorb.js';
import type { MergeRecipe } from '../fabric/strand.js';

export interface SnapshotResult {
  /** native root tree id (byte identity of the whole directory). */
  treeId: string;
  /** shadow git-sha1 tree OID — equals `git rev-parse <ref>^{tree}` for a clean tree. */
  gitOid: string;
  /** number of entries in the root tree (0 = empty). */
  entryCount: number;
}

const ROOT_IGNORE = new Set(['.git', '.warpline']);

/** Snapshot a directory tree into `store`; returns the root ids. */
export function snapshotDir(store: ObjectStore, dir: string): SnapshotResult {
  return walk(store, dir, true);
}

function walk(store: ObjectStore, dir: string, isRoot: boolean): SnapshotResult {
  const native: TreeEntry[] = [];
  const git: GitTreeEntry[] = [];

  for (const name of fs.readdirSync(dir)) {
    if (isRoot && ROOT_IGNORE.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);

    if (st.isSymbolicLink()) {
      const target = Buffer.from(fs.readlinkSync(full), 'utf8'); // link target IS the blob
      native.push({ mode: '120000', name, id: store.putBlob(target) });
      git.push({ mode: '120000', name, sha1: gitBlobOid(target) });
    } else if (st.isDirectory()) {
      const child = walk(store, full, false);
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

/** Snapshot a git REF's tree natively via raw `cat-file` bytes (§1.5). */
export async function snapshotRef(store: ObjectStore, ref: string, opts: GitOptions = {}): Promise<string> {
  const entries = await lsTree(ref, opts);
  const changes = new Map<string, PathChange>();
  for (const e of entries) {
    if (e.type === 'commit' || e.mode === '160000') {
      throw new Error(`warpline: snapshotRef — submodule/gitlink at ${e.path} not yet supported (T-2026-07-01-018)`);
    }
    changes.set(e.path, { content: await gitShowBuffer(ref, e.path, opts), mode: e.mode });
  }
  return writeMergedTree(store, null, changes);
}

/** Snapshot the state a strand is being sealed from — worktree (fs) or a git ref. */
export async function snapshotState(
  store: ObjectStore,
  ref: string,
  cwd: string,
  opts: GitOptions = {},
): Promise<string> {
  return ref === WORKTREE_REF ? snapshotDir(store, cwd).treeId : snapshotRef(store, ref, opts);
}

/**
 * Capture the durable bytes of a materialized CLEAN merge: snapshot the three
 * parents (native, git-independent) and build the merged result COMPOSITIONALLY
 * from the base tree + the merge's own byte changes (A2). Returns the re-derivable
 * recipe; `recipe.result` is the strand's binding.treeId.
 */
export async function captureMerge(
  store: ObjectStore,
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  files: Map<string, PathChange>,
  opts: GitOptions = {},
): Promise<MergeRecipe> {
  const base = await snapshotRef(store, baseRef, opts);
  const ours = await snapshotRef(store, oursRef, opts);
  const theirs = await snapshotRef(store, theirsRef, opts);
  const result = writeMergedTree(store, base, files);
  return { base, ours, theirs, result };
}

/** Restore a native tree to `dest` byte-faithfully (M1a helper; the `warpline
 * restore` verb + selector resolution is M1c). Mirrors materialize.ts §4. */
export function restoreTree(store: ObjectStore, treeId: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of store.getTree(treeId)) {
    const full = path.join(dest, e.name);
    if (e.mode === '40000') {
      restoreTree(store, e.id, full);
    } else if (e.mode === '120000') {
      const target = store.getBlob(e.id).toString('utf8');
      fs.symlinkSync(target, full);
    } else if (e.mode === '160000') {
      fs.mkdirSync(full, { recursive: true }); // gitlink: no bytes to fabricate
    } else {
      fs.writeFileSync(full, store.getBlob(e.id));
      fs.chmodSync(full, e.mode === '100755' ? 0o755 : 0o644);
    }
  }
}
