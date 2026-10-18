/**
 * @symbol #session-runner
 *
 * The macOS major version, read in PLATFORM code (G-WIN-05: kernel code never
 * branches on the OS; it calls this probe through the session backend
 * registry). `sw_vers -productVersion` by absolute path, cached per process.
 * null = unknown (not macOS, or sw_vers failed) — callers fail closed.
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
