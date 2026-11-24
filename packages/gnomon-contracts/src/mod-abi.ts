/**
 * `mod-abi:v1` (spec §12.3, §10 law 3) and its identity `modAbiId`.
 *
 * THE SURFACE (enumerated from §12.3's table, ≤ 8 RPCs + lifecycle + 2 relays):
 *   lifecycle (host → mod): `init{abi, features}` → `{abi, features, modAbiId}`,
 *     `shutdown`, `cancel{cancelToken}` (a notification naming an in-flight
 *     `view.render` / `tool.call`; honoured within its timeout or the child is
 *     restarted).
 *   the eight RPCs:
 *     1 `health`                       host → mod   liveness + abi echo
 *     2 `view.render{viewId, input, width, prefs, cancelToken, relayedFor?}` host → mod   pure render → display-block:v1
 *     3 `command.run{commandId, args, relayedFor?}`  host → mod   user command
 *     4 `tool.call{name, input, cancelToken, relayedFor?}` host → mod   agent tool; effects enforced by the host
 *     5 `event{event}`                 host → mod   filtered feed (a notification)
 *     6 `state.get{key}`               mod → host   per-mod KV (effect `read`)
 *     7 `state.set{key, value}`        mod → host   per-mod KV (effect `write`)
 *     8 `kernel.call{verb, params}`    mod → host   proxied kernel verb; `approve` never proxied
 *   the two client relays (client → host → mod): `mod.view`, `mod.command`
 *     (CLIENT_RELAYS, rpc.ts — shared, so the two ids agree on them).
 *
 * §12.3 lists `state.get` / `state.set` in one row; counted here as two RPCs
 * (six table rows + the split = 8), which is the reading that makes "≤ 8"
 * exact. `relayedFor` is a HOST-STAMPED top-level param whose fields are fixed
 * per method (RELAYED_FOR_FIELDS, S1.2 C2): `view.render` {principal, connId};
 * `command.run` adds `surface` (gui | cli); `tool.call` carries {principal,
 * surface (bridge | voice), agent} and, only for a first-party mod or one
 * granted `log.read`, {hsid, turn}. It is absent when the host itself renders
 * or runs (fixtures, Tier 0 templates). The host writes the SAME object into
 * the reserved payload key `relayedFor` of every row the mod appends inside
 * that call and removes a mod-supplied one (S1.2 C1). `pickRelayedFor` is the
 * one builder. Adding these moved modAbiId once (S1.2); clientApiId unchanged.
 *
 * CALL-ID BINDING (M1.11 slice 2, Aegis): every host → mod `view.render`,
 * `command.run` and `tool.call` carries a host-minted `callId`; a mod → host
 * request made on behalf of that call ECHOES it (the SDK does so for the api
 * it hands each handler). The host judges the request against THAT call's
 * effects only while the call is in force: a `callId` naming another or an
 * ended call is refused (FORBIDDEN, data.modCode `CALL`); a request without
 * one is judged as idle (`read` only, which only narrows). Adding `callId`
 * moved modAbiId (a mod-RPC change moves only modAbiId, §12.3) — clientApiId
 * is unchanged.
 *
 * WIRE: JSON-RPC 2.0, one object per `\n`-terminated line on the child's
 * stdin (host → mod) and stdout (mod → host); stderr is the child's log,
 * captured by the host as a tail (`gnomon mod inspect`, §12.4).
 *
 * IDENTITY (§12.3, A24-2):
 *   modAbiId = "sha256:" + hex(sha256(canonicalJson(MOD_ABI_DESCRIPTOR) + "\n" + kitId))
 * — the same "‖ kitId" reading as clientApiId (client-api.ts). modAbiId is
 * NOT an input of clientApiId and this descriptor is NOT in CONTRACT_SCHEMAS,
 * so a mod-RPC change moves only modAbiId; a kit change moves both.
 */
import { canonicalJson, deepFreeze, hex, sha256 } from './internal.js';
import { CLIENT_RELAYS } from './rpc.js';
import { computeKitId } from './client-api.js';

export const MOD_ABI_V1 = 'mod-abi:v1' as const;

export type ModAbiDirection = 'host->mod' | 'mod->host';
export type ModEffect = 'read' | 'write' | 'network' | 'spend';
export const MOD_EFFECTS: readonly ModEffect[] = Object.freeze(['read', 'write', 'network', 'spend'] as const);

export interface ModRpcDescriptor {
  method: string;
  direction: ModAbiDirection;
  /** a request expects a result; a notification carries no id and gets none */
  form: 'request' | 'notification';
  params: readonly string[];
  result: readonly string[];
  /** the effect a mod → host call draws (the host checks it against the declared set); null for host → mod */
  effect: ModEffect | 'by-verb' | null;
}

export const MOD_ABI_LIFECYCLE: readonly ModRpcDescriptor[] = deepFreeze([
  { method: 'init', direction: 'host->mod', form: 'request', params: ['abi', 'features'], result: ['abi', 'features', 'modAbiId'], effect: null },
  { method: 'shutdown', direction: 'host->mod', form: 'request', params: [], result: [], effect: null },
  { method: 'cancel', direction: 'host->mod', form: 'notification', params: ['cancelToken'], result: [], effect: null },
] satisfies ModRpcDescriptor[]);

export const MOD_ABI_RPCS: readonly ModRpcDescriptor[] = deepFreeze([
  { method: 'health', direction: 'host->mod', form: 'request', params: [], result: ['ok', 'abi'], effect: null },
  { method: 'view.render', direction: 'host->mod', form: 'request', params: ['viewId', 'input', 'width', 'prefs', 'cancelToken', 'callId', 'relayedFor'], result: ['block'], effect: null },
  { method: 'command.run', direction: 'host->mod', form: 'request', params: ['commandId', 'args', 'callId', 'relayedFor'], result: ['result'], effect: null },
  { method: 'tool.call', direction: 'host->mod', form: 'request', params: ['name', 'input', 'cancelToken', 'callId', 'relayedFor'], result: ['result'], effect: null },
  { method: 'event', direction: 'host->mod', form: 'notification', params: ['event'], result: [], effect: null },
  { method: 'state.get', direction: 'mod->host', form: 'request', params: ['key', 'callId'], result: ['value'], effect: 'read' },
  { method: 'state.set', direction: 'mod->host', form: 'request', params: ['key', 'value', 'callId'], result: [], effect: 'write' },
  { method: 'kernel.call', direction: 'mod->host', form: 'request', params: ['verb', 'params', 'callId'], result: ['result'], effect: 'by-verb' },
] satisfies ModRpcDescriptor[]);

/** Law 3 (§10): ≤ 8 RPCs. A test holds this bound. */
export const MOD_ABI_MAX_RPCS = 8;

/** Kernel verbs a mod may never reach through `kernel.call` (§12.3). */
export const MOD_NEVER_PROXIED = Object.freeze(['approve'] as const);

/** §12.2 block limits: a block over either is refused BAD_REQUEST. */
export const MOD_BLOCK_LIMITS = deepFreeze({ maxBytes: 256 * 1024, maxNodes: 2_000 });

/** `mod.view` → `view.render`: {principal, connId}. `mod.command` → `command.run`: plus `surface`. */
export interface RelayedFor {
  principal: string;
  connId: string;
  surface?: 'gui' | 'cli';
}
/** `tool.call` only. Never sent on `view.render` or `command.run`. */
export interface ToolRelayedFor {
  /** the calling session's principal */
  principal: string;
  /** `voice` is derived by the host from the cause turn's source */
  surface: 'bridge' | 'voice';
  /** the host-known label of the session's agent; never a nickname the agent chose, never tool input */
  agent: string;
  /** only for a first-party mod or one granted `log.read` */
  hsid?: string;
  turn?: string;
}

/** The fields `relayedFor` may carry, per host → mod method (CLOSED). */
export const RELAYED_FOR_FIELDS = deepFreeze({
  'view.render': ['principal', 'connId'],
  'command.run': ['principal', 'connId', 'surface'],
  'tool.call': ['principal', 'surface', 'agent', 'hsid', 'turn'],
} as const);
export type RelayedForMethod = keyof typeof RELAYED_FOR_FIELDS;
/** The identity fields, and who may receive them: a `gnomon`-published mod, or one granted `log.read`. */
export const RELAYED_FOR_IDENTITY = deepFreeze({ fields: ['hsid', 'turn'], onlyFor: ['first-party', 'log.read'] } as const);
/** The `surface` values each method may carry. */
export const RELAYED_FOR_SURFACES = deepFreeze({ 'command.run': ['gui', 'cli'], 'tool.call': ['bridge', 'voice'] } as const);
/** The reserved payload key of a mod's appended row that only the host writes. */
export const RELAYED_FOR_APPEND_KEY = 'relayedFor' as const;
/** No relayedFor value is longer than this; a longer one is dropped (the row cap is measured after stamping). */
export const RELAYED_FOR_VALUE_MAX = 256;

/**
 * THE one builder of a `relayedFor` the host sends and stamps. From host-known `raw` it keeps only the method's
 * fields, only non-empty strings of bounded length, drops `hsid` and `turn` unless `identity` is true, and drops a
 * `surface` the method may not carry. It never invents a value: a field the host does not know is absent (a row
 * stamped without `principal` or `surface` then folds as the unknown hand, never as human).
 */
export function pickRelayedFor(method: RelayedForMethod, raw: Readonly<Record<string, unknown>> | null | undefined, identity: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  const surfaces: readonly string[] = method === 'view.render' ? [] : RELAYED_FOR_SURFACES[method];
  for (const f of RELAYED_FOR_FIELDS[method] as readonly string[]) {
    if (!identity && (RELAYED_FOR_IDENTITY.fields as readonly string[]).includes(f)) continue;
    const v = Object.prototype.hasOwnProperty.call(raw, f) ? (raw as Record<string, unknown>)[f] : undefined;
    if (typeof v !== 'string' || v.length === 0 || v.length > RELAYED_FOR_VALUE_MAX) continue;
    if (f === 'surface' && !surfaces.includes(v)) continue;
    out[f] = v;
  }
  return out;
}

export const MOD_ABI_DESCRIPTOR = deepFreeze({
  schemaVersion: MOD_ABI_V1,
  wire: 'jsonrpc-2.0 ndjson over stdio',
  lifecycle: MOD_ABI_LIFECYCLE,
  rpcs: MOD_ABI_RPCS,
  relays: CLIENT_RELAYS,
  effects: MOD_EFFECTS,
  neverProxied: MOD_NEVER_PROXIED,
  blockLimits: MOD_BLOCK_LIMITS,
  relayedFor: { fields: RELAYED_FOR_FIELDS, identity: RELAYED_FOR_IDENTITY, surfaces: RELAYED_FOR_SURFACES, appendKey: RELAYED_FOR_APPEND_KEY, valueMax: RELAYED_FOR_VALUE_MAX },
});

export function computeModAbiId(descriptor: unknown = MOD_ABI_DESCRIPTOR, kitId: string = computeKitId()): string {
  return `sha256:${hex(sha256(`${canonicalJson(descriptor)}\n${kitId}`))}`;
}

/** Frozen per release; reported by `status` (§5) and echoed by a mod's `init`. */
export const MOD_ABI_ID: string = computeModAbiId();
