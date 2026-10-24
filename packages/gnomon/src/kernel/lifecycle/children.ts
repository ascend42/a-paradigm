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
 * Descendant sweep (T-2026-10-19-009 item 1, Orca audit "Adopt 1"): a group
 * kill misses a tool child that called `setsid` or daemonized. Before the
 * first signal, a session / local-runner stop takes an ASYNC process-table
 * snapshot (ProcessControl.snapshot, from the kernel, outside the sandbox) and
 * collects every descendant of the leader (ppid walk) plus every member of its
 * group, each with its `lstart` witness. Out-of-group descendants get SIGTERM
 * with the group; after the graceful window a fresh snapshot is taken and only
 * a pid whose witness still EQUALS the recorded one is SIGKILLed - a recycled
 * pid (different start time) is never signalled. The verdict is written into
 * `session.exited{tree}` as `exited | alive | unverifiable`: no snapshot (ps
 * unavailable, Windows parity row) or a failed re-check => `unverifiable`,
 * never folded into `exited` or `alive`. A stopped child's exit row waits for
 * the verdict. A descendant already reparented to init BEFORE the stop began
 * (double-fork whose parent already exited) is not reachable by the ppid walk
 * and not in the group: residual, reported. When the leader is already gone
 * at snapshot time and no group member is left, the ppid walk has nothing to
 * start from, so the verdict is `unverifiable` with
 * `treeDetail:'leader-gone-before-stop'`, never `exited`.
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
 * RESIDUALS (reported): a group whose leader died while members live has no
 * matching start-time witness, so it is recorded `unattributable` and not
 * signalled (the safe direction). §9.1 has no `mod.spawned` / `mod.exited` kind (adding
 * one moves clientApiId), so a mod child orphaned by a daemon crash is not
 * swept; mod children are tracked in memory and stopped at every exit.
 */
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { ProcessControl, ProcRow } from './process-control.js';

/** The descendant-tree verdict of a stop (session.exited{tree}); never collapse `unverifiable`. */
export type TreeVerdict = 'exited' | 'alive' | 'unverifiable';

/** Every descendant of `root` in the snapshot (ppid walk) plus every member of its group, excluding root itself. */
export function descendantsOf(rows: readonly ProcRow[], root: number): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>();
  for (const r of rows) byParent.set(r.ppid, [...(byParent.get(r.ppid) ?? []), r]);
  const out = new Map<number, ProcRow>();
  const queue = [root];
  while (queue.length > 0) {
    for (const c of byParent.get(queue.shift()!) ?? []) {
      if (c.pid === root || out.has(c.pid) || c.pid <= 1) continue;
      out.set(c.pid, c);
      queue.push(c.pid);
    }
  }
  for (const r of rows) if (r.pgid === root && r.pid !== root && r.pid > 1) out.set(r.pid, r);
  return [...out.values()];
}

/** Of `desc`, the pids still alive with the SAME start witness; null when no snapshot can be taken. */
async function stillOurs(control: ProcessControl, desc: readonly ProcRow[]): Promise<ProcRow[] | null> {
  const snap = control.snapshot ? await control.snapshot().catch(() => null) : null;
  if (!snap) return null;
  const now = new Map(snap.map((r) => [r.pid, r.start]));
  return desc.filter((d) => now.get(d.pid) === d.start);
}

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
  /** Set synchronously when a stop begins; the exit row waits for it. */
  tree?: Promise<TreeVerdict>;
  /** Why the verdict is `unverifiable` when it is not "no snapshot" (session.exited{treeDetail}). */
  treeDetail?: string;
  /** The exit-row write (sessions). */
  row?: Promise<void>;
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
    // read the witness NOW, before any await: a reaped-and-reused pid can never be recorded as this child
    const startTime = session ? this.#o.control.startTime(pid) : null;
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
        startTime,
      });
    }
    t.row = t.exited.then(async () => {
      this.#live.delete(t);
      release?.();
      if (!session) return;
      const tree = t.tree ? await t.tree : undefined;
      await this.#o
        .append('session.exited', {
          spawnId,
          hsid: input.hsid ?? null,
          pid,
          code: input.child.exitCode,
          signal: input.child.signalCode,
          ...(t.stopReason ? { reason: t.stopReason } : {}),
          ...(tree ? { tree } : {}),
          ...(t.treeDetail ? { treeDetail: t.treeDetail } : {}),
        })
        .catch(() => undefined);
    });
  }

  /** Stop ONE tracked child (staged, as stopAll) and await its exit; true when something of its group survived (M1.7 session.stop). */
  async stop(child: ChildProcess, reason: string): Promise<boolean> {
    const t = [...this.#live].find((x) => x.input.child === child);
    if (!t) return false;
    return this.#stop(t, reason);
  }

  /** Stop every child and await each exit (idle exit, shutdown). Returns leaders still alive + groups with surviving members. */
  async stopAll(reason: string): Promise<number> {
    this.#closed = true;
    const all = [...this.#live];
    // ONE process-table snapshot for the whole stop (not one `ps` per child), taken before any child is signalled
    const control = this.#o.control;
    const shared = control.snapshot && all.some((t) => t.input.kind !== 'mod') ? control.snapshot().catch(() => null) : undefined;
    const survivors = await Promise.all(all.map((t) => this.#stop(t, reason, shared)));
    await new Promise((r) => setImmediate(r)); // let exit handlers write their rows
    return this.#live.size + survivors.filter(Boolean).length;
  }

  /**
   * true when something of this child's group (or its descendant tree) is still alive after the stop.
   * `shared`: stopAll's one snapshot for every child (each walks its own tree in it); absent ⇒ a fresh one.
   */
  async #stop(t: Tracked, reason: string, shared?: Promise<ProcRow[] | null>): Promise<boolean> {
    t.stopReason = reason;
    const { child } = t.input;
    const control = this.#o.control;
    const session = t.input.kind !== 'mod';
    let resolveTree: (v: TreeVerdict) => void = () => undefined;
    if (session) t.tree = new Promise<TreeVerdict>((r) => (resolveTree = r));
    // snapshot the tree BEFORE any signal: once the leader dies its children are reparented and the ppid walk loses them
    const desc =
      session && control.snapshot
        ? await (shared ?? control.snapshot()).then(
            (rows) => {
              if (!rows) return null;
              const d = descendantsOf(rows, t.pid);
              // the leader died before the stop: its out-of-group descendants were already reparented to init and
              // the ppid walk cannot see them; with no group member left there is nothing to walk from — unknown, not exited
              const leaderGone = !isLive(child) || !rows.some((r) => r.pid === t.pid);
              if (leaderGone && d.length === 0) {
                t.treeDetail = 'leader-gone-before-stop';
                return null;
              }
              return d;
            },
            () => null,
          )
        : null;
    const outside = (desc ?? []).filter((d) => d.pgid !== t.pid);
    const signal = (s: 'SIGTERM' | 'SIGKILL'): void => {
      if (!control.signalGroup(t.pid, s)) child.kill(s);
    };
    if (isLive(child)) {
      signal('SIGTERM');
      for (const d of outside) control.signalPid?.(d.pid, 'SIGTERM');
      if (!(await within(t.exited, this.#graceMs))) {
        signal('SIGKILL');
        await within(t.exited, this.#graceMs);
      }
    } else for (const d of outside) control.signalPid?.(d.pid, 'SIGTERM');
    // members that outlive the leader (e.g. a SIGTERM-ignoring grandchild): kill the group, poll until gone
    let survivor = false;
    if (control.probeGroup(t.pid) === 'alive') {
      control.signalGroup(t.pid, 'SIGKILL');
      survivor = !(await groupGone(control, t.pid, this.#graceMs));
    }
    if (session) {
      const verdict: TreeVerdict = desc === null ? 'unverifiable' : await this.#sweepTree(desc);
      resolveTree(verdict);
      if (verdict === 'alive') survivor = true;
      if (!isLive(child)) await t.row;
    }
    if (t.input.kind === 'mod') await this.#o.append('mod.stopped', { name: t.input.name ?? null, reason }).catch(() => undefined);
    return survivor;
  }

  /** Graceful window, then SIGKILL every descendant whose start witness still matches; poll to a verdict. */
  async #sweepTree(desc: readonly ProcRow[]): Promise<TreeVerdict> {
    if (desc.length === 0) return 'exited';
    const control = this.#o.control;
    const pollMs = Math.min(100, Math.max(10, Math.floor(this.#graceMs / 10)));
    const until = async (ms: number): Promise<ProcRow[] | null> => {
      const deadline = Date.now() + ms;
      for (;;) {
        const live = await stillOurs(control, desc);
        if (live === null || live.length === 0 || Date.now() >= deadline) return live;
        await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    const afterTerm = await until(this.#graceMs);
    if (afterTerm === null) return 'unverifiable';
    if (afterTerm.length === 0) return 'exited';
    for (const d of afterTerm) control.signalPid?.(d.pid, 'SIGKILL');
    const afterKill = await until(this.#graceMs);
    if (afterKill === null) return 'unverifiable';
    return afterKill.length === 0 ? 'exited' : 'alive';
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
  /** Every kernel principal this home has used (p:00000000/kernel before root provisioning, p:<rootns>/kernel after, M1.3). */
  kernelPrincipals: readonly string[];
  boot: string;
  append: Append;
  control: ProcessControl;
  graceMs?: number;
  pollMs?: number;
  /**
   * §2.4 rule 4 as amended by rule 11 (TD-2026-10-19-908, G-DMN-04; T-2026-10-19-014 B2): the hsids this boot
   * resumes. A drained session's own exit already closed its old spawn, so it is never an orphan; this set also
   * keeps a spawn of THIS boot for one of them (the resume's own child) from ever being swept. A drained session
   * with no exit is not in it: its open spawn is swept like any crash orphan, and it is never resumed.
   */
  resuming?: ReadonlySet<string>;
  /** Aegis M-B: called once per orphan after its `session.orphaned` row and any stop (e.g. to empty its session-env) */
  onOrphaned?: (hsid: string | null) => Promise<void> | void;
}): Promise<SweepResult> {
  const open = new Map<string, OpenSpawn>();
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const idOf = (p: Record<string, unknown>): string =>
    typeof p.spawnId === 'string' ? `s:${p.spawnId}` : typeof p.hsid === 'string' ? `h:${p.hsid}` : `p:${String(p.pid)}`;
  for (const r of opts.rows) {
    if (r.principal === undefined || !opts.kernelPrincipals.includes(r.principal)) continue;
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
  for (const [k, o] of open) if (o.hsid !== null && o.boot === opts.boot && opts.resuming?.has(o.hsid)) open.delete(k);
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
      const after = async (stopped: boolean): Promise<boolean> => {
        try {
          await opts.onOrphaned?.(o.hsid);
        } catch {
          // cleanup is best-effort; the sweep result stands
        }
        return stopped;
      };
      if (action !== 'stop' || o.pgid === null) return after(false);
      opts.control.signalGroup(o.pgid, 'SIGTERM');
      if (await groupGone(opts.control, o.pgid, grace, opts.pollMs)) return after(true);
      opts.control.signalGroup(o.pgid, 'SIGKILL');
      return after(await groupGone(opts.control, o.pgid, grace, opts.pollMs));
    }),
  );
  return { orphans: open.size, stopped: results.filter(Boolean).length };
}
