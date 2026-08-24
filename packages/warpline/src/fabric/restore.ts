/**
 * #restore — the layer→VCS threshold (M1c). Reconstruct a working tree from the
 * NATIVE object store with git ABSENT: resolve a selector to a strand's byte
 * binding, then materialize its bytes byte-faithfully into a destination
 * (native-object-store-design.md §4). This is the proof that Warpline OWNS the
 * bytes — `rm -rf .git && warpline restore HEAD` reproduces the exact tree.
 *
 * SECURITY: restore writes attacker/corruption-influenceable tree bytes to disk,
 * so the byte writer (restoreTree, snapshot.ts) is path-hardened and fails closed
 * on a forged/corrupt entry name (Aegis C3). This module owns the DIRTY-DEST GUARD
 * — and, since the 2026-07-31 soundness audit, it owns it for EVERY byte write-back
 * in the package (C-5), not just the `restore` verb.
 *
 * THE GUARD, AND WHY IT IS PER-PATH (C-5, Judge). The original guard asked "is the
 * destination directory empty?". That question can never be satisfied by an
 * IN-PLACE restore into a working repo, so `--force` became mandatory for the
 * normal case and the guard trained its own bypass — while the two write-backs
 * that actually destroy work (`admit`'s CLEAN write-back, `fork --into`) skipped
 * it entirely and called restoreTree raw. The clobbered bytes are in NO object:
 * `propose` snapshotted BEFORE the edit and the write-back snapshots nothing, so
 * there is no stash, no reflog, no undo.
 *
 * The question the guard asks now is the one git asks — "would this overwrite
 * bytes that exist nowhere else?":
 *
 *   safe    the path is absent on disk                        (nothing to lose)
 *   safe    the disk bytes already equal what we would write  (the write is a no-op)
 *   safe    the disk bytes equal the caller's EXPECTED tree   (captured in an object)
 *   REFUSE  anything else                                     (bytes in no object)
 *
 * `expectTreeId` is the baseline the caller snapshotted — for `admit` that is the
 * proposal's own tree, so a merge that legitimately changes a file the agent has
 * not touched since `propose` passes, while an edit made AFTER `propose` (bytes
 * nothing holds) refuses. Callers with no baseline (`restore`, `fork --into`)
 * pass none, and any differing collision refuses. `--force` remains the escape.
 *
 * Unrelated files in the destination are NEVER a collision: restore has always
 * been an OVERLAY (it writes the tree's paths and leaves everything else alone).
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObjectStore } from '../warp/object-store.js';
import { restoreTree } from '../warp/snapshot.js';
import type { TreeEntry } from '../warp/tree.js';
import { warplineDirOf } from './fabric.js';
import { resolveSelector } from './select.js';

export interface RestoreOptions {
  /** what to restore: HEAD | selvage | N | @N | pick:<id> | state:<id> | tree:<id> (default HEAD). */
  selector?: string;
  /** the destination directory to reconstruct into. */
  to: string;
  /** overwrite colliding paths whose bytes are in no object (overlay, never wipe). */
  force?: boolean;
}

/* ── THE DIRTY-DESTINATION GUARD (C-5) ──────────────────────────────────────── */

/** One destination path whose current bytes a write-back would destroy. */
export interface DirtyCollision {
  /** the path, relative to the destination root (POSIX separators). */
  path: string;
  /**
   * `modified`    a file/symlink whose current content is in no object we hold.
   * `type-change` a file where a directory goes (or the reverse) — the occupant
   *               is removed wholesale, so its bytes go with it.
   */
  reason: 'modified' | 'type-change';
}

export interface DirtyGuardOptions {
  /**
   * The tree the destination is EXPECTED to currently hold — the baseline the
   * caller already snapshotted into the object store. A colliding path whose
   * disk bytes match this tree is recoverable, so overwriting it loses nothing.
   * Omit it (restore, fork --into) and ANY differing collision refuses.
   */
  expectTreeId?: string | null;
  /** the explicit human override: overwrite anyway. */
  force?: boolean;
  /** what to tell the caller to do instead (verb-specific; the CLI prints it). */
  overrideHint?: string;
}

/** How many collisions are named before the message truncates (honestly). */
const MAX_NAMED_COLLISIONS = 20;

/**
 * Every path in `treeId` whose current bytes at `dest` would be destroyed by
 * restoring it — per-path, never dir-emptiness. PURE: reads disk and the store,
 * writes nothing, so it is safe to call BEFORE deciding whether to seal.
 */
export function collectDirtyCollisions(
  store: ObjectStore,
  treeId: string,
  dest: string,
  expectTreeId?: string | null,
): DirtyCollision[] {
  const out: DirtyCollision[] = [];
  if (!fs.existsSync(dest)) return out; // nothing there to lose
  const expect = expectTreeId ? tryGetTree(store, expectTreeId) : null;
  walkForCollisions(store, store.getTree(treeId), expect, dest, '', out);
  return out;
}

function tryGetTree(store: ObjectStore, id: string): TreeEntry[] | null {
  // A missing/unreadable baseline is not "everything is clean" — it is "no
  // baseline", which makes the guard STRICTER, never laxer. Fail closed.
  try {
    return store.getTree(id);
  } catch {
    return null;
  }
}

function blobEquals(store: ObjectStore, id: string, disk: Buffer): boolean {
  try {
    return store.getBlob(id).equals(disk);
  } catch {
    return false; // unreadable object → cannot prove the disk bytes are captured
  }
}

function blobText(store: ObjectStore, id: string): string | null {
  try {
    return store.getBlob(id).toString('utf8');
  } catch {
    return null;
  }
}

function walkForCollisions(
  store: ObjectStore,
  entries: TreeEntry[],
  expect: TreeEntry[] | null,
  dir: string,
  rel: string,
  out: DirtyCollision[],
): void {
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue; // absent — a brand-new path destroys nothing
    }
    const baseline = expect?.find((x) => x.name === e.name) ?? null;

    if (e.mode === '40000') {
      if (st.isSymbolicLink() || !st.isDirectory()) {
        out.push({ path: relPath, reason: 'type-change' });
        continue;
      }
      const sub = store.getTree(e.id);
      const subExpect = baseline && baseline.mode === '40000' ? tryGetTree(store, baseline.id) : null;
      walkForCollisions(store, sub, subExpect, full, relPath, out);
      continue;
    }

    if (e.mode === '160000') {
      // gitlink: restoreTree only mkdir's. Only a non-directory occupant loses bytes.
      if (st.isSymbolicLink() || !st.isDirectory()) out.push({ path: relPath, reason: 'type-change' });
      continue;
    }

    if (e.mode === '120000') {
      if (!st.isSymbolicLink()) {
        out.push({ path: relPath, reason: 'type-change' });
        continue;
      }
      const current = fs.readlinkSync(full);
      if (current === blobText(store, e.id)) continue; // identical link — a no-op
      if (baseline && baseline.mode === '120000' && current === blobText(store, baseline.id)) continue;
      out.push({ path: relPath, reason: 'modified' });
      continue;
    }

    // regular file (100644 / 100755) — unknown modes are restoreTree's fail-closed
    if (st.isSymbolicLink() || st.isDirectory()) {
      out.push({ path: relPath, reason: 'type-change' });
      continue;
    }
    const disk = fs.readFileSync(full);
    if (blobEquals(store, e.id, disk)) continue; // the write is a no-op
    if (baseline && (baseline.mode === '100644' || baseline.mode === '100755') && blobEquals(store, baseline.id, disk)) {
      continue; // unmodified since the caller's snapshot — the bytes are in an object
    }
    out.push({ path: relPath, reason: 'modified' });
  }
}

/**
 * The refusal a non-empty collision set produces. Human prose lives in the
 * thrown Error's message (never in a verdict) — refusal.ts's binding rule.
 */
export function dirtyDestError(dest: string, collisions: DirtyCollision[], overrideHint: string): Error {
  const named = collisions.slice(0, MAX_NAMED_COLLISIONS);
  const lines = named.map((c) => `  - ${c.path} (${c.reason})`);
  if (collisions.length > named.length) lines.push(`  … and ${collisions.length - named.length} more`);
  return new Error(
    `warpline: refusing to overwrite ${collisions.length} path${collisions.length === 1 ? '' : 's'} in ${dest} — ` +
      `their current bytes are in NO object and cannot be recovered:\n` +
      lines.join('\n') +
      `\n${overrideHint}`,
  );
}

/**
 * Enforce the guard, then write. THE single byte-write-back entry point: admit's
 * CLEAN write-back, `fork --into` and the `restore` verb all come through here,
 * so the policy cannot be bypassed by adding a fourth caller that forgets it.
 */
export function guardedRestoreTree(
  store: ObjectStore,
  treeId: string,
  dest: string,
  opts: DirtyGuardOptions = {},
): number {
  assertDirtyFree(store, treeId, dest, opts);
  return restoreTree(store, treeId, dest);
}

/**
 * The guard ALONE — for callers that must know the write-back is safe BEFORE
 * they mutate the ledger (admit seals first, restores second; refusing after the
 * seal would leave a sealed strand behind an error).
 */
export function assertDirtyFree(
  store: ObjectStore,
  treeId: string,
  dest: string,
  opts: DirtyGuardOptions = {},
): void {
  if (opts.force) return;
  const collisions = collectDirtyCollisions(store, treeId, dest, opts.expectTreeId);
  if (collisions.length === 0) return;
  throw dirtyDestError(dest, collisions, opts.overrideHint ?? 'pass --force to overwrite them');
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

  // DIRTY-DEST GUARD (C-5): PER-PATH, not dir-emptiness. Restore OVERLAYS — it
  // writes the tree's paths and leaves unrelated files alone — so a merely
  // non-empty dest is no longer a refusal; a COLLIDING path whose bytes are in
  // no object is. `restore` has no snapshotted baseline, so it passes none.
  if (fs.existsSync(dest)) {
    const st = fs.lstatSync(dest);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      throw new Error(`warpline: --to ${dest} exists and is not a real directory`);
    }
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }

  const store = new ObjectStore(root);
  const entriesRestored = guardedRestoreTree(store, treeId, dest, {
    force: opts.force,
    overrideHint: 'pass --force to overwrite them (unrelated files are always left in place)',
  });

  return {
    selector: selectorLabel,
    treeId,
    dest,
    seq: strand?.seq ?? null,
    pickId: strand?.pickId ?? null,
    entriesRestored,
  };
}
