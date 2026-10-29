// @gnomon-platform: darwin, linux
/**
 * G-LCL-23 #mcp-servers trust, the request half (TD-2026-10-27-833 slice C5'a1): request.mcp.trust{id, op, token?} is
 * the human's alone (gui or device); preview works from the newest listing in this daemon run (not-listed otherwise)
 * and mints a single-use 60 s token bound to (principal, id, launchHash, toolsHash); only a commit with a live token
 * writes tool.trust{op:'set'}; clear needs no token; fetches, remote-proxy, project/local servers, the first-party
 * server and Windows are refused; a forged row or an edited store `trust` field widens nothing; turning a server off
 * drops its trust. POSIX-only fixture (sh shims on the session PATH), like test/mcp-servers.test.ts.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { declHash, discoverMcpServers } from '../src/kernel/desk/mcp-servers.js';
import { MCP_DISABLE_REQUEST, MCP_ENABLE_REQUEST, MCP_TRUST_REQUEST, mcpServersPath, McpServers, readMcpServersStore, trustDropNotice, TRUST_TOKEN_TTL_MS } from '../src/kernel/desk/mcp-server-cards.js';
import { McpListCache } from '../src/kernel/local/mcp-client.js';
import { bindingOf, McpTrust, toolsHashOf } from '../src/kernel/local/trust-book.js';
import type { RuleRow } from '../src/kernel/supervisor/rules.js';
import { NEVER_STANDING_KINDS, standingTupleOf } from '../src/kernel/broker/standing-grant.js';

const KERNEL = 'p:abcdefgh/kernel';
const KEY = Buffer.alloc(32, 7);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix: string): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};
const write = (p: string, v: unknown): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
};
const human = { connId: 'c1', principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' };
const TOOLS = [
  { name: 'search', description: 'Search notes.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'write', description: 'Write a note.', inputSchema: { type: 'object', properties: { t: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: false } },
];

function setup(platform = 'darwin', cardState: () => string = () => 'gone') {
  const userHome = tmp('trust-user-');
  const repo = tmp('trust-repo-');
  const home = tmp('trust-home-');
  const bin = path.join(userHome, 'bin');
  for (const b of ['node', 'npx']) {
    write(path.join(bin, b), '#!/bin/sh\n');
    fs.chmodSync(path.join(bin, b), 0o755);
  }
  write(path.join(userHome, '.claude.json'), {
    mcpServers: {
      neurons: { type: 'stdio', command: 'node', args: ['/x/main.js', 'mcp'] },
      fetchy: { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] },
      proxied: { type: 'stdio', command: 'node', args: ['mcp-remote', 'https://mcp.example.com/sse'] },
    },
  });
  write(path.join(repo, '.mcp.json'), { mcpServers: { repotool: { command: 'node', args: ['/r.js'] } } });
  const rows: RuleRow[] = [];
  const push = (kind: string, payload: Record<string, unknown>, principal = KERNEL, keyId = 'key:kernel'): void => void rows.push({ seq: rows.length + 1, kind, principal, keyId, payload });
  const trust = new McpTrust({ principal: KERNEL, isKernelKey: (k) => k === 'key:kernel', source: { head: () => rows.length, read: (f, t) => rows.filter((r) => r.seq! >= f && r.seq! <= t) }, append: async (k, p) => push(k, p) });
  const cache = new McpListCache();
  let now = 1_800_000_000_000;
  const raised: Array<{ kind: string; handOnly: boolean; detail: Record<string, unknown>; lines: string[]; prepare: (d: string) => unknown; effect: (d: string) => Promise<void> }> = [];
  const expired: string[] = [];
  const broker = { raise: async (i: never) => (raised.push(i), { cardId: (i as { cardId: string }).cardId }) as never, card: () => ({ state: cardState() }) as never, expire: async (cardId: string) => (expired.push(cardId), true) };
  const m = new McpServers({ home, broker: broker as never, userHome, pathDirs: () => [bin], launchKey: KEY, firstParty: () => ({ available: false, why: 'not installed' }) as never, liveRepos: () => [{ cwd: repo, hsid: 'h1' }], platform, clock: () => now, listedOf: (id) => cache.newest(id), trust });
  const decl = (name: string) => discoverMcpServers({ userHome, repos: [repo], pathDirs: [bin], platform: 'darwin' }).find((d) => d.name === name)!;
  const enable = async (name: string): Promise<string> => {
    const id = decl(name).id;
    raised.length = 0;
    await m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'all' });
    expect(raised[0]!.prepare('allow')).toBeNull();
    await raised[0]!.effect('allow');
    return id;
  };
  /** what a local session's pool records when it lists the server (the daemon's McpListCache) */
  const list = (name: string, tools = TOOLS): void => {
    const d = decl(name);
    cache.set(`k-${d.id}-${toolsHashOf(tools)}`, { tools, annotations: null }, { id: d.id, label: d.sessionName, launchHash: declHash(d, KEY), pluginVersion: null, toolsHash: toolsHashOf(tools) });
  };
  const trustRows = () => rows.filter((r) => r.kind === 'tool.trust').map((r) => r.payload as Record<string, unknown>);
  /** Aegis H1: a commit raises the fresh-presence card; the human's allow (prepare, then effect) sets trust */
  const commit = async (id: string, token: string): Promise<void> => {
    expect(await m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token })).toMatchObject({ id, pending: true });
    const c = raised.at(-1)!;
    expect(c.prepare('allow')).toBeNull();
    await c.effect('allow');
  };
  return { m, trust, cache, rows, push, trustRows, enable, list, decl, home, raised, expired, commit, tick: (ms: number) => (now += ms) };
}
const statusTrust = (m: McpServers, name: string) => (m.status() as { servers: Array<{ name: string; trust: { level: string; why: string | null } }> }).servers.find((s) => s.name === name)!.trust;
const refusal = async (p: Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await p;
  } catch (e) {
    const r = (e as { refusal?: { code: string; data?: Record<string, unknown> } }).refusal;
    return { message: (e as Error).message, ...(r?.data ?? {}), code: r?.code };
  }
  throw new Error('expected a refusal');
};

describe('G-LCL-23 request.mcp.trust: only a human commit with a live token sets trust', () => {
  it("is the human's on a gui or device connection only (never an agent, a session or voice)", async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    for (const asker of [{ ...human, principalClass: 'agent' }, { ...human, credential: 'voice' }, { ...human, principal: undefined }]) {
      expect(await refusal(t.m.request(asker as never, MCP_TRUST_REQUEST, { id, op: 'preview' }))).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(t.trustRows()).toEqual([]);
  });

  it('not-listed until a local session listed the server in this daemon run; not-enabled when it is off', async () => {
    const t = setup();
    const off = t.decl('neurons').id;
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id: off, op: 'preview' }))).toMatchObject({ why: 'not-enabled' });
    const id = await t.enable('neurons');
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' }))).toMatchObject({ why: 'not-listed' });
    expect(statusTrust(t.m, 'neurons')).toEqual({ level: 'untrusted', why: 'not-listed' });
  });

  it('preview answers the notice, the would-be read tools and a token; commit writes ONE kernel-signed set row', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    expect(statusTrust(t.m, 'neurons')).toEqual({ level: 'untrusted', why: null });
    const p = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string; reads: string[]; notice: string; launchHash: string; toolsHash: string };
    expect(p.reads).toEqual(['search']);
    expect(p.notice).toBe("Trust neurons's tool labels? Gnomon will believe what neurons says about its tools. These run with no card: search. You can make Always rules for its other tools. Tools that change or delete things still ask each time. Trust ends by itself if its command, arguments, environment or tool list changes.");
    expect(t.trustRows()).toEqual([]);
    await t.commit(id, p.token);
    const rows = t.trustRows();
    expect(rows).toEqual([{ id, label: 'neurons', op: 'set', binding: bindingOf({ id, launchHash: p.launchHash, pluginVersion: null, toolsHash: p.toolsHash }), why: 'human', launchHash: p.launchHash, toolsHash: p.toolsHash }]);
    expect(validateKindPayload('tool.trust', rows[0])).toEqual([]);
    expect(t.trust.of(id)).toMatchObject({ binding: rows[0]!.binding });
    expect(statusTrust(t.m, 'neurons')).toMatchObject({ level: 'trusted' });
  });

  it('token cases: reused, wrong principal, expired, stale (the listing moved) and missing are all refused; nothing is written', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const preview = async (): Promise<string> => ((await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string }).token;
    // wrong principal (the token is used up by the attempt)
    const t1 = await preview();
    expect(await refusal(t.m.request({ ...human, principal: 'p:abcdefgh/other' }, MCP_TRUST_REQUEST, { id, op: 'commit', token: t1 }))).toMatchObject({ why: 'stale' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: t1 }))).toMatchObject({ why: 'stale' });
    // expired
    const t2 = await preview();
    t.tick(TRUST_TOKEN_TTL_MS + 1);
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: t2 }))).toMatchObject({ why: 'stale' });
    // stale: a session listed other tools after the preview
    const t3 = await preview();
    t.list('neurons', [TOOLS[0]!]);
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: t3 }))).toMatchObject({ why: 'stale' });
    // forged / missing token, a token on a preview
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: 'made-up' }))).toMatchObject({ why: 'stale' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit' }))).toMatchObject({ field: 'token' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview', token: 'x' }))).toMatchObject({ field: 'token' });
    expect(t.trustRows()).toEqual([]);
    // reused: the first commit sets trust, the same token again is refused
    const t4 = await preview();
    await t.commit(id, t4);
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: t4 }))).toMatchObject({ why: 'stale' });
    expect(t.trustRows().map((r) => r.op)).toEqual(['set']);
  });

  it('a commit whose server changed since the preview (another launch) is refused', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const { token } = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(t.decl('neurons').resolved!)), '.claude.json'), 'utf8')) as { mcpServers: Record<string, { args: string[] }> };
    cfg.mcpServers.neurons!.args = ['/x/main.js', 'mcp', '--new'];
    fs.writeFileSync(path.join(path.dirname(path.dirname(t.decl('neurons').resolved!)), '.claude.json'), JSON.stringify(cfg));
    expect((await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token }))).why).toMatch(/^(not-enabled|changed|stale)$/);
    expect(t.trustRows()).toEqual([]);
  });

  it('clear takes no token and writes one cleared row (it only narrows); clearing an untrusted server writes nothing', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    expect(await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'clear' })).toEqual({ id, trusted: false, cleared: false });
    const { token } = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    await t.commit(id, token);
    expect(await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'clear' })).toEqual({ id, trusted: false, cleared: true });
    expect(t.trustRows().map((r) => [r.op, r.why])).toEqual([['set', 'human'], ['cleared', 'human']]);
    expect(t.trust.of(id)).toBeNull();
  });

  it('refused: a fetches server, a remote proxy, a project server, the first-party server, an unknown op; and Windows', async () => {
    const t = setup();
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id: t.decl('fetchy').id, op: 'preview' }))).toMatchObject({ why: 'fetches' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id: t.decl('proxied').id, op: 'preview' }))).toMatchObject({ why: 'remote-proxy' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id: t.decl('repotool').id, op: 'preview' }))).toMatchObject({ why: 'not-local' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id: 'first-party:paradigm', op: 'preview' }))).toMatchObject({ why: 'first-party' });
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id: t.decl('neurons').id, op: 'always' }))).toMatchObject({ field: 'op' });
    expect(statusTrust(t.m, 'fetchy')).toEqual({ level: 'untrusted', why: 'fetches' });
    const w = setup('win32');
    w.list('neurons');
    expect(await refusal(w.m.request(human, MCP_TRUST_REQUEST, { id: w.decl('neurons').id, op: 'preview' }))).toMatchObject({ why: 'platform' });
    expect(statusTrust(w.m, 'neurons')).toEqual({ level: 'untrusted', why: 'platform' });
    expect(t.trustRows()).toEqual([]);
    expect(w.trustRows()).toEqual([]);
  });
});

describe('G-LCL-23 nothing but a kernel commit widens trust', () => {
  it('a forged tool.trust row (another principal or key) and an edited store `trust` field leave the server untrusted', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const n = t.cache.newest(id)!;
    const set = { id, label: 'neurons', op: 'set', binding: bindingOf({ id, launchHash: n.launchHash, pluginVersion: null, toolsHash: n.toolsHash }), why: 'human', launchHash: n.launchHash, toolsHash: n.toolsHash };
    t.push('tool.trust', set, 'p:abcdefgh/agent');
    t.push('tool.trust', set, KERNEL, 'key:stolen');
    expect(t.trust.of(id)).toBeNull();
    expect(statusTrust(t.m, 'neurons').level).toBe('untrusted');
    const p = mcpServersPath(t.home);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { enabled: Array<Record<string, unknown>> };
    raw.enabled[0]!.trust = 'trusted';
    fs.writeFileSync(p, JSON.stringify({ ...raw, schema: 'gnomon-mcp-servers:v1' }));
    expect(readMcpServersStore(t.home).enabled[0]).not.toHaveProperty('trust');
    expect(t.m.composeLocal({ hsid: 'h1', cwd: os.tmpdir() }).find((s) => s.id === id)?.trust).toBe('enabled');
    expect(statusTrust(t.m, 'neurons').level).toBe('untrusted');
  });

  it('turning the server off drops its trust with one row (why disabled)', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const { token } = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    await t.commit(id, token);
    await t.m.request(human, MCP_DISABLE_REQUEST, { id });
    expect(t.trust.of(id)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.trustRows().map((r) => [r.op, r.why])).toEqual([['set', 'human'], ['dropped', 'disabled']]);
    expect(trustDropNotice('neurons', 'disabled')).toBe('neurons changed (it was turned off), so Gnomon stopped trusting its tool labels. Its tools ask again and its Always rules are paused. Trust it again in Settings › MCP servers.');
  });
});

describe('Aegis hardening (C5\'a2): one open trust card per server id', () => {
  it('a repeat commit while the card is open returns the SAME cardId and raises nothing; once it is decided a commit raises a new one', async () => {
    let state = 'pending';
    const t = setup('darwin', () => state);
    const id = await t.enable('neurons');
    t.list('neurons');
    const preview = async (): Promise<string> => ((await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string }).token;
    t.raised.length = 0;
    const first = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: await preview() })) as { cardId: string };
    expect(t.raised).toHaveLength(1);
    const again = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: await preview() })) as { cardId: string; pending: boolean };
    expect(again).toMatchObject({ id, pending: true, cardId: first.cardId });
    expect(t.raised).toHaveLength(1);
    // a repeat commit still needs a live token (the de-dupe never skips the token check)
    expect(await refusal(t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: 'not-a-token' }))).toMatchObject({ code: 'BAD_REQUEST', why: 'stale' });
    state = 'decided';
    const third = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: await preview() })) as { cardId: string };
    expect(third.cardId).not.toBe(first.cardId);
    expect(t.raised).toHaveLength(2);
    expect(t.trustRows()).toEqual([]);
  });

  it('Aegis L1: an open card for an older listing is withdrawn and a new card raised for the new one; the old allow is refused', async () => {
    const t = setup('darwin', () => 'pending');
    const id = await t.enable('neurons');
    t.list('neurons');
    const preview = async (): Promise<string> => ((await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string }).token;
    t.raised.length = 0;
    const a = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: await preview() })) as { cardId: string };
    const cardA = t.raised[0]!;
    // the server re-lists with another tool list (L2)
    const l2 = [...TOOLS, { name: 'more', description: 'More.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } }];
    t.tick(1000);
    t.list('neurons', l2);
    const b = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: await preview() })) as { cardId: string };
    expect(b.cardId).not.toBe(a.cardId);
    expect(t.expired).toEqual([a.cardId]);
    expect(t.raised).toHaveLength(2);
    expect(t.raised[1]!.detail).toMatchObject({ toolsHash: toolsHashOf(l2) });
    // card A's allow is refused (its listing is gone) before the prompt and at the effect; nothing is set
    expect(() => cardA.prepare('allow')).toThrow(/changed/);
    await expect(cardA.effect('allow')).rejects.toThrow(/changed/);
    expect(t.trustRows()).toEqual([]);
    // the same listing again returns card B
    expect(await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token: await preview() })).toMatchObject({ cardId: b.cardId });
    expect(t.raised).toHaveLength(2);
  });
});

describe('Aegis C5\'a1 review: H1 a fresh press, L1 re-trust, L3 restart', () => {
  it('H1: commit raises ONE hand-only grant card (never standing) binding id, launch, tools and reads; without the press nothing is set', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const { token, launchHash, toolsHash } = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string; launchHash: string; toolsHash: string };
    t.raised.length = 0;
    expect(await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token })).toMatchObject({ id, pending: true });
    expect(t.raised).toHaveLength(1);
    const c = t.raised[0]!;
    expect(c).toMatchObject({ kind: 'grant', handOnly: true, detail: { action: 'mcp.trust', id, launchHash, toolsHash, reads: ['search'], rootRows: [] } });
    // a standing grant never satisfies it ('grant' is never standing)
    expect(NEVER_STANDING_KINDS.has('grant')).toBe(true);
    expect(standingTupleOf({ kind: 'grant' } as never, 'allow', c.detail, null)).toBeNull();
    // no press (or a deny): trust stays unset
    expect(t.trust.of(id)).toBeNull();
    await c.effect('deny');
    expect(t.trust.of(id)).toBeNull();
    expect(t.trustRows()).toEqual([]);
  });

  it('H1: a listing that changed between the card and the approval is refused before the presence prompt and at the effect', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const { token } = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'commit', token });
    const c = t.raised.at(-1)!;
    t.list('neurons', [TOOLS[0]!]);
    expect(await refusal(Promise.resolve().then(() => c.prepare('allow')))).toMatchObject({ why: 'changed' });
    expect(await refusal(c.effect('allow'))).toMatchObject({ why: 'changed' });
    expect(t.trust.of(id)).toBeNull();
    expect(t.trustRows()).toEqual([]);
  });

  it('L1: trust dropped (a launch change), the launch reverted, trusted again: the server is trusted', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const p1 = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    await t.commit(id, p1.token);
    t.trust.drop(id, 'launch-changed');
    expect(t.trust.of(id)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    const p2 = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    await t.commit(id, p2.token);
    expect(t.trust.of(id)).not.toBeNull();
    expect(statusTrust(t.m, 'neurons').level).toBe('trusted');
  });

  it('L3: a trusted server that is on nowhere (its disabled drop row never landed) is dropped again at start', async () => {
    const t = setup();
    const id = await t.enable('neurons');
    t.list('neurons');
    const { token } = (await t.m.request(human, MCP_TRUST_REQUEST, { id, op: 'preview' })) as { token: string };
    await t.commit(id, token);
    // the store lost the entry while the trust row stayed (a failed drop write, then a restart)
    fs.writeFileSync(mcpServersPath(t.home), JSON.stringify({ schema: 'gnomon-mcp-servers:v1', enabled: [], firstParty: { paradigm: 'on' } }));
    expect(t.m.reconcileTrust()).toEqual([id]);
    expect(t.trust.of(id)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.trustRows().map((r) => [r.op, r.why])).toEqual([['set', 'human'], ['dropped', 'disabled']]);
    expect(t.m.reconcileTrust()).toEqual([]);
  });
});
