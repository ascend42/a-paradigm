/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 4, §16 "Process isolation + kill") — the
 * platform registry for probing and stopping a supervised child's process
 * group. Kernel code picks a row by platform key and never branches on the
 * platform itself (G-WIN-05).
 *
 * - darwin / linux: the child is spawned `detached` with its own pgid; probe =
 *   signal 0 to the group, stop = SIGTERM to the group, then SIGKILL after the
 *   grace. EPERM on the probe means the group is not ours: never signalled.
 * - win32: the job object `KILL_ON_JOB_CLOSE` via the signed helper is the
 *   Windows parity phase (P8-D78); until then the row reports `unsupported`
 *   for groups, so the orphan sweep records the orphan and stops nothing it
 *   cannot attribute (fail closed, reported `partial`).
 *
 * `startTime(pid)` is the group leader's start-time witness (macOS `ps -o
 * lstart=` by absolute path; Linux field 22 of /proc/<pid>/stat), recorded in
 * `session.spawned` so a recycled pid is never mistaken for the child the row
 * names. null = no witness ⇒ the orphan sweep never signals. `ps` runs with
 * TZ=UTC so the witness does not move with the system timezone. COST: on macOS
 * each read forks /bin/ps — call it only at track() and in the start-up
 * sweep, never on a hot path.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export type GroupProbe = 'alive' | 'gone' | 'foreign' | 'unsupported';

export interface ProcessControl {
  fidelity: 'full' | 'partial';
  probeGroup(pgid: number): GroupProbe;
  /** Signal the group; false when it is already gone (or cannot be signalled). */
  signalGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean;
  /** Start-time witness of `pid`, or null when it cannot be read. */
  startTime(pid: number): string | null;
}

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function darwinStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const r = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { LC_ALL: 'C', TZ: 'UTC', PATH: '/usr/bin:/bin' }, timeout: 5_000 });
  const out = r.status === 0 ? r.stdout.trim() : '';
  return out ? `lstart:${out}` : null;
}

function linuxStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // comm (field 2) may contain spaces/parens: split after the LAST ')'
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = rest[19]; // field 22 = index 19 after field 3
    return ticks ? `stat22:${ticks}` : null;
  } catch {
    return null;
  }
}

const POSIX_BASE = {
  fidelity: 'full' as const,
  probeGroup(pgid: number): GroupProbe {
    if (!Number.isInteger(pgid) || pgid <= 1) return 'foreign'; // never pgid 0/1: that is us or init
    try {
      process.kill(-pgid, 0);
      return 'alive';
    } catch (err) {
      return errno(err) === 'EPERM' ? 'foreign' : 'gone';
    }
  },
  signalGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean {
    if (!Number.isInteger(pgid) || pgid <= 1) return false;
    try {
      process.kill(-pgid, signal);
      return true;
    } catch {
      return false;
    }
  },
} satisfies Omit<ProcessControl, 'startTime'>;

const PARITY_PHASE: ProcessControl = {
  fidelity: 'partial',
  probeGroup: () => 'unsupported',
  signalGroup: () => false,
  startTime: () => null,
};

export const PROCESS_CONTROL: Readonly<Record<'darwin' | 'linux' | 'win32', ProcessControl>> = Object.freeze({
  darwin: { ...POSIX_BASE, startTime: darwinStartTime },
  linux: { ...POSIX_BASE, startTime: linuxStartTime },
  win32: PARITY_PHASE,
});

/** The row for `platform`; an unlisted platform gets the fail-closed parity row. */
export function processControlFor(platform: NodeJS.Platform = process.platform): ProcessControl {
  return (PROCESS_CONTROL as Record<string, ProcessControl>)[platform] ?? PARITY_PHASE;
}
