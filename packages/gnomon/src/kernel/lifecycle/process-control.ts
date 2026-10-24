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
 *
 * `snapshot()` (descendant sweep, T-2026-10-19-009 item 1) lists the whole
 * process table ASYNCHRONOUSLY (`ps -A -o pid=,ppid=,pgid=,lstart=`, TZ=UTC,
 * absolute path, from the kernel — never from inside a session sandbox), so
 * a stop can find a tool child that left the session's group (`setsid`,
 * daemonize) and check each one's `lstart` witness before it is signalled.
 * null = no snapshot (ps missing / failed / Windows) ⇒ the tree verdict is
 * `unverifiable`, never `exited`. Witness resolution is one second: a pid
 * recycled within the same wall-clock second as its predecessor started is
 * indistinguishable (accepted, reported).
 */
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export type GroupProbe = 'alive' | 'gone' | 'foreign' | 'unsupported';

/** One row of a process-table snapshot; `start` is the lstart witness. */
export interface ProcRow {
  pid: number;
  ppid: number;
  pgid: number;
  start: string;
}

export interface ProcessControl {
  fidelity: 'full' | 'partial';
  probeGroup(pgid: number): GroupProbe;
  /** Signal the group; false when it is already gone (or cannot be signalled). */
  signalGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean;
  /** Start-time witness of `pid`, or null when it cannot be read. */
  startTime(pid: number): string | null;
  /** Async process-table snapshot (POSIX), or null when none can be taken. Absent ⇒ tree verdict `unverifiable`. */
  snapshot?(): Promise<ProcRow[] | null>;
  /** Signal ONE pid (a descendant outside the group); false when gone or not signallable. */
  signalPid?(pid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean;
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

const PS_PATHS = ['/bin/ps', '/usr/bin/ps'];

/** Parse `ps -A -o pid=,ppid=,pgid=,lstart=` output; malformed lines are skipped. */
export function parsePsTable(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*\S)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), start: `lstart:${m[4]!.replace(/\s+/g, ' ')}` });
  }
  return rows;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse an `lstart` witness (`lstart:Mon Oct 19 12:34:56 2026`, or the bare
 * `ps -o lstart=` text) taken with TZ=UTC into epoch ms; null when it is not
 * that shape. Second resolution: the real start lies in [result, result+1 s).
 */
export function parseLstart(witness: string): number | null {
  const m = /^(?:lstart:)?\s*[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/.exec(witness);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!);
  if (month < 0) return null;
  const ms = Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Wall-clock start of `pid` in epoch ms (POSIX `ps -o lstart= -p`, absolute
 * path, TZ=UTC — the same witness the orphan sweep records), or null when it
 * cannot be read or parsed (no ps, ps failed, Windows). Used by
 * $daemon-lifecycle to tell a recycled pid from the pidfile's own holder
 * (T-2026-10-19-017). Forks ps: never on a hot path.
 */
export function processStartMs(pid: number, platform: NodeJS.Platform = process.platform): number | null {
  if (platform !== 'darwin' && platform !== 'linux') return null;
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const ps = PS_PATHS.find((p) => existsSync(p));
  if (!ps) return null;
  const r = spawnSync(ps, ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { LC_ALL: 'C', TZ: 'UTC', PATH: '/usr/bin:/bin' }, timeout: 5_000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return parseLstart(r.stdout.trim());
}

function posixSnapshot(): Promise<ProcRow[] | null> {
  const ps = PS_PATHS.find((p) => existsSync(p));
  if (!ps) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      ps,
      ['-A', '-o', 'pid=,ppid=,pgid=,lstart='],
      { encoding: 'utf8', env: { LC_ALL: 'C', TZ: 'UTC', PATH: '/usr/bin:/bin' }, timeout: 5_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        const rows = parsePsTable(stdout);
        resolve(rows.length > 0 ? rows : null);
      },
    );
  });
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
  snapshot: posixSnapshot,
  signalPid(pid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean {
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
    try {
      process.kill(pid, signal);
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
