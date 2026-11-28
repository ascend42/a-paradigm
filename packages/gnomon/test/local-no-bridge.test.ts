/**
 * S1.4 P5 review (Aegis I-2, A6 as a behaviour test): a LOCAL session is offered no mod tool of the bridge. The REAL
 * gnomon-local child against the fake OpenAI-compatible endpoint, through the LocalLane as test/local-mcp-lane.test.ts
 * builds it (its unsandboxed `launchPlan` rig seam), with NO local MCP server. What the model is actually SENT (every
 * request's `tools`) and what the session row says it was offered hold no `dim-` and no `gnomon-mods` name, and the
 * session writes no mcp.json entry for the bridge. The lane holds no mod host at all (it is constructed without one;
 * the source half is test/mods-bridge.test.ts), so no dimension mod can be started from it.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
let srv: FakeServer | null = null;
let root: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('A6: a local session is offered no gnomon-mods tool (behaviour)', () => {
  it('the tools the model is sent and the offered list hold no dim- or gnomon-mods name', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-a6-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, script: [{ content: 'Done.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const plans: Array<{ argv: readonly string[] }> = [];
    const lane = new LocalLane({
      sessionPath: null, pathDenies: [], log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp', surface: 'full' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => (plans.push(i), { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    await lane.probeAll({ generate: true });
    await lane.tierSettled();
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    await lane.send(HUMAN, { hsid: s.hsid, text: 'draw a box on the board' });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 20_000)).toBe(true);
    const offered = rows.find((r) => r.kind === 'session.sandbox' && r.payload.hsid === s.hsid)!.payload.brokeredTools as string[];
    const sent = srv.requests.flatMap((q) => (Array.isArray(q.tools) ? (q.tools as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '') : []));
    expect(sent.length).toBeGreaterThan(0); // the model really was sent a tool list
    const bridgeLike = (n: string) => /^dim-|gnomon-mods|mcp__gnomon-mods/.test(n);
    expect([...offered, ...sent].filter(bridgeLike)).toEqual([]);
    expect(JSON.stringify(plans).includes('gnomon-mods')).toBe(false);
    await lane.stop(HUMAN, { hsid: s.hsid });
  }, 60_000);
});
