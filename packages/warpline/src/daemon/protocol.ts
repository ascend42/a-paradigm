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
  'knot.show', // readKnotPayload                (read)
  'resolve', // resolveNative                    (write — human-class only)
  'stake', // stake                              (write — human-class only)
  'stake.recover', // stakeRecover               (write — human-class only)
  'grade.report', // gradeFabric (report only — applyGrades never rides the daemon)
  'shadow.tail', // readShadowVerdicts, last N   (read)
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

/** Machine-readable failure classes (stable — additive only, G1). */
export type RpcErrorCode =
  | 'AUTH' // missing/unknown token
  | 'FORBIDDEN' // verb × principal-class matrix refused (Aegis §2.2)
  | 'BAD_REQUEST' // malformed frame / missing required params
  | 'UNKNOWN_VERB'
  | 'NOT_FOUND' // selector matched nothing (e.g. knot.show)
  | 'ENGINE'; // the engine function threw — message carries its error

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
  error: { code: RpcErrorCode; message: string };
}

export type RpcResponse = RpcOk | RpcErr;

/** Verbs an `agent`-class principal may NOT invoke at all (Aegis §2.2:
 * resolve is tier-gated human-class; the stake valve is operator/human). */
export const HUMAN_ONLY_VERBS: readonly string[] = Object.freeze([
  'resolve',
  'stake',
  'stake.recover',
]);

/** Param flags an `agent`-class principal may NOT set — the override verbs.
 * "An agent must never accept its own breach" (Aegis §2.2). */
export const HUMAN_ONLY_ADMIT_FLAGS: readonly string[] = Object.freeze([
  'acceptBreach',
  'acceptRisk',
]);
