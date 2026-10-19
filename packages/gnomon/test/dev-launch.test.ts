// @gnomon-platform: darwin, linux
/**
 * #dev-launch (spec §2.4 rule 6): `gnomon dev init` provisions a DEV home and
 * every guard has a falsifier — the production home, a home holding another
 * root's registry, a non-empty unmarked home, a tampered registry; the dev
 * files never make the production daemon trust the dev root; no command
 * output carries key material.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, registerDevice, registryPath } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { GnomonClient } from '../src/clients/ts/index.js';
import { DEV_HOME_MARKER, DEV_ROOT_KEY_FILE, DevHomeRefusal, loadDevHome, looksLikeKeyMaterial } from '../src/cli/dev-home.js';
import { runDevCommand, startDevKernel, type DevCliIo } from '../src/cli/dev-cli.js';
import type { DaemonHandle, DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { tempHome } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import { activateDetached, runForeground } from '../src/cli/daemon-cli.js';

/** A clean runtime for the unsafe-env guard (vitest's own worker runs with interpreter flags). */
const CLEAN = { env: {}, execArgv: ['--disable-sigusr1'] as string[] };
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function sink(): { out: string[]; write(s: string): boolean } {
  const out: string[] = [];
  return { out, write: (s: string) => (out.push(s), true) };
}
function io(): DevCliIo & { o: string[]; e: string[] } {
  const stdout = sink();
  const stderr = sink();
  return { stdin: new PassThrough(), stdout, stderr, o: stdout.out, e: stderr.out };
}
/** A private user home (its `.gnomon` is the production home) and a dev home path beside it. */
function world(): { userHome: string; devHome: string; prodHome: string } {
  const t = tempHome('gv-');
  cleanups.push(t.cleanup);
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  return { userHome, devHome: path.join(userHome, 'devhome'), prodHome: path.join(userHome, '.gnomon') };
}

describe('#dev-launch: gnomon dev init', () => {
  it('provisions a dev root, a registered kernel key and one human device; loads back; prints no key material', async () => {
    const w = world();
    const x = io();
    expect(await runDevCommand(['init', '--home', w.devHome], x, { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const text = x.o.join('');
    expect(text).toMatch(/^DEV ONLY/);
    expect(text).toContain('INITIALIZED  dev home');
    expect(looksLikeKeyMaterial(text)).toBe(false);
    const l = loadDevHome(w.devHome, { userHome: w.userHome });
    expect(l.root.state).toBe('dev-test');
    expect(l.device.deviceId).toBe(`dev:${l.root.ns}/mac-1`);
    expect(l.device.principalId).toBe(`p:${l.root.ns}/founder`);
    for (const f of [DEV_ROOT_KEY_FILE, 'DEV-ONLY-kernel-ed25519.pem', 'device.key', 'registry.jsonl']) {
      expect(fs.statSync(path.join(w.devHome, 'keys', f)).mode & 0o777).toBe(0o600);
    }
    // re-running is a verified no-op
    const y = io();
    expect(await runDevCommand(['init', '--home', w.devHome], y, { userHome: w.userHome })).toBe(0);
    expect(y.o.join('')).toContain('ALREADY INITIALIZED');
  });

  it('FALSIFIER: refuses the production home (~/.gnomon), anything inside it, and anything containing it; writes nothing', async () => {
    const w = world();
    for (const home of [w.prodHome, path.join(w.prodHome, 'sub'), w.userHome]) {
      const x = io();
      expect(await runDevCommand(['init', '--home', home], x, { userHome: w.userHome })).toBe(1);
      expect(x.e.join('')).toContain('REFUSED  DEV  production-home');
    }
    expect(fs.existsSync(w.prodHome)).toBe(false);
    expect(fs.existsSync(path.join(w.userHome, DEV_HOME_MARKER))).toBe(false);
  });

  it('FALSIFIER: refuses a home holding a registry it did not write (a production root may have signed it); nothing is added', async () => {
    const w = world();
    const other = new DevTestRootAuthority(DEV_TEST_ROOT_ACK); // stands in for the production root
    registerDevice(w.devHome, other, { host: 'mac-1', name: 'founder', publicKeyPem: SoftwareEd25519Signer.generate('device').publicKeyPem });
    const before = fs.readFileSync(registryPath(w.devHome), 'utf8');
    const x = io();
    expect(await runDevCommand(['init', '--home', w.devHome], x, { userHome: w.userHome })).toBe(1);
    expect(x.e.join('')).toContain('production-root');
    expect(fs.readFileSync(registryPath(w.devHome), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(w.devHome, DEV_HOME_MARKER))).toBe(false);
    expect(fs.existsSync(path.join(w.devHome, 'keys', DEV_ROOT_KEY_FILE))).toBe(false);
  });

  it('FALSIFIER: refuses a non-empty unmarked home and a relative --home', async () => {
    const w = world();
    fs.mkdirSync(w.devHome, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(w.devHome, 'kernel.db'), '');
    const x = io();
    expect(await runDevCommand(['init', '--home', w.devHome], x, { userHome: w.userHome })).toBe(1);
    expect(x.e.join('')).toContain('home-not-empty');
    expect(await runDevCommand(['init', '--home', 'rel/path'], io(), { userHome: w.userHome })).toBe(64);
  });

  it('FALSIFIER: a registry row from another root makes the dev home refuse to load (fail closed)', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const other = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    registerDevice(w.devHome, other, { host: 'mac-9', name: 'mallory', publicKeyPem: SoftwareEd25519Signer.generate('device').publicKeyPem });
    expect(() => loadDevHome(w.devHome, { userHome: w.userHome })).toThrow(DevHomeRefusal);
    try {
      loadDevHome(w.devHome, { userHome: w.userHome });
    } catch (e) {
      expect((e as DevHomeRefusal).reason).toBe('dev-home-damaged');
    }
  });

  it('FALSIFIER: the production daemon (no root supplied) never trusts a dev home: device auth is refused root-unprovisioned', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const l = loadDevHome(w.devHome, { userHome: w.userHome });
    const d = await startDaemon({ home: w.devHome, idleMs: 60_000, kernelSigner: l.kernel });
    cleanups.push(() => d.shutdown('signal'));
    expect(d.kernelPrincipal).toBe('p:00000000/kernel');
    const err = await GnomonClient.connect({ socketPath: d.pidfile.socketPath, client: { name: 't', version: '0', surface: 'cli' }, kernelKey: l.kernelKey, credential: l.device }).then(
      (c) => (void c.close(), null),
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(JSON.stringify((err as { refusal?: unknown }).refusal ?? String(err))).toContain('root-unprovisioned');
  });
});

describe('#dev-launch: gnomon dev up', () => {
  it('FALSIFIER: refuses a home that is not a dev home, and the production home; starts nothing', async () => {
    const w = world();
    let started = 0;
    const start = async (o: DaemonOptions): Promise<DaemonHandle> => (started++, startDaemon(o));
    const x = io();
    expect(await runDevCommand(['up', '--home', w.devHome], x, { userHome: w.userHome, start, runtime: CLEAN })).toBe(1);
    expect(x.e.join('')).toContain('not-a-dev-home');
    const y = io();
    expect(await runDevCommand(['up', '--home', w.prodHome], y, { userHome: w.userHome, start, runtime: CLEAN })).toBe(1);
    expect(y.e.join('')).toContain('production-home');
    expect(started).toBe(0);
  });

  it('runs the kernel in-process with the dev-test root and connects as the registered human device', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const k = await startDevKernel(w.devHome, { userHome: w.userHome });
    cleanups.push(() => k.stop());
    expect(k.client.serverVerified).toBe(true);
    expect(k.client.principal).toBe(k.dev.device.principalId);
    const st = (await k.client.call('status', {})) as { root?: { state?: string } };
    expect(st.root?.state).toBe('dev-test');
  });

  it('never prints a launch token or key material when stdout is not a terminal; returns when the kernel exits', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    let h: DaemonHandle | null = null;
    const start = async (o: DaemonOptions): Promise<DaemonHandle> => (h = await startDaemon(o));
    const x = io();
    const run = runDevCommand(['up', '--home', w.devHome], x, { userHome: w.userHome, start, runtime: CLEAN });
    const deadline = Date.now() + 15_000;
    while (!x.o.join('').includes('gui ') && !x.e.join('').includes('web-launch') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    await h!.shutdown('signal');
    expect(await run).toBe(0);
    const all = x.o.join('') + x.e.join('');
    expect(all).toContain('UP  dev kernel');
    expect(all).toContain('DOWN  dev kernel');
    expect(all).not.toMatch(/#launch=/);
    expect(all).not.toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/);
    expect(looksLikeKeyMaterial(all)).toBe(false);
  });
});

describe('#dev-launch: production-home guard hardening (Aegis C1)', () => {
  it('FALSIFIER: a symlinked dev home is refused: into ~/.gnomon as production-home, elsewhere as unsafe-home', async () => {
    const w = world();
    fs.mkdirSync(w.prodHome, { mode: 0o700 });
    const link = path.join(w.userHome, 'link-to-prod');
    fs.symlinkSync(w.prodHome, link);
    const x = io();
    expect(await runDevCommand(['init', '--home', link], x, { userHome: w.userHome })).toBe(1);
    expect(x.e.join('')).toContain('production-home');
    const other = path.join(w.userHome, 'real-dir');
    fs.mkdirSync(other, { mode: 0o700 });
    const link2 = path.join(w.userHome, 'link-to-other');
    fs.symlinkSync(other, link2);
    const y = io();
    expect(await runDevCommand(['init', '--home', link2], y, { userHome: w.userHome })).toBe(1);
    expect(y.e.join('')).toContain('unsafe-home');
    expect(fs.readdirSync(other)).toEqual([]);
    expect(fs.readdirSync(w.prodHome)).toEqual([]);
  });

  it('FALSIFIER: a DANGLING ~/.gnomon symlink makes its target the production home', async () => {
    const w = world();
    const target = path.join(w.userHome, 'future-prod');
    fs.symlinkSync(target, w.prodHome);
    const x = io();
    expect(await runDevCommand(['init', '--home', target], x, { userHome: w.userHome })).toBe(1);
    expect(x.e.join('')).toContain('production-home');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('FALSIFIER: on darwin ~/.GNOMON is refused even when ~/.gnomon does not exist (case-insensitive APFS)', async () => {
    const w = world();
    const upper = path.join(w.userHome, '.GNOMON');
    const x = io();
    expect(await runDevCommand(['init', '--home', upper], x, { userHome: w.userHome, platform: 'darwin' })).toBe(1);
    expect(x.e.join('')).toContain('production-home');
    expect(fs.existsSync(upper)).toBe(false);
  });

  it('TRIPWIRE: gnomond (foreground and detaching) refuses, loudly, a home holding the DEV-ONLY marker; no daemon starts', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const err: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
    try {
      expect(await runForeground({ foreground: true, home: w.devHome, idleMs: 1000 })).toBe(78); // DAEMON_EXIT.config
      expect(await activateDetached({ foreground: false, home: w.devHome }, path.join(w.userHome, 'no-such-gnomond.js'))).toBe(78);
    } finally {
      spy.mockRestore();
    }
    expect(err.join('')).toContain('REFUSED  GNOMOND  dev-home');
    expect(err.filter((l) => l.includes('dev-home')).length).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(w.devHome, 'gnomon.pid'))).toBe(false);
    expect(fs.existsSync(path.join(w.devHome, 'kernel.db'))).toBe(false);
  });
});

describe('#dev-launch: dev up shutdown', () => {
  it('a failing stop is reported and returns 1, never an unhandled rejection; q on a TTY stops', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const start = async (o: DaemonOptions): Promise<DaemonHandle> => {
        const h = await startDaemon(o);
        return { ...h, shutdown: async (r) => (await h.shutdown(r), Promise.reject(new Error('shutdown boom (test)'))) };
      };
      const x = io();
      const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
      stdin.isTTY = true;
      const run = runDevCommand(['up', '--home', w.devHome], { ...x, stdin }, { userHome: w.userHome, start, runtime: CLEAN });
      const deadline = Date.now() + 15_000;
      while (!x.o.join('').includes('gui ') && !x.e.join('').includes('web-launch') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      stdin.write('q\n');
      expect(await run).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(x.o.join('')).toContain('STOPPING  dev kernel');
      expect(x.e.join('')).toContain('stop-failed');
      expect(x.e.join('')).toContain('shutdown boom (test)');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('#dev-launch: dev up refuses an unsafe runtime (Aegis C1, the gnomon up rule)', () => {
  it('FALSIFIER: NODE_OPTIONS or any node interpreter flag refuses unsafe-env; the kernel never starts', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    let started = 0;
    const start = async (o: DaemonOptions): Promise<DaemonHandle> => (started++, startDaemon(o));
    for (const runtime of [
      { env: { NODE_OPTIONS: '--require /tmp/x.js' }, execArgv: [] },
      { env: {}, execArgv: ['--inspect=0'] },
      { env: {}, execArgv: ['--import', 'data:text/javascript,0'] },
    ]) {
      const x = io();
      expect(await runDevCommand(['up', '--home', w.devHome], x, { userHome: w.userHome, start, runtime })).toBe(1);
      expect(x.e.join('')).toContain('REFUSED  DEV  unsafe-env');
      expect(x.e.join('')).not.toContain('/tmp/x.js');
    }
    expect(started).toBe(0);
    // and the real vitest worker (it runs with interpreter flags) is refused by the default facts
    if (process.execArgv.length > 0) {
      const y = io();
      expect(await runDevCommand(['up', '--home', w.devHome], y, { userHome: w.userHome, start })).toBe(1);
      expect(y.e.join('')).toContain('unsafe-env');
      expect(started).toBe(0);
    }
  });
});

describe('#dev-launch: an interrupted dev init', () => {
  it('a half-provisioned home (dev root key + registry, no marker) is refused by init and up with the remove-and-re-run hint', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
    fs.rmSync(path.join(w.devHome, DEV_HOME_MARKER)); // the marker is the LAST write: this is the interrupted shape
    const hint = `if this is an interrupted \`gnomon dev init\`, remove ${w.devHome} and re-run`;
    const x = io();
    expect(await runDevCommand(['init', '--home', w.devHome], x, { userHome: w.userHome })).toBe(1);
    expect(x.e.join('')).toContain('half-provisioned');
    expect(x.e.join('')).toContain(hint);
    expect(fs.existsSync(path.join(w.devHome, DEV_HOME_MARKER))).toBe(false);
    let started = 0;
    const y = io();
    expect(await runDevCommand(['up', '--home', w.devHome], y, { userHome: w.userHome, runtime: CLEAN, start: async (o) => (started++, startDaemon(o)) })).toBe(1);
    expect(y.e.join('')).toContain('not-a-dev-home');
    expect(y.e.join('')).toContain('interrupted');
    expect(y.e.join('')).toContain(hint);
    expect(started).toBe(0);
    // following the hint works
    fs.rmSync(w.devHome, { recursive: true, force: true });
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'mac-1' })).toBe(0);
  });
});

describe('#dev-launch: the production CLI passes no start seam (Aegis)', () => {
  it('gnomon.ts calls runDevCommand with argv and stdio only: no opts, no start, no test entry', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'gnomon.ts'), 'utf8');
    const uses = src.split('\n').filter((l) => /\brunDevCommand\(/.test(l));
    expect(uses).toHaveLength(1);
    expect(uses[0]!.trim()).toBe('runDevCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(');
    for (const f of ['gnomon.ts', 'dev-cli.ts', 'dev-home.ts']) {
      const t = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', f), 'utf8');
      expect(t, f).not.toMatch(/testing\.js|startDaemonForTest|internal-seams|seamsOf/);
    }
    // dev-cli's default start is the production startDaemon
    expect(fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'dev-cli.ts'), 'utf8')).toContain('const start = opts.start ?? startDaemon;');
  });
});
