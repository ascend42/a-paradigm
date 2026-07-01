/**
 * #restore — the layer→VCS threshold (M1c). Reconstruct a working tree from the
 * NATIVE object store with git ABSENT: resolve a selector to a strand's byte
 * binding, then materialize its bytes byte-faithfully into a destination
 * (native-object-store-design.md §4). This is the proof that Warpline OWNS the
 * bytes — `rm -rf .git && warpline restore HEAD` reproduces the exact tree.
 *
 * SECURITY: restore writes attacker/corruption-influenceable tree bytes to disk,
 * so the byte writer (restoreTree, snapshot.ts) is path-hardened and fails closed
 * on a forged/corrupt entry name (Aegis C3). This module owns the DIRTY-DEST GUARD:
 * refuse to write into a non-empty destination unless --force (overlay semantics —
 * colliding paths are overwritten, unrelated files are left in place).
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import { ObjectStore } from '../warp/object-store.js';
import { restoreTree } from '../warp/snapshot.js';
import { warplineDirOf } from './fabric.js';
import { resolveSelector } from './select.js';

export interface RestoreOptions {
  /** what to restore: HEAD | selvage | N | @N | pick:<id> | state:<id> | tree:<id> (default HEAD). */
  selector?: string;
  /** the destination directory to reconstruct into. */
  to: string;
  /** overwrite colliding paths in a non-empty destination (overlay, never wipe). */
  force?: boolean;
}

export interface RestoreResult {
  /** the selector as resolved (defaults to HEAD). */
  selector: string;
  /** the native treeId that was materialized. */
  treeId: string;
  /** the destination directory. */
  dest: string;
  /** the strand's seq (null for a direct `tree:` selector). */
  seq: number | null;
  /** the strand's pickId (null for a direct `tree:` selector). */
  pickId: string | null;
  /** entries written (files + dirs + symlinks + gitlinks, recursively). */
  entriesRestored: number;
}

/**
 * Reconstruct the tree named by `opts.selector` into `opts.to` with git absent.
 * Resolves the selector → treeId (A4-refuses an unbound strand), enforces the
 * dirty-dest guard, then walks the native store via the hardened restoreTree.
 */
export function restore(root: string, opts: RestoreOptions): RestoreResult {
  const wdir = warplineDirOf(root);
  const selectorLabel = (opts.selector ?? 'HEAD').trim() || 'HEAD';
  const { treeId, strand } = resolveSelector(wdir, opts.selector);
  const dest = opts.to;

  // DIRTY-DEST GUARD: a non-empty dest is only overwritten with --force. Restore
  // OVERLAYS (it writes the tree's paths, overwriting collisions; it does not wipe
  // unrelated files). A missing dest is created.
  if (fs.existsSync(dest)) {
    const st = fs.lstatSync(dest);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      throw new Error(`warpline: --to ${dest} exists and is not a real directory`);
    }
    if (fs.readdirSync(dest).length > 0 && !opts.force) {
      throw new Error(`warpline: dest ${dest} not empty; pass --force to overwrite colliding paths`);
    }
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }

  const store = new ObjectStore(root);
  const entriesRestored = restoreTree(store, treeId, dest);

  return {
    selector: selectorLabel,
    treeId,
    dest,
    seq: strand?.seq ?? null,
    pickId: strand?.pickId ?? null,
    entriesRestored,
  };
}
