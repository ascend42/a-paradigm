/**
 * G-LCL-24 #gui-capability-browser, kernel side (slice C6'a1): request.session.capabilities{hsid} in a live local
 * session — the REAL gnomon-local child against a fake OpenAI-compatible endpoint, the fake stdio MCP server through the
 * TEST-RIG-ONLY unsandboxed launchPlan seam (as test/local-tier-lane.test.ts). It is human-only (gui or device), the
 * owner's, read only (no row, no tools_set), and every server string in it is cleaned and capped; servers fold the
 * launch-check and pool refusals with the pool's runtime state; each tool says how the model can reach it at the
 * session's tier and mode; pins say why they are not offered.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { CAPABILITY_TEXT_MAX, LocalLane } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { McpListCache } from '../src/kernel/local/mcp-client.js';
import { bindingOf } from '../src/kernel/local/trust-book.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { PKG_ROOT } from './helpers.js';
import { waitFor } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
const human = { connId: 'c1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const CLI = path.join(PKG_ROOT, '..', 'gnomon-local', 'dist', 'cli.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
let srv: FakeServer | null = null;
let root: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

type Caps = {
  generation: number; tier: number; k: number; surface: string; mode: string;
  verbs: Array<{ name: string; class: string }>;
  servers: Array<{ label: string; trust: string; state: string; fit?: string; why?: string; error?: string; starts: number; counts: { read: number; mutate: number; destructive: number } }>;
  pins: Array<{ name: string; offered: boolean; why?: string }>;
  tools: Array<{ id: string; name: string; server: string; class: string; humanOnly: boolean; availability: string; description: string; params: Array<{ name: string; required: boolean; type: string; description?: string }>; fullSchema?: Record<string, unknown> }>;
};

describe('G-LCL-24 request.session.capabilities (kernel side)', () => {
  it('owner-only and read only; servers, tools, availability per tier and mode, pins, cleaned and capped text', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-caps-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: [{ content: 'Done.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    let mode: 'ask' | 'manual' = 'ask';
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      runMode: () => ({ effective: mode }),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [
        { id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, path.join(root!, 'pid'), 'dirty'], trust: 'enabled' },
        { id: 'user::broken', name: 'broken', transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures', 'no-such-server.mjs')], trust: 'enabled' },
        { id: 'user::inline', name: 'inline', transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(0)'], trust: 'enabled' },
        { id: 'user::far', name: 'far', transport: 'http', trust: 'enabled' },
      ],
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const ask = (asker: object, kind: string, p: Record<string, unknown>) => lane.humanRequest(asker as never, kind, p);
    const caps = async (): Promise<Caps> => (await ask(human, 'request.session.capabilities', { hsid: s.hsid })) as unknown as Caps;

    // refusals: an agent principal, a voice credential, another principal (NOT_FOUND: never reaches the session), extra keys
    await expect(ask({ ...human, principalClass: 'agent' }, 'request.session.capabilities', { hsid: s.hsid })).rejects.toThrow(/human/);
    await expect(ask({ ...human, credential: 'voice' }, 'request.session.capabilities', { hsid: s.hsid })).rejects.toThrow(/gui or device/);
    await expect(ask({ ...human, principal: 'p:abcdefgh/other' }, 'request.session.capabilities', { hsid: s.hsid })).rejects.toThrow(/no such running/);
    await expect(ask(human, 'request.session.capabilities', { hsid: s.hsid, tools: true })).rejects.toThrow(/takes \{hsid\}/);

    // read only: no row is written, no selection moves
    const before = rows.length;
    const c1 = await caps();
    expect(await ask({ ...human, credential: 'device' }, 'request.session.capabilities', { hsid: s.hsid })).toMatchObject({ hsid: s.hsid });
    expect(rows.length).toBe(before);
    expect(c1).toMatchObject({ tier: 1, k: 4, surface: 'compact', mode: 'ask' });
    expect(typeof c1.generation).toBe('number');

    // servers: running (started once), failed at index (its readable error), refused by the launch check and by the pool
    const byLabel = Object.fromEntries(c1.servers.map((x) => [x.label, x]));
    expect(byLabel.fake).toMatchObject({ trust: 'enabled', state: 'running', starts: 1 });
    // an enabled (untrusted) server's own read labels are not believed: its tools count as mutate
    expect(byLabel.fake!.counts).toMatchObject({ read: 0, destructive: 0 });
    expect(byLabel.fake!.counts.mutate).toBe(c1.tools.length);
    expect(byLabel.broken).toMatchObject({ state: 'failed', error: expect.stringMatching(/could not start|exited|closed/) });
    expect(byLabel.inline).toMatchObject({ state: 'refused', fit: 'launch-writable', why: expect.stringMatching(/inline code/) });
    expect(byLabel.far).toMatchObject({ state: 'refused', fit: 'remote-refused', why: expect.stringMatching(/remote/) });
    // session.mcp rows: one per start, failure and refusal, each a valid closed row (no server text past its cap)
    const mcpRows = rows.filter((r) => r.kind === 'session.mcp').map((r) => r.payload);
    for (const r of mcpRows) expect(validateKindPayload('session.mcp', r)).toEqual([]);
    expect(mcpRows).toEqual(expect.arrayContaining([
      { hsid: s.hsid, server: 'fake', state: 'started' },
      { hsid: s.hsid, server: 'broken', state: 'failed', error: expect.any(String) },
      { hsid: s.hsid, server: 'inline', state: 'refused', fit: 'launch-writable' },
      { hsid: s.hsid, server: 'far', state: 'refused', fit: 'remote-refused' },
    ]));
    expect(mcpRows.filter((r) => r.server === 'broken')).toHaveLength(1);
    for (const x of c1.servers) for (const t of [x.why, x.error].filter((v): v is string => v !== undefined)) expect([...t].length).toBeLessThanOrEqual(CAPABILITY_TEXT_MAX);

    // tools: at tier 1 (K 4) some are offered and the rest are findable; a human-only one is slash-only
    const tool = (c: Caps, name: string) => c.tools.find((t) => t.name === name)!;
    const offered = c1.tools.filter((t) => t.availability === 'offered');
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(4);
    expect(tool(c1, 'storm')).toMatchObject({ class: 'mutate', availability: 'findable', server: 'fake', humanOnly: false });
    expect(tool(c1, 'storm').fullSchema).toBeDefined(); // fullOfferable
    expect(tool(c1, 'storm').params).toEqual([{ name: 'text', required: false, type: 'string' }]);
    // cleaned and capped: the human-only tool's description, its params and its full schema carry no control, bidi or
    // template-token text and no string past its cap
    const dirty = tool(c1, 'dirty');
    expect(dirty).toMatchObject({ humanOnly: true, availability: 'slash-only' });
    expect(dirty.fullSchema).toBeDefined();
    const blob = JSON.stringify(dirty);
    expect(blob).not.toMatch(/[\u0007‮]/);
    expect(blob).not.toContain('<|im_start|>');
    expect(blob).not.toContain('<|im_end|>');
    expect([...dirty.description].length).toBeLessThanOrEqual(CAPABILITY_TEXT_MAX);
    const q = dirty.params.find((p) => p.name === 'q')!;
    expect(q).toMatchObject({ required: true, type: 'any' });
    expect([...q.description!].length).toBeLessThanOrEqual(CAPABILITY_TEXT_MAX);
    const fq = (dirty.fullSchema!.properties as Record<string, { description: string }>).q!;
    expect(fq.description).not.toMatch(/‮/);
    expect([...fq.description].length).toBeLessThanOrEqual(512);
    for (const t of c1.tools) expect(t.id).toMatch(/^fake\//);

    // mode: a manual session's mutate tools are manual-reads-only (an offered one stays offered until the set moves)
    mode = 'manual';
    expect(tool(await caps(), 'storm').availability).toBe('manual-reads-only');
    mode = 'ask';

    // pins: a pinned tool is offered; at tier 0 nothing is offered and every pin says tier-0
    await ask(human, 'request.session.tools.pin', { hsid: s.hsid, name: 'big', pinned: true });
    const c2 = await caps();
    expect(c2.pins).toEqual([{ name: 'big', offered: true }]);
    expect(c2.generation).toBeGreaterThan(c1.generation);
    const commit = async (t: number): Promise<void> => {
      const p = (await ask(human, 'request.session.tier', { hsid: s.hsid, op: 'preview', tier: t })) as { token: string };
      await ask(human, 'request.session.tier', { hsid: s.hsid, op: 'commit', token: p.token });
    };
    await commit(0);
    const c3 = await caps();
    expect(c3).toMatchObject({ tier: 0, k: 0, verbs: [] });
    expect(c3.pins).toEqual([{ name: 'big', offered: false, why: 'tier-0' }]);
    expect(c3.tools.every((t) => t.availability === 'not-at-tier')).toBe(true);
    // tier 3 (full surface): a fullOfferable tool is findable; a human-only one with no full form stays slash-only
    await commit(3);
    const c4 = await caps();
    expect(c4).toMatchObject({ tier: 3, surface: 'full' });
    expect(tool(c4, 'storm').availability).toMatch(/^(offered|findable)$/);
    expect(tool(c4, 'dirty').availability).toBe('slash-only');

    // an ended session is NOT_FOUND
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
    await expect(caps()).rejects.toThrow(/no such running/);
  }, 40_000);

  it('request.session.mcp.restart: owner-only; resets the counter; refused on a trust or launch binding change; one at a time', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-restart-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    // the second server runs through a symlinked dir OUTSIDE the repo; repointed INTO the repo, its launch is refused
    const outside = path.join(root, 'tools');
    fs.mkdirSync(outside);
    fs.copyFileSync(FAKE, path.join(outside, 'srv.mjs'));
    fs.mkdirSync(path.join(cwd, 'tools'));
    fs.copyFileSync(FAKE, path.join(cwd, 'tools', 'srv.mjs'));
    const link = path.join(root, 'link');
    fs.symlinkSync(outside, link, 'dir');
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: [{ content: 'Done.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    // a TrustBook stand-in: trust is set for the newest listing and folded into every session (subscribe)
    const cache = new McpListCache();
    const book = new Map<string, { binding: string; launchHash: string; toolsHash: string; label: string }>();
    const listeners: Array<(id: string) => void> = [];
    const mcpTrust = { of: (id: string) => book.get(id) ?? null, drop: (id: string) => void book.delete(id), subscribe: (fn: (id: string) => void) => (listeners.push(fn), () => undefined) };
    const trustNewest = (id: string): void => {
      const n = cache.newest(id)!;
      book.set(id, { binding: bindingOf({ id, launchHash: n.launchHash, pluginVersion: n.pluginVersion, toolsHash: n.toolsHash }), launchHash: n.launchHash, toolsHash: n.toolsHash, label: n.label });
      for (const fn of listeners) fn(id);
    };
    const LAUNCH = `hmac-sha256:${'1'.repeat(64)}`;
    const lane = new LocalLane({ sessionPath: null, pathDenies: [], mcpCache: cache, mcpTrust,
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [
        { id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE], trust: 'enabled', launchHash: LAUNCH, pluginVersion: null },
        { id: 'user::linked', name: 'linked', transport: 'stdio', command: process.execPath, args: [path.join(link, 'srv.mjs')], trust: 'enabled', launchHash: LAUNCH, pluginVersion: null },
      ],
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const restart = (server: string, asker: object = human) => lane.humanRequest(asker as never, 'request.session.mcp.restart', { hsid: s.hsid, server }) as Promise<Record<string, unknown>>;
    const caps = async () => (await lane.humanRequest(human as never, 'request.session.capabilities', { hsid: s.hsid })) as unknown as Caps;
    const mcpRows = () => rows.filter((r) => r.kind === 'session.mcp').map((r) => r.payload);

    // refusals before anything runs: an agent, another principal, bad params, a server the session does not hold
    await expect(restart('fake', { ...human, principalClass: 'agent' })).rejects.toThrow(/human/);
    await expect(restart('fake', { ...human, principal: 'p:abcdefgh/other' })).rejects.toThrow(/no such running/);
    await expect(restart('Not A Label')).rejects.toThrow(/server label/);
    await expect(restart('nope')).rejects.toThrow(/no MCP server nope/);
    expect((await caps()).servers.find((x) => x.label === 'fake')).toMatchObject({ state: 'running', starts: 1 });

    // a restart kills the process, resets the counter and starts it again (one started row); one at a time
    const n0 = mcpRows().length;
    const [a, b] = await Promise.allSettled([restart('fake'), restart('fake')]);
    expect(a).toMatchObject({ status: 'fulfilled', value: { hsid: s.hsid, server: 'fake', state: 'running', starts: 1 } });
    expect(b.status).toBe('rejected');
    expect(String((b as PromiseRejectedResult).reason)).toMatch(/already starting/);
    expect(mcpRows().slice(n0)).toEqual([{ hsid: s.hsid, server: 'fake', state: 'started' }]);

    // trusted, then the book holds another binding: the trust no longer holds and the restart is refused (one row)
    trustNewest('user::fake');
    expect((await caps()).servers.find((x) => x.label === 'fake')).toMatchObject({ trust: 'trusted' });
    expect(await restart('fake')).toMatchObject({ state: 'running', starts: 1 });
    book.get('user::fake')!.binding = `sha256:${'9'.repeat(64)}`;
    await expect(restart('fake')).rejects.toThrow(/not restarted/);
    expect(mcpRows().at(-1)).toEqual({ hsid: s.hsid, server: 'fake', state: 'refused', fit: 'trust-changed' });

    // the launch moved inside the repo since open: the re-run launch check refuses it
    expect(await restart('linked')).toMatchObject({ state: 'running' });
    fs.unlinkSync(link);
    fs.symlinkSync(path.join(cwd, 'tools'), link, 'dir');
    await expect(restart('linked')).rejects.toThrow(/not restarted/);
    expect(mcpRows().at(-1)).toEqual({ hsid: s.hsid, server: 'linked', state: 'refused', fit: 'launch-writable' });
    for (const r of mcpRows()) expect(validateKindPayload('session.mcp', r)).toEqual([]);

    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
    await expect(restart('fake')).rejects.toThrow(/no such running/);
  }, 40_000);
});
