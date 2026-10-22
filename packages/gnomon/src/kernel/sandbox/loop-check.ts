/**
 * @symbol #loop-check
 * @symbol #oracle-sandbox
 *
 * The `loop-check` sandbox profile's platform registry (docs/specs/gnomon-loops.md §4 "Sandboxes", §7;
 * TD-2026-10-22-129: loops build their own read-only profile in place of M2.3's `gnomon-oracle`, G:1596;
 * G-WIN-05: no platform branch in kernel code). darwin = `sandbox-exec -p <generated default-deny SBPL>
 * <argv…>` (platform/darwin/loop-check-sbpl.ts), under the SAME floor as sessions and mods (macOS 15+ AND
 * System Integrity Protection, darwinFloor in session.ts). win32 is ABSENT: the Windows session fills it
 * (WRITE_RESTRICTED token + ACEs + job object, `partial` on read denial, G:1596); until then a loop check run
 * there refuses `sandbox-unavailable`, like linux. A check never runs unsandboxed and never silently degraded.
 * Every granted path is checked like the transport and mod profiles' (Aegis C2): none may equal or contain
 * $HOME, the Gnomon home or a credential store, and none may lie inside the keys dir or a credential store.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { loopCheckProfileSbpl, LoopCheckSbplError, LOOP_CHECK_PROFILE_VERSION } from '../../platform/darwin/loop-check-sbpl.js';
import type { MacosProbe, SipProbe } from '../../platform/darwin/macos.js';
import { darwinFloor } from './session.js';
import { assertNoProtectedGrant, nodeRuntimeDirs, type ChildLaunchPlan } from './transport.js';

/** Check run dirs live in `<home>/loop-work/` (kernel-owned, 0700): never inside the repo, never under ~/.gnomon/loops. */
export const LOOP_WORK_DIR = 'loop-work';

/** The `loop-check` profile as data (versioned; its hash goes into the check result as profileHash). */
export const LOOP_CHECK_PROFILE = Object.freeze({
  name: 'loop-check' as const,
  version: LOOP_CHECK_PROFILE_VERSION,
  allow: Object.freeze({
    read: Object.freeze(['the check copy', "the repo's node_modules (read only)", 'the Node runtime', 'the hashed argv0 and its interpreter', 'the pinned paradigm CLI package (builtins)']),
    write: Object.freeze(['the check copy (its private HOME and TMPDIR inside it)']),
    network: 'none',
    exec: 'the kernel node, the hashed argv0 and its shebang interpreter',
  }),
  deny: Object.freeze(['every other file', 'the Gnomon home', 'credential stores', 'network (loopback included)', 'mach-lookup', 'every other exec', 'home']),
});

/**
 * Credential stores under the user's home, read- and write-denied last (the session profile's deny list:
 * the Gnomon home, ~/.claude and ~/.claude.json, browser profiles; plus the usual developer secrets).
 */
export const LOOP_CHECK_CREDENTIAL_STORES: readonly string[] = Object.freeze([
  '.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.netrc', '.npmrc', '.pypirc', '.git-credentials',
  '.config/gh', '.config/hub', '.config/gcloud', '.config/op', '.password-store', '.vault-token', '.terraform.d',
  '.cargo/credentials', '.cargo/credentials.toml', '.local/share/keyrings', '.claude', '.claude.json',
  'Library/Keychains', 'Library/Cookies', 'Library/Safari', 'Library/Application Support/Google/Chrome',
  'Library/Application Support/Firefox', 'Library/Application Support/Microsoft Edge', 'Library/Application Support/BraveSoftware',
]);

export interface LoopCheckLaunchInput {
  /** the Gnomon home (denied as a whole) */
  home: string;
  /** the user's OS home (default os.homedir()) */
  userHome?: string;
  /** the check's run dir, `<home>/loop-work/check-<runId>` (kernel-owned, 0700): read + write */
  copyDir: string;
  /** node_modules dirs linked into the copy: read only */
  nodeModules: readonly string[];
  /** argv to exec directly (argv[0] absolute; no shell) */
  argv: readonly string[];
  /** further exec-allowed files: argv0's shebang interpreter(s) */
  exec?: readonly string[];
  /** extra read-only subpaths (the paradigm CLI package for builtins) */
  readPaths?: readonly string[];
  env: Record<string, string>;
  /** the kernel's node (default process.execPath) */
  nodePath?: string;
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const real = (d: string): string => (existsSync(d) ? realpathSync.native(d) : d);
const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

function darwinLoopCheck(i: LoopCheckLaunchInput, probe?: MacosProbe, sip?: SipProbe): ChildLaunchPlan {
  const floor = darwinFloor(probe, sip);
  if (!floor.ok) {
    throw new LifecycleRefusal('sandbox-unavailable', floor.floor === 'sip' ? `the loop-check profile needs System Integrity Protection enabled (have ${floor.have})` : `the loop-check profile needs macOS ${floor.need}+ (have ${floor.have ?? 'unknown'})`, { profile: 'loop-check', floor: floor.floor, have: floor.have, need: floor.need });
  }
  if (!existsSync(SANDBOX_EXEC)) throw new LifecycleRefusal('sandbox-unavailable', `${SANDBOX_EXEC} is missing`, { profile: 'loop-check' });
  if (!i.argv.length || !path.isAbsolute(i.argv[0]!)) throw new LifecycleRefusal('sandbox-unavailable', 'a loop check execs an absolute, resolved argv0', { profile: 'loop-check' });
  const nodeReal = realpathSync.native(i.nodePath ?? process.execPath);
  const copyReal = realpathSync.native(i.copyDir);
  const argv0Real = realpathSync.native(i.argv[0]!);
  const execReal = [argv0Real, ...(i.exec ?? []).map((e) => realpathSync.native(e))];
  const nodeModulesReal = i.nodeModules.map(real);
  const readReal = (i.readPaths ?? []).map(real);
  // a native argv0 outside the copy needs its own install's libs (never its prefix; checked below)
  for (const e of execReal) if (e !== nodeReal && !within(e, copyReal) && !nodeModulesReal.some((n) => within(e, n))) readReal.push(...nodeRuntimeDirs(e).filter(existsSync).map(real));
  const userHome = real(i.userHome ?? homedir());
  const homeReal = real(i.home);
  const creds = LOOP_CHECK_CREDENTIAL_STORES.map((c) => real(path.join(userHome, ...c.split('/'))));
  const keys = path.join(homeReal, 'keys');
  // the run dir is the ONE grant inside the Gnomon home: exactly <home>/loop-work/check-<runId>, a real dir
  if (path.dirname(copyReal) !== path.join(homeReal, LOOP_WORK_DIR) || !/^check-[A-Za-z0-9_-]{1,64}$/.test(path.basename(copyReal)) || lstatSync(i.copyDir).isSymbolicLink()) {
    throw new LifecycleRefusal('sandbox-unavailable', `the loop-check run dir must be ${path.join(homeReal, LOOP_WORK_DIR, 'check-<runId>')} (got ${copyReal})`, { profile: 'loop-check' });
  }
  assertNoProtectedGrant([copyReal], [userHome], [keys, ...creds]);
  assertNoProtectedGrant([...nodeModulesReal, ...readReal, ...nodeRuntimeDirs(nodeReal)], [userHome, homeReal], [keys, homeReal, ...creds]);
  for (const e of execReal) for (const f of within(e, copyReal) ? [keys, ...creds] : [homeReal, ...creds]) {
    if (within(e, f)) throw new LifecycleRefusal('sandbox-unavailable', `the loop-check profile would exec ${e}, inside ${f}`, { profile: 'loop-check', exec: e });
  }
  let profile: string;
  try {
    profile = loopCheckProfileSbpl({ nodeReal, copyReal, nodeModulesReal, execReal, readReal, homeReal, denyReal: [keys, ...creds] });
  } catch (err) {
    if (err instanceof LoopCheckSbplError) throw new LifecycleRefusal('sandbox-unavailable', err.message, { profile: 'loop-check' });
    throw err;
  }
  return {
    command: SANDBOX_EXEC,
    args: ['-p', profile, argv0Real, ...i.argv.slice(1)],
    env: { ...i.env },
    sandbox: 'full',
    profile,
    profileHash: `sha256:${createHash('sha256').update(profile).digest('hex')}`,
  };
}

/** Platform registry of loop-check sandbox backends (G-WIN-05). win32 is the Windows session's to fill (W5). */
export const LOOP_CHECK_BACKENDS: Readonly<Partial<Record<string, (i: LoopCheckLaunchInput, probe?: MacosProbe, sip?: SipProbe) => ChildLaunchPlan>>> = Object.freeze({
  darwin: darwinLoopCheck,
  // win32: WRITE_RESTRICTED token + ACEs + job object, no network via WFP (G:1596), the Windows session (W5) — not built.
});

/** The launch plan for a loop check child on `platform`; refuses `sandbox-unavailable` where no profile can be applied. */
export function loopCheckLaunchPlan(i: LoopCheckLaunchInput, platform: string = process.platform, probe?: MacosProbe, sip?: SipProbe): ChildLaunchPlan {
  const backend = LOOP_CHECK_BACKENDS[platform];
  if (!backend) throw new LifecycleRefusal('sandbox-unavailable', `no loop-check sandbox profile on ${platform} (gnomon-loops.md §4; the Windows backend lands with W5)`, { platform, profile: 'loop-check' });
  return backend(i, probe, sip);
}
