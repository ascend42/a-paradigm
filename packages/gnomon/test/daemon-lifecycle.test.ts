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
import * as net from 'node:net';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireDaemonLock,
  DAEMON_PIDFILE_SCHEMA,
  daemonState,
  ensureGnomonHome,
  DAEMON_EXIT,
  exitCodeOfRefusal,
  HOLDER_START_TOLERANCE_MS,
  holderIsRecycled,
  parseLstart,
  pidAlive,
  processStartMs,
  pidPathOf,
  pidProbe,
  readPidfile,
  selectSocketPath,
  startDaemon,
  SUN_PATH_SAFE,
  type DaemonHandle,
} from '../src/kernel/lifecycle/index.js';
import { readKernelPubs, recordKernelPub } from '../src/kernel/identity/index.js';
import { gitPath } from '../src/kernel/git/verb-exec.js';
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
  const child = spawn(process.execPath, ['--disable-sigusr1', GNOMOND, '--foreground', '--home', h, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
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

describe('shutdown leaves no writer behind', () => {
  // The start-up push config capture (#git-verbs, Aegis H1) is fire-and-forget: it spawns git several times and
  // writes <home>/git-verbs/{gitconfig.<pid>.<ms>, ssh_config, gitconfig}. Shutdown resolving before it settled let
  // those writes land after the lock was released, racing a successor kernel and the tests' rmSync of the home
  // (ENOTEMPTY in afterEach, or a recreated home leaked in TMPDIR).
  it('the push config capture has settled when shutdown resolves: no temp file, and nothing more is written', async () => {
    const h = home();
    const d = await startDaemon({ home: h, idleMs: 60_000 });
    await d.shutdown('signal'); // at once: the capture is still spawning git
    const dir = path.join(h, 'git-verbs');
    const entries = existsSync(dir) ? readdirSync(dir).sort() : [];
    expect(entries.filter((e) => e.startsWith('gitconfig.'))).toEqual([]); // no half-made snapshot
    if (gitPath()) expect(entries).toContain('gitconfig'); // the capture finished before shutdown resolved
    else expect(entries).toEqual([]);
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
    const second = spawnSync(process.execPath, ['--disable-sigusr1', GNOMOND, '--foreground', '--home', h], { encoding: 'utf8', timeout: 10_000 });
    expect(second.status).toBe(4); // DAEMON_EXIT.superseded (exit-codes.ts)
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

  it('FALSIFIER (Aegis L2): a pidfile naming another user\'s live pid (pid 1) is residue, reclaimed, never already-running', async () => {
    if (process.getuid?.() === 0) return; // root may signal pid 1: no EPERM to test
    expect(pidProbe(1)).toBe('foreign');
    const h = home();
    ensureGnomonHome(h);
    writeFileSync(pidPathOf(h), JSON.stringify({ schemaVersion: DAEMON_PIDFILE_SCHEMA, pid: 1, startedAt: 'x', socketPath: '/attacker.sock' }));
    expect(daemonState(h).state).toBe('stale'); // was 'running' (EPERM counted as alive)
    await daemon(h);
    expect(readPidfile(h)!.pid).toBe(process.pid);
  });

  it('FALSIFIER (Aegis L2): a same-user live pid whose socket stays silent is holder-silent (transient), not already-running (superseded, never restarted)', async () => {
    const h = home();
    ensureGnomonHome(h);
    const squatter = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    cleanups.push(() => void squatter.kill('SIGKILL'));
    const row = JSON.stringify({ schemaVersion: DAEMON_PIDFILE_SCHEMA, pid: squatter.pid, startedAt: 'x', socketPath: '/attacker.sock' });
    writeFileSync(pidPathOf(h), row);
    const probed: string[] = [];
    const err = await startDaemon({ home: h, holderGraceMs: 150, probeHolder: async (p) => (probed.push(p), false) }).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'holder-silent' });
    expect(exitCodeOfRefusal('holder-silent')).toBe(DAEMON_EXIT.transient);
    expect(probed.length).toBeGreaterThan(0);
    const ours = selectSocketPath({ home: h });
    expect(ours.ok && probed.every((p) => p === ours.path)).toBe(true); // our socket path, never the pidfile's
    expect(readFileSync(pidPathOf(h), 'utf8')).toBe(row); // not stolen: a silent holder may be a racer mid-start
    // positive control: the same holder with a kernel answering is already-running
    await expect(startDaemon({ home: h, holderGraceMs: 150, probeHolder: async () => true })).rejects.toMatchObject({ reason: 'already-running' });
  });

  describe('T-2026-10-19-017: a recycled same-user pid after a crash or reboot', () => {
    function squat(h: string, startedAt: string): { pid: number; row: string } {
      ensureGnomonHome(h);
      const squatter = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      cleanups.push(() => void squatter.kill('SIGKILL'));
      const row = JSON.stringify({ schemaVersion: DAEMON_PIDFILE_SCHEMA, pid: squatter.pid, startedAt, socketPath: '/attacker.sock' });
      writeFileSync(pidPathOf(h), row);
      return { pid: squatter.pid!, row };
    }

    it('FALSIFIER: a live silent holder that started after the pidfile was written is reclaimed (real ps witness)', async () => {
      const h = home();
      const { pid } = squat(h, new Date(Date.now() - 3_600_000).toISOString()); // written an hour before this process existed
      const events: Array<{ kind: string }> = [];
      const d = await startDaemon({ home: h, idleMs: 60_000, holderGraceMs: 150, probeHolder: async () => false, onEvent: (e) => events.push(e) });
      cleanups.push(() => d.shutdown('signal'));
      expect(readPidfile(h)!.pid).toBe(process.pid);
      expect(events).toContainEqual(expect.objectContaining({ kind: 'daemon.lock.reclaimed', holderPid: pid }));
      expect(pidAlive(pid)).toBe(true); // reclaimed the lock, never signalled the recycled process
    });

    it('a silent holder whose start time matches the pidfile stays holder-silent (a racer between lock and listen)', async () => {
      const h = home();
      const { row } = squat(h, new Date(Date.now() + 1_000).toISOString()); // written just after the holder started
      const err = await startDaemon({ home: h, holderGraceMs: 150, probeHolder: async () => false }).catch((e: unknown) => e);
      expect(err).toMatchObject({ reason: 'holder-silent' });
      expect(readFileSync(pidPathOf(h), 'utf8')).toBe(row);
    });

    it('witness unavailable (ps fails / unparseable) stays holder-silent, never reclaimed', async () => {
      const h = home();
      const { row } = squat(h, new Date(Date.now() - 3_600_000).toISOString());
      const err = await startDaemon({ home: h, holderGraceMs: 150, probeHolder: async () => false, holderStartMs: () => null }).catch((e: unknown) => e);
      expect(err).toMatchObject({ reason: 'holder-silent' });
      expect(readFileSync(pidPathOf(h), 'utf8')).toBe(row);
    });

    it('holderIsRecycled / parseLstart edges', () => {
      const t = Date.parse('2026-10-19T12:00:00.000Z');
      expect(holderIsRecycled('2026-10-19T12:00:00.000Z', t + HOLDER_START_TOLERANCE_MS + 1)).toBe(true);
      expect(holderIsRecycled('2026-10-19T12:00:00.000Z', t + HOLDER_START_TOLERANCE_MS)).toBe(false);
      expect(holderIsRecycled('2026-10-19T12:00:00.000Z', t - 60_000)).toBe(false);
      expect(holderIsRecycled('x', t + 3_600_000)).toBe(false);
      expect(holderIsRecycled('2026-10-19T12:00:00.000Z', null)).toBe(false);
      expect(parseLstart('lstart:Mon Oct 19 12:34:56 2026')).toBe(Date.parse('2026-10-19T12:34:56Z'));
      expect(parseLstart('Mon Oct  5 01:02:03 2026')).toBe(Date.parse('2026-10-05T01:02:03Z'));
      expect(parseLstart('garbage')).toBeNull();
      const own = processStartMs(process.pid);
      expect(own).not.toBeNull();
      expect(own!).toBeLessThanOrEqual(Date.now());
    });
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
  it('status reports running, stop from a home with no human device is refused (daemon.stop is a verified-human-device verb; test/daemon-stop-verb.test.ts drives the card) and the kernel keeps running, status and stop after exit report not running', async () => {
    const h = home();
    const { child, ready } = await startChild(h);
    const status = spawnSync(process.execPath, [GNOMON, 'daemon', 'status', '--home', h], { encoding: 'utf8' });
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      running: true,
      socketPath: ready.socketPath,
      clientApi: 'gnomon-rpc:v1',
      // T-2026-10-19-016(a): pinned against the key this home's daemon recorded
      serverVerified: true,
      pinSource: 'home-kernel-pub',
      // T-2026-10-21-028: a build without a release manifest starts and says it is a dev build
      build: 'dev',
      authenticated: false,
      diagnosticPid: ready.pid,
    });
    const stop = spawnSync(process.execPath, [GNOMON, 'daemon', 'stop', '--home', h], { encoding: 'utf8' });
    expect(stop.status).toBe(1);
    expect(stop.stderr).toContain('REFUSED  FORBIDDEN  no-human-device');
    const still = spawnSync(process.execPath, [GNOMON, 'daemon', 'status', '--home', h], { encoding: 'utf8' });
    expect(JSON.parse(still.stdout)).toMatchObject({ running: true });
    child.kill('SIGTERM');
    await exitOf(child);
    const after = spawnSync(process.execPath, [GNOMON, 'daemon', 'status', '--home', h], { encoding: 'utf8' });
    expect(after.status).toBe(3);
    expect(JSON.parse(after.stdout)).toEqual({ running: false, state: 'stopped' });
    // T-2026-10-19-014 B0: with no kernel answering, stop is REFUSED ENGINE not-running (exit 1, like gnomon rules)
    const none = spawnSync(process.execPath, [GNOMON, 'daemon', 'stop', '--home', h], { encoding: 'utf8' });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('REFUSED  ENGINE  not-running');
  });

  it('T-2026-10-19-016(a): a squatter whose key the home does not know is never reported running:true; a known key with a bad sig is refused', async () => {
    // the "squatter": a proxy on h1's endpoint that relays to a real kernel of an UNRELATED home h2
    const h1 = home();
    const h2 = home();
    const real = await daemon(h2);
    ensureGnomonHome(h1);
    const sel = selectSocketPath({ home: h1 });
    if (!sel.ok) throw new Error(sel.reason);
    const proxy = net.createServer((c) => {
      c.on('error', () => undefined);
      const up = net.connect(real.pidfile.socketPath!);
      up.on('error', () => c.destroy());
      c.pipe(up);
      up.pipe(c);
    });
    proxy.on('error', () => undefined);
    await new Promise<void>((r) => proxy.listen(sel.path, () => r()));
    cleanups.push(() => new Promise<void>((r) => proxy.close(() => r())));
    const run = (): Promise<{ code: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, [GNOMON, 'daemon', 'status', '--home', h1], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        c.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
        c.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
        c.on('close', (code) => resolve({ code, stdout, stderr }));
      });
    const r1 = await run();
    expect(r1.code, r1.stderr).toBe(0);
    const out = JSON.parse(r1.stdout) as Record<string, unknown>;
    expect(out.running).not.toBe(true);
    expect(out).toMatchObject({ running: null, answering: true, serverVerified: false, unverified: { clientApi: 'gnomon-rpc:v1' } });
    expect(out).not.toHaveProperty('serverKeyId');
    // now h1 "knows" h2's key, but the relayed serverSig is bound to h2's endpoint: refused, not running
    recordKernelPub(h1, readKernelPubs(h2)[0]!.publicKeyPem);
    const r2 = await run();
    expect(r2.code).toBe(1);
    expect(r2.stdout).toBe('');
    expect(JSON.parse(r2.stderr)).toMatchObject({ refused: true });
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
    expect(ps.stdout).toContain('--disable-sigusr1'); // the re-exec passes the one flag the foreground daemon requires
    const deadline = Date.now() + 5000;
    while (pidAlive(pf.pid) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50));
    expect(pidAlive(pf.pid)).toBe(false);
    expect(existsSync(pidPathOf(h))).toBe(false);
  });
});

/** True when something accepts a TCP connection on 127.0.0.1:<port>. */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
}

describe('T-2026-10-18-030 (1): SIGUSR1 cannot open the V8 inspector in the kernel', () => {
  it('FALSIFIER: gnomond --foreground refuses to start without --disable-sigusr1 (no pidfile, no socket)', () => {
    const h = home();
    const r = spawnSync(process.execPath, [GNOMOND, '--foreground', '--home', h], { encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(78); // DAEMON_EXIT.config: never restarted in a loop
    expect(r.stderr).toContain('[sigusr1-enabled]');
    expect(existsSync(pidPathOf(h))).toBe(false);
  });

  it('FALSIFIER: a running kernel that receives SIGUSR1 opens no inspector port and keeps running', async () => {
    // control: the same signal against a node WITHOUT the flag does open an inspector (the detector works);
    // --inspect-port=0 so the control binds an ephemeral port, never 9229
    const control = spawn(process.execPath, ['--inspect-port=0', '-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'ignore', 'pipe'] });
    cleanups.push(() => void control.kill('SIGKILL'));
    let cerr = '';
    control.stderr!.on('data', (c: Buffer) => (cerr += c.toString('utf8')));
    await new Promise((r) => setTimeout(r, 300));
    control.kill('SIGUSR1');
    const cdl = Date.now() + 5000;
    while (!cerr.includes('Debugger listening') && Date.now() < cdl) await new Promise((r) => setTimeout(r, 25));
    expect(cerr).toContain('Debugger listening');

    const h = home();
    const was9229 = await portOpen(9229);
    const { child } = await startChild(h);
    let err = '';
    child.stderr!.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.kill('SIGUSR1');
    await new Promise((r) => setTimeout(r, 750));
    expect(err).not.toContain('Debugger listening');
    expect(child.exitCode).toBeNull(); // ignored, not a crash
    expect(child.signalCode).toBeNull();
    if (!was9229) expect(await portOpen(9229)).toBe(false);
    child.kill('SIGTERM');
    expect(await exitOf(child)).toBe(0);
  });
});
