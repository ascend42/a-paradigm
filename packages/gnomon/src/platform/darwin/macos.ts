/**
 * @symbol #session-runner
 *
 * Host facts the session profile's floor needs, read in PLATFORM code
 * (G-WIN-05: kernel code never branches on the OS; it calls these probes
 * through the session backend registry). Both by absolute path, cached per
 * process; null = unknown — callers fail closed.
 *   - the macOS major: `sw_vers -productVersion`;
 *   - System Integrity Protection: `csrutil status`.
 */
import { spawnSync } from 'node:child_process';

let cached: number | null | undefined;

export function darwinMacosMajor(): number | null {
  if (cached !== undefined) return cached;
  try {
    const r = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5_000, env: { PATH: '/usr/bin:/bin' } });
    const m = r.status === 0 ? /^(\d+)\./.exec(r.stdout.trim()) : null;
    cached = m ? Number(m[1]) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export type MacosProbe = () => number | null;

/**
 * Parse `csrutil status`: true only for a plain "status: enabled." — a
 * Custom Configuration (some protections off) or "disabled" is false; any
 * other text is null (unknown). Exported for tests.
 */
export function parseCsrutilStatus(text: string): boolean | null {
  if (/Custom Configuration/i.test(text) || /status: disabled/i.test(text)) return false;
  if (/^System Integrity Protection status: enabled\.?\s*$/m.test(text)) return true;
  return null;
}

let sipCached: boolean | null | undefined;

/**
 * System Integrity Protection on this host. Why the session profile needs it
 * (CI run 39100811385, GitHub's macos-15 runner, SIP off): launch constraints
 * are not enforced there, so a COPIED launchctl/osascript is not SIGKILLed
 * and the profile's launcher exec denies no longer hold by themselves.
 */
export function darwinSipEnabled(): boolean | null {
  if (sipCached !== undefined) return sipCached;
  try {
    const r = spawnSync('/usr/bin/csrutil', ['status'], { encoding: 'utf8', timeout: 5_000, env: { PATH: '/usr/bin:/bin' } });
    sipCached = r.status === 0 ? parseCsrutilStatus(r.stdout) : null;
  } catch {
    sipCached = null;
  }
  return sipCached;
}

/** true = enabled; false = disabled or partially disabled; null = unknown (fail closed) */
export type SipProbe = () => boolean | null;
