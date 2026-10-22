/**
 * @symbol #socket
 *
 * #socket verb dispatch (spec §4.9, §5; M1.4 slice 1).
 *
 * Per connection: `{connId, phase, principal, surface, …}` (auth.ts). Before
 * auth a caller may send only `hello` and `auth`; a known verb is refused
 * `AUTH{reason:'unauthenticated'}` (connection kept), an unknown name is
 * `UNKNOWN_VERB`. A failed `auth` is answered with ONE AUTH refusal and the
 * connection is closed. After auth, every one of the 12 verbs + 2 relays is
 * checked against the §5 verb × principal matrix (contracts `VERBS.access`;
 * the peer column is refused everywhere) and then either served — `status`,
 * for real — or refused `ENGINE{reason:'not-implemented', verb, milestone}`:
 * no fake success. The surface is exactly the contracts' CLIENT_METHODS; no
 * verb exists to serve a client (M1.4 falsifier).
 *
 * Access qualifiers: only the plain `'yes'` of the matrix is served by the
 * generic rule; any other qualified value (`'own view'`, …) needs a scoped
 * view that does not exist yet and is refused ENGINE{not-implemented} naming
 * its milestone — never the full view. M1.4 SLICE 2: `log.read` and
 * `ref.resolve` are handled EXPLICITLY per reader class (log-read.ts
 * readerFor: human → community-client projection until first-party proof,
 * mod → own modns, agent/voice → UNSUPPORTED, session → not-implemented
 * M1.7), pages and `follow` subscriptions via log-read.ts, refs via
 * #ref-resolver (refs/resolve.ts). Without a `reads` source (unit rigs) both
 * stay ENGINE not-implemented.
 *
 * Log-before-reply (chain write before side effect, §2.4 rule 4):
 * socket.hello and socket.auth.ok are written BEFORE the reply; if either
 * write fails the request is refused ENGINE{log-write-failed} and the
 * connection is closed (never authenticated without its row, never wedged).
 * socket.auth.fail / socket.auth.replay rows are BEST-EFFORT: written before
 * the refusal when the log accepts them, but a log failure never turns a
 * refusal into anything else. The `log` callback may RATE-LIMIT socket.hello
 * and socket.auth.fail (daemon.ts folds all but the first 8 per window into a
 * signed counter row); "written before the reply" then means the row or its
 * counter increment.
 *
 * M1.4 SLICE 3: a known verb before auth is AUTH{unauthenticated} AND closes
 * the connection (G-SOCK-01; counted as 'unauthenticated-call' in the
 * coalesced pre-auth row). Read-token connections (auth.ts) have matrix class
 * `readToken`: status, log.read, ref.resolve only; every other verb and both
 * relays are FORBIDDEN{matrix}. Their token is re-checked on every call and by
 * a per-connection timer (expiry, revocation every `tokenRecheckMs`); a dead
 * token closes the connection after AUTH{token-expired|token-revoked} and a
 * best-effort socket.disconnect{reason, tokenId} row. `log.append` is the
 * namespace-ownership gate (log-append.ts, G-SOCK-04): every cell refuses in
 * M1.4. status lists only next verbs the caller's class may call.
 *
 * M1.4 #web-endpoint: the web endpoint runs its OWN dispatcher (its
 * authenticator signs the ws:// endpoint path) with a `web` hook that serves
 * `auth {launchToken}` / `{reconnect}` (web/endpoint.ts). A GUI connection is
 * matrix class `human`; its auth.ok row is followed by socket.gui.token.issued
 * and both are written before the `{guiToken, principal, connId}` reply (the
 * session is withdrawn if either write fails). An auth refusal may carry rows
 * to write first (socket.auth.reconnect.requested) and its own row kind
 * (socket.auth.theft).
 *
 * Pre-auth limits (Aegis round 2): a connection with no hello after
 * `helloTimeoutMs` (10 s) or not authenticated after `preAuthTimeoutMs` (the
 * 30 s nonce TTL) is closed; at most `maxPreAuth` (64) unauthenticated
 * connections exist at once — the next one is closed on connect. Closures are
 * counted for the coalesced diagnostic row (daemon.ts), not logged one by one.
 *
 * M1.6 #approval-broker + #budget-fuse: `approve` and `permit.reserve` are
 * handled EXPLICITLY (T-2026-10-17-017), never by the generic qualified-
 * access rule: `approve` from the voice principal is FORBIDDEN gate voice
 * `voice-off` in every form (no arm can exist before Move 4, G-ABI-02 voice
 * row); from the human it goes to the broker, which applies the presence
 * class of §3.4 ("presence per class; root key for use-api-token, install;
 * withdraw on held cards"). `permit.reserve` for the human and agent classes
 * goes to the fuse; the session class ("own scope") needs session principals
 * (M1.7). Without an `approvals` port (unit rigs) both stay not-implemented.
 * A closed connection drops its cached unlock.
 *
 * M1.7 #supervisor (slice 1): `session.open`, `session.send` and
 * `session.stop` from a HUMAN principal go to the session port (attended,
 * human-started Claude Code sessions only); every other class keeps the
 * matrix's answer (not-implemented until session principals land).
 *
 * M1.11 slice 2 #mod-host: the client relays `mod.view` / `mod.command`
 * (§12.3) go to the `mods` port for every class the matrix lets call them
 * ("caller principal"; read tokens and peers are FORBIDDEN), with
 * `relayedFor{principal, connId}` stamped HERE from the authenticated
 * connection — never from params. `mod.command` from a GUI connection needs a
 * user gesture (§11.5) that no GUI can prove yet ⇒ ENGINE{not-implemented,
 * M1.10}. `callAs(principal, verb, params)` is the mod's `kernel.call`: the
 * same post-auth dispatch run as a connection-less mod principal (matrix
 * class `mod`): status = own view (served), log.read pages through
 * readerFor (own modns; `follow` needs a connection ⇒ BAD_REQUEST
 * bad-follow), ref.resolve, and every other cell keeps its answer. The relays
 * are not reachable through callAs (`mod.command` through kernel.call is for
 * `knowledge:federate` holders, §8.10, not built) and log.append is the mod
 * host's own path (modhost/bridge.ts).
 *
 * Voice slice V1 #gnomon-voice (T-2026-10-19-026, talk-only): with a `voice` port, the voice principal's
 * `session.send` (attached session, `source: voice` forced, forwarding guards), `session.stop` (interrupt only),
 * `log.append voice.*` (shape-validated) and `log.read` (own attached session + voice.*, redacted) are served by
 * voice/voice-control.ts; the human attaches / detaches voice by appending `voice.session.start|end` on a
 * first-party connection (the run-mode HumanRequestPort pattern). `approve` stays voice-off in every form;
 * `request.voice.arm`, root verbs and `permit.reserve` stay refused.
 */
import {
  CLIENT_API_ID,
  CLIENT_RELAYS,
  KIT_ID,
  RELAY_NAMES,
  VERBS,
  HUMAN_DEVICE_VERBS,
  HUMAN_DEVICE_VERB_NAMES,
  canonicalJson,
  hex,
  sanitizeDisplayText,
  sha256,
  type Access,
  type PrincipalKind,
} from '@a-company/gnomon-contracts';
import { KERNEL_METHODS, type MatrixClass, type MethodRegistry } from './methods.js';
import type { ConnectionContext, RpcHandler } from './server.js';
import { RpcRefusal, type RpcRequestFrame } from './rpc.js';
import type { ConnAuthState, SocketAuthenticator, WebAuthHook } from './auth.js';
import { SERVER_FEATURES } from './auth.js';
import { resolveRef } from '../refs/resolve.js';
import { refuseAppend, type AppendClass } from './log-append.js';
import type { SessionPort } from '../supervisor/port.js';
import { isModId, MOD_ABI_ID } from '@a-company/gnomon-contracts';
import type { VoiceControl } from '../voice/voice-control.js';

const SESSION_METHODS: readonly string[] = ['session.open', 'session.send', 'session.stop'];
import { voiceApproveRefusal } from '../broker/broker.js';
import { voiceStatusFor } from '../voice/voice-requests.js';
import { MOD_ADMIN_REQUESTS } from '../modhost/mods-admin.js';
import type { ApprovalPort } from '../broker/port.js';
import { asRpcRefusal, parseLogReadParams, readerFor, readOnePage, SUBSCRIPTION_BACKLOG_CAP, MAX_SUBSCRIPTIONS_PER_CONNECTION, type ReadLog, type SubscriptionHub } from './log-read.js';

const REPORT_HASH = /^sha256:[0-9a-f]{64}$/;
const MAX_CONFORMANCE_FIELD = 64;

/**
 * §12.8 honest limit (Aegis M1): what a client DECLARED in hello, copied
 * field by field — only {suite, version, reportHash} plus `label: 'declared'`,
 * never any other key a client sent (no `result: 'passed'`, no `verifiedBy`).
 * suite/version are sanitized (§4.5) and capped; a reportHash that is not
 * `sha256:<64 hex>` makes the declaration void (null).
 */
export function declaredConformance(v: unknown): { suite: string; version: string; reportHash: string; label: 'declared' } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { suite, version, reportHash } = v as Record<string, unknown>;
  if (typeof suite !== 'string' || typeof version !== 'string' || typeof reportHash !== 'string' || !REPORT_HASH.test(reportHash)) return null;
  const clean = (s: string): string => Array.from(sanitizeDisplayText(s).text).slice(0, MAX_CONFORMANCE_FIELD).join('');
  return { suite: clean(suite), version: clean(version), reportHash, label: 'declared' };
}

/** Where each not-yet-served method lands (spec §19). */
export const VERB_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  status: 'M1.4',
  'session.open': 'M1.7',
  'session.send': 'M1.7',
  'session.stop': 'M1.7',
  // The ownership gate is served since M1.4 slice 3 (every cell refuses). The first
  // cell that can succeed is a grant.bind'd kind: grant.bind{principal, manifestHash,
  // kinds[]} needs root-signed grants (M1.3) AND a loaded manifest (#manifest-loader M1.5).
  'log.append': 'M1.5',
  'log.read': 'M1.4',
  'permit.reserve': 'M1.6',
  approve: 'M1.6',
  // (the session class's permit.reserve, "own scope", lands with session principals in M1.7)
  'contract.register': 'M2.1',
  'contract.claim': 'M2.2',
  'oracle.run': 'M2.3',
  'ref.resolve': 'M1.4',
  'mod.view': 'M1.11',
  'mod.command': 'M1.11',
});

export const SERVED_METHODS: readonly string[] = Object.freeze(['status', 'log.read', 'ref.resolve']);
/** Served only when the dispatcher has a log to read (the daemon always passes one). */
const READ_METHODS: readonly string[] = Object.freeze(['log.read', 'ref.resolve']);

/**
 * §5 next-legal-verbs table, verbatim order. `when` = every listed fact holds.
 * Hashed into abiId with the verb and relay descriptors.
 */
export const NEXT_LEGAL_TABLE: ReadonlyArray<{ when: readonly string[]; verbs: readonly string[] }> = Object.freeze([
  { when: ['budgetPaused'], verbs: ['status', 'log.read'] },
  { when: ['cardsPendingForYou>0', 'human'], verbs: ['approve'] },
  { when: ['human', 'heldCards>0'], verbs: ['approve decision:withdraw'] },
  { when: ['voice', 'armed', 'voiceEligibleCards>0'], verbs: ['approve'] },
  { when: ['voice', '!armed'], verbs: ['status', 'log.read', 'session.send', 'session.stop'] },
  { when: ['repoStrictness:L3', 'agent|session'], verbs: ['status', 'log.read'] },
  { when: ['reviewReturned'], verbs: ['contract.claim op:built'] },
  { when: ['reviewCapped', 'agent|session'], verbs: ['status', 'log.read'] },
  { when: ['noSession'], verbs: ['session.open'] },
  { when: ['noPermit'], verbs: ['permit.reserve'] },
  { when: ['hasContract', 'unclaimed>0'], verbs: ['contract.claim'] },
  { when: ['claimed', 'built:false'], verbs: ['contract.claim op:built'] },
  { when: ['built'], verbs: ['oracle.run'] },
  { when: [], verbs: ['status'] },
]);

/** abiId = sha256(canonical {verbs, relays, nextLegal}) — the descriptors.ts:383-393 pattern. */
export const ABI_ID: string = `sha256:${hex(sha256(canonicalJson({ verbs: VERBS, relays: CLIENT_RELAYS, nextLegal: NEXT_LEGAL_TABLE })))}`;

export function matrixClass(kind: PrincipalKind): MatrixClass {
  switch (kind) {
    case 'human':
    case 'agent':
    case 'session':
    case 'mod':
    case 'voice':
      return kind;
    default:
      return 'peer'; // kernel and peer are never socket clients: refused everywhere
  }
}

/** The matrix column of an authenticated connection: a read token is `readToken` whatever its principal (§5). */
export function matrixClassOf(s: Pick<ConnAuthState, 'credential' | 'principalKind'>): MatrixClass {
  if (s.credential === 'read-token') return 'readToken';
  return s.principalKind ? matrixClass(s.principalKind) : 'peer';
}

/**
 * Access of a method (verb or relay) for a class, from the method registry
 * (methods.ts): relays are `caller principal` except for peers and read
 * tokens (§5). Fails CLOSED: an unknown method or an undefined tier is `false`.
 */
export function accessOf(method: string, cls: MatrixClass, methods: MethodRegistry = KERNEL_METHODS): Access {
  return methods.tier(method, cls);
}

export function nextLegalVerbs(facts: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const row of NEXT_LEGAL_TABLE) {
    if (row.when.every((f) => facts.has(f))) for (const v of row.verbs) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** What the daemon contributes to `status` (kept cheap: G-ABI-03 < 50 ms). */
export interface KernelStatusSource {
  daemon(): Record<string, unknown>;
  log(): Record<string, unknown>;
  kernelKey(): { keyId: string; custody: 'full' | 'partial'; source: string };
  root(): { state: string; rootKeyId: string | null };
  /** The web endpoint's status block (#web-endpoint; absent ⇒ `{listening:false}`). */
  web?(): Record<string, unknown>;
}

export type SocketLogKind =
  | 'socket.hello'
  | 'socket.auth.ok'
  | 'socket.auth.fail'
  | 'socket.auth.replay'
  | 'socket.auth.theft'
  | 'socket.auth.reconnect.requested'
  | 'socket.gui.token.issued'
  | 'socket.disconnect';

export type PreAuthCloseReason = 'hello-timeout' | 'pre-auth-timeout' | 'pre-auth-cap' | 'unauthenticated-call';

/** How often a live read-token connection's token is re-checked for revocation (expiry has its own timer). */
export const TOKEN_RECHECK_MS = 5_000;

export const HELLO_TIMEOUT_MS = 10_000;
export const PRE_AUTH_TIMEOUT_MS = 30_000;
export const MAX_PRE_AUTH = 64;

/** Milestone for a qualified (scoped) access value, by principal class. */
export const SCOPED_VIEW_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  mod: 'M1.11',
  agent: 'Move 2',
  session: 'M1.7',
  voice: 'Move 4',
  readToken: 'M1.4',
  human: 'M1.4',
});

export interface DispatcherOptions {
  authenticator: SocketAuthenticator;
  helloTimeoutMs?: number;
  preAuthTimeoutMs?: number;
  maxPreAuth?: number;
  /** A pre-auth connection was closed by a deadline or the cap (for the coalesced counter). */
  onPreAuthClose?: (why: PreAuthCloseReason) => void;
  /** Read-token revocation re-check period (default TOKEN_RECHECK_MS). */
  tokenRecheckMs?: number;
  status: KernelStatusSource;
  /** The kernel log read side + the subscription hub (M1.4 slice 2). Absent ⇒ log.read/ref.resolve stay not-implemented. */
  reads?: { log: ReadLog; hub: SubscriptionHub };
  /** The web endpoint's launch/reconnect auth handler (#web-endpoint dispatcher only). */
  web?: WebAuthHook;
  /** #approval-broker + #budget-fuse (M1.6). Absent ⇒ approve / permit.reserve stay not-implemented. */
  approvals?: ApprovalPort;
  /** #supervisor (M1.7 slice 1): session.open/send/stop for a HUMAN principal. Absent ⇒ they stay not-implemented. */
  sessions?: SessionPort;
  /** #mod-host (M1.11 slice 2): the client relays. Absent ⇒ mod.view / mod.command stay not-implemented. */
  mods?: ModRelayPort;
  /**
   * P8-D98 human-device verbs: each handler lives in its own module (later slices) and is wired here by the daemon,
   * so dispatch.ts does not change again. Absent ⇒ ENGINE{not-implemented}. Called only for a human principal on a
   * device connection (credential 'device'); the handler owns its own params check.
   */
  humanVerbs?: HumanDeviceVerbPorts;
  /**
   * §5 `request.*` append exception, served kinds (P8-D86/D87): `log.append{kind:'request.mode.set', payload}` from
   * a HUMAN on a first-party connection — the GUI launch-token session (credential `gui`) or this home's human device
   * (credential `device`, `gnomon mode`) — goes to the run-mode control (broker/run-mode.ts), which writes the
   * kernel-signed request row and answers. Every other request kind keeps log-append.ts's refusal. Absent ⇒ refused.
   * `status()` is the human class's `status.runModes`.
   */
  requests?: HumanRequestPort;
  /** #gnomon-voice (voice slice V1, talk-only). Absent ⇒ every voice cell keeps its refusal. */
  voice?: VoicePort;
  /** V2e: the kernel-spawned voice client (request.voice.client from the human). */
  voiceClient?: VoiceClientPort;
  /** The method registry (default KERNEL_METHODS: the 12 verbs + 2 relays). Test seam for the fail-closed check. */
  methods?: MethodRegistry;
  /** Append a socket.* row to the kernel log; must reject if the row was not written. */
  log: (kind: SocketLogKind, payload: Record<string, unknown>, ids: { connId: string; deviceId?: string }) => Promise<void>;
}

/** What the dispatcher needs of #gnomon-voice (voice/voice-control.ts VoiceControl). */
export type VoicePort = Pick<VoiceControl, 'humanAppend' | 'voiceAppend' | 'send' | 'stop' | 'attachedHsid' | 'connectionClosed' | 'status'> & Partial<Pick<VoiceControl, 'claimSend' | 'unverifiedFor'>>;

/** The served `request.*` kinds (P8-D86/D87): the asker is stamped from THIS connection, never from params. */
/** V2e: the kernel-spawned voice client, started and stopped only by the human (request.voice.client{op}). */
export interface VoiceClientPort {
  /** TD-2026-10-21-514: an optional capture kind (ptt | open | toggle) the client is (re)started with */
  start(capture?: 'ptt' | 'open' | 'toggle'): Promise<unknown>;
  stop(): Promise<unknown>;
  connectionClosed(connId: string): void;
  /**
   * V2e: GUI enrolment (request.voice.enrol{name, consent}): raise a fresh-presence card whose allow effect writes
   * the root-signed enrolment row. Resolves with the card. Absent ⇒ the request is refused like any unserved kind.
   */
  enrol?(asker: { connId: string; principal: string }, payload: { name: string; consent: string }): Promise<unknown>;
  /** V2e: request.voice.forget{name} (human only, no card: a forget narrows). */
  forget?(payload: { name: string }): Promise<unknown>;
  /** T-2026-10-19-026: request.voice.client{op:'stop-speaking'} — the human's ⏹ (bumps status.voice.stopSpeakingSeq). */
  stopSpeaking?(): unknown;
  /** TD-2026-10-21-514: request.voice.client{op:'mic-toggle'} (the GUI's in-app `) and {op:'mic-key', bare} (the Mic key switch) */
  micToggle?(): unknown;
  micKey?(bare: boolean): unknown;
  /**
   * TD-2026-10-21-514: request.voice.sendword{op:'start', word, variants?} | {op:'clear'} (human only, never a row): the
   * daemon validates, persists ~/.gnomon/voice/send-word.json (0600) and hands the word to #gnomon-voice to hold.
   */
  sendWord?(payload: unknown): Promise<unknown>;
  /** V2e: request.voice.report{enrolment?, notice?, dictation?, playback?, capture?, prints?} (voice principal only; relayed in status.voice, never logged; connId = the reporting connection). */
  report?(payload: unknown, connId?: string): unknown;
}

/** V2e: the human's GUI enrolment request (dispatcher-only like request.voice.client; never written as a row). */
export const VOICE_ENROL_REQUEST = 'request.voice.enrol' as const;
export const VOICE_FORGET_REQUEST = 'request.voice.forget' as const;
export const VOICE_REPORT_REQUEST = 'request.voice.report' as const;

/**
 * V2e: the human's start/stop of the voice app rides the §5 `request.*` append exception like request.mode.set. It
 * is served here and never written as a row (it is not in the §9.1 registry, so no contract id moves).
 */
export const VOICE_CLIENT_REQUEST = 'request.voice.client' as const;
/** TD-2026-10-21-514: the GUI's send claim and the held send word (dispatcher-only, never rows; no id moves). */
export const VOICE_SEND_CLAIM_REQUEST = 'request.voice.send.claim' as const;
export const VOICE_SENDWORD_REQUEST = 'request.voice.sendword' as const;
/** TD-2026-10-22-769: the human's local-model config request (dispatcher-only, never a row; no contract id moves). */
export const LOCAL_CONFIG_REQUEST = 'request.local.config' as const;
/** TD-2026-10-22-769 (Mika C1): the read-only loopback check (dispatcher-only, never a row; no contract id moves). */
export const LOCAL_PROBE_REQUEST = 'request.local.probe' as const;

export interface HumanRequestPort {
  modeSet(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
  status(): Record<string, unknown>;
  /**
   * M2.11-lite (#strictness-levels, broker/strictness.ts): request.strictness.set{repoKey | repo, level} from the human
   * on a gui or device connection ONLY (G-STR-01); status() is the human class's status.strictness.
   */
  strictness?: {
    set(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
    status(): Record<string, unknown>;
  };
  /** TD-2026-10-20-086 F6 (#standing-grant): request.grant.standing / .revoke from the human; status.standing */
  standing?: {
    request(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined; deviceId?: string }, payload: unknown): Promise<unknown>;
    revoke(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined; deviceId?: string }, payload: unknown): Promise<unknown>;
    status(): Record<string, unknown>;
  };
  /**
   * TD-2026-10-20-812 (#offer-router, ^offer-accept): request.offer.decide / request.offer.mute from the human on a
   * gui or device connection ONLY (Aegis D1: never an agent, MCP, model or mod connection); the asker is stamped here.
   */
  offer?: {
    decide(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
    mute(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
  };
  /**
   * #mods-admin (the GUI Mods panel): request.mod.install|link|pause|start|uninstall|config from the human on a gui or
   * device connection, each exactly its `gnomon mod` verb (modhost/mods-admin.ts); status() is merged into the human
   * class's status.mods (installed, available, catalog).
   */
  mods?: {
    request(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, kind: string, payload: unknown): Promise<unknown>;
    status(): Record<string, unknown>;
  };
  /**
   * 8.0:session-rename (#session-names): request.session.rename{hsid, name} from the human on a gui or device
   * connection ONLY; status.sessionNames lists the names of the asker's own sessions. A name is display text only.
   */
  sessionNames?: {
    rename(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
    namesFor(principal: string): Array<{ hsid: string; name: string }>;
  };
  /**
   * 8.0:loops (#loop-registry, kernel/loops/wire.ts): request.loop.trust|untrust|pause|resume|run|delete from the human
   * on a gui or device connection ONLY (the asker stamped here); status() is the human class's status.loops.
   */
  /**
   * TD-2026-10-22-769 (#local-config-request): request.local.config{op:'set', endpoint, runner?} | {op:'remove'} from the
   * human on a gui or device connection ONLY (never voice, an agent or a session; the asker stamped here). Dispatcher-
   * only and never a row: it is not in the §9.1 registry, so no contract id moves. status.local rides extraStatus.
   */
  local?: {
    request(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
    /** request.local.probe{model, base?, compat?}: the read-only loopback check before a card (no card, no row) */
    probe?(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, payload: unknown): Promise<unknown>;
  };
  loops?: {
    request(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined }, kind: string, payload: unknown): Promise<unknown>;
    status(): Record<string, unknown>;
    /** #loop-agent-ops (step 12): an AGENT's loop.request; the asker (principal, hsid) is stamped from this connection */
    agent?(asker: { connId: string; principal: string | undefined; principalClass: string; credential: string | undefined; hsid: string | null }, payload: unknown): Promise<unknown>;
  };
}

/** #mods-admin's status for the human's status.mods; a read that throws shows as `adminError`, never a failed status. */
function modsAdminStatus(m: NonNullable<HumanRequestPort['mods']>): Record<string, unknown> {
  try {
    return m.status();
  } catch (err) {
    return { adminError: err instanceof Error ? err.message.slice(0, 200) : 'mods status failed' };
  }
}

/** The connection a human-device verb runs for (stamped from THIS connection, never from params). */
export interface HumanDeviceVerbContext {
  connId: string;
  principal: string;
  deviceId?: string;
  surface: string | null;
  isLive: () => boolean;
}
export type HumanDeviceVerbHandler = (ctx: HumanDeviceVerbContext, params: unknown) => Promise<unknown>;
/** gui.open (§2.4 rule 8) and rules.revoke (TD-2026-10-19-528 F1): later slices supply them. */
export interface HumanDeviceVerbPorts {
  'gui.open'?: HumanDeviceVerbHandler;
  'rules.revoke'?: HumanDeviceVerbHandler;
  /** daemon.stop (TD-2026-10-19-339, T-2026-10-19-014 B0): raises the daemon-stop card. */
  'daemon.stop'?: HumanDeviceVerbHandler;
}
/** Where each human-device verb lands (T-2026-10-19-001 slices). */
export const HUMAN_DEVICE_VERB_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  'gui.open': 'T-2026-10-19-001',
  'rules.revoke': 'T-2026-10-19-001',
  'daemon.stop': 'T-2026-10-19-014',
});

/** The mod host's side of the client relays (modhost/bridge.ts createModRelayPort). */
export interface ModRelayPort {
  /** relayedFor.principalClass (Aegis M1): the caller's §5 class, for the host's K3 focus join; never forwarded to the mod */
  view(relayedFor: { principal: string; connId: string; principalClass: string }, req: { name: string; viewId: string; input: unknown }): Promise<unknown>;
  command(relayedFor: { principal: string; connId: string; principalClass: string }, req: { name: string; commandId: string; args: unknown }): Promise<unknown>;
  /** full for the human class; counts only otherwise (F4) */
  status(full: boolean): Record<string, unknown>;
}

/** Relay admission (F1): a mod name, and a view / command id (manifest DOTTED_ID, ≤ 128). */
/** S0b: the relayed mod is a mod id <publisher>.<name> (MOD_ID_PATTERN and the 60-character total). */
export const RELAY_MOD_NAME = { test: (s: string): boolean => isModId(s) };
export const RELAY_ID = /^(?=.{1,128}$)[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

export interface KernelDispatcher {
  handle: RpcHandler;
  /**
   * A mod's `kernel.call`: the post-auth dispatch run as a connection-less mod
   * principal (§12.3). The `principal` is TRUSTED — it is supplied only by
   * ModHost (`p:<ns>/mod-<name>` of the child it spawned), never by a mod or
   * a client; no other caller may pass one.
   */
  callAs(principal: string, verb: string, params: Record<string, unknown>): Promise<unknown>;
  onConnect(ctx: ConnectionContext): void;
  onDisconnect(ctx: ConnectionContext): void;
  /**
   * V2e (#gnomon-voice, Aegis V2c must-do 1): authenticate an ADOPTED connection (SocketServerHandle.adopt) as the
   * voice principal without hello/auth. TRUSTED like callAs: called only by the daemon for the socketpair end of
   * the voice child IT spawned, so the child holds no key, no socket path and no kernel pin. The connection is
   * `credential:'device'`, principalKind `voice` (the matrix's voice column), logged socket.auth.ok{via:'spawn'}.
   */
  adoptPreauthenticated(ctx: ConnectionContext, who: { principal: string; client: { name: string; version: string } }): Promise<void>;
  /** Authenticated connections (status `clients`). */
  clients(): ConnAuthState[];
  /** Connections holding timers (tests: nothing outlives its connection). */
  timerCount(): number;
}

export function createKernelDispatcher(o: DispatcherOptions): KernelDispatcher {
  const conns = new Map<string, ConnAuthState>();
  const timers = new Map<string, NodeJS.Timeout[]>();
  const helloMs = o.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const preAuthMs = o.preAuthTimeoutMs ?? PRE_AUTH_TIMEOUT_MS;
  const maxPreAuth = o.maxPreAuth ?? MAX_PRE_AUTH;
  const methods = o.methods ?? KERNEL_METHODS;
  const accessOf_ = (method: string, cls: MatrixClass): Access => accessOf(method, cls, methods);
  const clearTimers = (connId: string): void => {
    for (const t of timers.get(connId) ?? []) clearTimeout(t);
    timers.delete(connId);
  };
  const preAuthCount = (): number => [...conns.values()].filter((c) => c.phase !== 'authenticated').length;
  const stateOf = (connId: string): ConnAuthState => {
    let s = conns.get(connId);
    if (!s) {
      s = { connId, phase: 'new' };
      conns.set(connId, s);
    }
    return s;
  };

  const status = (s: ConnAuthState): Record<string, unknown> => {
    const cls = matrixClassOf(s);
    const facts = new Set<string>(['noSession', 'noPermit', cls]);
    if (cls === 'agent' || cls === 'session') facts.add('agent|session');
    if (cls === 'voice') facts.add('!armed');
    const key = o.status.kernelKey();
    const authed = [...conns.values()].filter((c) => c.phase === 'authenticated');
    const available = (m: string): boolean =>
      (SERVED_METHODS.includes(m) && (o.reads !== undefined || !READ_METHODS.includes(m))) || (o.approvals !== undefined && ((m === 'approve' && cls === 'human') || (m === 'permit.reserve' && (cls === 'human' || cls === 'agent')))) || (o.sessions !== undefined && cls === 'human' && SESSION_METHODS.includes(m)) || (o.voice !== undefined && cls === 'voice' && (m === 'session.send' || m === 'session.stop' || m === 'log.append'));
    return {
      principal: s.principal,
      principalKind: s.principalKind,
      connId: s.connId,
      deviceId: s.deviceId,
      surface: s.client?.surface ?? null,
      clientApi: s.clientApi,
      clientApiId: CLIENT_API_ID,
      kitId: KIT_ID,
      abiId: ABI_ID,
      modAbiId: MOD_ABI_ID,
      credential: s.credential ?? 'device',
      ...(s.credential === 'read-token' ? { token: { tokenId: s.tokenId, expiresAt: s.tokenExpiresAt } } : {}),
      nextLegalVerbs: nextLegalVerbs(facts)
        .filter((v) => accessOf_(v.split(' ')[0]!, cls) !== false) // legal for THIS class only
        .map((v) => ({ verb: v, available: available(v.split(' ')[0]!) })),
      verbs: VERBS.map((v) => ({ verb: v.verb, access: accessOf_(v.verb, cls), available: available(v.verb), milestone: VERB_MILESTONES[v.verb] })),
      humanDeviceVerbs: HUMAN_DEVICE_VERBS.map((v) => ({ verb: v.verb, access: accessOf_(v.verb, cls), available: cls === 'human' && s.credential === 'device' && o.humanVerbs?.[v.verb as keyof HumanDeviceVerbPorts] !== undefined, milestone: HUMAN_DEVICE_VERB_MILESTONES[v.verb] })),
      relays: CLIENT_RELAYS.map((r) => ({ relay: r.relay, access: accessOf_(r.relay, cls), available: relayAvailable(r.relay, s), milestone: VERB_MILESTONES[r.relay] })),
      // F4: full to the human class only; #mods-admin adds installed / available / catalog for the human's Mods panel
      ...(o.mods ? { mods: { ...o.mods.status(cls === 'human'), ...(cls === 'human' && o.requests?.mods ? modsAdminStatus(o.requests.mods) : {}) } } : {}),
      daemon: o.status.daemon(),
      log: o.status.log(),
      sessions: { n: 0 },
      cards: o.approvals?.cards(cls) ?? { n: 0, pendingForYou: 0 },
      ...(o.approvals ? o.approvals.status() : {}),
      ...(o.requests && cls === 'human' ? { runModes: o.requests.status() } : {}),
      ...(o.requests?.strictness && cls === 'human' ? { strictness: o.requests.strictness.status() } : {}),
      ...(o.requests?.standing && cls === 'human' ? { standing: o.requests.standing.status() } : {}),
      // 8.0:session-rename: the names of THIS human's sessions (display text; the GUI folds session.renamed rows too)
      ...(o.requests?.sessionNames && cls === 'human' && s.principal ? { sessionNames: o.requests.sessionNames.namesFor(s.principal) } : {}),
      ...(o.requests?.loops && cls === 'human' ? { loops: o.requests.loops.status() } : {}),
      // V2e: the voice connection reads its own principal here (the adopted fd had no hello/auth reply to carry it)
      // T-2026-10-20-005: status.voice.capture rides here too; voiceStatusFor is the V2 projection (B1's partial words,
      // capture.text, reach a human-class connection on the gui credential only)
      // Dictate (Aegis re-check): status.voice.unverified, the words of THIS human's own sessions' unverified draft turns, on gui only
      ...(o.voice && (cls === 'human' || cls === 'voice') ? { voice: { ...voiceStatusFor({ ...o.voice.status(), ...(cls === 'human' && s.credential === 'gui' && o.voice.unverifiedFor ? { unverified: o.voice.unverifiedFor(s.principal) } : {}) }, s.credential, cls), ...(cls === 'voice' ? { principal: s.principal ?? null } : {}) } } : {}),
      kernelKeyId: key.keyId,
      kernelKeyCustody: key.custody,
      kernelKeySource: key.source,
      root: o.status.root(),
      web: o.status.web?.() ?? { listening: false },
      subscriptions: { n: o.reads?.hub.count() ?? 0, onThisConnection: o.reads?.hub.count(s.connId) ?? 0, perConnectionMax: MAX_SUBSCRIPTIONS_PER_CONNECTION, backlogCap: o.reads?.hub.cap ?? SUBSCRIPTION_BACKLOG_CAP },
      clients: authed.map((c) => ({
        connId: c.connId,
        principal: c.principal,
        surface: c.client?.surface ?? null,
        client: { name: c.client?.name, version: c.client?.version },
        // §12.8 honest limit: what the client DECLARED in hello, labelled `declared`, never `passed`
        conformance: declaredConformance(c.client?.conformance),
      })),
      // G-OBS-01 / G-HON-03: {n, of} — clients that declared a conformance tuple, of authenticated clients
      clientConformance: { n: authed.filter((c) => declaredConformance(c.client?.conformance)).length, of: authed.length, label: 'declared' },
    };
  };

  const relayAvailable = (relay: string, s: ConnAuthState): boolean =>
    o.mods !== undefined && accessOf_(relay, matrixClassOf(s)) !== false && !(relay === 'mod.command' && s.credential === 'gui');

  const recheckMs = o.tokenRecheckMs ?? TOKEN_RECHECK_MS;
  /** A read-token connection whose token died: log (best-effort), then close. Returns the refusal to answer with. */
  const tokenDead = (s: ConnAuthState, ctx: ConnectionContext, reason: string, closeNow: boolean): RpcRefusal => {
    if (s.phase !== 'closed') {
      s.phase = 'closed';
      clearTimers(s.connId);
      void o.log('socket.disconnect', { reason, tokenId: s.tokenId ?? null }, { connId: s.connId }).catch(() => undefined);
      if (closeNow) ctx.close(); // timer path: no reply to send; the call path closes after its AUTH reply
    }
    return new RpcRefusal('AUTH', reason, 'the read token of this connection is no longer valid', { tokenId: s.tokenId }, { closeAfter: true });
  };
  const liveTokenCheck = (s: ConnAuthState): string | null => {
    const c = o.authenticator.checkToken(s.tokenId!);
    if (!c.ok) return c.reason;
    return null;
  };
  const armTokenTimers = (s: ConnAuthState, ctx: ConnectionContext): void => {
    const sweep = (): void => {
      if (conns.get(s.connId) !== s || s.phase !== 'authenticated') {
        if (conns.get(s.connId) === undefined) clearTimers(s.connId); // stale: never leave a timer behind
        return;
      }
      const dead = liveTokenCheck(s);
      if (dead) tokenDead(s, ctx, dead, true);
    };
    const untilExpiry = Math.max(0, (s.tokenExpiresAtMs ?? 0) - o.authenticator.now());
    timers.set(s.connId, [setTimeout(sweep, Math.min(untilExpiry + 1, 2 ** 31 - 1)).unref(), setInterval(sweep, recheckMs).unref()]);
  };

  const handle: RpcHandler = async (frame: RpcRequestFrame, ctx: ConnectionContext) => {
    // A request queued before the close must not re-create state for a gone connection (zombie pre-auth entries).
    if (ctx.closed) throw new RpcRefusal('ENGINE', 'gone', 'the connection is closed');
    const s = stateOf(ctx.connId);
    const m = frame.method;

    if (m === 'hello') {
      const out = o.authenticator.hello(s, frame.params);
      const client = s.client ?? (isClient(frame.params) ? frame.params.client : undefined);
      try {
        await o.log(
        'socket.hello',
        {
          outcome: out.ok ? 'ok' : String(out.refusal.data?.reason ?? out.refusal.code),
          clientApi: out.ok ? out.result.clientApi : null,
          ...(!out.ok && out.offered ? { offered: out.offered.slice(0, 16).map((a) => String(a).slice(0, 64)) } : {}),
          client: client ? { name: clip(client.name), version: clip(client.version), surface: clip(client.surface) } : null,
        },
        { connId: s.connId },
      );
      } catch {
        s.phase = 'closed'; // never wedged: no reply can claim a hello the log does not hold
        throw new RpcRefusal('ENGINE', 'log-write-failed', 'the kernel log refused the hello row', undefined, { closeAfter: true });
      }
      if (!out.ok) throw RpcRefusal.from(out);
      return out.result;
    }

    if (m === 'auth') {
      const out = o.authenticator.authenticate(s, frame.params, {
        tokenInUse: (tokenId) => [...conns.values()].some((c) => c !== s && c.phase === 'authenticated' && c.tokenId === tokenId),
        ...(o.web ? { web: o.web } : {}),
      });
      if (!out.ok) {
        for (const row of out.preRows ?? []) await o.log(row.kind, row.payload, { connId: s.connId }).catch(() => undefined);
        const wrote = await o
          .log(
            out.logKind ?? (out.replay ? 'socket.auth.replay' : 'socket.auth.fail'),
            out.logPayload ?? { reason: out.reason, ...(out.principalClaimed ? { principalClaimed: out.principalClaimed } : {}), ...(out.tokenId ? { tokenId: out.tokenId } : {}) },
            {
              connId: s.connId,
              ...(out.deviceId ? { deviceId: out.deviceId } : {}),
            },
          )
          .then(
            () => true,
            () => false,
          ); // the refusal and the close happen regardless
        // M1.6 slice 2: a WRITTEN theft row raises the broker's fresh-presence gate-class card naming the revoked connection
        const revokedConnId = out.logKind === 'socket.auth.theft' ? out.logPayload?.revokedConnId : undefined;
        if (wrote && typeof revokedConnId === 'string' && o.approvals) {
          const surface = out.logPayload?.surface;
          await o.approvals.authTheft({ connId: s.connId, revokedConnId, surface: typeof surface === 'string' ? surface : null }).catch(() => undefined);
        }
        throw RpcRefusal.from(out, { closeAfter: true });
      }
      try {
        if (out.credential === 'gui') {
          const surface = s.client?.surface ?? null;
          await o.log('socket.auth.ok', { principal: out.principal, principalKind: 'human', credential: 'gui', client: 'gui', via: out.via, surface }, { connId: s.connId, deviceId: out.deviceId });
          await o.log('socket.gui.token.issued', { via: out.via, surface, client: 'gui' }, { connId: s.connId, deviceId: out.deviceId });
        } else if (out.credential === 'device') {
          await o.log('socket.auth.ok', { principal: out.principal, principalKind: out.principalKind, keyId: out.keyId, surface: s.client?.surface ?? null }, { connId: s.connId, deviceId: out.deviceId });
        } else {
          // the token id only — never the token or a digest of it
          await o.log('socket.auth.ok', { principal: out.principal, principalKind: null, credential: 'read-token', tokenId: out.tokenId, expiresAt: out.expiresAt, surface: s.client?.surface ?? null }, { connId: s.connId });
        }
      } catch {
        s.phase = 'closed'; // never authenticated without the row
        if (out.credential === 'gui') out.abort();
        throw new RpcRefusal('ENGINE', 'log-write-failed', 'the kernel log refused the auth row; not authenticated', undefined, { closeAfter: true });
      }
      if (ctx.closed || conns.get(s.connId) !== s || s.phase !== 'authenticated') {
        // the connection went away (or was revoked) during the awaited auth.ok write: no timers, no lifted cap
        s.phase = 'closed';
        if (out.credential === 'gui') out.abort();
        throw new RpcRefusal('ENGINE', 'gone', 'the connection closed during authentication');
      }
      clearTimers(s.connId);
      ctx.authenticated(); // lift the 16 KiB pre-auth frame cap
      if (out.credential === 'read-token') {
        armTokenTimers(s, ctx);
        return { principal: out.principal, connId: s.connId, credential: 'read-token', expiresAt: out.expiresAt };
      }
      if (out.credential === 'gui') {
        out.commit();
        return { guiToken: out.guiToken, principal: out.principal, connId: s.connId };
      }
      return { principal: out.principal, connId: s.connId };
    }

    if (s.phase !== 'authenticated') {
      // G-SOCK-01: unauthenticated ⇒ AUTH + close (a client that calls before auth is not one we keep talking to).
      // Aegis L6: this runs BEFORE the registry lookup, so every name but hello/auth — known or not — gets the same
      // AUTH answer; an unauthenticated caller cannot enumerate method names by telling UNKNOWN_VERB from AUTH.
      if (s.phase !== 'closed') {
        s.phase = 'closed';
        o.onPreAuthClose?.('unauthenticated-call');
      }
      throw new RpcRefusal('AUTH', 'unauthenticated', 'this connection needs hello + auth first', { required: ['hello', 'auth'] }, { closeAfter: true });
    }
    const known = methods.has(m); // the registry: every method declared a tier for every class
    if (!known) throw new RpcRefusal('UNKNOWN_VERB', 'unknown-verb', `unknown verb ${JSON.stringify(m.slice(0, 64))}`);
    if (s.credential === 'read-token') {
      const dead = liveTokenCheck(s);
      if (dead) throw tokenDead(s, ctx, dead, false);
    }

    return serve(s, m, frame, ctx);
  };

  /** The post-auth dispatch: the §5 matrix, then each served cell (shared by the socket and a mod's kernel.call). */
  /** The voice reader's scope (V1): the attached session, when a voice port exists. */
  const voiceScope = (): { voiceHsid: string | null } | undefined => (o.voice ? { voiceHsid: o.voice.attachedHsid() } : undefined);

  const serve = async (s: ConnAuthState, m: string, frame: RpcRequestFrame, ctx: ConnectionContext): Promise<unknown> => {
    const cls = matrixClassOf(s);
    const access: Access = accessOf_(m, cls);
    // default deny: only a declared non-empty tier passes (an undefined permission is never "no restriction")
    if (typeof access !== 'string' || access.length === 0) throw new RpcRefusal('FORBIDDEN', 'matrix', `${m} is not callable by a ${cls} principal (§5)`, { verb: m, principalClass: cls });
    if (READ_METHODS.includes(m)) {
      const reads = o.reads;
      if (!reads) throw new RpcRefusal('ENGINE', 'not-implemented', `${m} is not implemented yet (lands with ${VERB_MILESTONES[m]})`, { verb: m, milestone: VERB_MILESTONES[m] });
      try {
        if (m === 'log.read') {
          const grant = readerFor(s, voiceScope()); // explicit per-class policy: never the generic 'full' view
          const params = parseLogReadParams(frame.params, { features: s.features ?? [], logId: reads.log.logId });
          if (params.follow && !Object.hasOwn(frame, 'id')) throw new RpcRefusal('BAD_REQUEST', 'follow-needs-id', 'a subscription is opened by a request with an id (its reply names the subscription)');
          // V2e: a voice follow with no `since` starts at the released head (voice speaks live rows only; never a
          // backlog-too-large replay from seq 0). A cursor `since` still resumes as for every class.
          const fp = frame.params as Record<string, unknown> | null;
          if (params.follow && cls === 'voice' && (fp === null || typeof fp !== 'object' || fp.since === undefined)) params.since = reads.log.releasedHead();
          return params.follow ? reads.hub.subscribe(ctx, grant, params) : readOnePage(reads.log, grant, params);
        }
        const r = resolveRef(frame.params, reads.log, () => readerFor(s, voiceScope()).reader);
        if (!r.ok) throw new RpcRefusal(r.code, r.reason, r.message, r.data);
        return r.result;
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // P8-D98: the human-device verbs. The matrix above already refused every non-human class (agent, session,
    // mod, voice, read token, peer). A human principal needs a DEVICE connection (a key that signed auth over
    // the verified hello); a GUI launch-token connection is refused. Then the port, or not-implemented.
    if (HUMAN_DEVICE_VERB_NAMES.includes(m)) {
      // Aegis L3: the credential must SAY device — a connection whose credential was never set is not a verified device
      if (cls !== 'human' || s.credential !== 'device' || !s.principal) {
        throw new RpcRefusal('FORBIDDEN', 'matrix', `${m} is callable only by a verified human device connection (§5)`, { verb: m, principalClass: cls });
      }
      const h = o.humanVerbs?.[m as keyof HumanDeviceVerbPorts];
      if (!h) throw new RpcRefusal('ENGINE', 'not-implemented', `${m} is not implemented yet (lands with ${HUMAN_DEVICE_VERB_MILESTONES[m]})`, { verb: m, milestone: HUMAN_DEVICE_VERB_MILESTONES[m] });
      try {
        return await h({ connId: s.connId, principal: s.principal, ...(s.deviceId ? { deviceId: s.deviceId } : {}), surface: s.client?.surface ?? null, isLive: () => !ctx.closed && conns.get(s.connId) === s }, frame.params);
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // M1.6 (T-2026-10-17-017): approve's qualified human value and permit.reserve, handled explicitly.
    if (m === 'approve') {
      if (cls === 'voice') throw asRpcRefusal(voiceApproveRefusal()); // every form, before any port (G-ABI-02 voice row)
      if (cls === 'human' && o.approvals) {
        try {
          return await o.approvals.approve({ connId: s.connId, principal: s.principal!, principalClass: cls, surface: s.client?.surface ?? null, credential: s.credential ?? 'device', ...(s.deviceId ? { deviceId: s.deviceId } : {}), isLive: () => !ctx.closed && conns.get(s.connId) === s }, frame.params);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
    }
    if (m === 'permit.reserve' && cls === 'session') {
      throw new RpcRefusal('ENGINE', 'not-implemented', 'permit.reserve for a session principal is scoped (own scope); session principals land with M1.7', { verb: m, access: String(access), milestone: 'M1.7' });
    }
    if (m === 'permit.reserve' && (cls === 'human' || cls === 'agent') && o.approvals) {
      try {
        return await o.approvals.reserve({ connId: s.connId, principal: s.principal!, principalClass: cls, surface: s.client?.surface ?? null, credential: s.credential ?? 'device' }, frame.params);
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // M1.7 slice 1: session.open/send/stop for a human principal (attended, human-started sessions only)
    if (SESSION_METHODS.includes(m) && cls === 'human' && o.sessions) {
      const sctx = { principal: s.principal!, principalClass: cls, features: s.features ?? [], connId: s.connId, ...(s.credential ? { credential: s.credential } : {}) };
      try {
        return await (m === 'session.open' ? o.sessions.open(sctx, frame.params) : m === 'session.send' ? o.sessions.send(sctx, frame.params) : o.sessions.stop(sctx, frame.params));
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // voice slice V1 (#gnomon-voice): the voice principal's session.send / session.stop (forwarding guards in the port)
    if (cls === 'voice' && (m === 'session.send' || m === 'session.stop') && o.voice && s.principal) {
      const vc = { connId: s.connId, principal: s.principal };
      try {
        return await (m === 'session.send' ? o.voice.send(vc, frame.params) : o.voice.stop(vc, frame.params));
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // M1.11 slice 2: the client relays, relayedFor stamped from THIS connection
    if (RELAY_NAMES.includes(m) && o.mods) {
      const p = frame.params;
      const pr = p !== null && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
      const id = pr?.[m === 'mod.view' ? 'viewId' : 'commandId'];
      const ok = pr !== null && typeof pr.name === 'string' && RELAY_MOD_NAME.test(pr.name) && typeof id === 'string' && RELAY_ID.test(id);
      if (!ok) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${m} params are {name: a mod name, ${m === 'mod.view' ? 'viewId: a view id, input' : 'commandId: a command id, args'}}`, { verb: m });
      if (m === 'mod.command' && s.credential === 'gui') {
        throw new RpcRefusal('ENGINE', 'not-implemented', 'mod.command from a GUI needs a user gesture (§11.5); the gesture proof lands with the GUI (M1.10)', { verb: m, milestone: 'M1.10' });
      }
      const q = p as Record<string, unknown>;
      // Aegis M1: the class rides with the principal, so the host joins a focus only for a caller entitled to it
      const relayedFor = { principal: s.principal!, connId: s.connId, principalClass: cls };
      try {
        return await (m === 'mod.view' ? o.mods.view(relayedFor, { name: String(q.name), viewId: String(q.viewId), input: q.input ?? null }) : o.mods.command(relayedFor, { name: String(q.name), commandId: String(q.commandId), args: q.args ?? null }));
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    if (access !== 'yes' && SERVED_METHODS.includes(m)) {
      const milestone = SCOPED_VIEW_MILESTONES[cls] ?? VERB_MILESTONES[m];
      throw new RpcRefusal('ENGINE', 'not-implemented', `${m} for a ${cls} principal is scoped (${String(access)}); the scoped view lands with ${milestone}`, {
        verb: m,
        access: String(access),
        milestone,
      });
    }

    if (m === 'log.append') {
      // P8-D86/D87: request.mode.set from the human on a first-party connection (GUI launch token or human device)
      const pa = frame.params !== null && typeof frame.params === 'object' && !Array.isArray(frame.params) ? (frame.params as Record<string, unknown>) : null;
      if (pa?.kind === 'request.mode.set' && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        try {
          return await o.requests.modeSet({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // M2.11-lite: request.strictness.set from the human on a first-party connection (GUI launch token or human device)
      if (pa?.kind === 'request.strictness.set' && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.strictness) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        try {
          return await o.requests.strictness.set({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // 8.0:model-switch: the human switches a live Claude session's model (GUI launch token or human device only)
      if (pa?.kind === 'request.session.model' && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.sessions?.model) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        const sctx = { principal: s.principal!, principalClass: cls, features: s.features ?? [], connId: s.connId, ...(s.credential ? { credential: s.credential } : {}) };
        try {
          return await o.sessions.model(sctx, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // TD-2026-10-20-086 F6: the daily standing grant (mint: the GUI only; revoke: the GUI or this home's device)
      if ((pa?.kind === 'request.grant.standing' || pa?.kind === 'request.grant.standing.revoke') && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.standing) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        const asker = { connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential, ...(s.deviceId ? { deviceId: s.deviceId } : {}) };
        try {
          return await (pa.kind === 'request.grant.standing' ? o.requests.standing.request(asker, pa.payload) : o.requests.standing.revoke(asker, pa.payload));
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // TD-2026-10-20-812 (Aegis D1): the Desk's two human requests, gui/device human connections only, stamped by connId
      if ((pa?.kind === 'request.offer.decide' || pa?.kind === 'request.offer.mute') && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.offer) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        const asker = { connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential };
        try {
          return await (pa.kind === 'request.offer.decide' ? o.requests.offer.decide(asker, pa.payload) : o.requests.offer.mute(asker, pa.payload));
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // #mods-admin: the GUI Mods panel's requests, gui/device human connections only, the asker stamped by connId
      if (typeof pa?.kind === 'string' && MOD_ADMIN_REQUESTS.includes(pa.kind) && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.mods) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        const asker = { connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential };
        try {
          return await o.requests.mods.request(asker, pa.kind, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // 8.0:session-rename: the human names a session (gui/device human connections only, stamped by connId)
      if (pa?.kind === 'request.session.rename' && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.sessionNames) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        try {
          return await o.requests.sessionNames.rename({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // TD-2026-10-22-769 (#local-config-request): the human sets or removes the local-model config (gui/device only)
      if (pa?.kind === LOCAL_CONFIG_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.local) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${LOCAL_CONFIG_REQUEST}', payload:{op:'set', endpoint, runner?} | {op:'remove'}}`);
        try {
          return await o.requests.local.request({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // TD-2026-10-22-769 (Mika C1): the read-only loopback check before a card (gui/device human only; no row, no card)
      if (pa?.kind === LOCAL_PROBE_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.local?.probe) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${LOCAL_PROBE_REQUEST}', payload:{model, base?, compat?}}`);
        try {
          return await o.requests.local.probe({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // 8.0:loops (#loop-registry): the human's request.loop.* (gui/device human connections only, stamped by connId)
      if (typeof pa?.kind === 'string' && pa.kind.startsWith('request.loop.') && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.requests?.loops) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${String(pa.kind)} (unknown: ${extra.slice(0, 4).join(', ')})`);
        try {
          return await o.requests.loops.request({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.kind, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // 8.0:loops step 12 (#loop-agent-ops): loop.request goes to the agent pre-gate and nowhere else; the asker's
      // principal and hsid come from THIS connection, never the payload. Every class reaches the gate, which refuses
      // all but an agent (sessions and loop sessions: LL5; peers, voice, mods: never)
      if (pa?.kind === 'loop.request' && o.requests?.loops?.agent) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for loop.request (unknown: ${extra.slice(0, 4).join(', ')})`);
        try {
          return await o.requests.loops.agent({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential, hsid: s.hsid ?? null }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // V2e: the human starts / stops the kernel-spawned voice app (never the voice principal, never an agent)
      if (pa?.kind === VOICE_CLIENT_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.voiceClient) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        const op = (pa.payload as { op?: unknown } | null | undefined)?.op;
        const stopSpeaking = o.voiceClient.stopSpeaking;
        const vcp = (pa.payload ?? {}) as Record<string, unknown>;
        // TD-2026-10-21-514: the in-app mic key and the Mic key switch (the human's own gestures; no card: a bare key is a local binding)
        if (op === 'start' && Object.keys(vcp).length === 2 && !extra.length) {
          if (vcp.capture !== 'ptt' && vcp.capture !== 'open' && vcp.capture !== 'toggle') throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${VOICE_CLIENT_REQUEST}', payload:{op:'start', capture?: 'ptt'|'open'|'toggle'}}`);
          return { voiceClient: await o.voiceClient.start(vcp.capture) };
        }
        if (op === 'mic-toggle' && o.voiceClient.micToggle && Object.keys(vcp).length === 1 && !extra.length) return { voiceClient: o.voiceClient.micToggle() };
        if (op === 'mic-key' && o.voiceClient.micKey && Object.keys(vcp).length === 2 && typeof vcp.bare === 'boolean' && !extra.length) return { voiceClient: o.voiceClient.micKey(vcp.bare) };
        if (extra.length || (op !== 'start' && op !== 'stop' && !(op === 'stop-speaking' && stopSpeaking)) || Object.keys(pa.payload as object).length !== 1) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${VOICE_CLIENT_REQUEST}', payload:{op:'start'|'stop'|'stop-speaking'|'mic-toggle'} | {op:'mic-key', bare}}`);
        // T-2026-10-19-026: ⏹ Stop speaking narrows (silences the voice app) ⇒ no card, no presence
        if (op === 'stop-speaking') return { voiceClient: stopSpeaking!.call(o.voiceClient) };
        return { voiceClient: await (op === 'start' ? o.voiceClient.start() : o.voiceClient.stop()) };
      }
      if (pa?.kind === VOICE_ENROL_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.voiceClient?.enrol && s.principal) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        const ep = pa.payload as { name?: unknown; consent?: unknown } | null | undefined;
        const shape = `log.append{kind:'${VOICE_ENROL_REQUEST}', payload:{name, consent}}`;
        if (extra.length || !ep || typeof ep !== 'object' || Object.keys(ep).some((k) => k !== 'name' && k !== 'consent') || typeof ep.name !== 'string' || typeof ep.consent !== 'string') throw new RpcRefusal('BAD_REQUEST', 'bad-params', shape);
        try {
          return await o.voiceClient.enrol({ connId: s.connId, principal: s.principal }, { name: ep.name, consent: ep.consent }); // {pending, cardId}
        } catch (err) {
          if (err instanceof TypeError) throw new RpcRefusal('BAD_REQUEST', 'bad-params', err.message);
          throw asRpcRefusal(err);
        }
      }
      // TD-2026-10-21-514 ($send-by-word, $send-by-pieces): the GUI's claim before a voice-origin send (human, first party)
      if (pa?.kind === VOICE_SEND_CLAIM_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.voice?.claimSend) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${VOICE_SEND_CLAIM_REQUEST}', payload:{hsid, by, turnSeq | turnSeqs}}`);
        try {
          return o.voice.claimSend({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, pa.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      // TD-2026-10-21-514: the human sets or clears the held send word (narrowing or a liability the GUI acknowledged)
      if (pa?.kind === VOICE_SENDWORD_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.voiceClient?.sendWord) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${VOICE_SENDWORD_REQUEST}', payload:{op:'start', word, variants?, trial?} | {op:'save', dropVariants?} | {op:'clear', trial?}}`);
        try {
          return await o.voiceClient.sendWord(pa.payload);
        } catch (err) {
          if (err instanceof TypeError) throw new RpcRefusal('BAD_REQUEST', 'bad-params', err.message);
          throw asRpcRefusal(err);
        }
      }
      // V2e: forget narrows ⇒ human only, no card (spec D62); the root-signed forget row is written at once
      if (pa?.kind === VOICE_FORGET_REQUEST && cls === 'human' && (s.credential === 'gui' || s.credential === 'device') && o.voiceClient?.forget) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        const fp = pa.payload as { name?: unknown } | null | undefined;
        if (extra.length || !fp || typeof fp !== 'object' || Object.keys(fp).some((k) => k !== 'name') || typeof fp.name !== 'string') throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${VOICE_FORGET_REQUEST}', payload:{name}}`);
        try {
          return await o.voiceClient.forget({ name: fp.name });
        } catch (err) {
          if (err instanceof TypeError) throw new RpcRefusal('BAD_REQUEST', 'bad-params', err.message);
          throw asRpcRefusal(err);
        }
      }
      // V2e: the voice client's enrolment progress and notices, relayed in status.voice (never a row)
      if (pa?.kind === VOICE_REPORT_REQUEST && cls === 'voice' && s.credential !== 'read-token' && o.voiceClient?.report) {
        const extra = Object.keys(pa).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append{kind:'${VOICE_REPORT_REQUEST}', payload:{enrolment?, notice?, dictation?, playback?, capture?, prints?}}`);
        try {
          return o.voiceClient.report(pa.payload, s.connId);
        } catch (err) {
          if (err instanceof TypeError) throw new RpcRefusal('BAD_REQUEST', 'bad-params', err.message);
          throw asRpcRefusal(err);
        }
      }
      // voice slice V1: the human's attach / detach gesture, and the voice principal's voice.* rows
      const vkind = typeof pa?.kind === 'string' ? pa.kind : '';
      if (o.voice && cls === 'human' && (vkind === 'voice.session.start' || vkind === 'voice.session.end') && (s.credential === 'gui' || s.credential === 'device')) {
        const extra = Object.keys(pa!).filter((k) => k !== 'kind' && k !== 'payload');
        if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `log.append takes {kind, payload} for ${vkind} (unknown: ${extra.slice(0, 4).join(', ')})`);
        try {
          return await o.voice.humanAppend({ connId: s.connId, principal: s.principal, principalClass: cls, credential: s.credential }, vkind, pa!.payload);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      if (o.voice && cls === 'voice' && vkind.startsWith('voice.') && s.principal) {
        try {
          return await o.voice.voiceAppend({ connId: s.connId, principal: s.principal }, frame.params);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
      try {
        refuseAppend(cls as AppendClass, s.principal, frame.params);
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    if (m === 'status') return status(s);
    throw new RpcRefusal('ENGINE', 'not-implemented', `${m} is not implemented yet (lands with ${VERB_MILESTONES[m]})`, { verb: m, milestone: VERB_MILESTONES[m] });
  };

  /** A mod's kernel.call (§12.3): matrix class `mod`, no connection (so no subscription), relays and log.append excluded. */
  const callAs = async (principal: string, verb: string, params: Record<string, unknown>): Promise<unknown> => {
    if (methods.kindOf(verb) !== 'verb') throw new RpcRefusal('UNKNOWN_VERB', 'unknown-verb', `unknown verb ${JSON.stringify(verb.slice(0, 64))}`);
    // in-process: the mod host speaks the kernel's own version, so it has every feature the kernel built (journal.cursor)
    const s: ConnAuthState = { connId: `kernel.call:${principal}`, phase: 'authenticated', principal, principalKind: 'mod', credential: 'device', features: [...SERVER_FEATURES] };
    if (verb === 'status') {
      // the mod column's `own view`: who it is, the ids, and what it may call — nothing about other principals
      return { principal, principalKind: 'mod', clientApiId: CLIENT_API_ID, kitId: KIT_ID, abiId: ABI_ID, modAbiId: MOD_ABI_ID, verbs: VERBS.map((v) => ({ verb: v.verb, access: v.access.mod })) };
    }
    if (verb === 'log.read' && params !== null && typeof params === 'object' && (params as { follow?: unknown }).follow) {
      throw new RpcRefusal('BAD_REQUEST', 'bad-follow', 'a mod reads pages through kernel.call; a follow subscription needs a connection');
    }
    if (verb === 'log.append') throw new RpcRefusal('FORBIDDEN', 'modns-not-own', 'a mod appends through the mod host only (its own declared modns.<name>.* kinds)', { verb, principalClass: 'mod' });
    const frame = { jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 0, method: verb, params } as unknown as RpcRequestFrame;
    const ctx = { connId: s.connId, closed: false, close: () => undefined, authenticated: () => undefined } as unknown as ConnectionContext;
    return serve(s, verb, frame, ctx);
  };

  return {
    handle,
    callAs,
    onConnect: (ctx) => {
      if (preAuthCount() >= maxPreAuth) {
        o.onPreAuthClose?.('pre-auth-cap');
        ctx.close();
        return;
      }
      const s = stateOf(ctx.connId);
      const expire = (why: PreAuthCloseReason, test: () => boolean) => () => {
        if (conns.get(ctx.connId) === s && test()) {
          o.onPreAuthClose?.(why);
          ctx.close();
        }
      };
      timers.set(ctx.connId, [
        setTimeout(expire('hello-timeout', () => s.phase === 'new'), helloMs).unref(),
        setTimeout(expire('pre-auth-timeout', () => s.phase !== 'authenticated'), preAuthMs).unref(),
      ]);
    },
    adoptPreauthenticated: async (ctx, who) => {
      if (!/^p:[0-9a-z]{8}\/voice$/.test(who.principal)) throw new TypeError('adoptPreauthenticated is for the spawned voice principal only');
      const s = stateOf(ctx.connId);
      if (s.phase !== 'new') throw new TypeError('adoptPreauthenticated: the connection already spoke');
      clearTimers(ctx.connId);
      s.phase = 'authenticated';
      s.principal = who.principal;
      s.principalKind = 'voice';
      s.credential = 'device';
      s.clientApi = 'gnomon-rpc:v1';
      s.features = [...SERVER_FEATURES];
      s.client = { name: who.client.name, version: who.client.version, surface: 'voice' } as ConnAuthState['client'];
      ctx.authenticated();
      try {
        await o.log('socket.auth.ok', { principal: who.principal, principalKind: 'voice', credential: 'device', via: 'spawn', surface: 'voice' }, { connId: s.connId });
      } catch {
        s.phase = 'closed'; // never an authenticated connection the log does not hold
        ctx.close();
        throw new Error('the kernel log refused the voice auth row');
      }
    },
    onDisconnect: (ctx) => {
      o.reads?.hub.disconnect(ctx.connId);
      o.approvals?.connectionClosed(ctx.connId);
      o.voice?.connectionClosed(ctx.connId);
      o.voiceClient?.connectionClosed(ctx.connId);
      clearTimers(ctx.connId);
      conns.delete(ctx.connId);
    },
    clients: () => [...conns.values()].filter((c) => c.phase === 'authenticated'),
    timerCount: () => timers.size,
  };
}

function isClient(p: unknown): p is { client: { name?: unknown; version?: unknown; surface?: unknown } } {
  return p !== null && typeof p === 'object' && 'client' in p && (p as { client: unknown }).client !== null && typeof (p as { client: unknown }).client === 'object';
}

function clip(v: unknown): string | null {
  return typeof v === 'string' ? v.slice(0, 128) : null;
}
