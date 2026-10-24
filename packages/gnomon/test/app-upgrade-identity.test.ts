// @gnomon-platform: darwin, linux
/**
 * 8.0 M4 (TD-2026-10-21-758, T-2026-10-21-031): the identity survives the app moving and being replaced.
 *   - identity.json records an absolute helperPath at provision time; a kernel inside Gnomon.app always uses ITS OWN
 *     helper (#app-bundle helperPathFor), so a moved app opens the same identity (keys are the helper's, bound to its
 *     keychain access group, never to a path);
 *   - the shim replaces Gnomon.app in place: a RUNNING release kernel refuses the newer helper (its compiled pin names
 *     the old sha256) through the existing repin path, and never starts the new bytes; restarted from the new app
 *     (whose pin names the new helper) it opens the SAME identity, identity.json untouched, also when the new release
 *     raises the helper floor (the record carries no helper version).
 */
import { createHash, createPublicKey } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nsFromRootPublicKey, RELEASE_MANIFEST_V1 } from '@a-company/gnomon-contracts';
import {
  acceptUnsignedHelperForTests,
  APPROVALS_ROW_SCHEMA,
  DEV_TEST_HELPER_ACK,
  HardwareRootAuthority,
  IDENTITY_SCHEMA,
  identityPath,
  openHardwareIdentity,
  p256KeyIdOfPem,
  writeIdentity,
  type IdentityRecord,
} from '../src/kernel/identity/index.js';
import { HELPER_REQUIREMENT, MIN_HELPER_VERSION } from '../src/kernel/identity/helper.js';
import { releasePinsFromCompiled, type ReleasePins } from '../src/kernel/lifecycle/release-pins.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FakeHelper } from './helper-fake.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-upg-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

/** A release-shaped Gnomon.app under `parent` whose helper prints `tag`; returns { kernel file, helper exe }. */
function makeApp(parent: string, tag: string): { kernel: string; helper: string } {
  const c = path.join(parent, 'Gnomon.app', 'Contents');
  const helper = path.join(c, 'Helpers', 'GnomonHelper.app', 'Contents', 'MacOS', 'gnomon-helper');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, `#!/bin/sh\necho ${tag}\n`);
  fs.chmodSync(helper, 0o755);
  const kernel = path.join(c, 'Resources', 'kernel', 'dist', 'cli', 'gnomon.js');
  fs.mkdirSync(path.dirname(kernel), { recursive: true });
  fs.writeFileSync(kernel, '// kernel\n');
  return { kernel, helper };
}

const sha = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** The pins a release kernel compiled for a helper with these bytes. */
function pinsFor(helperSha: string, version = MIN_HELPER_VERSION): ReleasePins {
  return releasePinsFromCompiled(
    true,
    JSON.stringify({ schemaVersion: RELEASE_MANIFEST_V1, release: '8.0.0', artifacts: [{ name: 'gnomon-helper', version, sha256: helperSha, requirement: HELPER_REQUIREMENT, arch: process.arch }] }),
  );
}

async function provision(home: string, fake: FakeHelper, helperPath: string): Promise<void> {
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
    helperPath,
    createdAt: new Date().toISOString(),
  };
  writeIdentity(home, rec);
}

describe('8.0 M4: the identity survives the app moving or being replaced', () => {
  it('a moved app opens the same identity with its own helper (the recorded path is stale and gone)', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001'); // the Secure Enclave keys, reached through whichever helper is pinned
    const firstParent = path.join(tmp(), 'Applications');
    const first = makeApp(firstParent, 'v1');
    await provision(home, fake, first.helper);
    const movedParent = path.join(tmp(), 'Applications');
    fs.mkdirSync(movedParent);
    fs.renameSync(path.join(firstParent, 'Gnomon.app'), path.join(movedParent, 'Gnomon.app'));
    expect(fs.existsSync(first.helper)).toBe(false);
    const kernel = path.join(movedParent, 'Gnomon.app/Contents/Resources/kernel/dist/cli/gnomon.js');
    const id = await openHardwareIdentity(home, { verifier: DEV, start: () => fake, from: kernel });
    expect(id!.pin.exe).toBe(path.join(movedParent, 'Gnomon.app/Contents/Helpers/GnomonHelper.app/Contents/MacOS/gnomon-helper'));
    expect(id!.root.rootKeyId).toBe(id!.record.rootKeyId);
    await id!.helper.close();
  });

  it('an in-place upgrade: the running release kernel refuses the newer helper until restart; then the same identity opens', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001');
    const parent = path.join(tmp(), 'Applications');
    const v1 = makeApp(parent, 'helper-1.6.0');
    await provision(home, fake, v1.helper);
    const before = fs.readFileSync(identityPath(home));
    const oldPins = pinsFor(sha(v1.helper));
    const running = await openHardwareIdentity(home, { verifier: DEV, start: () => fake, from: v1.kernel, pins: oldPins });
    expect(running).not.toBeNull();
    expect(await running!.repin()).toBe('unchanged');

    // the shim swaps in a newer app at the SAME path (rename the staged app over it)
    const staged = path.join(tmp(), 'stage');
    const v2 = makeApp(staged, 'helper-1.7.0');
    fs.renameSync(path.join(parent, 'Gnomon.app'), path.join(tmp(), 'old.app'));
    fs.renameSync(path.join(staged, 'Gnomon.app'), path.join(parent, 'Gnomon.app'));
    expect(v2.helper.replace(staged, parent)).toBe(v1.helper);
    const newSha = sha(v1.helper);
    expect(newSha).not.toBe(oldPins.mode === 'release' ? oldPins.manifest.artifacts[0]!.sha256 : '');

    // the running kernel: its compiled pin names the old bytes, so the new helper is refused (and not retried), and
    // the old pin's pre-spawn re-check refuses to start the changed file
    expect(await running!.repin()).toBe('refused');
    expect(await running!.repin()).toBe('refused');
    expect(() => running!.pin.recheck()).toThrow(/changed|moved/);

    // restarted from the new app (its compiled pin names the new helper, under a raised floor): the same identity
    const restarted = await openHardwareIdentity(home, { verifier: DEV, start: () => fake, from: v1.kernel, pins: pinsFor(newSha, '1.7.0') });
    expect(restarted!.pin.sha256).toBe(newSha);
    expect(restarted!.record.rootKeyId).toBe(running!.record.rootKeyId);
    expect(restarted!.approvals.principalId).toBe(running!.record.principalId);
    expect(fs.readFileSync(identityPath(home))).toEqual(before); // identity.json untouched by the upgrade
    await restarted!.helper.close();
    await running!.helper.close(); // the old kernel's process ends last here: the fake plays one shared SE
  });

  it('falsifier: a restarted kernel whose pin does not name the installed helper refuses to open (fail closed)', async () => {
    const home = tmp();
    const fake = new FakeHelper('test0001');
    const app = makeApp(path.join(tmp(), 'Applications'), 'x');
    await provision(home, fake, app.helper);
    await expect(openHardwareIdentity(home, { verifier: DEV, start: () => fake, from: app.kernel, pins: pinsFor('0'.repeat(64)) })).rejects.toMatchObject({ reason: 'helper' });
  });
});
