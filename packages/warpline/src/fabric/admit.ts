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
import { warplineDirOf, readSelvage, readFabric, appendStrand, writeSelvage } from './fabric.js';
import { readScratch, clearScratch } from './scratch.js';
import { computePickId, type Strand, type StrandDelta } from './strand.js';
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

const EMPTY_DELTA: StrandDelta = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

function summarizeDelta(parent: WarpState | undefined, state: WarpState): StrandDelta {
  if (!parent) return { ...EMPTY_DELTA };
  const d = diff(parent, state);
  const born: string[] = [];
  const retired: string[] = [];
  const contractChanged: string[] = [];
  for (const x of d.deltas.values()) {
    if (x.kind === 'symbol-born') born.push(x.symbol);
    else if (x.kind === 'symbol-retired') retired.push(x.symbol);
    else if (x.kind === 'contract-changed') contractChanged.push(x.symbol);
  }
  return { born: born.sort(), retired: retired.sort(), contractChanged: contractChanged.sort(), renamedNoop: d.renames.length };
}

/** Seal a (pre-absorbed) WarpState as a fabric strand and advance the selvage. */
function sealState(
  root: string,
  store: WarpStore,
  state: WarpState,
  parentStateId: string | null,
  actor: string,
  intent: string,
  gitCommit: string | null,
  now: string,
): Strand {
  const wdir = warplineDirOf(root);
  store.putState(state);
  const seq = readFabric(wdir).length;
  const parent = parentStateId ? store.loadState(parentStateId) : undefined;
  const body = {
    schemaVersion: 1 as const,
    seq,
    stateId: state.stateId,
    parentStateId,
    actor,
    intent,
    recordedAt: now,
    objectCount: state.objects.size,
    delta: summarizeDelta(parent, state),
    calibratedConfidence: null,
    provenance: { ref: state.ref, treeSha: state.treeSha, gitCommit },
  };
  const strand: Strand = { ...body, pickId: computePickId(body) };
  appendStrand(wdir, strand);
  writeSelvage(wdir, state.stateId);
  return strand;
}

/** The git commit a fabric state was sealed from (its coexistence anchor), if any. */
function commitOfState(root: string, stateId: string): string | null {
  for (const s of readFabric(warplineDirOf(root))) {
    if (s.stateId === stateId) return s.provenance?.gitCommit ?? null;
  }
  return null;
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
export async function admit(root: string, opts: AdmitOptions): Promise<AdmitResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });

  const baseId = readScratch(root, opts.agentId) ?? readSelvage(wdir);
  const selvageId = readSelvage(wdir);
  const proposed = await absorb(opts.ref, { cwd });
  store.putState(proposed);

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

  const base = baseId ? store.loadState(baseId) : undefined;
  const selvage = selvageId ? store.loadState(selvageId) : undefined;

  // Empty fabric (or unreadable base) → fast-admit the proposed state.
  if (!base || !selvage) {
    const strand = sealState(root, store, proposed, selvageId ?? null, actor, intent, oursCommit, now);
    clearScratch(root, opts.agentId);
    return { decision: blank('FAST_ADMIT'), sealed: true, proposedStateId: proposed.stateId, strand };
  }

  const decision = admitDecision(base, proposed, selvage);

  if (decision.status === 'NOOP') {
    return { decision, sealed: false, proposedStateId: proposed.stateId };
  }
  if (decision.status === 'FAST_ADMIT') {
    const strand = sealState(root, store, proposed, selvageId, actor, intent, oursCommit, now);
    clearScratch(root, opts.agentId);
    return { decision, sealed: true, proposedStateId: proposed.stateId, strand };
  }
  if (decision.status === 'CLEAN') {
    const baseCommit = commitOfState(root, baseId!);
    const theirsCommit = commitOfState(root, selvageId!);
    if (isWorktree || !baseCommit || !theirsCommit) {
      return { decision, sealed: false, proposedStateId: proposed.stateId }; // can't materialize without git refs
    }
    const mat = await materializeMergedState(baseCommit, opts.ref, theirsCommit, { cwd });
    if (mat.state && mat.plan.conflicts.length === 0) {
      const strand = sealState(root, store, mat.state, selvageId, actor, intent, oursCommit, now);
      clearScratch(root, opts.agentId);
      return { decision, sealed: true, proposedStateId: proposed.stateId, strand, merged: mat.plan };
    }
    // The meaning layer said CLEAN but the bytes overlap → surface as a KNOT.
    return { decision: { ...decision, status: 'KNOT' }, sealed: false, proposedStateId: proposed.stateId, merged: mat.plan };
  }
  // KNOT / DANGLE
  return { decision, sealed: false, proposedStateId: proposed.stateId };
}
