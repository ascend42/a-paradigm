/**
 * #local-runner (spec §13, §3.3, §10 laws 1 and 7; M1.8 slice 1) against a
 * FAKE in-process OpenAI-compatible server (packages/gnomon-local/test/
 * fake-openai.ts). Never a real model. Platform-independent: nothing here
 * spawns a session child (the routing/fallback paths refuse before spawn).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { classifyEndpoint as childClassify, COMPAT_ALLOWLIST } from '../../gnomon-local/src/index.js';
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
  const l = new LocalLane({ log, children: children as never, fuse, broker: broker as never, home: '/nonexistent-gnomon-home', kernelPrincipal: 'p:abcdefgh/kernel', sock: '/tmp/x.sock', ...(config ? { config } : {}) });
  return { l, rows, cards, fuse };
}
const req = (model: string) => ({ principal: HUMAN, principalClass: 'human', attended: true, cwd: process.cwd(), model });

describe('G-SUB-06: gnomon-local endpoints are loopback/LAN only (kernel and child hold ONE table)', () => {
  it.each(ENDPOINT_TABLE)('%s ⇒ %s (both copies)', (base, want) => {
    const k = classifyEndpoint(base);
    const c = childClassify(base);
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
    const { l, rows, cards } = lane({ endpoints: [{ id: 'llama', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: { command: process.execPath, args: ['/x/cli.js'] } });
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
});

describe('G-ADP-02: a recorded gnomon-local rpc transcript replays through the driver', () => {
  const transcript = [
    { type: 'model_capabilities', backend: 'local', model: 'qwen2.5-coder-7b', compat: 'llama.cpp', tools: true, ctx: 8192, textTools: false },
    { type: 'response', id: 't1', command: 'prompt', success: true },
    { type: 'agent_start' },
    { type: 'turn_start', turn: 1 },
    { type: 'message_update', delta: "I'll write the file." },
    { type: 'message_end', message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'write_file' }] }, usage: { input: 412, output: 38 } },
    { type: 'model_repair', toolCallId: 'c1', toolName: 'write_file', steps: ['single-quotes'] },
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'write_file' },
    { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write_file', isError: false },
    { type: 'turn_end', turn: 1 },
    { type: 'message_end', message: { role: 'assistant', content: 'Done.', toolCalls: [] }, usage: { input: 470, output: 3 }, futureField: 1 },
    { type: 'agent_end', stopReason: 'stop', usage: { input: 882, output: 41 } },
    { type: 'some_future_event' },
  ].map((o) => JSON.stringify(o));
  it('kinds are tolerant; usage is charged once (messages, then only the remainder)', () => {
    const evs = [...transcript, '[1,2]', 'not json'].map(parseLocalLine);
    expect(evs.map((e) => e.kind)).toEqual(['capabilities', 'response', 'start', 'turn', 'partial', 'message', 'repair', 'tool', 'tool', 'turn', 'message', 'end', 'unknown', 'malformed', 'malformed']);
    const m = new LocalUsageMeter();
    let charged = 0;
    for (const e of evs) {
      if (e.kind === 'message') charged += m.message(e.tokens);
      if (e.kind === 'end') charged += m.end(e.tokens);
    }
    expect(charged).toBe(882 + 41);
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

describe('deferred to slice 2 (manual oracles need a real model)', () => {
  it.todo('slice 2 / MANUAL ORACLE G-LCL-01: a model:local AUTOMATION completes end to end on llama.cpp (llama-server 9890 is installed; no GGUF on disk) with no Claude process started — needs a GGUF and attended scheduler runs (law 5 still refuses unattended)');
  it.todo('slice 2: the fake-endpoint half of G-LCL-01 — a model:local session spawned under the darwin session profile writes a file through gnomon-local and ends with turn.result');
  it.todo('slice 2: G-LCL-06 — a sandboxed gnomon-local read_file of ~/.gnomon/keys returns isError (session profile)');
  it.todo('slice 2: root-signed local.yaml, `gnomon probe local`, per-task endpoint choice, compaction at ~8k, session.send{steer}');
});
