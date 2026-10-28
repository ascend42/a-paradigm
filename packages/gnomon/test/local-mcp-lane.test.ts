/**
 * TD-2026-10-27-833 slice C2' end to end: a LOCAL session offered narrow tools from an MCP server (#capability-index
 * over #local-mcp-client) calls them through #local-tool-broker. The REAL gnomon-local child against a fake
 * OpenAI-compatible endpoint, the fake stdio MCP server (test/fixtures/fake-mcp-server.mjs) spawned through the
 * session's launch plan (the TEST-RIG-ONLY unsandboxed `launchPlan` seam, as test/local-lane-spawn.test.ts). A read
 * tool runs with no card; a mutate tool raises ONE permission card naming mcp:<server>/<tool> with the reassembled
 * call; a split op is fixed by the kernel; the server is reaped when the session exits; a loop session gets none.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { PKG_ROOT } from './helpers.js';
import { waitFor } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
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

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('slice C2\': a local session calls a narrow MCP tool end to end', () => {
  it('read runs, mutate raises one card with the reassembled call, the op is kernel-fixed; reaped on exit', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-mcpl-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    const pidfile = path.join(root, 'fake-mcp.pid');
    srv = await fakeOpenAI({
      tools: true,
      script: [
        { toolCalls: [{ name: 'echo', arguments: '{"text":"hi"}' }] },
        { toolCalls: [{ name: 'fam.set', arguments: '{"text":"v","op":"get"}' }] },
        { toolCalls: [{ name: 'poke', arguments: '{"text":"there"}' }] },
        { content: 'Done.' },
      ],
    });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const cards: Array<Record<string, unknown>> = [];
    const plans: Array<{ binaryReal: string; argv: readonly string[]; policy: { allowRead: Array<{ path: string }>; denyWrite: Array<{ path: string }> } }> = [];
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      broker: { raise: async (i) => (cards.push(i as never), { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' } as never), decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp', surface: 'full' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => (plans.push(i), { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [{ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, pidfile], trust: 'trusted' }, { id: 'user::far', name: 'far', transport: 'http', trust: 'trusted' }],
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const offered = rows.find((r) => r.kind === 'session.sandbox' && r.payload.hsid === s.hsid)!.payload.brokeredTools as string[];
    expect(offered).toEqual(expect.arrayContaining(['echo', 'poke', 'fam.get', 'fam.set']));
    expect(offered).not.toContain('fam');
    await lane.send(HUMAN, { hsid: s.hsid, text: 'go' });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 20_000)).toBe(true);
    const brokered = rows.filter((r) => r.kind === 'tool.brokered').map((r) => r.payload);
    for (const b of brokered) expect(validateKindPayload('tool.brokered', b)).toEqual([]);
    // read: ran with no card; mutate: one card. The model's smuggled op never leaves the child (the narrow schema has
    // no op and is closed); the kernel's own refusal of it is test/local-tool-broker.test.ts (G-LCL-16)
    expect(brokered.map((b) => [b.server, b.tool, b.class, b.decision])).toEqual([
      ['fake', 'echo', 'read', 'ran'],
      ['fake', 'poke', 'mutate', 'approved'],
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.tool).toBe('mcp:fake/poke');
    expect(cards[0]!.toolInput).toEqual({ text: 'there' });
    const agentReqs = srv.requests.filter((r) => !JSON.stringify(r.tools ?? []).includes('get_time'));
    const toolMsgs = (agentReqs[agentReqs.length - 1]!.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool');
    expect(toolMsgs[0]!.content).toContain('source="mcp:fake"');
    expect(toolMsgs[0]!.content).toContain('echo:{"text":"hi"}');
    // the server ran exactly two calls: echo (1) and poke (2); fam never reached it
    expect(toolMsgs[2]!.content).toContain('poke:{"text":"there"}:2');
    // Aegis H2: the server's own profile reads nothing of the session dir; its env carries no kernel credential
    const runnerPlan = plans.find((p) => p.argv[0] !== FAKE)!;
    const mcpPlan = plans.find((p) => p.argv[0] === FAKE)!;
    const sessionDir = path.join(home, 'sessions');
    expect(runnerPlan.policy.allowRead.some((r) => r.path.startsWith(sessionDir))).toBe(true);
    expect(mcpPlan.policy.allowRead.some((r) => r.path.startsWith(sessionDir))).toBe(false);
    // Aegis H1: the session profile write-denies the node server's project launch files inside the root
    const real = fs.realpathSync.native(cwd);
    expect(runnerPlan.policy.denyWrite.map((d) => d.path)).toEqual(expect.arrayContaining([path.join(real, 'package.json'), path.join(real, 'node_modules')]));
    expect(JSON.parse(fs.readFileSync(`${pidfile}.env`, 'utf8'))).toEqual([]);
    const pid = Number(fs.readFileSync(pidfile, 'utf8'));
    expect(alive(pid)).toBe(true);
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
    expect(await waitFor(() => !alive(pid), 5_000)).toBe(true);
  }, 40_000);
});
