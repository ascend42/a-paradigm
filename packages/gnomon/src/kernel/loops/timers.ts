/**
 * @symbol #loop-timers
 *
 * #loop-timers (docs/specs/gnomon-loops.md §4 "Scheduler integration", "Uptime hold", §10 D1; build plan step 6,
 * LP4a). The bridge between #loop-registry, #loop-runner and #scheduler:
 *
 *   - **Dynamic registration.** On every registry change (a scan, a folded trust row) and every runner event it
 *     reconciles: each schedule trigger of a RUNNABLE loop (trusted at its current hash, not paused, not held by the
 *     kill switch) has one scheduler timer, keyed `loop:<loopKey>#<trigger digest>`; every other loop has none. So
 *     trusting, pausing, untrusting, deleting or changing a loop adds or removes its timers, and a fresh install has
 *     zero (G-LAW-05b). Fires at or before the loop's trust or resume instant are never owed.
 *   - **Time zone.** The loop definition's `daily`/`weekly` times are wall times in the daemon's zone (`tz`, default
 *     the host's IANA zone), stated on the timer record; the scheduler resolves DST (zoned.ts).
 *   - **The hand-off.** A due loop timer calls `runner.start(loopKey, {type, key, dueAt, late?})` (scheduler.ts).
 *   - **Continuous.** After a run of a `continuous` loop ends, the next run is a one-shot timer at end + cooldown
 *     (≥ 60 s); at boot, a trust or a resume it is now + cooldown. A paused loop (a budget stop pauses), a
 *     killed one or a refused start (refused for the rest of the local day) gets no next run.
 *   - **Kill switch.** The runner's `kill` event drops every loop timer synchronously, before the pause rows are
 *     written; they come back only when each loop resumes (G-LOOP-26).
 *   - **Uptime (D1).** While any loop timer has a next due instant, or a run is in flight, the daemon holds idle
 *     exit with a `loop` holder: the whole horizon, not the scheduler's 10 minutes, because nothing else would start
 *     the daemon for a daily loop until launchd (8.1). status.loops.uptime says so: {enabled, running, waiting,
 *     keepingAlive, line: "Gnomon is staying up for loops"}.
 */
import { createHash } from 'node:crypto';
import type { CompiledTrigger } from '../../loops/index.js';
import { MIN_AUTOMATION_PERIOD_MS, type AutomationTrigger } from '../scheduler/automation.js';
import type { LoopTimerSpec, SchedulerLoopHost, TimerV1 } from '../scheduler/scheduler.js';
import type { Weekday } from '../scheduler/zoned.js';
import { dayKeyOf } from './ledger.js';
import type { LoopRegistry } from './registry.js';
import type { LoopRunner, LoopRunnerEvent } from './runner.js';

export const LOOP_KEEP_ALIVE_LINE = 'Gnomon is staying up for loops';
/** The continuous trigger's floor (§3.5: matching MIN_AUTOMATION_PERIOD_MS). */
export const LOOP_MIN_COOLDOWN_MS = MIN_AUTOMATION_PERIOD_MS;

/** The scheduler surface #loop-timers drives (Scheduler implements it). */
export interface LoopScheduler {
  attachLoops(host: SchedulerLoopHost): void;
  registerLoop(spec: LoopTimerSpec): boolean;
  unregister(key: string): boolean;
  unregisterAllLoops(): number;
  timers(): TimerV1[];
}

export interface LoopTimersOptions {
  registry: LoopRegistry;
  runner: LoopRunner;
  scheduler: LoopScheduler;
  /** the zone daily/weekly times are read in (default the host's IANA zone) */
  tz?: string;
  clock?: () => number;
  /** take the `loop` idle holder; returns its release */
  holdIdle?: () => () => void;
  diag?: (event: string, data: Record<string, unknown>) => void;
}

export interface LoopUptime {
  enabled: { n: number; of: number };
  running: { n: number; of: number };
  waiting: { n: number; of: number };
  keepingAlive: boolean;
  line?: string;
  nextDueAt?: string;
}

/** The host's IANA zone, UTC when the runtime cannot say. */
export function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);

/** The timer key of a loop's schedule trigger (neither its anchor nor its zone is part of it: history survives a resume or a zone change). */
export function loopTimerKey(loopKey: string, t: Extract<CompiledTrigger, { type: 'schedule' }> | 'continuous', tz: string): string {
  if (t === 'continuous') return `loop:${loopKey}#continuous`;
  // the zone is NOT in the key (Aegis step 6): a host zone change re-registers the same key, so its last fire carries over
  void tz;
  const what = t.every !== undefined ? { every: t.every } : t.daily !== undefined ? { daily: t.daily } : { weekly: t.weekly };
  return `loop:${loopKey}#${digest(what)}`;
}

/** A compiled schedule trigger as an automation trigger (`every` anchored at the loop's trust or resume instant). */
export function automationTriggerOf(t: Extract<CompiledTrigger, { type: 'schedule' }>, sinceMs: number, tz: string): AutomationTrigger | null {
  if (t.every !== undefined) return { every: Math.max(t.every * 1000, MIN_AUTOMATION_PERIOD_MS), anchor: new Date(sinceMs).toISOString() };
  if (t.daily !== undefined) return { daily: { at: t.daily, tz } };
  if (t.weekly !== undefined) return { weekly: { day: t.weekly.day as Weekday, at: t.weekly.at, tz } };
  return null;
}

type Desired = LoopTimerSpec | 'keep';

export class LoopTimers {
  readonly #o: LoopTimersOptions;
  readonly #tz: string;
  readonly #registered = new Map<string, { loopKey: string; sig: string }>();
  readonly #lastEnd = new Map<string, number>();
  readonly #firstSeen = new Map<string, number>();
  /** continuous loops whose start was refused: no next run until this local day is over */
  readonly #refusedDay = new Map<string, string>();
  readonly #unsubs: Array<() => void> = [];
  #reconciling = false;
  #again = false;
  #closed = false;
  #release: (() => void) | null = null;

  constructor(o: LoopTimersOptions) {
    this.#o = o;
    this.#tz = o.tz ?? hostTimeZone();
    o.scheduler.attachLoops({ trusted: (k) => this.runnable(k), start: (k, trigger) => this.#start(k, trigger) });
    this.#unsubs.push(o.registry.onChange(() => this.reconcile()));
    this.#unsubs.push(o.runner.onEvent((e) => this.#onRunner(e)));
    this.reconcile();
  }

  get tz(): string {
    return this.#tz;
  }

  #now(): number {
    return (this.#o.clock ?? Date.now)();
  }

  /** The trust predicate the scheduler's `attended:false` lift asks (and re-asks at every fire). */
  runnable(loopKey: string): boolean {
    return !this.#closed && this.#o.registry.canRun(loopKey).ok && !this.#o.runner.isHeld(loopKey);
  }

  /** The timer keys registered now (tests, status). */
  keys(): string[] {
    return [...this.#registered.keys()].sort();
  }

  /** Bring the scheduler's loop timers in line with the registry and the runner. Re-entrant calls coalesce. */
  reconcile(): void {
    if (this.#closed) return;
    if (this.#reconciling) {
      this.#again = true;
      return;
    }
    this.#reconciling = true;
    try {
      do {
        this.#again = false;
        this.#apply(this.#desired());
      } while (this.#again);
    } finally {
      this.#reconciling = false;
    }
    this.#refreshHold();
  }

  #desired(): Map<string, Desired> {
    const out = new Map<string, Desired>();
    const now = this.#now();
    const active = new Set(this.#o.runner.running().map((r) => r.key));
    for (const e of this.#o.registry.entries()) {
      if (!e.compiled || !this.runnable(e.key)) continue;
      let since = this.#o.registry.runnableSince(e.key);
      if (since === null) {
        if (!this.#firstSeen.has(e.key)) this.#firstSeen.set(e.key, now);
        since = this.#firstSeen.get(e.key)!;
      }
      for (const t of e.compiled.triggers) {
        if (t.type === 'schedule') {
          const trigger = automationTriggerOf(t, since, this.#tz);
          if (!trigger) continue;
          const key = loopTimerKey(e.key, t, this.#tz);
          out.set(key, { key, loopKey: e.key, loopId: e.loopId, trigger, catchUp: t.catchUp, sinceMs: since, type: 'schedule' });
        } else if (t.type === 'continuous') {
          const key = loopTimerKey(e.key, 'continuous', this.#tz);
          if (active.has(e.key)) continue; // the run's end schedules the next one
          if (this.#refusedDay.get(e.key) === dayKeyOf(now)) continue;
          if (this.#registered.has(key)) {
            out.set(key, 'keep');
            continue;
          }
          const cooldown = Math.max(t.cooldownSec * 1000, LOOP_MIN_COOLDOWN_MS);
          const end = this.#lastEnd.get(e.key);
          const at = end !== undefined ? Math.max(end + cooldown, now) : now + cooldown;
          out.set(key, { key, loopKey: e.key, loopId: e.loopId, trigger: { at: new Date(at).toISOString() }, catchUp: 'once', sinceMs: -Infinity, type: 'continuous' });
        }
      }
    }
    return out;
  }

  #apply(want: Map<string, Desired>): void {
    for (const k of [...this.#registered.keys()]) {
      if (want.has(k)) continue;
      this.#registered.delete(k);
      this.#o.scheduler.unregister(k);
    }
    for (const [k, spec] of want) {
      if (spec === 'keep') continue;
      const sig = JSON.stringify({ ...spec, sinceMs: Number.isFinite(spec.sinceMs) ? spec.sinceMs : null });
      if (this.#registered.get(k)?.sig === sig) continue;
      if (this.#o.scheduler.registerLoop(spec)) this.#registered.set(k, { loopKey: spec.loopKey, sig });
      else if (this.#registered.delete(k)) this.#o.scheduler.unregister(k);
    }
  }

  /** The scheduler's hand-off. A refused continuous start gets no next run today. */
  #start(loopKey: string, trigger: Record<string, unknown>): unknown {
    try {
      return this.#o.runner.start(loopKey, trigger);
    } catch (err) {
      if (trigger.type === 'continuous') {
        this.#refusedDay.set(loopKey, dayKeyOf(this.#now()));
        queueMicrotask(() => this.reconcile());
      }
      throw err;
    } finally {
      this.#refreshHold();
    }
  }

  #onRunner(e: LoopRunnerEvent): void {
    if (this.#closed) return;
    if (e.type === 'kill') {
      // G-LOOP-26: synchronously, before any pause row: no loop timer can fire from here on
      this.#o.scheduler.unregisterAllLoops();
      this.#registered.clear();
      this.#refreshHold();
      return;
    }
    if (e.type === 'ended') this.#lastEnd.set(e.key, this.#now());
    if (e.type === 'resumed') this.#refusedDay.delete(e.key);
    this.reconcile();
  }

  /** Is a loop keeping the daemon up? (a loop timer with a next due instant, or a run in flight) */
  keepingAlive(): boolean {
    if (this.#closed) return false;
    if (this.#o.runner.running().length > 0) return true;
    return this.#o.scheduler.timers().some((t) => t.source === 'loop' && t.nextDueAt !== undefined);
  }

  #refreshHold(): void {
    const on = this.keepingAlive();
    if (on && !this.#release && this.#o.holdIdle) this.#release = this.#o.holdIdle();
    else if (!on && this.#release) {
      const r = this.#release;
      this.#release = null;
      r();
    }
  }

  /** True while the `loop` idle holder is taken. */
  get holdingIdle(): boolean {
    return this.#release !== null;
  }

  /** status.loops.uptime (the header indicator, board 4). */
  status(): LoopUptime {
    const of = this.#o.registry.entries().length;
    const enabled = new Set([...this.#registered.values()].map((r) => r.loopKey));
    const running = new Set(this.#o.runner.running().map((r) => r.key));
    for (const k of running) {
      const e = this.#o.registry.entry(k);
      if (e?.compiled?.triggers.some((t) => t.type === 'continuous') && this.runnable(k)) enabled.add(k);
    }
    const waiting = [...enabled].filter((k) => !running.has(k)).length;
    const keepingAlive = this.keepingAlive();
    let next: string | undefined;
    for (const t of this.#o.scheduler.timers()) if (t.source === 'loop' && t.nextDueAt && (!next || t.nextDueAt < next)) next = t.nextDueAt;
    const total = Math.max(of, enabled.size, running.size);
    return {
      enabled: { n: enabled.size, of: total },
      running: { n: running.size, of: total },
      waiting: { n: waiting, of: total },
      keepingAlive,
      ...(keepingAlive ? { line: LOOP_KEEP_ALIVE_LINE } : {}),
      ...(next ? { nextDueAt: next } : {}),
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const u of this.#unsubs.splice(0)) u();
    for (const k of this.#registered.keys()) this.#o.scheduler.unregister(k);
    this.#registered.clear();
    if (this.#release) {
      const r = this.#release;
      this.#release = null;
      r();
    }
  }
}
