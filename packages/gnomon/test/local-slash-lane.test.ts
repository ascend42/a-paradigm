/**
 * G-LCL-25 / G-LCL-28 (slice C6'a2-1): "/" runs and the tier-0 start in a live local session — the REAL gnomon-local
 * child against a fake OpenAI-compatible endpoint and the fake stdio MCP server (TEST-RIG-ONLY unsandboxed launchPlan,
 * as test/local-capabilities-lane.test.ts). tools.start is tier 0 only; at tier 0 no list_changed or restart ever sends
 * a tools_set (no tool.selection row); a run of an unknown id, an untrusted server's tool or a narrow human-only form
 * is refused with a tool.brokered{author:'human'} row; tools.result reads only a held run; tools.policy needs the
 * daemon's policy book.
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

describe('G-LCL-25 "/" runs and the tier-0 start (kernel side)', () => {
  it('tier-0 only start, no tools_set at tier 0, run refusals with author human rows, result and policy refusals', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-slash-')));
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
      runMode: () => ({ effective: 'ask' }),
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [{ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, path.join(root!, 'pid')], trust: 'enabled' }],
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const ask = (kind: string, p: Record<string, unknown>, asker: object = human) => lane.humanRequest(asker as never, kind, p) as Promise<Record<string, unknown>>;
    try {
      // tier 1 at open: its servers started with the session, so start is refused
      await expect(ask('request.session.tools.start', { hsid: s.hsid })).rejects.toThrow(/tier 0/);
      // to tier 0: nothing is offered from now on
      const pv = await ask('request.session.tier', { hsid: s.hsid, op: 'preview', tier: 0 });
      await ask('request.session.tier', { hsid: s.hsid, op: 'commit', token: pv.token });
      expect(await ask('request.session.tools.start', { hsid: s.hsid })).toMatchObject({ started: true, already: true, offered: 0 });
      const selections = rows.filter((r) => r.kind === 'tool.selection').length;
      await ask('request.session.mcp.restart', { hsid: s.hsid, server: 'fake' });
      await new Promise((r) => setTimeout(r, 200));
      expect(rows.filter((r) => r.kind === 'tool.selection').length).toBe(selections);

      const caps = (await ask('request.session.capabilities', { hsid: s.hsid })) as unknown as { tools: Array<{ id: string; humanOnly: boolean; run: { runnable: boolean; why?: string } }> };
      expect(caps.tools.length).toBeGreaterThan(0);
      expect(caps.tools.every((t) => t.run.runnable === false && t.run.why === 'untrusted')).toBe(true);
      const before = rows.length;
      expect(await ask('request.session.tools.run', { hsid: s.hsid, id: 'fake/nope@00000000', args: {}, form: 'narrow' })).toMatchObject({ status: 'refused', why: 'unknown-tool', isError: true });
      expect(await ask('request.session.tools.run', { hsid: s.hsid, id: caps.tools[0]!.id, args: {}, form: 'full' })).toMatchObject({ status: 'refused', why: 'untrusted' });
      const brokered = rows.slice(before).filter((r) => r.kind === 'tool.brokered').map((r) => r.payload);
      expect(brokered).toHaveLength(2);
      for (const b of brokered) {
        expect(b.author).toBe('human');
        expect(validateKindPayload('tool.brokered', b)).toEqual([]);
      }
      // malformed requests and the other two requests
      await expect(ask('request.session.tools.run', { hsid: s.hsid, id: caps.tools[0]!.id, args: {}, form: 'wide' })).rejects.toThrow(/form/);
      await expect(ask('request.session.tools.result', { hsid: s.hsid, runId: 'run-' + '0'.repeat(24) })).rejects.toThrow(/no held result/);
      await expect(ask('request.session.tools.policy', { hsid: s.hsid, id: caps.tools[0]!.id, policy: 'send' }, { ...human, credential: 'device' })).rejects.toThrow(/press in the Gnomon app/);
      await expect(ask('request.session.tools.policy', { hsid: s.hsid, id: caps.tools[0]!.id, policy: 'ask' })).rejects.toThrow(/not available/);
      await expect(ask('request.session.tools.run', { hsid: s.hsid, id: 'x', args: {}, form: 'narrow' }, { ...human, credential: 'voice' })).rejects.toThrow(/gui or device/);
    } finally {
      await lane.stop(HUMAN, { hsid: s.hsid });
      await waitFor(() => true);
    }
  }, 30_000);
});
