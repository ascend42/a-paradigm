// @gnomon-platform: darwin
/**
 * The darwin `mod` profile under sandbox-exec with a REAL mod child (spec
 * §15.5 row `mod`, §3.8; G-MOD-02 profile half; M1.11 falsifier "a running
 * child reads a byte that was not approved"). Proves, from inside the child:
 * reads outside the pinned snapshot fail (the linked source folder, $HOME,
 * the gnomon home), writes fail (a read-only mod has no file-write at all,
 * even in its state dir), the network fails except through the egress proxy
 * port, and undeclared effects are refused at the RPC boundary. Requires the
 * session floor (macOS 15+ AND SIP); below it the host refuses SANDBOX.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { host, install, probeManifest, rig, writeModFolder } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const floor = darwinFloor();

describe.skipIf(!floor.ok)('the darwin mod profile, enforced (macOS 15+ and SIP)', () => {
  it('a running child reads only its snapshot, writes nothing, and reaches the network only through the proxy', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const folder = writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest());
    fs.writeFileSync(path.join(folder, 'secret.txt'), 'approved-copy'); // in the snapshot too
    install(r, folder, { via: 'linked', egress: ['api.example.com'] });
    fs.writeFileSync(path.join(r.root, 'outside.txt'), 'not approved');
    const listener = net.createServer((s) => s.end());
    await new Promise<void>((res) => listener.listen(0, '127.0.0.1', () => res()));
    const lport = (listener.address() as net.AddressInfo).port;
    cleanups.push(async () => listener.close());
    const target = net.createServer((s) => s.end());
    await new Promise<void>((res) => target.listen(0, '127.0.0.1', () => res()));
    const tport = (target.address() as net.AddressInfo).port;
    cleanups.push(async () => target.close());
    const { h } = host(r, { dial: { resolve: async () => '93.184.216.34', connect: () => net.connect({ host: '127.0.0.1', port: tport }) } });
    cleanups.push(() => h.stopAll());
    const s = await h.start('probe');
    expect(s).toMatchObject({ state: 'running', sandbox: 'full' });
    expect(r.events.find((e) => e.kind === 'mod.sandbox')?.payload).toMatchObject({ profile: 'mod', sandbox: 'full' });
    const snap = s.state === 'running' ? path.join(r.home, 'mods', 'probe', 'pinned', s.packageHash.slice(7)) : '';
    const tool = (input: Record<string, unknown>) => h.callTool('probe', 'probe.read', input);
    // reads: inside the snapshot yes; the linked source folder, an outside file, $HOME and the gnomon grants file no
    expect(await tool({ op: 'fs.read', path: path.join(fs.realpathSync(snap), 'secret.txt') })).toEqual({ ok: true, v: 'approved-copy' });
    for (const p of [path.join(folder, 'secret.txt'), path.join(r.root, 'outside.txt'), path.join(r.home, 'grants.jsonl'), path.join(homedir(), '.zshrc')]) {
      expect(await tool({ op: 'fs.read', path: p }), p).toMatchObject({ ok: false });
    }
    // writes: nowhere, not even its own state dir (no `write` effect in force for the profile? the mod declares write via probe.write)
    for (const p of [path.join(r.root, 'w.txt'), path.join(folder, 'w.txt'), path.join(snap, 'w.txt')]) {
      expect(await tool({ op: 'fs.write', path: p }), p).toMatchObject({ ok: false });
    }
    // network: a direct connect to a loopback listener fails; the proxy tunnels a granted host for a network tool only
    expect(await tool({ op: 'net', host: '127.0.0.1', port: lport })).toMatchObject({ ok: false });
    expect(await h.callTool('probe', 'probe.net', { host: 'api.example.com' })).toEqual({ ok: true, v: 'tunnel' });
    expect(await h.callTool('probe', 'probe.net', { host: 'evil.example.org' })).toMatchObject({ ok: false });
    // undeclared effects: refused at the boundary
    expect(await tool({ op: 'state.set' })).toMatchObject({ ok: false });
  });

  it('a mod with no write and no network effect gets no file-write and no network-outbound in its profile', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const m = probeManifest({ provides: { tools: [{ name: 'probe.read', effects: ['read'] }], events: ['modns.probe.done'] }, requires: { capabilities: ['log.append:modns.probe.*'], egress: 'none' } });
    const folder = writeModFolder(path.join(r.root, 'src', 'probe'), m);
    install(r, folder);
    const { h } = host(r);
    cleanups.push(() => h.stopAll());
    const s = await h.start('probe');
    expect(s).toMatchObject({ state: 'running', egressPort: null });
    const stateFile = path.join(r.home, 'mods', 'probe', 'state', 'x.txt');
    expect(await h.callTool('probe', 'probe.read', { op: 'fs.write', path: stateFile })).toMatchObject({ ok: false });
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});

describe.skipIf(!floor.ok)('Aegis round 2 F1: the mod-writable dirs cannot steer the host or the next profile', () => {
  it('a symlink planted in state/ never reaches the host store; the host-only dir is unwritable; a swapped state/ refuses the next start', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const outside = path.join(r.root, 'outside.txt');
    fs.writeFileSync(outside, 'untouched');
    const { h } = host(r);
    cleanups.push(() => h.stopAll());
    expect(await h.start('probe')).toMatchObject({ state: 'running', sandbox: 'full' });
    const modRoot = path.join(r.home, 'mods', 'probe');
    const w = (input: Record<string, unknown>) => h.callTool('probe', 'probe.write', input);
    // the mod may write its own state/ — including symlinks pointing anywhere
    expect(await w({ op: 'symlink', target: outside, path: path.join(modRoot, 'state', 'state.db') })).toMatchObject({ ok: true });
    expect(await w({ op: 'symlink', target: outside, path: path.join(modRoot, 'state', 'kv.json') })).toMatchObject({ ok: true });
    // the host store (sibling state.db) and its tmp names live where the mod cannot write
    expect(await w({ op: 'fs.write', path: path.join(modRoot, 'state.db') })).toMatchObject({ ok: false });
    expect(await w({ op: 'symlink', target: outside, path: path.join(modRoot, '.state.0000.tmp') })).toMatchObject({ ok: false });
    // the mod cannot swap its own state/ dir (no write on the parent)
    expect(await w({ op: 'rename', from: path.join(modRoot, 'state'), to: path.join(modRoot, 'state.old') })).toMatchObject({ ok: false });
    expect(await w({ op: 'state.set', value: 7 })).toMatchObject({ ok: true });
    expect(await w({ op: 'state.get' })).toEqual({ ok: true, v: '7' });
    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
    expect(fs.lstatSync(path.join(modRoot, 'state.db')).isSymbolicLink()).toBe(false);
    // an outside actor swaps state/ for a link to a fake $HOME: the next start refuses (never a profile granting the link target)
    await h.stop('probe');
    const fakeHome = path.join(r.root, 'fakehome');
    fs.mkdirSync(fakeHome);
    fs.rmSync(path.join(modRoot, 'state'), { recursive: true });
    fs.symlinkSync(fakeHome, path.join(modRoot, 'state'));
    await expect(h.start('probe')).rejects.toMatchObject({ modCode: 'SANDBOX' });
    expect(fs.readdirSync(fakeHome)).toEqual([]);
  });
});

describe.skipIf(!floor.ok)('Aegis round 3: hardlinks and the restart leg', () => {
  it('C1: a sandboxed child cannot hardlink a keys/ file, a $HOME file or ../state.db into state/ (EPERM)', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const keysFile = path.join(r.home, 'keys', 'fake-key.txt');
    fs.mkdirSync(path.dirname(keysFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keysFile, 'harmless test key');
    const homeFile = path.join(homedir(), `.gnomon-m111-link-test-${process.pid}.txt`);
    fs.writeFileSync(homeFile, 'harmless test file');
    cleanups.push(async () => fs.rmSync(homeFile, { force: true }));
    const { h } = host(r);
    cleanups.push(() => h.stopAll());
    expect(await h.start('probe')).toMatchObject({ state: 'running', sandbox: 'full' });
    const w = (input: Record<string, unknown>) => h.callTool('probe', 'probe.write', input);
    expect(await w({ op: 'state.set', value: 1 })).toMatchObject({ ok: true }); // state.db exists
    const modRoot = path.join(r.home, 'mods', 'probe');
    const sources = [keysFile, homeFile, path.join(modRoot, 'state.db')];
    for (const [i, from] of sources.entries()) {
      const res = (await w({ op: 'link', from, to: path.join(modRoot, 'state', `x${i}`) })) as { ok: boolean; code?: string };
      expect(res, from).toEqual({ ok: false, code: 'EPERM' });
      expect(fs.existsSync(path.join(modRoot, 'state', `x${i}`))).toBe(false);
    }
  });

  it('C2: state/ swapped for a symlink while running ⇒ the supervised restart after a crash refuses SANDBOX', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const { h } = host(r);
    cleanups.push(() => h.stopAll());
    await h.start('probe');
    const modRoot = path.join(r.home, 'mods', 'probe');
    const fakeHome = path.join(r.root, 'fakehome');
    fs.mkdirSync(fakeHome);
    fs.rmSync(path.join(modRoot, 'state'), { recursive: true });
    fs.symlinkSync(fakeHome, path.join(modRoot, 'state'));
    await expect(h.callTool('probe', 'probe.read', { op: 'crash' })).rejects.toMatchObject({ modCode: 'CRASHED' });
    await new Promise((res) => setTimeout(res, 1_000));
    expect(h.running()).toEqual([]);
    expect(r.events.some((e) => e.kind === 'mod.health' && e.payload.why === 'sandbox-unavailable')).toBe(true);
    expect(fs.readdirSync(fakeHome)).toEqual([]);
  });
});

describe.skipIf(floor.ok)('below the floor the mod host refuses (never a weaker profile)', () => {
  it('start refuses SANDBOX', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const { h } = host(r);
    await expect(h.start('probe')).rejects.toMatchObject({ modCode: 'SANDBOX' });
  });
});
