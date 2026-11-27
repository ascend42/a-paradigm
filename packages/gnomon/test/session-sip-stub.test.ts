// @gnomon-platform: darwin
/**
 * S1.4 P5 C0 (Aegis ruling 1(a)): the test-only `sessionSipStub` seam that lets the CI e2e job (`gnomon-e2e-sip-stubbed`)
 * run the real-kernel e2e on GitHub's SIP-off macOS runners. What it must never weaken:
 * - it answers ONLY the session floor's `sip` probe: the macOS-major floor, the `sandbox-exec` check, the generated
 *   profile and its argv stay real (a stubbed plan equals an unstubbed one for the same input);
 * - it is honoured only with a `claudePath` seam (tests pass the fake);
 * - a kernel WITHOUT it still refuses `session.open` with `sandbox-unavailable{floor:'sip'}` on a SIP-off host;
 * - a stubbed launch says so on its `session.sandbox` row (`sipStubbed: true`).
 * The source facts (only the allowed files name the token, no env/CLI/config read) are in test/mods-bridge.test.ts.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDevHome } from '../src/cli/dev-home.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { darwinFloor, sessionLaunchPlan, sessionSipProbe, type SessionLaunchInput } from '../src/kernel/sandbox/session.js';
import { modLaunchPlan, type ModLaunchInput } from '../src/kernel/sandbox/mod.js';
import { isLifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { E2E_REQUIRED, requireE2e, sessionWorld, setMode, worldPolicy, type SessionWorld } from './session-helpers.js';

const REAL = darwinFloor();
const MACOS_OK = REAL.ok || REAL.floor === 'sip';
const SBX = fs.existsSync('/usr/bin/sandbox-exec');

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
});

describe('sessionSipProbe: the stub is the SIP answer alone, and only with a claudePath seam (tests pass the fake)', () => {
  const real = () => false;
  it('no flag, or the flag without claudePath, is the supervisor\'s own probe', () => {
    expect(sessionSipProbe({ sipEnabled: real })).toBe(real);
    expect(sessionSipProbe({ sessionSipStub: true, sipEnabled: real })).toBe(real);
    expect(sessionSipProbe({ sessionSipStub: true, claudePath: '', sipEnabled: real })).toBe(real);
    expect(sessionSipProbe({ sessionSipStub: false, claudePath: '/x/claude', sipEnabled: real })).toBe(real);
    expect(sessionSipProbe({})).toBeUndefined();
  });
  it('the flag with claudePath answers true, and the macOS floor stays real', () => {
    const sip = sessionSipProbe({ sessionSipStub: true, claudePath: '/x/claude', sipEnabled: real })!;
    expect(sip()).toBe(true);
    const input: SessionLaunchInput = { policy: {} as never, binaryReal: '/x/claude', argv: [], extras: {} as never };
    expect(() => sessionLaunchPlan(input, 'darwin', () => 14, sip)).toThrow(/macOS 15\+/);
  });
});

describe.runIf(process.platform === 'darwin' && MACOS_OK && SBX)('a stubbed launch is the same launch (darwin, macOS 15+)', () => {
  it('profileHash, profile and args of a stubbed plan equal an unstubbed plan whose SIP answer is true', () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const input: SessionLaunchInput = { policy: worldPolicy(w), binaryReal: w.claude, argv: ['-p', '--output-format', 'stream-json'], extras: { uid: process.getuid?.() ?? 0, tmpdir: '/tmp', home: w.userHome, roots: [w.cwd], agentSockets: [] }, hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA' };
    const stubbed = sessionLaunchPlan(input, 'darwin', undefined, sessionSipProbe({ sessionSipStub: true, claudePath: w.claude, sipEnabled: () => false }));
    const unstubbed = sessionLaunchPlan(input, 'darwin', undefined, () => true);
    expect(stubbed.profileHash).toBe(unstubbed.profileHash);
    expect(stubbed.profile).toBe(unstubbed.profile);
    expect(stubbed.args).toEqual(unstubbed.args);
    expect(stubbed.command).toBe(unstubbed.command);
    // and with the real probe on a SIP-on host the same again
    if (REAL.ok) expect(sessionLaunchPlan(input, 'darwin').profileHash).toBe(stubbed.profileHash);
  });
});

const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });
async function kernelFor(w: SessionWorld, devHome: string, userHome: string, stub: boolean): Promise<DevKernel> {
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
type SandboxRow = { event: { payload: Record<string, unknown> } };
const sandboxRows = (k: DevKernel, hsid: string) => ([...k.handle.log.read({ reader: { class: 'human' }, kinds: ['session.sandbox'] })] as unknown as SandboxRow[]).map((r) => r.event.payload).filter((p) => p.hsid === hsid && p.profileHash);

requireE2e(process.platform === 'darwin' && MACOS_OK && SBX, 'session-sip-stub');
describe.runIf(process.platform === 'darwin' && MACOS_OK && SBX)('the real kernel: without the flag it is the real floor; with it the row says so', () => {
  it(`unstubbed: ${REAL.ok ? 'SIP is on here, so the unstubbed open succeeds unmarked' : 'SIP is off here, so session.open refuses sandbox-unavailable{floor:sip}'}`, async () => {
    if (E2E_REQUIRED) expect(REAL.ok || REAL.floor === 'sip').toBe(true);
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const t = tempHome('sip-');
    cleanups.push(() => removeTree(path.dirname(t.home)));
    const userHome = path.dirname(t.home);
    const devHome = path.join(userHome, 'devhome');
    expect(await runDevCommand(['init', '--home', devHome], quiet(), { userHome, host: 'mac-1' })).toBe(0);
    loadDevHome(devHome, { userHome });
    setMode(w, {});

    let k = await kernelFor(w, devHome, userHome, false);
    let plain: Record<string, unknown> | undefined;
    if (!REAL.ok) {
      const err = await k.client.call('session.open', { cwd: w.cwd, attended: true }).then(() => null, (e: unknown) => e as { code?: string; message?: string; data?: Record<string, unknown> });
      expect(err).not.toBeNull();
      expect(JSON.stringify(err)).toContain('sandbox-unavailable');
      expect(JSON.stringify(err)).toMatch(/"floor":"sip"|floor: ?'?sip/);
    } else {
      const s = await k.client.call<{ hsid: string }>('session.open', { cwd: w.cwd, attended: true });
      plain = sandboxRows(k, s.hsid)[0];
      expect(plain?.sipStubbed).toBeUndefined();
      await k.client.call('session.stop', { hsid: s.hsid });
    }
    await k.stop();

    k = await kernelFor(w, devHome, userHome, true);
    const s = await k.client.call<{ hsid: string }>('session.open', { cwd: w.cwd, attended: true });
    const row = sandboxRows(k, s.hsid)[0]!;
    expect(row.sipStubbed).toBe(true);
    expect(row.profile).toBe('session');
    // two opens never share a policy (it names the session's own dir), so the equal-launch proof is the pure plan
    // test above; here the unstubbed row is unmarked and the stubbed one is marked
    if (plain) expect(typeof plain.profileHash).toBe('string');
    await k.client.call('session.stop', { hsid: s.hsid });
  }, 120_000);
});

/** a real mod launch input in a throwaway root (realpath'd: SBPL matches resolved paths); removed after the test */
function modInput(): { input: ModLaunchInput; done: () => void } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gmsip-')));
  const home = path.join(root, 'home');
  const snap = path.join(home, 'mods', 'gnomon.probe', 'snap');
  for (const d of [snap, path.join(home, 'mods', 'gnomon.probe', 'state'), path.join(home, 'mods', 'gnomon.probe', 'blobs')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(snap, 'index.mjs'), '');
  const input: ModLaunchInput = { home, name: 'gnomon.probe', snapshotDir: snap, entry: path.join(snap, 'index.mjs'), stateDir: path.join(home, 'mods', 'gnomon.probe', 'state'), blobsDir: path.join(home, 'mods', 'gnomon.probe', 'blobs'), readPaths: [], write: true, proxyPort: null, denyRead: [], env: { GNOMON_MOD_NAME: 'gnomon.probe' } };
  return { input, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe.runIf(process.platform === 'darwin' && MACOS_OK && SBX)('the MOD floor (S1.4 P5 review, Aegis 1(b) items 2 and 3): the stub is the SIP answer alone', () => {
  it('for the same ModLaunchInput, the stubbed plan (the host passes () => true as `sip`, probe undefined) and a SIP-true plan are byte-equal in command, args, env, sandbox, profile and profileHash', () => {
    const m = modInput();
    cleanups.push(m.done);
    // what the host passes when modSipStub is on: modLaunchPlan(input, platform, undefined, () => true)
    const stubbed = modLaunchPlan(m.input, 'darwin', undefined, () => true);
    const sipTrue = modLaunchPlan(m.input, 'darwin', undefined, () => true as boolean | null);
    const pick = (p: typeof stubbed) => ({ command: p.command, args: p.args, env: p.env, sandbox: p.sandbox, profile: p.profile, profileHash: p.profileHash });
    expect(pick(stubbed)).toEqual(pick(sipTrue));
    if (REAL.ok) expect(pick(modLaunchPlan(m.input, 'darwin'))).toEqual(pick(stubbed)); // and the real probe on a SIP-on host
    // the macOS floor stays real under the stub
    expect(() => modLaunchPlan(m.input, 'darwin', () => 14, () => true)).toThrow(/macOS 15\+/);
  });
  it('without the seam, a SIP-off host refuses the mod: sandbox-unavailable, floor sip', () => {
    const m = modInput();
    cleanups.push(m.done);
    let err: unknown = null;
    try {
      modLaunchPlan(m.input, 'darwin', undefined, () => false);
    } catch (e) {
      err = e;
    }
    expect(isLifecycleRefusal(err)).toBe(true);
    expect((err as { code?: string; detail?: Record<string, unknown> }).detail).toMatchObject({ profile: 'mod', floor: 'sip' });
    expect(String((err as Error).message)).toMatch(/System Integrity Protection/);
  });
});

describe('the stub reaches only the session and mod floors (source facts; Aegis 1(b) items 1, 2, 4, 5)', () => {
  const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
  const code = (rel: string): string => fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8').replace(/\/\*[^]*?\*\/|\/\/.*$/gm, '');
  it('daemon.ts computes ONE switch off DaemonSeams.supervisor (sessionSipStub and a non-empty claudePath) and hands it to exactly the supervisor and the mod host', () => {
    const d = code('kernel/lifecycle/daemon.ts');
    expect(d).toContain("const sipStubOn = seams.supervisor?.sessionSipStub === true && typeof seams.supervisor.claudePath === 'string' && seams.supervisor.claudePath.length > 0;");
    expect(d.match(/\bsipStubOn\b/g)?.length).toBe(3); // the switch, the supervisor's hand-over, the mod host's
    expect(d).toContain('...(sipStubOn ? { sessionSipStub: true } : {})');
    expect(d).toContain('...(sipStubOn ? { modSipStub: true } : {})');
    expect(d.match(/\bmodSipStub\b/g)?.length).toBe(1);
  });
  it('host.ts passes the stub only as modLaunchPlan\'s sip argument with probe undefined, and marks mod.sandbox only when it applied', () => {
    const h = code('kernel/modhost/host.ts');
    expect(h).toContain("modLaunchPlan(input, this.#o.platform, undefined, this.#o.modSipStub === true ? () => true : undefined)");
    expect(h.match(/\bmodSipStub\b/g)?.length).toBe(3); // the option, the launch, the row mark
    expect(h).toContain("...(this.#o.modSipStub === true && !this.#seams.launcher && (this.#o.platform ?? process.platform) === 'darwin' ? { sipStubbed: true } : {})");
  });
  it('no other floor is passed the stub: loop-act, loop-check, the local lane, the sandbox registry and fidelity name neither switch', () => {
    for (const f of ['kernel/sandbox/loop-act.ts', 'kernel/sandbox/loop-check.ts', 'kernel/sandbox/mod.ts', 'kernel/supervisor/local-session.ts', 'kernel/loops/check-exec.ts']) {
      expect([f, /sessionSipStub|modSipStub|sipStubOn|sessionSip\b/.test(code(f))]).toEqual([f, false]);
    }
    const sup = code('kernel/supervisor/supervisor.ts');
    // fidelity reads the supervisor's own probe, never the stubbed one
    expect(sup).toContain('return sessionSandboxFidelity(this.#platform, this.#o.macosMajor, this.#o.sipEnabled);');
    // the local lane gets the supervisor's own sipEnabled, never #sessionSip
    expect(sup).toMatch(/\.\.\.\(o\.sipEnabled \? \{ sipEnabled: o\.sipEnabled \} : \{\}\)/);
    expect((sup.match(/#sessionSip\b/g) ?? []).length).toBe(5); // declaration, constructor, two launch plans, the row mark
  });
  it('the e2e and dogfood rigs never set the mod host\'s `launcher` seam', () => {
    for (const f of ['dimension-bridge-e2e.test.ts', 'dimension-dogfood.test.ts', 'dimension-board-browser.test.ts', 'session-helpers.ts']) {
      expect([f, /\blauncher\b/.test(fs.readFileSync(path.join(SRC, '..', 'test', f), 'utf8'))]).toEqual([f, false]);
    }
  });
});
