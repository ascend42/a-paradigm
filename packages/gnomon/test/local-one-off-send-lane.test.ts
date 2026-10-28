/**
 * G-LCL-26 (slice C6'a2-3, founder: "ask" means ask each time): the one-off send and the kernel facts the "/" GUI reads,
 * in a REAL LocalLane — the real gnomon-local child against a fake OpenAI-compatible endpoint, the fake stdio MCP server
 * through the TEST-RIG-ONLY unsandboxed launchPlan seam, trusted by a TrustBook stand-in (whose binding the test can
 * move), a ResultPolicyBook over kernel rows and a stub card broker that allows (as test/local-slash-lane.test.ts).
 *
 * K1: capabilities tools[].policy reads null (first use), then send and ask after the human sets them.
 * K2: capabilities `tainted` is false in a fresh session, true after a one-off send or a skill run, never leaked to
 * another session.
 * K4: request.session.tools.send{hsid, runId} sends ONE held result framed as data and taints the session; it is refused
 * from the device credential, for a non-owner, from another session, past 10 minutes, a second time, while the policy
 * is send and after a binding change; a tools.result read never consumes it; the whole-turn cap holds; the row says
 * policy 'once'.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { LocalLane, RUN_RESULT_TTL_MS } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { McpListCache } from '../src/kernel/local/mcp-client.js';
import { bindingOf } from '../src/kernel/local/trust-book.js';
import { RESULT_FOOTER, ResultPolicyBook, resultCap } from '../src/kernel/local/result-policy.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { PKG_ROOT } from './helpers.js';
import { waitFor } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
const KERNEL = 'p:abcdefgh/kernel';
const human = { connId: 'c1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const CLI = path.join(PKG_ROOT, '..', 'gnomon-local', 'dist', 'cli.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
const SKILL = '---\nname: tidy\ndescription: Tidy the notes\n---\nTidy $ARGUMENTS and report.\n';
let srv: FakeServer | null = null;
let root: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

type Caps = { tainted: boolean; tools: Array<{ id: string; name: string; policy: 'send' | 'ask' | null }> };
const refusalOf = async (p: Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await p;
  } catch (e) {
    const r = (e as { refusal?: { code?: string; data?: Record<string, unknown> } }).refusal;
    return { message: (e as Error).message, code: r?.code, ...(r?.data ?? {}) };
  }
  throw new Error('expected a refusal');
};

describe('G-LCL-26 one-off send (C6\'a2-3) and the capabilities policy and tainted facts', () => {
  it('sends one held result once, framed and tainting; every refusal; the cap; the once row; K1 and K2', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-once-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(path.join(cwd, '.claude', 'skills', 'tidy'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'skills', 'tidy', 'SKILL.md'), SKILL);
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: Array.from({ length: 8 }, () => ({ content: 'Noted.' })) });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload: structuredClone(payload) });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const policy = new ResultPolicyBook({ principal: KERNEL, isKernelKey: () => true });
    let pseq = 0;
    const resultPolicy = { of: (r: string, t: string, b: string) => policy.of(r, t, b), set: async (row: Record<string, unknown>) => policy.fold({ seq: ++pseq, kind: 'tool.result.policy', principal: KERNEL, keyId: 'k', payload: row }) };
    const mcpCache = new McpListCache();
    // the trust stand-in: `drift` moves the binding the TrustBook holds (the server's trust no longer holds)
    let drift = false;
    // the lane's clock: `skew` moves it past the 10-minute hold
    let skew = 0;
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: KERNEL, sock: path.join(root, 'k.sock'),
      runMode: () => ({ effective: 'ask' }),
      now: () => Date.now() + skew,
      broker: { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as never, decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [{ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, path.join(root!, 'pid')], trust: 'enabled', launchHash: `hmac-sha256:${'1'.repeat(64)}` }],
      mcpCache,
      mcpTrust: { of: (id) => { const n = mcpCache.newest(id); return n ? { binding: drift ? `sha256:${'d'.repeat(64)}` : bindingOf({ id, launchHash: n.launchHash, pluginVersion: n.pluginVersion, toolsHash: n.toolsHash }), launchHash: n.launchHash, toolsHash: n.toolsHash, label: n.label } : null; }, drop: () => undefined },
      resultPolicy: resultPolicy as never,
    });
    const ask = (kind: string, p: Record<string, unknown>, asker: object = human) => lane.humanRequest(asker as never, kind, p) as Promise<Record<string, unknown>>;
    const caps = async (hsid: string) => (await ask('request.session.capabilities', { hsid })) as unknown as Caps;
    const sends = () => rows.filter((r) => r.kind === 'tool.result.sent').map((r) => r.payload);
    const turnEnds = () => rows.filter((r) => r.kind === 'turn.result').length;
    const run = async (hsid: string, id: string, text: string) => {
      const r = await ask('request.session.tools.run', { hsid, id, args: { text }, form: 'narrow' });
      expect(r).toMatchObject({ status: 'ran' });
      return r.runId as string;
    };
    const lastData = (): string[] => {
      const msgs = (srv!.requests.at(-1)!.messages ?? []) as Array<{ role: string; content: unknown }>;
      return msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).filter((c) => c.includes(RESULT_FOOTER));
    };

    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    try {
      // K1 + K2: a fresh session: every policy is null (not chosen yet), and it is not tainted
      const c0 = await caps(s.hsid);
      expect(c0.tainted).toBe(false);
      expect(c0.tools.length).toBeGreaterThan(0);
      expect(c0.tools.every((t) => t.policy === null)).toBe(true);
      const echoId = c0.tools.find((t) => t.name === 'echo')!.id;
      const pokeId = c0.tools.find((t) => t.name === 'poke')!.id;

      // a carded "/" run (poke, mutate): its result is read once with tools.result, which does NOT consume the send
      const carded = await ask('request.session.tools.run', { hsid: s.hsid, id: pokeId, args: { text: 'note-A' }, form: 'narrow' });
      const runA = carded.runId as string;
      expect(carded).toMatchObject({ status: 'carded' });
      let read: Record<string, unknown> = {};
      for (let i = 0; i < 200 && read.status !== 'ran'; i++) {
        read = await ask('request.session.tools.result', { hsid: s.hsid, runId: runA });
        if (read.status !== 'ran') await new Promise((r) => setTimeout(r, 25));
      }
      expect(read).toMatchObject({ status: 'ran' });
      await expect(ask('request.session.tools.result', { hsid: s.hsid, runId: runA })).rejects.toThrow(/no held result/);

      // refusals before the send: the device credential, a non-owner, a bad runId
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runA }, { ...human, credential: 'device' }))).toMatchObject({ reason: 'matrix' });
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runA }, { ...human, principal: 'p:abcdefgh/someone' }))).toMatchObject({ reason: 'not-found' });
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: 'run-nope' }))).toMatchObject({ reason: 'bad-params' });
      expect(sends()).toEqual([]);
      expect((await caps(s.hsid)).tainted).toBe(false);

      // the one-off send: queued as once, the session tainted at once, the policy unchanged (still null)
      expect(await ask('request.session.tools.send', { hsid: s.hsid, runId: runA })).toMatchObject({ policy: 'once', queued: true, tainted: true, tool: 'mcp:fake/poke', cut: false });
      const c1 = await caps(s.hsid);
      expect(c1.tainted).toBe(true);
      expect(c1.tools.find((t) => t.id === pokeId)!.policy).toBeNull();
      // idempotent per runId
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runA }))).toMatchObject({ reason: 'already-sent' });

      // the human's next turn takes it: ONE framed data part and ONE tool.result.sent{policy:'once'} row
      await lane.send(HUMAN, { hsid: s.hsid, text: 'look at the note' });
      expect(await waitFor(() => turnEnds() === 1, 20_000)).toBe(true);
      expect(sends()).toHaveLength(1);
      expect(sends()[0]).toMatchObject({ hsid: s.hsid, tool: 'mcp:fake/poke', policy: 'once', cut: false });
      expect(validateKindPayload('tool.result.sent', sends()[0]!)).toEqual([]);
      const data = lastData();
      expect(data).toHaveLength(1);
      expect(data[0]).toContain('[data from mcp:fake/poke · run by the human from /');
      expect(data[0]).toMatch(/<gnomon-data-[0-9a-f]+>/);
      expect(data[0]).toContain('note-A');
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runA }))).toMatchObject({ reason: 'already-sent' });

      // the cap: a long result under a smaller context target is sent cut, and the turn's data fits the cap (the same
      // #queueSend and whole-queue cap as a `send` result)
      const ctx = await ask('request.session.context', { hsid: s.hsid, target: 4096 });
      const target = ctx.target as number;
      const runLong = await run(s.hsid, echoId, 'x'.repeat(4000));
      expect(await ask('request.session.tools.send', { hsid: s.hsid, runId: runLong })).toMatchObject({ policy: 'once', cut: true });
      await lane.send(HUMAN, { hsid: s.hsid, text: 'and that one' });
      expect(await waitFor(() => turnEnds() === 2, 20_000)).toBe(true);
      expect(sends()).toHaveLength(2);
      expect(sends()[1]).toMatchObject({ tool: 'mcp:fake/echo', policy: 'once', cut: true });
      // the history still holds turn 1's part; THIS turn's data part is the newest, cut and within the turn's cap
      const cut = lastData();
      expect(cut).toHaveLength(2);
      expect(cut[1]).toContain('[data from mcp:fake/echo · run by the human from / · trusted server · ');
      expect(cut[1]).toContain('cut to the first');
      expect(Buffer.byteLength(cut[1]!, 'utf8')).toBeLessThanOrEqual(resultCap(target).bytes);
      await ask('request.session.context', { hsid: s.hsid, target: 16384 });

      // K1: the policy moves to send: a held result of that tool is refused already-sending; then to ask
      const runB = await run(s.hsid, echoId, 'note-B');
      expect(await ask('request.session.tools.policy', { hsid: s.hsid, id: echoId, policy: 'send' })).toMatchObject({ policy: 'send', previous: 'ask' });
      expect((await caps(s.hsid)).tools.find((t) => t.id === echoId)!.policy).toBe('send');
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runB }))).toMatchObject({ reason: 'already-sending' });
      await ask('request.session.tools.policy', { hsid: s.hsid, id: echoId, policy: 'ask' });
      expect((await caps(s.hsid)).tools.find((t) => t.id === echoId)!.policy).toBe('ask');

      // expired: over 10 minutes after the run
      const runOld = await run(s.hsid, echoId, 'note-old');
      skew += RUN_RESULT_TTL_MS + 1;
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runOld }))).toMatchObject({ reason: 'not-found' });

      // another session (same owner) never sees this session's held run, and is not tainted (K2: no leak)
      const runC = await run(s.hsid, echoId, 'note-C');
      const f = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
      try {
        expect(await refusalOf(ask('request.session.tools.send', { hsid: f.hsid, runId: runC }))).toMatchObject({ reason: 'not-found' });
        expect((await caps(f.hsid)).tainted).toBe(false);
        // K2: a skill run taints THIS session only
        expect(await ask('request.session.skill.run', { hsid: f.hsid, name: 'tidy', args: 'notes' })).toMatchObject({ status: 'ran' });
        expect((await caps(f.hsid)).tainted).toBe(true);
      } finally {
        await lane.stop(HUMAN, { hsid: f.hsid });
      }

      // a binding change since the run: refused changed, nothing queued
      drift = true;
      expect(await refusalOf(ask('request.session.tools.send', { hsid: s.hsid, runId: runC }))).toMatchObject({ reason: 'changed' });
      drift = false;
      expect(sends()).toHaveLength(2);
    } finally {
      await lane.stop(HUMAN, { hsid: s.hsid });
    }
  }, 90_000);
});
