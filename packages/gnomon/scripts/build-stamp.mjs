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
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(pkg, 'dist');
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
const stamp = { schemaVersion: 'gnomon-build:v1', version, commit, distHash: `sha256:${h.digest('hex')}`, guiBundleHash: gui ? gui[1] : null, voiceClientManifest };
const tmp = path.join(dist, `${STAMP}.${process.pid}.tmp`);
writeFileSync(tmp, `${JSON.stringify(stamp)}\n`, { mode: 0o644 });
renameSync(tmp, path.join(dist, STAMP)); // atomic: a polling kernel never reads half a stamp
process.stdout.write(`build-stamp: ${stamp.version} ${stamp.commit} ${stamp.distHash.slice(0, 19)}\n`);
