/**
 * @symbol #gnomon-npm-packaging
 *
 * The version a packaged Gnomon.app carries (8.2.1 fix). 8.2.0 shipped @a-company/gnomon-darwin-arm64 with a stale,
 * genuinely notarized 8.0.0 app inside, because nothing checked the app's version: the shim then refused to update
 * ("the unpacked Gnomon.app is 8.0.0, not 8.2.0"). release-darwin.mjs (before it copies into the platform package),
 * seal-npm-release.mjs (before it seals) and scripts/gate-gnomon-publish.mjs (before it publishes) all run these
 * checks, reading the same path the shim reads (packages/paradigm/bin/gnomon-app.js LAYOUT.kernelPackage) plus the
 * kernel's build stamp (dist/build-id.json, scripts/build-stamp.mjs).
 *
 *   appVersionProblems(app, want)    problems with an unpacked Gnomon.app (empty = it is `want`)
 *   appZipVersionProblems(zip, want) the same for a Gnomon.app.zip, unpacked with ditto into a fresh temp dir (macOS)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Relative to Gnomon.app (the shim's LAYOUT.kernelPackage, and the kernel's build stamp). */
export const KERNEL_PACKAGE_REL = 'Contents/Resources/kernel/package.json';
export const KERNEL_STAMP_REL = 'Contents/Resources/kernel/dist/build-id.json';

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** The one sentence every refusal starts with (the gate, the seal and release-darwin print it). */
export const staleAppMessage = (have, want) => `the packaged Gnomon.app is ${have}, not ${want}: rebuild with release-darwin.mjs --notarize`;

/** Problems with the version an unpacked Gnomon.app carries (empty = its kernel package and build stamp are `want`). */
export function appVersionProblems(app, want) {
  const problems = [];
  const pkg = readJson(path.join(app, KERNEL_PACKAGE_REL));
  if (pkg?.name !== '@a-company/gnomon' || typeof pkg.version !== 'string') problems.push(`the packaged Gnomon.app has no readable @a-company/gnomon ${KERNEL_PACKAGE_REL}: rebuild with release-darwin.mjs --notarize`);
  else if (pkg.version !== want) problems.push(staleAppMessage(pkg.version, want));
  const stamp = readJson(path.join(app, KERNEL_STAMP_REL));
  if (typeof stamp?.version !== 'string') problems.push(`the packaged Gnomon.app has no readable ${KERNEL_STAMP_REL} version: rebuild with release-darwin.mjs --notarize`);
  else if (stamp.version !== want) problems.push(`the packaged Gnomon.app's kernel build stamp (${KERNEL_STAMP_REL}) is ${stamp.version}${stamp.commit ? ` from commit ${stamp.commit}` : ''}, not ${want}: rebuild with release-darwin.mjs --notarize`);
  return problems;
}

/** The same check for a Gnomon.app.zip (unpacked with ditto -x -k into a fresh temp dir, removed after). */
export function appZipVersionProblems(zip, want) {
  if (!existsSync(zip)) return [`no ${zip}`];
  if (process.platform !== 'darwin') return [`${zip}: the app's version is read by unpacking it with ditto, on macOS only`];
  const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-app-version-')));
  try {
    const x = spawnSync('/usr/bin/ditto', ['-x', '-k', zip, work], { encoding: 'utf8' });
    const app = path.join(work, 'Gnomon.app');
    if (x.status !== 0 || !existsSync(app)) return [`${zip} does not unpack to Gnomon.app: ${String(x.stderr ?? '').trim().slice(0, 300)}`];
    return appVersionProblems(app, want);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
