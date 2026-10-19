// @gnomon-platform: darwin, linux
/**
 * #identity M1.3 slice 1 — pinning and running the helper (G-HLP-01 shape):
 * the path is resolved once, verified, re-checked synchronously before every
 * spawn; a missing / non-executable / writable / unsigned / changed helper
 * fails closed; the `serve` child is serialized, bounded and fail-closed on
 * protocol errors; a provisioned home opens only when the helper confirms its
 * keys. POSIX: executable bits, a shebang fake helper, owner-only keys/.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptUnsignedHelperForTests,
  APPROVALS_ROW_SCHEMA,
  CODESIGN_VERIFIER,
  DEV_TEST_HELPER_ACK,
  HardwareRootAuthority,
  HelperProcess,
  SupervisedHelper,
  HelperUnavailableError,
  IDENTITY_SCHEMA,
  IdentityError,
  openHardwareIdentity,
  p256KeyIdOfPem,
  pinHelper,
  writeIdentity,
  type IdentityRecord,
} from '../src/kernel/identity/index.js';
import { nsFromRootPublicKey } from '@a-company/gnomon-contracts';
import { createPublicKey } from 'node:crypto';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FakeHelper } from './helper-fake.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-hlp-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

/** A fake `gnomon-helper serve`: echoes the id; op `bad-id` answers with the wrong id; op `die` exits. */
function fakeServe(dir: string, version = '1.6.0'): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(
    f,
    `#!${process.execPath}
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const req = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (req.op === 'die') process.exit(1);
    const id = req.op === 'bad-id' ? 999 : req.id;
    const info = { protocol: 'gnomon-helper:v2', version: '${version}' };
    if (req.op === 'push-lock') process.stdout.write(JSON.stringify({ push: 'session', cause: 'screen-lock', arms: ['arm:x'], unlocks: 1, seq: 1 }) + '\\n');
    if (req.op === 'push-bad') process.stdout.write(JSON.stringify({ push: 'session', cause: 'lid', arms: [], unlocks: 0, seq: 1 }) + '\\n');
    process.stdout.write(JSON.stringify(req.op === 'refuse' ? { id, ok: false, error: 'presence-denied', message: 'no' } : { id, ok: true, op: req.op, ...(req.op === 'info' ? info : {}) }) + '\\n');
  }
});
`,
  );
  fs.chmodSync(f, 0o755);
  return f;
}

describe('pinHelper', () => {
  it('refuses a missing, non-executable or group-writable file', () => {
    const d = tmp();
    expect(() => pinHelper(path.join(d, 'nope'), { verifier: DEV })).toThrow(/missing/);
    const f = path.join(d, 'x');
    fs.writeFileSync(f, 'x');
    fs.chmodSync(f, 0o644);
    expect(() => pinHelper(f, { verifier: DEV })).toThrow(/not-a-file/);
    fs.chmodSync(f, 0o775);
    expect(() => pinHelper(f, { verifier: DEV })).toThrow(/unsigned/);
  });

  it('falsifier: the production verifier refuses an unsigned executable', () => {
    const f = fakeServe(tmp());
    expect(() => pinHelper(f, { verifier: CODESIGN_VERIFIER })).toThrow(HelperUnavailableError);
    expect(() => pinHelper(f)).toThrow(process.platform === 'darwin' ? /unsigned/ : /platform/);
  });

  it('falsifier: a checksum pin that does not match refuses', () => {
    const f = fakeServe(tmp());
    expect(() => pinHelper(f, { verifier: DEV, expectedSha256: '0'.repeat(64) })).toThrow(/checksum/);
  });

  it('falsifier: a helper swapped after verification is refused at the pre-spawn re-check', () => {
    const d = tmp();
    const f = fakeServe(d);
    const pin = pinHelper(f, { verifier: DEV });
    expect(() => pin.recheck()).not.toThrow();
    fs.appendFileSync(f, '// swapped\n');
    expect(() => pin.recheck()).toThrow(/changed/);
    expect(() => HelperProcess.start(pin)).toThrow(/changed/);
    // replaced through a symlink retarget: the resolved path moved
    const g = fakeServe(fs.mkdtempSync(path.join(d, 'g-')));
    const link = path.join(d, 'link');
    fs.symlinkSync(g, link);
    const pin2 = pinHelper(link, { verifier: DEV });
    fs.unlinkSync(link);
    fs.symlinkSync(f, link);
    expect(() => pin2.recheck()).toThrow(/changed/);
  });
});

describe('HelperProcess (serve)', () => {
  it('falsifier (H1 c): a helper below the version floor, or speaking another protocol, is refused before any request', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp(), '1.1.0'), { verifier: DEV }));
    await expect(h.request({ op: 'key.public' })).rejects.toThrow(/older than the minimum/);
    expect(h.alive).toBe(false);
  });

  it('falsifier (V5, helper 1.6.0): a 1.5.0 helper (no arms, no session push) is below the floor', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp(), '1.5.0'), { verifier: DEV }));
    await expect(h.request({ op: 'key.public' })).rejects.toThrow(/older than the minimum 1.6.0/);
    expect(h.alive).toBe(false);
  });

  it('protocol v2: an unsolicited session push (screen lock) reaches onPush and does not disturb the reply in flight', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp()), { verifier: DEV }));
    const pushes: unknown[] = [];
    h.onPush((p) => pushes.push(p));
    const reply = await h.request({ op: 'push-lock' });
    expect(reply.op).toBe('push-lock');
    expect(pushes).toEqual([{ push: 'session', cause: 'screen-lock', arms: ['arm:x'], unlocks: 1, seq: 1 }]);
    expect(h.alive).toBe(true);
    await h.close();
  });

  it('protocol v2: a malformed push kills the helper (fail closed: every unlock and arm dies with it)', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp()), { verifier: DEV }));
    let exited = false;
    h.onExit(() => (exited = true));
    await expect(h.request({ op: 'push-bad' })).rejects.toThrow(/malformed/);
    expect(h.alive).toBe(false);
    expect(exited).toBe(true);
  });

  it('helper EOF: the exit listeners hear it (the daemon maps that to approval.voice.disarm{reason:helper-exit})', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp()), { verifier: DEV }));
    let exited = false;
    h.onExit(() => (exited = true));
    await expect(h.request({ op: 'die' })).rejects.toThrow(HelperUnavailableError);
    expect(exited).toBe(true);
  });

  it('falsifier (setup helper-line-mismatch, 2026-10-19): a 1.4.0 helper (root signs without `shown`) is below the floor', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp(), '1.4.0'), { verifier: DEV }));
    await expect(h.request({ op: 'key.public' })).rejects.toThrow(/older than the minimum 1.6.0/);
    expect(h.alive).toBe(false);
  });

  it('falsifier (T-2026-10-18-028 M2): a 1.2.0 helper (no absolute unlock TTL, no signature cap) is below the floor', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp(), '1.2.0'), { verifier: DEV }));
    await expect(h.request({ op: 'key.public' })).rejects.toThrow(/older than the minimum 1.6.0/);
    expect(h.alive).toBe(false);
  });

  it('falsifier (H5): a running child that fails the pid code-signing check is killed before any request', async () => {
    const pin = pinHelper(fakeServe(tmp()), { verifier: { kind: 'dev-test', verify: () => undefined, verifyRunning: (pid) => { throw new HelperUnavailableError('unsigned', `pid ${pid}`); } } });
    const h = HelperProcess.start(pin);
    expect(h.alive).toBe(false);
    await expect(h.request({ op: 'info' })).rejects.toThrow(/not running/);
  });

  it('falsifier (H5): a file swapped DURING verification is refused (hash, verify, re-hash)', () => {
    const f = fakeServe(tmp());
    expect(() => pinHelper(f, { verifier: { kind: 'dev-test', verify: (exe) => fs.appendFileSync(exe, '// swapped mid-verify\n'), verifyRunning: () => undefined } })).toThrow(/while it was being verified/);
  });

  it('SupervisedHelper: never restarts after close(), and backs off a helper that keeps dying', async () => {
    let starts = 0;
    let t = 0;
    const sup = new SupervisedHelper(() => {
      starts++;
      return HelperProcess.start(pinHelper(fakeServe(tmp()), { verifier: DEV }));
    }, () => t);
    await sup.request({ op: 'info' });
    await expect(sup.request({ op: 'die' })).rejects.toThrow();
    await expect(sup.request({ op: 'info' })).rejects.toThrow(/restart allowed/);
    t += 1_500;
    await sup.request({ op: 'info' });
    expect(starts).toBe(2);
    await sup.close();
    await expect(sup.request({ op: 'info' })).rejects.toThrow(/closed/);
    expect(starts).toBe(2);
  });

  it('answers in order; a refusal is a HelperRefusal; an out-of-order reply kills the helper (fail closed)', async () => {
    const pin = pinHelper(fakeServe(tmp()), { verifier: DEV });
    const h = HelperProcess.start(pin);
    let exited = 0;
    h.onExit(() => exited++);
    const [a, b] = await Promise.all([h.request({ op: 'info' }), h.request({ op: 'key.public' })]);
    expect([a.op, b.op]).toEqual(['info', 'key.public']);
    await expect(h.request({ op: 'refuse' })).rejects.toMatchObject({ name: 'HelperRefusal', code: 'presence-denied' });
    await expect(h.request({ op: 'bad-id' })).rejects.toThrow(/out of order/);
    expect(h.alive).toBe(false);
    expect(exited).toBe(1);
    await expect(h.request({ op: 'info' })).rejects.toThrow(/not running/);
  });

  it('a helper exit rejects the request in flight and tells the listeners', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp()), { verifier: DEV }));
    let exited = false;
    h.onExit(() => (exited = true));
    await expect(h.request({ op: 'die' })).rejects.toThrow(/exited/);
    expect(exited).toBe(true);
  });

  it('close() ends the helper with EOF', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp()), { verifier: DEV }));
    await h.request({ op: 'info' });
    await h.close();
    expect(h.alive).toBe(false);
  });
});

describe('openHardwareIdentity', () => {
  async function setup(home: string, fake: FakeHelper, mutate: (r: IdentityRecord) => void = () => undefined): Promise<void> {
    const rootPem = fake.publicPem('root');
    const root = new HardwareRootAuthority({ gen: 'test0001', rootPublicKeyPem: rootPem }, { helper: fake });
    const apprPem = fake.publicPem('approvals');
    const row = { schemaVersion: APPROVALS_ROW_SCHEMA, keyId: p256KeyIdOfPem(apprPem), publicKeyPem: apprPem, principalId: `p:${root.ns}/matt`, gen: 'test0001' };
    const signed = await root.signRowAsync(row);
    const rec: IdentityRecord = {
      schemaVersion: IDENTITY_SCHEMA,
      gen: 'test0001',
      rootKeyId: root.rootKeyId,
      rootPublicKeyPem: rootPem,
      ns: nsFromRootPublicKey(new Uint8Array(createPublicKey(rootPem).export({ type: 'spki', format: 'der' }))),
      approvals: { row, ...signed },
      principalId: row.principalId,
      deviceId: `dev:${root.ns}/mac`,
      helperPath: fakeServe(tmp()),
      createdAt: new Date().toISOString(),
    };
    mutate(rec);
    writeIdentity(home, rec);
  }

  it('an unprovisioned home opens as null', async () => {
    expect(await openHardwareIdentity(tmp(), { verifier: DEV })).toBeNull();
  });

  it('opens when the helper confirms both keys and the approvals binding verifies under the root', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001');
    await setup(home, fake);
    const id = await openHardwareIdentity(home, { verifier: DEV, start: () => fake });
    expect(id!.root.state).toBe('hardware');
    expect(id!.approvals.principalId).toBe(id!.record.principalId);
  });

  it('falsifier: identity.json naming keys the Secure Enclave does not hold refuses (mismatch)', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001');
    await setup(home, fake);
    const other = new FakeHelper('test0001'); // a different SE
    await expect(openHardwareIdentity(home, { verifier: DEV, start: () => other })).rejects.toMatchObject({ reason: 'mismatch' });
  });

  it('falsifier: a tampered approvals binding (another principal) refuses', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001');
    await setup(home, fake, (r) => {
      r.principalId = 'p:abcdefgh/eve';
      r.approvals.row.principalId = 'p:abcdefgh/eve';
    });
    await expect(openHardwareIdentity(home, { verifier: DEV, start: () => fake })).rejects.toBeInstanceOf(IdentityError);
  });

  it('falsifier: an unsigned helper refuses to open the identity (fail closed)', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001');
    await setup(home, fake);
    await expect(openHardwareIdentity(home, { start: () => fake })).rejects.toMatchObject({ reason: 'helper' });
  });
});
