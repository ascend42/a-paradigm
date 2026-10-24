/**
 * #loops-gate (TD-2026-10-24-447, docs/specs/gnomon-loops.md §11, G-LOOP-29): loops ship disabled in release builds.
 * The gate, the inert wireLoops() stub, the dispatcher's defence in depth, status.loops, a pre-seeded trusted loop that
 * does not run, `gnomon loop *`, and GNOMON_LOOPS honoured only when the release define is absent.
 * Platform-independent: no paths asserted, no fixtures on disk, \n only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOP_EXIT_REFUSED, runLoopCommand } from '../src/cli/loop-cli.js';
import { LOOPS_DISABLED_MESSAGE, LOOPS_DISABLED_REASON, resolveLoopsEnabled } from '../src/kernel/loops/gate.js';
import { disabledLoops, wireLoops } from '../src/kernel/loops/wire.js';
import { createKernelDispatcher, RpcRefusal } from '../src/kernel/socket/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';

const tmps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  while (tmps.length) removeTree(tmps.pop()!);
});

describe('resolveLoopsEnabled', () => {
  it('a release build is off, with or without GNOMON_LOOPS=1 (never a back door), in any name case', () => {
    expect(resolveLoopsEnabled({ release: true, env: {} })).toBe(false);
    expect(resolveLoopsEnabled({ release: true, env: { GNOMON_LOOPS: '1' } })).toBe(false);
    expect(resolveLoopsEnabled({ release: true, env: { gnomon_loops: '1' } })).toBe(false);
  });
  it('a dev build is on by default; GNOMON_LOOPS=0 turns it off; =1 keeps it on; env names are case-insensitive', () => {
    expect(resolveLoopsEnabled({ release: false, env: {} })).toBe(true);
    expect(resolveLoopsEnabled({ release: false, env: { GNOMON_LOOPS: '1' } })).toBe(true);
    expect(resolveLoopsEnabled({ release: false, env: { GNOMON_LOOPS: '0' } })).toBe(false);
    expect(resolveLoopsEnabled({ release: false, env: { Gnomon_Loops: '0' } })).toBe(false);
  });
  it('the compiled define decides: with __GNOMON_RELEASE__ present (even a broken manifest) loops are off despite GNOMON_LOOPS=1', async () => {
    vi.stubGlobal('__GNOMON_RELEASE__', true);
    vi.resetModules();
    const g = await import('../src/kernel/loops/gate.js');
    expect(g.resolveLoopsEnabled({ env: { GNOMON_LOOPS: '1' } })).toBe(false);
  });
  it('with the define absent, GNOMON_LOOPS=1 leaves loops on', async () => {
    vi.resetModules();
    const g = await import('../src/kernel/loops/gate.js');
    expect(g.resolveLoopsEnabled({ env: { GNOMON_LOOPS: '1' } })).toBe(true);
  });
});

describe('wireLoops({enabled:false}): the inert stub', () => {
  it('constructs and starts nothing: no timer, exit hook, idle hold, scheduler timer, log read or listener', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-loops-gate-'));
    tmps.push(home);
    const timers = vi.spyOn(globalThis, 'setInterval');
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    const once = vi.spyOn(process, 'once');
    const holdIdle = vi.fn(() => () => undefined);
    const schedule = vi.fn();
    const read = vi.fn(() => []);
    const onCommit = vi.fn();
    const append = vi.fn(async () => undefined);
    const check = vi.fn();
    const w = wireLoops({
      enabled: false, home, kernelPrincipal: 'p:kernel', holdIdle,
      scheduler: { schedule } as never,
      check: check as never,
      broker: { raise: async () => { throw new Error('no card'); } },
      log: { append, read, onCommit, isKernelKey: () => true },
    });
    await w.recovered;
    await new Promise((r) => setImmediate(r));
    expect(timers).not.toHaveBeenCalled();
    expect(timeouts).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
    expect([holdIdle.mock.calls.length, schedule.mock.calls.length, read.mock.calls.length, onCommit.mock.calls.length, append.mock.calls.length, check.mock.calls.length]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.keys(w).sort()).toEqual(['brake', 'close', 'localConfigApplied', 'port', 'recovered']);
    expect(await w.recovered).toBe(0);
    expect(await w.brake('repo')).toBe(0);
    expect(() => { w.localConfigApplied(); w.close(); }).not.toThrow();
  });
  it('port.request and port.agent refuse FORBIDDEN loops-disabled with the copy', async () => {
    const p = disabledLoops().port;
    for (const call of [() => p.request({ connId: 'c', principal: 'p', principalClass: 'human', credential: 'gui' }, 'request.loop.run', {}), () => p.agent!({ connId: 'c', principal: 'p', principalClass: 'agent', credential: 'device', hsid: null }, {})]) {
      const err = await call().then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(RpcRefusal);
      const r = (err as RpcRefusal).refusal;
      expect(r.code).toBe('FORBIDDEN');
      expect(r.data?.reason).toBe(LOOPS_DISABLED_REASON);
      expect((err as RpcRefusal).message).toBe(LOOPS_DISABLED_MESSAGE);
    }
  });
  it('status() is the additive disabled shape', () => {
    expect(disabledLoops().port.status()).toEqual({ enabled: false, reason: 'not-in-this-build', loops: [], running: 0, queued: 0, recent: [], startRefused: [], effective: {}, landing: [] });
  });
  it('a trusted loop already in the log does not run: the log is never read, the check never executes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-loops-gate-'));
    tmps.push(home);
    const rows = [{ view: 'full', event: { kind: 'loop.trusted', principal: 'p:kernel', keyId: 'k', payload: { loopId: 'one', scope: 'repo', repoKey: 'r', contentHash: 'sha256:x' } } }];
    const read = vi.fn(() => rows);
    const check = vi.fn();
    const w = wireLoops({ enabled: false, home, kernelPrincipal: 'p:kernel', check: check as never, broker: { raise: async () => { throw new Error('no card'); } }, log: { append: async () => undefined, read: read as never, onCommit: () => undefined, isKernelKey: () => true } });
    await expect(w.port.request({ connId: 'c', principal: 'p', principalClass: 'human', credential: 'gui' }, 'request.loop.run', { loopId: 'one' })).rejects.toMatchObject({ refusal: { data: { reason: 'loops-disabled' } } });
    expect(read).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
});

type Who = { kind: 'human' | 'agent'; credential: 'device' | 'gui' };
function rig(port: { request: (...a: never[]) => Promise<unknown>; status: () => Record<string, unknown>; agent?: (...a: never[]) => Promise<unknown> }) {
  const d = createKernelDispatcher({
    authenticator: {
      now: () => Date.now(),
      checkToken: () => ({ ok: true }),
      authenticate: (s: Record<string, unknown>, p: { who: Who }) => {
        s.phase = 'authenticated';
        s.principal = 'p:local/x';
        Object.assign(s, { principalKind: p.who.kind, deviceId: 'dev:local/mac', credential: p.who.credential });
        if (p.who.credential === 'gui') return { ok: true, credential: 'gui', principal: 'p:local/x', deviceId: 'dev:local/mac', via: 'launch', guiToken: 'g', commit: () => undefined, abort: () => undefined };
        return { ok: true, credential: 'device', principal: 'p:local/x', principalKind: p.who.kind, deviceId: 'dev:local/mac', keyId: 'k' };
      },
    } as never,
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
    log: async () => undefined,
    requests: { status: () => ({}), loops: port } as never,
  });
  let n = 0;
  const connect = async (who: Who) => {
    const ctx = { connId: `conn:test-${++n}`, closed: false, close() {}, authenticated() {}, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    await d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'auth', params: { who } }, ctx as never);
    return (method: string, params: unknown = {}) => d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method, params }, ctx as never);
  };
  return { connect };
}
async function reason(p: unknown): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcRefusal) return e.refusal.data?.reason;
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('dispatch: loops off', () => {
  // a port that claims enabled:false but WOULD act if reached: proves the dispatcher refuses first
  const reached: string[] = [];
  const hostile = () => ({
    request: async (_a: never) => (reached.push('request'), { ok: true }),
    agent: async () => (reached.push('agent'), { ok: true }),
    status: () => ({ enabled: false, reason: 'not-in-this-build', loops: [] }),
  });
  it.each(['request.loop.run', 'request.loop.trust', 'request.loop.pause'])('%s from the human GUI is refused loops-disabled before the port', async (kind) => {
    reached.length = 0;
    const call = await rig(hostile() as never).connect({ kind: 'human', credential: 'gui' });
    expect(await reason(call('log.append', { kind, payload: { all: true } }))).toBe('loops-disabled');
    expect(reached).toEqual([]);
  });
  it('loop.request is refused loops-disabled before the agent gate', async () => {
    reached.length = 0;
    for (const who of [{ kind: 'agent', credential: 'device' }, { kind: 'human', credential: 'gui' }] as Who[]) {
      const call = await rig(hostile() as never).connect(who);
      expect(await reason(call('log.append', { kind: 'loop.request', payload: { op: 'run' } }))).toBe('loops-disabled');
    }
    expect(reached).toEqual([]);
  });
  it('the real stub port behind the dispatcher refuses the same way', async () => {
    const call = await rig(disabledLoops().port as never).connect({ kind: 'human', credential: 'gui' });
    expect(await reason(call('log.append', { kind: 'request.loop.run', payload: { loopId: 'x' } }))).toBe('loops-disabled');
  });
  it('status.loops carries the stub status (key present, enabled:false)', async () => {
    const call = await rig(disabledLoops().port as never).connect({ kind: 'human', credential: 'gui' });
    const r = (await call('status', {})) as { loops?: Record<string, unknown> };
    expect(r.loops).toMatchObject({ enabled: false, reason: 'not-in-this-build', loops: [] });
  });
});

describe('gnomon loop * with loops off', () => {
  const sink = () => {
    let text = '';
    return { out: { write: (s: string) => { text += s; return true; } }, text: () => text };
  };
  it.each([['list'], ['list', '--all'], ['trust', 'one'], ['run', 'one'], ['pause', '--all']])('%j prints the copy and exits non-zero', async (...argv) => {
    const o = sink();
    const e = sink();
    const code = await runLoopCommand(argv, { stdout: o.out, stderr: e.out }, os.tmpdir(), false);
    expect(code).toBe(LOOP_EXIT_REFUSED);
    expect(e.text()).toContain(LOOPS_DISABLED_MESSAGE);
    expect(e.text()).toContain('loops-disabled');
    expect(o.text()).toBe('');
  });
});
