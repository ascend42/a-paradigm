/**
 * @symbol #oracle-sandbox
 * @symbol #session-runner
 *
 * The `session` sandbox profile's platform registry (spec §15.5 row
 * `session`, §16 "Session denies"; G-WIN-05: no platform branch in kernel
 * code). darwin = `sandbox-exec -p <generated SBPL> <claude real> <argv…>`
 * (platform/darwin/session-sbpl.ts). win32 = Low integrity + restricted token
 * + session-SID ACEs + a private desktop (platform/win32/session-sandbox.ts,
 * W5), always `partial` (no WFP loopback filter yet, probe P10w). linux has
 * no session mechanism yet (every class `none`, platform/session-denies.ts).
 * A platform with no backend REFUSES `sandbox-unavailable`: a session never
 * spawns unsandboxed and never silently degraded (§15.5 rule). The §15.5
 * `gate-class` card that lets a human accept a `partial` profile is M1.7
 * slice 2 (with the Windows row it exists for); `sessionSandboxFidelity`
 * gives status its `full | partial | none` per platform (G-WIN-06).
 * The darwin floor: macOS 15+ AND System Integrity Protection enabled
 * (CI runs 39100281741, 39100811385) — below either the backend refuses
 * `sandbox-unavailable` and status reports `unavailable` (never a weaker
 * profile).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import type { SessionPolicy } from '../manifest/policy.js';
import { SESSION_DENY_REALISATION, type DenyPlatform } from '../../platform/session-denies.js';
import { SbplError, sessionProfileSbpl, SESSION_SANDBOX_MIN_MACOS, type DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { darwinMacosMajor, darwinSipEnabled, type MacosProbe, type SipProbe } from '../../platform/darwin/macos.js';
import { sessionSidFor, win32SessionPlan } from '../../platform/win32/session-sandbox.js';

export interface SessionLaunchInput {
  policy: SessionPolicy;
  /** realpath of the driver binary (claude) */
  binaryReal: string;
  argv: string[];
  extras: DarwinSessionExtras;
  /** the session's hsid (win32: its own restricting SID, sessionSidFor) */
  hsid?: string;
}

export interface SessionLaunchPlan {
  command: string;
  args: string[];
  sandbox: 'full' | 'partial';
  profile: string;
  profileHash: string;
  /** what this launch could not deny (Aegis M1, PR #52): logged on the session.sandbox row, never dropped */
  partial?: readonly string[];
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export interface FloorResult {
  ok: boolean;
  /** which floor failed: the macOS major, or System Integrity Protection */
  floor?: 'macos' | 'sip';
  have: number | string | null;
  need: number | string;
}

/**
 * The darwin floor (platform data): below SESSION_SANDBOX_MIN_MACOS, or with
 * SIP disabled / partially disabled / unknown, the backend refuses — never a
 * weaker profile. macOS is checked first. `probe`/`sip` are test seams.
 */
export function darwinFloor(probe: MacosProbe = darwinMacosMajor, sip: SipProbe = darwinSipEnabled): FloorResult {
  const have = probe();
  if (have === null || have < SESSION_SANDBOX_MIN_MACOS) return { ok: false, floor: 'macos', have, need: SESSION_SANDBOX_MIN_MACOS };
  const s = sip();
  if (s !== true) return { ok: false, floor: 'sip', have: s === false ? 'disabled' : 'unknown', need: 'enabled' };
  return { ok: true, have, need: SESSION_SANDBOX_MIN_MACOS };
}

function darwinSession(i: SessionLaunchInput, probe?: MacosProbe, sip?: SipProbe): SessionLaunchPlan {
  const floor = darwinFloor(probe, sip);
  if (floor.floor === 'macos') {
    throw new LifecycleRefusal('sandbox-unavailable', `the session profile needs macOS ${floor.need}+ (have ${floor.have ?? 'unknown'}): below it a copied launcher escapes (§A.2(iv))`, { profile: 'session', floor: 'macos', have: floor.have, need: floor.need });
  }
  if (floor.floor === 'sip') {
    throw new LifecycleRefusal('sandbox-unavailable', `the session profile needs System Integrity Protection enabled (have ${floor.have}): without it launch constraints are not enforced and a copied launcher is not killed (§A.2(iv))`, { profile: 'session', floor: 'sip', have: floor.have });
  }
  if (!existsSync(SANDBOX_EXEC)) throw new LifecycleRefusal('sandbox-unavailable', `${SANDBOX_EXEC} is missing`, { profile: 'session' });
  let profile: string;
  try {
    profile = sessionProfileSbpl(i.policy, i.extras);
  } catch (err) {
    if (err instanceof SbplError) throw new LifecycleRefusal('sandbox-unavailable', err.message, { profile: 'session' });
    throw err;
  }
  return {
    command: SANDBOX_EXEC,
    args: ['-p', profile, i.binaryReal, ...i.argv],
    // ipc:helper-service has no mechanism until the helper exists (M1.3): the rest is full
    sandbox: 'full',
    profile,
    profileHash: `sha256:${createHash('sha256').update(profile).digest('hex')}`,
  };
}

/** win32 (W5): Low integrity + a restricted token + session-SID ACEs + a private desktop (platform/win32/session-sandbox.ts). */
function win32Session(i: SessionLaunchInput): SessionLaunchPlan {
  if (!i.hsid) throw new LifecycleRefusal('sandbox-unavailable', 'a win32 session launch needs its hsid (its own SID)', { profile: 'session' });
  const p = win32SessionPlan({ policy: i.policy, roots: i.extras.roots, tempDir: i.extras.tmpdir, sessionSid: sessionSidFor(i.hsid), binaryReal: i.binaryReal, argv: i.argv });
  return { command: p.command, args: p.args, sandbox: p.sandbox, profile: p.profile, profileHash: p.profileHash, partial: p.partial };
}

/** Platform registry of session sandbox backends (G-WIN-05). */
export const SESSION_SANDBOX_BACKENDS: Readonly<Partial<Record<string, (i: SessionLaunchInput, probe?: MacosProbe, sip?: SipProbe) => SessionLaunchPlan>>> = Object.freeze({
  darwin: darwinSession,
  win32: win32Session,
});

/** `probe` reads the OS version and `sip` System Integrity Protection (platform code); tests pass fixed ones to exercise the floor refusals. */
export function sessionLaunchPlan(i: SessionLaunchInput, platform: string = process.platform, probe?: MacosProbe, sip?: SipProbe): SessionLaunchPlan {
  const backend = SESSION_SANDBOX_BACKENDS[platform];
  if (!backend) throw new LifecycleRefusal('sandbox-unavailable', `no session sandbox profile on ${platform} (§15.5; Windows parity phase P8-D78)`, { platform, profile: 'session' });
  return backend(i, probe, sip);
}

/** Host floors per platform (registry, G-WIN-05): darwin has one (macOS + SIP); others have no backend at all. */
const SESSION_FLOORS: Readonly<Partial<Record<string, (probe?: MacosProbe, sip?: SipProbe) => FloorResult>>> = Object.freeze({ darwin: darwinFloor });

/** status: the session profile's fidelity on `platform` — full only with a backend and every class full (G-WIN-06). */
export function sessionSandboxFidelity(platform: string = process.platform, probe?: MacosProbe, sip?: SipProbe): { fidelity: 'full' | 'partial' | 'none' | 'unavailable'; classes: Record<string, string>; reason?: string; have?: number | string | null; need?: number | string } {
  const row = (SESSION_DENY_REALISATION as Record<string, (typeof SESSION_DENY_REALISATION)[DenyPlatform]>)[platform];
  const classes: Record<string, string> = {};
  for (const [k, v] of Object.entries(row ?? {})) classes[k] = v.fidelity;
  const floor = SESSION_FLOORS[platform]?.(probe, sip);
  if (floor && !floor.ok) return { fidelity: 'unavailable', classes, reason: floor.floor === 'sip' ? 'sip-disabled' : 'macos-floor', have: floor.have, need: floor.need };
  if (!SESSION_SANDBOX_BACKENDS[platform] || !row) return { fidelity: row ? 'partial' : 'none', classes };
  return { fidelity: Object.values(row).every((v) => v.fidelity === 'full') ? 'full' : 'partial', classes };
}
