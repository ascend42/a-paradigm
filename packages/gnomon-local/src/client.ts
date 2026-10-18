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
}

const usageOf = (u: Chunk['usage']): Completion['usage'] =>
  u && (typeof u.prompt_tokens === 'number' || typeof u.completion_tokens === 'number') ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 } : null;

export async function complete(base: string, body: Record<string, unknown>, o: { signal?: AbortSignal; onDelta?: (text: string) => void; forbiddenPorts?: readonly number[] } = {}): Promise<Completion> {
  const v = classifyEndpoint(base, o.forbiddenPorts);
  if (!v.ok) throw new EndpointRefused(v.why);
  const res = await fetch(`${v.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (!res.ok) throw new Error(`completion failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  if (!body.stream) {
    const j = (await res.json()) as Chunk;
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
    const u = usageOf(c.usage);
    if (u) out.usage = u;
    const ch = c.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) out.finishReason = ch.finish_reason;
    const d = ch.delta;
    if (d?.content) {
      out.content += d.content;
      o.onDelta?.(d.content);
    }
    for (const t of d?.tool_calls ?? []) {
      const idx = typeof t.index === 'number' ? t.index : byIndex.size;
      const cur = byIndex.get(idx) ?? { id: t.id ?? `call-${idx + 1}`, name: '', arguments: '' };
      if (t.id) cur.id = t.id;
      if (t.function?.name) cur.name += t.function.name;
      if (t.function?.arguments) cur.arguments += t.function.arguments;
      byIndex.set(idx, cur);
    }
  };
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(part, { stream: true });
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
