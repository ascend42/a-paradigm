#!/usr/bin/env node
// Build and sign Gnomon.app (#gnomon-wrapper, spec §11.1, §16, §18; M1.13; OPEN 1).
// Mirrors packages/gnomon-helper/scripts/build-darwin.mjs and reuses its
// signing.mjs: the Developer ID identity is LOOKED UP in the login keychain
// (never hardcoded, never printed beyond its name and a short hash).
//
//   node packages/gnomon-wrapper/scripts/build-darwin.mjs              signed (Developer ID, hardened runtime)
//   node packages/gnomon-wrapper/scripts/build-darwin.mjs --unsigned   dev build: ad-hoc signature only
//
// Steps:
//   1. checks packages/gnomon/dist/cli/gnomon.js exists (the kernel the app runs);
//   2. `cargo tauri build --bundles app --no-sign` (release: no devtools);
//   3. codesign --force --options runtime --timestamp --entitlements Entitlements.plist
//      --sign <identity sha1> Gnomon.app   (or `--sign -` with --unsigned);
//   4. codesign --verify --strict --deep, then the WRAPPER_REQUIREMENT check.
// Build-time records compiled into the binary (build.rs): the node path
// (GNOMON_WRAPPER_NODE, else the realpath of `which node`) and the absolute
// kernel package (GNOMON_WRAPPER_GNOMON_PKG, else this checkout's packages/gnomon), each with its hash. Notarize with
// scripts/notarize-darwin.mjs afterwards.
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM, findIdentity, run } from '../../gnomon-helper/scripts/signing.mjs';

export const BUNDLE_ID = 'gnomon.wrapper';
export const APP_NAME = 'Gnomon.app';
/** Apple anchor, a Developer ID Application leaf, this team, this identifier. */
export const WRAPPER_REQUIREMENT = `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}" and identifier "${BUNDLE_ID}"`;
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_PATH = path.join(PKG_ROOT, 'target', 'release', 'bundle', 'macos', APP_NAME);

const say = (m) => process.stdout.write(`gnomon-wrapper build: ${m}\n`);
function fail(m) {
  process.stderr.write(`gnomon-wrapper build: ${m}\n`);
  process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.platform !== 'darwin') fail('this script builds the macOS app; the Windows wrapper is the parity phase');
  const unsigned = process.argv.includes('--unsigned');
  const js = path.join(process.env.GNOMON_WRAPPER_GNOMON_PKG ?? path.resolve(PKG_ROOT, '..', 'gnomon'), 'dist', 'cli', 'gnomon.js');
  if (!existsSync(js)) fail(`${js} is missing: run \`npm run build:gnomon\` first (the app runs this kernel)`);

  const cargoBin = path.join(process.env.HOME ?? '', '.cargo', 'bin');
  const cargo = existsSync(path.join(cargoBin, 'cargo')) ? path.join(cargoBin, 'cargo') : 'cargo';
  const env = { ...process.env, PATH: `${cargoBin}:${process.env.PATH ?? ''}` };
  say('cargo tauri build --bundles app --no-sign (release) …');
  const b = spawnSync(cargo, ['tauri', 'build', '--bundles', 'app', '--no-sign'], { cwd: PKG_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'], timeout: 1_800_000 });
  if (b.status !== 0) fail('cargo tauri build failed (output above)');
  if (!existsSync(APP_PATH)) fail(`no ${APP_PATH} after the build`);

  const ent = path.join(PKG_ROOT, 'Entitlements.plist');
  let signWith = '-';
  if (!unsigned) {
    const identity = findIdentity();
    signWith = identity.sha1;
    say(`codesign with ${identity.name} (${identity.sha1.slice(0, 8)}) …`);
  } else say('UNSIGNED dev build: ad-hoc signature only (Gatekeeper will refuse it outside this Mac)');
  const cs = run('/usr/bin/codesign', ['--force', '--options', 'runtime', ...(unsigned ? [] : ['--timestamp']), '--entitlements', ent, '--sign', signWith, APP_PATH], { timeout: 180_000 });
  if (cs.status !== 0) fail(`codesign failed: ${cs.stderr.slice(0, 600)}`);
  const v = run('/usr/bin/codesign', ['--verify', '--strict', '--deep', '-vv', APP_PATH]);
  if (v.status !== 0) fail(`codesign --verify --strict failed: ${v.stderr.slice(0, 600)}`);
  if (!unsigned) {
    const req = run('/usr/bin/codesign', ['--verify', '--strict', `-R=${WRAPPER_REQUIREMENT}`, APP_PATH]);
    if (req.status !== 0) fail(`the app does not meet the wrapper requirement: ${req.stderr.slice(0, 400)}`);
  }
  const ents = run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', APP_PATH]).stdout;
  if (/<key>/.test(ents)) fail(`the app carries entitlements; the wrapper signs with none: ${ents.slice(0, 300)}`);
  const d = run('/usr/bin/codesign', ['-d', '-vv', APP_PATH]).stderr;
  const field = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(d) ?? [])[1] ?? null;
  process.stdout.write(
    `${JSON.stringify({ app: APP_PATH, signed: !unsigned, identifier: field('Identifier'), teamIdentifier: field('TeamIdentifier'), runtime: /flags=.*runtime/.test(d), kernel: js, next: unsigned ? 'dev build: open it from Finder with right-click Open' : 'node packages/gnomon-wrapper/scripts/notarize-darwin.mjs' }, null, 2)}\n`,
  );
}
