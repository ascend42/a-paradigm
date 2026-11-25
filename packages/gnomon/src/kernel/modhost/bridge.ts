/**
 * @symbol #mod-host
 *
 * The daemon side of #mod-host (spec §5, §12.3; M1.11 slice 2): the two
 * ports that connect a ModHost to the kernel.
 *
 * `createModKernelCall` — `kernel.call{verb, params}` from a mod, AFTER the
 * host's slice-1 rules (host.ts: `approve` never proxied, a verb outside the
 * explicit MOD_VERB_EFFECTS table refused, the effect checked against the
 * bound call, log.append only of the mod's own DECLARED `modns.<name>.*`,
 * session.send pinned to the caller's hsid with `permitId` stripped):
 *   - `log.append` is the §5 mod cell "modns.<name>.* only", which the socket
 *     gate (socket/log-append.ts) leaves to the mod host. The row is written
 *     under the MOD's principal with the fields CLAMPED (Aegis C2): only
 *     `kind`, `payload` (a plain object, canonical JSON ≤ MOD_APPEND_MAX_BYTES)
 *     and the two labels `audience` / `sensitivity` (enum values only; the
 *     log keeps them tighten-only, L6) pass; `scope`, `causes`, `ref`,
 *     `refHash`, `idem`, `session`, `connId`, `deviceId` and `principal` are
 *     never mod-supplied and are dropped. manifest:v1 declares no per-kind
 *     labels, so the §9.1 default for the kind applies unless the mod
 *     tightens it.
 *   - every other verb goes to the REAL dispatcher run as the mod principal
 *     (`callAs`, socket/dispatch.ts): the §5 mod column decides (status =
 *     own view; log.read = own modns through readerFor; ref.resolve; the
 *     session.send cell needs session principals, M1.7, and refuses so).
 *
 * APPEND BUDGET (Aegis F2): per mod, at most MOD_APPEND_ROWS_PER_SEC rows in
 * any 1 s window and MOD_APPEND_BYTES_PER_CALL payload bytes per bound call
 * (the callId; requests with none share a per-second idle window). The host
 * additionally caps a mod's in-flight mod → host requests (host.ts
 * MAX_MOD_HOST_INFLIGHT).
 *
 * HUMAN RESERVE (S1.4, Aegis A4; G-MOD-21), generic to every mod: of those
 * rows at most MOD_APPEND_TOOL_ROWS_PER_SEC may come from a call that is not
 * a command (`callKind`, set by the host from the bound call context, never
 * by the mod). Tool rows and command rows share the one window and the one
 * total, so commands always keep MOD_APPEND_ROWS_PER_SEC −
 * MOD_APPEND_TOOL_ROWS_PER_SEC rows a second however many tool calls append.
 *
 * A BUDGET REFUSAL IS A DEFINITE "NOT WRITTEN" (Aegis A4): beyond any of the
 * three budgets the append is refused APPEND_BUDGET (BAD_REQUEST, the route
 * LOG had) with `budget` one of `rows`, `tool-rows` or `bytes`, `written:
 * false`, and for the two row budgets `retryAfterMs`. It is decided before the
 * log is touched, so a mod may keep its fold and try again; every other
 * failure of a `log.append` (an error from the log, a lost reply, a timeout)
 * leaves the mod unable to tell whether the row landed.
 *
 * SIGNER (B1): the row is appended as a USERLAND row (`as: 'userland'`, L7 —
 * modns.* is userland-owned) under the MOD's principal and is signed by the
 * kernel key as an attestation that the kernel accepted a mod-originated
 * row. Readers and verifiers attribute it by `principal`, never by keyId.
 *
 * `createModRelayPort` — the client relays `mod.view` / `mod.command`
 * (§12.3) served for the dispatcher: admission is ModHost.admit (F1: an
 * uninstalled name is refused without loadMod, a paused one from memory, a
 * mod out of restarts is DOWN, relay starts count against RESTART_CAP), and
 * `relayedFor` comes from the dispatcher — the caller's authenticated
 * connection — never the input.
 */
import { canonicalJson, AUDIENCES, RELAYED_FOR_APPEND_KEY, SENSITIVITIES } from '@a-company/gnomon-contracts';
import type { CallStamp } from './effects.js';
import { ownsModKind } from '../manifest/mod-kind.js';
import type { ModHost, KernelCallRequest, RenderResult } from './host.js';
import { ModRefusal } from './refusal.js';

/** A mod-appended payload's cap (canonical JSON bytes). */
export const MOD_APPEND_MAX_BYTES = 16 * 1024;

/** Aegis F2: per-mod append budget. */
export const MOD_APPEND_ROWS_PER_SEC = 20;
export const MOD_APPEND_BYTES_PER_CALL = 64 * 1024;
/**
 * S1.4 (Aegis A4; G-MOD-21): the share of MOD_APPEND_ROWS_PER_SEC that calls other than commands may use, per mod
 * and per 1 s window. The rest is the human reserve: commands keep 15 rows a second.
 */
export const MOD_APPEND_TOOL_ROWS_PER_SEC = 5;
/** The window both row budgets are counted in. */
export const MOD_APPEND_WINDOW_MS = 1_000;
/** The `budget` values of an APPEND_BUDGET refusal. */
export const MOD_APPEND_BUDGETS = Object.freeze(['rows', 'tool-rows', 'bytes'] as const);
export type ModAppendBudget = (typeof MOD_APPEND_BUDGETS)[number];

/** An APPEND_BUDGET refusal: `written: false` is the contract (nothing was appended and nothing was tried). */
function budgetRefusal(name: string, budget: ModAppendBudget, message: string, retryAfterMs?: number): ModRefusal {
  return new ModRefusal('APPEND_BUDGET', message, { name, budget, written: false, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
}

/** The append fields a mod may supply; every other field is dropped (Aegis C2). */
export const MOD_APPEND_FIELDS = Object.freeze(['kind', 'payload', 'audience', 'sensitivity'] as const);

export interface ModAppendRow {
  kind: string;
  principal: string;
  payload: Record<string, unknown>;
  audience?: (typeof AUDIENCES)[number];
  sensitivity?: (typeof SENSITIVITIES)[number];
  /** HOST-ONLY (S1.2 C1): the turn that caused an entitled tool call. Never a mod-supplied field (MOD_APPEND_FIELDS). */
  causes?: string[];
  /**
   * HOST-ONLY (S1.3, Aegis A4): the repo scope of the session a first-party command was focused on, for the row's
   * ENVELOPE `scope` (the daemon writes `{org: null, team: null, repo}`). Only from the call's stamp: a mod-supplied
   * `scope` is not in MOD_APPEND_FIELDS and is never read.
   */
  scope?: { repo: string };
}

export interface ModKernelPorts {
  /** the socket dispatcher run as the mod principal (no connection) */
  callAs(principal: string, verb: string, params: Record<string, unknown>): Promise<unknown>;
  /** append one row as the mod principal; resolves the row's seq */
  append(row: ModAppendRow): Promise<{ seq: number }>;
}

/** G-MOD-18: own keys a mod payload may not hold at any depth (JSON.parse makes an OWN `__proto__` key). */
export const MOD_PAYLOAD_PROTOTYPE_KEYS: readonly string[] = Object.freeze(['__proto__', 'constructor', 'prototype']);
/** G-MOD-18: the deepest container a mod payload may nest (the payload's own keys are depth 1). */
export const MOD_PAYLOAD_MAX_DEPTH = 32;
/** G-MOD-18: object keys plus array elements the walk visits before it refuses. */
export const MOD_PAYLOAD_MAX_VISITED = 4_096;

/**
 * Aegis S1.3 A7 (G-MOD-18): REFUSE (never drop) an own key `__proto__`, `constructor` or `prototype` at any depth of
 * a mod payload, arrays included. A stored own `__proto__` key would become the prototype of any reader that assigns
 * the payload, or a part of it, onto an object. The walk is iterative (no recursion a deep payload could exhaust),
 * reads only own enumerable keys and array indexes, and refuses beyond MOD_PAYLOAD_MAX_DEPTH or
 * MOD_PAYLOAD_MAX_VISITED, so it is bounded whatever the mod sends. It runs before any copy or canonicalisation.
 * The refusal never echoes a mod-supplied key or value.
 */
export function checkModPayloadKeys(payload: Record<string, unknown>, at: { name: string; kind: string }): void {
  const stack: Array<{ v: object; depth: number }> = [{ v: payload, depth: 1 }];
  let visited = 0;
  while (stack.length > 0) {
    const { v, depth } = stack.pop()!;
    if (depth > MOD_PAYLOAD_MAX_DEPTH) throw new ModRefusal('LOG', `log.append payload nests deeper than ${MOD_PAYLOAD_MAX_DEPTH} levels`, { ...at, why: 'payload-depth' });
    const isArr = Array.isArray(v);
    const keys = isArr ? null : Object.keys(v);
    const n = isArr ? (v as unknown[]).length : keys!.length;
    visited += n;
    if (visited > MOD_PAYLOAD_MAX_VISITED) throw new ModRefusal('LOG', `log.append payload holds more than ${MOD_PAYLOAD_MAX_VISITED} keys and elements`, { ...at, why: 'payload-size' });
    for (let i = 0; i < n; i++) {
      let child: unknown;
      if (isArr) child = (v as unknown[])[i];
      else {
        const k = keys![i]!;
        if (MOD_PAYLOAD_PROTOTYPE_KEYS.includes(k)) throw new ModRefusal('LOG', 'log.append payload has a prototype key (__proto__, constructor or prototype)', { ...at, why: 'prototype-key', depth });
        child = (v as Record<string, unknown>)[k];
      }
      if (child !== null && typeof child === 'object') stack.push({ v: child, depth: depth + 1 });
    }
  }
}

/**
 * Clamp a mod's log.append params to the fields it may supply (Aegis C2), then apply the host's stamp (S1.2 C1,
 * G-MOD-12). `relayedFor` is a HOST-OWNED payload key on every mod append: a mod-supplied value is always removed;
 * with a stamp (a relayed command or a tool call) the host's value is written; without one (idle, event-driven or
 * host-initiated) the key is absent. `causes` and the envelope `scope` (S1.3: the repo scope of a first-party
 * command's joined focus) come only from the stamp; a mod-supplied `causes` or `scope` is never read. The size cap
 * is measured AFTER stamping, so the stamp cannot push a row past it.
 */
export function clampModAppend(name: string, principal: string, params: Record<string, unknown>, stamp?: CallStamp): ModAppendRow {
  const kind = params.kind;
  if (typeof kind !== 'string' || !ownsModKind(name, kind)) throw new ModRefusal('VERB', `${name} may append only its own modns.${name}.* kinds`, { name, verb: 'log.append' });
  const raw = params.payload ?? {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ModRefusal('LOG', 'log.append payload must be a plain object', { name, kind });
  // Aegis S1.2 A2 / S1.3 A7 (G-MOD-18): refused, never dropped, at ANY depth, before any copy or canonicalisation
  checkModPayloadKeys(raw as Record<string, unknown>, { name, kind });
  // a copy onto a null-prototype object, key by key: the mod's object is never mutated and never trusted for this key
  const payload: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (k !== RELAYED_FOR_APPEND_KEY) payload[k] = (raw as Record<string, unknown>)[k];
  if (stamp) payload[RELAYED_FOR_APPEND_KEY] = { ...stamp.relayedFor };
  const bytes = Buffer.byteLength(canonicalJson(payload), 'utf8');
  if (bytes > MOD_APPEND_MAX_BYTES) throw new ModRefusal('LOG', `log.append payload is ${bytes} bytes; a mod may append at most ${MOD_APPEND_MAX_BYTES}`, { name, kind, bytes });
  // S1.3 A4: the envelope scope comes from the stamp alone, and only in the one form the envelope accepts
  const repo = stamp?.scope?.repo;
  const scope = typeof repo === 'string' && /^repo:[0-9a-f]{16}$/.test(repo) ? { repo } : null;
  const row: ModAppendRow = { kind, principal, payload, ...(stamp?.causes && stamp.causes.length > 0 ? { causes: [...stamp.causes] } : {}), ...(scope ? { scope } : {}) };
  if (params.audience !== undefined) {
    if (!(AUDIENCES as readonly unknown[]).includes(params.audience)) throw new ModRefusal('LOG', 'log.append audience is not an audience value', { name, kind });
    row.audience = params.audience as ModAppendRow['audience'];
  }
  if (params.sensitivity !== undefined) {
    if (!(SENSITIVITIES as readonly unknown[]).includes(params.sensitivity)) throw new ModRefusal('LOG', 'log.append sensitivity is not a sensitivity value', { name, kind });
    row.sensitivity = params.sensitivity as ModAppendRow['sensitivity'];
  }
  return row;
}

export interface ModKernelCall {
  (req: KernelCallRequest): Promise<unknown>;
  /** the host's onCallEnd: drop that call's byte tally (it can bind no further request) */
  endCall(name: string, callId: string): void;
  /** live budget keys (tests) */
  budgetKeys(): number;
}

export function createModKernelCall(ports: ModKernelPorts, opts: { now?: () => number } = {}): ModKernelCall {
  // the budget windows are AGES, so the default clock is monotonic: a wall-clock step back can neither hold rows in
  // the window past their second nor stretch `retryAfterMs` (an injected clock is still clamped below)
  const now = opts.now ?? (() => performance.now());
  const rows = new Map<string, Array<{ t: number; tool: boolean }>>(); // name → appends in the last second, each with its share
  const bytes = new Map<string, number>(); // `${name}|${callKey}` → payload bytes appended
  const fn = async (req: KernelCallRequest): Promise<unknown> => {
    if (req.verb === 'log.append') {
      const row = clampModAppend(req.name, req.principal, req.params, req.stamp);
      const t = now();
      const recent = (rows.get(req.name) ?? []).filter((x) => t - x.t < MOD_APPEND_WINDOW_MS);
      // S1.4 A4: only a bound command is outside the tool share. It fails closed: a tool call, an idle request and a
      // request whose kind is missing or unknown all count against it, so nothing but a command can use the reserve.
      const tool = req.callKind !== 'command';
      // whole milliseconds, never under 1 and never over the window, whatever the clock did
      const wait = (xs: Array<{ t: number }>): number => Math.min(MOD_APPEND_WINDOW_MS, Math.max(1, Math.ceil(MOD_APPEND_WINDOW_MS - (t - xs[0]!.t))));
      if (tool) {
        const toolRows = recent.filter((x) => x.tool);
        if (toolRows.length >= MOD_APPEND_TOOL_ROWS_PER_SEC) throw budgetRefusal(req.name, 'tool-rows', `${req.name} exceeded ${MOD_APPEND_TOOL_ROWS_PER_SEC} tool-call appends per second`, wait(toolRows));
      }
      if (recent.length >= MOD_APPEND_ROWS_PER_SEC) throw budgetRefusal(req.name, 'rows', `${req.name} exceeded ${MOD_APPEND_ROWS_PER_SEC} appends per second`, wait(recent));
      const sec = Math.floor(t / 1_000);
      // prune idle windows older than this second (never a live call's tally)
      for (const k of bytes.keys()) {
        const i = k.lastIndexOf('|idle:');
        if (i >= 0 && Number(k.slice(i + 6)) < sec) bytes.delete(k);
      }
      const key = `${req.name}|${req.callId ?? `idle:${sec}`}`;
      const size = Buffer.byteLength(canonicalJson(row.payload), 'utf8');
      const used = bytes.get(key) ?? 0;
      if (used + size > MOD_APPEND_BYTES_PER_CALL) throw budgetRefusal(req.name, 'bytes', `${req.name} exceeded ${MOD_APPEND_BYTES_PER_CALL} appended bytes in this call`);
      recent.push({ t, tool });
      rows.set(req.name, recent);
      bytes.set(key, used + size);
      const r = await ports.append(row);
      return { seq: r.seq };
    }
    return ports.callAs(req.principal, req.verb, req.params);
  };
  // bounded by the host: one call in force per mod, and each call's key is dropped when it ends
  return Object.assign(fn, {
    endCall: (name: string, callId: string) => void bytes.delete(`${name}|${callId}`),
    budgetKeys: () => bytes.size,
  });
}

/** What the dispatcher needs from the mod host (socket/dispatch.ts ModRelayPort). */
export interface ModRelays {
  view(relayedFor: { principal: string; connId: string; principalClass: string }, req: { name: string; viewId: string; input: unknown }): Promise<RenderResult>;
  command(relayedFor: { principal: string; connId: string; principalClass: string; surface?: 'gui' | 'cli' }, req: { name: string; commandId: string; args: unknown }): Promise<unknown>;
  /** full for the human class; counts only for every other caller (F4) */
  status(full: boolean): Record<string, unknown>;
}

export function createModRelayPort(host: ModHost): ModRelays {
  const ensure = (name: string): Promise<void> => host.admit(name);
  return {
    view: async (rf, req) => {
      await ensure(req.name);
      return host.relayView({ name: req.name, viewId: req.viewId, input: req.input, principal: rf.principal, connId: rf.connId, principalClass: rf.principalClass });
    },
    command: async (rf, req) => {
      await ensure(req.name);
      return { result: await host.relayCommand({ name: req.name, commandId: req.commandId, args: req.args, principal: rf.principal, connId: rf.connId, principalClass: rf.principalClass, ...(rf.surface ? { surface: rf.surface } : {}) }) };
    },
    status: (full) => {
      const st = host.status() as { modAbiId: string; running: unknown[]; paused: unknown[] };
      return full ? st : { modAbiId: st.modAbiId, running: { n: st.running.length }, paused: { n: st.paused.length } };
    },
  };
}
