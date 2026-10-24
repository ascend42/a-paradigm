/**
 * #local-runner M1.8 slice 2 round 2 (reviewer): the daemon's two chain
 * high-water loops never cross. The meter's config.signed.json and the
 * local lane's local.signed.json both log `config.loaded{signed, version}`;
 * only the local rows carry `file`. With the sidecars removed, a restart
 * reads each high-water mark from the CHAIN alone: a local v9 must not make
 * a meter v2 "older" (and the reverse). Real daemon, real KernelLog.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { writeSignedConfig } from '../src/kernel/budget/config.js';
import { LOCAL_CONFIG_FILE, writeSignedLocalConfig } from '../src/kernel/local/config.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const LOCAL = { endpoints: [{ id: 'llama', base: 'http://127.0.0.1:9', model: 'm', compat: 'llama.cpp' }] };

async function twoBoots(meterVersion: number, localVersion: number): Promise<Array<Record<string, unknown>>> {
  const t = tempHome('gd-lcfg-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  fs.mkdirSync(t.home, { recursive: true, mode: 0o700 });
  writeSignedConfig(t.home, root, { fuse: { tokens: { user: 9 } } }, meterVersion);
  writeSignedLocalConfig(t.home, root, LOCAL, localVersion);
  const d1 = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
  await d1.shutdown('signal');
  // the sidecars go: the second boot's high-water marks come from the chain alone
  fs.rmSync(path.join(t.home, 'config.seen.json'), { force: true });
  fs.rmSync(path.join(t.home, 'local.seen.json'), { force: true });
  const d2 = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
  cleanups.push(() => d2.shutdown('signal'));
  return [...d2.log.read({ reader: { class: 'human' }, kinds: ['config.loaded'] })].map((v) => (v.view === 'full' ? (v.event.payload as Record<string, unknown>) : {}));
}

describe('the meter and local chain loops never cross (both directions)', () => {
  it('local v9 leaves the meter v2 applied on the next boot', async () => {
    const rows = await twoBoots(2, 9);
    const meter = rows.filter((r) => r.file === undefined);
    const local = rows.filter((r) => r.file === LOCAL_CONFIG_FILE);
    expect(meter).toHaveLength(2);
    expect(meter.every((r) => r.signed === true && r.version === 2 && r.fallback === undefined)).toBe(true);
    expect(local.every((r) => r.signed === true && r.version === 9 && r.fallback === undefined)).toBe(true);
  });
  it('meter v9 leaves the local v2 applied on the next boot', async () => {
    const rows = await twoBoots(9, 2);
    const meter = rows.filter((r) => r.file === undefined);
    const local = rows.filter((r) => r.file === LOCAL_CONFIG_FILE);
    expect(local).toHaveLength(2);
    expect(local.every((r) => r.signed === true && r.version === 2 && r.fallback === undefined)).toBe(true);
    expect(meter.every((r) => r.signed === true && r.version === 9 && r.fallback === undefined)).toBe(true);
  });
});
