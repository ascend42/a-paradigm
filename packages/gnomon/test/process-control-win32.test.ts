// @gnomon-platform: win32
/**
 * W3 (PR #52 release blocker): the win32 process-control row. The "group" is a launcher pid whose KILL_ON_JOB_CLOSE job
 * holds the whole tree (gnomon-helper exec / sandbox), so stopping the launcher stops a grandchild too; witnesses are
 * helper creation times, stable per process and present in the snapshot; a recycled parent link is never followed.
 * Sibling of the POSIX rows in test/daemon-children.test.ts.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { descendantsOf } from '../src/kernel/lifecycle/children.js';
import { PROCESS_CONTROL } from '../src/kernel/lifecycle/process-control.js';
import { helperOpSync, jobLaunch, pinWin32Helper } from '../src/platform/win32/helper-client.js';
import { PKG_ROOT } from './helpers.js';

const HELPER = path.resolve(PKG_ROOT, '..', 'gnomon-helper', 'bin', 'win32', 'gnomon-helper.exe');
const built = fs.existsSync(HELPER);
if (!built && process.env.CI) throw new Error(`the win32 helper is not built at ${HELPER}`);
const w = PROCESS_CONTROL.win32;

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const until = async (f: () => boolean, ms = 10_000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (f()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return f();
};

(built ? describe : describe.skip)('win32 process control (W3)', () => {
  it('witnesses, probe, and a launcher stop that takes its whole job tree', async () => {
    const { command, args } = jobLaunch(pinWin32Helper(HELPER), process.execPath, [
      '-e',
      "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000);",
    ]);
    const launcher = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    cleanups.push(() => launcher.kill());
    const grand = await new Promise<number>((res) => launcher.stdout!.once('data', (b: Buffer) => res(Number(String(b).trim()))));

    const lw = w.startTime(launcher.pid!);
    expect(lw).toMatch(/^ft:\d+$/);
    expect(w.startTime(launcher.pid!)).toBe(lw); // stable per process
    expect(w.probeGroup(launcher.pid!, lw!)).toBe('alive');
    expect(w.probeGroup(launcher.pid!)).toBe('unsupported'); // Aegis L1: a pid alone names nothing on Windows
    const gw = w.startTime(grand);

    const snap = (await w.snapshot!())!;
    expect(snap.find((r) => r.pid === launcher.pid)?.start).toBe(lw);
    // the node under the launcher and its grandchild are both descendants of the launcher (ppid walk)
    expect(descendantsOf(snap, launcher.pid!).map((r) => r.pid)).toContain(grand);

    // Aegis M2: no SIGTERM on Windows (the graceful step is the caller's stdin close); M1: a witness that no longer
    // matches is never terminated (the helper checks the creation time on the handle it terminates through)
    expect(w.gracefulStop).toBe('stdin');
    expect(w.signalGroup(launcher.pid!, 'SIGTERM')).toBe(false);
    const stale = helperOpSync(pinWin32Helper(HELPER), 'process.terminate', { pid: launcher.pid!, start: 'ft:1' });
    expect(stale.terminated).toBe(false);
    expect(w.probeGroup(launcher.pid!, lw!)).toBe('alive');
    expect(w.probeGroup(launcher.pid!, 'ft:1')).toBe('gone'); // a different witness: not our process
    expect(w.signalGroup(launcher.pid!, 'SIGKILL')).toBe(false); // never without the caller's witness
    expect(w.signalGroup(launcher.pid!, 'SIGKILL', 'ft:1')).toBe(false);
    expect(w.signalGroup(launcher.pid!, 'SIGKILL', lw!)).toBe(true);
    expect(await until(() => w.probeGroup(launcher.pid!, lw!) === 'gone')).toBe(true);
    // the job closed with the launcher: the grandchild is gone too
    expect(await until(() => w.probeGroup(grand, gw!) === 'gone')).toBe(true);
    expect(w.startTime(grand)).toBeNull();
  });
});
