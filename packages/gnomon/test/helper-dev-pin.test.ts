/**
 * #identity Aegis S1 H1: a dev helper (gnomon.helper.dev, group SW4BMQ8PNL.gnomon.dev) is accepted only by a dev SEA
 * kernel and is never shipped by release-darwin.mjs (built or --skip-native). Platform-independent (stubbed capture).
 */
import { describe, expect, it } from 'vitest';
import { HELPER_DEV_REQUIREMENT, HELPER_REQUIREMENT, helperRequirements } from '../src/kernel/identity/helper.js';
import { assertReleaseHelper } from '../scripts/release-darwin.mjs';
import * as signing from '../../gnomon-helper/scripts/signing.mjs';

type Cap = (cmd: string, args: string[], opts?: { input?: string }) => { status: number; stdout: string; stderr: string };
const cap = (bundleId: string, info: unknown, codesignOk = true): Cap => (cmd) => {
  if (cmd === '/usr/bin/plutil') return { status: 0, stdout: `${bundleId}\n`, stderr: '' };
  if (cmd === '/usr/bin/codesign') return { status: codesignOk ? 0 : 3, stdout: '', stderr: codesignOk ? '' : 'failed requirement' };
  return { status: 0, stdout: `${JSON.stringify(info)}\n`, stderr: '' };
};

describe('the dev helper pin (Aegis S1 H1)', () => {
  it('a release kernel (or any non-dev-SEA kernel) accepts only gnomon.helper; a dev SEA also gnomon.helper.dev', () => {
    expect(HELPER_REQUIREMENT).toMatch(/identifier "gnomon\.helper"$/);
    expect(HELPER_DEV_REQUIREMENT).toMatch(/identifier "gnomon\.helper\.dev"$/);
    expect(HELPER_DEV_REQUIREMENT.replace('gnomon.helper.dev', 'gnomon.helper')).toBe(HELPER_REQUIREMENT);
    expect(helperRequirements('release')).toEqual([HELPER_REQUIREMENT]);
    expect(helperRequirements(null)).toEqual([HELPER_REQUIREMENT]);
    expect(helperRequirements('dev')).toEqual([HELPER_REQUIREMENT, HELPER_DEV_REQUIREMENT]);
  });

  it('the dev flavor never shares the release identity, group, profile or output dir', () => {
    const r = signing.helperFlavor(false);
    const d = signing.helperFlavor(true);
    expect(r).toMatchObject({ bundleId: 'gnomon.helper', accessGroup: 'SW4BMQ8PNL.gnomon.prod', outDir: 'darwin' });
    expect(d).toMatchObject({ bundleId: 'gnomon.helper.dev', accessGroup: 'SW4BMQ8PNL.gnomon.dev', outDir: 'darwin-dev' });
    expect(d.profilePath).not.toBe(r.profilePath);
    expect(r.requirement).toBe(HELPER_REQUIREMENT);
    expect(d.requirement).toBe(HELPER_DEV_REQUIREMENT);
  });

  it('FALSIFIER: release-darwin refuses a dev bundle id, devKernel true or missing, and a signed helper off the release requirement', () => {
    const ok = { id: 1, ok: true, devKernel: false };
    expect(assertReleaseHelper('/x/GnomonHelper.app', { signed: true, requirement: HELPER_REQUIREMENT, cap: cap('gnomon.helper', ok) })).toMatchObject({ devKernel: false });
    expect(() => assertReleaseHelper('/x', { signed: false, requirement: HELPER_REQUIREMENT, cap: cap('gnomon.helper.dev', ok) })).toThrow(/bundle id/);
    expect(() => assertReleaseHelper('/x', { signed: false, requirement: HELPER_REQUIREMENT, cap: cap('gnomon.helper', { ...ok, devKernel: true }) })).toThrow(/devKernel/);
    expect(() => assertReleaseHelper('/x', { signed: false, requirement: HELPER_REQUIREMENT, cap: cap('gnomon.helper', { id: 1, ok: true }) })).toThrow(/devKernel/);
    expect(() => assertReleaseHelper('/x', { signed: true, requirement: HELPER_REQUIREMENT, cap: cap('gnomon.helper', ok, false) })).toThrow(/release requirement/);
    expect(() => assertReleaseHelper('/x', { signed: true, requirement: HELPER_DEV_REQUIREMENT, cap: cap('gnomon.helper', ok) })).toThrow(/must pin identifier gnomon.helper/);
  });
});
