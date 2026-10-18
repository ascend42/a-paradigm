#!/usr/bin/env node
// Build the signed darwin helper (#gnomon-helper, spec §16, §18; M1.3 slice 1).
//
//   node packages/gnomon-helper/scripts/build-darwin.mjs            signed (Developer ID, founder's Mac)
//   node packages/gnomon-helper/scripts/build-darwin.mjs --unsigned bundle only (CI, any Mac)
//   … [--out <dir>] [--profile <path>]
//
// Steps (the recipe probe P04 proved, packages/gnomon/probes/_shared/signing.mjs):
//   1. swift build -c release (SwiftPM, packages/gnomon-helper/darwin)
//   2. <out>/GnomonHelper.app/Contents/{MacOS/gnomon-helper, Info.plist, embedded.provisionprofile}
//   3. codesign --force --options runtime --timestamp --entitlements <ent> --sign <identity sha1> <app>
//      (the identity is LOOKED UP in the keychain: exactly one "Developer ID Application: … (SW4BMQ8PNL)")
//   4. codesign --verify --strict --deep, then --verify against HELPER_REQUIREMENT
//      (the same requirement the kernel checks at spawn)
//   5. checksums.json: sha256 of the executable (the kernel pins it at spawn)
// Notarization is a separate, optional step: scripts/notarize-darwin.mjs.
// Never run by tests and never in CI with --unsigned off (no identity there).
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ACCESS_GROUP, APP_ID, APP_NAME, BUNDLE_ID, EXE_NAME, HELPER_REQUIREMENT, PKG_ROOT, PROFILE_PATH, TEAM, checkProfile, fail, findIdentity, run, sha256File } from './signing.mjs';

if (process.platform !== 'darwin') fail('the darwin helper builds on macOS only');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const unsigned = flag('--unsigned');
const outDir = path.resolve(value('--out') ?? path.join(PKG_ROOT, 'bin', 'darwin'));
const profilePath = value('--profile') ?? PROFILE_PATH;

const say = (s) => process.stdout.write(`${s}\n`);

// 1. compile
const swiftDir = path.join(PKG_ROOT, 'darwin');
say('swift build -c release …');
const sb = run('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--package-path', swiftDir], { timeout: 600_000 });
if (sb.status !== 0) fail(`swift build failed:\n${(sb.stderr || sb.stdout).slice(-2000)}`);
const binPath = run('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--package-path', swiftDir, '--show-bin-path']).stdout;
const built = path.join(binPath, EXE_NAME);
const version = /gnomon-helper (\S+)/.exec(run(built, ['--version']).stdout)?.[1];
if (!version) fail('the built helper does not answer --version');

// 2. bundle (built in a temp dir, moved into place last, so a failed sign never leaves a half-signed app)
const stage = mkdtempSync(path.join(os.tmpdir(), 'gnomon-helper-build-'));
const app = path.join(stage, APP_NAME);
mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
const exe = path.join(app, 'Contents', 'MacOS', EXE_NAME);
copyFileSync(built, exe);
chmodSync(exe, 0o755);
writeFileSync(
  path.join(app, 'Contents', 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>${EXE_NAME}</string>
  <key>CFBundleName</key><string>Gnomon Helper</string>
  <key>CFBundleDisplayName</key><string>Gnomon Helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`,
);

let signing = { signed: false };
if (!unsigned) {
  const identity = findIdentity();
  const profile = checkProfile(profilePath);
  copyFileSync(profile.path, path.join(app, 'Contents', 'embedded.provisionprofile'));
  const ent = path.join(stage, 'helper.entitlements');
  writeFileSync(
    ent,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.application-identifier</key><string>${APP_ID}</string>
  <key>com.apple.developer.team-identifier</key><string>${TEAM}</string>
  <key>keychain-access-groups</key><array><string>${ACCESS_GROUP}</string></array>
</dict></plist>
`,
  );
  // 3. sign
  say(`codesign with ${identity.name} …`);
  const cs = run('/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', ent, '--sign', identity.sha1, app], { timeout: 180_000 });
  if (cs.status !== 0) fail(`codesign failed: ${cs.stderr.slice(0, 600)}`);
  // 4. verify (strict, then the kernel's own requirement)
  const v = run('/usr/bin/codesign', ['--verify', '--strict', '--deep', '-vv', app]);
  if (v.status !== 0) fail(`codesign --verify --strict failed: ${v.stderr.slice(0, 600)}`);
  const req = run('/usr/bin/codesign', ['--verify', '--strict', `-R=${HELPER_REQUIREMENT}`, app]);
  if (req.status !== 0) fail(`the signed helper does not satisfy the kernel's requirement: ${req.stderr.slice(0, 600)}`);
  const d = run('/usr/bin/codesign', ['-d', '-vv', app]).stderr;
  signing = {
    signed: true,
    identity: identity.name,
    team: /TeamIdentifier=(\S+)/.exec(d)?.[1] ?? null,
    identifier: /Identifier=(\S+)/.exec(d)?.[1] ?? null,
    profileSha256: profile.sha256.slice(0, 16),
    profileExpires: profile.expires,
  };
}

// move into place
mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, APP_NAME);
rmSync(dest, { recursive: true, force: true });
const mv = run('/bin/mv', [app, dest]);
if (mv.status !== 0) fail(`could not move the bundle into ${outDir}: ${mv.stderr}`);
rmSync(stage, { recursive: true, force: true });

// 5. checksums
const destExe = path.join(dest, 'Contents', 'MacOS', EXE_NAME);
const rel = path.relative(PKG_ROOT, destExe).split(path.sep).join('/');
const checksumsFile = path.join(PKG_ROOT, 'checksums.json');
let checksums;
try {
  checksums = JSON.parse(readFileSync(checksumsFile, 'utf8'));
} catch {
  checksums = {};
}
checksums = {
  schema: 'gnomon-helper-checksums:v1',
  note: 'sha256 per built helper executable; written by scripts/build-darwin.mjs. The kernel pins the executable by its code-signing requirement and this sha256 at spawn (G-HLP-01).',
  binaries: { ...(checksums.binaries ?? {}), [rel]: { sha256: sha256File(destExe), version, ...signing } },
};
writeFileSync(checksumsFile, `${JSON.stringify(checksums, null, 2)}\n`);
say(JSON.stringify({ app: dest, version, ...signing }, null, 2));
