/**
 * @symbol #oracle-sandbox
 * @symbol #mod-host
 *
 * The `mod` sandbox profile's platform registry (spec §15.5 row `mod`, §3.8;
 * G-WIN-05: no platform branch in kernel code). darwin = `sandbox-exec -p
 * <generated default-deny SBPL> <node real> <entry real>`
 * (platform/darwin/mod-sbpl.ts), under the SAME floor as sessions (macOS 15+
 * AND System Integrity Protection, darwinFloor in session.ts). win32 =
 * restricted token + ACL + job object, `partial` on read denial — the Windows
 * parity phase (P8-D78), not built. linux has no mod mechanism. A platform
 * with no backend, or below the floor, REFUSES `sandbox-unavailable`: a mod
 * never runs unsandboxed and never silently degraded (§15.5 rule; the
 * `gate-class` card that lets a human accept `partial` comes with the
 * Windows row). Every granted read path is checked like the transport
 * profile's (Aegis C2): none may equal or contain $HOME, the Gnomon home,
 * or the keys dir, and none may lie inside the keys dir.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { modProfileSbpl, ModSbplError, MOD_PROFILE_VERSION } from '../../platform/darwin/mod-sbpl.js';
import type { MacosProbe, SipProbe } from '../../platform/darwin/macos.js';
import { darwinFloor } from './session.js';
import { assertNoProtectedGrant, nodeRuntimeDirs, type ChildLaunchPlan } from './transport.js';
import { childNodePath } from '../lifecycle/sea.js';

/** The `mod` row of §15.5 as data (versioned; logged in mod.sandbox as profileHash). */
export const MOD_PROFILE = Object.freeze({
  name: 'mod' as const,
  version: MOD_PROFILE_VERSION,
  allow: Object.freeze({
    read: Object.freeze(['the Node runtime', 'the pinned snapshot', '<home>/mods/<name>/state/', 'knowledge:provide read paths']),
    write: Object.freeze(['<home>/mods/<name>/state/', '<home>/mods/<name>/blobs/ (write effect only)']),
    network: 'the kernel egress proxy port (network effect + egress grant only)',
    exec: 'node only',
  }),
  deny: Object.freeze(['every other file', 'the linked source folder and its .git', 'keystore', 'mach-lookup', 'other network', 'fork', 'home']),
});

export interface ModLaunchInput {
  /** the gnomon home (protected: never readable as a whole) */
  home: string;
  name: string;
  snapshotDir: string;
  /** the entry file inside the snapshot */
  entry: string;
  stateDir: string;
  blobsDir: string;
  readPaths: readonly string[];
  write: boolean;
  proxyPort: number | null;
  /** linked source folders: explicitly unreadable */
  denyRead: readonly string[];
  env: Record<string, string>;
  nodePath?: string;
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const real = (d: string): string => (existsSync(d) ? realpathSync(d) : d);
const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/**
 * Aegis round 2 (F1c): the mod-writable dirs must be REAL directories (lstat:
 * not a symlink) whose realpath is exactly the expected path — a mod (or
 * anyone) that swapped `state/` for a link to $HOME would otherwise have the
 * NEXT profile grant writes to $HOME. Checked before every profile build.
 */
export function assertRealModDir(p: string): void {
  let ok = false;
  try {
    const st = lstatSync(p);
    ok = st.isDirectory() && !st.isSymbolicLink() && realpathSync(p) === path.join(realpathSync(path.dirname(p)), path.basename(p));
  } catch {
    ok = false;
  }
  if (!ok) throw new LifecycleRefusal('sandbox-unavailable', `the mod-writable dir ${p} is not a real directory at its expected path (symlink or swap refused)`, { profile: 'mod', dir: p });
}

function darwinMod(i: ModLaunchInput, probe?: MacosProbe, sip?: SipProbe): ChildLaunchPlan {
  const floor = darwinFloor(probe, sip);
  if (!floor.ok) {
    throw new LifecycleRefusal('sandbox-unavailable', floor.floor === 'sip' ? `the mod profile needs System Integrity Protection enabled (have ${floor.have})` : `the mod profile needs macOS ${floor.need}+ (have ${floor.have ?? 'unknown'})`, { profile: 'mod', floor: floor.floor, have: floor.have, need: floor.need });
  }
  if (!existsSync(SANDBOX_EXEC)) throw new LifecycleRefusal('sandbox-unavailable', `${SANDBOX_EXEC} is missing`, { profile: 'mod' });
  const nodeReal = realpathSync(i.nodePath ?? childNodePath());
  const snapshotReal = realpathSync(i.snapshotDir);
  const entryReal = realpathSync(i.entry);
  if (!within(entryReal, snapshotReal)) throw new LifecycleRefusal('sandbox-unavailable', `the mod entry ${entryReal} is outside its snapshot`, { profile: 'mod' });
  assertRealModDir(i.stateDir);
  assertRealModDir(i.blobsDir);
  const readPaths = i.readPaths.map(real);
  const homeReal = real(i.home);
  const keys = path.join(homeReal, 'keys');
  // F1d: the writable dirs are checked like every granted path (never $HOME, the gnomon home or inside keys/)
  assertNoProtectedGrant([...readPaths, ...nodeRuntimeDirs(nodeReal), real(i.stateDir), real(i.blobsDir)], [real(homedir()), homeReal], [keys]);
  let profile: string;
  try {
    profile = modProfileSbpl({ nodeReal, snapshotReal, stateReal: real(i.stateDir), blobsReal: real(i.blobsDir), readPaths, write: i.write, proxyPort: i.proxyPort, denyRead: i.denyRead.map(real) });
  } catch (err) {
    if (err instanceof ModSbplError) throw new LifecycleRefusal('sandbox-unavailable', err.message, { profile: 'mod' });
    throw err;
  }
  return {
    command: SANDBOX_EXEC,
    args: ['-p', profile, nodeReal, entryReal],
    env: { ...i.env },
    sandbox: 'full',
    profile,
    profileHash: `sha256:${createHash('sha256').update(profile).digest('hex')}`,
  };
}

/** Platform registry of mod sandbox backends (G-WIN-05). */
export const MOD_SANDBOX_BACKENDS: Readonly<Partial<Record<string, (i: ModLaunchInput, probe?: MacosProbe, sip?: SipProbe) => ChildLaunchPlan>>> = Object.freeze({
  darwin: darwinMod,
  // win32: restricted token + ACL + job object (`partial` on read denial), Windows parity phase (P8-D78) — not built.
});

/** The launch plan for a mod child on `platform`; refuses where no profile can be applied. */
export function modLaunchPlan(i: ModLaunchInput, platform: string = process.platform, probe?: MacosProbe, sip?: SipProbe): ChildLaunchPlan {
  const backend = MOD_SANDBOX_BACKENDS[platform];
  if (!backend) throw new LifecycleRefusal('sandbox-unavailable', `no mod sandbox profile on ${platform} (§15.5; Windows parity phase P8-D78)`, { platform, profile: 'mod' });
  return backend(i, probe, sip);
}
