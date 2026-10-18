// @gnomon-platform: darwin, linux
/**
 * #scheduler + $daemon-lifecycle in the real daemon (spec §2.4, §3.5; M1.9):
 * G-SCH-01 over the real #kernel-log across a restart, the due-while-down
 * rule, the timer idle hold, idle exit stopping supervised children BEFORE
 * daemon.exit (falsifier: daemon exits with a live child) incl. a
 * SIGTERM-ignoring grandchild and real SIGKILL escalation, track() refusing a
 * non-detached session, the start-up orphan sweep (G-DMN-04) against real
 * detached process groups with boot + start-time attribution, and plain
 * `gnomond` ignoring GNOMON_HOME. Scheduler time is a clock seam kept BEHIND
 * the wall clock (due rows are never dated after their own commit), so the
 * tests do not depend on timer races. POSIX: the unix-socket endpoint and
 * process groups (the pipe and job object are the parity phase, P8-D78).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KernelLog, readBootSession, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { pidPathOf, processControlFor, startDaemon } from '../src/kernel/lifecycle/index.js';
import { PKG_ROOT } from './helpers.js';
import { sleep, tempHome } from './daemon-helpers.js';

const GNOMOND = path.join(PKG_ROOT, 'dist', 'cli', 'gnomond.js');
const MIN = 60_000;
const cleanups: Array<() => void | Promise<void>> = [];
const kids: ChildProcess[] = [];
afterEach(async () => {
  for (const k of kids.splice(0)) {
    try {
      if (k.pid) process.kill(-k.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  while (cleanups.length) await cleanups.pop()!();
});

function home(): string {
  const t = tempHome('gs-');
  cleanups.push(t.cleanup);
  return t.home;
}

type Opts = Partial<Parameters<typeof startDaemon>[0]>;
async function daemon(h: string, opts: Opts = {}) {
  const d = await startDaemon({ home: h, idleMs: 60_000, ...opts });
  cleanups.push(() => d.shutdown('signal'));
  return d;
}

/** A scheduler clock 30 min behind the wall clock, advanced by hand. */
function lagClock() {
  const c = { now: Date.now() - 30 * MIN, fn: () => c.now };
  return c;
}

/** Rows of a stopped daemon's log (opened with a throwaway key, as `gnomon log` does). */
async function rowsOf(h: string, kinds?: string[]): Promise<Array<{ kind: string; payload: Record<string, unknown> }>> {
  const log = KernelLog.open({ home: h, kernelPrincipal: 'p:00000000/kernel', signer: SoftwareEd25519Signer.generate() });
  const out: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  for (const v of log.read({ reader: { class: 'human' }, ...(kinds ? { kinds } : {}) })) {
    if (v.view === 'full') out.push({ kind: v.event.kind, payload: (v.event.payload ?? {}) as Record<string, unknown> });
  }
  await log.close();
  return out;
}

function detached(code = 'setInterval(()=>{},1000)'): ChildProcess {
  const c = spawn(process.execPath, ['-e', code], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  kids.push(c);
  return c;
}

const ready = (c: ChildProcess): Promise<void> =>
  new Promise((r) => {
    let buf = '';
    c.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('ready')) r();
    });
  });

const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('G-SCH-01 timers rebuild from the kernel log after a restart', () => {
  it('fires a due instant once; a restarted daemon with the same record does not refire it', async () => {
    const h = home();
    const clock = lagClock();
    const a = { id: 'nightly', model: 'local', trigger: { at: new Date(clock.now + 5 * MIN).toISOString() } };
    const d1 = await daemon(h, { automations: [a], schedulerNow: clock.fn });
    expect(d1.scheduler.holdingIdle).toBe(true);
    clock.now += 6 * MIN;
    await d1.scheduler.tick();
    await d1.shutdown('signal');
    expect((await rowsOf(h, ['schedule.automation.due'])).map((r) => r.payload)).toEqual([
      expect.objectContaining({ id: 'nightly', key: 'automation:nightly', attended: true, late: false, model: 'local' }),
    ]);
    clock.now += MIN;
    const d2 = await daemon(h, { automations: [a], schedulerNow: clock.fn });
    expect(d2.scheduler.timers()[0]).toMatchObject({ key: 'automation:nightly', lastFiredAt: a.trigger.at });
    expect(d2.scheduler.holdingIdle).toBe(false);
    await d2.shutdown('signal');
    expect(await rowsOf(h, ['schedule.automation.due'])).toHaveLength(1);
  });

  it('an instant that fell due while down fires on activation, attended and late; attended:false is refused', async () => {
    const h = home();
    const past = new Date(Date.now() - MIN).toISOString();
    const d = await daemon(h, {
      automations: [
        { id: 'missed', model: 'any', trigger: { at: past } },
        { id: 'unattended', model: 'local', trigger: { at: past }, attended: false },
      ],
    });
    await d.shutdown('signal');
    const rows = await rowsOf(h, ['schedule.automation.due', 'schedule.dropped', 'session.refused']);
    expect(rows.map((r) => [r.kind, r.payload.key, r.payload.reason ?? r.payload.late])).toEqual([
      ['schedule.dropped', 'automation:unattended', 'unattended-unavailable'],
      ['schedule.automation.due', 'automation:missed', true],
    ]);
  });

  it('a fresh daemon with no automations writes no schedule row and grants no permit (G-LAW-05, real log)', async () => {
    const h = home();
    const d = await daemon(h);
    await d.shutdown('signal');
    const rows = await rowsOf(h);
    expect(rows.filter((r) => r.kind.startsWith('schedule.') || r.kind.startsWith('permit.') || r.kind === 'session.spawned')).toEqual([]);
  });
});

describe('§2.4 rule 3 idle exit with timers and children', () => {
  it('a timer due inside the horizon holds idle exit until it fires', async () => {
    const h = home();
    const clock = lagClock();
    const d = await daemon(h, { idleMs: 100, schedulerNow: clock.fn, automations: [{ id: 'soon', model: 'claude', trigger: { at: new Date(clock.now + 5 * MIN).toISOString() } }] });
    let exited = false;
    void d.exited.then(() => (exited = true));
    await sleep(400);
    expect(exited).toBe(false);
    clock.now += 6 * MIN;
    await d.scheduler.tick();
    expect(await d.exited).toBe('idle');
    const kinds = (await rowsOf(h)).map((r) => r.kind);
    expect(kinds.indexOf('schedule.automation.due')).toBeGreaterThan(-1);
    expect(kinds.indexOf('schedule.automation.due')).toBeLessThan(kinds.lastIndexOf('daemon.exit'));
  });

  it('idle exit stops a mod child (mod.stopped{reason:"idle"}) and awaits it BEFORE daemon.exit — never exits with a live child', async () => {
    const h = home();
    const d = await daemon(h, { idleMs: 150 });
    const mod = detached();
    await d.children.track({ kind: 'mod', child: mod, name: 'workshop' });
    expect(await d.exited).toBe('idle'); // a resident mod never holds the daemon open (A23-2)
    expect(groupAlive(mod.pid!)).toBe(false);
    const rows = await rowsOf(h);
    const kinds = rows.map((r) => r.kind);
    expect(rows.find((r) => r.kind === 'mod.stopped')?.payload).toEqual({ name: 'workshop', reason: 'idle' });
    expect(kinds.indexOf('mod.stopped')).toBeLessThan(kinds.lastIndexOf('daemon.exit'));
    expect(rows.filter((r) => r.kind === 'daemon.exit').at(-1)?.payload).toEqual({ reason: 'idle', liveChildren: 0 });
  });

  it('a live session holds idle exit; shutdown stops it and a SIGTERM-ignoring grandchild in its group, then daemon.exit with no live child', async () => {
    const h = home();
    const d = await daemon(h, { idleMs: 100, childGraceMs: 500 });
    const grand = "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)";
    const s = detached(
      `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:['ignore','pipe','ignore']});c.stdout.on('data',d=>{if(String(d).includes('ready'))console.log('ready')});setInterval(()=>{},1000)`,
    );
    await ready(s);
    const intent = await d.children.intend({ kind: 'session', hsid: 'h-live' });
    await d.children.track({ kind: 'session', child: s, hsid: 'h-live', intent });
    let exited = false;
    void d.exited.then(() => (exited = true));
    await sleep(400);
    expect(exited).toBe(false);
    await d.shutdown('signal');
    expect(groupAlive(s.pid!)).toBe(false); // leader AND grandchild gone
    const rows = await rowsOf(h);
    const kinds = rows.map((r) => r.kind);
    expect(rows.filter((r) => r.kind === 'session.spawned').map((r) => r.payload.phase)).toEqual(['intent', 'running']);
    expect(rows.find((r) => r.payload.phase === 'running')?.payload).toMatchObject({ hsid: 'h-live', pid: s.pid, pgid: s.pid, boot: readBootSession(), startTime: processControlFor().startTime(process.pid) === null ? null : expect.any(String) });
    expect(kinds.indexOf('session.exited')).toBeLessThan(kinds.lastIndexOf('daemon.exit'));
    expect(rows.filter((r) => r.kind === 'daemon.exit').at(-1)?.payload).toEqual({ reason: 'signal', liveChildren: 0 });
  });

  it('escalates to a real SIGKILL when a session ignores SIGTERM', async () => {
    const h = home();
    const d = await daemon(h, { childGraceMs: 300 });
    const s = detached("process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)");
    await ready(s);
    await d.children.track({ kind: 'local-runner', child: s, hsid: 'h-kill' });
    await d.shutdown('signal');
    expect(s.signalCode).toBe('SIGKILL');
  });

  it('track() refuses a session child that does not lead its own process group', async () => {
    const h = home();
    const d = await daemon(h);
    const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    kids.push(c);
    await expect(d.children.track({ kind: 'session', child: c, hsid: 'h-attached' })).rejects.toThrow(/detached/);
    c.kill('SIGKILL');
  });
});

describe('G-DMN-04 orphan sweep', () => {
  it('a restarted daemon stops a session group a crashed daemon left behind, recording session.orphaned first', async () => {
    const h = home();
    const d1 = await daemon(h);
    const orphan = detached();
    const dead = spawn(process.execPath, ['-e', '0'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => dead.once('exit', r));
    const boot = readBootSession();
    const st = processControlFor().startTime(orphan.pid!);
    expect(st).not.toBeNull();
    // what DaemonChildren writes at spawn; d1 then "crashes" without stopping either child
    const row = (hsid: string, pid: number, extra: Record<string, unknown> = {}) =>
      d1.log.append({ kind: 'session.spawned', principal: d1.kernelPrincipal, payload: { phase: 'running', spawnId: `sp-${hsid}`, hsid, kind: 'session', pid, pgid: pid, boot, startTime: st, ...extra } });
    await row('h-orphan', orphan.pid!);
    await row('h-dead', dead.pid!);
    await d1.shutdown('signal');
    expect(groupAlive(orphan.pid!)).toBe(true);

    const d2 = await daemon(h, { childGraceMs: 1_000 });
    expect(d2.orphanSweep).toEqual({ orphans: 2, stopped: 1 });
    expect(groupAlive(orphan.pid!)).toBe(false);
    await d2.shutdown('signal');
    const orphaned = (await rowsOf(h, ['session.orphaned'])).map((r) => r.payload);
    expect(orphaned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hsid: 'h-orphan', probe: 'alive', action: 'stop', fidelity: 'full' }),
        expect.objectContaining({ hsid: 'h-dead', probe: 'gone', action: 'none' }),
      ]),
    );
    const d3 = await daemon(h);
    expect(d3.orphanSweep).toEqual({ orphans: 0, stopped: 0 });
  });

  it('a live group recorded under a different boot id, or with another start time, is never signalled', async () => {
    const h = home();
    const d1 = await daemon(h);
    const a = detached();
    const b = detached();
    const boot = readBootSession();
    await d1.log.append({ kind: 'session.spawned', principal: d1.kernelPrincipal, payload: { phase: 'running', spawnId: 'sp-a', hsid: 'h-a', pid: a.pid, pgid: a.pid, boot: 'other-boot-id', startTime: processControlFor().startTime(a.pid!) } });
    await d1.log.append({ kind: 'session.spawned', principal: d1.kernelPrincipal, payload: { phase: 'running', spawnId: 'sp-b', hsid: 'h-b', pid: b.pid, pgid: b.pid, boot, startTime: 'lstart:Thu Jan  1 00:00:00 1970' } });
    await d1.shutdown('signal');
    const d2 = await daemon(h);
    expect(d2.orphanSweep).toEqual({ orphans: 2, stopped: 0 });
    expect(groupAlive(a.pid!)).toBe(true);
    expect(groupAlive(b.pid!)).toBe(true);
    await d2.shutdown('signal');
    const orphaned = (await rowsOf(h, ['session.orphaned'])).map((r) => [r.payload.hsid, r.payload.probe, r.payload.action]);
    expect(orphaned).toEqual(expect.arrayContaining([['h-a', 'stale-boot', 'none'], ['h-b', 'unattributable', 'none']]));
  });
});

describe('§2.4 rule 1: plain gnomond ignores GNOMON_HOME', () => {
  it('the detaching gnomond resolves ~/.gnomon from HOME, never the GNOMON_HOME seam', async () => {
    const t = tempHome('gh-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const fakeHome = realpathSync(t.home);
    const seamRoot = mkdtempSync(path.join(os.tmpdir(), 'gseam-'));
    cleanups.push(() => rmSync(seamRoot, { recursive: true, force: true }));
    const seam = path.join(seamRoot, 'h');
    const r = spawnSync(process.execPath, [GNOMOND, '--idle-ms', '300'], { encoding: 'utf8', timeout: 15_000, env: { ...process.env, HOME: fakeHome, GNOMON_HOME: seam } });
    expect(r.status).toBe(0);
    const expected = path.join(fakeHome, '.gnomon');
    expect(r.stdout).toContain(path.join(expected, 'gnomon.sock'));
    expect(existsSync(seam)).toBe(false);
    for (let i = 0; i < 50 && existsSync(pidPathOf(expected)); i++) await sleep(100); // it idles out
  });
});
