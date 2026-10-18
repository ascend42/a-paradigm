/**
 * #scheduler (spec §3.5, §2.4 rule 3, §10 law 5) — platform-independent unit
 * tests over an in-memory log and a manual clock: G-SCH-01 (timers rebuild
 * from the log after a restart; no due instant fires twice; only kernel-written,
 * not-future-dated due rows count), G-LAW-05 (a clock-advanced 24 h soak: zero
 * permit.grant; every automation is attended — attended:false is refused until
 * M1.6 + M1.7/M1.8), G-LAW-05b (N registrations of one key ⇒ one timer), the
 * due-while-down / slept-host lateness rule, the idle-exit timer hold, the
 * 60 s wake cap, the stop latch and the failed-append path.
 */
import { describe, expect, it } from 'vitest';
import { AutomationRefusal, dueWindow, MAX_ARM_MS, MAX_AUTOMATION_PERIOD_MS, parseAutomation, RETRY_MS, Scheduler, type SchedulerLog } from '../src/kernel/scheduler/index.js';

const H = 3_600_000;
const MIN = 60_000;
const T0 = Date.parse('2026-10-17T00:00:00.000Z');
const K = 'p:ab12/kernel';
const iso = (ms: number): string => new Date(ms).toISOString();

class MemLog implements SchedulerLog {
  readonly all: Array<{ kind: string; payload: Record<string, unknown>; principal: string; at: string }> = [];
  failNext = 0;
  constructor(private readonly clock: { now: number }) {}
  async append(kind: string, payload: Record<string, unknown>): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('log closed');
    }
    this.all.push({ kind, payload, principal: K, at: iso(this.clock.now) });
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
  wake: { at: number; ms: number } | null = null;
  holds = 0;
  arm = (_fn: () => void, ms: number) => {
    const w = { at: this.now + ms, ms };
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

function setup(automations: unknown[], clock = new Clock(), log = new MemLog(clock)) {
  const s = new Scheduler({ log, kernelPrincipal: K, automations, now: () => clock.now, arm: clock.arm, holdIdle: clock.holdIdle });
  return { s, log, clock };
}

const hourly = (id: string, extra: Record<string, unknown> = {}) => ({ id, model: 'local', trigger: { every: H, anchor: iso(T0) }, ...extra });

describe('automation:v1', () => {
  it('is attended and keeps model', () => {
    expect(parseAutomation(hourly('a'))).toEqual({ id: 'a', model: 'local', trigger: { every: H, anchor: iso(T0) }, attended: true });
    expect(parseAutomation({ id: 'b', model: 'any', trigger: { at: '2026-10-17T01:00:00+02:00' } }).trigger).toEqual({ at: '2026-10-17T01:00:00+02:00' });
  });

  it.each([
    ['attended:false (no broker decision / run step yet)', hourly('x', { attended: false }), 'unattended-unavailable'],
    ['attended:false with a principal-string mark', hourly('x', { attended: false, markedBy: 'p:ab12/founder' }), 'bad-shape'],
    ['an unknown model', hourly('x', { model: 'gpt' }), 'bad-model'],
    ['no model', { id: 'x', trigger: { at: iso(T0) } }, 'bad-model'],
    ['a period under a minute', { id: 'x', model: 'any', trigger: { every: 1000, anchor: iso(T0) } }, 'bad-trigger'],
    ['a period over 10 years', { id: 'x', model: 'any', trigger: { every: MAX_AUTOMATION_PERIOD_MS + 1, anchor: iso(T0) } }, 'bad-trigger'],
    ['an every trigger without an anchor (would be now-relative)', { id: 'x', model: 'any', trigger: { every: H } }, 'bad-trigger'],
    ['a zoneless instant', { id: 'x', model: 'any', trigger: { at: '2026-10-17T00:00:00' } }, 'bad-trigger'],
    ['a date-only instant', { id: 'x', model: 'any', trigger: { at: '2026-10-17' } }, 'bad-trigger'],
    ['a non-ISO instant Date.parse accepts', { id: 'x', model: 'any', trigger: { at: 'October 17, 2026' } }, 'bad-trigger'],
    ['an expanded-year instant', { id: 'x', model: 'any', trigger: { at: '+275760-09-13T00:00:00.000Z' } }, 'bad-trigger'],
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
    const a = { id: 'once', model: 'claude', trigger: { at: iso(T0 + 5 * MIN) } };
    const { s: s1, log, clock } = setup([a]);
    await s1.start();
    expect(log.of('schedule.automation.due')).toHaveLength(0);
    await clock.advance(s1, 6 * MIN);
    expect(log.of('schedule.automation.due')).toEqual([{ id: 'once', key: 'automation:once', dueAt: iso(T0 + 5 * MIN), model: 'claude', attended: true, late: false }]);
    await s1.stop();
    const { s: s2 } = setup([a], clock, log);
    await s2.start();
    await clock.advance(s2, 24 * H);
    expect(log.of('schedule.automation.due')).toHaveLength(1);
    expect(s2.timers()).toEqual([{ key: 'automation:once', source: 'automation', automationId: 'once', lastFiredAt: iso(T0 + 5 * MIN) }]);
  });

  it('an interval timer resumes on its anchor grid after a restart (never now + period)', async () => {
    const { s: s1, log, clock } = setup([hourly('tick')]);
    clock.now = T0 + 1;
    await s1.start();
    await clock.advance(s1, H + 10 * MIN);
    await s1.stop();
    expect(log.of('schedule.automation.due').map((p) => p.dueAt)).toEqual([iso(T0), iso(T0 + H)]);
    clock.now += 20 * MIN;
    const { s: s2 } = setup([hourly('tick')], clock, log);
    await s2.start();
    expect(s2.timers()[0]).toMatchObject({ lastFiredAt: iso(T0 + H), nextDueAt: iso(T0 + 2 * H) });
    await clock.advance(s2, 31 * MIN);
    expect(log.of('schedule.automation.due').map((p) => p.dueAt)).toEqual([iso(T0), iso(T0 + H), iso(T0 + 2 * H)]);
  });

  it('ignores due rows not written by the kernel principal, or dated after their own commit', async () => {
    const clock = new Clock();
    const log = new MemLog(clock);
    const a = { id: 'guard', model: 'any', trigger: { at: iso(T0 + 5 * MIN) } };
    log.all.push({ kind: 'schedule.automation.due', principal: 'p:ab12/mod-evil', at: iso(T0 + 10 * MIN), payload: { key: 'automation:guard', dueAt: iso(T0 + 5 * MIN) } });
    log.all.push({ kind: 'schedule.automation.due', principal: K, at: iso(T0), payload: { key: 'automation:guard', dueAt: iso(T0 + 5 * MIN) } }); // future-dated
    const { s } = setup([a], clock, log);
    await s.start();
    expect(s.timers()[0]!.lastFiredAt).toBeUndefined();
    await clock.advance(s, 6 * MIN);
    expect(log.all.filter((r) => r.kind === 'schedule.automation.due' && r.at === iso(T0 + 5 * MIN))).toHaveLength(1);
  });

  it('a timer due while the daemon was down fires on activation, attended and late; misses coalesce', async () => {
    const clock = new Clock();
    clock.now = T0 + 3.5 * H;
    const { s, log } = setup([hourly('night')], clock);
    await s.start();
    expect(log.of('schedule.dropped')).toEqual([{ key: 'automation:night', reason: 'coalesced', count: 3, throughAt: iso(T0 + 3 * H) }]);
    expect(log.of('schedule.automation.due')).toEqual([{ id: 'night', key: 'automation:night', dueAt: iso(T0 + 3 * H), model: 'local', attended: true, late: true }]);
  });

  it('a due instant older than one period (capped at the horizon) counts as late — the host slept through it', async () => {
    const { s, log, clock } = setup([{ id: 'nap', model: 'any', trigger: { at: iso(T0 + 5 * MIN) } }]);
    await s.start();
    clock.now = T0 + 30 * MIN; // the wake was due at +5 min; the host slept
    await s.tick();
    expect(log.of('schedule.automation.due')).toEqual([expect.objectContaining({ late: true, attended: true })]);
  });
});

describe('G-LAW-05 nothing spends by default (clock-advanced 24 h soak)', () => {
  const SPEND = ['permit.grant', 'permit.reserve', 'session.spawned', 'session.open', 'session.refused'];

  it('a fresh install: no timers, no rows, no hold', async () => {
    const { s, log, clock } = setup([]);
    await s.start();
    await clock.advance(s, 24 * H);
    expect(log.all).toEqual([]);
    expect(clock.holds).toBe(0);
  });

  it('automations fire attended due events for a human and spend nothing', async () => {
    const { s, log, clock } = setup([hourly('a'), { ...hourly('b'), model: 'claude' }]);
    await s.start();
    await clock.advance(s, 24 * H);
    expect(log.of('schedule.automation.due')).toHaveLength(2 * 25);
    expect(log.of('schedule.automation.due').every((p) => p.attended === true)).toBe(true);
    for (const k of SPEND) expect(log.of(k)).toEqual([]);
  });

  it('an unattended record is refused at registration (schedule.dropped) and gets no timer', async () => {
    const { s, log, clock } = setup([hourly('u', { attended: false })]);
    await s.start();
    expect(log.of('schedule.dropped')).toMatchObject([{ key: 'automation:u', reason: 'unattended-unavailable' }]);
    await clock.advance(s, 24 * H);
    expect(log.of('schedule.automation.due')).toEqual([]);
    for (const k of SPEND) expect(log.of(k)).toEqual([]);
  });

  it.todo('G-LAW-05: attended:false accepted only with a verified #approval-broker decision reference (M1.6 integration)');
  it.todo('G-LAW-05: a broker-marked `model: local` automation runs unattended through #local-runner under a compute permit (M1.8; run step hard-wired to refuse until then)');
  it.todo('G-LAW-05: spending scheduler jobs are manifest `opt-in` — the manifest-declared job source (#mod-host M1.11) feeds automation records');
});

describe('G-LAW-05b one daemon ⇒ one timer per key', () => {
  it('the same automation registered from N worktrees yields one timer and one due row per instant', async () => {
    const N = 5;
    const { s, log, clock } = setup(Array.from({ length: N }, () => hourly('shared')));
    await s.start();
    expect(s.timers()).toHaveLength(1);
    expect(log.of('schedule.dropped')).toEqual(Array.from({ length: N - 1 }, () => ({ key: 'automation:shared', reason: 'duplicate-key' })));
    await clock.advance(s, 3 * H);
    expect(log.of('schedule.automation.due').map((p) => p.dueAt)).toEqual([iso(T0), iso(T0 + H), iso(T0 + 2 * H), iso(T0 + 3 * H)]);
  });
});

describe('§2.4 rule 3: no due timers inside 10 min; wakes, latch, failures', () => {
  it('holds idle only while the next due instant is inside the horizon; wakes are capped at 60 s', async () => {
    const clock = new Clock();
    clock.now = T0 - 30 * MIN;
    const { s, log } = setup([{ id: 'h', model: 'any', trigger: { at: iso(T0) } }], clock);
    await s.start();
    expect(clock.holds).toBe(0);
    expect(clock.wake?.ms).toBe(MAX_ARM_MS);
    await clock.advance(s, 21 * MIN);
    expect(clock.holds).toBe(1);
    expect(s.holdingIdle).toBe(true);
    await clock.advance(s, 10 * MIN);
    expect(log.of('schedule.automation.due')).toEqual([expect.objectContaining({ late: false })]);
    expect(clock.holds).toBe(0);
    expect(clock.wake).toBeNull();
  });

  it('stop() is a latch: it releases the hold, cancels the wake, and a later start() is a no-op', async () => {
    const { s, log, clock } = setup([{ id: 'h', model: 'any', trigger: { at: iso(T0 + MIN) } }]);
    await s.start();
    expect(clock.holds).toBe(1);
    await s.stop();
    expect(clock.holds).toBe(0);
    expect(clock.wake).toBeNull();
    await s.start();
    await clock.advance(s, H);
    expect(log.all).toEqual([]);
    const { s: never, clock: c2 } = setup([{ id: 'h', model: 'any', trigger: { at: iso(T0 + MIN) } }]);
    await never.stop();
    await never.start();
    expect(c2.holds).toBe(0);
  });

  it('a failed append releases the hold and re-arms a retry; the instant fires on the retry', async () => {
    const { s, log, clock } = setup([{ id: 'r', model: 'any', trigger: { at: iso(T0 + MIN) } }]);
    await s.start();
    log.failNext = 1;
    clock.now = T0 + MIN;
    await s.tick();
    expect(clock.holds).toBe(0);
    expect(clock.wake?.ms).toBe(RETRY_MS);
    await clock.advance(s, RETRY_MS);
    expect(log.of('schedule.automation.due')).toHaveLength(1);
  });
});
