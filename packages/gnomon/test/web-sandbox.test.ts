// @gnomon-platform: darwin
/**
 * #web-endpoint under the darwin `transport` sandbox profile (spec §15.5,
 * §11.2 rule 1b, §16 "Web endpoint" row; `G-WEB-07`, `G-WEB-05`) and the daemon
 * path of `gnomon open` (§11.2 rule 2). macOS-first (P8-D78): the win32
 * restricted-token `transport` profile is the Windows parity phase; linux has
 * no transport profile in the spec (the endpoint refuses there, fail closed —
 * test/web-units.test.ts asserts the refusal on every platform).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, loadDeviceKey, readRegistry, registerDevice, registerKernelKey, RootVerifier, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { homedir } from 'node:os';
import { transportLaunchPlan, transportProfileSbpl } from '../src/kernel/sandbox/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { NdjsonDecoder } from '../src/kernel/socket/framing.js';
import { childDefaultHeaders, materializePlaceholderBundle } from '../src/kernel/web/index.js';
import type { ChildRecord, KernelRecord } from '../src/kernel/web/protocol.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';
import { GOOD, HELLO, rawHttp, rpc, wsConnect } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
/** This Mac's LAN IPv4 (en*), if it has one: the address a LAN listener would use (stated, local only). */
const lanIpv4 = (): string | null => {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && /^en/.test(name)) return a.address;
  return null;
};
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('the darwin transport profile (§15.5)', () => {
  it('is default-deny, realpath-ed, with no mach-lookup, no outbound, no fork and exec of node only', () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const dir = materializePlaceholderBundle(t.home);
    const plan = transportLaunchPlan({ scriptPath: CHILD, bundleDir: dir });
    expect(plan).toMatchObject({ command: '/usr/bin/sandbox-exec', sandbox: 'full', env: {} });
    expect(plan.profileHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const p = plan.profile!;
    expect(p).toContain('(deny default)');
    expect(p).toContain(`(subpath "${realpathSync(dir)}")`);
    for (const forbidden of ['mach-lookup', 'network-outbound', 'process-fork', 'file-write', '(allow default)']) expect(p).not.toContain(forbidden);
    expect(p.match(/process-exec/g)?.length).toBe(1);
  });

  it('Aegis C2: node under $HOME grants its lib/ only — no read subpath equals or contains $HOME, the gnomon home or keys', () => {
    const H = realpathSync(homedir());
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const bundle = realpathSync(materializePlaceholderBundle(t.home));
    const script = realpathSync(CHILD);
    const p = transportProfileSbpl({ nodeReal: `${H}/bin/node`, scriptReal: script, bundleReal: bundle, protectedDirs: [t.home, path.join(t.home, 'keys')] });
    const subs = [...p.matchAll(/\(subpath "([^"]+)"\)/g)].map((m) => m[1]!);
    expect(subs).toContain(`${H}/lib`);
    for (const g of subs) for (const prot of [H, realpathSync(t.home)]) expect(prot === g || prot.startsWith(`${g}/`), `${g} ⊇ ${prot}`).toBe(false);
    const refuse = (i: Parameters<typeof transportProfileSbpl>[0]) => expect(() => transportProfileSbpl(i)).toThrow(expect.objectContaining({ reason: 'sandbox-unavailable' }));
    refuse({ nodeReal: `${H}/bin/node`, scriptReal: script, bundleReal: H }); // the bundle dir = $HOME
    refuse({ nodeReal: `${H}/bin/node`, scriptReal: `${H}/gnomon-web.js`, bundleReal: bundle }); // the entry dir = $HOME
    refuse({ nodeReal: '/opt/x/bin/node', scriptReal: script, bundleReal: realpathSync(t.home), protectedDirs: [t.home] }); // = the gnomon home
    const keys = path.join(t.home, 'keys', 'gui');
    mkdirSync(keys, { recursive: true, mode: 0o700 });
    refuse({ nodeReal: '/opt/x/bin/node', scriptReal: script, bundleReal: realpathSync(keys), forbiddenTrees: [path.join(t.home, 'keys')] }); // INSIDE keys/
    expect(() => transportProfileSbpl({ nodeReal: '/opt/x/bin/node', scriptReal: script, bundleReal: bundle, protectedDirs: [t.home], forbiddenTrees: [path.join(t.home, 'keys')] })).not.toThrow(); // <home>/gui is fine
  });

  // T-2026-10-18-020: the child listens on nothing, so the loopback listen is now DENIED like every other socket
  // (the T-2026-10-18-017 flake, a sometimes-EPERM loopback listen, has no allow left to flake on: no retry).
  it('a probe under the generated profile: bundle readable; home read, outbound connect, exec and even a loopback listen denied', async () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const secret = path.join(t.home, 'secret.key');
    writeFileSync(secret, 'k', { mode: 0o600 });
    const dir = materializePlaceholderBundle(t.home);
    const probeDir = mkdtempSync(path.join(path.dirname(t.home), 'probe-'));
    const probe = path.join(probeDir, 'probe.mjs');
    writeFileSync(
      probe,
      `import fs from 'node:fs'; import net from 'node:net'; import http from 'node:http'; import cp from 'node:child_process';
const [bundle, secret, port] = process.argv.slice(2); const r = {};
try { fs.readFileSync(bundle + '/index.html'); r.bundle = 'ok'; } catch (e) { r.bundle = e.code; }
try { fs.readFileSync(secret); r.secret = 'READ'; } catch (e) { r.secret = e.code; }
try { const c = cp.spawnSync('/bin/echo', ['x']); r.exec = c.error ? c.error.code : 'RAN'; } catch (e) { r.exec = e.code ?? 'threw'; }
r.out = await new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port: Number(port) }); s.on('connect', () => (s.destroy(), res('CONNECTED'))); s.on('error', (e) => res(e.code)); });
const srv = http.createServer(); srv.once('error', (e) => { r.listen = e.code; process.stdout.write(JSON.stringify(r)); });
srv.listen(0, '127.0.0.1', () => { r.listen = 'LISTENING'; srv.close(); process.stdout.write(JSON.stringify(r)); });`,
    );
    const target = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => target.once('listening', r));
    cleanups.push(() => target.close());
    const plan = transportLaunchPlan({ scriptPath: probe, bundleDir: dir });
    const run = spawnSync(plan.command, [...plan.args, realpathSync(dir), secret, String((target.address() as net.AddressInfo).port)], { env: plan.env, encoding: 'utf8', timeout: 20_000 });
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toEqual({ bundle: 'ok', secret: 'EPERM', exec: 'EPERM', out: 'EPERM', listen: 'EPERM' });
  });

  /*
   * T-2026-10-18-020 (was the T-2026-10-18-017 it.todo): `(local ip "localhost:*")` was NOT loopback-only — the child
   * could listen on the LAN address and the wildcards. SBPL cannot name a loopback address, so the profile now has NO
   * network-* rule: the kernel listens on 127.0.0.1 and hands connected sockets over the IPC channel (probe P14b-web).
   * Falsifiers: (i) every bind/listen variant and (ii) outbound TCP + unix connect are EPERM inside the child, against
   * an unsandboxed control that reaches every target; (iii) a handed socket serves HTTP and a WebSocket round trip;
   * (v) the generated profile names no network- rule. (iv), the en0 connect, is in the daemon test below.
   */
  it('T-2026-10-18-020 (v): the generated transport profile contains no network- rule', () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const dir = materializePlaceholderBundle(t.home);
    const plan = transportLaunchPlan({ scriptPath: CHILD, bundleDir: dir });
    expect(plan.profile).not.toMatch(/network/);
    expect(transportProfileSbpl({ nodeReal: realpathSync(process.execPath), scriptReal: realpathSync(CHILD), bundleReal: realpathSync(dir) })).not.toMatch(/network/);
  });

  it('T-2026-10-18-020 (i)+(ii): inside the child every bind/listen (0.0.0.0, ::, en0, 127.0.0.1, ::1, no host), UDP bind, outbound TCP and unix connect is EPERM', async () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const dir = materializePlaceholderBundle(t.home);
    const probeDir = realpathSync(mkdtempSync(path.join(path.dirname(t.home), 'probe-')));
    const probe = path.join(probeDir, 'probe.mjs');
    writeFileSync(
      probe,
      `import net from 'node:net'; import dgram from 'node:dgram';
const [port, lan, sock] = process.argv.slice(2); const r = {};
const lst = (host) => new Promise((res) => { const v = net.createServer(); v.on('error', (e) => res(e.code)); const ok = () => { v.close(); res('LISTENING'); }; host === null ? v.listen(0, ok) : v.listen(0, host, ok); });
const ub = (type, host) => new Promise((res) => { const u = dgram.createSocket(type); u.on('error', (e) => { try { u.close(); } catch {} res(e.code); }); u.bind(0, host, () => { u.close(); res('BOUND'); }); });
const tcp = (opts) => new Promise((res) => { const s = net.connect(opts); s.on('connect', () => (s.destroy(), res('CONNECTED'))); s.on('error', (e) => res(e.code)); });
r.listen0000 = await lst('0.0.0.0'); r.listenAny6 = await lst('::'); r.listenLan = lan ? await lst(lan) : 'no-lan';
r.listenLoop4 = await lst('127.0.0.1'); r.listenLoop6 = await lst('::1'); r.listenNoHost = await lst(null);
r.udp0000 = await ub('udp4', '0.0.0.0'); r.udpAny6 = await ub('udp6', '::'); r.udpLan = lan ? await ub('udp4', lan) : 'no-lan'; r.udpLoop4 = await ub('udp4', '127.0.0.1');
r.tcpOut = await tcp({ host: '127.0.0.1', port: Number(port) }); r.unixOut = await tcp({ path: sock });
process.stdout.write(JSON.stringify(r));`,
    );
    const target = net.createServer((c) => c.destroy()).listen(0, '127.0.0.1');
    await new Promise((r) => target.once('listening', r));
    cleanups.push(() => target.close());
    const sock = path.join(probeDir, 's.sock');
    const unix = net.createServer((c) => c.destroy()).listen(sock);
    await new Promise((r) => unix.once('listening', r));
    cleanups.push(() => unix.close());
    const lan = lanIpv4();
    const args = [String((target.address() as net.AddressInfo).port), lan ?? '', sock];
    const reachedAs = (k: string): string => (k.startsWith('listen') ? 'LISTENING' : k.startsWith('udp') ? 'BOUND' : 'CONNECTED');
    // unsandboxed control: every target is reachable, so an EPERM below is the profile's answer
    const control = spawnSync(process.execPath, [probe, ...args], { encoding: 'utf8', timeout: 20_000 });
    const reached = JSON.parse(control.stdout) as Record<string, string>;
    expect(Object.keys(reached)).toHaveLength(12);
    for (const [k, v] of Object.entries(reached)) expect([k, v]).toEqual([k, v === 'no-lan' ? 'no-lan' : reachedAs(k)]);
    const plan = transportLaunchPlan({ scriptPath: probe, bundleDir: dir });
    const run = spawnSync(plan.command, [...plan.args, ...args], { env: plan.env, encoding: 'utf8', timeout: 20_000 });
    expect(run.stderr).toBe('');
    const denied = JSON.parse(run.stdout) as Record<string, string>;
    expect(Object.keys(denied)).toEqual(Object.keys(reached));
    for (const [k, v] of Object.entries(denied)) expect([k, v]).toEqual([k, v === 'no-lan' ? 'no-lan' : 'EPERM']);
  });

  it('T-2026-10-18-020 (iii): the sandboxed child serves a handed socket — a full HTTP request and a WebSocket round trip', async () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const dir = materializePlaceholderBundle(t.home);
    const plan = transportLaunchPlan({ scriptPath: CHILD, bundleDir: dir });
    const child = spawn(plan.command, plan.args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: plan.env });
    cleanups.push(() => child.kill('SIGKILL'));
    child.stdin!.on('error', () => undefined);
    let stderr = '';
    child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
    const recs: ChildRecord[] = [];
    const dec = new NdjsonDecoder(16 * 1024 * 1024);
    child.stdout!.on('data', (c: Buffer) => {
      for (const i of dec.push(c)) if (i.kind === 'frame') recs.push(i.value as unknown as ChildRecord);
    });
    const wait = async <T extends ChildRecord['t']>(kind: T): Promise<Extract<ChildRecord, { t: T }>> => {
      const end = Date.now() + 10_000;
      for (;;) {
        const i = recs.findIndex((r) => r.t === kind);
        if (i !== -1) return recs.splice(i, 1)[0] as Extract<ChildRecord, { t: T }>;
        if (Date.now() > end) throw new Error(`no ${kind} record; stderr: ${stderr}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const send = (r: KernelRecord) => child.stdin!.write(`${JSON.stringify(r)}\n`);
    send({
      t: 'config', bundleDir: realpathSync(dir), pingMs: 60_000, missedPongs: 2, maxFrameBytes: 4 * 1024 * 1024, preAuthMaxFrameBytes: 16 * 1024,
      maxBodyBytes: 64 * 1024, maxSocketBuffer: 8 * 1024 * 1024, writeHighWater: 1024 * 1024, defaultHeaders: childDefaultHeaders(),
    });
    const ready = await wait('ready');
    expect(Object.keys(ready).sort()).toEqual(['bundleHash', 'files', 't']); // no port: the child listens on nothing
    // the kernel's half, as endpoint.ts: listen on 127.0.0.1, hand each accepted socket over unread
    const listener = net.createServer({ pauseOnConnect: true }, (s) => child.send('conn', s));
    await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
    cleanups.push(() => listener.close());
    const port = (listener.address() as net.AddressInfo).port;
    const resP = rawHttp(port, 'GET', '/', GOOD(port));
    const h = await wait('http');
    expect(h).toMatchObject({ method: 'GET', path: '/' });
    send({ t: 'static', rid: h.rid, file: 'index.html', headers: { 'content-type': 'text/html' } });
    const res = await resP;
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const wsP = wsConnect(port);
    const up = await wait('upgrade');
    send({ t: 'accept', rid: up.rid });
    const ws = await wsP;
    cleanups.push(() => ws.end());
    expect(ws.status).toBe(101);
    ws.sendJson({ ping: 1 });
    const f = await wait('frame');
    expect(JSON.parse(Buffer.from(f.data, 'base64').toString('utf8'))).toEqual({ ping: 1 });
    send({ t: 'send', rid: up.rid, data: Buffer.from(JSON.stringify({ pong: 1 })).toString('base64') });
    expect(await ws.nextJson()).toEqual({ pong: 1 });
    expect(stderr).toBe('');
  });
});

describe('gnomon open (kernel side) through the daemon, child sandboxed', () => {
  it('a human device connection gets a launch grant; the page attaches; the token is on no argv; shutdown ends the child', async () => {
    const t = tempHome('gd-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    registerKernelKey(t.home, root, kernel.publicKeyPem);
    const devKey = writeNewDeviceKey(t.home);
    const entry = registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: devKey.publicKeyPem, principalKind: 'human' });
    const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
    let down = false;
    cleanups.push(() => (down ? undefined : d.shutdown('signal')));
    const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
    const s = await connectGnomon({
      socketPath: d.pidfile.socketPath,
      client: { name: 'gnomon', version: '0', surface: 'cli' },
      serverKey: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! },
      device: { principalId: entry.principalId, deviceId: entry.deviceId, signer: loadDeviceKey(t.home) },
    });
    cleanups.push(() => s.conn.close());
    await expect(d.requestWebLaunch('conn:01JNOSUCHCONNECTION00000000')).rejects.toMatchObject({ reason: 'web-launch-refused' });
    const grant = await d.requestWebLaunch(s.connId!);
    const web = d.web()!;
    expect(web.status()).toMatchObject({ listening: true, sandbox: 'full' });
    const cmd = execFileSync('/bin/ps', ['-ww', '-o', 'command=', '-p', String(web.childPid())], { encoding: 'utf8' });
    expect(cmd).toContain('gnomon-web.js'); // sandbox-exec has exec'd node under the profile
    expect(cmd).not.toContain(grant.launchToken);
    // T-2026-10-18-020 (iv): the endpoint is up, and nothing answers on this Mac's LAN address (or ::1) at its port
    const knock = (host: string) =>
      new Promise<string>((res) => {
        const k = net.connect({ host, port: grant.port });
        k.on('connect', () => (k.destroy(), res('CONNECTED')));
        k.on('error', (e: NodeJS.ErrnoException) => res(e.code ?? 'error'));
      });
    const lan = lanIpv4();
    if (lan) expect(await knock(lan)).toBe('ECONNREFUSED');
    expect(await knock('::1')).toBe('ECONNREFUSED');
    const ws = await wsConnect(grant.port);
    cleanups.push(() => ws.end());
    ws.sendJson(rpc(1, 'hello', HELLO('browser')));
    await ws.nextJson();
    ws.sendJson(rpc(2, 'auth', { launchToken: grant.launchToken }));
    const auth = (await ws.nextJson()).result as { guiToken: string; connId: string };
    expect(auth.guiToken).toBeDefined();
    const st = (await s.conn.call('status')) as { result: { web: { guiSessions: { n: number } } } };
    expect(st.result.web.guiSessions.n).toBe(1);
    const pid = web.childPid()!;
    down = true;
    await d.shutdown('signal');
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
