/**
 * #refusal — `refusal:v1`, the MACHINE-READABLE REFUSAL (SP0/SP1, founder
 * constraint TD-2026-07-21-766; pre-registered falsifier F4 "cold-agent
 * legibility").
 *
 * THE CONSTRAINT THIS OBJECT CARRIES. An agent of ANY provider — with no
 * Warpline in its weights and no Warpline documentation in its context — must be
 * able to drive propose → admit → KNOT → resolve using ONLY tool descriptions
 * and the refusal objects Warpline hands back. Git is easy for models because
 * git is MEMORIZED; Warpline never will be. Runtime self-description is
 * therefore the only mechanism available, and this object is its load-bearing
 * carrier: a refusal must state what refused, why, whether the caller may try
 * again, exactly which units are contested, and — above all — WHAT TO CALL NEXT.
 *
 * THE BINDING RULE: **no human sentences in a verdict, ever.** Every field here
 * is an id, an enum, a pointer, or a count. A cold model must never have to
 * parse prose to recover, because prose parsing is exactly the capability that
 * varies across providers (and exactly the surface §3d treats as untrusted).
 * Human-facing prose stays where it always was: OUTSIDE the verdict — in the
 * thrown Error's `message`, in CLI rendering, or ENVELOPED as UntrustedProse
 * (envelope.ts) when it originates from an agent. `next[]` replaces the sentence
 * "run `warpline resolve …`" with the structured call itself.
 *
 * SHAPE DISCIPLINE, mirroring #knot-payload (the model for this module):
 *   G1 — schemaVersion on every object; evolution is additive or a version bump.
 *   G2 — no seq / ledger positions: every reference is a stateId, pickId,
 *        payloadId, claimId, stableKey or symbol NAME.
 *   G3 — this IS the engine shape; the CLI, the daemon and the forge project it
 *        verbatim rather than re-deriving a parallel error vocabulary.
 *   G4 — a refusal is DATA. It never performs, retries, or overrides anything;
 *        `next[]` and `override` DESCRIBE the doors, they do not open them.
 *   G5 — derived data. A refusal is never a signed strand field.
 *
 * TRUNCATION HONESTY: `contested` is capped at MAX_CONTESTED so an
 * essence-transitivity avalanche cannot blow a tool-result budget, and
 * `contestedTotal` always carries the FULL count — a truncated list without a
 * total is a lie. The surviving entries are the RANKED ones (direct-contested
 * before ripple-only, T-2026-07-03-002): the cap keeps the units that matter.
 *
 * Library code: no console output.
 */

import type { AdmitStatus } from './admit.js';
import type { Knot, Dangle, KnotRule } from '../predict.js';
import { rankOf } from './rank.js';

export const REFUSAL_SCHEMA = 'refusal:v1' as const;

/**
 * The maximum number of contested units carried inline. Ground truth put every
 * ≥10-symbol flag set at 0% churn-validated (T-2026-07-03-002), so 32 is already
 * far past the useful band — it exists to bound the payload, not to inform.
 * Anything beyond it is reachable via `pointers.knotPayloadId` (#knot-payload).
 */
export const MAX_CONTESTED = 32;

/**
 * WHY the refusal happened, as a closed enum. Stable and additive (G1) — a cold
 * agent may branch on these without ever reading a sentence.
 *
 *   GATE_REFUSED     a MEANING verdict refuses the write (KNOT / DANGLE), or the
 *                    R2 agent gate refuses an attributed pick.
 *   CLAIM_BREACH     the computed touched set escaped the pre-declared claim:v1.
 *   TRUST_HELD       an independent-confidence CLEAN touched a below-floor symbol.
 *   STALE_BASE       the caller's base is behind the selvage; rebase and re-propose.
 *   INTEGRITY_BROKEN the fabric/object custody does not verify — no write may proceed.
 *   AUTH             missing or unknown token.
 *   FORBIDDEN        the verb × principal-class matrix refused (Aegis §2.2).
 *   BAD_REQUEST      malformed frame / missing required params.
 *   UNKNOWN_VERB     the verb is not in the surface.
 *   NOT_FOUND        the selector matched nothing.
 *   UNSUPPORTED      the request is well-formed but this build cannot service it.
 *   ENGINE           the engine could not produce a verdict (it threw, or a gate
 *                    input was unreadable). Carries no verdict — fail closed.
 */
export type RefusalCode =
  | 'GATE_REFUSED'
  | 'CLAIM_BREACH'
  | 'TRUST_HELD'
  | 'STALE_BASE'
  | 'INTEGRITY_BROKEN'
  | 'AUTH'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'UNKNOWN_VERB'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'ENGINE';

/** WHICH gate refused — the layer, not the reason. */
export type RefusalGate = 'meaning' | 'claim' | 'trust' | 'pick' | 'transport' | 'usage';

/**
 * MAY the caller try again, and under what precondition? The single PRIMARY
 * recovery axis; when more than one door exists, `next[]` enumerates them all.
 *
 *   retry-identical      the same call may succeed (transient failure).
 *   retry-corrected      a CORRECTED or PREREQUISITE call succeeds — follow
 *                        `next[]`, then retry. Covers both wrong-params and
 *                        missing-prerequisite: the recovery axis is identical
 *                        ("a different call first") and `next[]` disambiguates
 *                        (PW-1, mcp-skin-spec §4 — 'never' on a fixable call
 *                        taught cold agents to abandon instead of correct).
 *   retry-after-rebase   re-fork/re-propose against the current selvage first.
 *   retry-after-resolve  a KNOT/DANGLE must be resolved first (human-class verb).
 *   retry-with-override  only an explicit human override flag unblocks this.
 *   never                no retry of any form will change the outcome.
 */
export type Retriability =
  | 'retry-identical'
  | 'retry-corrected'
  | 'retry-after-rebase'
  | 'retry-after-resolve'
  | 'retry-with-override'
  | 'never';

/**
 * One contested unit, RANKED. Structural only — no bodies, no diffs, no prose:
 * this is the "what is contested" index; the resolvable CONTENT lives in the
 * #knot-payload the refusal points at.
 */
export interface RefusalContested {
  stableKey: string;
  symbol: string;
  /**
   * WHICH decision rule fired (#predict). `null` when the verdict came from a
   * producer that does not label its rules (hand-built Prediction fixtures, or a
   * pre-`rule` shape) — an explicit unknown, never a guessed label.
   */
  rule: KnotRule | null;
  /** the slots both sides changed in conflicting directions (empty for dangles). */
  conflictingSlots: string[];
  /** direct-contested (own-content edit) vs ripple-only (essence transitivity). */
  rank: 'direct' | 'ripple';
}

/**
 * ONE recoverable next call — THE field F4 rests on. A cold agent that can read
 * `next[0]` can act without ever having seen Warpline before:
 *
 *   verb      the call to make. Shares the DAEMON_VERBS vocabulary
 *             (daemon/protocol.ts) wherever a daemon verb exists; CLI-only verbs
 *             (e.g. `pick`, `fork`) use their CLI name.
 *   params    arguments ALREADY DETERMINED by the refusal — copy them verbatim.
 *   requires  argument NAMES the caller must still supply. Empty ⇒ `params`
 *             alone is a complete call.
 *   principal WHO may make it. 'human' marks the human-class verbs and the
 *             override flags (Aegis §2.2 / HUMAN_ONLY_VERBS): an agent that
 *             sees principal:'human' must ESCALATE, not attempt.
 */
export interface RefusalNextStep {
  verb: string;
  params: Record<string, string>;
  requires: string[];
  principal: 'agent' | 'human';
}

/** Content addresses / names the caller can hydrate. No ledger positions (G2). */
export interface RefusalPointers {
  /** the #knot-payload holding both sides' bodies + the resolution envelope. */
  knotPayloadId?: string;
  /** the state the caller asked to admit. */
  proposedStateId?: string;
  /** the selvage the proposal was judged against (the rebase target). */
  rebasedOnto?: string;
  /** the claim:v1 the admission was judged under. */
  claimId?: string;
  /** the symbol NAMES the refusal is about (e.g. a claim's excess set). */
  symbols?: string[];
}

/** The explicit, human-class door out of a fail-SAFE hold. Never an agent's to open. */
export interface RefusalOverride {
  flag: 'acceptBreach' | 'acceptRisk';
  principal: 'human';
}

/** `refusal:v1` — the whole machine-readable refusal. No prose, ever. */
export interface Refusal {
  schemaVersion: typeof REFUSAL_SCHEMA;
  code: RefusalCode;
  /** the admission verdict class behind the refusal; null for transport/usage. */
  verdict: AdmitStatus | null;
  gate: RefusalGate;
  retriable: Retriability;
  /** RANKED and CAPPED at MAX_CONTESTED — read `contestedTotal` for the truth. */
  contested: RefusalContested[];
  /** the FULL contested count (≥ contested.length). */
  contestedTotal: number;
  pointers: RefusalPointers;
  /**
   * The recoverable calls, most-immediate first. EMPTY means exactly one thing:
   * no call recovers this — escalate. (It never means "we didn't bother".)
   */
  next: RefusalNextStep[];
  override?: RefusalOverride;
}

/* ── the code tables (totality is a TESTED invariant) ────────────────────────── */

/**
 * PROCESS EXIT CODE per refusal code — the shell-legible half of F4 (an agent
 * that cannot parse JSON can still branch on `$?`). Distinct codes exist only
 * where the RECOVERY differs; everything the caller simply got wrong shares 2.
 *
 *   0  admitted / sealed / clean read          (never a Refusal)
 *   1  Warpline refuses; do not proceed
 *   2  the caller's request was wrong or unserviceable
 *   3  claim breach          → widen the claim, or human --accept-breach
 *   4  trust floor held      → human --accept-risk
 *   5  stale base            → rebase and re-propose
 */
const EXIT_FOR: Record<RefusalCode, number> = {
  GATE_REFUSED: 1,
  INTEGRITY_BROKEN: 1,
  ENGINE: 1,
  BAD_REQUEST: 2,
  UNKNOWN_VERB: 2,
  NOT_FOUND: 2,
  AUTH: 2,
  FORBIDDEN: 2,
  UNSUPPORTED: 2,
  CLAIM_BREACH: 3,
  TRUST_HELD: 4,
  STALE_BASE: 5,
};

/**
 * The process exit code for a refusal code. TOTAL over RefusalCode by
 * construction (the table is a Record, so a new code fails to compile until it
 * is mapped) — and re-asserted at runtime, because an unmapped code must fail
 * CLOSED as "Warpline refuses" rather than leak a success exit.
 */
export function exitCodeFor(code: RefusalCode): number {
  return EXIT_FOR[code] ?? 1;
}

/**
 * The process exit code for a whole admission OUTCOME: the refusal's mapped
 * code when one is present, else 0 (sealed, NOOP, or an unsealed non-refusing
 * report). THE consumer wiring exitCodeFor was built for and then left
 * unconsumed (T-2026-07-21-006): `admit --native` exited 0 on an unsealed
 * CLAIM-BREACH — indistinguishable from success without parsing output, the
 * F4-critical silent failure. Every skin (CLI, daemon, MCP) derives its exit
 * from the result's OWN refusal object, never from a re-derived vocabulary (G3).
 */
export function exitCodeForResult(result: { refusal?: Refusal }): number {
  return result.refusal ? exitCodeFor(result.refusal.code) : 0;
}

/**
 * A THROWN refusal — the typed carrier for prerequisite/usage refusals raised
 * at engine boundaries (PW-2, mcp-skin-spec §4). Before this class, a
 * sequencing mistake (admit with nothing proposed, propose over a legacy
 * scratch, resolve with no scratch strand…) threw a prose Error that every
 * skin's catch-all collapsed to ENGINE / retry-identical / empty next[] — the
 * machine hint said "retry the identical call", which fails forever, while the
 * real recovery lived only in prose. Throwing the refusal itself lets every
 * skin (CLI fail(), daemon catch-all, MCP) detect it and emit the carried
 * `refusal:v1` verbatim instead of the ENGINE dead-end (G3: one vocabulary,
 * built engine-side, inherited by all skins).
 *
 * `message` stays the human sentence — prose belongs OUTSIDE the verdict, in
 * the Error where it always was (the binding rule above).
 */
export class RefusedError extends Error {
  constructor(
    public refusal: Refusal,
    message: string,
  ) {
    super(message);
    this.name = 'RefusedError';
  }
}

/**
 * DEFAULT gate per code, for the codes whose layer is unambiguous. Overridable
 * at the call site because one code can be raised by more than one gate: a
 * GATE_REFUSED is 'meaning' at #admit but 'pick' at the R2 agent gate, and an
 * ENGINE refusal belongs to whichever gate failed to evaluate.
 */
const GATE_FOR: Record<RefusalCode, RefusalGate> = {
  GATE_REFUSED: 'meaning',
  STALE_BASE: 'meaning',
  INTEGRITY_BROKEN: 'meaning',
  CLAIM_BREACH: 'claim',
  TRUST_HELD: 'trust',
  AUTH: 'transport',
  FORBIDDEN: 'transport',
  ENGINE: 'transport',
  BAD_REQUEST: 'usage',
  UNKNOWN_VERB: 'usage',
  NOT_FOUND: 'usage',
  UNSUPPORTED: 'usage',
};

/**
 * DEFAULT retriability per code. Overridable: a pick-gate GATE_REFUSED on a
 * CLEAN-that-would-not-materialize wants 'retry-after-rebase', not the KNOT
 * default. ENGINE is 'retry-identical' because the request itself was
 * well-formed — the identical call is the only recovery a cold agent can
 * attempt, and fabric-lock contention is the common cause.
 */
const RETRIABLE_FOR: Record<RefusalCode, Retriability> = {
  GATE_REFUSED: 'retry-after-resolve',
  CLAIM_BREACH: 'retry-with-override',
  TRUST_HELD: 'retry-with-override',
  STALE_BASE: 'retry-after-rebase',
  INTEGRITY_BROKEN: 'never',
  ENGINE: 'retry-identical',
  // AUTH/FORBIDDEN stay 'never': true for the SAME principal — the recovery is
  // escalation, and that door is carried by `next[]`, not the retry axis.
  AUTH: 'never',
  FORBIDDEN: 'never',
  // The caller got the CALL wrong, not the outcome: a corrected call succeeds.
  // 'never' here was semantically false and taught cold agents to abandon
  // exactly when they should fix one param and retry (PW-1).
  BAD_REQUEST: 'retry-corrected',
  UNKNOWN_VERB: 'retry-corrected',
  NOT_FOUND: 'retry-corrected',
  UNSUPPORTED: 'never',
};

/** The default gate for a code (call sites override where the layer differs). */
export function gateFor(code: RefusalCode): RefusalGate {
  return GATE_FOR[code] ?? 'usage';
}

/** The default retriability for a code (call sites override). */
export function retriabilityFor(code: RefusalCode): Retriability {
  return RETRIABLE_FOR[code] ?? 'never';
}

/* ── construction ────────────────────────────────────────────────────────────── */

/** What a call site supplies; everything else is derived by `refuse`. */
export interface RefuseInput {
  code: RefusalCode;
  /** the verdict class behind the refusal. Omitted ⇒ null (transport/usage). */
  verdict?: AdmitStatus | null;
  /** override the code's default gate (see GATE_FOR). */
  gate?: RefusalGate;
  /** override the code's default retriability (see RETRIABLE_FOR). */
  retriable?: Retriability;
  /** the FULL contested set — ranked and capped by `refuse`, never by the caller. */
  contested?: RefusalContested[];
  /**
   * the full contested count when the caller's `contested` array is ITSELF
   * already partial. Omitted ⇒ `contested.length` (the honest default).
   */
  contestedTotal?: number;
  pointers?: RefusalPointers;
  next?: RefusalNextStep[];
  override?: RefusalOverride;
}

/**
 * THE single constructor for `refusal:v1`. No other module may build a Refusal
 * literal — one constructor is what makes the cap, the total, the ranking and
 * the code tables invariants rather than per-site conventions.
 *
 * Deterministic: same input ⇒ byte-identical output. No clock, no I/O, no
 * randomness; the contested set is ordered direct-before-ripple then by
 * stableKey, so the truncation is stable AND keeps the units that matter.
 */
export function refuse(input: RefuseInput): Refusal {
  const all = input.contested ?? [];
  const ranked = [...all].sort(rankOrder);
  const pointers = prunePointers(input.pointers ?? {});
  return {
    schemaVersion: REFUSAL_SCHEMA,
    code: input.code,
    verdict: input.verdict ?? null,
    gate: input.gate ?? gateFor(input.code),
    retriable: input.retriable ?? retriabilityFor(input.code),
    contested: ranked.slice(0, MAX_CONTESTED),
    contestedTotal: input.contestedTotal ?? all.length,
    pointers,
    next: input.next ?? [],
    ...(input.override ? { override: input.override } : {}),
  };
}

/** Direct-contested first (the product, T-2026-07-03-002), then stableKey asc. */
function rankOrder(a: RefusalContested, b: RefusalContested): number {
  if (a.rank !== b.rank) return a.rank === 'direct' ? -1 : 1;
  return a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0;
}

/** Drop undefined/empty pointer keys so the object carries no dead weight. */
function prunePointers(p: RefusalPointers): RefusalPointers {
  const out: RefusalPointers = {};
  if (p.knotPayloadId) out.knotPayloadId = p.knotPayloadId;
  if (p.proposedStateId) out.proposedStateId = p.proposedStateId;
  if (p.rebasedOnto) out.rebasedOnto = p.rebasedOnto;
  if (p.claimId) out.claimId = p.claimId;
  if (p.symbols?.length) out.symbols = [...p.symbols];
  return out;
}

/**
 * Project a decision's knots + dangles onto the refusal's contested index. The
 * ONE mapping from #predict shapes to `refusal:v1`, so every refusal site
 * describes contest the same way. Structural only — no bodies, no prose.
 */
export function contestedOf(knots: readonly Knot[], dangling: readonly Dangle[]): RefusalContested[] {
  return [
    ...knots.map(
      (k): RefusalContested => ({
        stableKey: k.stableKey,
        symbol: k.symbol,
        rule: k.rule ?? null,
        conflictingSlots: [...k.conflictingSlots],
        rank: rankOf(k),
      }),
    ),
    ...dangling.map(
      (d): RefusalContested => ({
        stableKey: d.fromKey,
        symbol: d.fromSymbol,
        rule: d.rule ?? null,
        // a dangle is a broken REFERENCE, not a slot disagreement.
        conflictingSlots: [],
        rank: rankOf(d),
      }),
    ),
  ];
}
