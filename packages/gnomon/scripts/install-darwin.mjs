#!/usr/bin/env node
// #bare-entry installer (spec §2.4 rule 8): put `gnomon` on PATH from THIS clone, idempotently.
//   node packages/gnomon/scripts/install-darwin.mjs [--no-build]      (or: npm run gnomon:install)
// 1. refuses when NODE_OPTIONS is set (the kernel would refuse it anyway: `unsafe-env`) or node is older than 22.14;
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

/** Null when the runtime is fit to install from; else why not. */
export function runtimeProblem(env = process.env, version = process.versions.node) {
  if (env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS.trim() !== '') return 'NODE_OPTIONS is set: gnomon refuses to run its kernel under it (unsafe-env). Run `unset NODE_OPTIONS` (and remove it from your shell profile), then run this again';
  const [maj, min] = version.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 14)) return `node ${version} is too old: gnomon needs node 22.14 or later (for --disable-sigusr1)`;
  return null;
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
    process.stderr.write(`REFUSED  INSTALL  unsafe-env\n  ${bad}\n`);
    return 1;
  }
  if (build) {
    process.stdout.write('building: npm run build:gnomon\n');
    execFileSync('npm', ['run', 'build:gnomon'], { cwd: REPO, stdio: 'inherit' });
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
  const onPath = (process.env.PATH ?? '').split(path.delimiter).find((d) => fs.existsSync(path.join(d, 'gnomon')));
  if (onPath && onPath !== r.dir) process.stdout.write(`  note: ${path.join(onPath, 'gnomon')} comes first on your PATH and is not this link\n`);
  else if (!onPath) process.stdout.write(`  note: ${r.dir} is not on your PATH; add it to your shell profile\n`);
  process.stdout.write(`\n${NEXT_STEPS}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync.native(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
