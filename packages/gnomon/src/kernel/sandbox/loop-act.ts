/**
 * @symbol #loop-act
 * @symbol #oracle-sandbox
 *
 * The `loop-act` sandbox profile's platform registry (docs/specs/gnomon-loops.md §4 "Sandboxes"; build plan step 10;
 * G-WIN-05: no platform branch in kernel code). An act node's gnomon-local child runs under the generated `session`
 * profile plus the loop-act tail (platform/darwin/loop-act-sbpl.ts): outbound only to the loopback port of its
 * `loops: true` endpoint, writes only in the scratch worktree (and its private tmp), the human repo unreadable except
 * its node_modules, the Gnomon home unreadable except the run dir, credential stores denied. darwin only, under the
 * session floor (macOS 15+ and SIP). win32 is ABSENT, like loop-check: a loop act run there refuses
 * `sandbox-unavailable` until W5 (the runner refuses the whole run first, LOOP_CHECK_BACKENDS).
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { loopActTailSbpl, LoopActSbplError, LOOP_ACT_PROFILE_VERSION } from '../../platform/darwin/loop-act-sbpl.js';
import { SbplError, sessionProfileSbpl } from '../../platform/darwin/session-sbpl.js';
import type { MacosProbe, SipProbe } from '../../platform/darwin/macos.js';
import { darwinFloor, type SessionLaunchInput, type SessionLaunchPlan } from './session.js';
import { LOOP_CHECK_CREDENTIAL_STORES, LOOP_WORK_DIR } from './loop-check.js';

/** The `loop-act` profile as data (versioned). */
export const LOOP_ACT_PROFILE = Object.freeze({
  name: 'loop-act' as const,
  version: LOOP_ACT_PROFILE_VERSION,
  base: 'session',
  allow: Object.freeze({
    read: Object.freeze(['the scratch worktree (the repo copy) and its run dir', "the repo's node_modules (read only)", 'what the session profile allows outside the Gnomon home and the repo']),
    write: Object.freeze(['the scratch worktree', "the run's private tmp"]),
    network: 'the loopback port of the configured loops: true endpoint only',
    exec: 'the pinned runner node only',
  }),
  deny: Object.freeze(['the human repo (but node_modules)', 'the Gnomon home (but the run dir)', 'credential stores', 'every other connect, unix sockets included', 'every other exec', 'every other write']),
});

export interface LoopActSpec {
  /** the Gnomon home */
  home: string;
  userHome?: string;
  /** the scratch worktree `<home>/loop-work/act-<runId>/tree` */
  scratch: string;
  /** its private tmp `<home>/loop-work/act-<runId>/tmp` */
  tmp: string;
  /** the human repo */
  repo: string;
  nodeModules: readonly string[];
  endpointPort: number;
  /** the repo's git common dir and its other worktrees (read denied) */
  gitDeny?: readonly string[];
}

export type LoopActLaunchInput = SessionLaunchInput & { act: LoopActSpec };

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const real = (d: string): string => (existsSync(d) ? realpathSync.native(d) : d);

function darwinLoopAct(i: LoopActLaunchInput, probe?: MacosProbe, sip?: SipProbe): SessionLaunchPlan {
  const floor = darwinFloor(probe, sip);
  if (!floor.ok) throw new LifecycleRefusal('sandbox-unavailable', floor.floor === 'sip' ? `the loop-act profile needs System Integrity Protection enabled (have ${floor.have})` : `the loop-act profile needs macOS ${floor.need}+ (have ${floor.have ?? 'unknown'})`, { profile: 'loop-act', floor: floor.floor, have: floor.have, need: floor.need });
  if (!existsSync(SANDBOX_EXEC)) throw new LifecycleRefusal('sandbox-unavailable', `${SANDBOX_EXEC} is missing`, { profile: 'loop-act' });
  const homeReal = real(i.act.home);
  const scratchReal = realpathSync.native(i.act.scratch);
  const runDirReal = path.dirname(scratchReal);
  // the one grant inside the Gnomon home: exactly <home>/loop-work/act-<runId>/{tree,tmp}, real dirs
  if (path.dirname(runDirReal) !== path.join(homeReal, LOOP_WORK_DIR) || !/^act-[A-Za-z0-9_-]{1,64}$/.test(path.basename(runDirReal)) || path.basename(scratchReal) !== 'tree' || lstatSync(i.act.scratch).isSymbolicLink()) {
    throw new LifecycleRefusal('sandbox-unavailable', `the loop-act scratch must be ${path.join(homeReal, LOOP_WORK_DIR, 'act-<runId>', 'tree')} (got ${scratchReal})`, { profile: 'loop-act' });
  }
  const tmpReal = realpathSync.native(i.act.tmp);
  if (tmpReal !== path.join(runDirReal, 'tmp')) throw new LifecycleRefusal('sandbox-unavailable', 'the loop-act tmp must be the run dir\'s tmp', { profile: 'loop-act' });
  const userHome = real(i.act.userHome ?? homedir());
  const repoReal = realpathSync.native(i.act.repo);
  if (repoReal === userHome || repoReal === path.parse(repoReal).root) throw new LifecycleRefusal('sandbox-unavailable', 'the loop-act repo may not be / or the user home', { profile: 'loop-act' });
  // Aegis M2: an endpoint on a port the kernel denies to sessions is refused, never re-opened by the allow
  if (i.policy.denyLoopbackPorts.includes(i.act.endpointPort)) throw new LifecycleRefusal('sandbox-unavailable', `the loop endpoint port ${i.act.endpointPort} is a port the kernel denies to sessions`, { profile: 'loop-act', port: i.act.endpointPort });
  // Aegis L3: every node_modules grant is a real dir named node_modules inside the repo, under no .git component
  const nodeModulesReal = i.act.nodeModules.map(real);
  for (const n of nodeModulesReal) {
    const rel = path.relative(repoReal, n);
    if (path.basename(n) !== 'node_modules' || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((c) => c.toLowerCase().replace(/[. ]+$/, '') === '.git') || !lstatSync(n).isDirectory()) {
      throw new LifecycleRefusal('sandbox-unavailable', `the loop-act profile would grant ${n}, which is not a node_modules dir inside the repo`, { profile: 'loop-act' });
    }
  }
  const denyReal = [path.join(homeReal, 'keys'), ...LOOP_CHECK_CREDENTIAL_STORES.map((c) => real(path.join(userHome, ...c.split('/'))))];
  let profile: string;
  try {
    profile = [sessionProfileSbpl(i.policy, i.extras).trimEnd(), ...loopActTailSbpl({ scratchReal, runDirReal, tmpReal, repoReal, nodeModulesReal, nodeReal: realpathSync.native(i.binaryReal), endpointPort: i.act.endpointPort, denyLoopbackPorts: i.policy.denyLoopbackPorts, gitDenyReal: (i.act.gitDeny ?? []).map(real), denyReal }), ''].join('\n');
  } catch (err) {
    if (err instanceof SbplError || err instanceof LoopActSbplError) throw new LifecycleRefusal('sandbox-unavailable', err.message, { profile: 'loop-act' });
    throw err;
  }
  return { command: SANDBOX_EXEC, args: ['-p', profile, i.binaryReal, ...i.argv], sandbox: 'full', profile, profileHash: `sha256:${createHash('sha256').update(profile).digest('hex')}` };
}

/** Platform registry of loop-act sandbox backends (G-WIN-05). win32 is the Windows session's to fill (W5). */
export const LOOP_ACT_BACKENDS: Readonly<Partial<Record<string, (i: LoopActLaunchInput, probe?: MacosProbe, sip?: SipProbe) => SessionLaunchPlan>>> = Object.freeze({
  darwin: darwinLoopAct,
  // win32: the session's restricted token + ACEs + WFP with the act narrowing, the Windows session (W5) — not built.
});

/** The launch plan for an act node's local child on `platform`; refuses `sandbox-unavailable` where none applies. */
export function loopActLaunchPlan(i: LoopActLaunchInput, platform: string = process.platform, probe?: MacosProbe, sip?: SipProbe): SessionLaunchPlan {
  const backend = LOOP_ACT_BACKENDS[platform];
  if (!backend) throw new LifecycleRefusal('sandbox-unavailable', `no loop-act sandbox profile on ${platform} (gnomon-loops.md §4; the Windows backend lands with W5)`, { platform, profile: 'loop-act' });
  return backend(i, probe, sip);
}
