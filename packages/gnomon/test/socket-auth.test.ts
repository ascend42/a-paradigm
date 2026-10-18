// @gnomon-platform: darwin, linux
/**
 * #socket M1.4 slice 1 (spec §4.9, §5, §3.1): hello negotiation, serverSig,
 * device-key mutual auth against the root-signed registry (dev/test root —
 * the hardware root is M1.3), replay refusal, the unauthenticated surface,
 * the verb × principal matrix skeleton, status (< 50 ms, G-ABI-03) and the
 * kernel-log rows for every auth outcome.
 */
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_SERVER_DOMAIN, CLIENT_API_ID, CLIENT_METHODS, KIT_ID, authServerMessage, isRefusalV1, validateHelloResult, type HelloResult } from '@a-company/gnomon-contracts';
import {
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  DeviceKeyError,
  RootUnavailableError,
  RootVerifier,
  UnprovisionedRootAuthority,
  loadDeviceKey,
  readRegistry,
  registerDevice,
  registerKernelKey,
  registryPath,
  writeNewDeviceKey,
} from '../src/kernel/identity/index.js';
import { startDaemon, type DaemonHandle, type DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { KeyRing, SIGNATURE_DOMAINS, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import {
  ABI_ID,
  RpcConnection,
  ServerAuthError,
  connectGnomon,
  reasonOf,
  signAuth,
  verifyServerHello,
  type DeviceCredential,
  type RpcResponseFrame,
  type ServerKeyPin,
} from '../src/kernel/socket/index.js';
import { rawConnect, tempHome, TEST_CLIENT_NONCE } from './daemon-helpers.js';
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createKernelDispatcher, encodeFrame, listenSocket, requestFrame, SocketAuthenticator } from '../src/kernel/socket/index.js';
import { readKernelPubs } from '../src/kernel/identity/index.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const CLIENT = { name: 'gnomon-test', version: '0.0.0', surface: 'cli' };

interface Rig {
  home: string;
  d: DaemonHandle;
  root: DevTestRootAuthority;
  pin: ServerKeyPin;
  cred: DeviceCredential;
  now: { t: number };
}

async function rig(opts: { principalKind?: 'human' | 'agent' | 'mod'; name?: string; daemon?: Partial<DaemonOptions> } = {}): Promise<Rig> {
  const t = tempHome('ga-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const devKey = writeNewDeviceKey(t.home);
  const entry = registerDevice(t.home, root, { host: 'mac-1', name: opts.name ?? 'founder', publicKeyPem: devKey.publicKeyPem, principalKind: opts.principalKind ?? 'human' });
  const now = { t: Date.now() };
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root, clock: () => now.t, ...opts.daemon });
  cleanups.push(() => d.shutdown('signal'));
  // The CLIENT side resolves the kernel key from the registry with only the root PUBLIC key.
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  const pin = { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! };
  expect(pin.publicKeyPem).toBeDefined();
  const cred = { principalId: entry.principalId, deviceId: entry.deviceId, signer: loadDeviceKey(t.home) };
  return { home: t.home, d, root, pin, cred, now };
}

type Row = { seq: number; kind: string; principal: string; sig: string | null; env: { connId?: string; deviceId?: string; payload?: Record<string, unknown> } };
function rows(home: string): Row[] {
  const db = new DatabaseSync(path.join(home, 'kernel.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT seq, kind, principal, sig, envelope FROM chain ORDER BY seq').all() as Array<{ seq: number; kind: string; principal: string; sig: string | null; envelope: string }>).map(
      (r) => ({ seq: r.seq, kind: r.kind, principal: r.principal, sig: r.sig, env: JSON.parse(r.envelope) }),
    );
  } finally {
    db.close();
  }
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

const errReason = (f: RpcResponseFrame): string | undefined => reasonOf(f);

describe('hello negotiation (§4.9)', () => {
  it('happy path: highest shared clientApi, nonce, serverKeyId = kernel key, clientApiId and kitId', async () => {
    const r = await rig();
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, clientApis: ['gnomon-rpc:v1', 'gnomon-rpc:v9'], serverKey: r.pin });
    cleanups.push(() => s.conn.close());
    expect(validateHelloResult(s.hello)).toEqual([]);
    expect(s.hello).toMatchObject({ clientApi: 'gnomon-rpc:v1', features: [], serverKeyId: r.d.kernelSigner.keyId, clientApiId: CLIENT_API_ID, kitId: KIT_ID });
    expect(s.serverVerified).toBe(true);
    expect(s.clientApiIdMatches).toBe(true);
    // hello is answered once per connection
    const again = await s.conn.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    expect(errReason(again)).toBe('hello-repeated');
  });

  it('version mismatch: UNSUPPORTED (-32005) with data.offered[]; the connection may retry', async () => {
    const r = await rig();
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => c.close());
    const resp = await c.call('hello', { clientApis: ['gnomon-rpc:v2', 'gnomon-rpc:v3'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    expect(resp).toMatchObject({ error: { code: -32005, data: { schemaVersion: 'refusal:v1', code: 'UNSUPPORTED', data: { offered: ['gnomon-rpc:v2', 'gnomon-rpc:v3'], supported: ['gnomon-rpc:v1'] } } } });
    expect(isRefusalV1((resp as { error: { data: unknown } }).error.data, { mode: 'tolerant' })).toBe(true);
    const ok = await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    expect('result' in ok).toBe(true);
    await settle();
    const hellos = rows(r.home).filter((x) => x.kind === 'socket.hello').map((x) => x.env.payload);
    expect(hellos).toEqual([
      expect.objectContaining({ outcome: 'no-shared-client-api', clientApi: null, offered: ['gnomon-rpc:v2', 'gnomon-rpc:v3'] }),
      expect.objectContaining({ outcome: 'ok', clientApi: 'gnomon-rpc:v1', client: { name: 'gnomon-test', version: '0.0.0', surface: 'cli' } }),
    ]);
  });
});

describe('serverSig — the kernel proves itself before auth is sent', () => {
  it('verifies against the registry kernel key; forged sig, impostor key and relayed path are rejected', async () => {
    const r = await rig();
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => c.close());
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    const sock = r.d.pidfile.socketPath;
    expect(() => verifyServerHello(h.result, sock, r.pin, TEST_CLIENT_NONCE)).not.toThrow();
    // forged: a signature by another Ed25519 key, labelled with the real serverKeyId
    const impostor = SoftwareEd25519Signer.generate('kernel');
    const forged = { ...h.result, serverSig: Buffer.from(impostor.sign('authServer', `${h.result.nonce}\n${sock}`)).toString('base64') };
    expect(() => verifyServerHello(forged, sock, r.pin, TEST_CLIENT_NONCE)).toThrow(expect.objectContaining({ reason: 'bad-server-sig' }));
    // a flipped byte
    const raw = Buffer.from(h.result.serverSig, 'base64');
    raw[0] = raw[0]! ^ 1;
    expect(() => verifyServerHello({ ...h.result, serverSig: raw.toString('base64') }, sock, r.pin, TEST_CLIENT_NONCE)).toThrow(ServerAuthError);
    // impostor kernel presenting its own key id: not the registered kernel key
    const impHello = { ...h.result, serverKeyId: impostor.keyId, serverSig: forged.serverSig };
    expect(() => verifyServerHello(impHello, sock, r.pin, TEST_CLIENT_NONCE)).toThrow(expect.objectContaining({ reason: 'server-key-mismatch' }));
    // a relay answering on another endpoint path: the client checks over ITS path
    expect(() => verifyServerHello(h.result, `${sock}.relay`, r.pin, TEST_CLIENT_NONCE)).toThrow(expect.objectContaining({ reason: 'bad-server-sig' }));
    // P8-D93 r2: the server-sig domain is v2 in the kernel signer AND the contracts; a v1-domain signature over the same message is refused
    expect(SIGNATURE_DOMAINS.authServer).toBe(AUTH_SERVER_DOMAIN);
    expect(AUTH_SERVER_DOMAIN).toBe('gnomon:auth-server:v2');
    const { generateKeyPairSync, sign: edSign } = await import('node:crypto');
    const kp = generateKeyPairSync('ed25519');
    const pem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const keyId = new KeyRing().addEd25519(pem);
    const pin2 = { keyId, publicKeyPem: pem };
    const msg = authServerMessage(h.result.nonce, TEST_CLIENT_NONCE, sock, { clientApi: h.result.clientApi, features: h.result.features });
    const sigWith = (domain: string): string => edSign(null, Buffer.from(`${domain}\n${msg}`), kp.privateKey).toString('base64');
    expect(() => verifyServerHello({ ...h.result, serverKeyId: keyId, serverSig: sigWith('gnomon:auth-server:v2') }, sock, pin2, TEST_CLIENT_NONCE)).not.toThrow();
    expect(() => verifyServerHello({ ...h.result, serverKeyId: keyId, serverSig: sigWith('gnomon:auth-server:v1') }, sock, pin2, TEST_CLIENT_NONCE)).toThrow(expect.objectContaining({ reason: 'bad-server-sig' }));
    // the kernel key never signs the client auth domain (no signing oracle)
    expect(() => r.d.kernelSigner.sign('auth', 'x')).toThrow(/may not sign/);
  });

  it('G-SOCK-02: connectGnomon never sends auth to an unverified server', async () => {
    const r = await rig();
    const wrongPin = { keyId: SoftwareEd25519Signer.generate().keyId, publicKeyPem: SoftwareEd25519Signer.generate().publicKeyPem };
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: wrongPin, device: r.cred })).rejects.toThrow(ServerAuthError);
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, device: r.cred })).rejects.toThrow(/unverified server/);
    await settle();
    expect(rows(r.home).filter((x) => x.kind.startsWith('socket.auth'))).toEqual([]); // no auth frame reached the kernel
  });
});

describe('device-key auth (§4.9 S-H4, §3.1)', () => {
  it('G-ABI-03: a registered device authenticates; status is served for real, < 50 ms', async () => {
    const r = await rig();
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    cleanups.push(() => s.conn.close());
    expect(s.principal).toBe(r.cred.principalId);
    expect(s.connId).toMatch(/^conn:[0-9A-HJKMNP-TV-Z]{26}$/);
    const st = await s.conn.call('status', {});
    expect(st).toMatchObject({
      result: {
        principal: r.cred.principalId,
        principalKind: 'human',
        connId: s.connId,
        deviceId: r.cred.deviceId,
        surface: 'cli',
        clientApi: 'gnomon-rpc:v1',
        clientApiId: CLIENT_API_ID,
        kitId: KIT_ID,
        abiId: ABI_ID,
        sessions: { n: 0 },
        cards: { n: 0, pendingForYou: 0 },
        kernelKeyId: r.d.kernelSigner.keyId,
        kernelKeyCustody: 'partial',
        kernelKeySource: 'supplied-software',
        root: { state: 'dev-test', rootKeyId: r.root.rootKeyId },
        daemon: { pid: process.pid, socketPath: r.d.pidfile.socketPath, connections: 1 },
        log: { log: r.d.log.logId },
        web: { listening: false },
      },
    });
    const res = (st as { result: { verbs: Array<{ verb: string; available: boolean }>; relays: unknown[]; nextLegalVerbs: Array<{ verb: string }>; clients: unknown[]; log: { seq: number } } }).result;
    expect(res.verbs.map((v) => v.verb)).toEqual(CLIENT_METHODS.slice(0, 12));
    expect(res.verbs.filter((v) => v.available).map((v) => v.verb)).toEqual(['status', 'session.open', 'session.send', 'session.stop', 'log.read', 'permit.reserve', 'approve', 'ref.resolve']); // approve + permit.reserve served since M1.6; session.* for the human since M1.7 slice 1
    expect(res.relays).toHaveLength(2);
    expect(res.nextLegalVerbs.map((v) => v.verb)).toEqual(['session.open', 'permit.reserve', 'status']);
    expect(res.clients).toEqual([{ connId: s.connId, principal: r.cred.principalId, surface: 'cli', client: { name: 'gnomon-test', version: '0.0.0' }, conformance: null }]);
    expect(res.log.seq).toBe(r.d.log.head().seq);

    const times: number[] = [];
    for (let i = 0; i < 205; i++) {
      const t0 = process.hrtime.bigint();
      const x = await s.conn.call('status', {});
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      expect('result' in x).toBe(true);
    }
    const measured = times.slice(5).sort((a, b) => a - b); // first 5 = warm-up
    const pct = (p: number): number => measured[Math.min(measured.length - 1, Math.floor((p / 100) * measured.length))]!;
    const report = { n: measured.length, p50: pct(50).toFixed(3), p95: pct(95).toFixed(3), p99: pct(99).toFixed(3), max: measured[measured.length - 1]!.toFixed(3) };
    process.stdout.write(`G-ABI-03 status round-trip ms ${JSON.stringify(report)}\n`);
    expect(pct(99)).toBeLessThan(50); // G-ABI-03
    expect(measured[measured.length - 1]!).toBeLessThan(250); // generous hard ceiling against a scheduler hiccup
  });

  it('an unknown device key is refused AUTH, logged socket.auth.fail, and the connection closes', async () => {
    const r = await rig();
    const stranger = SoftwareEd25519Signer.generate('device');
    const cred = { ...r.cred, signer: stranger, deviceId: r.cred.deviceId.replace('mac-1', 'mac-2') };
    const err = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: cred }).catch((e: unknown) => e);
    expect(err).toMatchObject({ refusal: { code: 'AUTH', data: { reason: 'unknown-device' } } });
    // a registered deviceId with the wrong key: bad-signature
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    const bad = await c.call('auth', { principal: r.cred.principalId, deviceId: r.cred.deviceId, sig: signAuth({ ...r.cred, signer: stranger }, h.result, r.d.pidfile.socketPath) });
    expect(bad).toMatchObject({ error: { code: -32001, data: { code: 'AUTH', data: { reason: 'bad-signature' } } } });
    const after = await c.call('status', {});
    expect(errReason(after)).toBe('connection-closed'); // one AUTH refusal, then closed
    expect(c.closed).toBe(true);
    await settle();
    const fails = rows(r.home).filter((x) => x.kind === 'socket.auth.fail');
    expect(fails.map((x) => [x.env.payload?.reason, x.env.deviceId])).toEqual([
      ['unknown-device', cred.deviceId],
      ['bad-signature', r.cred.deviceId],
    ]);
    expect(fails.every((x) => typeof x.env.connId === 'string' && x.sig !== null && x.principal === r.d.kernelPrincipal)).toBe(true);
  });

  it('a replayed auth transcript is refused and logged socket.auth.replay (other connection and same connection)', async () => {
    const r = await rig();
    const a = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => a.close());
    const h = (await a.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    const authParams = { principal: r.cred.principalId, deviceId: r.cred.deviceId, sig: signAuth(r.cred, h.result, r.d.pidfile.socketPath) };
    expect(await a.call('auth', authParams)).toMatchObject({ result: { principal: r.cred.principalId } });
    // captured transcript replayed on a fresh connection (after its own hello)
    const b = await RpcConnection.open(r.d.pidfile.socketPath);
    await b.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    const replay = await b.call('auth', authParams);
    expect(replay).toMatchObject({ error: { code: -32001, data: { data: { reason: 'replayed-transcript' } } } });
    expect(errReason(await b.call('status'))).toBe('connection-closed');
    // replayed on the original connection: its nonce is spent
    const again = await a.call('auth', authParams);
    expect(errReason(again)).toBe('already-authenticated');
    // and on a connection that never said hello
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    expect(errReason(await c.call('auth', authParams))).toBe('no-hello');
    await settle();
    const replays = rows(r.home).filter((x) => x.kind === 'socket.auth.replay').map((x) => x.env.payload?.reason);
    expect(replays).toEqual(['replayed-transcript', 'already-authenticated']);
  });

  it('the nonce is valid 30 s: just under succeeds; just over is AUTH nonce-expired, logged, and closes', async () => {
    const r = await rig();
    const ok = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => ok.close());
    const h1 = (await ok.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    r.now.t += 29_999;
    expect(await ok.call('auth', { principal: r.cred.principalId, deviceId: r.cred.deviceId, sig: signAuth(r.cred, h1.result, r.d.pidfile.socketPath) })).toMatchObject({ result: { principal: r.cred.principalId } });
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    r.now.t += 30_001;
    const late = await c.call('auth', { principal: r.cred.principalId, deviceId: r.cred.deviceId, sig: signAuth(r.cred, h.result, r.d.pidfile.socketPath) });
    expect(errReason(late)).toBe('nonce-expired');
    expect(errReason(await c.call('status'))).toBe('connection-closed');
    expect(c.closed).toBe(true);
    expect(rows(r.home).filter((x) => x.kind === 'socket.auth.fail').map((x) => x.env.payload?.reason)).toEqual(['nonce-expired']);
  });

  it('principal mismatch, foreign principal and malformed params are AUTH', async () => {
    const r = await rig();
    for (const [principal, want] of [
      [r.cred.principalId.replace('/founder', '/other'), 'principal-mismatch'],
      [`${r.cred.principalId}@0123abcd`, 'foreign-principal'],
    ] as const) {
      const c = await RpcConnection.open(r.d.pidfile.socketPath);
      const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
      const resp = await c.call('auth', { principal, deviceId: r.cred.deviceId, sig: signAuth({ ...r.cred, principalId: principal }, h.result, r.d.pidfile.socketPath) });
      expect(errReason(resp)).toBe(want);
    }
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    expect(errReason(await c.call('auth', { deviceId: r.cred.deviceId }))).toBe('auth-params');
    const t = await RpcConnection.open(r.d.pidfile.socketPath);
    await t.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    // read tokens are proof of possession since M1.4 slice 3 (socket-abi.test.ts): a bearer {token} is never accepted
    expect(await t.call('auth', { token: 'x' })).toMatchObject({ error: { code: -32001, data: { data: { reason: 'auth-params' } } } });
  });
});

describe('verb dispatch skeleton (§5)', () => {
  it('G-SOCK-01: unauthenticated callers get only hello/auth; any other known method is AUTH and closes the connection (before and after hello); unknown names are UNKNOWN_VERB', async () => {
    const r = await rig();
    for (const m of CLIENT_METHODS) {
      const c = await RpcConnection.open(r.d.pidfile.socketPath);
      cleanups.push(() => c.close());
      expect(errReason(await c.call(m, {}))).toBe('unauthenticated');
      expect(errReason(await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT }))).toBe('connection-closed');
      expect(c.closed).toBe(true);
    }
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => c.close());
    expect(await c.call('daemon.stop', {})).toMatchObject({ error: { code: -32601 } }); // unknown: refused, connection kept
    await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    expect(await c.call('status', {})).toMatchObject({ error: { code: -32001, data: { code: 'AUTH', data: { reason: 'unauthenticated' } } } });
    expect(errReason(await c.call('status', {}))).toBe('connection-closed');
    expect(c.closed).toBe(true);
  });

  it('after auth: the other 9 verbs + 2 relays (log.read / ref.resolve are served since M1.4 slice 2, test/socket-log-read.test.ts) refuse ENGINE not-implemented naming the milestone — or FORBIDDEN by the matrix', async () => {
    const r = await rig();
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    cleanups.push(() => s.conn.close());
    const got: Record<string, unknown> = {};
    for (const m of CLIENT_METHODS.filter((x) => x !== 'status' && x !== 'log.read' && x !== 'ref.resolve')) {
      const f = await s.conn.call(m, {});
      expect('error' in f).toBe(true);
      const e = (f as { error: { code: number; data: { data: { reason: string; milestone?: string } } } }).error;
      got[m] = [e.code, e.data.data.reason, e.data.data.milestone];
    }
    expect(got).toEqual({
      'session.open': [-32600, 'bad-params', undefined], // served for the human since M1.7 slice 1 (#supervisor): {} has no cwd
      'session.send': [-32600, 'bad-params', undefined],
      'session.stop': [-32600, 'bad-params', undefined],
      'log.append': [-32600, 'bad-kind', undefined], // the ownership gate (M1.4 slice 3, socket-abi.test.ts G-SOCK-04)
      'permit.reserve': [-32600, 'bad-params', undefined], // served since M1.6 (#budget-fuse): {} has no kind
      approve: [-32600, 'bad-params', undefined], // served since M1.6 (#approval-broker): {} has no cardId
      'contract.register': [-32000, 'not-implemented', 'M2.1'],
      'contract.claim': [-32000, 'not-implemented', 'M2.2'],
      'oracle.run': [-32000, 'not-implemented', 'M2.3'],
      'mod.view': [-32600, 'bad-params', undefined], // served since M1.11 slice 2 (#mod-host relays): {} has no name/viewId
      'mod.command': [-32600, 'bad-params', undefined],
    });
  });

  it('an agent-class device: approve is FORBIDDEN by the matrix (HUMAN_ONLY), status served', async () => {
    const r = await rig({ principalKind: 'agent' });
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    cleanups.push(() => s.conn.close());
    expect(await s.conn.call('approve', {})).toMatchObject({ error: { code: -32002, data: { code: 'FORBIDDEN', data: { reason: 'matrix', principalClass: 'agent' } } } });
    expect(await s.conn.call('status', {})).toMatchObject({ result: { principalKind: 'agent' } });
  });
});

describe('kernel log rows for every auth outcome', () => {
  it('daemon.start, socket.connect, socket.hello, socket.auth.ok — kernel-signed, with connId and deviceId; the chain verifies', async () => {
    const r = await rig();
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    await s.conn.close();
    await settle();
    await r.d.flushDiagnostics();
    const rs = rows(r.home);
    expect(rs.map((x) => x.kind)).toEqual(['daemon.start', 'socket.hello', 'socket.auth.ok', 'socket.connect']);
    expect(rs[0]!.env.payload).toMatchObject({ kernelKeyId: r.d.kernelSigner.keyId, kernelKeySource: 'supplied-software', kernelKeyCustody: 'partial', root: 'dev-test' });
    expect(rs[3]!.env.payload).toMatchObject({ coalesced: true, count: 1 });
    const ok = rs[2]!;
    expect(ok.env).toMatchObject({ connId: s.connId, deviceId: r.cred.deviceId, payload: { principal: r.cred.principalId, principalKind: 'human', surface: 'cli' } });
    expect(rs.every((x) => x.sig !== null && x.principal === r.d.kernelPrincipal)).toBe(true);
    expect(r.d.kernelPrincipal).toBe(`p:${r.root.ns}/kernel`);
    const v = r.d.log.verify();
    expect(v.failures).toEqual([]);
  });
});

describe('#identity seams: production root, registry trust, device key file', () => {
  it('production (no root) refuses registration naming M1.3 and no device ever authenticates', async () => {
    const prod = new UnprovisionedRootAuthority();
    const t = tempHome('gp-');
    cleanups.push(t.cleanup);
    const key = SoftwareEd25519Signer.generate('device');
    const e = (() => {
      try {
        registerDevice(t.home, prod, { host: 'mac-1', name: 'founder', publicKeyPem: key.publicKeyPem });
      } catch (x) {
        return x;
      }
    })();
    expect(e).toBeInstanceOf(RootUnavailableError);
    expect((e as RootUnavailableError).refusal).toMatchObject({ code: 'UNSUPPORTED', data: { reason: 'root-unprovisioned', milestone: 'M1.3' } });
    expect(() => new DevTestRootAuthority('yes' as never)).toThrow(/DEV_TEST_ROOT_ACK/);
    // a daemon on the default (unprovisioned) root: hello works, auth is refused root-unprovisioned
    const d = await startDaemon({ home: t.home, idleMs: 60_000 });
    cleanups.push(() => d.shutdown('signal'));
    expect(d.kernelPrincipal).toBe('p:00000000/kernel');
    const c = await RpcConnection.open(d.pidfile.socketPath);
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    const resp = await c.call('auth', { principal: 'p:abcdefgh/founder', deviceId: 'dev:abcdefgh/mac-1', sig: Buffer.from(key.sign('auth', h.result.nonce)).toString('base64') });
    expect(resp).toMatchObject({ error: { code: -32001, data: { data: { reason: 'root-unprovisioned', milestone: 'M1.3' } } } });
  });

  it('registry: rows signed by another root, tampered rows and unsigned lines never resolve and are surfaced', () => {
    const t = tempHome('gr-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const other = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const k1 = SoftwareEd25519Signer.generate('device');
    registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: k1.publicKeyPem });
    registerDevice(t.home, other, { host: 'mac-9', name: 'mallory', publicKeyPem: SoftwareEd25519Signer.generate('device').publicKeyPem });
    const lines = readFileSync(registryPath(t.home), 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[0]!);
    tampered.row.principalId = tampered.row.principalId.replace('founder', 'admin');
    appendFileSync(registryPath(t.home), `${JSON.stringify(tampered)}\nnot json\n${JSON.stringify({ row: tampered.row })}\n`);
    const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
    expect([...reg.devices.keys()]).toEqual([`dev:${root.ns}/mac-1`]);
    expect(reg.rejected.map((x) => x.reason)).toEqual(['untrusted-signer', 'bad-signature', 'malformed', 'unsigned']);
    // the unprovisioned verifier resolves nothing
    expect(readRegistry(t.home, new UnprovisionedRootAuthority()).devices.size).toBe(0);
  });

  it('device key file: created 0600 O_EXCL; group/other bits or a second write are refused', () => {
    const t = tempHome('gk-');
    cleanups.push(t.cleanup);
    const k = writeNewDeviceKey(t.home);
    expect(loadDeviceKey(t.home).keyId).toBe(k.keyId);
    expect(() => writeNewDeviceKey(t.home)).toThrow(/EEXIST/);
    const file = path.join(t.home, 'keys', 'device.key');
    chmodSync(file, 0o644);
    expect(() => loadDeviceKey(t.home)).toThrow(DeviceKeyError);
    chmodSync(file, 0o600);
    chmodSync(path.join(t.home, 'keys'), 0o755);
    expect(() => loadDeviceKey(t.home)).toThrow(/not owner-only/);
    chmodSync(path.join(t.home, 'keys'), 0o700);
    writeFileSync(file, 'garbage');
    expect(() => loadDeviceKey(t.home)).toThrow(expect.objectContaining({ reason: 'not-ed25519' }));
    // a device signer cannot approve (§3.1)
    expect(() => k.sign('approve', 'x')).toThrow(/may not sign/);
  });
});

describe('round 2: log-before-reply, scoped access, pre-auth limits, flow control, coalescing, kernel-pub', () => {
  it('socket.hello and socket.auth.ok rows exist the moment the reply arrives (no settle)', async () => {
    const r = await rig();
    const c = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => c.close());
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    expect(rows(r.home).map((x) => x.kind)).toContain('socket.hello');
    const a = await c.call('auth', { principal: r.cred.principalId, deviceId: r.cred.deviceId, sig: signAuth(r.cred, h.result, r.d.pidfile.socketPath) });
    expect('result' in a).toBe(true);
    const ok = rows(r.home).filter((x) => x.kind === 'socket.auth.ok');
    expect(ok.map((x) => x.env.connId)).toEqual([(a as { result: { connId: string } }).result.connId]);
  });

  it('a failing log: auth is refused ENGINE log-write-failed, the connection closes, status is never served; a failing hello row closes too', async () => {
    const t = tempHome('gf-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    const devKey = writeNewDeviceKey(t.home);
    const entry = registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: devKey.publicKeyPem });
    const sock = path.join(t.home, 'g.sock');
    let failKind = 'socket.auth.ok';
    const dispatcher = createKernelDispatcher({
      authenticator: new SocketAuthenticator({ home: t.home, endpointPath: sock, kernelSigner: kernel, trust: root }),
      status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: root.rootKeyId }) },
      log: async (kind) => {
        if (kind === failKind) throw new Error('disk full');
      },
    });
    const srv = await listenSocket({ socketPath: sock, handle: dispatcher.handle, onConnect: dispatcher.onConnect, onDisconnect: dispatcher.onDisconnect });
    cleanups.push(() => srv.close());
    const cred = { principalId: entry.principalId, deviceId: entry.deviceId, signer: devKey };
    const c = await RpcConnection.open(sock);
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    const a = await c.call('auth', { principal: cred.principalId, deviceId: cred.deviceId, sig: signAuth(cred, h.result, sock) });
    expect(a).toMatchObject({ error: { code: -32000, data: { code: 'ENGINE', data: { reason: 'log-write-failed' } } } });
    expect(errReason(await c.call('status'))).toBe('connection-closed');
    expect(dispatcher.clients()).toEqual([]);
    failKind = 'socket.hello';
    const c2 = await RpcConnection.open(sock);
    expect(errReason(await c2.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT }))).toBe('log-write-failed');
    expect(errReason(await c2.call('status'))).toBe('connection-closed');
  });

  it('a qualified access value (mod: own view) is refused ENGINE not-implemented naming the milestone, never the full status', async () => {
    const r = await rig({ principalKind: 'mod', name: 'mod-workshop' });
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    cleanups.push(() => s.conn.close());
    const st = await s.conn.call('status', {});
    expect(st).toMatchObject({ error: { code: -32000, data: { data: { reason: 'not-implemented', access: 'own view', milestone: 'M1.11' } } } });
    expect('result' in st).toBe(false);
  });

  it('pre-auth: no hello by the deadline closes; not authenticated by the nonce TTL closes; the pre-auth cap closes the next connection; all counted in one coalesced row', async () => {
    const r = await rig({ daemon: { helloTimeoutMs: 300, preAuthTimeoutMs: 1500, maxPreAuth: 2 } });
    const waitFor = async (cond: () => boolean, ms: number): Promise<number> => {
      const t0 = Date.now();
      while (!cond() && Date.now() - t0 < ms) await new Promise((res) => setTimeout(res, 10));
      return Date.now() - t0;
    };
    const t0 = Date.now();
    const idle = await RpcConnection.open(r.d.pidfile.socketPath);
    const helloOnly = await RpcConnection.open(r.d.pidfile.socketPath);
    await helloOnly.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    const capped = await RpcConnection.open(r.d.pidfile.socketPath);
    await waitFor(() => capped.closed, 2000);
    expect(capped.closed).toBe(true); // third pre-auth connection over the cap of 2
    await waitFor(() => idle.closed, 3000);
    expect(idle.closed).toBe(true); // no hello within 300 ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(helloOnly.closed).toBe(Date.now() - t0 >= 1500); // still open unless the 1.5 s TTL already passed
    await waitFor(() => helloOnly.closed, 5000);
    expect(helloOnly.closed).toBe(true); // hello but no auth by the TTL
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    // an authenticated connection outlives both deadlines
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    cleanups.push(() => s.conn.close());
    await new Promise((res) => setTimeout(res, 1800));
    expect(s.conn.closed).toBe(false);
    await r.d.flushDiagnostics();
    const conn = rows(r.home).filter((x) => x.kind === 'socket.connect');
    expect(conn).toHaveLength(1);
    expect(conn[0]!.env.payload).toMatchObject({ coalesced: true, count: 4, preAuthClosed: { 'pre-auth-cap': 1, 'hello-timeout': 1, 'pre-auth-timeout': 1 } });
    expect(conn[0]!.sig).not.toBeNull();
  });

  it('flow control: reading pauses at maxInFlight and at the write high-water mark; every reply still arrives, in order', async () => {
    for (const daemon of [{ maxInFlight: 2 }, { writeHighWater: 1 }]) {
      const r = await rig({ daemon });
      const c = await rawConnect(r.d.pidfile.socketPath);
      cleanups.push(c.close);
      // unknown names: answered without closing (a known verb before auth closes, G-SOCK-01)
      c.send(Buffer.concat(Array.from({ length: 60 }, (_, i) => encodeFrame(requestFrame(i, 'no.such')))));
      const got = await c.next(60, 5000);
      expect(got.map((f) => f.id)).toEqual(Array.from({ length: 60 }, (_, i) => i));
      expect(r.d.server.stats().pauses).toBeGreaterThan(0);
    }
  });

  it('a pre-auth flood is coalesced: 20 connections and 10 bad frames = one socket.connect row and one socket.frame.refused row', async () => {
    const r = await rig();
    const cs = await Promise.all(Array.from({ length: 20 }, () => RpcConnection.open(r.d.pidfile.socketPath)));
    const raw = await rawConnect(r.d.pidfile.socketPath);
    for (let i = 0; i < 10; i++) raw.send('{nope\n');
    await raw.next(10);
    await Promise.all([...cs.map((c) => c.close()), raw.close()]);
    await r.d.flushDiagnostics();
    const rs = rows(r.home);
    expect(rs.filter((x) => x.kind === 'socket.connect').map((x) => x.env.payload)).toEqual([expect.objectContaining({ coalesced: true, count: 21 })]);
    expect(rs.filter((x) => x.kind === 'socket.frame.refused').map((x) => x.env.payload)).toEqual([
      expect.objectContaining({ coalesced: true, count: 10, byReason: { 'malformed-json': 10 } }),
    ]);
  });

  it('ephemeral kernel keys across restarts: public halves recorded 0600; start, append, stop, start ⇒ full-chain verify ok, kernelBinding ok', async () => {
    const t = tempHome('gx-');
    cleanups.push(t.cleanup);
    const d1 = await startDaemon({ home: t.home, idleMs: 60_000 });
    const c = await RpcConnection.open(d1.pidfile.socketPath);
    await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    await c.close();
    await d1.shutdown('signal');
    const d2 = await startDaemon({ home: t.home, idleMs: 60_000 });
    cleanups.push(() => d2.shutdown('signal'));
    expect(d2.kernelSigner.keyId).not.toBe(d1.kernelSigner.keyId);
    const pubs = readKernelPubs(t.home).map((k) => k.keyId);
    expect(pubs).toEqual([d1.kernelSigner.keyId, d2.kernelSigner.keyId]);
    expect(statSync(path.join(t.home, 'keys', 'kernel-pub.jsonl')).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(t.home, 'keys', 'kernel-pub.jsonl'), 'utf8')).not.toMatch(/PRIVATE/);
    const v = d2.log.verify();
    expect(v.failures).toEqual([]);
    expect(v.kernelBinding).toBe('ok');
    const starts = rows(t.home).filter((x) => x.kind === 'daemon.start').map((x) => x.env.payload?.kernelKeyId);
    expect(starts).toEqual([d1.kernelSigner.keyId, d2.kernelSigner.keyId]);
  });
});

describe('wire reasons', () => {
  it("'connection-closed' is client-local: no server-side socket module can emit it", () => {
    for (const f of ['server.ts', 'dispatch.ts', 'auth.ts', 'rpc.ts']) {
      expect(readFileSync(path.join(__dirname, '..', 'src', 'kernel', 'socket', f), 'utf8')).not.toContain('connection-closed');
    }
    expect(readFileSync(path.join(__dirname, '..', 'src', 'kernel', 'socket', 'client.ts'), 'utf8')).toContain("reason: 'connection-closed'");
  });
});

describe('round 3: pre-auth row rate limit, frame cap, hello-not-offered', () => {
  it('200 × connect→hello→bad auth→close adds at most 8 individual + 1 counter row per kind per window', async () => {
    const r = await rig({ daemon: { diagFlushMs: 600_000 } });
    const before = rows(r.home).length;
    const stranger = SoftwareEd25519Signer.generate('device');
    for (let i = 0; i < 200; i++) {
      const c = await RpcConnection.open(r.d.pidfile.socketPath);
      const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
      const bad = await c.call('auth', { principal: r.cred.principalId, deviceId: 'dev:' + r.root.ns + '/ghost', sig: signAuth({ ...r.cred, deviceId: 'dev:' + r.root.ns + '/ghost', signer: stranger }, h.result, r.d.pidfile.socketPath) });
      expect(errReason(bad)).toBe('unknown-device');
      await c.close();
    }
    await settle();
    await r.d.flushDiagnostics();
    const rs = rows(r.home).slice(before);
    const of = (k: string) => rs.filter((x) => x.kind === k);
    expect(of('socket.hello').filter((x) => !x.env.payload?.coalesced)).toHaveLength(8);
    expect(of('socket.hello').filter((x) => x.env.payload?.coalesced).map((x) => x.env.payload)).toEqual([expect.objectContaining({ count: 192, byOutcome: { ok: 192 } })]);
    expect(of('socket.auth.fail').filter((x) => !x.env.payload?.coalesced)).toHaveLength(8);
    expect(of('socket.auth.fail').filter((x) => x.env.payload?.coalesced).map((x) => x.env.payload)).toEqual([expect.objectContaining({ count: 192, byReason: { 'unknown-device': 192 } })]);
    expect(of('socket.connect').map((x) => x.env.payload)).toEqual([expect.objectContaining({ coalesced: true, count: 200 })]);
    expect(rs.length).toBeLessThanOrEqual(8 + 1 + 8 + 1 + 1);
    expect(rs.every((x) => x.sig !== null)).toBe(true);
    process.stdout.write(`pre-auth flood: 200 loops -> ${rs.length} rows ${JSON.stringify(rs.reduce((m: Record<string, number>, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {}))}\n`);
  });

  it('inbound frames are capped at 16 KiB until auth succeeds, then the full limit applies', async () => {
    const r = await rig();
    const big = { pad: 'x'.repeat(20 * 1024) };
    const pre = await RpcConnection.open(r.d.pidfile.socketPath);
    cleanups.push(() => pre.close());
    const raw = await rawConnect(r.d.pidfile.socketPath);
    cleanups.push(raw.close);
    raw.send(requestFrame(1, 'status', big));
    const [refused] = await raw.next(1);
    expect((refused!.error as { data: { data: { reason: string } } }).data.data.reason).toBe('frame-too-large');
    const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
    cleanups.push(() => s.conn.close());
    expect(await s.conn.call('status', big)).toMatchObject({ result: { principal: r.cred.principalId } });
  });

  it('the client refuses a hello that picks a clientApi or feature it did not offer (hello-not-offered, client-local)', async () => {
    const t = tempHome('gh-');
    cleanups.push(t.cleanup);
    const sock = path.join(t.home, 'f.sock');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    for (const result of [
      { clientApi: 'gnomon-rpc:v9', features: [] },
      { clientApi: 'gnomon-rpc:v1', features: ['sneaky'] },
    ]) {
      const srv = await listenSocket({
        socketPath: sock,
        handle: () => ({ ...result, nonce: 'n', serverKeyId: 'gkey:v1:' + '0'.repeat(64), serverSig: 'AA==', clientApiId: CLIENT_API_ID, kitId: KIT_ID }),
      });
      await expect(connectGnomon({ socketPath: sock, client: CLIENT })).rejects.toMatchObject({ reason: 'hello-not-offered' });
      await srv.close();
    }
  });

  it('T-2026-10-18-016: a genuine hello recorded on one connection and replayed from a squatted socket is refused before auth — verbatim (client-nonce-mismatch) and echo-rewritten (bad-server-sig)', async () => {
    const r = await rig();
    const real = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin });
    const recorded = real.hello;
    await real.conn.close();
    expect(recorded.clientNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sock = path.join(r.home, 'squat.sock');
    for (const [mode, reason] of [['verbatim', 'client-nonce-mismatch'], ['echo-rewrite', 'bad-server-sig']] as const) {
      let auths = 0;
      const srv = await listenSocket({
        socketPath: sock,
        handle: (frame: { method: string; params?: { clientNonce?: string } }) => {
          if (frame.method === 'auth') auths++;
          return mode === 'verbatim' ? recorded : { ...recorded, clientNonce: frame.params?.clientNonce };
        },
      } as never);
      // the client derives the REAL endpoint path, so only the nonce differs from the recorded transcript
      await expect(connectGnomon({ socketPath: sock, endpointPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred })).rejects.toMatchObject({ reason });
      await new Promise((res) => setTimeout(res, 30));
      expect(auths).toBe(0);
      await srv.close();
    }
  });
});
