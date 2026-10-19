// @gnomon-platform: darwin, linux
/**
 * #bare-entry (spec §2.4 rule 8): bare `gnomon` in a folder is `gnomon up`
 * plus a folder hint in the launch URL fragment. Falsified here: the kernel
 * starts with the hint; the hint is the URL's fragment and the token goes
 * nowhere new (argv, env, any other output line); a hostile folder is shown
 * escaped and capped, never interpreted; an unprovisioned home surfaces the
 * `gnomon identity init` refusal; a running kernel is not joined and no second
 * one starts (`already-running`, exit 3); help lists every verb. The GUI side
 * (prefill shown as text, never submitted) is in packages/gnomon-gui/test.
 * POSIX: the home is provisioned with owner-only keys/ and a shebang helper
 * (like test/up-cli.test.ts); the launch test is darwin-only (linux has no
 * `transport` sandbox profile, so web-launch is refused there).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { BARE_EXIT_ALREADY_RUNNING, displayPath, DISPLAY_CAP, folderOf, GNOMON_HELP, HINT_MAX_BYTES, hintSuffix, needsEscape, runBareCommand, type BareDeps } from '../src/cli/bare-cli.js';
import { runIdentityCommand, type IdentityDeps } from '../src/cli/identity-cli.js';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, type HelperTransport } from '../src/kernel/identity/index.js';
import { startDaemon, type DaemonHandle, type DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';
import { privateTmpRoot } from './daemon-helpers.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const CLEAN = { env: {}, execArgv: ['--disable-sigusr1'] as string[] };
const NO_TRANSPORT = process.platform !== 'darwin';
const NL = String.fromCodePoint(0x0a);
const ESC = String.fromCodePoint(0x1b);
const RLO = String.fromCodePoint(0x202e);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tmpDir(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), prefix)));
  cleanups.push(() => removeTree(d));
  return d;
}
function exe(dir: string): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(f, `#!${process.execPath}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}
function io(tty = false) {
  const o: string[] = [];
  const e: string[] = [];
  return { stdin: new PassThrough(), stdout: { write: (s: string) => (o.push(s), true), ...(tty ? { isTTY: true } : {}) }, stderr: { write: (s: string) => (e.push(s), true) }, o, e };
}
function view(fake: FakeHelper, onClose: () => void = () => undefined): HelperTransport {
  return { request: (r) => fake.request(r), get alive() { return fake.alive; }, onExit: (cb) => fake.onExit(cb), close: async () => onClose() };
}
async function provisioned(): Promise<{ uh: string; home: string; fake: FakeHelper }> {
  const uh = tmpDir('gb-');
  const home = path.join(uh, '.gnomon');
  const fake = new FakeHelper(null);
  const deps: IdentityDeps = { env: {}, verifier: DEV, handleSignals: false, start: () => (fake.revive(), view(fake)), once: () => (req) => fake.handle(req) };
  const code = await runIdentityCommand(['init', '--home', home, '--helper', exe(uh), '--name', 'matt', '--host', 'mac'], { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }, deps);
  expect(code).toBe(0);
  return { uh, home, fake };
}
function bareDeps(fake: FakeHelper, uh: string, cwd: string, extra: Partial<BareDeps> = {}) {
  const n = { helper: 0, kernel: 0 };
  const deps: BareDeps = { userHome: uh, cwd, runtime: CLEAN, verifier: DEV, startHelper: () => (n.helper++, fake.revive(), view(fake)), start: async (o: DaemonOptions) => (n.kernel++, startDaemon(o)), ...extra };
  return { deps, n };
}
async function until(p: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!p() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

describe('#bare-entry: the folder hint (pure)', () => {
  it('the folder is the nearest ancestor holding .git, else the cwd itself (said so)', () => {
    const d = tmpDir('gf-');
    fs.mkdirSync(path.join(d, 'repo', '.git'), { recursive: true });
    fs.mkdirSync(path.join(d, 'repo', 'src', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(d, 'plain'));
    expect(folderOf(path.join(d, 'repo', 'src', 'deep'))).toEqual({ folder: path.join(d, 'repo'), inGit: true });
    const plain = folderOf(path.join(d, 'plain'));
    if (!plain.inGit) expect(plain.folder).toBe(path.join(d, 'plain')); // the tmp root itself may sit inside a checkout on a CI runner
  });
  it('the hint is base64url UTF-8 in a fragment parameter; over HINT_MAX_BYTES it is not carried', () => {
    const s = hintSuffix(path.join('/Users', 'matt', 'repo'))!;
    expect(s).toMatch(/^&cwd=[A-Za-z0-9_-]+$/);
    expect(Buffer.from(s.slice(5), 'base64url').toString('utf8')).toBe(path.join('/Users', 'matt', 'repo'));
    expect(hintSuffix(`/${'a'.repeat(HINT_MAX_BYTES)}`)).toBeNull();
    expect(hintSuffix('')).toBeNull();
  });
  it('FALSIFIER: hostile paths are escaped and capped for display, never passed through raw', () => {
    const hostile = [`/r/a${NL}b`, `/r/${ESC}[2J`, `/r/${RLO}txt.sh`, '/r/"q\'uote', '/r/back\\slash', `/r/bad${String.fromCodePoint(0xfffd)}utf8`];
    for (const p of hostile) {
      const d = displayPath(p);
      expect(d).not.toContain(NL);
      expect(d).not.toContain(ESC);
      expect(d).not.toContain(RLO);
    }
    expect(displayPath(`/r/a${NL}b`)).toBe('/r/a\\u{a}b');
    expect(displayPath('/r/back\\slash')).toBe('/r/back\\\\slash');
    expect(displayPath('/r/"q\'uote')).toBe('/r/"q\'uote'); // quotes are text: shown as they are, nothing is shell-quoted or evaluated
    expect(needsEscape('/r/"q\'uote')).toBe(false);
    expect(needsEscape(`/r/a${NL}b`)).toBe(true);
    const long = displayPath(`/${'x'.repeat(5000)}`);
    expect([...long].length).toBeLessThan(DISPLAY_CAP + 20);
    expect(long).toContain('(+4761 chars)');
  });
});

describe('#bare-entry: help and dispatch', () => {
  it('help lists every verb with one line each, and the first-run steps', () => {
    for (const v of ['up', 'dev', 'identity', 'session', 'rules', 'mod', 'replay', 'trace', 'log', 'daemon', 'help']) expect(GNOMON_HELP).toMatch(new RegExp(`^  ${v} +\\S`, 'm'));
    expect(GNOMON_HELP).toContain('gnomon identity init');
    expect(GNOMON_HELP.split('\n').length).toBeLessThan(25);
  });
  it('gnomon.ts runs bare entry for no argv (no seam), help for help/--help/-h, and refuses an unknown verb without echoing it', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'gnomon.ts'), 'utf8');
    expect(src).toContain("} else if (argv.length === 0 || argv[0] === '--no-open') {"); // spec §2.4 rule 10: bare `gnomon --no-open`
    expect(src).toContain('runBareCommand(argv, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(');
    expect(src).toContain("argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h'");
    expect(src).toContain('gnomon: unknown command (${argv[0]!.length} chars)');
    expect(fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'bare-cli.ts'), 'utf8')).not.toMatch(/testing\.js|startDaemonForTest|internal-seams|acceptUnsignedHelperForTests/);
  });
  it('extra argv on the bare path is a usage error (64), nothing starts', async () => {
    const x = io();
    expect(await runBareCommand(['--home'], x, { runtime: CLEAN, start: () => Promise.reject(new Error('must not start')) })).toBe(64);
  });
});

describe('#bare-entry: refusals', () => {
  it('an unprovisioned home off a terminal surfaces the existing refusal with `next: gnomon setup` (#first-run); nothing starts', async () => {
    const uh = tmpDir('gu-');
    const x = io();
    expect(await runBareCommand([], x, { userHome: uh, cwd: uh, runtime: CLEAN, start: () => Promise.reject(new Error('must not start')) })).toBe(1);
    const err = x.e.join('');
    expect(err).toContain('REFUSED  GNOMON  unprovisioned');
    expect(err).toContain('next: gnomon setup');
  });
  it('the unsafe-env guard still runs first (NODE_OPTIONS)', async () => {
    const uh = tmpDir('gu-');
    const x = io();
    expect(await runBareCommand([], x, { userHome: uh, cwd: uh, runtime: { env: { NODE_OPTIONS: '--require x' }, execArgv: ['--disable-sigusr1'] } })).toBe(1);
    expect(x.e.join('')).toContain('REFUSED  GNOMON  unsafe-env');
  });
  it('FALSIFIER: a kernel already running is not joined and no second one starts: already-running, exit 3, how to open this folder', async () => {
    const { uh, home, fake } = await provisioned();
    const running = await startDaemon({ home }); // a Gnomon.app / gnomond stand-in holding the lock and the socket
    cleanups.push(() => running.shutdown('signal'));
    const repo = tmpDir('gr-');
    fs.mkdirSync(path.join(repo, '.git'));
    const { deps, n } = bareDeps(fake, uh, repo);
    const x = io();
    expect(await runBareCommand([], x, deps)).toBe(BARE_EXIT_ALREADY_RUNNING);
    const err = x.e.join('');
    expect(err).toContain('REFUSED  GNOMON  already-running');
    expect(err).toContain(`(pid ${process.pid}, diagnostic only)`);
    expect(err).toContain(`cwd: ${repo}`);
    expect(err).toContain('gnomon open');
    expect(n).toEqual({ helper: 0, kernel: 0 });
    expect(x.o.join('')).toBe('');
  });
});

describe('#bare-entry: the kernel starts with the hint', () => {
  it('without a terminal: the folder row is shown (escaped), no URL, no token; a hostile folder is never interpreted', async () => {
    const { uh, fake } = await provisioned();
    const hostile = path.join(tmpDir('gh-'), `we"ird${NL}name ${ESC}[31m`);
    fs.mkdirSync(hostile);
    let h: DaemonHandle | null = null;
    const { deps } = bareDeps(fake, uh, hostile, { start: async (o) => (h = await startDaemon(o)) });
    const x = io();
    const run = runBareCommand([], x, deps);
    await until(() => x.o.join('').includes('gui '));
    await h!.shutdown('signal');
    expect(await run).toBe(0);
    const out = x.o.join('');
    const row = out.split('\n').find((l) => l.trimStart().startsWith('folder'))!;
    expect(row).toContain('we"ird\\u{a}name \\u{1b}[31m');
    expect(row).toContain('the GUI will not prefill it');
    expect(out).not.toContain(ESC);
    expect(out).not.toMatch(/#launch=|&cwd=/);
  });

  it.skipIf(NO_TRANSPORT)('FALSIFIER (G-GUI-12, P07): on a terminal the hint rides the launch URL fragment; the token is in that one line only, never argv or env', async () => {
    const { uh, fake } = await provisioned();
    const repo = tmpDir('gl-');
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, 'pkg'));
    let h: DaemonHandle | null = null;
    let starts = 0;
    const { deps } = bareDeps(fake, uh, path.join(repo, 'pkg'), { start: async (o) => (starts++, (h = await startDaemon(o))) });
    const x = io(true);
    const run = runBareCommand([], x, deps);
    await until(() => x.o.join('').includes('#launch=') || x.e.join('').includes('web-launch'), 30_000);
    const out = x.o.join('');
    const line = out.split('\n').find((l) => l.includes('#launch='));
    expect(line, x.e.join('')).toBeDefined();
    const m = /^  http:\/\/127\.0\.0\.1:\d+\/#launch=([A-Za-z0-9_-]+)&k=[A-Za-z0-9_-]+&cwd=([A-Za-z0-9_-]+)$/.exec(line!);
    expect(m).not.toBeNull();
    const [, token, cwd] = m!;
    expect(Buffer.from(cwd!, 'base64url').toString('utf8')).toBe(repo); // the git top, not the subdirectory
    const all = out + x.e.join('');
    expect(all.split(token!).length - 1).toBe(1);
    expect(process.argv.join('\n')).not.toContain(token!);
    expect(Object.values(process.env).join('\n')).not.toContain(token!);
    expect(out).toMatch(/folder\s+\S.*git top/);
    expect(starts).toBe(1);
    await h!.shutdown('signal');
    expect(await run).toBe(0);
  }, 60_000);
});

describe('#bare-entry: the shared prefill/escape vectors (Aegis L3)', () => {
  it('the CLI rule matches test/fixtures/cwd-hint.v1.json exactly (the GUI reads the same file)', () => {
    const vectors = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'cwd-hint.v1.json'), 'utf8')) as { cases: Array<{ name: string; cps: number[]; prefill: boolean; escaped: string[] }> };
    expect(vectors.cases.map((c) => c.name)).toEqual(expect.arrayContaining(['cgj-034f', 'hangul-choseong-filler-115f', 'hangul-filler-3164', 'vs16-fe0f', 'interlinear-fff9', 'tag-e0001']));
    for (const v of vectors.cases) {
      const p = String.fromCodePoint(...v.cps);
      expect(!needsEscape(p), v.name).toBe(v.prefill);
      if (v.prefill) expect(Buffer.from(hintSuffix(p)!.slice(5), 'base64url').equals(Buffer.from(p, 'utf8')), v.name).toBe(true); // the hint carries the original bytes
      for (const e of v.escaped) expect(displayPath(p), v.name).toContain(e);
    }
  });
  it('nits: the instance probe runs /bin/ps (not a PATH lookup) and reads `pid N` from the refusal', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'bare-cli.ts'), 'utf8');
    expect(src).toContain("execFileSync('/bin/ps',");
    expect(src).toContain('/\\bpid (\\d+)/');
  });
});
