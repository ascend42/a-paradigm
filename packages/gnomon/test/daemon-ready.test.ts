// @gnomon-platform: darwin, linux
/**
 * $daemon-lifecycle (spec §2.4 rule 2) — the readiness handshake over real
 * gnomond processes (T-2026-10-19-009 item 3, Orca audit Adopt 3).
 *
 * The activator learns readiness from the kernel's `gnomonReady:v1` line on an
 * inherited pipe, never by polling; a kernel that dies first is reported with
 * its stderr tail and a classified exit code; two activators racing for one
 * home end with one `ready` and one `attached`, neither an error. Unix
 * sockets only (the Windows named pipe is the parity phase, P8-D78); the
 * exit-code table and the stderr tail run everywhere in
 * test/daemon-exit-codes.test.ts.
 */
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canConnectSocket,
  DAEMON_EXIT,
  DAEMON_READY_SCHEMA,
  launchDaemon,
  pidAlive,
  pidPathOf,
  readPidfile,
  selectSocketPath,
  type LaunchOutcome,
} from '../src/kernel/lifecycle/index.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';

const GNOMOND = path.join(PKG_ROOT, 'dist', 'cli', 'gnomond.js');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function home(): string {
  const t = tempHome();
  cleanups.push(t.cleanup);
  return t.home;
}

function sockOf(h: string): string {
  const c = selectSocketPath({ home: h });
  if (!c.ok) throw new Error('no socket path');
  return c.path;
}

/** Stop the kernel that holds `h` and wait for its lock to go. */
function reap(h: string): void {
  cleanups.push(async () => {
    const pf = readPidfile(h);
    if (!pf) return;
    try {
      process.kill(pf.pid, 'SIGTERM');
    } catch {
      return;
    }
    for (let i = 0; i < 100 && pidAlive(pf.pid); i++) await sleep(50);
  });
}

function launch(h: string, extra: Partial<Parameters<typeof launchDaemon>[0]> = {}): Promise<LaunchOutcome> {
  return launchDaemon({ execPath: process.execPath, entry: GNOMOND, home: h, socketPath: sockOf(h), idleMs: 60_000, ...extra });
}

describe('§2.4 rule 2: readiness handshake (Orca Adopt 3)', () => {
  it('the activator gets ready{identity} on the inherited pipe, and the identity is the lock holder', async () => {
    const h = home();
    reap(h);
    const o = await launch(h);
    expect(o.kind).toBe('ready');
    if (o.kind !== 'ready') return;
    expect(o.identity.schemaVersion).toBe(DAEMON_READY_SCHEMA);
    const pf = readPidfile(h)!;
    expect(o.identity.pid).toBe(pf.pid);
    expect(o.identity.startedAt).toBe(pf.startedAt);
    expect(o.identity.socketPath).toBe(pf.socketPath);
    expect(o.identity.kernelPrincipal.length).toBeGreaterThan(0);
    expect(await canConnectSocket(o.identity.socketPath)).toBe(true);
    // the kernel outlives the activator's closed pipes (EPIPE is not a crash)
    await sleep(300);
    expect(pidAlive(pf.pid)).toBe(true);
    expect(await canConnectSocket(o.identity.socketPath)).toBe(true);
  });

  it('FALSIFIER: two activators racing for one home end ready + attached, neither an error, one kernel', async () => {
    const h = home();
    reap(h);
    const [a, b] = await Promise.all([launch(h), launch(h)]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['attached', 'ready']);
    const loser = a.kind === 'attached' ? a : b;
    const winner = a.kind === 'ready' ? a : b;
    if (loser.kind !== 'attached' || winner.kind !== 'ready') return;
    expect(loser.socketPath).toBe(winner.identity.socketPath);
    expect(readPidfile(h)!.pid).toBe(winner.identity.pid);
  });

  it('FALSIFIER: a config fault before ready is reported with its stderr tail and exit 78, not polled into a timeout', async () => {
    const real = home();
    mkdirSync(real, { recursive: true, mode: 0o700 });
    const link = `${real}-link`;
    symlinkSync(real, link);
    cleanups.push(() => rmSync(link, { force: true }));
    const t0 = Date.now();
    const o = await launch(link, { timeoutMs: 15_000 });
    expect(o.kind).toBe('exited');
    if (o.kind !== 'exited') return;
    expect(o.code).toBe(DAEMON_EXIT.config);
    expect(o.class).toBe('config');
    expect(o.stderrTail).toContain('[unsafe-home]');
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(readPidfile(real)).toBeNull();
    expect(pidPathOf(real)).toBeTruthy();
  });
});
