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
 * (the callId; requests with none share a per-second idle window); beyond
 * either ⇒ LOG (BAD_REQUEST) and no row. The host additionally caps a mod's
 * in-flight mod → host requests (host.ts MAX_MOD_HOST_INFLIGHT).
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
import { canonicalJson, AUDIENCES, SENSITIVITIES } from '@a-company/gnomon-contracts';
import type { ModHost, KernelCallRequest, RenderResult } from './host.js';
import { ModRefusal } from './refusal.js';

/** A mod-appended payload's cap (canonical JSON bytes). */
export const MOD_APPEND_MAX_BYTES = 16 * 1024;

/** Aegis F2: per-mod append budget. */
export const MOD_APPEND_ROWS_PER_SEC = 20;
export const MOD_APPEND_BYTES_PER_CALL = 64 * 1024;

/** The append fields a mod may supply; every other field is dropped (Aegis C2). */
export const MOD_APPEND_FIELDS = Object.freeze(['kind', 'payload', 'audience', 'sensitivity'] as const);

export interface ModAppendRow {
  kind: string;
  principal: string;
  payload: Record<string, unknown>;
  audience?: (typeof AUDIENCES)[number];
  sensitivity?: (typeof SENSITIVITIES)[number];
}

export interface ModKernelPorts {
  /** the socket dispatcher run as the mod principal (no connection) */
  callAs(principal: string, verb: string, params: Record<string, unknown>): Promise<unknown>;
  /** append one row as the mod principal; resolves the row's seq */
  append(row: ModAppendRow): Promise<{ seq: number }>;
}

/** Clamp a mod's log.append params to the fields it may supply (Aegis C2). */
export function clampModAppend(name: string, principal: string, params: Record<string, unknown>): ModAppendRow {
  const kind = params.kind;
  if (typeof kind !== 'string' || !kind.startsWith(`modns.${name}.`)) throw new ModRefusal('VERB', `${name} may append only its own modns.${name}.* kinds`, { name, verb: 'log.append' });
  const raw = params.payload ?? {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ModRefusal('LOG', 'log.append payload must be a plain object', { name, kind });
  const bytes = Buffer.byteLength(canonicalJson(raw), 'utf8');
  if (bytes > MOD_APPEND_MAX_BYTES) throw new ModRefusal('LOG', `log.append payload is ${bytes} bytes; a mod may append at most ${MOD_APPEND_MAX_BYTES}`, { name, kind, bytes });
  const row: ModAppendRow = { kind, principal, payload: raw as Record<string, unknown> };
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

export function createModKernelCall(ports: ModKernelPorts, opts: { now?: () => number } = {}): (req: KernelCallRequest) => Promise<unknown> {
  const now = opts.now ?? Date.now;
  const rows = new Map<string, number[]>(); // name → append times in the last second
  const bytes = new Map<string, number>(); // `${name}|${callKey}` → payload bytes appended
  return async (req) => {
    if (req.verb === 'log.append') {
      const row = clampModAppend(req.name, req.principal, req.params);
      const t = now();
      const recent = (rows.get(req.name) ?? []).filter((x) => t - x < 1_000);
      if (recent.length >= MOD_APPEND_ROWS_PER_SEC) throw new ModRefusal('LOG', `${req.name} exceeded ${MOD_APPEND_ROWS_PER_SEC} appends per second`, { name: req.name, budget: 'rows' });
      const key = `${req.name}|${req.callId ?? `idle:${Math.floor(t / 1_000)}`}`;
      const size = Buffer.byteLength(canonicalJson(row.payload), 'utf8');
      const used = bytes.get(key) ?? 0;
      if (used + size > MOD_APPEND_BYTES_PER_CALL) throw new ModRefusal('LOG', `${req.name} exceeded ${MOD_APPEND_BYTES_PER_CALL} appended bytes in this call`, { name: req.name, budget: 'bytes' });
      recent.push(t);
      rows.set(req.name, recent);
      if (bytes.size > 256) bytes.clear(); // bounded: old call windows are dead
      bytes.set(key, used + size);
      const r = await ports.append(row);
      return { seq: r.seq };
    }
    return ports.callAs(req.principal, req.verb, req.params);
  };
}

/** What the dispatcher needs from the mod host (socket/dispatch.ts ModRelayPort). */
export interface ModRelays {
  view(relayedFor: { principal: string; connId: string }, req: { name: string; viewId: string; input: unknown }): Promise<RenderResult>;
  command(relayedFor: { principal: string; connId: string }, req: { name: string; commandId: string; args: unknown }): Promise<unknown>;
  /** full for the human class; counts only for every other caller (F4) */
  status(full: boolean): Record<string, unknown>;
}

export function createModRelayPort(host: ModHost): ModRelays {
  const ensure = (name: string): Promise<void> => host.admit(name);
  return {
    view: async (rf, req) => {
      await ensure(req.name);
      return host.relayView({ name: req.name, viewId: req.viewId, input: req.input, principal: rf.principal, connId: rf.connId });
    },
    command: async (rf, req) => {
      await ensure(req.name);
      return { result: await host.relayCommand({ name: req.name, commandId: req.commandId, args: req.args, principal: rf.principal, connId: rf.connId }) };
    },
    status: (full) => {
      const st = host.status() as { modAbiId: string; running: unknown[]; paused: unknown[] };
      return full ? st : { modAbiId: st.modAbiId, running: { n: st.running.length }, paused: { n: st.paused.length } };
    },
  };
}
