// @gnomon-platform: darwin, linux
/**
 * $daemon-lifecycle idle exit (spec §2.4 rule 3): with no holders the daemon
 * exits after idleMs (`daemon.exit{reason:'idle'}`), releasing pidfile and
 * socket; an open #socket connection holds it open until it closes.
 */
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdleMonitor, pidPathOf, startDaemon, type DaemonEvent } from '../src/kernel/lifecycle/index.js';
import { rawConnect, sleep, tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  while (cleanups.length) await cleanups.pop()!();
});

describe('IdleMonitor', () => {
  it('fires once after idleMs with no holders', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const m = new IdleMonitor({ idleMs: 100, onIdle });
    m.start();
    vi.advanceTimersByTime(99);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not fire while held, and restarts the full window on release', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const m = new IdleMonitor({ idleMs: 100, onIdle });
    m.start();
    vi.advanceTimersByTime(90);
    const a = m.hold('connection');
    const b = m.hold('session');
    expect(m.holders).toBe(2);
    expect(m.count('session')).toBe(1);
    vi.advanceTimersByTime(10_000);
    a();
    a(); // idempotent
    expect(m.holders).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(onIdle).not.toHaveBeenCalled();
    b();
    vi.advanceTimersByTime(99);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('never fires after stop() and rejects a bad idleMs', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const m = new IdleMonitor({ idleMs: 10, onIdle });
    m.start();
    m.stop();
    vi.advanceTimersByTime(100);
    expect(onIdle).not.toHaveBeenCalled();
    expect(() => new IdleMonitor({ idleMs: -1, onIdle })).toThrow(RangeError);
  });
});

describe('daemon idle exit', () => {
  async function daemon(idleMs: number) {
    const t = tempHome();
    cleanups.push(t.cleanup);
    const events: DaemonEvent[] = [];
    const d = await startDaemon({ home: t.home, idleMs, onEvent: (e) => events.push(e) });
    cleanups.push(() => d.shutdown('signal'));
    return { d, events, home: t.home };
  }

  it('exits on idle and releases pidfile and socket', async () => {
    const { d, events, home } = await daemon(150);
    expect(await d.exited).toBe('idle');
    expect(events.map((e) => e.kind)).toEqual(['daemon.start', 'daemon.exit']);
    expect(events[1]).toEqual({ kind: 'daemon.exit', reason: 'idle' });
    expect(existsSync(pidPathOf(home))).toBe(false);
    expect(existsSync(d.pidfile.socketPath)).toBe(false);
  });

  it('does not exit while a connection is open; exits after it closes', async () => {
    const { d, events } = await daemon(150);
    const c = await rawConnect(d.pidfile.socketPath);
    let exited = false;
    void d.exited.then(() => (exited = true));
    await sleep(500);
    expect(exited).toBe(false);
    expect(d.status().connections).toBe(1);
    const t0 = Date.now();
    await c.close();
    expect(await d.exited).toBe('idle');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(events.map((e) => e.kind)).toEqual(['daemon.start', 'socket.connect', 'socket.disconnect', 'daemon.exit']);
  });
});
