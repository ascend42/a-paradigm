// @gnomon-platform: darwin
/**
 * #release-darwin (T-2026-10-21-029, TD-2026-10-21-758; 8.0 M2): the release script's pure parts and its
 * `--dry-run --unsigned` run (no swift, npm, cargo, network or codesign) producing the expected relocatable layout.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import * as rel from '../scripts/release-darwin.mjs';
import { appBundleOf } from '../src/kernel/lifecycle/app-bundle.js';
import { findFirstPartyRoot } from '../src/kernel/modhost/mods-admin.js';
import { FIRST_PARTY_PACKAGE_HASHES } from '../src/kernel/manifest/install.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
// @ts-expect-error -- a plain .mjs script, no declarations
import * as bump from '../scripts/bump-bundled-node.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'release-darwin.mjs');
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-release-test-')));
  dirs.push(d);
  return d;
}

describe('#release-darwin pins', () => {
  it('kernelTreeHash is the wrapper tree.rs hash (shared vector with packages/gnomon-wrapper/src/kernel.rs)', () => {
    const d = tmp();
    mkdirSync(path.join(d, 'dist/cli'), { recursive: true });
    writeFileSync(path.join(d, 'dist/cli/gnomon.js'), 'console.log(1)\n');
    writeFileSync(path.join(d, 'package.json'), '{"type":"module"}\n');
    expect(rel.kernelTreeHash(d)).toBe('sha256:1c36bf6b177d07ce096f770c9cd046f3b297cc562b7ad77b495aefc9e01035f9');
  });

  it('the node lock pins an official 24.x tarball with a sha256 per arch', () => {
    for (const arch of ['arm64', 'x64']) {
      const e = rel.nodeLockFor(arch);
      expect(e.version).toMatch(/^24\.\d+\.\d+$/);
      expect(e.url).toBe(`https://nodejs.org/dist/v${e.version}/node-v${e.version}-darwin-${arch}.tar.gz`);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const d = tmp();
    const bad = (lock: unknown): void => {
      writeFileSync(path.join(d, 'lock.json'), JSON.stringify(lock));
      expect(() => rel.nodeLockFor('arm64', path.join(d, 'lock.json'))).toThrow();
    };
    const good = JSON.parse(readFileSync(rel.NODE_LOCK, 'utf8'));
    bad({ ...good, version: '26.0.0' });
    bad({ ...good, base: 'https://example.com/dist' });
    bad({ ...good, artifacts: { 'darwin-arm64': { ...good.artifacts['darwin-arm64'], sha256: 'x' } } });
    // Aegis M2 medium 3: a hand-written lock (no gpg provenance) or a signer outside the vendored keys is refused
    bad({ ...good, provenance: undefined });
    bad({ ...good, provenance: { ...good.provenance, signer: 'F'.repeat(40) } });
    bad({ ...good, provenance: { ...good.provenance, method: 'manual' } });
    expect(JSON.parse(readFileSync(rel.RELEASE_KEYS, 'utf8')).fingerprints).toContain(good.provenance.signer);
  });

  it('the node requirement is the one the wrapper compiles (packages/gnomon-wrapper/src/layout.rs)', () => {
    const rs = readFileSync(path.join(rel.WRAPPER, 'src', 'layout.rs'), 'utf8');
    const lit = (name: string): string => new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(rs)![1]!;
    expect([lit('NODE_IDENTIFIER'), lit('TEAM')]).toEqual([rel.NODE_IDENTIFIER, rel.TEAM]);
    const devId = /"developer-id" => Ok\(format!\("(.+)"\)\),/.exec(rs)![1]!.replace(/\\"/g, '"').replace('{TEAM}', lit('TEAM')).replace('{NODE_IDENTIFIER}', lit('NODE_IDENTIFIER'));
    expect(rel.nodeRequirement('developer-id')).toBe(devId);
    expect(rel.nodeRequirement('adhoc')).toBe(`identifier "${rel.NODE_IDENTIFIER}"`);
  });

  it('staging refuses a symlink anywhere in a tree (never dereferenced)', () => {
    const d = tmp();
    const pkg = path.join(d, 'pkg');
    mkdirSync(path.join(pkg, 'dist', 'cli'), { recursive: true });
    writeFileSync(path.join(pkg, 'dist', 'cli', 'gnomon.js'), '//');
    writeFileSync(path.join(pkg, 'package.json'), '{}');
    expect(rel.stageKernel(pkg, path.join(d, 'stage1'))).toBe(path.join(d, 'stage1', 'Resources/kernel'));
    symlinkSync('/etc/hosts', path.join(pkg, 'dist', 'hosts.js'));
    expect(() => rel.stageKernel(pkg, path.join(d, 'stage2'))).toThrow(/symlink/);
  });

  describe('assertReleaseKernel (TD-2026-10-24-447: the shipped kernel is a release build with loops off)', () => {
    // The in-app kernel has no appZips (it can't pin the zip of the app that carries it); that is the real shape.
    const NATIVE = "artifacts: [{ name: 'gnomon-helper', arch: 'arm64' }, { name: 'gnomon-voice-io', arch: 'universal' }]";
    const kernel = (mode: string, loopsOn: boolean, withGate = true, appZips = false, artifacts = NATIVE): string => {
      const d = tmp();
      const dist = path.join(d, 'kernel', 'dist');
      mkdirSync(dist, { recursive: true });
      writeFileSync(path.join(dist, 'index.js'), [
        `export const releasePins = { loadedReleasePins: () => ({ mode: ${JSON.stringify(mode)}, why: 'test', manifest: { release: '8.0.1', ${artifacts}${appZips ? ", appZips: [{ arch: 'arm64' }]" : ''} } }) };`,
        withGate ? `export const loopsGate = { resolveLoopsEnabled: () => ${loopsOn} };` : '',
      ].join('\n'));
      return path.join(d, 'kernel');
    };
    it('accepts a release kernel whose loops gate stays off, with or without appZips', async () => {
      await expect(rel.assertReleaseKernel(kernel('release', false), '8.0.1', 'arm64')).resolves.toBeUndefined();
      await expect(rel.assertReleaseKernel(kernel('release', false, true, true), '8.0.1', 'arm64')).resolves.toBeUndefined();
    });
    it('the npm dist check still requires the app zip pin (prepack / gate-gnomon-publish)', async () => {
      const { checkReleaseDist } = await import('../scripts/prepack.mjs');
      const noZip = path.join(kernel('release', false), 'dist');
      expect((await checkReleaseDist(noZip, '8.0.1')).problems).toContain('dist pins no Gnomon.app zip for arm64');
      expect((await checkReleaseDist(path.join(kernel('release', false, true, true), 'dist'), '8.0.1')).problems).toEqual([]);
    });
    it('refuses a dev kernel, a wrong version, a missing gate and a kernel with loops on', async () => {
      await expect(rel.assertReleaseKernel(kernel('dev', false), '8.0.1', 'arm64')).rejects.toThrow(/REFUSING TO SHIP.*not a release/);
      await expect(rel.assertReleaseKernel(kernel('release', false), '9.9.9', 'arm64')).rejects.toThrow(/REFUSING TO SHIP/);
      await expect(rel.assertReleaseKernel(kernel('release', false, false), '8.0.1', 'arm64')).rejects.toThrow(/no loops gate/);
      await expect(rel.assertReleaseKernel(kernel('release', true), '8.0.1', 'arm64')).rejects.toThrow(/loops are ON/);
      await expect(rel.assertReleaseKernel(kernel('release', false, true, false, "artifacts: [{ name: 'gnomon-helper', arch: 'arm64' }]"), '8.0.1', 'arm64')).rejects.toThrow(/pins no gnomon-voice-io for arm64/);
      await expect(rel.assertReleaseKernel(kernel('release', false, true, false, "artifacts: [{ name: 'gnomon-helper', arch: 'x64' }, { name: 'gnomon-voice-io', arch: 'universal' }]"), '8.0.1', 'arm64')).rejects.toThrow(/pins no gnomon-helper for arm64/);
    });
  });

  it('a downloaded node that does not hash to the lock is refused; a cached one that does is extracted', async () => {
    const d = tmp();
    const root = path.join(d, 'src', 'node-v24.0.0-darwin-arm64', 'bin');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'node'), 'fake node');
    const cache = path.join(d, 'cache');
    mkdirSync(cache);
    const tgz = path.join(cache, 'node-v24.0.0-darwin-arm64.tar.gz');
    expect(spawnSync('/usr/bin/tar', ['-czf', tgz, '-C', path.join(d, 'src'), 'node-v24.0.0-darwin-arm64']).status).toBe(0);
    const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
    const entry = { version: '24.0.0', file: 'node-v24.0.0-darwin-arm64.tar.gz', sha256: sha, url: 'https://nodejs.org/dist/v24.0.0/node-v24.0.0-darwin-arm64.tar.gz' };
    const fetchSpy = vi.fn(async () => new Response('tampered bytes'));
    vi.stubGlobal('fetch', fetchSpy);
    const work = path.join(d, 'work');
    mkdirSync(work);
    const got = await rel.fetchPinnedNode(entry, cache, work);
    expect(readFileSync(got.node, 'utf8')).toBe('fake node');
    expect(fetchSpy).not.toHaveBeenCalled(); // the cache hit hashed to the pin
    // the cache is wrong now: the download is tried, and its bytes do not match the pin
    writeFileSync(tgz, 'corrupt');
    await expect(rel.fetchPinnedNode(entry, cache, work)).rejects.toThrow(/not the lock's/);
    expect(fetchSpy).toHaveBeenCalledWith(entry.url);
  });
});

describe('bump-bundled-node (the lock\'s only writer)', () => {
  it('takes the signer from VALIDSIG\'s primary-key field and the darwin hashes from SHASUMS256.txt', () => {
    const fpr = '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356';
    const status = `[GNUPG:] GOODSIG X n\n[GNUPG:] VALIDSIG ${'A'.repeat(40)} 2026-10-20 1760000000 0 4 0 1 10 00 ${fpr}\n`;
    expect(bump.validSigner(status)).toBe(fpr);
    expect(bump.validSigner('[GNUPG:] BADSIG X n\n')).toBeNull();
    const sums = `${'a'.repeat(64)}  node-v24.1.2-darwin-arm64.tar.gz\n${'b'.repeat(64)}  node-v24.1.2-darwin-x64.tar.gz\n${'c'.repeat(64)}  node-v24.1.2-darwin-arm64.tar.xz\n`;
    expect(bump.darwinEntries(sums, '24.1.2')).toEqual({ 'darwin-arm64': { file: 'node-v24.1.2-darwin-arm64.tar.gz', sha256: 'a'.repeat(64) }, 'darwin-x64': { file: 'node-v24.1.2-darwin-x64.tar.gz', sha256: 'b'.repeat(64) } });
    expect(() => bump.darwinEntries(sums, '24.9.9')).toThrow();
    expect(bump.releaseKeyFingerprints().fingerprints.length).toBeGreaterThan(0);
  });
});

describe('#release-darwin --dry-run --unsigned', () => {
  it.runIf(process.platform === 'darwin')('assembles the relocatable layout and pins what it staged', () => {
    const out = tmp();
    const r = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--unsigned', '--out', out], { encoding: 'utf8', timeout: 120_000 });
    expect(r.status, r.stderr).toBe(0);
    const s = JSON.parse(r.stdout) as { app: string; pins: { nodeSha256: string; kernelTree: string }; signed: boolean; zip: string | null; plan: string[] };
    expect(s.app).toBe(path.join(out, 'Gnomon.app'));
    expect(rel.missingFromLayout(s.app)).toEqual([]);
    // the pins build.rs would compile equal the assembled bundle's own hashes
    expect(rel.bundlePins(path.join(s.app, 'Contents'))).toEqual(s.pins);
    expect(s.signed).toBe(false);
    expect(s.zip).toBeNull();
    const lock = rel.nodeLockFor(process.arch === 'x64' ? 'x64' : 'arm64');
    expect(s.plan).toContain(`fetch ${lock.url} (sha256 ${lock.sha256})`);
    // build-voice-io.mjs imports gnomon-contracts' dist: a fresh checkout must build it before the native helpers
    const contracts = s.plan.indexOf('npm run build -w @a-company/gnomon-contracts');
    expect(contracts).toBeGreaterThanOrEqual(0);
    expect(contracts).toBeLessThan(s.plan.indexOf('build GnomonVoiceIO.app'));
    expect(s.plan.indexOf('cargo tauri build --bundles app --no-sign (GNOMON_WRAPPER_BUNDLE_STAGE)')).toBeGreaterThan(s.plan.findIndex((p) => p.startsWith('codesign ') && p.includes('node')));
    // the kernel ships zero runtime deps: no node_modules beside it; the voice client carries its own
    expect(existsSync(path.join(s.app, 'Contents/Resources/kernel/node_modules'))).toBe(false);
    // relocation: the produced app, moved, still resolves its helpers inside itself
    const moved = path.join(tmp(), 'Applications');
    mkdirSync(moved);
    renameSync(s.app, path.join(moved, 'Gnomon.app'));
    const b = appBundleOf(path.join(moved, 'Gnomon.app/Contents/Resources/kernel/dist/cli/gnomon.js'))!;
    expect(existsSync(b.helperExe) && existsSync(b.voiceIoApp) && existsSync(path.join(b.voicePackage, 'dist/cli.js')) && existsSync(b.node)).toBe(true);
    expect(rel.bundlePins(path.join(moved, 'Gnomon.app/Contents'))).toEqual(s.pins);
    // 8.0 M4: the first-party mods ship inside the app and the moved kernel finds them bundle-relative, each byte
    // for byte (its packageHash is still a pinned first-party hash)
    const mods = findFirstPartyRoot(path.join(moved, 'Gnomon.app/Contents/Resources/kernel/dist/cli'));
    expect(mods).toBe(realpathSync(b.mods));
    const shipped = fs.readdirSync(path.join(rel.PACKAGES, 'gnomon-mods')).filter((n) => fs.statSync(path.join(rel.PACKAGES, 'gnomon-mods', n)).isDirectory()).sort();
    expect(fs.readdirSync(mods!).sort()).toEqual(expect.arrayContaining(shipped));
    for (const n of shipped) {
      const m = JSON.parse(readFileSync(path.join(mods!, n, 'gnomon-manifest.json'), 'utf8')) as { name: string };
      expect([...FIRST_PARTY_PACKAGE_HASHES]).toContain(hashSourceTree(path.join(mods!, n), m.name, () => undefined).packageHash);
    }
  }, 120_000);

  it('--package-dir refuses an unsigned or dry-run build unless --allow-unsigned-for-tests (Aegis M3 high 1)', () => {
    const pkgDir = path.join(rel.PACKAGES, 'gnomon-darwin-arm64'); // the one shipped platform package (TD-2026-10-22-310)
    const refused = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--unsigned', '--zip', '--out', tmp(), '--package-dir', pkgDir], { encoding: 'utf8', timeout: 60_000 });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/--package-dir takes only a signed, notarized, stapled release/);
    // a signed build that is not notarized is not shippable either
    const unnotarized = spawnSync(process.execPath, [SCRIPT, '--out', tmp(), '--package-dir', pkgDir, '--dry-run'], { encoding: 'utf8', timeout: 60_000 });
    expect(unnotarized.status).toBe(1);
    // the test-only flag copies into a scratch copy of the package, and the result is never `signed`
    const scratch = tmp();
    for (const f of ['package.json', 'index.js']) fs.copyFileSync(path.join(pkgDir, f), path.join(scratch, f));
    const ok = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--unsigned', '--zip', '--out', tmp(), '--package-dir', scratch, '--allow-unsigned-for-tests'], { encoding: 'utf8', timeout: 120_000 });
    expect(ok.status, ok.stderr).toBe(0);
    const s = JSON.parse(ok.stdout) as { signed: boolean; stapled: boolean; packaged: { zip: string } };
    expect(s.signed).toBe(false);
    expect(s.stapled).toBe(false);
    expect(existsSync(s.packaged.zip)).toBe(true);
  }, 180_000);

  it('refuses --arch x64 in 8.0 (Apple silicon only, TD-2026-10-22-310) unless --experimental-x64, before building anything', () => {
    for (const extra of [[], ['--dry-run']]) {
      const r = spawnSync(process.execPath, [SCRIPT, '--unsigned', '--arch', 'x64', '--out', tmp(), ...extra], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(rel.X64_REFUSED);
    }
    expect(rel.X64_REFUSED).toMatch(/^Gnomon 8\.0 runs on Apple silicon Macs; Intel support is planned\./);
  });

  it('refuses another arch than the host outside --dry-run, before building anything', () => {
    const other = process.arch === 'arm64' ? 'x64' : 'arm64';
    const r = spawnSync(process.execPath, [SCRIPT, '--unsigned', '--experimental-x64', '--arch', other, '--out', tmp()], { encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`--arch ${other} on a ${process.arch} Mac|built on macOS`));
  });
});
