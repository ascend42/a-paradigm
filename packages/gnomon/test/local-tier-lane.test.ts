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
import { readTiers, toolTiersPath } from '../src/kernel/local/tool-tier.js';
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
});
