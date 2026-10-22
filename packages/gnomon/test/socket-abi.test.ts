// @gnomon-platform: darwin, linux
/**
 * #socket + #identity M1.4 slice 3 (spec §4.9, §5, §9.3): read tokens, and the
 * M1.4 acceptance suites as named tests — G-ABI-01..05 and G-SOCK-01..04.
 *
 * The oracle texts are not restated in spec v3.9 (only their ids, in §5,
 * §9.3, §10 law 3 and the M1.4 row); the definitions used here are spec v2's
 * M1.4 row (3b352368): G-ABI-01 ≤ 12; G-ABI-02 matrix total; G-ABI-03 status
 * < 50 ms; G-ABI-04 frozen tripwire; G-ABI-05 redaction matrix; G-SOCK-01
 * unauthenticated ⇒ AUTH + close; G-SOCK-02 relay without serverSig rejected
 * by the client; G-SOCK-03 lag drop logged; G-SOCK-04 log.append of a
 * kernel-owned kind ⇒ FORBIDDEN for every class. Parts owned by a later
 * milestone assert today's refusal and are `it.todo` naming that milestone.
 * Elsewhere: G-SOCK-01 also in socket-auth.test.ts, G-SOCK-02 (device form)
 * and G-ABI-03 (device) in socket-auth.test.ts, G-SOCK-03 in
 * socket-log-read.test.ts.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_API_ID,
  CLIENT_METHODS,
  CLIENT_RELAYS,
  EVENT_KIND_NAMES,
  EVENT_KINDS,
  KIT_ID,
  OPEN_USERLAND_NAMESPACES,
  VERBS,
  authTokenMessage,
  canonicalJson,
  hex,
  kindOwner,
  sha256,
  type EventV1,
  type HelloResult,
  type PrincipalKind,
} from '@a-company/gnomon-contracts';
import { HUMAN_DEVICE_VERBS } from '@a-company/gnomon-contracts';
import {
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  READ_TOKEN_MAX_TTL_MS,
  RootUnavailableError,
  RootVerifier,
  UnprovisionedRootAuthority,
  loadDeviceKey,
  mintReadToken,
  parseReadToken,
  readRegistry,
  readTokensPath,
  registerDevice,
  registerKernelKey,
  registryPath,
  revokeReadToken,
  writeNewDeviceKey,
} from '../src/kernel/identity/index.js';
import { startDaemon, type DaemonHandle, type DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { projectForReader, SoftwareEd25519Signer, type LogView } from '../src/kernel/log/index.js';
import { mayBeVisible } from '../src/kernel/log/redaction.js';
import {
  ABI_ID,
  NEXT_LEGAL_TABLE,
  RpcConnection,
  ServerAuthError,
  SocketAuthenticator,
  connectGnomon,
  createKernelDispatcher,
  listenSocket,
  type DeviceCredential,
  type GnomonSession,
  type RpcResponseFrame,
  type ServerKeyPin,
} from '../src/kernel/socket/index.js';
import { sleep, tempHome, TEST_CLIENT_NONCE } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

/** The server closed the connection: wait until the client has SEEN the close, so the next call is provably never sent ⇒ exactly `connection-closed` (never `delivery-unknown`, which is only for a frame that was written). */
async function untilClosed(c: { readonly closed: boolean }): Promise<void> {
  for (let i = 0; i < 200 && !c.closed; i++) await new Promise((r) => setTimeout(r, 10));
  expect(c.closed).toBe(true);
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const CLIENT = { name: 'gnomon-test', version: '0.0.0', surface: 'cli' };
const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
const OTHER_HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ1';
const SHA = `sha256:${'a'.repeat(64)}`;
type Res = Record<string, unknown>;

const CLASSES: Array<[PrincipalKind, string]> = [
  ['human', 'founder'],
  ['agent', 'builder'],
  ['session', 'sess-1'],
  ['mod', 'mod-workshop'],
  ['voice', 'voice'],
];

interface Rig {
  home: string;
  d: DaemonHandle;
  root: DevTestRootAuthority;
  pin: ServerKeyPin;
  creds: Map<PrincipalKind, DeviceCredential>;
  now: { t: number };
  kernel: SoftwareEd25519Signer;
}

/** One daemon, one device per constructible principal class (its own key file). */
async function rig(daemon: Partial<DaemonOptions> = {}): Promise<Rig> {
  const t = tempHome('gx-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const creds = new Map<PrincipalKind, DeviceCredential>();
  writeNewDeviceKey(t.home); // creates the owner-only keys/ dir
  for (const [kind, name] of CLASSES) {
    const file = path.join(t.home, 'keys', `${kind}.key`);
    const key = writeNewDeviceKey(t.home, file);
    const e = registerDevice(t.home, root, { host: `host-${kind}`, name, publicKeyPem: key.publicKeyPem, principalKind: kind });
    creds.set(kind, { principalId: e.principalId, deviceId: e.deviceId, signer: loadDeviceKey(t.home, file) });
  }
  const now = { t: Date.now() };
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root, clock: () => now.t, ...daemon });
  cleanups.push(() => d.shutdown('signal'));
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  return { home: t.home, d, root, pin: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! }, creds, now, kernel };
}

async function asDevice(r: Rig, kind: PrincipalKind): Promise<GnomonSession> {
  const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.creds.get(kind)! });
  cleanups.push(() => s.conn.close());
  return s;
}

async function asToken(r: Rig, token: string): Promise<GnomonSession> {
  const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, readToken: token });
  cleanups.push(() => s.conn.close());
  return s;
}

/** hello on a raw connection, then `auth` with arbitrary params. */
async function helloThenAuth(r: Rig, params: unknown): Promise<{ c: RpcConnection; resp: RpcResponseFrame }> {
  const c = await RpcConnection.open(r.d.pidfile.socketPath);
  cleanups.push(() => c.close());
  await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: ['journal.cursor'], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
  return { c, resp: await c.call('auth', params) };
}

/** The read token's proof of possession for one hello (what connectGnomon sends). */
function tokenProof(token: string, hello: HelloResult, endpointPath: string): { tokenId: string; sig: string } {
  const t = parseReadToken(token);
  const msg = authTokenMessage(hello.nonce, hello.serverKeyId, t.tokenId, endpointPath, { clientApi: hello.clientApi, features: hello.features });
  return { tokenId: t.tokenId, sig: Buffer.from(t.signer.sign('authToken', msg)).toString('base64') };
}

async function helloOn(r: Rig): Promise<{ c: RpcConnection; hello: HelloResult }> {
  const c = await RpcConnection.open(r.d.pidfile.socketPath);
  cleanups.push(() => c.close());
  const h = await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: ['journal.cursor'], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
  return { c, hello: (h as { result: HelloResult }).result };
}

const ok = (f: RpcResponseFrame): Res => {
  if ('error' in f) throw new Error(`refused: ${JSON.stringify(f.error)}`);
  return f.result as Res;
};
const errOf = (f: RpcResponseFrame) => ('error' in f ? { code: f.error.code, c: f.error.data.code, reason: f.error.data.data?.reason as string | undefined, milestone: f.error.data.data?.milestone as string | undefined } : null);

type Row = { kind: string; env: { connId?: string; payload?: Record<string, unknown> }; raw: string };
function rows(home: string): Row[] {
  const db = new DatabaseSync(path.join(home, 'kernel.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT kind, envelope FROM chain ORDER BY seq').all() as Array<{ kind: string; envelope: string }>).map((x) => ({ kind: x.kind, env: JSON.parse(x.envelope), raw: x.envelope }));
  } finally {
    db.close();
  }
}

const settle = (): Promise<void> => sleep(50);

/* ── read tokens ──────────────────────────────────────────────────────────── */

describe('read tokens (§4.9 auth {token}, §5 read-token column, §9.3 read-token row)', () => {
  it('minting is a root-signed act: the production root cannot mint, the file holds only the PUBLIC key, TTL and mint clock are bounded, the principal is a local non-kernel one', () => {
    const t = tempHome('gt-');
    cleanups.push(t.cleanup);
    const prod = new UnprovisionedRootAuthority();
    expect(() => mintReadToken(t.home, prod, { principalId: 'p:abcdefgh/console' })).toThrow(RootUnavailableError);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const m = mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: 60_000 });
    expect(m.token).toMatch(/^grt:v1:[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{43}$/);
    expect(m.tokenId).toMatch(/^rtk:[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(parseReadToken(m.token).tokenId).toBe(m.tokenId);
    const file = readFileSync(readTokensPath(t.home), 'utf8');
    expect(file).not.toContain(m.token.split('.')[1]!); // the seed never touches disk
    const row = JSON.parse(file.trim()).row;
    expect(row).toMatchObject({ op: 'mint', tokenId: m.tokenId, keyId: parseReadToken(m.token).signer.keyId, publicKeyPem: expect.stringContaining('PUBLIC KEY') });
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'expiresAt', 'keyId', 'op', 'principalId', 'publicKeyPem', 'schemaVersion', 'tokenId']);
    expect(() => mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: READ_TOKEN_MAX_TTL_MS + 1 })).toThrow(RangeError);
    expect(() => mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, now: new Date(Date.now() + 6 * 60_000) })).toThrow(/real clock/);
    // Aegis follow-up 3: a future `now` inside the slack is clamped — the TTL never stretches past real now + ttl
    const before = Date.now();
    const fut = mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: 60_000, now: new Date(before + 4 * 60_000) });
    expect(Date.parse(fut.expiresAt)).toBeLessThanOrEqual(Date.now() + 60_000);
    const past = mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: 60_000, now: new Date(before - 60_000) });
    expect(Date.parse(past.expiresAt)).toBe(before);
    expect(() => mintReadToken(t.home, root, { principalId: `p:${root.ns}/kernel` })).toThrow(TypeError);
    expect(() => mintReadToken(t.home, root, { principalId: 'p:abcdefgh/console' })).toThrow(TypeError); // another ns
    expect(() => mintReadToken(t.home, root, { principalId: `p:${root.ns}/console@0123abcd` })).toThrow(TypeError); // foreign
    // the token key proves possession and signs nothing else
    expect(() => parseReadToken(m.token).signer.sign('auth', 'x')).toThrow(/may not sign/);
    expect(() => parseReadToken(m.token).signer.sign('event', 'x')).toThrow(/may not sign/);
  });

  it('G-ABI-02 read-token column + G-ABI-03: status, log.read, ref.resolve served; every other verb and both relays FORBIDDEN; status < 50 ms; auth.ok names the tokenId, never the token or its digest', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60 * 60_000 });
    const s = await asToken(r, m.token);
    expect(s).toMatchObject({ principal: m.principalId, expiresAt: m.expiresAt, serverVerified: true });
    const st = ok(await s.conn.call('status', {}));
    expect(st).toMatchObject({ principal: m.principalId, credential: 'read-token', token: { tokenId: m.tokenId, expiresAt: m.expiresAt } });
    expect(st.principalKind).toBeUndefined();
    expect((st.nextLegalVerbs as Array<{ verb: string }>).map((v) => v.verb)).toEqual(['status']); // only verbs this class may call
    expect((st.verbs as Array<{ verb: string; access: unknown }>).filter((v) => v.access !== false).map((v) => v.verb)).toEqual(['status', 'log.read', 'ref.resolve']);
    expect((st.relays as Array<{ access: unknown }>).every((x) => x.access === false)).toBe(true);
    const lr = ok(await s.conn.call('log.read', {}));
    expect(lr.projection).toBe('read-token');
    const evId = ((lr.rows as Array<{ event: EventV1 }>)[0]!).event.id;
    expect(ok(await s.conn.call('ref.resolve', { ref: evId }))).toMatchObject({ ref: evId, target: { view: 'full' } });
    for (const meth of CLIENT_METHODS.filter((x) => !['status', 'log.read', 'ref.resolve'].includes(x))) {
      expect(errOf(await s.conn.call(meth, {}))).toMatchObject({ code: -32002, c: 'FORBIDDEN', reason: 'matrix' });
    }
    const times: number[] = [];
    for (let i = 0; i < 105; i++) {
      const t0 = process.hrtime.bigint();
      ok(await s.conn.call('status', {}));
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const measured = times.slice(5).sort((a, b) => a - b);
    expect(measured[Math.floor(0.99 * measured.length)]!).toBeLessThan(50); // G-ABI-03 for the read-token class
    await settle();
    const authOk = rows(r.home).filter((x) => x.kind === 'socket.auth.ok');
    expect(authOk.at(-1)!.env).toMatchObject({ connId: s.connId, payload: { principal: m.principalId, principalKind: null, credential: 'read-token', tokenId: m.tokenId, expiresAt: m.expiresAt } });
    const all = rows(r.home).map((x) => x.raw).join('\n');
    expect(all).not.toContain(m.token.split('.')[1]!); // the seed is never on the chain
  });

  it('proof of possession: a bearer {token}, a bad or replayed proof, unknown, expired, not yet valid, revoked, in use, no hello, expired nonce ⇒ AUTH + close; fail rows carry the tokenId, never the seed', async () => {
    const r = await rig({ preAuthRowsPerWindow: 100 }); // every fail row individually (no folding into the window counter)
    const pid = `p:${r.root.ns}/console`;
    const live = mintReadToken(r.home, r.root, { principalId: pid, ttlMs: 60_000 });
    const short = mintReadToken(r.home, r.root, { principalId: pid, ttlMs: 1_000, now: new Date(r.now.t) });
    // not-yet-valid: mint clamps createdAt to the real clock, so craft a root-signed row dated 4 min ahead
    const scratch = tempHome('gq-');
    cleanups.push(scratch.cleanup);
    const early = mintReadToken(scratch.home, r.root, { principalId: pid, ttlMs: 60_000 });
    const earlyRow = { ...JSON.parse(readFileSync(readTokensPath(scratch.home), 'utf8').trim()).row, createdAt: new Date(r.now.t + 4 * 60_000).toISOString(), expiresAt: new Date(r.now.t + 5 * 60_000).toISOString() };
    appendFileSync(readTokensPath(r.home), `${JSON.stringify({ row: earlyRow, ...r.root.signRow(earlyRow) })}\n`);
    const dead = mintReadToken(r.home, r.root, { principalId: pid, ttlMs: 60_000 });
    revokeReadToken(r.home, r.root, dead.tokenId);
    const expectRefused = async (params: (h: HelloResult) => unknown, reason: string): Promise<void> => {
      const { c, hello } = await helloOn(r);
      expect(errOf(await c.call('auth', params(hello))), reason).toMatchObject({ code: -32001, c: 'AUTH', reason });
      await untilClosed(c);
      expect(errOf(await c.call('status'))).toMatchObject({ reason: 'connection-closed' });
    };
    const sock = r.d.pidfile.socketPath;
    await expectRefused(() => ({ token: live.token }), 'auth-params'); // the bearer form is never accepted
    await expectRefused((h) => ({ ...tokenProof(live.token, h, sock), principal: pid }), 'auth-params');
    // without a valid proof the answer is uniform and names no token (Aegis follow-up 2)
    await expectRefused((h) => ({ tokenId: tokenProof(live.token, h, sock).tokenId, sig: Buffer.alloc(64).toString('base64') }), 'unknown-token');
    await expectRefused((h) => tokenProof(live.token, h, `${sock}.relay`), 'unknown-token'); // signed for another endpoint
    await expectRefused((h) => ({ tokenId: dead.tokenId, sig: tokenProof(live.token, h, sock).sig }), 'unknown-token'); // a revoked id with someone else's proof: no state leak
    await expectRefused((h) => ({ tokenId: 'rtk:' + '0'.repeat(26), sig: tokenProof(live.token, h, sock).sig }), 'unknown-token');
    await expectRefused((h) => tokenProof(dead.token, h, sock), 'token-revoked');
    await expectRefused((h) => tokenProof(early.token, h, sock), 'token-not-yet-valid');
    // a proof captured from one connection is useless on another (new nonce)
    const a = await helloOn(r);
    const captured = tokenProof(live.token, a.hello, sock);
    await expectRefused(() => captured, 'unknown-token');
    expect(await a.c.call('auth', captured)).toMatchObject({ result: { principal: pid, credential: 'read-token' } });
    // one live connection per token
    await expectRefused((h) => tokenProof(live.token, h, sock), 'token-in-use');
    await a.c.close();
    await settle();
    await asToken(r, live.token); // free again once the first connection is gone
    r.now.t += 1_000;
    await expectRefused((h) => tokenProof(short.token, h, sock), 'token-expired');
    const bare = await RpcConnection.open(sock);
    cleanups.push(() => bare.close());
    expect(errOf(await bare.call('auth', { tokenId: live.tokenId, sig: 'AA==' }))).toMatchObject({ c: 'AUTH', reason: 'no-hello' });
    const late = await helloOn(r);
    r.now.t += 30_001;
    expect(errOf(await late.c.call('auth', tokenProof(live.token, late.hello, sock)))).toMatchObject({ c: 'AUTH', reason: 'nonce-expired' });
    await settle();
    const fails = rows(r.home).filter((x) => x.kind === 'socket.auth.fail').map((x) => x.env.payload);
    expect(fails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'token-revoked', tokenId: dead.tokenId }),
        expect.objectContaining({ reason: 'token-in-use', tokenId: live.tokenId }),
        expect.objectContaining({ reason: 'token-expired', tokenId: short.tokenId }),
        expect.objectContaining({ reason: 'token-not-yet-valid', tokenId: early.tokenId }),
        expect.objectContaining({ reason: 'unknown-token' }),
      ]),
    );
    // a failed proof is never attributed: unknown-token rows carry no tokenId, and no row says bad-signature for a token
    expect(fails.filter((f) => f?.reason === 'unknown-token').every((f) => !Object.hasOwn(f!, 'tokenId'))).toBe(true);
    expect(fails.filter((f) => f?.tokenId === dead.tokenId).map((f) => f?.reason)).toEqual(['token-revoked']);
    const all = rows(r.home).map((x) => x.raw).join('\n');
    for (const tok of [live, short, dead, early]) expect(all).not.toContain(tok.token.split('.')[1]!);
  });

  it('revocations are sticky (Aegis cond 2): the kernel records key.token.revoked; deleting the revoke line makes the token file untrusted (nothing resolves, key.registry.malformed); after a restart the chain still revokes it', async () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    registerKernelKey(t.home, root, kernel.publicKeyPem);
    const pin = { keyId: kernel.keyId, publicKeyPem: kernel.publicKeyPem };
    const pid = `p:${root.ns}/console`;
    const keep = mintReadToken(t.home, root, { principalId: pid, ttlMs: 60 * 60_000 });
    const gone = mintReadToken(t.home, root, { principalId: pid, ttlMs: 60 * 60_000 });
    const before = readFileSync(readTokensPath(t.home));
    const start = async () => {
      const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
      return d;
    };
    const tryToken = (d: DaemonHandle, token: string) => connectGnomon({ socketPath: d.pidfile.socketPath, client: CLIENT, serverKey: pin, readToken: token }).then(
      async (s) => {
        await s.conn.close();
        return 'ok';
      },
      (e: { refusal?: { data?: { reason?: string } } }) => e.refusal?.data?.reason ?? String(e),
    );
    let d = await start();
    expect(await tryToken(d, gone.token)).toBe('ok');
    revokeReadToken(t.home, root, gone.tokenId);
    expect(await tryToken(d, gone.token)).toBe('token-revoked');
    // roll the file back: drop the revoke line
    writeFileSync(readTokensPath(t.home), before);
    expect(await tryToken(d, gone.token)).toBe('token-store-untrusted');
    expect(await tryToken(d, keep.token)).toBe('token-store-untrusted'); // nothing resolves from a rewritten file
    await settle();
    const db = () => {
      const x = new DatabaseSync(path.join(t.home, 'kernel.db'), { readOnly: true });
      try {
        return (x.prepare('SELECT kind, envelope FROM chain ORDER BY seq').all() as Array<{ kind: string; envelope: string }>).map((y) => ({ kind: y.kind, payload: JSON.parse(y.envelope).payload }));
      } finally {
        x.close();
      }
    };
    expect(db().filter((x) => x.kind === 'key.token.revoked').map((x) => x.payload)).toEqual([{ tokenId: gone.tokenId }]);
    expect(db().filter((x) => x.kind === 'key.registry.malformed').map((x) => x.payload)).toEqual([{ file: 'read-tokens.jsonl', reason: 'rewritten' }]);
    await d.shutdown('signal');
    // a new daemon sees the rolled-back file as its baseline, but the chain remembers the revocation
    d = await start();
    cleanups.push(() => d.shutdown('signal'));
    expect(await tryToken(d, gone.token)).toBe('token-revoked');
    expect(await tryToken(d, keep.token)).toBe('ok');
  }, 30_000);

  it('Aegis follow-up 1: a revocation is recorded at daemon start and on the slow token timer, with no token connection live', async () => {
    const t = tempHome('gv-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const pid = `p:${root.ns}/console`;
    const a = mintReadToken(t.home, root, { principalId: pid, ttlMs: 60_000 });
    const b = mintReadToken(t.home, root, { principalId: pid, ttlMs: 60_000 });
    revokeReadToken(t.home, root, a.tokenId); // pending before the daemon exists
    const d = await startDaemon({ home: t.home, idleMs: 60_000, rootAuthority: root, tokenRefreshMs: 40 });
    cleanups.push(() => d.shutdown('signal'));
    await settle();
    const revoked = () => rows(t.home).filter((x) => x.kind === 'key.token.revoked').map((x) => x.env.payload?.tokenId);
    expect(revoked()).toEqual([a.tokenId]);
    revokeReadToken(t.home, root, b.tokenId);
    for (let i = 0; i < 50 && revoked().length < 2; i++) await sleep(20);
    expect(revoked()).toEqual([a.tokenId, b.tokenId]);
  });

  it('caps (Aegis low): a token file over 1 MiB resolves nothing', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    appendFileSync(readTokensPath(r.home), `${'x'.repeat(1024 * 1024)}\n`);
    await expect(asToken(r, m.token)).rejects.toMatchObject({ refusal: { data: { reason: 'token-store-untrusted' } } });
    await settle();
    expect(rows(r.home).filter((x) => x.kind === 'key.registry.malformed').map((x) => x.env.payload)).toEqual([{ file: 'read-tokens.jsonl', reason: 'oversize' }]);
  });

  it('a production (unprovisioned) root: no token resolves (root-unprovisioned, M1.3)', async () => {
    const t = tempHome('gu-');
    cleanups.push(t.cleanup);
    const d = await startDaemon({ home: t.home, idleMs: 60_000 });
    cleanups.push(() => d.shutdown('signal'));
    const c = await RpcConnection.open(d.pidfile.socketPath);
    cleanups.push(() => c.close());
    await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: ['journal.cursor'], clientNonce: TEST_CLIENT_NONCE, client: CLIENT });
    expect(errOf(await c.call('auth', { tokenId: 'rtk:' + '0'.repeat(26), sig: 'AA==' }))).toMatchObject({ c: 'AUTH', reason: 'root-unprovisioned', milestone: 'M1.3' });
  });

  it('a live token connection dies with its token: revocation (periodic re-check) closes it and ends its subscription; expiry refuses the next call and closes; socket.disconnect is logged', async () => {
    const r = await rig({ tokenRecheckMs: 40 });
    const pid = `p:${r.root.ns}/console`;
    const a = mintReadToken(r.home, r.root, { principalId: pid, ttlMs: 60 * 60_000 });
    const s = await asToken(r, a.token);
    ok(await s.conn.call('log.read', { follow: true, since: { logId: r.d.log.logId, seq: r.d.log.head().seq } }));
    revokeReadToken(r.home, r.root, a.tokenId);
    for (let i = 0; i < 100 && !s.conn.closed; i++) await sleep(20);
    expect(s.conn.closed).toBe(true);
    expect(r.d.subscriptions().active).toBe(0);
    const b = mintReadToken(r.home, r.root, { principalId: pid, ttlMs: 10 * 60_000, now: new Date(r.now.t) });
    const s2 = await asToken(r, b.token);
    r.now.t += 10 * 60_000;
    expect(errOf(await s2.conn.call('status', {}))).toMatchObject({ c: 'AUTH', reason: 'token-expired' });
    await untilClosed(s2.conn);
    expect(errOf(await s2.conn.call('status', {}))).toMatchObject({ reason: 'connection-closed' });
    await settle();
    const disc = rows(r.home).filter((x) => x.kind === 'socket.disconnect').map((x) => x.env.payload);
    expect(disc).toEqual([
      { reason: 'token-revoked', tokenId: a.tokenId },
      { reason: 'token-expired', tokenId: b.tokenId },
    ]);
  });

  it('G-SOCK-02 (token form): a read token is never sent to an unverified server; a relay on another endpoint path is detected by serverSig', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const relayPath = path.join(path.dirname(r.d.pidfile.socketPath), 'relay.sock');
    const relay = net.createServer((client) => {
      const up = net.connect(r.d.pidfile.socketPath);
      client.pipe(up).pipe(client);
      client.on('error', () => up.destroy());
      up.on('error', () => client.destroy());
    });
    await new Promise<void>((res) => relay.listen(relayPath, res));
    cleanups.push(() => new Promise<void>((res) => relay.close(() => res())));
    await expect(connectGnomon({ socketPath: relayPath, client: CLIENT, serverKey: r.pin, readToken: m.token })).rejects.toMatchObject({ reason: 'bad-server-sig' });
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, readToken: m.token })).rejects.toThrow(ServerAuthError);
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, readToken: m.token, device: r.creds.get('human')! })).rejects.toThrow(TypeError);
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, readToken: 'not-a-token' })).rejects.toThrow(TypeError);
    await settle();
    expect(rows(r.home).filter((x) => x.kind.startsWith('socket.auth'))).toEqual([]); // the token never reached the kernel
  });

  it('G-ABI-05 read-token row over the socket: full minus secret — sensitive-column kinds stubbed, sensitive fields redacted, sensitive rows visible, secret rows never (page and stream)', async () => {
    const r = await rig();
    const K = r.d.kernelPrincipal;
    const L = r.d.log;
    const since = { logId: L.logId, seq: L.head().seq }; // journal.cursor
    const inj = (await L.append({ kind: 'session.inject', principal: K, session: HSID, payload: { origin: 'client', hash: SHA, bytes: 3 } })).seq;
    const req = (await L.append({ kind: 'approval.request', principal: K, session: HSID, payload: { cardId: 'c1', tool_input: 'MARK-tool-input' } })).seq;
    const sens = (await L.append({ kind: 'config.prefs', principal: K, sensitivity: 'sensitive', payload: { note: 'VISIBLE-sensitive-row' } })).seq;
    const sec = (await L.append({ kind: 'config.prefs', principal: K, sensitivity: 'secret', payload: { note: 'MARK-secret-row' } })).seq;
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const s = await asToken(r, m.token);
    const events: unknown[] = [];
    s.conn.onNotification((_m, p) => events.push(p));
    ok(await s.conn.call('log.read', { follow: true, since }));
    const page = ok(await s.conn.call('log.read', { since, limit: 1000 }));
    const by = new Map((page.rows as LogView[]).map((v) => [v.seq, v]));
    expect(by.get(inj)).toEqual({ seq: inj, view: 'stub', stub: { kind: 'session.inject', hsid: HSID, at: expect.any(String) } });
    expect(((by.get(req) as { event: EventV1 }).event.payload as Res).tool_input).toEqual({ redacted: true });
    expect(by.get(sens)).toMatchObject({ view: 'full', event: { payload: { note: 'VISIBLE-sensitive-row' } } });
    expect(by.has(sec)).toBe(false);
    for (const v of by.values()) if (v.view === 'full') expect(Object.keys(v.event)).not.toEqual(expect.arrayContaining(['hash']));
    for (let i = 0; i < 50 && events.length < by.size; i++) await sleep(20);
    const streamed = JSON.stringify(events);
    expect(streamed).toContain('VISIBLE-sensitive-row');
    expect(`${JSON.stringify(page)}${streamed}`).not.toMatch(/MARK-/);
  });
});

/* ── G-ABI-01 ─────────────────────────────────────────────────────────────── */

describe('G-ABI-01 ≤ 12: twelve kernel verbs + two relays is the whole client-callable surface', () => {
  it('the frozen list is 12 verbs (n = 1..12) + 2 relays, status lists exactly those, and no other name is a verb (incl. no token/daemon verbs)', async () => {
    expect(VERBS.map((v) => v.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(CLIENT_RELAYS.map((x) => x.relay)).toEqual(['mod.view', 'mod.command']);
    expect(CLIENT_METHODS).toHaveLength(17); // + the three P8-D98 human-device verbs, not kernel verbs (law 3)
    expect(HUMAN_DEVICE_VERBS.map((v) => v.verb)).toEqual(['gui.open', 'rules.revoke', 'daemon.stop']);
    const r = await rig();
    const s = await asDevice(r, 'human');
    const st = ok(await s.conn.call('status', {}));
    expect((st.verbs as Array<{ verb: string }>).map((v) => v.verb)).toEqual(VERBS.map((v) => v.verb));
    expect((st.relays as Array<{ relay: string }>).map((v) => v.relay)).toEqual(['mod.view', 'mod.command']);
    for (const extra of ['daemon.status', 'daemon.shutdown', 'token.mint', 'readToken.mint', 'auth.token', 'log.tail', 'log.write', 'session.list', 'grant', 'kernel.call', 'mod.install', 'approve.batch', 'status.full', 'rpc.discover']) {
      expect(errOf(await s.conn.call(extra, {}))).toMatchObject({ code: -32601, c: 'UNKNOWN_VERB' });
    }
  });
  it.todo('G-ABI-01: the MCP proxy registers ≤ 12 tools (descriptors.ts:269-271 naming law) — the Claude Code plugin proxy is not in any M1.x row; lands with the clients (M1.12)');
});

/* ── G-ABI-02 ─────────────────────────────────────────────────────────────── */

/** §5's table, transcribed cell by cell from docs/specs/gnomon.md (columns Human … Peer). */
const SPEC_MATRIX: Record<string, [string, string, string, string, string, string, string]> = {
  status: ['✓', '✓', '✓', '✓ (own view)', '✓', '✓', '✗'],
  'session.open': ['✓', '✓ permit', '✓ permit', '✗', '✗', '✗', '✗'],
  'session.send': ['✓', 'own subtree', 'own subtree', 'via `kernel.call` with caller hsid, same scope', '✓ attached session, `source: voice` forced', '✗', '✗'],
  'session.stop': ['✓', 'own subtree', 'own subtree', '✗', 'interrupt only', '✗', '✗'],
  'log.append': ['granted kinds + `request.*` (first-party human-class connections)', 'granted kinds', '**none**', '`modns.<name>.*` only', '`voice.*` + `request.voice.arm`', '✗', '✗'],
  'log.read': ['full', 'redacted', 'own scope', 'granted kinds, own `modns`', 'own session + `voice.*`', 'redacted', '✗'],
  'permit.reserve': ['✓', '✓', '✓ own scope', '✗ (spend comes from the caller\'s permit)', '✗', '✗', '✗'],
  approve: [
    '✓ (presence per class; root key for `use-api-token`, `install`; `withdraw` on `held` cards with no presence)',
    '✗',
    '✗',
    '✗',
    'intent form only, as the supervised child inside a live arm, for classes and repos the grant allows; no `cardId`, no `decisionSig`; hand-only kinds never (§14.7)',
    '✗',
    '✗',
  ],
  'contract.register': ['✓', '✓', '✗ (A17-5)', '✗', '✗', '✗', '✗'],
  'contract.claim': ['✓', '✓', '✓', '✗', '✗', '✗', '✗'],
  'oracle.run': ['✓', '✓ requests', '✓ requests', '✗', '✗', '✗', '✗'],
  'ref.resolve': ['✓', '✓', '✓', '✓', '✓', '✓', '✗'],
};
const MATRIX_COLUMNS = ['human', 'agent', 'session', 'mod', 'voice', 'readToken', 'peer'] as const;
/** Cells whose contracts text deliberately compresses the spec cell — every entry is a reviewed edit. */
const COMPRESSED_CELLS: Record<string, string> = {
  'approve×voice': 'intent form only, supervised child inside a live arm',
};

describe('G-ABI-02 matrix total: every principal class × every verb and both relays', () => {
  it('the contracts matrix equals the §5 table: ✗ ⇔ false, and every allowed cell\'s contracts text is the spec cell verbatim (after dropping ✓/markup) or its entry in the explicit COMPRESSED_CELLS allowlist', () => {
    const norm = (cell: string): string => cell.replace(/\*\*/g, '').replace(/`/g, '').replace(/^✓\s*/, '').replace(/^\((.*)\)$/, '$1').trim();
    expect(Object.keys(SPEC_MATRIX)).toEqual(VERBS.map((v) => v.verb));
    for (const v of VERBS) {
      MATRIX_COLUMNS.forEach((col, i) => {
        const cell = SPEC_MATRIX[v.verb]![i]!;
        const got = v.access[col];
        const at = `${v.verb} × ${col}: spec ${JSON.stringify(cell)}`;
        const refused = cell.startsWith('✗') || cell === '**none**';
        if (refused) return expect(got, at).toBe(false);
        expect(got, at).not.toBe(false);
        const want = norm(cell) === '' ? 'yes' : norm(cell);
        const key = `${v.verb}×${col}`;
        if (Object.hasOwn(COMPRESSED_CELLS, key)) return expect(got, at).toBe(COMPRESSED_CELLS[key]);
        expect(got, `${at} (a new compression must be added to COMPRESSED_CELLS deliberately)`).toBe(want);
      });
    }
  });

  it('§5 namespace ownership: the registry\'s userland namespaces are exactly the §5 list', () => {
    // 8.0:loops (gnomon-loops.md §5): loop.request is the agent's userland loop ask; loop.round and the other runner rows are kernel-owned
    const SPEC_USERLAND = 'paradigm.* inject.* credit.* broke.* detector.* loop.row loop.open loop.closed loop.request tend.* decay.* calibration.* flow.* neurons.* voice.* modns.<name>.*'.split(' ');
    const fromRegistry = new Set<string>();
    for (const k of EVENT_KIND_NAMES) if (EVENT_KINDS[k]!.owner === 'userland') fromRegistry.add(k.startsWith('loop.') ? k : `${k.split('.')[0]}.*`);
    for (const ns of OPEN_USERLAND_NAMESPACES) fromRegistry.add(ns === 'modns' ? 'modns.<name>.*' : `${ns}.*`);
    expect([...fromRegistry].sort()).toEqual([...SPEC_USERLAND].sort());
  });

  it('every ✗ cell is FORBIDDEN{matrix}; every allowed cell is served, a scoped/milestone refusal, or a param/ownership refusal — never FORBIDDEN{matrix}; approve is HUMAN_ONLY', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const sessions: Array<[string, GnomonSession]> = [];
    for (const [kind] of CLASSES) sessions.push([kind, await asDevice(r, kind)]);
    sessions.push(['readToken', await asToken(r, m.token)]);
    const table: Record<string, Record<string, string>> = {};
    for (const [cls, s] of sessions) {
      table[cls] = {};
      for (const meth of CLIENT_METHODS) {
        const verb = [...VERBS, ...HUMAN_DEVICE_VERBS].find((v) => v.verb === meth);
        const access = verb ? verb.access[cls as keyof (typeof verb)['access']] : cls === 'readToken' ? false : 'caller principal';
        const e = errOf(await s.conn.call(meth, meth === 'ref.resolve' ? { ref: 'sym:#socket' } : {}));
        const got = e ? `${e.c}:${e.reason}${e.milestone ? `@${e.milestone}` : ''}` : 'served';
        table[cls]![meth] = got;
        if (access === false) expect(got, `${cls} × ${meth}`).toBe('FORBIDDEN:matrix');
        else {
          expect(got, `${cls} × ${meth}`).not.toBe('FORBIDDEN:matrix');
          // a refusal of an allowed cell names its milestone, or is a params / ownership / resolver answer
          // gui.open reaches the web endpoint, whose transport sandbox does not exist on linux yet: an environment refusal, not a matrix one
          const env = meth === 'gui.open' ? '|^ENGINE:sandbox-unavailable$' : '';
          if (got !== 'served') expect(got, `${cls} × ${meth}`).toMatch(new RegExp(`@|^BAD_REQUEST:|^FORBIDDEN:(kernel-owned|ungranted|modns-not-own|mod-principal-name|voice-off)|^UNSUPPORTED:no-resolver${env}`));
        }
      }
    }
    for (const cls of ['agent', 'session', 'mod', 'readToken']) expect(table[cls]!.approve).toBe('FORBIDDEN:matrix');
    expect(table.human!.approve).toBe('BAD_REQUEST:bad-params'); // served since M1.6: {} names no card
    expect(table.voice!.approve).toBe('FORBIDDEN:voice-off'); // voice-intent row: every form FORBIDDEN in M1.6 (no arm can exist)
    expect(table.human!['permit.reserve']).toBe('BAD_REQUEST:bad-params');
    expect(table.agent!['permit.reserve']).toBe('BAD_REQUEST:bad-params');
    expect(table.session!['permit.reserve']).toBe('ENGINE:not-implemented@M1.7'); // own scope: session principals land in M1.7
    expect(VERBS.filter((v) => v.humanOnly).map((v) => v.verb)).toEqual(['approve']);
  }, 30_000);

  it('the peer column: refused everywhere — the contracts column is ✗ on every verb, a peer cannot be registered, a signed peer row never resolves, a foreign principal never authenticates', async () => {
    expect(VERBS.every((v) => v.access.peer === false)).toBe(true);
    const r = await rig();
    const key = SoftwareEd25519Signer.generate('device');
    expect(() => registerDevice(r.home, r.root, { host: 'peer-1', name: 'kernel-b', publicKeyPem: key.publicKeyPem, principalKind: 'peer' })).toThrow(TypeError);
    const row = { schemaVersion: 'registryRow:v1', kind: 'device', keyId: key.keyId, publicKeyPem: key.publicKeyPem, createdAt: new Date().toISOString(), deviceId: `dev:${r.root.ns}/peer-1`, principalId: `p:${r.root.ns}/kernel-b`, principalKind: 'peer' };
    appendFileSync(registryPath(r.home), `${JSON.stringify({ row, ...r.root.signRow(row) })}\n`);
    expect(readRegistry(r.home, new RootVerifier(r.root.publicKeyPem)).rejected.map((x) => x.reason)).toContain('principalKind');
    const cred = { principalId: row.principalId, deviceId: row.deviceId, signer: key };
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: cred })).rejects.toMatchObject({ refusal: { code: 'AUTH', data: { reason: 'unknown-device' } } });
    const foreign = { ...r.creds.get('human')!, principalId: `${r.creds.get('human')!.principalId}@0123abcd` };
    await expect(connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: foreign })).rejects.toMatchObject({ refusal: { code: 'AUTH', data: { reason: 'foreign-principal' } } });
  });

  it.todo('G-ABI-02 voice-intent row, armed cases (unarmed, wrong connection, unsupervised client, class/repo outside the grant, hand-only kind) — Move 4 (M4.5/M4.6); M1.6 refuses every form (test/approval-broker.test.ts)');
  it.todo('G-ABI-02 withdraw on held cards — Move 4 (M4.5: held cards exist only under a voice arm); presence classes + root key are in test/approval-broker.test.ts');
  it.todo('G-ABI-02 session/agent own-subtree and permit cells (session.*, permit.reserve) — M1.6/M1.7; contract.* and oracle.run — M2.1–M2.3');
  it.todo('G-ABI-02 mod cells (status own view, log.read granted kinds, session.send via kernel.call) and both relays with relayedFor — M1.11 (#mod-host)');
});

/* ── G-ABI-04 ─────────────────────────────────────────────────────────────── */

describe('G-ABI-04 frozen tripwire', () => {
  const pins = JSON.parse(readFileSync(path.join(PKG_ROOT, 'test', 'abi.ids.json'), 'utf8')) as { abiId: string };
  const contractsPins = JSON.parse(readFileSync(path.join(PKG_ROOT, '..', 'gnomon-contracts', 'schemas', 'client-api.ids.json'), 'utf8')) as { kitId: string; clientApiId: string };
  const abiOf = (verbs: unknown, relays: unknown, nextLegal: unknown): string => `sha256:${hex(sha256(canonicalJson({ verbs, relays, nextLegal })))}`;

  it('abiId equals its pin (test/abi.ids.json) and moves with any verb, relay or next-legal change; clientApiId and kitId equal the contracts pin; status reports all three', async () => {
    expect(ABI_ID).toBe(pins.abiId);
    expect(abiOf(VERBS, CLIENT_RELAYS, NEXT_LEGAL_TABLE)).toBe(ABI_ID);
    const verbs = JSON.parse(JSON.stringify(VERBS));
    verbs[5].access.readToken = 'full';
    expect(abiOf(verbs, CLIENT_RELAYS, NEXT_LEGAL_TABLE)).not.toBe(ABI_ID);
    expect(abiOf(VERBS, [...CLIENT_RELAYS, { relay: 'mod.extra', params: [], forwardsAs: 'x' }], NEXT_LEGAL_TABLE)).not.toBe(ABI_ID);
    expect(abiOf(VERBS, CLIENT_RELAYS, NEXT_LEGAL_TABLE.slice(1))).not.toBe(ABI_ID);
    expect({ kitId: KIT_ID, clientApiId: CLIENT_API_ID }).toEqual(contractsPins);
    const r = await rig();
    const st = ok(await (await asDevice(r, 'human')).conn.call('status', {}));
    expect(st).toMatchObject({ abiId: pins.abiId, clientApiId: contractsPins.clientApiId, kitId: contractsPins.kitId });
  });
  it.todo('G-ABI-04 modAbiId pinned and reported by status — M1.11 (mod-abi:v1)');
  it.todo('G-ABI-04 linkApiId pinned — M2.8 (#peer-link)');
});

/* ── G-ABI-05 ─────────────────────────────────────────────────────────────── */

/*
 * DEVIATION (M1.4 slice 2 round 2, Aegis): §9.3 v3.9 printed the limited-view stub as {kind, hsid, at, hash};
 * the kernel drops `hash` (a digest over the hidden payload confirms a dictionary guess), and every limited
 * view drops hash/sig/prev/idem/refHash. §9.3 is amended to match in this change (P8-D89).
 */
describe('G-ABI-05 redaction matrix: every (reader class, kind) pair', () => {
  const RANK = { normal: 0, sensitive: 1, secret: 2 } as const;
  const base = { schemaVersion: 'event:v1', log: 'log:x', at: '2026-10-17T00:00:00.000Z', principal: 'p:x/kernel', audience: 'private', prev: SHA, hash: SHA, sig: 'c2ln' } as const;
  type Expect = 'none' | 'full' | 'stub' | 'limited' | 'throws';

  /** §9.3, written from the table — not from redaction.ts. */
  function expected(cls: string, kind: string, eff: number, column: boolean, sameSession: boolean): Expect {
    switch (cls) {
      case 'human':
        return 'full';
      case 'read-token':
        return eff === 2 ? 'none' : column ? 'stub' : 'limited';
      case 'community-client':
        return eff === 2 ? 'none' : column ? 'stub' : eff === 1 ? 'none' : 'limited';
      case 'session':
        // §9.3: voice.turn.*.audioRef is never shown to a session, even its own (T-2026-10-18-010)
        return sameSession ? (kind.startsWith('voice.turn.') && Object.hasOwn(EVENT_KINDS[kind]!.fieldLabels ?? {}, 'audioRef') ? 'limited' : 'full') : 'none';
      case 'mod':
        return column || eff !== 0 ? 'none' : 'limited';
      case 'peer':
        return 'none';
      case 'voice':
        // voice slice V1 (Aegis L3): rows of the attached session only, redacted — this matrix reader has no attachment,
        // so it sees nothing (test/voice-v1.test.ts covers the attached projection)
        return 'none';
      default:
        return 'throws'; // agent (Move 2): refused rather than guessed
    }
  }

  it('T-2026-10-18-010 a session reader sees ONLY its own hsid rows, every label, and never voice.turn.*.audioRef', () => {
    const mk = (kind: string, session: string | undefined, sensitivity: string, payload: Res): EventV1 => ({ ...base, id: 'ev:1', seq: 1, kind, ...(session ? { session } : {}), sensitivity, payload }) as unknown as EventV1;
    const me = { class: 'session', hsid: HSID } as const;
    // another session's inject text, approval tool_input and a kernel row with no hsid: invisible
    expect(projectForReader(mk('session.inject', OTHER_HSID, 'sensitive', { text: 'SECRET' }), me)).toBeUndefined();
    expect(projectForReader(mk('approval.request', OTHER_HSID, 'normal', { tool_input: 'SECRET' }), me)).toBeUndefined();
    expect(projectForReader(mk('daemon.start', undefined, 'normal', {}), me)).toBeUndefined();
    expect(mayBeVisible(mk('session.inject', OTHER_HSID, 'sensitive', {}), me)).toBe(false);
    // its own rows: full, at every label
    for (const l of ['normal', 'sensitive', 'secret']) expect(projectForReader(mk('turn.event', HSID, l, { line: 'x' }), me)?.view).toBe('full');
    const own = projectForReader(mk('voice.turn.user', HSID, 'sensitive', { audioRef: 'blob:abc', text: 't' }), me) as { event: Res };
    expect((own.event.payload as Res).audioRef).toEqual({ redacted: true });
    for (const k of ['hash', 'sig', 'prev', 'idem', 'refHash']) expect(own.event).not.toHaveProperty(k);
    expect(JSON.stringify(own)).not.toContain('blob:abc');
  });

  it('the named §9.3 columns are registry columns: session.inject, turn.event, voice.turn.* kinds; tool_input, evidence, audioRef fields', () => {
    for (const k of ['session.inject', 'turn.event', 'voice.turn.user', 'voice.turn.agent']) expect(RANK[EVENT_KINDS[k]!.sensitivity], k).toBeGreaterThanOrEqual(1);
    expect(EVENT_KINDS['approval.request']!.fieldLabels).toHaveProperty('tool_input');
    expect(EVENT_KINDS['oracle.result']!.fieldLabels).toHaveProperty('evidence');
    expect(EVENT_KINDS['voice.turn.user']!.fieldLabels).toHaveProperty('audioRef');
  });

  it('projectForReader agrees with §9.3 for every registered kind × label × reader class × session match', () => {
    const readers = [
      { class: 'human' },
      { class: 'read-token' },
      { class: 'community-client' },
      { class: 'session', hsid: HSID },
      { class: 'peer' },
      { class: 'agent' },
      { class: 'voice' },
    ] as const;
    let pairs = 0;
    for (const kind of EVENT_KIND_NAMES) {
      const spec = EVENT_KINDS[kind]!;
      const reg = RANK[spec.sensitivity];
      const column = reg >= 1;
      const payload: Res = { note: 'MARK-note' };
      for (const f of Object.keys(spec.fieldLabels ?? {})) payload[f] = `MARK-${f}`;
      for (const label of ['normal', 'sensitive', 'secret'] as const) {
        const eff = Math.max(reg, RANK[label]);
        for (const session of [HSID, OTHER_HSID]) {
          const e = { ...base, id: 'ev:1', seq: 1, kind, session, sensitivity: label, payload } as unknown as EventV1;
          const all = [...readers, { class: 'mod', name: 'x', grantedKinds: [kind] } as const];
          for (const rd of all) {
            const want = expected(rd.class, kind, eff, column, session === HSID);
            pairs++;
            if (want === 'throws') {
              expect(() => projectForReader(e, rd), `${rd.class} ${kind}`).toThrow(/read projection/);
              continue;
            }
            const v = projectForReader(e, rd);
            const at = `${rd.class} × ${kind} × ${label} × ${session === HSID ? 'own' : 'other'}`;
            if (want === 'none') expect(v, at).toBeUndefined();
            else if (want === 'full') expect(v, at).toEqual({ seq: 1, view: 'full', event: e });
            else if (want === 'stub') expect(v, at).toEqual({ seq: 1, view: 'stub', stub: { kind, hsid: session, at: base.at } });
            else {
              expect(v?.view, at).toBe('full');
              const ev = (v as { event: Res }).event;
              for (const k of ['hash', 'sig', 'prev', 'idem', 'refHash']) expect(ev, at).not.toHaveProperty(k);
              for (const f of Object.keys(spec.fieldLabels ?? {})) expect((ev.payload as Res)[f], at).toEqual({ redacted: true });
              expect((ev.payload as Res).note, at).toBe('MARK-note');
            }
          }
        }
      }
    }
    expect(pairs).toBe(EVENT_KIND_NAMES.length * 3 * 2 * 8);
    // a mod's own modns kind (no registry entry): normal ⇒ limited view; a mod never sees another mod's kinds
    const own = { ...base, id: 'ev:2', seq: 2, kind: 'modns.x.saved', sensitivity: 'normal', payload: {} } as unknown as EventV1;
    expect(projectForReader(own, { class: 'mod', name: 'x' })).toMatchObject({ view: 'full' });
    expect(projectForReader(own, { class: 'mod', name: 'y' })).toBeUndefined();
  });

  it.todo('G-ABI-05 agent row (own subtree) — Move 2; voice row (attached session, kernel voice lines) — Move 4');
  it.todo('G-ABI-05 mod with turn.text:attached-session (assistant/user text parts only) — M1.11');
  it.todo('G-ABI-05 human full row on a first-party surface (GUI launch token / wrapper, #web-endpoint) and community device keys granted log.read:sensitive — #web-endpoint slice + M1.12');
  it.todo('G-ABI-05 session own-hsid row over the socket (principal → hsid binding) — M1.7');
});

/* ── G-SOCK-04 ────────────────────────────────────────────────────────────── */

describe('G-SOCK-04 log.append of a kernel-owned kind ⇒ FORBIDDEN for every class', () => {
  it('every registered kernel-owned kind and an unknown kind are FORBIDDEN{kernel-owned} for human, agent, mod and voice — the human request.* exception too (but request.mode.set, served for the human device, P8-D86/D87), until a connection can prove it is first-party; only voice request.voice.arm names Move 4; session and read token are FORBIDDEN by the matrix; nothing is appended', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const kernelKinds = [...EVENT_KIND_NAMES.filter((k) => kindOwner(k) === 'kernel'), 'made.up.kind', 'socket.auth.ok', 'daemon.start'];
    expect(kernelKinds.length).toBeGreaterThan(100);
    // Aegis #12 (TD-2026-10-20-086 F6): the standing-grant and unlock-joined rows are kernel-written only — every
    // log.append of them from human, agent, mod or voice is FORBIDDEN{kernel-owned} below
    for (const k of ['grant.standing', 'grant.standing.used', 'grant.standing.revoked', 'approval.unlock.joined']) expect(kernelKinds).toContain(k);
    const before = r.d.log.head().seq;
    const humanRequest = new Set(['request.grant', 'request.voice.narrow', 'request.brief.send', 'request.cowork.allow', 'request.link.revoke', 'request.strictness.set', 'request.mode.set', 'request.incident', 'request.voice.arm']);
    // 8.0:loops (gnomon-loops.md §5 Human ops): the human's loop asks take the same first-party request gate until a route serves them
    const loopRequests = ['request.loop.trust', 'request.loop.untrust', 'request.loop.pause', 'request.loop.resume', 'request.loop.run', 'request.loop.delete'];
    for (const k of loopRequests) {
      expect(kernelKinds, k).toContain(k);
      humanRequest.add(k);
    }
    for (const cls of ['human', 'agent', 'mod', 'voice'] as const) {
      const s = await asDevice(r, cls);
      for (const kind of kernelKinds) {
        const e = errOf(await s.conn.call('log.append', { kind, payload: { x: 1 } }));
        if (cls === 'human' && kind === 'request.session.model') {
          // 8.0:model-switch: served for the human's own device; a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && (kind === 'request.offer.decide' || kind === 'request.offer.mute' || kind === 'request.session.rename')) {
          // TD-2026-10-20-812 (Aegis D1) / 8.0:session-rename: served for the human's own device; a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && kind.startsWith('request.loop.')) {
          // 8.0:loops (#loop-registry, #loop-runner): served for the human's own device; a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && kind === 'request.mod.install') {
          // #mods-admin (the GUI Mods panel): served for the human's own device like `gnomon mod install`; a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && kind === 'request.strictness.set') {
          // M2.11-lite (#strictness-levels): served for the human's own device; a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && kind === 'request.mode.set') {
          // P8-D86/D87: served for the human's own device (a first-party connection); a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && kind === 'request.grant.standing') {
          // TD-2026-10-20-086 F6: a standing grant is minted only on the GUI; the human's CLI device is refused by the grant itself
          expect(e, kind).toMatchObject({ c: 'FORBIDDEN', reason: 'matrix' });
        } else if (cls === 'human' && kind === 'request.grant.standing.revoke') {
          // F6: Revoke is served for the human device too (a tighten); a bad payload is BAD_REQUEST and appends nothing
          expect(e, kind).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
        } else if (cls === 'human' && humanRequest.has(kind)) {
          expect(e, kind).toMatchObject({ c: 'FORBIDDEN', reason: 'kernel-owned' });
          expect((await s.conn.call('log.append', { kind })) as { error: { data: { data: Res } } }).toMatchObject({ error: { data: { data: { needs: 'first-party human-class connection' } } } });
        } else if (cls === 'voice' && kind === 'request.voice.arm') expect(e, kind).toMatchObject({ c: 'ENGINE', reason: 'not-implemented', milestone: 'voice V7' });
        else expect(e, `${cls} ${kind}`).toMatchObject({ code: -32002, c: 'FORBIDDEN', reason: 'kernel-owned' });
      }
      await s.conn.close();
    }
    for (const s of [await asDevice(r, 'session'), await asToken(r, m.token)]) {
      expect(errOf(await s.conn.call('log.append', { kind: 'daemon.start' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'matrix' });
    }
    await settle();
    const appended = rows(r.home).slice(before);
    expect(appended.every((x) => x.kind.startsWith('socket.'))).toBe(true); // only the kernel's own auth rows
    expect(appended.some((x) => canonicalJson(x.env.payload ?? null) === canonicalJson({ x: 1 }))).toBe(false); // no client payload reached the chain
  }, 60_000);

  it('8.0:model-switch request.session.model: the human device reaches the session port (an unknown hsid is NOT_FOUND); agent, mod and voice are FORBIDDEN{kernel-owned}; session and read token by the matrix; nothing is appended', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const before = r.d.log.head().seq;
    const payload = { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', model: 'sonnet' };
    for (const cls of ['agent', 'mod', 'voice'] as const) {
      const s = await asDevice(r, cls);
      expect(errOf(await s.conn.call('log.append', { kind: 'request.session.model', payload })), cls).toMatchObject({ c: 'FORBIDDEN', reason: 'kernel-owned' });
      await s.conn.close();
    }
    for (const s of [await asDevice(r, 'session'), await asToken(r, m.token)]) {
      expect(errOf(await s.conn.call('log.append', { kind: 'request.session.model', payload }))).toMatchObject({ c: 'FORBIDDEN', reason: 'matrix' });
    }
    const h = await asDevice(r, 'human');
    expect(errOf(await h.conn.call('log.append', { kind: 'request.session.model', payload }))).toMatchObject({ c: 'NOT_FOUND' });
    expect(errOf(await h.conn.call('log.append', { kind: 'request.session.model', payload, extra: 1 }))).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
    await h.conn.close();
    await settle();
    expect(rows(r.home).slice(before).every((x) => x.kind.startsWith('socket.'))).toBe(true);
  }, 60_000);

  it('8.0:session-rename request.session.rename: the human device names its own session (request row, then session.renamed, normalised), status.sessionNames shows it, \'\' resets, and the name survives a kernel restart; agent, mod and voice are FORBIDDEN{kernel-owned}; session and read token by the matrix', async () => {
    const r = await rig();
    const K = r.d.kernelPrincipal;
    const human = r.creds.get('human')!.principalId;
    const mine = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZ1';
    const theirs = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZ2';
    // the kernel's own session.open rows name each session's owner (by)
    await r.d.log.append({ kind: 'session.open', principal: K, session: mine, payload: { hsid: mine, by: human, cwd: '/tmp/x', backend: 'claude-code' } });
    await r.d.log.append({ kind: 'session.open', principal: K, session: theirs, payload: { hsid: theirs, by: 'p:zzzzzzzz/other', cwd: '/tmp/y', backend: 'claude-code' } });
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const before = r.d.log.head().seq;
    const payload = { hsid: mine, name: 'Fix the build' };
    for (const cls of ['agent', 'mod', 'voice'] as const) {
      const s = await asDevice(r, cls);
      expect(errOf(await s.conn.call('log.append', { kind: 'request.session.rename', payload })), cls).toMatchObject({ c: 'FORBIDDEN', reason: 'kernel-owned' });
      await s.conn.close();
    }
    for (const s of [await asDevice(r, 'session'), await asToken(r, m.token)]) {
      expect(errOf(await s.conn.call('log.append', { kind: 'request.session.rename', payload }))).toMatchObject({ c: 'FORBIDDEN', reason: 'matrix' });
    }
    const h = await asDevice(r, 'human');
    expect(errOf(await h.conn.call('log.append', { kind: 'request.session.rename', payload: { hsid: theirs, name: 'x' } }))).toMatchObject({ c: 'NOT_FOUND' });
    expect(errOf(await h.conn.call('log.append', { kind: 'request.session.rename', payload: { hsid: mine, name: 'a\u0007b' } }))).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
    expect(errOf(await h.conn.call('log.append', { kind: 'request.session.rename', payload, extra: 1 }))).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
    await settle();
    expect(rows(r.home).slice(before).every((x) => x.kind.startsWith('socket.'))).toBe(true); // nothing refused reached the chain
    expect(ok(await h.conn.call('log.append', { kind: 'request.session.rename', payload: { hsid: mine, name: '  Fix   the\u200b build ' } }))).toEqual({ hsid: mine, name: 'Fix the build', changed: true });
    await settle();
    const added = rows(r.home).slice(before).filter((x) => !x.kind.startsWith('socket.'));
    expect(added.map((x) => [x.kind, x.env.payload])).toEqual([
      ['request.session.rename', { hsid: mine, name: 'Fix the build' }],
      ['session.renamed', { hsid: mine, name: 'Fix the build' }],
    ]);
    expect((ok(await h.conn.call('status')) as { sessionNames?: unknown }).sessionNames).toEqual([{ hsid: mine, name: 'Fix the build' }]);
    const a = await asDevice(r, 'agent');
    expect(Object.hasOwn(ok(await a.conn.call('status')), 'sessionNames')).toBe(false); // the human class only
    // a kernel restart folds the same kernel-signed rows: the name stays
    await h.conn.close();
    await r.d.shutdown('signal');
    const d2 = await startDaemon({ home: r.home, idleMs: 60_000, kernelSigner: r.kernel, rootAuthority: r.root, clock: () => r.now.t });
    cleanups.push(() => d2.shutdown('signal'));
    const h2 = await connectGnomon({ socketPath: d2.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.creds.get('human')! });
    cleanups.push(() => h2.conn.close());
    expect((ok(await h2.conn.call('status')) as { sessionNames?: unknown }).sessionNames).toEqual([{ hsid: mine, name: 'Fix the build' }]);
    // '' resets to the derived title, and that survives too
    expect(ok(await h2.conn.call('log.append', { kind: 'request.session.rename', payload: { hsid: mine, name: '   ' } }))).toEqual({ hsid: mine, name: null, changed: true });
    expect((ok(await h2.conn.call('status')) as { sessionNames?: unknown }).sessionNames).toEqual([]);
  }, 60_000);

  it('P8-D86/D87 request.mode.set: the human device tightens a repo with no presence (request row, then approval.mode.set), status.runModes shows it and it survives a kernel restart; agent, mod, voice, session and read-token connections never set a mode', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const before = r.d.log.head().seq;
    const repoPath = path.join(r.home, 'some-repo');
    for (const cls of ['agent', 'mod', 'voice'] as const) {
      const s = await asDevice(r, cls);
      expect(errOf(await s.conn.call('log.append', { kind: 'request.mode.set', payload: { repo: repoPath, to: 'manual' } })), cls).toMatchObject({ c: 'FORBIDDEN', reason: 'kernel-owned' });
    }
    for (const s of [await asDevice(r, 'session'), await asToken(r, m.token)]) {
      expect(errOf(await s.conn.call('log.append', { kind: 'request.mode.set', payload: { repo: repoPath, to: 'manual' } }))).toMatchObject({ c: 'FORBIDDEN', reason: 'matrix' });
    }
    const h = await asDevice(r, 'human');
    expect(errOf(await h.conn.call('log.append', { kind: 'request.mode.set', payload: { repo: repoPath, to: 'yolo' } }))).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' });
    const res = ok(await h.conn.call('log.append', { kind: 'request.mode.set', payload: { repo: repoPath, to: 'manual' } }));
    expect(res).toMatchObject({ changed: true, applied: true, from: 'ask', to: 'manual', presence: 'none' });
    await settle();
    const added = rows(r.home).slice(before).filter((x) => !x.kind.startsWith('socket.'));
    expect(added.map((x) => x.kind)).toEqual(['request.mode.set', 'approval.mode.set']);
    expect(added[1]!.env.payload).toMatchObject({ from: 'ask', to: 'manual', presence: 'none', by: { via: 'cli' } });
    const st = ok(await h.conn.call('status')) as { runModes?: { strictness: { built: boolean }; repos: Array<{ mode: string }> } };
    expect(st.runModes).toMatchObject({ strictness: { built: true }, repos: [{ mode: 'manual' }] });
    // only the human class sees status.runModes
    const a = await asDevice(r, 'agent');
    expect(Object.hasOwn(ok(await a.conn.call('status')), 'runModes')).toBe(false);
    // a kernel restart folds the same kernel-signed rows: the repo keeps its mode
    await h.conn.close();
    await r.d.shutdown('signal');
    const d2 = await startDaemon({ home: r.home, idleMs: 60_000, kernelSigner: r.kernel, rootAuthority: r.root, clock: () => r.now.t });
    cleanups.push(() => d2.shutdown('signal'));
    const h2 = await connectGnomon({ socketPath: d2.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.creds.get('human')! });
    cleanups.push(() => h2.conn.close());
    expect((ok(await h2.conn.call('status')) as { runModes: unknown }).runModes).toMatchObject({ repos: [{ mode: 'manual' }] });
    expect(ok(await h2.conn.call('log.append', { kind: 'request.mode.set', payload: { repo: repoPath, to: 'manual' } }))).toMatchObject({ changed: false, mode: 'manual' });
  }, 60_000);

  it('M2.11-lite request.strictness.set: the human device raises a repo level with no presence (request row, then approval.strictness.raised), status.strictness and the run-mode ceiling show it, and it survives a kernel restart; agent, mod, voice, session and read-token connections never set a level (G-STR-01)', async () => {
    const r = await rig();
    const m = mintReadToken(r.home, r.root, { principalId: `p:${r.root.ns}/console`, ttlMs: 60_000 });
    const before = r.d.log.head().seq;
    const repoPath = path.join(r.home, 'some-repo');
    for (const cls of ['agent', 'mod', 'voice'] as const) {
      const s = await asDevice(r, cls);
      expect(errOf(await s.conn.call('log.append', { kind: 'request.strictness.set', payload: { repo: repoPath, to: 'L0' } })), cls).toMatchObject({ c: 'FORBIDDEN', reason: 'kernel-owned' });
    }
    for (const s of [await asDevice(r, 'session'), await asToken(r, m.token)]) {
      expect(errOf(await s.conn.call('log.append', { kind: 'request.strictness.set', payload: { repo: repoPath, to: 'L0' } }))).toMatchObject({ c: 'FORBIDDEN', reason: 'matrix' });
    }
    const h = await asDevice(r, 'human');
    const res = ok(await h.conn.call('log.append', { kind: 'request.strictness.set', payload: { repo: repoPath, to: 'L3' } }));
    expect(res).toMatchObject({ changed: true, applied: true, from: 'L0', to: 'L3', presence: 'none' });
    await settle();
    const added = rows(r.home).slice(before).filter((x) => !x.kind.startsWith('socket.'));
    expect(added.map((x) => x.kind)).toEqual(['request.strictness.set', 'approval.strictness.raised']);
    expect(added[1]!.env.payload).toMatchObject({ from: 'L0', to: 'L3', cause: 'manual', presence: 'none', by: { via: 'cli' } });
    const st = ok(await h.conn.call('status')) as { strictness?: unknown; runModes?: unknown };
    expect(st.strictness).toMatchObject({ built: true, default: 'L0', repos: [{ level: 'L3' }] });
    // the level is the run-mode ceiling: at L3 a looser mode is refused strictness-mode
    expect(errOf(await h.conn.call('log.append', { kind: 'request.mode.set', payload: { repo: repoPath, to: 'ask' } }))).toMatchObject({ c: 'FORBIDDEN', reason: 'strictness-mode' });
    const a = await asDevice(r, 'agent');
    expect(Object.hasOwn(ok(await a.conn.call('status')), 'strictness')).toBe(false);
    await h.conn.close();
    await r.d.shutdown('signal');
    const d2 = await startDaemon({ home: r.home, idleMs: 60_000, kernelSigner: r.kernel, rootAuthority: r.root, clock: () => r.now.t });
    cleanups.push(() => d2.shutdown('signal'));
    const h2 = await connectGnomon({ socketPath: d2.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.creds.get('human')! });
    cleanups.push(() => h2.conn.close());
    expect((ok(await h2.conn.call('status')) as { strictness: unknown }).strictness).toMatchObject({ repos: [{ level: 'L3' }] });
    // loosening raises a strictness card (fresh presence); nothing changes until it is allowed
    const loosen = ok(await h2.conn.call('log.append', { kind: 'request.strictness.set', payload: { repo: repoPath, to: 'L2' } }));
    expect(loosen).toMatchObject({ pending: true, from: 'L3', to: 'L2' });
    expect((ok(await h2.conn.call('status')) as { strictness: unknown }).strictness).toMatchObject({ repos: [{ level: 'L3', pendingTo: 'L2' }] });
  }, 60_000);

  it('userland kinds: ungranted for human/agent (grants are M1.3), a mod only its own modns (M1.11), voice only voice.* (Move 4); bad kinds are BAD_REQUEST', async () => {
    const r = await rig();
    const h = await asDevice(r, 'human');
    expect(errOf(await h.conn.call('log.append', { kind: 'paradigm.event' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'ungranted', milestone: 'M1.5' });
    expect(errOf(await h.conn.call('log.append', { kind: 'modns.workshop.saved' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'ungranted' });
    for (const bad of [{}, { kind: 'Bad Kind' }, { kind: 'x'.repeat(200) + '.y' }, []]) expect(errOf(await h.conn.call('log.append', bad))).toMatchObject({ code: -32600, c: 'BAD_REQUEST' });
    const a = await asDevice(r, 'agent');
    expect(errOf(await a.conn.call('log.append', { kind: 'loop.row' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'ungranted' });
    // 8.0:loops: the agent's loop.request is userland and ungranted until its pre-gate (build step 12); the runner's rows are kernel-owned
    expect(errOf(await a.conn.call('log.append', { kind: 'loop.request', payload: { op: 'run', loopId: 'x' } }))).toMatchObject({ c: 'FORBIDDEN', reason: 'ungranted' });
    for (const k of ['loop.round', 'loop.trusted', 'loop.run.started', 'loop.node']) expect(errOf(await a.conn.call('log.append', { kind: k })), k).toMatchObject({ c: 'FORBIDDEN', reason: 'kernel-owned' });
    const mod = await asDevice(r, 'mod');
    expect(errOf(await mod.conn.call('log.append', { kind: 'modns.workshop.saved' }))).toMatchObject({ c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.11' });
    expect(errOf(await mod.conn.call('log.append', { kind: 'modns.other.saved' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'modns-not-own' });
    expect(errOf(await mod.conn.call('log.append', { kind: 'paradigm.event' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'modns-not-own' });
    const v = await asDevice(r, 'voice');
    expect(errOf(await v.conn.call('log.append', { kind: 'voice.focus' }))).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-params' }); // voice slice V1: served, shape-validated
    expect(errOf(await v.conn.call('log.append', { kind: 'paradigm.event' }))).toMatchObject({ c: 'FORBIDDEN', reason: 'ungranted' });
  });

  it.todo('G-SOCK-04 the allowed cells append for real: grant.bind kinds (M1.3 signed grants over M1.5 manifests), request.* on a first-party human connection (#web-endpoint proof, answered by the M1.6 broker), a mod\'s own modns with manifest labels (M1.11), voice.* (Move 4)');
});

/* ── reviewer #4: a connection that closes during the awaited auth.ok write ── */

describe('auth race (reviewer #4)', () => {
  it('a read-token client that closes while socket.auth.ok is being written leaves no state and no timers (the device path shares the same post-write check)', async () => {
    const t = tempHome('gr-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    const m = mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: 60_000 });
    const sock = path.join(t.home, 'g.sock');
    let release!: () => void;
    let entered!: () => void;
    const inWrite = new Promise<void>((res) => (entered = res));
    const dispatcher = createKernelDispatcher({
      authenticator: new SocketAuthenticator({ home: t.home, endpointPath: sock, kernelSigner: kernel, trust: root }),
      status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: root.rootKeyId }) },
      log: async (kind) => {
        if (kind === 'socket.auth.ok') {
          entered();
          await new Promise<void>((res) => (release = res));
        }
      },
    });
    const srv = await listenSocket({ socketPath: sock, handle: dispatcher.handle, onConnect: dispatcher.onConnect, onDisconnect: dispatcher.onDisconnect });
    cleanups.push(() => srv.close());
    const c = await RpcConnection.open(sock);
    const h = (await c.call('hello', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: CLIENT })) as { result: HelloResult };
    const pending = c.call('auth', tokenProof(m.token, h.result, sock)).catch(() => undefined);
    await inWrite;
    await c.close();
    await sleep(30);
    release();
    await pending;
    await sleep(30);
    expect(dispatcher.clients()).toEqual([]);
    expect(dispatcher.timerCount()).toBe(0);
  });
});
