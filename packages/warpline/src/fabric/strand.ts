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
 * THREE schema epochs (dispatched by `schemaVersion` in computePickId):
 *   - v1 (pick:v0) — per-strand self-hash, unlinked.
 *   - v2 (pick:v2) — authenticated LINEAR chain: parentPickId = the physical
 *                    ledger tip; seq is IN the preimage (position-bound identity).
 *   - v3 (pick:v3) — the real PICK-DAG (docs/specs/warpline-v3-identity.md §1):
 *                    pickId = H(parents + content). NO ledger position, ever —
 *                    seq/parentStateId/merged are GONE from the strand (derived);
 *                    parents: string[] is ordered and multi-parent native; the
 *                    full merge recipe and binding.treeId are folded IN; and
 *                    calibratedConfidence leaves the strand entirely (grades.jsonl
 *                    sidecar is authoritative, §7). A sealed v3 strand has ZERO
 *                    post-seal-mutable fields.
 *
 * `calibratedConfidence` (v1/v2 only) is RESERVED (null until graded) — the one
 * field a git-backed history can't carry, and the seed of the non-portable moat:
 * an actor's graded belief at write time, later scored against outcome. On v3 the
 * moat data lives in the grades.jsonl sidecar (spec §7, founder-signed R4).
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
  /**
   * The #knot-payload this resolution settles, when one was persisted.
   *
   * WHY A POINTER AND NOT A COPY. The payload already classifies every contested
   * unit as `direct` (an own-content edit by at least one side) or ripple-only
   * (both essences moved solely through edge-target transitivity — the
   * Merkle-by-target avalanche). That distinction is what separates a GENUINE
   * contest from an OVER-BLOCK, and the field test's headline falsifiers cannot
   * be read without it: "meaning adds nothing over bytes" and "failing closed is
   * unaffordable" are both unreadable if the denominator mixes real contests with
   * commuting-edit false positives (T-2026-07-15-008, measured 3/3 on Move-3).
   *
   * `contended` carries only symbol NAMES, so joining a resolution back to its
   * classification previously meant matching on name and timing — which breaks
   * the moment one symbol is contested twice. This makes the join exact.
   *
   * A pointer rather than an inlined copy because duplicated data drifts, and
   * `.warpline/knots/` is never gc'd (per the audit, "nothing is ever deleted" is
   * load-bearing for recoverability), so the payload is durable. OPTIONAL: a
   * resolution sealed before this field, or one with no persisted payload (a
   * shadow-era contest), stays valid — and because `resolves` is folded WHOLE
   * into the v3 pickId, an ABSENT field is absent from the preimage, so every
   * already-sealed strand keeps its identity.
   */
  knotPayloadId?: string;
}

/**
 * The byte binding of a strand to the NATIVE object store (M1b) — the meaning↔bytes
 * seam. EXCLUDED from pickId (like calibratedConfidence) because it may be backfilled
 * after seal (§3) and because many byte-trees can absorb to one stateId.
 */
export interface StrandBinding {
  treeId: string; // native root treeId — byte identity in the object store
  /** git tree sha of the PROVENANCE ref (coexistence breadcrumb), or null for a
   * merge result / worktree seal. Under worktree:v1 semantics this is the GIT
   * view's oid, NOT the binding tree's own shadow oid (the binding is filtered). */
  gitOid?: string | null;
  /**
   * TREE SEMANTICS (T-2026-07-18-005, the one-tree-semantics decision — see
   * snapshot.ts header): 'worktree:v1' = the binding tree is ignore-honoring
   * (snapshotDir rules — THE canonical semantics for new bindings). ABSENT =
   * legacy-git semantics (git-commit-tree, tracked-but-gitignored files IN),
   * grandfathered; verify/recover treat such a strand under ITS OWN semantics
   * (stake/recover derive the worktree expectation by projection). Rides
   * OUTSIDE the pickId preimage in BOTH epochs: the v2 rule destructures
   * `binding` out and folds only bindingTreeId; the founder-signed v3 preimage
   * (§9/G-law) lists bindingTreeId explicitly — the tag is never hashed.
   */
  treeSemantics?: 'worktree:v1';
}

/**
 * Present only on an ANCHOR strand: a chained attestation over an earlier,
 * weaker-authenticated segment of the fabric. IN the v2 pickId (rides via the
 * preimage `...rest` spread in computePickId), so the attestation is itself
 * chain-protected. kind/epoch are generalized so the v2→v3 epoch boundary can
 * reuse this shape (docs/specs/warpline-v3-identity.md §5). See
 * docs/specs/warpline-v1-anchor.md.
 */
export interface EpochAnchor {
  kind: 'epoch-anchor';
  version: 1; // attestation FORMAT version
  epoch: 'v1' | 'v2'; // the segment being attested ('v2' = the v3 genesis anchor, V3.3)
  prefixCount: number; // number of strands covered (== count of ALL v1 strands)
  prefixTipPickId: string; // stored pickId of the last covered strand (redundant corroboration)
  prefixDigest: string; // sha256:… — anchor.ts §3.1 fold over the covered strands
  manifestDigest: string | null; // sha256:… over the canonical fabric-legacy.json (null iff no manifest)
  grandfatheredCount: number; // pins manifest cardinality (kills the mint variant)
  corroboration: {
    method: 'git-history-prefix-match';
    gitCommit: string; // the commit whose committed fabric.jsonl v1 prefix matched (attest §5.3)
  };
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
  schemaVersion: 1 | 2 | 3; // v1 = pick:v0 self-hash; v2 = pick:v2 chain link; v3 = pick:v3 DAG identity
  /**
   * v1/v2 ONLY — monotonic history index (0 = genesis). GONE on v3: ledger
   * position is a local arrival fact, not event identity; display order is
   * DERIVED from the DAG (dag.ts; spec §1.2). Never persisted on a v3 strand.
   */
  seq?: number;
  pickId: string; // event content-address — pick:v0:… (v1) | pick:v2:… (v2) | pick:v3:… (v3)
  /**
   * v3 ONLY — the ORDERED DAG parents (pickIds). [] at genesis; parents[0] is the
   * primary (chain/ours-history) parent; parents[1] the admitted/merge parent;
   * N-way councils get N. IN the v3 pickId — identity includes ancestry (§1).
   */
  parents?: string[];
  /**
   * v2 ONLY — the authenticated chain link: the pickId of the strand at
   * parentStateId (always the ledger tip). null at genesis. IN the v2 pickId, so
   * reordering/forging a strand breaks the chain. Absent on v1/v3 strands
   * (v3 carries `parents` instead).
   */
  parentPickId?: string | null;
  /**
   * v2/v3 — agent attribution. agentId is IN the pickId (attribution is
   * event identity); sessionKey is an ephemeral breadcrumb EXCLUDED from the hash.
   */
  authoredBy?: { agentId: string | null; sessionKey?: string | null };
  /**
   * v2 ONLY — the SECOND merge parent (merge strands only): the pickId of the
   * strand at the admit baseId (the ours-side fork base). IN the v2 pickId.
   * Absent on v3 (parents[1] is the merge parent).
   */
  mergeParentPickId?: string | null;
  stateId: string; // the WarpState this strand lands on (the new selvage)
  /**
   * v1/v2 ONLY — previous selvage (null at genesis). GONE on v3 (derived: it is
   * parents[0]'s stateId; storing it re-introduces a copy that can drift, §1.1).
   */
  parentStateId?: string | null;
  actor: string; // who recorded it — agent/operator identity (attribution)
  intent: string; // human-readable reason
  recordedAt: string; // ISO timestamp (event identity — stays IN the v3 hash, signed §9.5)
  objectCount: number; // size of the lifted meaning graph (headline for genesis)
  delta: StrandDelta;
  /**
   * v1/v2 ONLY — graded belief in this pick (the moat signal). null until graded.
   * GONE on v3 (spec §7, R4): mutable trust data leaves the signed record; the
   * grades.jsonl sidecar is authoritative. A v3 strand has ZERO mutable fields.
   */
  calibratedConfidence?: number | null;
  provenance: {
    ref: string; // WORKTREE or the git ref the snapshot was lifted from
    treeSha: string | null; // git tree provenance, if any (coexistence, not identity)
    gitCommit: string | null; // git HEAD at record time — the coexistence anchor
  };
  /** present only on a KNOT-council resolution strand (omitted on normal picks). */
  resolves?: KnotResolution;
  /**
   * BYTE-CUSTODY strand (T-2026-07-18-002): true only on a strand sealed for a
   * meaning-NOOP whose TREE advanced (doc/config/lore-only change) — stateId
   * naturally equals the parent's, the delta is empty, the byte binding advances.
   * Always FAST/no-gate (there is no meaning to contest). Additive: absent on
   * every pre-existing strand; on a NEW v2 strand it rides INTO the pickId via
   * the `...rest` preimage spread (tamper-evident), and it is derivable anyway
   * (empty delta + stateId === parent's + binding moved). v2 pick path only —
   * the v3 preimage is founder-signed and does not carry the flag. On the native
   * path byte-custody is likewise DERIVED, not flagged: proposeNative seals a
   * strand whenever the meaning is a NOOP but the tree advanced (empty delta,
   * stateId === parent's, binding.treeId moved) and admitNative carries it forward
   * as a byte-custody FAST_ADMIT — so a doc/asset/.js-only change leaves a strand
   * on both paths (B-1, T-2026-08-11-013; before that fix native dropped it).
   */
  byteOnly?: boolean;
  /**
   * v2 ONLY — true only on a strand sealed by a materialized CLEAN merge (#admit).
   * Its provenance.gitCommit is ONE parent and does NOT contain the merged bytes,
   * so a later merge must NOT re-base its base/theirs off this strand's commit —
   * admit fails closed instead (H1; durable merged-tree byte-anchoring is
   * native-store work). GONE on v3 (derived: parents.length > 1).
   */
  merged?: boolean;
  /**
   * NATIVE byte binding (M1b) — the treeId that reconstructs this strand's working
   * tree from the object store with git ABSENT. v1/v2: EXCLUDED from pickId AS A
   * WHOLE (backfillable) though v2 folds binding.treeId in; absent on strands not
   * yet bound. v3: MANDATORY at seal (bind-on-seal is the only v3 write path —
   * there is no unbound v3 strand; §1.1) and treeId is IN the pickId. gitOid stays
   * excluded/optional in every epoch (coexistence breadcrumb).
   */
  binding?: StrandBinding | null;
  /**
   * The re-derivable merge recipe (merge strands only, M1b). v2: EXCLUDED from
   * pickId (verify-side compensating control). v3: folded WHOLE into the pickId
   * (§1.1 — closes MED-D structurally; a bad recipe means a superseding strand,
   * never a repair).
   */
  merge?: MergeRecipe;
  /**
   * Present ONLY on an epoch-anchor strand (docs/specs/warpline-v1-anchor.md): the
   * chained attestation over the v1 prefix + grandfather manifest. IN the v2 pickId
   * (rides the `...rest` spread), so editing/deleting the anchor breaks the chain.
   */
  attests?: EpochAnchor;
  /**
   * M3-lite I3 (m3-integrity-design-2026-08-23.md §3+§6) — the seal-time AGENT
   * signature: Ed25519 over the domain-separated pickId
   * (`'warpline:strand-sig:v1\n' + pickId`, keys.ts). Present ONLY on an
   * agent-class strand (authoredBy.agentId set) sealed AFTER the signing-epoch
   * boundary (the `signed-from` row in .warpline/keys/registry.jsonl).
   * Human-class strands stay UNSIGNED — the human boundary is PROCEDURAL
   * (founder ruling TD-2026-08-23-136 Q1).
   *
   * EXCLUDED from the pickId preimage in BOTH current sealing epochs, by
   * necessity, not preference: the signature is computed OVER the pickId, so
   * folding it back into the preimage would be circular (no strand could ever
   * reproduce its own id). The v2 rule destructures `sig` out of its `...rest`
   * spread; the founder-signed v3 preimage is EXPLICIT and never picks it up.
   * The retired v1 rule deliberately does NOT exclude it — no v1 strand can
   * legitimately carry a sig (v1 predates the signing epoch), so a grafted one
   * breaks the self-hash and fails CLOSED. Verified by verifyFabric against
   * the REGISTRY public key, never the key file (I4).
   */
  sig?: {
    keyId: string; // 'wlkey:v1:…' — the signing key's registry identity
    sigBase64: string; // Ed25519(STRAND_SIG_DOMAIN + pickId), base64
    principal: string; // must equal authoredBy.agentId (verify: sig-principal-mismatch)
    schemaVersion: 'strandSig:v1';
  };
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
export function canonicalSafe(v: unknown): CanonicalValue {
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
  // `sig` is deliberately NOT excluded here (I3 preimage audit): no v1 strand can
  // legitimately carry one (v1 predates the signing epoch, and nothing seals v1
  // today), so a sig GRAFTED onto a v1 strand lands in the preimage, breaks the
  // self-hash, and fails CLOSED — the correct outcome for a forged field.
  if (body.schemaVersion < 2) {
    const { calibratedConfidence: _graded, binding: _bound, merge: _merge, ...identity } = body;
    const canon = canonicalSerialize(canonicalSafe(identity));
    return 'pick:v0:' + createHash('sha256').update(canon, 'utf8').digest('hex');
  }
  // v3 — pickId = H(parents + content); NO ledger position, EVER (spec §1). The
  // preimage is built EXPLICITLY (no rest-spread) so a stray positional field
  // (seq/parentStateId/merged/parentPickId) can never leak into a v3 identity:
  // position is a local arrival fact, not event identity. vs v2: parents[] replaces
  // the two scalar chain links; the merge recipe is folded WHOLE (closes MED-D
  // structurally); binding.treeId is mandatory-at-seal; calibratedConfidence does
  // not exist on the strand at all (§7). recordedAt stays IN (signed §9.5).
  // `attests` rides in when present (the v2-epoch anchor is chain-protected, §5).
  // `sig` (I3) is SAFE BY CONSTRUCTION here: this preimage is explicit — a field
  // not listed below can never leak into a v3 identity, and `sig` is not listed
  // (it is a signature OVER the pickId; folding it in would be circular).
  if (body.schemaVersion >= 3) {
    const identity = {
      schemaVersion: body.schemaVersion,
      parents: body.parents ?? [], // ORDERED; [] at genesis
      stateId: body.stateId,
      actor: body.actor,
      authoredBy: { agentId: body.authoredBy?.agentId ?? null }, // sessionKey EXCLUDED
      intent: body.intent,
      recordedAt: body.recordedAt,
      objectCount: body.objectCount,
      delta: body.delta,
      provenance: body.provenance,
      ...(body.resolves ? { resolves: body.resolves } : {}), // KNOT council rides along
      bindingTreeId: body.binding?.treeId ?? null, // mandatory at seal (buildStrandV3 enforces)
      ...(body.merge ? { merge: body.merge } : {}), // folded WHOLE (§1.3)
      ...(body.attests ? { attests: body.attests } : {}), // epoch anchor payload (§5)
    };
    const canon = canonicalSerialize(canonicalSafe(identity));
    return 'pick:v3:' + createHash('sha256').update(canon, 'utf8').digest('hex');
  }
  // v2 — authenticated chain link (parentPickId) + byte binding (bindingTreeId) +
  // agent attribution (authoredBy.agentId) + the merge second-parent/algo folded IN.
  // sessionKey, binding.gitOid, merge.{base,ours,theirs,result}, and
  // calibratedConfidence remain EXCLUDED (§1.1) — each is mutable/derivable post-seal.
  // `sig` (I3) is ALSO excluded — of necessity, not policy: the signature is
  // computed OVER the pickId, so a preimage containing it is circular (the sealed
  // strand could never reproduce its own id). Letting it ride the `...rest` spread
  // would silently corrupt the identity of every signed v2 strand.
  const { calibratedConfidence: _c, binding, merge, authoredBy, sig: _sig, ...rest } = body;
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
 *
 * `sig` (I3) is deliberately NOT excluded (same reasoning as the v1 pickId rule):
 * every grandfathered strand is v1 and pre-signing-epoch, so none carries a sig —
 * one grafted on changes the body hash and fails HARD (legacy-body-mismatch).
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
  if (computePickId(body) === pickId) return true; // v1-exclusion, v2, or v3 dispatch
  if (body.schemaVersion < 2 && computePickIdWholeBody(body) === pickId) return true; // legacy whole-body
  return false;
}

/* ── v3 construction (docs/specs/warpline-v3-identity.md §1) ─────────────────── */

/** The input to buildStrandV3 — exactly the v3 event, nothing positional. */
export interface StrandV3Input {
  /** ORDERED DAG parents (pickIds). [] ONLY at a fresh-repo genesis (§1.3). */
  parents: string[];
  stateId: string;
  actor: string;
  /** agentId is IN the pickId; sessionKey is stored but EXCLUDED from the hash. */
  authoredBy?: { agentId: string | null; sessionKey?: string | null };
  intent: string;
  recordedAt: string; // ISO — event identity (git-committer-date precedent, §9.5)
  objectCount: number;
  delta: StrandDelta;
  provenance: { ref: string; treeSha: string | null; gitCommit: string | null };
  /** present only on a KNOT-council resolution strand. */
  resolves?: KnotResolution;
  /** MANDATORY — bind-on-seal is the only v3 write path (no unbound v3 strand). */
  binding: StrandBinding;
  /** the merge recipe (weaves only) — folded WHOLE into the pickId (§1.1). */
  merge?: MergeRecipe;
  /** present only on an epoch-anchor strand (the v2-epoch anchor at v3 genesis, §5). */
  attests?: EpochAnchor;
}

/**
 * Build (and content-address) a v3 strand — the ONLY constructor of v3 identity.
 * Validates the schema-level invariants the spec makes structural:
 *   - binding.treeId present (bind-on-seal mandatory; HIGH-A class dies here);
 *   - parents are well-formed pickIds, ordered, no duplicates;
 *   - a merge recipe requires 2+ parents (a weave IS a multi-parent strand);
 *   - no positional field can exist (the input shape simply has none).
 * Pure — does NOT touch disk; callers append + advance refs themselves (seal/
 * exchange are the write paths; the cutover of the default seal path is V3.3).
 */
export function buildStrandV3(input: StrandV3Input): Strand {
  if (!input.binding?.treeId) {
    throw new Error(
      'warpline: buildStrandV3 refused — binding.treeId is mandatory at v3 seal (bind-on-seal is the only v3 write path; there is no unbound v3 strand — spec §1.1)',
    );
  }
  if (!Array.isArray(input.parents)) {
    throw new Error('warpline: buildStrandV3 refused — parents must be an (ordered) array of pickIds');
  }
  for (const p of input.parents) {
    if (typeof p !== 'string' || !p.startsWith('pick:')) {
      throw new Error(`warpline: buildStrandV3 refused — parent ${JSON.stringify(p)} is not a pickId (pick:…)`);
    }
  }
  if (new Set(input.parents).size !== input.parents.length) {
    throw new Error('warpline: buildStrandV3 refused — duplicate parent pickId (parents are an ordered set)');
  }
  if (input.merge && input.parents.length < 2) {
    throw new Error(
      'warpline: buildStrandV3 refused — a merge recipe requires 2+ parents (merged-ness is DERIVED: parents.length > 1; a single-parent "merge" is a forged recipe)',
    );
  }
  const body: StrandBody = {
    schemaVersion: 3,
    parents: [...input.parents],
    stateId: input.stateId,
    actor: input.actor,
    authoredBy: {
      agentId: input.authoredBy?.agentId ?? null,
      ...(input.authoredBy?.sessionKey !== undefined ? { sessionKey: input.authoredBy.sessionKey } : {}),
    },
    intent: input.intent,
    recordedAt: input.recordedAt,
    objectCount: input.objectCount,
    delta: input.delta,
    provenance: input.provenance,
    ...(input.resolves ? { resolves: input.resolves } : {}),
    binding: input.binding,
    ...(input.merge ? { merge: input.merge } : {}),
    ...(input.attests ? { attests: input.attests } : {}),
  };
  return { ...body, pickId: computePickId(body) };
}
