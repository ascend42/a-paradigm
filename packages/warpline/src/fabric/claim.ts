/**
 * #claim — the claim-scoped propose API, `claim:v1` (P2.3 / roadmap 2.3,
 * docs/specs/warpline-forge.md §3b; T-2026-06-24-018).
 *
 * A claim is the author's PRE-DECLARATION: "this change touches these symbols,
 * for this intent, with this confidence" — declared BEFORE the edit is judged,
 * so admit can compare belief against computation instead of re-deriving
 * everything and throwing the belief away. The claim does triple duty (§3b):
 *
 *   1. HONESTY CHECK — computed-touched ⊄ claimed ⇒ the CLAIM-BREACH verdict
 *      class (admit.ts): a first-class verdict alongside KNOT/DANGLE, carried
 *      in the same decision shape (G3), fail-SAFE not fail-hard — a breach
 *      refuses the seal (HELD-equivalent) with the exact excess set, and is
 *      overridable via an explicit acceptBreach flag that seals but records
 *      the breach fact in the sidecar stream.
 *   2. CALIBRATION PROBE — every evaluation lands as a JSONL row in
 *      .warpline/claims/evaluations.jsonl {claimId, pickId?, agentId, breach,
 *      excess, missing, ts}: the per-agent/per-symbol claimed-vs-computed
 *      honesty signal for the future grade stream (G5 — trust data lives in
 *      sidecars, never on the signed strand).
 *   3. PERF HINT — the claim is RECORDED so a later layer CAN scope ripple
 *      computation by it. Deliberately NOT implemented here (the delta-native
 *      layer already carries perf); no decision function reads a claim to
 *      narrow what it computes.
 *
 * THE EVALUATION RULE (conservative, documented per the mission):
 *   excess  = computed agentChanged symbols NOT in claimedSymbols, where the
 *             symbol is DIRECT-changed (SemDelta.localChanged — an own-content
 *             edit) OR it KNOTS/DANGLES in this admission WITHOUT being a
 *             PROVEN body-internal ripple. A ripple-only symbol (essence moved
 *             solely via Merkle-by-target transitivity, zero local edit) that
 *             does NOT knot never counts as excess — charging an author for a
 *             48-symbol Merkle avalanche (T-2026-07-03-002) would make honest
 *             claims impossible. A ripple-only symbol that DOES knot counts —
 *             contested reality — UNLESS its ripple is proven body-internal
 *             (localChanged false AND rippleFromContract false, the stage-1
 *             bit): the essence inlines callee bodies into callers, so an
 *             honest single-symbol edit re-addresses every caller and can knot
 *             them against a concurrent writer; charging the claim for that
 *             engine artifact converts accurate self-reporting into a breach
 *             (T-2026-07-21-008 — the documented trust-erosion path). The
 *             exemption is exactly as narrow as the proof: rippleFromContract
 *             absent or true keeps the knot counting (fail closed). When no
 *             agentDelta is supplied, EVERY unclaimed changed symbol counts
 *             (absent ⇒ treated direct — the same convention as Knot.direct).
 *   missing = claimed but untouched. Recorded (an over-claim is calibration
 *             signal), NEVER a breach.
 *   breach  = excess.length > 0.
 *
 * Guardrails honored: G1 (claim:v1, versioned-additive; claims are OPT-IN —
 * an admit without a claim is byte-identical to pre-claim behavior), G2 (no
 * seq/ledger positions — claims key on claimId, evaluations on claimId/pickId),
 * G3 (claimedContractDelta is the engine's SemDelta shape verbatim; the claim
 * schema IS the future OFFER metadata), G5 (claims + evaluations are sidecar
 * data under .warpline/claims/ — never a strand field; the pickId preimage is
 * founder-signed and UNTOUCHED).
 *
 * INJECTION SAFETY (§3d): `intent` — the only free-prose field — is an
 * UntrustedProse envelope, born content-addressed. `taskRef` is a structured
 * reference (a task id / URL), not prose. No verdict or evaluation function
 * reads prose: evaluateClaim compares symbol SETS only (the poisoned-prose
 * invariant test covers claim fields).
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SemDelta, SemDeltaSet } from '../sem-delta.js';
import type { AdmitDecision } from './admit.js';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe } from './strand.js';
import { envelopeProse, verifyProse, type UntrustedProse } from '../envelope.js';

export const CLAIM_SCHEMA = 'claim:v1' as const;

/** The author's pre-declaration — sealed belief, immutable once judged (§3b). */
export interface Claim {
  schemaVersion: typeof CLAIM_SCHEMA;
  /** content address of this claim (excludes itself) — 'claim:v1:sha256…'. */
  claimId: string;
  /** the declaring agent (attribution — the calibration probe's subject). */
  agentId: string;
  /**
   * structured task reference (e.g. a T-… task id or a URL) — an IDENTIFIER,
   * not prose. Free-text task DESCRIPTIONS belong in `intent` (enveloped).
   */
  taskRef?: string;
  /** the symbols the author believes this change touches (sorted, deduped). */
  claimedSymbols: string[];
  /**
   * the author's predicted contract delta — the engine's SemDelta shape
   * VERBATIM (G3). Recorded for the future grade stream; NOT evaluated by
   * the v1 breach rule (symbol-set comparison only).
   */
  claimedContractDelta?: SemDelta[];
  /** the author's belief this claim is complete/correct (0–1). */
  confidence?: number;
  /** why — agent prose, ENVELOPED (§3d). Never read by a decision function. */
  intent: UntrustedProse;
}

export interface CreateClaimInput {
  agentId: string;
  taskRef?: string;
  claimedSymbols: string[];
  claimedContractDelta?: SemDelta[];
  confidence?: number;
  /** free text — enveloped at creation (§3d). */
  intent: string;
}

/**
 * Create (and content-address) a claim — the ONLY constructor of claim
 * identity. Pure: no clock, no disk; persist via persistClaim. Deterministic:
 * same inputs ⇒ same claimId.
 */
export function createClaim(input: CreateClaimInput): Claim {
  if (!input.agentId || typeof input.agentId !== 'string') {
    throw new Error('warpline: createClaim — agentId is required (the calibration probe is per-agent)');
  }
  if (!Array.isArray(input.claimedSymbols) || input.claimedSymbols.some((s) => typeof s !== 'string' || !s)) {
    throw new Error('warpline: createClaim — claimedSymbols must be an array of non-empty symbol names');
  }
  if (input.confidence !== undefined && !(typeof input.confidence === 'number' && input.confidence >= 0 && input.confidence <= 1)) {
    throw new Error('warpline: createClaim — confidence must be a number in [0, 1]');
  }
  if (typeof input.intent !== 'string') {
    throw new Error('warpline: createClaim — intent (free text) is required; it is enveloped at creation (§3d)');
  }
  const body: Omit<Claim, 'claimId'> = {
    schemaVersion: CLAIM_SCHEMA,
    agentId: input.agentId,
    ...(input.taskRef ? { taskRef: input.taskRef } : {}),
    claimedSymbols: Array.from(new Set(input.claimedSymbols)).sort(),
    ...(input.claimedContractDelta ? { claimedContractDelta: input.claimedContractDelta } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    intent: envelopeProse(input.intent),
  };
  const claimId = 'claim:v1:' + createHash('sha256').update(canonicalSerialize(canonicalSafe(body)), 'utf8').digest('hex');
  return { claimId, ...body };
}

/**
 * Is this a well-formed, UNTAMPERED claim? Recomputes the content address and
 * verifies the intent envelope (fail closed on either). Admit refuses to judge
 * against a claim that fails this — an unverifiable belief grades nobody.
 */
export function verifyClaim(c: unknown): c is Claim {
  if (typeof c !== 'object' || c === null) return false;
  const e = c as Record<string, unknown>;
  if (e.schemaVersion !== CLAIM_SCHEMA) return false;
  if (typeof e.claimId !== 'string' || typeof e.agentId !== 'string') return false;
  if (!Array.isArray(e.claimedSymbols) || e.claimedSymbols.some((s) => typeof s !== 'string')) return false;
  if (!verifyProse(e.intent)) return false;
  const { claimId, ...body } = e;
  const recomputed = 'claim:v1:' + createHash('sha256').update(canonicalSerialize(canonicalSafe(body)), 'utf8').digest('hex');
  return recomputed === claimId;
}

/* ── evaluation (the honesty check + calibration probe) ──────────────────────── */

export interface ClaimEvaluation {
  /** computed-touched ⊄ claimed (per the documented excess rule above). */
  breach: boolean;
  /**
   * changed-but-unclaimed symbols that COUNT (direct, or ripple-only-but-
   * knotting minus the proven body-internal ripples — see the module rule). Sorted.
   */
  excess: string[];
  /** claimed-but-untouched symbols. Recorded, never a breach. Sorted. */
  missing: string[];
}

export interface EvaluateClaimOptions {
  /**
   * the agent's computed base→proposed delta, for the direct-vs-ripple
   * distinction (SemDelta.localChanged). Absent ⇒ every changed symbol is
   * treated DIRECT (conservative — matches the Knot.direct convention).
   */
  agentDelta?: SemDeltaSet;
}

/**
 * Compare the author's claimed symbol set against the admit decision's
 * COMPUTED agentChanged set. Pure over its inputs; reads NO prose field (the
 * pure-function-verdict contract, §3d). See the module header for the
 * documented excess/missing/breach rule.
 */
export function evaluateClaim(decision: AdmitDecision, claim: Claim, opts: EvaluateClaimOptions = {}): ClaimEvaluation {
  const claimed = new Set(claim.claimedSymbols);
  const computed = new Set(decision.agentChanged);

  // Symbols that knot/dangle in THIS admission — a ripple-only change that
  // knots is contested reality, not avalanche noise: it counts.
  const knotted = new Set<string>([
    ...decision.knots.map((k) => k.symbol),
    ...decision.dangling.map((d) => d.fromSymbol),
  ]);

  // Direct-changed symbols: any delta for the symbol with an own-content edit
  // (localChanged ≠ false; absent ⇒ treated direct — conservative). Alongside:
  // the PROVEN body-internal ripples (localChanged false AND rippleFromContract
  // false — the stage-1 bit, fail-closed towards true), whose knots are the
  // essence over-block's own artifact and must not grade the author
  // (T-2026-07-21-008).
  let direct: Set<string> | null = null;
  const bodyInternalRipple = new Set<string>();
  if (opts.agentDelta) {
    direct = new Set<string>();
    for (const d of opts.agentDelta.deltas.values()) {
      if (d.localChanged !== false) direct.add(d.symbol);
      else if (d.rippleFromContract === false) bodyInternalRipple.add(d.symbol);
    }
  }

  const excess = [...computed]
    .filter((s) => !claimed.has(s))
    .filter((s) => {
      if (!direct) return true; // no delta info — every unclaimed change counts
      if (direct.has(s)) return true; // own-content edit — always counts
      if (!knotted.has(s)) return false; // ripple-only, uncontested — avalanche noise
      // Ripple-only AND knotting: contested reality — unless PROVEN body-internal.
      return !bodyInternalRipple.has(s);
    })
    .sort();
  const missing = [...claimed].filter((s) => !computed.has(s)).sort();
  return { breach: excess.length > 0, excess, missing };
}

/* ── sidecar persistence (.warpline/claims/ — G5: never a strand field) ───────── */

const safeName = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

export function claimsDirOf(root: string): string {
  return path.join(root, '.warpline', 'claims');
}

/** Persist a claim to .warpline/claims/<claimId>.json (atomic, idempotent). */
export function persistClaim(root: string, claim: Claim): string {
  if (!verifyClaim(claim)) {
    throw new Error('warpline: persistClaim — refusing to persist a claim that fails verification (tampered/forged) — fail closed');
  }
  const dir = claimsDirOf(root);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, `${safeName(claim.claimId)}.json`);
  if (!fs.existsSync(full)) {
    const tmp = `${full}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(claim, null, 2), 'utf8');
    fs.renameSync(tmp, full);
  }
  return full;
}

/**
 * Resolve a selector (exact claimId or a ≥12-char prefix) to a persisted,
 * VERIFIED claim. A stored claim that fails verification returns null — admit
 * must never judge against a tampered belief (fail closed).
 */
export function readClaim(root: string, selector: string): Claim | null {
  const dir = claimsDirOf(root);
  const tryLoad = (file: string): Claim | null => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      return verifyClaim(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const exact = path.join(dir, `${safeName(selector)}.json`);
  if (fs.existsSync(exact)) return tryLoad(exact);
  if (!fs.existsSync(dir) || selector.length < 12) return null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const claim = tryLoad(path.join(dir, name));
    if (claim && claim.claimId.startsWith(selector)) return claim;
  }
  return null;
}

/* ── the evaluation stream (.warpline/claims/evaluations.jsonl — G5 sidecar) ──── */

/** One calibration-probe row: a claim judged against a computed decision. */
export interface ClaimEvaluationRow {
  claimId: string;
  /** the sealed strand this evaluation graded into (null when the admit did not seal). */
  pickId: string | null;
  agentId: string;
  breach: boolean;
  excess: string[];
  missing: string[];
  /** true when a breach was explicitly overridden (acceptBreach) and the admit sealed anyway. */
  acceptedBreach?: boolean;
  ts: string;
}

export function evaluationsPathOf(root: string): string {
  return path.join(claimsDirOf(root), 'evaluations.jsonl');
}

/** Append one evaluation row (the calibration-probe stream for the grade layer). */
export function recordClaimEvaluation(root: string, row: ClaimEvaluationRow): void {
  fs.mkdirSync(claimsDirOf(root), { recursive: true });
  fs.appendFileSync(evaluationsPathOf(root), JSON.stringify(row) + '\n', 'utf8');
}

/** All recorded evaluations (unreadable rows skipped, never fatal). */
export function listClaimEvaluations(root: string): ClaimEvaluationRow[] {
  const file = evaluationsPathOf(root);
  if (!fs.existsSync(file)) return [];
  const out: ClaimEvaluationRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ClaimEvaluationRow);
    } catch {
      /* skip */
    }
  }
  return out;
}
