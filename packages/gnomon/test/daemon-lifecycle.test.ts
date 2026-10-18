// @gnomon-platform: darwin, linux
/**
 * $daemon-lifecycle (spec §2.4) — G-DMN-01 (one daemon per user: a second
 * instance is refused while the first lives; a stale pidfile is reclaimed) and
 * G-DMN-02 (socket 0600, owner-only home, never under /tmp, sun_path overflow
 * rerouted to $XDG_RUNTIME_DIR on Linux or refused). Unix sockets only: the
 * Windows named pipe is the parity phase (P8-D78), see platform-registry.ts.
 * The platform-independent pieces (home resolution, the win32 endpoint
 * refusal) live in test/home-resolution.test.ts, which runs everywhere.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireDaemonLock,
  DAEMON_PIDFILE_SCHEMA,
  daemonState,
  ensureGnomonHome,
  pidAlive,
  pidPathOf,
  readPidfile,
  selectSocketPath,
  startDaemon,
  SUN_PATH_SAFE,
  type DaemonHandle,
} from '../src/kernel/lifecycle/index.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';

const GNOMOND = path.join(PKG_ROOT, 'dist', 'cli', 'gnomond.js');
const GNOMON = path.join(PKG_ROOT, 'dist', 'cli', 'gnomon.js');

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function home(): string {
  const t = tempHome();
  cleanups.push(t.cleanup);
  return t.home;
}

async function daemon(h: string, idleMs = 60_000): Promise<DaemonHandle> {
  const d = await startDaemon({ home: h, idleMs });
  cleanups.push(() => d.shutdown('signal'));
  return d;
}

/** A pid that is certainly dead: a child that has already exited. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', '0']);
  expect(pidAlive(r.pid!)).toBe(false);
  return r.pid!;
}

function startChild(h: string, extra: string[] = []): Promise<{ child: ChildProcess; ready: { pid: number; socketPath: string } }> {
  const child = spawn(process.execPath, [GNOMOND, '--foreground', '--home', h, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (c: Buffer) => {
      out += c.toString('utf8');
      const nl = out.indexOf('\n');
      if (nl !== -1) resolve({ child, ready: JSON.parse(out.slice(0, nl)) });
    });
    child.once('exit', (code) => reject(new Error(`gnomond exited ${code} before ready`)));
  });
}

function exitOf(child: ChildProcess): Promise<number | null> {
  return child.exitCode !== null ? Promise.resolve(child.exitCode) : new Promise((r) => child.once('exit', (c) => r(c)));
}

describe('home resolution', () => {
  it('creates the home 0700 and tightens a wider one, reading the mode back', () => {
    const h = home();
    ensureGnomonHome(h);
    expect(lstatSync(h).mode & 0o777).toBe(0o700);
    chmodSync(h, 0o755);
    ensureGnomonHome(h);
    expect(lstatSync(h).mode & 0o777).toBe(0o700);
  });

  it('refuses a symlinked home', () => {
    const h = home();
    mkdirSync(h, { recursive: true });
    const link = `${h}-link`;
    symlinkSync(h, link);
    expect(() => ensureGnomonHome(link)).toThrow(/not a plain directory/);
  });
});

describe('G-DMN-01 one daemon per user', () => {
  it('writes daemonPid:v1 O_EXCL with mode 0600', async () => {
    const h = home();
    const d = await daemon(h);
    const pf = JSON.parse(readFileSync(pidPathOf(h), 'utf8'));
    expect(pf).toEqual({ schemaVersion: DAEMON_PIDFILE_SCHEMA, pid: process.pid, startedAt: d.pidfile.startedAt, socketPath: d.pidfile.socketPath });
    expect(lstatSync(pidPathOf(h)).mode & 0o777).toBe(0o600);
    expect(daemonState(h).state).toBe('running');
  });

  it('refuses a second instance in-process while the first is alive', async () => {
    const h = home();
    await daemon(h);
    await expect(startDaemon({ home: h })).rejects.toMatchObject({ reason: 'already-running' });
    expect(readPidfile(h)!.pid).toBe(process.pid); // the loser never touched the winner's lock
  });

  it('refuses a second gnomond process while the first is alive, then the first stops cleanly', async () => {
    const h = home();
    const first = await startChild(h);
    expect(first.ready.pid).toBe(first.child.pid);
    const second = spawnSync(process.execPath, [GNOMOND, '--foreground', '--home', h], { encoding: 'utf8', timeout: 10_000 });
    expect(second.status).toBe(1);
    expect(second.stderr).toMatch(/already running.*\[already-running\]/);
    expect(second.stderr).toContain('daemon.lock.refused');
    expect(readPidfile(h)!.pid).toBe(first.child.pid);
    first.child.kill('SIGTERM');
    expect(await exitOf(first.child)).toBe(0);
    expect(existsSync(pidPathOf(h))).toBe(false);
    expect(existsSync(first.ready.socketPath)).toBe(false);
  });

  it('reclaims a stale pidfile (dead holder) and a stale socket', async () => {
    const h = home();
    ensureGnomonHome(h);
    const sock = path.join(h, 'gnomon.sock');
    // Crash residue: a dead holder's pidfile plus a bound-then-abandoned socket file.
    writeFileSync(pidPathOf(h), JSON.stringify({ schemaVersion: DAEMON_PIDFILE_SCHEMA, pid: deadPid(), startedAt: 'x', socketPath: sock }));
    const stray = spawnSync(
      process.execPath,
      ['-e', `require('net').createServer().listen(${JSON.stringify(sock)}, () => process.kill(process.pid, 'SIGKILL'))`],
    );
    expect(stray.signal).toBe('SIGKILL');
    expect(lstatSync(sock).isSocket()).toBe(true); // a crash leaves the socket file behind
    expect(daemonState(h, sock).state).toBe('stale');
    const d = await daemon(h);
    expect(readPidfile(h)!.pid).toBe(process.pid);
    expect(lstatSync(d.pidfile.socketPath).isSocket()).toBe(true);
  });

  it('reclaims unreadable residue after the mid-write grace', () => {
    const h = home();
    ensureGnomonHome(h);
    writeFileSync(pidPathOf(h), 'garbage{');
    const pf = acquireDaemonLock(h, 4242, { socketPath: path.join(h, 'gnomon.sock') });
    expect(pf.pid).toBe(4242);
    expect(readPidfile(h)!.pid).toBe(4242);
  });

  it('never unlinks a non-socket file at the socket path', async () => {
    const h = home();
    ensureGnomonHome(h);
    writeFileSync(path.join(h, 'gnomon.sock'), 'not a socket');
    await expect(startDaemon({ home: h })).rejects.toMatchObject({ reason: 'endpoint-busy' });
    expect(readFileSync(path.join(h, 'gnomon.sock'), 'utf8')).toBe('not a socket');
    expect(existsSync(pidPathOf(h))).toBe(false); // lock released on failure
  });
});

describe('G-DMN-02 endpoint ACL and placement', () => {
  it('binds <home>/gnomon.sock as a socket with mode 0600 and a 0700 home', async () => {
    const h = home();
    const d = await daemon(h);
    expect(d.via).toBe('home');
    expect(d.pidfile.socketPath).toBe(path.join(h, 'gnomon.sock'));
    const st = lstatSync(d.pidfile.socketPath);
    expect(st.isSocket()).toBe(true);
    expect(st.mode & 0o777).toBe(0o600);
    expect(st.uid).toBe(process.getuid!());
    expect(lstatSync(h).mode & 0o777).toBe(0o700);
    expect(d.pidfile.socketPath.startsWith('/tmp/')).toBe(false);
    expect(d.pidfile.socketPath.startsWith('/private/tmp/')).toBe(false);
  });

  it('restores the process umask after binding', async () => {
    const before = process.umask();
    await daemon(home());
    expect(process.umask()).toBe(before);
  });

  it('refuses a home under /tmp (never /tmp)', () => {
    const r = selectSocketPath({ home: '/tmp/gnomon-home', platform: 'darwin', env: {} });
    expect(r).toMatchObject({ ok: false });
    const r2 = selectSocketPath({ home: '/private/tmp/x', platform: 'linux', env: {} });
    expect(r2.ok).toBe(false);
  });

  it('macOS: a sun_path overflow is refused, with no tmpdir fallback', () => {
    const deep = `/Users/someone/${'d'.repeat(SUN_PATH_SAFE)}`;
    const r = selectSocketPath({ home: deep, platform: 'darwin', env: { XDG_RUNTIME_DIR: '/run/user/501' }, forbiddenRoots: ['/tmp'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/sun_path/);
      expect(r.candidates).toEqual([path.join(deep, 'gnomon.sock')]);
    }
  });

  it('Linux: a sun_path overflow reroutes to a safe $XDG_RUNTIME_DIR', () => {
    const xdg = home();
    mkdirSync(xdg, { recursive: true, mode: 0o700 });
    chmodSync(xdg, 0o700);
    const deep = `/home/someone/${'d'.repeat(SUN_PATH_SAFE)}`;
    const r = selectSocketPath({ home: deep, platform: 'linux', env: { XDG_RUNTIME_DIR: xdg }, forbiddenRoots: ['/tmp', '/private/tmp', '/var/tmp'] });
    expect(r).toMatchObject({ ok: true, via: 'xdg-runtime' });
    if (r.ok) {
      expect(path.dirname(r.path)).toBe(xdg);
      expect(path.basename(r.path)).toMatch(/^gnomon-[0-9a-f]{16}\.sock$/);
      // Deterministic: every client derives the same path.
      expect(selectSocketPath({ home: deep, platform: 'linux', env: { XDG_RUNTIME_DIR: xdg }, forbiddenRoots: ['/tmp'] })).toEqual(r);
    }
  });

  it('Linux: refuses when $XDG_RUNTIME_DIR is unset, relative, too open, or /tmp', () => {
    const deep = `/home/someone/${'d'.repeat(SUN_PATH_SAFE)}`;
    const open = home();
    mkdirSync(open, { recursive: true });
    chmodSync(open, 0o755);
    for (const XDG_RUNTIME_DIR of [undefined, 'run/user/1', open, '/tmp']) {
      const r = selectSocketPath({ home: deep, platform: 'linux', env: { XDG_RUNTIME_DIR }, forbiddenRoots: ['/tmp', '/private/tmp'] });
      expect(r.ok, String(XDG_RUNTIME_DIR)).toBe(false);
    }
  });

  it('startDaemon refuses no-safe-endpoint without taking the lock', async () => {
    const h = home();
    const deep = path.join(h, 'd'.repeat(SUN_PATH_SAFE));
    await expect(startDaemon({ home: deep, platform: 'darwin' })).rejects.toMatchObject({ reason: 'no-safe-endpoint' });
    expect(existsSync(pidPathOf(deep))).toBe(false);
  });
});

describe('gnomon daemon status|stop (CLI over the socket)', () => {
  it('status reports running, stop is a refusal pending approvals, status after exit reports not running', async () => {
    const h = home();
    const { child, ready } = await startChild(h);
    const status = spawnSync(process.execPath, [GNOMON, 'daemon', 'status', '--home', h], { encoding: 'utf8' });
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      running: true,
      socketPath: ready.socketPath,
      clientApi: 'gnomon-rpc:v1',
      serverVerified: false,
      authenticated: false,
      diagnosticPid: ready.pid,
    });
    const stop = spawnSync(process.execPath, [GNOMON, 'daemon', 'stop', '--home', h], { encoding: 'utf8' });
    expect(stop.status).toBe(1);
    expect(JSON.parse(stop.stderr)).toMatchObject({ code: -32000, data: { code: 'ENGINE', data: { reason: 'not-implemented', milestone: 'M1.6' } } });
    child.kill('SIGTERM');
    await exitOf(child);
    const after = spawnSync(process.execPath, [GNOMON, 'daemon', 'status', '--home', h], { encoding: 'utf8' });
    expect(after.status).toBe(3);
    expect(JSON.parse(after.stdout)).toEqual({ running: false, state: 'stopped' });
  });

  it('G-DMN-03 + G-DMN-05: --detach activates a daemon with the clean env (no NODE_OPTIONS / GNOMON_*), which then idles out', async () => {
    const h = home();
    const r = spawnSync(process.execPath, [GNOMON, 'daemon', '--detach', '--home', h, '--idle-ms', '300'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--no-warnings', GNOMON_HOME: '/nonexistent' },
    });
    expect(r.status, r.stderr).toBe(0);
    const pf = readPidfile(h)!;
    expect(pf).not.toBeNull();
    // The detached daemon got home via argv; its env carried no NODE_OPTIONS / GNOMON_*.
    const ps = spawnSync('ps', ['eww', '-o', 'command=', '-p', String(pf.pid)], { encoding: 'utf8' });
    expect(ps.stdout).not.toMatch(/NODE_OPTIONS=|GNOMON_HOME=/);
    const deadline = Date.now() + 5000;
    while (pidAlive(pf.pid) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50));
    expect(pidAlive(pf.pid)).toBe(false);
    expect(existsSync(pidPathOf(h))).toBe(false);
  });
});
