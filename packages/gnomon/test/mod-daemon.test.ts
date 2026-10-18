/**
 * #mod-host wired into startDaemon (M1.11 slice 2; spec §5, §12.3). Platform-
 * independent half: status reports modAbiId + `mods`, the relays are served
 * (bad params refused, an uninstalled mod refused by #manifest-loader with
 * nothing spawned), a mod's kernel.call reaches the REAL dispatcher as the
 * mod principal (status own view, log.read own modns, follow refused,
 * log.append excluded, session.send refused until session principals), the
 * C2 clamp on own-modns appends, and the daemon's exit stops the mod host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MOD_ABI_ID } from '@a-company/gnomon-contracts';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, loadDeviceKey, readRegistry, registerDevice, registerKernelKey, RootVerifier, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { clampModAppend, createModKernelCall, MOD_APPEND_MAX_BYTES, ModRefusal } from '../src/kernel/modhost/index.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function rig() {
  const t = tempHome('gmd-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const devKey = writeNewDeviceKey(t.home);
  const entry = registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: devKey.publicKeyPem, principalKind: 'human' });
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
  cleanups.push(() => d.shutdown('signal'));
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  const s = await connectGnomon({
    socketPath: d.pidfile.socketPath,
    client: { name: 't', version: '0', surface: 'cli' },
    serverKey: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! },
    device: { principalId: entry.principalId, deviceId: entry.deviceId, signer: loadDeviceKey(t.home) },
  });
  cleanups.push(() => s.conn.close());
  return { d, s, ns: root.ns };
}

describe('ModHost in startDaemon (M1.11 slice 2)', () => {
  it('status reports modAbiId and mods; the relays are available to a human device connection', async () => {
    const { s } = await rig();
    const st = (await s.conn.call('status', {})) as { result: Record<string, unknown> };
    expect(st.result.modAbiId).toBe(MOD_ABI_ID);
    expect(st.result.mods).toEqual({ modAbiId: MOD_ABI_ID, running: [], paused: [] });
    expect(st.result.relays).toEqual([expect.objectContaining({ relay: 'mod.view', available: true }), expect.objectContaining({ relay: 'mod.command', available: true })]);
  });

  it('relays: bad params ⇒ BAD_REQUEST; an uninstalled mod is refused by #manifest-loader and nothing is spawned', async () => {
    const { d, s } = await rig();
    expect(await s.conn.call('mod.view', { name: 'probe' })).toMatchObject({ error: { data: { code: 'BAD_REQUEST', data: { reason: 'bad-params' } } } });
    const f = (await s.conn.call('mod.view', { name: 'probe', viewId: 'probe.view', input: {} })) as { error?: { data: { code: string } } };
    expect(f.error?.data.code).toBeTruthy();
    expect(d.mods.running()).toEqual([]);
    expect(d.children.live()).toBe(0);
  });

  it("a mod's kernel.call reaches the real dispatcher as the mod principal", async () => {
    const { d, ns } = await rig();
    const p = `p:${ns}/mod-probe`;
    const call = createModKernelCall({ callAs: (pr, v, pa) => d.dispatcher.callAs(pr, v, pa), append: async () => ({ seq: 0 }) });
    const st = (await call({ name: 'probe', principal: p, verb: 'status', params: {} })) as Record<string, unknown>;
    expect(st).toMatchObject({ principal: p, principalKind: 'mod', modAbiId: MOD_ABI_ID });
    expect(st.daemon).toBeUndefined(); // own view only
    const page = (await call({ name: 'probe', principal: p, verb: 'log.read', params: {} })) as { projection: string };
    expect(page.projection).toBe('mod');
    await expect(call({ name: 'probe', principal: p, verb: 'log.read', params: { follow: true } })).rejects.toMatchObject({ refusal: { data: { reason: 'bad-follow' } } });
    await expect(d.dispatcher.callAs(p, 'log.append', { kind: 'modns.probe.x' })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(call({ name: 'probe', principal: p, verb: 'session.send', params: { hsid: 'h' }, hsid: 'h' })).rejects.toMatchObject({ refusal: { code: 'ENGINE' } });
  });

  it('shutdown stops the mod host (no restart can race the children sweep)', async () => {
    const { d } = await rig();
    await d.shutdown('idle');
    await expect(d.mods.start('probe')).rejects.toMatchObject({ modCode: 'NOT_RUNNING' });
  });
});

describe('Aegis C2: a mod-supplied log.append is clamped', () => {
  it('only kind/payload/audience/sensitivity pass; scope, causes, ref, idem, principal are dropped; payload object ≤ cap; labels are enum values', () => {
    const row = clampModAppend('probe', 'p:x/mod-probe', { kind: 'modns.probe.done', payload: { a: 1 }, scope: { repo: 'r' }, causes: ['ev'], ref: 'x', idem: 'i', principal: 'p:x/kernel', sensitivity: 'sensitive' });
    expect(row).toEqual({ kind: 'modns.probe.done', principal: 'p:x/mod-probe', payload: { a: 1 }, sensitivity: 'sensitive' });
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.other.x' })).toThrow(ModRefusal);
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.probe.x', payload: [1] })).toThrow(/plain object/);
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.probe.x', payload: { b: 'x'.repeat(MOD_APPEND_MAX_BYTES) } })).toThrow(/at most/);
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.probe.x', sensitivity: 'public' })).toThrow(/sensitivity/);
  });
});
