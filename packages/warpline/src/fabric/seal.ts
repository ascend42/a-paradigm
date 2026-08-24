/**
 * #seal — the one place a pre-absorbed WarpState becomes a fabric #strand and the
 * selvage advances. Shared by #pick (worktree seal), #admit (merge seal), and
 * #resolve (KNOT-council seal) so the strand schema + atomic publish live once.
 *
 * Library code: no console output.
 */

import { diff } from '../sem-delta.js';
import type { WarpStore } from '../warp/store.js';
import type { WarpState } from '../warp/warp-state.js';
import { warplineDirOf, readFabric, readSelvage, appendStrand, writeSelvage } from './fabric.js';
import { readRef, writeRef } from './refs.js';
import { hasSignedFrom, loadAgentKey, signPickId } from './keys.js';
import { refuse, RefusedError } from './refusal.js';
import {
  computePickId,
  type Strand,
  type StrandDelta,
  type KnotResolution,
  type StrandBinding,
  type MergeRecipe,
  type EpochAnchor,
} from './strand.js';

const EMPTY_DELTA: StrandDelta = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

/** Summarize the meaning change parent → state (empty when no parent / genesis). */
export function summarizeDelta(parent: WarpState | undefined, state: WarpState): StrandDelta {
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
  return {
    born: born.sort(),
    retired: retired.sort(),
    contractChanged: contractChanged.sort(),
    renamedNoop: d.renames.length,
  };
}

export interface SealInput {
  parentStateId: string | null;
  actor: string;
  intent: string;
  gitCommit: string | null;
  now: string;
  confidence?: number | null;
  /** present only for a KNOT-council resolution strand. */
  resolves?: KnotResolution;
  /** true when sealing a materialized CLEAN merge (its gitCommit is one parent). */
  merged?: boolean;
  /** true when sealing a BYTE-CUSTODY strand (meaning-NOOP, tree advanced —
   * T-2026-07-18-002). Rides into the v2 pickId via the `...rest` spread. */
  byteOnly?: boolean;
  /** native byte binding (M1b) — the treeId that restores this strand git-absent. */
  binding?: StrandBinding | null;
  /** the re-derivable merge recipe (merge strands only, M1b). */
  merge?: MergeRecipe;
  /**
   * Provenance override (default: derived from the state being sealed — its ref +
   * treeSha, plus `gitCommit`). ONE caller sets it: `stake recover`'s reversion
   * strand (TD-2026-08-01-893), which lands on an EARLIER strand's state and must
   * carry THAT strand's provenance triple rather than whatever the shared
   * states/ cache last recorded under the stateId — a byte-custody strand can
   * legitimately overwrite the cached snapshot of a stateId, and a provenance
   * that drifted away from the binding it ships with would trip verify's
   * binding.gitOid ↔ provenance.treeSha cross-check.
   */
  provenance?: { ref: string; treeSha: string | null; gitCommit: string | null };
  /**
   * NEW (schema v2) — agent attribution. agentId is IN the v2 pickId; sessionKey is
   * excluded. Absent → authoredBy.agentId hashes as null (the human/git-commit default).
   * parentPickId is NOT a SealInput field — seal computes it from the ledger tip.
   */
  authoredBy?: { agentId: string | null; sessionKey?: string | null };
  /** NEW (schema v2) — the SECOND merge parent (CLEAN merge only): the base strand's pickId. */
  mergeParentPickId?: string | null;
  /**
   * Present ONLY when sealing an epoch-anchor strand (anchor.ts). Rides into the v2
   * pickId via the `...rest` spread in computePickId, so the attestation is itself
   * chain-protected.
   */
  attests?: EpochAnchor;
}

/**
 * M3-lite I3 — seal-time AGENT signing (m3-integrity-design-2026-08-23.md §3,
 * under the §6 rulings). Called on the fully-built strand (pickId computed)
 * IMMEDIATELY before it is appended, by EVERY seal site: `sealState` below (the
 * shared v2 write path — pick/admit/resolve/anchor/recover) AND the three v3
 * seal sites in native.ts (propose/weave/resolve — the daemon's write path,
 * which seals via buildStrandV3 + appendStrand and does NOT flow through
 * sealState).
 *
 * The class/epoch rules, in refusal order:
 *   - HUMAN-CLASS (no authoredBy.agentId)  → returned UNTOUCHED, unsigned. The
 *     human boundary is PROCEDURAL (TD-2026-08-23-136 Q1) — the verifier
 *     exempts human-class strands.
 *   - NO SIGNING EPOCH (no signed-from row) → returned UNTOUCHED. An epoch-less
 *     repo behaves EXACTLY as before this increment, byte for byte.
 *   - AGENT-CLASS, EPOCH PINNED → this seal is post-boundary BY CONSTRUCTION
 *     (the signed-from row pinned the then-tip; every later seal is after it),
 *     so the strand MUST carry a signature: load the principal's key
 *     (fail-closed — a garbled/missing/swapped key file never resolves), sign
 *     the pickId (domain-separated, keys.ts), attach `sig`.
 *   - KEY UNRESOLVABLE → REFUSE the seal (refusal:v1, AUTH — the escalation is
 *     the human's `warpline key mint`). Never seal unsigned past the boundary:
 *     an unsigned agent strand there is exactly what verify flags sig-missing.
 *
 * `sig` is EXCLUDED from the pickId preimage (strand.ts — the signature is over
 * the pickId; folding it in would be circular), so attaching it never perturbs
 * the already-computed identity.
 */
export function signStrandForSeal(root: string, strand: Strand): Strand {
  const agentId = strand.authoredBy?.agentId;
  if (!agentId) return strand; // human-class — stays UNSIGNED (procedural boundary)
  if (!hasSignedFrom(root)) return strand; // no signing epoch — pre-I3 behavior exactly
  const key = loadAgentKey(root, agentId);
  if (!key) {
    throw new RefusedError(
      refuse({
        code: 'AUTH',
        next: [{ verb: 'key.mint', params: { principal: agentId }, requires: [], principal: 'human' }],
      }),
      `warpline: seal refused — a signing epoch is pinned (signed-from) and this seal is agent-class, ` +
        `but principal "${agentId}" has no usable signing key (missing, garbled, or swapped at ` +
        `.warpline/keys/agents/${agentId}.key — the loader fails closed). ` +
        `Mint one with \`warpline key mint ${agentId}\` (a HUMAN-class act), then retry.`,
    );
  }
  return {
    ...strand,
    sig: {
      keyId: key.keyId,
      sigBase64: signPickId(key.privateKeyPem, strand.pickId),
      principal: agentId,
      schemaVersion: 'strandSig:v1',
    },
  };
}

/** Persist `state`, append its strand to the fabric, advance the selvage. */
export function sealState(
  root: string,
  store: WarpStore,
  state: WarpState,
  input: SealInput,
): Strand {
  const wdir = warplineDirOf(root);
  // Load the parent + compute the delta BEFORE persisting `state`. In the dedup
  // edge case current.stateId === parent.stateId (an added symbol whose essence
  // equals an existing one), putState(state) would overwrite the parent's stored
  // snapshot under the shared id, making summarizeDelta diff state against itself.
  const parent = input.parentStateId ? store.loadState(input.parentStateId) : undefined;
  const delta = summarizeDelta(parent, state);
  store.putState(state);
  // The chain link (schema v2): parentPickId := the pickId of the strand at
  // parentStateId, which is ALWAYS the ledger tip (append-only). Computed here from
  // the fabric already read for `seq` — no threading needed. null at genesis; at the
  // v1→v2 boundary this is the last v1 strand's pick:v0 (anchors the v1 tip for free).
  const fab = readFabric(wdir);
  const seq = fab.length;
  const tip = fab.length ? fab[fab.length - 1] : undefined;
  const parentPickId = tip ? tip.pickId : null;
  // C-4 WRITER GUARD (the crash-window laundering): the two parent pointers this
  // strand is about to declare are derived from DIFFERENT sources — parentPickId
  // from the LEDGER TIP, parentStateId from the caller's selvage read. When those
  // disagree the strand names one parent by pickId and a DIFFERENT one by
  // stateId, its delta is diffed against the wrong parent, and once the selvage
  // catches up `fabric verify` reports "all intact" forever: the evidence of the
  // break is consumed by the break. That window opens when a crash lands between
  // appendStrand and writeSelvage (the lesser-evil ordering below).
  //
  // REFUSE, NEVER REPAIR. Silently re-pointing at the real tip would seal a
  // strand nobody asked for over a fabric whose operator has not yet seen the
  // break. The break stays visible (verify keeps reporting chain-break) until a
  // human decides. Recovery back to an EARLIER state is a first-class verb —
  // `stake recover` — which appends an explicit reversion strand (TD-2026-08-01-893)
  // and therefore re-establishes this invariant instead of violating it.
  if ((tip?.stateId ?? null) !== (input.parentStateId ?? null)) {
    throw new Error(
      `warpline: seal refused — the ledger tip's stateId is ${tip?.stateId ?? '(empty ledger)'} but this seal parents on ${input.parentStateId ?? '(none)'}. ` +
        `The two parent pointers would name DIFFERENT parents (parentPickId ${parentPickId ?? '(null)'} vs parentStateId ${input.parentStateId ?? '(null)'}) — ` +
        `the crash-window laundering C-4. Refusing rather than repairing: run \`warpline fabric verify\` to see the break, ` +
        `and \`warpline stake recover <stake>\` if you meant to roll history back (it records the reversion).`,
    );
  }
  const body: Omit<Strand, 'pickId'> = {
    schemaVersion: 2,
    seq,
    parentPickId,
    stateId: state.stateId,
    parentStateId: input.parentStateId,
    actor: input.actor,
    intent: input.intent,
    recordedAt: input.now,
    objectCount: state.objects.size,
    delta,
    calibratedConfidence: input.confidence ?? null,
    provenance: input.provenance ?? { ref: state.ref, treeSha: state.treeSha, gitCommit: input.gitCommit },
    ...(input.resolves ? { resolves: input.resolves } : {}),
    ...(input.merged ? { merged: true } : {}),
    ...(input.byteOnly ? { byteOnly: true } : {}),
    ...(input.authoredBy ? { authoredBy: input.authoredBy } : {}),
    ...(input.mergeParentPickId !== undefined ? { mergeParentPickId: input.mergeParentPickId } : {}),
    ...(input.binding ? { binding: input.binding } : {}),
    ...(input.merge ? { merge: input.merge } : {}),
    ...(input.attests ? { attests: input.attests } : {}),
  };
  // I3: sign BEFORE any ledger byte moves — agent-class + pinned epoch ⇒ sig
  // attached (or the seal REFUSES on an unresolvable key); human-class and
  // epoch-less seals pass through untouched. sig is outside the pickId preimage.
  const strand: Strand = signStrandForSeal(root, { ...body, pickId: computePickId(body) });
  // CAS GUARDS FIRST — refuse if the tip moved off the parent the decision was
  // based on (a concurrent writer won the race). Checking BEFORE mutating the
  // ledger means a lost race throws cleanly with no orphan strand. Callers hold
  // #fabric-lock; this is defense-in-depth against a stolen/stale lock.
  const cur = readSelvage(wdir);
  if (cur !== input.parentStateId) {
    throw new Error(
      `warpline: selvage CAS failed — expected ${input.parentStateId ?? '(none)'}, found ${cur ?? '(none)'} (a concurrent writer advanced the tip)`,
    );
  }
  // Refs mode (V3.2): once a repo has migrated to the pickId ref (refs/heads/
  // selvage — refs.ts), seal maintains it alongside the legacy stateId selvage.
  // The ref must still name the ledger tip this seal chained off; drift between
  // the two tip pointers fails CLOSED (never publish over an unexplained tip).
  const refTip = readRef(wdir, 'selvage'); // null ⇒ legacy (unmigrated) repo — untouched
  if (refTip !== null && refTip !== parentPickId) {
    throw new Error(
      `warpline: ref CAS failed — refs/heads/selvage holds ${refTip} but the ledger tip is ${parentPickId ?? '(none)'} (drifted tip pointers; a concurrent writer advanced the ref)`,
    );
  }
  appendStrand(wdir, strand); // ledger first…
  writeSelvage(wdir, state.stateId); // …then publish the tip (lesser-evil crash ordering)
  if (refTip !== null) {
    writeRef(wdir, 'selvage', strand.pickId, refTip); // per-ref CAS (spec §2)
  } else if (parentPickId === null) {
    // GENESIS IS BORN IN REFS MODE (finding B5). A brand-new fabric used to seal
    // its first strand with no refs/heads/selvage at all and therefore came up
    // LEGACY: the per-ref CAS disengaged (audit C-1), `warpline health` warning on
    // run one, the native write path refusing outright (native.ts: "this fabric
    // predates them; run `warpline refs migrate` first"), and no authoritative tip
    // for git's .gitignore allowlist to carry. A new project starting C-1-exposed
    // until someone runs a second, undocumented command is a setup trap, not a
    // migration policy.
    //
    // AND IT SKIPS NOTHING migration performs. `migrateSelvageToRefs` exists for
    // exactly one job: recover a pickId from a legacy stateId selvage via the
    // highest-seq disambiguation hack, because stateIds are many-to-one and cannot
    // name a history position. At genesis there is no legacy selvage to resolve
    // and the tip's pickId is in hand — the hack has nothing to disambiguate. On
    // an empty fabric migration is already a documented reasoned no-op ("no legacy
    // selvage (empty fabric — nothing to migrate)"), so this is not a shortcut
    // around it; it is the case it declines to handle. The native admit path has
    // minted the genesis ref this way since it was written (native.ts, "GENESIS
    // admit: fast-forward the (new) selvage ref") — this closes the gap for
    // `pick`, which is how every fabric that is not born multi-writer starts.
    //
    // EXISTING LEGACY FABRICS ARE UNTOUCHED. The predicate is `parentPickId ===
    // null` — an EMPTY LEDGER — not "the ref is missing". An unmigrated fabric
    // with history has a non-null parentPickId on every seal and never enters this
    // arm, so it stays legacy until its operator runs the founder-visible
    // `warpline refs migrate`, exactly as before.
    writeRef(wdir, 'selvage', strand.pickId, null); // CAS: must still be unborn
  }
  return strand;
}
