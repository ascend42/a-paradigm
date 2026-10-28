/**
 * #local-tool-tier (slice C4'a; G-LCL-21) in a live local session: the REAL gnomon-local child against a fake
 * OpenAI-compatible endpoint (16k), the fake stdio MCP server through the TEST-RIG-ONLY unsandboxed launchPlan seam (as
 * test/local-mcp-lane.test.ts). An unmeasured endpoint opens provisional at tier 1; request.session.tier is human-only
 * and two-phase (stale, expired, wrong principal and reused tokens refused); a commit to tier 3 offers FULL schemas the
 * model sees; remember persists per model and the next open is labelled human. The child half: a tools_set surface
 * switch recomputes its ledger.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { Agent } from '../../gnomon-local/src/agent.js';
import { KernelToolBroker } from '../../gnomon-local/src/broker.js';
import { COMPAT_ALLOWLIST } from '../../gnomon-local/src/compat.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { readTiers, setHuman, toolTiersPath } from '../src/kernel/local/tool-tier.js';
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

describe('slice C4\'a: a live session\'s tool tier', () => {
  it('provisional at open; human-only two-phase change; tier 3 offers full schemas; remember labels the next open human', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tier-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: [{ content: 'Done.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    let clock = Date.now();
    const lane = new LocalLane({ sessionPath: null, pathDenies: [], now: () => clock,
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [{ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, path.join(root!, 'pid')], trust: 'trusted' }],
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const caps = (hsid: string) => rows.filter((r) => r.kind === 'model.capabilities' && r.payload.hsid === hsid && r.payload.tier !== undefined).map((r) => r.payload);
    expect(caps(s.hsid)[0]).toMatchObject({ tier: 1, tierSource: 'provisional', measured: null, surface: 'compact' });
    const tier = (asker: object, p: Record<string, unknown>) => lane.humanRequest(asker as never, 'request.session.tier', { hsid: s.hsid, ...p });
    // an agent principal is refused on both phases
    await expect(tier({ ...human, principalClass: 'agent' }, { op: 'preview', tier: 3 })).rejects.toThrow(/human/);
    await expect(tier({ ...human, principalClass: 'agent' }, { op: 'commit', token: '0'.repeat(32) })).rejects.toThrow(/human/);
    const preview = async (t = 3) => (await tier(human, { op: 'preview', tier: t })) as { token: string } & Record<string, unknown>;
    const p1 = await preview();
    expect(p1).toMatchObject({ from: 1, to: 3, measured: null, k: 12, slotTokens: 4000, surface: 'compact→full', cacheLost: true });
    expect(p1.notice).toContain('Tier 3 is above what this model measured (not measured yet)');
    // a preview changes nothing
    expect(caps(s.hsid)).toHaveLength(1);
    // the wrong principal (not the owner) never reaches the session; a wrong token is stale and burns the preview
    await expect(tier({ ...human, principal: 'p:abcdefgh/other' }, { op: 'commit', token: p1.token })).rejects.toThrow(/no such running/);
    await expect(tier(human, { op: 'commit', token: 'f'.repeat(32) })).rejects.toThrow(/stale/);
    await expect(tier(human, { op: 'commit', token: p1.token })).rejects.toThrow(/stale/);
    // expired
    const p2 = await preview();
    clock += 61_000;
    await expect(tier(human, { op: 'commit', token: p2.token })).rejects.toThrow(/stale/);
    // a valid commit applies; the same token again is refused
    const p3 = await preview();
    const done = await tier(human, { op: 'commit', token: p3.token });
    expect(done).toMatchObject({ tier: 3, previous: 1, tierSource: 'human', surface: 'full', remembered: false });
    await expect(tier(human, { op: 'commit', token: p3.token })).rejects.toThrow(/stale/);
    expect(caps(s.hsid).at(-1)).toMatchObject({ tier: 3, previous: 1, measured: null, tierSource: 'human' });
    const sel = rows.filter((r) => r.kind === 'tool.selection' && r.payload.hsid === s.hsid).at(-1)!.payload;
    expect(sel.trigger).toBe('tier');
    expect(validateKindPayload('tool.selection', sel)).toEqual([]);
    // the model sees the FULL schema (the original inputSchema: no narrow additionalProperties) under surface full
    await lane.send(HUMAN, { hsid: s.hsid, text: 'go' });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 20_000)).toBe(true);
    const req = srv.requests.filter((r) => JSON.stringify(r.tools ?? []).includes('read_file')).at(-1)!;
    const echo = (req.tools as Array<{ function: { name: string; parameters: unknown } }>).find((t) => t.function.name === 'echo')!;
    expect(echo.function.parameters).toEqual({ type: 'object', properties: { text: { type: 'string' } } });
    // remember: the human's value is stored for this model (its fingerprint) and labels the next open
    const p4 = await preview(2);
    expect(await tier(human, { op: 'commit', token: p4.token, remember: true })).toMatchObject({ tier: 2, previous: 3, remembered: true, surface: 'compact' });
    expect(fs.statSync(toolTiersPath(home)).mode & 0o777).toBe(0o600);
    const recs = Object.values(readTiers(home).records);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ model: 'fake-qwen-7b-q4', fingerprint: 'llama.cpp:/models/fake-qwen-7b-q4.gguf|fake-qwen-7b-q4', human: 2 });
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
    const s2 = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    expect(caps(s2.hsid)[0]).toMatchObject({ tier: 2, tierSource: 'human' });
    await lane.stop(HUMAN, { hsid: s2.hsid });
    expect(await waitFor(() => lane.stateOf(s2.hsid) === 'exited', 5_000)).toBe(true);
  }, 40_000);

  it('the child: a tools_set surface applies with its set, acks, and recomputes the ledger; surface none never changes', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tierc-')));
    srv = await fakeOpenAI({ tools: true, script: [{ content: 'a' }, { content: 'b' }] });
    const evs: Array<Record<string, unknown>> = [];
    const emit = (e: Record<string, unknown>): void => void evs.push(e);
    const broker = new KernelToolBroker({ emit });
    const big = { name: 'mk', description: 'make', class: 'read' as const, parameters: { type: 'object', properties: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, { type: 'string', description: `the parameter number ${i} of this tool` }])) } };
    const a = new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'compact', cwd: root, roots: [root], maxSteps: 2, maxTokens: 256, contextTarget: 8192, broker, emit });
    expect(a.setBrokered([big], 'ts-1')).toBeNull();
    await a.prompt('one');
    const toolsSlot = (): number => ((evs.filter((e) => e.type === 'context_report').at(-1)!.slots as { tools: number }).tools);
    const compact = toolsSlot();
    expect(a.setBrokered([big], 'ts-2', 'full')).toBeNull();
    expect(a.surface).toBe('full');
    expect(evs.some((e) => e.type === 'tools_applied' && e.id === 'ts-2')).toBe(true);
    await a.prompt('two');
    expect(toolsSlot()).toBeGreaterThan(compact);
    const none = new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'none', cwd: root, roots: [root], maxSteps: 1, maxTokens: 256, broker, emit });
    expect(none.setBrokered([big], 'ts-1', 'full')).toMatch(/surface none/);
    expect(none.surface).toBe('none');
  });

  it('Aegis L1 (b): a set with no surface keeps a pending surface change (the child ends on full)', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tierl1-')));
    srv = await fakeOpenAI({ tools: true, script: [{ content: 'a', delayMs: 200 }, { content: 'b' }] });
    const evs: Array<Record<string, unknown>> = [];
    const emit = (e: Record<string, unknown>): void => void evs.push(e);
    const t = { name: 'mk', description: 'make', class: 'read' as const, parameters: { type: 'object', properties: { a: { type: 'string' } } } };
    const a = new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'compact', cwd: root, roots: [root], maxSteps: 2, maxTokens: 256, broker: new KernelToolBroker({ emit }), emit });
    const run = a.prompt('one');
    await new Promise((r) => setTimeout(r, 50));
    expect(a.running).toBe(true);
    // the tier commit's set (full), then a selection's set with no surface, both before the next step
    expect(a.setBrokered([t], 'ts-1', 'full')).toBeNull();
    expect(a.setBrokered([t, { ...t, name: 'mk2' }], 'ts-2')).toBeNull();
    await run;
    await a.prompt('two');
    expect(a.surface).toBe('full');
    expect(a.brokered).toEqual(['mk', 'mk2']);
  });

  it('Aegis L2: two interleaved commits during an MCP start — the loser is stale and nothing stale is sent', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tierl2-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: [{ content: 'Done.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [{ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, path.join(root!, 'pid')], trust: 'trusted' }],
    });
    // measured (fingerprint known), then the human's remembered tier 0: the session opens with no MCP server started
    await lane.probeAll();
    await lane.tierSettled();
    const rec = Object.values(readTiers(home).records)[0]!;
    setHuman(home, { base: rec.base, model: rec.model, fingerprint: rec.fingerprint }, 0);
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const caps = () => rows.filter((r) => r.kind === 'model.capabilities' && r.payload.hsid === s.hsid && r.payload.tier !== undefined).map((r) => r.payload);
    expect(caps()[0]).toMatchObject({ tier: 0, tierSource: 'human' });
    const tier = (p: Record<string, unknown>) => lane.humanRequest(human as never, 'request.session.tier', { hsid: s.hsid, ...p }) as Promise<Record<string, unknown>>;
    const pa = (await tier({ op: 'preview', tier: 3 })).token;
    const a = tier({ op: 'commit', token: pa });
    // A is waiting on the MCP start; B previews and commits on top of it
    const pb = (await tier({ op: 'preview', tier: 2 })).token;
    await expect(tier({ op: 'commit', token: pb })).rejects.toThrow(/stale/);
    expect(await a).toMatchObject({ tier: 3, previous: 0, surface: 'full' });
    const human_ = caps().filter((c) => c.previous !== undefined);
    expect(human_).toEqual([expect.objectContaining({ tier: 3, previous: 0, surface: 'full' })]);
    expect(rows.filter((r) => r.kind === 'tool.selection' && r.payload.hsid === s.hsid && r.payload.trigger === 'tier')).toHaveLength(1);
    // Aegis L1 (a): a later selection keeps the child on full (the model sees the full echo schema)
    await lane.humanRequest(human as never, 'request.session.tools.pin', { hsid: s.hsid, name: 'echo', pinned: true });
    await lane.send(HUMAN, { hsid: s.hsid, text: 'go' });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 20_000)).toBe(true);
    const req = srv.requests.filter((r) => JSON.stringify(r.tools ?? []).includes('read_file')).at(-1)!;
    const echo = (req.tools as Array<{ function: { name: string; parameters: unknown } }>).find((t) => t.function.name === 'echo')!;
    expect(echo.function.parameters).toEqual({ type: 'object', properties: { text: { type: 'string' } } });
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
  }, 40_000);

  it('Aegis L3: an existing local/ dir that is too open is narrowed to 0700', () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tierl3-')));
    fs.mkdirSync(path.join(root, 'local'), { mode: 0o755 });
    fs.chmodSync(path.join(root, 'local'), 0o755);
    setHuman(root, { base: 'http://127.0.0.1:1', model: 'm', fingerprint: 'f' }, 2);
    expect(fs.statSync(path.join(root, 'local')).mode & 0o777).toBe(0o700);
  });

  /** a lane on a fresh home against `srv` (the C4'b cases) */
  const laneFor = () => {
    const cwd = path.join(root!, 'repo');
    const home = path.join(root!, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root!, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root!, 'k.sock'),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv!.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    const open = async () => (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const stop = async (hsid: string) => {
      await lane.stop(HUMAN, { hsid });
      expect(await waitFor(() => lane.stateOf(hsid) === 'exited', 5_000)).toBe(true);
    };
    return { lane, rows, home, open, stop };
  };

  it('C4\'b: re-measure and clear are human-only; a second re-measure joins; clear makes the next open measured; rememberable says why not', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tierb-')));
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: [{ content: 'Done.' }] });
    const { lane, rows, home, open, stop } = laneFor();
    const ask = (asker: object, kind: string, p: Record<string, unknown>) => lane.humanRequest(asker as never, kind, p);
    // principal refusals: an agent, or a human on a non-gui/device connection, never reaches either request
    for (const kind of ['request.local.tier.remeasure', 'request.local.tier.clear']) {
      await expect(ask({ ...human, principalClass: 'agent' }, kind, { endpoint: 'fake' })).rejects.toThrow(/human/);
      await expect(ask({ ...human, credential: 'cli' }, kind, { endpoint: 'fake' })).rejects.toThrow(/human/);
      await expect(ask(human, kind, { endpoint: 'nope' })).rejects.toThrow(/no configured endpoint/);
      await expect(ask(human, kind, { endpoint: 'fake', hsid: 'x' })).rejects.toThrow(/takes \{endpoint\}/);
    }
    await lane.probeAll();
    await lane.tierSettled();
    const measuredRows = () => rows.filter((r) => r.kind === 'model.capabilities' && r.payload.tierSource === 'measured' && r.payload.action === undefined && r.payload.hsid === undefined);
    const before = measuredRows().length;
    expect(before).toBe(1);
    // two re-measures at once: the second joins the first (one measurement); measuring shows at once
    const r1 = await ask(human, 'request.local.tier.remeasure', { endpoint: 'fake' });
    expect(r1).toEqual({ endpoint: 'fake', measuring: true, joined: false });
    expect(lane.lastProbe()?.tier?.measuring).toBe(true);
    const r2 = await ask({ ...human, credential: 'device' }, 'request.local.tier.remeasure', { endpoint: 'fake' });
    expect(r2).toEqual({ endpoint: 'fake', measuring: true, joined: true });
    await lane.tierSettled();
    expect(measuredRows()).toHaveLength(before + 1);
    expect(lane.lastProbe()?.tier).toMatchObject({ measuring: false, human: null });
    // a remembered tier, then clear: the store forgets it, one row says so, and the next open is measured
    const rec = Object.values(readTiers(home).records)[0]!;
    setHuman(home, { base: rec.base, model: rec.model, fingerprint: rec.fingerprint }, 3);
    const s1 = await open();
    const caps = (hsid: string) => rows.filter((r) => r.kind === 'model.capabilities' && r.payload.hsid === hsid && r.payload.tier !== undefined).map((r) => r.payload);
    expect(caps(s1.hsid)[0]).toMatchObject({ tier: 3, tierSource: 'human' });
    expect(await ask(human, 'request.local.tier.clear', { endpoint: 'fake' })).toMatchObject({ endpoint: 'fake', cleared: true, previous: 3, measured: rec.skill });
    expect(rows.filter((r) => r.payload.action === 'human-cleared')).toEqual([{ kind: 'model.capabilities', payload: expect.objectContaining({ endpoint: 'fake', tierSource: 'measured', tier: rec.skill, previous: 3 }) }]);
    expect(Object.values(readTiers(home).records)[0]).toMatchObject({ human: null, skill: rec.skill });
    // nothing remembered: a second clear changes nothing and writes no row
    expect(await ask(human, 'request.local.tier.clear', { endpoint: 'fake' })).toMatchObject({ cleared: false, why: 'none' });
    expect(rows.filter((r) => r.payload.action === 'human-cleared')).toHaveLength(1);
    // the open session keeps its tier (no row, nothing sent); a new one opens measured
    expect(caps(s1.hsid)).toHaveLength(1);
    const s2 = await open();
    expect(caps(s2.hsid)[0]).toMatchObject({ tier: rec.skill, tierSource: 'measured' });
    const preview = (hsid: string) => ask(human, 'request.session.tier', { hsid, op: 'preview', tier: 2 });
    expect(await preview(s2.hsid)).toMatchObject({ rememberable: true });
    expect((await preview(s2.hsid)).rememberWhy).toBeUndefined();
    // the store cannot be written (its directory is a file): rememberable false, store-unwritable
    fs.rmSync(path.join(home, 'local'), { recursive: true, force: true });
    fs.writeFileSync(path.join(home, 'local'), 'not a dir\n');
    expect(await preview(s2.hsid)).toMatchObject({ rememberable: false, rememberWhy: 'store-unwritable' });
    await stop(s1.hsid);
    await stop(s2.hsid);
  }, 40_000);

  it('C4\'b: a server that names no model file (no fingerprint) previews rememberable false, no-fingerprint', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-tierbf-')));
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, modelPath: '', script: [{ content: 'Done.' }] });
    const { lane, open, stop } = laneFor();
    const s = await open();
    expect(await lane.humanRequest(human as never, 'request.session.tier', { hsid: s.hsid, op: 'preview', tier: 2 })).toMatchObject({ rememberable: false, rememberWhy: 'no-fingerprint' });
    expect(await lane.humanRequest(human as never, 'request.local.tier.clear', { endpoint: 'fake' })).toMatchObject({ cleared: false, why: 'no-fingerprint' });
    await stop(s.hsid);
  }, 40_000);
});
