/**
 * $daemon-lifecycle (spec §2.4 rules 1, 3, 4; §16) — the platform-independent
 * pieces of M1.9: supervised children are stopped and awaited (falsifier:
 * daemon exits with a live child) with SIGKILL escalation and group-survivor
 * kill, spawn intent rows, the orphan sweep's attribution rules (boot session
 * + start-time witness + kernel principal; record-before-signal; G-DMN-04),
 * the process-control registry's Windows row, and the daemon's home coming
 * from argv only. Process control is faked here; the real POSIX groups are
 * exercised in test/scheduler-daemon.test.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonHomeOf } from '../src/cli/daemon-cli.js';
import { DaemonChildren, descendantsOf, parsePsTable, PROCESS_CONTROL, processControlFor, sweepOrphans, type GroupProbe, type ProcessControl, type ProcRow } from '../src/kernel/lifecycle/index.js';

const K = 'p:ab12/kernel';
const UNPROV = 'p:00000000/kernel';
const BOOT = 'boot-A';
const kids: ChildProcess[] = [];
afterEach(() => {
  for (const k of kids.splice(0)) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
});

function sleeper(): ChildProcess {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  kids.push(c);
  return c;
}

const alive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

/**
 * Fake group control over real children: a group is alive while its leader
 * (or a registered extra member) lives. SIGTERM is IGNORED (records only) when
 * `ignoreTerm`; SIGKILL kills the leader and every member.
 */
function childControl(opts: { ignoreTerm?: boolean; members?: Map<number, { alive: boolean }> } = {}): ProcessControl & { signals: string[]; register(c: ChildProcess): void } {
  const byPid = new Map<number, ChildProcess>();
  const signals: string[] = [];
  const members = opts.members ?? new Map<number, { alive: boolean }>();
  return {
    fidelity: 'full',
    signals,
    register: (c) => void byPid.set(c.pid!, c),
    probeGroup: (pgid) => {
      const c = byPid.get(pgid);
      return (c && alive(c)) || members.get(pgid)?.alive ? 'alive' : 'gone';
    },
    signalGroup: (pgid, sig) => {
      signals.push(`${pgid}:${sig}`);
      const c = byPid.get(pgid);
      if (sig === 'SIGKILL') {
        c?.kill('SIGKILL');
        const m = members.get(pgid);
        if (m) m.alive = false;
      } else if (!opts.ignoreTerm) c?.kill('SIGTERM');
      return true;
    },
    startTime: (pid) => `t:${pid}`,
  };
}

describe('DaemonChildren: never exit with a live child', () => {
  it('stopAll stops and awaits every child; sessions write intent/running/exited rows and hold idle, mods log mod.stopped', async () => {
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    let holds = 0;
    const control = childControl();
    const children = new DaemonChildren({
      append: async (kind, payload) => void rows.push({ kind, payload }),
      control,
      boot: BOOT,
      holdIdle: () => {
        holds++;
        return () => void holds--;
      },
    });
    const intent = await children.intend({ kind: 'session', hsid: 'h-1' });
    expect(rows[0]).toEqual({ kind: 'session.spawned', payload: { phase: 'intent', spawnId: intent.spawnId, hsid: 'h-1', kind: 'session', boot: BOOT } });
    const s = sleeper();
    const m = sleeper();
    control.register(s);
    control.register(m);
    await children.track({ kind: 'session', child: s, hsid: 'h-1', intent });
    await children.track({ kind: 'mod', child: m, name: 'workshop' });
    expect(rows[1]!.payload).toEqual({ phase: 'running', spawnId: intent.spawnId, hsid: 'h-1', kind: 'session', pid: s.pid, pgid: s.pid, boot: BOOT, startTime: `t:${s.pid}` });
    expect(children.live()).toBe(2);
    expect(holds).toBe(1); // the session holds idle; the mod never does
    expect(await children.stopAll('idle')).toBe(0);
    expect(alive(s)).toBe(false);
    expect(alive(m)).toBe(false);
    expect(holds).toBe(0);
    expect(rows.find((r) => r.kind === 'mod.stopped')!.payload).toEqual({ name: 'workshop', reason: 'idle' });
    expect(rows.find((r) => r.kind === 'session.exited')!.payload).toMatchObject({ spawnId: intent.spawnId, hsid: 'h-1', pid: s.pid, reason: 'idle' });
    await expect(children.track({ kind: 'mod', child: sleeper(), name: 'late' })).rejects.toThrow(/stopping/);
    await expect(children.intend({ kind: 'session' })).rejects.toThrow(/stopping/);
  });

  it('escalates SIGTERM → SIGKILL after the grace when the group ignores SIGTERM', async () => {
    const control = childControl({ ignoreTerm: true });
    const children = new DaemonChildren({ append: async () => undefined, control, boot: BOOT, graceMs: 200 });
    const c = sleeper();
    control.register(c);
    await children.track({ kind: 'local-runner', child: c, hsid: 'h-2' });
    expect(await children.stopAll('signal')).toBe(0);
    expect(alive(c)).toBe(false);
    expect(control.signals).toEqual([`${c.pid}:SIGTERM`, `${c.pid}:SIGKILL`]);
  });

  it('kills group members that outlive the leader and counts a member that will not die as a live child', async () => {
    const members = new Map<number, { alive: boolean }>();
    const control = childControl({ members });
    const children = new DaemonChildren({ append: async () => undefined, control, boot: BOOT, graceMs: 200 });
    const c = sleeper();
    control.register(c);
    members.set(c.pid!, { alive: true }); // a grandchild in the leader's group
    await children.track({ kind: 'session', child: c, hsid: 'h-3' });
    expect(await children.stopAll('idle')).toBe(0);
    expect(members.get(c.pid!)!.alive).toBe(false);
    expect(control.signals).toEqual([`${c.pid}:SIGTERM`, `${c.pid}:SIGKILL`]);

    // a member SIGKILL cannot remove (stuck): reported, never hidden
    const stuck = childControl();
    const d2 = new DaemonChildren({ append: async () => undefined, control: { ...stuck, probeGroup: (g) => (g === c2.pid ? 'alive' : 'gone') }, boot: BOOT, graceMs: 100 });
    const c2 = sleeper();
    stuck.register(c2);
    await d2.track({ kind: 'mod', child: c2, name: 'm' });
    expect(await d2.stopAll('signal')).toBe(1);
  });
});

describe('G-DMN-04 orphan sweep (fake process control)', () => {
  function fakeControl(probes: Record<number, GroupProbe>, starts: Record<number, string> = {}): ProcessControl & { signals: string[] } {
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
      startTime: (pid) => starts[pid] ?? null,
    };
  }
  const spawned = (hsid: string, pid: number, extra: Record<string, unknown> = {}, principal = K) => ({
    kind: 'session.spawned',
    principal,
    payload: { phase: 'running', spawnId: `sp-${hsid}`, hsid, pid, pgid: pid, boot: BOOT, startTime: `t:${pid}`, ...extra },
  });

  it('signals only a group whose boot and start-time witness both match; records first; ignores non-kernel rows', async () => {
    const order: string[] = [];
    const control = fakeControl(
      { 101: 'alive', 102: 'gone', 103: 'foreign', 104: 'unsupported', 105: 'alive', 107: 'alive', 108: 'alive', 109: 'alive' },
      { 101: 't:101', 107: 't:107', 108: 't:RECYCLED', 109: 't:109' },
    );
    const origSignal = control.signalGroup;
    control.signalGroup = (pgid, sig) => (order.push(`signal:${pgid}`), origSignal(pgid, sig));
    const rows = [
      spawned('a', 101),
      spawned('b', 102),
      spawned('c', 103),
      spawned('d', 104),
      spawned('e', 105),
      { kind: 'session.exited', principal: K, payload: { spawnId: 'sp-e', hsid: 'e', pid: 105 } }, // ended cleanly
      spawned('f', 106),
      { kind: 'session.orphaned', principal: K, payload: { spawnId: 'sp-f', hsid: 'f', pid: 106 } }, // swept before
      spawned('g', 107, { boot: 'boot-OTHER' }), // live group, but from another boot: a recycled pid
      spawned('h', 108), // live, same boot, start time differs: recycled pid
      spawned('i', 109, {}, 'p:ab12/mod-evil'), // not the kernel's row: ignored entirely
      { kind: 'session.spawned', principal: K, payload: { phase: 'intent', spawnId: 'sp-j', hsid: 'j', boot: BOOT } }, // crash in the spawn gap
    ];
    const out: Array<Record<string, unknown>> = [];
    const r = await sweepOrphans({ rows, kernelPrincipals: [UNPROV, K], boot: BOOT, control, append: async (kind, payload) => void (out.push({ kind, ...payload }), order.push(`row:${String(payload.pgid)}`)), pollMs: 1 });
    expect(r).toEqual({ orphans: 7, stopped: 1 });
    expect(out.map((o) => [o.hsid, o.probe, o.action, o.detail])).toEqual([
      ['a', 'alive', 'stop', undefined],
      ['b', 'gone', 'none', undefined],
      ['c', 'foreign', 'none', undefined],
      ['d', 'unsupported', 'none', undefined],
      ['g', 'stale-boot', 'none', undefined],
      ['h', 'unattributable', 'none', 'start-time'],
      ['j', 'unattributable', 'none', 'spawn-gap'],
    ]);
    expect(control.signals).toEqual(['101:SIGTERM']);
    expect(order.indexOf('row:101')).toBeLessThan(order.indexOf('signal:101'));
  });

  it('principal continuity: spawn rows from before root provisioning (p:00000000/kernel) are still swept (M1.3)', async () => {
    const control = fakeControl({ 401: 'alive' }, { 401: 't:401' });
    const r = await sweepOrphans({ rows: [spawned('pre', 401, {}, UNPROV)], kernelPrincipals: [UNPROV, K], boot: BOOT, control, append: async () => undefined, pollMs: 1 });
    expect(r).toEqual({ orphans: 1, stopped: 1 });
  });

  it('Aegis M-B: onOrphaned runs once per orphan, after its session.orphaned row and any stop (stopped or not)', async () => {
    const control = fakeControl({ 501: 'alive', 502: 'gone' }, { 501: 't:501', 502: 't:502' });
    const order: string[] = [];
    const r = await sweepOrphans({
      rows: [spawned('m1', 501), spawned('m2', 502)], kernelPrincipals: [UNPROV, K], boot: BOOT, control, pollMs: 1,
      append: async (_k, payload) => void order.push(`row:${String(payload.hsid)}`),
      onOrphaned: async (hsid) => {
        order.push(`clean:${String(hsid)}`);
        if (hsid === 'm2') throw new Error('cleanup failure is swallowed');
      },
    });
    expect(r).toEqual({ orphans: 2, stopped: 1 });
    expect(order.filter((o) => o.startsWith('clean:')).sort()).toEqual(['clean:m1', 'clean:m2']);
    expect(order.indexOf('row:m1')).toBeLessThan(order.indexOf('clean:m1'));
    expect(order.indexOf('row:m2')).toBeLessThan(order.indexOf('clean:m2'));
  });

  it('an unknown boot session never signals', async () => {
    const control = fakeControl({ 201: 'alive' }, { 201: 't:201' });
    const r = await sweepOrphans({ rows: [spawned('k', 201, { boot: 'unknown' })], kernelPrincipals: [UNPROV, K], boot: 'unknown', control, append: async () => undefined });
    expect(r).toEqual({ orphans: 1, stopped: 0 });
    expect(control.signals).toEqual([]);
  });

  it('counts an orphan as stopped only when its group is gone', async () => {
    const control = fakeControl({ 301: 'alive' }, { 301: 't:301' });
    control.signalGroup = (pgid, sig) => (control.signals.push(`${pgid}:${sig}`), true); // the group will not die
    const r = await sweepOrphans({ rows: [spawned('z', 301)], kernelPrincipals: [UNPROV, K], boot: BOOT, control, append: async () => undefined, graceMs: 50, pollMs: 5 });
    expect(r).toEqual({ orphans: 1, stopped: 0 });
    expect(control.signals).toEqual(['301:SIGTERM', '301:SIGKILL']);
  });

  it('the win32 row is the parity phase: groups are unprobeable and never signalled (fail closed, partial)', () => {
    expect(PROCESS_CONTROL.win32.fidelity).toBe('partial');
    expect(PROCESS_CONTROL.win32.probeGroup(1234)).toBe('unsupported');
    expect(PROCESS_CONTROL.win32.signalGroup(1234, 'SIGKILL')).toBe(false);
    expect(PROCESS_CONTROL.win32.startTime(1234)).toBeNull();
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
  it.todo('G-DMN-05 (Windows): the clean re-exec env keeps the §16 Windows allowlist (USERPROFILE SYSTEMROOT …) and nothing else (Windows parity phase, P8-D78)');
});

describe('descendant sweep on stop (T-2026-10-19-009 item 1): tree verdict exited | alive | unverifiable', () => {
  type TreeCtl = ReturnType<typeof childControl> & { pidSignals: string[] };
  /** childControl plus a scripted process table: `table()` is consulted at every snapshot. */
  function treeControl(table: () => ProcRow[] | null, onSignal?: (pid: number, sig: string) => void): TreeCtl {
    const pidSignals: string[] = [];
    return Object.assign(childControl(), {
      pidSignals,
      snapshot: async () => table(),
      signalPid: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
        pidSignals.push(`${pid}:${sig}`);
        onSignal?.(pid, sig);
        return true;
      },
    });
  }
  let leader = 0;
  const ESCAPED = 2_000_000_001; // a fake pid outside the leader's group (setsid)
  async function stopOne(control: ReturnType<typeof childControl>): Promise<{ survivors: number; tree: unknown }> {
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const children = new DaemonChildren({ append: async (kind, payload) => void rows.push({ kind, payload }), control, boot: BOOT, graceMs: 150 });
    const s = sleeper();
    control.register(s);
    leader = s.pid!;
    await children.track({ kind: 'session', child: s, hsid: 'h-tree' });
    const survivors = await children.stopAll('stop');
    return { survivors, tree: rows.find((r) => r.kind === 'session.exited')?.payload.tree };
  }
  const L = (): ProcRow => ({ pid: leader, ppid: process.pid, pgid: leader, start: 'L' });

  it('an escaped (setsid) descendant gets SIGTERM, then SIGKILL while its witness matches; verdict exited once gone', async () => {
    let killed = false;
    const control = treeControl(
      () => [L(), ...(killed ? [] : [{ pid: ESCAPED, ppid: leader, pgid: ESCAPED, start: 'A' }])],
      (_pid, sig) => void (sig === 'SIGKILL' && (killed = true)),
    );
    const r = await stopOne(control);
    expect(control.pidSignals).toEqual([`${ESCAPED}:SIGTERM`, `${ESCAPED}:SIGKILL`]);
    expect(r).toEqual({ survivors: 0, tree: 'exited' });
  });

  it('stopAll takes ONE process-table snapshot for all its children, before any of them is signalled', async () => {
    let snaps = 0;
    let signalledAt = -1;
    const control = treeControl(() => (snaps++, []));
    const signalGroup = control.signalGroup.bind(control);
    control.signalGroup = (pgid, sig) => (signalledAt < 0 && (signalledAt = snaps), signalGroup(pgid, sig));
    const children = new DaemonChildren({ append: async () => undefined, control, boot: BOOT, graceMs: 150 });
    for (const hsid of ['h-a', 'h-b', 'h-c']) {
      const s = sleeper();
      control.register(s);
      await children.track({ kind: 'session', child: s, hsid });
    }
    expect(await children.stopAll('stop')).toBe(0);
    expect(snaps).toBe(1); // was one `ps` per child
    expect(signalledAt).toBe(1);
  });

  it('a pid reused with a different start time is never SIGKILLed', async () => {
    let calls = 0;
    const control = treeControl(() => {
      calls++;
      // first snapshot: our descendant started at A; afterwards the pid is a stranger started at B
      return [L(), { pid: ESCAPED, ppid: calls === 1 ? leader : 1, pgid: ESCAPED, start: calls === 1 ? 'A' : 'B' }];
    });
    const r = await stopOne(control);
    expect(control.pidSignals.filter((s) => s.endsWith('SIGKILL'))).toEqual([]);
    expect(r.tree).toBe('exited');
  });

  it('a descendant that will not die is reported alive and counted as a survivor', async () => {
    const control = treeControl(() => [L(), { pid: ESCAPED, ppid: leader, pgid: ESCAPED, start: 'A' }]);
    expect(await stopOne(control)).toEqual({ survivors: 1, tree: 'alive' });
  });

  it('no snapshot (ps unavailable), a failed re-check and a control without snapshot are unverifiable, never exited', async () => {
    expect((await stopOne(treeControl(() => null))).tree).toBe('unverifiable');
    let n = 0;
    const flaky = treeControl(() => (++n === 1 ? [L(), { pid: ESCAPED, ppid: leader, pgid: ESCAPED, start: 'A' }] : null));
    expect((await stopOne(flaky)).tree).toBe('unverifiable');
    expect((await stopOne(childControl())).tree).toBe('unverifiable'); // the Windows parity row has no snapshot
  });

  it('a leader already gone at snapshot time with no group member left is unverifiable (leader-gone-before-stop), never exited', async () => {
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const control = treeControl(() => []); // the leader is not in the table: its descendants were reparented to init
    const children = new DaemonChildren({ append: async (kind, payload) => void rows.push({ kind, payload }), control, boot: BOOT, graceMs: 150 });
    const s = sleeper();
    control.register(s);
    await children.track({ kind: 'session', child: s, hsid: 'h-gone' });
    await children.stopAll('stop');
    expect(rows.find((r) => r.kind === 'session.exited')?.payload).toMatchObject({ tree: 'unverifiable', treeDetail: 'leader-gone-before-stop' });
    // a leader that is present keeps the plain verdict and no detail
    const live = await stopOne(treeControl(() => [L()]));
    expect(live.tree).toBe('exited');
  });

  it('descendantsOf walks ppid and adds group members, never the root or init; parsePsTable reads lstart rows', () => {
    const rows: ProcRow[] = [
      { pid: 10, ppid: 1, pgid: 10, start: 'r' },
      { pid: 11, ppid: 10, pgid: 10, start: 'a' },
      { pid: 12, ppid: 11, pgid: 12, start: 'b' },
      { pid: 13, ppid: 1, pgid: 10, start: 'c' },
      { pid: 14, ppid: 1, pgid: 14, start: 'd' },
    ];
    expect(descendantsOf(rows, 10).map((r) => r.pid).sort()).toEqual([11, 12, 13]);
    expect(parsePsTable('  10     1    10 Mon Oct 19 10:00:00 2026\njunk\n')).toEqual([{ pid: 10, ppid: 1, pgid: 10, start: 'lstart:Mon Oct 19 10:00:00 2026' }]);
  });
});
