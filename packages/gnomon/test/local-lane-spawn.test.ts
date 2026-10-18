/**
 * #local-runner LocalLane spawn path end to end (#spawn → #wire → #onLine →
 * send → stop → #onExit) with the REAL gnomon-local child (packages/
 * gnomon-local/dist/cli.js, built by build:gnomon) against a FAKE in-process
 * OpenAI-compatible endpoint, real DaemonChildren and POSIX process groups.
 * The `session` sandbox profile is replaced through the TEST-RIG-ONLY
 * `launchPlan` seam (unsandboxed): the sandboxed variant (G-LCL-06) is the
 * darwin rig of slice 2. Never a real model, never claude.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
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

describe('LocalLane spawn (fake endpoint, unsandboxed test seam)', () => {
  it('a model:local session runs gnomon-local: tool write inside the root, usage against the spawn permit, stop releases permits; no claude', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lls-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, script: [{ toolCalls: [{ name: 'write_file', arguments: '{"path":"out.txt","content":"local ok"}' }] }, { content: 'Done.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: { command: process.execPath, args: [CLI] } },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    const s = await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => {
      throw new Error('claude must not be opened');
    });
    expect(s).toMatchObject({ backend: 'local', model: 'fake-qwen-7b-q4', state: 'running' });
    const hsid = s!.hsid;
    await lane.send(HUMAN, { hsid, text: 'write out.txt' });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 15_000)).toBe(true);
    expect(fs.readFileSync(path.join(cwd, 'out.txt'), 'utf8')).toBe('local ok');
    const kinds = rows.map((r) => r.kind);
    const grant = rows.find((r) => r.kind === 'permit.grant' && (r.payload.permit as { kind: string }).kind === 'session.spawn')!.payload.permit as Record<string, unknown>;
    expect(grant).toMatchObject({ backend: 'local', billing: 'local', model: 'fake-qwen-7b-q4', hsid });
    expect((grant.scope as { repo: string }).repo).toMatch(/^path:/);
    expect(rows.find((r) => r.kind === 'session.spawned' && r.payload.phase === 'running')!.payload.kind).toBe('local-runner');
    expect(kinds.indexOf('session.spawned')).toBeLessThan(kinds.indexOf('turn.event'));
    expect(rows.find((r) => r.kind === 'model.capabilities' && r.payload.hsid === hsid)!.payload).toMatchObject({ backend: 'local', tools: true, ctx: 8192 });
    const usage = rows.filter((r) => r.kind === 'budget.usage' && !r.payload.malformed);
    expect(usage.every((u) => u.payload.backend === 'local' && u.payload.permitId === grant.permitId)).toBe(true);
    expect(usage.reduce((a, u) => a + (u.payload.tokens as number), 0)).toBe(240);
    // every turn.event precedes the rows acting on it (S2): the first turn.usage comes after a message_end turn.event
    expect(kinds.indexOf('turn.event')).toBeLessThan(kinds.indexOf('turn.usage'));
    const stop = await lane.stop(HUMAN, { hsid });
    expect(stop.exited).toBe(true);
    expect(await waitFor(() => lane.stateOf(hsid) === 'exited', 5_000)).toBe(true);
    const released = rows.filter((r) => r.kind === 'permit.release').map((r) => r.payload.permitId);
    expect(released).toContain(grant.permitId);
    expect((fuse.status() as { permits: { n: number } }).permits.n).toBe(0);
    expect(rows.some((r) => JSON.stringify(r.payload).includes('claude-code') && r.kind === 'permit.grant')).toBe(false);
  });
  it('slice 2 session.send{steer}: mid-turn text joins the in-flight turn under its permit and reaches the next step; idle steer is a send', async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lls-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, script: [{ toolCalls: [{ name: 'list_dir', arguments: '{}' }], delayMs: 600 }, { content: 'Brief.' }, { content: 'Again.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: { command: process.execPath, args: [CLI] } },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    const t1 = await lane.send(HUMAN, { hsid: s.hsid, text: 'look around' });
    expect(await waitFor(() => srv!.requests.some((r) => !(Array.isArray(r.tools) && JSON.stringify(r.tools).includes('get_time'))), 10_000)).toBe(true);
    const st = await lane.send(HUMAN, { hsid: s.hsid, text: 'be brief', steer: true });
    expect(st).toEqual({ turn: t1.turn, steered: true });
    await expect(lane.send(HUMAN, { hsid: s.hsid, text: 'x', steer: true, permitId: 'permit:nope' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 15_000)).toBe(true);
    const steer = rows.find((r) => r.kind === 'turn.steer')!.payload;
    const sent = rows.filter((r) => r.kind === 'turn.sent');
    expect(sent).toHaveLength(1);
    expect(steer).toMatchObject({ hsid: s.hsid, turn: t1.turn, permitId: sent[0]!.payload.permitId, backend: 'local' });
    const agentReqs = srv.requests.filter((r) => !JSON.stringify(r.tools ?? []).includes('get_time'));
    expect((agentReqs[1]!.messages as Array<{ content: string }>).at(-1)!.content).toBe('be brief');
    // idle: nothing to steer ⇒ an ordinary permitted send
    const t2 = await lane.send(HUMAN, { hsid: s.hsid, text: 'once more', steer: true });
    expect(t2.steered).toBeUndefined();
    expect(rows.filter((r) => r.kind === 'turn.sent')).toHaveLength(2);
    expect(await waitFor(() => rows.filter((r) => r.kind === 'turn.result').length === 2, 15_000)).toBe(true);
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
  });
});
