/**
 * @symbol #oracle-sandbox
 * @symbol #session-runner
 *
 * The `session` sandbox profile's platform registry (spec §15.5 row
 * `session`, §16 "Session denies"; G-WIN-05: no platform branch in kernel
 * code). darwin = `sandbox-exec -p <generated SBPL> <claude real> <argv…>`
 * (platform/darwin/session-sbpl.ts). win32 = restricted token + ACEs + the
 * S29-08 WFP mechanism, Windows parity phase (P8-D78) — not built. linux has
 * no session mechanism yet (every class `none`, platform/session-denies.ts).
 * A platform with no backend REFUSES `sandbox-unavailable`: a session never
 * spawns unsandboxed and never silently degraded (§15.5 rule). The §15.5
 * `gate-class` card that lets a human accept a `partial` profile is M1.7
 * slice 2 (with the Windows row it exists for); `sessionSandboxFidelity`
 * gives status its `full | partial | none` per platform (G-WIN-06).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import type { SessionPolicy } from '../manifest/policy.js';
import { SESSION_DENY_REALISATION, type DenyPlatform } from '../../platform/session-denies.js';
import { SbplError, sessionProfileSbpl, type DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';

export interface SessionLaunchInput {
  policy: SessionPolicy;
  /** realpath of the driver binary (claude) */
  binaryReal: string;
  argv: string[];
  extras: DarwinSessionExtras;
}

export interface SessionLaunchPlan {
  command: string;
  args: string[];
  sandbox: 'full' | 'partial';
  profile: string;
  profileHash: string;
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

function darwinSession(i: SessionLaunchInput): SessionLaunchPlan {
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

/** Platform registry of session sandbox backends (G-WIN-05). */
export const SESSION_SANDBOX_BACKENDS: Readonly<Partial<Record<string, (i: SessionLaunchInput) => SessionLaunchPlan>>> = Object.freeze({
  darwin: darwinSession,
  // win32: restricted token + ACEs + WFP (S29-08), Windows parity phase (P8-D78) — not built.
});

export function sessionLaunchPlan(i: SessionLaunchInput, platform: string = process.platform): SessionLaunchPlan {
  const backend = SESSION_SANDBOX_BACKENDS[platform];
  if (!backend) throw new LifecycleRefusal('sandbox-unavailable', `no session sandbox profile on ${platform} (§15.5; Windows parity phase P8-D78)`, { platform, profile: 'session' });
  return backend(i);
}

/** status: the session profile's fidelity on `platform` — full only with a backend and every class full (G-WIN-06). */
export function sessionSandboxFidelity(platform: string = process.platform): { fidelity: 'full' | 'partial' | 'none'; classes: Record<string, string> } {
  const row = (SESSION_DENY_REALISATION as Record<string, (typeof SESSION_DENY_REALISATION)[DenyPlatform]>)[platform];
  const classes: Record<string, string> = {};
  for (const [k, v] of Object.entries(row ?? {})) classes[k] = v.fidelity;
  if (!SESSION_SANDBOX_BACKENDS[platform] || !row) return { fidelity: row ? 'partial' : 'none', classes };
  return { fidelity: Object.values(row).every((v) => v.fidelity === 'full') ? 'full' : 'partial', classes };
}
