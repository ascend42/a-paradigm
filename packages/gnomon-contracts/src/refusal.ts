/**
 * refusal:v1 — Gnomon superset (spec §4.6).
 *
 * Shape and semantics lifted from packages/warpline/src/fabric/refusal.ts
 * (REFUSAL_SCHEMA, MAX_CONTESTED 32, RefusalGate, Retriability,
 * RefusalNextStep{verb,params,requires,principal}, Refusal, refuse(),
 * refusalOf(), the exit-code table) — COPIED, never imported: no engine type
 * enters kernel contracts (A-boundary-4). Differences from Warpline:
 *
 *   - `verdict` is `string | null` (Warpline's AdmitStatus values are legal strings);
 *   - `contested[].rule` is `string | null` (Warpline's KnotRule values are legal);
 *   - five more codes (BUDGET_DENIED, PERMIT_REQUIRED, CAS_LOST, BILLING_REFUSED,
 *     MODEL_UNAVAILABLE) with their exit codes 6/2/7/8/9;
 *   - more gates: budget, billing, model, voice, link (claim already existed),
 *     and review, strictness (reserved M1.1, P8-D86–D88, §4.11);
 *   - an optional `data` object for refusal data (§4.9: `UNSUPPORTED{data:{offered[]}}`,
 *     `FORBIDDEN{data:{reason}}` for voice/link/presence reasons). Additive per §4.9.
 *
 * Warpline's schema is a strict subset: every Warpline refusal validates here
 * (G-CON-02, test/refusal.test.ts).
 */

import { Checker, isPlainObject, type ValidateOptions } from './internal.js';

export const REFUSAL_SCHEMA = 'refusal:v1' as const;
export const MAX_CONTESTED = 32;

/** Warpline's twelve codes (refusal.ts:76-88). */
export const WARPLINE_REFUSAL_CODES = [
  'GATE_REFUSED',
  'CLAIM_BREACH',
  'TRUST_HELD',
  'STALE_BASE',
  'INTEGRITY_BROKEN',
  'AUTH',
  'FORBIDDEN',
  'BAD_REQUEST',
  'UNKNOWN_VERB',
  'NOT_FOUND',
  'UNSUPPORTED',
  'ENGINE',
] as const;
export const GNOMON_ONLY_REFUSAL_CODES = [
  'BUDGET_DENIED',
  'PERMIT_REQUIRED',
  'CAS_LOST',
  'BILLING_REFUSED',
  'MODEL_UNAVAILABLE',
] as const;
export const REFUSAL_CODES = [...WARPLINE_REFUSAL_CODES, ...GNOMON_ONLY_REFUSAL_CODES] as const;
/** Closed: a new code needs a JSON-RPC code and an exit code, i.e. a version bump. */
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const WARPLINE_REFUSAL_GATES = ['meaning', 'claim', 'trust', 'pick', 'transport', 'usage'] as const;
export const REFUSAL_GATES = [
  ...WARPLINE_REFUSAL_GATES,
  'budget',
  'billing',
  'model',
  'voice',
  'link',
  // reserved M1.1 (P8-D86–D88, §4.11): review-convergence cap and strictness levels/run modes.
  'review',
  'strictness',
] as const;
/** Additive enum (§4.9): a client renders an unknown gate opaquely. */
export type RefusalGate = (typeof REFUSAL_GATES)[number];

export const RETRIABILITIES = [
  'retry-identical',
  'retry-corrected',
  'retry-after-rebase',
  'retry-after-resolve',
  'retry-with-override',
  'never',
] as const;
export type Retriability = (typeof RETRIABILITIES)[number];

export const NEXT_PRINCIPALS = ['agent', 'human'] as const;
export const CONTESTED_RANKS = ['direct', 'ripple'] as const;
export const OVERRIDE_FLAGS = ['acceptBreach', 'acceptRisk'] as const;

/** Voice-approval refusal reasons (§14.7), carried in `data.reason`, gate `voice`. Reserved M1.1 (P8-D58). */
export const VOICE_REFUSAL_REASONS = [
  'voice-off',
  'voice-not-armed',
  'voice-custody',
  'voice-peer',
  'voice-surface',
  'voice-conn',
  'voice-project',
  'voice-class',
  'voice-hand-only',
  'voice-ineligible',
  'voice-target',
  'voice-ambiguous',
  'voice-handle',
  'voice-stale-utterance',
  'voice-grammar',
  'voice-speaker',
  'voice-echo',
  'voice-playback',
  'voice-readback-missing',
  'voice-challenge',
  'voice-confirm-expired',
  'voice-route',
  'voice-focus',
  'voice-rate',
  'held',
  // reserved M1.1 (P8-D86–D88, §4.11): the level's voice ceiling refused it (Arky's strictness-voice folds in here).
  'voice-strictness',
] as const;

/** Link refusal reasons (§4.6, §3.9), gate `link`. Reserved M1.1 (P8-R9). */
export const LINK_REFUSAL_REASONS = [
  'link-unpaired',
  'link-scope',
  'link-expired',
  'link-revoked',
  'link-paused',
  'link-rate',
  'audience',
  'sensitivity',
  'secret-found',
  'brief-replayed',
  'brief-expired',
  'brief-misaddressed',
  'peer-always',
  'peer-presence',
  'peer-via',
  'warpline-sync-absent',
] as const;

/** Review-convergence refusal reasons (§7.3, §4.11), gate `review`. Reserved M1.1 (P8-D86–D88). */
export const REVIEW_REFUSAL_REASONS = ['review-cap'] as const;

/** Strictness refusal reasons (§3.4, §4.11), `FORBIDDEN` gate `strictness`. Reserved M1.1 (P8-D86–D88). */
export const STRICTNESS_REFUSAL_REASONS = [
  'strictness-presence',
  'strictness-paused',
  'strictness-mode',
  'strictness-evidence',
] as const;

/** Change-note refusal reason (§3.4, §4.11): `BAD_REQUEST` (gate `usage`) on `contract.claim{op:'built'}`. Reserved M1.1. */
export const CHANGE_NOTE_REFUSAL_REASONS = ['note-missing'] as const;

/**
 * Reasons the kernel socket emits today (M1.4: packages/gnomon/src/kernel/socket
 * auth.ts, dispatch.ts, rpc.ts, server.ts, framing.ts, client.ts — read, not
 * imported), routed to code + gate per §4.6/§4.9/§5. `malformed-<x>` =
 * framing.ts's three decode failures. Orchestrator rulings (round 2): the
 * socket code's `id`/`method`/`peer` are renamed `request-id`/`method-missing`/
 * `peer-not-client`; `connection-closed` and `delivery-unknown` are
 * client-local (client.ts synthesizes them, they never cross the wire) and are
 * NOT wire reasons — `connection-closed` = the call was provably never sent,
 * `delivery-unknown` = it was written and the connection dropped before the
 * reply (T-2026-10-19-009 item 6). A client-side TIMEOUT is exactly as
 * delivery-ambiguous as a dropped connection (Reviewer B8): the frame may have
 * reached the kernel and been acted on, and bytes still buffered when the timer
 * fires keep flushing afterwards, so Node's write callback cannot prove a
 * timed-out call unsent. Clients report a timeout as a timeout (ETIMEDOUT /
 * TIMEOUT{call-timeout}), never as a refusal; a caller treats it like
 * delivery-unknown and re-reads state before retrying a non-idempotent verb
 * (every write: approve, permit.reserve, session.*, log.append,
 * contract.register, …). The
 * not-implemented placeholders are kept as future-stable reasons.
 */
export const SOCKET_REASON_ROUTES: Readonly<Record<string, { code: RefusalCode; gate: RefusalGate }>> = Object.freeze({
  // framing / request shape (server.ts, rpc.ts parseRequest) — BAD_REQUEST
  'frame-too-large': { code: 'BAD_REQUEST', gate: 'usage' },
  'malformed-utf8': { code: 'BAD_REQUEST', gate: 'usage' },
  'malformed-json': { code: 'BAD_REQUEST', gate: 'usage' },
  'malformed-not-object': { code: 'BAD_REQUEST', gate: 'usage' },
  'jsonrpc-version': { code: 'BAD_REQUEST', gate: 'usage' },
  'rpc-tag': { code: 'BAD_REQUEST', gate: 'usage' },
  'request-id': { code: 'BAD_REQUEST', gate: 'usage' },
  'method-missing': { code: 'BAD_REQUEST', gate: 'usage' },
  // hello (auth.ts)
  'hello-repeated': { code: 'BAD_REQUEST', gate: 'usage' },
  'hello-params': { code: 'BAD_REQUEST', gate: 'usage' },
  'no-shared-client-api': { code: 'UNSUPPORTED', gate: 'usage' },
  // auth (auth.ts) — AUTH unless noted
  'already-authenticated': { code: 'AUTH', gate: 'transport' },
  'no-hello': { code: 'AUTH', gate: 'transport' },
  'nonce-used': { code: 'AUTH', gate: 'transport' },
  'nonce-expired': { code: 'AUTH', gate: 'transport' },
  'auth-params': { code: 'AUTH', gate: 'transport' },
  'token-not-implemented': { code: 'UNSUPPORTED', gate: 'usage' },
  'web-auth-not-implemented': { code: 'UNSUPPORTED', gate: 'usage' },
  'replayed-transcript': { code: 'AUTH', gate: 'transport' },
  'foreign-principal': { code: 'AUTH', gate: 'transport' },
  'root-unprovisioned': { code: 'AUTH', gate: 'transport' },
  'unknown-device': { code: 'AUTH', gate: 'transport' },
  'principal-mismatch': { code: 'AUTH', gate: 'transport' },
  'peer-not-client': { code: 'AUTH', gate: 'transport' },
  'bad-signature': { code: 'AUTH', gate: 'transport' },
  // read tokens (auth.ts, identity/read-token.ts; M1.4 slice 3, P8-D89/D89a)
  'unknown-token': { code: 'AUTH', gate: 'transport' },
  'token-expired': { code: 'AUTH', gate: 'transport' },
  'token-revoked': { code: 'AUTH', gate: 'transport' },
  'token-in-use': { code: 'AUTH', gate: 'transport' },
  'token-not-yet-valid': { code: 'AUTH', gate: 'transport' },
  'token-store-untrusted': { code: 'AUTH', gate: 'transport' },
  // dispatch (dispatch.ts)
  'unknown-verb': { code: 'UNKNOWN_VERB', gate: 'usage' },
  unauthenticated: { code: 'AUTH', gate: 'transport' },
  matrix: { code: 'FORBIDDEN', gate: 'transport' },
  'not-implemented': { code: 'ENGINE', gate: 'transport' },
  'log-write-failed': { code: 'ENGINE', gate: 'transport' },
  gone: { code: 'ENGINE', gate: 'transport' },
  // log.append namespace ownership (log-append.ts; M1.4 slice 3, P8-D89)
  'kernel-owned': { code: 'FORBIDDEN', gate: 'transport' },
  ungranted: { code: 'FORBIDDEN', gate: 'transport' },
  'modns-not-own': { code: 'FORBIDDEN', gate: 'transport' },
  'bad-kind': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-params': { code: 'BAD_REQUEST', gate: 'usage' },
  // reasons the kernel already sent since M1.4 slice 2 (log-read.ts, refs/resolve.ts, redaction.ts, kernel-log read side) — P8-D89 round 3
  'follow-needs-id': { code: 'BAD_REQUEST', gate: 'usage' },
  'backlog-too-large': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-since': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-until': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-limit': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-follow': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-kinds': { code: 'BAD_REQUEST', gate: 'usage' },
  'bad-scope': { code: 'BAD_REQUEST', gate: 'usage' },
  'since-ahead': { code: 'BAD_REQUEST', gate: 'usage' },
  'subscription-cap': { code: 'BAD_REQUEST', gate: 'usage' },
  'mod-principal-name': { code: 'FORBIDDEN', gate: 'transport' },
  'reader-unsupported': { code: 'UNSUPPORTED', gate: 'usage' },
  'bad-ref': { code: 'BAD_REQUEST', gate: 'usage' },
  'rev-not-applicable': { code: 'BAD_REQUEST', gate: 'usage' },
  'unknown-scheme': { code: 'UNSUPPORTED', gate: 'usage' },
  'peer-ref': { code: 'UNSUPPORTED', gate: 'usage' },
  'no-resolver': { code: 'UNSUPPORTED', gate: 'usage' },
  'not-found': { code: 'NOT_FOUND', gate: 'usage' },
  'row-integrity': { code: 'ENGINE', gate: 'transport' },
  closed: { code: 'ENGINE', gate: 'transport' },
  // server internals (server.ts)
  'response-too-large': { code: 'ENGINE', gate: 'transport' },
  internal: { code: 'ENGINE', gate: 'transport' },
});
export const SOCKET_REFUSAL_REASONS = Object.freeze(Object.keys(SOCKET_REASON_ROUTES)) as readonly string[];

/**
 * Client-local reasons: synthesized by a client, never sent by the kernel
 * (T-2026-10-17-017, P8-D89). `hello-not-offered` = the kernel chose a
 * clientApi or feature this client did not offer. `client-nonce-mismatch`
 * (T-2026-10-18-016) = the hello result does not echo the clientNonce this
 * client sent (a recorded hello replayed from an impostor endpoint).
 */
export const CLIENT_LOCAL_REFUSAL_REASONS = ['hello-not-offered', 'client-nonce-mismatch'] as const;

/** Other named reasons the spec uses (§3.4: `FORBIDDEN{reason:'presence'}`). */
export const OTHER_REFUSAL_REASONS = ['presence'] as const;
/** Additive: a client renders an unknown reason opaquely. */
export const REFUSAL_REASONS = [
  ...VOICE_REFUSAL_REASONS,
  ...LINK_REFUSAL_REASONS,
  ...REVIEW_REFUSAL_REASONS,
  ...STRICTNESS_REFUSAL_REASONS,
  ...CHANGE_NOTE_REFUSAL_REASONS,
  ...OTHER_REFUSAL_REASONS,
  ...CLIENT_LOCAL_REFUSAL_REASONS,
  ...(SOCKET_REFUSAL_REASONS as readonly string[]),
] as readonly string[];

/** Which gate (and code) each reserved P8-D86–D88 reason rides on (§4.11). */
export const RESERVED_REASON_ROUTES: Readonly<Record<string, { code: RefusalCode; gate: RefusalGate }>> = Object.freeze({
  'review-cap': { code: 'FORBIDDEN', gate: 'review' },
  'strictness-presence': { code: 'FORBIDDEN', gate: 'strictness' },
  'strictness-paused': { code: 'FORBIDDEN', gate: 'strictness' },
  'strictness-mode': { code: 'FORBIDDEN', gate: 'strictness' },
  'strictness-evidence': { code: 'FORBIDDEN', gate: 'strictness' },
  'voice-strictness': { code: 'FORBIDDEN', gate: 'voice' },
  'note-missing': { code: 'BAD_REQUEST', gate: 'usage' },
});

export interface RefusalContested {
  stableKey: string;
  symbol: string;
  /** Warpline KnotRule values are legal strings; null = unlabelled rule. */
  rule: string | null;
  conflictingSlots: string[];
  rank: 'direct' | 'ripple';
}

export interface RefusalNextStep {
  verb: string;
  params: Record<string, string>;
  requires: string[];
  principal: 'agent' | 'human';
}

export interface RefusalPointers {
  knotPayloadId?: string;
  proposedStateId?: string;
  rebasedOnto?: string;
  claimId?: string;
  symbols?: string[];
}

export interface RefusalOverride {
  flag: 'acceptBreach' | 'acceptRisk';
  principal: 'human';
}

/** Refusal data (additive per §4.9). Known members typed; others allowed. */
export interface RefusalData {
  /** a reason string: VOICE_/LINK_/OTHER_REFUSAL_REASONS, additive. */
  reason?: string;
  /** UNSUPPORTED hello: the client APIs the client offered. */
  offered?: string[];
  /** the card a `next[]` approve step points at (budget/api-token/fallback/voice). */
  cardId?: string;
  [key: string]: unknown;
}

export interface Refusal {
  schemaVersion: typeof REFUSAL_SCHEMA;
  code: RefusalCode;
  verdict: string | null;
  gate: RefusalGate;
  retriable: Retriability;
  contested: RefusalContested[];
  contestedTotal: number;
  pointers: RefusalPointers;
  next: RefusalNextStep[];
  override?: RefusalOverride;
  data?: RefusalData;
}

export const REFUSAL_V1_KEYS = [
  'schemaVersion',
  'code',
  'verdict',
  'gate',
  'retriable',
  'contested',
  'contestedTotal',
  'pointers',
  'next',
  'override',
  'data',
] as const;
export const REFUSAL_V1_REQUIRED = [
  'schemaVersion',
  'code',
  'verdict',
  'gate',
  'retriable',
  'contested',
  'contestedTotal',
  'pointers',
  'next',
] as const;
export const REFUSAL_POINTER_KEYS = ['knotPayloadId', 'proposedStateId', 'rebasedOnto', 'claimId', 'symbols'] as const;

/* ── code tables (totality tested) ────────────────────────────────────────── */

/** Exit codes: Warpline's table (refusal.ts:213-226) + Gnomon's 6/2/7/8/9 (§4.6). */
export const EXIT_CODES: Readonly<Record<RefusalCode, number>> = Object.freeze({
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
  BUDGET_DENIED: 6,
  PERMIT_REQUIRED: 2,
  CAS_LOST: 7,
  BILLING_REFUSED: 8,
  MODEL_UNAVAILABLE: 9,
});

/** JSON-RPC error codes (§4.9 "total code map"). */
export const JSON_RPC_CODES: Readonly<Record<RefusalCode, number>> = Object.freeze({
  AUTH: -32001,
  FORBIDDEN: -32002,
  NOT_FOUND: -32004,
  UNSUPPORTED: -32005,
  BAD_REQUEST: -32600,
  UNKNOWN_VERB: -32601,
  ENGINE: -32000,
  BUDGET_DENIED: -32010,
  PERMIT_REQUIRED: -32011,
  CAS_LOST: -32012,
  INTEGRITY_BROKEN: -32013,
  GATE_REFUSED: -32020,
  CLAIM_BREACH: -32021,
  TRUST_HELD: -32022,
  STALE_BASE: -32023,
  BILLING_REFUSED: -32030,
  MODEL_UNAVAILABLE: -32031,
});

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
  BUDGET_DENIED: 'budget',
  PERMIT_REQUIRED: 'budget',
  CAS_LOST: 'claim',
  BILLING_REFUSED: 'billing',
  MODEL_UNAVAILABLE: 'model',
};

const RETRIABLE_FOR: Record<RefusalCode, Retriability> = {
  GATE_REFUSED: 'retry-after-resolve',
  CLAIM_BREACH: 'retry-with-override',
  TRUST_HELD: 'retry-with-override',
  STALE_BASE: 'retry-after-rebase',
  INTEGRITY_BROKEN: 'never',
  ENGINE: 'retry-identical',
  AUTH: 'never',
  FORBIDDEN: 'never',
  BAD_REQUEST: 'retry-corrected',
  UNKNOWN_VERB: 'retry-corrected',
  NOT_FOUND: 'retry-corrected',
  UNSUPPORTED: 'never',
  BUDGET_DENIED: 'retry-with-override',
  PERMIT_REQUIRED: 'retry-corrected',
  CAS_LOST: 'retry-corrected',
  BILLING_REFUSED: 'never',
  MODEL_UNAVAILABLE: 'retry-with-override',
};

/** Default `next[]` for the Gnomon-only codes (§4.6); Warpline codes default to []. */
const NEXT_FOR: Partial<Record<RefusalCode, RefusalNextStep[]>> = {
  BUDGET_DENIED: [{ verb: 'approve', params: {}, requires: ['cardId', 'decision'], principal: 'human' }],
  PERMIT_REQUIRED: [{ verb: 'permit.reserve', params: {}, requires: ['kind', 'scope'], principal: 'agent' }],
  CAS_LOST: [{ verb: 'status', params: {}, requires: [], principal: 'agent' }],
  BILLING_REFUSED: [{ verb: 'approve', params: {}, requires: ['cardId', 'decision'], principal: 'human' }],
  MODEL_UNAVAILABLE: [{ verb: 'approve', params: {}, requires: ['cardId', 'decision'], principal: 'human' }],
};

export function exitCodeFor(code: RefusalCode): number {
  return EXIT_CODES[code] ?? 1;
}
export function exitCodeForResult(result: { refusal?: Refusal }): number {
  return result.refusal ? exitCodeFor(result.refusal.code) : 0;
}
export function jsonRpcCodeFor(code: RefusalCode): number {
  return JSON_RPC_CODES[code] ?? -32000;
}
export function gateFor(code: RefusalCode): RefusalGate {
  return GATE_FOR[code] ?? 'usage';
}
export function retriabilityFor(code: RefusalCode): Retriability {
  return RETRIABLE_FOR[code] ?? 'never';
}

/* ── construction ─────────────────────────────────────────────────────────── */

export interface RefuseInput {
  code: RefusalCode;
  verdict?: string | null;
  gate?: RefusalGate;
  retriable?: Retriability;
  contested?: RefusalContested[];
  contestedTotal?: number;
  pointers?: RefusalPointers;
  /** omitted ⇒ the code's default (§4.6 for Gnomon codes, [] otherwise). */
  next?: RefusalNextStep[];
  override?: RefusalOverride;
  data?: RefusalData;
}

/**
 * THE single constructor for refusal:v1 (Warpline semantics: deterministic,
 * contested ranked direct-before-ripple then stableKey, capped at
 * MAX_CONTESTED, contestedTotal = the full count, empty pointers pruned).
 */
export function refuse(input: RefuseInput): Refusal {
  const all = input.contested ?? [];
  const ranked = [...all].sort(rankOrder);
  const next = input.next ?? NEXT_FOR[input.code] ?? [];
  return {
    schemaVersion: REFUSAL_SCHEMA,
    code: input.code,
    verdict: input.verdict ?? null,
    gate: input.gate ?? gateFor(input.code),
    retriable: input.retriable ?? retriabilityFor(input.code),
    contested: ranked.slice(0, MAX_CONTESTED),
    contestedTotal: input.contestedTotal ?? all.length,
    pointers: prunePointers(input.pointers ?? {}),
    next: next.map((s) => ({ ...s, params: { ...s.params }, requires: [...s.requires] })),
    ...(input.override ? { override: input.override } : {}),
    ...(input.data && Object.keys(input.data).length ? { data: { ...input.data } } : {}),
  };
}

function rankOrder(a: RefusalContested, b: RefusalContested): number {
  if (a.rank !== b.rank) return a.rank === 'direct' ? -1 : 1;
  return a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0;
}

function prunePointers(p: RefusalPointers): RefusalPointers {
  const out: RefusalPointers = {};
  if (p.knotPayloadId) out.knotPayloadId = p.knotPayloadId;
  if (p.proposedStateId) out.proposedStateId = p.proposedStateId;
  if (p.rebasedOnto) out.rebasedOnto = p.rebasedOnto;
  if (p.claimId) out.claimId = p.claimId;
  if (p.symbols?.length) out.symbols = [...p.symbols];
  return out;
}

/** Shape check used by refusalOf (versioned, never duck-typed on a bare key). */
function looksLikeRefusal(value: unknown): value is Refusal {
  return (
    isPlainObject(value) && value.schemaVersion === REFUSAL_SCHEMA && typeof value.code === 'string'
  );
}

/**
 * THE refusal accessor (Warpline refusalOf semantics): `result.refusal`, or one
 * envelope level down at `result.result.refusal`. Deliberately bounded. Also
 * accepts a JSON-RPC error `{error:{data: refusal:v1}}` (§4.9) — the RPC
 * envelope is the one Gnomon-specific depth, named here.
 */
export function refusalOf(value: unknown): Refusal | undefined {
  if (!isPlainObject(value)) return undefined;
  if (looksLikeRefusal(value.refusal)) return value.refusal;
  const enveloped = value.result;
  if (isPlainObject(enveloped) && looksLikeRefusal(enveloped.refusal)) return enveloped.refusal;
  const err = value.error;
  if (isPlainObject(err) && looksLikeRefusal(err.data)) return err.data;
  return undefined;
}

/** A thrown refusal; `message` is the human sentence, kept outside the verdict. */
export class RefusedError extends Error {
  constructor(
    public refusal: Refusal,
    message: string,
  ) {
    super(message);
    this.name = 'RefusedError';
  }
}

/* ── validation ───────────────────────────────────────────────────────────── */

export function validateRefusalV1(value: unknown, opts: ValidateOptions = {}): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, REFUSAL_V1_KEYS);
  c.required('', v, REFUSAL_V1_REQUIRED);
  if ('schemaVersion' in v && v.schemaVersion !== REFUSAL_SCHEMA) c.fail('schemaVersion', `must be ${REFUSAL_SCHEMA}`);
  if ('code' in v) c.closedEnum('code', v.code, REFUSAL_CODES);
  if ('verdict' in v && v.verdict !== null && typeof v.verdict !== 'string') c.fail('verdict', 'must be a string or null');
  if ('gate' in v) c.additiveEnum('gate', v.gate, REFUSAL_GATES);
  if ('retriable' in v) c.closedEnum('retriable', v.retriable, RETRIABILITIES);
  if ('contested' in v && c.arr('contested', v.contested)) {
    if (v.contested.length > MAX_CONTESTED) c.fail('contested', `at most ${MAX_CONTESTED} items`);
    v.contested.forEach((u, i) => {
      const p = `contested[${i}]`;
      if (!c.obj(p, u)) return;
      c.closed(p, u, ['stableKey', 'symbol', 'rule', 'conflictingSlots', 'rank']);
      c.required(p, u, ['stableKey', 'symbol', 'rule', 'conflictingSlots', 'rank']);
      if ('stableKey' in u) c.str(`${p}.stableKey`, u.stableKey);
      if ('symbol' in u) c.str(`${p}.symbol`, u.symbol);
      if ('rule' in u && u.rule !== null && typeof u.rule !== 'string') c.fail(`${p}.rule`, 'must be a string or null');
      if ('conflictingSlots' in u && c.arr(`${p}.conflictingSlots`, u.conflictingSlots)) {
        u.conflictingSlots.forEach((s, j) => c.str(`${p}.conflictingSlots[${j}]`, s));
      }
      if ('rank' in u) c.closedEnum(`${p}.rank`, u.rank, CONTESTED_RANKS);
    });
  }
  if ('contestedTotal' in v) {
    c.int('contestedTotal', v.contestedTotal, 0);
    if (Array.isArray(v.contested) && typeof v.contestedTotal === 'number' && v.contestedTotal < v.contested.length) {
      c.fail('contestedTotal', 'must be >= contested.length');
    }
  }
  if ('pointers' in v && c.obj('pointers', v.pointers)) {
    const p = v.pointers;
    c.closed('pointers', p, REFUSAL_POINTER_KEYS);
    for (const k of ['knotPayloadId', 'proposedStateId', 'rebasedOnto', 'claimId'] as const) {
      if (k in p) c.str(`pointers.${k}`, p[k]);
    }
    if ('symbols' in p && c.arr('pointers.symbols', p.symbols)) {
      p.symbols.forEach((s, i) => c.str(`pointers.symbols[${i}]`, s));
    }
  }
  if ('next' in v && c.arr('next', v.next)) {
    v.next.forEach((s, i) => {
      const p = `next[${i}]`;
      if (!c.obj(p, s)) return;
      c.closed(p, s, ['verb', 'params', 'requires', 'principal']);
      c.required(p, s, ['verb', 'params', 'requires', 'principal']);
      if ('verb' in s) c.str(`${p}.verb`, s.verb, /^.+$/, 'a non-empty string');
      if ('params' in s && c.obj(`${p}.params`, s.params)) {
        for (const [k, pv] of Object.entries(s.params)) c.str(`${p}.params.${k}`, pv);
      }
      if ('requires' in s && c.arr(`${p}.requires`, s.requires)) {
        s.requires.forEach((r, j) => c.str(`${p}.requires[${j}]`, r));
      }
      if ('principal' in s) c.closedEnum(`${p}.principal`, s.principal, NEXT_PRINCIPALS);
    });
  }
  if ('override' in v && c.obj('override', v.override)) {
    c.closed('override', v.override, ['flag', 'principal']);
    c.required('override', v.override, ['flag', 'principal']);
    if ('flag' in v.override) c.closedEnum('override.flag', v.override.flag, OVERRIDE_FLAGS);
    if ('principal' in v.override && v.override.principal !== 'human') c.fail('override.principal', 'must be human');
  }
  if ('data' in v && c.obj('data', v.data)) {
    const d = v.data;
    if ('reason' in d) c.additiveEnum('data.reason', d.reason, REFUSAL_REASONS);
    if ('offered' in d && c.arr('data.offered', d.offered)) d.offered.forEach((o, i) => c.str(`data.offered[${i}]`, o));
    if ('cardId' in d) c.str('data.cardId', d.cardId);
  }
  return c.errors;
}

export function isRefusalV1(value: unknown, opts: ValidateOptions = {}): value is Refusal {
  return validateRefusalV1(value, opts).length === 0;
}
