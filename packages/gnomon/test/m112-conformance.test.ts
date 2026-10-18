// @gnomon-platform: darwin, linux
/**
 * M1.12 slice 2 (spec §12.8, §19.1; G-CLI-02, G-OBS-01): the published TS
 * client (src/clients/ts) against a LIVE kernel spawned in-test, and the
 * conformance runner driving it through the language-neutral driver protocol.
 * Every CONFORMANCE_CHECKS `run` check passes; `slice-2` checks are `todo`.
 */
import { createPublicKey, generateKeyPairSync, verify as edVerify } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CLIENT_API_ID, CLIENT_METHODS, CONFORMANCE_CHECKS, RefusedError, authServerPreimage, conformanceReportHash, type ClientMethod, type HelloResult } from '@a-company/gnomon-contracts';
import {
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  mintReadToken,
  readRegistry,
  registerDevice,
  registerKernelKey,
  RootVerifier,
  writeNewDeviceKey,
} from '../src/kernel/identity/index.js';
import { deviceKeyPath } from '../src/kernel/identity/device-key.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { ClientAuthError, GnomonClient, ed25519KeyIdOf, newClientNonce, type ClientLogPort } from '../src/clients/ts/index.js';
import * as net from 'node:net';
import { SubprocessDriver, TsClientDriver } from '../src/clients/conformance/driver.js';
import { declaredConformance } from '../src/kernel/socket/dispatch.js';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';
import { RUNNER_CHECK_IDS, runConformance, type ConformanceFixture } from '../src/clients/conformance/runner.js';
import { extractSpecifiers, PKG_ROOT, walk } from './helpers.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function kernelRig(): Promise<ConformanceFixture & { home: string }> {
  const t = tempHome('gc-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const devKey = writeNewDeviceKey(t.home);
  const entry = registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: devKey.publicKeyPem, principalKind: 'human' });
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
  cleanups.push(() => d.shutdown('signal'));
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  const other = SoftwareEd25519Signer.generate('kernel');
  const stray = generateKeyPairSync('ed25519');
  const token = mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: 60 * 60_000 });
  return {
    home: t.home,
    socketPath: d.pidfile.socketPath,
    kernelKey: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! },
    otherKey: { keyId: other.keyId, publicKeyPem: other.publicKeyPem },
    device: { kind: 'device', principalId: entry.principalId, deviceId: entry.deviceId, privateKeyPem: readFileSync(deviceKeyPath(t.home), 'utf8') },
    unregisteredDevice: { kind: 'device', principalId: entry.principalId, deviceId: `${entry.deviceId}x`, privateKeyPem: stray.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    readToken: token.token,
    authRows: () => {
      const db = new DatabaseSync(path.join(t.home, 'kernel.db'), { readOnly: true });
      try {
        return (db.prepare("SELECT count(*) AS n FROM chain WHERE kind LIKE 'socket.auth.%'").get() as { n: number }).n;
      } finally {
        db.close();
      }
    },
  };
}

const CLIENT = { name: 'gnomon-ts-client-test', version: '0.0.0', surface: 'cli' };

describe('#gnomon-ts-client against a live kernel (§4.9, §12.8)', () => {
  it('hello + serverSig against the pinned key, device auth, typed calls; refusals reject with the contracts RefusedError', async () => {
    const f = await kernelRig();
    const logs: string[] = [];
    const log: ClientLogPort = { info: (m) => logs.push(`info ${m}`), warn: (m) => logs.push(`warn ${m}`) };
    const c = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: f.device, log });
    cleanups.push(() => c.close());
    expect(c.serverVerified).toBe(true);
    expect(c.principal).toBe(f.device.principalId);
    expect(c.hello.clientApiId).toBe(CLIENT_API_ID);
    expect(ed25519KeyIdOf(f.kernelKey.publicKeyPem)).toBe(f.kernelKey.keyId);
    const st = await c.call('status', {});
    expect(st.connId).toBe(c.connId);
    expect(st.clientConformance).toEqual({ n: 0, of: 1, label: 'declared' });
    const err = await c.callRaw('no.such.verb', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RefusedError);
    expect((err as RefusedError).refusal.code).toBe('UNKNOWN_VERB');
    expect(logs).toContain('info connected'); // through the injected port, never console
  });

  it('never sends a credential to an unverified or mismatched server', async () => {
    const f = await kernelRig();
    const before = f.authRows();
    await expect(GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, credential: f.device })).rejects.toMatchObject({ reason: 'unverified-server' });
    await expect(GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.otherKey, credential: f.device })).rejects.toBeInstanceOf(ClientAuthError);
    await expect(GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: { ...f.kernelKey, keyId: f.otherKey.keyId }, credential: f.device })).rejects.toMatchObject({ reason: 'server-key-mismatch' });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.authRows()).toBe(before);
  });

  it('read token by proof of possession: reads served, writes FORBIDDEN; a subscription delivers backlog then live rows in seq order', async () => {
    const f = await kernelRig();
    const t = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: { kind: 'read-token', token: f.readToken } });
    cleanups.push(() => t.close());
    expect(t.expiresAt).toBeDefined();
    await expect(t.call('log.append', { kind: 'request.grant', payload: {} })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    const seqs: number[] = [];
    const sub = await t.subscribe({ since: 0 }, { row: (r) => seqs.push(r.seq) });
    expect(typeof sub.subscription).toBe('string');
    const other = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: f.device });
    cleanups.push(() => other.close());
    const deadline = Date.now() + 3000;
    while (!seqs.some((s) => s > sub.head) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(seqs[0]).toBe(1);
    expect(seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1 || s > seqs[i - 1]!)).toBe(true);
    expect(seqs.some((s) => s > sub.head)).toBe(true);
    expect(sub.cursor()).toBe(seqs.at(-1));
  });
});

describe('#client-conformance runner (G-CLI-02)', () => {
  it('every `run` check in the catalog has a runner implementation, and nothing else does', () => {
    expect([...RUNNER_CHECK_IDS].sort()).toEqual(CONFORMANCE_CHECKS.filter((c) => c.status === 'run').map((c) => c.id).sort());
  });

  it('the TS client passes every run check against a spawned kernel; slice-2 checks are todo, never passes; the report hash is the declared one', async () => {
    const f = await kernelRig();
    const driver = new TsClientDriver();
    cleanups.push(() => driver.stop());
    const report = await runConformance(driver, f, { client: { name: '@a-company/gnomon/clients/ts', version: '8.0.0', language: 'typescript' } });
    const failed = report.checks.filter((c) => c.result === 'fail');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.pass).toBe(true);
    for (const c of CONFORMANCE_CHECKS) expect(report.checks.find((x) => x.id === c.id)?.result).toBe(c.status === 'run' ? 'pass' : 'todo');
    expect(report.reportHash).toBe(conformanceReportHash(report));
    expect(report.reportHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('#client-conformance falsifiers (the runner can fail)', () => {
  it('a client whose sanitizer keeps a bidi override, or that authenticates to any server, fails — and the report is not a pass', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    const lying = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        if (r.op === 'sanitize') return { id: r.id, ok: true, text: String(r.input), flags: [] };
        // a client that skips serverSig verification: drops the pin but still authenticates
        if (r.op === 'connect' && r.kernelKey && (r.kernelKey as { keyId: string }).keyId === f.otherKey.keyId) return inner.request({ ...r, kernelKey: f.kernelKey });
        return inner.request(r);
      },
    };
    const report = await runConformance(lying, f, { client: { name: 'liar', version: '0' } });
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.id === 'display.sanitize')?.result).toBe('fail');
    expect(report.checks.find((c) => c.id === 'hello.server-sig-mismatch')?.result).toBe('fail');
  });

  it('B1: a keyId-only client (checks serverKeyId, never the signature) fails hello.server-sig-mismatch', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    /** hello, then auth with whatever the client has — after checking only that serverKeyId equals the pinned keyId. */
    const keyIdOnly = async (socketPath: string, keyId: string): Promise<boolean> => {
      const sock = net.connect(socketPath);
      await new Promise((res, rej) => sock.once('connect', res).once('error', rej));
      const frames: Array<Record<string, unknown>> = [];
      let buf = '';
      sock.on('data', (ch) => {
        buf += ch.toString('utf8');
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          frames.push(JSON.parse(buf.slice(0, nl)));
          buf = buf.slice(nl + 1);
        }
      });
      sock.write(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'hello', params: { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: newClientNonce(), client: CLIENT } })}\n`);
      while (!frames.length) await new Promise((r) => setTimeout(r, 10));
      const ok = (frames[0]!.result as { serverKeyId?: string } | undefined)?.serverKeyId === keyId;
      if (ok) sock.write(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method: 'auth', params: { principal: f.device.principalId, deviceId: f.device.deviceId, sig: 'AAAA' } })}\n`);
      await new Promise((r) => setTimeout(r, 30));
      sock.destroy();
      return ok;
    };
    const lying = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        if (r.op === 'connect' && r.credential && r.kernelKey) {
          const ok = await keyIdOnly(String(r.socketPath), (r.kernelKey as { keyId: string }).keyId);
          return ok ? { id: r.id, ok: true, conn: 'x', serverVerified: true } : { id: r.id, ok: false, error: { kind: 'client' as const, reason: 'server-key-mismatch', message: 'keyId differs' } };
        }
        return inner.request(r);
      },
    };
    const report = await runConformance(lying, f, { client: { name: 'keyid-only', version: '0' } });
    expect(report.checks.find((c) => c.id === 'hello.server-sig-mismatch')?.result).toBe('fail');
    expect(report.pass).toBe(false);
  });

  it('T-2026-10-18-015 item 4: a client that checks the pinned PEM hash and keyId but never verifies serverSig fails ONLY hello.server-sig-mismatch, at case (c)', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    /** hello on a raw socket; true when serverKeyId equals the pin's keyId AND the pin's PEM hashes to that keyId. serverSig is never looked at. */
    const pinOnly = async (socketPath: string, pin: { keyId: string; publicKeyPem: string }): Promise<{ ok: boolean; send: (frame: unknown) => void; done: () => void }> => {
      const sock = net.connect(socketPath);
      await new Promise((res, rej) => sock.once('connect', res).once('error', rej));
      sock.on('error', () => undefined);
      const frames: Array<Record<string, unknown>> = [];
      let buf = '';
      sock.on('data', (ch) => {
        buf += ch.toString('utf8');
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          frames.push(JSON.parse(buf.slice(0, nl)));
          buf = buf.slice(nl + 1);
        }
      });
      sock.write(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'hello', params: { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: newClientNonce(), client: CLIENT } })}\n`);
      while (!frames.length) await new Promise((r) => setTimeout(r, 10));
      const serverKeyId = (frames[0]!.result as { serverKeyId?: string } | undefined)?.serverKeyId;
      const ok = serverKeyId === pin.keyId && ed25519KeyIdOf(pin.publicKeyPem) === pin.keyId;
      return { ok, send: (frame) => sock.write(`${JSON.stringify(frame)}\n`), done: () => sock.destroy() };
    };
    const noSig = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        if (r.op === 'connect' && r.credential && r.kernelKey) {
          const pin = r.kernelKey as { keyId: string; publicKeyPem: string };
          const h = await pinOnly(String(r.socketPath), pin);
          if (!h.ok) {
            h.done();
            return { id: r.id, ok: false, error: { kind: 'client' as const, reason: 'server-key-mismatch', message: 'pin check failed' } };
          }
          if (String(r.socketPath) === f.socketPath) {
            // against the real kernel the signature is genuine, so skipping its check changes nothing: behave as the real client
            h.done();
            return inner.request(r);
          }
          // any other server: authenticates without ever checking serverSig
          h.send({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method: 'auth', params: { principal: f.device.principalId, deviceId: f.device.deviceId, sig: 'AAAA' } });
          await new Promise((res) => setTimeout(res, 30));
          h.done();
          return { id: r.id, ok: true, conn: 'x', serverVerified: true };
        }
        return inner.request(r);
      },
    };
    const report = await runConformance(noSig, f, { client: { name: 'pin-only', version: '0' } });
    const failed = report.checks.filter((c) => c.result === 'fail');
    expect(failed.map((c) => c.id)).toEqual(['hello.server-sig-mismatch']);
    expect(failed[0]!.detail).toMatch(/replayed hello \(verbatim\) was accepted/); // (a) and (b) passed; (c) caught it
    expect(report.pass).toBe(false);
  });

  it('T-2026-10-18-016: a client that verifies serverSig but skips the clientNonce check (trusts the echoed nonce) fails ONLY hello.server-sig-mismatch, at the verbatim replay', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    /** hello on a raw socket with a fresh clientNonce; the signature is verified over the ECHOED clientNonce, never compared to the one sent. */
    const echoTrusting = async (socketPath: string, endpointPath: string, pin: { keyId: string; publicKeyPem: string }): Promise<{ ok: boolean; send: (frame: unknown) => void; done: () => void }> => {
      const sock = net.connect(socketPath);
      await new Promise((res, rej) => sock.once('connect', res).once('error', rej));
      sock.on('error', () => undefined);
      const frames: Array<Record<string, unknown>> = [];
      let buf = '';
      sock.on('data', (ch) => {
        buf += ch.toString('utf8');
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          frames.push(JSON.parse(buf.slice(0, nl)));
          buf = buf.slice(nl + 1);
        }
      });
      sock.write(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'hello', params: { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: newClientNonce(), client: CLIENT } })}\n`);
      while (!frames.length) await new Promise((r) => setTimeout(r, 10));
      const h = frames[0]!.result as HelloResult | undefined;
      let ok = false;
      if (h && h.serverKeyId === pin.keyId && ed25519KeyIdOf(pin.publicKeyPem) === pin.keyId) {
        const pre = Buffer.from(authServerPreimage(h.nonce, h.clientNonce, endpointPath, { clientApi: h.clientApi, features: h.features }), 'utf8');
        try {
          ok = edVerify(null, pre, createPublicKey(pin.publicKeyPem), Buffer.from(h.serverSig, 'base64'));
        } catch {
          ok = false;
        }
      }
      return { ok, send: (frame) => sock.write(`${JSON.stringify(frame)}\n`), done: () => sock.destroy() };
    };
    const skipNonce = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        if (r.op === 'connect' && r.credential && r.kernelKey) {
          const h = await echoTrusting(String(r.socketPath), String(r.endpointPath ?? r.socketPath), r.kernelKey as { keyId: string; publicKeyPem: string });
          if (!h.ok) {
            h.done();
            return { id: r.id, ok: false, error: { kind: 'client' as const, reason: 'bad-server-sig', message: 'serverSig does not verify' } };
          }
          if (String(r.socketPath) === f.socketPath) {
            // against the real kernel the echo IS this connection's nonce: behave as the real client
            h.done();
            return inner.request(r);
          }
          h.send({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method: 'auth', params: { principal: f.device.principalId, deviceId: f.device.deviceId, sig: 'AAAA' } });
          await new Promise((res) => setTimeout(res, 30));
          h.done();
          return { id: r.id, ok: true, conn: 'x', serverVerified: true };
        }
        return inner.request(r);
      },
    };
    const report = await runConformance(skipNonce, f, { client: { name: 'skip-nonce', version: '0' } });
    const failed = report.checks.filter((c) => c.result === 'fail');
    expect(failed.map((c) => c.id)).toEqual(['hello.server-sig-mismatch']);
    expect(failed[0]!.detail).toMatch(/replayed hello \(verbatim\) was accepted/); // (a), (b) passed; the replay of a genuine hello caught it
    expect(report.pass).toBe(false);
  });

  it('T-2026-10-18-016: the TS client refuses a replayed genuine hello locally — verbatim (client-nonce-mismatch) and echo-rewritten (bad-server-sig)', async () => {
    const f = await kernelRig();
    const real = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey });
    const recorded = real.hello;
    await real.close();
    const { verifyHelloSignature } = await import('../src/clients/ts/index.js');
    expect(() => verifyHelloSignature(recorded, f.socketPath, f.kernelKey, recorded.clientNonce)).not.toThrow();
    const mine = newClientNonce();
    expect(() => verifyHelloSignature(recorded, f.socketPath, f.kernelKey, mine)).toThrow(expect.objectContaining({ reason: 'client-nonce-mismatch' }));
    expect(() => verifyHelloSignature({ ...recorded, clientNonce: mine }, f.socketPath, f.kernelKey, mine)).toThrow(expect.objectContaining({ reason: 'bad-server-sig' }));
  });

  it('T-2026-10-18-015 item 6: a client that keeps a live connection after the AUTH refusal fails auth.device-refused', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    const keeper = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        const res = await inner.request(r);
        if (r.op === 'connect' && (r.credential as { deviceId?: string } | undefined)?.deviceId === f.unregisteredDevice.deviceId) {
          // surfaces the refusal but hands back a still-open (hello-only) connection
          const kept = await inner.request({ ...r, credential: undefined });
          return { ...res, conn: kept.conn };
        }
        return res;
      },
    };
    const report = await runConformance(keeper, f, { client: { name: 'keeper', version: '0' } });
    const c = report.checks.find((x) => x.id === 'auth.device-refused')!;
    expect(c.result).toBe('fail');
    expect(c.detail).toMatch(/kept a live connection/);
    expect(report.pass).toBe(false);
  });

  it('T-2026-10-18-015 item 5: an impostor that cannot listen fails hello.server-sig-mismatch with the listen error; the runner does not crash', async () => {
    const f = await kernelRig();
    const driver = new TsClientDriver();
    cleanups.push(() => driver.stop());
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('gimp-'));
    // the impostor's listen() emits 'error' (as EADDRINUSE / EACCES would); without a listener that is an uncaught exception
    const orig = net.Server.prototype.listen;
    net.Server.prototype.listen = function (this: net.Server, ...a: unknown[]) {
      if (typeof a[0] === 'string' && a[0].includes('gimp-')) {
        process.nextTick(() => this.emit('error', Object.assign(new Error('listen EACCES (injected)'), { code: 'EACCES' })));
        return this;
      }
      return (orig as (...x: unknown[]) => net.Server).apply(this, a);
    } as typeof orig;
    let report;
    try {
      report = await runConformance(driver, f, { client: { name: 'ts', version: '0' } });
    } finally {
      net.Server.prototype.listen = orig;
    }
    // the impostor's temp dir was removed on the failure path
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('gimp-'))).toEqual(before);
    const failed = report.checks.filter((c) => c.result === 'fail');
    expect(failed.map((c) => c.id)).toEqual(['hello.server-sig-mismatch']);
    expect(failed[0]!.detail).toMatch(/impostor endpoint could not listen/);
  });

  it('B2: a client that drops backlog rows fails subscribe.since', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    const dropping = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        const res = await inner.request(r);
        if (r.op === 'events' && Array.isArray(res.rows)) return { ...res, rows: (res.rows as unknown[]).slice(2) };
        return res;
      },
    };
    const report = await runConformance(dropping, f, { client: { name: 'dropper', version: '0' } });
    expect(report.checks.find((c) => c.id === 'subscribe.since')?.result).toBe('fail');
    expect(report.pass).toBe(false);
  });
});

describe('Aegis M1: status reports only what was declared, labelled declared', () => {
  it('declaredConformance copies {suite, version, reportHash} only, sanitizes and caps, voids a bad hash', () => {
    const h = `sha256:${'a'.repeat(64)}`;
    expect(declaredConformance({ suite: 's', version: '1', reportHash: h, result: 'passed', verifiedBy: 'gnomon-kernel' })).toEqual({ suite: 's', version: '1', reportHash: h, label: 'declared' });
    expect(declaredConformance({ suite: 's‮', version: 'x'.repeat(500), reportHash: h })).toEqual({ suite: 's⟨RLO⟩', version: 'x'.repeat(64), reportHash: h, label: 'declared' });
    expect(declaredConformance({ suite: 's', version: '1', reportHash: 'passed' })).toBeNull();
    expect(declaredConformance('passed')).toBeNull();
  });

  it('a forged {result: passed, verifiedBy: gnomon-kernel} in hello never reaches status', async () => {
    const f = await kernelRig();
    const forged = { suite: 'gnomon-client-conformance', version: '1', reportHash: `sha256:${'b'.repeat(64)}`, result: 'passed', verifiedBy: 'gnomon-kernel' };
    const c = await GnomonClient.connect({ socketPath: f.socketPath, client: { ...CLIENT, conformance: forged } as never, kernelKey: f.kernelKey, credential: f.device }).catch((e: unknown) => e);
    if (c instanceof GnomonClient) {
      cleanups.push(() => c.close());
      const st = await c.call('status', {});
      const mine = st.clients.find((x) => x.connId === c.connId)!;
      expect(mine.conformance).toEqual({ suite: forged.suite, version: '1', reportHash: forged.reportHash, label: 'declared' });
      expect(JSON.stringify(st)).not.toContain('verifiedBy');
    } else {
      expect(c).toMatchObject({ refusal: { code: 'BAD_REQUEST' } }); // refused at hello: equally never reported
    }
  });
});

describe('client credential and hello hygiene', () => {
  it('an unknown credential kind or a malformed device PEM is bad-credential before any connection', async () => {
    await expect(GnomonClient.connect({ socketPath: '/nonexistent', client: CLIENT, credential: { kind: 'bearer' } as never })).rejects.toMatchObject({ reason: 'bad-credential' });
    await expect(GnomonClient.connect({ socketPath: '/nonexistent', client: CLIENT, credential: { kind: 'device', principalId: 'p', deviceId: 'd', privateKeyPem: 'not a pem' } })).rejects.toMatchObject({ reason: 'bad-credential' });
  });

  it('SubprocessDriver: a missing driver binary answers driver errors instead of crashing', async () => {
    const d = new SubprocessDriver('none', '/nonexistent/driver-binary', []);
    const r = await d.request({ op: 'sanitize', input: 'x' });
    expect(r).toMatchObject({ ok: false, error: { kind: 'driver' } });
    await d.stop();
  });
});

describe('#gnomon-ts-client surface', () => {
  it('the client imports only @a-company/gnomon-contracts and node:* (a community client could be built from the package alone)', () => {
    for (const dir of ['src/clients/ts', 'src/clients/conformance']) {
      for (const file of walk(path.join(PKG_ROOT, dir), (f) => f.endsWith('.ts'))) {
        for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
          const ok = spec.startsWith('node:') || spec === '@a-company/gnomon-contracts' || (spec.startsWith('./') || spec.startsWith('../ts/'));
          expect(ok, `${path.relative(PKG_ROOT, file)} imports ${spec}`).toBe(true);
        }
      }
    }
  });

  it('call() is typed for exactly the 12 verbs + 2 relays (ClientMethodParams keys = CLIENT_METHODS)', () => {
    const typed: Record<ClientMethod, true> = {
      status: true, 'session.open': true, 'session.send': true, 'session.stop': true, 'log.append': true, 'log.read': true,
      'permit.reserve': true, approve: true, 'contract.register': true, 'contract.claim': true, 'oracle.run': true, 'ref.resolve': true,
      'mod.view': true, 'mod.command': true,
    };
    expect(Object.keys(typed).sort()).toEqual([...CLIENT_METHODS].sort());
  });
});

describe('honesty CI on a live kernel (G-HON-03 denominators, G-HON-07 latency provenance in status)', () => {
  it('every number in a live status (device and read-token views) is {n, of}, a gauge, or declared in STATUS_NUMBERS', async () => {
    const f = await kernelRig();
    const c = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: f.device });
    cleanups.push(() => c.close());
    const r = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: { kind: 'read-token', token: f.readToken } });
    cleanups.push(() => r.close());
    for (const st of [await c.call('status', {}), await r.call('status', {})]) expect(checkStatusNumbers(st)).toEqual([]);
  });
});
