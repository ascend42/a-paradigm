/**
 * @symbol #gnomon-local
 * @symbol ^subscription-only
 *
 * The OpenAI-compatible completions client (spec §13.1): POST
 * `<base>/v1/chat/completions`, streamed (SSE `data:` lines, `[DONE]`) or
 * not. Fail closed: the loopback/LAN rule is re-run on every request, fetch
 * follows NO redirect (a LAN box cannot bounce the session to a cloud host),
 * and only `http(s)` bases that passed the rule are ever dialled.
 * Stream tool-call deltas are accumulated by index; usage comes from the
 * final usage chunk (stream_options.include_usage) or the body's `usage`.
 * Bounded (Aegis L1, round 2): an SSE line ≤ 1 MiB, content ≤ 1 MiB, one
 * tool call's arguments ≤ 256 KiB, an error body ≤ 4 KiB, a non-stream body
 * ≤ 2 MiB; an idle gap longer than `idleMs` (default 120 s) aborts the
 * request. A mid-stream `{"error": …}` chunk fails the request (the agent
 * ends with stopReason `error`).
 */
import { classifyEndpoint } from './endpoint.js';

export interface ToolCallOut {
  id: string;
  name: string;
  /** raw argument text as the model produced it (repaired later) */
  arguments: string;
}

export interface Completion {
  content: string;
  toolCalls: ToolCallOut[];
  usage: { input: number; output: number } | null;
  finishReason: string | null;
}

export const CAPS = Object.freeze({ sseLine: 1 << 20, content: 1 << 20, toolArgs: 256 * 1024, errorBody: 4 * 1024, body: 2 << 20, stream: 8 << 20 });

export class EndpointRefused extends Error {
  constructor(readonly why: string) {
    super(`endpoint refused: ${why} (loopback/LAN only, law 7)`);
  }
}

interface Choice {
  delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
  message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string | object } }> };
  finish_reason?: string | null;
}

interface Chunk {
  choices?: Choice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: unknown;
}

async function* chunksOf(res: Response): AsyncGenerator<Uint8Array> {
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) yield part;
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const dec = new TextDecoder();
  let out = '';
  let n = 0;
  for await (const part of chunksOf(res)) {
    n += part.length;
    if (n > cap) {
      out += dec.decode(part.subarray(0, Math.max(0, part.length - (n - cap))));
      break;
    }
    out += dec.decode(part, { stream: true });
  }
  return out;
}

const usageOf = (u: Chunk['usage']): Completion['usage'] =>
  u && (typeof u.prompt_tokens === 'number' || typeof u.completion_tokens === 'number') ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 } : null;

export async function complete(base: string, body: Record<string, unknown>, o: { signal?: AbortSignal; onDelta?: (text: string) => void; forbiddenPorts?: readonly number[]; idleMs?: number } = {}): Promise<Completion> {
  const v = classifyEndpoint(base, o.forbiddenPorts);
  if (!v.ok) throw new EndpointRefused(v.why);
  const ctl = new AbortController();
  const outer = o.signal;
  const onOuter = (): void => ctl.abort(outer?.reason);
  if (outer?.aborted) ctl.abort(outer.reason);
  outer?.addEventListener('abort', onOuter, { once: true });
  const idleMs = o.idleMs ?? 120_000;
  let idle = setTimeout(() => ctl.abort(new Error(`idle > ${idleMs} ms`)), idleMs);
  const touch = (): void => {
    clearTimeout(idle);
    idle = setTimeout(() => ctl.abort(new Error(`idle > ${idleMs} ms`)), idleMs);
  };
  try {
    return await completeInner(v.base, body, o, ctl.signal, touch);
  } finally {
    clearTimeout(idle);
    outer?.removeEventListener('abort', onOuter);
  }
}

async function completeInner(vbase: string, body: Record<string, unknown>, o: { onDelta?: (text: string) => void }, signal: AbortSignal, touch: () => void): Promise<Completion> {
  const res = await fetch(`${vbase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal,
  });
  touch();
  if (!res.ok) throw new Error(`completion failed: HTTP ${res.status} ${(await readCapped(res, CAPS.errorBody).catch(() => '')).slice(0, 200)}`);
  if (!body.stream) {
    const j = JSON.parse(await readCapped(res, CAPS.body)) as Chunk;
    if (j.error !== undefined) throw new Error(`completion error: ${JSON.stringify(j.error).slice(0, 200)}`);
    const m = j.choices?.[0]?.message;
    return {
      content: m?.content ?? '',
      toolCalls: (m?.tool_calls ?? []).map((t, i) => ({ id: t.id ?? `call-${i + 1}`, name: t.function?.name ?? '', arguments: typeof t.function?.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function?.arguments ?? {}) })),
      usage: usageOf(j.usage),
      finishReason: j.choices?.[0]?.finish_reason ?? null,
    };
  }
  const out: Completion = { content: '', toolCalls: [], usage: null, finishReason: null };
  const byIndex = new Map<number, ToolCallOut>();
  const decoder = new TextDecoder();
  let buf = '';
  const onData = (data: string): void => {
    if (data === '[DONE]') return;
    let c: Chunk;
    try {
      c = JSON.parse(data) as Chunk;
    } catch {
      return; // a malformed chunk is skipped, never acted on
    }
    if (c.error !== undefined) throw new Error(`stream error: ${JSON.stringify(c.error).slice(0, 200)}`);
    const u = usageOf(c.usage);
    if (u) out.usage = u;
    const ch = c.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) out.finishReason = ch.finish_reason;
    const d = ch.delta;
    if (d?.content) {
      if (out.content.length + d.content.length > CAPS.content) throw new Error('content cap exceeded');
      out.content += d.content;
      o.onDelta?.(d.content);
    }
    for (const t of d?.tool_calls ?? []) {
      const idx = typeof t.index === 'number' ? t.index : byIndex.size;
      const cur = byIndex.get(idx) ?? { id: t.id ?? `call-${idx + 1}`, name: '', arguments: '' };
      if (t.id) cur.id = t.id;
      if (t.function?.name) cur.name += t.function.name;
      if (t.function?.arguments) {
        if (cur.arguments.length + t.function.arguments.length > CAPS.toolArgs) throw new Error('tool-call arguments cap exceeded');
        cur.arguments += t.function.arguments;
      }
      byIndex.set(idx, cur);
    }
  };
  let streamed = 0;
  for await (const part of chunksOf(res)) {
    touch();
    streamed += part.length;
    if (streamed > CAPS.stream) throw new Error('stream bytes cap exceeded');
    buf += decoder.decode(part, { stream: true });
    if (buf.length > CAPS.sseLine && buf.indexOf('\n') < 0) throw new Error('SSE line cap exceeded');
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
  if (buf.startsWith('data:')) onData(buf.slice(5).trim());
  out.toolCalls = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  return out;
}
