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
 * - Nothing spends by default (law 5): an attended automation's due row is for
 *   a human; only a human-marked `attended:false` automation reaches the run
 *   step, and the run step needs a permit from the session runner — until
 *   #session-runner (M1.7) and #local-runner (M1.8) exist it is refused
 *   ENGINE{not-implemented} and logged `session.refused` (no spawn, no permit).
 * - Idle exit's "no due timers inside 10 min" clause: while the next due
 *   instant is within `horizonMs` the scheduler holds the daemon open
 *   (`holdIdle`), and releases the hold when nothing is due that soon.
 *
 * The scheduler never reads a wall clock directly (`now` seam) and arms one
 * wake at a time (`arm` seam), so the 24 h soak of G-LAW-05 runs as a
 * clock-advanced unit test.
 */
import { refuse } from '@a-company/gnomon-contracts';
import { automationKey, AutomationRefusal, dueWindow, parseAutomation, type AutomationV1 } from './automation.js';

/** §2.4 rule 3: "no due timers inside 10 min". */
export const DEFAULT_TIMER_HORIZON_MS = 10 * 60_000;
/** setTimeout's ceiling; a farther wake re-arms. */
const MAX_ARM_MS = 2 ** 31 - 1;

export interface SchedulerRow {
  kind: string;
  payload: unknown;
}

/** The slice of #kernel-log the scheduler uses (KernelLog through the daemon adapter, or a test log). */
export interface SchedulerLog {
  append(kind: string, payload: Record<string, unknown>): Promise<void>;
  rows(kinds: readonly string[]): Iterable<SchedulerRow>;
}

/** `timer:v1` — one per key, derived, never stored. */
export interface TimerV1 {
  key: string;
  source: 'automation';
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

/** The run step for an unattended automation (§13.3 routing). Resolves when the attempt is recorded. */
export type AutomationRunner = (a: AutomationV1, fire: AutomationFire) => Promise<void>;

export interface SchedulerOptions {
  log: SchedulerLog;
  /** Raw `automation:v1` records (validated here; root-signed config supplies them in production). */
  automations?: readonly unknown[];
  now?: () => number;
  horizonMs?: number;
  /** Take an idle hold; returns its release (§2.4 rule 3). */
  holdIdle?: () => () => void;
  run?: AutomationRunner;
  arm?: (fn: () => void, ms: number) => { cancel(): void };
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
  readonly #timers = new Map<string, { a: AutomationV1; last: number }>();
  #activatedAt = 0;
  #wake: { cancel(): void } | null = null;
  #release: (() => void) | null = null;
  #chain: Promise<void> = Promise.resolve();
  #running = false;

  constructor(opts: SchedulerOptions) {
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
    this.#horizon = opts.horizonMs ?? DEFAULT_TIMER_HORIZON_MS;
  }

  /** Rebuild every timer from the records + the log, then fire what is due. */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#activatedAt = this.#now();
    const fired = new Map<string, number>();
    for (const r of this.#o.log.rows([DUE])) {
      const p = r.payload as { key?: unknown; dueAt?: unknown } | undefined;
      if (typeof p?.key !== 'string' || typeof p.dueAt !== 'string') continue;
      const ms = Date.parse(p.dueAt);
      if (Number.isFinite(ms) && ms > (fired.get(p.key) ?? -Infinity)) fired.set(p.key, ms);
    }
    for (const raw of this.#o.automations ?? []) {
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
      this.#timers.set(key, { a, last: fired.get(key) ?? -Infinity });
    }
    await this.tick();
  }

  stop(): void {
    this.#running = false;
    this.#wake?.cancel();
    this.#wake = null;
    this.#setHold(false);
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
        source: 'automation' as const,
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
    for (const [key, t] of this.#timers) {
      const w = dueWindow(t.a.trigger, t.last, now);
      if (w.count > 0 && w.last !== null) await this.#fire(key, t, w.last, w.count);
      if (!this.#running) return;
      if (w.next !== null && (next === null || w.next < next)) next = w.next;
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

  async #fire(key: string, t: { a: AutomationV1; last: number }, dueMs: number, count: number): Promise<void> {
    const dueAt = new Date(dueMs).toISOString();
    const late = dueMs < this.#activatedAt;
    const attended = t.a.attended || late;
    if (count > 1) await this.#o.log.append(DROPPED, { key, reason: 'coalesced', count: count - 1, throughAt: dueAt });
    // chain write before side effect (§2.4 rule 4): the due row commits before any run step
    await this.#o.log.append(DUE, { id: t.a.id, key, dueAt, model: t.a.model, attended, late });
    t.last = dueMs;
    if (attended) return; // an attended due row is for a human: nothing spends (law 5)
    const fire: AutomationFire = { key, dueAt, late };
    await (this.#o.run ?? this.#refuseRun)(t.a, fire);
  }

  /** The default run step: the session runner is not built yet — refuse, record, spawn nothing. */
  readonly #refuseRun: AutomationRunner = async (a, fire) => {
    const milestone = runStepMilestone(a.model);
    const refusal = refuse({ code: 'ENGINE', data: { reason: 'not-implemented', verb: 'automation.run', milestone } });
    await this.#o.log.append('session.refused', { code: refusal.code, reason: 'not-implemented', automationId: a.id, key: fire.key, dueAt: fire.dueAt, model: a.model, milestone });
  };

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
