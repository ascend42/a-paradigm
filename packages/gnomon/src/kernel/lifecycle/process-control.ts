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
 */

export type GroupProbe = 'alive' | 'gone' | 'foreign' | 'unsupported';

export interface ProcessControl {
  fidelity: 'full' | 'partial';
  probeGroup(pgid: number): GroupProbe;
  /** Signal the group; false when it is already gone (or cannot be signalled). */
  signalGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean;
}

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

const POSIX: ProcessControl = {
  fidelity: 'full',
  probeGroup(pgid) {
    if (!Number.isInteger(pgid) || pgid <= 1) return 'foreign'; // never pgid 0/1: that is us or init
    try {
      process.kill(-pgid, 0);
      return 'alive';
    } catch (err) {
      return errno(err) === 'EPERM' ? 'foreign' : 'gone';
    }
  },
  signalGroup(pgid, signal) {
    if (!Number.isInteger(pgid) || pgid <= 1) return false;
    try {
      process.kill(-pgid, signal);
      return true;
    } catch {
      return false;
    }
  },
};

const PARITY_PHASE: ProcessControl = {
  fidelity: 'partial',
  probeGroup: () => 'unsupported',
  signalGroup: () => false,
};

export const PROCESS_CONTROL: Readonly<Record<'darwin' | 'linux' | 'win32', ProcessControl>> = Object.freeze({
  darwin: POSIX,
  linux: POSIX,
  win32: PARITY_PHASE,
});

/** The row for `platform`; an unlisted platform gets the fail-closed parity row. */
export function processControlFor(platform: NodeJS.Platform = process.platform): ProcessControl {
  return (PROCESS_CONTROL as Record<string, ProcessControl>)[platform] ?? PARITY_PHASE;
}
