/**
 * #gnomon-voice V2e (T-2026-10-19-026; TD-2026-10-19-194/-298/-063), pure half: the kernel-supervised voice client
 * (spawn / kill / restart with backoff over a fake child), the allow-list env, the adopted-fd principal (voice only,
 * nothing else), request.voice.client (human only), the client entry resolution (darwin only, lazily).
 * The daemon half (a real child over a real socketpair, death on close and on drain) is voice-v2e-daemon.test.ts.
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VoiceChildSupervisor, voiceChildArgs, voiceChildEnv, type VoiceChildOptions } from '../src/kernel/voice/voice-child.js';
import { resolveVoiceClientEntry } from '../src/kernel/voice/voice-install.js';
import { createKernelDispatcher, RpcRefusal } from '../src/kernel/socket/index.js';

class FakeChild extends EventEmitter {
  readonly signals: string[] = [];
  stdinEnded = false;
  exitOnTerm = true;
  readonly stdin = { end: () => void (this.stdinEnded = true) };
  readonly stdout = { resume: () => undefined };
  readonly stderr = new EventEmitter();
  readonly stdio: unknown[];
  constructor(sock: unknown = { fake: 'socket' }) {
    super();
    this.stdio = [this.stdin, this.stdout, this.stderr, sock];
  }
  kill(sig: string): boolean {
    this.signals.push(sig);
    if (sig === 'SIGKILL' || this.exitOnTerm) setImmediate(() => this.emit('exit', null, sig));
    return true;
  }
  crash(code = 1): void {
    this.stderr.emit('data', Buffer.from('boom: the mic went away\n'));
    this.emit('exit', code, null);
  }
}

function rig(o: Partial<VoiceChildOptions> = {}) {
  let t = 0;
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const children: FakeChild[] = [];
  const spawns: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv | undefined; stdio: unknown }> = [];
  let attaches = 0;
  const sup = new VoiceChildSupervisor({
    home: '/h',
    clientEntry: '/pkg/gnomon-voice/dist/cli.js',
    execPath: '/node',
    sourceEnv: { HOME: '/Users/x', NODE_OPTIONS: '--require evil', GNOMON_SOCKET: '/s', DYLD_INSERT_LIBRARIES: 'x', LANG: 'en_US.UTF-8', LC_ALL: 'C' },
    spawn: (cmd, args, so) => {
      spawns.push({ cmd, args, env: so.env, stdio: so.stdio });
      const c = new FakeChild();
      children.push(c);
      return c as never;
    },
    prepare: async (report) => {
      report('downloading-models', 412);
      return { ioBinary: '/h/bin/voice/GnomonVoiceIO.app/Contents/MacOS/gnomon-voice-io', devUnsigned: false };
    },
    attach: async () => `conn:V${++attaches}`,
    now: () => t,
    setTimer: (fn, ms) => {
      const x = { fn, ms, cleared: false };
      timers.push(x);
      return { clear: () => void (x.cleared = true) };
    },
    ...o,
  });
  const fire = (): number => {
    const x = timers.filter((y) => !y.cleared).at(-1)!;
    x.cleared = true;
    x.fn();
    return x.ms;
  };
  return { sup, children, spawns, timers, fire, advance: (ms: number) => void (t += ms) };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('#gnomon-voice V2e: VoiceChildSupervisor', () => {
  it('spawns `node --disable-sigusr1 <cli.js> run --fd 3 --home H --io <bin>` with fd 3 a pipe and an allow-list env', async () => {
    const r = rig();
    const s = await r.sup.start();
    expect(s).toMatchObject({ clientConnected: true, phase: 'running', wanted: true, restarts: 0, devUnsigned: false });
    expect(r.spawns).toHaveLength(1);
    const sp = r.spawns[0]!;
    expect(sp.cmd).toBe('/node');
    expect(sp.args).toEqual(voiceChildArgs('/pkg/gnomon-voice/dist/cli.js', '/h', '/h/bin/voice/GnomonVoiceIO.app/Contents/MacOS/gnomon-voice-io'));
    expect(sp.args.slice(0, 1)).toEqual(['--disable-sigusr1']);
    expect(sp.stdio).toEqual(['pipe', 'pipe', 'pipe', 'pipe']);
    expect(sp.env).toEqual(voiceChildEnv({ HOME: '/Users/x', LANG: 'en_US.UTF-8', LC_ALL: 'C' }, '/h'));
    for (const k of ['NODE_OPTIONS', 'GNOMON_SOCKET', 'DYLD_INSERT_LIBRARIES']) expect(sp.env).not.toHaveProperty(k);
    expect(sp.env).toMatchObject({ GNOMON_HOME: '/h', HOME: '/Users/x' });
    expect(r.sup.connId).toBe('conn:V1');
    // idempotent: a second start spawns nothing
    await r.sup.start();
    expect(r.spawns).toHaveLength(1);
  });

  it('reports the model download (an integer MB) while preparing, then clears it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = rig({
      prepare: async (report) => {
        report('downloading-models', 412);
        await gate;
        return { ioBinary: '/io', devUnsigned: true };
      },
    });
    const p = r.sup.start();
    await tick();
    expect(r.sup.status()).toMatchObject({ phase: 'downloading-models', downloadMb: 412, clientConnected: false });
    release();
    const s = await p;
    expect(s).toMatchObject({ phase: 'running', devUnsigned: true });
    expect(s).not.toHaveProperty('downloadMb');
  });

  it('restarts a crashed child with exponential backoff (doubling, capped) and resets after a stable run', async () => {
    const r = rig({ backoffMinMs: 1000, backoffMaxMs: 4000, stableMs: 60_000 });
    await r.sup.start();
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      r.children.at(-1)!.crash();
      expect(r.sup.status()).toMatchObject({ phase: 'backoff' });
      expect(r.sup.status().lastError).toMatch(/exit 1.*the mic went away/);
      waits.push(r.fire());
      await tick();
      await tick();
    }
    expect(waits).toEqual([1000, 2000, 4000, 4000]);
    expect(r.spawns).toHaveLength(5);
    expect(r.sup.status()).toMatchObject({ phase: 'running', restarts: 4 });
    // a run longer than stableMs resets the backoff
    r.advance(60_000);
    r.children.at(-1)!.crash();
    expect(r.fire()).toBe(1000);
  });

  it('a human stop kills the child (stdin end, SIGTERM, SIGKILL after grace) and ends every restart', async () => {
    const r = rig();
    await r.sup.start();
    const c = r.children[0]!;
    c.exitOnTerm = false; // ignores SIGTERM: the grace timer escalates
    const p = r.sup.stop();
    await tick();
    expect(c.stdinEnded).toBe(true);
    expect(c.signals).toEqual(['SIGTERM']);
    r.fire(); // grace elapsed
    const s = await p;
    expect(c.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(s).toMatchObject({ phase: 'stopped', wanted: false, clientConnected: false });
    expect(r.timers.filter((x) => !x.cleared)).toHaveLength(0); // no restart pending
    expect(r.spawns).toHaveLength(1);
  });

  it('a crash during backoff then stop: the pending restart is cancelled', async () => {
    const r = rig();
    await r.sup.start();
    r.children[0]!.crash();
    await r.sup.stop();
    expect(r.timers.every((x) => x.cleared)).toBe(true);
    expect(r.spawns).toHaveLength(1);
  });

  it('close() (daemon exit / drain) kills it and no later start or crash ever respawns (TD-908)', async () => {
    const r = rig();
    await r.sup.start();
    await r.sup.close();
    expect(r.children[0]!.signals).toContain('SIGTERM');
    expect(await r.sup.start()).toMatchObject({ phase: 'stopped', clientConnected: false });
    expect(r.spawns).toHaveLength(1);
  });

  it('a refused install (unsigned, bad model hash) is failed, not retried', async () => {
    const r = rig({ prepare: async () => Promise.reject(new Error("The voice app is not signed by Gnomon's team")) });
    const s = await r.sup.start();
    expect(s).toMatchObject({ phase: 'failed', wanted: false, lastError: expect.stringMatching(/not signed/) });
    expect(r.spawns).toHaveLength(0);
    expect(r.timers).toHaveLength(0);
  });

  it('an attach refusal kills the child; a connection close clears clientConnected', async () => {
    const r = rig({ attach: async () => Promise.reject(new Error('the kernel log refused the voice auth row')) });
    const s = await r.sup.start();
    expect(s).toMatchObject({ phase: 'failed', clientConnected: false });
    expect(r.children[0]!.signals).toContain('SIGTERM');
    const ok = rig();
    await ok.sup.start();
    ok.sup.connectionClosed('conn:other');
    expect(ok.sup.status().clientConnected).toBe(true);
    ok.sup.connectionClosed('conn:V1');
    expect(ok.sup.status().clientConnected).toBe(false);
  });

  it('no client entry (non-darwin, not installed): start fails with the plain reason and spawns nothing', async () => {
    const r = rig({ clientEntry: null, unavailableReason: 'voice runs on macOS only for now' });
    expect(await r.sup.start()).toMatchObject({ phase: 'failed', unavailable: 'voice runs on macOS only for now', clientConnected: false });
    expect(r.spawns).toHaveLength(0);
  });
});

describe('#gnomon-voice V2e: client entry resolution (lazy, darwin only)', () => {
  it('is unavailable on every other OS, without touching the filesystem', () => {
    for (const p of ['linux', 'win32'] as const) expect(resolveVoiceClientEntry(p, '/nowhere/x.js')).toEqual({ entry: null, reason: 'voice runs on macOS only for now' });
  });
  it('finds a built workspace sibling or an installed package; says "not built" / "not installed" otherwise', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-entry-'));
    try {
      const from = path.join(root, 'packages', 'gnomon', 'dist', 'cli', 'gnomond.js');
      fs.mkdirSync(path.dirname(from), { recursive: true });
      expect(resolveVoiceClientEntry('darwin', from)).toEqual({ entry: null, reason: 'the voice client is not installed' });
      const sib = path.join(root, 'packages', 'gnomon-voice');
      fs.mkdirSync(path.join(sib, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(sib, 'package.json'), JSON.stringify({ name: '@a-company/gnomon-voice' }));
      expect(resolveVoiceClientEntry('darwin', from)).toEqual({ entry: null, reason: 'the voice client is not built' });
      fs.writeFileSync(path.join(sib, 'dist', 'cli.js'), '');
      expect(resolveVoiceClientEntry('darwin', from)).toEqual({ entry: path.join(sib, 'dist', 'cli.js') });
      // a directory merely NAMED gnomon-voice is not the package
      fs.writeFileSync(path.join(sib, 'package.json'), JSON.stringify({ name: 'evil' }));
      expect(resolveVoiceClientEntry('darwin', from).entry).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

type Who = { kind: 'human' | 'agent' | 'session' | 'mod' | 'voice' | 'peer'; credential?: 'device' | 'gui' } | { kind: 'readToken' };

function drig() {
  const logged: Array<{ kind: string; payload: unknown }> = [];
  const calls: string[] = [];
  const d = createKernelDispatcher({
    authenticator: {
      now: () => Date.now(),
      checkToken: () => ({ ok: true }),
      authenticate: (s: Record<string, unknown>, p: { who: Who }) => {
        s.phase = 'authenticated';
        s.principal = 'p:abcdefgh/x';
        if (p.who.kind === 'readToken') {
          Object.assign(s, { credential: 'read-token', tokenId: 'rtk:T', tokenExpiresAtMs: Date.now() + 60_000 });
          return { ok: true, credential: 'read-token', principal: 'p:abcdefgh/x', tokenId: 'rtk:T', expiresAt: new Date(Date.now() + 60_000).toISOString() };
        }
        Object.assign(s, { principalKind: p.who.kind, deviceId: 'dev:abcdefgh/mac', credential: p.who.credential ?? 'device' });
        if (p.who.credential === 'gui') return { ok: true, credential: 'gui', principal: 'p:abcdefgh/x', deviceId: 'dev:abcdefgh/mac', via: 'launch', guiToken: 'g', commit: () => undefined, abort: () => undefined };
        return { ok: true, credential: 'device', principal: 'p:abcdefgh/x', principalKind: p.who.kind, deviceId: 'dev:abcdefgh/mac', keyId: 'k' };
      },
    } as never,
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
    log: async (kind, payload) => void logged.push({ kind, payload }),
    voiceClient: {
      start: async () => (calls.push('start'), { phase: 'running' }),
      stop: async () => (calls.push('stop'), { phase: 'stopped' }),
      connectionClosed: (id) => void calls.push(`closed:${id}`),
      enrol: async (asker, p) => (calls.push(`enrol:${asker.principal}:${JSON.stringify(p)}`), { cardId: 'card:x' }),
    },
  });
  let n = 0;
  const ctxOf = () => {
    const ctx = { connId: `conn:t-${++n}`, closed: false, authed: 0, close() { ctx.closed = true; }, authenticated() { ctx.authed++; }, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    return ctx;
  };
  const call = (ctx: unknown, method: string, params: unknown = {}) => d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method, params }, ctx as never);
  const connect = async (who: Who) => {
    const ctx = ctxOf();
    await d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'auth', params: { who } }, ctx as never);
    return (method: string, params: unknown = {}) => call(ctx, method, params);
  };
  return { d, logged, calls, ctxOf, call, connect };
}

async function refusal(p: unknown): Promise<{ code: string; reason: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcRefusal) return { code: e.refusal.code, reason: e.refusal.data?.reason };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('#gnomon-voice V2e: the adopted-fd principal is voice and nothing else', () => {
  it('adoptPreauthenticated authenticates p:<ns>/voice as principalKind voice, credential device, logged via spawn', async () => {
    const r = drig();
    const ctx = r.ctxOf();
    await r.d.adoptPreauthenticated(ctx as never, { principal: 'p:abcdefgh/voice', client: { name: '@a-company/gnomon-voice', version: 'spawned' } });
    expect(ctx.authed).toBe(1);
    const c = r.d.clients().find((x) => x.connId === ctx.connId)!;
    expect(c).toMatchObject({ principal: 'p:abcdefgh/voice', principalKind: 'voice', credential: 'device' });
    expect(r.logged).toContainEqual({ kind: 'socket.auth.ok', payload: expect.objectContaining({ principal: 'p:abcdefgh/voice', principalKind: 'voice', via: 'spawn' }) });
    // the voice column of the matrix: no approve, no session open, no human verbs, no voice-client control
    expect(await refusal(r.call(ctx, 'approve', { cardId: 'card:x', decision: 'allow' }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusal(r.call(ctx, 'session.open', { cwd: '/' }))).toMatchObject({ code: 'FORBIDDEN' });
    await expect(r.call(ctx, 'log.append', { kind: 'request.voice.client', payload: { op: 'stop' } })).rejects.toBeInstanceOf(RpcRefusal);
    expect(r.calls).toEqual([]);
    expect(r.d.clients().find((x) => x.connId === ctx.connId)?.principalKind).toBe('voice');
  });

  it('refuses any other principal (human, kernel, agent, another namespace shape) and a connection that already spoke', async () => {
    const r = drig();
    for (const principal of ['p:abcdefgh/founder', 'p:abcdefgh/kernel', 'p:abcdefgh/s-1', 'p:ABC/voice', 'p:abcdefgh/voice/x', 'voice']) {
      await expect(r.d.adoptPreauthenticated(r.ctxOf() as never, { principal, client: { name: 'x', version: '1' } })).rejects.toThrow(/voice principal only/);
    }
    const ctx = r.ctxOf();
    await r.d.adoptPreauthenticated(ctx as never, { principal: 'p:abcdefgh/voice', client: { name: 'x', version: '1' } });
    await expect(r.d.adoptPreauthenticated(ctx as never, { principal: 'p:abcdefgh/voice', client: { name: 'x', version: '1' } })).rejects.toThrow(/already spoke/);
  });

  it('a voice auth row the log refuses closes the connection (never an authenticated connection the log does not hold)', async () => {
    const d = createKernelDispatcher({
      authenticator: { now: () => Date.now(), checkToken: () => ({ ok: true }), authenticate: () => ({ ok: false }) } as never,
      status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
      log: async () => Promise.reject(new Error('disk full')),
    });
    const ctx = { connId: 'conn:z', closed: false, close() { ctx.closed = true; }, authenticated() {}, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    await expect(d.adoptPreauthenticated(ctx as never, { principal: 'p:abcdefgh/voice', client: { name: 'x', version: '1' } })).rejects.toThrow(/refused the voice auth row/);
    expect(ctx.closed).toBe(true);
  });
});

describe('#gnomon-voice V2e: request.voice.client is human only', () => {
  it('a human (device or GUI) starts and stops the voice app; the port is reached, nothing is written as a row', async () => {
    const r = drig();
    for (const credential of ['device', 'gui'] as const) {
      const call = await r.connect({ kind: 'human', credential });
      expect(await call('log.append', { kind: 'request.voice.client', payload: { op: 'start' } })).toMatchObject({ voiceClient: { phase: 'running' } });
      expect(await call('log.append', { kind: 'request.voice.client', payload: { op: 'stop' } })).toMatchObject({ voiceClient: { phase: 'stopped' } });
    }
    expect(r.calls).toEqual(['start', 'stop', 'start', 'stop']);
    expect(r.logged.filter((x) => x.kind.startsWith('request.'))).toEqual([]);
  });

  it('bad params are BAD_REQUEST', async () => {
    const r = drig();
    const call = await r.connect({ kind: 'human' });
    for (const params of [{ kind: 'request.voice.client', payload: { op: 'restart' } }, { kind: 'request.voice.client', payload: { op: 'start', x: 1 } }, { kind: 'request.voice.client', payload: { op: 'start' }, session: 'hs:x' }, { kind: 'request.voice.client', payload: null }]) {
      expect(await refusal(call('log.append', params)), JSON.stringify(params)).toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(r.calls).toEqual([]);
  });

  it('every other class (agent, session, mod, voice, read token, peer) is refused and never reaches the port', async () => {
    const r = drig();
    for (const who of [{ kind: 'agent' }, { kind: 'session' }, { kind: 'mod' }, { kind: 'voice' }, { kind: 'readToken' }, { kind: 'peer' }] as Who[]) {
      const call = await r.connect(who);
      for (const op of ['start', 'stop']) await expect(call('log.append', { kind: 'request.voice.client', payload: { op } }), `${who.kind} ${op}`).rejects.toBeInstanceOf(RpcRefusal);
    }
    expect(r.calls).toEqual([]);
  });

  it('a closed connection is reported to the supervisor', async () => {
    const r = drig();
    const ctx = r.ctxOf();
    r.d.onDisconnect(ctx as never);
    expect(r.calls).toEqual([`closed:${ctx.connId}`]);
  });
});
