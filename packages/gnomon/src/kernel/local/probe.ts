/**
 * @symbol #local-runner
 *
 * The local capability probe (spec §13.1 "tool-capability probe at
 * model.capabilities", §13.2; the P06 probe's method, kernel-side): for one
 * configured endpoint —
 *   n_ctx   from llama.cpp `/slots` (the first slot), else `/props`
 *           default_generation_settings.n_ctx, else unknown (null);
 *   model   `/v1/models` data[0].id, else the configured id;
 *   tools   LIVE only: one completion with a single `get_time` tool and
 *           tool_choice "required"; capable iff the reply's tool_calls[0]
 *           names get_time with JSON-object arguments. A template that
 *           merely mentions tools is recorded (`templateTools`) but never
 *           turns tools on (§13.1: tools off unless detected).
 * Every request re-runs the loopback/LAN rule, follows no redirect and has a
 * timeout; any failure is `ok:false` with the reason — never an exception.
 */
import { classifyEndpoint } from './endpoint.js';

export interface LocalCapabilities {
  endpoint: string;
  base: string;
  ok: boolean;
  model: string | null;
  tools: boolean;
  templateTools: boolean;
  nCtx: number | null;
  nCtxSource: 'slots' | 'props' | null;
  error?: string;
}

export type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>;

async function getJson(f: ProbeFetch, url: string, init: RequestInit, ms: number): Promise<{ status: number; json: unknown }> {
  try {
    const r = await f(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    try {
      return { status: r.status, json: JSON.parse(text) as unknown };
    } catch {
      return { status: r.status, json: null };
    }
  } catch (err) {
    return { status: 0, json: { error: (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name } };
  }
}

export async function probeLocalEndpoint(ep: { id: string; base: string; model: string }, o: { fetch?: ProbeFetch; forbiddenPorts?: readonly number[]; timeoutMs?: number; toolTimeoutMs?: number } = {}): Promise<LocalCapabilities> {
  const base: LocalCapabilities = { endpoint: ep.id, base: ep.base, ok: false, model: null, tools: false, templateTools: false, nCtx: null, nCtxSource: null };
  const v = classifyEndpoint(ep.base, o.forbiddenPorts);
  if (!v.ok) return { ...base, error: `refused:${v.why}` };
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  const ms = o.timeoutMs ?? 3_000;
  const health = await getJson(f, `${v.base}/health`, {}, ms);
  if (health.status === 0) return { ...base, error: `unreachable:${String((health.json as { error?: string } | null)?.error ?? 'error')}` };
  const slots = await getJson(f, `${v.base}/slots`, {}, ms);
  const props = await getJson(f, `${v.base}/props`, {}, ms);
  const models = await getJson(f, `${v.base}/v1/models`, {}, ms);
  const slotCtx = Array.isArray(slots.json) && typeof (slots.json[0] as { n_ctx?: unknown } | undefined)?.n_ctx === 'number' ? ((slots.json[0] as { n_ctx: number }).n_ctx) : null;
  const pj = props.json as { default_generation_settings?: { n_ctx?: unknown }; n_ctx?: unknown; chat_template?: unknown } | null;
  const propsCtx = typeof pj?.default_generation_settings?.n_ctx === 'number' ? pj.default_generation_settings.n_ctx : typeof pj?.n_ctx === 'number' ? pj.n_ctx : null;
  const model = ((models.json as { data?: Array<{ id?: unknown }> } | null)?.data?.[0]?.id as string | undefined) ?? null;
  const chat = await getJson(f, `${v.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model ?? ep.model,
      messages: [{ role: 'user', content: 'What time is it in UTC? Use the tool.' }],
      tools: [{ type: 'function', function: { name: 'get_time', description: 'Current time in a timezone', parameters: { type: 'object', properties: { tz: { type: 'string' } }, required: ['tz'] } } }],
      tool_choice: 'required',
      max_tokens: 128,
      temperature: 0,
    }),
  }, o.toolTimeoutMs ?? 120_000);
  const call = (chat.json as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> } }> } | null)?.choices?.[0]?.message?.tool_calls?.[0];
  let argsOk = false;
  try {
    const a = typeof call?.function?.arguments === 'string' ? (JSON.parse(call.function.arguments) as unknown) : call?.function?.arguments;
    argsOk = a !== null && typeof a === 'object' && !Array.isArray(a);
  } catch {
    argsOk = false;
  }
  return {
    ...base,
    ok: true,
    model: model ?? ep.model,
    tools: call?.function?.name === 'get_time' && argsOk,
    templateTools: typeof pj?.chat_template === 'string' && /tool/i.test(pj.chat_template),
    nCtx: slotCtx ?? propsCtx,
    nCtxSource: slotCtx !== null ? 'slots' : propsCtx !== null ? 'props' : null,
  };
}
