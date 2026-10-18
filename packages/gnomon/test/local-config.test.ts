/**
 * #local-runner M1.8 slice 2 (spec §13.1–§13.3, §2.4 "backend binaries come
 * from root-signed config"): the ROOT-SIGNED local lane config, the runner's
 * sha256 pin, per-task endpoint choice, roots inside the Gnomon home, the
 * daemon-start probe, and the steer param at the socket port. Against FAKE
 * in-process OpenAI-compatible servers; never a real model, never claude.
 * Platform-independent: nothing here reaches a spawn (the routes refuse, or
 * the run stops at the launch plan / intend seam).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { assertRunnerPin, loadLocalConfig, LOCAL_CONFIG_FILE, parseLocalLaneConfig, writeSignedLocalConfig } from '../src/kernel/local/config.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import type { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { parseLocalLine } from '../src/adapters/local/runner.js';

const HUMAN = 'p:abcdefgh/founder';
const servers: FakeServer[] = [];
let tmp: string | null = null;
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratch = (): string => (tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lcfg-'))));
const fake = async (o: Parameters<typeof fakeOpenAI>[0]): Promise<FakeServer> => {
  const s = await fakeOpenAI(o);
  servers.push(s);
  return s;
};

function lane(home: string, config: ConstructorParameters<typeof LocalLane>[0]['config']) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const cards: Array<Record<string, unknown>> = [];
  const sessionCfgs: Array<Record<string, unknown>> = [];
  const broker = { raise: async (i: Record<string, unknown>) => (cards.push(i), { cardId: `card:01HZZZZZZZZZZZZZZZZZZZZZZ${cards.length}` }) };
  const children = { intend: async () => { throw new Error('intend reached (test stop)'); }, track: async () => undefined, stop: async () => false };
  const l = new LocalLane({
    log, children: children as never, fuse, broker: broker as never, home, userHome: path.join(home, '..', 'userhome'), kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(home, 'k.sock'),
    // the test-rig launch seam: never a real sandbox here, and the run stops at intend
    launchPlan: (i) => {
      sessionCfgs.push(JSON.parse(fs.readFileSync(i.argv[i.argv.indexOf('--config') + 1]!, 'utf8')) as Record<string, unknown>);
      return { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test', profileHash: 'sha256:test' };
    },
    ...(config ? { config } : {}),
  });
  return { l, rows, cards, sessionCfgs };
}

describe('root-signed local.signed.json (only a root-verified row is applied; anything else is NO config, logged)', () => {
  const local = { endpoints: [{ id: 'llama', base: 'http://127.0.0.1:8080', model: 'qwen', compat: 'llama.cpp' }], runner: { command: process.execPath, args: ['/x/gnomon-local/dist/cli.js'] }, contextTarget: 4096 };

  it('signed ⇒ applied, logged with file + version; the sidecar records the version', () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, root, local, 3);
    const ev: Array<[string, Record<string, unknown>]> = [];
    const r = loadLocalConfig(home, root, (k, p) => ev.push([k, p]));
    expect(r).toMatchObject({ signed: true, fellBack: false, version: 3, config: { endpoints: [{ id: 'llama' }], contextTarget: 4096 } });
    expect(ev).toEqual([['config.loaded', expect.objectContaining({ file: LOCAL_CONFIG_FILE, signed: true, version: 3, endpoints: ['llama'], runner: { command: process.execPath, pinned: false } })]]);
    expect(JSON.parse(fs.readFileSync(path.join(home, 'local.seen.json'), 'utf8'))).toEqual({ version: 3 });
  });

  it('another root, a tampered row, unparseable bytes ⇒ no config + config.unsigned', () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, new DevTestRootAuthority(DEV_TEST_ROOT_ACK), local);
    const ev: string[] = [];
    expect(loadLocalConfig(home, root, (k, p) => ev.push(`${k}:${String(p.why)}`)).config).toBeUndefined();
    writeSignedLocalConfig(home, root, local);
    const doc = JSON.parse(fs.readFileSync(path.join(home, LOCAL_CONFIG_FILE), 'utf8')) as { row: { local: { endpoints: Array<{ base: string }> } } };
    doc.row.local.endpoints[0]!.base = 'http://10.0.0.9:8080';
    fs.writeFileSync(path.join(home, LOCAL_CONFIG_FILE), JSON.stringify(doc));
    expect(loadLocalConfig(home, root, (k, p) => ev.push(`${k}:${String(p.why)}`)).config).toBeUndefined();
    fs.writeFileSync(path.join(home, LOCAL_CONFIG_FILE), '{not json');
    expect(loadLocalConfig(home, root, (k, p) => ev.push(`${k}:${String(p.why)}`)).config).toBeUndefined();
    expect(ev).toEqual(['config.unsigned:signature', 'config.unsigned:signature', 'config.unsigned:unparseable']);
  });

  it('rollback: a signed row older than the chain high-water mark (or the sidecar) is NOT applied', () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, root, local, 2);
    const ev: Array<Record<string, unknown>> = [];
    expect(loadLocalConfig(home, root, (_k, p) => ev.push(p), { chainHighWater: 5 }).config).toBeUndefined();
    expect(ev[0]).toMatchObject({ file: LOCAL_CONFIG_FILE, signed: true, fallback: 'none', why: 'older', version: 2, highWater: 5 });
    fs.writeFileSync(path.join(home, 'local.seen.json'), '{"version":9}');
    expect(loadLocalConfig(home, root).config).toBeUndefined();
    // a missing file after a signed one is logged, not silent
    fs.rmSync(path.join(home, LOCAL_CONFIG_FILE));
    const ev2: Array<Record<string, unknown>> = [];
    loadLocalConfig(home, root, (_k, p) => ev2.push(p));
    expect(ev2[0]).toMatchObject({ why: 'missing', fallback: 'none' });
  });

  it('structurally invalid ⇒ no config (unknown key, relative runner, bad pin, duplicate id, extra endpoint key)', () => {
    for (const bad of [
      { ...local, apiKey: 'x' },
      { ...local, runner: { command: 'node' } },
      { ...local, runner: { command: process.execPath, sha256: 'abc' } },
      { endpoints: [local.endpoints[0], local.endpoints[0]] },
      { endpoints: [{ ...local.endpoints[0], headers: { authorization: 'Bearer x' } }] },
      { endpoints: 'llama' },
    ]) expect(parseLocalLaneConfig(bad), JSON.stringify(bad)).toBeNull();
    expect(parseLocalLaneConfig({ endpoints: [] })).toEqual({ endpoints: [] });
  });

  it('G-SUB-06 through the signed config: a signed public endpoint is applied and then refuses every local open BILLING_REFUSED', async () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, root, { endpoints: [{ id: 'cloud', base: 'https://api.anthropic.com', model: 'x', compat: 'llama.cpp' }] });
    const cfg = loadLocalConfig(home, root).config!;
    expect(cfg.endpoints).toHaveLength(1);
    const { l, rows } = lane(home, cfg);
    const e = (await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: home, model: 'local' }, async () => null).catch((x: unknown) => x)) as RefusedError;
    expect(e.refusal.code).toBe('BILLING_REFUSED');
    expect(rows.map((r) => r.kind)).toEqual(['session.refused']);
    expect(await l.probeAll()).toEqual([]); // the start probe never dials a refused endpoint
  });
});

describe('the runner pin (law 7 / S8, positive half)', () => {
  it('a matching sha256 passes; a changed entry file refuses PERMIT_REQUIRED{runner-pin-mismatch}; CRLF bytes are bytes', () => {
    const d = scratch();
    const entry = path.join(d, 'cli.js');
    fs.writeFileSync(entry, 'console.log(1)\n');
    const pin = createHash('sha256').update(fs.readFileSync(entry)).digest('hex');
    expect(() => assertRunnerPin({ command: process.execPath, args: [entry], sha256: pin })).not.toThrow();
    expect(() => assertRunnerPin({ command: process.execPath, args: [entry], sha256: pin.toUpperCase() })).not.toThrow();
    fs.writeFileSync(entry, 'console.log(1)\r\n');
    try {
      assertRunnerPin({ command: process.execPath, args: [entry], sha256: pin });
      expect.unreachable();
    } catch (err) {
      expect((err as RefusedError).refusal).toMatchObject({ code: 'PERMIT_REQUIRED', data: { why: 'runner-pin-mismatch' } });
    }
    expect(() => assertRunnerPin({ command: process.execPath, args: [path.join(d, 'missing.js')], sha256: pin })).toThrow(/pin/);
    expect(() => assertRunnerPin({ command: process.execPath, args: [entry] })).not.toThrow();
  });

  it('a mismatched pin refuses before any permit or spawn row', async () => {
    const home = scratch();
    const cwd = path.join(home, '..', `repo-${path.basename(home)}`);
    fs.mkdirSync(cwd, { recursive: true });
    try {
      const srv = await fake({ tools: true });
      const { l, rows } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: { command: process.execPath, args: [path.join(home, 'nope.js')], sha256: '0'.repeat(64) } });
      await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'PERMIT_REQUIRED' } });
      expect(rows.some((r) => r.kind.startsWith('permit.') || r.kind === 'session.open')).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('per-task endpoint choice: the first endpoint in signed order that is capable for the task floor', () => {
  it('an incapable first endpoint is passed over for a capable second one (no fallback card); both are probed and recorded', async () => {
    const home = scratch();
    const cwd = path.join(home, 'repo');
    fs.mkdirSync(cwd);
    const a = await fake({ tools: false });
    const b = await fake({ tools: true, nCtx: 16384 });
    const { l, rows, cards, sessionCfgs } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'a', base: a.base, model: 'm', compat: 'llama.cpp' }, { id: 'b', base: b.base, model: 'm', compat: 'ollama' }], runner: { command: process.execPath, args: ['/x/gnomon-local/dist/cli.js'] } });
    await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null).catch(() => undefined);
    expect(cards).toEqual([]);
    expect(rows.filter((r) => r.kind === 'model.probe').map((r) => r.payload.endpoint)).toEqual(['a', 'b']);
    expect(rows.find((r) => r.kind === 'session.open')!.payload).toMatchObject({ endpoint: 'b', backend: 'local' });
    expect(rows.find((r) => r.kind === 'permit.grant')!.payload.permit).toMatchObject({ backend: 'local', billing: 'local', model: 'fake-qwen-7b-q4' });
    // the per-session config handed to the child: endpoint b, its compat, the compaction target min(~8k, n_ctx)
    expect(sessionCfgs).toEqual([expect.objectContaining({ endpoint: { base: b.base, model: 'fake-qwen-7b-q4', compat: 'ollama' }, contextTarget: 8192, capabilities: { tools: true, nCtx: 16384 } })]);
    const dir = fs.readdirSync(path.join(home, 'gh', 'sessions'));
    expect(dir).toEqual([]); // intend refused ⇒ the session dir is removed (nothing left behind)
  });

  it('no capable endpoint ⇒ the FIRST endpoint\'s reason on the fallback card', async () => {
    const home = scratch();
    const a = await fake({ tools: false });
    const b = await fake({ tools: true, nCtx: 2048 });
    const { l, cards } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'a', base: a.base, model: 'm', compat: 'llama.cpp' }, { id: 'b', base: b.base, model: 'm', compat: 'llama.cpp' }], runner: { command: process.execPath, args: ['/x/cli.js'] } });
    await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: home, model: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'MODEL_UNAVAILABLE', data: { why: 'no-tools' } } });
    expect(cards).toHaveLength(1);
  });

  it('probeAll (daemon start) records model.probe + model.capabilities for every configured endpoint and caches them', async () => {
    const home = scratch();
    const a = await fake({ tools: true });
    const { l, rows } = lane(home, { endpoints: [{ id: 'a', base: a.base, model: 'm', compat: 'llama.cpp' }, { id: 'dead', base: 'http://127.0.0.1:9', model: 'm', compat: 'llama.cpp' }] });
    expect(await l.probeAll()).toEqual([{ endpoint: 'a', ok: true }, { endpoint: 'dead', ok: false }]);
    expect(rows.map((r) => `${r.kind}:${String(r.payload.endpoint)}`)).toEqual(['model.probe:a', 'model.capabilities:a', 'model.probe:dead']);
    const n = a.requests.length;
    await l.probeAll();
    expect(a.requests.length).toBe(n); // cached (probeTtlMs)
  });
});

describe('round 3 R2, widened in slice 2: a root INSIDE the Gnomon home is refused too', () => {
  it('cwd or worktree under the Gnomon home ⇒ BAD_REQUEST before any permit', async () => {
    const home = scratch();
    fs.mkdirSync(path.join(home, 'keys'));
    const srv = await fake({ tools: true });
    const { l, rows } = lane(home, { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: { command: process.execPath, args: ['/x/gnomon-local/dist/cli.js'] } });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lcfg-out-'));
    try {
      for (const over of [{ cwd: path.join(home, 'keys') }, { cwd: outside, worktree: path.join(home, 'keys') }]) {
        await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, model: 'local', ...over }, async () => null), JSON.stringify(over)).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    expect(rows.some((r) => r.kind.startsWith('permit.'))).toBe(false);
  });
});

describe('session.send{steer} at the socket port', () => {
  const sup = (calls: unknown[]) => ({ send: async (_p: string, x: unknown) => (calls.push(x), { turn: 't' }) }) as unknown as SessionSupervisor;
  it('steer: true is passed through; a non-boolean steer is BAD_REQUEST; steer false is a plain send', async () => {
    const calls: unknown[] = [];
    const port = createSessionPort(sup(calls));
    const ctx = { principal: HUMAN, principalClass: 'human' };
    await port.send(ctx, { hsid: 'h', content: [{ text: 'be brief' }], steer: true });
    await port.send(ctx, { hsid: 'h', content: [{ text: 'x' }], steer: false });
    await expect(port.send(ctx, { hsid: 'h', content: [{ text: 'x' }], steer: 'yes' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(calls).toEqual([{ hsid: 'h', text: 'be brief', steer: true }, { hsid: 'h', text: 'x' }]);
  });
  it('the driver reads the child\'s compaction events (logged, never acted on)', () => {
    expect(parseLocalLine('{"type":"compaction_end","reason":"threshold","tokensBefore":9000,"tokensAfter":700,"kept":2}')).toEqual({ kind: 'compaction', type: 'compaction_end', phase: 'end', reason: 'threshold', tokensBefore: 9000, tokensAfter: 700, error: null });
  });
});
