/**
 * #local-runner (spec §13, §3.3, §10 laws 1 and 7; M1.8 slice 1) against a
 * FAKE in-process OpenAI-compatible server (packages/gnomon-local/test/
 * fake-openai.ts). Never a real model. Platform-independent: nothing here
 * spawns a session child (the routing/fallback paths refuse before spawn).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { classifyEndpoint as childClassify, COMPAT_ALLOWLIST, parseSessionConfig, rpcSession } from '../../gnomon-local/src/index.js';
import { ENDPOINT_TABLE } from '../../gnomon-local/test/endpoint-table.js';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { classifyEndpoint } from '../src/kernel/local/endpoint.js';
import { assertNotClaude, LOCAL_COMPAT_NAMES, validateLocalEndpoints } from '../src/kernel/local/config.js';
import { probeLocalEndpoint } from '../src/kernel/local/probe.js';
import { capability, routeModel } from '../src/kernel/local/routing.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { LocalUsageMeter, parseLocalLine } from '../src/adapters/local/runner.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';

const HUMAN = 'p:abcdefgh/founder';
const FAKE_PIN = { node: process.execPath, nodeSha256: '0'.repeat(64), dir: '/x/gnomon-local/dist', treeSha256: '0'.repeat(64), entry: 'cli.js' };
let srv: FakeServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

function lane(config: ConstructorParameters<typeof LocalLane>[0]['config']) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const cards: Array<Record<string, unknown>> = [];
  const broker = { raise: async (i: Record<string, unknown>) => (cards.push(i), { cardId: `card:01HZZZZZZZZZZZZZZZZZZZZZZ${cards.length}` }) };
  const children = { intend: async () => { throw new Error('no spawn expected'); }, track: async () => undefined, stop: async () => false };
  const l = new LocalLane({ sessionPath: null, pathDenies: [], log, children: children as never, fuse, broker: broker as never, home: '/nonexistent-gnomon-home', kernelPrincipal: 'p:abcdefgh/kernel', sock: '/tmp/x.sock', ...(config ? { config } : {}) });
  return { l, rows, cards, fuse };
}
const req = (model: string) => ({ principal: HUMAN, principalClass: 'human', attended: true, cwd: process.cwd(), model });

describe('G-SUB-06: gnomon-local endpoints are loopback/LAN only (kernel and child hold ONE table)', () => {
  it.each(ENDPOINT_TABLE)('%s ⇒ %s (forbidden %j; both copies)', (base, want, ports) => {
    const k = classifyEndpoint(base, ports);
    const c = childClassify(base, ports);
    expect(k.ok ? k.class : k.why).toBe(want);
    expect(c).toEqual(k);
  });
  it('a configured public endpoint refuses every local open BILLING_REFUSED, before any probe or permit', async () => {
    const { l, rows } = lane({ endpoints: [{ id: 'cloud', base: 'https://api.anthropic.com', model: 'x', compat: 'llama.cpp' }] });
    const e = await l.open(req('local'), async () => null).catch((x: unknown) => x);
    expect((e as RefusedError).refusal.code).toBe('BILLING_REFUSED');
    expect(rows.map((r) => r.kind)).toEqual(['session.refused']);
    expect(() => validateLocalEndpoints({ endpoints: [{ id: 'a', base: 'http://127.0.0.1:1', model: 'm', compat: 'openai' }] }, [])).toThrow(/not a local transport/);
  });
  it('the compat names are the child allowlist (no cloud provider)', () => {
    expect([...LOCAL_COMPAT_NAMES].sort()).toEqual(Object.keys(COMPAT_ALLOWLIST).sort());
  });
  it('law 7: claude never runs under a local permit (runner named claude ⇒ PERMIT_REQUIRED)', () => {
    for (const r of [{ command: '/usr/local/bin/claude' }, { command: process.execPath, args: ['/x/claude'] }, { command: process.execPath, args: ['/h/bin/claude-0123456789abcdef0123'] }]) {
      expect(() => assertNotClaude(r)).toThrow(/claude never runs/);
    }
    expect(() => assertNotClaude({ command: process.execPath, args: ['/x/gnomon-local/dist/cli.js'] })).not.toThrow();
  });
  it('Aegis L3: realpath before the check (a symlink named gnomon-local → claude) and any @anthropic-ai/claude-code segment', () => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lr-')));
    try {
      fs.writeFileSync(path.join(d, 'claude'), '');
      fs.symlinkSync(path.join(d, 'claude'), path.join(d, 'gnomon-local'));
      expect(() => assertNotClaude({ command: path.join(d, 'gnomon-local') })).toThrow(/claude never runs/);
      expect(() => assertNotClaude({ command: process.execPath, args: ['/u/lib/node_modules/@anthropic-ai/claude-code/cli.js'] })).toThrow(/claude never runs/);
      expect(() => assertNotClaude({ command: '/Users/u/.local/share/claude/versions/2.1.302' })).toThrow(/claude never runs/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('§13.2 probe + §13.3 routing (fake endpoint)', () => {
  it('tools only when a live tool call works; n_ctx from /slots, else /props', async () => {
    srv = await fakeOpenAI({ tools: true, nCtx: 16384 });
    expect(await probeLocalEndpoint({ id: 'e', base: srv.base, model: 'm' })).toMatchObject({ ok: true, tools: true, nCtx: 16384, nCtxSource: 'slots', model: 'fake-qwen-7b-q4' });
    await srv.close();
    srv = await fakeOpenAI({ tools: false, slots: false, nCtx: 4096 });
    expect(await probeLocalEndpoint({ id: 'e', base: srv.base, model: 'm' })).toMatchObject({ ok: true, tools: false, nCtx: 4096, nCtxSource: 'props' });
    expect(await probeLocalEndpoint({ id: 'e', base: 'http://127.0.0.1:9', model: 'm' })).toMatchObject({ ok: false });
  });
  it('Ollama (no /slots, no /props): n_ctx from /api/show num_ctx, else the loaded context in /api/ps, else unknown', async () => {
    const ollama = (show: string, ps: unknown): ((u: string, i: RequestInit) => Promise<Response>) => async (u) => {
      const p = new URL(u).pathname;
      const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (p === '/v1/models') return json(200, { data: [{ id: 'qwen3.5-9b-16k' }] });
      if (p === '/api/show') return json(200, { parameters: show });
      if (p === '/api/ps') return json(200, ps);
      if (p === '/v1/chat/completions') return json(200, { choices: [{ message: { tool_calls: [{ function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }] } }] });
      return new Response('404 page not found', { status: 404 });
    };
    const ep = { id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5-9b-16k' };
    expect(await probeLocalEndpoint(ep, { fetch: ollama('top_k                          20\nnum_ctx                        16384\ntemperature 1', { models: [] }) })).toMatchObject({ ok: true, tools: true, nCtx: 16384, nCtxSource: 'ollama-show' });
    expect(await probeLocalEndpoint(ep, { fetch: ollama('temperature 1', { models: [{ name: 'qwen3.5-9b-16k', context_length: 4096 }] }) })).toMatchObject({ nCtx: 4096, nCtxSource: 'ollama-ps' });
    expect(await probeLocalEndpoint(ep, { fetch: ollama('temperature 1', { models: [{ name: 'other', context_length: 4096 }] }) })).toMatchObject({ nCtx: null, nCtxSource: null });
  });
  it('Aegis L2 / reviewer: the configured model id wins when /v1/models lists it; else data[0] (string ≤ 128)', async () => {
    srv = await fakeOpenAI({ tools: true });
    expect((await probeLocalEndpoint({ id: 'e', base: srv.base, model: 'fake-qwen-7b-q4' })).model).toBe('fake-qwen-7b-q4');
    expect((await probeLocalEndpoint({ id: 'e', base: srv.base, model: 'not-listed' })).model).toBe('fake-qwen-7b-q4');
  });
  it('Aegis M1: a probe body is capped (an endpoint streaming forever is aborted, ok:false, bounded time)', async () => {
    const s = http.createServer((req, res) => {
      if (req.url === '/health') return res.end('{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      const pump = (): void => {
        while (!res.destroyed && res.write(chunk));
        if (!res.destroyed) res.once('drain', pump);
      };
      pump();
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    try {
      const t0 = Date.now();
      const caps = await probeLocalEndpoint({ id: 'e', base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, model: 'm' }, { timeoutMs: 20_000, toolTimeoutMs: 20_000 });
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(caps.nCtx).toBeNull();
      expect(caps.tools).toBe(false);
    } finally {
      s.closeAllConnections();
      s.close();
    }
  });
  it('routing table', () => {
    const caps = { endpoint: 'e', base: 'b', ok: true, model: 'm', tools: true, templateTools: true, nCtx: 8192, nCtxSource: 'slots' as const };
    expect(routeModel('local', capability(caps, 8192, false), true)).toEqual({ chosen: 'local', reason: 'capable', tools: 'native' });
    expect(routeModel('local', capability({ ...caps, tools: false }, 8192, true), true)).toMatchObject({ chosen: 'local', tools: 'text' });
    expect(routeModel('local', capability({ ...caps, tools: false }, 8192, false), true)).toEqual({ chosen: 'fallback', reason: 'no-tools' });
    expect(routeModel('local', capability({ ...caps, nCtx: 4096 }, 8192, false), true)).toEqual({ chosen: 'fallback', reason: 'ctx-below-floor' });
    expect(routeModel('local', capability({ ...caps, nCtx: null }, 8192, false), true)).toEqual({ chosen: 'fallback', reason: 'ctx-unknown' });
    expect(routeModel('local', capability(caps, 8192, false), false)).toEqual({ chosen: 'fallback', reason: 'no-runner' });
    expect(routeModel('any', capability(null, 8192, false), true)).toEqual({ chosen: 'claude', reason: 'no-endpoint' });
    expect(routeModel('claude', capability(caps, 8192, false), true)).toEqual({ chosen: 'claude', reason: 'declared-claude' });
  });

  it('G-LCL-02: an incapable endpoint ⇒ a fallback card + MODEL_UNAVAILABLE{cardId}, and no spawn', async () => {
    srv = await fakeOpenAI({ tools: false });
    const { l, rows, cards } = lane({ endpoints: [{ id: 'llama', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: FAKE_PIN });
    const e = (await l.open(req('local'), async () => null).catch((x: unknown) => x)) as RefusedError;
    expect(e.refusal.code).toBe('MODEL_UNAVAILABLE');
    expect(e.refusal.data).toMatchObject({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZ1', why: 'no-tools' });
    expect(cards[0]).toMatchObject({ kind: 'fallback', requestedBy: HUMAN, detail: { task: 'session.open', reason: 'no-tools', estimate: { backend: 'claude-code' } } });
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toEqual(['model.probe', 'model.capabilities', 'model.fallback.requested']);
    expect(kinds.some((k) => k.startsWith('permit.') || k === 'session.spawned')).toBe(false);
  });

  it('G-LCL-03: the card\'s fallback-cloud decision opens Claude for the same requester; deny opens nothing (S7)', async () => {
    const { l, rows, cards } = lane(undefined);
    const opened: Array<Record<string, unknown>> = [];
    await l.open(req('local'), async (r) => opened.push(r as never)).catch(() => undefined);
    const effect = cards[0]!.effect as (d: string) => Promise<void>;
    await effect('deny');
    expect(opened).toEqual([]);
    await effect('fallback-cloud');
    expect(opened).toEqual([{ ...req('local'), backend: 'claude-code', model: 'claude' }]);
    expect(rows.filter((r) => r.kind === 'model.fallback.decided').map((r) => r.payload.decision)).toEqual(['deny', 'fallback-cloud']);
  });

  it('any + no capable local model ⇒ session.routed{chosen:claude}, back to the Claude path; contradictions refused', async () => {
    const { l, rows } = lane(undefined);
    expect(await l.open(req('any'), async () => null)).toBeNull();
    expect(rows.at(-1)).toMatchObject({ kind: 'session.routed', payload: { declared: 'any', chosen: 'claude', reason: 'no-endpoint' } });
    await expect(l.open({ ...req('local'), backend: 'claude-code' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
  });
  it('an explicit backend pins the route: backend local + any never falls through to Claude (fallback card instead)', async () => {
    const { l, cards } = lane(undefined);
    await expect(l.open({ ...req('any'), backend: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'MODEL_UNAVAILABLE' } });
    expect(cards).toHaveLength(1);
  });
});

describe('G-ADP-02: a transcript CAPTURED from gnomon-local (rpcSession × fake endpoint) replays through the driver', () => {
  it('kinds are tolerant; usage is charged once (messages, then only the remainder)', async () => {
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-adp-')));
    srv = await fakeOpenAI({ script: [{ content: "I'll write it.", toolCalls: [{ name: 'write_file', arguments: "{'path': 'out.txt', 'content': 'ok'}" }] }, { content: 'Done.' }] });
    const lines: string[] = [];
    const cfg = parseSessionConfig(JSON.stringify({ schemaVersion: 'gnomon-local-session:v1', session: 'hsid:v1:x', cwd, endpoint: { base: srv.base, model: 'm', compat: 'llama.cpp' }, capabilities: { tools: true, nCtx: 8192 } }));
    const { onLine, agent } = rpcSession(cfg, (e) => lines.push(JSON.stringify(e)));
    onLine('{"id":"t1","type":"prompt","message":"write out.txt"}');
    await new Promise((r) => setTimeout(r, 10));
    while (agent.running) await new Promise((r) => setTimeout(r, 10));
    fs.rmSync(cwd, { recursive: true, force: true });
    const evs = [...lines, '{"type":"some_future_event"}', '[1,2]', 'not json'].map(parseLocalLine);
    expect(evs.map((e) => e.kind)).toEqual(['capabilities', 'response', 'start', 'turn', 'partial', 'partial', 'partial', 'message', 'repair', 'tool', 'tool', 'turn', 'turn', 'partial', 'partial', 'partial', 'message', 'turn', 'end', 'unknown', 'malformed', 'malformed']);
    const m = new LocalUsageMeter();
    let charged = 0;
    for (const e of evs) {
      if (e.kind === 'message') charged += m.message(e.tokens);
      if (e.kind === 'end') charged += m.end(e.tokens);
    }
    expect(charged).toBe(240);
  });
});

describe('G-LAW-01c / G-LCL-04 (P8-D92 meter): local sessions get compute permits, recorded with model and project, never capped', () => {
  it('6 local spawns ⇒ 6 granted permits, each with backend local, model and repo', async () => {
    const { fuse, rows } = lane(undefined);
    for (let i = 0; i < 6; i++) await fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', backend: 'local', model: `qwen-${i % 2}`, scope: { user: HUMAN, session: `hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZ${i}`, repo: `repo-${i % 3}` } });
    const grants = rows.filter((r) => r.kind === 'permit.grant').map((r) => r.payload.permit as Record<string, unknown>);
    expect(grants).toHaveLength(6);
    for (const g of grants) expect(g).toMatchObject({ backend: 'local', billing: 'local', decision: 'allow' });
    const local = (fuse.status() as { local: Array<{ model: string; repos: string[] }> }).local;
    expect(local).toHaveLength(6);
    expect(local.every((x) => x.model.startsWith('qwen-') && x.repos.length === 1)).toBe(true);
  });
  it.todo('slice 2: G-LAW-01c end to end — 6 sandboxed gnomon-local children through SessionSupervisor.open (darwin rig, test/local-session.test.ts)');
});

describe('round 3 (R2): session roots are never /, the user home, or an ancestor of the Gnomon home; worktree validated', () => {
  it('refuses BAD_REQUEST before any permit', async () => {
    srv = await fakeOpenAI({ tools: true });
    const { l, rows } = lane({ endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: FAKE_PIN });
    for (const over of [{ cwd: '/' }, { cwd: os.homedir() }, { cwd: process.cwd(), worktree: 'relative/wt' }, { cwd: process.cwd(), worktree: '/' }]) {
      await expect(l.open({ ...req('local'), ...over }, async () => null), JSON.stringify(over)).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    }
    expect(rows.some((r) => r.kind.startsWith('permit.'))).toBe(false);
  });
});

describe('deferred to slice 2 (manual oracles need a real model)', () => {
  it.todo('slice 2 / MANUAL ORACLE G-LCL-01: a model:local AUTOMATION completes end to end on llama.cpp (llama-server 9890 is installed; no GGUF on disk) with no Claude process started — needs a GGUF and attended scheduler runs (law 5 still refuses unattended)');
  it.todo('slice 2: the fake-endpoint half of G-LCL-01 UNDER the darwin session profile (the unsandboxed spawn path is test/local-lane-spawn.test.ts)');
  it.todo('slice 2: G-LCL-06 — a sandboxed gnomon-local read_file of ~/.gnomon/keys returns isError (session profile)');
  // slice 2 shipped root-signed local.signed.json, the runner pin, per-task endpoint choice and the daemon-start probe (test/local-config.test.ts), compaction (gnomon-local test/compaction.test.ts) and session.send{steer} (test/local-lane-spawn.test.ts)
  it.todo('slice 3: `gnomon probe local` as a CLI verb (the daemon-start probe records model.probe/model.capabilities today); the claude estimate on the fallback card; the JSONL session tree; bash / edit tools');
});

describe('T-2026-10-26-003: the end of a local run says how it ended', () => {
  it('agent_end carries input/output beside the total; message_end the reply size (never the text)', () => {
    expect(parseLocalLine(JSON.stringify({ type: 'agent_end', stopReason: 'max_steps', usage: { input: 48000, output: 2712 } }))).toEqual({ kind: 'end', type: 'agent_end', tokens: 50712, input: 48000, output: 2712, stopReason: 'max_steps', error: null });
    expect(parseLocalLine(JSON.stringify({ type: 'agent_end', stopReason: 'error' }))).toMatchObject({ kind: 'end', tokens: null, input: null, output: null });
    expect(parseLocalLine(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: '  ', toolCalls: [{ id: 'a' }] }, usage: { input: 1, output: 2 } }))).toEqual({ kind: 'message', type: 'message_end', tokens: 3, toolCalls: 1, textBytes: 0 });
    expect(parseLocalLine(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: 'é ok' } }))).toMatchObject({ kind: 'message', textBytes: 5 });
  });
});
