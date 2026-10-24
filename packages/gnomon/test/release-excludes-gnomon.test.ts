/**
 * #release-publish, #publish-gnomon: CI's `npm run release` (scripts/release.mjs) never lets changesets publish
 * @a-company/gnomon or its platform packages, and never publishes paradigm before they are on npm; the founder's
 * `npm run publish:gnomon` (scripts/publish-gnomon.mjs) publishes in order: gate, platform packages, gnomon.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import * as release from '../../../scripts/release.mjs';
// @ts-expect-error -- a plain .mjs script, no declarations
import { publishPlan } from '../../../scripts/publish-gnomon.mjs';
import { PKG_ROOT } from './helpers.js';

const REPO = path.resolve(PKG_ROOT, '..', '..');
const rootPkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const version = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version as string;
// Apple silicon only in 8.0 (TD-2026-10-22-310): x64 is neither published nor checked on npm
const MANUAL = ['@a-company/gnomon-darwin-arm64', '@a-company/gnomon'];

describe('CI release excludes gnomon', () => {
  it('the root release script goes through the preflight, never a bare changeset publish', () => {
    expect(rootPkg.scripts.release).toBe('node scripts/release.mjs --check && npm run build && node scripts/release.mjs');
    expect(rootPkg.scripts.release).not.toMatch(/changeset publish/);
    const wf = readFileSync(path.join(REPO, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(wf).toMatch(/publish: npm run release\b/);
  });

  it('the platform packages are not workspaces (changesets cannot see them)', () => {
    expect(rootPkg.workspaces).toContain('!packages/gnomon-darwin-*');
  });

  it('lists gnomon and the arm64 platform package (no x64) as manual-only, in publish order, at the repo version', () => {
    const pkgs = release.manualOnlyPackages();
    expect(pkgs.map((p: { name: string }) => p.name)).toEqual(MANUAL);
    for (const p of pkgs) expect(p.version).toBe(version);
  });

  it('refuses, without running changeset publish, when any manual-only package is not on npm', () => {
    for (const missing of MANUAL) {
      const ran: string[][] = [];
      let msg = '';
      const code = release.runRelease({
        hasVersion: (name: string) => name !== missing,
        run: (cmd: string, args: string[]) => (ran.push([cmd, ...args]), 0),
        write: (s: string) => (msg += s),
      });
      expect(code).toBe(1);
      expect(ran).toEqual([]);
      expect(msg).toContain(`${missing}@${version} is not on npm`);
      expect(msg).toContain('npm run publish:gnomon');
    }
  });

  it('fails closed when the registry cannot be read', () => {
    const ran: string[][] = [];
    const code = release.runRelease({
      hasVersion: () => {
        throw new Error('ETIMEDOUT');
      },
      run: (cmd: string, args: string[]) => (ran.push([cmd, ...args]), 0),
      write: () => undefined,
    });
    expect(code).toBe(1);
    expect(ran).toEqual([]);
  });

  it('runs changeset publish only once both are on npm (changesets then skips them as published)', () => {
    const ran: string[][] = [];
    const code = release.runRelease({ hasVersion: () => true, run: (cmd: string, args: string[]) => (ran.push([cmd, ...args]), 0), write: () => undefined });
    expect(code).toBe(0);
    expect(ran).toHaveLength(1);
    expect(ran[0].slice(1)).toEqual(['changeset', 'publish']);
    expect(release.runRelease({ hasVersion: () => true, run: () => 0, checkOnly: true, write: () => undefined })).toBe(0);
  });
});

describe('founder publish order', () => {
  it('gate, then arm64, gnomon, then verify, then the lock repair; paradigm only with --release (no x64 step)', () => {
    const steps = publishPlan({ hasVersion: () => false, release: true });
    expect(steps.map((s: { kind: string; name?: string }) => `${s.kind}${s.name ? ` ${s.name}` : ''}`)).toEqual([
      'gate',
      ...MANUAL.map((n) => `publish ${n}`),
      ...MANUAL.map((n) => `verify ${n}`),
      'lock',
      'release',
    ]);
    expect(steps.at(-1).args).toEqual(['run', 'release']);
    expect(publishPlan({ hasVersion: () => false }).some((s: { kind: string }) => s.kind === 'release')).toBe(false);
  });

  it('a re-run skips what is already on npm but still gates first', () => {
    const steps = publishPlan({ hasVersion: (n: string) => n !== '@a-company/gnomon' });
    expect(steps[0].kind).toBe('gate');
    expect(steps.filter((s: { kind: string }) => s.kind === 'publish').map((s: { name: string }) => s.name)).toEqual(['@a-company/gnomon']);
  });
});
