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
 * to build-release.mjs (--helper, --voice-io, --arch, ...). Refuses when a zip is missing, and (8.2.1) when the app
 * inside a zip is not @a-company/gnomon's version (8.2.0 sealed a stale 8.0.0 app; scripts/app-version.mjs).
 *
 *   node packages/gnomon/scripts/seal-npm-release.mjs [build-release args]
 * Then: npm run publish:gnomon (scripts/gate-gnomon-publish.mjs verifies everything first).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appZipVersionProblems } from './app-version.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.resolve(PKG, '..');
export const SEAL_ARCHES = Object.freeze(['arm64']);

/** Every reason not to seal the zips under `packages` for gnomon `version` (empty = seal them). */
export function sealProblems(packages = PACKAGES, version = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')).version) {
  const problems = [];
  for (const arch of SEAL_ARCHES) {
    const zip = path.join(packages, `gnomon-darwin-${arch}`, 'Gnomon.app.zip');
    if (!existsSync(zip)) {
      problems.push(`no ${zip}; run release-darwin.mjs --notarize on the Apple silicon Mac first`);
      continue;
    }
    problems.push(...appZipVersionProblems(zip, version).map((p) => `${zip}: ${p}`));
  }
  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const problems = sealProblems();
  if (problems.length) {
    process.stderr.write(`seal-npm-release: REFUSED, nothing sealed\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    const zips = SEAL_ARCHES.map((arch) => ({ arch, zip: path.join(PACKAGES, `gnomon-darwin-${arch}`, 'Gnomon.app.zip') }));
    const r = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'build-release.mjs'), ...process.argv.slice(2), ...zips.flatMap((z) => ['--app-zip', `${z.arch}=${z.zip}`])], { cwd: PKG, stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  }
}
