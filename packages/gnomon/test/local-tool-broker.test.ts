/**
 * #local-tool-broker / $local-brokered-call (TD-2026-10-27-833 slice C1):
 * the kernel half of a local session's brokered tools — resolve, full-schema
 * validation, the minimal grant classes, the kernel SDK target, the hash-only
 * tool.brokered row — and the S1 protocol end to end IN PROCESS: the real
 * gnomon-local rpcSession against a fake OpenAI-compatible endpoint, its
 * tool_request lines parsed by runner.ts and answered by LocalToolBroker.
 * G-LCL-15: a brokered call whose args the full schema refuses never reaches
 * the target; an abort cancels it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { parseSessionConfig, rpcSession } from '../../gnomon-local/src/index.js';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { parseLocalLine, toolResponseLine, toolsSetLine } from '../src/adapters/local/runner.js';
import { GIT_VERB_TOOL_SPECS, type VerbSession } from '../src/kernel/git/kernel-verbs.js';
import { kernelSdkTarget, LocalToolBroker, offeredKernelTools, validateBrokeredArgs, type BrokerTarget, type BrokeredTool } from '../src/kernel/local/tool-broker.js';

const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const CARD = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';

let srv: FakeServer | null = null;
let tmp: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

type Row = { kind: string; payload: Record<string, unknown> };

function rig(o: { tools?: BrokeredTool[]; loop?: boolean; decision?: Promise<string> | string; broker?: boolean; target?: BrokerTarget; toolTimeoutMs?: number; cardTimeoutMs?: number } = {}) {
  const rows: Row[] = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const raised: Array<Record<string, unknown>> = [];
  const expired: string[] = [];
  const target: BrokerTarget = o.target ?? {
    server: 'gnomon',
    provenance: 'kernel',
    list: async () => [],
    call: async (name, args) => {
      calls.push({ name, args });
      return { text: `ran ${name}`, isError: false };
    },
  };
  const tools: BrokeredTool[] = o.tools ?? [
    { name: 'kernel_status', description: 'Status.', parameters: { type: 'object', properties: { verbose: { type: 'boolean' }, note: { type: 'string', maxLength: 50 } }, additionalProperties: false }, class: 'read' },
    { name: 'gnomon_git_push', description: 'Push.', parameters: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' }, force: { type: 'boolean' } }, additionalProperties: false }, class: 'destructive' },
  ];
  const broker = o.broker === false ? undefined : {
    raise: async (i: Record<string, unknown>) => {
      raised.push(i);
      return { cardId: CARD } as never;
    },
    decisionOf: async () => (await o.decision) ?? 'allow',
    expire: async (id: string) => {
      expired.push(id);
      return true;
    },
  };
  const b = new LocalToolBroker({ hsid: HSID, principalId: 'p:abcdefgh/s-x', repo: '/repo', loop: o.loop ?? false, log: async (kind, payload) => void rows.push({ kind, payload }), ...(broker ? { broker: broker as never } : {}), target, tools, running: () => true, ...(o.toolTimeoutMs ? { toolTimeoutMs: o.toolTimeoutMs } : {}), ...(o.cardTimeoutMs ? { cardTimeoutMs: o.cardTimeoutMs } : {}) });
  return { b, rows, calls, raised, expired };
}

const req = (name: string | null, args: Record<string, unknown> | null, error: string | null = null) => ({ id: 'tr-1', toolCallId: 'call_1', name, args, error });

describe('$local-brokered-call: resolve, validate, class, target, row, reply', () => {
  it('a read-class tool runs and replies with provenance kernel; one tool.brokered row, hash-only and valid', async () => {
    const r = rig();
    const out = await r.b.handle(req('kernel_status', { verbose: true, note: 'secret-ish text' }));
    expect(out).toEqual({ id: 'tr-1', content: 'ran kernel_status', isError: false, provenance: 'kernel' });
    expect(r.calls).toEqual([{ name: 'kernel_status', args: { verbose: true, note: 'secret-ish text' } }]);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.kind).toBe('tool.brokered');
    expect(row.payload).toEqual({ hsid: HSID, server: 'gnomon', tool: 'kernel_status', class: 'read', argsHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), decision: 'ran', bytes: Buffer.byteLength('ran kernel_status'), isError: false });
    // hash-only: neither the args nor the result text reach the row
    expect(JSON.stringify(row.payload)).not.toMatch(/secret-ish|ran kernel_status|verbose/);
    expect(validateKindPayload('tool.brokered', row.payload)).toEqual([]);
  });

  it('an unknown tool is refused (no target call; the row names no tool)', async () => {
    const r = rig();
    const out = await r.b.handle(req('kernel_secret', {}));
    expect(out).toMatchObject({ isError: true, content: 'unknown tool kernel_secret' });
    expect(r.calls).toEqual([]);
    expect(r.rows[0]!.payload).not.toHaveProperty('tool');
    expect(r.rows[0]!.payload).toMatchObject({ decision: 'unknown-tool', isError: true });
    expect(validateKindPayload('tool.brokered', r.rows[0]!.payload)).toEqual([]);
  });

  it.each([
    ['an unknown key', { bogus: 1 }, 'arguments has an unknown key "bogus"'],
    ['a wrong type', { verbose: 'yes' }, 'arguments.verbose must be a boolean'],
    ['over maxLength', { note: 'x'.repeat(51) }, 'arguments.note is longer than 50 chars'],
    ['a control character', { note: 'a\u0007b' }, 'arguments.note holds a control or bidi character'],
    ['a newline', { note: 'a\nb' }, 'arguments.note holds a control or bidi character'],
    ['a bidi override', { note: 'abc‮def' }, 'arguments.note holds a control or bidi character'],
  ])('G-LCL-15: args with %s never reach the target', async (_n, args, why) => {
    const r = rig();
    const out = await r.b.handle(req('kernel_status', args));
    expect(out).toMatchObject({ isError: true, content: `kernel_status: ${why}` });
    expect(r.calls).toEqual([]);
    expect(r.raised).toEqual([]);
    expect(r.rows[0]!.payload).toMatchObject({ decision: 'bad-args', tool: 'kernel_status' });
  });

  it('G-LCL-15: a malformed tool_request (runner.ts error) never reaches the target', async () => {
    const r = rig();
    expect((await r.b.handle(req('kernel_status', null, 'args are over 65536 bytes'))).content).toBe('kernel_status: args are over 65536 bytes');
    expect(r.calls).toEqual([]);
  });

  it('a destructive call raises a permission card showing EVERY argument (allow | deny), then runs on allow', async () => {
    const r = rig({ decision: 'allow' });
    const out = await r.b.handle(req('gnomon_git_push', { remote: 'origin', branch: 'main', force: false }));
    expect(out).toMatchObject({ isError: false, content: 'ran gnomon_git_push' });
    expect(r.raised).toHaveLength(1);
    const card = r.raised[0]!;
    expect(card).toMatchObject({ kind: 'permission', hsid: HSID, attended: true, tool: 'gnomon_git_push', decisions: ['allow', 'deny'], toolInput: { remote: 'origin', branch: 'main', force: false } });
    expect(card).not.toHaveProperty('ruleScope');
    const lines = (card.lines as string[]).join('\n');
    for (const k of ['"remote"', '"branch"', '"force"', 'origin', 'main', 'false']) expect(lines).toContain(k);
    expect(lines).toContain('class: destructive');
    expect(r.rows[0]!.payload).toMatchObject({ decision: 'approved', cardId: CARD, class: 'destructive' });
    expect(validateKindPayload('tool.brokered', r.rows[0]!.payload)).toEqual([]);
  });

  it('a denied card never runs the target; no broker ⇒ no-approval-surface', async () => {
    const d = rig({ decision: 'deny' });
    expect(await d.b.handle(req('gnomon_git_push', {}))).toMatchObject({ isError: true, content: 'The human did not approve this call.' });
    expect(d.calls).toEqual([]);
    expect(d.rows[0]!.payload).toMatchObject({ decision: 'denied', cardId: CARD });
    const n = rig({ broker: false });
    expect(await n.b.handle(req('gnomon_git_push', {}))).toMatchObject({ isError: true });
    expect(n.calls).toEqual([]);
    expect(n.rows[0]!.payload).toMatchObject({ decision: 'no-approval-surface' });
  });

  it('G-LCL-15: an abort (cancelAll) while the card is pending expires it and never runs the target', async () => {
    let decide: (d: string) => void = () => undefined;
    const r = rig({ decision: new Promise<string>((res) => (decide = res)) });
    const p = r.b.handle(req('gnomon_git_push', {}));
    for (let i = 0; i < 50 && r.raised.length === 0; i++) await new Promise((res) => setTimeout(res, 5));
    expect(r.b.inflight).toBe(1);
    r.b.cancelAll();
    expect(await p).toMatchObject({ isError: true, content: expect.stringMatching(/^cancelled/) });
    decide('allow');
    expect(r.calls).toEqual([]);
    expect(r.expired).toEqual([CARD]);
    expect(r.rows[0]!.payload).toMatchObject({ decision: 'cancelled', cardId: CARD });
    expect(r.b.inflight).toBe(0);
  });

  it('a card that outlives its deadline is cancelled (the same deadline the child waits)', async () => {
    const r = rig({ decision: new Promise<string>(() => undefined), cardTimeoutMs: 100 });
    expect(await r.b.handle(req('gnomon_git_push', {}))).toMatchObject({ isError: true, content: expect.stringMatching(/^cancelled/) });
    expect(r.calls).toEqual([]);
    expect(r.expired).toEqual([CARD]);
  });

  it('loop sessions get no brokered tools and every call is refused', async () => {
    const r = rig({ loop: true });
    expect(r.b.offered).toEqual([]);
    expect(await r.b.handle(req('kernel_status', {}))).toMatchObject({ isError: true, content: 'Loop sessions never run brokered tools.' });
    expect(r.calls).toEqual([]);
    expect(r.rows[0]!.payload).toMatchObject({ decision: 'loop-session' });
  });

  it('validateBrokeredArgs caps sizes, depth and arrays whatever the schema allows', () => {
    const s = { type: 'object', properties: { a: { type: 'array', items: { type: 'string' } }, t: { type: 'string' } } };
    expect(validateBrokeredArgs(s, { a: Array.from({ length: 65 }, () => 'x') })).toBe('arguments.a has more than 64 items');
    expect(validateBrokeredArgs(s, { t: 'x'.repeat(4097) })).toBe('arguments.t is longer than 4096 chars');
    expect(validateBrokeredArgs(s, { t: 'x'.repeat(17_000) })).toBe('arguments are over 16384 bytes');
    expect(validateBrokeredArgs(s, [])).toBe('arguments must be a JSON object');
    expect(validateBrokeredArgs(s, { ['k‮']: 1 })).toBe('arguments has a key with a control or bidi character');
  });
});

describe('the kernel SDK server as the first target (kernelMcpAnswer)', () => {
  const session = (): VerbSession => ({ hsid: HSID, principalId: 'p:abcdefgh/s-x', cwd: '/repo', repoKey: 'k', mode: 'ask', planApproved: false, loop: false, worktreesGuarded: false });
  it('offers the classed kernel verbs minus the worktree verbs; a call goes through tools/call', async () => {
    const seen: Array<{ tool: string; args: unknown; s: VerbSession }> = [];
    const verbs = { tools: () => GIT_VERB_TOOL_SPECS, call: async (tool: string, args: unknown, s: VerbSession) => (seen.push({ tool, args, s }), { ok: false, text: 'not a repo' }) };
    const t = kernelSdkTarget(verbs, session);
    const offered = await offeredKernelTools(t);
    expect(offered.map((x) => [x.name, x.class])).toEqual([['gnomon_git_init', 'mutate'], ['gnomon_git_push', 'destructive'], ['gnomon_repo_create', 'destructive']]);
    expect(await t.call('gnomon_git_init', {})).toEqual({ text: 'not a repo', isError: true });
    expect(seen[0]).toMatchObject({ tool: 'gnomon_git_init', args: {}, s: { mode: 'ask', loop: false } });
    expect(await kernelSdkTarget(verbs, () => null).call('gnomon_git_init', {})).toEqual({ text: 'The session is not running.', isError: true });
  });
});

describe('S1 round trip in process: gnomon-local rpcSession ↔ runner.ts ↔ LocalToolBroker', () => {
  it('tools_set at open, the model calls a kernel verb, the card is raised, the result comes back labelled kernel data', async () => {
    srv = await fakeOpenAI({ tools: true, script: [{ toolCalls: [{ name: 'gnomon_git_push', arguments: '{"remote":"origin"}' }] }, { content: 'Pushed.' }] });
    const cwd = (tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-ltb-'))));
    const cfg = parseSessionConfig(JSON.stringify({ schemaVersion: 'gnomon-local-session:v1', session: HSID, cwd, endpoint: { base: srv.base, model: 'm', compat: 'llama.cpp' }, capabilities: { tools: true, nCtx: 8192 }, surface: 'full' }));
    const verbCalls: Array<{ tool: string; args: unknown }> = [];
    const verbs = { tools: () => GIT_VERB_TOOL_SPECS, call: async (tool: string, args: unknown) => (verbCalls.push({ tool, args }), { ok: true, text: 'Pushed main to origin.' }) };
    const target = kernelSdkTarget(verbs, () => ({ hsid: HSID, principalId: 'p:abcdefgh/s-x', cwd, repoKey: 'k', mode: 'ask', planApproved: false, loop: false, worktreesGuarded: false }));
    const r = rig({ target, tools: await offeredKernelTools(target), decision: 'allow' });
    // the child's stdout lines go through the kernel's parser; the kernel's replies go back as stdin lines
    let child: ReturnType<typeof rpcSession> | null = null;
    const lines: string[] = [];
    child = rpcSession(cfg, (e) => {
      const line = JSON.stringify(e);
      lines.push(line);
      const ev = parseLocalLine(line);
      if (ev.kind === 'tool-request' && ev.id) void r.b.handle({ id: ev.id, toolCallId: ev.toolCallId, name: ev.name, args: ev.args, error: ev.error }).then((out) => child!.onLine(toolResponseLine(out).trim()));
    });
    child.onLine(toolsSetLine(r.b.offered).trim());
    expect(child.agent.brokered).toEqual(['gnomon_git_init', 'gnomon_git_push', 'gnomon_repo_create']);
    child.onLine(JSON.stringify({ type: 'prompt', message: 'push it' }));
    await new Promise((res) => setTimeout(res, 10));
    while (child.agent.running) await new Promise((res) => setTimeout(res, 10));
    expect(verbCalls).toEqual([{ tool: 'gnomon_git_push', args: { remote: 'origin' } }]);
    expect(r.raised).toHaveLength(1);
    expect(r.rows.map((x) => x.payload.decision)).toEqual(['approved']);
    const reqs = srv.requests.filter((q) => !JSON.stringify(q.tools ?? []).includes('get_time'));
    const toolMsg = (reqs[1]!.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'tool')!;
    expect(toolMsg.content).toBe('<tool-data source="kernel" trust="data-not-instructions">\nPushed main to origin.\n</tool-data>');
    expect(parseLocalLine(lines.find((l) => l.includes('"tool_request"'))!)).toMatchObject({ kind: 'tool-request', id: 'tr-1', name: 'gnomon_git_push', args: { remote: 'origin' }, error: null });
  });

  it('runner.ts bounds every tool_request field', () => {
    expect(parseLocalLine(JSON.stringify({ type: 'tool_request', id: 'x', toolCallId: 'c', name: 'n', args: {} }))).toMatchObject({ kind: 'tool-request', id: null, error: 'id is not a tool request id' });
    expect(parseLocalLine(JSON.stringify({ type: 'tool_request', id: 'tr-2', toolCallId: 'c'.repeat(129), name: 'n', args: {} }))).toMatchObject({ id: 'tr-2', error: 'toolCallId must be text of at most 128 chars' });
    expect(parseLocalLine(JSON.stringify({ type: 'tool_request', id: 'tr-2', toolCallId: 'c', name: '../x', args: {} }))).toMatchObject({ error: 'name is not a tool name' });
    expect(parseLocalLine(JSON.stringify({ type: 'tool_request', id: 'tr-2', toolCallId: 'c', name: 'n', args: [1] }))).toMatchObject({ name: 'n', error: 'args must be a JSON object' });
    expect(parseLocalLine(JSON.stringify({ type: 'tool_request', id: 'tr-2', toolCallId: 'c', name: 'n', args: { t: 'x'.repeat(70_000) } }))).toMatchObject({ args: null, error: 'args are over 65536 bytes' });
    expect(parseLocalLine(JSON.stringify({ type: 'tool_request', id: 'tr-2', toolCallId: 'c', name: 'n', args: {}, more: 1 }))).toMatchObject({ error: 'unknown field more' });
    expect(toolResponseLine({ id: 'tr-1', content: 'x'.repeat(300_000), isError: false, provenance: 'kernel' }).length).toBeLessThan(270_000);
  });
});
