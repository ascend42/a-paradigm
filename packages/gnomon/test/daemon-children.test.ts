/**
 * $daemon-lifecycle (spec §2.4 rules 1, 3, 4; §16) — the platform-independent
 * pieces of M1.9: supervised children are stopped and awaited (falsifier:
 * daemon exits with a live child), the orphan sweep's record-before-signal
 * order and its fail-closed cases (G-DMN-04), the process-control registry's
 * Windows row, and the daemon's home coming from argv only. Real children are
 * plain `node -e` processes (no detach), stopped through the host's own row.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonHomeOf } from '../src/cli/daemon-cli.js';
import { DaemonChildren, PROCESS_CONTROL, processControlFor, sweepOrphans, type GroupProbe, type ProcessControl } from '../src/kernel/lifecycle/index.js';

const kids: ChildProcess[] = [];
afterEach(() => {
  for (const k of kids.splice(0)) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
});

function sleeper(ignoreTerm = false): ChildProcess {
  const code = ignoreTerm ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)" : 'setInterval(()=>{},1000)';
  const c = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
  kids.push(c);
  return c;
}

const alive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

describe('DaemonChildren: never exit with a live child', () => {
  it('stopAll stops and awaits every child; sessions log spawned/exited and hold idle, mods log mod.stopped', async () => {
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    let holds = 0;
    const children = new DaemonChildren({
      append: async (kind, payload) => void rows.push({ kind, payload }),
      control: processControlFor(),
      holdIdle: () => {
        holds++;
        return () => void holds--;
      },
    });
    const s = sleeper();
    const m = sleeper();
    await children.track({ kind: 'session', child: s, hsid: 'h-1' });
    await children.track({ kind: 'mod', child: m, name: 'workshop' });
    expect(children.live()).toBe(2);
    expect(holds).toBe(1); // the session holds idle; the mod never does
    expect(await children.stopAll('idle')).toBe(0);
    expect(alive(s)).toBe(false);
    expect(alive(m)).toBe(false);
    expect(holds).toBe(0);
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['session.spawned', 'session.exited', 'mod.stopped']));
    expect(rows.find((r) => r.kind === 'mod.stopped')!.payload).toEqual({ name: 'workshop', reason: 'idle' });
    expect(rows.find((r) => r.kind === 'session.exited')!.payload).toMatchObject({ hsid: 'h-1', pid: s.pid, reason: 'idle' });
    await expect(children.track({ kind: 'mod', child: sleeper(), name: 'late' })).rejects.toThrow(/stopping/);
  });

  it('escalates to SIGKILL after the grace when a child ignores SIGTERM', async () => {
    const children = new DaemonChildren({ append: async () => undefined, control: processControlFor(), graceMs: 300 });
    const c = sleeper(true);
    await new Promise((r) => setTimeout(r, 200)); // let it install the handler
    await children.track({ kind: 'local-runner', child: c, hsid: 'h-2' });
    expect(await children.stopAll('signal')).toBe(0);
    expect(alive(c)).toBe(false);
  });
});

describe('G-DMN-04 orphan sweep (fake process control)', () => {
  function fakeControl(probes: Record<number, GroupProbe>): ProcessControl & { signals: string[] } {
    const signals: string[] = [];
    return {
      fidelity: 'full',
      signals,
      probeGroup: (pgid) => probes[pgid] ?? 'gone',
      signalGroup: (pgid, sig) => {
        signals.push(`${pgid}:${sig}`);
        probes[pgid] = 'gone';
        return true;
      },
    };
  }

  it('records each open session.spawned BEFORE signalling, stops live groups, never signals gone / foreign / unsupported', async () => {
    const order: string[] = [];
    const control = fakeControl({ 101: 'alive', 102: 'gone', 103: 'foreign', 104: 'unsupported', 105: 'alive' });
    const origSignal = control.signalGroup;
    control.signalGroup = (pgid, sig) => (order.push(`signal:${pgid}`), origSignal(pgid, sig));
    const rows = [
      { kind: 'session.spawned', payload: { hsid: 'a', pid: 101, pgid: 101 } },
      { kind: 'session.spawned', payload: { hsid: 'b', pid: 102, pgid: 102 } },
      { kind: 'session.spawned', payload: { hsid: 'c', pid: 103, pgid: 103 } },
      { kind: 'session.spawned', payload: { hsid: 'd', pid: 104, pgid: 104 } },
      { kind: 'session.spawned', payload: { hsid: 'e', pid: 105, pgid: 105 } },
      { kind: 'session.exited', payload: { hsid: 'e', pid: 105 } }, // ended cleanly: not an orphan
      { kind: 'session.spawned', payload: { hsid: 'f', pid: 106, pgid: 106 } },
      { kind: 'session.orphaned', payload: { hsid: 'f', pid: 106 } }, // swept by an earlier start
    ];
    const out: Array<Record<string, unknown>> = [];
    const r = await sweepOrphans({ rows, control, append: async (kind, payload) => void (out.push({ kind, ...payload }), order.push(`row:${String(payload.pgid)}`)), pollMs: 1 });
    expect(r).toEqual({ orphans: 4, stopped: 1 });
    expect(out.map((o) => [o.hsid, o.probe, o.action])).toEqual([
      ['a', 'alive', 'stop'],
      ['b', 'gone', 'none'],
      ['c', 'foreign', 'none'],
      ['d', 'unsupported', 'none'],
    ]);
    expect(control.signals).toEqual(['101:SIGTERM']);
    expect(order.indexOf('row:101')).toBeLessThan(order.indexOf('signal:101'));
  });

  it('the win32 row is the parity phase: groups are unprobeable and never signalled (fail closed, partial)', () => {
    expect(PROCESS_CONTROL.win32.fidelity).toBe('partial');
    expect(PROCESS_CONTROL.win32.probeGroup(1234)).toBe('unsupported');
    expect(PROCESS_CONTROL.win32.signalGroup(1234, 'SIGKILL')).toBe(false);
    expect(processControlFor('aix')).toBe(PROCESS_CONTROL.win32);
    expect(PROCESS_CONTROL.darwin.probeGroup(1)).toBe('foreign'); // never init / ourselves
  });
});

describe('§2.4 rule 1: the daemon learns its home only from --home', () => {
  it('ignores GNOMON_HOME (a client-side test seam) and defaults to ~/.gnomon', () => {
    const before = process.env.GNOMON_HOME;
    process.env.GNOMON_HOME = path.resolve(path.sep, 'elsewhere');
    try {
      expect(daemonHomeOf({})).toBe(path.join(os.homedir(), '.gnomon'));
      const argv = path.resolve(path.sep, 'from', 'argv');
      expect(daemonHomeOf({ home: argv })).toBe(argv);
    } finally {
      if (before === undefined) delete process.env.GNOMON_HOME;
      else process.env.GNOMON_HOME = before;
    }
  });

  it.todo('G-WIN-02: %USERPROFILE%\\.gnomon gets an owner-only DACL via the signed helper (icacls fallback), inheritance removed, and the ACL read back equals the expected one (Windows parity phase, P8-D78; ensureGnomonHome refuses unsafe-home on win32 until then)');
  it.todo('G-DMN-03 (Windows): client activation over the named pipe (Windows parity phase, P8-D78)');
});
