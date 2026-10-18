/**
 * #scheduler (spec §3.5, §2.4 rule 3, §10 law 5) — platform-independent unit
 * tests over an in-memory log and a manual clock: G-SCH-01 (timers rebuild
 * from the log after a restart; no due instant fires twice), G-LAW-05 (a
 * clock-advanced 24 h soak: zero permit.grant; attended automations spend
 * nothing; an unattended one is refused ENGINE{not-implemented} until
 * M1.7/M1.8), G-LAW-05b (N registrations of one key ⇒ one timer), the
 * due-while-down rule and the idle-exit timer hold.
 */
import { describe, expect, it } from 'vitest';
import {
  AutomationRefusal,
  dueWindow,
  parseAutomation,
  Scheduler,
  type AutomationRunner,
  type SchedulerLog,
} from '../src/kernel/scheduler/index.js';

const H = 3_600_000;
const T0 = Date.parse('2026-10-17T00:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

class MemLog implements SchedulerLog {
  readonly all: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  async append(kind: string, payload: Record<string, unknown>): Promise<void> {
    this.all.push({ kind, payload });
  }
  *rows(kinds: readonly string[]) {
    for (const r of this.all) if (kinds.includes(r.kind)) yield r;
  }
  of(kind: string) {
    return this.all.filter((r) => r.kind === kind).map((r) => r.payload);
  }
}

/** A manual clock: the scheduler arms one wake at a time; advance() runs wakes in order. */
class Clock {
  now = T0;
  wake: { at: number } | null = null;
  holds = 0;
  arm = (_fn: () => void, ms: number) => {
    const w = { at: this.now + ms };
    this.wake = w;
    return { cancel: () => void (this.wake === w ? (this.wake = null) : undefined) };
  };
  holdIdle = () => {
    this.holds++;
    let done = false;
    return () => void (done ? undefined : ((done = true), this.holds--));
  };
  async advance(s: Scheduler, ms: number): Promise<void> {
    const target = this.now + ms;
    while (this.wake && this.wake.at <= target) {
      this.now = this.wake.at;
      this.wake = null;
      await s.tick();
    }
    this.now = target;
  }
}

function sched(log: MemLog, clock: Clock, automations: unknown[], run?: AutomationRunner): Scheduler {
  return new Scheduler({ log, automations, now: () => clock.now, arm: clock.arm, holdIdle: clock.holdIdle, ...(run ? { run } : {}) });
}

const hourly = (id: string, extra: Record<string, unknown> = {}) => ({ id, model: 'local', trigger: { every: H, anchor: iso(T0) }, ...extra });

describe('automation:v1', () => {
  it('is attended unless a human marked it, and keeps model', () => {
    expect(parseAutomation(hourly('a'))).toEqual({ id: 'a', model: 'local', trigger: { every: H, anchor: iso(T0) }, attended: true });
    expect(parseAutomation(hourly('b', { attended: false, markedBy: 'p:ab12/founder' }))).toMatchObject({ attended: false, markedBy: 'p:ab12/founder' });
  });

  it.each([
    ['attended:false without a mark', hourly('x', { attended: false }), 'unattended-unmarked'],
    ['attended:false marked by the kernel', hourly('x', { attended: false, markedBy: 'p:ab12/kernel' }), 'unattended-unmarked'],
    ['attended:false marked by a mod', hourly('x', { attended: false, markedBy: 'p:ab12/mod-foo' }), 'unattended-unmarked'],
    ['markedBy on an attended record', hourly('x', { markedBy: 'p:ab12/founder' }), 'bad-shape'],
    ['an unknown model', hourly('x', { model: 'gpt' }), 'bad-model'],
    ['no model', { id: 'x', trigger: { at: iso(T0) } }, 'bad-model'],
    ['a period under a minute', { id: 'x', model: 'any', trigger: { every: 1000, anchor: iso(T0) } }, 'bad-trigger'],
    ['an every trigger without an anchor (would be now-relative)', { id: 'x', model: 'any', trigger: { every: H } }, 'bad-trigger'],
    ['an unknown field', hourly('x', { spend: true }), 'bad-shape'],
    ['a non-kebab id', hourly('X_1'), 'bad-id'],
  ])('refuses %s', (_label, raw, reason) => {
    expect(() => parseAutomation(raw)).toThrow(AutomationRefusal);
    try {
      parseAutomation(raw);
    } catch (e) {
      expect((e as AutomationRefusal).reason).toBe(reason);
    }
  });

  it('due instants are a pure function of the trigger and the last fired instant', () => {
    const tr = { every: H, anchor: iso(T0) };
    expect(dueWindow(tr, -Infinity, T0 - 1)).toEqual({ count: 0, last: null, next: T0 });
    expect(dueWindow(tr, -Infinity, T0 + 2.5 * H)).toEqual({ count: 3, last: T0 + 2 * H, next: T0 + 3 * H });
    expect(dueWindow(tr, T0 + 2 * H, T0 + 2.5 * H)).toEqual({ count: 0, last: null, next: T0 + 3 * H });
    expect(dueWindow({ at: iso(T0) }, T0, T0 + H)).toEqual({ count: 0, last: null, next: null });
  });
});

describe('G-SCH-01 timers rebuild from the log after a restart', () => {
  it('an `at` timer fires once; a restarted scheduler over the same log never refires it', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const a = { id: 'once', model: 'claude', trigger: { at: iso(T0 + 5 * 60_000) } };
    const s1 = sched(log, clock, [a]);
    await s1.start();
    expect(log.of('schedule.automation.due')).toHaveLength(0);
    await clock.advance(s1, 6 * 60_000);
    expect(log.of('schedule.automation.due')).toEqual([{ id: 'once', key: 'automation:once', dueAt: iso(T0 + 5 * 60_000), model: 'claude', attended: true, late: false }]);
    s1.stop();
    const s2 = sched(log, clock, [a]);
    await s2.start();
    await clock.advance(s2, 24 * H);
    expect(log.of('schedule.automation.due')).toHaveLength(1);
    expect(s2.timers()).toEqual([{ key: 'automation:once', source: 'automation', automationId: 'once', lastFiredAt: iso(T0 + 5 * 60_000) }]);
  });

  it('an interval timer resumes on its anchor grid after a restart (never now + period)', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const s1 = sched(log, clock, [hourly('tick')]);
    clock.now = T0 + 1; // just after the anchor instant: the anchor itself was missed by 1 ms
    await s1.start();
    await clock.advance(s1, H + 10 * 60_000); // T0+70min
    s1.stop();
    const fired1 = log.of('schedule.automation.due').map((p) => p.dueAt);
    expect(fired1).toEqual([iso(T0), iso(T0 + H)]);
    clock.now += 20 * 60_000; // restart at T0+90min
    const s2 = sched(log, clock, [hourly('tick')]);
    await s2.start();
    expect(s2.timers()[0]).toMatchObject({ lastFiredAt: iso(T0 + H), nextDueAt: iso(T0 + 2 * H) });
    await clock.advance(s2, 31 * 60_000); // T0+121min
    expect(log.of('schedule.automation.due').map((p) => p.dueAt)).toEqual([iso(T0), iso(T0 + H), iso(T0 + 2 * H)]);
  });

  it('a timer due while the daemon was down fires on activation as an ATTENDED event; misses coalesce', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const runs: string[] = [];
    clock.now = T0 + 3.5 * H; // down since before T0
    const s = sched(log, clock, [hourly('night', { attended: false, markedBy: 'p:ab12/founder' })], async (a) => void runs.push(a.id));
    await s.start();
    expect(log.of('schedule.dropped')).toEqual([{ key: 'automation:night', reason: 'coalesced', count: 3, throughAt: iso(T0 + 3 * H) }]);
    expect(log.of('schedule.automation.due')).toEqual([{ id: 'night', key: 'automation:night', dueAt: iso(T0 + 3 * H), model: 'local', attended: true, late: true }]);
    expect(runs).toEqual([]); // late ⇒ attended ⇒ no run step
    await clock.advance(s, H); // the next one is on time and unattended
    expect(runs).toEqual(['night']);
  });
});

describe('G-LAW-05 nothing spends by default (clock-advanced 24 h soak)', () => {
  const SPEND = ['permit.grant', 'permit.reserve', 'session.spawned', 'session.open'];

  it('a fresh install: no timers, no rows, no hold', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const s = sched(log, clock, []);
    await s.start();
    await clock.advance(s, 24 * H);
    expect(log.all).toEqual([]);
    expect(clock.holds).toBe(0);
  });

  it('attended automations fire due events for a human and spend nothing', async () => {
    const log = new MemLog();
    const clock = new Clock();
    let runs = 0;
    const s = sched(log, clock, [hourly('a'), { ...hourly('b'), model: 'claude' }], async () => void runs++);
    await s.start();
    await clock.advance(s, 24 * H);
    expect(log.of('schedule.automation.due')).toHaveLength(2 * 25); // T0..T0+24h inclusive
    expect(log.of('schedule.automation.due').every((p) => p.attended === true)).toBe(true);
    expect(runs).toBe(0);
    for (const k of SPEND) expect(log.of(k)).toEqual([]);
  });

  it('a human-marked unattended automation reaches the run step, which is refused ENGINE{not-implemented} (M1.7/M1.8): no spawn, no permit', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const s = sched(log, clock, [
      hourly('loc', { attended: false, markedBy: 'p:ab12/founder' }),
      { ...hourly('cld', { attended: false, markedBy: 'p:ab12/founder' }), model: 'claude' },
      { ...hourly('any', { attended: false, markedBy: 'p:ab12/founder' }), model: 'any' },
    ]);
    await s.start();
    await clock.advance(s, 24 * H);
    const refused = log.of('session.refused');
    expect(refused).toHaveLength(3 * 25);
    expect(refused.every((p) => p.code === 'ENGINE' && p.reason === 'not-implemented')).toBe(true);
    expect(new Set(refused.map((p) => `${p.automationId}:${p.milestone}`))).toEqual(new Set(['loc:M1.8', 'cld:M1.7', 'any:M1.7+M1.8']));
    for (const k of SPEND) expect(log.of(k)).toEqual([]);
  });

  it('refused registrations are logged schedule.dropped and get no timer', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const s = sched(log, clock, [hourly('u', { attended: false })]);
    await s.start();
    expect(log.of('schedule.dropped')).toMatchObject([{ key: 'automation:u', reason: 'unattended-unmarked' }]);
    await clock.advance(s, 24 * H);
    expect(log.of('schedule.automation.due')).toEqual([]);
  });

  it.todo('G-LAW-05: a human-marked `model: local` automation runs unattended through #local-runner under a compute permit (M1.8; run step refused until then)');
  it.todo('G-LAW-05: spending scheduler jobs are manifest `opt-in` — the manifest-declared job source (#mod-host M1.11) feeds automation records');
});

describe('G-LAW-05b one daemon ⇒ one timer per key', () => {
  it('the same automation registered from N worktrees yields one timer and one due row per instant', async () => {
    const log = new MemLog();
    const clock = new Clock();
    const N = 5;
    const s = sched(log, clock, Array.from({ length: N }, () => hourly('shared')));
    await s.start();
    expect(s.timers()).toHaveLength(1);
    expect(log.of('schedule.dropped')).toEqual(Array.from({ length: N - 1 }, () => ({ key: 'automation:shared', reason: 'duplicate-key' })));
    await clock.advance(s, 3 * H);
    expect(log.of('schedule.automation.due').map((p) => p.dueAt)).toEqual([iso(T0), iso(T0 + H), iso(T0 + 2 * H), iso(T0 + 3 * H)]);
  });
});

describe('§2.4 rule 3: no due timers inside 10 min', () => {
  it('holds idle only while the next due instant is inside the horizon', async () => {
    const log = new MemLog();
    const clock = new Clock();
    clock.now = T0 - 30 * 60_000;
    const s = sched(log, clock, [{ id: 'h', model: 'any', trigger: { at: iso(T0) } }]);
    await s.start();
    expect(clock.holds).toBe(0);
    expect(clock.wake?.at).toBe(T0 - 10 * 60_000); // wakes at the horizon edge
    await clock.advance(s, 21 * 60_000);
    expect(clock.holds).toBe(1);
    expect(s.holdingIdle).toBe(true);
    await clock.advance(s, 10 * 60_000);
    expect(log.of('schedule.automation.due')).toHaveLength(1);
    expect(clock.holds).toBe(0); // spent ⇒ released
    expect(clock.wake).toBeNull();
  });

  it('stop() releases the hold and cancels the wake', async () => {
    const clock = new Clock();
    const s = sched(new MemLog(), clock, [{ id: 'h', model: 'any', trigger: { at: iso(T0 + 60_000) } }]);
    await s.start();
    expect(clock.holds).toBe(1);
    s.stop();
    expect(clock.holds).toBe(0);
    expect(clock.wake).toBeNull();
  });
});
