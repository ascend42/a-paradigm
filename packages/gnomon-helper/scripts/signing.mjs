// Shared by build-darwin.mjs and notarize-darwin.mjs (#gnomon-helper, spec
// §16, §18; M1.3 slice 1). ZERO deps. Reads (never writes, never prints) the
// founder's signing material: the Developer ID identity in the login
// keychain (looked up, never hardcoded), the provisioning profile at
// ~/.config/gnomon-signing/gnomon-helper.provisionprofile and the notarytool
// keychain profile `gnomon-notary`. Nothing secret is printed: only names,
// ids, hashes and dates.
//
// The identity shape is the one probe P04 proved on the founder's Mac:
// bundle id gnomon.helper, team SW4BMQ8PNL, keychain access group
// SW4BMQ8PNL.gnomon, hardened runtime, the profile embedded in a .app.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEAM = 'SW4BMQ8PNL';
export const BUNDLE_ID = 'gnomon.helper';
export const APP_ID = `${TEAM}.${BUNDLE_ID}`;
/** Production keys only (Aegis H1): the probe helper uses `${TEAM}.gnomon.probe`, never this group. */
export const ACCESS_GROUP = `${TEAM}.gnomon.prod`;
export const APP_NAME = 'GnomonHelper.app';
export const EXE_NAME = 'gnomon-helper';
export const PROFILE_PATH = path.join(os.homedir(), '.config/gnomon-signing/gnomon-helper.provisionprofile');
export const NOTARY_PROFILE = 'gnomon-notary';

/**
 * The code-signing requirement the kernel checks at spawn (kept identical to
 * packages/gnomon/src/kernel/identity/helper.ts HELPER_REQUIREMENT): Apple
 * anchor, a Developer ID Application leaf issued by the Developer ID CA, this
 * team, this identifier.
 */
export const HELPER_REQUIREMENT =
  `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}" and identifier "${BUNDLE_ID}"`;

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 120_000, input: opts.input, cwd: opts.cwd });
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim(), timedOut: r.error?.code === 'ETIMEDOUT' };
}

export function fail(msg) {
  process.stderr.write(`gnomon-helper build: ${msg}\n`);
  process.exit(1);
}

/**
 * Every valid "Developer ID Application: … (SW4BMQ8PNL)" identity in the keychain, de-duplicated (never exits).
 * `null` when `security find-identity` itself fails (no keychain access, not macOS). Shared with
 * packages/gnomon/scripts/build-sea.mjs, whose `--sign auto` falls back to ad-hoc when this is empty.
 */
export function listIdentities() {
  const r = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
  if (r.status !== 0) return null;
  const found = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(Developer ID Application: [^"]+ \(([A-Z0-9]{10})\))"/.exec(line);
    if (m && m[3] === TEAM) found.push({ sha1: m[1], name: m[2] });
  }
  return [...new Map(found.map((f) => [f.sha1, f])).values()];
}

/** Exactly one valid "Developer ID Application: … (SW4BMQ8PNL)" identity; returns its SHA-1 (public cert hash) and name. */
export function findIdentity() {
  const unique = listIdentities();
  if (unique === null) fail('security find-identity failed');
  if (unique.length === 0) fail(`no valid "Developer ID Application: … (${TEAM})" identity in the keychain`);
  if (unique.length > 1) fail(`more than one Developer ID Application identity for ${TEAM}; remove the stale one (${unique.map((u) => u.sha1.slice(0, 8)).join(', ')})`);
  return unique[0];
}

/** The provisioning profile: decoded, checked for this App ID, the access group and expiry. */
export function checkProfile(file = PROFILE_PATH) {
  if (!existsSync(file)) fail(`no provisioning profile at ${file.replace(os.homedir(), '~')}`);
  const cms = run('/usr/bin/security', ['cms', '-D', '-i', file]);
  if (cms.status !== 0) fail('security cms could not decode the provisioning profile');
  const x = (key, fmt) => run('/usr/bin/plutil', ['-extract', key, fmt, '-o', '-', '-'], { input: cms.stdout }).stdout;
  const xml = x('Entitlements', 'xml1');
  const str = (k) => (xml.match(new RegExp(`<key>${k.replace(/\./g, '\\.')}</key>\\s*<string>([^<]*)</string>`)) ?? [])[1];
  const m = xml.match(/<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/);
  const groups = m ? [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((s) => s[1]) : [];
  const appId = str('com.apple.application-identifier');
  const expiresRaw = x('ExpirationDate', 'raw');
  const expires = expiresRaw ? new Date(expiresRaw) : null;
  if (appId !== APP_ID) fail(`the profile is for ${appId ?? '(none)'}, not ${APP_ID}`);
  // Aegis H1 (d): never sign for the team wildcard. The entitlements we sign with name ONLY ${ACCESS_GROUP};
  // the profile must allow it, explicitly (preferred) or through the team wildcard, which Developer ID
  // profiles always carry — recorded as groupGrant so the build output says which one it was.
  const explicit = groups.includes(ACCESS_GROUP);
  const wildcard = groups.includes(`${TEAM}.*`);
  if (!explicit && !wildcard) fail(`the profile does not grant the keychain access group ${ACCESS_GROUP}`);
  if (!explicit) process.stderr.write(`gnomon-helper build: WARNING the profile grants keychain groups only through the team wildcard ${TEAM}.*; any binary this team signs with a profile may claim ${ACCESS_GROUP} (see README: separate App ID)\n`);
  if (expires && !(expires > new Date())) fail(`the profile expired at ${expires.toISOString()}`);
  return { path: file, appId, groups, groupGrant: explicit ? 'explicit' : 'team-wildcard', expires: expires?.toISOString() ?? null, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
