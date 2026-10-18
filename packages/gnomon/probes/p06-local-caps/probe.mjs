// p06-local-caps — Arky P06 (spec §19.1 M1.0 P06, §13.2, §13.3; G-LCL-01..04).
// For each configured llama.cpp endpoint: n_ctx from /slots (and /props),
// tool-call capability, and the model id. Recorded, not failed (spec: "recorded,
// not failed") — no endpoint present is verdict partial with that reason.
//
// Endpoints: P06_ENDPOINTS="http://127.0.0.1:8080,http://10.0.0.5:8080"
// (default http://127.0.0.1:8080). Loopback/LAN only, per the §13 rule.
// Optional: P06_GGUF=/path/model.gguf starts llama-server (from PATH or
// P06_LLAMA_SERVER) on an ephemeral loopback port with --jinja for the run and
// stops it after.
//
// Tool-call detection, two signals:
//   template — /props chat_template_caps.supports_tools (newer llama-server) or
//              the chat template mentions tools;
//   live     — one /v1/chat/completions with a single `get_time` tool and
//              tool_choice "required"; capable iff the reply has tool_calls[0]
//              naming get_time with JSON-parseable arguments.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

export const specRefs = ['§13.2', '§13.3', '§19.1 M1.0 P06', 'G-LCL-01', 'G-LCL-02', 'model.probe', 'model.capabilities'];

// Loopback/LAN per the §13 rule, on a parsed address (net.isIP), never a
// hostname prefix (a regex on the string admitted e.g. "10.evil.example").
function loopbackOrLan(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (h === 'localhost') return true;
  const v = net.isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  if (v === 6) return h === '::1' || /^f[cd]/i.test(h) || /^fe[89ab]/i.test(h);
  return false;
}

async function getJson(url, init = {}, timeoutMs = 10_000) {
  const ctl = AbortSignal.timeout(timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON body
    }
    return { status: r.status, json, text: json ? undefined : text.slice(0, 300) };
  } catch (e) {
    return { status: 0, error: e.cause?.code ?? e.name ?? String(e) };
  }
}

async function probeEndpoint(base) {
  const host = new URL(base).hostname;
  if (!loopbackOrLan(host)) return { base, refused: 'not loopback/LAN (§13 rule)' };
  const health = await getJson(`${base}/health`, {}, 3000);
  if (health.status === 0) return { base, present: false, error: health.error };
  const props = await getJson(`${base}/props`);
  const slots = await getJson(`${base}/slots`);
  const models = await getJson(`${base}/v1/models`);
  const tmpl = props.json?.chat_template ?? '';
  const caps = props.json?.chat_template_caps ?? null;
  const slotCtx = Array.isArray(slots.json) ? slots.json.map((s) => s.n_ctx) : null;
  const t0 = Date.now();
  const chat = await getJson(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What time is it in UTC? Use the tool.' }],
      tools: [{ type: 'function', function: { name: 'get_time', description: 'Current time in a timezone', parameters: { type: 'object', properties: { tz: { type: 'string' } }, required: ['tz'] } } }],
      tool_choice: 'required',
      max_tokens: 128,
      temperature: 0,
    }),
  }, 120_000);
  const call = chat.json?.choices?.[0]?.message?.tool_calls?.[0];
  let argsOk = false;
  try {
    argsOk = call ? typeof JSON.parse(call.function?.arguments ?? 'x') === 'object' : false;
  } catch {
    argsOk = false;
  }
  return {
    base,
    present: true,
    health: health.json ?? health.status,
    model: models.json?.data?.[0]?.id ?? props.json?.model_path?.split('/').pop() ?? null,
    nCtx: {
      slots: slotCtx,
      slotsStatus: slots.status,
      propsDefault: props.json?.default_generation_settings?.n_ctx ?? props.json?.n_ctx ?? null,
    },
    totalSlots: props.json?.total_slots ?? (slotCtx ? slotCtx.length : null),
    tools: {
      templateCaps: caps,
      templateMentionsTools: /tool/i.test(tmpl),
      live: { status: chat.status, toolCall: call ? { name: call.function?.name, argsJson: argsOk } : null, finishReason: chat.json?.choices?.[0]?.finish_reason ?? null, error: chat.json?.error?.message ?? chat.error, ms: Date.now() - t0 },
      capable: !!(call && call.function?.name === 'get_time' && argsOk),
    },
    buildInfo: props.json?.build_info ?? null,
  };
}

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

function which(bin) {
  const r = spawnSync('/usr/bin/which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export default async function probe(ctx) {
  const llamaServer = process.env.P06_LLAMA_SERVER ?? (ctx.platform === 'win32' ? null : which('llama-server'));
  const llamaVersion = llamaServer ? (spawnSync(llamaServer, ['--version'], { encoding: 'utf8' }).stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' | ') : null;
  const endpoints = (process.env.P06_ENDPOINTS ?? 'http://127.0.0.1:8080').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  let spawned = null;
  if (process.env.P06_GGUF) {
    if (!llamaServer || !existsSync(process.env.P06_GGUF)) return { verdict: 'partial', evidence: { blocked: 'P06_GGUF set but llama-server or the model file is missing' } };
    const port = await freePort();
    const child = spawn(llamaServer, ['-m', process.env.P06_GGUF, '--host', '127.0.0.1', '--port', String(port), '--jinja', '-c', '8192'], { stdio: 'ignore' });
    spawned = { child, base: `http://127.0.0.1:${port}` };
    for (let i = 0; i < 240; i++) {
      const h = await getJson(`${spawned.base}/health`, {}, 1000);
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    endpoints.unshift(spawned.base);
  }
  try {
    const results = [];
    for (const e of endpoints) results.push(await probeEndpoint(e));
    const present = results.filter((r) => r.present);
    const toolVersions = llamaVersion ? { llamaServer: llamaVersion } : {};
    if (!present.length) {
      return {
        verdict: 'partial',
        evidence: {
          reason: 'no endpoint present — recorded, not failed (§19.1 P06)',
          endpointsTried: results,
          llamaServerInstalled: llamaServer ? llamaServer : false,
          note: 'set P06_ENDPOINTS to the configured endpoints, or P06_GGUF to a model file to let the probe start llama-server itself',
        },
        toolVersions,
      };
    }
    return {
      verdict: 'pass',
      evidence: { endpoints: results, spawnedByProbe: spawned ? spawned.base : false, platform: ctx.platform, recordedNotFailed: true },
      toolVersions,
    };
  } finally {
    if (spawned) spawned.child.kill('SIGTERM');
  }
}
