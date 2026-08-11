/**
 * #native-write-path — Phase 0 of NATIVE-FIRST (arky-architecture.md §2.1, the
 * keystone; roadmap-native-first.md "PHASE 0"; ratified D2, TD-2026-07-17-085):
 * the worktree→pick→admit loop with NO git anywhere. T-030's successor, promoted
 * from residue to the central write path of the product.
 *
 *   1. FORK    — `forkNative` mints the agent's scratch ref
 *                (.warpline/refs/scratch/<agentId>) at the current selvage
 *                pickId (I9: base is a pickId, forever), optionally restoring
 *                the base tree into the agent's directory.
 *   2. PROPOSE — `proposeNative` SEALS A SCRATCH STRAND from the worktree:
 *                snapshotDir (native walk — bytes first), absorb FROM THE STORE
 *                (restoreTree → lens; I2 — the sealed meaning provably
 *                corresponds to the snapshotted bytes), then a v3 strand
 *                (buildStrandV3, bind-on-seal, parents=[scratch base], claim
 *                attached via the claims sidecar, provenance git-null — I4) and
 *                the SCRATCH ref alone advances. The proposal is durable,
 *                addressable, and exchangeable BEFORE judgment (D2).
 *   3. ADMIT   — `admitNative` weaves scratch-tip × selvage through the
 *                EXISTING decision engine (admitDecision + claim gate + trust
 *                floor, verbatim), materializes via materializeMergedStateNative
 *                ONLY (no git merge machinery on this path), seals the weave
 *                (parents=[selvageTip, scratchTip], recipe folded in — v3 §1.1)
 *                and CAS-advances refs/heads/selvage. On CLEAN the merged bytes
 *                are RESTORED back into the agent worktree (step 5 of §2.1 —
 *                the agent continues from merged reality; no commit ever
 *                existed). KNOT/DANGLE/CLAIM-BREACH/HELD refuse; the scratch
 *                ref keeps the work; the knot payload carries both sides; every
 *                refusing verdict carries `refusal:v1` (the F4 carrier,
 *                T-2026-07-21-007 — this path is the one agents actually use).
 *   4. RESOLVE — `resolveNative` seals the human/agent resolution of a KNOT as
 *                a v3 weave carrying the KnotResolution envelope.
 *   5. ABANDON — `abandonNative` WITHDRAWS the agent's scratch: the pointer is
 *                cleared, nothing else. The AGENT-CLASS exit (audit C-10), and
 *                the only verb here whose whole job is to un-wedge a principal.
 *
 * Every step is an append or a per-ref CAS — nothing is lost if the process
 * dies between any two steps. SCOPE (founder-visible cutover discipline): this
 * module writes v3 strands for SCRATCH work and native weaves; the git-era
 * seal path (pick/admit over refs) stays v2 until the founder-visible cutover.
 * Exit proof: test/native-loop-no-git.test.ts — the full loop green in a
 * directory with no `.git` at all (I12).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadLiveGraph } from '@a-company/premise-core';
import { buildWarpState, type WarpState } from '../warp/warp-state.js';
import { liftCodeUnits, injectCodeUnits } from '../lens/lift-code-units.js';
import { ObjectStore } from '../warp/object-store.js';
import { snapshotDir, restoreTree, WORKTREE_SEMANTICS } from '../warp/snapshot.js';
import { WarpStore } from '../warp/store.js';
import { diff } from '../sem-delta.js';
import { classifyMergePaths } from '../honesty.js';
import { warplineDirOf, readFabric, readSelvage, appendStrand, writeSelvage } from './fabric.js';
import { readRef, writeRef } from './refs.js';
import { readScratch, writeScratchRef, clearScratch } from './scratch.js';
import { guardedRestoreTree, assertDirtyFree } from './restore.js';
import { withFabricLock } from './lock.js';
import { summarizeDelta } from './seal.js';
import { buildStrandV3, type Strand, type MergeRecipe, type KnotResolution } from './strand.js';
import { parentsOf } from './dag.js';
import {
  admitDecision,
  ADMIT_RESULT_SCHEMA,
  meaningRefusal,
  claimRefusal,
  trustRefusal,
  type AdmitDecision,
  type AdmitResult,
  type AdmitStatus,
} from './admit.js';
import { materializeMergedStateNative } from './materialize.js';
import { buildKnotPayload, persistKnotPayload, readFileFromTree, listKnotPayloads, readKnotPayload } from './knot-payload.js';
import { VERB_DESCRIPTORS, nextLegalVerbsFor } from '../daemon/descriptors.js';
import { readClaim, evaluateClaim, recordClaimEvaluation, createClaim, persistClaim, type Claim, type ClaimEvaluation, type CreateClaimInput } from './claim.js';
import { readGradeSidecar, symbolSurvivalIndex, evaluateEscalation, recordGradeEscalation } from './grade.js';
import { hazardAdvisory } from './hazard.js';
import { refuse, RefusedError, type RefusalNextStep } from './refusal.js';

/** The provenance/scratch ref label for an agent (sanitized like scratchPath). */
export function scratchRefName(agentId: string): string {
  return `refs/scratch/${agentId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

const blankDecision = (status: AdmitStatus): AdmitDecision => ({
  status,
  knots: [],
  dangling: [],
  confidence: null,
  rebasedOnto: null,
  agentChanged: [],
  otherChanged: [],
});

/** Absorb a NATIVE tree from the object store (I2): restore to a temp dir → lens. */
export async function absorbTree(store: ObjectStore, treeId: string, refLabel: string): Promise<WarpState> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-absorb-tree-'));
  try {
    restoreTree(store, treeId, tmp);
    const graph = await loadLiveGraph(tmp);
    // Same universe rules as absorb(): code-units injected BEFORE essences.
    injectCodeUnits(graph.index, await liftCodeUnits(tmp));
    // Native provenance: the ref label is a NATIVE ref name; no git tree (I4).
    return buildWarpState(graph.index, { ref: refLabel, treeSha: null, rootDir: tmp });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ── helpers over the DAG ────────────────────────────────────────────────────── */

function byPickIndex(fabric: Strand[]): Map<string, Strand> {
  const m = new Map<string, Strand>();
  for (const s of fabric) if (!m.has(s.pickId)) m.set(s.pickId, s);
  return m;
}

function mustStrand(byPick: Map<string, Strand>, pickId: string, what: string): Strand {
  const s = byPick.get(pickId);
  if (!s) {
    throw new Error(`warpline: ${what} points at ${pickId} but no strand in the fabric carries that pickId (closure hole — repair .warpline/)`);
  }
  return s;
}

/** All ancestors of `tip` (inclusive), BFS over unified DAG parents. */
function ancestorSet(byPick: Map<string, Strand>, tip: string): Set<string> {
  const seen = new Set<string>();
  const queue = [tip];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byPick.get(id);
    if (s) for (const p of parentsOf(s)) queue.push(p);
  }
  return seen;
}

/** Walk parents[0] from the scratch tip until a strand on the selvage history. */
function forkBaseOf(byPick: Map<string, Strand>, scratchTip: string, selvageAncestors: Set<string>): Strand | null {
  let cur: Strand | undefined = byPick.get(scratchTip);
  while (cur) {
    if (selvageAncestors.has(cur.pickId)) return cur;
    const p0 = parentsOf(cur)[0];
    cur = p0 ? byPick.get(p0) : undefined;
  }
  return null;
}

/**
 * The native selvage tip pickId — refs mode is MANDATORY on the native path.
 * null = no selvage has ever been admitted (genesis; unadmitted scratch strands
 * may already exist in the arrival log). A LEGACY fabric (stateId selvage, no
 * pickId ref) must run the one-time founder-visible migration first.
 */
function nativeSelvageTip(wdir: string): string | null {
  const tip = readRef(wdir, 'selvage');
  if (tip !== null) return tip;
  if (readSelvage(wdir) !== null) {
    // PW-2: a typed refusal, not a prose dead-end — the migration is a
    // one-time human act, so the ladder escalates rather than instructs retry.
    throw new RefusedError(
      refuse({
        code: 'UNSUPPORTED',
        next: [{ verb: 'refs.migrate', params: {}, requires: [], principal: 'human' }],
      }),
      'warpline: the native write path needs pickId refs (refs/heads/selvage) — this fabric predates them; run `warpline refs migrate` first (one-time, founder-visible)',
    );
  }
  return null; // no admitted selvage yet — genesis
}

/* ── 1. FORK ─────────────────────────────────────────────────────────────────── */

export interface ForkNativeOptions {
  /** restore the base tree into this directory (the agent's fresh worktree). */
  into?: string;
  /**
   * C-5: overwrite colliding paths in `--into` whose bytes are in no object.
   * Without it the per-path dirty guard (#restore) refuses — `fork --into` used
   * to call restoreTree RAW and silently clobber a working directory.
   */
  force?: boolean;
}

export interface ForkNativeResult {
  agentId: string;
  /** the selvage tip pickId the scratch was minted at (null on an empty fabric). */
  base: string | null;
  /** entries restored into `into` (absent when no restore was requested). */
  restoredEntries?: number;
}

/**
 * The fork-clobber ladder, DERIVED from the next-verb rule rather than
 * hardcoded (D-6b, F4 instrument panel 2026-07-31).
 *
 * This ladder used to be a flat `[{verb:'admit'}]`. That is right for an
 * unjudged proposal and WRONG after a KNOT: the scratch still holds the sealed
 * proposal and the selvage has moved, so the guard fires — and told the agent
 * to re-admit, which is the exact identical-repeat the classifier scores W1,
 * while `status` answered the SAME position with `knot.show` and "resolution is
 * human-class — escalate rather than retry". Two carriers, one position,
 * opposite instructions; the same misdirection the FG-3 review already removed
 * from `status`, surviving one carrier over.
 *
 * The fix is not a second hand-written branch — it is to stop being a second
 * carrier at all. The position is computed exactly as the daemon's `status`
 * handler computes it and resolved through the SAME hashed `NEXT_LEGAL_VERBS`
 * table, so the two answers cannot diverge again: a change to the rule moves
 * both, and moves `descriptorsId` with them.
 *
 * Params/requires come from the verb's own descriptor, so the step stays
 * copy-paste runnable (a `knot.show` step carries the payload selector it
 * needs). Best-effort throughout: a ladder must never throw on the way to
 * reporting a refusal.
 */
function forkClobberNextSteps(root: string, agentId: string, scratchPick: string, base: string | null): RefusalNextStep[] {
  let knotPayloadId: string | undefined;
  let behindSelvage = false;
  try {
    const strand = readFabric(warplineDirOf(root)).find((s) => s.pickId === scratchPick);
    if (strand) {
      behindSelvage = (parentsOf(strand)[0] ?? null) !== base;
      // Keyed on (agentId, stateId) verbatim as daemon/server.ts's status
      // handler keys it: a work order naming THIS principal's CURRENT sealed
      // proposal means the contest is live.
      knotPayloadId = listKnotPayloads(root).find(
        (p) => p.ours.agentId === agentId && p.ours.stateId === strand.stateId,
      )?.payloadId;
    }
  } catch {
    /* the ladder degrades to the unKNOTted position — never throws */
  }
  const { verbs } = nextLegalVerbsFor({
    scratchPresent: true,
    proposalSealed: true,
    behindSelvage,
    knotOpen: knotPayloadId !== undefined,
  });
  return verbs.map((verb) => {
    const descriptor = VERB_DESCRIPTORS[verb];
    const params: Record<string, string> =
      verb === 'knot.show' && knotPayloadId ? { selector: knotPayloadId } : {};
    const required = ((descriptor.paramsSchema as { required?: string[] }).required ?? []).filter(
      (r) => !(r in params),
    );
    return { verb, params, requires: required, principal: descriptor.principal };
  });
}

/** Mint the agent's scratch ref at the current selvage pickId (I9). */
export function forkNative(root: string, agentId: string, opts: ForkNativeOptions = {}): ForkNativeResult {
  const wdir = warplineDirOf(root);
  const base = nativeSelvageTip(wdir);
  // PW-10 clobber guard: a scratch ref that is a pickId AND differs from the
  // selvage tip is a sealed-but-unadmitted proposal — re-forking would orphan
  // it silently (writeScratchRef was an unconditional overwrite; same-principal
  // concurrent sessions clobbered each other with no error anywhere). Refuse
  // loudly; the ladder (D-6b: derived from the next-verb rule, so it cannot
  // contradict `status`) says what to do with the pending work first.
  const existing = readScratch(root, agentId);
  if (existing !== null && existing.startsWith('pick:') && existing !== base) {
    const next = forkClobberNextSteps(root, agentId, existing, base);
    const contested = next.some((n) => n.verb === 'knot.show');
    throw new RefusedError(
      refuse({
        code: 'BAD_REQUEST',
        retriable: 'retry-corrected',
        next,
      }),
      `warpline: fork — ${JSON.stringify(agentId)} already has a sealed, unadmitted proposal (scratch ${existing}); ` +
        `re-fork would orphan it silently. ` +
        (contested
          ? 'That proposal is CONTESTED: read the KNOT work order named in next[]. Re-admitting unchanged cannot clear it, and resolution is human-class — escalate rather than retry, or `abandon` to withdraw your proposal.'
          : 'Admit it first, or `abandon` to withdraw it (the sealed strand stays in the ledger, restorable by pickId).'),
    );
  }
  writeScratchRef(root, agentId, base ?? '', existing);
  let restoredEntries: number | undefined;
  if (opts.into) {
    if (!base) throw new Error('warpline: fork --into needs a sealed selvage to restore from (empty fabric)');
    const tip = mustStrand(byPickIndex(readFabric(wdir)), base, 'refs/heads/selvage');
    const treeId = tip.binding?.treeId;
    if (!treeId) throw new Error(`warpline: fork --into — selvage strand ${base} has no byte binding (unrestorable)`);
    // C-5: through the guard, never raw. `fork --into` has no snapshotted
    // baseline (that is what propose is for), so ANY colliding path whose bytes
    // differ from what we are about to write refuses without --force.
    restoredEntries = guardedRestoreTree(new ObjectStore(root), treeId, opts.into, {
      force: opts.force,
      overrideHint: 'pass --force to overwrite them, or fork into an empty directory',
    });
  }
  return { agentId, base, ...(restoredEntries !== undefined ? { restoredEntries } : {}) };
}

/* ── 2. PROPOSE — seal the scratch strand ────────────────────────────────────── */

export interface ProposeNativeOptions {
  /** the agent's working directory (the snapshot source — never mutated). */
  worktree: string;
  agentId: string;
  /** REQUIRED intent (I3: identity/intent come from the caller — an intent-less propose is refused). */
  intent: string;
  /** actor identity (defaults to agentId — the authenticated-session stand-in at phase 0). */
  actor?: string;
  /** register a claim:v1 alongside the proposal (the native front door is propose-with-claim). */
  claim?: Omit<CreateClaimInput, 'agentId' | 'intent'> & { intent?: string };
  /** injectable clock (ISO) — determinism in tests. */
  now?: string;
  /** ephemeral session breadcrumb (EXCLUDED from the pickId). */
  sessionKey?: string;
}

export interface ProposeNativeResult {
  /** true when meaning is unchanged vs the scratch base — nothing sealed. */
  noop: boolean;
  /** the sealed scratch strand (absent on a no-op). */
  strand?: Strand;
  /** the registered claim's id (when a claim was supplied). */
  claimId?: string;
  stateId: string;
  /** the native root treeId of the snapshotted worktree. */
  treeId: string;
  /** the parent pickId the strand chained off (null at a fresh-fabric genesis). */
  base: string | null;
}

/**
 * Seal a v3 SCRATCH strand from the worktree — no git anywhere. Advances ONLY
 * the agent's scratch ref; the selvage is untouched until admit.
 */
export async function proposeNative(root: string, opts: ProposeNativeOptions): Promise<ProposeNativeResult> {
  if (!opts.intent || !opts.intent.trim()) {
    throw new Error('warpline: propose (native) refused — intent is required from the caller; there is no git fallback on the native path (I3)');
  }
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root);
  const refLabel = scratchRefName(opts.agentId);

  // Bytes first (native walk, I5-indexed: only changed files are rehashed),
  // then meaning FROM the store (I2) — expensive, outside the lock.
  const snap = snapshotDir(objStore, opts.worktree, { indexRoot: root });
  const state = await absorbTree(objStore, snap.treeId, refLabel);

  // Claim registration (sidecar, G5) — the OFFER metadata rides beside the strand.
  let claimId: string | undefined;
  if (opts.claim) {
    const c = createClaim({
      ...opts.claim,
      intent: opts.claim.intent ?? opts.intent,
      agentId: opts.agentId,
    });
    persistClaim(root, c);
    claimId = c.claimId;
  }
  const now = opts.now ?? new Date().toISOString();

  return withFabricLock(root, () => {
    const fabric = readFabric(wdir);
    const byPick = byPickIndex(fabric);
    // Base = the scratch ref (a pickId) when forked; else the selvage tip (auto-fork).
    const scratch = readScratch(root, opts.agentId);
    let basePickId: string | null;
    if (scratch !== null) {
      if (!scratch.startsWith('pick:')) {
        // PW-2: the corrected prerequisite is a fresh fork — retry-corrected.
        throw new RefusedError(
          refuse({
            code: 'UNSUPPORTED',
            retriable: 'retry-corrected',
            next: [{ verb: 'fork', params: {}, requires: [], principal: 'agent' }],
          }),
          `warpline: propose (native) — scratch for ${opts.agentId} holds ${JSON.stringify(scratch)} (a legacy stateId scratch); the native path needs a pickId scratch ref — run \`warpline fork ${opts.agentId}\``,
        );
      }
      basePickId = scratch;
    } else {
      basePickId = nativeSelvageTip(wdir);
    }
    const baseStrand = basePickId ? mustStrand(byPick, basePickId, `scratch base for ${opts.agentId}`) : undefined;
    const baseState = baseStrand ? store.loadState(baseStrand.stateId) : undefined;
    if (baseStrand && !baseState) {
      throw new Error(
        `warpline: propose (native) — base state ${baseStrand.stateId} cannot be loaded (states/ cache missing or corrupt) — fail closed`,
      );
    }
    if (baseState) {
      const d = diff(baseState, state);
      if (d.deltas.size === 0 && d.renames.length === 0) {
        return { noop: true, stateId: state.stateId, treeId: snap.treeId, base: basePickId, ...(claimId ? { claimId } : {}) };
      }
    }
    const strand = buildStrandV3({
      parents: basePickId ? [basePickId] : [],
      stateId: state.stateId,
      actor: opts.actor ?? opts.agentId,
      authoredBy: { agentId: opts.agentId, ...(opts.sessionKey !== undefined ? { sessionKey: opts.sessionKey } : {}) },
      intent: opts.intent,
      recordedAt: now,
      objectCount: state.objects.size,
      delta: summarizeDelta(baseState, state),
      provenance: { ref: refLabel, treeSha: null, gitCommit: null }, // git-null (I4)
      binding: { treeId: snap.treeId, gitOid: snap.gitOid, treeSemantics: WORKTREE_SEMANTICS }, // bind-on-seal (v3 §1.1)
    });
    store.putState(state);
    appendStrand(wdir, strand); // durable BEFORE judgment (D2)
    writeScratchRef(root, opts.agentId, strand.pickId); // only the scratch ref moves
    return {
      noop: false,
      strand,
      stateId: state.stateId,
      treeId: snap.treeId,
      base: basePickId,
      ...(claimId ? { claimId } : {}),
    };
  });
}

/* ── 3. ADMIT — weave scratch-tip × selvage, git-absent ──────────────────────── */

export interface AdmitNativeOptions {
  /** the agent's worktree — CLEAN merged bytes are restored back into it. */
  worktree: string;
  agentId: string;
  actor?: string;
  intent?: string;
  /** judge against a pre-declared claim (claimId or ≥12-char prefix) — fail closed. */
  claim?: string;
  acceptBreach?: boolean;
  acceptRisk?: boolean;
  now?: string;
  /** skip the CLEAN write-back restore (server/test callers). */
  noRestore?: boolean;
}

export interface AdmitNativeResult extends AdmitResult {
  /** entries restored into the worktree on a CLEAN weave (absent otherwise). */
  restoredEntries?: number;
}

/**
 * AdmitNativeResult minus its G1 stamp — the shape the internal builders
 * produce. Mirrors AdmitResultBody: the `admitResult:v1` stamp is applied
 * EXACTLY ONCE, at the public boundary, so no builder can forget or forge it.
 */
type AdmitNativeResultBody = Omit<AdmitNativeResult, 'schemaVersion'>;

/**
 * The native admission: verdict via the EXISTING decision engine, bytes via
 * materializeMergedStateNative only. FAST_ADMIT is a selvage fast-forward to the
 * scratch tip (the scratch strand IS the admissible DAG node — no re-seal);
 * CLEAN seals a weave (parents [selvageTip, scratchTip]) and restores the
 * merged tree into the agent worktree; KNOT/DANGLE persist the payload and
 * refuse; CLAIM-BREACH/HELD refuse exactly as the git-era gate does.
 */
export async function admitNative(root: string, opts: AdmitNativeOptions): Promise<AdmitNativeResult> {
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root);
  const now = opts.now ?? new Date().toISOString();

  // Claim resolution BEFORE the lock (read-only sidecar) — same fail-closed
  // posture as the git-era admit.
  let claim: Claim | null = null;
  if (opts.claim) {
    claim = readClaim(root, opts.claim);
    if (!claim) {
      throw new Error(
        `warpline: admit --claim ${opts.claim} — no verified claim matches (missing, tampered, or a <12-char prefix) — fail closed.`,
      );
    }
    if (claim.agentId !== opts.agentId) {
      throw new Error(
        `warpline: admit --claim ${claim.claimId} belongs to agent ${JSON.stringify(claim.agentId)}, not ${JSON.stringify(opts.agentId)} — a claim grades its own author (fail closed).`,
      );
    }
  }

  const result = await withFabricLock(root, async (): Promise<AdmitNativeResultBody> => {
    const fabric = readFabric(wdir);
    const byPick = byPickIndex(fabric);

    const scratchTipId = readScratch(root, opts.agentId);
    if (!scratchTipId || !scratchTipId.startsWith('pick:')) {
      // PW-2: THE most common cold mistake (admit before propose). Pre-fix it
      // surfaced as ENGINE/retry-identical/empty-next — a machine hint that
      // instructed an infinite losing retry while the real recovery lived only
      // in prose. The ladder is the recovery: fork, then propose, then retry.
      throw new RefusedError(
        refuse({
          code: 'BAD_REQUEST',
          retriable: 'retry-corrected',
          next: [
            { verb: 'fork', params: {}, requires: [], principal: 'agent' },
            { verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' },
          ],
        }),
        `warpline: admit (native) — nothing proposed for ${opts.agentId} (scratch ref ${scratchTipId ? 'is not a pickId' : 'absent'}); run \`warpline fork\` + \`warpline propose --native\` first`,
      );
    }
    const scratchStrand = mustStrand(byPick, scratchTipId, `refs/scratch/${opts.agentId}`);
    // THE SECOND HALF OF THE SAME COLD MISTAKE. The guard above catches `admit`
    // with no scratch at all — but `fork` MINTS a valid pickId (the base), so an
    // agent that forked and edited but never PROPOSED sails past it and lands on
    // the "already selvage history" NOOP below, which reports "the agent changed
    // no meaning". That message is false and it is the expensive kind of false:
    // the work is real and unsealed, and the agent is told its edits were empty.
    // A proposal strand is sealed THROUGH the scratch ref and carries it as
    // provenance; a fork base carries whatever sealed it (WORKTREE, a git ref,
    // refs/heads/selvage). So the discriminator is exact, not heuristic.
    if (scratchStrand.provenance.ref !== scratchRefName(opts.agentId)) {
      throw new RefusedError(
        refuse({
          code: 'BAD_REQUEST',
          retriable: 'retry-corrected',
          next: [{ verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' }],
        }),
        `warpline: admit (native) — ${opts.agentId} has a scratch ref but nothing PROPOSED on it: it still points at the fork base ` +
          `(${scratchTipId.slice(0, 20)}…, sealed as "${scratchStrand.intent}"). Forking mints the base; it does not capture your work. ` +
          `Run \`warpline propose --agent ${opts.agentId} --native -m "<why this change exists>"\` to seal the worktree, then admit.`,
      );
    }
    const proposed = store.loadState(scratchStrand.stateId);
    if (!proposed) {
      throw new Error(`warpline: admit (native) — proposed state ${scratchStrand.stateId} cannot be loaded — fail closed`);
    }

    // Claim judgment plumbing — mirror of the git-era admit's withClaim.
    let claimEval: ClaimEvaluation | null = null;
    const withClaim = (r: AdmitNativeResultBody): AdmitNativeResultBody => {
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

    const selvageTipId = nativeSelvageTip(wdir);
    if (selvageTipId === null) {
      // GENESIS admit: fast-forward the (new) selvage ref to the scratch tip.
      const genesis = blankDecision('FAST_ADMIT');
      if (claim) claimEval = evaluateClaim(genesis, claim);
      writeRef(wdir, 'selvage', scratchTipId, null); // CAS: must still be unborn
      writeSelvage(wdir, scratchStrand.stateId); // legacy stateId pointer kept in lockstep
      clearScratch(root, opts.agentId);
      return withClaim({ decision: genesis, sealed: true, proposedStateId: proposed.stateId, strand: scratchStrand });
    }

    const selvageStrand = mustStrand(byPick, selvageTipId, 'refs/heads/selvage');
    const selvage = store.loadState(selvageStrand.stateId);
    if (!selvage) {
      throw new Error(`warpline: admit (native) — selvage state ${selvageStrand.stateId} cannot be loaded — fail closed`);
    }

    const selvageAncestors = ancestorSet(byPick, selvageTipId);
    if (selvageAncestors.has(scratchTipId)) {
      // The scratch tip is already selvage history — nothing to admit.
      const noop = blankDecision('NOOP');
      if (claim) claimEval = evaluateClaim(noop, claim);
      return withClaim({ decision: noop, sealed: false, proposedStateId: proposed.stateId });
    }
    const baseStrand = forkBaseOf(byPick, scratchTipId, selvageAncestors);
    if (!baseStrand) {
      // PW-2: disjoint roots mean the record itself is suspect — no agent call
      // recovers this; escalate (empty next[] means exactly that).
      throw new RefusedError(
        refuse({ code: 'INTEGRITY_BROKEN' }),
        `warpline: admit (native) — the scratch history of ${opts.agentId} shares no base with the selvage (disjoint DAG roots) — fail closed`,
      );
    }
    const base = store.loadState(baseStrand.stateId);
    if (!base) {
      throw new Error(`warpline: admit (native) — base state ${baseStrand.stateId} cannot be loaded — fail closed`);
    }

    const decision = admitDecision(base, proposed, selvage);

    // THE CLAIM GATE — judged strictly before any seal (verbatim rule).
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
          // #refusal (T-2026-07-21-007): the native path is the one agents
          // actually use — a refusing verdict without the F4 carrier here made
          // cold-agent recovery impossible exactly where it matters most.
          refusal: claimRefusal(decision, proposed.stateId, claim.claimId, claimEval.excess, { native: 'true' }),
        };
      }
    }

    // THE TRUST FLOOR — independent-CLEAN into a low-survival symbol is HELD.
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
        refusal: trustRefusal(decision, proposed.stateId, escalation.symbol, { native: 'true' }),
      });
    }
    const withEscalation = (r: AdmitNativeResultBody): AdmitNativeResultBody => {
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

    // THE CLEAN-HAZARD ADVISORY (#clean-hazard, T-2026-06-24-015) — the SAME
    // helper the git-era path calls, at the same point in the pipeline, for the
    // same reason the refusal carrier is built one way for both (T-2026-07-21-007:
    // this is the path agents actually use, and a native-only gap is invisible
    // exactly where it matters most). Advisory: it writes `hazards` and nothing
    // else — no status, no `sealed`, no refusal.
    const withHazards = hazardAdvisory({
      root,
      agentId: opts.agentId,
      base,
      proposed,
      selvage,
      decision,
      shadow: false, // the native path never runs observe-only
      now,
    }).attach;

    if (decision.status === 'NOOP') {
      return withClaim({ decision, sealed: false, proposedStateId: proposed.stateId });
    }

    if (decision.status === 'FAST_ADMIT' && baseStrand.pickId === selvageTipId) {
      // Fast-forward: the scratch strand IS the admissible node — the ref moves,
      // no re-seal (v3: admission of a sealed strand is a ref advance).
      writeRef(wdir, 'selvage', scratchTipId, selvageTipId); // per-ref CAS
      writeSelvage(wdir, scratchStrand.stateId);
      clearScratch(root, opts.agentId);
      return withClaim({ decision, sealed: true, proposedStateId: proposed.stateId, strand: scratchStrand });
    }

    if (decision.status === 'CLEAN' || decision.status === 'FAST_ADMIT') {
      // All three sides are BOUND v3 strands — the whole 3-way merge runs off
      // the object store (I6): no git merge-file, no git anything.
      const baseTree = baseStrand.binding?.treeId;
      const oursTree = scratchStrand.binding?.treeId;
      const theirsTree = selvageStrand.binding?.treeId;
      if (!baseTree || !oursTree || !theirsTree) {
        throw new Error('warpline: admit (native) — a merge side has no byte binding (bind-on-seal is mandatory on v3 strands) — fail closed');
      }
      const mat = await materializeMergedStateNative(objStore, baseTree, oursTree, theirsTree);
      if (!mat.state || mat.plan.conflicts.length > 0 || !mat.resultTreeId) {
        // Meaning said CLEAN but bytes overlap → surface as KNOT (never a silent wrong-merge).
        return withClaim({
          decision: { ...decision, status: 'KNOT' },
          sealed: false,
          proposedStateId: proposed.stateId,
          merged: mat.plan,
          refusal: meaningRefusal('KNOT', decision, proposed.stateId, opts.agentId),
        });
      }
      // C-5 DIRTY-WORKTREE GUARD, and it runs HERE — before a single ledger
      // byte moves. The write-back below used to call restoreTree raw over the
      // WHOLE merged tree (not just the merged paths) into the human's own
      // working directory, and the clobbered bytes were in no object: propose
      // snapshotted before the edit, the write-back snapshots nothing. Git
      // aborts a merge that would overwrite local changes; so do we.
      //
      // The baseline is the PROPOSAL's own tree (`oursTree`): a path the agent
      // has not touched since `propose` is recoverable and may be overwritten,
      // which is the normal merge and must not be blocked. A path edited AFTER
      // propose is bytes nothing holds — refuse, and name --no-restore, which
      // seals the admission and simply declines the write-back.
      if (!opts.noRestore) {
        assertDirtyFree(objStore, mat.resultTreeId, opts.worktree, {
          expectTreeId: oursTree,
          overrideHint:
            'pass --no-restore to admit WITHOUT the write-back (the merge still seals; reconcile with `warpline restore` afterwards), ' +
            'or save those paths first',
        });
      }
      const recipe: MergeRecipe = { algo: 'warpline-merge3-v1', base: baseTree, ours: oursTree, theirs: theirsTree, result: mat.resultTreeId };
      const weave = buildStrandV3({
        parents: [selvageTipId, scratchTipId], // primary = selvage history; ours = the admitted proposal
        stateId: mat.state.stateId,
        actor: opts.actor ?? opts.agentId,
        authoredBy: { agentId: opts.agentId },
        intent: opts.intent ?? `admit ${opts.agentId}`,
        recordedAt: now,
        objectCount: mat.state.objects.size,
        delta: summarizeDelta(selvage, mat.state),
        provenance: { ref: 'refs/heads/selvage', treeSha: null, gitCommit: null },
        binding: { treeId: mat.resultTreeId, gitOid: null },
        merge: recipe,
      });
      store.putState(mat.state);
      appendStrand(wdir, weave);
      writeRef(wdir, 'selvage', weave.pickId, selvageTipId); // per-ref CAS
      writeSelvage(wdir, mat.state.stateId);
      clearScratch(root, opts.agentId);
      const coverage = classifyMergePaths(mat.plan.files.keys(), [mat.state, proposed, selvage]);
      // Close the loop (§2.1 step 5): restore the merged bytes back into the
      // agent worktree (overlay semantics) — the agent continues from merged
      // reality. Already cleared by assertDirtyFree above, before the seal.
      const restoredEntries = opts.noRestore ? undefined : restoreTree(objStore, mat.resultTreeId, opts.worktree);
      return withClaim(
        withEscalation(
          withHazards({
            decision,
            sealed: true,
            proposedStateId: proposed.stateId,
            strand: weave,
            merged: mat.plan,
            coverage,
            ...(restoredEntries !== undefined ? { restoredEntries } : {}),
          }),
        ),
      );
    }

    // KNOT / DANGLE — persist the machine-readable resolution work order; the
    // scratch ref KEEPS the work (durable strand — nothing is lost).
    let knotPayloadId: string | undefined;
    try {
      const payload = buildKnotPayload({
        decision,
        base,
        proposed,
        selvage,
        ours: {
          agentId: opts.agentId,
          actor: opts.actor ?? opts.agentId,
          intent: scratchStrand.intent,
          ref: scratchRefName(opts.agentId),
          gitCommit: null,
          treeId: scratchStrand.binding?.treeId ?? null,
        },
        theirs: {
          agentId: selvageStrand.authoredBy?.agentId ?? null,
          actor: selvageStrand.actor,
          intent: selvageStrand.intent,
          ref: selvageStrand.provenance?.ref ?? null,
          gitCommit: selvageStrand.provenance?.gitCommit ?? null,
          treeId: selvageStrand.binding?.treeId ?? null,
        },
        baseTreeId: baseStrand.binding?.treeId ?? null,
        readFile: (treeId, rel) => readFileFromTree(objStore, treeId, rel),
      });
      persistKnotPayload(root, payload);
      knotPayloadId = payload.payloadId;
    } catch {
      /* payload is auxiliary — the KNOT/DANGLE verdict stands without it */
    }
    return withClaim({
      decision,
      sealed: false,
      proposedStateId: proposed.stateId,
      ...(knotPayloadId ? { knotPayloadId } : {}),
      // #refusal: built AFTER the payload attempt so `next[0]` names the work
      // order whenever one actually persisted (every pointer must dereference — F4).
      refusal: meaningRefusal(decision.status, decision, proposed.stateId, opts.agentId, knotPayloadId),
    });
  });
  // THE single G1 stamp point for the native path (see AdmitNativeResultBody).
  return { schemaVersion: ADMIT_RESULT_SCHEMA, ...result };
}

/* ── 4. RESOLVE — the native KNOT council seal ───────────────────────────────── */

export interface ResolveNativeOptions {
  /** the worktree holding the human/agent-RESOLVED bytes (snapshot source). */
  worktree: string;
  agentId: string;
  /** why it was resolved this way (required — the accountability record). */
  reason: string;
  /** who made the call (defaults to agentId — no git user.name on this path). */
  decidedBy?: string;
  now?: string;
}

export interface ResolveNativeResult {
  strand: Strand;
  resolution: KnotResolution;
}

/**
 * Seal the resolution of a KNOT as a v3 weave: parents [selvageTip, scratchTip],
 * the KnotResolution envelope on the strand, bytes bound from the resolved
 * worktree — git absent end to end.
 */
export async function resolveNative(root: string, opts: ResolveNativeOptions): Promise<ResolveNativeResult> {
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root);
  const now = opts.now ?? new Date().toISOString();
  const decidedBy = opts.decidedBy ?? opts.agentId;

  // Bytes + meaning outside the lock (expensive; I5-indexed walk).
  const snap = snapshotDir(objStore, opts.worktree, { indexRoot: root });
  const resolved = await absorbTree(objStore, snap.treeId, 'refs/heads/selvage');

  return withFabricLock(root, () => {
    const fabric = readFabric(wdir);
    const byPick = byPickIndex(fabric);
    const selvageTipId = nativeSelvageTip(wdir);
    if (!selvageTipId) {
      // PW-2: nothing sealed yet — there is no knot to resolve; no call fixes that.
      throw new RefusedError(
        refuse({ code: 'NOT_FOUND', retriable: 'never' }),
        'warpline: resolve (native) — no selvage; nothing to resolve against',
      );
    }
    const selvageStrand = mustStrand(byPick, selvageTipId, 'refs/heads/selvage');
    const selvage = store.loadState(selvageStrand.stateId);
    if (!selvage) throw new Error(`warpline: resolve (native) — selvage state ${selvageStrand.stateId} cannot be loaded — fail closed`);

    const scratchTipId = readScratch(root, opts.agentId);
    if (!scratchTipId || !scratchTipId.startsWith('pick:')) {
      // PW-2: the conflicting proposal must exist first — sealed via propose.
      throw new RefusedError(
        refuse({
          code: 'NOT_FOUND',
          retriable: 'retry-corrected',
          next: [{ verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' }],
        }),
        `warpline: resolve (native) — no proposed scratch strand for ${opts.agentId} (the conflicting proposal names the second parent)`,
      );
    }
    const scratchStrand = mustStrand(byPick, scratchTipId, `refs/scratch/${opts.agentId}`);

    // Contended set: recompute the verdict from the durable proposal (precise —
    // the native equivalent of resolve --ours, for free: the proposal is sealed).
    const baseStrand = forkBaseOf(byPick, scratchTipId, ancestorSet(byPick, selvageTipId));
    let contended: string[] = [];
    if (baseStrand) {
      const base = store.loadState(baseStrand.stateId);
      const ours = store.loadState(scratchStrand.stateId);
      if (base && ours) {
        const dec = admitDecision(base, ours, selvage);
        contended = Array.from(
          new Set([...dec.knots.map((k) => k.symbol), ...dec.dangling.map((d) => d.fromSymbol)]),
        ).sort();
      }
    }
    const resolvedSymbols = Array.from(
      new Set(Array.from(diff(selvage, resolved).deltas.values()).map((d) => d.symbol)),
    ).sort();
    if (contended.length === 0) contended = resolvedSymbols;

    // Link to the payload this resolution settles (see
    // KnotResolution.knotPayloadId): the payload already classifies each
    // contested unit direct-vs-ripple, which is what separates a GENUINE contest
    // from an OVER-BLOCK, and the field test's falsifiers are unreadable without
    // that split. Joined by the ours-side stateId rather than by symbol name,
    // which breaks as soon as one symbol is contested twice. Best-effort: a
    // contest with no persisted payload simply omits the field, never a guess.
    const knotPayloadId = readKnotPayload(root, scratchStrand.stateId)?.payloadId;

    const resolution: KnotResolution = {
      decidedBy,
      reason: opts.reason,
      base: baseStrand?.stateId ?? null,
      against: selvage.stateId,
      contended,
      resolvedSymbols,
      ...(knotPayloadId ? { knotPayloadId } : {}),
    };
    const strand = buildStrandV3({
      parents: [selvageTipId, scratchTipId],
      stateId: resolved.stateId,
      actor: decidedBy,
      authoredBy: { agentId: opts.agentId },
      intent: `resolve knot — ${opts.reason}`,
      recordedAt: now,
      objectCount: resolved.objects.size,
      delta: summarizeDelta(selvage, resolved),
      provenance: { ref: 'refs/heads/selvage', treeSha: null, gitCommit: null },
      resolves: resolution,
      binding: { treeId: snap.treeId, gitOid: snap.gitOid, treeSemantics: WORKTREE_SEMANTICS },
    });
    store.putState(resolved);
    appendStrand(wdir, strand);
    writeRef(wdir, 'selvage', strand.pickId, selvageTipId); // per-ref CAS
    writeSelvage(wdir, resolved.stateId);
    clearScratch(root, opts.agentId);
    return { strand, resolution };
  });
}

/* ── 5. ABANDON — the agent-class exit ───────────────────────────────────────── */

export interface AbandonNativeResult {
  agentId: string;
  /** true when a scratch pointer was actually cleared (false = already clear). */
  abandoned: boolean;
  /** the value the scratch ref held — the ABANDONED HEAD when it was a pickId. */
  abandonedPick: string | null;
  /** true when `abandonedPick` names a SEALED proposal this agent authored. */
  sealedProposal: boolean;
  /**
   * KNOT work orders that still name the withdrawn proposal. REPORTED, never
   * touched: abandoning CONCEDES a contest, it does not resolve one.
   */
  openKnotPayloadIds: string[];
}

/**
 * WITHDRAW an agent's scratch — the agent-class exit git has always had
 * (`git merge --abort`) and Warpline did not (soundness audit 2026-07-31, C-10;
 * P1 remediation "agent-class `abandon` verb").
 *
 * THE WEDGE THIS OPENS. After a KNOT — or after a crash between the weave's ref
 * advance and `clearScratch` — the scratch still holds a sealed proposal that
 * `admit` answers with NOOP (it is already selvage history, or it is contested)
 * while `fork` REFUSES with the clobber guard. Both doors are agent-class, both
 * are closed, and the only verb that clears scratch as a side effect (`resolve`)
 * is HUMAN_ONLY. An all-agent swarm therefore halted on its first genuine
 * conflict — the exact scenario the product exists to serve. Worse, the clobber
 * guard's own prose named `abandon` as the way out, and no such verb existed.
 *
 * WHAT IT DOES, AND ONLY THIS: clears `.warpline/refs/scratch/<agentId>`.
 *
 *   - SEALED WORK IS NEVER LOST. The strand stays in the ledger (append-only;
 *     nothing here deletes), its state stays in the store, its bytes stay in the
 *     object store, and it stays restorable by pickId forever
 *     (`warpline restore pick:<id> --to <dir>`). `fabric verify` already reports
 *     it as an ABANDONED HEAD and always did: `abandonedHeads` is computed from
 *     DAG heads that no `refs/heads/*` entry names (verify.ts:508-511) and
 *     `listRefs` reads refs/heads ONLY — a scratch ref never suppressed the
 *     report, so clearing one cannot change it. Legal, visible, recoverable.
 *   - AN OPEN KNOT IS LEFT OPEN. The payload sidecar is not read for mutation,
 *     not deleted, not marked resolved; the other side (the selvage) does not
 *     move; no weave is sealed and no `resolves` envelope is written. A KNOT is
 *     a human's decision and abandoning must not silently make it. The still-open
 *     payload ids are RETURNED so the withdrawal is legible rather than silent.
 *
 * IDEMPOTENT: no scratch is not an error — `abandoned:false` and exit 0. A cold
 * agent that retries its own exit must not be handed a refusal for succeeding.
 */
export async function abandonNative(root: string, agentId: string): Promise<AbandonNativeResult> {
  const wdir = warplineDirOf(root);
  return withFabricLock(root, () => {
    const existing = readScratch(root, agentId);
    if (existing === null) {
      return { agentId, abandoned: false, abandonedPick: null, sealedProposal: false, openKnotPayloadIds: [] };
    }
    let sealedProposal = false;
    let openKnotPayloadIds: string[] = [];
    if (existing.startsWith('pick:')) {
      try {
        const strand = readFabric(wdir).find((s) => s.pickId === existing);
        // The scratch tip is a PROPOSAL (vs the fork base it was minted at) only
        // when this principal authored it — keyed exactly as the daemon's
        // `status` handler and the fork clobber guard key it.
        sealedProposal = !!strand && strand.authoredBy?.agentId === agentId;
        if (sealedProposal && strand) {
          openKnotPayloadIds = listKnotPayloads(root)
            .filter((p) => p.ours.agentId === agentId && p.ours.stateId === strand.stateId)
            .map((p) => p.payloadId)
            .sort();
        }
      } catch {
        /* the REPORT degrades; the withdrawal itself must never be blocked by it */
      }
    }
    clearScratch(root, agentId);
    return { agentId, abandoned: true, abandonedPick: existing, sealedProposal, openKnotPayloadIds };
  });
}
