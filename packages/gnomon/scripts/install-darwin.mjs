#!/usr/bin/env node
// #bare-entry installer (spec §2.4 rule 8): put `gnomon` on PATH from THIS clone, idempotently.
//   node packages/gnomon/scripts/install-darwin.mjs [--no-build]      (or: npm run gnomon:install)
// 1. refuses when NODE_OPTIONS is set (the kernel would refuse it anyway: `unsafe-env`) or node is older than 24 (NODE_MAJOR_FLOOR);
// 2. runs `npm run build:gnomon` at the repo root (skip with --no-build);
// 3. links `gnomon` → packages/gnomon/dist/cli/gnomon.js in the first writable of /opt/homebrew/bin, /usr/local/bin.
//    An existing link to this clone's bin is left as is; a link elsewhere or a non-symlink is REFUSED (said so,
//    never overwritten); no sudo;
// 4. prints the next steps. It never reads or writes ~/.gnomon or any key.
// Zero deps (like the kernel). Exit 0 = linked or already linked; 1 = refused; 64 = usage.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(PKG, '..', '..');
export const BIN_DIRS = Object.freeze(['/opt/homebrew/bin', '/usr/local/bin']);

/**
 * The ONE Node floor for a dev/source install: 24. Kept equal to NODE_MAJOR_FLOOR in src/kernel/setup/preflight.ts
 * (test/install-darwin.test.ts pins the two together). --disable-sigusr1 alone would allow 22.14+/23.7+, but the
 * kernel is built (tsup target node24) and type-checked (@types/node 24) for Node 24 and every Gnomon package
 * declares engines >=24, so nothing guarantees a 22.x runtime has the APIs it uses. A zero-build release bundles its
 * own pinned Node (TD-2026-10-21-758), so this floor only gates source installs.
 */
export const NODE_MAJOR_FLOOR = 24;

/** True when node is at or above the floor (every 24+ also has --disable-sigusr1). */
export function nodeFloorOk(version) {
  return Number(version.split('.')[0]) >= NODE_MAJOR_FLOOR;
}

/** Null when the runtime is fit to install from; else {reason, message}. */
export function runtimeProblem(env = process.env, version = process.versions.node) {
  if (env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS.trim() !== '') return { reason: 'unsafe-env', message: 'NODE_OPTIONS is set: gnomon refuses to run its kernel under it (unsafe-env). Run `unset NODE_OPTIONS` (and remove it from your shell profile), then run this again' };
  if (!nodeFloorOk(version)) return { reason: 'node-too-old', message: `node ${version} is too old: gnomon from source needs node ${NODE_MAJOR_FLOOR} or later` };
  return null;
}

/** A directory as a comparable key: resolved, trailing separators dropped, realpath'd when it exists. */
export function dirKey(d) {
  const r = path.resolve(d);
  try {
    return fs.realpathSync.native(r);
  } catch {
    return r;
  }
}

/** The first PATH directory holding a `gnomon` that is NOT `dir` (compared as dirKey), or null. */
export function shadowingDir(dir, pathVar = process.env.PATH ?? '') {
  const want = dirKey(dir);
  for (const d of pathVar.split(path.delimiter).filter(Boolean)) {
    if (!fs.existsSync(path.join(d, 'gnomon'))) continue;
    return dirKey(d) === want ? null : d;
  }
  return null;
}

/** True when `dir` (as dirKey) is on PATH. */
export function onPath(dir, pathVar = process.env.PATH ?? '') {
  const want = dirKey(dir);
  return pathVar.split(path.delimiter).filter(Boolean).some((d) => dirKey(d) === want);
}

/**
 * Decide and make the link. Returns {ok, dir, link, action: 'linked'|'already'} or {ok:false, message}.
 * Never overwrites anything: a non-symlink or a symlink to another target is refused.
 */
export function placeLink(target, dirs = BIN_DIRS) {
  const real = fs.realpathSync.native(target);
  const writable = dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory() && (fs.accessSync(d, fs.constants.W_OK), true);
    } catch {
      return false;
    }
  });
  // an existing link in ANY candidate dir is checked first: a second link elsewhere would shadow or be shadowed
  for (const d of dirs) {
    const link = path.join(d, 'gnomon');
    let st;
    try {
      st = fs.lstatSync(link);
    } catch {
      continue;
    }
    if (!st.isSymbolicLink()) return { ok: false, message: `${link} exists and is not a symlink; it was left alone. Remove it yourself if it is an old gnomon, then run this again` };
    let to;
    try {
      to = fs.realpathSync.native(link);
    } catch {
      to = path.resolve(d, fs.readlinkSync(link));
    }
    if (to === real) return { ok: true, dir: d, link, action: 'already' };
    return { ok: false, message: `${link} already points to ${to}, not this clone's ${real}; it was left alone. Remove it yourself (rm ${link}) if you mean to switch clones, then run this again` };
  }
  if (writable.length === 0) return { ok: false, message: `none of ${dirs.join(', ')} is a writable directory (this script does not use sudo). Link it yourself: ln -s ${real} <a directory on your PATH>/gnomon` };
  const link = path.join(writable[0], 'gnomon');
  fs.symlinkSync(real, link);
  return { ok: true, dir: writable[0], link, action: 'linked' };
}

/** The text for a failed build: a refusal and a next step, never a stack trace. */
export function buildRefusal(e) {
  const how = e && typeof e.status === 'number' ? `exit ${e.status}` : e && e.code ? String(e.code) : 'failed';
  return `REFUSED  INSTALL  build\n  npm run build:gnomon ${how} (its output is above)\n  next: fix the build error above (often: npm ci), then run this again\n`;
}

export const NEXT_STEPS = `next steps (once):
  1. the signed Secure Enclave helper:   node packages/gnomon-helper/scripts/build-darwin.mjs
  2. optional hardware test, BEFORE identity init:
       cd packages/gnomon && GNOMON_HW_TESTS=1 npx vitest run test/identity-hw.test.ts && cd ../..
  3. your identity (two Touch ID prompts): gnomon identity init --name <you>
  4. use it: cd into a repo and type   gnomon
     or build the app: node packages/gnomon-wrapper/scripts/build-darwin.mjs   (packages/gnomon-wrapper/README.md)
after every git pull: run this again, then rebuild Gnomon.app (it pins node and the kernel dist)
after Claude Code updates itself: gnomon session repin-claude`;

function main(argv) {
  const build = !argv.includes('--no-build');
  const unknown = argv.filter((a) => a !== '--no-build');
  if (unknown.length) {
    process.stderr.write(`install-darwin: unknown argument(s): ${unknown.length}\nusage: node packages/gnomon/scripts/install-darwin.mjs [--no-build]\n`);
    return 64;
  }
  if (process.platform !== 'darwin') process.stderr.write('install-darwin: this installer is written for macOS; continuing (the kernel runs on linux without the GUI launch)\n');
  const bad = runtimeProblem();
  if (bad) {
    process.stderr.write(`REFUSED  INSTALL  ${bad.reason}\n  ${bad.message}\n`);
    return 1;
  }
  if (build) {
    process.stdout.write('building: npm run build:gnomon\n');
    try {
      execFileSync('npm', ['run', 'build:gnomon'], { cwd: REPO, stdio: 'inherit' });
    } catch (e) {
      process.stderr.write(buildRefusal(e));
      return 1;
    }
  }
  const target = path.join(PKG, 'dist', 'cli', 'gnomon.js');
  if (!fs.existsSync(target)) {
    process.stderr.write(`REFUSED  INSTALL  not-built\n  ${target} does not exist\n  next: npm run build:gnomon\n`);
    return 1;
  }
  fs.chmodSync(target, 0o755);
  const r = placeLink(target);
  if (!r.ok) {
    process.stderr.write(`REFUSED  INSTALL  link\n  ${r.message}\n`);
    return 1;
  }
  process.stdout.write(`${r.action === 'linked' ? 'LINKED' : 'ALREADY LINKED'}  ${r.link} -> ${fs.realpathSync.native(target)}\n`);
  const shadow = shadowingDir(r.dir);
  if (shadow) process.stdout.write(`  note: ${path.join(shadow, 'gnomon')} comes first on your PATH and is not this link\n`);
  else if (!onPath(r.dir)) process.stdout.write(`  note: ${r.dir} is not on your PATH; add it to your shell profile\n`);
  process.stdout.write(`\n${NEXT_STEPS}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync.native(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
