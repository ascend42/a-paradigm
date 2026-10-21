#!/usr/bin/env node
/**
 * @symbol #update-watch
 *
 * The gnomon build stamp (TD-2026-10-19-063, self-update pickup): after tsup,
 * write dist/build-id.json {schemaVersion, version, commit, distHash,
 * guiBundleHash}. distHash is sha256 over every dist file (sorted relative
 * path, NUL, bytes) except the stamp itself, so ANY rebuild that changes the
 * shipped bytes changes the stamp. A running kernel polls it (update-watch.ts)
 * and raises the upgrade card when it no longer matches what it loaded.
 * voiceClientManifest (Aegis V2e M2): the sha256 of the sibling gnomon-voice
 * dist/voice-client.manifest.json, so the kernel only copies and spawns the
 * voice client this build was made with. Build gnomon-voice FIRST (root
 * build:gnomon does); absent ⇒ null (the kernel then refuses to start voice).
 * release (T-2026-10-21-028, #release-pins): under `npm run build:release` (scripts/build-release.mjs sets
 * GNOMON_RELEASE_MANIFEST) the manifest is validated and copied into the stamp for status and the upgrade card ONLY:
 * the kernel's pins are compiled into the bundle (tsup define), never read from here. Unset: a dev stamp. An invalid
 * manifest fails the build. `--dist <dir>` stamps another dist (tests).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseManifestV1 } from '@a-company/gnomon-contracts';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distArg = process.argv.indexOf('--dist');
const dist = distArg >= 0 ? path.resolve(process.argv[distArg + 1]) : path.join(pkg, 'dist');
const STAMP = 'build-id.json';

function walk(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else if (e.isFile() && r !== STAMP && !r.startsWith(`${STAMP}.`)) out.push(r);
  }
  return out;
}

const h = createHash('sha256');
for (const r of walk(dist).sort()) {
  h.update(r, 'utf8');
  h.update('\0');
  h.update(readFileSync(path.join(dist, r)));
  h.update('\0');
}
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: pkg, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
} catch {
  /* not a git checkout: the stamp still pins the bytes */
}
const version = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
const gui = readFileSync(path.join(pkg, 'src', 'kernel', 'web', 'gui-bundle.ts'), 'utf8').match(/GUI_BUNDLE_HASH[^=]*=\s*['"]([^'"]+)['"]/);
const voiceManifest = path.join(pkg, '..', 'gnomon-voice', 'dist', 'voice-client.manifest.json');
const voiceClientManifest = existsSync(voiceManifest) ? `sha256:${createHash('sha256').update(readFileSync(voiceManifest)).digest('hex')}` : null;
if (!voiceClientManifest) process.stderr.write('build-stamp: no gnomon-voice manifest (build @a-company/gnomon-voice first); this kernel will not start voice\n');
let release = null;
const releaseFile = process.env.GNOMON_RELEASE_MANIFEST;
if (releaseFile) {
  try {
    release = JSON.parse(readFileSync(releaseFile, 'utf8'));
  } catch {
    release = undefined;
  }
  const errors = release === undefined ? ['not readable JSON'] : validateReleaseManifestV1(release);
  if (errors.length) {
    process.stderr.write(`build-stamp: ${releaseFile} is invalid (${errors.join('; ')}); refusing to stamp a release\n`);
    process.exit(1);
  }
} else process.stderr.write('build-stamp: dev build (no release manifest): the kernel pins the helper and voice-io by signature and version floor only\n');
const stamp = { schemaVersion: 'gnomon-build:v1', version, commit, distHash: `sha256:${h.digest('hex')}`, guiBundleHash: gui ? gui[1] : null, voiceClientManifest, ...(release ? { release } : {}) };
const tmp = path.join(dist, `${STAMP}.${process.pid}.tmp`);
writeFileSync(tmp, `${JSON.stringify(stamp)}\n`, { mode: 0o644 });
renameSync(tmp, path.join(dist, STAMP)); // atomic: a polling kernel never reads half a stamp
process.stdout.write(`build-stamp: ${stamp.version} ${stamp.commit} ${stamp.distHash.slice(0, 19)} ${release ? `release ${release.release}` : 'dev'}\n`);
