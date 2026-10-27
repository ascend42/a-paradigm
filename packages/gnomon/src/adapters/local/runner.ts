/**
 * @symbol #local-runner
 *
 * #local-runner's stdio driver half (spec §2.2 `#backend-adapter`, §3.3
 * `#local-runner` argv, §13.1) — the ONE place in the kernel that knows the
 * shape of gnomon-local's `--mode rpc` JSONL (pi's rpc-entry.ts shape),
 * symmetric with #claude-adapter.
 *
 *   buildLocalArgv — `--mode rpc --config <local.yaml> --session <hsid>`.
 *   parseLocalLine — one stdout line → one typed LocalEvent. TOLERANT: unknown
 *     fields ignored, an unknown `type` is `unknown` (logged, never acted on),
 *     a non-object is `malformed`. Usage only from `message_end.usage` and
 *     `agent_end.usage` — never model text (§2.2).
 *   T-2026-10-26-003: `message` carries textBytes (the assistant text's size,
 *     never the text) and `end` carries input/output beside the total, so the
 *     kernel's turn.result can say "no answer" and the run's real usage.
 *   Slice B1 (TD-2026-10-27-833): `context_report` (the child's context
 *     ledger at each turn start) is a typed `context` event — bounded numbers
 *     only (each a non-negative integer ≤ CONTEXT_NUM_MAX, else null); the
 *     kernel logs the raw line as turn.event and does not act on it yet.
 *   Slice S1 (TD-2026-10-27-833, the two-way protocol): `tool_request{id,
 *     toolCallId, name, args}` is a typed `tool-request` event, every field
 *     bounded (id tr-N, toolCallId <= 128 chars, a tool-name pattern, args a
 *     JSON object of at most TOOL_ARGS_MAX_BYTES); a malformed one carries
 *     `error` (the kernel answers it as an error when its id is usable).
 *     toolResponseLine / toolsSetLine are the kernel's replies; the reserved
 *     B2 commands (memory_set, compact, set_context) have no writer yet.
 *   LocalUsageMeter — each message's usage is charged once; agent_end charges
 *     only what the messages did not (no double count).
 *   promptLine / followUpLine / steerLine / abortLine — the stdin commands;
 *     interrupt is the `abort` command, never a signal (A23-4).
 */

export function buildLocalArgv(i: { configPath: string; hsid: string }): string[] {
  return ['--mode', 'rpc', '--config', i.configPath, '--session', i.hsid];
}

export type LocalEvent =
  | { kind: 'capabilities'; type: string; model: string | null; tools: boolean | null; ctx: number | null; compat: string | null; textTools: boolean | null }
  | { kind: 'partial'; type: string; bytes: number }
  | { kind: 'message'; type: string; tokens: number | null; toolCalls: number; textBytes: number }
  | { kind: 'repair'; type: string; tool: string | null; steps: string[] }
  | { kind: 'tool'; type: string; phase: 'start' | 'end'; tool: string | null; isError: boolean | null }
  | { kind: 'turn'; type: string; phase: 'start' | 'end' }
  | { kind: 'start'; type: string }
  | { kind: 'compaction'; type: string; phase: 'start' | 'end'; reason: string | null; tokensBefore: number | null; tokensAfter: number | null; summaryHash: string | null; summaryBytes: number | null; error: string | null }
  | { kind: 'context'; type: string; turn: number | null; target: number | null; slots: { system: number | null; memory: number | null; tools: number | null; history: number | null; reply: number | null }; historyUsed: number | null; compactions: number | null }
  | { kind: 'end'; type: string; tokens: number | null; input: number | null; output: number | null; stopReason: string | null; error: string | null }
  | { kind: 'response'; type: string; command: string | null; success: boolean | null; error: string | null }
  | { kind: 'tool-request'; type: string; id: string | null; toolCallId: string | null; name: string | null; args: Record<string, unknown> | null; error: string | null }
  | { kind: 'tool-cancel'; type: string; id: string | null }
  | { kind: 'fatal'; type: string; error: string | null }
  | { kind: 'unknown'; type: string }
  | { kind: 'malformed'; type: 'malformed' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/** Slice B1: a context_report number — a non-negative integer no larger than this, else null. */
export const CONTEXT_NUM_MAX = 1 << 24;
const cnum = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= CONTEXT_NUM_MAX ? v : null);
const s = (v: unknown, max = 200): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const b = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function tokensOf(u: unknown): number | null {
  if (u === null || typeof u !== 'object') return null;
  const i = num((u as { input?: unknown }).input);
  const o = num((u as { output?: unknown }).output);
  return i === null && o === null ? null : (i ?? 0) + (o ?? 0);
}

export function parseLocalLine(line: string): LocalEvent {
  let j: unknown;
  try {
    j = JSON.parse(line);
  } catch {
    return { kind: 'malformed', type: 'malformed' };
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return { kind: 'malformed', type: 'malformed' };
  const e = j as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type.slice(0, 64) : 'unknown';
  switch (type) {
    case 'model_capabilities':
      return { kind: 'capabilities', type, model: s(e.model), tools: b(e.tools), ctx: num(e.ctx), compat: s(e.compat, 32), textTools: b(e.textTools) };
    case 'message_update':
      return { kind: 'partial', type, bytes: typeof e.delta === 'string' ? Buffer.byteLength(e.delta) : 0 };
    case 'message_end': {
      const m = e.message as { toolCalls?: unknown; content?: unknown } | undefined;
      return { kind: 'message', type, tokens: tokensOf(e.usage), toolCalls: Array.isArray(m?.toolCalls) ? m.toolCalls.length : 0, textBytes: typeof m?.content === 'string' ? Buffer.byteLength(m.content.trim()) : 0 };
    }
    case 'model_repair':
      return { kind: 'repair', type, tool: s(e.toolName, 64), steps: Array.isArray(e.steps) ? e.steps.filter((x): x is string => typeof x === 'string').slice(0, 16) : [] };
    case 'tool_execution_start':
    case 'tool_execution_end':
      return { kind: 'tool', type, phase: type.endsWith('start') ? 'start' : 'end', tool: s(e.toolName, 64), isError: b(e.isError) };
    case 'turn_start':
    case 'turn_end':
      return { kind: 'turn', type, phase: type.endsWith('start') ? 'start' : 'end' };
    case 'agent_start':
      return { kind: 'start', type };
    case 'compaction_start':
    case 'compaction_end':
      // slice 2: logged (turn.event) and never acted on — its usage reaches the meter through agent_end's remainder
      return { kind: 'compaction', type, phase: type.endsWith('start') ? 'start' : 'end', reason: s(e.reason, 32), tokensBefore: num(e.tokensBefore), tokensAfter: num(e.tokensAfter), summaryHash: typeof e.summaryHash === 'string' && /^sha256:[0-9a-f]{64}$/.test(e.summaryHash) ? e.summaryHash : null, summaryBytes: num(e.summaryBytes), error: s(e.error, 500) };
    case 'context_report': {
      const sl = e.slots !== null && typeof e.slots === 'object' && !Array.isArray(e.slots) ? (e.slots as Record<string, unknown>) : {};
      return { kind: 'context', type, turn: cnum(e.turn), target: cnum(e.target), slots: { system: cnum(sl.system), memory: cnum(sl.memory), tools: cnum(sl.tools), history: cnum(sl.history), reply: cnum(sl.reply) }, historyUsed: cnum(e.historyUsed), compactions: cnum(e.compactions) };
    }
    case 'agent_end':
    {
      const u = e.usage !== null && typeof e.usage === 'object' ? (e.usage as { input?: unknown; output?: unknown }) : {};
      return { kind: 'end', type, tokens: tokensOf(e.usage), input: num(u.input), output: num(u.output), stopReason: s(e.stopReason, 32), error: s(e.error, 500) };
    }
    case 'response':
      return { kind: 'response', type, command: s(e.command, 32), success: b(e.success), error: s(e.error, 200) };
    case 'fatal':
      return { kind: 'fatal', type, error: s(e.error, 500) };
    case 'tool_request':
      return toolRequestOf(type, e);
    case 'tool_cancel':
      // Aegis M1: the child gave up on a call (its timeout or abort); honouring it only removes privilege
      return { kind: 'tool-cancel', type, id: typeof e.id === 'string' && TOOL_REQUEST_ID_RE.test(e.id) ? e.id : null };
    default:
      return { kind: 'unknown', type };
  }
}

/** Slice S1: bounds of a tool_request (the child's broker.ts mirrors them). */
export const TOOL_REQUEST_ID_RE = /^tr-[1-9]\d{0,9}$/;
export const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
export const TOOL_CALL_ID_MAX = 128;
/** Aegis L5: a toolCallId the kernel accepts (the child substitutes its own for anything else). */
export const TOOL_CALL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Aegis L2: the deepest args nesting measured before any stringify. */
export const TOOL_ARGS_MAX_DEPTH = 16;

/** Aegis L2: the nesting depth of a parsed value, iteratively (never recursion); stops counting past `max`. */
export function nestingDepth(v: unknown, max = TOOL_ARGS_MAX_DEPTH): number {
  let deepest = 0;
  const stack: Array<[unknown, number]> = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (x === null || typeof x !== 'object') continue;
    deepest = Math.max(deepest, d);
    if (deepest > max) return deepest;
    for (const y of Object.values(x as Record<string, unknown>)) stack.push([y, d + 1]);
  }
  return deepest;
}
export const TOOL_ARGS_MAX_BYTES = 64 * 1024;
/** The most content one tool_response carries (the child refuses more). */
export const TOOL_RESPONSE_MAX_CHARS = 256 * 1024;

function toolRequestOf(type: string, e: Record<string, unknown>): Extract<LocalEvent, { kind: 'tool-request' }> {
  const id = typeof e.id === 'string' && TOOL_REQUEST_ID_RE.test(e.id) ? e.id : null;
  const out = { kind: 'tool-request' as const, type, id, toolCallId: null as string | null, name: null as string | null, args: null as Record<string, unknown> | null, error: null as string | null };
  const extra = Object.keys(e).find((k) => !['type', 'id', 'toolCallId', 'name', 'args'].includes(k));
  if (!id) return { ...out, error: 'id is not a tool request id' };
  if (extra !== undefined) return { ...out, error: `unknown field ${extra.slice(0, 32)}` };
  if (typeof e.toolCallId !== 'string' || !TOOL_CALL_ID_RE.test(e.toolCallId)) return { ...out, error: 'toolCallId must match [A-Za-z0-9_.:-]{1,128}' };
  if (typeof e.name !== 'string' || !TOOL_NAME_RE.test(e.name)) return { ...out, toolCallId: e.toolCallId, error: 'name is not a tool name' };
  const a = e.args;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return { ...out, toolCallId: e.toolCallId, name: e.name, error: 'args must be a JSON object' };
  if (nestingDepth(a) > TOOL_ARGS_MAX_DEPTH) return { ...out, toolCallId: e.toolCallId, name: e.name, error: `args are nested deeper than ${TOOL_ARGS_MAX_DEPTH}` };
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(a), 'utf8');
  } catch {
    return { ...out, toolCallId: e.toolCallId, name: e.name, error: 'args are not plain JSON' };
  }
  if (size > TOOL_ARGS_MAX_BYTES) return { ...out, toolCallId: e.toolCallId, name: e.name, error: `args are over ${TOOL_ARGS_MAX_BYTES} bytes` };
  return { ...out, toolCallId: e.toolCallId, name: e.name, args: a as Record<string, unknown> };
}

/** Per run: messages charged as they end; agent_end charges only the remainder. */
export class LocalUsageMeter {
  #run = 0;
  message(tokens: number | null): number {
    const t = tokens ?? 0;
    this.#run += t;
    return t;
  }
  end(total: number | null): number {
    const rest = Math.max(0, (total ?? 0) - this.#run);
    this.#run = 0;
    return rest;
  }
}

const line = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;
export const promptLine = (message: string, id?: string): string => line({ ...(id ? { id } : {}), type: 'prompt', message });
export const followUpLine = (message: string, id?: string): string => line({ ...(id ? { id } : {}), type: 'follow_up', message });
export const steerLine = (message: string, id?: string): string => line({ ...(id ? { id } : {}), type: 'steer', message });
export const abortLine = (): string => line({ type: 'abort' });
/** Slice S1: the kernel's answer to one tool_request (content capped at TOOL_RESPONSE_MAX_CHARS). */
export const toolResponseLine = (r: { id: string; content: string; isError: boolean; provenance: string }): string => line({ type: 'tool_response', id: r.id, content: r.content.slice(0, TOOL_RESPONSE_MAX_CHARS), isError: r.isError, provenance: r.provenance });
/** Slice S1: the brokered tools offered from the child's next step on. */
export const toolsSetLine = (tools: ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown>; class: string }>): string => line({ type: 'tools_set', tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, class: t.class })) });
