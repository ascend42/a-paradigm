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
 *   - CLAIM-BREACH: (P2.3, forge-spec §3b — claim-layer only, never returned by
 *                   admitDecision) the admission was judged against a pre-declared
 *                   claim:v1 and the computed touched set escaped the claimed set.
 *                   FAIL-SAFE, not fail-hard: the admit is HELD (refused, unsealed,
 *                   with the exact excess set) — overridable via acceptBreach,
 *                   which seals the underlying verdict but records the breach fact
 *                   in the claims sidecar (see claim.ts; G5).
 *   - HELD        : (P3 Lane A2, forge-spec §1d — trust-layer only, never returned
 *                   by admitDecision) an independent-confidence CLEAN touching a
 *                   symbol whose GRADED survival (grades.jsonl sidecar; ≥K graded
 *                   outcomes, min across touched symbols) is below the floor. Same
 *                   fail-safe mechanics as CLAIM-BREACH: refused, unsealed, selvage
 *                   unmoved, report names the symbol + survival + n — overridable
 *                   via acceptRisk, which seals and records the override in
 *                   .warpline/grades-escalations.jsonl (see grade.ts; G5).
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
import { buildKnotPayload, persistKnotPayload, readFileFromTree } from './knot-payload.js';
import { classifyMergePaths, type MergeCoverage } from '../honesty.js';
import { readClaim, evaluateClaim, recordClaimEvaluation, type Claim, type ClaimEvaluation } from './claim.js';
import { readGradeSidecar, symbolSurvivalIndex, evaluateEscalation, recordGradeEscalation, type GradeEscalation } from './grade.js';

export type AdmitStatus = 'NOOP' | 'FAST_ADMIT' | 'CLEAN' | 'KNOT' | 'DANGLE' | 'CLAIM-BREACH' | 'HELD';
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
  /**
   * P2.3 (forge-spec §3b, G1-additive, OPT-IN): judge this admission against a
   * pre-declared claim — a claimId (or ≥12-char prefix) persisted by the
   * propose API (`warpline propose` / createClaim+persistClaim). Absent ⇒ the
   * admit behaves EXACTLY as before claims existed. The claim must verify
   * (untampered) and belong to `agentId` — anything else fails closed.
   */
  claim?: string;
  /**
   * Explicit CLAIM-BREACH override: seal the underlying verdict anyway, but
   * record the breach fact (acceptedBreach) in the claims sidecar stream.
   * Never silent — the breach still lands in AdmitResult.claim and the JSONL row.
   */
  acceptBreach?: boolean;
  /**
   * Explicit trust-floor HELD override (P3 Lane A2, §1d): seal the underlying
   * CLEAN verdict despite the low-survival escalation. Never silent — the
   * escalation lands in AdmitResult.escalation AND as an override row in
   * .warpline/grades-escalations.jsonl (G5).
   */
  acceptRisk?: boolean;
}

/**
 * The claim judgment attached to an admit that carried a claim (P2.3, §3b).
 * Additive: absent whenever no claim was supplied.
 */
export interface AdmitClaimReport {
  claimId: string;
  /** the pre-declared symbol set the decision was judged against. */
  claimedSymbols: string[];
  breach: boolean;
  /** changed-but-unclaimed symbols that count (direct, or ripple-only-but-knotting). */
  excess: string[];
  /** claimed-but-untouched symbols — recorded, never a breach. */
  missing: string[];
  /** on a CLAIM-BREACH refusal: the verdict class the admission carried before the claim gate. */
  underlyingStatus?: AdmitStatus;
  /** true when the breach was explicitly overridden (acceptBreach). */
  acceptedBreach?: boolean;
}

/**
 * The trust-floor escalation attached to an admit the grades sidecar HELD
 * (P3 Lane A2, forge-spec §1d). Additive: absent whenever no escalation fired.
 */
export interface AdmitEscalationReport extends GradeEscalation {
  /** the verdict class the admission carried before the trust gate (always CLEAN at v1). */
  underlyingStatus: AdmitStatus;
  /** true when the escalation was explicitly overridden (acceptRisk). */
  acceptedRisk?: boolean;
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
  /**
   * P2.2 (forge-spec §3a, G1-additive): the content address of the persisted
   * machine-readable KNOT payload (`.warpline/knots/`) — a POINTER, never the
   * payload inline, so existing JSON consumers are untouched. Present only on a
   * meaning-level KNOT/DANGLE verdict; hydrate via `warpline knot show <id>` or
   * readKnotPayload().
   */
  knotPayloadId?: string;
  /**
   * P2.3 (§3b, G1-additive): the claim judgment — present ONLY when the admit
   * carried a claim. Every judgment is also appended to
   * .warpline/claims/evaluations.jsonl (the calibration-probe stream, G5).
   */
  claim?: AdmitClaimReport;
  /**
   * P3 GAP-1 (G1-additive): per-path HONESTY labels for a materialized CLEAN
   * merge — which tier GOVERNED each changed path (meaning-decided / byte-decided
   * / derived) + the aggregate counts (#honesty). Presentation data, never a
   * verdict input. Present only when a CLEAN admit materialized.
   */
  coverage?: MergeCoverage;
  /**
   * P3 Lane A2 (§1d, G1-additive): the trust-floor escalation — present ONLY
   * when an independent-CLEAN touched a below-floor symbol (HELD, or sealed via
   * acceptRisk with the override row recorded in grades-escalations.jsonl).
   */
  escalation?: AdmitEscalationReport;
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

  // P2.3 — resolve the pre-declared claim BEFORE the lock (read-only sidecar).
  // A named-but-unresolvable or tampered claim fails CLOSED: the caller asked
  // for claim semantics, and silently judging unclaimed would corrupt the
  // calibration stream. So does an agent mismatch — a claim grades ITS author.
  let claim: Claim | null = null;
  if (opts.claim) {
    claim = readClaim(root, opts.claim);
    if (!claim) {
      throw new Error(
        `warpline: admit --claim ${opts.claim} — no verified claim matches (missing, tampered, or a <12-char prefix). Claims are created by \`warpline propose\` (.warpline/claims/) — fail closed.`,
      );
    }
    if (claim.agentId !== opts.agentId) {
      throw new Error(
        `warpline: admit --claim ${claim.claimId} belongs to agent ${JSON.stringify(claim.agentId)}, not ${JSON.stringify(opts.agentId)} — a claim grades its own author (fail closed).`,
      );
    }
  }

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

    // P2.3 — the claim judgment, attached to whatever result this admit returns.
    // Reaching withClaim with a breach means the gate PASSED via acceptBreach
    // (the refusal path returns before any seal) — record the override fact.
    // Every judgment (breach or not, sealed or not) lands as a sidecar JSONL
    // row: the calibration-probe stream (§3b duty 2; G5 — never a strand field).
    let claimEval: ClaimEvaluation | null = null;
    const withClaim = (r: AdmitResult): AdmitResult => {
      if (!claim || !claimEval) return r;
      const accepted = claimEval.breach ? { acceptedBreach: true } : {};
      recordClaimEvaluation(root, {
        claimId: claim.claimId,
        pickId: r.strand?.pickId ?? null,
        agentId: opts.agentId,
        breach: claimEval.breach,
        excess: claimEval.excess,
        missing: claimEval.missing,
        ...accepted,
        ts: now,
      });
      return {
        ...r,
        claim: {
          claimId: claim.claimId,
          claimedSymbols: [...claim.claimedSymbols],
          breach: claimEval.breach,
          excess: claimEval.excess,
          missing: claimEval.missing,
          ...accepted,
        },
      };
    };

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
      const genesis = blank('FAST_ADMIT');
      // A claim on genesis is judged against the blank decision: with no base
      // there is no computed delta, so agentChanged=[] ⇒ excess=[] (no breach),
      // missing = the whole claimed set. Recorded like any other evaluation.
      if (claim) claimEval = evaluateClaim(genesis, claim);
      const treeId = await snapshotState(objStore, opts.ref, cwd, { cwd });
      const strand = sealState(root, store, proposed, {
        parentStateId: selvageId ?? null, actor, intent, gitCommit: oursCommit, now, confidence: 0.8,
        authoredBy: { agentId: opts.agentId },
        binding: { treeId, gitOid: proposed.treeSha ?? null },
      });
      clearScratch(root, opts.agentId);
      return withClaim({ decision: genesis, sealed: true, proposedStateId: proposed.stateId, strand });
    }

    const decision = admitDecision(base, proposed, selvage);

    // P2.3 — THE CLAIM GATE (§3b duty 1, the honesty check). Judged strictly
    // BEFORE any seal so a breach can never silently land. FAIL-SAFE: a breach
    // HOLDS the admission (refused, unsealed, exact excess/missing surfaced as
    // the CLAIM-BREACH verdict class) rather than crashing or silently sealing;
    // acceptBreach is the explicit override — the underlying verdict then
    // proceeds, with the breach fact recorded (withClaim). The gate reads ONLY
    // structural fields (symbol sets, localChanged, knots) — never prose (§3d).
    // HELD takes precedence over KNOT/DANGLE side-work: no knot payload is
    // persisted for a held admission (re-admit after the claim is squared).
    if (claim) {
      claimEval = evaluateClaim(decision, claim, { agentDelta: diff(base, proposed) });
      if (claimEval.breach && !opts.acceptBreach) {
        recordClaimEvaluation(root, {
          claimId: claim.claimId, pickId: null, agentId: opts.agentId,
          breach: true, excess: claimEval.excess, missing: claimEval.missing, ts: now,
        });
        return {
          decision: { ...decision, status: 'CLAIM-BREACH' },
          sealed: false,
          proposedStateId: proposed.stateId,
          claim: {
            claimId: claim.claimId,
            claimedSymbols: [...claim.claimedSymbols],
            breach: true,
            excess: claimEval.excess,
            missing: claimEval.missing,
            underlyingStatus: decision.status,
          },
        };
      }
    }

    // P3 Lane A2 — THE TRUST-FLOOR ESCALATION (forge-spec §1d: the permission
    // model IS the scrutiny policy; TD-2026-07-16-426 organic arm). The FIRST
    // consumer of the grades sidecar: an independent-confidence CLEAN — the
    // autoClean class the false-AUTOFOLD gate proved blind — touching a symbol
    // whose graded survival is below the floor is HELD (same fail-safe mechanics
    // as CLAIM-BREACH: refused, unsealed, selvage unmoved), overridable via an
    // explicit acceptRisk that seals AND records the override (G5 sidecar row).
    // PURE over (decision, sidecar snapshot); the sidecar is read only on the
    // independent-CLEAN path, so every other path is byte-identical to before.
    // Claim gate FIRST (above): an honest claim is judged before trust is.
    const escalation =
      decision.status === 'CLEAN' && decision.confidence === 'independent'
        ? evaluateEscalation(decision, symbolSurvivalIndex(readGradeSidecar(root)))
        : null;
    if (escalation && !opts.acceptRisk) {
      return withClaim({
        decision: { ...decision, status: 'HELD' },
        sealed: false,
        proposedStateId: proposed.stateId,
        escalation: { ...escalation, underlyingStatus: decision.status },
      });
    }
    // Attach (and record) an acceptRisk-overridden escalation on whatever the
    // CLEAN path returns — the override is never silent, sealed or not.
    const withEscalation = (r: AdmitResult): AdmitResult => {
      if (!escalation) return r;
      recordGradeEscalation(root, {
        agentId: opts.agentId,
        pickId: r.strand?.pickId ?? null,
        ...escalation,
        acceptedRisk: true,
        ts: now,
      });
      return { ...r, escalation: { ...escalation, underlyingStatus: decision.status, acceptedRisk: true } };
    };

    if (decision.status === 'NOOP') {
      return withClaim({ decision, sealed: false, proposedStateId: proposed.stateId });
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
      return withClaim({ decision, sealed: true, proposedStateId: proposed.stateId, strand });
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
        return withClaim(withEscalation({ decision, sealed: false, proposedStateId: proposed.stateId }));
      }

      // Resolve base/theirs to byte sources. H1 relaxation (PR-B): a MERGE strand
      // contributes its durable binding.treeId (the merged bytes an earlier CLEAN
      // admit content-addressed) rather than failing closed on its single-parent
      // commit. A side reconstructable via NEITHER a commit NOR a durable binding →
      // null → fail CLOSED (never a wrong 3rd-generation merge).
      const baseInput = resolveMergeInput(baseStrand, baseCommit, objStore);
      const theirsInput = resolveMergeInput(theirsStrand, theirsCommit, objStore);
      if (!baseInput || !theirsInput) {
        return withClaim(withEscalation({ decision, sealed: false, proposedStateId: proposed.stateId }));
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
        // P3 GAP-1 honesty labels (additive): classify every changed path by the
        // tier that governed it, against the merge inputs + the merged result.
        const coverage = classifyMergePaths(plan.files.keys(), [state, proposed, selvage]);
        return withClaim(withEscalation({ decision, sealed: true, proposedStateId: proposed.stateId, strand, merged: plan, coverage }));
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
        return withClaim({ decision: { ...decision, status: 'KNOT' }, sealed: false, proposedStateId: proposed.stateId, merged: mat.plan });
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
      return withClaim({ decision: { ...decision, status: 'KNOT' }, sealed: false, proposedStateId: proposed.stateId, merged: mat.plan });
    }
    // KNOT / DANGLE — detection alone relocates the bottleneck (R3): attach the
    // machine-readable resolution payload (forge-spec §3a) so a resolver agent
    // can act from the payload alone. The verdict is already decided above from
    // STRUCTURAL inputs only; the payload is derived evidence (G5 sidecar), so a
    // payload-build failure degrades to a verdict without a payload pointer —
    // it must never turn a KNOT into a crash (detection stays fail-closed).
    let knotPayloadId: string | undefined;
    try {
      const fabric = readFabric(wdir);
      const baseStrand = fabric.find((s) => s.stateId === baseId);
      const theirsStrand = fabric.find((s) => s.stateId === selvageId);
      // Durably snapshot OURS (the unsealed proposal): the payload's byte
      // authority is the object store, and a KNOT proposal was never sealed, so
      // its bytes are not yet content-addressed. Anchored on the tip strand's
      // verified binding — costs the diff, not the universe (T-2026-07-04-003).
      const oursAnchor = await strandSnapshotAnchor(theirsStrand, objStore, { cwd });
      const oursTree = await snapshotState(objStore, opts.ref, cwd, { cwd }, oursAnchor);
      const payload = buildKnotPayload({
        decision,
        base,
        proposed,
        selvage,
        ours: {
          agentId: opts.agentId,
          actor,
          intent,
          ref: opts.ref,
          gitCommit: oursCommit,
          treeId: oursTree,
        },
        theirs: {
          agentId: theirsStrand?.authoredBy?.agentId ?? null,
          actor: theirsStrand?.actor ?? 'unknown',
          intent: theirsStrand?.intent ?? '',
          ref: theirsStrand?.provenance?.ref ?? null,
          gitCommit: theirsStrand?.provenance?.gitCommit ?? null,
          treeId: theirsStrand?.binding?.treeId ?? null,
        },
        baseTreeId: baseStrand?.binding?.treeId ?? null,
        readFile: (treeId, rel) => readFileFromTree(objStore, treeId, rel),
      });
      persistKnotPayload(root, payload);
      knotPayloadId = payload.payloadId;
    } catch {
      /* payload is auxiliary — the KNOT/DANGLE verdict stands without it */
    }
    return withClaim({ decision, sealed: false, proposedStateId: proposed.stateId, ...(knotPayloadId ? { knotPayloadId } : {}) });
  });
}
