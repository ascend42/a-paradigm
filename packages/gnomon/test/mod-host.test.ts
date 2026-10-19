/**
 * #mod-host (spec §3.8, §12.1–§12.3; §19.1 M1.11) — the platform-independent
 * half: mod-abi:v1 lifecycle over stdio, declared-effect enforcement at the
 * RPC boundary, relays stamping relayedFor, the closed-kit gate, crash
 * containment and restart, cancel/timeout restart, the pin (a changed linked
 * folder pauses instead of loading) and the egress proxy's refusals. Children
 * run WITHOUT the `mod` profile here (createModHostForTest +
 * unsandboxedModLauncher); the profile itself is test/mod-sandbox.test.ts
 * (darwin). Falsifiers (M1.11 row): "a mod exceeds its declared effects";
 * "a changed linked folder loads without a card".
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRefusalV1, MOD_ABI_ID, RefusedError, refuse } from '@a-company/gnomon-contracts';
import { ModRefusal, sanitizeModBlock, EgressProxy, isNonPublicAddress } from '../src/kernel/modhost/index.js';
import { modLaunchPlan } from '../src/kernel/sandbox/mod.js';
import { createModHostForTest, unsandboxedModLauncher } from '../src/kernel/testing.js';
import { ModChannel } from '../src/kernel/modhost/channel.js';
import { EXAMPLE_MOD, host, install, PROBE_SOURCE, probeManifest, rig, writeModFolder, type Rig } from './mod-helpers.js';
import { appendGrantRow, effectiveInstall, readGrants } from '../src/kernel/manifest/index.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function started(opts: { linked?: boolean; egress?: string[] } = {}) {
  const r = rig();
  cleanups.push(r.cleanup);
  const folder = writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest());
  install(r, folder, { via: opts.linked ? 'linked' : 'package', egress: opts.egress ?? ['api.example.com'] });
  const { h } = host(r, { launcher: unsandboxedModLauncher });
  cleanups.push(() => h.stopAll());
  const s = await h.start('probe');
  return { r, h, s, folder };
}

async function refused(p: Promise<unknown>): Promise<ModRefusal> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ModRefusal) {
      expect(isRefusalV1(err.refusal)).toBe(true);
      return err;
    }
    throw err;
  }
  throw new Error('expected a ModRefusal');
}

const kinds = (r: Rig) => r.events.map((e) => e.kind);

describe('mod-abi:v1 lifecycle (§12.3, G-MOD-01)', () => {
  it('starts from the pinned snapshot, negotiates init with this modAbiId, logs mod.sandbox and mod.health', async () => {
    const { r, h, s } = await started();
    expect(s).toMatchObject({ state: 'running', name: 'probe', sandbox: 'none' });
    expect(MOD_ABI_ID).toMatch(/^sha256:/);
    expect(kinds(r)).toEqual(expect.arrayContaining(['manifest.load', 'mod.sandbox', 'mod.health']));
    expect(await h.health('probe')).toBe(true);
    await h.stop('probe', 'test');
    expect(r.events.find((e) => e.kind === 'mod.stopped')?.payload).toMatchObject({ name: 'probe', reason: 'test' });
    expect(h.running()).toEqual([]);
  });

  it('the example mod (packages/gnomon-mod-sdk/example/hello) renders, runs its command and keeps state', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const folder = path.join(r.root, 'hello');
    fs.cpSync(EXAMPLE_MOD, folder, { recursive: true });
    writeModFolder(folder, JSON.parse(fs.readFileSync(path.join(EXAMPLE_MOD, 'gnomon-manifest.json'), 'utf8')), fs.readFileSync(path.join(EXAMPLE_MOD, 'index.mjs'), 'utf8'));
    install(r, folder);
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    await h.start('hello');
    expect(await h.relayCommand({ name: 'hello', commandId: 'hello.bump', principal: 'p:abcdefgh/matt', connId: 'c1' })).toEqual({ count: 1 });
    const v = await h.relayView({ name: 'hello', viewId: 'hello.panel', input: { name: 'matt' }, principal: 'p:abcdefgh/matt', connId: 'c1' });
    expect(v.label).toBe('mod:hello');
    expect(JSON.stringify(v.block)).toContain('hello, matt');
  });
});

describe('declared effects at the RPC boundary (G-MOD-02; falsifier: a mod exceeds its declared effects)', () => {
  it('a read tool cannot state.set; a write tool can; refusals log mod.effect.refused', async () => {
    const { r, h } = await started();
    expect(await h.callTool('probe', 'probe.read', { op: 'state.set' })).toMatchObject({ ok: false });
    expect(r.events.find((e) => e.kind === 'mod.effect.refused')?.payload).toMatchObject({ name: 'probe', effect: 'write', method: 'state.set' });
    expect(await h.callTool('probe', 'probe.write', {})).toMatchObject({ ok: true });
    expect(await h.callTool('probe', 'probe.read', { op: 'state.get' })).toEqual({ ok: true, v: '2' });
  });

  it('approve is never proxied; log.append needs write; an undeclared tool/view/command is refused', async () => {
    const { r, h } = await started();
    expect(await h.callTool('probe', 'probe.read', { op: 'approve' })).toMatchObject({ ok: false });
    expect(r.events.filter((e) => e.kind === 'mod.effect.refused').map((e) => e.payload.effect)).toContain('approve');
    expect(await h.callTool('probe', 'probe.read', { op: 'append' })).toMatchObject({ ok: false }); // write outside a read tool
    expect((await refused(h.callTool('probe', 'probe.nope', {}))).modCode).toBe('UNDECLARED');
    expect((await refused(h.render('probe', 'other.view', {}))).modCode).toBe('UNDECLARED');
  });
});

describe('relays stamp relayedFor (§12.2/§12.3)', () => {
  it('the command receives the host-stamped principal/connId, never a client-chosen one', async () => {
    const { h } = await started();
    const out = await h.relayCommand({ name: 'probe', commandId: 'probe.who', args: { relayedFor: { principal: 'p:evil/x', connId: 'z' } }, principal: 'p:abcdefgh/matt', connId: 'conn-7' });
    expect(out).toEqual({ relayedFor: { principal: 'p:abcdefgh/matt', connId: 'conn-7' } });
  });
});

describe('closed kit gate (§12.2)', () => {
  it('refuses non-kit nodes, unknown keys, oversize blocks and an Image without alt', async () => {
    const { h } = await started();
    expect((await refused(h.render('probe', 'probe.view', { raw: { schemaVersion: 'display-block:v1', type: 'Html', html: '<script>' } }))).modCode).toBe('BLOCK');
    expect(() => sanitizeModBlock({ schemaVersion: 'display-block:v1', type: 'Text', text: 'x', onclick: 'y' }, 'm')).toThrow(ModRefusal);
    expect(() => sanitizeModBlock({ schemaVersion: 'display-block:v1', type: 'Image', blob: `sha256:${'a'.repeat(64)}`, alt: ' ', w: 1, h: 1 }, 'm')).toThrow(/alt/);
    expect(() => sanitizeModBlock({ schemaVersion: 'display-block:v1', type: 'Text', text: 'x'.repeat(300 * 1024) }, 'm')).toThrow(/exceeds/);
    const ok = await h.render('probe', 'probe.view', {});
    expect(ok).toMatchObject({ label: 'mod:probe', dev: false, block: { schemaVersion: 'display-block:v1', type: 'Text', text: 'hi' } });
  });
});

describe('supervision (G-MOD-03, §12.3 cancel)', () => {
  it('a crashing mod never takes the host down and is restarted (cap 3 / 10 min)', async () => {
    const { r, h } = await started();
    await refused(h.callTool('probe', 'probe.read', { op: 'crash' }));
    await new Promise((res) => setTimeout(res, 800));
    expect(r.events.some((e) => e.kind === 'mod.health' && e.payload.ok === false)).toBe(true);
    expect(h.restarts('probe')).toBe(1);
    expect(await h.callTool('probe', 'probe.read', { op: 'state.get' })).toMatchObject({ ok: true });
  });

  it('a call past its timeout is cancelled, and an unhonoured cancel restarts the child', async () => {
    const { h } = await started();
    const e = await refused(h.callTool('probe', 'probe.read', { op: 'hang' }, { timeoutMs: 300 }));
    expect(e.modCode).toBe('TIMEOUT');
    expect(e.detail.honoured).toBe(false);
    expect(h.restarts('probe')).toBe(1);
    expect(await h.health('probe')).toBe(true);
  });
});

describe('the pin (G-MOD-05 / G-MOD-08; falsifier: a changed linked folder loads without a card)', () => {
  it('an edited linked folder pauses the mod on its next load and stages a re-approve card', async () => {
    const { r, h, folder } = await started({ linked: true });
    await h.stop('probe');
    fs.appendFileSync(path.join(folder, 'index.mjs'), '\n// edited\n');
    const s = await h.start('probe');
    expect(s).toMatchObject({ state: 'paused', why: 'changed' });
    expect(s.state === 'paused' && s.cardId).toMatch(/^card:/);
    expect(kinds(r)).toContain('mod.paused');
    expect((await refused(h.callTool('probe', 'probe.read', {}))).modCode).toBe('PAUSED');
  });
});

describe('egress proxy (§3.8, §15.4 grant.egress)', () => {
  const connect = (port: number, target: string): Promise<string> =>
    new Promise((res) => {
      const s = net.connect({ host: '127.0.0.1', port }, () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
      s.once('data', (d) => {
        res(d.toString().split('\r\n')[0]!);
        s.destroy();
      });
      s.on('error', () => res('error'));
    });

  it('tunnels only granted hosts on 443; refuses IP literals, Anthropic, ungranted, other ports and private resolutions', async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const target = net.createServer((s) => s.end());
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
    const tport = (target.address() as net.AddressInfo).port;
    let resolved = '93.184.216.34';
    const p = new EgressProxy({ name: 'probe', hosts: new Set(['api.example.com']), emit: (_k, pl) => void emitted.push(pl), dial: { resolve: async () => resolved, connect: () => net.connect({ host: '127.0.0.1', port: tport }) } });
    const port = await p.listen();
    cleanups.push(async () => {
      await p.close();
      target.close();
    });
    expect(await connect(port, 'api.example.com:443')).toMatch(/200/);
    expect(await connect(port, '93.184.216.34:443')).toMatch(/403/);
    expect(await connect(port, 'api.anthropic.com:443')).toMatch(/403/);
    expect(await connect(port, 'evil.example.org:443')).toMatch(/403/);
    expect(await connect(port, 'api.example.com:80')).toMatch(/403/);
    resolved = '127.0.0.1';
    expect(await connect(port, 'api.example.com:443')).toMatch(/403/);
    expect(emitted.map((e) => e.why)).toEqual(['numeric', 'anthropic', 'ungranted', 'port', 'private-address']);
    for (const a of ['::ffff:10.0.0.1', '198.18.0.1', '192.0.0.8', '192.0.2.1', '198.51.100.7', '203.0.113.9', '64:ff9b::7f00:1', '::127.0.0.1', 'fec0::1', 'fe80::1', 'fd00::1', '2002:7f00:1::1', '::', '::1']) expect(isNonPublicAddress(a), a).toBe(true);
    for (const a of ['93.184.216.34', '2606:4700::1111', '64:ff9b::5db8:d822', '::ffff:93.184.216.34']) expect(isNonPublicAddress(a), a).toBe(false);
  });

  it('a tool without `network` cannot open a tunnel even though the mod has a proxy', async () => {
    const { r, h, s } = await started();
    expect(s.state === 'running' && s.egressPort).toBeGreaterThan(0);
    expect(await h.callTool('probe', 'probe.read', { op: 'egress', host: 'api.example.com' })).toMatchObject({ ok: false });
    expect(r.events.find((e) => e.kind === 'mod.effect.refused' && e.payload.why === 'effect')).toBeTruthy();
  });
});

describe('round 2 (Aegis F2, reviewer #5)', () => {
  async function withTarget() {
    const target = net.createServer((s) => s.on('data', () => undefined));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
    const tport = (target.address() as net.AddressInfo).port;
    cleanups.push(async () => void target.close());
    return { resolve: async () => '93.184.216.34', connect: () => net.connect({ host: '127.0.0.1', port: tport }) };
  }

  it('F2: a tunnel opened in a network tool is dead when the next tool starts', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()), { egress: ['api.example.com'] });
    const { h } = host(r, { launcher: unsandboxedModLauncher, dial: await withTarget() });
    cleanups.push(() => h.stopAll());
    await h.start('probe');
    expect(await h.callTool('probe', 'probe.net', { op: 'hold', host: 'api.example.com' })).toEqual({ ok: true, v: 'held' });
    await new Promise((res) => setTimeout(res, 100));
    expect(await h.callTool('probe', 'probe.read', { op: 'held' })).toEqual({ ok: true, v: 'true' });
  });

  it('kernel.call success path with a stub kernel: declared log.append in a write tool; session.send stamps the caller hsid and strips permitId', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const calls: unknown[] = [];
    const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: async (req) => (calls.push(req), { seq: 1 }) });
    cleanups.push(() => h.stopAll());
    await h.start('probe');
    expect(await h.callTool('probe', 'probe.write', { op: 'append' })).toEqual({ ok: true, v: '{"seq":1}' });
    expect(calls[0]).toMatchObject({ verb: 'log.append', principal: expect.stringMatching(/\/mod-probe$/), params: { kind: 'modns.probe.done' } });
    expect(await h.callTool('probe', 'probe.spend', { op: 'send' })).toMatchObject({ ok: false }); // no caller hsid
    expect(await h.callTool('probe', 'probe.spend', { op: 'send', params: { hsid: 'other', content: [] } }, { hsid: 'hs-1' })).toMatchObject({ ok: false });
    expect(await h.callTool('probe', 'probe.spend', { op: 'send', params: { content: [], permitId: 'mine' } }, { hsid: 'hs-1' })).toMatchObject({ ok: true });
    expect(calls[1]).toMatchObject({ verb: 'session.send', hsid: 'hs-1', params: { hsid: 'hs-1' } });
    expect((calls[1] as { params: Record<string, unknown> }).params.permitId).toBeUndefined();
    expect(await h.callTool('probe', 'probe.write', { op: 'send', params: {} }, { hsid: 'hs-1' })).toMatchObject({ ok: false }); // spend not declared there
  });

  it('dev mode caps effects at read; an expired dev period pauses the mod', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const row = effectiveInstall(readGrants(r.home, r.auth), 'probe')!;
    const { schemaVersion: _s, createdAt: _c, ...rest } = row;
    appendGrantRow(r.home, r.auth, { ...rest, dev: { until: new Date(Date.now() + 3_600_000).toISOString() } });
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    const s = await h.start('probe');
    expect(s).toMatchObject({ state: 'running', dev: true, effects: ['read'], egressPort: null });
    expect(await h.callTool('probe', 'probe.write', {})).toMatchObject({ ok: false });
    expect((await h.render('probe', 'probe.view', {})).dev).toBe(true);
    await h.stop('probe');
    const { h: later } = host(r, { launcher: unsandboxedModLauncher }, { now: () => Date.now() + 2 * 3_600_000 });
    cleanups.push(() => later.stopAll());
    expect(await later.start('probe')).toMatchObject({ state: 'paused', why: 'dev-expired' });
    expect(kinds(r)).toContain('mod.dev.expired');
  });

  it('an init answering another modAbiId is refused ABI and the child stopped', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const raw = `process.stdin.on('data', (b) => { for (const l of String(b).split('\\n').filter(Boolean)) { const m = JSON.parse(l); if (m.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { abi: 'mod-abi:v1', features: [], modAbiId: 'sha256:${'0'.repeat(64)}' } }) + '\\n'); } });`;
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest(), raw));
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    expect((await refused(h.start('probe'))).modCode).toBe('ABI');
    expect(h.running()).toEqual([]);
  });

  it('malformed and oversize NDJSON from a mod is dropped and counted; the mod keeps working', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const src = PROBE_SOURCE.replace("import { serveMod } from './gnomon-mod-sdk.mjs';", "import { serveMod } from './gnomon-mod-sdk.mjs';\nprocess.stdout.write('not json\\n' + 'x'.repeat(2 * 1024 * 1024) + '\\n[1]\\n');");
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest(), src));
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    await h.start('probe');
    expect(await h.health('probe')).toBe(true);
    expect(h.inspect('probe').protocolErrors).toBe(3);
  });

  it('the restart cap: after 3 restarts in 10 min the mod stays down and mod.health{restart-cap} is logged', async () => {
    const { r, h } = await started();
    for (let i = 0; i < 4; i++) {
      await refused(h.callTool('probe', 'probe.read', { op: 'crash' }));
      await new Promise((res) => setTimeout(res, 700));
    }
    expect(h.restarts('probe')).toBe(3);
    expect(h.running()).toEqual([]);
    expect(r.events.some((e) => e.kind === 'mod.health' && e.payload.why === 'restart-cap')).toBe(true);
  });
});

describe('round 3 (reviewer)', () => {
  it('a child that cannot be tracked is killed and the start refused CRASHED', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    let pid: number | undefined;
    const children = {
      track: async (i: { child: ChildProcess }) => {
        pid = i.child.pid;
        throw new Error('no');
      },
      stop: async () => false,
    };
    const h = createModHostForTest({ home: r.home, trust: r.auth, children: children as never, emit: (kind, payload) => r.events.push({ kind, payload }) }, { launcher: unsandboxedModLauncher });
    expect((await refused(h.start('probe'))).modCode).toBe('CRASHED');
    expect(h.running()).toEqual([]);
    await new Promise((res) => setTimeout(res, 200));
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it('stopAll waits for an in-flight start: no child outlives it', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const { h, children } = host(r, { launcher: unsandboxedModLauncher });
    const p = h.start('probe').catch((e: unknown) => e);
    await h.stopAll();
    await p;
    expect(h.running()).toEqual([]);
    expect(children.live()).toBe(0);
  });

  it('a mod flooding state.get gets at most 8 requests in flight in the host (16 on the channel); the rest are refused BUSY', async () => {
    const { h } = await started();
    const out = (await h.callTool('probe', 'probe.read', { op: 'flood' })) as { ok: number; busy: number };
    expect(out.ok + out.busy).toBe(40);
    expect(out.busy).toBeGreaterThan(0);
    expect(out.ok).toBeGreaterThanOrEqual(8);
  });

  it('backpressure: while the mod stdin does not drain, the host stops reading its stdout (one drain listener)', async () => {
    const stdin = new Writable({ highWaterMark: 1, write: (_c, _e, cb) => setTimeout(cb, 50) });
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough() }) as unknown as ChildProcess;
    const ch = new ModChannel(child, async () => ({ value: 1 }));
    for (let i = 1; i <= 3; i++) stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method: 'state.get', params: { key: 'k' } })}\n`);
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
    expect(stdout.isPaused()).toBe(true);
    expect(stdin.listenerCount('drain')).toBeLessThanOrEqual(2); // ours (one) + the stream's own
    await new Promise((res) => setTimeout(res, 400));
    expect(stdout.isPaused()).toBe(false);
    ch.close(new Error('done'));
  });
});

describe('the mod profile registry (G-WIN-05)', () => {
  it('refuses sandbox-unavailable where no backend exists (fail closed)', () => {
    for (const platform of ['linux', 'win32']) {
      expect(() => modLaunchPlan({ home: '/h', name: 'm', snapshotDir: '/s', entry: '/s/index.mjs', stateDir: '/st', blobsDir: '/b', readPaths: [], write: false, proxyPort: null, denyRead: [], env: {} }, platform)).toThrow(
        expect.objectContaining({ reason: 'sandbox-unavailable' }),
      );
    }
  });
});

describe('call-id binding (M1.11 slice 2, Aegis)', () => {
  it('a request echoing an ENDED call is refused CALL even when the call in force would allow it; mod.effect.refused{why:call-id}', async () => {
    const { r, h } = await started();
    expect(await h.callTool('probe', 'probe.write', { op: 'keep' })).toEqual({ ok: true, v: 'kept' });
    // the kept api echoes the write call's id; that call has ended, and a later write tool is in force
    expect(await h.callTool('probe', 'probe.write', { op: 'stale' })).toMatchObject({ ok: false });
    expect(await h.callTool('probe', 'probe.read', { op: 'stale.get' })).toMatchObject({ ok: false });
    const refusedRows = r.events.filter((e) => e.kind === 'mod.effect.refused' && e.payload.why === 'call-id');
    expect(refusedRows.length).toBe(2);
    expect(refusedRows[0]!.payload).toMatchObject({ name: 'probe', method: 'state.set', effect: 'call-id' });
    // the live call's own id still works
    expect(await h.callTool('probe', 'probe.write', {})).toMatchObject({ ok: true });
  });
});

describe('folder watch (G-MOD-08, slice 2)', () => {
  it('an edit to a RUNNING linked mod\'s folder stops it within the debounce and pauses it with a re-approve card', async () => {
    const { r, h, folder } = await started({ linked: true });
    expect(h.watching()).toEqual(['probe']);
    // FSEvents on a loaded CI runner can coalesce or drop the first event: edit again every 2 s, up to 15 s.
    // Security does not rest on the watch (every start re-hashes the folder); this checks the prompt stop.
    for (let i = 0; i < 150 && h.running().length; i++) {
      if (i % 20 === 0) fs.appendFileSync(path.join(folder, 'index.mjs'), `\n// edited while running ${i}\n`);
      await new Promise((res) => setTimeout(res, 100));
    }
    for (let i = 0; i < 20 && !kinds(r).includes('mod.paused'); i++) await new Promise((res) => setTimeout(res, 100));
    expect(h.running()).toEqual([]);
    expect(r.events.find((e) => e.kind === 'mod.stopped' && e.payload.reason === 'changed')).toBeTruthy();
    expect(kinds(r)).toContain('mod.paused');
    expect(h.status()).toMatchObject({ paused: [expect.objectContaining({ name: 'probe', why: 'changed' })] });
    expect(h.watching()).toEqual([]);
  });
});

describe('relay admission (Aegis F1) and in-flight cap (F2), round 2', () => {
  it('an uninstalled name is refused NOT_INSTALLED without loadMod; misses beyond 8 per window fold into one counter row', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    for (let i = 0; i < 11; i++) {
      const e = await refused(h.admit(`ghost-${i % 2}`));
      expect(e.modCode).toBe('NOT_INSTALLED');
      expect(e.refusal).toMatchObject({ code: 'NOT_FOUND', data: { modCode: 'NOT_INSTALLED', reason: 'not-found' } });
    }
    h.flushRelayMisses();
    const rows = r.events.filter((e) => e.kind === 'manifest.refuse');
    expect(rows.filter((e) => !e.payload.coalesced).length).toBe(8);
    expect(rows.filter((e) => e.payload.coalesced)).toEqual([{ kind: 'manifest.refuse', payload: expect.objectContaining({ count: 3, via: 'relay' }) }]);
    expect(kinds(r)).not.toContain('manifest.load');
  });

  it('a paused mod is answered from memory (no loadMod, no second card); a relay start counts against RESTART_CAP; DOWN until an operator start', async () => {
    const { r, h, folder } = await started({ linked: true });
    await h.stop('probe');
    fs.appendFileSync(path.join(folder, 'index.mjs'), '\n// edited\n');
    expect(await h.start('probe')).toMatchObject({ state: 'paused' });
    const staged = r.events.filter((e) => e.kind === 'manifest.staged').length;
    for (let i = 0; i < 3; i++) expect((await refused(h.admit('probe'))).modCode).toBe('PAUSED');
    expect(r.events.filter((e) => e.kind === 'manifest.staged').length).toBe(staged);

    const { h: h2 } = await started();
    await h2.stop('probe');
    await h2.admit('probe'); // a relay-triggered start
    expect(h2.restarts('probe')).toBe(1);
    for (let i = 0; i < 2; i++) {
      await refused(h2.callTool('probe', 'probe.read', { op: 'crash' }));
      await new Promise((res) => setTimeout(res, 700));
    }
    await refused(h2.callTool('probe', 'probe.read', { op: 'crash' }));
    await new Promise((res) => setTimeout(res, 500));
    expect(h2.running()).toEqual([]);
    const down = await refused(h2.admit('probe'));
    expect(down.modCode).toBe('DOWN');
    expect(h2.down()).toEqual(['probe']);
    expect(await h2.start('probe')).toMatchObject({ state: 'running' }); // the operator path lifts it
    expect(h2.down()).toEqual([]);
  });

  it('F2: a mod has at most 8 mod → host requests in flight in the host; the rest are refused BUSY', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, writeModFolder(path.join(r.root, 'src', 'probe'), probeManifest()));
    const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: () => new Promise((res) => setTimeout(() => res({ ok: 1 }), 300)) });
    cleanups.push(() => h.stopAll());
    await h.start('probe');
    expect(await h.callTool('probe', 'probe.read', { op: 'kflood' })).toEqual({ ok: 8, busy: 12 });
  });

  it('I1: watching() tells the truth across a crash restart and the restart cap', async () => {
    const { h } = await started({ linked: true });
    const until = async (f: () => boolean, ms = 20_000) => {
      for (let t = 0; t < ms && !f(); t += 50) await new Promise((res) => setTimeout(res, 50));
    };
    expect(h.watching()).toEqual(['probe']);
    await refused(h.callTool('probe', 'probe.read', { op: 'crash' }));
    await until(() => h.restarts('probe') === 1 && h.running().length === 1 && h.watching().length === 1);
    expect(h.running()).toEqual(['probe']);
    expect(h.watching()).toEqual(['probe']); // re-armed by the successful restart
    for (let n = 2; n <= 4; n++) {
      await until(() => h.running().length === 1);
      await refused(h.callTool('probe', 'probe.read', { op: 'crash' }));
      await until(() => (n <= 3 ? h.restarts('probe') === n && h.running().length === 1 : h.down().includes('probe')));
    }
    expect(h.running()).toEqual([]);
    expect(h.watching()).toEqual([]);
  }, 120_000); // four crash/respawn cycles: windows-latest spawns node far slower than macOS
});

describe('round 3 (Aegis R2-1, R2-2, low)', () => {
  it('R2-1: a 1000-request refusal loop writes at most 8 individual mod.effect.refused rows + 1 coalesced row', async () => {
    const { r, h } = await started();
    expect(await h.callTool('probe', 'probe.read', { op: 'aloop', n: 1000 }, { timeoutMs: 20_000 })).toEqual({ refused: 1000 });
    await h.stop('probe'); // stop flushes the fold
    const rows = r.events.filter((e) => e.kind === 'mod.effect.refused');
    expect(rows.filter((e) => !e.payload.coalesced)).toHaveLength(8);
    const co = rows.filter((e) => e.payload.coalesced);
    expect(co).toHaveLength(1);
    expect(co[0]!.payload).toMatchObject({ name: 'probe', count: 992, byKey: { 'approve||approve': 992 }, otherKeys: 0, distinct: 1 });
  }, 30_000);

  it('R2-2: 10 000 rotating relay-miss names fold into one coalesced row under 4 KiB (16 keys + otherNames + distinct)', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    for (let i = 0; i < 10_000; i++) await h.admit(`n${i}`).catch(() => undefined);
    h.flushRelayMisses();
    const co = r.events.filter((e) => e.kind === 'manifest.refuse' && e.payload.coalesced);
    expect(co).toHaveLength(1);
    const p = co[0]!.payload as { count: number; byName: Record<string, number>; otherNames: number; distinct: number; distinctCapped?: boolean };
    expect(p.count).toBe(10_000 - 8);
    expect(Object.keys(p.byName)).toHaveLength(16);
    expect(p.otherNames).toBe(10_000 - 8 - 16);
    expect(p.distinct).toBe(1024);
    expect(p.distinctCapped).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(4096);
  }, 60_000);

  it('Aegis low: a kernel-side refusal reaches the mod with its code and reason only — never its message or wrapped data', async () => {
    const written: string[] = [];
    const stdin = new Writable({ write: (c, _e, cb) => (written.push(String(c)), cb()) });
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough() }) as unknown as ChildProcess;
    const ch = new ModChannel(child, async () => {
      throw new RefusedError(refuse({ code: 'ENGINE', data: { reason: 'anchor-failed', path: '/Users/secret/.gnomon/keys', error: 'EACCES /Users/secret' } }), 'anchor write failed at /Users/secret/.gnomon/anchor: EACCES');
    });
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'kernel.call', params: { verb: 'log.append', params: {} } })}\n`);
    for (let i = 0; i < 20 && !written.length; i++) await new Promise((res) => setTimeout(res, 10));
    const reply = JSON.parse(written[0]!) as { error: { message: string; data: { code: string; data: Record<string, unknown> } } };
    expect(reply.error.message).toBe('refused ENGINE (anchor-failed)');
    expect(reply.error.data).toMatchObject({ code: 'ENGINE', data: { reason: 'anchor-failed' } });
    expect(JSON.stringify(reply)).not.toContain('secret');
    ch.close(new Error('done'));
  });
});

describe('M1.11 slice 3 (named, not built)', () => {
  it.todo('slice 3: spend from the caller permit and session principals for kernel.call session.send (M1.7 session principals; G-ABI-02 mod column)');
  it.todo('slice 3: mod.repinned (dev re-pin) and the rollback re-pin of a running mod (G-MOD-08)');
  it.todo('slice 3: dev mode cards, 8 h expiry scheduling, cwd/worktree exclusion, widening card in dev mode, dev badge (G-MOD-09, G-MOD-11)');
  it.todo('slice 3: gnomon-mods MCP bridge per session writing inject.receipt (§3.8)');
  it.todo('slice 3: gnomon mod new|types|test|inspect|install|link|unlink|dev|diff|rollback + fixtures→golden renders (G-MOD-04)');
  it.todo('slice 3: kit Image via /blob and Canvas host-owned surface in the GUI; overlay rules for card.*/status.mod (G-MOD-06, G-MOD-07, G-MOD-10)');
  it.todo('slice 3 (Aegis C4): /blob serving opens blobs/ files O_NOFOLLOW and re-hashes before serving');
  it.todo('slice 3: mod.command relay from a GUI needs a provable user gesture (§11.5; M1.10)');
  it.todo('slice 4: host-filled Tier 0 persona templates (#workshop-mod and its feed: test/workshop-mod.test.ts)');
});
