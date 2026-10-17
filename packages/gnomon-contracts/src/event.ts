/**
 * event:v1 — the kernel log envelope (spec §4.1) and the kind registry with
 * per-kind default labels (§9.1, §3.2 L6, S32 §6).
 *
 * Labels: `audience` ∈ private|team|org (default private), `sensitivity` ∈
 * normal|sensitive|secret (default = the §9.1 column for the kind). Both are
 * set by the APPENDING COMPONENT at append, never by the payload's author, and
 * never relaxed in place (L6). `defaultLabelsFor(kind)` is the one lookup.
 *
 * The registry is closed per namespace; new kinds are additive (§4.9). A
 * client renders an unknown kind opaquely as `{kind, principal, at}`
 * (`opaqueEventView`), never drops it.
 */

import { Checker, ISO_DATE_TIME, SHA256_TAGGED, type ValidateOptions } from './internal.js';
import { ID_PATTERNS, HSID_PATTERN, KEY_ID_PATTERN, REPO_SCOPE_PATTERN, CONTRACT_ID_PATTERN } from './ids.js';
import { ANY_PRINCIPAL_PATTERN, DEVICE_ID_PATTERN } from './principal.js';
import { validateRefV1 } from './ref.js';

export const EVENT_V1 = 'event:v1' as const;

export const AUDIENCES = ['private', 'team', 'org'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const SENSITIVITIES = ['normal', 'sensitive', 'secret'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
export const DEFAULT_AUDIENCE: Audience = 'private';

/** session.inject origins (§3.2 L2, §9.1); `peer` reserved M1.1 (P8-R9). Additive. */
export const INJECT_ORIGINS = ['kernel', 'client', 'peer'] as const;

export type KindOwner = 'kernel' | 'userland';

export interface EventKindSpec {
  kind: string;
  owner: KindOwner;
  sensitivity: Sensitivity;
  /** payload fields carrying a stricter label than the event (§9.1 / §9.3). */
  fieldLabels?: Readonly<Record<string, Sensitivity>>;
  /** release the value was reserved for (one release ahead, §4.9 / A26-11). */
  reserved?: 'M1.1:P8-D58' | 'M1.1:P8-R9';
}

const D58 = 'M1.1:P8-D58' as const;
const R9 = 'M1.1:P8-R9' as const;

type Row = [ns: string, owner: KindOwner, kinds: string, reserved?: typeof D58 | typeof R9];

/** §9.1, namespace by namespace. Kinds are the names before `{…}`. */
const TABLE: Row[] = [
  // daemon.anchor.lag{rows, which}: research 33 S33-07 (P8-D82) — keystore anchor lag > 1023 on open.
  ['daemon', 'kernel', 'start exit lock.refused segment reexec anchor.lag'],
  [
    'socket',
    'kernel',
    'connect hello auth.ok auth.fail auth.theft auth.replay auth.reconnect.requested web.listen web.bundle.mismatch web.linger web.stop web.transport.exited gui.token.issued gui.session.ended subscription.dropped frame.dropped frame.refused',
  ],
  ['key', 'kernel', 'mint rotate registry.malformed registry.unsigned device.added device.revoked keystore.unavailable'],
  ['config', 'kernel', 'loaded unsigned prefs ignored'],
  [
    'session',
    'kernel',
    'open alias alias.rejected refused spawned inject tainted idle respawn exited orphaned routed sandbox layers.changed',
  ],
  ['turn', 'kernel', 'sent event usage result partial steer ask-user plan'],
  // §9.1 lists permit/budget as one row; split by the names the spec uses
  // elsewhere (permit.grant §3.3 S1, budget.usage §3.3 S3).
  ['permit', 'kernel', 'reserve grant deny release'],
  ['budget', 'kernel', 'usage ladder pause resume breaker.open breaker.close compute window'],
  ['billing', 'kernel', 'api.card.requested api.active api.ended api.refused'],
  ['approval', 'kernel', 'request decide unlock unlock.dropped presence.denied expire rule.learned suspect'],
  [
    'approval',
    'kernel',
    'voice.arm voice.disarm voice.intent voice.held voice.withdrawn voice.refused voice.policy.narrowed voice.handle.rotated',
    D58,
  ],
  ['request', 'kernel', 'grant voice.arm voice.narrow', D58],
  ['request', 'kernel', 'brief.send cowork.allow link.revoke', R9],
  [
    'link',
    'kernel',
    'pair.offered paired renewed revoked expired connect disconnect auth.fail frame.refused paused rate relay.unreachable msg.in msg.out brief.drafted brief.sent brief.received brief.accepted brief.declined brief.expired declassified scan.hit egress.refused',
    R9,
  ],
  ['manifest', 'kernel', 'load refuse widened generate staged installed uninstall'],
  ['schedule', 'kernel', 'due dropped tend.start tend.end automation.due'],
  ['model', 'kernel', 'capabilities probe repair fallback.requested fallback.decided'],
  [
    'mod',
    'kernel',
    'installed rolled-back health effect.refused view.rendered stopped sandbox linked snapshot.refused paused repinned dev.expired unlinked',
  ],
  [
    'voice',
    'userland',
    'session.start turn.user turn.agent deck focus tts.filtered bargein session.end share enrol forget',
  ],
  ['contract', 'kernel', 'registered claim claimed released built knot progress'],
  ['oracle', 'kernel', 'run result'],
  ['warpline', 'kernel', 'pick admit knot resolve selvage.moved'],
  ['merge', 'kernel', 'tree conflict ci landed'],
  ['gate-class', 'kernel', 'detected decided'],
  ['inject', 'userland', 'receipt'],
  ['paradigm', 'userland', 'doodle.exported event'],
  ['detector', 'userland', 'event'],
  ['loop', 'userland', 'open row closed'],
  ['loop', 'kernel', 'paused'],
  ['tend', 'userland', 'digest proposal.fate teacher.drafted'],
  ['decay', 'userland', 'writeback'],
  ['calibration', 'userland', 'contested reviewer'],
  ['verdict', 'kernel', 'founder'],
  ['liveness', 'kernel', 'violation digest.consumed'],
  ['flow', 'userland', 'event'],
  ['neurons', 'userland', 'event'],
  // Standalone kernel-owned kinds named in §3.2 L5 and §5.
  ['blob', 'kernel', 'pruned'],
  ['digest', 'kernel', 'consumed'],
];

/** Per-kind sensitivity overrides from §9.1's last column. */
const SENSITIVE_KINDS: Record<string, Sensitivity> = {
  'session.inject': 'sensitive',
  'turn.event': 'sensitive',
  'voice.turn.user': 'sensitive',
  'voice.turn.agent': 'sensitive',
  // "voiceprints secret (§14.4)": the enrol row is the one that carries the print reference.
  'voice.enrol': 'secret',
};

/** Field-level labels stricter than the event's (§9.1 / §9.3 redaction matrix). */
const FIELD_LABELS: Record<string, Record<string, Sensitivity>> = {
  'approval.request': { tool_input: 'sensitive' },
  'oracle.result': { evidence: 'sensitive' },
  'voice.turn.user': { audioRef: 'sensitive' },
};

function build(): Readonly<Record<string, EventKindSpec>> {
  const out: Record<string, EventKindSpec> = {};
  for (const [ns, owner, kinds, reserved] of TABLE) {
    for (const k of kinds.split(/\s+/)) {
      const kind = `${ns}.${k}`;
      if (out[kind]) throw new Error(`duplicate kind ${kind}`);
      out[kind] = Object.freeze({
        kind,
        owner,
        sensitivity: SENSITIVE_KINDS[kind] ?? 'normal',
        ...(FIELD_LABELS[kind] ? { fieldLabels: Object.freeze({ ...FIELD_LABELS[kind] }) } : {}),
        ...(reserved ? { reserved } : {}),
      });
    }
  }
  return Object.freeze(out);
}

/** The frozen kind registry (§9.1). */
export const EVENT_KINDS: Readonly<Record<string, EventKindSpec>> = build();
export const EVENT_KIND_NAMES: readonly string[] = Object.freeze(Object.keys(EVENT_KINDS).sort());

/**
 * Userland namespaces whose kinds the spec does not enumerate (§5, §9.1:
 * `credit{outcome}`, `broke{class}`, mod kinds): any kind under them is valid
 * and labelled `normal` unless the granting manifest declares otherwise.
 * `modns.<name>.*` labels come from the mod's manifest per kind (§9.1).
 */
export const OPEN_USERLAND_NAMESPACES = ['credit', 'broke', 'modns'] as const;

export const KIND_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const MODNS_KIND_PATTERN = /^modns\.[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

export function isKnownKind(kind: string): boolean {
  if (EVENT_KINDS[kind]) return true;
  if (MODNS_KIND_PATTERN.test(kind)) return true;
  return OPEN_USERLAND_NAMESPACES.some((ns) => ns !== 'modns' && kind.startsWith(`${ns}.`) && KIND_PATTERN.test(kind));
}

export function kindOwner(kind: string): KindOwner | undefined {
  if (EVENT_KINDS[kind]) return EVENT_KINDS[kind]!.owner;
  return isKnownKind(kind) ? 'userland' : undefined;
}

export interface EventLabels {
  audience: Audience;
  sensitivity: Sensitivity;
}

/**
 * Default labels for a kind (S32 §6). Returns undefined for an unregistered
 * kind — "a kind missing from the table fails CI", so the kernel must refuse
 * to append it rather than guess `normal`. `manifestSensitivity` is the label a
 * mod manifest declares for a `modns.*` kind.
 */
export function defaultLabelsFor(kind: string, manifestSensitivity?: Sensitivity): EventLabels | undefined {
  const spec = EVENT_KINDS[kind];
  if (spec) return { audience: DEFAULT_AUDIENCE, sensitivity: spec.sensitivity };
  if (!isKnownKind(kind)) return undefined;
  return { audience: DEFAULT_AUDIENCE, sensitivity: manifestSensitivity ?? 'normal' };
}

/* ── envelope ─────────────────────────────────────────────────────────────── */

export interface EventScopeV1 {
  /** reserved (Q4): always null in 8.0. */
  org: null;
  team: null;
  repo?: string;
  loop?: string;
  contract?: string;
}

export interface EventV1<P = unknown> {
  schemaVersion: typeof EVENT_V1;
  id: string;
  log: string;
  seq: number;
  at: string;
  principal: string;
  keyId?: string;
  deviceId?: string;
  connId?: string;
  idem?: string;
  session?: string;
  scope?: EventScopeV1;
  audience: Audience;
  sensitivity: Sensitivity;
  kind: string;
  causes?: string[];
  payload?: P;
  ref?: string;
  refHash?: string;
  prev: string;
  hash: string;
  sig?: string;
}

export const EVENT_V1_KEYS = [
  'schemaVersion',
  'id',
  'log',
  'seq',
  'at',
  'principal',
  'keyId',
  'deviceId',
  'connId',
  'idem',
  'session',
  'scope',
  'audience',
  'sensitivity',
  'kind',
  'causes',
  'payload',
  'ref',
  'refHash',
  'prev',
  'hash',
  'sig',
] as const;
export const EVENT_V1_REQUIRED = [
  'schemaVersion',
  'id',
  'log',
  'seq',
  'at',
  'principal',
  'audience',
  'sensitivity',
  'kind',
  'prev',
  'hash',
] as const;
export const EVENT_SCOPE_KEYS = ['org', 'team', 'repo', 'loop', 'contract'] as const;

const LOOP_ID = /^loop:.+$/;

/**
 * Validate an event:v1 envelope. Strict additionally requires a registered
 * kind and — when `checkDefaultLabels` is set — that the labels are no looser
 * than the kind's default (L6: a component may tighten, never relax).
 */
export function validateEventV1(
  value: unknown,
  opts: ValidateOptions & { checkDefaultLabels?: boolean } = {},
): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, EVENT_V1_KEYS);
  c.required('', v, EVENT_V1_REQUIRED);
  if ('schemaVersion' in v && v.schemaVersion !== EVENT_V1) c.fail('schemaVersion', `must be ${EVENT_V1}`);
  if ('id' in v) c.str('id', v.id, ID_PATTERNS.ev, 'ev:<ULID>');
  if ('log' in v) c.str('log', v.log, ID_PATTERNS.log, 'log:<ULID>');
  if ('seq' in v) c.int('seq', v.seq, 1);
  if ('at' in v) c.str('at', v.at, ISO_DATE_TIME, 'an ISO-8601 date-time');
  if ('principal' in v) c.str('principal', v.principal, ANY_PRINCIPAL_PATTERN, 'p:<ns>/<name>[@<rootKeyId8>]');
  if ('keyId' in v) c.str('keyId', v.keyId, KEY_ID_PATTERN, 'a keyId');
  if ('deviceId' in v) c.str('deviceId', v.deviceId, DEVICE_ID_PATTERN, 'dev:<ns>/<host>');
  if ('connId' in v) c.str('connId', v.connId, ID_PATTERNS.conn, 'conn:<ULID>');
  if ('idem' in v) c.str('idem', v.idem, SHA256_TAGGED, 'sha256:<hex>');
  if ('session' in v) c.str('session', v.session, HSID_PATTERN, 'an hsid');
  if ('scope' in v && c.obj('scope', v.scope)) {
    const s = v.scope;
    c.closed('scope', s, EVENT_SCOPE_KEYS);
    c.required('scope', s, ['org', 'team']);
    if ('org' in s && s.org !== null) c.fail('scope.org', 'reserved: must be null');
    if ('team' in s && s.team !== null) c.fail('scope.team', 'reserved: must be null');
    if ('repo' in s) c.str('scope.repo', s.repo, REPO_SCOPE_PATTERN, 'repo:<16 hex>');
    if ('loop' in s) c.str('scope.loop', s.loop, LOOP_ID, 'loop:<id>');
    if ('contract' in s) c.str('scope.contract', s.contract, CONTRACT_ID_PATTERN, 'contract:v1:<64 hex>');
  }
  if ('audience' in v) c.closedEnum('audience', v.audience, AUDIENCES);
  if ('sensitivity' in v) c.closedEnum('sensitivity', v.sensitivity, SENSITIVITIES);
  if ('kind' in v && c.str('kind', v.kind, KIND_PATTERN, 'a dotted kind')) {
    if (c.mode === 'strict' && !isKnownKind(v.kind)) c.fail('kind', `unregistered kind ${v.kind}`);
    if (opts.checkDefaultLabels && typeof v.sensitivity === 'string') {
      const d = defaultLabelsFor(v.kind);
      const order = SENSITIVITIES as readonly string[];
      if (d && order.indexOf(v.sensitivity) < order.indexOf(d.sensitivity)) {
        c.fail('sensitivity', `looser than the ${v.kind} default (${d.sensitivity})`);
      }
    }
  }
  if ('causes' in v && c.arr('causes', v.causes)) {
    v.causes.forEach((r, i) => {
      for (const e of validateRefV1(r, { mode: c.mode })) c.fail(`causes[${i}]`, e);
    });
  }
  if ('ref' in v) for (const e of validateRefV1(v.ref, { mode: c.mode })) c.fail('ref', e);
  if ('refHash' in v) c.str('refHash', v.refHash, SHA256_TAGGED, 'sha256:<hex>');
  if ('prev' in v) c.str('prev', v.prev, SHA256_TAGGED, 'sha256:<hex>');
  if ('hash' in v) c.str('hash', v.hash, SHA256_TAGGED, 'sha256:<hex>');
  if ('sig' in v) c.str('sig', v.sig, /^.+$/, 'a non-empty string');
  return c.errors;
}

export function isEventV1(value: unknown, opts: ValidateOptions = {}): value is EventV1 {
  return validateEventV1(value, opts).length === 0;
}

/** How a client shows a kind it does not know (§4.9): opaque, never dropped. */
export function opaqueEventView(e: Pick<EventV1, 'kind' | 'principal' | 'at'>): {
  kind: string;
  principal: string;
  at: string;
} {
  return { kind: e.kind, principal: e.principal, at: e.at };
}
