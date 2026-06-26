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

import { absorb } from '../absorb.js';
import { diff, type SemDeltaSet } from '../sem-delta.js';
import { predict, type Knot, type Dangle } from '../predict.js';
import { WarpStore } from '../warp/store.js';
import type { WarpState } from '../warp/warp-state.js';
import { warplineDirOf, readSelvage } from './fabric.js';
import { readScratch } from './scratch.js';

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
  /** true only when v1 actually advanced the fabric (FAST_ADMIT). */
  sealed: boolean;
  proposedStateId: string;
}

/**
 * Run the admission protocol against the live fabric for an agent's scratch.
 * v1 seals ONLY on FAST_ADMIT (a complete state); CLEAN (materialization v2),
 * KNOT, and DANGLE return the verdict for the caller to surface/resolve.
 */
export async function admit(root: string, opts: AdmitOptions): Promise<AdmitResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });

  const baseId = readScratch(root, opts.agentId) ?? readSelvage(wdir);
  const selvageId = readSelvage(wdir);
  const proposed = await absorb(opts.ref, { cwd });
  store.putState(proposed);

  const base = baseId ? store.loadState(baseId) : undefined;
  const selvage = selvageId ? store.loadState(selvageId) : undefined;

  // No base/selvage yet (empty fabric) → treat as a fast admit of the first state.
  if (!base || !selvage) {
    return {
      decision: { status: 'FAST_ADMIT', knots: [], dangling: [], confidence: null, rebasedOnto: null, agentChanged: [], otherChanged: [] },
      sealed: false,
      proposedStateId: proposed.stateId,
    };
  }

  const decision = admitDecision(base, proposed, selvage);
  return { decision, sealed: false, proposedStateId: proposed.stateId };
}
