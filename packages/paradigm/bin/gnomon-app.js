// @symbol #gnomon-app-installer
//
// Install and launch the signed Gnomon.app for paradigm's `gnomon` shim (T-2026-10-21-031, TD-2026-10-21-758;
// 8.0 M4). Node >= 20 syntax and node: built-ins ONLY: this file runs on whatever Node the user has, so it never
// imports @a-company/gnomon (a Node 24 kernel). Gnomon itself only ever runs on the app's bundled Node.
//
//   1. pin: the sha256 of this arch's Gnomon.app.zip is read from @a-company/gnomon's RELEASE build stamp
//      (dist/build-id.json `release.appZips`, written from the same manifest the kernel compiles in by
//      scripts/build-release.mjs). Never the .sha256 file beside the zip in the platform package: a swapped platform
//      package cannot swap gnomon's stamp. A dev build (no release) is refused.
//   2. install, when the app is missing, older than this gnomon, or fails verification (a failing app is moved aside
//      to .Gnomon.app.rejected-<time> and the user is told, never opened): target appInstallDir (/Applications when this user
//      can write it without sudo, else ~/Applications; the same rule as the kernel's app-bundle.ts), under a lock
//      beside it; the zip must hash to the pin BEFORE it is unpacked (ditto -x -k into a staging dir beside the
//      target, so the final rename stays on one volume); the staged app must have the release layout, carry this
//      exact gnomon version, and pass `codesign --verify --strict --deep -R=<wrapper requirement>` (team SW4BMQ8PNL);
//      only then is the old app renamed aside, the new one renamed into place, and the old one removed. A failure at
//      any step leaves the old app where it was. No postinstall, no sudo.
//   3. launch the INSTALLED, just-verified app (launchApp): bare `gnomon` opens it, a verb runs
//      `gnomon-wrapper --cli -- <args>`, so the Rust wrapper is the one trust root; children get scrubbedEnv() only.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'Gnomon.app';
export const TEAM = 'SW4BMQ8PNL';
export const WRAPPER_IDENTIFIER = 'gnomon.wrapper';
/** packages/gnomon-wrapper/scripts/build-darwin.mjs WRAPPER_REQUIREMENT (a test keeps the two equal). */
export const WRAPPER_REQUIREMENT = `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}" and identifier "${WRAPPER_IDENTIFIER}"`;
/** The release layout (packages/gnomon/scripts/release-darwin.mjs LAYOUT), relative to the .app. */
export const LAYOUT = Object.freeze({
  wrapper: 'Contents/MacOS/gnomon-wrapper',
  node: 'Contents/Resources/node/bin/node',
  kernelPackage: 'Contents/Resources/kernel/package.json',
  cli: 'Contents/Resources/kernel/dist/cli/gnomon.js',
});
const LOCK = `.${APP_NAME}.lock`;
const STAGING = `.${APP_NAME}.staging-`;
const OLD = `.${APP_NAME}.old-`;

export class ShimRefused extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'ShimRefused';
    this.reason = reason;
  }
}

/** Where the app is installed: /Applications when this user can write it without sudo, else ~/Applications. */
export function appInstallDir({ home = os.homedir(), writable } = {}) {
  const canWrite =
    writable ??
    ((dir) => {
      try {
        fs.accessSync(dir, fs.constants.W_OK);
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
  return canWrite('/Applications') ? '/Applications' : path.join(home, 'Applications');
}

/** Streamed sha256 (hex) of a file. */
export function sha256OfFile(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n = fs.readSync(fd, buf, 0, buf.length, null); n > 0; n = fs.readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * The sha256 this @a-company/gnomon release pins for `arch`'s Gnomon.app.zip, read from its build stamp. Refused
 * `dev` for a build without a release, `unpinned` when the release pins no zip for this arch.
 */
export function compiledAppZipPin(gnomonPackage, version, arch) {
  let stamp;
  try {
    stamp = JSON.parse(fs.readFileSync(path.join(gnomonPackage, 'dist', 'build-id.json'), 'utf8'));
  } catch {
    throw new ShimRefused('dev', `${gnomonPackage} has no readable build stamp; reinstall with: npm i -g @a-company/paradigm`);
  }
  const rel = stamp && typeof stamp === 'object' ? stamp.release : undefined;
  if (!rel || typeof rel !== 'object') throw new ShimRefused('dev', 'this @a-company/gnomon is a development build: it pins no Gnomon.app, so it installs none (run Gnomon from your clone, or install a published release)');
  if (rel.release !== version || stamp.version !== version) throw new ShimRefused('broken', `@a-company/gnomon ${version} carries the pins of release ${rel.release}; reinstall with: npm i -g @a-company/paradigm`);
  const z = Array.isArray(rel.appZips) ? rel.appZips.find((e) => e && e.arch === arch) : undefined;
  if (!z || typeof z.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(z.sha256)) throw new ShimRefused('unpinned', `release ${version} pins no Gnomon.app for ${arch}`);
  return z.sha256;
}

/** -1 / 0 / 1 for semver a vs b (a prerelease sorts below its release). */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v));
    if (!m) return null;
    return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new ShimRefused('version', `not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * What sits at `app`: { state: 'missing' } | { state: 'gnomon', version, complete } | { state: 'foreign' } (a
 * Gnomon.app we did not ship: never replaced).
 */
export function inspectApp(app) {
  let st;
  try {
    st = fs.lstatSync(app);
  } catch {
    return { state: 'missing' };
  }
  if (!st.isDirectory()) return { state: 'foreign' };
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(app, LAYOUT.kernelPackage), 'utf8'));
  } catch {
    return { state: 'foreign' };
  }
  if (pkg?.name !== '@a-company/gnomon' || typeof pkg.version !== 'string') return { state: 'foreign' };
  const complete = [LAYOUT.wrapper, LAYOUT.node, LAYOUT.cli].every((r) => {
    try {
      return fs.lstatSync(path.join(app, r)).isFile();
    } catch {
      return false;
    }
  });
  return { state: 'gnomon', version: pkg.version, complete };
}

/** The production check of an app: its signature and our team's wrapper requirement (seals node and the kernel). */
export function codesignVerifyApp(app) {
  const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', `-R=${WRAPPER_REQUIREMENT}`, app], { encoding: 'utf8', timeout: 300_000, env: scrubbedEnv() });
  if (r.status !== 0) throw new ShimRefused('signature', `${app} is not Gnomon signed by team ${TEAM}: ${String(r.stderr || r.error?.message || '').trim().slice(0, 300)}`);
}

/**
 * TESTS ONLY (the --allow-unsigned-for-tests seam): accepts an unsigned app. The CLI path never passes a verifier,
 * so it always runs codesignVerifyApp; test/gnomon-shim-install.test.ts falsifies that statically.
 */
export const ALLOW_UNSIGNED_FOR_TESTS = Object.freeze({ verifyApp: () => undefined });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The environment every child of the shim gets (Aegis M4 high 1): the wrapper's own allow-list (gnomon-wrapper
 * src/kernel.rs ENV_ALLOWLIST) plus a fixed system PATH. Never NODE_OPTIONS, GNOMON_*, DYLD_* or anything else of
 * the caller's; the wrapper scrubs again before it execs node.
 */
export const ENV_ALLOWLIST = Object.freeze(['HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'SHELL']);
export function scrubbedEnv(from = process.env) {
  const env = {};
  for (const k of ENV_ALLOWLIST) if (typeof from[k] === 'string') env[k] = from[k];
  env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  return env;
}

/** A process's start time as `ps` reports it (stable for the life of the pid), or null when there is no such pid. */
export function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const r = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: scrubbedEnv() });
  const t = r.status === 0 ? String(r.stdout).trim() : '';
  return t || null;
}

function readOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** A lock is stale when its owner pid is gone or is now ANOTHER process (pid reuse: a different start time). */
function ownerAlive(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid)) return false;
  const now = processStart(owner.pid);
  return now !== null && now === owner.start;
}

/** A lock directory with no owner file yet is being created; older than this, its creator died. */
export const LOCK_UNOWNED_STALE_MS = 30_000;
/** How long a second `gnomon` waits for an install in progress before it gives up (with the lock's path). */
export const LOCK_WAIT_MS = 5 * 60_000;

/**
 * An exclusive lock beside the app (mkdir is atomic): `<dir>/.Gnomon.app.lock/owner.json` = { pid, start, nonce }
 * (start = the owner's process start time, so a reused pid never keeps a dead owner's lock). A lock whose owner is
 * gone, or with no owner file for LOCK_UNOWNED_STALE_MS, is broken by renaming it aside first; a lock that turns out
 * to be live after the rename is put back. The wait is capped (LOCK_WAIT_MS). Returns the release function.
 */
export async function acquireInstallLock(dir, { timeoutMs = LOCK_WAIT_MS, pollMs = 100 } = {}) {
  const lockDir = path.join(dir, LOCK);
  const nonce = randomBytes(8).toString('hex');
  const me = { pid: process.pid, start: processStart(process.pid), nonce };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(me));
      return () => {
        if (readOwner(lockDir)?.nonce === nonce) fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw new ShimRefused('install', `cannot lock ${dir}: ${e.message}`);
    }
    const owner = readOwner(lockDir);
    let age = 0;
    try {
      age = Date.now() - fs.statSync(lockDir).mtimeMs;
    } catch {
      continue; // released meanwhile
    }
    if (owner ? !ownerAlive(owner) : age > LOCK_UNOWNED_STALE_MS) {
      const tomb = path.join(dir, `${LOCK}.stale-${nonce}`);
      try {
        fs.renameSync(lockDir, tomb);
        const took = readOwner(tomb);
        if (took && took.nonce !== owner?.nonce && ownerAlive(took)) {
          // a live lock was taken in the meantime: give it back
          try {
            fs.renameSync(tomb, lockDir);
          } catch {
            /* it was re-taken; its owner keeps going */
          }
        } else fs.rmSync(tomb, { recursive: true, force: true });
      } catch {
        /* someone else broke it first */
      }
      continue;
    }
    if (Date.now() > deadline) throw new ShimRefused('busy', `another gnomon (pid ${owner?.pid ?? '?'}) has been installing Gnomon.app in ${dir} for over ${Math.round(timeoutMs / 1000)} s; let it finish and run gnomon again (if no gnomon is running, remove ${lockDir})`);
    await sleep(pollMs);
  }
}

/** Is `app` a complete Gnomon release of `version` or newer that passes `verifyApp`? { ok, version, why }. */
function trusted(app, version, verifyApp) {
  const a = inspectApp(app);
  if (a.state !== 'gnomon' || !a.complete) return { ok: false, why: 'not a complete Gnomon release' };
  try {
    verifyApp(app);
  } catch (e) {
    return { ok: false, version: a.version, why: e instanceof Error ? e.message : String(e) };
  }
  return { ok: version === undefined || compareVersions(a.version, version) >= 0, version: a.version, why: 'older than this gnomon' };
}

/**
 * With the lock held: an app a crashed swap left renamed aside is put back ONLY if it passes `verifyApp` and is a
 * complete Gnomon release (Aegis M4 medium 3; a planted `.Gnomon.app.old-*` is discarded and the app reinstalled);
 * stale staging dirs and every other aside copy are removed.
 */
function recoverInterrupted(dir, target, verifyApp, onEvent) {
  const olds = fs.readdirSync(dir).filter((n) => n.startsWith(OLD)).map((n) => path.join(dir, n));
  if (!fs.existsSync(target) && olds.length) {
    const newest = olds.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    const t = trusted(newest, undefined, verifyApp);
    if (t.ok) fs.renameSync(newest, target);
    else onEvent({ step: 'discarded', app: newest, why: t.why });
  }
  for (const n of fs.readdirSync(dir)) if (n.startsWith(OLD) || n.startsWith(STAGING)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
}

/** Refuse unless `app` (staged) is the release layout of exactly `version`, with no symlink at its top levels. */
function checkStagedLayout(app, version) {
  const st = fs.lstatSync(app);
  if (!st.isDirectory()) throw new ShimRefused('layout', 'the zip does not hold a Gnomon.app directory');
  for (const rel of ['Contents', 'Contents/MacOS', 'Contents/Resources', ...Object.values(LAYOUT)]) {
    let s;
    try {
      s = fs.lstatSync(path.join(app, rel));
    } catch {
      throw new ShimRefused('layout', `the unpacked Gnomon.app has no ${rel}`);
    }
    if (s.isSymbolicLink()) throw new ShimRefused('layout', `the unpacked Gnomon.app has a symlink at ${rel}`);
  }
  const got = inspectApp(app);
  if (got.state !== 'gnomon' || !got.complete) throw new ShimRefused('layout', 'the unpacked Gnomon.app is not a complete Gnomon release');
  if (got.version !== version) throw new ShimRefused('version', `the unpacked Gnomon.app is ${got.version}, not ${version}`);
}

export const REJECTED = `.${APP_NAME}.rejected-`;

/**
 * Make sure a VERIFIED Gnomon.app `version` (or newer) is installed in `installDir`, and return it for launchApp:
 * { app, action: 'present' | 'installed' | 'upgraded' | 'reinstalled', version, verified: true }.
 * Every path ends in a verified app (Aegis M4 medium 2): a present app of this version or newer is used only after
 * it passes `verifyApp` (no lock, no copy). One that FAILS is treated as not installed: under the lock it is moved
 * aside to `.Gnomon.app.rejected-<time>` (kept, never deleted silently; the event names the path for the user) and
 * the app is reinstalled from the verified zip. `verifyApp` defaults to the codesign check; only tests pass
 * ALLOW_UNSIGNED_FOR_TESTS.
 */
export async function ensureApp({ zip, sha256, version, installDir, verifyApp = codesignVerifyApp, ditto = '/usr/bin/ditto', lock = {}, onEvent = () => undefined }) {
  const target = path.join(installDir, APP_NAME);
  const fast = trusted(target, version, verifyApp);
  if (fast.ok) return { app: target, action: 'present', version: fast.version, verified: true };
  try {
    fs.mkdirSync(installDir, { recursive: true });
  } catch (e) {
    throw new ShimRefused('install', `cannot create ${installDir}: ${e.message}`);
  }
  const release = await acquireInstallLock(installDir, lock);
  try {
    recoverInterrupted(installDir, target, verifyApp, onEvent);
    const again = trusted(target, version, verifyApp); // another gnomon may have installed it while we waited
    if (again.ok) return { app: target, action: 'present', version: again.version, verified: true };
    let before = inspectApp(target);
    if (before.state === 'foreign') throw new ShimRefused('foreign', `${target} exists and is not a Gnomon release; move it away and run gnomon again`);
    let rejected = false;
    if (before.state === 'gnomon' && again.why !== 'older than this gnomon') {
      // a Gnomon.app that fails verification (or is incomplete): never opened, never silently deleted
      const aside = path.join(installDir, `${REJECTED}${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.renameSync(target, aside);
      onEvent({ step: 'rejected', app: target, movedTo: aside, why: again.why });
      rejected = true;
      before = { state: 'missing' };
    }
    // 1. the zip must be the pinned bytes before anything opens it
    let got;
    try {
      got = sha256OfFile(zip);
    } catch {
      throw new ShimRefused('missing', `no Gnomon.app zip at ${zip}; reinstall with: npm i -g @a-company/paradigm`);
    }
    if (got !== sha256) throw new ShimRefused('checksum', `${zip} hashes to ${got}, not the ${sha256} this release pins; refused`);
    onEvent({ step: before.state === 'missing' ? 'installing' : 'upgrading', from: before.version ?? null, to: version, dir: installDir });
    // 2. unpack beside the target and verify the staged app
    const staging = fs.mkdtempSync(path.join(installDir, STAGING));
    try {
      const x = spawnSync(ditto, ['-x', '-k', zip, staging], { encoding: 'utf8', timeout: 600_000, env: scrubbedEnv() });
      if (x.status !== 0) throw new ShimRefused('unpack', `ditto could not unpack ${zip}: ${String(x.stderr || x.error?.message || '').trim().slice(0, 300)}`);
      const entries = fs.readdirSync(staging);
      if (entries.length !== 1 || entries[0] !== APP_NAME) throw new ShimRefused('layout', `the zip holds ${entries.join(', ') || 'nothing'}, not just ${APP_NAME}`);
      const staged = path.join(staging, APP_NAME);
      checkStagedLayout(staged, version);
      verifyApp(staged);
      onEvent({ step: 'verified', app: staged });
      // 3. swap: the old app is renamed aside (kept until the new one is in place), then removed
      let aside = null;
      if (before.state === 'gnomon') {
        aside = path.join(installDir, `${OLD}${process.pid}-${randomBytes(4).toString('hex')}`);
        fs.renameSync(target, aside);
      }
      try {
        fs.renameSync(staged, target);
      } catch (e) {
        if (aside) fs.renameSync(aside, target);
        throw new ShimRefused('install', `could not move the new Gnomon.app into ${installDir}: ${e.message}`);
      }
      if (aside) fs.rmSync(aside, { recursive: true, force: true });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    const action = rejected ? 'reinstalled' : before.state === 'missing' ? 'installed' : 'upgraded';
    onEvent({ step: action, app: target, version });
    return { app: target, action, version, verified: true };
  } finally {
    release();
  }
}

/**
 * Launch the INSTALLED app, which ensureApp just verified (`installed.verified`; anything else is verified here
 * first). The wrapper is the ONE trust root (Aegis M4 high 1): it re-hashes its bundled node and kernel against the
 * values compiled into it, checks the node's designated requirement and refuses symlinks and hard links, scrubs the
 * environment, and only then runs the kernel.
 *   - no arguments (`gnomon`): `open` the app through LaunchServices; `up --wrapper` lands a fresh Mac on the setup
 *     screens (#setup-endpoint), two Touch ID prompts, then the desk;
 *   - with arguments: exec `<app>/Contents/MacOS/gnomon-wrapper --cli -- <args>`, whose same checks run before it
 *     execs the bundled node on the kernel CLI (stdio, signals and the exit code pass through).
 * Every child gets scrubbedEnv(), never process.env.
 * Resolves to the exit code.
 */
export function launchApp(installed, args, { verifyApp = codesignVerifyApp, open = '/usr/bin/open' } = {}) {
  const app = installed.app;
  if (installed.verified !== true) verifyApp(app);
  const env = scrubbedEnv();
  if (args.length === 0) {
    return new Promise((resolve) => {
      const child = spawn(open, [app], { stdio: 'inherit', env });
      child.on('error', (e) => {
        process.stderr.write(`gnomon: could not open ${app}: ${e.message}\n`);
        resolve(70);
      });
      child.on('exit', (code) => resolve(code ?? 70));
    });
  }
  const wrapper = path.join(app, LAYOUT.wrapper);
  return new Promise((resolve) => {
    const child = spawn(wrapper, ['--cli', '--', ...args], { stdio: 'inherit', env });
    const forward = (sig) => () => child.kill(sig);
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, forward(s)]);
    for (const [s, h] of handlers) process.on(s, h);
    child.on('error', (e) => {
      process.stderr.write(`gnomon: ${e.message}\n`);
      resolve(70);
    });
    child.on('exit', (code, signal) => {
      for (const [s, h] of handlers) process.off(s, h);
      resolve(code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : signal === 'SIGHUP' ? 1 : 15) : 70));
    });
  });
}
