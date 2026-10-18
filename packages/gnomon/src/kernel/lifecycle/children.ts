/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rules 3–4, M1.9 falsifier "daemon exits with a
 * live child") — the daemon's supervised children and the orphan sweep.
 *
 * DaemonChildren: every child the daemon owns besides the web transport child
 * (which #web-endpoint stops itself) is tracked here — sessions and local
 * runners (spawned by #session-runner / #local-runner, M1.7 / M1.8) and mod
 * children (#mod-host, M1.11). At idle exit and at every shutdown `stopAll`
 * stops each child (staged: SIGTERM to its group → grace → SIGKILL) and AWAITS
 * its exit before the daemon writes `daemon.exit` — so the daemon never exits
 * with a live child. A mod child's stop is logged `mod.stopped{name, reason}`.
 *
 * Spawn rows: `intend()` writes `session.spawned{phase:'intent', spawnId,
 * boot}` BEFORE the spawner forks (a crash in the spawn gap stays visible);
 * `track()` writes `session.spawned{phase:'running', spawnId, pid, pgid,
 * boot, startTime}` and `session.exited` on exit. A session / local-runner
 * child must lead its own process group (spawned `detached`), else track()
 * refuses. Stopping waits for the leader, then probes the group: members that
 * outlive the leader are SIGKILLed and counted as survivors until gone.
 *
 * sweepOrphans (rule 4, G-DMN-04): on start, every KERNEL-written
 * `session.spawned` with no `session.exited` / `session.orphaned` is an orphan
 * of a crashed daemon. `session.orphaned` is written BEFORE any signal (chain
 * write before side effect). The group is signalled ONLY when the row's boot
 * session equals this boot AND the live leader's start-time witness equals the
 * recorded one — otherwise `probe:'stale-boot' | 'unattributable'`,
 * `action:'none'`, so a recycled pid is never signalled. Gone, foreign (EPERM)
 * and unprobeable (Windows until the parity phase) groups are recorded and
 * never signalled. Orphans are stopped in parallel; `stopped` counts only
 * groups that are gone.
 *
 * RESIDUAL (reported): §9.1 has no `mod.spawned` / `mod.exited` kind (adding
 * one moves clientApiId), so a mod child orphaned by a daemon crash is not
 * swept; mod children are tracked in memory and stopped at every exit.
 */
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { ProcessControl } from './process-control.js';

export type ChildKind = 'session' | 'local-runner' | 'mod';
export type SessionChildKind = Exclude<ChildKind, 'mod'>;

export interface SpawnIntent {
  spawnId: string;
  kind: SessionChildKind;
  hsid?: string;
}

export interface TrackInput {
  kind: ChildKind;
  child: ChildProcess;
  /** Sessions and local runners. */
  hsid?: string;
  /** Mods. */
  name?: string;
  /** From intend(), for sessions / local runners (minted here when absent). */
  intent?: SpawnIntent;
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

async function groupGone(control: ProcessControl, pgid: number, ms: number, pollMs = 25): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (control.probeGroup(pgid) !== 'alive') return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return control.probeGroup(pgid) !== 'alive';
}

const isLive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

export interface DaemonChildrenOptions {
  append: Append;
  control: ProcessControl;
  /** This boot session (log/boot.ts readBootSession), recorded in every spawn row. */
  boot: string;
  graceMs?: number;
  /** A live session / local runner holds idle exit (§2.4 rule 3 "no live sessions"); a mod never does (A23-2). */
  holdIdle?: () => () => void;
}

export class DaemonChildren {
  readonly #o: DaemonChildrenOptions;
  readonly #graceMs: number;
  readonly #live = new Set<Tracked>();
  #closed = false;

  constructor(opts: DaemonChildrenOptions) {
    this.#o = opts;
    this.#graceMs = opts.graceMs ?? DEFAULT_CHILD_GRACE_MS;
  }

  /** Children still running. */
  live(): number {
    return this.#live.size;
  }

  /** Record the intent to spawn BEFORE forking (rule 4: chain write before side effect). */
  async intend(input: { kind: SessionChildKind; hsid?: string }): Promise<SpawnIntent> {
    if (this.#closed) throw new Error('daemon is stopping: no new children');
    const intent: SpawnIntent = { spawnId: randomUUID(), kind: input.kind, ...(input.hsid ? { hsid: input.hsid } : {}) };
    await this.#o.append('session.spawned', { phase: 'intent', spawnId: intent.spawnId, hsid: input.hsid ?? null, kind: input.kind, boot: this.#o.boot });
    return intent;
  }

  /** Track a spawned child. Refused after shutdown began, or for a session child that does not lead its own group: the caller must stop it. */
  async track(input: TrackInput): Promise<void> {
    const pid = input.child.pid;
    if (this.#closed) throw new Error('daemon is stopping: no new children');
    if (pid === undefined) throw new Error('child has no pid (spawn failed)');
    const session = input.kind !== 'mod';
    if (session && isLive(input.child) && this.#o.control.probeGroup(pid) === 'gone') {
      throw new Error(`a ${input.kind} child must be spawned detached (its own process group) so it can be stopped as a group`);
    }
    let spawnId: string | null = null;
    if (session) spawnId = (input.intent ?? (await this.intend({ kind: input.kind as SessionChildKind, ...(input.hsid ? { hsid: input.hsid } : {}) }))).spawnId;
    const t: Tracked = { input, pid, exited: exitedPromise(input.child) };
    this.#live.add(t);
    const release = session ? this.#o.holdIdle?.() : undefined;
    if (session) {
      await this.#o.append('session.spawned', {
        phase: 'running',
        spawnId,
        hsid: input.hsid ?? null,
        kind: input.kind,
        pid,
        pgid: pid,
        boot: this.#o.boot,
        startTime: this.#o.control.startTime(pid),
      });
    }
    void t.exited.then(async () => {
      this.#live.delete(t);
      release?.();
      if (!session) return;
      await this.#o
        .append('session.exited', {
          spawnId,
          hsid: input.hsid ?? null,
          pid,
          code: input.child.exitCode,
          signal: input.child.signalCode,
          ...(t.stopReason ? { reason: t.stopReason } : {}),
        })
        .catch(() => undefined);
    });
  }

  /** Stop every child and await each exit (idle exit, shutdown). Returns leaders still alive + groups with surviving members. */
  async stopAll(reason: string): Promise<number> {
    this.#closed = true;
    const survivors = await Promise.all([...this.#live].map((t) => this.#stop(t, reason)));
    await new Promise((r) => setImmediate(r)); // let exit handlers write their rows
    return this.#live.size + survivors.filter(Boolean).length;
  }

  /** true when something of this child's group is still alive after the stop. */
  async #stop(t: Tracked, reason: string): Promise<boolean> {
    t.stopReason = reason;
    const { child } = t.input;
    const control = this.#o.control;
    const signal = (s: 'SIGTERM' | 'SIGKILL'): void => {
      if (!control.signalGroup(t.pid, s)) child.kill(s);
    };
    if (isLive(child)) {
      signal('SIGTERM');
      if (!(await within(t.exited, this.#graceMs))) {
        signal('SIGKILL');
        await within(t.exited, this.#graceMs);
      }
    }
    // members that outlive the leader (e.g. a SIGTERM-ignoring grandchild): kill the group, poll until gone
    let survivor = false;
    if (control.probeGroup(t.pid) === 'alive') {
      control.signalGroup(t.pid, 'SIGKILL');
      survivor = !(await groupGone(control, t.pid, this.#graceMs));
    }
    if (t.input.kind === 'mod') await this.#o.append('mod.stopped', { name: t.input.name ?? null, reason }).catch(() => undefined);
    return survivor;
  }
}

export interface OrphanRow {
  kind: string;
  principal?: string;
  payload: unknown;
}

export interface SweepResult {
  orphans: number;
  stopped: number;
}

export type OrphanProbe = 'alive' | 'gone' | 'foreign' | 'unsupported' | 'stale-boot' | 'unattributable';

interface OpenSpawn {
  spawnId: string | null;
  hsid: string | null;
  pid: number | null;
  pgid: number | null;
  boot: string | null;
  startTime: string | null;
}

/** G-DMN-04: kernel-written `session.spawned` without an end row ⇒ record, then stop only what is provably ours. */
export async function sweepOrphans(opts: {
  rows: Iterable<OrphanRow>;
  kernelPrincipal: string;
  boot: string;
  append: Append;
  control: ProcessControl;
  graceMs?: number;
  pollMs?: number;
}): Promise<SweepResult> {
  const open = new Map<string, OpenSpawn>();
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const idOf = (p: Record<string, unknown>): string =>
    typeof p.spawnId === 'string' ? `s:${p.spawnId}` : typeof p.hsid === 'string' ? `h:${p.hsid}` : `p:${String(p.pid)}`;
  for (const r of opts.rows) {
    if (r.principal !== opts.kernelPrincipal) continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    if (r.kind === 'session.spawned') {
      const pid = typeof p.pid === 'number' ? p.pid : null;
      open.set(idOf(p), {
        spawnId: str(p.spawnId),
        hsid: str(p.hsid),
        pid,
        pgid: typeof p.pgid === 'number' ? p.pgid : pid,
        boot: str(p.boot),
        startTime: str(p.startTime),
      });
    } else if (r.kind === 'session.exited' || r.kind === 'session.orphaned') open.delete(idOf(p));
  }
  const grace = opts.graceMs ?? DEFAULT_CHILD_GRACE_MS;
  const results = await Promise.all(
    [...open.values()].map(async (o): Promise<boolean> => {
      let probe: OrphanProbe;
      let detail: string | undefined;
      if (o.pgid === null) {
        probe = 'unattributable';
        detail = 'spawn-gap'; // an intent with no running row: the crash fell between intent and fork
      } else if (o.boot === null || o.boot === 'unknown' || o.boot !== opts.boot) {
        probe = 'stale-boot';
      } else {
        probe = opts.control.probeGroup(o.pgid);
        if (probe === 'alive') {
          const witness = opts.control.startTime(o.pgid);
          if (o.startTime === null || witness === null || witness !== o.startTime) {
            probe = 'unattributable';
            detail = 'start-time';
          }
        }
      }
      const action = probe === 'alive' ? 'stop' : 'none';
      await opts.append('session.orphaned', {
        spawnId: o.spawnId,
        hsid: o.hsid,
        pid: o.pid,
        pgid: o.pgid,
        probe,
        action,
        fidelity: opts.control.fidelity,
        ...(detail ? { detail } : {}),
      });
      if (action !== 'stop' || o.pgid === null) return false;
      opts.control.signalGroup(o.pgid, 'SIGTERM');
      if (await groupGone(opts.control, o.pgid, grace, opts.pollMs)) return true;
      opts.control.signalGroup(o.pgid, 'SIGKILL');
      return groupGone(opts.control, o.pgid, grace, opts.pollMs);
    }),
  );
  return { orphans: open.size, stopped: results.filter(Boolean).length };
}
