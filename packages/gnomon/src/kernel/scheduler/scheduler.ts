/**
 * @symbol #scheduler
 *
 * #scheduler (spec §3.5, §2.4 rule 3, §9.1 `schedule.*`, §10 law 5) — log-derived
 * timers (`timer:v1`), recomputed on start.
 *
 * - The ONLY state that survives a restart is the log: the last fired due
 *   instant of a key is the max `dueAt` of its `schedule.automation.due` rows,
 *   so `start()` rebuilds every timer from the records + the log (G-SCH-01)
 *   and a due instant is never fired twice.
 * - One daemon ⇒ one timer per key: a second record with the same key (the
 *   same automation registered from N worktrees) is dropped with
 *   `schedule.dropped{key, reason:'duplicate-key'}` (G-LAW-05b).
 * - A timer fires an event and nothing else: `schedule.automation.due`. An
 *   instant that fell due while the daemon was down fires on the next
 *   activation as an ATTENDED event (`late:true`, §2.4 rule 3); several missed
 *   instants coalesce into one due row plus `schedule.dropped{reason:'coalesced'}`.
 *   A due instant older than the lateness threshold (one period, capped at
 *   the horizon; the horizon for `at`) also counts as late — the host slept.
 * - Rebuild trusts only due rows written by the kernel principal whose `dueAt`
 *   is not after the row's own `at` (a forged or future-dated row cannot
 *   suppress a timer).
 * - Nothing spends by default (law 5): every automation is attended until the
 *   #approval-broker decision (M1.6) and the run step (#session-runner M1.7 /
 *   #local-runner M1.8) land, so a due row is for a human. The run step is
 *   hard-wired to refuse ENGINE{not-implemented} (`session.refused`; no
 *   spawn, no permit) for when an unattended fire becomes reachable.
 * - Idle exit's "no due timers inside 10 min" clause: while the next due
 *   instant is within `horizonMs` the scheduler holds the daemon open
 *   (`holdIdle`), and releases the hold when nothing is due that soon.
 * - Each wake is capped at 60 s, so a wall-clock jump or a host sleep is
 *   noticed within a minute. A failed append releases the hold and retries;
 *   a retry after a partial failure can write a second `coalesced` drop row
 *   for the same span (benign: drop rows never feed the rebuild).
 * - stop() is a latch (a later start() is a no-op) and returns the in-flight
 *   tick, which the daemon awaits before stopping children.
 *
 * Loops (docs/specs/gnomon-loops.md §4, build step 6): #loop-timers registers and unregisters loop timers at run
 * time (register/unregister) as loops are trusted, paused, untrusted, deleted or change hash; a static automation
 * list is still read once at start(). A loop timer's record is parsed with the trust predicate, so `attended:false`
 * holds only while its loop is trusted. When a loop timer falls due it is re-checked (still registered, still
 * trusted: the kill switch unregisters first, G-LOOP-26), the due row commits, and the run step HANDS OFF to
 * #loop-runner (`host.start(loopKey, {type, key, dueAt, late})`) instead of refusing. A late fire (missed while the
 * daemon was down, or the host slept) stays attended (a row for a human, no run) unless the trigger says
 * `catchUp: once`, which runs it once. A refused hand-off writes `schedule.dropped{reason:'run-refused'}`. Non-loop
 * automations keep the hard-wired refusal below.
 *
 * The scheduler never reads a wall clock directly (`now` seam) and arms one
 * wake at a time (`arm` seam), so the 24 h soak of G-LAW-05 runs as a
 * clock-advanced unit test.
 */
import { refuse } from '@a-company/gnomon-contracts';
import { automationKey, AutomationRefusal, dueWindow, parseAutomation, type AutomationTrigger, type AutomationV1 } from './automation.js';

/** §2.4 rule 3: "no due timers inside 10 min". */
export const DEFAULT_TIMER_HORIZON_MS = 10 * 60_000;
/** Longest single wake: re-check the wall clock at least once a minute. */
export const MAX_ARM_MS = 60_000;
/** Retry delay after a failed append. */
export const RETRY_MS = 5_000;

export interface SchedulerRow {
  kind: string;
  payload: unknown;
  principal?: string;
  /** The row's own commit time (ISO). */
  at?: string;
}

/** The slice of #kernel-log the scheduler uses (KernelLog through the daemon adapter, or a test log). */
export interface SchedulerLog {
  append(kind: string, payload: Record<string, unknown>): Promise<void>;
  rows(kinds: readonly string[]): Iterable<SchedulerRow>;
}

/** `timer:v1` — one per key, derived, never stored. */
export interface TimerV1 {
  key: string;
  source: 'automation' | 'loop';
  /** the loop's registry key (source 'loop') */
  loopKey?: string;
  automationId: string;
  /** Last fired due instant from the log (ISO), absent when it never fired. */
  lastFiredAt?: string;
  /** Next due instant (ISO), absent when the trigger is spent. */
  nextDueAt?: string;
}

export interface AutomationFire {
  key: string;
  dueAt: string;
  late: boolean;
}

/** A loop timer (#loop-timers): one per (loop, trigger). */
export interface LoopTimerSpec {
  /** the timer key, `loop:<loopKey>#<trigger digest>` (stable across restarts while the trigger is unchanged) */
  key: string;
  loopKey: string;
  loopId: string;
  trigger: AutomationTrigger;
  /** a fire missed while the daemon was down: skip (a row for a human) or once (run it once) */
  catchUp: 'skip' | 'once';
  /** fires at or before this instant are never owed (the loop's trust or resume time) */
  sinceMs: number;
  /** the trigger type handed to the runner */
  type: 'schedule' | 'continuous';
}

/** #loop-timers' side of the hand-off. */
export interface SchedulerLoopHost {
  /** is the loop trusted at its current hash, unpaused and not held by the kill switch? */
  trusted(loopKey: string): boolean;
  /** hand a due fire to #loop-runner; throws its refusal */
  start(loopKey: string, trigger: Record<string, unknown>): unknown;
}

export interface SchedulerOptions {
  log: SchedulerLog;
  /** Every kernel principal this home has used (unprovisioned p:00000000/kernel and the current one, M1.3): the only writers whose due rows rebuild timers. */
  kernelPrincipals: readonly string[];
  /** Raw `automation:v1` records (validated here; root-signed config supplies them in production). */
  automations?: readonly unknown[];
  now?: () => number;
  horizonMs?: number;
  /** Take an idle hold; returns its release (§2.4 rule 3). */
  holdIdle?: () => () => void;
  arm?: (fn: () => void, ms: number) => { cancel(): void };
}

interface Timer {
  key: string;
  a: AutomationV1;
  last: number;
  loop?: { loopKey: string; catchUp: 'skip' | 'once'; type: 'schedule' | 'continuous' };
}

const DUE = 'schedule.automation.due';
const DROPPED = 'schedule.dropped';

function defaultArm(fn: () => void, ms: number): { cancel(): void } {
  const t = setTimeout(fn, ms);
  t.unref();
  return { cancel: () => clearTimeout(t) };
}

/** The milestone that brings the run step for `model` (§19.1 M1.7 / M1.8). */
export function runStepMilestone(model: AutomationV1['model']): string {
  return model === 'local' ? 'M1.8' : model === 'claude' ? 'M1.7' : 'M1.7+M1.8';
}

export class Scheduler {
  readonly #o: SchedulerOptions;
  readonly #now: () => number;
  readonly #horizon: number;
  readonly #timers = new Map<string, Timer>();
  /** the last fired due instant per key from the log (kernel rows only), kept current by #fire */
  #fired: Map<string, number> | null = null;
  #loops: SchedulerLoopHost | null = null;
  #activatedAt = 0;
  #wake: { cancel(): void } | null = null;
  #release: (() => void) | null = null;
  #chain: Promise<void> = Promise.resolve();
  #running = false;
  #stopped = false;

  constructor(opts: SchedulerOptions) {
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
    this.#horizon = opts.horizonMs ?? DEFAULT_TIMER_HORIZON_MS;
  }

  /** Rebuild every timer from the records + the log, then fire what is due. A no-op once stopped. */
  async start(): Promise<void> {
    if (this.#running || this.#stopped) return;
    this.#running = true;
    this.#activatedAt = this.#now();
    const fired = this.#firedIndex();
    for (const t of this.#timers.values()) t.last = Math.max(t.last, fired.get(t.key) ?? -Infinity);
    for (const raw of this.#o.automations ?? []) {
      if (this.#stopped) return;
      let a: AutomationV1;
      try {
        a = parseAutomation(raw);
      } catch (err) {
        if (!(err instanceof AutomationRefusal)) throw err;
        const id = (raw as { id?: unknown } | null)?.id;
        await this.#o.log.append(DROPPED, { ...(typeof id === 'string' ? { key: automationKey(id) } : {}), reason: err.reason, detail: err.message });
        continue;
      }
      const key = automationKey(a.id);
      if (this.#timers.has(key)) {
        await this.#o.log.append(DROPPED, { key, reason: 'duplicate-key' });
        continue;
      }
      this.#timers.set(key, { key, a, last: fired.get(key) ?? -Infinity });
    }
    await this.tick();
  }

  /** Attach #loop-timers (the trust predicate and the runner hand-off). Loop timers register only through it. */
  attachLoops(host: SchedulerLoopHost): void {
    this.#loops = host;
  }

  /**
   * Register (or replace) a loop timer. Its record is `automation:v1 {id: loopId, trigger, model: local,
   * attended: false}`, parsed with the trust predicate: an untrusted loop is refused (`schedule.dropped`), never
   * registered. Returns whether the timer is armed. Before start() the timer waits for it.
   */
  registerLoop(spec: LoopTimerSpec): boolean {
    const host = this.#loops;
    if (this.#stopped || !host) return false;
    // a loop timer lives only in the loop: namespace (never an automation:<id> key, whose refusal must stand)
    if (typeof spec.key !== 'string' || !spec.key.startsWith('loop:')) {
      this.#o.log.append(DROPPED, { reason: 'bad-key', detail: 'a loop timer key starts with loop:' }).catch(() => undefined);
      return false;
    }
    let a: AutomationV1;
    try {
      a = parseAutomation({ id: spec.loopId, trigger: spec.trigger, model: 'local', attended: false }, { unattended: () => host.trusted(spec.loopKey) });
    } catch (err) {
      if (!(err instanceof AutomationRefusal)) throw err;
      this.#o.log.append(DROPPED, { key: spec.key, reason: err.reason, detail: err.message.slice(0, 300) }).catch(() => undefined);
      return false;
    }
    const prior = this.#timers.get(spec.key);
    const fired = this.#firedIndex().get(spec.key) ?? -Infinity;
    const last = Math.max(fired, prior?.last ?? -Infinity, spec.sinceMs);
    this.#timers.set(spec.key, { key: spec.key, a, last, loop: { loopKey: spec.loopKey, catchUp: spec.catchUp, type: spec.type } });
    if (this.#running) void this.tick().catch(() => undefined);
    return true;
  }

  /** Remove a timer (a loop paused, untrusted, deleted, changed, or the kill switch). No row. */
  unregister(key: string): boolean {
    const had = this.#timers.delete(key);
    if (had && this.#running) void this.tick().catch(() => undefined);
    return had;
  }

  /** The kill switch's half: drop every loop timer at once, synchronously (no wake can fire one after this). */
  unregisterAllLoops(): number {
    let n = 0;
    for (const [k, t] of this.#timers) if (t.loop && this.#timers.delete(k)) n++;
    if (n && this.#running) void this.tick().catch(() => undefined);
    return n;
  }

  #firedIndex(): Map<string, number> {
    if (this.#fired) return this.#fired;
    const fired = new Map<string, number>();
    for (const r of this.#o.log.rows([DUE])) {
      if (r.principal === undefined || !this.#o.kernelPrincipals.includes(r.principal)) continue;
      const p = r.payload as { key?: unknown; dueAt?: unknown } | undefined;
      if (typeof p?.key !== 'string' || typeof p.dueAt !== 'string') continue;
      const ms = Date.parse(p.dueAt);
      const rowAt = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
      if (!Number.isFinite(ms) || !Number.isFinite(rowAt) || ms > rowAt) continue; // a due row cannot predate its own instant
      if (ms > (fired.get(p.key) ?? -Infinity)) fired.set(p.key, ms);
    }
    this.#fired = fired;
    return fired;
  }

  /** Latch off: cancel the wake, release the hold; resolves when an in-flight tick has finished. */
  stop(): Promise<void> {
    this.#stopped = true;
    this.#running = false;
    this.#wake?.cancel();
    this.#wake = null;
    this.#setHold(false);
    return this.#chain;
  }

  /** Evaluate at `now()`: fire what is due, then arm the next wake. Serialized. */
  tick(): Promise<void> {
    const next = this.#chain.then(() => this.#tick());
    this.#chain = next.catch(() => undefined);
    return next;
  }

  timers(): TimerV1[] {
    const now = this.#now();
    return [...this.#timers.entries()].map(([key, t]) => {
      const w = dueWindow(t.a.trigger, t.last, now);
      const nextMs = w.count > 0 ? w.last : w.next;
      return {
        key,
        source: t.loop ? ('loop' as const) : ('automation' as const),
        ...(t.loop ? { loopKey: t.loop.loopKey } : {}),
        automationId: t.a.id,
        ...(Number.isFinite(t.last) ? { lastFiredAt: new Date(t.last).toISOString() } : {}),
        ...(nextMs !== null ? { nextDueAt: new Date(nextMs).toISOString() } : {}),
      };
    });
  }

  /** True while the scheduler holds the daemon open (a due instant inside the horizon). */
  get holdingIdle(): boolean {
    return this.#release !== null;
  }

  async #tick(): Promise<void> {
    if (!this.#running) return;
    this.#wake?.cancel();
    this.#wake = null;
    const now = this.#now();
    let next: number | null = null;
    try {
      for (const [key, t] of this.#timers) {
        const w = dueWindow(t.a.trigger, t.last, now);
        if (w.count > 0 && w.last !== null) await this.#fire(key, t, w.last, w.count, now);
        if (!this.#running) return;
        if (w.next !== null && (next === null || w.next < next)) next = w.next;
      }
    } catch {
      // the log refused (closing, faulted): do not hold the daemon open on a timer we cannot record
      if (!this.#running) return;
      this.#setHold(false);
      this.#arm(RETRY_MS);
      return;
    }
    if (next === null) {
      this.#setHold(false);
      return;
    }
    const until = next - this.#now();
    if (until <= this.#horizon) {
      this.#setHold(true);
      this.#arm(until);
    } else {
      this.#setHold(false);
      this.#arm(until - this.#horizon);
    }
  }

  async #fire(key: string, t: Timer, dueMs: number, count: number, now: number): Promise<void> {
    const dueAt = new Date(dueMs).toISOString();
    const threshold = 'every' in t.a.trigger ? Math.min(t.a.trigger.every, this.#horizon) : this.#horizon;
    const late = dueMs < this.#activatedAt || now - dueMs > threshold;
    if (t.loop) return this.#fireLoop(key, t, t.loop, dueAt, dueMs, count, late);
    const attended = t.a.attended || late;
    if (count > 1) await this.#o.log.append(DROPPED, { key, reason: 'coalesced', count: count - 1, throughAt: dueAt });
    // chain write before side effect (§2.4 rule 4): the due row commits before any run step
    await this.#o.log.append(DUE, { id: t.a.id, key, dueAt, model: t.a.model, attended, late });
    this.#markFired(key, t, dueMs);
    if (attended || !this.#running) return; // an attended due row is for a human: nothing spends (law 5)
    await this.#refuseRun(t.a, { key, dueAt, late });
  }

  /** A loop timer's fire: re-checked against the registry, the due row, then the hand-off to #loop-runner. */
  async #fireLoop(key: string, t: Timer, loop: NonNullable<Timer['loop']>, dueAt: string, dueMs: number, count: number, late: boolean): Promise<void> {
    const host = this.#loops;
    // unregistered meanwhile (the kill switch, a pause) or no longer trusted: nothing fires, no row
    if (this.#timers.get(key) !== t || !host || !host.trusted(loop.loopKey)) {
      if (this.#timers.get(key) === t) t.last = dueMs;
      return;
    }
    const runs = !late || loop.catchUp === 'once';
    if (count > 1) await this.#o.log.append(DROPPED, { key, reason: 'coalesced', count: count - 1, throughAt: dueAt });
    await this.#o.log.append(DUE, { id: t.a.id, key, dueAt, model: t.a.model, attended: !runs, late, source: 'loop', loopKey: loop.loopKey, ...(late ? { catchUp: loop.catchUp } : {}) });
    this.#markFired(key, t, dueMs);
    if (!runs || !this.#running) return; // a late fire with catchUp: skip is a row for a human
    try {
      host.start(loop.loopKey, { type: loop.type, key, dueAt, ...(late ? { late: true } : {}) });
    } catch (err) {
      const e = err as { reason?: unknown; refusal?: { data?: { reason?: unknown } } } | null;
      const reason = e?.refusal?.data?.reason ?? e?.reason;
      await this.#o.log.append(DROPPED, { key, reason: 'run-refused', ...(typeof reason === 'string' ? { refusal: reason } : {}), detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }
  }

  #markFired(key: string, t: Timer, dueMs: number): void {
    t.last = dueMs;
    const f = this.#firedIndex();
    if (dueMs > (f.get(key) ?? -Infinity)) f.set(key, dueMs);
  }

  /** The run step, hard-wired: the session runner is not built yet — refuse, record, spawn nothing. */
  async #refuseRun(a: AutomationV1, fire: AutomationFire): Promise<void> {
    const milestone = runStepMilestone(a.model);
    const refusal = refuse({ code: 'ENGINE', data: { reason: 'not-implemented', verb: 'automation.run', milestone } });
    await this.#o.log.append('session.refused', { code: refusal.code, reason: 'not-implemented', automationId: a.id, key: fire.key, dueAt: fire.dueAt, model: a.model, milestone });
  }

  #arm(ms: number): void {
    const delay = Math.max(0, Math.min(ms, MAX_ARM_MS));
    this.#wake = (this.#o.arm ?? defaultArm)(() => void this.tick().catch(() => undefined), delay);
  }

  #setHold(on: boolean): void {
    if (on && !this.#release && this.#o.holdIdle) this.#release = this.#o.holdIdle();
    else if (!on && this.#release) {
      const r = this.#release;
      this.#release = null;
      r();
    }
  }
}
