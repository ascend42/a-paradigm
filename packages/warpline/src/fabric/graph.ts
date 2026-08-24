/**
 * #graph — multi-branch HISTORY presentation over the derived pick-DAG (M2.5
 * increment 6, TD-2026-08-12-813; closes M2 history-nav T-2026-07-01-013).
 *
 * READ-ONLY. Nothing here changes a verdict, a seal, or a ref. It CONSUMES the
 * layers increments 1–5 already built — the derived pick-DAG (#fabric-dag), the
 * ref layer (#fabric-refs), HEAD (#head), and the native object store — to present
 * history ACROSS branches, exactly as `git log --all` / `git diff A..B` / `git
 * show` present git's object graph without mutating it. The presentation is
 * derived; a derived position is SHOWN, never persisted (spec §1.2).
 *
 *   - branchGraph  — the DAG order annotated with which refs name each node + the
 *                    HEAD marker + author/intent; the structure `log` renders.
 *   - ancestorsOf  — the ancestry line of one branch tip (`log <branch>`), the
 *                    #mergebase ancestorSet presented in DAG order, newest first.
 *   - diffTrees    — the byte diff between two native trees (`diff A..B`), reusing
 *                    the #materialize flatten primitive (no new tree walker, no new
 *                    per-path change test — flattenNativeTree + nativeDiffers are
 *                    the SAME ones the native merge decides changed-ness with).
 *
 * Library code: no console output — the CLI prints.
 */

import type { Strand } from './strand.js';
import { buildDag } from './dag.js';
import { ancestorSet } from './mergebase.js';
import { DEFAULT_BRANCH, type HeadTarget } from './head.js';
import { flattenNativeTree, nativeDiffers } from './materialize.js';
import type { ObjectStore } from '../warp/object-store.js';

/** One node in a multi-branch log: a strand + the refs that name it + the HEAD marker. */
export interface GraphNode {
  strand: Strand;
  /** branch/ref names whose ref points AT this strand's pickId (sorted; [] when unnamed). */
  refs: string[];
  /** true when HEAD resolves to this strand's pickId (the '*' marker). */
  head: boolean;
  /** the HEAD branch name when HEAD is attached to a branch naming this node; null otherwise. */
  headBranch: string | null;
}

export interface BranchGraph {
  /** the derived DAG order, NEWEST FIRST (buildDag.order reversed) — the log order. */
  nodes: GraphNode[];
  /** the HEAD as read (a branch symref, a detached pickId, or null ≡ the default trunk). */
  head: HeadTarget | null;
}

/**
 * Annotate the whole fabric's DAG order with branch/HEAD decoration — the
 * `warpline log` (multi-branch, default) structure. `refs` is name → pickId
 * (#fabric-refs listRefs); `head` is the HEAD as read (#head readHead), where
 * ABSENT (null) means the default trunk, exactly as resolveHeadTip defaults it.
 *
 * A single pickId can be named by several refs (two branches at the same tip), so
 * `refs` per node is a sorted list. HEAD is marked on the node its branch tip (or
 * its detached pickId) resolves to.
 */
export function branchGraph(
  fabric: Strand[],
  refs: Map<string, string>,
  head: HeadTarget | null,
): BranchGraph {
  const dag = buildDag(fabric);

  // pickId → the ref names pointing at it (invert the ref map; a tip may carry many).
  const refsAt = new Map<string, string[]>();
  for (const [name, pickId] of refs) {
    const arr = refsAt.get(pickId);
    if (arr) arr.push(name);
    else refsAt.set(pickId, [name]);
  }
  for (const arr of refsAt.values()) arr.sort();

  // Which pickId is the CURRENT HEAD position? Absent HEAD ≡ refs/heads/selvage
  // (DEFAULT_BRANCH), the same default #head resolveHeadTip applies.
  const headBranch = head === null ? DEFAULT_BRANCH : head.kind === 'branch' ? head.branch : null;
  const headTip =
    headBranch !== null
      ? refs.get(headBranch) ?? null
      : head !== null && head.kind === 'detached'
        ? head.pickId
        : null;

  // Newest first — the log presentation order (buildDag.order is oldest→newest).
  const nodes: GraphNode[] = [];
  for (let i = dag.order.length - 1; i >= 0; i--) {
    const s = dag.order[i];
    const isHead = headTip !== null && s.pickId === headTip;
    nodes.push({
      strand: s,
      refs: refsAt.get(s.pickId) ?? [],
      head: isHead,
      headBranch: isHead ? headBranch : null,
    });
  }
  return { nodes, head };
}

/**
 * The ancestry line of `tip` (a pickId), INCLUSIVE, presented in DAG order newest
 * first — the `warpline log <branch>` view. Reuses the #mergebase ancestorSet
 * (the unified DAG-parent walk) and the #fabric-dag topological order; it does not
 * re-derive either. A `tip` absent from the fabric (a closure hole) simply yields
 * the ancestors that ARE present, exactly as the DAG orders around missing parents.
 */
export function ancestorsOf(fabric: Strand[], tip: string): Strand[] {
  const dag = buildDag(fabric);
  const anc = ancestorSet(dag.byPickId, tip);
  const out: Strand[] = [];
  for (let i = dag.order.length - 1; i >= 0; i--) {
    const s = dag.order[i];
    if (anc.has(s.pickId)) out.push(s);
  }
  return out;
}

/** The byte diff between two native trees: paths added / removed / modified. */
export interface TreeDiff {
  /** present in B, absent in A (sorted). */
  added: string[];
  /** present in A, absent in B (sorted). */
  removed: string[];
  /** present in both, but {mode,id} moved (sorted). */
  modified: string[];
}

/**
 * The byte diff between two native trees `treeIdA` → `treeIdB` (the `A..B` range of
 * `warpline diff`). Flattens BOTH through the #materialize walker and compares
 * {mode,id} per path via the SAME nativeDiffers the native merge uses — so a
 * rename reads as delete+add and an unchanged file is exactly id-equal (the native
 * equivalent of `git diff --no-renames`). Presentation only — reads the object
 * store, writes nothing.
 */
export function diffTrees(store: ObjectStore, treeIdA: string, treeIdB: string): TreeDiff {
  const a = flattenNativeTree(store, treeIdA);
  const b = flattenNativeTree(store, treeIdB);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const p of a.keys()) if (!b.has(p)) removed.push(p);
  for (const [p, be] of b) {
    const ae = a.get(p);
    if (ae === undefined) added.push(p);
    else if (nativeDiffers(ae, be)) modified.push(p);
  }
  added.sort();
  removed.sort();
  modified.sort();
  return { added, removed, modified };
}
