/**
 * #admit — the multi-writer WRITE side (Phase C v1, decision-level). The protocol
 * that lets N agents commit concurrently into one WARP without git's shared-tree
 * collision: each agent forks a #scratch at a base selvage, edits, then ADMITS.
 *
 * admitDecision(base, proposed, selvage) is the pure verdict:
 *   - NOOP        : the agent changed no meaning — diff(base, proposed) is empty
 *                   (the DIFF, not stateId equality, decides; same rule as #pick).
 *   - FAST_ADMIT  : selvage hasn't advanced since the agent's base — admit directly.
 *   - CLEAN       : selvage advanced, but predict(agentΔ, otherΔ) is autoClean — the
 *                   concurrent edits commute at the meaning level (this is the case
 *                   git CONFLICTS on when the edits are textually adjacent). Carries
 *                   a GATE-RULE confidence: 'linked' (the two changed sets are
 *                   dependency-adjacent in-graph ⇒ Merkle would have surfaced a real
 *                   conflict, so autoClean is trustworthy) vs 'independent' (disjoint,
 *                   no in-graph link ⇒ autoClean may HIDE a cross-symbol semantic
 *                   conflict the engine is blind to — per the false-AUTOFOLD gate).
 *   - KNOT        : same symbol, contradictory meaning — a human DECIDE is required.
 *   - DANGLE      : one side's edge into a symbol the other retired — broken ref.
 *
 * v1 SCOPE: this is the DECISION engine + the FAST_ADMIT seal. Producing the
 * MERGED bytes for a CLEAN re-base (so the agent's tree reflects base+other+agent)
 * is the meaning→bytes materialization layer, deferred to v2 — admit() seals only
 * on FAST_ADMIT (a complete state); CLEAN/KNOT/DANGLE return the verdict unsealed.
 *
 * Library code: no console output.
 */

import { absorb, WORKTREE_REF } from '../absorb.js';
import { diff, type SemDeltaSet } from '../sem-delta.js';
import { predict, type Knot, type Dangle } from '../predict.js';
import { WarpStore } from '../warp/store.js';
import type { WarpState } from '../warp/warp-state.js';
import { ObjectStore } from '../warp/object-store.js';
import { snapshotState, snapshotRef, captureMerge, strandSnapshotAnchor, type SnapshotAnchor } from '../warp/snapshot.js';
import { revParse, commitAuthor, commitSubject, gitUserName } from '../git/git-exec.js';
import { warplineDirOf, readSelvage, readFabric } from './fabric.js';
import { readScratch, clearScratch } from './scratch.js';
import type { Strand, MergeRecipe } from './strand.js';
import { sealState } from './seal.js';
import { withFabricLock } from './lock.js';
import { materializeMergedState, materializeMergedStateNative, type MergePlan } from './materialize.js';

export type AdmitStatus = 'NOOP' | 'FAST_ADMIT' | 'CLEAN' | 'KNOT' | 'DANGLE';
export type AdmitConfidence = 'linked' | 'independent';

export interface AdmitDecision {
  status: AdmitStatus;
  knots: Knot[];
  dangling: Dangle[];
  /** for CLEAN: whether the concurrent changed-sets are dependency-adjacent in-graph. */
  confidence: AdmitConfidence | null;
  /** the selvage the agent re-based against (for CLEAN/KNOT/DANGLE). */
  rebasedOnto: string | null;
  /** symbol names this agent changed vs its base (for surfacing). */
  agentChanged: string[];
  /** symbol names the concurrent writer(s) changed vs the same base. */
  otherChanged: string[];
}

const symbolsOf = (d: SemDeltaSet): string[] =>
  Array.from(new Set(Array.from(d.deltas.values()).map((x) => x.symbol))).sort();

/**
 * Direct dependency-adjacency (v1 heuristic for the gate rule): is any symbol in
 * setA joined by an edge — in EITHER direction — to any symbol in setB, across the
 * union of the supplied states' edge graphs? If so, a conflict between them would
 * propagate via Merkle-by-target and surface as a knot; if NOT, the autoClean
 * verdict carries the cross-symbol blind-spot risk the false-AUTOFOLD gate proved.
 * (v1 is direct adjacency, not full dependency-cone reachability.)
 */
function dependencyAdjacent(setA: Set<string>, setB: Set<string>, states: WarpState[]): boolean {
  for (const state of states) {
    for (const obj of state.objects.values()) {
      const from = obj.symbol;
      for (const e of obj.edges ?? []) {
        const to = e.to;
        if ((setA.has(from) && setB.has(to)) || (setB.has(from) && setA.has(to))) return true;
      }
    }
  }
  return false;
}

/** The pure admission verdict over three WarpStates. */
export function admitDecision(base: WarpState, proposed: WarpState, selvage: WarpState): AdmitDecision {
  const empty = (): Omit<AdmitDecision, 'status'> => ({
    knots: [],
    dangling: [],
    confidence: null,
    rebasedOnto: null,
    agentChanged: [],
    otherChanged: [],
  });

  // The DIFF — not stateId equality — is the source of truth for "did meaning
  // change?" (mirrors #pick): stateId hashes the DEDUPED essence SET, so a
  // symbol whose before- AND after-essence both already exist elsewhere in the
  // tree leaves stateId unchanged while diff (keyed by stableKey) sees the
  // change. stateId equality therefore CANNOT short-circuit to NOOP — it would
  // drop a real admission invisibly. There is no safe stateId fast path in
  // either direction (inequality needs the diff anyway for agentChanged), so
  // always diff.
  const agentDelta = diff(base, proposed);
  if (agentDelta.deltas.size === 0 && agentDelta.renames.length === 0) {
    return { status: 'NOOP', ...empty() };
  }
  if (selvage.stateId === base.stateId) {
    return { status: 'FAST_ADMIT', ...empty(), agentChanged: symbolsOf(agentDelta) };
  }

  // Concurrent advance — re-base the agent's delta against the new selvage.
  const otherDelta = diff(base, selvage);
  const pred = predict(agentDelta, otherDelta);
  const agentChanged = symbolsOf(agentDelta);
  const otherChanged = symbolsOf(otherDelta);

  if (pred.dangling.length > 0) {
    return { status: 'DANGLE', knots: [], dangling: pred.dangling, confidence: null, rebasedOnto: selvage.stateId, agentChanged, otherChanged };
  }
  if (pred.knots.length > 0) {
    return { status: 'KNOT', knots: pred.knots, dangling: [], confidence: null, rebasedOnto: selvage.stateId, agentChanged, otherChanged };
  }
  const linked = dependencyAdjacent(new Set(agentChanged), new Set(otherChanged), [selvage, proposed]);
  return {
    status: 'CLEAN',
    knots: [],
    dangling: [],
    confidence: linked ? 'linked' : 'independent',
    rebasedOnto: selvage.stateId,
    agentChanged,
    otherChanged,
  };
}

export interface AdmitOptions {
  cwd?: string;
  agentId: string;
  /** the agent's proposed state, as a git ref or WORKTREE. */
  ref: string;
}

export interface AdmitResult {
  decision: AdmitDecision;
  /** true when the fabric was advanced (FAST_ADMIT, or a materialized CLEAN). */
  sealed: boolean;
  proposedStateId: string;
  /** the sealed strand (when sealed). */
  strand?: Strand;
  /** the merge plan (when a CLEAN admit was materialized). */
  merged?: MergePlan;
}

const blank = (status: AdmitStatus): AdmitDecision => ({
  status,
  knots: [],
  dangling: [],
  confidence: null,
  rebasedOnto: null,
  agentChanged: [],
  otherChanged: [],
});

/**
 * Run the admission protocol against the live fabric and PERFORM the merge.
 *  - FAST_ADMIT → seal the proposed state, advance selvage, clear scratch.
 *  - CLEAN → materialize the merged tree (base+ours+theirs via #materialize) and
 *    seal it; if materialization finds a byte conflict the meaning layer missed,
 *    downgrade to KNOT (never a silent wrong-merge). Needs git refs for ours/base/
 *    theirs; a WORKTREE proposal or a state with no git anchor returns CLEAN unsealed.
 *  - KNOT / DANGLE / NOOP → no seal.
 */
/**
 * Seed calibratedConfidence from the gate rule (Loid's moat): a 'linked' CLEAN
 * admit is trustworthy (Merkle would surface a real conflict); an 'independent'
 * one carries the false-AUTOFOLD blind-spot risk, so it starts hedged. The
 * survive/overturn grader later moves these against real outcome.
 */
function priorFor(d: AdmitDecision): number | null {
  if (d.status === 'CLEAN') return d.confidence === 'linked' ? 0.9 : 0.6;
  if (d.status === 'FAST_ADMIT') return 0.8;
  return null;
}

/** A resolved byte source for one side of a 3-way merge. */
type MergeInput = { kind: 'git'; ref: string } | { kind: 'native'; treeId: string };

/**
 * Resolve a merge side (base or theirs) to a byte source (H1 relaxation, PR-B).
 *
 *  - A NORMAL strand contributes its git commit (UNCHANGED pre-relaxation posture):
 *    no commit ⇒ null (fail closed, exactly as before).
 *  - A MERGE strand's gitCommit is only ONE parent and lacks the merged bytes — so
 *    it contributes its durable binding.treeId instead: the merged tree an earlier
 *    CLEAN admit content-addressed into the object store IS the second-parent bytes.
 *    A merge strand whose bytes were NEVER bound (no binding, or the object is
 *    absent) is genuinely unreconstructable ⇒ null (fail closed — never a wrong
 *    3rd-generation merge).
 *
 * The relaxation is deliberately narrow: ONLY "a merge strand with a durable
 * binding.treeId is a valid merge input." A normal strand is never redirected to its
 * binding here, so the common (no-merge-input) path stays byte-for-byte unchanged.
 */
function resolveMergeInput(strand: Strand | undefined, gitCommit: string | null, store: ObjectStore): MergeInput | null {
  if (!strand) return null;
  if (strand.merged) {
    const treeId = strand.binding?.treeId;
    return treeId && store.has(treeId) ? { kind: 'native', treeId } : null;
  }
  return gitCommit ? { kind: 'git', ref: gitCommit } : null;
}

export async function admit(root: string, opts: AdmitOptions): Promise<AdmitResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root); // native byte store (M1b bind-on-seal)

  // Lift proposed + resolve attribution OUTSIDE the lock (expensive / selvage-
  // independent). proposed is NOT eagerly persisted — sealState putStates only
  // what actually seals (no .warpline/states litter on a NOOP — Reviewer M4).
  const proposed = await absorb(opts.ref, { cwd });
  const isWorktree = opts.ref === WORKTREE_REF;
  const oursCommit = isWorktree ? null : await revParse(opts.ref, { cwd }).catch(() => null);
  const actor =
    (isWorktree ? null : await commitAuthor(opts.ref, { cwd }).catch(() => null)) ??
    (await gitUserName({ cwd })) ??
    'unknown';
  const intent = isWorktree
    ? 'uncommitted worktree state'
    : (await commitSubject(opts.ref, { cwd }).catch(() => '')) || `admit ${opts.agentId}`;
  const now = new Date().toISOString();

  // The read-decide-seal critical section runs under the fabric lock so concurrent
  // admits can't lose a write (Reviewer C1). CLEAN materialization (git ops) runs
  // inside too, so the decision and the seal are atomic against the live selvage.
  return withFabricLock(root, async () => {
    const baseId = readScratch(root, opts.agentId) ?? readSelvage(wdir);
    const selvageId = readSelvage(wdir);
    const base = baseId ? store.loadState(baseId) : undefined;
    const selvage = selvageId ? store.loadState(selvageId) : undefined;

    // A SET tip/base that we cannot LOAD is corruption or a regen-gap in the
    // states cache — NOT an empty fabric. Fast-admitting here would seal a fresh
    // genesis and ORPHAN the real history (silent data loss). Fail CLOSED: the
    // caller must re-absorb the referenced state or repair .warpline/.
    if (selvageId && !selvage) {
      throw new Error(
        `warpline: selvage points at ${selvageId} but that state cannot be loaded (states/ cache missing or corrupt) — refusing to fast-admit over existing history. Re-absorb the tip or repair .warpline/.`,
      );
    }
    if (baseId && !base) {
      throw new Error(
        `warpline: base points at ${baseId} but that state cannot be loaded — refusing to fast-admit over existing history. Re-absorb the base or repair .warpline/.`,
      );
    }

    // Genuinely empty fabric (no tip ever sealed) → fast-admit the proposed state.
    if (!base || !selvage) {
      const treeId = await snapshotState(objStore, opts.ref, cwd, { cwd });
      const strand = sealState(root, store, proposed, {
        parentStateId: selvageId ?? null, actor, intent, gitCommit: oursCommit, now, confidence: 0.8,
        authoredBy: { agentId: opts.agentId },
        binding: { treeId, gitOid: proposed.treeSha ?? null },
      });
      clearScratch(root, opts.agentId);
      return { decision: blank('FAST_ADMIT'), sealed: true, proposedStateId: proposed.stateId, strand };
    }

    const decision = admitDecision(base, proposed, selvage);

    if (decision.status === 'NOOP') {
      return { decision, sealed: false, proposedStateId: proposed.stateId };
    }
    if (decision.status === 'FAST_ADMIT') {
      // Incremental snapshot anchored on the tip strand (selvage === base here):
      // the proposed ref usually differs from the tip by one agent's edits, so
      // the snapshot costs the DIFF, not the universe. Unverifiable ⇒ full path.
      const fabric = readFabric(wdir);
      const tipStrand = [...fabric].reverse().find((s) => s.stateId === selvageId);
      const anchor = await strandSnapshotAnchor(tipStrand, objStore, { cwd });
      const treeId = await snapshotState(objStore, opts.ref, cwd, { cwd }, anchor);
      const strand = sealState(root, store, proposed, {
        parentStateId: selvageId, actor, intent, gitCommit: oursCommit, now, confidence: priorFor(decision),
        authoredBy: { agentId: opts.agentId },
        binding: { treeId, gitOid: proposed.treeSha ?? null },
      });
      clearScratch(root, opts.agentId);
      return { decision, sealed: true, proposedStateId: proposed.stateId, strand };
    }
    if (decision.status === 'CLEAN') {
      const fabric = readFabric(wdir);
      const baseStrand = fabric.find((s) => s.stateId === baseId);
      const theirsStrand = fabric.find((s) => s.stateId === selvageId);
      const baseCommit = baseStrand?.provenance?.gitCommit ?? null;
      const theirsCommit = theirsStrand?.provenance?.gitCommit ?? null;

      // `ours` is the agent's proposal: a WORKTREE proposal has no durable committed
      // tree to merge from → fail CLOSED (unchanged posture).
      if (isWorktree) {
        return { decision, sealed: false, proposedStateId: proposed.stateId };
      }

      // Resolve base/theirs to byte sources. H1 relaxation (PR-B): a MERGE strand
      // contributes its durable binding.treeId (the merged bytes an earlier CLEAN
      // admit content-addressed) rather than failing closed on its single-parent
      // commit. A side reconstructable via NEITHER a commit NOR a durable binding →
      // null → fail CLOSED (never a wrong 3rd-generation merge).
      const baseInput = resolveMergeInput(baseStrand, baseCommit, objStore);
      const theirsInput = resolveMergeInput(theirsStrand, theirsCommit, objStore);
      if (!baseInput || !theirsInput) {
        return { decision, sealed: false, proposedStateId: proposed.stateId };
      }

      // Seal a materialized CLEAN merge: pin the result as BOTH binding.treeId and
      // merge.result (so verify's `merge.result === binding.treeId` holds) and carry
      // the base strand's pickId as the second DAG parent. Confidence uses the SAME
      // gate rule (linked/independent over base/proposed/selvage) as a 1st-generation
      // merge — the rule does not re-examine a merge input's internal provenance, an
      // honest v2 limitation (the graded outcome corpus, not the prior, carries it).
      const sealMerge = (state: WarpState, plan: MergePlan, recipe: MergeRecipe): AdmitResult => {
        const strand = sealState(root, store, state, {
          parentStateId: selvageId, actor, intent, gitCommit: oursCommit, now, confidence: priorFor(decision),
          authoredBy: { agentId: opts.agentId },
          mergeParentPickId: baseStrand?.pickId ?? null, // the SECOND DAG parent (the ours-side fork base)
          merged: true, binding: { treeId: recipe.result, gitOid: null }, merge: recipe,
        });
        clearScratch(root, opts.agentId);
        return { decision, sealed: true, proposedStateId: proposed.stateId, strand, merged: plan };
      };

      if (baseInput.kind === 'git' && theirsInput.kind === 'git') {
        // COMMON PATH (unchanged): neither side is a merge strand — the git-ref 3-way
        // materialize + compositional capture, exactly as before the relaxation.
        const mat = await materializeMergedState(baseInput.ref, opts.ref, theirsInput.ref, { cwd });
        if (mat.state && mat.plan.conflicts.length === 0) {
          // A2: capture durable merged BYTES compositionally (base tree via cat-file +
          // the merge's own byte changes) — never the git-archive temp dir. The recipe
          // makes the merge both restorable (result) and re-derivable (3 parent trees).
          // Anchor the base snapshot on the base strand's verified binding (ours/
          // theirs then anchor on the base tree inside captureMerge) — the three
          // whole-universe snapshots become three diffs (T-2026-07-04-003).
          const baseAnchor = await strandSnapshotAnchor(baseStrand, objStore, { cwd });
          const recipe = await captureMerge(objStore, baseInput.ref, opts.ref, theirsInput.ref, mat.plan.files, { cwd }, baseAnchor);
          return sealMerge(mat.state, mat.plan, recipe);
        }
        // The meaning layer said CLEAN but the bytes overlap → surface as a KNOT.
        return { decision: { ...decision, status: 'KNOT' }, sealed: false, proposedStateId: proposed.stateId, merged: mat.plan };
      }

      // RELAXED PATH: at least one side is a merge strand contributing its durable
      // tree. Normalize ALL THREE sides to native treeIds (merge strand → binding;
      // normal strand / ours → snapshotRef of its commit) and run the whole 3-way
      // merge off the object store — the second-parent bytes are natively present.
      // Snapshots are anchored where verifiable (strand bindings / the fork base's
      // git ref) so each costs its diff, not the universe (T-2026-07-04-003).
      const baseTree =
        baseInput.kind === 'native'
          ? baseInput.treeId
          : await snapshotRef(objStore, baseInput.ref, { cwd }, await strandSnapshotAnchor(baseStrand, objStore, { cwd }));
      const theirsTree =
        theirsInput.kind === 'native'
          ? theirsInput.treeId
          : await snapshotRef(objStore, theirsInput.ref, { cwd }, await strandSnapshotAnchor(theirsStrand, objStore, { cwd }));
      // Ours can only anchor on a side that still has a GIT ref to diff against.
      const oursAnchor: SnapshotAnchor | undefined =
        baseInput.kind === 'git'
          ? { ref: baseInput.ref, treeId: baseTree }
          : theirsInput.kind === 'git'
            ? { ref: theirsInput.ref, treeId: theirsTree }
            : undefined;
      const oursTree = await snapshotRef(objStore, opts.ref, { cwd }, oursAnchor);
      const mat = await materializeMergedStateNative(objStore, baseTree, oursTree, theirsTree);
      if (mat.state && mat.plan.conflicts.length === 0 && mat.resultTreeId) {
        const recipe: MergeRecipe = { algo: 'warpline-merge3-v1', base: baseTree, ours: oursTree, theirs: theirsTree, result: mat.resultTreeId };
        return sealMerge(mat.state, mat.plan, recipe);
      }
      // Meaning CLEAN but bytes overlap (or a genuinely unmergeable entry) → KNOT.
      return { decision: { ...decision, status: 'KNOT' }, sealed: false, proposedStateId: proposed.stateId, merged: mat.plan };
    }
    // KNOT / DANGLE
    return { decision, sealed: false, proposedStateId: proposed.stateId };
  });
}
