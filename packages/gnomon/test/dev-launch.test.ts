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
import { runDevCommand, type DevCliIo } from '../src/cli/dev-cli.js';
import { tempHome } from './daemon-helpers.js';
import { PassThrough } from 'node:stream';

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
