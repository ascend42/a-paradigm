/**
 * #native-status — the WORKING TREE's MEANING vs the SELVAGE, git ABSENT
 * (T-2026-08-12-002, cold-agent dogfood). The native backing for `warpline
 * status` / `warpline diff` (no-args) when there is no reachable git repo.
 *
 * WHY THIS EXISTS. `status`/`diff` computed the meaning diff as
 * `semanticDiff('HEAD', WORKTREE)`, and `absorb('HEAD')` shells `git archive` —
 * so in a NON-GIT native project the very first thing an agent runs
 * (`warpline status` is the manual) died with `git ... not a repository`. The
 * native path answers the same question without git: snapshot the worktree into
 * the object store, absorb it FROM the store (I2), and diff it against the
 * SELVAGE state (the fabric tip), exactly as `admit --native` derives its sides.
 *
 * THE HONESTY SURFACE. `diff` reports meaning: a byte-only change (an asset, a
 * `.env`, a doc) or a scalar-const edit that lifts to NO meaning delta produced
 * an EMPTY report — which reads as "nothing changed", the expensive false read
 * (an agent takes it as a no-op and drops real work). So the report also carries
 * a `DiskHonesty` block: how many files differ BYTE-WISE between the selvage tree
 * and the worktree, and whether that byte change carried zero meaning. The CLI
 * says it out loud ("0 meaning changes, but N files changed on disk"). This is a
 * SURFACE-ONLY signal — it never touches a verdict, never gates anything.
 *
 * Library code: no console output (the CLI prints).
 */

import { ObjectStore } from './warp/object-store.js';
import { WarpStore } from './warp/store.js';
import { snapshotDir } from './warp/snapshot.js';
import { absorbTree } from './fabric/native.js';
import { diff, type SemDelta, type SemDeltaSet } from './sem-delta.js';
import { warplineDirOf, readFabric, readSelvage } from './fabric/fabric.js';
import { readRef } from './fabric/refs.js';
import { revParse } from './git/git-exec.js';
import type { SemDiffReport } from './weave.js';
import type { WarpState } from './warp/warp-state.js';
import type { Strand } from './fabric/strand.js';

/** The base label a native diff reports against (the fabric tip, not a git ref). */
export const SELVAGE_REF = 'selvage' as const;
/** The branch label for the live working tree on the native path. */
export const WORKTREE_LABEL = 'WORKTREE' as const;

/**
 * The BYTE-level honesty layer over a meaning diff: how much moved ON DISK that
 * meaning did NOT govern. Present so a byte-only / scalar-only change is never
 * mistaken for a no-op (surface-only — never a verdict input).
 */
export interface DiskHonesty {
  /** files whose bytes differ between the base tree and the worktree tree. */
  filesChanged: number;
  /**
   * TRUE iff bytes moved (`filesChanged > 0`) but the MEANING delta is empty
   * (no born/retired/contract-changed symbol). The dangerous case: real work
   * that did not lift into any symbol.
   */
  byteOnly: boolean;
}

/** A native SemDiffReport with the byte-honesty layer attached. */
export type NativeStatusReport = SemDiffReport & { native: true; onDisk: DiskHonesty };

/** Is `HEAD` reachable via git from `root`? False ⇒ take the native path. */
export async function gitHeadReachable(root: string): Promise<boolean> {
  return revParse('HEAD', { cwd: root })
    .then(() => true)
    .catch(() => false);
}

/** The selvage tip STRAND (pickId ref preferred; legacy stateId selvage as fallback). */
function selvageTipStrand(root: string): Strand | undefined {
  const wdir = warplineDirOf(root);
  const fabric = readFabric(wdir);
  const pickId = readRef(wdir, 'selvage');
  if (pickId !== null) return fabric.find((s) => s.pickId === pickId);
  const legacy = readSelvage(wdir); // a stateId, pre-refs migration
  if (legacy !== null) return fabric.find((s) => s.stateId === legacy) ?? fabric[fabric.length - 1];
  return undefined; // empty / uninitialized fabric
}

/** The empty base — everything in the worktree reads as born (uninitialized fabric). */
function emptyState(): WarpState {
  return { ref: SELVAGE_REF, treeSha: null, objects: new Map(), stateId: 'state:v0:empty', absorbedAt: new Date().toISOString() };
}

/** Every FILE path in a tree (recurse dirs), keyed to its content id. */
function treeFileMap(store: ObjectStore, treeId: string | null, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (!treeId) return out;
  for (const e of store.getTree(treeId)) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.mode === '40000') treeFileMap(store, e.id, p, out);
    else out.set(p, e.id); // files / symlinks / gitlinks — the byte identity is the id
  }
  return out;
}

/** Count paths whose bytes differ between two trees (added / removed / edited). */
function countDiskChanges(store: ObjectStore, baseTree: string | null, worktreeTree: string): number {
  const a = treeFileMap(store, baseTree);
  const b = treeFileMap(store, worktreeTree);
  let changed = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(k) !== b.get(k)) changed++;
  }
  return changed;
}

/** Group a SemDeltaSet into the SemDiffReport buckets (mirrors weave.ts semanticDiff). */
function groupDeltas(set: SemDeltaSet): Pick<SemDiffReport, 'born' | 'retired' | 'contractChanged' | 'renamedNoop' | 'changedCount' | 'renamedNoopCount'> {
  const born: SemDelta[] = [];
  const retired: SemDelta[] = [];
  const contractChanged: SemDelta[] = [];
  for (const d of set.deltas.values()) {
    if (d.kind === 'symbol-born') born.push(d);
    else if (d.kind === 'symbol-retired') retired.push(d);
    else if (d.kind === 'contract-changed') contractChanged.push(d);
  }
  const bySym = (x: SemDelta, y: SemDelta): number => x.symbol.localeCompare(y.symbol);
  born.sort(bySym);
  retired.sort(bySym);
  contractChanged.sort(bySym);
  const renamedNoop = [...set.renames].sort(bySym);
  return {
    born,
    retired,
    contractChanged,
    renamedNoop,
    changedCount: born.length + retired.length + contractChanged.length,
    renamedNoopCount: renamedNoop.length,
  };
}

/**
 * The native `status`/`diff`: worktree MEANING vs the selvage, plus the disk-
 * honesty layer. `base = selvage` (HEAD-as-base status semantics: a NEW symbol
 * reads as `born`, a deleted one as `retired`), `branch = the live worktree`.
 */
export async function nativeStatus(root: string, opts: { worktree?: string } = {}): Promise<NativeStatusReport> {
  const worktree = opts.worktree ?? root;
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root);

  const tip = selvageTipStrand(root);
  const baseTree = tip?.binding?.treeId ?? null;
  const baseState = tip ? store.loadState(tip.stateId) ?? emptyState() : emptyState();

  // Snapshot the worktree (native walk, git-absent) and lift it FROM the store.
  const snap = snapshotDir(objStore, worktree, { indexRoot: root });
  const worktreeState = await absorbTree(objStore, snap.treeId, WORKTREE_LABEL);

  const set = diff(baseState, worktreeState);
  const grouped = groupDeltas(set);

  const filesChanged = countDiskChanges(objStore, baseTree, snap.treeId);
  const onDisk: DiskHonesty = {
    filesChanged,
    byteOnly: filesChanged > 0 && grouped.changedCount === 0 && grouped.renamedNoopCount === 0,
  };

  return {
    refA: SELVAGE_REF,
    refB: WORKTREE_LABEL,
    stateIds: { A: baseState.stateId, B: worktreeState.stateId },
    ...grouped,
    native: true,
    onDisk,
  };
}
