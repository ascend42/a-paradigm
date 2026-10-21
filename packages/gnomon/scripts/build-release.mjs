#!/usr/bin/env node
/**
 * @symbol #release-pins
 *
 * `npm run build:release` (T-2026-10-21-028, TD-2026-10-21-758; Aegis M1 review): build a kernel whose helper and
 * voice-io pins are COMPILED IN.
 *   1. tsup (a dev build: its dist/index.js names the requirements and floors this kernel enforces);
 *   2. scripts/write-release-manifest.mjs from the signed bin/ outputs (codesign -R, --version ≥ floor, sha256, arch);
 *   3. tsup again with GNOMON_RELEASE_MANIFEST set: tsup.config.ts defines __GNOMON_RELEASE__ = true and
 *      __GNOMON_RELEASE_MANIFEST__ (src/kernel/lifecycle/release-pins.ts reads only those);
 *   4. scripts/build-stamp.mjs, which copies the manifest into the stamp for status only.
 * Any failing step fails the build. Every argument except --out-dir is passed to write-release-manifest.mjs
 * (--helper, --voice-io, --arch, --release, --no-codesign for tests). --out-dir <dir> builds somewhere other than
 * dist (tests). The manifest is written to a private temp dir that is removed afterwards: it then lives only in the
 * bundle (the pins) and the stamp (informational).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const o = argv.indexOf('--out-dir');
const outDir = o >= 0 ? path.resolve(argv[o + 1]) : path.join(PKG, 'dist');
const pass = o >= 0 ? [...argv.slice(0, o), ...argv.slice(o + 2)] : argv;
const tsup = path.join(path.dirname(fileURLToPath(import.meta.resolve('tsup/package.json'))), 'dist', 'cli-default.js');

function step(name, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd: PKG, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${name} failed (exit ${r.status ?? r.signal})`);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'gnomon-release-'));
const manifest = path.join(tmp, 'release-manifest.json');
try {
  step('tsup (dev pass)', [tsup, '--out-dir', outDir], { GNOMON_RELEASE_MANIFEST: '' });
  step('write-release-manifest', [path.join(PKG, 'scripts', 'write-release-manifest.mjs'), '--out', manifest, '--dist', outDir, ...pass]);
  step('tsup (release pass)', [tsup, '--out-dir', outDir], { GNOMON_RELEASE_MANIFEST: manifest });
  step('build-stamp', [path.join(PKG, 'scripts', 'build-stamp.mjs'), '--dist', outDir], { GNOMON_RELEASE_MANIFEST: manifest });
} catch (e) {
  process.stderr.write(`build-release: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
