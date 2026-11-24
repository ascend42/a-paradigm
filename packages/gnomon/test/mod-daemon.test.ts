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
import { EXAMPLE_MOD, FIRST_PARTY_PROBE, host as modHost, install, installFirstParty, rig as modRig, writeModFolder, probeManifest } from './mod-helpers.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { connectGnomon, createKernelDispatcher, listenSocket, SocketAuthenticator } from '../src/kernel/socket/index.js';
import { createModKernelCall, createModRelayPort, type ModAppendRow } from '../src/kernel/modhost/index.js';
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
    expect(st.result.mods).toMatchObject({ modAbiId: MOD_ABI_ID, running: [], paused: [], publishers: {}, views: [], installed: [] }); // #mods-admin adds installed / available / catalog for the human
    expect(st.result.relays).toEqual([expect.objectContaining({ relay: 'mod.view', available: true }), expect.objectContaining({ relay: 'mod.command', available: true })]);
  });

  it('relays: bad params ⇒ BAD_REQUEST before the port; an uninstalled mod is refused NOT_FOUND/not-found and nothing is spawned', async () => {
    const { d, s } = await rig();
    const bad = { error: { data: { code: 'BAD_REQUEST', data: { reason: 'bad-params' } } } };
    expect(await s.conn.call('mod.view', { name: 'acme.probe' })).toMatchObject(bad);
    expect(await s.conn.call('mod.view', { name: '../probe', viewId: 'probe.view' })).toMatchObject(bad);
    expect(await s.conn.call('mod.view', { name: 'Probe', viewId: 'probe.view' })).toMatchObject(bad);
    expect(await s.conn.call('mod.view', { name: 'acme.probe', viewId: `v.${'a'.repeat(200)}` })).toMatchObject(bad);
    expect(await s.conn.call('mod.command', { name: 'acme.probe', commandId: 'Bad Id' })).toMatchObject(bad);
    const f = await s.conn.call('mod.view', { name: 'acme.probe', viewId: 'probe.view', input: {} });
    expect(f).toMatchObject({ error: { data: { code: 'NOT_FOUND', data: { modCode: 'NOT_INSTALLED', reason: 'not-found', name: 'acme.probe' } } } });
    expect(d.mods.running()).toEqual([]);
    expect(d.children.live()).toBe(0);
  });

  it("a mod's kernel.call reaches the real dispatcher as the mod principal", async () => {
    const { d, ns } = await rig();
    const p = `p:${ns}/mod-acme.probe`;
    const call = createModKernelCall({ callAs: (pr, v, pa) => d.dispatcher.callAs(pr, v, pa), append: async () => ({ seq: 0 }) });
    const st = (await call({ name: 'acme.probe', principal: p, verb: 'status', params: {} })) as Record<string, unknown>;
    expect(st).toMatchObject({ principal: p, principalKind: 'mod', modAbiId: MOD_ABI_ID });
    expect(st.daemon).toBeUndefined(); // own view only
    const page = (await call({ name: 'acme.probe', principal: p, verb: 'log.read', params: {} })) as { projection: string };
    expect(page.projection).toBe('mod');
    await expect(call({ name: 'acme.probe', principal: p, verb: 'log.read', params: { follow: true } })).rejects.toMatchObject({ refusal: { data: { reason: 'bad-follow' } } });
    await expect(d.dispatcher.callAs(p, 'log.append', { kind: 'modns.acme.probe.x' })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(call({ name: 'acme.probe', principal: p, verb: 'session.send', params: { hsid: 'h' }, hsid: 'h' })).rejects.toMatchObject({ refusal: { code: 'ENGINE' } });
  });

  it('F4: status.mods goes in full to the human class only; an agent gets counts', async () => {
    const { s } = await rig('agent');
    const st = (await s.conn.call('status', {})) as { result: Record<string, unknown> };
    expect(st.result.mods).toEqual({ modAbiId: MOD_ABI_ID, running: { n: 0 }, paused: { n: 0 } });
  });

  it("B1: the daemon's real kernel.call appends a mod's own modns row as userland under the mod principal, clamped; a relaxed label is refused label-relaxed", async () => {
    const { d, ns } = await rig();
    const p = `p:${ns}/mod-acme.probe`;
    const out = (await d.modKernelCall({ name: 'acme.probe', principal: p, verb: 'log.append', params: { kind: 'modns.acme.probe.x', payload: { a: 1 }, scope: { repo: 'r' }, causes: ['ev:x'], idem: 'i', sensitivity: 'sensitive' } })) as { seq: number };
    expect(out.seq).toBeGreaterThan(0);
    const views = [...d.log.read({ reader: { class: 'human' }, kinds: ['modns.acme.probe.x'] })];
    expect(views).toHaveLength(1);
    const ev = (views[0] as { event: Record<string, unknown> }).event;
    expect(ev).toMatchObject({ kind: 'modns.acme.probe.x', principal: p, payload: { a: 1 }, audience: 'private', sensitivity: 'sensitive' });
    expect(ev.scope).toBeUndefined();
    expect(ev.causes ?? []).toEqual([]);
    expect(ev.idem).toBeUndefined();
    await expect(d.modKernelCall({ name: 'acme.probe', principal: p, verb: 'log.append', params: { kind: 'modns.acme.probe.x', audience: 'team' } })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN', data: { reason: 'label-relaxed' } } });
  });

  it('G-MOD-17 row scope: the real log takes the host-stamped scope.repo on a userland mod row, a scope filter finds it, and the chain verifies offline', async () => {
    const { d, ns, home } = await rig();
    const p = `p:${ns}/mod-gnomon.probe`;
    const repo = 'repo:0123456789abcdef';
    const stamp = { relayedFor: { principal: `p:${ns}/founder`, connId: 'conn-7', surface: 'gui' }, scope: { repo } };
    // the mod supplies ANOTHER scope: only the stamp's reaches the envelope
    await d.modKernelCall({ name: 'gnomon.probe', principal: p, verb: 'log.append', params: { kind: 'modns.gnomon.probe.x', payload: { a: 1 }, scope: { repo: 'repo:fedcba9876543210' } }, stamp });
    await d.modKernelCall({ name: 'gnomon.probe', principal: p, verb: 'log.append', params: { kind: 'modns.gnomon.probe.x', payload: { a: 2 }, scope: { repo } }, stamp: { relayedFor: stamp.relayedFor } });
    const events = [...d.log.read({ reader: { class: 'human' }, kinds: ['modns.gnomon.probe.x'] })].map((v) => (v as { event: Record<string, unknown> }).event);
    expect(events.map((e) => e.scope)).toEqual([{ org: null, team: null, repo }, undefined]);
    expect(events[0]).toMatchObject({ principal: p, payload: { a: 1, relayedFor: stamp.relayedFor } });
    await d.shutdown('signal');
    const ring = new KeyRing();
    const pubs = readKernelPubs(home);
    for (const k of pubs) ring.addEd25519(k.publicKeyPem);
    const rep = verifyLog(home, { keyRing: ring, kernelPrincipal: d.kernelPrincipal, kernelKeyIds: pubs.map((k) => k.keyId) });
    expect(rep.failures).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('reviewer: an OFFLINE chain verify accepts the userland row with a mod principal signed by the kernel key', async () => {
    const { d, ns, home } = await rig();
    await d.modKernelCall({ name: 'acme.probe', principal: `p:${ns}/mod-acme.probe`, verb: 'log.append', params: { kind: 'modns.acme.probe.x', payload: { a: 1 } } });
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
    const src = path.join(srcRoot, 'acme.probe');
    install({ root: srcRoot, home, auth: root, events: [], cleanup: async () => undefined }, writeModFolder(src, probeManifest()), { via: 'linked' });
    fs.appendFileSync(path.join(src, 'index.mjs'), '\n// edited\n');
    await d.log.close(); // every append now refuses
    await expect(d.mods.admit('acme.probe')).rejects.toMatchObject({ modCode: 'PAUSED' });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'daemon.mod.row.unrecorded', rowKind: 'mod.paused', name: 'acme.probe' }));
    await d.shutdown('signal');
    removeTree(path.join(home, 'mods')); // pinned snapshots are read-only
  });

  it('shutdown stops the mod host (no restart can race the children sweep)', async () => {
    const { d } = await rig();
    await d.shutdown('idle');
    await expect(d.mods.start('acme.probe')).rejects.toMatchObject({ modCode: 'NOT_RUNNING' });
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

/*
 * S1.3 P1 (Aegis B4): the read cap per caller class over REAL unix-socket connections. Each class is a registered
 * device key that does hello + auth against the real dispatcher (the daemon's own mod launcher is sandboxed, so the
 * dispatcher here is stood up beside a mod host on the unsandboxed launcher seam; everything between the socket and
 * the mod is the real code). The GUI credential is a WebSocket launch token: test/relay-gesture.test.ts.
 */
describe('G-MOD-17: the command read cap over a real unix socket, per caller class', () => {
  it('human on a device key (cli), agent, session, voice and mod: every command is read-only for both mods; no row, no state; a gesture stamp buys nothing', async () => {
    const r = modRig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'acme.probe'), probeManifest()));
    installFirstParty(r);
    const rows: ModAppendRow[] = [];
    const LIVE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
    const { h } = modHost(r, { launcher: unsandboxedModLauncher }, { kernelCall: createModKernelCall({ callAs: async () => ({}), append: async (row) => (rows.push(row), { seq: rows.length }) }), callTimeoutMs: 10_000, focusRepo: (hsid) => (hsid === LIVE ? 'repo:0123456789abcdef' : null), focusPrincipal: () => null });
    cleanups.push(() => h.stopAll());
    await h.start('acme.probe');
    await h.start(FIRST_PARTY_PROBE);

    const t = tempHome('gmc-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    registerKernelKey(t.home, root, kernel.publicKeyPem);
    const classes: Array<[PrincipalKind, string]> = [['human', 'founder'], ['agent', 'kit'], ['session', 's-01hzzzzz'], ['voice', 'voice'], ['mod', 'mod-acme.other']];
    const creds = classes.map(([kind, name], i) => {
      const signer = SoftwareEd25519Signer.generate('device');
      const entry = registerDevice(t.home, root, { host: `mac-${i + 1}`, name, publicKeyPem: signer.publicKeyPem, principalKind: kind });
      return { kind, cred: { principalId: entry.principalId, deviceId: entry.deviceId, signer } };
    });
    const sock = path.join(t.home, 'g.sock');
    const authed: Array<{ connId: unknown; principal: unknown; principalKind: unknown }> = [];
    const dispatcher = createKernelDispatcher({
      authenticator: new SocketAuthenticator({ home: t.home, endpointPath: sock, kernelSigner: kernel, trust: root }),
      status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: root.rootKeyId }) },
      mods: createModRelayPort(h),
      log: async (k, p, ids) => void (k === 'socket.auth.ok' && authed.push({ connId: ids?.connId, principal: p.principal, principalKind: p.principalKind })),
    });
    const srv = await listenSocket({ socketPath: sock, handle: dispatcher.handle, onConnect: dispatcher.onConnect, onDisconnect: dispatcher.onDisconnect });
    cleanups.push(() => srv.close());
    const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
    const serverKey = { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! };

    type Out = { result?: { result?: { relayedFor?: Record<string, string>; out?: { ok: boolean; keys?: string[]; hsid?: unknown; repo?: unknown; gesture?: unknown } } }; error?: unknown };
    const state = async (name: string): Promise<unknown> => ((await h.callTool(name, 'probe.read', { op: 'state.get' })) as { v?: string }).v;
    const before = { 'acme.probe': await state('acme.probe'), [FIRST_PARTY_PROBE]: await state(FIRST_PARTY_PROBE) };
    const seen: unknown[][] = [];
    for (const { kind, cred } of creds) {
      const s = await connectGnomon({ socketPath: sock, client: { name: 't', version: '0', surface: 'cli' }, serverKey, device: cred });
      cleanups.push(() => s.conn.close());
      // the class the KERNEL authenticated this connection as: its own socket.auth.ok row for this connId (status is refused for some classes)
      expect(authed.filter((x) => x.connId === s.connId)).toEqual([{ connId: s.connId, principal: cred.principalId, principalKind: kind }]);
      for (const name of [FIRST_PARTY_PROBE, 'acme.probe']) {
        // a stamp, a forged relayedFor and a focus on a live session ride along: none of them earns a write
        const call = async (args: Record<string, unknown>): Promise<Out> => (await s.conn.call('mod.command', { name, commandId: 'probe.who', args: { ...args, gesture: { n: 1, kind: 'pointer' }, focus: { hsid: LIVE } }, relayedFor: { principal: 'p:evil/x', surface: 'gui' } })) as Out;
        const append = await call({ op: 'append.forged' });
        const set = await call({ op: 'state.set', value: `${kind} ${name}` });
        const get = await call({ op: 'state.get' });
        const args = await call({ op: 'args' });
        expect(append.error).toBeUndefined();
        seen.push([kind, name, append.result?.result?.relayedFor?.principal === cred.principalId, append.result?.result?.relayedFor?.surface, append.result?.result?.out?.ok, set.result?.result?.out?.ok, get.result?.result?.out?.ok, args.result?.result?.out?.keys, args.result?.result?.out?.gesture]);
      }
    }
    // class, mod, relayedFor.principal is the connection's, surface the mod was told, append, state.set, state.get, arg keys, gesture
    const row = (kind: string, name: string, surface: string | undefined, keys: string[] = ['op']): unknown[] => [kind, name, true, surface, false, false, true, keys, null];
    expect(seen).toEqual([
      row('human', FIRST_PARTY_PROBE, 'cli', ['op', 'hsid', 'repo']), // a human may join a live focus; it is still read-only
      row('human', 'acme.probe', 'cli'),
      row('agent', FIRST_PARTY_PROBE, undefined),
      row('agent', 'acme.probe', undefined),
      row('session', FIRST_PARTY_PROBE, undefined),
      row('session', 'acme.probe', undefined),
      row('voice', FIRST_PARTY_PROBE, undefined),
      row('voice', 'acme.probe', undefined),
      row('mod', FIRST_PARTY_PROBE, undefined),
      row('mod', 'acme.probe', undefined),
    ]);
    expect(rows).toEqual([]);
    expect({ 'acme.probe': await state('acme.probe'), [FIRST_PARTY_PROBE]: await state(FIRST_PARTY_PROBE) }).toEqual(before);
    // the human on a device key may join a live session's focus (the first-party mod is told hsid and repo): still read-only
    const cli = await connectGnomon({ socketPath: sock, client: { name: 't', version: '0', surface: 'cli' }, serverKey, device: creds[0]!.cred });
    cleanups.push(() => cli.conn.close());
    const joined = (await cli.conn.call('mod.command', { name: FIRST_PARTY_PROBE, commandId: 'probe.who', args: { op: 'args', focus: { hsid: LIVE } } })) as Out;
    expect(joined.result?.result?.out).toMatchObject({ keys: ['op', 'hsid', 'repo'], hsid: LIVE, repo: 'repo:0123456789abcdef' });
  }, 60_000);
});
