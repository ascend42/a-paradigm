// @gnomon-platform: darwin
/**
 * S1.4 P5 review (Aegis 1(b) items 4 and 9), on this host with SIP answered by a test switch (the daemon runs in this
 * process, so the mock reaches the kernel's real default probe):
 * - with the CI seam ON, the session and mod floors pass and every other floor still refuses `floor:'sip'`:
 *   loop-act, loop-check, the darwin floor itself and the session-profile fidelity status reports;
 * - with NO seam, a mod floor refusal reaches the page as `sandbox-unavailable` (the kernel's ModRefusal SANDBOX),
 *   never a bare UNSUPPORTED.
 */
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDevHome } from '../src/cli/dev-home.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { isLifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { loopActLaunchPlan } from '../src/kernel/sandbox/loop-act.js';
import { loopCheckLaunchPlan } from '../src/kernel/sandbox/loop-check.js';
import { darwinFloor, sessionSandboxFidelity } from '../src/kernel/sandbox/session.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { dimId, installDimension } from './dimension-helpers.js';
import { guiPage } from './dim-gui-page.js';
import { sessionWorld, setMode, waitFor, type SessionWorld } from './session-helpers.js';

const SIP = vi.hoisted(() => ({ on: false }));
vi.mock('../src/platform/darwin/macos.js', async (orig) => ({ ...((await orig()) as Record<string, unknown>), darwinSipEnabled: () => SIP.on }));

const REAL_MACOS = darwinFloor(undefined, () => true).ok;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  SIP.on = false;
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
});
const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });
const press = (type = 'pointerup'): Event => ({ isTrusted: true, type }) as unknown as Event;
const floorOf = (f: () => unknown): unknown => {
  try {
    f();
    return 'passed';
  } catch (e) {
    return isLifecycleRefusal(e) ? (e.detail as { floor?: unknown }).floor : String(e);
  }
};

async function rig(w: SessionWorld, tag: string, stub: boolean): Promise<DevKernel> {
  const t = tempHome(tag);
  cleanups.push(() => removeTree(path.dirname(t.home)));
  const userHome = path.dirname(t.home);
  const devHome = path.join(userHome, 'devhome');
  expect(await runDevCommand(['init', '--home', devHome], quiet(), { userHome, host: 'mac-1' })).toBe(0);
  const dev = loadDevHome(devHome, { userHome });
  installDimension({ root: userHome, home: dev.home, auth: dev.root as never, events: [], cleanup: async () => undefined });
  setMode(w, {});
  const k = await startDevKernel(devHome, {
    userHome,
    start: (o) =>
      startDaemonForTest(o, {
        supervisor: { claudePath: w.claude, allowScripts: true, userHome: w.userHome, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }), ...(stub ? { sessionSipStub: true } : {}) },
        billing: { env: () => ({}), layers: () => [] },
      }),
  });
  cleanups.push(() => k.stop());
  return k;
}

describe.runIf(process.platform === 'darwin' && REAL_MACOS)('SIP off on this host (a test switch), the real kernel', () => {
  it('seam ON: a session opens and the dimension mod runs, both rows marked sipStubbed; loop-act, loop-check, the darwin floor and the fidelity status still refuse floor sip', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const k = await rig(w, 'sipA-', true);
    const P = await guiPage(k, cleanups);
    const s = await k.client.call<{ hsid: string }>('session.open', { cwd: w.cwd, attended: true });
    const a = P.sessions.open({ dim: dimId(7), hsid: s.hsid, opened: 'command', title: 'SIP stubbed' }, press('click'));
    expect(await a.opened(), JSON.stringify(a.lastNotice())).toBe(true);
    const rows = [...k.handle.log.read({ reader: { class: 'human' }, kinds: ['session.sandbox', 'mod.sandbox'] })].map((r) => (r as unknown as { event: { kind: string; payload: Record<string, unknown> } }).event);
    expect(rows.filter((e) => e.kind === 'mod.sandbox').map((e) => e.payload.sipStubbed)).toEqual([true]);
    expect(rows.filter((e) => e.kind === 'session.sandbox' && e.payload.profileHash).map((e) => e.payload.sipStubbed)).toEqual([true]);
    // every other floor reads the real (here: off) answer
    expect(floorOf(() => loopActLaunchPlan({} as never, 'darwin'))).toBe('sip');
    expect(floorOf(() => loopCheckLaunchPlan({} as never, 'darwin'))).toBe('sip');
    expect(darwinFloor()).toMatchObject({ ok: false, floor: 'sip' });
    expect(sessionSandboxFidelity('darwin')).toMatchObject({ fidelity: 'unavailable', reason: 'sip-disabled' });
    await k.client.call('session.stop', { hsid: s.hsid });
  }, 120_000);

  it('NO seam: the session opens while SIP answers on, then SIP goes off and the board\'s mod cannot start: the page is told sandbox-unavailable, never a bare UNSUPPORTED', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const k = await rig(w, 'sipB-', false);
    const P = await guiPage(k, cleanups);
    SIP.on = true;
    const s = await k.client.call<{ hsid: string }>('session.open', { cwd: w.cwd, attended: true });
    SIP.on = false;
    const a = P.sessions.open({ dim: dimId(8), hsid: s.hsid, opened: 'command', title: 'SIP off' }, press('click'));
    expect(await a.opened()).toBe(false);
    expect(await waitFor(() => a.lastNotice() !== null, 5_000)).toBe(true);
    expect(a.lastNotice()).toMatchObject({ code: 'sandbox-unavailable', why: 'SANDBOX' });
    expect(k.handle.mods.running()).not.toContain('gnomon.dimension');
    await k.client.call('session.stop', { hsid: s.hsid });
  }, 120_000);
});
