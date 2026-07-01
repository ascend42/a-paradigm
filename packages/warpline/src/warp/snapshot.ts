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
