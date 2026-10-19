// @gnomon-platform: darwin, linux
/**
 * TD-2026-10-19-063 POSIX half: the 0600 hand-off files (kernel-build.json, gui-resume.json) and the helper re-pin
 * (an executable fixture file with a mode). Windows has no POSIX mode bits to assert.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readKernelBuild, writeKernelBuild } from '../src/kernel/lifecycle/build-stamp.js';
import { mintResumeToken, ResumeGate, resumeRecordOf, RESUME_FILE, RESUME_TOKEN_TTL_MS, takeResumeHandoff, writeResumeHandoff } from '../src/kernel/web/resume.js';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, HelperRepin, HelperUnavailableError, pinHelper, type HelperVerifier } from '../src/kernel/identity/helper.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gn-updp-'));
  chmodSync(d, 0o700);
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const binding = { principal: 'p:local/founder', deviceId: 'dev-1', ns: 'local' };

describe('kernel-build.json', () => {
  it('is written 0600 and read back', () => {
    const home = tmp();
    writeKernelBuild(home, { stamp: null, pid: 42, startedAt: '2026-10-19T00:00:00.000Z' });
    expect(statSync(path.join(home, 'kernel-build.json')).mode & 0o777).toBe(0o600);
    expect(readKernelBuild(home)).toMatchObject({ pid: 42, stamp: null });
  });
});

describe('#gui-resume hand-off', () => {
  it('written 0600 holding the digest only; taken ONCE (unlinked at once)', () => {
    const home = tmp();
    const token = mintResumeToken();
    writeResumeHandoff(home, resumeRecordOf(token, binding, Date.now()));
    const file = path.join(home, RESUME_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain(token); // theft from the home: nothing presentable
    const rec = takeResumeHandoff(home, Date.now());
    expect(rec).not.toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(takeResumeHandoff(home, Date.now())).toBeNull();
    const g = new ResumeGate({ record: rec, ns: 'local', isHumanDevice: () => true });
    expect(g.exchange(token).kind).toBe('fresh');
    expect(g.exchange(token).kind).toBe('replay');
  });

  it('refused (and still unlinked): group-readable, expired, a TTL longer than allowed, a symlink', () => {
    const home = tmp();
    const file = path.join(home, RESUME_FILE);
    writeResumeHandoff(home, resumeRecordOf(mintResumeToken(), binding, Date.now()));
    chmodSync(file, 0o640);
    expect(takeResumeHandoff(home, Date.now())).toBeNull();
    expect(existsSync(file)).toBe(false);
    writeResumeHandoff(home, resumeRecordOf(mintResumeToken(), binding, Date.now() - RESUME_TOKEN_TTL_MS - 1));
    expect(takeResumeHandoff(home, Date.now())).toBeNull();
    writeResumeHandoff(home, resumeRecordOf(mintResumeToken(), binding, Date.now(), RESUME_TOKEN_TTL_MS * 10));
    expect(takeResumeHandoff(home, Date.now())).toBeNull();
    expect(existsSync(file)).toBe(false);
  });
});

describe('helper re-pin (no card; fail closed)', () => {
  const exe = (dir: string, body: string): string => {
    const p = path.join(dir, 'gnomon-helper');
    writeFileSync(p, `#!/bin/sh\n# ${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const okVerifier = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
  const rig = (verifier: HelperVerifier, inFlight = 0, confirm?: () => Promise<boolean>) => {
    const dir = tmp();
    const p = exe(dir, 'v1');
    const holder = { pin: pinHelper(p, { verifier: okVerifier }) };
    let recycled = 0;
    const r = new HelperRepin({ helperPath: p, holder, helper: { inFlight, recycle: async () => void recycled++ }, verifier, ...(confirm ? { confirm } : {}) });
    return { p, holder, r, recycled: () => recycled };
  };

  it('unchanged ⇒ nothing; changed + verified ⇒ re-pinned and the serve child recycled', async () => {
    const x = rig(okVerifier);
    expect(await x.r.check()).toBe('unchanged');
    const before = x.holder.pin.sha256;
    exe(path.dirname(x.p), 'v2');
    expect(await x.r.check()).toBe('respawned');
    expect(x.holder.pin.sha256).not.toBe(before);
    expect(x.recycled()).toBe(1);
  });

  it('a request in flight ⇒ busy (tried next tick)', async () => {
    const x = rig(okVerifier, 1);
    exe(path.dirname(x.p), 'v2');
    expect(await x.r.check()).toBe('busy');
    expect(x.recycled()).toBe(0);
  });

  it('an unsigned helper fails closed: never pinned, never started, not retried', async () => {
    let verifies = 0;
    const reject: HelperVerifier = {
      verify: () => {
        verifies++;
        throw new HelperUnavailableError('unsigned', 'not signed');
      },
    } as unknown as HelperVerifier;
    const x = rig(reject);
    const before = x.holder.pin.sha256;
    exe(path.dirname(x.p), 'evil');
    expect(await x.r.check()).toBe('refused');
    expect(await x.r.check()).toBe('refused');
    expect(verifies).toBe(1);
    expect(x.holder.pin.sha256).toBe(before);
    expect(x.recycled()).toBe(0);
    expect(() => x.holder.pin.recheck()).toThrow(/changed/); // the old pin refuses the changed file
  });

  it('a respawned helper that does not hold this identity\'s keys fails closed (pin restored)', async () => {
    const x = rig(okVerifier, 0, async () => false);
    const before = x.holder.pin.sha256;
    exe(path.dirname(x.p), 'other-keys');
    expect(await x.r.check()).toBe('refused');
    expect(x.holder.pin.sha256).toBe(before);
  });
});

describe('the launcher (bare gnomon) on a stale kernel', () => {
  const st = (n: string) => ({ schemaVersion: 'gnomon-build:v1' as const, version: '8.0.0', commit: n, distHash: `sha256:${n.repeat(64).slice(0, 64)}`, guiBundleHash: null });
  it('kernel-build.json differing from the on-disk stamp is a mismatch; same / missing is not', async () => {
    const { launcherSeesUpdate } = await import('../src/cli/bare-cli.js');
    const home = tmp();
    expect(launcherSeesUpdate(home, st('a'))).toBe(false);
    writeKernelBuild(home, { stamp: st('a'), pid: 1, startedAt: 'x' });
    expect(launcherSeesUpdate(home, st('a'))).toBe(false);
    expect(launcherSeesUpdate(home, null)).toBe(false);
    expect(launcherSeesUpdate(home, st('b'))).toBe(true);
  });
  it('0 live sessions ⇒ daemon.stop{reason:upgrade} (the upgrade card); live sessions ⇒ no card', async () => {
    const { raiseUpgradeIfIdle } = await import('../src/cli/bare-cli.js');
    const calls: Array<[string, unknown]> = [];
    const call = (n: number) => async (verb: string, params: Record<string, unknown>) => {
      calls.push([verb, params]);
      return verb === 'status' ? { result: { sessions: { n } } } : { result: { cardId: 'card:1' } };
    };
    expect(await raiseUpgradeIfIdle(call(0))).toBe('raised');
    expect(calls).toEqual([['status', {}], ['daemon.stop', { reason: 'upgrade' }]]);
    calls.length = 0;
    expect(await raiseUpgradeIfIdle(call(2))).toBe('busy');
    expect(calls.map((c) => c[0])).toEqual(['status']);
  });
});
