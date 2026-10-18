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
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, loadDeviceKey, readKernelPubs, readRegistry, registerDevice, registerKernelKey, RootVerifier, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { startDaemon, type DaemonEvent } from '../src/kernel/lifecycle/index.js';
import { KeyRing, SoftwareEd25519Signer, verifyLog } from '../src/kernel/log/index.js';
import { install, writeModFolder, probeManifest } from './mod-helpers.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { clampModAppend, createModKernelCall, MOD_APPEND_BYTES_PER_CALL, MOD_APPEND_MAX_BYTES, MOD_APPEND_ROWS_PER_SEC, ModRefusal } from '../src/kernel/modhost/index.js';
import type { PrincipalKind } from '@a-company/gnomon-contracts';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function rig(kind: PrincipalKind = 'human', events: DaemonEvent[] = []) {
  const t = tempHome('gmd-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const devKey = writeNewDeviceKey(t.home);
  const entry = registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: devKey.publicKeyPem, principalKind: kind });
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root, onEvent: (e) => void events.push(e) });
  cleanups.push(() => d.shutdown('signal'));
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  const s = await connectGnomon({
    socketPath: d.pidfile.socketPath,
    client: { name: 't', version: '0', surface: 'cli' },
    serverKey: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! },
    device: { principalId: entry.principalId, deviceId: entry.deviceId, signer: loadDeviceKey(t.home) },
  });
  cleanups.push(() => s.conn.close());
  return { d, s, ns: root.ns, home: t.home, root };
}

describe('ModHost in startDaemon (M1.11 slice 2)', () => {
  it('status reports modAbiId and mods; the relays are available to a human device connection', async () => {
    const { s } = await rig();
    const st = (await s.conn.call('status', {})) as { result: Record<string, unknown> };
    expect(st.result.modAbiId).toBe(MOD_ABI_ID);
    expect(st.result.mods).toEqual({ modAbiId: MOD_ABI_ID, running: [], paused: [] });
    expect(st.result.relays).toEqual([expect.objectContaining({ relay: 'mod.view', available: true }), expect.objectContaining({ relay: 'mod.command', available: true })]);
  });

  it('relays: bad params ⇒ BAD_REQUEST before the port; an uninstalled mod is refused NOT_FOUND/not-found and nothing is spawned', async () => {
    const { d, s } = await rig();
    const bad = { error: { data: { code: 'BAD_REQUEST', data: { reason: 'bad-params' } } } };
    expect(await s.conn.call('mod.view', { name: 'probe' })).toMatchObject(bad);
    expect(await s.conn.call('mod.view', { name: '../probe', viewId: 'probe.view' })).toMatchObject(bad);
    expect(await s.conn.call('mod.view', { name: 'Probe', viewId: 'probe.view' })).toMatchObject(bad);
    expect(await s.conn.call('mod.view', { name: 'probe', viewId: `v.${'a'.repeat(200)}` })).toMatchObject(bad);
    expect(await s.conn.call('mod.command', { name: 'probe', commandId: 'Bad Id' })).toMatchObject(bad);
    const f = await s.conn.call('mod.view', { name: 'probe', viewId: 'probe.view', input: {} });
    expect(f).toMatchObject({ error: { data: { code: 'NOT_FOUND', data: { modCode: 'NOT_INSTALLED', reason: 'not-found', name: 'probe' } } } });
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

  it('F4: status.mods goes in full to the human class only; an agent gets counts', async () => {
    const { s } = await rig('agent');
    const st = (await s.conn.call('status', {})) as { result: Record<string, unknown> };
    expect(st.result.mods).toEqual({ modAbiId: MOD_ABI_ID, running: { n: 0 }, paused: { n: 0 } });
  });

  it("B1: the daemon's real kernel.call appends a mod's own modns row as userland under the mod principal, clamped; a relaxed label is refused label-relaxed", async () => {
    const { d, ns } = await rig();
    const p = `p:${ns}/mod-probe`;
    const out = (await d.modKernelCall({ name: 'probe', principal: p, verb: 'log.append', params: { kind: 'modns.probe.x', payload: { a: 1 }, scope: { repo: 'r' }, causes: ['ev:x'], idem: 'i', sensitivity: 'sensitive' } })) as { seq: number };
    expect(out.seq).toBeGreaterThan(0);
    const views = [...d.log.read({ reader: { class: 'human' }, kinds: ['modns.probe.x'] })];
    expect(views).toHaveLength(1);
    const ev = (views[0] as { event: Record<string, unknown> }).event;
    expect(ev).toMatchObject({ kind: 'modns.probe.x', principal: p, payload: { a: 1 }, audience: 'private', sensitivity: 'sensitive' });
    expect(ev.scope).toBeUndefined();
    expect(ev.causes ?? []).toEqual([]);
    expect(ev.idem).toBeUndefined();
    await expect(d.modKernelCall({ name: 'probe', principal: p, verb: 'log.append', params: { kind: 'modns.probe.x', audience: 'team' } })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN', data: { reason: 'label-relaxed' } } });
  });

  it('reviewer: an OFFLINE chain verify accepts the userland row with a mod principal signed by the kernel key', async () => {
    const { d, ns, home } = await rig();
    await d.modKernelCall({ name: 'probe', principal: `p:${ns}/mod-probe`, verb: 'log.append', params: { kind: 'modns.probe.x', payload: { a: 1 } } });
    await d.shutdown('signal');
    const ring = new KeyRing();
    const pubs = readKernelPubs(home);
    for (const k of pubs) ring.addEd25519(k.publicKeyPem);
    const rep = verifyLog(home, { keyRing: ring, kernelPrincipal: d.kernelPrincipal, kernelKeyIds: pubs.map((k) => k.keyId) });
    expect(rep.failures).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('N3: a mod.paused row the log refuses surfaces as daemon.mod.row.unrecorded on the diag channel', async () => {
    const events: DaemonEvent[] = [];
    const { d, home, root } = await rig('human', events);
    const srcRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gmd-src-')));
    cleanups.push(() => fs.rmSync(srcRoot, { recursive: true, force: true }));
    const src = path.join(srcRoot, 'probe');
    install({ root: srcRoot, home, auth: root, events: [], cleanup: async () => undefined }, writeModFolder(src, probeManifest()), { via: 'linked' });
    fs.appendFileSync(path.join(src, 'index.mjs'), '\n// edited\n');
    await d.log.close(); // every append now refuses
    await expect(d.mods.admit('probe')).rejects.toMatchObject({ modCode: 'PAUSED' });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'daemon.mod.row.unrecorded', rowKind: 'mod.paused', name: 'probe' }));
    await d.shutdown('signal');
    removeTree(path.join(home, 'mods')); // pinned snapshots are read-only
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

describe('Aegis F2: the per-mod append budget', () => {
  it(`at most ${MOD_APPEND_ROWS_PER_SEC} rows per second and ${MOD_APPEND_BYTES_PER_CALL} bytes per call; beyond ⇒ LOG and no row`, async () => {
    let t = 1_000_000;
    let written = 0;
    const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: ++written }) }, { now: () => t });
    const append = (payload: Record<string, unknown>, callId?: string) => call({ name: 'probe', principal: 'p:x/mod-probe', verb: 'log.append', params: { kind: 'modns.probe.x', payload }, ...(callId ? { callId } : {}) });
    for (let i = 0; i < MOD_APPEND_ROWS_PER_SEC; i++) await append({ i });
    await expect(append({ i: 'over' })).rejects.toMatchObject({ modCode: 'LOG', detail: { budget: 'rows' } });
    expect(written).toBe(MOD_APPEND_ROWS_PER_SEC);
    t += 1_500;
    const big = { b: 'x'.repeat(15 * 1024) };
    for (let i = 0; i < 4; i++) {
      t += 100;
      await append(big, 'call-1');
    }
    await expect(append(big, 'call-1')).rejects.toMatchObject({ modCode: 'LOG', detail: { budget: 'bytes' } });
    await append(big, 'call-2'); // a new call has its own window
  });
});

describe('reviewer: per-call byte budgets survive other keys', () => {
  it("a call's 64 KiB budget still holds after 300 other keys exist; ending a call drops only its own key", async () => {
    let t = 5_000_000;
    const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: 1 }) }, { now: () => t });
    const big = { b: 'x'.repeat(15 * 1024) };
    const append = (name: string, payload: Record<string, unknown>, callId: string) => call({ name, principal: `p:x/mod-${name}`, verb: 'log.append', params: { kind: `modns.${name}.x`, payload }, callId });
    for (let i = 0; i < 2; i++) await append('probe', big, 'call-1');
    for (let i = 0; i < 300; i++) await append(`m${i}`, { i }, `c-${i}`);
    expect(call.budgetKeys()).toBe(301);
    for (let i = 0; i < 2; i++) await append('probe', big, 'call-1');
    await expect(append('probe', big, 'call-1')).rejects.toMatchObject({ modCode: 'LOG', detail: { budget: 'bytes' } });
    call.endCall('m0', 'c-0');
    expect(call.budgetKeys()).toBe(300);
    await expect(append('probe', big, 'call-1')).rejects.toMatchObject({ detail: { budget: 'bytes' } });
  });
});
