// @gnomon-platform: darwin, linux
/**
 * #gnomon-wrapper launch contract (spec §11.1, §11.2 rule 2; M1.13, G-GUI-12
 * oracle "the token appears on any argv"): `gnomon up --wrapper` and
 * `gnomon dev up --wrapper` hand the launch grant to the parent (Gnomon.app)
 * ONLY on the stdout pipe it holds, as `gnomon-wrapper-channel:v1` lines.
 *
 * Falsifiers:
 *   - in-process: the grant is on the channel; stderr (the app's log) never
 *     carries the token; `quit` and EOF stop the kernel; a refusal (an
 *     unprovisioned home) arrives on the channel with the `gnomon identity
 *     init` step the app shows;
 *   - a stdout that is a regular file or stdin that is a terminal is refused
 *     `wrapper-channel` before any kernel starts, and the file holds no token;
 *   - real process, P07 style: the CLI is spawned with a clean env exactly as
 *     the app spawns it; while the token is live a `ps` sampler reads every
 *     process's argv AND env (`ps -E` on macOS, `ps e` on Linux) and never sees
 *     it. Positive control first: a process holding a control token on argv
 *     and another in env MUST be seen, or the run proves nothing.
 * POSIX only: fd kinds, `ps`, the unix-socket kernel (G-WIN-05 row).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { channelKind, WRAPPER_UNSAFE_ENV_NEXT, wrapperChannelProblem } from '../src/cli/launch-tty.js';
import { runDevCommand } from '../src/cli/dev-cli.js';
import { runUpCommand } from '../src/cli/up-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const CLEAN = { env: {}, execArgv: ['--disable-sigusr1'] as string[] };
const TOKEN_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function world(): { userHome: string; devHome: string } {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gw-'))); // never world-writable /tmp
  cleanups.push(() => removeTree(d));
  return { userHome: d, devHome: path.join(d, 'devhome') };
}
const quiet = () => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });

/** An in-memory channel: stdin the test writes, stdout lines parsed as they come. */
function channel() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const err: string[] = [];
  let buf = '';
  const stdin = new PassThrough();
  return {
    stdin,
    stdout: {
      write: (s: string) => {
        raw.push(s);
        buf += s;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
          buf = buf.slice(i + 1);
        }
        return true;
      },
    },
    stderr: { write: (s: string) => (err.push(s), true) },
    lines,
    raw,
    err,
    async next(t: string, ms = 15_000): Promise<Record<string, unknown>> {
      const end = Date.now() + ms;
      for (;;) {
        const hit = lines.find((l) => l.t === t);
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`no ${t} line; got ${JSON.stringify(lines.map((l) => l.t))} / ${err.join('')}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}

describe('#gnomon-wrapper channel (in-process)', () => {
  it('the grant is on the channel only: up → launch → quit → down; stderr never carries the token', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], quiet(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const c = channel();
    const run = runDevCommand(['up', '--home', w.devHome, '--wrapper'], c, { userHome: w.userHome, runtime: CLEAN });
    await c.next('up');
    c.stdin.write('launch\n');
    const g = await c.next('launch');
    expect(Object.keys(g).sort()).toEqual(['bundleHash', 'expiresAt', 'kernelPublicKey', 'launchToken', 'port', 't', 'v']);
    expect(g.launchToken).toMatch(TOKEN_RE);
    expect(g.bundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(c.err.join('')).not.toContain(g.launchToken as string);
    expect(c.err.join('')).not.toMatch(/#launch=/);
    expect(c.err.join('')).toContain('DEV ONLY'); // the banner goes to stderr: stdout is the channel
    c.stdin.write('launch\n');
    const end = Date.now() + 10_000;
    while (c.lines.filter((l) => l.t === 'launch').length < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const two = c.lines.filter((l) => l.t === 'launch');
    expect(two).toHaveLength(2);
    expect(two[1]!.launchToken).not.toBe(two[0]!.launchToken); // a fresh single-use token per request
    c.stdin.write('quit\n');
    expect(await run).toBe(0);
    expect((await c.next('down')).reason).toBe('signal');
  });

  it('EOF on stdin (the app went away) stops the kernel', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], quiet(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const c = channel();
    const run = runDevCommand(['up', '--home', w.devHome, '--wrapper'], c, { userHome: w.userHome, runtime: CLEAN });
    await c.next('up');
    c.stdin.end();
    expect(await run).toBe(0);
    await c.next('down');
  });

  it('a refusal reaches the app on the channel: an unprovisioned home names `gnomon identity init`', async () => {
    const w = world();
    const c = channel();
    expect(await runUpCommand(['--wrapper'], c, { userHome: w.userHome, runtime: CLEAN })).toBe(1);
    const r = await c.next('refused');
    expect(r).toMatchObject({ code: 'up', reason: 'unprovisioned' });
    expect((r.next as string[]).join(' ')).toContain('gnomon identity init');
  });

  it('FALSIFIER: an unsafe runtime is refused on the channel too (the app shows why it did not start)', async () => {
    const w = world();
    const c = channel();
    expect(await runUpCommand(['--wrapper'], c, { userHome: w.userHome, runtime: { env: { NODE_OPTIONS: '--require x' }, execArgv: ['--disable-sigusr1'] } })).toBe(1);
    const r = await c.next('refused');
    expect(r).toMatchObject({ reason: 'unsafe-env', next: [WRAPPER_UNSAFE_ENV_NEXT] }); // the fix is the app's, not a command line
  });
});

describe('#gnomon-wrapper channel kinds', () => {
  it('a regular file and a terminal are not a channel; a pipe or socketpair (libuv stdio) is', () => {
    const d = world().userHome;
    const fd = fs.openSync(path.join(d, 'out'), 'w', 0o600);
    cleanups.push(() => fs.closeSync(fd));
    expect(channelKind({ fd })).toBe('file');
    expect(channelKind({ isTTY: true })).toBe('tty');
    expect(channelKind({})).toBe('in-memory');
    const p = spawnSync(process.execPath, ['-e', `const fs=require('fs');const s=fs.fstatSync(1);process.stdout.write(s.isFIFO()||s.isSocket()?'pipe':'no')`], { encoding: 'utf8' });
    expect(p.stdout).toBe('pipe');
    expect(wrapperChannelProblem({ stdin: new PassThrough(), stdout: { write: () => true, fd } as never, stderr: { write: () => true } })).toMatch(/stdout is a file/);
    expect(wrapperChannelProblem({ stdin: Object.assign(new PassThrough(), { isTTY: true }), stdout: { write: () => true }, stderr: { write: () => true } })).toMatch(/stdin is a tty/);
  });
});

/* ── real process (P07 style) ─────────────────────────────────────────── */

const CLI = path.join(PKG_ROOT, 'dist', 'cli', 'gnomon.js');
/** The env the app gives its kernel child (gnomon-wrapper src/kernel.rs child_env): an allowlist, no NODE_OPTIONS. */
const APP_ENV = (home: string): Record<string, string> => ({ HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' });
/** The node flags the app passes (gnomon-wrapper src/kernel.rs NODE_FLAGS): `--disable-sigusr1`, first and only. */
const APP_NODE_FLAGS = ['--disable-sigusr1'];

/** Every process's argv + env, as one string (ps -E on macOS, ps e on Linux; own-user processes show env). */
function psAll(): string {
  const args = process.platform === 'darwin' ? ['-axww', '-E', '-o', 'pid=,command='] : ['axwwe', '-o', 'pid=,args='];
  const r = spawnSync('/bin/ps', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  return r.stdout ?? '';
}

function readLines(child: ChildProcess): { lines: Record<string, unknown>[]; next(t: string, ms?: number): Promise<Record<string, unknown>> } {
  const lines: Record<string, unknown>[] = [];
  let buf = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (s: string) => {
    buf += s;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
      buf = buf.slice(i + 1);
    }
  });
  return {
    lines,
    async next(t, ms = 20_000) {
      const end = Date.now() + ms;
      for (;;) {
        const hit = lines.find((l) => l.t === t);
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`no ${t} line (got ${JSON.stringify(lines.map((l) => l.t))})`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
}

describe('#gnomon-wrapper channel (real process, no token on any argv or env)', () => {
  it('FALSIFIER (G-GUI-12): spawned as the app spawns it, the live token is on no process argv or env; the control is seen', async () => {
    expect(fs.existsSync(CLI), 'dist/cli/gnomon.js (run npm run build:gnomon)').toBe(true);
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], quiet(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);

    // positive control: the sampler must see a token on argv and one in env
    const ctlArgv = randomBytes(32).toString('base64url');
    const ctlEnv = randomBytes(32).toString('base64url');
    const ctl = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)', ctlArgv], { env: { ...APP_ENV(w.userHome), GNOMON_CTL: ctlEnv }, stdio: 'ignore' });
    cleanups.push(() => ctl.kill('SIGKILL'));
    await new Promise((r) => setTimeout(r, 300));
    const seen = psAll();
    expect(seen, 'control on argv').toContain(ctlArgv);
    if (process.platform === 'darwin' || process.platform === 'linux') expect(seen, 'control in env').toContain(ctlEnv);

    const child = spawn(process.execPath, [...APP_NODE_FLAGS, CLI, 'dev', 'up', '--home', w.devHome, '--wrapper'], { env: APP_ENV(w.userHome), stdio: ['pipe', 'pipe', 'pipe'] });
    cleanups.push(() => child.kill('SIGKILL'));
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (s: string) => (err += s));
    const ch = readLines(child);
    await ch.next('up');
    child.stdin!.write('launch\n');
    const g = await ch.next('launch');
    const token = g.launchToken as string;
    expect(token).toMatch(TOKEN_RE);
    // sample while the token is live (60 s TTL): argv + env of every process, including the kernel's own children
    for (let i = 0; i < 10; i++) {
      expect(psAll().includes(token), `sample ${i}`).toBe(false);
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(err).not.toContain(token);
    child.stdin!.write('quit\n');
    const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    expect(code).toBe(0);
  }, 60_000);

  it('FALSIFIER (T-2026-10-18-030): spawned WITHOUT --disable-sigusr1 the child refuses unsafe-env on the channel, naming the app rebuild', async () => {
    expect(fs.existsSync(CLI)).toBe(true);
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], quiet(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const r = spawnSync(process.execPath, [CLI, 'dev', 'up', '--home', w.devHome, '--wrapper'], { env: APP_ENV(w.userHome), stdio: ['pipe', 'pipe', 'pipe'], input: '', encoding: 'utf8', timeout: 20_000 });
    expect(r.status).toBe(1);
    const lines = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([{ v: 1, t: 'refused', code: 'dev', reason: 'unsafe-env', message: expect.stringContaining('--disable-sigusr1'), next: [WRAPPER_UNSAFE_ENV_NEXT] }]);
  }, 30_000);

  it('FALSIFIER: stdout redirected to a file is refused wrapper-channel; no kernel starts and the file holds no token', async () => {
    expect(fs.existsSync(CLI)).toBe(true);
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], quiet(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const file = path.join(w.userHome, 'leak.txt');
    const fd = fs.openSync(file, 'w', 0o600);
    const r = spawnSync(process.execPath, [...APP_NODE_FLAGS, CLI, 'dev', 'up', '--home', w.devHome, '--wrapper'], { env: APP_ENV(w.userHome), stdio: ['pipe', fd, 'pipe'], input: 'launch\n', encoding: 'utf8', timeout: 20_000 });
    fs.closeSync(fd);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('wrapper-channel');
    const out = fs.readFileSync(file, 'utf8');
    expect(out).not.toMatch(TOKEN_RE);
    expect(out).not.toContain('launchToken');
    expect(fs.existsSync(path.join(w.devHome, 'gnomond.pid'))).toBe(false);
  }, 30_000);
});
