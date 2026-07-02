/**
 * #strand — a Strand: one PICK sealed into the Warpline fabric (this project's
 * OWN native meaning-history, not git).
 *
 * Two distinct identities, deliberately separated:
 *   - stateId  = the REPRODUCIBLE content-address of the meaning this strand
 *                lands on (from #warp-state; provable-zero on a no-op edit).
 *   - pickId   = the EVENT identity of the recording — includes actor + time +
 *                intent, so two identical edits by different actors are
 *                different picks. This is where attribution/provenance lives
 *                (the substrate of the calibration corpus).
 *
 * `calibratedConfidence` is RESERVED (null until graded) — the one field a
 * git-backed history can't carry, and the seed of the non-portable moat: an
 * actor's graded belief at write time, later scored against outcome.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import { canonicalSerialize, type CanonicalValue } from '../warp/canonical.js';

/** A compact summary of the meaning change this strand introduced vs its parent. */
export interface StrandDelta {
  born: string[]; // sorted symbol names born in this strand
  retired: string[]; // sorted symbol names retired
  contractChanged: string[]; // sorted symbol names whose contract/essence moved
  renamedNoop: number; // count of pure renames/moves (the EMPTY delta)
}

/**
 * The record a KNOT-council resolution carries on its strand: WHO resolved a
 * genuine meaning conflict, WHY, what was contended, and how. This is what git
 * can't keep — a merge commit records the bytes, not the reasoning. Warpline's
 * history is accountability-native.
 */
export interface KnotResolution {
  decidedBy: string; // the human (or agent) who made the call
  reason: string; // why it was resolved this way
  base: string | null; // the scratch base the resolution re-based from
  against: string; // the selvage stateId the proposal conflicted with
  contended: string[]; // the symbols that were in conflict (knots + dangles)
  resolvedSymbols: string[]; // symbols the resolution changed vs the selvage
}

/**
 * The byte binding of a strand to the NATIVE object store (M1b) — the meaning↔bytes
 * seam. EXCLUDED from pickId (like calibratedConfidence) because it may be backfilled
 * after seal (§3) and because many byte-trees can absorb to one stateId.
 */
export interface StrandBinding {
  treeId: string; // native root treeId — byte identity in the object store
  gitOid?: string | null; // shadow git tree sha (coexistence proof), or null for a merge result
}

/**
 * The re-derivable recipe of a materialized CLEAN merge (M1b). All three parents +
 * the result are NATIVE treeIds (git-independent, review amendment A3 — non-optional)
 * so the merge Warpline performed is both RESTORABLE (result) and RE-DERIVABLE
 * (re-run the token merge over base/ours/theirs).
 */
export interface MergeRecipe {
  /** the exact merge algorithm version — folded INTO the v2 pickId (restored per Judge). */
  algo: 'warpline-merge3-v1';
  base: string; // native treeId of the merge base
  ours: string; // native treeId of the admitting agent's side
  theirs: string; // native treeId of the live selvage side
  result: string; // native treeId of the merged tree
}

export interface Strand {
  schemaVersion: 1 | 2; // v1 = pick:v0 self-hash; v2 = pick:v2 authenticated chain link
  seq: number; // monotonic history index (0 = genesis)
  pickId: string; // event content-address — pick:v0:… (v1) | pick:v2:… (v2)
  /**
   * NEW (v2) — the authenticated chain link: the pickId of the strand at
   * parentStateId (always the ledger tip). null at genesis. IN the v2 pickId, so
   * reordering/forging a strand breaks the chain. Absent on v1 strands.
   */
  parentPickId?: string | null;
  /**
   * NEW (v2) — agent attribution. agentId is IN the v2 pickId (attribution is
   * event identity); sessionKey is an ephemeral breadcrumb EXCLUDED from the hash.
   */
  authoredBy?: { agentId: string | null; sessionKey?: string | null };
  /**
   * NEW (v2) — the SECOND merge parent (merge strands only): the pickId of the
   * strand at the admit baseId (the ours-side fork base). IN the v2 pickId.
   */
  mergeParentPickId?: string | null;
  stateId: string; // the WarpState this strand lands on (the new selvage)
  parentStateId: string | null; // previous selvage (null at genesis)
  actor: string; // who recorded it — agent/operator identity (attribution)
  intent: string; // human-readable reason
  recordedAt: string; // ISO timestamp (event provenance)
  objectCount: number; // size of the lifted meaning graph (headline for genesis)
  delta: StrandDelta;
  /** RESERVED — graded belief in this pick (the moat signal). null until graded. */
  calibratedConfidence: number | null;
  provenance: {
    ref: string; // WORKTREE or the git ref the snapshot was lifted from
    treeSha: string | null; // git tree provenance, if any (coexistence, not identity)
    gitCommit: string | null; // git HEAD at record time — the coexistence anchor
  };
  /** present only on a KNOT-council resolution strand (omitted on normal picks). */
  resolves?: KnotResolution;
  /**
   * true only on a strand sealed by a materialized CLEAN merge (#admit). Its
   * provenance.gitCommit is ONE parent and does NOT contain the merged bytes, so a
   * later merge must NOT re-base its base/theirs off this strand's commit — admit
   * fails closed instead (H1; durable merged-tree byte-anchoring is native-store work).
   */
  merged?: boolean;
  /**
   * NATIVE byte binding (M1b) — the treeId that reconstructs this strand's working
   * tree from the object store with git ABSENT. EXCLUDED from pickId (backfillable,
   * many-trees-to-one-meaning). Absent on strands not yet bound (backfill stamps it).
   */
  binding?: StrandBinding | null;
  /** the re-derivable merge recipe (merge strands only, M1b). Excluded from pickId. */
  merge?: MergeRecipe;
}

/** The strand minus its own content-address (what `pickId` is computed over). */
export type StrandBody = Omit<Strand, 'pickId'>;

/**
 * Null-normalize a value for hashing: the canonical serializer rejects null
 * (it demands "normalize to empty first"), but a strand body carries meaningful
 * nulls (genesis parent, ungraded confidence, no git tree). Map null/undefined →
 * "" for the ADDRESS only; the stored strand JSON keeps the real nulls. "" is
 * never a real stateId/confidence, so this introduces no collision.
 */
function canonicalSafe(v: unknown): CanonicalValue {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(canonicalSafe);
  if (typeof v === 'object') {
    const out: Record<string, CanonicalValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = canonicalSafe(val);
    return out;
  }
  return v as CanonicalValue;
}

/**
 * pickId = pick:v0:sha256(canonical(identity)) — the EVENT identity. It EXCLUDES
 * calibratedConfidence, binding, and merge: those are graded/bound LATER
 * (survive-overturn outcome; native byte backfill) and must be mutable without
 * changing the strand's content-address. Everything else (stateId, actor, time,
 * intent, delta, provenance, resolves) is the immutable event.
 *
 * Note: binding/merge are excluded even for strands where they ARE known at seal
 * time — one uniform rule so backfill/repair/re-derivation never fork the identity
 * semantics between "new" and "old" strands (native-object-store-design.md §3). The
 * ledger's tamper-evidence is a separate concern handled by the pickId hash-chain
 * (review amendment A1), authored as its own step.
 */
export function computePickId(body: StrandBody): string {
  // v1 legacy path — UNCHANGED self-hash. Lets `fabric verify` recompute every
  // historical strand byte-for-byte; v1 pickIds are immutable and never promoted.
  if (body.schemaVersion < 2) {
    const { calibratedConfidence: _graded, binding: _bound, merge: _merge, ...identity } = body;
    const canon = canonicalSerialize(canonicalSafe(identity));
    return 'pick:v0:' + createHash('sha256').update(canon, 'utf8').digest('hex');
  }
  // v2 — authenticated chain link (parentPickId) + byte binding (bindingTreeId) +
  // agent attribution (authoredBy.agentId) + the merge second-parent/algo folded IN.
  // sessionKey, binding.gitOid, merge.{base,ours,theirs,result}, and
  // calibratedConfidence remain EXCLUDED (§1.1) — each is mutable/derivable post-seal.
  const { calibratedConfidence: _c, binding, merge, authoredBy, ...rest } = body;
  const identity = {
    ...rest, // schemaVersion, seq, stateId, parentStateId, parentPickId, actor, intent,
    // recordedAt, objectCount, delta, provenance, resolves?, merged?, mergeParentPickId?
    authoredBy: { agentId: authoredBy?.agentId ?? null }, // sessionKey EXCLUDED
    bindingTreeId: binding?.treeId ?? null, // A1: fold byte identity into the address
    mergeAlgo: merge?.algo ?? null, // Judge: restore the algo tag
  };
  const canon = canonicalSerialize(canonicalSafe(identity));
  return 'pick:v2:' + createHash('sha256').update(canon, 'utf8').digest('hex');
}

/**
 * The pre-`59c138f7` WHOLE-BODY hashing rule (§7.1) — kept ONLY so `fabric verify`
 * and the rewriteFabric guard can honestly re-verify strands sealed before the
 * exclusion rule existed (this repo's dogfood genesis, seq 0). It hashes the FULL
 * body, INCLUDING calibratedConfidence/binding/merge. Never used to seal new
 * strands; a historical re-verification rule only.
 */
export function computePickIdWholeBody(body: StrandBody): string {
  const canon = canonicalSerialize(canonicalSafe(body));
  return 'pick:v0:' + createHash('sha256').update(canon, 'utf8').digest('hex');
}

/**
 * The pinned BODY HASH of a grandfathered legacy strand (§7.2 containment,
 * HIGH-2/MEDIUM-2): sha256 over the canonical strand body EXCLUDING
 * calibratedConfidence/binding/merge — the same exclusion set as the v1 pickId
 * rule, so #grade (confidence) and `objects backfill` (binding) stay legal while
 * intent/delta/stateId/actor/provenance are all PINNED. A grandfathered strand
 * escapes pickId re-verification (its hashed byte was destroyed, §7.2) but NOT
 * body pinning — tampering its meaning now fails hard instead of hiding behind
 * the grandfather clause.
 */
export function computeLegacyBodyHash(body: StrandBody): string {
  const { calibratedConfidence: _graded, binding: _bound, merge: _merge, ...identity } = body;
  const canon = canonicalSerialize(canonicalSafe(identity));
  return 'sha256:' + createHash('sha256').update(canon, 'utf8').digest('hex');
}

/**
 * Does `strand`'s stored pickId reproduce under a KNOWN hashing rule (§7.1)? For a
 * v2 strand: the v2 rule. For a v1 strand: the current-exclusion rule (§1.4) OR the
 * legacy whole-body rule. Accept on the first match. Callers grandfather the
 * graded-over residue (seq 1–7) separately (§7.2); a strand that reproduces under
 * NO known rule and is NOT grandfathered is a real tamper.
 */
export function reproducesUnderKnownRule(strand: Strand): boolean {
  const { pickId, ...body } = strand;
  if (computePickId(body) === pickId) return true; // v1-exclusion or v2 dispatch
  if (body.schemaVersion < 2 && computePickIdWholeBody(body) === pickId) return true; // legacy whole-body
  return false;
}
