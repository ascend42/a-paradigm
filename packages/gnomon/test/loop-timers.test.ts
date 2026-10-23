/**
 * #loop-timers and the step-6 #scheduler forms (docs/specs/gnomon-loops.md §4 "Scheduler integration", "Uptime
 * hold", §10 D1; build plan step 6, LP4a), over the real scheduler, registry, ledger and runner with an injected
 * check executor and a manual clock. Platform-independent: zones are data, fixtures are built with path.join under
 * os.tmpdir(), timer keys are never path components.
 *
 *   DST         daily/weekly in America/Los_Angeles and Europe/London: a time skipped by spring-forward fires once
 *               at the end of the gap, a repeated one once at its first occurrence; counts across a DST change
 *   trust lift  attended:false parses only when the predicate says the loop is trusted; an unknown zone refuses
 *   G-LAW-05b   a fresh install has zero loop timers; an untrusted loop none; trust adds, pause/untrust/change remove
 *   end to end  a scheduled run on a fake clock: due row (attended:false), hand-off, run, ledger; the loop idle hold
 *   catchUp     a fire missed while the daemon was down: skip is a row for a human, once runs it once
 *   G-LOOP-26   the kill switch drops every loop timer synchronously; nothing fires after it; resume restores
 *   continuous  the next run at end + cooldown; a pause (budget) or a refused start schedules nothing
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { LoopLedger } from '../src/kernel/loops/ledger.js';
import { LoopRegistry } from '../src/kernel/loops/registry.js';
import { LoopRunner } from '../src/kernel/loops/runner.js';
import { LOOP_KEEP_ALIVE_LINE, LoopTimers } from '../src/kernel/loops/timers.js';
import type { CheckResult } from '../src/kernel/loops/check-exec.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';
import { AutomationRefusal, dueWindow, parseAutomation, Scheduler, zonedInstant, type SchedulerLog } from '../src/kernel/scheduler/index.js';

type Def = Record<string, any>;
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const gui = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const MIN = 60_000;
const H = 3_600_000;
const z = (s: string): number => Date.parse(s);
const iso = (ms: number): string => new Date(ms).toISOString();
const LA = 'America/Los_Angeles';
const LDN = 'Europe/London';

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});
const write = (p: string, text: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
function putLoop(root: string, def: Def): void {
  const r = compileLoop(def, { scope: 'repo', readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
  if (!r.compiled) throw new Error(JSON.stringify(r.errors));
  write(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
}
function repo(defs: Def[] = []): string {
  const root = tmp('gnomon-repo-');
  fs.mkdirSync(path.join(root, '.git'));
  write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n');
  write(path.join(root, 'package.json'), '{"name":"x"}\n');
  for (const d of defs) putLoop(root, d);
  return root;
}
const chk = (id: string, on: Record<string, string>): Def => ({ id, type: 'check', run: ['bin/check', id], on });
const scheduled = (id: string, schedule: Def, catchUp: 'skip' | 'once' = 'skip'): Def => ({
  schema: 'loop:v2', id, autonomy: 'observe', triggers: [{ schedule, catchUp }], budgets: { day: { runs: 12 } }, start: 'a', nodes: [chk('a', { pass: '@stop', fail: '@stop' })],
});
const continuous = (id: string, extra: Def = {}): Def => ({
  schema: 'loop:v2', id, autonomy: 'observe', triggers: [{ continuous: { cooldown: '2m' } }], budgets: { run: { rounds: 2 }, day: { runs: 3 } }, start: 'a', nodes: [chk('a', { pass: '@stop', fail: '@stop' })], ...extra,
});

function ok(verdict: CheckResult['verdict']): CheckResult {
  return { verdict, exitCode: verdict === 'pass' ? 0 : 1, signal: null, durationMs: 10, evidence: { stdoutTail: '', stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true }, profileHash: null, envKeys: [], copy: { dir: '', files: 0, bytes: 0, kept: false } };
}

type Row = { kind: string; principal: string; at: string; payload: Record<string, unknown> };

/** A manual clock: the scheduler arms one wake at a time; advance() runs wakes in order. */
class Clock {
  constructor(public now: number) {}
  wake: { at: number } | null = null;
  holds: string[] = [];
  arm = (_fn: () => void, ms: number) => {
    const w = { at: this.now + ms };
    this.wake = w;
    return { cancel: () => void (this.wake === w ? (this.wake = null) : undefined) };
  };
  hold = (kind: string) => () => {
    this.holds.push(kind);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.holds.splice(this.holds.indexOf(kind), 1);
    };
  };
}

interface RigOpts {
  rows?: Row[];
  tz?: string;
  start?: boolean;
}

/** registry + ledger + runner + scheduler + timers over one in-memory log and one manual clock */
async function rig(root: string | null, clock: Clock, o: RigOpts = {}) {
  const home = tmp('gnomon-home-');
  const rows: Row[] = o.rows ?? [];
  const cards: any[] = [];
  const registry = new LoopRegistry({ home, kernelPrincipal: KERNEL, append: async (k, p) => append(k, p), watch: false, rescanMs: 0 });
  const ledger = new LoopLedger({ kernelPrincipal: KERNEL });
  const append = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    const row = { kind, principal: KERNEL, at: iso(clock.now), payload };
    rows.push(row);
    registry.observe(row);
    ledger.observe(row);
  };
  for (const r of rows) {
    registry.observe(r);
    ledger.observe(r);
  }
  const log: SchedulerLog = {
    append: (kind, payload) => append(kind, payload),
    *rows(kinds) {
      for (const r of rows) if (kinds.includes(r.kind)) yield r;
    },
  };
  const scheduler = new Scheduler({ log, kernelPrincipals: [KERNEL], now: () => clock.now, arm: clock.arm, holdIdle: clock.hold('timer') });
  const runner = new LoopRunner({
    home, kernelPrincipal: KERNEL, registry, ledger, append, platform: 'darwin', clock: () => clock.now,
    broker: { raise: async (input: any) => { cards.push(input); return { cardId: input.cardId } as any; } },
    check: async () => ok('pass'),
  });
  const timers = new LoopTimers({ registry, runner, scheduler, tz: o.tz ?? LA, clock: () => clock.now, holdIdle: clock.hold('loop') });
  if (root) registry.addRepo(root);
  registry.scan();
  if (o.start !== false) await scheduler.start();
  const key = (id: string): string => `repo/${repoKeyOf([root!])}/${id}`;
  const trust = (id: string): void => {
    const e = registry.verify(key(id))!;
    void append('loop.trusted', { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, by: HUMAN });
  };
  const advance = async (ms: number): Promise<void> => {
    const target = clock.now + ms;
    await scheduler.tick(); // a timer registered since the last wake arms on its own tick
    while (clock.wake && clock.wake.at <= target) {
      clock.now = clock.wake.at;
      clock.wake = null;
      await scheduler.tick();
      await runner.idle();
    }
    clock.now = target;
  };
  const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.payload);
  const loopTimers = () => scheduler.timers().filter((t) => t.source === 'loop');
  return { rows, cards, registry, ledger, runner, scheduler, timers, key, trust, advance, of, loopTimers };
}

// ── DST fixtures ─────────────────────────────────────────────────────────────

const day = (s: string): number => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86_400_000;

describe('zoned triggers: DST (America/Los_Angeles, Europe/London)', () => {
  it('Los Angeles: 02:30 on spring-forward day fires once at 03:00 PDT; normal days either side are exact', () => {
    expect(iso(zonedInstant(day('2026-03-07'), 150, LA))).toBe('2026-03-07T10:30:00.000Z'); // 02:30 PST
    expect(iso(zonedInstant(day('2026-03-08'), 150, LA))).toBe('2026-03-08T10:00:00.000Z'); // the gap: 03:00 PDT
    expect(iso(zonedInstant(day('2026-03-09'), 150, LA))).toBe('2026-03-09T09:30:00.000Z'); // 02:30 PDT
    const w = dueWindow({ daily: { at: '02:30', tz: LA } }, z('2026-03-07T12:00:00Z'), z('2026-03-09T12:00:00Z'));
    expect(w).toEqual({ count: 2, last: z('2026-03-09T09:30:00Z'), next: z('2026-03-10T09:30:00Z') });
    // exactly one fire on the skipped day
    expect(dueWindow({ daily: { at: '02:30', tz: LA } }, z('2026-03-08T08:00:00Z'), z('2026-03-08T23:00:00Z')).count).toBe(1);
  });

  it('Los Angeles: 01:30 on fall-back day fires once, at its first occurrence (PDT)', () => {
    expect(iso(zonedInstant(day('2026-11-01'), 90, LA))).toBe('2026-11-01T08:30:00.000Z'); // 01:30 PDT, not 09:30Z PST
    const t = { daily: { at: '01:30', tz: LA } };
    expect(dueWindow(t, z('2026-11-01T08:30:00Z'), z('2026-11-01T23:00:00Z'))).toEqual({ count: 0, last: null, next: z('2026-11-02T09:30:00Z') });
    expect(dueWindow(t, z('2026-10-31T12:00:00Z'), z('2026-11-02T12:00:00Z'))).toMatchObject({ count: 2, last: z('2026-11-02T09:30:00Z') });
  });

  it('London: 01:30 on spring-forward day fires at 02:00 BST; on fall-back day once at 01:30 BST; weekly too', () => {
    expect(iso(zonedInstant(day('2026-03-29'), 90, LDN))).toBe('2026-03-29T01:00:00.000Z'); // the gap: 02:00 BST
    expect(iso(zonedInstant(day('2026-10-25'), 90, LDN))).toBe('2026-10-25T00:30:00.000Z'); // first 01:30 (BST)
    const sun = { weekly: { day: 'sun' as const, at: '01:30', tz: LDN } };
    expect(dueWindow(sun, z('2026-03-28T00:00:00Z'), z('2026-04-05T12:00:00Z'))).toEqual({ count: 2, last: z('2026-04-05T00:30:00Z'), next: z('2026-04-12T00:30:00Z') });
    expect(dueWindow(sun, z('2026-10-24T00:00:00Z'), z('2026-10-26T00:00:00Z'))).toMatchObject({ count: 1, last: z('2026-10-25T00:30:00Z') });
  });

  it('a daily 09:00 across the US change fires once per local day (14 in two weeks), one gap of 23 h', () => {
    const t = { daily: { at: '09:00', tz: LA } };
    const w = dueWindow(t, z('2026-03-01T00:00:00Z'), z('2026-03-15T00:00:00Z'));
    expect(w.count).toBe(14);
    const fires: number[] = [];
    let after = z('2026-03-01T00:00:00Z');
    for (let i = 0; i < 14; i++) {
      const n = dueWindow(t, after, after).next!;
      fires.push(n);
      after = n;
    }
    const gaps = fires.slice(1).map((f, i) => (f - fires[i]!) / H);
    expect(gaps.filter((g) => g === 23)).toHaveLength(1);
    expect(gaps.filter((g) => g === 24)).toHaveLength(12);
  });
});

describe('automation:v1 step-6 forms and the trust lift', () => {
  const rec = (extra: Def = {}) => ({ id: 'nightly', model: 'local', trigger: { daily: { at: '07:30', tz: LA } }, ...extra });
  it('daily/weekly parse; an unknown zone, a bad time or day refuses bad-trigger', () => {
    expect(parseAutomation(rec())).toEqual({ id: 'nightly', model: 'local', trigger: { daily: { at: '07:30', tz: LA } }, attended: true });
    expect(parseAutomation(rec({ trigger: { weekly: { day: 'mon', at: '09:00', tz: LDN } } })).trigger).toEqual({ weekly: { day: 'mon', at: '09:00', tz: LDN } });
    for (const trigger of [{ daily: { at: '07:30', tz: 'Mars/Olympus' } }, { daily: { at: '7:30', tz: LA } }, { weekly: { day: 'funday', at: '09:00', tz: LA } }, { daily: { at: '07:30', tz: LA, x: 1 } }]) {
      expect(() => parseAutomation(rec({ trigger }))).toThrow(AutomationRefusal);
    }
  });
  it('attended:false lifts ONLY when the predicate says the loop is trusted; everything else keeps refusing', () => {
    expect(() => parseAutomation(rec({ attended: false }))).toThrow(/unattended-unavailable|M1\.6/);
    expect(() => parseAutomation(rec({ attended: false }), { unattended: () => false })).toThrow(AutomationRefusal);
    expect(parseAutomation(rec({ attended: false }), { unattended: () => true }).attended).toBe(false);
  });
});

// ── #loop-timers ─────────────────────────────────────────────────────────────

const T0 = z('2026-03-07T12:00:00Z'); // 04:00 PST

describe('G-LAW-05b: loop timers exist only for trusted, unpaused loops', () => {
  it('a fresh install has zero loop timers and holds nothing', async () => {
    const clock = new Clock(T0);
    const r = await rig(null, clock);
    expect(r.loopTimers()).toEqual([]);
    expect(r.timers.keys()).toEqual([]);
    expect(clock.holds).toEqual([]);
    const up = r.timers.status();
    expect(up).toMatchObject({ enabled: { n: 0 }, running: { n: 0 }, keepingAlive: false });
    expect(up.line).toBeUndefined();
  });

  it('untrusted: none; trust adds one per schedule trigger; pause, untrust and a content change remove it', async () => {
    const root = repo([scheduled('nightly', { daily: '07:30' })]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    expect(r.loopTimers()).toEqual([]);
    r.trust('nightly');
    expect(r.loopTimers()).toHaveLength(1);
    expect(r.loopTimers()[0]).toMatchObject({ source: 'loop', loopKey: r.key('nightly'), nextDueAt: '2026-03-07T15:30:00.000Z' });
    expect(clock.holds).toContain('loop');
    expect(r.timers.status()).toMatchObject({ enabled: { n: 1, of: 1 }, waiting: { n: 1 }, keepingAlive: true, line: LOOP_KEEP_ALIVE_LINE, nextDueAt: '2026-03-07T15:30:00.000Z' });
    expect(checkStatusNumbers({ loops: { uptime: r.timers.status() } })).toEqual([]);
    // a human pause
    await r.runner.request(gui, 'request.loop.pause', { loopId: 'nightly', scope: 'repo', repo: root });
    expect(r.loopTimers()).toEqual([]);
    expect(clock.holds).not.toContain('loop');
    await r.runner.request(gui, 'request.loop.resume', { loopId: 'nightly', scope: 'repo', repo: root });
    expect(r.loopTimers()).toHaveLength(1);
    // a content change pauses (registry) and drops the timer
    putLoop(root, scheduled('nightly', { daily: '08:30' }));
    r.registry.scan();
    await Promise.resolve();
    expect(r.registry.canRun(r.key('nightly')).ok).toBe(false);
    expect(r.loopTimers()).toEqual([]);
    // re-trust the new hash: a timer at the new time
    r.trust('nightly');
    expect(r.loopTimers().map((t) => t.nextDueAt)).toEqual(['2026-03-07T16:30:00.000Z']);
    // untrust
    const e = r.registry.entry(r.key('nightly'))!;
    r.registry.observe({ kind: 'loop.untrusted', principal: KERNEL, at: iso(clock.now), payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey } });
    expect(r.loopTimers()).toEqual([]);
    expect(r.of('schedule.automation.due')).toEqual([]);
  });
});

describe('a scheduled run end to end (fake clock)', () => {
  it('daily 07:30 Los Angeles: the due row is unattended, the runner runs it, the next timer is tomorrow', async () => {
    const root = repo([scheduled('nightly', { daily: '07:30' })]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('nightly');
    await r.advance(3 * H);
    expect(r.of('loop.run.started')).toEqual([]);
    await r.advance(1 * H);
    expect(r.of('schedule.automation.due')).toEqual([expect.objectContaining({ id: 'nightly', dueAt: '2026-03-07T15:30:00.000Z', attended: false, late: false, source: 'loop', loopKey: r.key('nightly') })]);
    const started = r.of('loop.run.started');
    expect(started).toHaveLength(1);
    expect(started[0]!.trigger).toMatchObject({ type: 'schedule', dueAt: '2026-03-07T15:30:00.000Z' });
    expect(r.of('loop.run.ended')).toEqual([expect.objectContaining({ reason: 'stop' })]);
    expect(r.loopTimers()[0]!.nextDueAt).toBe('2026-03-08T14:30:00.000Z'); // 07:30 PDT the next day (DST began)
    expect(r.of('session.refused')).toEqual([]);
    // a restart rebuilds the same timer from the log (G-SCH-01 for loop timers): no second fire of 15:30Z
    const r2 = await rig(root, clock, { rows: r.rows.map((x) => x) });
    expect(r2.loopTimers()[0]!.lastFiredAt).toBe('2026-03-07T15:30:00.000Z');
    expect(r2.of('schedule.automation.due')).toHaveLength(1);
  });

  it('a refused hand-off (the day cap) writes schedule.dropped{run-refused}, never a run', async () => {
    const root = repo([{ ...scheduled('often', { every: '1m' }), budgets: { day: { runs: 1 } } }]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('often');
    await r.advance(2 * MIN + 1000);
    expect(r.of('loop.run.started')).toHaveLength(1);
    expect(r.of('schedule.dropped')).toEqual([expect.objectContaining({ reason: 'run-refused', refusal: 'budget' })]);
  });
});

describe('catchUp: a fire missed while the daemon was down', () => {
  const missed = async (catchUp: 'skip' | 'once') => {
    const root = repo([scheduled('nightly', { daily: '07:30' }, catchUp)]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('nightly');
    // the daemon is down for two days, then boots
    clock.now = T0 + 2 * 24 * H;
    return rig(root, clock, { rows: r.rows.map((x) => x) });
  };
  it('skip: one late due row for a human (attended, coalesced), no run', async () => {
    const r = await missed('skip');
    expect(r.of('schedule.automation.due')).toEqual([expect.objectContaining({ attended: true, late: true, catchUp: 'skip' })]);
    expect(r.of('schedule.dropped')).toEqual([expect.objectContaining({ reason: 'coalesced', count: 1 })]);
    expect(r.of('loop.run.started')).toEqual([]);
  });
  it('once: the missed fires run exactly once (late)', async () => {
    const r = await missed('once');
    await r.runner.idle();
    expect(r.of('schedule.automation.due')).toEqual([expect.objectContaining({ attended: false, late: true, catchUp: 'once' })]);
    expect(r.of('loop.run.started')).toHaveLength(1);
    expect(r.of('loop.run.started')[0]!.trigger).toMatchObject({ type: 'schedule', late: true });
  });
});

describe('G-LOOP-26: the kill switch unregisters every loop timer until resume', () => {
  it('no timer fires after the kill switch; a resume decided with presence restores it', async () => {
    const root = repo([scheduled('a1', { every: '5m' }), scheduled('a2', { daily: '07:30' })]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('a1');
    r.trust('a2');
    expect(r.loopTimers()).toHaveLength(2);
    const kill = r.runner.request(gui, 'request.loop.pause', { all: true });
    expect(r.loopTimers()).toEqual([]); // synchronously, before any pause row
    await kill;
    await r.advance(24 * H);
    expect(r.of('schedule.automation.due')).toEqual([]);
    expect(r.of('loop.run.started')).toEqual([]);
    expect(clock.holds).not.toContain('loop');
    await r.runner.request(gui, 'request.loop.resume', { loopId: 'a1', scope: 'repo', repo: root });
    expect(r.loopTimers()).toEqual([]); // the card is pending: still nothing
    await r.cards[0].effect('continue', { connId: gui.connId });
    expect(r.loopTimers().map((t) => t.loopKey)).toEqual([r.key('a1')]);
    await r.advance(5 * MIN);
    expect(r.of('loop.run.started')).toHaveLength(1);
  });
});

describe('the continuous trigger', () => {
  it('runs after the cooldown, then again cooldown after each end; the day cap stops it with no further timer', async () => {
    const root = repo([continuous('cont')]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('cont');
    expect(r.loopTimers()[0]).toMatchObject({ nextDueAt: iso(T0 + 2 * MIN) });
    await r.advance(2 * MIN - 1);
    expect(r.of('loop.run.started')).toEqual([]);
    await r.advance(1);
    expect(r.of('loop.run.started')).toHaveLength(1);
    expect(r.of('loop.run.started')[0]!.trigger).toMatchObject({ type: 'continuous' });
    expect(r.loopTimers()[0]).toMatchObject({ nextDueAt: iso(clock.now + 2 * MIN) });
    await r.advance(10 * MIN);
    expect(r.of('loop.run.started')).toHaveLength(3); // day.runs: 3
    expect(r.of('schedule.dropped')).toEqual([expect.objectContaining({ reason: 'run-refused', refusal: 'budget' })]);
    await Promise.resolve();
    expect(r.loopTimers()).toEqual([]);
    expect(clock.holds).not.toContain('loop');
  });

  it('a paused loop gets no next run', async () => {
    const root = repo([continuous('cont')]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('cont');
    await r.advance(2 * MIN);
    expect(r.of('loop.run.started')).toHaveLength(1);
    await r.runner.request(gui, 'request.loop.pause', { loopId: 'cont', scope: 'repo', repo: root });
    expect(r.loopTimers()).toEqual([]);
    await r.advance(60 * MIN);
    expect(r.of('loop.run.started')).toHaveLength(1);
  });
});

describe('Aegis step-6 hardenings', () => {
  it('registerLoop refuses a key outside the loop: namespace (no timer, a bad-key drop row)', async () => {
    const root = repo([scheduled('nightly', { daily: '07:30' })]);
    const clock = new Clock(T0);
    const r = await rig(root, clock);
    r.trust('nightly');
    const ok = r.scheduler.registerLoop({ key: 'automation:nightly', loopKey: r.key('nightly'), loopId: 'nightly', trigger: { daily: { at: '07:30', tz: LA } }, catchUp: 'once', sinceMs: T0, type: 'schedule' });
    expect(ok).toBe(false);
    await Promise.resolve();
    expect(r.scheduler.timers().map((t) => t.key)).not.toContain('automation:nightly');
    expect(r.of('schedule.dropped')).toEqual([expect.objectContaining({ reason: 'bad-key' })]);
  });

  it('a host zone change keeps the timer key and its last fire: no extra catch-up run', async () => {
    const root = repo([scheduled('nightly', { daily: '07:30' }, 'once')]);
    const clock = new Clock(z('2026-03-06T12:00:00Z'));
    const r = await rig(root, clock);
    r.trust('nightly');
    await r.advance(31 * H); // fires 03-06 15:30Z and 03-07 15:30Z (Los Angeles)
    expect(r.of('loop.run.started')).toHaveLength(2);
    const before = r.loopTimers()[0]!.key;
    clock.now = z('2026-03-07T20:00:00Z');
    const r2 = await rig(root, clock, { rows: r.rows.map((x) => x), tz: LDN }); // restart in London
    await r2.runner.idle();
    expect(r2.loopTimers()[0]).toMatchObject({ key: before, lastFiredAt: '2026-03-07T15:30:00.000Z', nextDueAt: '2026-03-08T07:30:00.000Z' });
    expect(r2.of('schedule.automation.due')).toHaveLength(2);
    expect(r2.of('loop.run.started')).toHaveLength(2);
  });
});
