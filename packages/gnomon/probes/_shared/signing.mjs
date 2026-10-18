// Shared by the founder-run signing probes p00-sign-notary, p04-se-helper,
// p05-keychain-acl. ZERO deps. Reads (never writes) the founder's signing
// material: the Developer ID identity in the login keychain, the provisioning
// profile at ~/.config/gnomon-signing/gnomon-helper.provisionprofile, and the
// notarytool keychain profile `gnomon-notary`. Nothing secret is returned:
// only presence, ids, dates and hashes.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runCleanups } from './abort.mjs';

const SHARED = path.dirname(fileURLToPath(import.meta.url));
export const TEAM = 'SW4BMQ8PNL';
export const BUNDLE_ID = 'gnomon.helper';
export const APP_ID = `${TEAM}.${BUNDLE_ID}`;
export const ACCESS_GROUP = `${TEAM}.gnomon`;
export const IDENTITY = `Developer ID Application: Matthew Canoy (${TEAM})`;
export const PROFILE_PATH = path.join(os.homedir(), '.config/gnomon-signing/gnomon-helper.provisionprofile');
export const NOTARY_PROFILE = 'gnomon-notary';
export const SEE = 'see docs/private/gnomon-founder-steps.html section 1';

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 60_000, input: opts.input, env: opts.env ?? process.env });
  return { status: r.status, signal: r.signal, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim(), timedOut: r.error?.code === 'ETIMEDOUT' };
}

export function checkIdentity() {
  const r = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
  return { present: r.stdout.includes(`"${IDENTITY}"`), identity: IDENTITY };
}

export function checkProfile() {
  if (!existsSync(PROFILE_PATH)) return { present: false, path: PROFILE_PATH.replace(os.homedir(), '~') };
  const cms = run('/usr/bin/security', ['cms', '-D', '-i', PROFILE_PATH]);
  if (cms.status !== 0) return { present: true, valid: false, error: cms.stderr.slice(0, 300) };
  // The profile carries <data>/<date> values, so extract keys one at a time
  // (Entitlements is strings/arrays only and converts to JSON).
  const x = (key, fmt) => run('/usr/bin/plutil', ['-extract', key, fmt, '-o', '-', '-'], { input: cms.stdout });
  let p;
  try {
    // Entitlements as XML (json refuses it on this macOS); pick the keys we need.
    const xml = x('Entitlements', 'xml1').stdout;
    const str = (k) => (xml.match(new RegExp(`<key>${k.replace(/\./g, '\\.')}</key>\\s*<string>([^<]*)</string>`)) ?? [])[1];
    const arr = (k) => {
      const m = xml.match(new RegExp(`<key>${k.replace(/\./g, '\\.')}</key>\\s*<array>([\\s\\S]*?)</array>`));
      return m ? [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((s) => s[1]) : [];
    };
    if (!xml) throw new Error('no Entitlements');
    p = {
      Entitlements: {
        'com.apple.application-identifier': str('com.apple.application-identifier'),
        'com.apple.developer.team-identifier': str('com.apple.developer.team-identifier'),
        'keychain-access-groups': arr('keychain-access-groups'),
      },
      Name: x('Name', 'raw').stdout,
      UUID: x('UUID', 'raw').stdout,
      TeamIdentifier: [x('TeamIdentifier.0', 'raw').stdout],
      ExpirationDate: x('ExpirationDate', 'raw').stdout || null,
    };
  } catch {
    return { present: true, valid: false, error: 'plutil could not read Entitlements from the profile' };
  }
  const ent = p.Entitlements ?? {};
  const groups = ent['keychain-access-groups'] ?? [];
  const expires = p.ExpirationDate ? new Date(p.ExpirationDate) : null;
  const appIdOk = ent['com.apple.application-identifier'] === APP_ID;
  const groupOk = groups.some((g) => g === ACCESS_GROUP || g === `${TEAM}.*`);
  return {
    present: true,
    valid: appIdOk && groupOk && (!expires || expires > new Date()),
    path: PROFILE_PATH.replace(os.homedir(), '~'),
    name: p.Name,
    uuid: p.UUID,
    team: p.TeamIdentifier,
    applicationIdentifier: ent['com.apple.application-identifier'],
    keychainAccessGroups: groups,
    expires: expires?.toISOString() ?? null,
    appIdOk,
    groupOk,
    sha256: createHash('sha256').update(readFileSync(PROFILE_PATH)).digest('hex').slice(0, 16),
  };
}

/** `notarytool history` is the P00 check itself; a missing profile errors fast. */
export function checkNotary() {
  const r = run('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE, '--output-format', 'json'], { timeout: 90_000 });
  const missing = /No Keychain password item found|could not be found|profile.*not found/i.test(`${r.stderr} ${r.stdout}`);
  let history = null;
  try {
    history = JSON.parse(r.stdout);
  } catch {
    // not JSON on error
  }
  return { present: r.status === 0, missing, status: r.status, answered: r.status === 0, submissions: history?.history?.length ?? null, error: r.status === 0 ? undefined : (r.stderr || r.stdout).slice(0, 300) };
}

/** Print a fail-fast prerequisite message; returns the probe outcome. */
export function prerequisiteFailure(missing, evidence) {
  const msg = `MISSING PREREQUISITE: ${missing.join(' / ')} — ${SEE}`;
  process.stderr.write(`\n${msg}\n\n`);
  return { verdict: 'partial', evidence: { blocked: 'prerequisites', message: msg, ...evidence } };
}

const INFO_PLIST = (exe) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>${exe}</string>
  <key>CFBundleName</key><string>Gnomon Helper</string>
  <key>CFBundleDisplayName</key><string>Gnomon Helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.0-probe</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`;

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.application-identifier</key><string>${APP_ID}</string>
  <key>com.apple.developer.team-identifier</key><string>${TEAM}</string>
  <key>keychain-access-groups</key><array><string>${ACCESS_GROUP}</string></array>
</dict></plist>
`;

/**
 * Build steps (also the documented manual recipe, probes/README.md):
 *   1. xcrun swiftc -O _shared/helper/ProbeHelper.swift -o <app>/Contents/MacOS/gnomon-helper
 *   2. Info.plist (CFBundleIdentifier gnomon.helper) + Contents/embedded.provisionprofile
 *   3. codesign --force --options runtime --timestamp --entitlements helper.entitlements
 *        --sign "Developer ID Application: Matthew Canoy (SW4BMQ8PNL)" <app>
 *   4. codesign --verify --strict --deep -vv <app>
 * Also builds an UNSIGNED copy (linker ad-hoc signature only) for the
 * entitlement-refusal case. Output lives in a temp dir, never in the repo.
 * `embedProfile: false` builds the P00 stub (hardened runtime, no restricted
 * entitlements, no profile).
 */
export function buildHelper({ embedProfile = true, sign = true } = {}) {
  const src = path.join(SHARED, 'helper/ProbeHelper.swift');
  const hash = createHash('sha256').update(readFileSync(src)).update(String(embedProfile)).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), `gnomon-probe-helper-${hash}`);
  rmSync(dir, { recursive: true, force: true });
  const app = path.join(dir, 'GnomonHelperProbe.app');
  const macos = path.join(app, 'Contents/MacOS');
  mkdirSync(macos, { recursive: true });
  const exe = path.join(macos, 'gnomon-helper');
  const steps = {};
  let t = Date.now();
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', src, '-o', exe], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
  steps.swiftcMs = Date.now() - t;
  const unsigned = path.join(dir, 'gnomon-helper-unsigned');
  copyFileSync(exe, unsigned);
  writeFileSync(path.join(app, 'Contents/Info.plist'), INFO_PLIST('gnomon-helper'));
  const entFile = path.join(dir, 'helper.entitlements');
  writeFileSync(entFile, embedProfile ? ENTITLEMENTS : '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict/></plist>\n');
  if (embedProfile) copyFileSync(PROFILE_PATH, path.join(app, 'Contents/embedded.provisionprofile'));
  if (sign) {
    t = Date.now();
    const cs = run('/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', entFile, '--sign', IDENTITY, app], { timeout: 120_000 });
    steps.codesign = { status: cs.status, ms: Date.now() - t, timedOut: cs.timedOut, stderr: cs.stderr.slice(0, 400) };
    const v = run('/usr/bin/codesign', ['--verify', '--strict', '--deep', '-vv', app]);
    steps.verifyStrict = { ok: v.status === 0, output: v.stderr.slice(0, 400) };
    const d = run('/usr/bin/codesign', ['-d', '-vv', app]);
    steps.details = d.stderr.split('\n').filter((l) => /^(Identifier|Format|Authority|TeamIdentifier|Runtime Version|Timestamp|flags|CodeDirectory)/.test(l)).map((l) => l.replace(/CodeDirectory v=\S+ size=\S+ /, 'CodeDirectory '));
    const e = run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', app]);
    steps.signedEntitlements = (e.stdout.match(/<key>([^<]+)<\/key>/g) ?? []).map((k) => k.replace(/<\/?key>/g, ''));
    const sp = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', app]);
    steps.spctl = { status: sp.status, output: sp.stderr.slice(0, 300) };
  }
  return { dir, app, exe, unsigned, steps, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Run a helper command; parse its one JSON line. */
export function helper(bin, args, opts = {}) {
  const r = run(bin, args, { timeout: opts.timeout ?? 30_000, env: opts.env });
  let json = null;
  try {
    json = JSON.parse(r.stdout.split('\n').pop());
  } catch {
    // crashed or killed
  }
  return { status: r.status, signal: r.signal, timedOut: r.timedOut, json, stderr: r.stderr ? r.stderr.slice(0, 400) : undefined };
}

let abortSignal = null;
/** Bind ctx.signal so ask() rejects when the harness aborts (timeout). */
export function bindSignal(signal) {
  abortSignal = signal ?? null;
}

/**
 * Interactive prompt; resolves the trimmed answer. Only call when stdin is a TTY.
 * - Ctrl-C at the prompt: on a TTY readline receives it as a keypress and
 *   emits 'SIGINT' on the INTERFACE (process 'SIGINT' never fires), so we
 *   handle it here: close, run the onAbort cleanups synchronously, exit 130.
 * - Harness abort (ctx.signal) or the interface closing with no answer
 *   (EOF, Ctrl-D): reject.
 * `opts` ({input, output, exit, onInterface}) is a test seam only.
 */
export function ask(question, opts = {}) {
  const rl = readline.createInterface({ input: opts.input ?? process.stdin, output: opts.output ?? process.stderr });
  const exit = opts.exit ?? ((code) => process.exit(code));
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, v) => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener('abort', onAbortFn);
      fn(v);
    };
    const onAbortFn = () => {
      settle(reject, new Error('aborted'));
      rl.close();
    };
    if (abortSignal?.aborted) {
      onAbortFn();
      return;
    }
    abortSignal?.addEventListener('abort', onAbortFn, { once: true });
    rl.on('SIGINT', () => {
      settle(reject, new Error('interrupted'));
      rl.close();
      (opts.output ?? process.stderr).write('\nCtrl-C: running probe cleanups…\n');
      runCleanups();
      exit(130);
    });
    rl.on('close', () => settle(reject, new Error('prompt closed without an answer')));
    rl.question(`\n${question}\n> `, (a) => {
      settle(resolve, a.trim());
      rl.close();
    });
    opts.onInterface?.(rl);
  });
}

export function say(text) {
  process.stderr.write(`\n=== ${text}\n`);
}

export const interactive = () => process.stdin.isTTY === true && process.env.GNOMON_PROBE_UNATTENDED !== '1';
