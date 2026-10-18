// @gnomon-platform: darwin, linux
/**
 * #scheduler + $daemon-lifecycle in the real daemon (spec §2.4, §3.5; M1.9):
 * G-SCH-01 over the real #kernel-log across a restart, the due-while-down
 * rule, the timer idle hold, idle exit stopping supervised children BEFORE
 * daemon.exit (falsifier: daemon exits with a live child), and the start-up
 * orphan sweep (G-DMN-04) against a real detached process group. POSIX: the
 * unix-socket endpoint and process groups (the Windows pipe and job object are
 * the parity phase, P8-D78).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { KernelLog, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { sleep, tempHome } from './daemon-helpers.js';

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

async function daemon(h: string, opts: Parameters<typeof startDaemon>[0] extends infer O ? Partial<O> : never = {}) {
  const d = await startDaemon({ home: h, idleMs: 60_000, ...opts });
  cleanups.push(() => d.shutdown('signal'));
  return d;
}

/** Rows of a stopped daemon's log (opened read-mostly with a throwaway key, as `gnomon log` does). */
async function rowsOf(h: string, kinds?: string[]): Promise<Array<{ kind: string; payload: Record<string, unknown> }>> {
  const log = KernelLog.open({ home: h, kernelPrincipal: 'p:00000000/kernel', signer: SoftwareEd25519Signer.generate() });
  const out: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  for (const v of log.read({ reader: { class: 'human' }, ...(kinds ? { kinds } : {}) })) {
    if (v.view === 'full') out.push({ kind: v.event.kind, payload: (v.event.payload ?? {}) as Record<string, unknown> });
  }
  await log.close();
  return out;
}

function detachedSleeper(): ChildProcess {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  kids.push(c);
  return c;
}

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
    const a = { id: 'nightly', model: 'local', trigger: { at: new Date(Date.now() + 300).toISOString() } };
    const d1 = await daemon(h, { automations: [a] });
    expect(d1.scheduler.holdingIdle).toBe(true);
    await sleep(700);
    await d1.shutdown('signal');
    expect((await rowsOf(h, ['schedule.automation.due'])).map((r) => r.payload)).toEqual([
      expect.objectContaining({ id: 'nightly', key: 'automation:nightly', attended: true, late: false, model: 'local' }),
    ]);
    const d2 = await daemon(h, { automations: [a] });
    expect(d2.scheduler.timers()[0]).toMatchObject({ key: 'automation:nightly', lastFiredAt: a.trigger.at });
    expect(d2.scheduler.holdingIdle).toBe(false);
    await d2.shutdown('signal');
    expect(await rowsOf(h, ['schedule.automation.due'])).toHaveLength(1);
  });

  it('an instant that fell due while down fires on activation, attended and late', async () => {
    const h = home();
    const past = new Date(Date.now() - 60_000).toISOString();
    const d = await daemon(h, { automations: [{ id: 'missed', model: 'any', trigger: { at: past }, attended: false, markedBy: 'p:ab12/founder' }] });
    await d.shutdown('signal');
    const rows = await rowsOf(h, ['schedule.automation.due', 'session.refused']);
    expect(rows.map((r) => [r.kind, r.payload.attended, r.payload.late])).toEqual([['schedule.automation.due', true, true]]);
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
    const t0 = Date.now();
    const d = await daemon(h, { idleMs: 100, automations: [{ id: 'soon', model: 'claude', trigger: { at: new Date(t0 + 700).toISOString() } }] });
    expect(await d.exited).toBe('idle');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
    const kinds = (await rowsOf(h)).map((r) => r.kind);
    expect(kinds.indexOf('schedule.automation.due')).toBeGreaterThan(-1);
    expect(kinds.indexOf('schedule.automation.due')).toBeLessThan(kinds.lastIndexOf('daemon.exit'));
  });

  it('idle exit stops a mod child (mod.stopped{reason:"idle"}) and awaits it BEFORE daemon.exit — never exits with a live child', async () => {
    const h = home();
    const d = await daemon(h, { idleMs: 150 });
    const mod = detachedSleeper();
    await d.children.track({ kind: 'mod', child: mod, name: 'workshop' });
    expect(await d.exited).toBe('idle'); // a resident mod never holds the daemon open (A23-2)
    expect(groupAlive(mod.pid!)).toBe(false);
    const rows = await rowsOf(h);
    const kinds = rows.map((r) => r.kind);
    expect(rows.find((r) => r.kind === 'mod.stopped')?.payload).toEqual({ name: 'workshop', reason: 'idle' });
    expect(kinds.indexOf('mod.stopped')).toBeLessThan(kinds.lastIndexOf('daemon.exit'));
    expect(rows.filter((r) => r.kind === 'daemon.exit').at(-1)?.payload).toEqual({ reason: 'idle', liveChildren: 0 });
  });

  it('a live session holds idle exit; shutdown stops it, logs session.exited, then daemon.exit with no live child', async () => {
    const h = home();
    const d = await daemon(h, { idleMs: 100 });
    const s = detachedSleeper();
    await d.children.track({ kind: 'session', child: s, hsid: 'h-live' });
    let exited = false;
    void d.exited.then(() => (exited = true));
    await sleep(400);
    expect(exited).toBe(false);
    await d.shutdown('signal');
    expect(groupAlive(s.pid!)).toBe(false);
    const rows = await rowsOf(h);
    const kinds = rows.map((r) => r.kind);
    expect(rows.find((r) => r.kind === 'session.spawned')?.payload).toMatchObject({ hsid: 'h-live', pid: s.pid, pgid: s.pid });
    expect(kinds.indexOf('session.exited')).toBeGreaterThan(-1);
    expect(kinds.indexOf('session.exited')).toBeLessThan(kinds.lastIndexOf('daemon.exit'));
    expect(rows.filter((r) => r.kind === 'daemon.exit').at(-1)?.payload).toEqual({ reason: 'signal', liveChildren: 0 });
  });
});

describe('G-DMN-04 orphan sweep', () => {
  it('a restarted daemon stops a session group a crashed daemon left behind, recording session.orphaned first', async () => {
    const h = home();
    const d1 = await daemon(h);
    const orphan = detachedSleeper();
    const dead = spawn(process.execPath, ['-e', '0'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => dead.once('exit', r));
    // what #session-runner writes at spawn; d1 then "crashes" without tracking either child
    await d1.log.append({ kind: 'session.spawned', principal: d1.kernelPrincipal, payload: { hsid: 'h-orphan', kind: 'session', pid: orphan.pid, pgid: orphan.pid } });
    await d1.log.append({ kind: 'session.spawned', principal: d1.kernelPrincipal, payload: { hsid: 'h-dead', kind: 'session', pid: dead.pid, pgid: dead.pid } });
    await d1.shutdown('signal');
    expect(groupAlive(orphan.pid!)).toBe(true);

    const d2 = await daemon(h, { childGraceMs: 1_000 });
    expect(d2.orphanSweep).toEqual({ orphans: 2, stopped: 1 });
    expect(groupAlive(orphan.pid!)).toBe(false);
    await d2.shutdown('signal');
    const orphaned = (await rowsOf(h, ['session.orphaned'])).map((r) => r.payload);
    expect(orphaned).toEqual([
      expect.objectContaining({ hsid: 'h-orphan', probe: 'alive', action: 'stop', fidelity: 'full' }),
      expect.objectContaining({ hsid: 'h-dead', probe: 'gone', action: 'none' }),
    ]);
    // a third start finds nothing left to sweep
    const d3 = await daemon(h);
    expect(d3.orphanSweep).toEqual({ orphans: 0, stopped: 0 });
  });
});
