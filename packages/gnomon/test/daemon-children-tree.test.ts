// @gnomon-platform: darwin, linux
/**
 * $daemon-lifecycle — descendant sweep on stop over REAL processes
 * (T-2026-10-19-009 item 1, Orca audit "Adopt 1"). A fake session leader
 * (spawned detached, its own group, as #session-runner does) starts a tool
 * child that calls setsid (Node `detached: true`) and ignores SIGTERM — the
 * group kill cannot reach it. Stopping the session must still kill it, using
 * the real POSIX process table (`ps`, async) and start-time witness, and
 * record `session.exited{tree:'exited'}`. POSIX-only: Windows has no ps or
 * process groups (job objects are the parity phase, P8-D78).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonChildren, processControlFor } from '../src/kernel/lifecycle/index.js';

const leaders: ChildProcess[] = [];
const escaped: number[] = [];
afterEach(() => {
  for (const c of leaders.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  for (const pid of escaped.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
});

const GRANDCHILD = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
const LEADER = `const {spawn}=require('node:child_process');const g=spawn(process.execPath,['-e',${JSON.stringify(GRANDCHILD)}],{detached:true,stdio:'ignore'});g.unref();process.stdout.write(String(g.pid)+'\\n');setInterval(()=>{},1000)`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('descendant sweep (real processes, POSIX)', () => {
  it('a tool child that ran setsid and ignores SIGTERM does not survive the session stop; tree verdict exited', async () => {
    const control = processControlFor();
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const children = new DaemonChildren({ append: async (kind, payload) => void rows.push({ kind, payload }), control, boot: 'boot-T', graceMs: 500 });
    const leader = spawn(process.execPath, ['-e', LEADER], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    leaders.push(leader);
    const gpid = await new Promise<number>((resolve, reject) => {
      let buf = '';
      leader.stdout!.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        if (buf.includes('\n')) resolve(Number(buf.trim()));
      });
      leader.once('exit', () => reject(new Error('leader exited early')));
    });
    escaped.push(gpid);
    expect(isAlive(gpid)).toBe(true);
    expect(control.probeGroup(gpid)).toBe('alive'); // its own group: a group kill of the leader misses it
    await children.track({ kind: 'session', child: leader, hsid: 'h-setsid' });
    const survivors = await children.stop(leader, 'session.stop');
    expect(survivors).toBe(false);
    expect(isAlive(gpid)).toBe(false);
    expect(rows.find((r) => r.kind === 'session.exited')!.payload).toMatchObject({ hsid: 'h-setsid', reason: 'session.stop', tree: 'exited' });
  }, 20_000);

  it('the real snapshot lists this process with its ppid and an lstart witness', async () => {
    const control = processControlFor();
    const rows = await control.snapshot!();
    expect(rows).not.toBeNull();
    const me = rows!.find((r) => r.pid === process.pid)!;
    expect(me.ppid).toBe(process.ppid);
    expect(me.start.startsWith('lstart:')).toBe(true);
  });
});
