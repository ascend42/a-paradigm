/**
 * gnomon-rpc:v1 (spec §4.9, §5, §12.3, §12.8) — the hello frame, version and
 * feature negotiation, the compatible-additive rule, and the frozen client
 * surface: 12 kernel verbs + 2 client relays.
 */

import { ID_PATTERNS } from './ids.js';
import { Checker, canonicalJson, deepFreeze, type ValidateOptions } from './internal.js';
import { PRINCIPAL_KINDS } from './principal.js';
import { CARD_EXPIRY_WHYS, CARD_KINDS, CARD_STATES, CARD_FLAGS, CARD_DECISIONS, PRESENCE_VALUES, VIA_VALUES, RUN_MODES, STRICTNESS_LEVELS } from './card.js';
import { FINDING_RESPONSES, FINDING_SEVERITIES } from './review-finding.js';
import { RISK_TIERS, AGENT_REVERT_HOWS, KERNEL_REVERT_HOWS } from './change-note.js';
import { REFUSAL_GATES, REFUSAL_REASONS, refuse, type Refusal, type RefusalCode } from './refusal.js';
import { INJECT_ORIGINS, ALWAYS_RULE_MATCHES, DRAIN_REASONS } from './event.js';

export const GNOMON_RPC_V1 = 'gnomon-rpc:v1' as const;
export const CLIENT_API_PATTERN = /^gnomon-rpc:v([1-9][0-9]*)$/;

/** hello `client.surface` values the spec names; additive ("…" in §4.9). */
export const CLIENT_SURFACES = ['browser', 'wrapper', 'cli', 'conductor'] as const;

/* ── the frozen verb list (§5) ────────────────────────────────────────────── */

/** Access per principal class, verbatim-compressed from §5's matrix. `false` = refused. */
export type Access = false | string;

export interface VerbDescriptor {
  n: number;
  verb: string;
  /** param names; `?` suffix = optional. */
  params: readonly string[];
  result: string;
  refusals: readonly RefusalCode[];
  humanOnly: boolean;
  access: {
    human: Access;
    agent: Access;
    session: Access;
    mod: Access;
    voice: Access;
    readToken: Access;
    peer: Access;
  };
}

export const VERBS: readonly VerbDescriptor[] = deepFreeze([
  {
    n: 1, verb: 'status', params: [], result: 'self-description', refusals: ['AUTH'], humanOnly: false,
    access: { human: 'yes', agent: 'yes', session: 'yes', mod: 'own view', voice: 'yes', readToken: 'yes', peer: false },
  },
  {
    n: 2, verb: 'session.open',
    params: ['backend?', 'model', 'cwd', 'mode?', 'runMode?', 'as?', 'goal?', 'contract?', 'alias?', 'derived?', 'permitId?', 'systemPrompt?', 'attended', 'brief?'],
    result: '{hsid, principalId, backend, state}',
    refusals: ['PERMIT_REQUIRED', 'BUDGET_DENIED', 'BILLING_REFUSED', 'MODEL_UNAVAILABLE', 'UNSUPPORTED', 'FORBIDDEN'], humanOnly: false,
    access: { human: 'yes', agent: 'permit', session: 'permit', mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 3, verb: 'session.send', params: ['hsid', 'content', 'permitId', 'steer?', 'source?'], result: '{turn}',
    refusals: ['PERMIT_REQUIRED', 'BUDGET_DENIED', 'NOT_FOUND', 'BAD_REQUEST'], humanOnly: false,
    access: { human: 'yes', agent: 'own subtree', session: 'own subtree', mod: 'via kernel.call with caller hsid, same scope', voice: 'attached session, source: voice forced', readToken: false, peer: false },
  },
  {
    n: 4, verb: 'session.stop', params: ['hsid', 'interrupt?'], result: '{signals[], exited}', refusals: ['NOT_FOUND', 'FORBIDDEN'], humanOnly: false,
    access: { human: 'yes', agent: 'own subtree', session: 'own subtree', mod: false, voice: 'interrupt only', readToken: false, peer: false },
  },
  {
    n: 5, verb: 'log.append', params: ['kind', 'payload?', 'ref?', 'causes?', 'scope?', 'idem?', 'audience?', 'sensitivity?'], result: '{id, seq, hash}',
    refusals: ['FORBIDDEN', 'BAD_REQUEST', 'ENGINE'], humanOnly: false,
    access: { human: 'granted kinds + request.* (first-party human-class connections)', agent: 'granted kinds', session: false, mod: 'modns.<name>.* only', voice: 'voice.* + request.voice.arm', readToken: false, peer: false },
  },
  {
    n: 6, verb: 'log.read', params: ['since?', 'kinds?', 'scope?', 'follow?'], result: 'backlog + stream', refusals: ['AUTH', 'BAD_REQUEST'], humanOnly: false,
    access: { human: 'full', agent: 'redacted', session: 'own scope', mod: 'granted kinds, own modns', voice: 'own session + voice.*', readToken: 'redacted', peer: false },
  },
  {
    n: 7, verb: 'permit.reserve', params: ['kind', 'scope', 'backend?', 'model?', 'limits?', 'tool?', 'input?', 'op?', 'permitId?'], result: 'permit:v1',
    refusals: ['BUDGET_DENIED', 'BILLING_REFUSED', 'FORBIDDEN'], humanOnly: false,
    access: { human: 'yes', agent: 'yes', session: 'own scope', mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 8, verb: 'approve', params: ['cardId?', 'decision', 'note?', 'decisionSig?', 'via?', 'voice?'], result: 'card:v1',
    refusals: ['FORBIDDEN', 'NOT_FOUND', 'AUTH'], humanOnly: true,
    access: { human: 'presence per class; root key for use-api-token, install; withdraw on held cards with no presence', agent: false, session: false, mod: false, voice: 'intent form only, supervised child inside a live arm', readToken: false, peer: false },
  },
  {
    n: 9, verb: 'contract.register', params: ['contract'], result: '{contractId, nodes}', refusals: ['BAD_REQUEST', 'FORBIDDEN'], humanOnly: false,
    access: { human: 'yes', agent: 'yes', session: false, mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 10, verb: 'contract.claim', params: ['contractId', 'nodeId', 'op', 'ttl?', 'expect?', 'note?', 'responses?'], result: '{nodeId, status, by, seq, expiresAt?}',
    refusals: ['CAS_LOST', 'NOT_FOUND', 'BAD_REQUEST'], humanOnly: false,
    access: { human: 'yes', agent: 'yes', session: 'yes', mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 11, verb: 'oracle.run', params: ['contractId', 'nodeId', 'oracle'], result: 'oracle:v1', refusals: ['PERMIT_REQUIRED', 'UNSUPPORTED', 'ENGINE', 'FORBIDDEN'], humanOnly: false,
    access: { human: 'yes', agent: 'requests', session: 'requests', mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 12, verb: 'ref.resolve', params: ['ref'], result: '{target, hash?}', refusals: ['BAD_REQUEST', 'UNSUPPORTED', 'NOT_FOUND'], humanOnly: false,
    access: { human: 'yes', agent: 'yes', session: 'yes', mod: 'yes', voice: 'yes', readToken: 'yes', peer: false },
  },
] satisfies VerbDescriptor[]);

export const VERB_NAMES = Object.freeze(VERBS.map((v) => v.verb)) as readonly string[];

/**
 * Human-device verbs (P8-D98, T-2026-10-19-001): socket methods callable ONLY by a human principal on a device
 * connection whose hello verified the kernel key. Every other class is refused (`false`), the peer column included.
 * They are not among law 3's twelve kernel verbs (§10 law 3 counts them separately, as it counts the relays):
 *   13 `gui.open{cwdHint?}` → a single-use launch grant, the in-process requestWebLaunch's rules (§2.4 rule 8).
 *   14 `rules.revoke{ruleId}` → revokes a standing `always` rule; writes approval.rule.revoked. No presence prompt:
 *      revoking only narrows (TD-2026-10-19-528 F1).
 *   15 `daemon.stop{reason?}` → raises the kernel's signed `daemon-stop` card (§3.1 I3, TD-2026-10-19-528 F3,
 *      ruling TD-2026-10-19-339); the kernel stops only on a fresh-presence (Touch ID) accept. `reason` is one of
 *      DAEMON_STOP_REASONS: `stop` (the default) or `upgrade` (reserved: the §2.4 rule 11 drain, slice B1).
 * Each handler is its own module behind a dispatcher port; until it lands the call is ENGINE{not-implemented}.
 */
export const HUMAN_DEVICE_ACCESS = 'verified human device' as const;
export const HUMAN_DEVICE_VERBS: readonly VerbDescriptor[] = deepFreeze([
  {
    n: 13, verb: 'gui.open', params: ['cwdHint?'], result: '{url, expiresAt}', refusals: ['FORBIDDEN', 'BAD_REQUEST', 'ENGINE'], humanOnly: true,
    access: { human: HUMAN_DEVICE_ACCESS, agent: false, session: false, mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 14, verb: 'rules.revoke', params: ['ruleId'], result: '{ruleId, revoked}', refusals: ['FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'ENGINE'], humanOnly: true,
    access: { human: HUMAN_DEVICE_ACCESS, agent: false, session: false, mod: false, voice: false, readToken: false, peer: false },
  },
  {
    n: 15, verb: 'daemon.stop', params: ['reason?'], result: '{cardId, state}', refusals: ['FORBIDDEN', 'BAD_REQUEST', 'ENGINE'], humanOnly: true,
    access: { human: HUMAN_DEVICE_ACCESS, agent: false, session: false, mod: false, voice: false, readToken: false, peer: false },
  },
] satisfies VerbDescriptor[]);
export const HUMAN_DEVICE_VERB_NAMES = Object.freeze(HUMAN_DEVICE_VERBS.map((v) => v.verb)) as readonly string[];
/** `gui.open.cwdHint` cap in UTF-8 bytes (§2.4 rule 8). */
export const GUI_OPEN_CWD_HINT_MAX_BYTES = 1024;
/**
 * `daemon.stop.reason` values (closed, TD-2026-10-19-339): `stop` (the default) asks to stop the kernel; `upgrade`
 * is reserved for the §2.4 rule 11 drain-and-resume (slice B1) — until the kernel builds it the call is refused
 * `ENGINE{reason:'not-implemented'}`. Any other value is `BAD_REQUEST{reason:'bad-params'}`.
 */
export const DAEMON_STOP_REASONS = Object.freeze(['stop', 'upgrade'] as const);
export type DaemonStopReasonValue = (typeof DAEMON_STOP_REASONS)[number];

export interface RelayDescriptor {
  relay: string;
  params: readonly string[];
  forwardsAs: string;
}

/** The two client relays (§12.3): served by the mod host, not kernel verbs. */
export const CLIENT_RELAYS: readonly RelayDescriptor[] = deepFreeze([
  { relay: 'mod.view', params: ['name', 'viewId', 'input'], forwardsAs: 'view.render' },
  { relay: 'mod.command', params: ['name', 'commandId', 'args'], forwardsAs: 'command.run' },
] satisfies RelayDescriptor[]);
export const RELAY_NAMES = Object.freeze(CLIENT_RELAYS.map((r) => r.relay)) as readonly string[];

/**
 * Typed values of verb params reserved M1.1 (§5, §4.11). `session.open.runMode`
 * and `contract.claim.responses[].response` (P8-D86–D88); `contract.claim.note`
 * is a change-note:v1 (claim form: agentClaims only).
 */
export const VERB_PARAM_VALUES = deepFreeze({
  'session.open.runMode': [...RUN_MODES],
  'contract.claim.note': ['change-note.v1.schema.json#/$defs/claim'],
  'contract.claim.responses[].response': [...FINDING_RESPONSES],
});

/** Content parts of `session.send{content[]}` the spec names (§3.9: `{brief}`, human only). Reserved M1.1 (P8-R9). */
export const RESERVED_CONTENT_PARTS = ['brief'] as const;

/**
 * Top-level `status` fields reserved M1.1 (§5): `links` (P8-R9, §3.9);
 * `strictness`, `review`, `unobservedRefWrites` (P8-D86–D88, §3.4, §7.3).
 * Shapes are the §5 prose; the full status:v1 result schema is not yet in
 * this package, so the reservation is the field name plus its owner.
 */
export const STATUS_RESERVED_FIELDS = deepFreeze({
  links: { reserved: 'M1.1:P8-R9', section: '§3.9' },
  strictness: { reserved: 'M1.1:P8-D86-D88', section: '§3.4' },
  review: { reserved: 'M1.1:P8-D86-D88', section: '§7.3' },
  unobservedRefWrites: { reserved: 'M1.1:P8-D86-D88', section: '§3.4' },
});

/** The client-callable surface: 12 kernel verbs + 3 human-device verbs + 2 relays (§5, P8-D98). */
export const CLIENT_METHODS = Object.freeze([...VERB_NAMES, ...HUMAN_DEVICE_VERB_NAMES, ...RELAY_NAMES]) as readonly string[];

/**
 * hello feature names reserved by P8-D98 (§2.4 rule 11, §5): per-client gates negotiated in the signed hello.
 * The kernel advertises none of them until it builds them (socket/auth.ts SERVER_FEATURES stays []); a client
 * that needs one and does not get it refuses the dependent operation, never degrades it.
 */
export const RESERVED_HELLO_FEATURES = Object.freeze(['journal.cursor', 'session.resume'] as const);

/** The `log.read` cursor (§5, TD-2026-10-19-648 item 8): a seq is only meaningful inside one log. */
export interface LogReadCursor {
  logId: string;
  seq: number;
}
export const LOG_READ_CURSOR_KEYS = ['logId', 'seq'] as const;
export function validateLogReadCursor(value: unknown): string[] {
  const c = new Checker('strict');
  if (!c.obj('', value)) return c.errors;
  c.closed('', value, LOG_READ_CURSOR_KEYS);
  c.required('', value, LOG_READ_CURSOR_KEYS);
  if ('logId' in value) c.str('logId', value.logId, ID_PATTERNS.log, 'log:<ULID>');
  if ('seq' in value) c.int('seq', value.seq, 1);
  return c.errors;
}

/**
 * Closed value sets of the P8-D98 move that are NOT additive: an always-rule matches exactly (F2), and a drain
 * has one reason. Published so clientApiId covers them.
 */
export const D98_CLOSED_VALUES = deepFreeze({
  'approval.rule.learned.match': [...ALWAYS_RULE_MATCHES],
  'session.drained.reason': [...DRAIN_REASONS],
  'daemon.stop.reason': [...DAEMON_STOP_REASONS],
});

/* ── the compatible-additive rule (§4.9, §12.8) ───────────────────────────── */

/**
 * The closed enumerations inside v1 schemas that MAY gain values. A client
 * renders an unknown value opaquely (never drops the item) and treats a card
 * in an unknown `state` as not decidable. Everything not listed here (refusal
 * codes, retriability, audience, sensitivity, …) is closed: changing it is v2.
 */
export const ADDITIVE_ENUMS = deepFreeze({
  'card.kind': [...CARD_KINDS],
  'card.state': [...CARD_STATES],
  'card.flags': [...CARD_FLAGS],
  presence: [...PRESENCE_VALUES],
  via: [...VIA_VALUES],
  'principal.kind': [...PRINCIPAL_KINDS],
  'session.inject.origin': [...INJECT_ORIGINS],
  decision: [...CARD_DECISIONS],
  'refusal.gate': [...REFUSAL_GATES],
  'refusal.reason': [...REFUSAL_REASONS],
  'client.surface': [...CLIENT_SURFACES],
  // P8-D98: approval.expire{why} (session-drained, F4).
  'approval.expire.why': [...CARD_EXPIRY_WHYS],
  // P8-D86–D88, additive with fail-safe readings (FAIL_SAFE_VALUES).
  'card.strictness.level': [...STRICTNESS_LEVELS],
  'run.mode': [...RUN_MODES],
  'risk.tier': [...RISK_TIERS],
  'agentClaims.revert.how': [...AGENT_REVERT_HOWS],
  'kernel.revert.how': [...KERNEL_REVERT_HOWS],
  'finding.severity': [...FINDING_SEVERITIES],
  'finding.response': [...FINDING_RESPONSES],
});

/**
 * How a client READS an unknown value of a fail-safe additive enum: as the
 * strictest known value (null = "no value": an unknown finding response is not
 * an answer). A card carrying any such unknown value renders but is never
 * decidable (`hasUnknownFailSafeValue`). Part of clientApiId.
 */
export const FAIL_SAFE_VALUES = deepFreeze({
  'card.strictness.level': 'L3',
  'run.mode': 'manual',
  'risk.tier': 'high',
  'agentClaims.revert.how': 'manual',
  'kernel.revert.how': 'none',
  'finding.severity': 'important',
  'finding.response': null,
} as const);
export type AdditiveEnumName = keyof typeof ADDITIVE_ENUMS;

export type EnumRendering = { known: true; value: string } | { known: false; opaque: string };

/** Classify a received enum value; unknown values are kept, marked opaque. */
export function renderEnumValue(name: AdditiveEnumName, value: string): EnumRendering {
  return (ADDITIVE_ENUMS[name] as readonly string[]).includes(value)
    ? { known: true, value }
    : { known: false, opaque: value };
}

/* ── hello ────────────────────────────────────────────────────────────────── */

export interface HelloParams {
  clientApis: string[];
  features: string[];
  /**
   * T-2026-10-18-016: a fresh random value per hello (32 bytes base64url is the
   * recommended form; CLIENT_NONCE_PATTERN). The kernel echoes it and binds it
   * into serverSig, so a recorded genuine hello cannot be replayed to a
   * different connection by an impostor on a squatted endpoint.
   */
  clientNonce: string;
  client: {
    name: string;
    version: string;
    surface?: string;
    conformance?: { suite: string; version: string; reportHash: string };
  };
}

export interface HelloResult {
  clientApi: string;
  features: string[];
  nonce: string;
  /** The hello params' clientNonce, echoed; serverSig covers it (§4.9). */
  clientNonce: string;
  serverKeyId: string;
  serverSig: string;
  clientApiId: string;
  kitId: string;
}

/** A gnomon-rpc frame: JSON-RPC 2.0 + `"rpc"` (§4.9). */
export interface RpcRequestFrame<P = unknown> {
  jsonrpc: '2.0';
  rpc: string;
  id?: string | number;
  method: string;
  params?: P;
}

export const HELLO_PARAMS_KEYS = ['clientApis', 'features', 'clientNonce', 'client'] as const;
export const HELLO_CLIENT_KEYS = ['name', 'version', 'surface', 'conformance'] as const;
export const HELLO_RESULT_KEYS = ['clientApi', 'features', 'nonce', 'clientNonce', 'serverKeyId', 'serverSig', 'clientApiId', 'kitId'] as const;

/**
 * hello clientNonce (T-2026-10-18-016): unpadded base64url of 16..64 random
 * bytes (22..86 characters). Clients SHOULD send 32 bytes (CLIENT_NONCE_BYTES).
 */
export const CLIENT_NONCE_PATTERN_SOURCE = '^[A-Za-z0-9_-]{22,86}$' as const;
export const CLIENT_NONCE_PATTERN = new RegExp(CLIENT_NONCE_PATTERN_SOURCE);
export const CLIENT_NONCE_BYTES = 32 as const;

/** Server-signature domain for hello and the auth preimages (§4.9). */
export const AUTH_SERVER_DOMAIN = 'gnomon:auth-server:v2' as const;
export const AUTH_CLIENT_DOMAIN = 'gnomon:auth:v1' as const;
/** Read-token proof-of-possession domain (§4.9 read tokens, P8-D89a): never verifies as device auth, nor the reverse. */
export const AUTH_TOKEN_DOMAIN = 'gnomon:auth-token:v1' as const;

/**
 * The negotiated hello outcome every auth signature binds (M1.4 downgrade-
 * proofing, T-2026-10-17-017): a relay that rewrites the hello offer cannot
 * pick a clientApi or feature set no signature covers. The kernel signs and
 * verifies exactly these messages; there is no unbound form.
 */
export interface NegotiatedHello {
  clientApi: string;
  features: readonly string[];
}

function negotiatedLines(n: NegotiatedHello): string {
  return `\n${n.clientApi}\n${canonicalJson([...n.features])}`;
}

/**
 * serverSig message after the domain line: the server nonce, the CLIENT's
 * nonce (T-2026-10-18-016), endpoint path, the negotiated clientApi and
 * canonical features. A client verifies it with the clientNonce IT sent, never
 * the echoed one, so a recorded hello replayed to another connection fails.
 */
export function authServerMessage(nonce: string, clientNonce: string, endpointPath: string, negotiated: NegotiatedHello): string {
  return `${nonce}\n${clientNonce}\n${endpointPath}${negotiatedLines(negotiated)}`;
}

/** Device-key auth message after the domain line. */
export function authClientMessage(nonce: string, serverKeyId: string, principalId: string, deviceId: string, endpointPath: string, negotiated: NegotiatedHello): string {
  return `${nonce}\n${serverKeyId}\n${principalId}\n${deviceId}\n${endpointPath}${negotiatedLines(negotiated)}`;
}

/** Read-token auth message after the domain line: the device shape with the tokenId in the principal/device slots' place. */
export function authTokenMessage(nonce: string, serverKeyId: string, tokenId: string, endpointPath: string, negotiated: NegotiatedHello): string {
  return `${nonce}\n${serverKeyId}\n${tokenId}\n${endpointPath}${negotiatedLines(negotiated)}`;
}

export function authServerPreimage(nonce: string, clientNonce: string, endpointPath: string, negotiated: NegotiatedHello): string {
  return `${AUTH_SERVER_DOMAIN}\n${authServerMessage(nonce, clientNonce, endpointPath, negotiated)}`;
}
export function authClientPreimage(nonce: string, serverKeyId: string, principalId: string, deviceId: string, endpointPath: string, negotiated: NegotiatedHello): string {
  return `${AUTH_CLIENT_DOMAIN}\n${authClientMessage(nonce, serverKeyId, principalId, deviceId, endpointPath, negotiated)}`;
}
export function authTokenPreimage(nonce: string, serverKeyId: string, tokenId: string, endpointPath: string, negotiated: NegotiatedHello): string {
  return `${AUTH_TOKEN_DOMAIN}\n${authTokenMessage(nonce, serverKeyId, tokenId, endpointPath, negotiated)}`;
}

export function validateHelloParams(value: unknown, opts: ValidateOptions = {}): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  c.closed('', value, HELLO_PARAMS_KEYS);
  c.required('', value, HELLO_PARAMS_KEYS);
  if ('clientApis' in value && c.arr('clientApis', value.clientApis)) {
    if (value.clientApis.length === 0) c.fail('clientApis', 'must name at least one client API');
    value.clientApis.forEach((a, i) => c.str(`clientApis[${i}]`, a, /^[a-z][a-z0-9-]*:v[1-9][0-9]*$/, '<api>:v<N>'));
  }
  if ('features' in value && c.arr('features', value.features)) value.features.forEach((f, i) => c.str(`features[${i}]`, f));
  if ('clientNonce' in value) c.str('clientNonce', value.clientNonce, CLIENT_NONCE_PATTERN, 'base64url, 22..86 characters');
  if ('client' in value && c.obj('client', value.client)) {
    const cl = value.client;
    c.closed('client', cl, HELLO_CLIENT_KEYS);
    c.required('client', cl, ['name', 'version']);
    if ('name' in cl) c.str('client.name', cl.name, /^.+$/, 'non-empty');
    if ('version' in cl) c.str('client.version', cl.version, /^.+$/, 'non-empty');
    if ('surface' in cl) c.additiveEnum('client.surface', cl.surface, CLIENT_SURFACES);
    if ('conformance' in cl && c.obj('client.conformance', cl.conformance)) {
      c.required('client.conformance', cl.conformance, ['suite', 'version', 'reportHash']);
      for (const k of ['suite', 'version', 'reportHash'] as const) if (k in cl.conformance) c.str(`client.conformance.${k}`, cl.conformance[k]);
    }
  }
  return c.errors;
}

export function validateHelloResult(value: unknown, opts: ValidateOptions = {}): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  c.closed('', value, HELLO_RESULT_KEYS);
  c.required('', value, HELLO_RESULT_KEYS);
  for (const k of HELLO_RESULT_KEYS) {
    if (k === 'features') {
      if (k in value && c.arr(k, value[k])) (value[k] as unknown[]).forEach((f, i) => c.str(`features[${i}]`, f));
    } else if (k in value) c.str(k, value[k], /^.+$/, 'non-empty');
  }
  if (typeof value.clientApi === 'string' && !CLIENT_API_PATTERN.test(value.clientApi)) c.fail('clientApi', 'must be gnomon-rpc:v<N>');
  if (typeof value.clientNonce === 'string' && !CLIENT_NONCE_PATTERN.test(value.clientNonce)) c.fail('clientNonce', 'must be base64url, 22..86 characters');
  return c.errors;
}

function apiVersion(api: string): number {
  const m = CLIENT_API_PATTERN.exec(api);
  return m ? Number(m[1]) : -1;
}

export type HelloNegotiation =
  | { ok: true; clientApi: string; features: string[] }
  | { ok: false; refusal: Refusal };

/**
 * Kernel-side negotiation (§4.9): choose the HIGHEST gnomon-rpc version both
 * sides speak; features = the intersection, in the server's order. A client
 * naming none the kernel speaks ⇒ `UNSUPPORTED{data:{offered[]}}`.
 */
export function negotiateHello(
  hello: Pick<HelloParams, 'clientApis' | 'features'>,
  serverApis: readonly string[] = [GNOMON_RPC_V1],
  serverFeatures: readonly string[] = [],
): HelloNegotiation {
  const shared = hello.clientApis.filter((a) => serverApis.includes(a) && apiVersion(a) > 0);
  if (shared.length === 0) {
    return { ok: false, refusal: refuse({ code: 'UNSUPPORTED', data: { offered: [...hello.clientApis] } }) };
  }
  const clientApi = shared.reduce((best, a) => (apiVersion(a) > apiVersion(best) ? a : best));
  const features = serverFeatures.filter((f) => hello.features.includes(f));
  return { ok: true, clientApi, features };
}
