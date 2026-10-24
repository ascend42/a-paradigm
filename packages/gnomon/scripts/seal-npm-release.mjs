#!/usr/bin/env node
/**
 * @symbol #gnomon-npm-packaging
 *
 * Seal the @a-company/gnomon that npm publishes (T-2026-10-21-030; Aegis M3 high 2). Run on the release Mac AFTER the
 * shippable zip sits in packages/gnomon-darwin-arm64 (release-darwin.mjs --notarize; Apple silicon only in 8.0,
 * TD-2026-10-22-310). It runs
 * `build-release.mjs` (a RELEASE build, pins compiled in) with `--app-zip <arch>=<zip>` for each shipped arch, so each zip's
 * sha256 is compiled into dist (release-manifest:v1 appZips) and the zip is later checked against the CODE
 * (src/kernel/lifecycle/app-zip.ts verifyAppZip), never the .sha256 beside it. Every other argument is passed through
 * to build-release.mjs (--helper, --voice-io, --arch, ...). Refuses when a zip is missing.
 *
 *   node packages/gnomon/scripts/seal-npm-release.mjs [build-release args]
 * Then: npm run publish:gnomon (scripts/gate-gnomon-publish.mjs verifies everything first).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.resolve(PKG, '..');
const zips = ['arm64'].map((arch) => ({ arch, zip: path.join(PACKAGES, `gnomon-darwin-${arch}`, 'Gnomon.app.zip') }));
const missing = zips.filter((z) => !existsSync(z.zip));
if (missing.length) {
  process.stderr.write(`seal-npm-release: no ${missing.map((z) => z.zip).join(', ')}; run release-darwin.mjs --notarize on the Apple silicon Mac first\n`);
  process.exitCode = 1;
} else {
  const r = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'build-release.mjs'), ...process.argv.slice(2), ...zips.flatMap((z) => ['--app-zip', `${z.arch}=${z.zip}`])], { cwd: PKG, stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
}
