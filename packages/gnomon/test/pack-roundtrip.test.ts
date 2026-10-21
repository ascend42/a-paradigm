// @gnomon-platform: darwin
/**
 * #gnomon-npm-packaging (T-2026-10-21-030 acceptance, TD-2026-10-21-758; 8.0 M3): a platform package holding a zip
 * built by `release-darwin --dry-run --unsigned --zip` survives `npm pack` → tar → `ditto -x -k` with the app layout
 * and its framework symlinks intact. The signed checks (codesign --verify --strict --deep, spctl -a) run only when a
 * signed release zip sits in packages/gnomon-darwin-<host arch>; otherwise that case is skipped and says why.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import { packRoundTrip, signatureKind } from '../scripts/pack-roundtrip.mjs';
import { PKG_ROOT } from './helpers.js';

const arch = process.arch === 'x64' ? 'x64' : 'arm64';
const releaseZip = path.join(PKG_ROOT, '..', `gnomon-darwin-${arch}`, 'Gnomon.app.zip');

describe('#gnomon-npm-packaging pack round trip', () => {
  it('an unsigned dry-run zip survives npm pack with its layout and symlinks; the signed checks are skipped', () => {
    const r = packRoundTrip({ arch });
    expect(r.problems).toEqual([]);
    expect(r.built).toBe(true);
    expect(r.files).toEqual(['Gnomon.app.zip', 'Gnomon.app.zip.sha256', 'README.md', 'index.js', 'package.json']);
    expect(r.symlinks).toBeGreaterThanOrEqual(3);
    expect(r.frameworks.length).toBeGreaterThan(0);
    expect(r.signature).not.toBe('developer-id');
    expect(r.signedChecks).toMatch(/^skipped: /);
    expect(r.packedSize).toBeGreaterThan(0);
  }, 300_000);

  const signed = existsSync(releaseZip);
  if (!signed) process.stderr.write(`pack-roundtrip.test: no signed release zip at ${releaseZip}; the codesign/spctl round trip is skipped (run release-darwin.mjs on the release Mac first)\n`);
  it.runIf(signed)('the signed release zip in the platform package survives npm pack and passes codesign --deep and spctl', () => {
    const r = packRoundTrip({ arch, zip: releaseZip });
    if (r.signature !== 'developer-id') {
      // an ad-hoc zip copied in by hand (--package-dir): nothing signed to verify
      expect(r.signedChecks).toMatch(/^skipped: /);
      return;
    }
    expect(r.problems).toEqual([]);
    expect(r.signedChecks).toEqual({ codesign: 'ok', spctl: 'ok' });
  }, 600_000);

  it('signatureKind reads an unsigned path as unsigned', () => {
    expect(signatureKind(path.join(PKG_ROOT, 'package.json'))).toBe('unsigned');
  });
});
