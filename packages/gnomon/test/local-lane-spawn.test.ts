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
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { KernelLog } from '../src/kernel/log/index.js';
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
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
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
    // T-2026-10-26-003: the result carries how the run ended — its whole usage and the reply's size
    expect(rows.find((r) => r.kind === 'turn.result')!.payload).toMatchObject({ stopReason: 'stop', isError: false, runUsage: { tokens: 240, input: 200, output: 40 }, replyBytes: Buffer.byteLength('Done.') });
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
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
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
    // review M2: each local turn.result names the turn it closes
    expect(rows.filter((r) => r.kind === 'turn.result').map((r) => r.payload.turn)).toEqual([t1.turn, t2.turn]);
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
  });
  it('round 2 (M2): a steer whose in-flight turn permit has expired is refused PERMIT_REQUIRED; nothing is written', async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lls-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, script: [{ content: 'slow', delayMs: 1500 }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const real = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const expired = new Set<string>();
    const fuse = {
      reserve: (r: Parameters<BudgetFuse['reserve']>[0]) => real.reserve(r),
      release: (id: string, p: string) => real.release(id, p),
      recordStreamUsage: (e: Parameters<BudgetFuse['recordStreamUsage']>[0]) => real.recordStreamUsage(e),
      permit: (id: string) => {
        const pm = real.permit(id);
        return pm && expired.has(id) ? { ...pm, expiresAt: new Date(Date.now() - 1000).toISOString() } : pm;
      },
    };
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse: fuse as never, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    await lane.send(HUMAN, { hsid: s.hsid, text: 'go' });
    const turnPermit = rows.find((r) => r.kind === 'turn.sent')!.payload.permitId as string;
    expired.add(turnPermit);
    await expect(lane.send(HUMAN, { hsid: s.hsid, text: 'late steer', steer: true })).rejects.toMatchObject({ refusal: { code: 'PERMIT_REQUIRED' } });
    expect(rows.some((r) => r.kind === 'turn.steer')).toBe(false);
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
  });

  it('round 2 (steer race): a steer that reaches an idle child is refused by the child and the kernel logs turn.steer{refused}', async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lls-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    const rt = path.join(root, 'fake-child');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    fs.mkdirSync(rt);
    // a fake child that never ends its turn (the kernel keeps the turn in flight) but is idle for steering — the race, made deterministic
    fs.writeFileSync(path.join(rt, 'cli.js'), [
      "const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      "let buf = '';",
      "process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const c = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);",
      "  if (c.type === 'prompt') out({ type: 'response', command: 'prompt', success: true });",
      "  if (c.type === 'steer') out({ type: 'response', command: 'steer', success: false, error: 'agent is idle (nothing to steer)' });",
      "} });",
      "",
    ].join('\n'));
    srv = await fakeOpenAI({ tools: true });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(rt, 'cli.js') },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
    await lane.send(HUMAN, { hsid: s.hsid, text: 'go' });
    expect(await lane.send(HUMAN, { hsid: s.hsid, text: 'steer it', steer: true })).toMatchObject({ steered: true });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.steer' && r.payload.phase === 'refused'), 5_000)).toBe(true);
    expect(rows.find((r) => r.kind === 'turn.steer' && r.payload.phase === 'refused')!.payload).toMatchObject({ hsid: s.hsid, by: 'child', error: 'agent is idle (nothing to steer)' });
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
  });
  it('T-2026-10-18-019: session.send and a steer through a REAL KernelLog — session.inject carries byte counts, never the text', async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lls-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    const lh = path.join(root, 'log-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    fs.mkdirSync(lh);
    srv = await fakeOpenAI({ tools: true, script: [{ toolCalls: [{ name: 'list_dir', arguments: '{}' }], delayMs: 600 }, { content: 'ok' }] });
    const klog = KernelLog.open({ home: lh, kernelPrincipal: 'p:abcdefgh/kernel', signer: SoftwareEd25519Signer.generate() });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>, ids: { session?: string } = {}): Promise<void> => {
      await klog.append({ kind, principal: 'p:abcdefgh/kernel', payload, ...(ids.session ? { session: ids.session } : {}) });
      rows.push({ kind, payload });
    };
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    try {
      const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
      await lane.send(HUMAN, { hsid: s.hsid, text: 'PLAIN-ONE ü' });
      await lane.send(HUMAN, { hsid: s.hsid, text: 'PLAIN-STEER', steer: true });
      expect(rows.filter((r) => r.kind === 'session.inject').map((r) => r.payload.bytes)).toEqual([Buffer.byteLength('PLAIN-ONE ü'), Buffer.byteLength('PLAIN-STEER')]);
      expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 15_000)).toBe(true);
      await lane.stop(HUMAN, { hsid: s.hsid });
      expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
      const injects = rows.filter((r) => r.kind === 'session.inject').map((r) => JSON.stringify(r.payload)).join('');
      expect(injects).not.toMatch(/PLAIN-/);
    } finally {
      await klog.close();
    }
  });
});

describe('Aegis L1 / L2 + TD-2026-10-21-077 (LocalLane env and profile extras)', () => {
  async function capture(identity: { user?: string; tmpdir?: string; home?: string }, withUserHome: boolean) {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lls-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home);
    srv = await fakeOpenAI({ tools: true, script: [{ content: 'ok' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    let seen: { tmpdir: string; home: string } | null = null;
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, ...(withUserHome ? { userHome: root } : {}), kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(root, 'k.sock'),
      env: () => ({ HOME: '/daemon-home-probe', PATH: '/daemon/path/probe', TMPDIR: '/daemon-tmp-probe/' }),
      identity, sessionPath: '/cfg/bin:/usr/bin:/bin',
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => {
        seen = { tmpdir: i.extras.tmpdir, home: i.extras.home };
        throw new Error('captured (test stops before the spawn)');
      },
    });
    await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => { throw new Error('claude must not be opened'); }).catch(() => undefined);
    return seen as { tmpdir: string; home: string } | null;
  }
  it('L1: no OS TMPDIR ⇒ the screen deny dir is the literal /private/tmp, never the daemon TMPDIR; an OS TMPDIR is used as given', async () => {
    expect((await capture({ user: 'a' }, true))?.tmpdir).toBe('/private/tmp');
    expect((await capture({ user: 'a', tmpdir: '/var/folders/zz/T/' }, true))?.tmpdir).toBe('/var/folders/zz/T/');
  });
  it('L2: with no userHome seam the user home is the OS identity home, never the daemon $HOME', async () => {
    const r = await capture({ user: 'a', home: '/os-home-probe' }, false);
    expect(r?.home).toBe('/os-home-probe');
  });
});
