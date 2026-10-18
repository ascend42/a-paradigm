/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rules 3–4, M1.9 falsifier "daemon exits with a
 * live child") — the daemon's supervised children and the orphan sweep.
 *
 * DaemonChildren: every child the daemon owns besides the web transport child
 * (which #web-endpoint stops itself) is tracked here — sessions and local
 * runners (spawned by #session-runner / #local-runner, M1.7 / M1.8) and mod
 * children (#mod-host, M1.11). `session.spawned{hsid, pid, pgid}` is written
 * when a session child is tracked and `session.exited` when it exits; at idle
 * exit and at every shutdown `stopAll` stops each child (staged: SIGTERM to
 * its group → grace → SIGKILL) and AWAITS its exit before the daemon writes
 * `daemon.exit` — so the daemon never exits with a live child. A mod child's
 * stop is logged `mod.stopped{name, reason}`.
 *
 * sweepOrphans (rule 4, G-DMN-04): on start, every `session.spawned` with no
 * `session.exited` / `session.orphaned` is an orphan of a crashed daemon. Its
 * group is probed (process-control.ts); the `session.orphaned` row is written
 * BEFORE any signal (chain write before side effect), then the group is
 * stopped. A group that is gone, foreign (EPERM) or unprobeable (Windows until
 * the parity phase) is recorded and never signalled. Residual (reported): a
 * pgid recycled by the OS within the same boot is indistinguishable here; the
 * spawn row will carry a process start-time witness once M1.7 spawns sessions.
 */
import type { ChildProcess } from 'node:child_process';
import type { ProcessControl } from './process-control.js';

export type ChildKind = 'session' | 'local-runner' | 'mod';

export interface TrackInput {
  kind: ChildKind;
  child: ChildProcess;
  /** Sessions and local runners. */
  hsid?: string;
  /** Mods. */
  name?: string;
}

type Append = (kind: string, payload: Record<string, unknown>) => Promise<void>;

interface Tracked {
  input: TrackInput;
  pid: number;
  exited: Promise<void>;
  stopReason?: string;
}

export const DEFAULT_CHILD_GRACE_MS = 2_000;

function exitedPromise(child: ChildProcess): Promise<void> {
  return new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', () => r())));
}

function within(p: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((r) => {
    const t = setTimeout(() => r(false), ms);
    void p.then(() => {
      clearTimeout(t);
      r(true);
    });
  });
}

export class DaemonChildren {
  readonly #append: Append;
  readonly #control: ProcessControl;
  readonly #graceMs: number;
  readonly #holdIdle: (() => () => void) | undefined;
  readonly #live = new Set<Tracked>();
  #closed = false;

  /** `holdIdle`: a live session / local runner holds idle exit (§2.4 rule 3 "no live sessions"); a mod never does (A23-2). */
  constructor(opts: { append: Append; control: ProcessControl; graceMs?: number; holdIdle?: () => () => void }) {
    this.#append = opts.append;
    this.#holdIdle = opts.holdIdle;
    this.#control = opts.control;
    this.#graceMs = opts.graceMs ?? DEFAULT_CHILD_GRACE_MS;
  }

  /** Children still running. */
  live(): number {
    return this.#live.size;
  }

  /** Track a spawned child. Refused after shutdown began: the caller must stop it. */
  async track(input: TrackInput): Promise<void> {
    const pid = input.child.pid;
    if (this.#closed) throw new Error('daemon is stopping: no new children');
    if (pid === undefined) throw new Error('child has no pid (spawn failed)');
    const t: Tracked = { input, pid, exited: exitedPromise(input.child) };
    this.#live.add(t);
    const isSession = input.kind !== 'mod';
    const release = isSession ? this.#holdIdle?.() : undefined;
    if (isSession) await this.#append('session.spawned', { hsid: input.hsid ?? null, kind: input.kind, pid, pgid: pid });
    void t.exited.then(async () => {
      this.#live.delete(t);
      release?.();
      if (isSession) {
        await this.#append('session.exited', {
          hsid: input.hsid ?? null,
          pid,
          code: input.child.exitCode,
          signal: input.child.signalCode,
          ...(t.stopReason ? { reason: t.stopReason } : {}),
        }).catch(() => undefined);
      }
    });
  }

  /** Stop every child and await each exit (idle exit, shutdown). Returns the count still alive (0 unless a kill failed). */
  async stopAll(reason: string): Promise<number> {
    this.#closed = true;
    await Promise.all([...this.#live].map((t) => this.#stop(t, reason)));
    // let exit handlers write their rows
    await new Promise((r) => setImmediate(r));
    return this.#live.size;
  }

  async #stop(t: Tracked, reason: string): Promise<void> {
    t.stopReason = reason;
    const { child } = t.input;
    const signal = (s: 'SIGTERM' | 'SIGKILL'): void => {
      if (!this.#control.signalGroup(t.pid, s)) child.kill(s);
    };
    if (child.exitCode === null && child.signalCode === null) {
      signal('SIGTERM');
      if (!(await within(t.exited, this.#graceMs))) {
        signal('SIGKILL');
        await within(t.exited, this.#graceMs);
      }
    }
    if (t.input.kind === 'mod') await this.#append('mod.stopped', { name: t.input.name ?? null, reason }).catch(() => undefined);
  }
}

export interface OrphanRow {
  kind: string;
  payload: unknown;
}

export interface SweepResult {
  orphans: number;
  stopped: number;
}

/** G-DMN-04: find `session.spawned` without an end row; record, then stop. */
export async function sweepOrphans(opts: {
  rows: Iterable<OrphanRow>;
  append: Append;
  control: ProcessControl;
  graceMs?: number;
  pollMs?: number;
}): Promise<SweepResult> {
  const open = new Map<string, { hsid: string | null; pid: number; pgid: number }>();
  const idOf = (p: { hsid?: unknown; pid?: unknown }): string => (typeof p.hsid === 'string' ? `h:${p.hsid}` : `p:${String(p.pid)}`);
  for (const r of opts.rows) {
    const p = (r.payload ?? {}) as { hsid?: unknown; pid?: unknown; pgid?: unknown };
    if (r.kind === 'session.spawned') {
      if (typeof p.pid !== 'number') continue;
      open.set(idOf(p), { hsid: typeof p.hsid === 'string' ? p.hsid : null, pid: p.pid, pgid: typeof p.pgid === 'number' ? p.pgid : p.pid });
    } else if (r.kind === 'session.exited' || r.kind === 'session.orphaned') open.delete(idOf(p));
  }
  const grace = opts.graceMs ?? DEFAULT_CHILD_GRACE_MS;
  const poll = opts.pollMs ?? 25;
  const gone = async (pgid: number, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (opts.control.probeGroup(pgid) !== 'alive') return true;
      await new Promise((r) => setTimeout(r, poll));
    }
    return opts.control.probeGroup(pgid) !== 'alive';
  };
  let stopped = 0;
  for (const o of open.values()) {
    const probe = opts.control.probeGroup(o.pgid);
    const action = probe === 'alive' ? 'stop' : 'none';
    await opts.append('session.orphaned', { hsid: o.hsid, pid: o.pid, pgid: o.pgid, probe, action, fidelity: opts.control.fidelity });
    if (action !== 'stop') continue;
    opts.control.signalGroup(o.pgid, 'SIGTERM');
    if (!(await gone(o.pgid, grace))) {
      opts.control.signalGroup(o.pgid, 'SIGKILL');
      await gone(o.pgid, grace);
    }
    stopped++;
  }
  return { orphans: open.size, stopped };
}
