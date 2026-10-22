#!/usr/bin/env node
/**
 * @symbol #gnomon-npm-packaging
 *
 * prepack / postpack for @a-company/gnomon (T-2026-10-21-030, TD-2026-10-21-758; 8.0 M3). The published tarball must
 * carry no unpublished dependency:
 *   - @a-company/gnomon-contracts is inlined into dist by tsup (noExternal; the G-KRN-02 dist scan proves no bare
 *     import survives), so it is a devDependency only;
 *   - the first-party mods (packages/gnomon-mods, plain .mjs + manifests, no package.json) are found at runtime as
 *     the nearest `gnomon-mods` folder above the kernel module (mods-admin.ts findFirstPartyRoot), so prepack copies
 *     them to packages/gnomon/gnomon-mods (gitignored, listed in `files`) byte for byte, which keeps their pinned
 *     packageHash (FIRST_PARTY_PACKAGE_HASHES);
 *   - gnomon-local, gnomon-mod-sdk and gnomon-gui are not imported by the kernel at runtime (the GUI is embedded in
 *     dist; gnomon-local is a configured executable path), so nothing of theirs ships.
 * prepack refuses an unbuilt dist, any symlink in the copied tree, and (Aegis M3 high 1) a dist that is not a RELEASE
 * build: dist/index.js must report compiled release pins (__GNOMON_RELEASE__ with a valid compiled manifest) for this
 * package's version, pinning the app zip of every darwin arch (appZips; scripts/seal-npm-release.mjs). A dev dist is
 * never packed. This is a lifecycle hook (--ignore-scripts skips it): the binding check is
 * scripts/gate-gnomon-publish.mjs, which `npm run publish:gnomon` runs first. `--clean` (postpack) removes the copy.
 */
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(PKG, '..', 'gnomon-mods');
const DST = path.join(PKG, 'gnomon-mods');
// the arches a publishable release must pin a Gnomon.app zip for: Apple silicon only in 8.0 (TD-2026-10-22-310). The
// release-manifest:v1 contract still admits x64 (gnomon-contracts APP_ZIP_ARCHES) for when it returns.
export const APP_ZIP_ARCHES = ['arm64'];

/** Problems with `dist` as a publishable release build of `version` (empty = ok). Imports dist/index.js. */
export async function releaseDistProblems(dist, version) {
  return (await checkReleaseDist(dist, version)).problems;
}

/** { problems, module }: the release check plus the dist module it loaded (for callers that read its pins). */
export async function checkReleaseDist(dist, version) {
  const r = await releaseDistCheck(dist, version);
  return Array.isArray(r) ? { problems: r, module: null } : r;
}

async function releaseDistCheck(dist, version) {
  let m;
  try {
    // the mtime query keeps a re-built dist at the same path from being served from the ESM cache
    const index = path.join(dist, 'index.js');
    m = await import(`${pathToFileURL(index).href}?mtime=${statSync(index).mtimeMs}`);
  } catch (e) {
    return [`dist/index.js does not load (${e instanceof Error ? e.message : String(e)})`];
  }
  const pins = m.releasePins?.loadedReleasePins?.();
  if (!pins || pins.mode !== 'release') return [`dist is a ${pins?.mode ?? 'unknown'} build, not a release (${pins?.why ?? 'no release pins'}); run scripts/seal-npm-release.mjs`];
  const problems = [];
  if (pins.manifest.release !== version) problems.push(`dist pins release ${pins.manifest.release}, not ${version}`);
  for (const arch of APP_ZIP_ARCHES) if (!pins.manifest.appZips?.some((z) => z.arch === arch)) problems.push(`dist pins no Gnomon.app zip for ${arch}`);
  return { problems, module: m };
}

function assertPlain(dir) {
  const st = lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error(`symlink in gnomon-mods: ${dir}`);
  if (st.isDirectory()) for (const n of readdirSync(dir)) assertPlain(path.join(dir, n));
  else if (!st.isFile()) throw new Error(`not a regular file in gnomon-mods: ${dir}`);
}

const isMain = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) try {
  rmSync(DST, { recursive: true, force: true });
  if (!process.argv.includes('--clean')) {
    if (!existsSync(path.join(PKG, 'dist', 'cli', 'gnomon.js'))) throw new Error('dist is not built (npm run build:gnomon)');
    const version = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
    const problems = await releaseDistProblems(path.join(PKG, 'dist'), version);
    if (problems.length) throw new Error(`refusing to pack a non-release dist: ${problems.join('; ')}`);
    assertPlain(SRC);
    cpSync(SRC, DST, { recursive: true, dereference: false });
    process.stderr.write(`gnomon prepack: copied ${readdirSync(DST).length} first-party mods into gnomon-mods/\n`);
  }
} catch (e) {
  process.stderr.write(`gnomon prepack: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
