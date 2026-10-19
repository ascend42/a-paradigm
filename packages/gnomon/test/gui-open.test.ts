// @gnomon-platform: darwin, linux
/**
 * #socket / #bare-entry — `gui.open {cwdHint?}` (spec §2.4 rule 8, P8-D98 verb 13, T-2026-10-19-001 A3).
 * Falsifiers:
 *   - an agent connection, a read token and a connection with no verified-device auth are refused; the port is never reached;
 *   - a cwdHint over 1024 UTF-8 bytes is refused BAD_REQUEST{cwd-hint-too-long} before any mint;
 *   - the launch-grant cap is ONE cap shared by the in-process launch, the wrapper channel and gui.open (not added on top);
 *   - the grant is single-use and expires at most 60 s after it is minted;
 *   - the cwdHint is never written to the log (the whole home is grepped);
 *   - bare `gnomon` against a running kernel: no TTY ⇒ nothing printed, no RPC; a TTY ⇒ it opens the folder.
 * The real-kernel tests are darwin-only (linux has no `transport` sandbox profile, so web-launch is refused, §15.5).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { GUI_OPEN_CWD_HINT_MAX_BYTES } from '@a-company/gnomon-contracts';
import { BARE_EXIT_ALREADY_RUNNING, runBareCommand } from '../src/cli/bare-cli.js';
import { runIdentityCommand, type IdentityDeps } from '../src/cli/identity-cli.js';
import { requestRunningLaunch, startUpKernel, UpRefusal, type UpDeps, type UpKernel } from '../src/cli/up-cli.js';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, type HelperTransport } from '../src/kernel/identity/index.js';
import { selectSocketPath, startDaemon, type DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { connectGnomon, createGuiOpenHandler, createKernelDispatcher, RpcRefusal } from '../src/kernel/socket/index.js';
import { LAUNCH_GRANT_CAP, LaunchGrantCap } from '../src/kernel/web/launch-cap.js';
import { LAUNCH_TOKEN_TTL_MS } from '../src/kernel/web/launch.js';
import { FakeHelper } from './helper-fake.js';
import { privateTmpRoot } from './daemon-helpers.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const NO_TRANSPORT = process.platform !== 'darwin';
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/* ── the handler behind the dispatcher (every platform) ─────────────────── */

type Who = { kind: 'human' | 'agent'; credential?: 'device' | 'gui' } | { kind: 'readToken' };
const GRANT = { port: 1, launchToken: 'T'.repeat(43), expiresAt: Date.now() + LAUNCH_TOKEN_TTL_MS, kernelPublicKey: 'K', bundleHash: 'sha256:x', url: 'http://127.0.0.1:1/#launch=TTT&k=K' };

function rig() {
  const asked: string[] = [];
  const d = createKernelDispatcher({
    authenticator: {
      now: () => Date.now(),
      checkToken: () => ({ ok: true }),
      authenticate: (s: Record<string, unknown>, p: { who: Who }) => {
        s.phase = 'authenticated';
        s.principal = 'p:local/x';
        if (p.who.kind === 'readToken') {
          Object.assign(s, { credential: 'read-token', tokenId: 'rtk:T', tokenExpiresAtMs: Date.now() + 60_000 });
          return { ok: true, credential: 'read-token', principal: 'p:local/x', tokenId: 'rtk:T', expiresAt: new Date(Date.now() + 60_000).toISOString() };
        }
        Object.assign(s, { principalKind: p.who.kind, credential: p.who.credential ?? 'device', deviceId: 'dev:local/mac' });
        return { ok: true, credential: 'device', principal: 'p:local/x', principalKind: p.who.kind, deviceId: 'dev:local/mac', keyId: 'k' };
      },
    } as never,
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
    log: async () => undefined,
    humanVerbs: { 'gui.open': createGuiOpenHandler({ requestLaunch: async (connId) => (asked.push(connId), GRANT) }) },
  });
  let n = 0;
  const connect = async (who: Who | null) => {
    const ctx = { connId: `conn:test-${++n}`, closed: false, close() {}, authenticated() {}, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    if (who) await d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'auth', params: { who } }, ctx as never);
    return (params: unknown = {}) => d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method: 'gui.open', params }, ctx as never);
  };
  return { connect, asked };
}

async function refusal(p: unknown): Promise<{ code: string; reason: unknown; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcRefusal) return { code: e.refusal.code, reason: e.refusal.data?.reason, message: e.message };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('gui.open: who may call it (FALSIFIERS)', () => {
  it('an agent connection, a read token, a GUI launch-token connection and an unauthenticated (hello-only) connection are refused; the mint is never reached', async () => {
    const { connect, asked } = rig();
    for (const who of [{ kind: 'agent' }, { kind: 'readToken' }, { kind: 'human', credential: 'gui' }] as Who[]) {
      expect(await refusal((await connect(who))({})), JSON.stringify(who)).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    const r = await refusal((await connect(null))({})); // no auth over a verified hello: refused before the matrix even runs
    expect(r.code).not.toBe('ENGINE');
    expect(asked).toEqual([]);
  });
  it('a verified human device gets {url, expiresAt (ISO), cwdHint verbatim}', async () => {
    const { connect, asked } = rig();
    const call = await connect({ kind: 'human' });
    const hint = '/Users/matt/репо with space';
    expect(await call({ cwdHint: hint })).toEqual({ url: GRANT.url, expiresAt: new Date(GRANT.expiresAt).toISOString(), cwdHint: hint });
    expect(await call({})).toEqual({ url: GRANT.url, expiresAt: new Date(GRANT.expiresAt).toISOString() });
    expect(asked).toHaveLength(2);
  });
  it('a cwdHint over 1024 UTF-8 bytes is refused BAD_REQUEST{cwd-hint-too-long} (length only, never the hint); 1024 passes; no mint for a bad one', async () => {
    const { connect, asked } = rig();
    const call = await connect({ kind: 'human' });
    const over = `/${'é'.repeat(GUI_OPEN_CWD_HINT_MAX_BYTES / 2)}`; // 1025 bytes
    const r = await refusal(call({ cwdHint: over }));
    expect(r).toMatchObject({ code: 'BAD_REQUEST', reason: 'cwd-hint-too-long' });
    expect(r.message).not.toContain('é');
    expect(await refusal(call({ cwdHint: 7 }))).toMatchObject({ code: 'BAD_REQUEST', reason: 'bad-params' });
    expect(await refusal(call({ cwdHint: '/a', extra: 1 }))).toMatchObject({ code: 'BAD_REQUEST', reason: 'bad-params' });
    expect(asked).toEqual([]);
    expect(await call({ cwdHint: `/${'a'.repeat(GUI_OPEN_CWD_HINT_MAX_BYTES - 1)}` })).toMatchObject({ url: GRANT.url });
  });
});

describe('the ONE launch-grant cap (FALSIFIER: shared, not added on top)', () => {
  it('two askers drawing on one cap get LAUNCH_GRANT_CAP grants a minute in total; one in flight; the window frees them', async () => {
    let t = 1_000_000;
    const cap = new LaunchGrantCap(() => t);
    const mint = async (): Promise<string> => 'g';
    let ok = 0;
    for (let i = 0; i < LAUNCH_GRANT_CAP + 4; i++) {
      // alternate the "wrapper" and the "gui.open" askers: the count is one
      if (await cap.run(mint).then(() => true, (e: Error) => (expect(e.message).toContain('in a minute'), false))) ok++;
    }
    expect(ok).toBe(LAUNCH_GRANT_CAP);
    t += 60_001;
    let release!: () => void;
    const held = cap.run(() => new Promise<string>((r) => (release = () => r('g'))));
    await expect(cap.run(mint)).rejects.toThrow('a launch is already being minted');
    release();
    await held;
    await expect(cap.run(mint)).resolves.toBe('g');
  });
});

/* ── a real kernel on a provisioned home (darwin: the web endpoint needs the transport sandbox) ── */

function tmpDir(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), prefix)));
  cleanups.push(() => removeTree(d));
  return d;
}
function view(fake: FakeHelper): HelperTransport {
  return { request: (r) => fake.request(r), get alive() { return fake.alive; }, onExit: (cb) => fake.onExit(cb), close: async () => undefined };
}
async function running(): Promise<{ uh: string; home: string; fake: FakeHelper; k: UpKernel; deps: UpDeps }> {
  const uh = tmpDir('go-');
  const home = path.join(uh, '.gnomon');
  const fake = new FakeHelper(null);
  const exe = path.join(uh, 'gnomon-helper');
  fs.writeFileSync(exe, `#!${process.execPath}\n`);
  fs.chmodSync(exe, 0o755);
  const ideps: IdentityDeps = { env: {}, verifier: DEV, handleSignals: false, start: () => (fake.revive(), view(fake)), once: () => (req) => fake.handle(req) };
  expect(await runIdentityCommand(['init', '--home', home, '--helper', exe, '--name', 'matt', '--host', 'mac'], { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }, ideps)).toBe(0);
  const deps: UpDeps = { userHome: uh, verifier: DEV, startHelper: () => (fake.revive(), view(fake)), runtime: { env: {}, execArgv: ['--disable-sigusr1'] } };
  // the "already running" kernel: gnomon up's own, on the hardware identity (a Gnomon.app / gnomond stand-in)
  const k = await startUpKernel(fs.realpathSync.native(home), deps);
  cleanups.push(() => k.stop());
  return { uh, home: fs.realpathSync.native(home), fake, k, deps };
}
function tty() {
  const o: string[] = [];
  const e: string[] = [];
  return { stdin: new PassThrough(), stdout: { write: (s: string) => (o.push(s), true), isTTY: true }, stderr: { write: (s: string) => (e.push(s), true) }, o, e };
}
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.isFile() ? [path.join(dir, d.name)] : []));
}

describe.skipIf(NO_TRANSPORT)('gui.open on a running kernel', () => {
  it('FALSIFIER: an unverified hello cannot reach it; a pinned device gets a single-use grant that expires at most 60 s after minting', async () => {
    const { home, k } = await running();
    const sock = selectSocketPath({ home });
    if (!sock.ok) throw new Error(sock.reason);
    const s = await connectGnomon({ socketPath: sock.path, client: { name: 't', version: '0', surface: 'cli' } }); // hello only, nothing verified
    const r = await s.conn.call('gui.open', {});
    await s.conn.close();
    expect('error' in r).toBe(true);
    expect(k.handle.web()).toBeNull(); // refused before any endpoint or token exists
    const before = Date.now();
    const g = await requestRunningLaunch(home, undefined);
    expect(Date.parse(g.expiresAt) - before).toBeLessThanOrEqual(LAUNCH_TOKEN_TTL_MS + 1000); // at most 60 s (ISO is ms-precise; 1 s clock slack)
    const token = /#launch=([A-Za-z0-9_-]{43})&k=/.exec(g.url)![1]!;
    const access = k.handle.web()!.access;
    expect(access.exchange(token, 'conn:a').kind).toBe('fresh');
    expect(access.exchange(token, 'conn:b').kind).toBe('theft'); // single use: a second presentation is never a launch
  });

  it('FALSIFIER: the cap is shared with the in-process launch (the terminal / wrapper path), not added on top', async () => {
    const { home, k } = await running();
    for (let i = 0; i < LAUNCH_GRANT_CAP - 2; i++) await k.launch(); // the in-process path (what the wrapper channel calls)
    await requestRunningLaunch(home, undefined);
    await requestRunningLaunch(home, undefined);
    const e = await requestRunningLaunch(home, undefined).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(UpRefusal);
    expect((e as UpRefusal).reason).toBe('gui-open-web-launch-capped');
    await expect(k.launch()).rejects.toThrow('in a minute'); // and the in-process path sees the same count
  });

  it('FALSIFIER: no TTY ⇒ nothing printed and gui.open is never called; the already-running refusal (exit 3)', async () => {
    const { uh, k, deps } = await running();
    const repo = tmpDir('gr-');
    fs.mkdirSync(path.join(repo, '.git'));
    const o: string[] = [];
    const e: string[] = [];
    const io = { stdin: new PassThrough(), stdout: { write: (x: string) => (o.push(x), true) }, stderr: { write: (x: string) => (e.push(x), true) } };
    expect(await runBareCommand([], io, { ...deps, userHome: uh, cwd: repo })).toBe(BARE_EXIT_ALREADY_RUNNING);
    expect(o.join('')).toBe('');
    expect(e.join('')).toContain('REFUSED  GNOMON  already-running');
    expect(k.handle.web()).toBeNull(); // no grant was asked for: the endpoint never started
  });

  it('FALSIFIER: bare `gnomon` against a running kernel opens the folder (gui.open), and the hint never reaches the log', async () => {
    const { uh, home, k, deps } = await running();
    const repo = path.join(tmpDir('gr-'), 'hint-canary-7f3a');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const x = tty();
    const opened: string[] = [];
    let started = 0;
    const code = await runBareCommand([], x, { ...deps, userHome: uh, cwd: repo, start: async (o: DaemonOptions) => (started++, startDaemon(o)), openEnv: {}, open: async (u) => (opened.push(u), { ok: true as const }) });
    expect(code).toBe(0);
    expect(started).toBe(0); // no second kernel
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#launch=[A-Za-z0-9_-]{43}&k=[A-Za-z0-9_-]+&cwd=/);
    expect(opened[0]!.endsWith(`&cwd=${Buffer.from(repo, 'utf8').toString('base64url')}`)).toBe(true);
    expect(x.o.join('')).toContain('ATTACHED  gnomon');
    expect(k.handle.web()!.access.pendingLaunches()).toBe(1);
    // grep the chain (and everything else in the home) for the hint, raw and as it rides the fragment
    await k.handle.flushDiagnostics();
    for (const f of walk(home)) {
      const b = fs.readFileSync(f);
      expect(b.includes('hint-canary-7f3a'), f).toBe(false);
      expect(b.includes(Buffer.from(repo, 'utf8').toString('base64url')), f).toBe(false);
    }
  });
});
