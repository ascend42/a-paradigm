#!/usr/bin/env node
/**
 * @symbol #gnomon-npm-packaging
 *
 * The publish gate for Gnomon (T-2026-10-21-030; Aegis M3 high 1). `npm run publish:gnomon` runs THIS first, as a
 * plain command (not an npm lifecycle hook: `--ignore-scripts` would skip one), and publishes nothing unless every
 * check passes:
 *   1. lockstep: scripts/sync-gnomon-versions.mjs finds no drift;
 *   2. each platform package (packages/gnomon-darwin-arm64; Apple silicon only in 8.0): exactly its files, no scripts, a Gnomon.app.zip that
 *      unpacks (ditto -x -k, into a fresh temp dir) to a Gnomon.app passing
 *        codesign --verify --deep --strict -R=<the wrapper requirement: Developer ID, team OU SW4BMQ8PNL>,
 *        xcrun stapler validate, and spctl -a -t exec -vv;
 *   3. @a-company/gnomon's dist is a RELEASE build (__GNOMON_RELEASE__ with a valid compiled manifest, for this version)
 *      whose compiled appZips sha256 equals each platform package's zip (scripts/seal-npm-release.mjs).
 *
 *   node scripts/gate-gnomon-publish.mjs        exit 0 = publishable; 1 = refused (every problem printed)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gnomonVersionDrift, REPO } from './sync-gnomon-versions.mjs';

// Apple silicon only in 8.0 (TD-2026-10-22-310); x64 is not published.
export const ARCHES = Object.freeze(['arm64']);
export const PLATFORM_FILES = Object.freeze(['index.js', 'Gnomon.app.zip', 'Gnomon.app.zip.sha256']);
export const TEAM = 'SW4BMQ8PNL';

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tail = (r) => `${String(r.stdout ?? '')}${String(r.stderr ?? '')}`.trim().split('\n').slice(-2).join(' | ').slice(0, 300);

/** The designated requirement the published app must meet (the wrapper's: Developer ID, team OU, bundle id). */
async function appRequirement() {
  const { WRAPPER_REQUIREMENT } = await import(pathToFileURL(path.join(REPO, 'packages', 'gnomon-wrapper', 'scripts', 'build-darwin.mjs')).href);
  if (!WRAPPER_REQUIREMENT.includes(`certificate leaf[subject.OU] = "${TEAM}"`)) throw new Error(`the wrapper requirement does not name team ${TEAM}`);
  return WRAPPER_REQUIREMENT;
}

/** Problems with one platform package's zip and the app inside it (empty = shippable). */
export function platformPackageProblems(dir, arch, requirement) {
  const problems = [];
  const at = `@a-company/gnomon-darwin-${arch}`;
  const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pj.scripts && Object.keys(pj.scripts).length) problems.push(`${at}: has scripts (${Object.keys(pj.scripts).join(', ')})`);
  if (JSON.stringify(pj.files) !== JSON.stringify(PLATFORM_FILES)) problems.push(`${at}: files must be exactly ${PLATFORM_FILES.join(', ')}`);
  const zip = path.join(dir, 'Gnomon.app.zip');
  if (!existsSync(zip)) return [...problems, `${at}: no Gnomon.app.zip (run release-darwin.mjs --notarize on a ${arch} Mac)`];
  if (process.platform !== 'darwin') return [...problems, `${at}: the app is verified on macOS only (codesign, stapler, spctl)`];
  const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-publish-gate-')));
  try {
    const x = spawnSync('/usr/bin/ditto', ['-x', '-k', zip, work], { encoding: 'utf8' });
    const app = path.join(work, 'Gnomon.app');
    if (x.status !== 0 || !existsSync(app)) return [...problems, `${at}: the zip does not unpack to Gnomon.app (${tail(x)})`];
    const cs = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', `-R=${requirement}`, app], { encoding: 'utf8' });
    if (cs.status !== 0) problems.push(`${at}: codesign --verify --deep --strict -R (team ${TEAM}) failed: ${tail(cs)}`);
    const st = spawnSync('/usr/bin/xcrun', ['stapler', 'validate', app], { encoding: 'utf8' });
    if (st.status !== 0) problems.push(`${at}: xcrun stapler validate failed (not notarized and stapled): ${tail(st)}`);
    const sp = spawnSync('/usr/sbin/spctl', ['-a', '-t', 'exec', '-vv', app], { encoding: 'utf8' });
    if (sp.status !== 0) problems.push(`${at}: spctl -a -t exec failed: ${tail(sp)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return problems;
}

/** Problems with @a-company/gnomon's dist: a release build of this version pinning each platform zip's sha256. */
export async function gnomonDistProblems(root) {
  const pkg = path.join(root, 'packages', 'gnomon');
  const version = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  const { checkReleaseDist } = await import(pathToFileURL(path.join(REPO, 'packages', 'gnomon', 'scripts', 'prepack.mjs')).href);
  const checked = await checkReleaseDist(path.join(pkg, 'dist'), version);
  const problems = checked.problems.map((p) => `@a-company/gnomon: ${p}`);
  if (problems.length) return problems;
  const m = checked.module; // the very module the release check just loaded
  const manifest = m.releasePins.loadedReleasePins().manifest;
  for (const arch of ARCHES) {
    const zip = path.join(root, 'packages', `gnomon-darwin-${arch}`, 'Gnomon.app.zip');
    if (!existsSync(zip)) continue; // reported by the platform check
    const pinned = manifest.appZips?.find((z) => z.arch === arch)?.sha256;
    if (pinned !== sha256File(zip)) problems.push(`@a-company/gnomon: dist pins ${arch} zip ${pinned ?? '(none)'}, but the platform package's zip hashes to ${sha256File(zip)}; re-run scripts/seal-npm-release.mjs`);
  }
  return problems;
}

/** Every reason not to publish (empty = publishable). */
export async function gateProblems(root = REPO) {
  const problems = gnomonVersionDrift(root).map((d) => `lockstep: ${path.relative(root, d.file)} ${d.field} is ${d.have ?? '(missing)'}, want ${d.want ?? '(absent)'}`);
  const requirement = await appRequirement();
  for (const arch of ARCHES) problems.push(...platformPackageProblems(path.join(root, 'packages', `gnomon-darwin-${arch}`), arch, requirement));
  problems.push(...(await gnomonDistProblems(root)));
  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  gateProblems().then(
    (problems) => {
      if (problems.length === 0) {
        process.stdout.write('gate-gnomon-publish: ok (signed, notarized, stapled zips; release dist pins them; versions in lockstep)\n');
        return;
      }
      process.stderr.write(`gate-gnomon-publish: refused, nothing published\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
      process.exitCode = 1;
    },
    (e) => {
      process.stderr.write(`gate-gnomon-publish: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
