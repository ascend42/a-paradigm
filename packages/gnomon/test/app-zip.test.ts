// @gnomon-platform: darwin, linux
/**
 * #gnomon-npm-packaging (T-2026-10-21-030, Aegis M3 high 2): the published Gnomon.app.zip is checked against the
 * sha256 COMPILED INTO @a-company/gnomon (release-manifest:v1 appZips), never the .sha256 shipped beside it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppZipRefused, appZipPin, platformPackageZip, verifyAppZip } from '../src/kernel/lifecycle/app-zip.js';
import { DEV_PINS, releasePinsFromCompiled } from '../src/kernel/lifecycle/release-pins.js';
import { MIN_HELPER_VERSION } from '../src/kernel/identity/helper.js';
import { MIN_VOICE_IO_VERSION } from '../src/kernel/voice/voice-install.js';
import { PKG_ROOT } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-app-zip-')));
  dirs.push(d);
  return d;
};
const sha = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const manifest = (appZips?: Array<{ arch: string; sha256: string }>) =>
  JSON.stringify({
    schemaVersion: 'gnomon-release-manifest:v1',
    release: '8.0.0',
    artifacts: [{ name: 'gnomon-helper', version: '1.8.0', sha256: 'a'.repeat(64), requirement: 'identifier "x"', arch: 'universal' }],
    ...(appZips ? { appZips } : {}),
  });
const reason = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof AppZipRefused ? e.reason : `other: ${String(e)}`;
  }
};

/** A platform package dir holding a zip and a sidecar that MATCHES it (the attacker controls both). */
function platformPackage(root: string, arch: string, bytes: string, name = `@a-company/gnomon-darwin-${arch}`): string {
  const dir = path.join(root, 'node_modules', '@a-company', `gnomon-darwin-${arch}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '8.0.0' }));
  fs.writeFileSync(path.join(dir, 'Gnomon.app.zip'), bytes);
  fs.writeFileSync(path.join(dir, 'Gnomon.app.zip.sha256'), `${sha(path.join(dir, 'Gnomon.app.zip'))}  Gnomon.app.zip\n`);
  return dir;
}

describe('appZipPin', () => {
  it('dev, broken, unpinned arch are refused; a pinned arch gives its sha256', () => {
    expect(appZipPin(DEV_PINS, 'arm64')).toMatchObject({ kind: 'refuse', reason: 'dev' });
    expect(appZipPin(releasePinsFromCompiled(true, null), 'arm64')).toMatchObject({ kind: 'refuse', reason: 'broken' });
    const pins = releasePinsFromCompiled(true, manifest([{ arch: 'arm64', sha256: 'b'.repeat(64) }]));
    expect(appZipPin(pins, 'arm64')).toEqual({ kind: 'pinned', sha256: 'b'.repeat(64) });
    expect(appZipPin(pins, 'x64')).toMatchObject({ kind: 'refuse', reason: 'unpinned' });
    expect(appZipPin(releasePinsFromCompiled(true, manifest()), 'arm64')).toMatchObject({ kind: 'refuse', reason: 'unpinned' });
  });
});

describe('verifyAppZip', () => {
  it('a tampered zip with a MATCHING sidecar is refused `checksum`; the original passes', () => {
    const root = tmp();
    const dir = platformPackage(root, 'arm64', 'the real zip bytes');
    const pins = releasePinsFromCompiled(true, manifest([{ arch: 'arm64', sha256: sha(path.join(dir, 'Gnomon.app.zip')) }]));
    const zip = path.join(dir, 'Gnomon.app.zip');
    expect(verifyAppZip(zip, { arch: 'arm64', pins })).toBe(sha(zip));
    // swap the zip AND rewrite its sidecar to match: still refused, the sidecar is never read
    fs.writeFileSync(zip, 'tampered zip bytes');
    fs.writeFileSync(`${zip}.sha256`, `${sha(zip)}  Gnomon.app.zip\n`);
    expect(reason(() => verifyAppZip(zip, { arch: 'arm64', pins }))).toBe('checksum');
    expect(reason(() => verifyAppZip(zip, { arch: 'arm64', pins: DEV_PINS }))).toBe('dev');
    expect(reason(() => verifyAppZip(path.join(root, 'nope.zip'), { arch: 'arm64', pins }))).toBe('missing');
  });
});

describe('platformPackageZip', () => {
  it('resolves the installed package; a missing package or a planted one with another name is refused `missing`', () => {
    const root = tmp();
    const from = path.join(root, 'node_modules', '@a-company', 'gnomon', 'dist', 'index.js');
    expect(reason(() => platformPackageZip('arm64', from))).toBe('missing');
    platformPackage(root, 'arm64', 'zip', 'evil-package');
    expect(reason(() => platformPackageZip('arm64', from))).toBe('missing');
    const dir = platformPackage(root, 'x64', 'zip');
    expect(platformPackageZip('x64', from)).toBe(path.join(dir, 'Gnomon.app.zip'));
  });
});

describe('a RELEASE build compiles the app zip sha256 (write-release-manifest --app-zip)', () => {
  it('the built dist refuses a tampered zip with a matching sidecar and accepts the published one', { timeout: 180_000 }, () => {
    const d = tmp();
    const helper = path.join(d, 'gnomon-helper');
    fs.writeFileSync(helper, `#!/bin/sh\necho "gnomon-helper ${MIN_HELPER_VERSION}"\n`, { mode: 0o755 });
    const voice = path.join(d, 'gnomon-voice-io');
    fs.writeFileSync(voice, `#!/bin/sh\necho "gnomon-voice-io ${MIN_VOICE_IO_VERSION}"\n`, { mode: 0o755 });
    const pkg = platformPackage(d, 'arm64', 'published zip bytes');
    const zip = path.join(pkg, 'Gnomon.app.zip');
    const dist = path.join(d, 'dist');
    const b = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'build-release.mjs'), '--out-dir', dist, '--helper', helper, '--voice-io', voice, '--arch', 'universal', '--no-codesign', '--release', '8.0.0', '--app-zip', `arm64=${zip}`], { encoding: 'utf8', cwd: PKG_ROOT });
    expect(b.status, b.stderr).toBe(0);
    const probe = () => {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const m = await import(${JSON.stringify(path.join(dist, 'index.js'))});
        let out;
        try { out = { ok: m.appZip.verifyAppZip(${JSON.stringify(zip)}, { arch: 'arm64' }) }; } catch (e) { out = { refused: e.reason }; }
        let x64; try { m.appZip.verifyAppZip(${JSON.stringify(zip)}, { arch: 'x64' }); } catch (e) { x64 = e.reason; }
        process.stdout.write(JSON.stringify({ ...out, x64 }));
      `], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return JSON.parse(r.stdout) as { ok?: string; refused?: string; x64?: string };
    };
    expect(probe()).toEqual({ ok: sha(zip), x64: 'unpinned' });
    fs.writeFileSync(zip, 'tampered');
    fs.writeFileSync(`${zip}.sha256`, `${sha(zip)}  Gnomon.app.zip\n`);
    expect(probe()).toEqual({ refused: 'checksum', x64: 'unpinned' });
  });
});
