// @gnomon-platform: darwin, linux
/**
 * $daemon-lifecycle (spec §2.4 rule 2) — the readiness handshake over real
 * gnomond processes (T-2026-10-19-009 item 3, Orca audit Adopt 3).
 *
 * The activator learns readiness from the kernel's `gnomonReady:v1` line on an
 * inherited pipe, never by polling; a kernel that dies first is reported with
 * its stderr tail and a classified exit code; two activators racing for one
 * home end with one `ready` and one `attached`, neither an error. Unix
 * sockets only (the Windows named pipe is the parity phase, P8-D78); the
 * exit-code table and the stderr tail run everywhere in
 * test/daemon-exit-codes.test.ts.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canConnectSocket,
  DAEMON_EXIT,
  DAEMON_READY_SCHEMA,
  exitCodeOfLaunch,
  launchDaemon,
  READY_LINE_MAX,
  pidAlive,
  pidPathOf,
  readPidfile,
  selectSocketPath,
  type LaunchOutcome,
} from '../src/kernel/lifecycle/index.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';

const GNOMOND = path.join(PKG_ROOT, 'dist', 'cli', 'gnomond.js');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function home(): string {
  const t = tempHome();
  cleanups.push(t.cleanup);
  return t.home;
}

function sockOf(h: string): string {
  const c = selectSocketPath({ home: h });
  if (!c.ok) throw new Error('no socket path');
  return c.path;
}

/** Stop the kernel that holds `h` and wait for its lock to go. */
function reap(h: string): void {
  cleanups.push(async () => {
    const pf = readPidfile(h);
    if (!pf) return;
    try {
      process.kill(pf.pid, 'SIGTERM');
    } catch {
      return;
    }
    for (let i = 0; i < 100 && pidAlive(pf.pid); i++) await sleep(50);
  });
}

function launch(h: string, extra: Partial<Parameters<typeof launchDaemon>[0]> = {}): Promise<LaunchOutcome> {
  return launchDaemon({ execPath: process.execPath, entry: GNOMOND, home: h, socketPath: sockOf(h), idleMs: 60_000, ...extra });
}

describe('§2.4 rule 2: readiness handshake (Orca Adopt 3)', () => {
  it('the activator gets ready{identity} on the inherited pipe, and the identity is the lock holder', async () => {
    const h = home();
    reap(h);
    const o = await launch(h);
    expect(o.kind).toBe('ready');
    if (o.kind !== 'ready') return;
    expect(o.identity.schemaVersion).toBe(DAEMON_READY_SCHEMA);
    const pf = readPidfile(h)!;
    expect(o.identity.pid).toBe(pf.pid);
    expect(o.identity.startedAt).toBe(pf.startedAt);
    expect(o.identity.socketPath).toBe(pf.socketPath);
    expect(o.identity.kernelPrincipal.length).toBeGreaterThan(0);
    expect(await canConnectSocket(o.identity.socketPath)).toBe(true);
    // the kernel outlives the activator's closed pipes (EPIPE is not a crash)
    await sleep(300);
    expect(pidAlive(pf.pid)).toBe(true);
    expect(await canConnectSocket(o.identity.socketPath)).toBe(true);
  });

  it('FALSIFIER: two activators racing for one home end ready + attached, neither an error, one kernel', async () => {
    const h = home();
    reap(h);
    const [a, b] = await Promise.all([launch(h), launch(h)]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['attached', 'ready']);
    const loser = a.kind === 'attached' ? a : b;
    const winner = a.kind === 'ready' ? a : b;
    if (loser.kind !== 'attached' || winner.kind !== 'ready') return;
    expect(loser.socketPath).toBe(winner.identity.socketPath);
    expect(readPidfile(h)!.pid).toBe(winner.identity.pid);
  });

  it('FALSIFIER: a config fault before ready is reported with its stderr tail and exit 78, not polled into a timeout', async () => {
    const real = home();
    mkdirSync(real, { recursive: true, mode: 0o700 });
    const link = `${real}-link`;
    symlinkSync(real, link);
    cleanups.push(() => rmSync(link, { force: true }));
    const t0 = Date.now();
    const o = await launch(link, { timeoutMs: 15_000 });
    expect(o.kind).toBe('exited');
    if (o.kind !== 'exited') return;
    expect(o.code).toBe(DAEMON_EXIT.config);
    expect(o.class).toBe('config');
    expect(o.stderrTail).toContain('[unsafe-home]');
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(readPidfile(real)).toBeNull();
    expect(pidPathOf(real)).toBeTruthy();
  });
});

/** A fake detached kernel: stdio[2] = stderr, stdio[3] = the ready pipe. No real process. */
type FakeChild = ChildProcess & { ready: PassThrough; err: PassThrough; die(code: number): void };
function fakeChild(pid = 4242): FakeChild {
  const ee = new EventEmitter() as unknown as FakeChild & { exitCode: number | null; signalCode: null };
  const ready = new PassThrough();
  const err = new PassThrough();
  Object.assign(ee, {
    pid,
    exitCode: null,
    signalCode: null,
    stdio: [null, null, err, ready],
    ready,
    err,
    unref: () => undefined,
    kill: () => true,
    die(code: number) {
      (ee as { exitCode: number | null }).exitCode = code;
      ready.end();
      ee.emit('exit', code, null);
    },
  });
  return ee;
}

const SOCK = '/home/u/.gnomon/run/gnomon.sock';
function seamLaunch(child: FakeChild, o: { probe: () => boolean; holder?: number | null; timeoutMs?: number; attachWaitMs?: number }) {
  let probes = 0;
  const p = launchDaemon({
    execPath: 'node',
    home: '/home/u/.gnomon',
    socketPath: SOCK,
    timeoutMs: o.timeoutMs ?? 400,
    attachWaitMs: o.attachWaitMs ?? 200,
    spawnChild: () => child,
    probeSocket: async () => (probes++, o.probe()),
    lockHolderPid: () => o.holder ?? null,
  });
  return { p, probes: () => probes };
}
const line = (pid: number, socketPath = SOCK): string =>
  `${JSON.stringify({ schemaVersion: DAEMON_READY_SCHEMA, pid, startedAt: 't', socketPath, kernelPrincipal: 'k' })}\n`;

describe('§2.4 rule 2: launcher decisions over the spawnChild seam (every platform)', () => {
  it('a well-formed ready line from the child with the expected socketPath is ready', async () => {
    const c = fakeChild();
    const { p } = seamLaunch(c, { probe: () => false });
    c.ready.write(line(4242));
    expect((await p).kind).toBe('ready');
  });

  it('FALSIFIER: a forged socketPath is rejected; our own child owning the socket at the deadline is timeout, not attached', async () => {
    const c = fakeChild();
    const { p } = seamLaunch(c, { probe: () => true, holder: 4242 });
    c.ready.write(line(4242, '/attacker/gnomon.sock'));
    const o = await p;
    expect(o.kind).toBe('timeout');
    if (o.kind === 'timeout') expect(o.stderrTail).toContain('ready line rejected: socketPath');
  });

  it('at the deadline a socket owned by ANOTHER kernel is attached (socket-probe)', async () => {
    const c = fakeChild();
    const o = await seamLaunch(c, { probe: () => true, holder: 999 }).p;
    expect(o).toEqual({ kind: 'attached', socketPath: SOCK, via: 'socket-probe' });
  });

  it('FALSIFIER: a ready line over READY_LINE_MAX without a newline is malformed, even if a valid line follows', async () => {
    const c = fakeChild();
    const { p } = seamLaunch(c, { probe: () => false });
    c.ready.write('x'.repeat(READY_LINE_MAX + 1));
    c.ready.write(`\n${line(4242)}`);
    const o = await p;
    expect(o.kind).toBe('timeout');
    if (o.kind === 'timeout') expect(o.stderrTail).toContain('without a newline');
  });

  it('no ready line (pipe closed, child alive): probes the socket and attaches via no-ready-line', async () => {
    const c = fakeChild();
    let n = 0;
    const t0 = Date.now();
    const { p } = seamLaunch(c, { probe: () => ++n >= 3, timeoutMs: 5_000 });
    c.ready.end();
    expect(await p).toEqual({ kind: 'attached', socketPath: SOCK, via: 'no-ready-line' });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('FALSIFIER: the no-ready-line wait ends at the GLOBAL deadline, and no probe runs after the launch settled', async () => {
    const c = fakeChild();
    const t0 = Date.now();
    const s = seamLaunch(c, { probe: () => false, timeoutMs: 400 });
    c.ready.end();
    expect((await s.p).kind).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1_000); // was deadline + a fresh full timeout
    const after = s.probes();
    await sleep(250);
    expect(s.probes()).toBe(after);
  });

  it('FALSIFIER: superseded exit with no winner answering is exited/superseded (activator exit 75), and the probe loop stops', async () => {
    const c = fakeChild();
    const s = seamLaunch(c, { probe: () => false, attachWaitMs: 200, timeoutMs: 10_000 });
    c.err.write('another kernel serves this home [already-running]\n');
    c.die(DAEMON_EXIT.superseded);
    const o = await s.p;
    expect(o).toMatchObject({ kind: 'exited', code: 4, class: 'superseded' });
    if (o.kind === 'exited') expect(o.stderrTail).toContain('[already-running]');
    expect(exitCodeOfLaunch(o)).toBe(DAEMON_EXIT.transient);
    const after = s.probes();
    await sleep(200);
    expect(s.probes()).toBe(after);
  });

  it('superseded exit while the winner answers is attached via superseded', async () => {
    const c = fakeChild();
    const s = seamLaunch(c, { probe: () => true, timeoutMs: 10_000 });
    c.die(DAEMON_EXIT.superseded);
    expect(await s.p).toEqual({ kind: 'attached', socketPath: SOCK, via: 'superseded' });
  });
});
