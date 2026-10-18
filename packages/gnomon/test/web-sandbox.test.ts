// @gnomon-platform: darwin
/**
 * #web-endpoint under the darwin `transport` sandbox profile (spec §15.5,
 * §11.2 rule 1b, §16 "Web endpoint" row; `G-WEB-07`, `G-WEB-05`) and the daemon
 * path of `gnomon open` (§11.2 rule 2). macOS-first (P8-D78): the win32
 * restricted-token `transport` profile is the Windows parity phase; linux has
 * no transport profile in the spec (the endpoint refuses there, fail closed —
 * test/web-units.test.ts asserts the refusal on every platform).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, loadDeviceKey, readRegistry, registerDevice, registerKernelKey, RootVerifier, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { homedir } from 'node:os';
import { transportLaunchPlan, transportProfileSbpl } from '../src/kernel/sandbox/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { materializePlaceholderBundle } from '../src/kernel/web/index.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';
import { HELLO, rpc, wsConnect } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
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

  // T-2026-10-18-017 finding for Aegis: `(local ip "localhost:*")` is NOT loopback-only — under the generated
  // profile the child can listen on the host's LAN address and on 0.0.0.0 / :: (measured locally). SBPL cannot name a
  // numeric loopback address, and fd-passing does not help (listen() on an inherited fd is re-checked by
  // network-inbound). Profile left UNCHANGED pending Aegis; this becomes a falsifier once a loopback-only mechanism exists.
  it.todo('T-2026-10-18-017: a non-loopback (LAN or wildcard) listen under the transport profile is denied');
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
