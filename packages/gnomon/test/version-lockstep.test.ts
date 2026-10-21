/**
 * #gnomon-npm-packaging (T-2026-10-21-030, TD-2026-10-21-758; 8.0 M3): the published Gnomon packages stay in
 * lockstep (scripts/sync-gnomon-versions.mjs), and the published manifests carry nothing unpublished.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import * as sync from '../../../scripts/sync-gnomon-versions.mjs';
import { PKG_ROOT } from './helpers.js';

const REPO = path.resolve(PKG_ROOT, '..', '..');
const read = (rel: string): Record<string, any> => JSON.parse(readFileSync(path.join(REPO, rel), 'utf8'));
const ARCHES = ['arm64', 'x64'] as const;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of just the four package.json files the lockstep covers. */
function fixtureRepo(): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-lockstep-')));
  dirs.push(d);
  for (const p of ['gnomon', 'paradigm', 'gnomon-darwin-arm64', 'gnomon-darwin-x64']) {
    mkdirSync(path.join(d, 'packages', p), { recursive: true });
    cpSync(path.join(REPO, 'packages', p, 'package.json'), path.join(d, 'packages', p, 'package.json'));
  }
  return d;
}

describe('gnomon version lockstep', () => {
  it('the repo is in lockstep (run node scripts/sync-gnomon-versions.mjs to fix)', () => {
    expect(sync.gnomonVersionDrift()).toEqual([]);
  });

  it('a drifted platform version, optional dep or paradigm dependency fails, and the sync fixes all of them', () => {
    const d = fixtureRepo();
    const edit = (p: string, f: (j: Record<string, any>) => void): void => {
      const file = path.join(d, 'packages', p, 'package.json');
      const j = JSON.parse(readFileSync(file, 'utf8'));
      f(j);
      writeFileSync(file, JSON.stringify(j, null, 2));
    };
    edit('gnomon-darwin-x64', (j) => (j.version = '7.9.9'));
    edit('gnomon', (j) => (j.optionalDependencies['@a-company/gnomon-darwin-arm64'] = '^8.0.0'));
    edit('paradigm', (j) => delete j.dependencies['@a-company/gnomon']);
    const drift = sync.gnomonVersionDrift(d).map((x: { field: string }) => x.field).sort();
    expect(drift).toEqual(['dependencies.@a-company/gnomon', 'optionalDependencies.@a-company/gnomon-darwin-arm64', 'version']);
    expect(sync.syncGnomonVersions(d)).toHaveLength(3);
    expect(sync.gnomonVersionDrift(d)).toEqual([]);
    const want = read('packages/gnomon/package.json').version;
    expect(JSON.parse(readFileSync(path.join(d, 'packages', 'paradigm', 'package.json'), 'utf8')).dependencies['@a-company/gnomon']).toBe(want);
  });
});

describe('published manifests (no unpublished dependency reaches a user)', () => {
  const gnomon = read('packages/gnomon/package.json');

  it('@a-company/gnomon is public, keeps its bins, ships dist + the first-party mods, and depends on nothing but the platform packages', () => {
    expect(gnomon.private).toBeUndefined();
    expect(gnomon.publishConfig?.access).toBe('public');
    expect(gnomon.bin.gnomon).toBe('dist/cli/gnomon.js');
    expect(gnomon.files).toEqual(['dist', 'gnomon-mods']);
    expect(gnomon.dependencies).toBeUndefined();
    expect(Object.keys(gnomon.optionalDependencies).sort()).toEqual(ARCHES.map((a) => `@a-company/gnomon-darwin-${a}`));
    // every workspace dep is a devDependency, bundled by tsup (fence.test.ts proves dist has no bare import)
    for (const k of Object.keys(gnomon.devDependencies ?? {})) if (k.startsWith('@a-company/')) expect(k).toBe('@a-company/gnomon-contracts');
  });

  // the platform packages' own manifest and tarball checks live in G-SEC-01 (test/sec-01.test.ts; Aegis M3 medium 4)

  it('the platform packages stay out of the root workspaces (os/cpu would make npm install fail on the other arch)', () => {
    expect(read('package.json').workspaces).toContain('!packages/gnomon-darwin-*');
  });

  it('@a-company/paradigm depends on gnomon exactly and ships the gnomon shim bin beside its own bins', () => {
    const p = read('packages/paradigm/package.json');
    expect(p.dependencies['@a-company/gnomon']).toBe(gnomon.version);
    expect(p.bin).toMatchObject({ paradigm: './dist/index.js', 'paradigm-mcp': './dist/mcp.js', sentinel: './dist/sentinel.js', 'sentinel-mcp': './dist/sentinel-mcp.js', gnomon: './bin/gnomon.js' });
    expect(p.files).toContain('bin');
  });
});
