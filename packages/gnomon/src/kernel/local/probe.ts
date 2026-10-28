/**
 * @symbol #local-runner
 *
 * The local capability probe (spec §13.1 "tool-capability probe at
 * model.capabilities", §13.2; the P06 probe's method, kernel-side): for one
 * configured endpoint —
 *   n_ctx   from llama.cpp `/slots` (the first slot), else `/props`
 *           default_generation_settings.n_ctx, else Ollama's `/api/show`
 *           `num_ctx` parameter (a Modelfile's), else the context_length of
 *           the model as loaded in Ollama's `/api/ps`, else unknown (null);
 *   model   `/v1/models` data[0].id, else the configured id;
 *   tools   LIVE only: one completion with a single `get_time` tool and
 *           tool_choice "required"; capable iff the reply's tool_calls[0]
 *           names get_time with JSON-object arguments. A template that
 *           merely mentions tools is recorded (`templateTools`) but never
 *           turns tools on (§13.1: tools off unless detected).
 * Every request re-runs the loopback/LAN rule, follows no redirect and has a
 * timeout; every body is stream-read into a buffer capped at PROBE_BODY_CAP
 * (1 MiB) and the request is aborted past it (Aegis M1, round 2); any failure
 * is `ok:false` with the reason — never an exception. The model id is the
 * CONFIGURED one when /v1/models lists it, else data[0].id when it is a
 * string of ≤ 128 chars, else the configured one (Aegis L2).
 *
 * @symbol #local-tool-tier
 * Slice C4'a: the tool-skill probe. T1 is the get_time check above
 * (unchanged; a fail is tools:false, tier 0). After a successful T1 the
 * lane runs probeToolSkill in the background on a cache miss: T2 two
 * requests (lookup_city{code:"K7"}, then after a FIXED tool result
 * get_time{tz:"Europe/Lisbon"}), T3 sixteen tools of which only
 * archive_note{id:"n-42"} passes, T4 one tool with a nested object, an array
 * of objects and an enum whose args must pass validateBrokeredArgs against
 * the full schema AND equal the expected values. Constant prompts,
 * temperature 0, seed 0, max_tokens 128; each test a pure predicate over the
 * reply JSON (parsed, never executed) under the same body cap; 120 s per
 * test, 3 min in all; it stops at the first failure (an error or a timeout
 * is a failure). Grade: T1 → 1, T1-T3 → 2, all four → 3. fingerprintOf is
 * the cache key's model part (llama.cpp /props model_path + the model id,
 * else Ollama's /api/tags digest). The window is the lane's input, never
 * model_info.*.context_length (the trained maximum overclaims).
 */
import { canonicalJson } from '@a-company/gnomon-contracts';
import { classifyEndpoint } from './endpoint.js';
import { validateBrokeredArgs } from './tool-broker.js';
import { skillTier, type ToolTier } from './tool-tier.js';

export interface LocalCapabilities {
  endpoint: string;
  base: string;
  ok: boolean;
  model: string | null;
  tools: boolean;
  templateTools: boolean;
  nCtx: number | null;
  nCtxSource: 'slots' | 'props' | 'ollama-show' | 'ollama-ps' | null;
  error?: string;
}

export const PROBE_BODY_CAP = 1 << 20;

export type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>;

async function getJson(f: ProbeFetch, url: string, init: RequestInit, ms: number): Promise<{ status: number; json: unknown }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(new Error('timeout')), ms);
    let text = '';
    let status = 0;
    try {
      const r = await f(url, { ...init, redirect: 'error', signal: ctl.signal });
      status = r.status;
      const dec = new TextDecoder();
      let n = 0;
      for await (const part of (r.body ?? []) as AsyncIterable<Uint8Array>) {
        n += part.length;
        if (n > PROBE_BODY_CAP) {
          ctl.abort(new Error('body cap'));
          return { status: 0, json: { error: 'body-cap' } };
        }
        text += dec.decode(part, { stream: true });
      }
    } finally {
      clearTimeout(t);
    }
    const r = { status };
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
  const ids = ((models.json as { data?: Array<{ id?: unknown }> } | null)?.data ?? []).map((d) => d?.id).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128);
  const model = ids.includes(ep.model) ? ep.model : (ids[0] ?? null);
  // Ollama serves neither /slots nor /props: its context is the model's num_ctx parameter, else the loaded size
  let ollamaCtx: number | null = null;
  let ollamaSource: 'ollama-show' | 'ollama-ps' | null = null;
  if (slotCtx === null && propsCtx === null) {
    const show = await getJson(f, `${v.base}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model ?? ep.model }) }, ms);
    const params = (show.json as { parameters?: unknown } | null)?.parameters;
    const m = typeof params === 'string' ? /^\s*num_ctx\s+(\d{1,7})\s*$/m.exec(params) : null;
    if (m) {
      ollamaCtx = Number(m[1]);
      ollamaSource = 'ollama-show';
    } else {
      const ps = await getJson(f, `${v.base}/api/ps`, {}, ms);
      const run = ((ps.json as { models?: Array<{ name?: unknown; model?: unknown; context_length?: unknown }> } | null)?.models ?? []).find((x) => x?.name === (model ?? ep.model) || x?.model === (model ?? ep.model));
      if (typeof run?.context_length === 'number' && Number.isInteger(run.context_length) && run.context_length > 0) {
        ollamaCtx = run.context_length;
        ollamaSource = 'ollama-ps';
      }
    }
  }
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
    nCtx: slotCtx ?? propsCtx ?? ollamaCtx,
    nCtxSource: slotCtx !== null ? 'slots' : propsCtx !== null ? 'props' : ollamaSource,
  };
}

// ── slice C4'a (#local-tool-tier): the tool-skill probe T2-T4 and the model fingerprint ─────────────────────────────

/** Each tier test is capped at this long (T2's two requests share it). */
export const TIER_TEST_TIMEOUT_MS = 120_000;
/** The whole skill probe (T2-T4) is capped at this long. */
export const TIER_PROBE_TIMEOUT_MS = 3 * 60_000;

type ProbeTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ProbeTool => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });

const T2_TOOLS: readonly ProbeTool[] = Object.freeze([
  fn('lookup_city', 'Look up a city by its short code; returns the city and its IANA timezone', { code: { type: 'string' } }, ['code']),
  fn('get_time', 'Current time in an IANA timezone', { tz: { type: 'string' } }, ['tz']),
]);
const T2_PROMPT = 'What is the local time in the city with code K7? First look the city up, then get the time in its timezone. Use the tools.';
const T2_CALL_ID = 'call_t2_1';
/** The fixed tool result T2's second request carries (never the model's own output: the bodies stay byte-stable). */
export const T2_TOOL_RESULT = '{"code":"K7","city":"Lisbon","tz":"Europe/Lisbon"}';

const DECOYS: ReadonlyArray<[string, string]> = [
  ['create_note', 'Create a new note'], ['delete_note', 'Delete a note permanently'], ['list_notes', 'List all notes'], ['read_note', 'Read one note'],
  ['rename_note', 'Rename a note'], ['tag_note', 'Add a tag to a note'], ['share_note', 'Share a note with someone'], ['pin_note', 'Pin a note to the top'],
  ['restore_note', 'Restore a note from the archive'], ['export_notes', 'Export notes to a file'], ['search_notes', 'Search notes by text'], ['copy_note', 'Copy a note'],
  ['lock_note', 'Lock a note against edits'], ['move_note', 'Move a note to a folder'], ['count_notes', 'Count the notes'], ['archive_note', 'Move a note to the archive'],
];
/** T3: sixteen tools (fifteen decoys and archive_note). */
const T3_TOOLS: readonly ProbeTool[] = Object.freeze(DECOYS.map(([n, d]) => fn(n, d, { id: { type: 'string', description: 'the note id' } }, ['id'])));
const T3_PROMPT = 'Archive the note with id n-42. Use exactly one tool.';

/** T4's one tool: a nested object, an array of objects and an enum (validated against this FULL schema). */
export const T4_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: {
    title: { type: 'string' },
    when: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24-hour' } }, required: ['date', 'time'], additionalProperties: false },
    attendees: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string', enum: ['organizer', 'guest'] } }, required: ['name', 'role'], additionalProperties: false } },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
  },
  required: ['title', 'when', 'attendees', 'priority'],
  additionalProperties: false,
});
const T4_TOOLS: readonly ProbeTool[] = Object.freeze([{ type: 'function', function: { name: 'create_event', description: 'Create a calendar event', parameters: T4_SCHEMA as Record<string, unknown> } }]);
const T4_PROMPT = 'Create a calendar event titled "Design review" on 2026-03-14 at 15:00 with priority high. Attendees: Ana as organizer and Ben as guest. Use the tool.';
export const T4_EXPECTED: Readonly<Record<string, unknown>> = Object.freeze({ title: 'Design review', when: { date: '2026-03-14', time: '15:00' }, attendees: [{ name: 'Ana', role: 'organizer' }, { name: 'Ben', role: 'guest' }], priority: 'high' });

/** One request body of the skill probe: a constant prompt, temperature 0, seed 0, max_tokens 128, tool_choice required. */
function tierBody(model: string, messages: unknown[], tools: readonly ProbeTool[]): string {
  return JSON.stringify({ model, messages, tools, tool_choice: 'required', max_tokens: 128, temperature: 0, seed: 0 });
}

/** The request bodies of T2 (two), T3 and T4 for `model` (exported: tests check they are byte-stable). */
export function tierProbeBodies(model: string): { t2a: string; t2b: string; t3: string; t4: string } {
  const user = { role: 'user', content: T2_PROMPT };
  return {
    t2a: tierBody(model, [user], T2_TOOLS),
    t2b: tierBody(model, [user, { role: 'assistant', content: '', tool_calls: [{ id: T2_CALL_ID, type: 'function', function: { name: 'lookup_city', arguments: '{"code":"K7"}' } }] }, { role: 'tool', tool_call_id: T2_CALL_ID, content: T2_TOOL_RESULT }], T2_TOOLS),
    t3: tierBody(model, [{ role: 'user', content: T3_PROMPT }], T3_TOOLS),
    t4: tierBody(model, [{ role: 'user', content: T4_PROMPT }], T4_TOOLS),
  };
}

/**
 * The tool calls of a completion reply ({name, args} with JSON-object args), or null when the reply holds none or a
 * malformed one. Model output is only parsed, never executed.
 */
export function replyCalls(json: unknown): Array<{ name: string; args: Record<string, unknown> }> | null {
  const calls = (json as { choices?: Array<{ message?: { tool_calls?: unknown } }> } | null)?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 32) return null;
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const c of calls) {
    const f = (c as { function?: { name?: unknown; arguments?: unknown } } | null)?.function;
    if (!f || typeof f.name !== 'string') return null;
    let a: unknown = f.arguments;
    if (typeof a === 'string') {
      try {
        a = JSON.parse(a);
      } catch {
        return null;
      }
    }
    if (a === null || typeof a !== 'object' || Array.isArray(a)) return null;
    out.push({ name: f.name, args: a as Record<string, unknown> });
  }
  return out;
}

const sameJson = (a: unknown, b: unknown): boolean => {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
};
/** Exactly one call, of `name`, whose args equal `args`. */
const exactlyOne = (json: unknown, name: string, args: unknown): boolean => {
  const c = replyCalls(json);
  return c !== null && c.length === 1 && c[0]!.name === name && sameJson(c[0]!.args, args);
};

/** The pure predicates over each reply (exported for tests). */
export const TIER_PREDICATES = Object.freeze({
  t2a: (json: unknown): boolean => exactlyOne(json, 'lookup_city', { code: 'K7' }),
  t2b: (json: unknown): boolean => exactlyOne(json, 'get_time', { tz: 'Europe/Lisbon' }),
  t3: (json: unknown): boolean => exactlyOne(json, 'archive_note', { id: 'n-42' }),
  t4: (json: unknown): boolean => {
    const c = replyCalls(json);
    if (c === null || c.length !== 1 || c[0]!.name !== 'create_event') return false;
    return validateBrokeredArgs(T4_SCHEMA as Record<string, unknown>, c[0]!.args) === null && sameJson(c[0]!.args, T4_EXPECTED);
  },
});

const TIMEOUT = Symbol('timeout');
const UNREACHABLE = Symbol('unreachable');

export interface ToolSkill {
  /** how many of T1..T4 passed, in order (the run stops at the first failure) */
  passed: number;
  skill: ToolTier;
  /** the first test that failed, or null when all passed */
  failed: 't1' | 't2' | 't3' | 't4' | null;
  /** why it failed (`timeout`, `unreachable`, `wrong-call`, `error`, `refused:<why>`) */
  why?: string;
}

/**
 * T2-T4 after a T1 result (the existing get_time check: `t1` false is tier 0 with no request made). Each test is a pure
 * predicate over the reply JSON under the probe's body cap; each is capped at TIER_TEST_TIMEOUT_MS and the whole run at
 * TIER_PROBE_TIMEOUT_MS; it stops at the first failure, and an error or a timeout is a failure. Never throws.
 */
export async function probeToolSkill(ep: { base: string; model: string }, o: { t1: boolean; fetch?: ProbeFetch; forbiddenPorts?: readonly number[]; testTimeoutMs?: number; totalTimeoutMs?: number; now?: () => number }): Promise<ToolSkill> {
  const grade = (passed: number, failed: ToolSkill['failed'], why?: string): ToolSkill => ({ passed, skill: skillTier(passed), failed, ...(why ? { why } : {}) });
  if (!o.t1) return grade(0, 't1', 'wrong-call');
  const v = classifyEndpoint(ep.base, o.forbiddenPorts);
  if (!v.ok) return grade(1, 't2', `refused:${v.why}`);
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  const now = o.now ?? Date.now;
  const end = now() + (o.totalTimeoutMs ?? TIER_PROBE_TIMEOUT_MS);
  const bodies = tierProbeBodies(ep.model);
  const post = async (body: string, testEnd: number): Promise<unknown> => {
    const until = Math.min(testEnd, end);
    const ms = until - now();
    if (ms <= 0) return TIMEOUT;
    const r = await getJson(f, `${v.base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, ms);
    if (r.status === 0) return now() >= until || (r.json as { error?: string } | null)?.error === 'AbortError' ? TIMEOUT : UNREACHABLE;
    return r.json;
  };
  const one = async (body: string, pred: (j: unknown) => boolean, testEnd: number): Promise<true | string> => {
    const a = await post(body, testEnd);
    if (a === TIMEOUT) return 'timeout';
    if (a === UNREACHABLE) return 'unreachable';
    return pred(a) ? true : 'wrong-call';
  };
  const steps: Array<{ id: 't2' | 't3' | 't4'; run: (testEnd: number) => Promise<true | string> }> = [
    { id: 't2', run: async (te) => {
      const a = await one(bodies.t2a, TIER_PREDICATES.t2a, te);
      return a === true ? one(bodies.t2b, TIER_PREDICATES.t2b, te) : a;
    } },
    { id: 't3', run: (te) => one(bodies.t3, TIER_PREDICATES.t3, te) },
    { id: 't4', run: (te) => one(bodies.t4, TIER_PREDICATES.t4, te) },
  ];
  let passed = 1;
  for (const s of steps) {
    let r: true | string;
    try {
      r = await s.run(now() + (o.testTimeoutMs ?? TIER_TEST_TIMEOUT_MS));
    } catch {
      r = 'error';
    }
    if (r !== true) return grade(passed, s.id, r);
    passed++;
  }
  return grade(passed, null);
}
/** The longest fingerprint kept. */
export const FINGERPRINT_MAX = 512;

/**
 * The model's fingerprint (the tier cache key's last part), or null when the endpoint names none: llama.cpp's /props
 * model_path plus the model id; else Ollama's /api/tags digest of the model. Never throws.
 */
export async function fingerprintOf(ep: { base: string; model: string }, o: { fetch?: ProbeFetch; forbiddenPorts?: readonly number[]; timeoutMs?: number } = {}): Promise<string | null> {
  const v = classifyEndpoint(ep.base, o.forbiddenPorts);
  if (!v.ok) return null;
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  const ms = o.timeoutMs ?? 3_000;
  const ok = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 320 && !/[\u0000-\u001f\u007f]/.test(s);
  const props = await getJson(f, `${v.base}/props`, {}, ms);
  const mp = (props.json as { model_path?: unknown } | null)?.model_path;
  if (props.status >= 200 && props.status < 300 && ok(mp)) return `llama.cpp:${mp}|${ep.model}`.slice(0, FINGERPRINT_MAX);
  const tags = await getJson(f, `${v.base}/api/tags`, {}, ms);
  const models = (tags.json as { models?: unknown } | null)?.models;
  if (tags.status >= 200 && tags.status < 300 && Array.isArray(models)) {
    const m = models.find((x) => (x as { name?: unknown } | null)?.name === ep.model || (x as { model?: unknown } | null)?.model === ep.model) as { digest?: unknown } | undefined;
    if (m && typeof m.digest === 'string' && /^(?:sha256:)?[0-9a-f]{12,64}$/.test(m.digest)) return `ollama:${m.digest}`;
  }
  return null;
}
