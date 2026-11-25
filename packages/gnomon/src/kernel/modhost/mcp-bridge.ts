/**
 * @symbol #mod-tool-bridge
 *
 * #mod-tool-bridge (S1.4-P2; spec §3.8, §12.3; G-MOD-19, G-MOD-22): the kernel's SECOND SDK-type MCP server for a
 * Claude Code session, named `gnomon-mods` (MOD_BRIDGE_SERVER). Like #kernel-mcp it has no process, no socket, no
 * port and no credential: the session's mcp.json carries `{"type":"sdk","name":"gnomon-mods"}` and Claude Code sends
 * each JSON-RPC message over the session's own stdio control channel. The caller IS the session the kernel spawned,
 * so every identity value comes from the supervisor's `Session` object and NOTHING in the message reaches a stamp, a
 * gate, a receipt or a row.
 *
 * This module is the answerer and its ports. It is pure over `BridgePorts`: the supervisor captures the caller
 * (BridgeSession) synchronously and writes the one answer; the daemon builds the ports over the mod host and the log.
 *
 * WHAT IS LISTED (modBridgeTools). A tool is listed, and callable, only when all of these hold. The rule is
 * re-derived on every `tools/call`; an earlier `tools/list` is never trusted.
 *  - its mod is installed, verified, granted and unpaused (the desk set the daemon passes in);
 *  - the mod and the tool are named on the CLOSED allowlist. The production allowlist MOD_BRIDGE_TOOLS is EMPTY
 *    until S1.4-P5 (Aegis M1: nothing draws before the revoke key and the dashed stroke exist), so a real kernel
 *    lists nothing and writes no mcp.json entry in this pass; tests pass an allowlist through the ports;
 *  - the mod is first-party (`gnomon`-published, tier first-party) and its installed package hash is one of the
 *    kernel's CURRENT pins, never a superseded or a historical first-party hash (Aegis A7);
 *  - the tool declares neither `network` nor `spend` (a tool call with an hsid could reach `session.send`);
 *  - the tool carries a manifest `schema` of type `object` whose `description` is a string of at most 1,024
 *    characters with no control or format character, and whose canonical JSON is at most 8 KiB (Aegis M6);
 *  - the tool name is declared by one listed mod only (a name two mods declare is listed for neither).
 *
 * ARGUMENTS (Aegis A1; checkBridgeArguments). Of `params` only the OWN keys `name` and `arguments` are read.
 * `arguments` is refused BEFORE the mod is reached when it is not a plain object, nests deeper than 32, holds more
 * than 8,192 keys and elements, holds an own `__proto__`, `constructor` or `prototype` key at any depth, or is over
 * 128 KiB as canonical JSON (the session line cap is 4 MiB, so this cap is the one that binds). The walk is the
 * mod host's own (bridge.ts walkPayloadKeys): iterative, own keys only, bounded before anything is copied.
 */
import { canonicalJson } from '@a-company/gnomon-contracts';
import { HISTORICAL_FIRST_PARTY_PINS } from '../manifest/grants.js';
import { FIRST_PARTY_PACKAGE_HASHES, SUPERSEDED_FIRST_PARTY_PINS } from '../manifest/install.js';
import { GNOMON_VERSION } from '../../version.js';
import { walkPayloadKeys } from './bridge.js';

export const MOD_BRIDGE_SERVER = 'gnomon-mods';
/** The session mcp.json entry of the bridge. Nothing else is ever written for it: no env, no path, no token. */
export const MOD_BRIDGE_ENTRY = Object.freeze({ type: 'sdk', name: MOD_BRIDGE_SERVER });
/**
 * The CLOSED production allowlist: mod id → tool names. EMPTY in S1.4-P2 (Aegis M1); P5 adds the one line, and may
 * merge only after P4a and P4b. A tool outside it is never listed and never called.
 */
export const MOD_BRIDGE_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({});
/** The MCP protocol version answered when the client names none (the client's own version is echoed otherwise). */
export const MOD_BRIDGE_PROTOCOL = '2025-06-18';
export const MOD_BRIDGE_LIMITS = Object.freeze({
  /** calls that pass the gates, per session per second */
  callsPerSecond: 4,
  inFlightPerSession: 1,
  /** Aegis M7: bridge calls queued or running per mod, across all sessions */
  perMod: 2,
  /** the mod result's JSON after escaping */
  resultBytes: 256 * 1024,
  /** Aegis A1: `arguments` as canonical JSON, its nesting, and its keys plus elements */
  argumentBytes: 128 * 1024,
  argumentDepth: 32,
  argumentVisited: 8_192,
  /** Aegis M6 */
  descriptionChars: 1_024,
  schemaBytes: 8 * 1024,
  /** the window kernel-composed refusals are folded in (one counter row per session per window) */
  foldWindowMs: 10_000,
  agentLabel: /^[a-z][a-z0-9-]{0,31}$/,
});

/** Control (Cc), format (Cf), line (Zl) and paragraph (Zp) separators: never in a listed description, always escaped in a result. */
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

/** One installed, verified, granted, unpaused mod as the list rule reads it (the daemon: DeskMods.list()). */
export interface BridgeMod {
  name: string;
  manifest: { publisher?: unknown; provides?: { tools?: ReadonlyArray<{ name: string; schema?: unknown; effects: readonly string[] }> } };
  /** the installed snapshot's package hash; absent ⇒ never listed */
  packageHash?: string;
  /** the trust tier of the installed manifest; absent ⇒ never listed */
  tier?: string;
}

export interface BridgeTool {
  mod: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Is this package hash one of the kernel's CURRENT first-party pins? A superseded pin and a historical format-1 pin
 * keep their first-party TIER (so an old install still loads), but neither is current: a tree at one of them lists
 * no tool (Aegis A7, "an older first-party tree with tools must not stay drawable after a fix").
 */
export function isCurrentFirstPartyPin(packageHash: string): boolean {
  return FIRST_PARTY_PACKAGE_HASHES.has(packageHash) && !SUPERSEDED_FIRST_PARTY_PINS.has(packageHash) && !HISTORICAL_FIRST_PARTY_PINS.has(packageHash);
}

/** The list rule (see the header). Pure; fail closed per mod and per tool; sorted by mod id, then by the allowlist's order. */
export function modBridgeTools(mods: readonly BridgeMod[], allow: Readonly<Record<string, readonly string[]>> = MOD_BRIDGE_TOOLS, currentPin: (packageHash: string) => boolean = isCurrentFirstPartyPin): BridgeTool[] {
  const out: BridgeTool[] = [];
  const seen = new Map<string, number>();
  for (const m of [...mods].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!Object.hasOwn(allow, m.name)) continue;
    if (m.tier !== 'first-party' || m.manifest.publisher !== 'gnomon') continue;
    if (typeof m.packageHash !== 'string' || !currentPin(m.packageHash)) continue;
    const declared = m.manifest.provides?.tools ?? [];
    for (const name of allow[m.name] ?? []) {
      const t = declared.find((x) => x.name === name);
      if (!t || !Array.isArray(t.effects) || t.effects.includes('network') || t.effects.includes('spend')) continue;
      const schema = t.schema;
      if (!isObj(schema) || own(schema, 'type') !== 'object') continue;
      const description = own(schema, 'description');
      if (typeof description !== 'string' || description.length === 0 || description.length > MOD_BRIDGE_LIMITS.descriptionChars || UNSAFE_TEXT.test(description)) continue;
      try {
        if (Buffer.byteLength(canonicalJson(schema), 'utf8') > MOD_BRIDGE_LIMITS.schemaBytes) continue;
      } catch {
        continue; // a schema that cannot be canonicalised is not listed
      }
      seen.set(name, (seen.get(name) ?? 0) + 1);
      out.push({ mod: m.name, name, description, inputSchema: schema });
    }
  }
  return out.filter((t) => seen.get(t.name) === 1);
}

/** Per-session rate state. It lives on the supervisor's `Session` and dies with it. */
export interface BridgeRate {
  /** the times (ports.now()) of the calls that passed the gates in the last second */
  calls: number[];
  inFlight: number;
}
export const newBridgeRate = (): BridgeRate => ({ calls: [], inFlight: 0 });

/**
 * The caller, captured by the supervisor from its `Session` object SYNCHRONOUSLY when the control request is read
 * (before any await: a `result` line may close the turn while the call waits). No field comes from the message.
 */
export interface BridgeSession {
  hsid: string;
  /** the session principal (`p:<ns>/s-<hsid-short>`) */
  principal: string;
  /** a kernel constant per backend (`claude`) */
  agent: string;
  /** the newest consumed outstanding turn; null ⇒ refused `no-turn` */
  turn: string | null;
  /** `voice` when that turn was sent with origin voice or voice-unverified, else `bridge` (Aegis A5: no gate reads it) */
  surface: 'bridge' | 'voice';
  /** Aegis M2: why the bridge itself refuses this session's calls, whether or not a can_use_tool arrived */
  held: 'manual' | 'loop' | null;
  rate: BridgeRate;
  /** is the session still running NOW (asked again before a receipt is written) */
  running(): boolean;
}

/** The closed reasons of a kernel-composed refusal (the counter row's `byWhy` keys). */
export const MOD_BRIDGE_REFUSALS = Object.freeze(['unknown-tool', 'manual', 'loop', 'no-turn', 'arguments', 'rate', 'in-flight', 'mod-busy', 'mod-refused', 'mod-failed', 'not-built'] as const);
export type BridgeRefusal = (typeof MOD_BRIDGE_REFUSALS)[number];

export interface BridgePorts {
  /** the list rule, derived NOW */
  tools(): BridgeTool[];
  /** host.admit(mod), then the mod host's tool call with the whole host-known value */
  call(mod: string, tool: string, input: unknown, s: BridgeSession): Promise<unknown>;
  /** one kernel-composed refusal, folded into the session's counter row */
  refused(s: Pick<BridgeSession, 'hsid' | 'principal'>, why: BridgeRefusal): void;
  now(): number;
}

/** The fixed sentences a model is handed. None carries mod text, model text or a message field. */
export const MOD_BRIDGE_SENTENCES = Object.freeze({
  notRunning: 'The session is not running.',
  notBuilt: 'Refused: this tool is not available yet.',
  arguments: 'Refused: the arguments are not an object, or are too large, too deep or hold a reserved key.',
});

/**
 * Aegis A1: may this `arguments` value reach a mod? Absent ⇒ `{}`. The walk runs first (bounded whatever the model
 * sent), the canonical size after it. Returns the value to send, or null (refused; nothing of it is echoed).
 */
export function checkBridgeArguments(params: Record<string, unknown>): Record<string, unknown> | null {
  const args = Object.hasOwn(params, 'arguments') ? params.arguments : {};
  if (args === undefined || args === null) return {};
  if (!isObj(args)) return null;
  if (walkPayloadKeys(args, { maxDepth: MOD_BRIDGE_LIMITS.argumentDepth, maxVisited: MOD_BRIDGE_LIMITS.argumentVisited }) !== null) return null;
  try {
    if (Buffer.byteLength(canonicalJson(args), 'utf8') > MOD_BRIDGE_LIMITS.argumentBytes) return null;
  } catch {
    return null;
  }
  return args;
}

type Answer = Record<string, unknown>;
const text = (id: string | number, t: string, isError: boolean): Answer => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: t }], isError } });

/** One `tools/call` for a listed tool, from a running session. Every path returns exactly one answer. */
async function runCall(id: string | number, tool: BridgeTool, params: Record<string, unknown>, ports: BridgePorts, s: BridgeSession): Promise<Answer> {
  void tool;
  const input = checkBridgeArguments(params);
  if (input === null) {
    ports.refused(s, 'arguments');
    return text(id, MOD_BRIDGE_SENTENCES.arguments, true);
  }
  ports.refused(s, 'not-built');
  return text(id, MOD_BRIDGE_SENTENCES.notBuilt, true);
}

/**
 * One JSON-RPC message → its JSON-RPC answer (a notification is answered with an empty result, id 0), shaped like
 * kernelMcpAnswer. Of the message only `method`, `id`, `params.protocolVersion` (initialize) and the OWN keys
 * `params.name` and `params.arguments` (tools/call) are read. It never throws: a throw inside a call is the fixed
 * failure result, so the supervisor always has one answer to write.
 */
export async function modBridgeAnswer(message: unknown, ports: BridgePorts, session: () => BridgeSession | null): Promise<Answer> {
  if (!isObj(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    const id = isObj(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } };
  }
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const method = message.method;
  const params = isObj(message.params) ? message.params : {};
  if (id === null || method.startsWith('notifications/')) return { jsonrpc: '2.0', id: 0, result: {} };
  const ok = (result: Record<string, unknown>): Answer => ({ jsonrpc: '2.0', id, result });
  try {
    switch (method) {
      case 'initialize': {
        const v = own(params, 'protocolVersion');
        // no `listChanged`: a running session re-reads the list only on a respawn (S1.4 sends no notification)
        return ok({ protocolVersion: typeof v === 'string' ? v.slice(0, 32) : MOD_BRIDGE_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: MOD_BRIDGE_SERVER, version: GNOMON_VERSION } });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: ports.tools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      case 'tools/call': {
        const s = session();
        const raw = own(params, 'name');
        const name = typeof raw === 'string' ? raw : '';
        // re-derived on every call: a tool that left the list since `tools/list` is unknown now
        const tool = ports.tools().find((t) => t.name === name);
        if (!tool) {
          if (s) ports.refused(s, 'unknown-tool');
          return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name.slice(0, 64).replace(/[^A-Za-z0-9._-]/g, '?')}` } };
        }
        if (!s || !s.running()) return text(id, MOD_BRIDGE_SENTENCES.notRunning, true);
        return await runCall(id, tool, params, ports, s);
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method.slice(0, 64).replace(/[^A-Za-z0-9._/-]/g, '?')}` } };
    }
  } catch {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'internal error' } };
  }
}
