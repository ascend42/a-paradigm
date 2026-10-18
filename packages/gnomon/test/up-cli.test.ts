// @gnomon-platform: darwin, linux
/**
 * #gnomon-up (spec §2.4 rule 7): `gnomon up` runs the kernel in-process on a
 * PROVISIONED home with the hardware identity. Every guard has a falsifier:
 * a dev-marked home, an unprovisioned home (none, empty, no identity.json),
 * a symlinked home, a kernel already running on the home, an identity that
 * does not open (SE mismatch), a device key without its row. The happy path
 * prints no token and no key material when stdout is not a terminal, and the
 * CLI's own connection verifies the kernel. The FakeHelper (test/helper-fake.ts)
 * stands in for the Secure Enclave; the home is provisioned by the real
 * `gnomon identity init` code. POSIX: owner-only keys/ modes, a shebang
 * "helper" to pin, the unix-socket endpoint.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runIdentityCommand, type IdentityDeps } from '../src/cli/identity-cli.js';
import { resolveUpHome, runUpCommand, startUpKernel, type UpDeps } from '../src/cli/up-cli.js';
import { runDevCommand } from '../src/cli/dev-cli.js';
import { looksLikeKeyMaterial } from '../src/cli/dev-home.js';
import { acceptUnsignedHelperForTests, deviceKeyPath, DEV_TEST_HELPER_ACK, readIdentity, writeNewDeviceKey, type HelperTransport } from '../src/kernel/identity/index.js';
import { startDaemon, type DaemonHandle, type DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** A private user home (short path: the socket must fit sun_path) whose `.gnomon` is the production home. */
function userHome(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gu-')));
  cleanups.push(() => removeTree(d));
  return d;
}

function exe(dir: string): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(f, `#!${process.execPath}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

function io() {
  const o: string[] = [];
  const e: string[] = [];
  return { stdin: new PassThrough(), stdout: { write: (s: string) => (o.push(s), true) }, stderr: { write: (s: string) => (e.push(s), true) }, o, e };
}

/** The CLI closes its helper at the end; the fake SE outlives it (every start is a fresh helper process). */
function view(fake: FakeHelper, onClose: () => void = () => undefined): HelperTransport {
  return {
    request: (r) => fake.request(r),
    get alive() {
      return fake.alive;
    },
    onExit: (cb) => fake.onExit(cb),
    close: async () => onClose(),
  };
}

/** Provision `home` with the real `gnomon identity init` over the FakeHelper. */
async function provision(home: string, fake: FakeHelper, uh: string): Promise<void> {
  const deps: IdentityDeps = { env: {}, verifier: DEV, handleSignals: false, start: () => (fake.revive(), view(fake)), once: () => (req) => fake.handle(req) };
  const x = io();
  const code = await runIdentityCommand(['init', '--home', home, '--helper', exe(uh), '--name', 'matt', '--host', 'mac'], { stdin: x.stdin, stdout: new PassThrough(), stderr: new PassThrough() }, deps);
  expect(code).toBe(0);
}

/** Up deps over the fake; counts helper starts and kernel starts (a refusal must start neither). */
function upDeps(fake: FakeHelper, uh: string, extra: Partial<UpDeps> = {}) {
  const n = { helper: 0, kernel: 0, closed: 0 };
  const deps: UpDeps = {
    userHome: uh,
    verifier: DEV,
    startHelper: () => (n.helper++, fake.revive(), view(fake, () => void n.closed++)),
    start: async (o: DaemonOptions) => (n.kernel++, startDaemon(o)),
    ...extra,
  };
  return { deps, n };
}

async function provisioned(): Promise<{ uh: string; home: string; fake: FakeHelper }> {
  const uh = userHome();
  const home = path.join(uh, '.gnomon');
  const fake = new FakeHelper(null);
  await provision(home, fake, uh);
  return { uh, home, fake };
}

describe('#gnomon-up refusals (each guard falsified)', () => {
  it('FALSIFIER: an unprovisioned home is refused — missing, empty, and with no identity.json; nothing starts', async () => {
    const uh = userHome();
    const fake = new FakeHelper(null);
    const { deps, n } = upDeps(fake, uh);
    const a = io();
    expect(await runUpCommand([], a, deps)).toBe(1); // default ~/.gnomon does not exist
    expect(a.e.join('')).toContain('REFUSED  UP  unprovisioned');
    expect(a.e.join('')).toContain('next: gnomon identity init');
    const empty = path.join(uh, 'empty');
    fs.mkdirSync(empty, { mode: 0o700 });
    const b = io();
    expect(await runUpCommand(['--home', empty], b, deps)).toBe(1);
    expect(b.e.join('')).toContain('unprovisioned');
    expect(b.e.join('')).toContain(`gnomon identity init --home ${empty}`);
    expect(n).toEqual({ helper: 0, kernel: 0, closed: 0 });
    expect(fs.existsSync(path.join(empty, 'gnomon.pid'))).toBe(false);
  });

  it('FALSIFIER: a dev-marked home is refused (the #dev-launch marker); no helper, no kernel', async () => {
    const uh = userHome();
    const devHome = path.join(uh, 'devhome');
    expect(await runDevCommand(['init', '--home', devHome], { ...io() }, { userHome: uh, host: 'mac-1' })).toBe(0);
    const { deps, n } = upDeps(new FakeHelper(null), uh);
    const x = io();
    expect(await runUpCommand(['--home', devHome], x, deps)).toBe(1);
    expect(x.e.join('')).toContain('REFUSED  UP  dev-home');
    expect(n).toEqual({ helper: 0, kernel: 0, closed: 0 });
    expect(fs.existsSync(path.join(devHome, 'gnomon.pid'))).toBe(false);
  });

  it('FALSIFIER: a home where a kernel already runs is detected and refused before the helper opens', async () => {
    const { uh, home, fake } = await provisioned();
    const running = await startDaemon({ home }); // a gnomond stand-in holding the lock and the socket
    cleanups.push(() => running.shutdown('signal'));
    const { deps, n } = upDeps(fake, uh);
    const x = io();
    expect(await runUpCommand(['--home', home], x, deps)).toBe(1);
    const err = x.e.join('');
    expect(err).toContain('REFUSED  UP  daemon-running');
    expect(err).toContain('gnomon open');
    expect(n).toEqual({ helper: 0, kernel: 0, closed: 0 });
  });

  it('FALSIFIER: a symlinked home is refused unsafe-home (the home is a plain directory, resolved once)', async () => {
    const { uh, home, fake } = await provisioned();
    const link = path.join(uh, 'link');
    fs.symlinkSync(home, link);
    const { deps, n } = upDeps(fake, uh);
    const x = io();
    expect(await runUpCommand(['--home', link], x, deps)).toBe(1);
    expect(x.e.join('')).toContain('unsafe-home');
    expect(n).toEqual({ helper: 0, kernel: 0, closed: 0 });
  });

  it('FALSIFIER: an identity that does not open (another Secure Enclave) fails closed; the kernel never starts', async () => {
    const { uh, home } = await provisioned();
    const other = new FakeHelper(readIdentity(home)!.gen); // same generation, other keys
    const { deps, n } = upDeps(other, uh);
    const x = io();
    expect(await runUpCommand(['--home', home], x, deps)).toBe(1);
    expect(x.e.join('')).toContain('REFUSED  UP  identity-mismatch');
    expect(n.kernel).toBe(0);
    expect(n.helper).toBeGreaterThan(0);
    expect(n.closed).toBe(n.helper); // every helper it opened was closed
  });

  it('FALSIFIER: a device key without its root-signed human row is refused; the helper is closed, no kernel', async () => {
    const { uh, home, fake } = await provisioned();
    fs.rmSync(deviceKeyPath(home));
    writeNewDeviceKey(home);
    const { deps, n } = upDeps(fake, uh);
    const x = io();
    expect(await runUpCommand(['--home', home], x, deps)).toBe(1);
    expect(x.e.join('')).toContain('device-unregistered');
    expect(n.kernel).toBe(0);
    expect(n.helper).toBeGreaterThan(0);
    expect(n.closed).toBe(n.helper);
  });

  it('the default home is <userHome>/.gnomon and GNOMON_HOME is never read', () => {
    const uh = userHome();
    fs.mkdirSync(path.join(uh, '.gnomon'), { mode: 0o700 });
    const before = process.env.GNOMON_HOME;
    process.env.GNOMON_HOME = path.join(uh, 'elsewhere');
    try {
      expect(resolveUpHome(undefined, uh)).toEqual({ home: fs.realpathSync.native(path.join(uh, '.gnomon')), isDefault: true });
    } finally {
      if (before === undefined) delete process.env.GNOMON_HOME;
      else process.env.GNOMON_HOME = before;
    }
  });

  it('usage: a relative --home and an unknown argument exit 64', async () => {
    expect(await runUpCommand(['--home', 'rel'], io())).toBe(64);
    expect(await runUpCommand(['--nope'], io())).toBe(64);
  });
});

describe('#gnomon-up runs on the hardware identity', () => {
  it('the CLI connects as the human device with the kernel verified; status reports the hardware root', async () => {
    const { uh, home, fake } = await provisioned();
    const { deps } = upDeps(fake, uh);
    const k = await startUpKernel(fs.realpathSync.native(home), deps);
    cleanups.push(() => k.stop());
    expect(k.client.serverVerified).toBe(true);
    expect(k.client.principal).toBe(readIdentity(home)!.principalId);
    const st = (await k.client.call('status', {})) as { root?: { state?: string; rootKeyId?: string } };
    expect(st.root).toMatchObject({ state: 'hardware', rootKeyId: readIdentity(home)!.rootKeyId });
  });

  it('never prints a launch token or key material when stdout is not a terminal; the helper closes with the kernel', async () => {
    const { uh, home, fake } = await provisioned();
    let h: DaemonHandle | null = null;
    const { deps, n } = upDeps(fake, uh, { start: async (o) => (h = await startDaemon(o)) });
    const x = io();
    const run = runUpCommand(['--home', home], x, deps);
    const deadline = Date.now() + 15_000;
    while (!x.o.join('').includes('gui ') && !x.e.join('').includes('web-launch') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    await h!.shutdown('signal');
    expect(await run).toBe(0);
    const all = x.o.join('') + x.e.join('');
    expect(all).toContain('UP  kernel (in this process)');
    expect(all).toContain('DOWN  kernel');
    expect(all).toMatch(/root\s+hardware /);
    expect(all).not.toMatch(/#launch=/);
    expect(all).not.toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/);
    expect(looksLikeKeyMaterial(all)).toBe(false);
    expect(all).not.toContain('DEV ONLY');
    expect(n.helper).toBeGreaterThan(0);
    expect(n.closed).toBe(n.helper);
  });
});

describe('#gnomon-up: the production CLI passes no seam', () => {
  it('gnomon.ts calls runUpCommand with argv and stdio only; up-cli and launch-tty import no test entry; the default start is startDaemon', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'gnomon.ts'), 'utf8');
    const uses = src.split('\n').filter((l) => /\brunUpCommand\(/.test(l));
    expect(uses).toHaveLength(1);
    expect(uses[0]!.trim()).toBe('runUpCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(');
    for (const f of ['up-cli.ts', 'launch-tty.ts']) {
      const t = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', f), 'utf8');
      expect(t, f).not.toMatch(/testing\.js|startDaemonForTest|internal-seams|seamsOf|acceptUnsignedHelperForTests/);
    }
    expect(fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'up-cli.ts'), 'utf8')).toContain('const start = deps.start ?? startDaemon;');
  });
});
