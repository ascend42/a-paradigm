/**
 * #warplined-protocol — the wire envelope of the solo daemon (`warplined`),
 * PHASE 1 of native-first (arky-architecture.md §1.1: "the server is a fabric
 * with a network face"; roadmap-native-first.md PHASE 1).
 *
 * TRANSPORT CHOICE (documented per the phase-1 brief): newline-delimited JSON
 * over a UNIX DOMAIN SOCKET (`.warpline/daemon.sock`, mode 0600 — Aegis stage-1
 * trust boundary = the OS user). Why NDJSON-over-UDS and not HTTP-over-uds:
 *   - the protocol is verb→result, 1:1 onto engine functions — it needs no
 *     routing, headers, chunking, or content negotiation;
 *   - node stdlib support is `net.createServer` + a line splitter (~30 lines);
 *     the client is `net.connect` + the same splitter — zero dependencies;
 *   - one frame = one JSON line = one request or one response; framing bugs
 *     are impossible to hide (a partial line never parses).
 * Loopback TCP stays a later opt-in flag; the socket is the simplest trust
 * boundary and ships first.
 *
 * G3 (engine shapes verbatim): `result` is EXACTLY what the engine function
 * returned — AdmitResult, knotPayload:v1, GradeReport, shadowVerdict:v1 rows,
 * StakeResult… — inside this thin versioned envelope. The daemon adds transport
 * and identity, never logic.
 *
 * G1 (versioned/additive): every frame carries `rpc: 'warplined:v1'`; evolution
 * is additive or a version bump, never a silent shape change.
 *
 * Library code: no console output.
 */

import type { Refusal, RefusalCode } from '../fabric/refusal.js';

export const RPC_SCHEMA = 'warplined:v1' as const;

/** The daemon's verb surface — each maps 1:1 onto an existing engine function.
 * G4: no other mutation path exists; write verbs run under the SAME fabric
 * lock the CLI takes (the engine functions acquire it themselves). */
export const DAEMON_VERBS = [
  'status', // daemon liveness + fabric identity (no engine mutation)
  'refs.list', // listRefs + heads               (read)
  'fork', // forkNative                          (write — scratch ref only)
  'propose', // proposeNative                    (write — scratch strand)
  'admit', // admitNative | shadowAdmit          (write | observe-only row)
  'abandon', // abandonNative                    (write — clears the caller's scratch pointer)
  'knot.show', // readKnotPayload                (read)
  'resolve', // resolveNative                    (write — human-class only)
  'stake', // stake                              (write — human-class only)
  'stake.recover', // stakeRecover               (write — human-class only)
  'grade.report', // gradeFabric (report only — applyGrades never rides the daemon)
  'shadow.tail', // readShadowVerdicts, last N   (read)
  'backup', // backupFabric — atomic fabric snapshot (write to DEST only; human-class)
] as const;

export type DaemonVerb = (typeof DAEMON_VERBS)[number];

/** One request frame (one JSON line). `token` authenticates the caller; the
 * daemon derives the acting identity FROM the token (server-stamped, Aegis §1.2
 * stage 1) — identity fields inside `params` are advisory and ignored. */
export interface RpcRequest {
  rpc: typeof RPC_SCHEMA;
  /** caller-chosen correlation id, echoed verbatim on the response. */
  id: string | number;
  verb: DaemonVerb | string;
  /** bearer token minted by `warpline daemon token mint` (human-gated). */
  token?: string;
  params?: Record<string, unknown>;
}

/**
 * Machine-readable failure classes — COLLAPSED into #refusal's RefusalCode
 * (SP2, TD-2026-07-21-766: one error vocabulary across every skin, collapsed
 * BEFORE any MCP tool schema could freeze the duplicate). The daemon's original
 * six codes (AUTH / FORBIDDEN / BAD_REQUEST / UNKNOWN_VERB / NOT_FOUND /
 * ENGINE) were already a strict subset of RefusalCode, so this is a pure
 * widening: every code the daemon has ever emitted is still valid, and clients
 * must tolerate additional codes (G1 — additive only). TODAY the daemon emits
 * only that transport/usage subset: the VERDICT-class codes (GATE_REFUSED /
 * CLAIM_BREACH / TRUST_HELD / STALE_BASE) arrive INSIDE engine results
 * (AdmitResult.refusal, G3), never as transport errors.
 */
export type RpcErrorCode = RefusalCode;

export interface RpcOk {
  rpc: typeof RPC_SCHEMA;
  id: string | number;
  ok: true;
  /** the engine shape VERBATIM (G3). */
  result: unknown;
}

export interface RpcErr {
  rpc: typeof RPC_SCHEMA;
  /** null when the request line did not even parse to a frame with an id. */
  id: string | number | null;
  ok: false;
  error: {
    code: RpcErrorCode;
    message: string;
    /**
     * `refusal:v1` for the transport/usage refusal itself (SP2, ADDITIVE):
     * the SAME machine-readable object every gate hands back, so a cold agent
     * on the daemon skin branches on enums (code / gate / retriable) and never
     * on `message` prose — which stays for humans.
     */
    refusal?: Refusal;
  };
}

export type RpcResponse = RpcOk | RpcErr;

/** Verbs an `agent`-class principal may NOT invoke at all (Aegis §2.2:
 * resolve is tier-gated human-class; the stake valve is operator/human;
 * backup is custodianship — the human's act, like token minting). */
export const HUMAN_ONLY_VERBS: readonly string[] = Object.freeze([
  'resolve',
  'stake',
  'stake.recover',
  'backup',
]);

/**
 * The READ-ONLY verb allowlist — the verbs a `scope:'read'` token (the CONSOLE
 * token class, tokens.ts) may invoke. Everything else is FORBIDDEN for a
 * read-scoped principal, checked structurally before dispatch.
 *
 * CONSOLE-AUTH CHOICE (documented per the phase-1 close-out brief): stage 1
 * says NO anonymous reads — the sidecars behind these verbs are trust data
 * (Aegis §2.3) — so a tokenless local-socket allowlist was REJECTED: it would
 * drop both authentication and audit attribution on trust data. Instead the
 * console holds a minted, read-SCOPED token (`warpline daemon token mint
 * console --kind human --scope read`): every call stays tokened, stamped, and
 * audited, and the token is least-privilege — even if it leaks, no write verb
 * is reachable (this list is the ceiling, enforced server-side). Conservative
 * on both axes: stage-1 law intact + strictly narrower capability than any
 * pre-existing token class.
 */
export const READ_ONLY_VERBS: readonly string[] = Object.freeze([
  'status',
  'refs.list',
  'knot.show',
  'grade.report',
  'shadow.tail',
]);

/** Param flags an `agent`-class principal may NOT set — the override verbs.
 * "An agent must never accept its own breach" (Aegis §2.2). */
export const HUMAN_ONLY_ADMIT_FLAGS: readonly string[] = Object.freeze([
  'acceptBreach',
  'acceptRisk',
]);

/**
 * THE PROTECTED-BRANCH PRINCIPAL SURFACE (#protected, M2.5 security,
 * TD-2026-08-12-813 — Aegis's own finding). Two acts join the human-class law
 * here, and NEITHER is a static verb in HUMAN_ONLY_VERBS — deliberately:
 *
 *   1. `branch --protect` / `branch --unprotect` — changing WHAT is protected is
 *      a human-class act (an agent must never decide what is protected FROM
 *      agents). These are CLI-only acts; the daemon exposes NO protect verb, so
 *      the wire surface simply never offers them to a token-bearing agent. The
 *      CLI enforces it with the #agent-shell credential (an agent shell is
 *      refused FORBIDDEN), the same mechanism the HUMAN_ONLY_VERBS CLI skin uses.
 *
 *   2. `merge` INTO a protected branch (and a direct agent `admit` onto one) is
 *      human-class — but DESTINATION-DEPENDENT, so it CANNOT be a static verb
 *      flag: the SAME `merge`/`admit` verb is agent-legal onto a feature branch
 *      and human-only onto the protected integration line. The classification is
 *      therefore made at RUNTIME by the registry check (fabric/protected.ts
 *      `protectedLandingRefusal`), inside the engine (merge.ts / native.ts), on
 *      the RESOLVED target branch — an agent-class landing onto a protected
 *      branch returns the same FORBIDDEN `refusal:v1` (Aegis §2.2, retriable
 *      'never', escalate) every other human-class refusal does. Listed here as
 *      the documented reason merge/admit are absent from the static matrix, not
 *      to add them to it (adding `merge` would forbid ALL agent merges, including
 *      the feature-to-feature folds the whole branch model is FOR).
 *
 * Named as a constant so the classification is greppable next to its siblings,
 * even though enforcement is destination-dependent rather than a flat allowlist. */
export const PROTECTED_BRANCH_HUMAN_ONLY = Object.freeze({
  /** CLI-only human-class acts (no daemon verb exists for them). */
  registryVerbs: Object.freeze(['branch --protect', 'branch --unprotect']),
  /** verbs whose human-class-ness depends on whether the RESOLVED target branch
   * is protected — enforced by fabric/protected.ts, never a static flag. */
  destinationGated: Object.freeze(['merge', 'admit']),
});
