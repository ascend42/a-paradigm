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
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { CAPABILITY_TEXT_MAX, LocalLane } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
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
});
