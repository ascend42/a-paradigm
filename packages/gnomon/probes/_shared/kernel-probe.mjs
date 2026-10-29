// Shared by the S0 probes p15-sea-peertoken, p16-se-ephemeral, p17-se-afterfirstunlock (TD-2026-10-29-746).
// ZERO deps beyond the repo's own scripts. Builds _shared/kernel/KernelProbe.swift into a temp dir, optionally
// signs it (Developer ID from the keychain) or wraps it in a .app with the provisioning profile, and builds the
// probe SEA (identifier gnomon.kernel.probe, never gnomon.kernel: a probe binary must not pass the kernel's own
// requirement, Aegis H1). GNOMON_PROBE_ADHOC=1 forces ad-hoc everywhere (the agent-run half; a `partial` verdict).
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkIdentity, checkProfile, IDENTITY, PROFILE_PATH, run, TEAM } from './signing.mjs';

const SHARED = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(SHARED, '..', '..', 'scripts');
export const PROBE_SEA_IDENTIFIER = 'gnomon.kernel.probe';
export const PROBE_GROUP = `${TEAM}.gnomon.probe`;
export const PROBE_APP_ID = `${TEAM}.gnomon.helper`;
export const adhocForced = () => process.env.GNOMON_PROBE_ADHOC === '1';

/** Whether this run may sign with the Developer ID (present, and not forced ad-hoc). */
export function signingAvailable() {
  if (adhocForced()) return { signed: false, why: 'GNOMON_PROBE_ADHOC=1' };
  const id = checkIdentity();
  return id.present ? { signed: true, identity: IDENTITY } : { signed: false, why: `no "${IDENTITY}" in the keychain` };
}

export function workDir(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `gnomon-${tag}-`));
}

/** swiftc KernelProbe.swift → <dir>/<name> (the linker's ad-hoc signature only). */
export function buildTool(dir, name = 'kernel-probe') {
  const exe = path.join(dir, name);
  const r = run('/usr/bin/xcrun', ['swiftc', '-O', path.join(SHARED, 'kernel', 'KernelProbe.swift'), '-o', exe], { timeout: 300_000 });
  if (r.status !== 0) throw new Error(`swiftc failed: ${r.stderr.slice(0, 600)}`);
  return exe;
}

/** codesign a bare binary: Developer ID + hardened runtime + timestamp, no entitlements (or ad-hoc). */
export function signBare(file, identifier, signed) {
  const args = ['--force', '--options', 'runtime', ...(signed ? ['--timestamp'] : []), '--identifier', identifier, '--sign', signed ? IDENTITY : '-', file];
  const r = run('/usr/bin/codesign', args, { timeout: 120_000 });
  if (r.status !== 0) throw new Error(`codesign ${file}: ${r.stderr.slice(0, 400)}`);
}

/** The tool inside a .app (bundle id gnomon.probe) with the profile embedded and the probe keychain group. */
export function buildProbeApp(dir, toolExe) {
  const app = path.join(dir, 'GnomonKernelProbe.app');
  const macos = path.join(app, 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  const exe = path.join(macos, 'kernel-probe');
  copyFileSync(toolExe, exe);
  writeFileSync(
    path.join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>CFBundleIdentifier</key><string>gnomon.probe</string>\n  <key>CFBundleExecutable</key><string>kernel-probe</string>\n  <key>CFBundlePackageType</key><string>APPL</string>\n  <key>CFBundleShortVersionString</key><string>0.0.0-probe</string>\n  <key>CFBundleVersion</key><string>1</string>\n  <key>LSUIElement</key><true/>\n</dict></plist>\n`,
  );
  copyFileSync(PROFILE_PATH, path.join(app, 'Contents', 'embedded.provisionprofile'));
  const ent = path.join(dir, 'probe.entitlements');
  writeFileSync(ent, `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n  <key>com.apple.application-identifier</key><string>${PROBE_APP_ID}</string>\n  <key>com.apple.developer.team-identifier</key><string>${TEAM}</string>\n  <key>keychain-access-groups</key><array><string>${PROBE_GROUP}</string></array>\n</dict></plist>\n`);
  const r = run('/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', ent, '--sign', IDENTITY, app], { timeout: 120_000 });
  if (r.status !== 0) throw new Error(`codesign ${app}: ${r.stderr.slice(0, 400)}`);
  return { app, exe };
}

/** The probe SEA: build-sea.mjs's own pipeline (same base node, sea-config, flags) with a probe main and identifier. */
export async function buildProbeSea(dir, mainCjs, signed) {
  const sea = await import(pathToFileURL(path.join(SCRIPTS, 'build-sea.mjs')).href);
  const work = path.join(dir, 'sea-work');
  mkdirSync(work, { recursive: true });
  const base = await sea.pinnedBaseNode({ work });
  const out = path.join(dir, 'probe.kernel');
  const built = await sea.buildSeaBinary({ baseNode: base.node, main: mainCjs, out, identifier: PROBE_SEA_IDENTIFIER, identity: signed ? (await sea.resolveSigning('auto')).identity : '-', work });
  return { sea: out, baseNode: base.node, built };
}

/** One JSON line from a command (the tool and the probe SEA print one). */
export function json(cmd, args, opts = {}) {
  const r = run(cmd, args, { timeout: opts.timeout ?? 60_000 });
  let j = null;
  try {
    j = JSON.parse(r.stdout.split('\n').pop());
  } catch {
    // not JSON
  }
  return { status: r.status, json: j, stderr: r.stderr ? r.stderr.slice(0, 400) : undefined };
}

export { checkIdentity, checkProfile, rmSync };
