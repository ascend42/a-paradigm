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
import { gateProblems } from '../../../scripts/gate-gnomon-publish.mjs';
import { MIN_HELPER_VERSION } from '../src/kernel/identity/helper.js';
import { MIN_VOICE_IO_VERSION } from '../src/kernel/voice/voice-install.js';
import { PKG_ROOT } from './helpers.js';

const PACKAGES = path.resolve(PKG_ROOT, '..');
const ARCHES = ['arm64']; // Apple silicon only in 8.0 (TD-2026-10-22-310)
let root = '';
const sha = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** A repo-shaped fixture: the three manifests, the arm64 platform package holding an UNSIGNED dry-run zip. */
beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-gate-')));
  for (const p of ['gnomon', 'paradigm', 'gnomon-darwin-arm64']) {
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
  const b = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'build-release.mjs'), '--out-dir', dist, '--helper', helper, '--voice-io', voice, '--arch', 'universal', '--no-codesign', '--release', '8.0.0', ...zips], { encoding: 'utf8', cwd: PKG_ROOT });
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
      expect(problems.join('\n')).toMatch(/lockstep: .*gnomon-darwin-arm64.* version is 7.0.0, want 8.0.0/);
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
      expect(again.join('\n')).toMatch(/lockstep: .*optionalDependencies\.@a-company\/gnomon-darwin-x64 is 8\.0\.0, want \(absent\)/);
    } finally {
      fs.writeFileSync(f, orig);
    }
  });
});
