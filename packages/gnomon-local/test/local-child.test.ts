/**
 * gnomon-local (spec §13.1): the loopback/LAN rule, the compat allowlist
 * without cloud providers, argument repair, the text-tool fallback, the
 * streaming client and the agent loop — all against a FAKE in-process
 * OpenAI-compatible server (test/fake-openai.ts). Never a real model.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, buildRequest, classifyEndpoint, complete, COMPAT_ALLOWLIST, EndpointRefused, parseSessionConfig, parseTextToolCalls, repairArguments, rpcSession, surfaceTools, TOOLS } from '../src/index.js';
import { ENDPOINT_TABLE } from './endpoint-table.js';
import { fakeOpenAI, type FakeServer } from './fake-openai.js';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let srv: FakeServer | null = null;
let tmp: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratch = (): string => (tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-local-'))));

describe('G-SUB-06 (child copy): loopback/LAN only', () => {
  it.each(ENDPOINT_TABLE)('%s ⇒ %s', (base, want) => {
    const v = classifyEndpoint(base);
    expect(v.ok ? v.class : v.why).toBe(want);
  });
  it('refuses a forbidden port (the kernel web endpoint) and port 0', () => {
    expect(classifyEndpoint('http://127.0.0.1:4555', [4555])).toMatchObject({ ok: false, why: 'port' });
  });
  it('the client refuses a non-LAN base before any request', async () => {
    await expect(complete('https://api.anthropic.com', { stream: false })).rejects.toBeInstanceOf(EndpointRefused);
  });
  it('the session config refuses a public endpoint (fatal, never a fallback)', () => {
    const cfg = { schemaVersion: 'gnomon-local-session:v1', session: 'hsid:v1:x', cwd: '/tmp', endpoint: { base: 'http://8.8.8.8:8080', model: 'm', compat: 'llama.cpp' }, capabilities: { tools: true, nCtx: 8192 } };
    expect(() => parseSessionConfig(JSON.stringify(cfg))).toThrow(/public/);
  });
});

describe('compat allowlist: OpenAI-compatible local transports only, no cloud providers (§13.1)', () => {
  it('names exactly the local engines', () => {
    expect(Object.keys(COMPAT_ALLOWLIST).sort()).toEqual(['llama.cpp', 'lm-studio', 'mlx-lm', 'ollama', 'vllm']);
    for (const p of Object.values(COMPAT_ALLOWLIST)) expect(p).toMatchObject({ api: 'openai-completions', developerRole: false, store: false, maxTokensField: 'max_tokens' });
  });
  it('a config naming a cloud provider is refused', () => {
    for (const compat of ['openai', 'anthropic', 'google', 'bedrock', 'vertex', 'mistral', 'groq', 'openrouter']) {
      const cfg = { schemaVersion: 'gnomon-local-session:v1', session: 's', cwd: '/tmp', endpoint: { base: 'http://127.0.0.1:1', model: 'm', compat }, capabilities: { tools: false } };
      expect(() => parseSessionConfig(JSON.stringify(cfg))).toThrow(/allowlist/);
    }
  });
  it('the llama.cpp preset: system (never developer), no store, max_tokens, qwen thinking kwarg', () => {
    const b = buildRequest(COMPAT_ALLOWLIST['llama.cpp']!, { model: 'm', messages: [{ role: 'developer' as 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools: TOOLS, nativeTools: true, surface: 'full', maxTokens: 64, stream: true, thinking: false });
    expect((b.messages as Array<{ role: string }>)[0]!.role).toBe('system');
    expect(b).not.toHaveProperty('store');
    expect(b).not.toHaveProperty('max_completion_tokens');
    expect(b).toMatchObject({ max_tokens: 64, chat_template_kwargs: { enable_thinking: false }, stream_options: { include_usage: true } });
    expect(buildRequest(COMPAT_ALLOWLIST['llama.cpp']!, { model: 'm', messages: [], tools: TOOLS, nativeTools: false, surface: 'full', maxTokens: 1, stream: false })).not.toHaveProperty('tools');
  });
  it('tool surfaces: none ⇒ no tools, compact ⇒ names + types only', () => {
    expect(surfaceTools(TOOLS, 'none')).toEqual([]);
    const c = surfaceTools(TOOLS, 'compact').find((t) => t.name === 'write_file')!;
    expect(c.parameters).toEqual({ type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] });
  });
  it('zero runtime dependencies; no cloud SDK or cloud host anywhere in src/ (or dist/ when built)', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.dependencies).toBeUndefined();
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js)$/.test(f)) files.push(p);
      }
    };
    walk(path.join(PKG, 'src'));
    if (fs.existsSync(path.join(PKG, 'dist'))) walk(path.join(PKG, 'dist'));
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/@anthropic-ai|@google\/genai|@aws-sdk|openai\/|@mistralai|@earendil-works\/pi-ai|api\.openai\.com|generativelanguage|bedrock-runtime/);
      for (const m of s.matchAll(/from\s+'([^']+)'/g)) expect(m[1]!.startsWith('node:') || m[1]!.startsWith('./'), `${f}: ${m[1]}`).toBe(true);
    }
  });
});

describe('argument repair and the text-tool fallback (§13.1)', () => {
  it.each([
    ['{"path":"a.txt"}', false, []],
    ['```json\n{"path":"a.txt"}\n```', true, ['fence']],
    ["{'path': 'a.txt'}", true, ['single-quotes']],
    ['{path: "a.txt"}', true, ['unquoted-keys']],
    ['{"path":"a.txt",}', true, ['trailing-commas']],
    ['{"path":"a.txt"', true, ['balance']],
    ['"{\\"path\\":\\"a.txt\\"}"', false, []],
  ])('%s', (raw, repaired, steps) => {
    const r = repairArguments(raw);
    expect(r).toMatchObject({ ok: true, value: { path: 'a.txt' }, repaired });
    expect(r.steps).toEqual(steps);
  });
  it('a non-object never becomes a call', () => {
    expect(repairArguments('[1,2]').ok).toBe(false);
    expect(repairArguments('rm -rf /').ok).toBe(false);
    expect(repairArguments(42).ok).toBe(false);
  });
  it('parses <tool_call> blocks out of text', () => {
    const r = parseTextToolCalls('Sure.\n<tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>\n<tool_call>{name: "list_dir", arguments: {}}</tool_call>');
    expect(r.calls.map((c) => c.name)).toEqual(['read_file', 'list_dir']);
    expect(r.rest).toBe('Sure.');
  });
});

describe('the streaming client and the agent loop (fake server)', () => {
  it('accumulates streamed content and split tool-call arguments; usage from the usage chunk', async () => {
    srv = await fakeOpenAI({ script: [{ content: 'hello world', toolCalls: [{ name: 'read_file', arguments: '{"path":"README.md"}' }] }] });
    const deltas: string[] = [];
    const c = await complete(srv.base, { model: 'm', messages: [], stream: true }, { onDelta: (d) => deltas.push(d) });
    expect(deltas.join('')).toBe('hello world');
    expect(c.toolCalls).toEqual([{ id: 'call_1_0', name: 'read_file', arguments: '{"path":"README.md"}' }]);
    expect(c.usage).toEqual({ input: 100, output: 20 });
  });

  it('native tools: parallel calls run, results go back as tool messages, the run ends on a text reply', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'in.txt'), 'forty-two');
    srv = await fakeOpenAI({ script: [{ toolCalls: [{ name: 'read_file', arguments: '{"path":"in.txt"}' }, { name: 'write_file', arguments: "{'path': 'out.txt', 'content': 'ok'}" }] }, { content: 'All done.' }] });
    const evs: Array<Record<string, unknown>> = [];
    const a = new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'full', cwd, maxSteps: 8, maxTokens: 256, emit: (e) => evs.push(e) });
    await a.prompt('copy it');
    expect(fs.readFileSync(path.join(cwd, 'out.txt'), 'utf8')).toBe('ok');
    const types = evs.map((e) => e.type);
    expect(types[0]).toBe('agent_start');
    expect(types.at(-1)).toBe('agent_end');
    expect(evs.filter((e) => e.type === 'tool_execution_end').map((e) => e.isError)).toEqual([false, false]);
    expect(evs.find((e) => e.type === 'model_repair')).toMatchObject({ toolName: 'write_file', steps: ['single-quotes'] });
    expect(evs.at(-1)).toMatchObject({ stopReason: 'stop', usage: { input: 200, output: 40 } });
    const second = srv.requests[1]!.messages as Array<{ role: string; content: string }>;
    expect(second.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual(['forty-two', 'wrote 2 bytes to out.txt']);
    expect(srv.requests[0]!.tools).toBeDefined();
  });

  it('text-tool fallback: no native tools sent, calls parsed from <tool_call> text', async () => {
    const cwd = scratch();
    srv = await fakeOpenAI({ script: [{ content: '<tool_call>{"name":"write_file","arguments":{"path":"t.txt","content":"via text"}}</tool_call>' }, { content: 'ok' }] });
    const evs: Array<Record<string, unknown>> = [];
    const a = new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST.ollama!, nativeTools: false, surface: 'compact', cwd, maxSteps: 4, maxTokens: 64, emit: (e) => evs.push(e) });
    await a.prompt('write it');
    expect(fs.readFileSync(path.join(cwd, 't.txt'), 'utf8')).toBe('via text');
    expect(srv.requests[0]!.tools).toBeUndefined();
    expect(String((srv.requests[0]!.messages as Array<{ content: string }>)[0]!.content)).toMatch(/<tool_call>/);
    expect(String((srv.requests[1]!.messages as Array<{ content: string }>).at(-1)!.content)).toMatch(/^<tool_result name="write_file">/);
  });

  it('steer text is injected at the next step; maxSteps bounds the run', async () => {
    const cwd = scratch();
    srv = await fakeOpenAI({ script: [{ toolCalls: [{ name: 'list_dir', arguments: '{}' }] }, { toolCalls: [{ name: 'list_dir', arguments: '{}' }] }, { toolCalls: [{ name: 'list_dir', arguments: '{}' }] }] });
    const evs: Array<Record<string, unknown>> = [];
    const a = new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'full', cwd, maxSteps: 2, maxTokens: 64, emit: (e) => {
      evs.push(e);
      if (e.type === 'turn_start' && e.turn === 1) a.steer('also be brief');
    } });
    await a.prompt('look');
    expect((srv.requests[1]!.messages as Array<{ content: string }>).at(-1)!.content).toBe('also be brief');
    expect(evs.at(-1)).toMatchObject({ type: 'agent_end', stopReason: 'max_steps' });
  });

  it('rpc: prompt/get_state/unknown responses; capabilities announced first', async () => {
    srv = await fakeOpenAI({ script: [{ content: 'hi' }] });
    const cwd = scratch();
    const cfg = parseSessionConfig(JSON.stringify({ schemaVersion: 'gnomon-local-session:v1', session: 'hsid:v1:x', cwd, endpoint: { base: srv.base, model: 'm', compat: 'llama.cpp' }, capabilities: { tools: false, nCtx: 8192 }, surface: 'none' }));
    const evs: Array<Record<string, unknown>> = [];
    const { onLine, agent } = rpcSession(cfg, (e) => evs.push(e));
    expect(evs[0]).toMatchObject({ type: 'model_capabilities', backend: 'local', tools: false, ctx: 8192, textTools: false });
    onLine('{"id":"1","type":"prompt","message":"hello"}');
    onLine('{"id":"2","type":"bogus"}');
    onLine('not json');
    await new Promise((r) => setTimeout(r, 20));
    while (agent.running) await new Promise((r) => setTimeout(r, 10));
    expect(evs.filter((e) => e.type === 'response')).toEqual([
      { type: 'response', id: '1', command: 'prompt', success: true },
      { type: 'response', id: '2', command: 'bogus', success: false, error: 'unknown command bogus' },
      { type: 'response', command: 'unknown', success: false, error: 'malformed line' },
    ]);
    expect(evs.at(-1)).toMatchObject({ type: 'agent_end', stopReason: 'stop' });
  });
});
