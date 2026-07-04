/**
 * #materialize — Phase-C v2 meaning→bytes. PERFORM the merge git could only
 * forecast: given base / ours / theirs refs whose meaning-deltas commute (a CLEAN
 * #admit), produce the MERGED tree and absorb it to the merged WarpState.
 *
 * Per file: only-one-side-changed → that side; both-changed → token-level #merge3
 * (which composes disjoint edits git's line-merge conflicts on). Any add/delete-vs-
 * edit, or any overlapping token-region, is a CONFLICT — surfaced, NEVER silently
 * resolved (a wrong merge is the VCS cardinal sin). Bytes are read via git (the
 * coexistence byte store); the merge decision is Warpline's.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { absorb, WORKTREE_REF } from '../absorb.js';
import type { WarpState } from '../warp/warp-state.js';
import {
  gitShowBuffer,
  changedPaths,
  treeEntryMode,
  materializeTree,
  releaseTree,
  type GitOptions,
} from '../git/git-exec.js';
import { ObjectStore } from '../warp/object-store.js';
import { writeMergedTree, restoreTree } from '../warp/snapshot.js';
import { mergeText } from './merge3.js';

export interface MergeConflict {
  path: string;
  reason: string;
}

/** A merged CHANGED path: the resolved bytes plus the 3-way-merged git file mode. */
export interface MergedFile {
  content: Buffer;
  /** git tree-entry mode — `100644` regular or `100755` executable. */
  mode: string;
}

export interface MergePlan {
  /** merged file per CHANGED path (null = deleted in the merge). */
  files: Map<string, MergedFile | null>;
  conflicts: MergeConflict[];
}

/** Entry modes we cannot byte-merge — fail closed rather than corrupt them. */
const NON_BLOB_MODES = new Set(['120000', '160000']); // symlink, gitlink/submodule

/**
 * 3-way merge a file's git mode exactly like its bytes: unchanged on a side takes
 * the other side; changed differently on both sides is a conflict. `null` = absent
 * (only reached for a retained file, so at least one side is present).
 */
function mergeMode(
  base: string | null,
  ours: string | null,
  theirs: string | null,
): { mode: string } | { reason: string } {
  if (ours === theirs) return { mode: ours ?? '100644' };
  if (ours === base) return { mode: theirs ?? '100644' };
  if (theirs === base) return { mode: ours ?? '100644' };
  return { reason: `file mode changed differently on both sides (${ours ?? 'absent'} vs ${theirs ?? 'absent'})` };
}

/** A blob is binary if it contains a NUL byte (git's own heuristic). */
const isBinary = (b: Buffer | null): boolean => b !== null && b.includes(0);
const bufEq = (a: Buffer | null, b: Buffer | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && a.equals(b));

/** Resolve one file's 3-way merge over raw bytes (binary-safe). */
function resolveFile(
  base: Buffer | null,
  ours: Buffer | null,
  theirs: Buffer | null,
): { content: Buffer | null } | { reason: string } {
  if (bufEq(ours, theirs)) return { content: ours }; // both same (incl. both-deleted)
  if (bufEq(ours, base)) return { content: theirs }; // only theirs changed
  if (bufEq(theirs, base)) return { content: ours }; // only ours changed
  // Both sides changed differently.
  if (base === null || ours === null || theirs === null) {
    return { reason: 'add/delete vs edit on the same file' };
  }
  // H3: never token-merge binary — a NUL-bearing blob through the text path would
  // corrupt silently. Fail CLOSED on binary-changed-both-sides.
  if (isBinary(base) || isBinary(ours) || isBinary(theirs)) {
    return { reason: 'binary file changed on both sides' };
  }
  const m = mergeText(base.toString('utf8'), ours.toString('utf8'), theirs.toString('utf8'));
  if (m.conflicts > 0) return { reason: `${m.conflicts} overlapping token-region(s)` };
  return { content: Buffer.from(m.text, 'utf8') };
}

/** Compute the merged content of every path that base→ours or base→theirs touched. */
export async function computeMerge(
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  opts: GitOptions = {},
): Promise<MergePlan> {
  const changed = new Set<string>([
    ...(await changedPaths(baseRef, oursRef, opts)),
    ...(await changedPaths(baseRef, theirsRef, opts)),
  ]);
  const files = new Map<string, MergedFile | null>();
  const conflicts: MergeConflict[] = [];

  for (const p of changed) {
    const [baseMode, oursMode, theirsMode] = await Promise.all([
      treeEntryMode(baseRef, p, opts),
      treeEntryMode(oursRef, p, opts),
      treeEntryMode(theirsRef, p, opts),
    ]);
    // Fail CLOSED on symlinks / submodules on any side: gitShowBuffer would hand
    // us the target-path text / gitlink sha, and writing it as a regular blob would
    // silently corrupt the entry type. We only byte-merge real blobs.
    if ([baseMode, oursMode, theirsMode].some((m) => m !== null && NON_BLOB_MODES.has(m))) {
      conflicts.push({ path: p, reason: 'symlink or submodule changed — unmergeable entry type' });
      continue;
    }
    const base = await gitShowBuffer(baseRef, p, opts).catch(() => null);
    const ours = await gitShowBuffer(oursRef, p, opts).catch(() => null);
    const theirs = await gitShowBuffer(theirsRef, p, opts).catch(() => null);
    const r = resolveFile(base, ours, theirs);
    if ('reason' in r) {
      conflicts.push({ path: p, reason: r.reason });
      continue;
    }
    if (r.content === null) {
      files.set(p, null); // deleted in the merge — no bytes, no mode
      continue;
    }
    // The bytes merged cleanly; the executable bit must survive the merge too.
    const mm = mergeMode(baseMode, oursMode, theirsMode);
    if ('reason' in mm) {
      conflicts.push({ path: p, reason: mm.reason });
      continue;
    }
    files.set(p, { content: r.content, mode: mm.mode });
  }
  return { files, conflicts };
}

export interface MaterializeResult {
  plan: MergePlan;
  /** the absorbed merged WarpState, or null when the plan has conflicts. */
  state: WarpState | null;
}

/**
 * PERFORM the merge: compute the plan, then (if conflict-free) materialize the
 * base tree + overrides into a throwaway dir and absorb it → the merged WarpState.
 * The user's working tree is never touched (the merge lands in a temp dir).
 */
export async function materializeMergedState(
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  opts: GitOptions = {},
): Promise<MaterializeResult> {
  const plan = await computeMerge(baseRef, oursRef, theirsRef, opts);
  if (plan.conflicts.length > 0) return { plan, state: null };

  const tmp = await materializeTree(baseRef, opts);
  try {
    for (const [p, entry] of plan.files) {
      const full = path.join(tmp, p);
      if (entry === null) {
        await fs.rm(full, { force: true });
      } else {
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, entry.content); // Buffer — raw bytes, no re-encoding
        // Preserve the executable bit through the merge (fs.writeFile forces 0644).
        await fs.chmod(full, entry.mode === '100755' ? 0o755 : 0o644);
      }
    }
    const state = await absorb(WORKTREE_REF, { cwd: tmp });
    return { plan, state };
  } finally {
    await releaseTree(tmp);
  }
}

/* ── NATIVE-tree merge (H1 relaxation, PR-B) ─────────────────────────────────── */

/** Flatten a native tree to leaf paths → {mode, id}. Dirs are expanded; symlink /
 * gitlink entries are kept as leaves (the merge fails them closed as NON_BLOB). */
function flattenNativeTree(store: ObjectStore, treeId: string): Map<string, { mode: string; id: string }> {
  const out = new Map<string, { mode: string; id: string }>();
  const walk = (tid: string, prefix: string): void => {
    for (const e of store.getTree(tid)) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.mode === '40000') walk(e.id, p);
      else out.set(p, { mode: e.mode, id: e.id });
    }
  };
  walk(treeId, '');
  return out;
}

type NativeEntry = { mode: string; id: string };
/** A path differs between two native trees when presence, native id, OR mode moved.
 * Because all three merge sides are normalized to NATIVE ids, unchanged files share
 * one content-address across sides — so id-equality is an exact, cheap change test
 * (the native equivalent of git diff --no-renames: a rename reads as delete+add). */
const nativeDiffers = (a: NativeEntry | undefined, b: NativeEntry | undefined): boolean =>
  (a === undefined) !== (b === undefined) ||
  (a !== undefined && b !== undefined && (a.id !== b.id || a.mode !== b.mode));

/**
 * Compute the 3-way merge plan over three NATIVE trees (git ABSENT). The H1
 * relaxation's core: when a merge base/theirs strand contributes its durable
 * binding.treeId instead of a git commit, the whole merge runs off the object
 * store. Byte + mode resolution is IDENTICAL to the git path (resolveFile /
 * mergeMode / NON_BLOB fail-closed) — only the byte SOURCE changed.
 */
export function computeMergeNative(
  store: ObjectStore,
  baseTreeId: string,
  oursTreeId: string,
  theirsTreeId: string,
): MergePlan {
  const base = flattenNativeTree(store, baseTreeId);
  const ours = flattenNativeTree(store, oursTreeId);
  const theirs = flattenNativeTree(store, theirsTreeId);

  const changed = new Set<string>();
  for (const p of new Set([...base.keys(), ...ours.keys()])) if (nativeDiffers(base.get(p), ours.get(p))) changed.add(p);
  for (const p of new Set([...base.keys(), ...theirs.keys()])) if (nativeDiffers(base.get(p), theirs.get(p))) changed.add(p);

  const files = new Map<string, MergedFile | null>();
  const conflicts: MergeConflict[] = [];

  for (const p of changed) {
    const bE = base.get(p);
    const oE = ours.get(p);
    const tE = theirs.get(p);
    // Same fail-closed as the git path: we only byte-merge real blobs.
    if ([bE?.mode, oE?.mode, tE?.mode].some((m) => m != null && NON_BLOB_MODES.has(m))) {
      conflicts.push({ path: p, reason: 'symlink or submodule changed — unmergeable entry type' });
      continue;
    }
    const b = bE ? store.getBlob(bE.id) : null; // verified read — fails closed on tamper
    const o = oE ? store.getBlob(oE.id) : null;
    const t = tE ? store.getBlob(tE.id) : null;
    const r = resolveFile(b, o, t);
    if ('reason' in r) {
      conflicts.push({ path: p, reason: r.reason });
      continue;
    }
    if (r.content === null) {
      files.set(p, null);
      continue;
    }
    const mm = mergeMode(bE?.mode ?? null, oE?.mode ?? null, tE?.mode ?? null);
    if ('reason' in mm) {
      conflicts.push({ path: p, reason: mm.reason });
      continue;
    }
    files.set(p, { content: r.content, mode: mm.mode });
  }
  return { files, conflicts };
}

export interface MaterializeNativeResult {
  plan: MergePlan;
  /** the absorbed merged WarpState, or null when the plan has conflicts. */
  state: WarpState | null;
  /** the native treeId of the merged result (the strand's binding + recipe result). */
  resultTreeId: string | null;
}

/**
 * PERFORM a merge over three NATIVE trees: compute the plan, build the merged
 * result tree in the object store (COMPOSITIONALLY — unchanged subtrees reused),
 * restore it to a throwaway dir, and absorb → the merged WarpState. Returns the
 * result treeId so the caller pins it as both binding.treeId and merge.result — so
 * the merged strand re-verifies (verify: merge.result === binding.treeId). The
 * user's worktree is never touched.
 */
export async function materializeMergedStateNative(
  store: ObjectStore,
  baseTreeId: string,
  oursTreeId: string,
  theirsTreeId: string,
): Promise<MaterializeNativeResult> {
  const plan = computeMergeNative(store, baseTreeId, oursTreeId, theirsTreeId);
  if (plan.conflicts.length > 0) return { plan, state: null, resultTreeId: null };
  const resultTreeId = writeMergedTree(store, baseTreeId, plan.files);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-merge-native-'));
  try {
    restoreTree(store, resultTreeId, tmp);
    const state = await absorb(WORKTREE_REF, { cwd: tmp });
    return { plan, state, resultTreeId };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
