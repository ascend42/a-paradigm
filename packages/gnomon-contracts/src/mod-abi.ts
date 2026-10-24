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
 *     4 `tool.call{name, input, cancelToken}`        host → mod   agent tool; effects enforced by the host
 *     5 `event{event}`                 host → mod   filtered feed (a notification)
 *     6 `state.get{key}`               mod → host   per-mod KV (effect `read`)
 *     7 `state.set{key, value}`        mod → host   per-mod KV (effect `write`)
 *     8 `kernel.call{verb, params}`    mod → host   proxied kernel verb; `approve` never proxied
 *   the two client relays (client → host → mod): `mod.view`, `mod.command`
 *     (CLIENT_RELAYS, rpc.ts — shared, so the two ids agree on them).
 *
 * §12.3 lists `state.get` / `state.set` in one row; counted here as two RPCs
 * (six table rows + the split = 8), which is the reading that makes "≤ 8"
 * exact. `relayedFor{principal, connId}` is a top-level param of the two
 * relayed host→mod calls (§12.2 "every input a view or command receives from
 * a client carries the host-stamped relayedFor"); absent when the host itself
 * renders (fixtures, Tier 0 templates).
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
  { method: 'tool.call', direction: 'host->mod', form: 'request', params: ['name', 'input', 'cancelToken', 'callId'], result: ['result'], effect: null },
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

export interface RelayedFor {
  principal: string;
  connId: string;
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
  relayedFor: ['principal', 'connId'],
});

export function computeModAbiId(descriptor: unknown = MOD_ABI_DESCRIPTOR, kitId: string = computeKitId()): string {
  return `sha256:${hex(sha256(`${canonicalJson(descriptor)}\n${kitId}`))}`;
}

/** Frozen per release; reported by `status` (§5) and echoed by a mod's `init`. */
export const MOD_ABI_ID: string = computeModAbiId();
