#!/usr/bin/env node
// Build the signed darwin voice I/O child (#gnomon-voice-io; TD-2026-10-19-298, slice V2b).
//
//   node packages/gnomon-voice/scripts/build-voice-io.mjs             signed (Developer ID, founder's Mac)
//   node packages/gnomon-voice/scripts/build-voice-io.mjs --unsigned  bundle only (CI, any Mac)
//   … [--out <dir>]
//
// The same recipe as packages/gnomon-helper/scripts/build-darwin.mjs, with LEAST PRIVILEGE:
//   - its own identifier `gnomon.voice-io` (never the helper's `gnomon.helper`),
//   - ONE entitlement, com.apple.security.device.audio-input (the hardened runtime blocks the mic without it),
//   - NO keychain-access-groups, NO application-identifier, NO provisioning profile (none is needed
//     for audio-input, so the voice binary cannot claim any team keychain group).
// Steps:
//   1. swift build -c release (SwiftPM, packages/gnomon-voice/io-darwin)
//   2. <out>/GnomonVoiceIO.app/Contents/{MacOS/gnomon-voice-io, Info.plist (NSMicrophoneUsageDescription)}
//   3. codesign --force --options runtime --timestamp --entitlements <ent> --sign <identity sha1> <app>
//      (identity LOOKED UP in the keychain: exactly one "Developer ID Application: … (SW4BMQ8PNL)")
//   4. codesign --verify --strict --deep, then against VOICE_IO_REQUIREMENT; the signed entitlements
//      must be exactly {audio-input: true} and the runtime flag set (anything else fails the build)
//   5. checksums.json: sha256 of the executable (advisory; a release kernel pins the sha256 from packages/gnomon's
//      release manifest, write-release-manifest.mjs, T-2026-10-21-028)
// Notarization is NOT run here; the founder runs notarytool (README).
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_IO_IDENTIFIER, VOICE_IO_REQUIREMENT, VOICE_IO_TEAM } from '@a-company/gnomon-contracts';
import { TEAM, findIdentity, run, sha256File } from '../../gnomon-helper/scripts/signing.mjs';

export const BUNDLE_ID = 'gnomon.voice-io';
export const APP_NAME = 'GnomonVoiceIO.app';
export const EXE_NAME = 'gnomon-voice-io';
export const MIC_USAGE = 'Gnomon voice listens only while the mic is on.';
export const AUDIO_INPUT = 'com.apple.security.device.audio-input';
/**
 * Apple anchor, a Developer ID Application leaf from the Developer ID CA, this team, this identifier: the ONE constant
 * the kernel verifies too (gnomon-contracts; build @a-company/gnomon-contracts first).
 */
export { VOICE_IO_REQUIREMENT };
if (VOICE_IO_IDENTIFIER !== BUNDLE_ID || VOICE_IO_TEAM !== TEAM) throw new Error('gnomon-voice-io build: the shared requirement names another identifier or team');

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  process.stderr.write(`gnomon-voice-io build: ${msg}\n`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('gnomon-voice-io builds on macOS only');

const argv = process.argv.slice(2);
const unsigned = argv.includes('--unsigned');
const outIdx = argv.indexOf('--out');
const outDir = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(PKG_ROOT, 'bin', 'darwin'));
const say = (s) => process.stdout.write(`${s}\n`);

// 1. compile
const swiftDir = path.join(PKG_ROOT, 'io-darwin');
say('swift build -c release …');
const sb = run('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--package-path', swiftDir], { timeout: 600_000 });
if (sb.status !== 0) fail(`swift build failed:\n${(sb.stderr || sb.stdout).slice(-2000)}`);
const binPath = run('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--package-path', swiftDir, '--show-bin-path']).stdout;
const built = path.join(binPath, EXE_NAME);
const version = /gnomon-voice-io (\S+)/.exec(run(built, ['--version']).stdout)?.[1];
if (!version) fail('the built binary does not answer --version');

// 2. bundle (staged in a temp dir, moved into place last: a failed sign never leaves a half-signed app)
const stage = mkdtempSync(path.join(os.tmpdir(), 'gnomon-voice-io-build-'));
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
  <key>CFBundleName</key><string>GnomonVoiceIO</string>
  <key>CFBundleDisplayName</key><string>GnomonVoiceIO</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>${MIC_USAGE}</string>
</dict></plist>
`,
);

let signing = { signed: false };
if (!unsigned) {
  const identity = findIdentity();
  const ent = path.join(stage, 'voice-io.entitlements');
  writeFileSync(
    ent,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>${AUDIO_INPUT}</key><true/>
</dict></plist>
`,
  );
  // 3. sign
  say(`codesign with ${identity.name} …`);
  const cs = run('/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', ent, '--sign', identity.sha1, app], { timeout: 180_000 });
  if (cs.status !== 0) fail(`codesign failed: ${cs.stderr.slice(0, 600)}`);
  // 4. verify
  const v = run('/usr/bin/codesign', ['--verify', '--strict', '--deep', '-vv', app]);
  if (v.status !== 0) fail(`codesign --verify --strict failed: ${v.stderr.slice(0, 600)}`);
  const req = run('/usr/bin/codesign', ['--verify', '--strict', `-R=${VOICE_IO_REQUIREMENT}`, app]);
  if (req.status !== 0) fail(`the signed binary does not satisfy VOICE_IO_REQUIREMENT: ${req.stderr.slice(0, 600)}`);
  const entOut = run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', app]).stdout;
  const keys = [...entOut.matchAll(/<key>([^<]*)<\/key>/g)].map((m) => m[1]);
  if (keys.length !== 1 || keys[0] !== AUDIO_INPUT || !/<true\/>/.test(entOut)) fail(`the signed entitlements are ${JSON.stringify(keys)}, want exactly ["${AUDIO_INPUT}"]`);
  const d = run('/usr/bin/codesign', ['-d', '-vv', app]).stderr;
  if (!/\(runtime\)/.test(d)) fail('the signature lacks the hardened runtime flag');
  signing = {
    signed: true,
    identity: identity.name,
    team: /TeamIdentifier=(\S+)/.exec(d)?.[1] ?? null,
    identifier: /Identifier=(\S+)/.exec(d)?.[1] ?? null,
    entitlements: [AUDIO_INPUT],
    runtime: true,
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
  schema: 'gnomon-voice-checksums:v1',
  note: 'sha256 per built voice executable; written by scripts/build-voice-io.mjs. ADVISORY: the kernel does not read this file; a release kernel pins the voice-io sha256 from its release manifest (packages/gnomon/scripts/write-release-manifest.mjs) on top of the code-signing requirement and the version floor. A timestamped signature changes the sha on every build.',
  binaries: { ...(checksums.binaries ?? {}), [rel]: { sha256: sha256File(destExe), version, ...signing } },
};
writeFileSync(checksumsFile, `${JSON.stringify(checksums, null, 2)}\n`);
say(JSON.stringify({ app: dest, version, ...signing }, null, 2));
