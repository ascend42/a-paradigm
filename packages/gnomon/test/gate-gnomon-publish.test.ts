// @gnomon-platform: darwin
/**
 * #gnomon-npm-packaging (T-2026-10-21-030; Aegis M3 high 1): scripts/gate-gnomon-publish.mjs, run first by
 * `npm run publish:gnomon`, refuses unsigned/unnotarized app zips, a dev dist, a dist whose compiled appZips do not
 * match the platform packages' zips, and version drift.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import { gateProblems, platformPackageProblems } from '../../../scripts/gate-gnomon-publish.mjs';
// @ts-expect-error -- a plain .mjs script, no declarations
import { sealProblems } from '../scripts/seal-npm-release.mjs';
import { MIN_HELPER_VERSION } from '../src/kernel/identity/helper.js';
import { MIN_VOICE_IO_VERSION } from '../src/kernel/voice/voice-install.js';
import { PKG_ROOT } from './helpers.js';

const PACKAGES = path.resolve(PKG_ROOT, '..');
// the release under test follows the package's own version, so a version bump never strands this suite
const RELEASE = (JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const ARCHES = ['arm64']; // Apple silicon only in 8.0 (TD-2026-10-22-310)
let root = '';
const sha = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** A repo-shaped fixture: the four manifests, the arm64 platform package holding an UNSIGNED dry-run zip. */
beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-gate-')));
  for (const p of ['gnomon', 'paradigm', 'paradigm-mcp', 'gnomon-darwin-arm64']) {
    fs.mkdirSync(path.join(root, 'packages', p), { recursive: true });
    fs.copyFileSync(path.join(PACKAGES, p, 'package.json'), path.join(root, 'packages', p, 'package.json'));
  }
  const out = path.join(root, 'release');
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'release-darwin.mjs'), '--dry-run', '--unsigned', '--zip', '--out', out], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  const zip = JSON.parse(r.stdout).zip as string;
  for (const a of ARCHES) fs.copyFileSync(zip, path.join(root, 'packages', `gnomon-darwin-${a}`, 'Gnomon.app.zip'));
}, 180_000);
afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function buildDist(release: boolean): void {
  const dist = path.join(root, 'packages', 'gnomon', 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  if (!release) {
    fs.cpSync(path.join(PKG_ROOT, 'dist'), dist, { recursive: true });
    return;
  }
  const helper = path.join(root, 'gnomon-helper');
  fs.writeFileSync(helper, `#!/bin/sh\necho "gnomon-helper ${MIN_HELPER_VERSION}"\n`, { mode: 0o755 });
  const voice = path.join(root, 'gnomon-voice-io');
  fs.writeFileSync(voice, `#!/bin/sh\necho "gnomon-voice-io ${MIN_VOICE_IO_VERSION}"\n`, { mode: 0o755 });
  const zips = ARCHES.flatMap((a) => ['--app-zip', `${a}=${path.join(root, 'packages', `gnomon-darwin-${a}`, 'Gnomon.app.zip')}`]);
  const b = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'build-release.mjs'), '--out-dir', dist, '--helper', helper, '--voice-io', voice, '--arch', 'universal', '--no-codesign', '--release', RELEASE, ...zips], { encoding: 'utf8', cwd: PKG_ROOT });
  if (b.status !== 0) throw new Error(b.stderr);
}

describe('gate-gnomon-publish', () => {
  it('refuses a dev dist (plain npm run build)', async () => {
    buildDist(false);
    const problems: string[] = await gateProblems(root);
    expect(problems.join('\n')).toMatch(/@a-company\/gnomon: dist is a dev build, not a release/);
  });

  it('a release dist pinning the zips passes the dist check, but unsigned, unstapled zips are refused per arch', { timeout: 180_000 }, async () => {
    buildDist(true);
    const problems: string[] = await gateProblems(root);
    expect(problems.filter((p) => p.startsWith('@a-company/gnomon:'))).toEqual([]);
    for (const a of ARCHES) {
      const mine = problems.filter((p) => p.startsWith(`@a-company/gnomon-darwin-${a}:`)).join('\n');
      expect(mine).toMatch(/codesign --verify --deep --strict -R \(team SW4BMQ8PNL\) failed/);
      expect(mine).toMatch(/xcrun stapler validate failed/);
      expect(mine).toMatch(/spctl -a -t exec failed/);
    }
    // a zip swapped after sealing: the compiled pin no longer matches
    const zip = path.join(root, 'packages', 'gnomon-darwin-arm64', 'Gnomon.app.zip');
    const before = sha(zip);
    fs.appendFileSync(zip, 'x');
    const again: string[] = await gateProblems(root);
    expect(again.join('\n')).toMatch(new RegExp(`dist pins arm64 zip ${before}, but the platform package's zip hashes to`));
  });

  it('refuses version drift and a platform package that grew scripts', async () => {
    const f = path.join(root, 'packages', 'gnomon-darwin-arm64', 'package.json');
    const orig = fs.readFileSync(f, 'utf8');
    try {
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(orig), version: '7.0.0', scripts: { postinstall: 'echo hi' } }));
      const problems: string[] = await gateProblems(root);
      expect(problems.join('\n')).toMatch(new RegExp(`lockstep: .*gnomon-darwin-arm64.* version is 7\\.0\\.0, want ${RELEASE.replace(/\./g, '\\.')}`));
      expect(problems.join('\n')).toMatch(/gnomon-darwin-arm64: has scripts \(postinstall\)/);
    } finally {
      fs.writeFileSync(f, orig);
    }
  });

  it('Apple silicon only (TD-2026-10-22-310): never gates or publishes x64, and refuses an x64 optional dependency', async () => {
    const problems: string[] = await gateProblems(root);
    expect(problems.join('\n')).not.toMatch(/gnomon-darwin-x64/);
    const f = path.join(root, 'packages', 'gnomon', 'package.json');
    const orig = fs.readFileSync(f, 'utf8');
    try {
      const j = JSON.parse(orig);
      fs.writeFileSync(f, JSON.stringify({ ...j, optionalDependencies: { ...j.optionalDependencies, '@a-company/gnomon-darwin-x64': j.version } }));
      const again: string[] = await gateProblems(root);
      expect(again.join('\n')).toMatch(new RegExp(`lockstep: .*optionalDependencies\\.@a-company/gnomon-darwin-x64 is ${RELEASE.replace(/\./g, '\\.')}, want \\(absent\\)`));
    } finally {
      fs.writeFileSync(f, orig);
    }
  });
});

/**
 * 8.2.1: 8.2.0's platform package carried a stale, genuinely notarized 8.0.0 app (kernel package.json 8.0.0, build
 * stamp commit e9fb52f9) and nothing checked its version. A fixture app zip with a chosen kernel version.
 */
function appZip(dir: string, kernel: string, stamp: string | null): string {
  const app = path.join(dir, 'build', 'Gnomon.app');
  fs.rmSync(path.join(dir, 'build'), { recursive: true, force: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'kernel', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'kernel', 'package.json'), JSON.stringify({ name: '@a-company/gnomon', version: kernel }));
  if (stamp) fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'kernel', 'dist', 'build-id.json'), JSON.stringify({ schemaVersion: 'gnomon-build:v1', version: stamp, commit: 'e9fb52f9' }));
  const zip = path.join(dir, 'Gnomon.app.zip');
  fs.rmSync(zip, { force: true });
  const z = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip], { encoding: 'utf8' });
  if (z.status !== 0) throw new Error(z.stderr);
  return zip;
}

describe('8.2.1: the app inside the platform package must be this version', () => {
  const versionProblems = (ps: string[]): string[] => ps.filter((p) => /packaged Gnomon\.app/.test(p));
  function platformDir(): string {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-gate-version-')));
    fs.mkdirSync(path.join(d, 'packages', 'gnomon-darwin-arm64'), { recursive: true });
    fs.copyFileSync(path.join(PACKAGES, 'gnomon-darwin-arm64', 'package.json'), path.join(d, 'packages', 'gnomon-darwin-arm64', 'package.json'));
    return d;
  }

  it('the gate refuses a stale app (the 8.2.0 incident) and a stale build stamp, and passes a matching one', () => {
    const d = platformDir();
    const pkg = path.join(d, 'packages', 'gnomon-darwin-arm64');
    try {
      appZip(pkg, '8.0.0', '8.0.0');
      const stale = versionProblems(platformPackageProblems(pkg, 'arm64', 'identifier "gnomon.wrapper"'));
      expect(stale).toContain(`@a-company/gnomon-darwin-arm64: the packaged Gnomon.app is 8.0.0, not ${RELEASE}: rebuild with release-darwin.mjs --notarize`);
      expect(stale.join('\n')).toMatch(new RegExp(`kernel build stamp .* is 8\\.0\\.0 from commit e9fb52f9, not ${RELEASE.replace(/\./g, '\\.')}`));
      appZip(pkg, RELEASE, '8.0.0');
      expect(versionProblems(platformPackageProblems(pkg, 'arm64', 'identifier "gnomon.wrapper"'))).toEqual([expect.stringMatching(/kernel build stamp .* is 8\.0\.0/)]);
      appZip(pkg, RELEASE, null);
      expect(versionProblems(platformPackageProblems(pkg, 'arm64', 'identifier "gnomon.wrapper"')).join('\n')).toMatch(/no readable Contents\/Resources\/kernel\/dist\/build-id\.json version/);
      appZip(pkg, RELEASE, RELEASE);
      expect(versionProblems(platformPackageProblems(pkg, 'arm64', 'identifier "gnomon.wrapper"'))).toEqual([]);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('seal-npm-release refuses to seal a stale app, and seals a matching one', () => {
    const d = platformDir();
    const pkg = path.join(d, 'packages', 'gnomon-darwin-arm64');
    try {
      expect((sealProblems(path.join(d, 'packages'), RELEASE) as string[]).join('\n')).toMatch(/no .*Gnomon\.app\.zip; run release-darwin\.mjs --notarize/);
      appZip(pkg, '8.0.0', '8.0.0');
      expect((sealProblems(path.join(d, 'packages'), RELEASE) as string[]).join('\n')).toContain(`the packaged Gnomon.app is 8.0.0, not ${RELEASE}: rebuild with release-darwin.mjs --notarize`);
      appZip(pkg, RELEASE, RELEASE);
      expect(sealProblems(path.join(d, 'packages'), RELEASE)).toEqual([]);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('the seal CLI exits 1 and seals nothing when it refuses (no build-release run)', () => {
    const zip = path.join(PACKAGES, 'gnomon-darwin-arm64', 'Gnomon.app.zip');
    if (fs.existsSync(zip)) return; // a release checkout holding a real zip: the function tests above cover it
    const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'seal-npm-release.mjs')], { encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/seal-npm-release: REFUSED, nothing sealed/);
  });
});
