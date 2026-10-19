// @gnomon-platform: darwin, linux
/**
 * #mod-host wired into startDaemon (M1.11 slice 2; spec §5, §12.3). POSIX-only
 * (unix socket, POSIX device-key modes); the pure clamp and budget half is
 * test/mod-append-budget.test.ts. Covers: status reports modAbiId + `mods`, the relays are served
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
import { EXAMPLE_MOD, install, writeModFolder, probeManifest } from './mod-helpers.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { createModKernelCall } from '../src/kernel/modhost/index.js';
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

describe('gnomon mod pickup in startDaemon (M1.11 slice 3, #mod-cli)', () => {
  it('a card the CLI staged on disk is raised through the daemon broker and logged approval.request + manifest.staged', async () => {
    const { d, home, root } = await rig();
    cleanups.push(() => removeTree(path.join(home, 'mods'))); // read-only pinned snapshots (removeTree restores write)
    const src = path.join(path.dirname(home), 'hello-src');
    fs.cpSync(EXAMPLE_MOD, src, { recursive: true });
    const out: string[] = [];
    const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
    expect(await runModCommand(['install', src, '--home', home], io, { trust: root })).toBe(0);
    const cardId = /STAGED {2}(card:[0-9A-Z]{26})/.exec(out.join(''))![1]!;
    await d.modPickup.scan();
    await new Promise((r) => setTimeout(r, 50));
    const kinds = [...d.log.read({ reader: { class: 'human' }, kinds: ['approval.request', 'manifest.staged'] })].map((v) => (v.view === 'full' ? v.event.kind : ''));
    expect(kinds).toContain('approval.request');
    expect(kinds).toContain('manifest.staged');
    expect(d.modPickup.raised()).toEqual([cardId]);
  });
});
