/**
 * G-LCL-23 #mcp-servers trust, kernel side (TD-2026-10-27-833 slice C5'a1): the TrustBook folds only kernel-signed
 * tool.trust rows; the binding (launch hash, plugin version, tools hash) is checked at index, on a cache hit, at the
 * first spawn and on list_changed, and a mismatch drops trust with ONE row; the broker believes a read label only
 * while trustLive says so (grace entries included). Platform-neutral: the fake server runs under process.execPath and
 * no key is written; the request half (preview, commit, clear, refusals) is test/mcp-trust-request.test.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { launchKey, LocalMcpPool, McpListCache, type LocalMcpServer } from '../src/kernel/local/mcp-client.js';
import { bindingOf, McpTrust, toolsHashOf, TrustBook } from '../src/kernel/local/trust-book.js';
import { narrow } from '../src/kernel/local/capability-index.js';
import { LocalToolBroker, TRUST_CARD_LINE, type BrokeredTool, type BrokerTarget } from '../src/kernel/local/tool-broker.js';
import type { RuleRow } from '../src/kernel/supervisor/rules.js';

const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
const KERNEL = 'p:abcdefgh/kernel';
const L1 = `hmac-sha256:${'1'.repeat(64)}`;
const L2 = `hmac-sha256:${'2'.repeat(64)}`;
const kids: ChildProcess[] = [];
afterEach(() => {
  for (const k of kids.splice(0)) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
});
const spawnFake = (): ChildProcess => {
  const c = spawn(process.execPath, [FAKE], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  kids.push(c);
  return c;
};
const waitFor = async (f: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** An in-memory chain: the kernel's rows, and rows anyone else (a forger) appends. */
function chain() {
  const rows: RuleRow[] = [];
  const push = (kind: string, payload: Record<string, unknown>, principal = KERNEL, keyId = 'key:kernel'): void => void rows.push({ seq: rows.length + 1, kind, principal, keyId, payload });
  const trust = new McpTrust({ principal: KERNEL, isKernelKey: (k) => k === 'key:kernel', source: { head: () => rows.length, read: (from, to) => rows.filter((r) => r.seq! >= from && r.seq! <= to) }, append: async (kind, payload) => push(kind, payload) });
  return { rows, push, trust, trustRows: () => rows.filter((r) => r.kind === 'tool.trust').map((r) => r.payload as Record<string, unknown>) };
}
const server = (over: Partial<LocalMcpServer> = {}): LocalMcpServer => ({ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE], trust: 'enabled', launchHash: L1, pluginVersion: null, ...over });
const trustNewest = async (c: ReturnType<typeof chain>, cache: McpListCache, id = 'user::fake'): Promise<void> => {
  const n = cache.newest(id)!;
  await c.trust.set({ id, label: n.label, binding: bindingOf({ id, launchHash: n.launchHash, pluginVersion: n.pluginVersion, toolsHash: n.toolsHash }), launchHash: n.launchHash, toolsHash: n.toolsHash });
};
const classes = (es: ReadonlyArray<{ name: string; class: string }>): Record<string, string> => Object.fromEntries(es.map((e) => [e.name, e.class]));

describe('the binding (toolsHash, bindingOf)', () => {
  const tools = [
    { name: 'b', description: 'B.', inputSchema: { type: 'object', properties: { x: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'a', description: 'A.', inputSchema: { type: 'object', properties: {} }, _meta: { 'io.gnomon/op-annotations': { get: { readOnlyHint: true } }, other: 1 } },
  ];
  it('covers names, schemas, annotations and op-annotations; never descriptions, order or other _meta keys', () => {
    const h = toolsHashOf(tools);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(toolsHashOf([...tools].reverse())).toBe(h);
    expect(toolsHashOf(tools.map((t) => ({ ...t, description: 'reworded' })))).toBe(h);
    expect(toolsHashOf([tools[0]!, { ...tools[1]!, _meta: { 'io.gnomon/op-annotations': { get: { readOnlyHint: true } }, other: 2 } }])).toBe(h);
    expect(toolsHashOf([{ ...tools[0]!, inputSchema: { type: 'object', properties: { x: { type: 'number' } } } }, tools[1]!])).not.toBe(h);
    expect(toolsHashOf([{ ...tools[0]!, annotations: { readOnlyHint: false } }, tools[1]!])).not.toBe(h);
    expect(toolsHashOf([tools[0]!, { ...tools[1]!, _meta: { 'io.gnomon/op-annotations': { get: { destructiveHint: true } } } }])).not.toBe(h);
  });
  it('bindingOf moves with the id, the launch hash, the plugin version and the tools hash (never the trust or the repo)', () => {
    const b = { id: 'user::x', launchHash: L1, pluginVersion: '1.0.0', toolsHash: toolsHashOf(tools) };
    const base = bindingOf(b);
    for (const over of [{ id: 'user::y' }, { launchHash: L2 }, { pluginVersion: '1.0.1' }, { toolsHash: toolsHashOf([tools[0]!]) }]) expect(bindingOf({ ...b, ...over })).not.toBe(base);
    expect(launchKey(server({ trust: 'enabled' }), '/r')).toBe(launchKey(server({ trust: 'enabled', launchHash: L2 }), '/r'));
  });
});

describe('G-LCL-23 TrustBook: only kernel-signed rows widen', () => {
  const set = { id: 'user::fake', label: 'fake', op: 'set', binding: `sha256:${'a'.repeat(64)}`, why: 'human', launchHash: L1, toolsHash: `sha256:${'b'.repeat(64)}` };
  it('a forged row (another principal, or a key the kernel does not hold) and a malformed row widen nothing', () => {
    const c = chain();
    c.push('tool.trust', set, 'p:abcdefgh/agent');
    c.push('tool.trust', set, KERNEL, 'key:someone');
    c.push('tool.trust', { ...set, why: 'tools-changed' });
    c.push('tool.trust', { ...set, launchHash: 'sha256:x' });
    expect(c.trust.of('user::fake')).toBeNull();
    c.push('tool.trust', set);
    expect(c.trust.of('user::fake')).toMatchObject({ binding: set.binding, label: 'fake' });
    // a forged clear cannot end it either (it only narrows, but the book still folds kernel rows only)
    c.push('tool.trust', { id: 'user::fake', label: 'fake', op: 'cleared', binding: set.binding, why: 'human' }, 'p:abcdefgh/agent');
    expect(c.trust.of('user::fake')).not.toBeNull();
    c.push('tool.trust', { id: 'user::fake', label: 'fake', op: 'dropped', binding: set.binding, why: 'disabled' });
    expect(c.trust.of('user::fake')).toBeNull();
  });
  it('the book folds rows in order and advances past every row it read', () => {
    const b = new TrustBook({ principal: KERNEL, isKernelKey: (k) => k === 'key:kernel' });
    b.fold({ seq: 4, kind: 'session.open', principal: KERNEL, keyId: 'key:kernel', payload: {} });
    b.fold({ seq: 5, kind: 'tool.trust', principal: KERNEL, keyId: 'key:kernel', payload: set });
    expect(b.lastSeq).toBe(5);
    expect(b.of('user::fake')?.seq).toBe(5);
    expect(b.drainChanged()).toEqual(['user::fake']);
    expect(b.drainChanged()).toEqual([]);
  });
  it('a drop hides the trust at once, writes ONE row however often it is asked, and tells subscribers after the call', async () => {
    const c = chain();
    c.push('tool.trust', set);
    const told: string[] = [];
    c.trust.subscribe((id) => told.push(id));
    c.trust.drop('user::fake', 'tools-changed');
    c.trust.drop('user::fake', 'tools-changed');
    expect(c.trust.of('user::fake')).toBeNull();
    expect(told).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(told.length).toBeGreaterThan(0);
    const dropped = c.trustRows().filter((p) => p.op === 'dropped');
    expect(dropped).toEqual([{ id: 'user::fake', label: 'fake', op: 'dropped', binding: set.binding, why: 'tools-changed' }]);
    for (const p of c.trustRows()) expect(validateKindPayload('tool.trust', p)).toEqual([]);
  });
});

describe('G-LCL-23 the pool: trust follows the binding; a change drops it with a row', () => {
  it('untrusted: every tool mutate; trusted (the exact binding): read labels count; the resource is never read', async () => {
    const c = chain();
    const cache = new McpListCache();
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', cache, trust: c.trust, spawn: () => spawnFake() });
    expect(new Set((await pool.index()).entries.map((e) => e.class))).toEqual(new Set(['mutate']));
    expect(pool.trustLive('fake')).toBe('enabled');
    expect(cache.newest('user::fake')).toMatchObject({ id: 'user::fake', label: 'fake', launchHash: L1, pluginVersion: null, toolsHash: expect.stringMatching(/^sha256:/) });
    await trustNewest(c, cache);
    expect(classes(pool.renarrow('fake')!)).toMatchObject({ echo: 'read', poke: 'mutate', 'fam.get': 'mutate' });
    expect(pool.trustLive('fake')).toBe('trusted');
    await pool.closeAll();
  }, 20_000);

  it('a launch change (another launch hash, same list) drops trust with one row: launch-changed', async () => {
    const c = chain();
    const cache = new McpListCache();
    const a = new LocalMcpPool({ servers: [server()], repo: '/r', cache, trust: c.trust, spawn: () => spawnFake() });
    await a.index();
    await trustNewest(c, cache);
    // the same command (cache hit, nothing spawned) under a new launch hash: the binding differs
    let spawned = 0;
    const b = new LocalMcpPool({ servers: [server({ launchHash: L2 })], repo: '/r', cache, trust: c.trust, spawn: () => (spawned++, spawnFake()) });
    expect(new Set((await b.index()).entries.map((e) => e.class))).toEqual(new Set(['mutate']));
    expect(spawned).toBe(0);
    await waitFor(() => c.trustRows().some((p) => p.op === 'dropped'));
    expect(c.trustRows().filter((p) => p.op === 'dropped').map((p) => p.why)).toEqual(['launch-changed']);
    // trust drops EVERYWHERE: the first session's labels are no longer believed either
    expect(a.trustLive('fake')).toBe('enabled');
    await a.closeAll();
    await b.closeAll();
  }, 20_000);

  it('a tools change on list_changed drops trust with one row: tools-changed', async () => {
    const c = chain();
    const cache = new McpListCache();
    const changed: string[][] = [];
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', cache, trust: c.trust, spawn: () => spawnFake(), onChanged: (_l, es) => changed.push(es.map((e) => `${e.name}:${e.class}`)) });
    await pool.index();
    await trustNewest(c, cache);
    pool.renarrow('fake');
    expect(pool.trustLive('fake')).toBe('trusted');
    await pool.target('fake')!.call('change', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 });
    await waitFor(() => changed.length > 0);
    expect(changed[0]).toContain('echo:mutate');
    expect(changed[0]).toContain('later:mutate');
    await waitFor(() => c.trustRows().some((p) => p.op === 'dropped'));
    expect(c.trustRows().filter((p) => p.op === 'dropped').map((p) => p.why)).toEqual(['tools-changed']);
    expect(pool.trustLive('fake')).toBe('enabled');
    await pool.closeAll();
  }, 20_000);

  it('Arky 11: trust is global but the list is per repo: a server that lists other tools in another repo drops trust there', async () => {
    const c = chain();
    const cache = new McpListCache();
    const a = new LocalMcpPool({ servers: [server()], repo: '/repo-a', cache, trust: c.trust, spawn: () => spawnFake() });
    await a.index();
    await trustNewest(c, cache);
    expect(classes(a.renarrow('fake')!)).toMatchObject({ echo: 'read' });
    // the same launch in repo B lists a different tool set (its cache entry, as that repo's server answered)
    const echoOnly = [{ name: 'echo', description: 'Echo.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: false } }];
    cache.set(launchKey(server(), '/repo-b'), { tools: echoOnly, annotations: null });
    const b = new LocalMcpPool({ servers: [server()], repo: '/repo-b', cache, trust: c.trust, spawn: () => spawnFake() });
    expect(classes((await b.index()).entries)).toEqual({ echo: 'mutate' });
    await waitFor(() => c.trustRows().some((p) => p.op === 'dropped'));
    expect(c.trustRows().filter((p) => p.op === 'dropped').map((p) => p.why)).toEqual(['tools-changed']);
    expect(a.trustLive('fake')).toBe('enabled');
    await a.closeAll();
    await b.closeAll();
  }, 20_000);

  it('the first spawn of a trusted server re-lists once; a changed list drops trust and refuses the uncarded read', async () => {
    const c = chain();
    const cache = new McpListCache();
    // a cached list older than the binary: echo only (trusted for exactly this list)
    const old = [{ name: 'echo', description: 'Echo.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: false } }];
    const meta = { id: 'user::fake', label: 'fake', launchHash: L1, pluginVersion: null, toolsHash: toolsHashOf(old) };
    cache.set(launchKey(server(), '/r'), { tools: old, annotations: null }, meta);
    await trustNewest(c, cache);
    let spawned = 0;
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', cache, trust: c.trust, spawn: () => (spawned++, spawnFake()) });
    expect(classes((await pool.index()).entries)).toEqual({ echo: 'read' });
    expect(spawned).toBe(0);
    const r = await pool.target('fake')!.call('echo', { text: 'x' }, { signal: new AbortController().signal, deadline: Date.now() + 10_000, trustedRead: true });
    expect(spawned).toBe(1);
    expect(r).toMatchObject({ isError: true, why: 'trust-dropped' });
    await waitFor(() => c.trustRows().some((p) => p.op === 'dropped'));
    expect(c.trustRows().filter((p) => p.op === 'dropped').map((p) => p.why)).toEqual(['tools-changed']);
    await pool.closeAll();
  }, 20_000);
});

describe('G-LCL-23 the broker believes a read label only while trustLive says so (Arky 4)', () => {
  const [echo] = narrow([{ name: 'echo', description: 'Echo.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: false } }], 'srv', { trust: 'trusted' });
  const rig = (trustLive?: () => 'enabled' | 'trusted' | 'first-party') => {
    const rows: Array<Record<string, unknown>> = [];
    const raised: Array<Record<string, unknown>> = [];
    const calls: Array<Record<string, unknown>> = [];
    const target: BrokerTarget = { server: 'srv', provenance: 'mcp:srv', ownsGate: false, list: async () => [], call: async (_n, args, o) => (calls.push({ args, trustedRead: o.trustedRead === true }), { text: 'ok', isError: false }) };
    const tool: BrokeredTool = { name: echo!.name, description: echo!.description, parameters: echo!.parameters, class: echo!.class, entry: echo!, target };
    const broker = { raise: async (i: Record<string, unknown>) => (raised.push(i), { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true };
    const b = new LocalToolBroker({ hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', principalId: 'p', repo: '/r', loop: false, log: async (_k, p) => void rows.push(p), broker: broker as never, target, tools: [tool], running: () => true, ...(trustLive ? { trustLive } : {}) });
    return { b, rows, raised, calls, tool };
  };
  const req = (id = 'tr-1') => ({ id, toolCallId: 'c', name: 'echo', args: { text: 'hi' }, error: null });

  it('trusted now: the read runs with no card (the target is told it ran on trust)', async () => {
    const r = rig(() => 'trusted');
    expect(await r.b.handle(req())).toMatchObject({ isError: false, decision: 'ran' });
    expect(r.raised).toEqual([]);
    expect(r.calls).toEqual([{ args: { text: 'hi' }, trustedRead: true }]);
  });

  it('untrusted now (or no trustLive at all): the same read takes a card, logged as mutate, the card names the trust', async () => {
    for (const r of [rig(() => 'enabled'), rig()]) {
      expect(await r.b.handle(req())).toMatchObject({ isError: false, decision: 'approved' });
      expect(r.raised).toHaveLength(1);
      expect(r.raised[0]!.lines as string[]).toContain(TRUST_CARD_LINE.enabled);
      expect((r.raised[0]!.detail as { brokered: Record<string, unknown> }).brokered).toMatchObject({ class: 'mutate', trust: 'untrusted' });
      expect(r.rows[0]).toMatchObject({ tool: 'echo', class: 'mutate', decision: 'approved' });
      expect(validateKindPayload('tool.brokered', r.rows[0])).toEqual([]);
      expect(r.calls[0]!.trustedRead).toBe(false);
    }
    expect(TRUST_CARD_LINE.enabled).toBe('server: untrusted · Gnomon ignores its tool labels');
  });

  it('a GRACE entry still marked read gets a card once its server is untrusted (checked on the resolved tool)', async () => {
    let level: 'enabled' | 'trusted' = 'trusted';
    const r = rig(() => level);
    // the new set no longer offers echo; until the ack the previous set (echo, class read) stays callable
    r.b.setTools([], { ackId: 'ts-1' });
    expect(r.b.grace.map((t) => [t.name, t.class])).toEqual([['echo', 'read']]);
    level = 'enabled';
    expect(await r.b.handle(req())).toMatchObject({ decision: 'approved' });
    expect(r.raised).toHaveLength(1);
    // pruneGrace (what LocalLane runs on a drop) ends it
    r.b.pruneGrace((t) => t.class !== 'read');
    expect(await r.b.handle(req('tr-2'))).toMatchObject({ decision: 'unknown-tool' });
  });
});
