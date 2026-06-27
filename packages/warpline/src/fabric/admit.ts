/**
 * #admit — the multi-writer WRITE side (Phase C v1, decision-level). The protocol
 * that lets N agents commit concurrently into one WARP without git's shared-tree
 * collision: each agent forks a #scratch at a base selvage, edits, then ADMITS.
 *
 * admitDecision(base, proposed, selvage) is the pure verdict:
 *   - NOOP        : the agent changed no meaning (proposed ≡ base).
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
import { revParse, commitAuthor, commitSubject, gitUserName } from '../git/git-exec.js';
import { warplineDirOf, readSelvage, readFabric } from './fabric.js';
import { readScratch, clearScratch } from './scratch.js';
import type { Strand } from './strand.js';
import { sealState } from './seal.js';
import { withFabricLock } from './lock.js';
import { materializeMergedState, type MergePlan } from './materialize.js';

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

  if (proposed.stateId === base.stateId) {
    return { status: 'NOOP', ...empty() };
  }
  if (selvage.stateId === base.stateId) {
    const agentDelta = diff(base, proposed);
    return { status: 'FAST_ADMIT', ...empty(), agentChanged: symbolsOf(agentDelta) };
  }

  // Concurrent advance — re-base the agent's delta against the new selvage.
  const agentDelta = diff(base, proposed);
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

export async function admit(root: string, opts: AdmitOptions): Promise<AdmitResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });

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

    // Empty fabric (or unreadable base) → fast-admit the proposed state.
    if (!base || !selvage) {
      const strand = sealState(root, store, proposed, { parentStateId: selvageId ?? null, actor, intent, gitCommit: oursCommit, now, confidence: 0.8 });
      clearScratch(root, opts.agentId);
      return { decision: blank('FAST_ADMIT'), sealed: true, proposedStateId: proposed.stateId, strand };
    }

    const decision = admitDecision(base, proposed, selvage);

    if (decision.status === 'NOOP') {
      return { decision, sealed: false, proposedStateId: proposed.stateId };
    }
    if (decision.status === 'FAST_ADMIT') {
      const strand = sealState(root, store, proposed, { parentStateId: selvageId, actor, intent, gitCommit: oursCommit, now, confidence: priorFor(decision) });
      clearScratch(root, opts.agentId);
      return { decision, sealed: true, proposedStateId: proposed.stateId, strand };
    }
    if (decision.status === 'CLEAN') {
      const fabric = readFabric(wdir);
      const baseStrand = fabric.find((s) => s.stateId === baseId);
      const theirsStrand = fabric.find((s) => s.stateId === selvageId);
      const baseCommit = baseStrand?.provenance?.gitCommit ?? null;
      const theirsCommit = theirsStrand?.provenance?.gitCommit ?? null;
      // H1: a MERGE strand's gitCommit is ONE parent and lacks the merged bytes, so
      // re-basing base/theirs off it would mis-materialize. Fail CLOSED (unsealed)
      // rather than produce a wrong 3rd-generation merge.
      if (isWorktree || !baseCommit || !theirsCommit || baseStrand?.merged || theirsStrand?.merged) {
        return { decision, sealed: false, proposedStateId: proposed.stateId };
      }
      const mat = await materializeMergedState(baseCommit, opts.ref, theirsCommit, { cwd });
      if (mat.state && mat.plan.conflicts.length === 0) {
        const strand = sealState(root, store, mat.state, { parentStateId: selvageId, actor, intent, gitCommit: oursCommit, now, confidence: priorFor(decision), merged: true });
        clearScratch(root, opts.agentId);
        return { decision, sealed: true, proposedStateId: proposed.stateId, strand, merged: mat.plan };
      }
      // The meaning layer said CLEAN but the bytes overlap → surface as a KNOT.
      return { decision: { ...decision, status: 'KNOT' }, sealed: false, proposedStateId: proposed.stateId, merged: mat.plan };
    }
    // KNOT / DANGLE
    return { decision, sealed: false, proposedStateId: proposed.stateId };
  });
}
