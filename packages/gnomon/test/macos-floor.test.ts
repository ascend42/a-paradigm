/**
 * #setup-preflight — the macOS floor is 15 everywhere (TD-2026-10-22-220, spec §18.1 "macOS floor"):
 * setup preflight, the session sandbox, the app's LSMinimumSystemVersion (tauri minimumSystemVersion),
 * and the helper and voice-io build targets and Info.plists. Pure file reads; runs on every platform.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MACOS_MAJOR_FLOOR } from '../src/kernel/setup/preflight.js';
import { SESSION_SANDBOX_MIN_MACOS } from '../src/platform/darwin/session-sbpl.js';

const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(PACKAGES, rel), 'utf8');

describe('macOS floor (TD-2026-10-22-220)', () => {
  it('setup preflight refuses exactly where sessions refuse: 15', () => {
    expect(SESSION_SANDBOX_MIN_MACOS).toBe(15);
    expect(MACOS_MAJOR_FLOOR).toBe(SESSION_SANDBOX_MIN_MACOS);
  });

  it("the app's minimum system version is 15.0", () => {
    const conf = JSON.parse(read('gnomon-wrapper/tauri.conf.json')) as { bundle: { macOS: { minimumSystemVersion: string } } };
    expect(conf.bundle.macOS.minimumSystemVersion).toBe(`${MACOS_MAJOR_FLOOR}.0`);
  });

  it.each([
    ['gnomon-helper/darwin/Package.swift', 'gnomon-helper/scripts/build-darwin.mjs'],
    ['gnomon-voice/io-darwin/Package.swift', 'gnomon-voice/scripts/build-voice-io.mjs'],
  ])('%s and its Info.plist build for macOS 15', (pkg, build) => {
    const swift = read(pkg);
    expect(swift).toMatch(/\.macOS\("15\.0"\)/);
    expect(swift).not.toMatch(/\.macOS\(\.v1[0-4]\)/);
    const plists = [...read(build).matchAll(/<key>LSMinimumSystemVersion<\/key><string>([^<]+)<\/string>/g)].map((m) => m[1]);
    expect(plists.length).toBeGreaterThan(0);
    for (const v of plists) expect(v).toBe(`${MACOS_MAJOR_FLOOR}.0`);
  });
});
