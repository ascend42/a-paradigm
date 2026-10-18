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
  | { kind: 'message'; type: string; tokens: number | null; toolCalls: number }
  | { kind: 'repair'; type: string; tool: string | null; steps: string[] }
  | { kind: 'tool'; type: string; phase: 'start' | 'end'; tool: string | null; isError: boolean | null }
  | { kind: 'turn'; type: string; phase: 'start' | 'end' }
  | { kind: 'start'; type: string }
  | { kind: 'compaction'; type: string; phase: 'start' | 'end'; reason: string | null; tokensBefore: number | null; tokensAfter: number | null; error: string | null }
  | { kind: 'end'; type: string; tokens: number | null; stopReason: string | null; error: string | null }
  | { kind: 'response'; type: string; command: string | null; success: boolean | null; error: string | null }
  | { kind: 'fatal'; type: string; error: string | null }
  | { kind: 'unknown'; type: string }
  | { kind: 'malformed'; type: 'malformed' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
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
      const m = e.message as { toolCalls?: unknown } | undefined;
      return { kind: 'message', type, tokens: tokensOf(e.usage), toolCalls: Array.isArray(m?.toolCalls) ? m.toolCalls.length : 0 };
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
      return { kind: 'compaction', type, phase: type.endsWith('start') ? 'start' : 'end', reason: s(e.reason, 32), tokensBefore: num(e.tokensBefore), tokensAfter: num(e.tokensAfter), error: s(e.error, 500) };
    case 'agent_end':
      return { kind: 'end', type, tokens: tokensOf(e.usage), stopReason: s(e.stopReason, 32), error: s(e.error, 500) };
    case 'response':
      return { kind: 'response', type, command: s(e.command, 32), success: b(e.success), error: s(e.error, 200) };
    case 'fatal':
      return { kind: 'fatal', type, error: s(e.error, 500) };
    default:
      return { kind: 'unknown', type };
  }
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
