/**
 * G-SEC-01 — the kernel's package.json declares no runtime dependencies
 * (spec §15.1 row 8, §18; research 29 §1). There is no `dependencies` key at
 * all; gnomon-contracts is a devDependency and tsup bundles it. Optional, peer
 * and bundled dependencies would also reach the kernel process at runtime, so
 * they are refused too.
 *
 * 8.0 M3 (T-2026-10-21-030, TD-2026-10-21-758): the ONE allowed optional dependency is the darwin platform
 * package, at exactly the kernel's version: @a-company/gnomon-darwin-arm64 only, since Gnomon 8.0 ships for Apple
 * silicon Macs only (TD-2026-10-22-310). They hold only a zipped Gnomon.app (plus a tiny index.js exporting its
 * path); the kernel never imports them (the G-KRN-02 fence and dist scan still allow only node:* and relative
 * imports), so no third-party code reaches the kernel process.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from './helpers.js';

const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

describe('G-SEC-01 kernel has zero runtime deps', () => {
  it('has no "dependencies" key', () => {
    expect(Object.hasOwn(pkg, 'dependencies')).toBe(false);
  });

  it('optionalDependencies are exactly the arm64 darwin platform package, pinned to this version (no x64 in 8.0)', () => {
    expect(pkg.optionalDependencies).toEqual({
      '@a-company/gnomon-darwin-arm64': pkg.version,
    });
  });

  it.each(['peerDependencies', 'bundleDependencies', 'bundledDependencies'])(
    'has no "%s" key',
    (key) => {
      expect(Object.hasOwn(pkg, key)).toBe(false);
    },
  );

  it('takes gnomon-contracts as a devDependency only', () => {
    const dev = pkg.devDependencies as Record<string, string>;
    expect(dev['@a-company/gnomon-contracts']).toBeDefined();
  });

  it('is published (not private; 8.0 M3) and requires Node >= 24', () => {
    expect(pkg.private).toBeUndefined();
    expect((pkg.engines as Record<string, string>).node).toBe('>=24.0.0');
  });
});

/**
 * G-SEC-01 for the darwin platform packages (T-2026-10-21-030; Aegis M3 medium 4). They reach every user who installs
 * paradigm on a Mac, so they carry NOTHING that runs at install or publish time and nothing but the app zip: no
 * scripts at all (publishing is gated by scripts/gate-gnomon-publish.mjs, a plain command), no dependency of any kind,
 * and `files` exactly index.js, the zip and its sha256.
 */
describe('G-SEC-01 darwin platform packages', () => {
  const ARCHES = ['arm64'] as const; // Apple silicon only in 8.0 (TD-2026-10-22-310)
  const dirOf = (arch: string) => path.join(PKG_ROOT, '..', `gnomon-darwin-${arch}`);
  const manifestOf = (arch: string) => JSON.parse(readFileSync(path.join(dirOf(arch), 'package.json'), 'utf8')) as Record<string, unknown>;

  it.each(ARCHES)('gnomon-darwin-%s: public, os/cpu pinned, no scripts, no dependencies, exact files', (arch) => {
    const p = manifestOf(arch);
    expect(p.name).toBe(`@a-company/gnomon-darwin-${arch}`);
    expect(p.private).toBeUndefined();
    expect((p.publishConfig as Record<string, string> | undefined)?.access).toBe('public');
    expect(p.os).toEqual(['darwin']);
    expect(p.cpu).toEqual([arch]);
    expect(Object.hasOwn(p, 'scripts')).toBe(false);
    for (const k of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies', 'devDependencies']) expect(Object.hasOwn(p, k)).toBe(false);
    expect(p.files).toEqual(['index.js', 'Gnomon.app.zip', 'Gnomon.app.zip.sha256']);
    expect(p.version).toBe(pkg.version);
  });

  it.each(ARCHES)('gnomon-darwin-%s: npm pack --dry-run holds exactly package.json, README.md, index.js, the zip and its sha256 (placeholder zip)', (arch) => {
    const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-sec01-pack-')));
    try {
      for (const f of ['package.json', 'index.js', 'README.md', '.purpose']) copyFileSync(path.join(dirOf(arch), f), path.join(d, f));
      writeFileSync(path.join(d, 'Gnomon.app.zip'), 'placeholder zip');
      writeFileSync(path.join(d, 'Gnomon.app.zip.sha256'), `${'0'.repeat(64)}  Gnomon.app.zip\n`);
      writeFileSync(path.join(d, 'stray.js'), 'must not ship');
      const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: d, encoding: 'utf8', shell: true });
      expect(r.status, r.stderr).toBe(0);
      const files = (JSON.parse(r.stdout) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map((f) => f.path).sort();
      expect(files).toEqual(['Gnomon.app.zip', 'Gnomon.app.zip.sha256', 'README.md', 'index.js', 'package.json']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(ARCHES)('gnomon-darwin-%s: index.js imports node built-ins only and never trusts the sidecar', (arch) => {
    const src = readFileSync(path.join(dirOf(arch), 'index.js'), 'utf8');
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(m[1]!.startsWith('node:')).toBe(true);
    expect(src).not.toMatch(/readFileSync\(sha256Path/);
  });
});
