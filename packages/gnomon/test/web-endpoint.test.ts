/**
 * #web-endpoint end to end over the real `gnomon-web` child (spec §11.2,
 * §4.9, `G-WEB-01..08`). The child runs WITHOUT its sandbox profile here (the
 * internal test seam, src/kernel/testing.ts) so the suite runs on every OS;
 * test/web-sandbox.test.ts runs it under the darwin `transport` profile.
 * Needs the built child (dist/transport/gnomon-web.js): `npm run test:gnomon`
 * builds first.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UnprovisionedRootAuthority } from '../src/kernel/identity/index.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { createKernelDispatcher, SocketAuthenticator, verifyServerHello, type ModRelayPort } from '../src/kernel/socket/index.js';
import { createWebEndpointForTest, unsandboxedLauncher } from '../src/kernel/testing.js';
import { GUI_BUNDLE_HASH, guiBundleFiles, materializePlaceholderBundle, PLACEHOLDER_BUNDLE_HASH, type BlobSource, type WebEndpoint, type WebEndpointSeams } from '../src/kernel/web/index.js';
import { encodeClientFrame, OP } from '../src/transport/ws-codec.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome, TEST_CLIENT_NONCE } from './daemon-helpers.js';
import { GOOD, HELLO, rawHttp, rpc, wsConnect, type RawWs } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await sleep(20);
  expect(f()).toBe(true);
}

interface Row {
  kind: string;
  payload: Record<string, unknown>;
  ids: { connId?: string; deviceId?: string };
}
const HUMAN = { connId: 'conn:01JTESTASKER0000000000000', phase: 'authenticated' as const, credential: 'device' as const, principalKind: 'human' as const, principal: 'p:00000000/founder', deviceId: 'dev:00000000/mac-1' };

async function rig(o: { logDelay?: { kind: string; ms: number }; handoffAckMs?: number; lingerMs?: number; authDeadlineMs?: number; maxConnections?: number; blobs?: BlobSource; bundle?: { dir: string; hash: string }; now?: { t: number }; launcher?: WebEndpointSeams['launcher']; mods?: ModRelayPort } = {}) {
  const t = tempHome('gw-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const rows: Row[] = [];
  const log = async (kind: string, payload: Record<string, unknown>, ids: Row['ids'] = {}) => {
    if (o.logDelay?.kind === kind) await sleep(o.logDelay.ms); // a slow log write (the exit-log race, round 3)
    rows.push({ kind, payload, ids });
  };
  const trust = new UnprovisionedRootAuthority();
  let ep!: WebEndpoint;
  ep = createWebEndpointForTest(
    {
      home: t.home,
      kernelPublicKeyPem: kernel.publicKeyPem,
      scriptPath: CHILD,
      log,
      ...(o.lingerMs !== undefined ? { lingerMs: o.lingerMs } : {}),
      ...(o.handoffAckMs !== undefined ? { handoffAckMs: o.handoffAckMs } : {}),
      ...(o.authDeadlineMs !== undefined ? { authDeadlineMs: o.authDeadlineMs } : {}),
      ...(o.maxConnections !== undefined ? { maxConnections: o.maxConnections } : {}),
      ...(o.blobs ? { blobs: o.blobs } : {}),
      ...(o.now ? { now: () => o.now!.t } : {}),
      dispatcher: (endpointPath, web) =>
        createKernelDispatcher({
          authenticator: new SocketAuthenticator({ home: t.home, endpointPath, kernelSigner: kernel, trust }),
          web,
          ...(o.mods ? { mods: o.mods } : {}),
          log: (k, p, ids) => log(k, p, ids),
          status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'unprovisioned', rootKeyId: null }), web: () => ep.status() },
        }),
    },
    { ...(o.bundle ? { bundle: o.bundle } : {}), ...(o.launcher ? { launcher: o.launcher } : {}) },
  );
  cleanups.push(() => ep.stop('test'));
  return { ep, rows, home: t.home, kernel };
}

async function attach(ep: WebEndpoint, token: string, surface = 'browser'): Promise<{ ws: RawWs; hello: Record<string, unknown>; auth: Record<string, unknown> }> {
  const ws = await wsConnect(ep.port);
  cleanups.push(() => ws.end());
  ws.sendJson(rpc(1, 'hello', HELLO(surface)));
  const hello = await ws.nextJson();
  ws.sendJson(rpc(2, 'auth', { launchToken: token }));
  const auth = await ws.nextJson();
  return { ws, hello, auth };
}
const reason = (f: Record<string, unknown>) => ((f.error as { data?: { data?: { reason?: string } } } | undefined)?.data?.data?.reason);

describe('G-WEB-01 bind: 127.0.0.1 literal only, ephemeral port', () => {
  it('listens on 127.0.0.1; ::1 and the name localhost are not bound', async () => {
    const { ep, rows } = await rig();
    await ep.ensureListening();
    expect(ep.port).toBeGreaterThan(0);
    expect(rows.find((r) => r.kind === 'socket.web.listen')?.payload).toMatchObject({ port: ep.port, bundleHash: GUI_BUNDLE_HASH, sandbox: 'none' });
    const v6 = await new Promise<string>((res) => {
      const s = net.connect({ host: '::1', port: ep.port });
      s.on('connect', () => (s.destroy(), res('connected')));
      s.on('error', (e: NodeJS.ErrnoException) => res(e.code ?? 'error'));
    });
    expect(v6).not.toBe('connected');
  });
});

describe('G-WEB-02/03/04 at the wire: no non-Gnomon origin reaches a verb (M1.4 falsifier)', () => {
  it('foreign Origin / Host / Sec-Fetch-Site upgrades are refused before the dispatcher sees a frame', async () => {
    const { ep, rows } = await rig();
    await ep.ensureListening();
    const port = ep.port;
    const cases: Array<[Record<string, string>, number, string]> = [
      [{ ...GOOD(port), Origin: 'http://evil.example' }, 403, 'origin'],
      [{ ...GOOD(port), Origin: `http://localhost:${port}` }, 403, 'origin'],
      [{ Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' }, 403, 'origin'],
      [{ ...GOOD(port), 'Sec-Fetch-Site': 'cross-site' }, 403, 'sec-fetch-site'],
      [{ ...GOOD(port), Host: `attacker.example:${port}` }, 421, 'host'],
      [{ ...GOOD(port), Host: `localhost:${port}` }, 421, 'host'],
    ];
    for (const [h, status, why] of cases) {
      const ws = await wsConnect(port, h);
      expect(ws.status).toBe(status);
      ws.end();
      await until(() => rows.some((r) => r.kind === 'socket.auth.fail' && r.payload.reason === why));
    }
    expect(rows.some((r) => r.kind === 'socket.hello')).toBe(false); // nothing reached a verb, not even hello
  });

  it('a credentialed cross-origin POST with a REAL GUI token is refused 403 (no body), logged origin, and writes nothing', async () => {
    const { ep, rows, home } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const { auth } = await attach(ep, grant.launchToken);
    const guiToken = (auth.result as { guiToken: string }).guiToken;
    const port = ep.port;
    for (const target of ['/diag', `/blob/${'a'.repeat(64)}`]) {
      const r = await rawHttp(port, 'POST', target, { ...GOOD(port), Origin: 'http://evil.example', 'X-Gnomon-Token': guiToken }, Buffer.from('x'));
      expect(r.status).toBe(403);
      expect(r.body.length).toBe(0);
    }
    await until(() => rows.filter((r) => r.kind === 'socket.auth.fail' && r.payload.reason === 'origin').length === 2);
    expect(existsSync(path.join(home, 'logs', 'gui.log'))).toBe(false);
  });

  it('Aegis finding 2: a /diag or /blob POST with NO Sec-Fetch-Site is served only with a live GUI token (exact Origin still required)', async () => {
    const { ep, rows, home } = await rig();
    const grant = await ep.requestLaunch(HUMAN); // listening from here (the port is live)
    const { auth } = await attach(ep, grant.launchToken);
    const guiToken = (auth.result as { guiToken: string }).guiToken;
    const port = ep.port;
    const bare: Record<string, string> = { ...GOOD(port) };
    for (const k of Object.keys(bare)) if (k.toLowerCase() === 'sec-fetch-site') delete bare[k];
    // no token / a wrong token: 403, logged gui-token with the absent header named, nothing written
    for (const tok of [undefined, 'x'.repeat(43)]) {
      const r = await rawHttp(port, 'POST', '/diag', { ...bare, ...(tok ? { 'X-Gnomon-Token': tok } : {}) }, Buffer.from('x'));
      expect(r.status).toBe(403);
    }
    await until(() => rows.filter((r) => r.kind === 'socket.auth.fail' && r.payload.reason === 'gui-token' && r.payload.secFetchSite === 'absent').length === 2);
    expect(existsSync(path.join(home, 'logs', 'gui.log'))).toBe(false);
    expect((await rawHttp(port, 'POST', '/diag', { ...bare, 'X-Gnomon-Token': guiToken }, Buffer.from('ok'))).status).toBe(204);
    expect((await rawHttp(port, 'POST', `/blob/${'a'.repeat(64)}`, { ...bare, 'X-Gnomon-Token': guiToken }, Buffer.alloc(0))).status).toBe(404);
    expect((await rawHttp(port, 'POST', '/diag', { ...bare, Origin: 'http://evil.example', 'X-Gnomon-Token': guiToken }, Buffer.from('x'))).status).toBe(403);
  });
});

describe('G-WEB-06 HTTP surface: headers, CSP, no cookies, traversal, raster-only /blob, /diag', () => {
  it('static bundle bytes with rule-6 headers; no ACAO, no Set-Cookie; traversal 404; served bytes = hashed bytes', async () => {
    const { ep, home } = await rig();
    await ep.ensureListening();
    const port = ep.port;
    const r = await rawHttp(port, 'GET', '/', { Host: `127.0.0.1:${port}`, Cookie: 'a=b' });
    expect(r.status).toBe(200);
    expect(r.body.equals(guiBundleFiles().get('index.html')!)).toBe(true);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers).toMatchObject({ 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    expect(Object.keys(r.headers).filter((k) => k.startsWith('access-control') || k === 'set-cookie')).toEqual([]);
    for (const target of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/nope.js']) expect((await rawHttp(port, 'GET', target, { Host: `127.0.0.1:${port}` })).status).toBe(404);
    expect((await rawHttp(port, 'GET', '/', { Host: `localhost:${port}` })).status).toBe(421);
    // a same-user write into the served dir after start changes nothing served (bytes come from the hashed snapshot)
    appendFileSync(path.join(home, 'gui', 'bundle', 'app.js'), 'alert(1)');
    expect((await rawHttp(port, 'GET', '/app.js', { Host: `127.0.0.1:${port}` })).body.equals(guiBundleFiles().get('app.js')!)).toBe(true);
    const rpcGet = await rawHttp(port, 'GET', '/rpc', GOOD(port));
    expect(rpcGet.status).toBe(426);
    expect(rpcGet.headers['cache-control']).toBe('no-store');
  });

  it('/blob: GUI token required, content hash verified, PNG served, SVG and disguised HTML 415; /diag appends gui.log', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const store = new Map([png, svg, html].map((b) => [sha(b), b]));
    store.set('f'.repeat(64), png); // stored under the wrong hash
    const { ep, home } = await rig({ blobs: { read: (s) => store.get(s) ?? null } });
    const grant = await ep.requestLaunch(HUMAN);
    const { auth } = await attach(ep, grant.launchToken);
    const guiToken = (auth.result as { guiToken: string }).guiToken;
    const port = ep.port;
    const get = (s: string, tok: string | null = guiToken) => rawHttp(port, 'POST', `/blob/${s}`, { ...GOOD(port), ...(tok ? { 'X-Gnomon-Token': tok } : {}) });
    expect((await get(sha(png), null)).status).toBe(403);
    expect((await get(sha(png), 'A'.repeat(43))).status).toBe(403);
    const ok = await get(sha(png));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.body.equals(png)).toBe(true);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect((await get(sha(svg))).status).toBe(415);
    expect((await get(sha(html))).status).toBe(415);
    expect((await get('f'.repeat(64))).status).toBe(404);
    expect((await get('0'.repeat(64))).status).toBe(404);
    const d = await rawHttp(port, 'POST', '/diag', { ...GOOD(port), 'X-Gnomon-Token': guiToken }, Buffer.from('boom: <b>x</b>'));
    expect(d.status).toBe(204);
    expect(readFileSync(path.join(home, 'logs', 'gui.log'), 'utf8')).toContain('boom: <b>x</b>');
    // C5: tokens are redacted and terminal escapes neutralized before gui.log; 64-hex hashes survive
    const leak = `token ${guiToken} esc \x1b]52;c;ZXZpbA==\x07 hash ${'a'.repeat(64)}`;
    expect((await rawHttp(port, 'POST', '/diag', { ...GOOD(port), 'X-Gnomon-Token': guiToken }, Buffer.from(leak))).status).toBe(204);
    const logged = readFileSync(path.join(home, 'logs', 'gui.log'), 'utf8');
    expect(logged).not.toContain(String(guiToken));
    expect(logged).toContain('⟨redacted⟩');
    expect(logged).not.toContain('\\u001b');
    expect(logged).toContain('a'.repeat(64));
    expect((await rawHttp(port, 'POST', '/diag', { ...GOOD(port), 'X-Gnomon-Token': guiToken }, Buffer.alloc(64 * 1024 + 1))).status).toBe(413);
    expect((await rawHttp(port, 'GET', '/diag', { ...GOOD(port), 'X-Gnomon-Token': guiToken })).status).toBe(405);
    expect((await rawHttp(port, 'GET', `/blob/${sha(png)}`, { ...GOOD(port), 'X-Gnomon-Token': guiToken })).status).toBe(405); // POST only
  });
});

describe('G-WEB-07 the transport child: RFC 6455 refusals at the wire, restart cap', () => {
  it('no extension negotiated; binary 1003, fragment 1009, unmasked 1002, RSV1 1002, invalid UTF-8 1007, oversize 1009, close mirrored, ping answered', async () => {
    const { ep } = await rig();
    await ep.ensureListening();
    const port = ep.port;
    const deflate = await wsConnect(port, { ...GOOD(port), 'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits' });
    expect(deflate.status).toBe(101);
    expect(deflate.headers['sec-websocket-extensions']).toBeUndefined();
    deflate.end();
    const cases: Array<[Buffer, number]> = [
      [encodeClientFrame(OP.BINARY, Buffer.from('x')), 1003],
      [encodeClientFrame(OP.TEXT, Buffer.from('x'), { fin: false }), 1009],
      [encodeClientFrame(OP.CONT, Buffer.from('x')), 1009],
      [encodeClientFrame(OP.TEXT, Buffer.from('x'), { mask: false }), 1002],
      [encodeClientFrame(OP.TEXT, Buffer.from('x'), { rsv: 4 }), 1002],
      [encodeClientFrame(OP.TEXT, Buffer.from([0xc3, 0x28])), 1007],
      [encodeClientFrame(OP.TEXT, Buffer.alloc(0), { len: 4 * 1024 * 1024 + 1 }), 1009],
      [encodeClientFrame(OP.CLOSE, Buffer.from([0x0f, 0xa1])), 4001],
    ];
    for (const [frame, code] of cases) {
      const ws = await wsConnect(port);
      ws.sendRaw(frame);
      expect(await ws.closed()).toBe(code);
      ws.end();
    }
    const ws = await wsConnect(port);
    ws.sendRaw(encodeClientFrame(OP.PING, Buffer.from('abc')));
    await until(() => ws.frames.some((f) => f.op === OP.PONG && f.payload.toString() === 'abc'));
    ws.end();
  });

  it('a crashed child is restarted (GUI sessions end ⇒ Reconnect) and the cap is 3 per 10 min', async () => {
    const { ep, rows } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const { ws, auth } = await attach(ep, grant.launchToken);
    expect(auth.result).toBeDefined();
    for (let i = 1; i <= 4; i++) {
      const pid = ep.childPid()!;
      process.kill(pid, 'SIGKILL');
      await until(() => rows.filter((r) => r.kind === 'socket.web.transport.exited').length === i);
      if (i <= 3) await until(() => ep.listening && ep.childPid() !== pid);
    }
    expect(await ws.closed()).toBe(1006);
    expect(rows.find((r) => r.kind === 'socket.gui.session.ended')?.payload).toEqual({ reason: 'transport-exited' });
    await until(() => rows.some((r) => r.kind === 'socket.web.stop' && r.payload.reason === 'transport-restart-cap'));
    expect(ep.listening).toBe(false);
  });
});

describe('G-WEB-05 launch token → GUI token; theft inside the TTL; replay after; never on argv', () => {
  it('exchange: serverSig verifies over the ws:// path; status shows the GUI session; rows written', async () => {
    const { ep, rows, kernel } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    expect(grant.url).toBe(`http://127.0.0.1:${ep.port}/#launch=${grant.launchToken}&k=${grant.kernelPublicKey}`);
    expect(grant.bundleHash).toBe(GUI_BUNDLE_HASH);
    const { ws, hello, auth } = await attach(ep, grant.launchToken, 'wrapper');
    expect(() => verifyServerHello(hello.result as never, ep.endpointPath, { keyId: kernel.keyId, publicKeyPem: kernel.publicKeyPem }, TEST_CLIENT_NONCE)).not.toThrow();
    const res = auth.result as { guiToken: string; principal: string; connId: string };
    expect(res.principal).toBe(HUMAN.principal);
    expect(res.guiToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    ws.sendJson(rpc(3, 'status'));
    const st = (await ws.nextJson()).result as Record<string, unknown>;
    expect(st).toMatchObject({ credential: 'gui', principalKind: 'human', surface: 'wrapper', deviceId: HUMAN.deviceId });
    expect(st.web).toMatchObject({ listening: true, port: ep.port, guiSessions: { n: 1, sessions: [{ connId: res.connId, surface: 'wrapper', via: 'launch' }] } });
    const kinds = rows.map((r) => r.kind);
    expect(kinds.indexOf('socket.auth.ok')).toBeLessThan(kinds.indexOf('socket.gui.token.issued'));
    expect(rows.find((r) => r.kind === 'socket.auth.ok')?.payload).toMatchObject({ credential: 'gui', client: 'gui', surface: 'wrapper', via: 'launch' });
    // falsifier: a token on any argv (and env) of the child
    const argv = JSON.stringify([ep.childArgv(), ep.childEnv()]);
    expect(argv).not.toContain(grant.launchToken);
    expect(argv).not.toContain(res.guiToken);
    expect(JSON.stringify(rows)).not.toContain(grant.launchToken);
    expect(JSON.stringify(rows)).not.toContain(res.guiToken);
  });

  it('a second presentation INSIDE the TTL is theft: refused, the consuming session revoked, socket.auth.theft', async () => {
    const { ep, rows } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const a = await attach(ep, grant.launchToken);
    const aConn = (a.auth.result as { connId: string }).connId;
    const b = await attach(ep, grant.launchToken);
    expect(reason(b.auth)).toBe('replayed-transcript');
    expect(await b.ws.closed()).toBe(1008);
    expect(await a.ws.closed()).toBe(1008);
    await until(() => rows.some((r) => r.kind === 'socket.auth.theft'));
    expect(rows.find((r) => r.kind === 'socket.auth.theft')?.payload).toMatchObject({ revokedConnId: aConn });
    expect(rows.find((r) => r.kind === 'socket.gui.session.ended')).toMatchObject({ payload: { reason: 'theft' }, ids: { connId: aConn } });
    expect(ep.access.sessions()).toEqual([]);
  });
  it.todo('M1.6 (#approval-broker): theft raises a fresh-presence gate-class card naming the revoked connection');

  it('AFTER the TTL a consumed token is a replay: refused and logged only — no revoke', async () => {
    const now = { t: Date.now() };
    const { ep, rows } = await rig({ now });
    const grant = await ep.requestLaunch(HUMAN);
    const a = await attach(ep, grant.launchToken);
    const aConn = (a.auth.result as { connId: string }).connId;
    now.t += 61_000;
    const b = await attach(ep, grant.launchToken);
    expect(reason(b.auth)).toBe('replayed-transcript');
    await until(() => rows.some((r) => r.kind === 'socket.auth.replay'));
    expect(rows.find((r) => r.kind === 'socket.auth.replay')?.payload).toMatchObject({ consumedBy: aConn });
    expect(rows.some((r) => r.kind === 'socket.auth.theft' || r.kind === 'socket.gui.session.ended')).toBe(false);
    a.ws.sendJson(rpc(9, 'status'));
    expect((await a.ws.nextJson()).result).toBeDefined();
  });

  it('unknown, expired, malformed and non-human launches are refused; launch auth needs surface browser|wrapper', async () => {
    const now = { t: Date.now() };
    const { ep } = await rig({ now });
    await expect(ep.requestLaunch({ ...HUMAN, principalKind: 'agent' as never })).rejects.toBeInstanceOf(LifecycleRefusal);
    await expect(ep.requestLaunch({ ...HUMAN, credential: 'read-token' as never })).rejects.toBeInstanceOf(LifecycleRefusal);
    const g1 = await ep.requestLaunch(HUMAN);
    expect(reason((await attach(ep, 'B'.repeat(43))).auth)).toBe('unknown-token');
    expect(reason((await attach(ep, g1.launchToken, 'cli')).auth)).toBe('auth-params');
    const g2 = await ep.requestLaunch(HUMAN);
    now.t += 60_001;
    expect(reason((await attach(ep, g2.launchToken)).auth)).toBe('token-expired');
  });
});

describe('G-WEB-08 Reconnect through presence; bundle mismatch', () => {
  it('Reconnect is refused UNSUPPORTED{presence-unavailable, M1.3} after logging socket.auth.reconnect.requested', async () => {
    const { ep, rows } = await rig();
    await ep.ensureListening();
    const ws = await wsConnect(ep.port);
    cleanups.push(() => ws.end());
    ws.sendJson(rpc(1, 'hello', HELLO('browser')));
    await ws.nextJson();
    ws.sendJson(rpc(2, 'auth', { reconnect: true }));
    const r = await ws.nextJson();
    expect(r.error).toMatchObject({ code: -32005, data: { code: 'UNSUPPORTED', data: { reason: 'web-auth-not-implemented', milestone: 'M1.3', cause: 'presence-unavailable' } } });
    expect(await ws.closed()).toBe(1008);
    const kinds = rows.map((x) => x.kind);
    expect(kinds.indexOf('socket.auth.reconnect.requested')).toBeLessThan(kinds.lastIndexOf('socket.auth.fail'));
    expect(rows.find((x) => x.kind === 'socket.auth.reconnect.requested')?.payload).toMatchObject({ surface: 'browser', openGuiSessions: 0 });
  });
  it.todo('M1.3 (#identity presence via the signed helper): on presence, Reconnect answers {guiToken, principal, connId, kernelPublicKey} and logs socket.gui.token.issued; a denial logs approval.presence.denied and closes');

  it('a bundle that does not hash to its pin never opens the endpoint (socket.web.bundle.mismatch)', async () => {
    const t = tempHome('gb-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const dir = materializePlaceholderBundle(t.home);
    writeFileSync(path.join(dir, 'evil.js'), 'fetch("//x")');
    const { ep, rows } = await rig({ bundle: { dir, hash: PLACEHOLDER_BUNDLE_HASH } });
    await expect(ep.ensureListening()).rejects.toMatchObject({ reason: 'web-bundle-mismatch' });
    expect(ep.listening).toBe(false);
    expect(rows.find((r) => r.kind === 'socket.web.bundle.mismatch')?.payload).toMatchObject({ expected: PLACEHOLDER_BUNDLE_HASH });
    expect(rows.some((r) => r.kind === 'socket.web.listen')).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('rule 7 auth deadline, rule 8 connection cap, §2.4 linger', () => {
  it('no hello+auth within the deadline ⇒ 1008; a first frame that is not hello ⇒ 1008, undispatched', async () => {
    const { ep, rows } = await rig({ authDeadlineMs: 300 });
    await ep.ensureListening();
    const idle = await wsConnect(ep.port);
    expect(await idle.closed()).toBe(1008);
    const early = await wsConnect(ep.port);
    early.sendJson(rpc(1, 'status'));
    expect(await early.closed()).toBe(1008);
    const second = await wsConnect(ep.port);
    second.sendJson(rpc(1, 'hello', HELLO()));
    await second.nextJson();
    second.sendJson(rpc(2, 'log.read', {}));
    expect(await second.closed()).toBe(1008);
    expect(rows.filter((r) => r.kind === 'socket.hello').length).toBe(1);
    expect(rows.some((r) => r.kind === 'socket.auth.fail' && r.payload.reason === 'unauthenticated')).toBe(false);
  });

  it('back-to-back upgrades at the cap: closing connections are not counted and never re-picked (reviewer / C5)', async () => {
    const { ep } = await rig({ maxConnections: 2 });
    await ep.ensureListening();
    const u1 = await wsConnect(ep.port);
    const u2 = await wsConnect(ep.port);
    const [u3, u4] = await Promise.all([wsConnect(ep.port), wsConnect(ep.port)]);
    expect([u3.status, u4.status]).toEqual([101, 101]);
    expect(await u1.closed()).toBe(1013);
    expect(await u2.closed()).toBe(1013);
    await until(() => ep.status().connections === 2); // u1/u2 closed: exactly the two live ones remain
    for (const w of [u3, u4]) w.end();
  });

  it('pre-auth the child caps frames at 16 KiB (1009); after auth the kernel lifts it to 4 MiB', async () => {
    const { ep } = await rig();
    await ep.ensureListening();
    const big = await wsConnect(ep.port);
    big.sendText('x'.repeat(20 * 1024));
    expect(await big.closed()).toBe(1009);
    const g = await ep.requestLaunch(HUMAN);
    const a = await attach(ep, g.launchToken);
    a.ws.sendJson({ ...rpc(7, 'status'), pad: 'x'.repeat(64 * 1024) });
    expect((await a.ws.nextJson()).result).toBeDefined();
  });

  it('read tokens do not authenticate on the web endpoint (Aegis C3)', async () => {
    const { ep } = await rig();
    await ep.ensureListening();
    const ws = await wsConnect(ep.port);
    ws.sendJson(rpc(1, 'hello', HELLO()));
    await ws.nextJson();
    ws.sendJson(rpc(2, 'auth', { tokenId: 'rt:x', sig: 'AAAA' }));
    expect(reason(await ws.nextJson())).toBe('auth-params');
    expect(await ws.closed()).toBe(1008);
  });

  it('at the cap the oldest UNAUTHENTICATED connection is closed, never an authenticated GUI one', async () => {
    const { ep } = await rig({ maxConnections: 2 });
    const g = await ep.requestLaunch(HUMAN);
    const a = await attach(ep, g.launchToken);
    expect(a.auth.result).toBeDefined();
    const u1 = await wsConnect(ep.port);
    const u2 = await wsConnect(ep.port);
    expect(u2.status).toBe(101);
    expect(await u1.closed()).toBe(1013);
    const g2 = await ep.requestLaunch(HUMAN);
    u2.sendJson(rpc(1, 'hello', HELLO()));
    await u2.nextJson();
    u2.sendJson(rpc(2, 'auth', { launchToken: g2.launchToken }));
    expect((await u2.nextJson()).result).toBeDefined();
    const u3 = await wsConnect(ep.port);
    expect(u3.status).toBe(503);
    a.ws.sendJson(rpc(5, 'status'));
    expect((await a.ws.nextJson()).result).toBeDefined();
  });

  it('linger: after the last GUI session closes the endpoint stops (socket.web.stop no-sessions) and its child ends', async () => {
    const { ep, rows } = await rig({ lingerMs: 300 });
    const g = await ep.requestLaunch(HUMAN);
    const a = await attach(ep, g.launchToken);
    await sleep(500);
    expect(ep.listening).toBe(true); // a live session holds it
    const pid = ep.childPid()!;
    a.ws.end();
    await until(() => !ep.listening);
    // stop() flips `listening` at once but writes socket.web.stop only AFTER the
    // child has exited (shutdown record, then SIGKILL at 1 s): the row means
    // "down and the child is gone". Wait for the row (bounded), not the flag.
    await until(() => rows.some((r) => r.kind === 'socket.web.stop'));
    expect(rows.find((r) => r.kind === 'socket.web.stop')?.payload).toEqual({ reason: 'no-sessions' });
    expect(rows.some((r) => r.kind === 'socket.web.linger')).toBe(true);
    expect(ep.childPid()).toBeNull();
    expect(() => process.kill(pid, 0)).toThrow(); // the child really ended
  });
});

describe('a compromised child cannot crash or steer the kernel (Aegis C1)', () => {
  const FAKE = `const bad = JSON.parse(process.argv[2]); let sent = false;
process.stdin.on('data', () => { if (sent) return; sent = true;
  process.stdout.write(JSON.stringify({ t: 'ready', bundleHash: process.argv[3], files: 2 }) + '\\n');
  setTimeout(() => process.stdout.write(JSON.stringify(bad) + '\\n'), 50); });
setInterval(() => undefined, 1000);`;
  it.each([{ t: 'http', rid: 1 }, { t: 'frame', rid: 1, data: 42 }, { t: 'upgrade', rid: -1, method: 'GET', path: '/rpc', headers: {} }, { t: 'nope' }, { t: 'closed', rid: 1, code: 'x', why: 1 }])(
    'record %j ⇒ the child is killed (transport.exited), the kernel keeps running',
    async (bad) => {
      const t = tempHome('gf-');
      cleanups.push(t.cleanup);
      mkdirSync(t.home, { recursive: true, mode: 0o700 });
      const fake = path.join(t.home, 'fake-child.mjs');
      writeFileSync(fake, FAKE);
      const { ep, rows } = await rig({
        launcher: (input) => ({ ...unsandboxedLauncher({ ...input, scriptPath: fake }), args: [fake, JSON.stringify(bad), GUI_BUNDLE_HASH] }),
      });
      await ep.ensureListening();
      const pid = ep.childPid()!;
      await until(() => rows.some((r) => r.kind === 'socket.web.transport.exited'));
      expect(() => process.kill(pid, 0)).toThrow();
      await ep.stop('test');
    },
  );
  it('a ready record out of shape (it names a port: the child listens on nothing) never opens the endpoint', async () => {
    const t = tempHome('gf-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const fake = path.join(t.home, 'fake-ready.mjs');
    writeFileSync(fake, `process.stdin.once('data', () => process.stdout.write(JSON.stringify({ t: 'ready', port: 1, bundleHash: 'x', files: 1 }) + '\\n')); setInterval(() => undefined, 1000);`);
    const { ep } = await rig({ launcher: (input) => ({ ...unsandboxedLauncher({ ...input, scriptPath: fake }), args: [fake] }) });
    await expect(ep.ensureListening()).rejects.toMatchObject({ reason: 'web-transport-failed' });
    expect(ep.listening).toBe(false);
  });
});

describe('#mod-host relays on a GUI connection (M1.11 slice 2, I3)', () => {
  it('mod.command is refused (no gesture proof yet) and status reports it available:false; mod.view is served with relayedFor from the GUI connection', async () => {
    const seen: unknown[] = [];
    const mods: ModRelayPort = {
      view: async (rf, req) => (seen.push({ rf, req }), { label: 'mod:probe' }),
      command: async () => {
        throw new Error('must not be reached');
      },
      status: (full) => ({ full }),
    };
    const { ep } = await rig({ mods });
    const grant = await ep.requestLaunch(HUMAN);
    const { ws, auth } = await attach(ep, grant.launchToken);
    const connId = (auth.result as { connId: string }).connId;
    ws.sendJson(rpc(3, 'status', {}));
    const st = (await ws.nextJson()).result as { relays: Array<{ relay: string; available: boolean }>; mods: unknown };
    expect(st.relays).toEqual([expect.objectContaining({ relay: 'mod.view', available: true }), expect.objectContaining({ relay: 'mod.command', available: false })]);
    expect(st.mods).toEqual({ full: true }); // GUI = the human class
    ws.sendJson(rpc(4, 'mod.command', { name: 'probe', commandId: 'probe.who', args: {} }));
    expect(await ws.nextJson()).toMatchObject({ error: { data: { code: 'ENGINE', data: { reason: 'not-implemented', milestone: 'M1.10' } } } });
    ws.sendJson(rpc(5, 'mod.view', { name: 'probe', viewId: 'probe.view', input: {}, relayedFor: { principal: 'p:evil/x', connId: 'z' } }));
    expect(await ws.nextJson()).toMatchObject({ result: { label: 'mod:probe' } });
    expect(seen).toEqual([{ rf: { principal: HUMAN.principal, connId, principalClass: 'human' }, req: { name: 'probe', viewId: 'probe.view', input: {} } }]);
  });
});

describe('named gaps', () => {
  it.todo('M1.3 / M1.10: root-signed `gnomon gui pin` writes gui.bundleHash; the endpoint pins that instead of the placeholder literal');
  it.todo('gnomon open wire path: §5 names no verb for the launch request (adding one is the M1.4 falsifier) — needs a spec ruling; today DaemonHandle.requestWebLaunch is in-process only');
});

/*
 * T-2026-10-18-020 round 2 (Aegis C1/C2, reviewer): endpoint.ts's own hand-off claims. Fake children are plain
 * `node <script>` (unsandboxed seam) so these run on every OS.
 */
describe('the kernel listener and the socket hand-off (T-2026-10-18-020)', () => {
  const FAKE = `import fs from 'node:fs';
const [hash, mode, counter] = process.argv.slice(2);
const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(n + 1));
const ready = () => process.stdout.write(JSON.stringify({ t: 'ready', bundleHash: hash, files: 1 }) + '\\n');
process.on('message', (m, s) => { if (m === 'conn' && s) s.end('HTTP/1.0 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok'); });
let seen = 0;
process.stdin.on('data', (d) => { // late-ready: ready only once stop()'s shutdown (the 2nd record) arrives
  if (mode !== 'late-ready' || n === 0 || seen >= 2) return;
  seen += String(d).split('\\n').length - 1;
  if (seen >= 2) ready();
});
process.stdin.once('data', () => {
  if (mode === 'late-ready' && n > 0) return;
  if (mode === 'slow-restart' && n > 0) return void setTimeout(ready, 1500);
  if (mode === 'fail-restart' && n > 0) return void process.exit(3);
  ready();
  if (mode === 'user-msg') setTimeout(() => process.send('hi'), 50);
  if (mode === 'internal-msg') setTimeout(() => process.send({ cmd: 'NODE_EVIL' }), 50);
  if (mode === 'stall') setImmediate(() => { const e = Date.now() + 30000; while (Date.now() < e); });
});
process.stdin.on('end', () => { if (mode !== 'late-ready' || n === 0) process.exit(0); });
`;
  async function fakeRig(mode: string, extra: { handoffAckMs?: number } = {}) {
    const t = tempHome('gh-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const fake = path.join(t.home, 'fake-handoff.mjs');
    writeFileSync(fake, FAKE);
    const counter = path.join(t.home, 'spawns');
    return rig({ ...extra, launcher: (input) => ({ ...unsandboxedLauncher({ ...input, scriptPath: fake }), args: [fake, GUI_BUNDLE_HASH, mode, counter] }) });
  }
  /** One connection: what it read and how it ended. */
  const dial = (port: number): Promise<{ data: string; error: string | null }> =>
    new Promise((res) => {
      const s = net.connect({ host: '127.0.0.1', port });
      let data = '';
      let error: string | null = null;
      s.on('data', (d: Buffer) => (data += d.toString('latin1')));
      s.on('error', (e: NodeJS.ErrnoException) => (error = e.code ?? 'error'));
      s.on('close', () => res({ data, error }));
      setTimeout(() => s.destroy(), 10_000).unref(); // win32 retries a refused connect for ~2 s before ECONNREFUSED
    });
  const exited = (rows: Row[]) => rows.filter((r) => r.kind === 'socket.web.transport.exited').length;

  it('the listener is bound to 127.0.0.1 (the kernel listens, not the child)', async () => {
    const { ep } = await rig();
    await ep.ensureListening();
    expect(ep.listenAddress()).toEqual({ address: '127.0.0.1', port: ep.port });
  });

  it.each(['user-msg', 'internal-msg'])('a child that sends any IPC message (%s) is killed', async (mode) => {
    const { ep, rows } = await fakeRig(mode);
    await ep.ensureListening();
    const pid = ep.childPid()!;
    await until(() => exited(rows) >= 1);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('a healthy child ACKs every hand-off: the watchdog never fires (internalMessage canary)', async () => {
    const { ep, rows } = await rig({ handoffAckMs: 300 });
    await ep.ensureListening();
    const pid = ep.childPid();
    for (let i = 0; i < 5; i++) expect((await rawHttp(ep.port, 'GET', '/', GOOD(ep.port))).status).toBe(200);
    await sleep(700);
    expect(exited(rows)).toBe(0);
    expect(ep.childPid()).toBe(pid);
  });

  it('an ACK-less child is SIGKILLed by the watchdog', async () => {
    const { ep, rows } = await fakeRig('stall', { handoffAckMs: 300 });
    await ep.ensureListening();
    const pid = ep.childPid()!;
    // keep dialing until the watchdog fires: on a slow runner the first hand-off may land before the busy loop
    const end = Date.now() + 15_000;
    while (exited(rows) === 0 && Date.now() < end) {
      void dial(ep.port);
      await sleep(200);
    }
    expect(exited(rows)).toBeGreaterThanOrEqual(1);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('a restart keeps the port; a connection during the restart is destroyed; after it the port serves again', async () => {
    const { ep, rows } = await fakeRig('slow-restart');
    await ep.ensureListening();
    const port = ep.port;
    expect((await dial(port)).data).toContain('ok');
    process.kill(ep.childPid()!, 'SIGKILL');
    await until(() => exited(rows) === 1);
    expect(ep.listening).toBe(false); // the respawned child waits 1.5 s before ready
    const during = await dial(port);
    expect(during.data).toBe(''); // accepted, then closed (a clean close or a reset, per OS): never served
    await until(() => ep.listening, 10_000);
    expect(ep.port).toBe(port);
    expect(ep.listenAddress()).toEqual({ address: '127.0.0.1', port });
    expect((await dial(port)).data).toContain('ok');
  });

  it('after stop() the launch port refuses connections', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    await ep.stop('test');
    expect(ep.listenAddress()).toBeNull();
    expect((await dial(grant.port)).error).toBe('ECONNREFUSED');
  });

  it('after the restart cap the launch port refuses connections', async () => {
    const { ep, rows } = await fakeRig('normal');
    const grant = await ep.requestLaunch(HUMAN);
    for (let i = 1; i <= 4; i++) {
      const pid = ep.childPid()!;
      process.kill(pid, 'SIGKILL');
      await until(() => exited(rows) === i);
      if (i <= 3) await until(() => ep.listening && ep.childPid() !== pid);
    }
    await until(() => rows.some((r) => r.kind === 'socket.web.stop' && r.payload.reason === 'transport-restart-cap'));
    expect((await dial(grant.port)).error).toBe('ECONNREFUSED');
  });

  it('after a failed respawn the launch port refuses connections', async () => {
    const { ep, rows } = await fakeRig('fail-restart');
    const grant = await ep.requestLaunch(HUMAN);
    process.kill(ep.childPid()!, 'SIGKILL');
    await until(() => rows.some((r) => r.kind === 'socket.web.stop' && r.payload.reason === 'transport-restart-failed'), 10_000);
    expect((await dial(grant.port)).error).toBe('ECONNREFUSED');
  });

  it.each(['slow-restart', 'late-ready'])('stop() while the start is still waiting for ready (%s): no listen, the child killed, exactly one socket.web.stop row', async (mode) => {
    const { ep, rows } = await fakeRig(mode);
    await ep.ensureListening();
    process.kill(ep.childPid()!, 'SIGKILL');
    await until(() => exited(rows) === 1);
    const respawned = ep.childPid();
    expect(respawned).not.toBeNull();
    await ep.stop('test'); // during the respawn's 1.5 s wait for ready
    await sleep(2000);
    expect(ep.listening).toBe(false);
    expect(ep.listenAddress()).toBeNull();
    expect(rows.filter((r) => r.kind === 'socket.web.stop')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'socket.web.listen')).toHaveLength(1); // the first start only
    expect(() => process.kill(respawned!, 0)).toThrow();
  });
});

describe('round 3: unsolicited ACKs and a stop() during the exit-log write (T-2026-10-18-020)', () => {
  const FAKE = `const [hash, mode] = process.argv.slice(2);
const ready = () => process.stdout.write(JSON.stringify({ t: 'ready', bundleHash: hash, files: 1 }) + '\\n');
process.on('message', (m, s) => {
  if (m !== 'conn' || !s) return;
  s.end('HTTP/1.0 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok');
  if (mode === 'ack-double') setTimeout(() => process.send({ cmd: 'NODE_HANDLE_ACK' }), 20); // one more ACK than hand-offs
});
process.stdin.once('data', () => {
  ready();
  if (mode === 'ack-unsolicited') setTimeout(() => process.send({ cmd: 'NODE_HANDLE_ACK' }), 50); // nothing in flight
});
process.stdin.on('end', () => process.exit(0));
`;
  async function fakeRig(mode: string, extra: { logDelay?: { kind: string; ms: number } } = {}) {
    const t = tempHome('gu-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const fake = path.join(t.home, 'fake-ack.cjs');
    writeFileSync(fake, FAKE);
    return rig({ ...extra, launcher: (input) => ({ ...unsandboxedLauncher({ ...input, scriptPath: fake }), args: [fake, GUI_BUNDLE_HASH, mode] }) });
  }
  const exited = (rows: Row[]) => rows.filter((r) => r.kind === 'socket.web.transport.exited').length;
  const get = (port: number) => rawHttp(port, 'GET', '/', GOOD(port));

  it.each(['ack-unsolicited', 'ack-double'])('%s: the kernel survives (no ERR_INTERNAL_ASSERTION) and the child is killed', async (mode) => {
    const { ep, rows } = await fakeRig(mode);
    await ep.ensureListening();
    const pid = ep.childPid()!;
    if (mode === 'ack-double') expect((await get(ep.port)).body.toString()).toBe('ok');
    await until(() => exited(rows) >= 1, 10_000); // a loaded runner can take seconds to spawn and kill the child
    expect(() => process.kill(pid, 0)).toThrow();
    // the kernel is alive and supervising: the child was restarted and the same port serves
    await until(() => ep.listening && ep.childPid() !== pid, 10_000);
    expect(rows.find((r) => r.kind === 'socket.web.transport.exited')?.payload).toMatchObject({ signal: 'SIGKILL' });
  });

  it('a stop() while the exit-log row is being written cancels the respawn and is recorded', async () => {
    const { ep, rows } = await fakeRig('normal', { logDelay: { kind: 'socket.web.transport.exited', ms: 500 } });
    await ep.ensureListening();
    process.kill(ep.childPid()!, 'SIGKILL');
    await until(() => ep.childPid() === null); // #onChildExit is now awaiting the slow exit-log write
    await ep.stop('test');
    await sleep(1500);
    expect(exited(rows)).toBe(1);
    expect(ep.listening).toBe(false);
    expect(ep.childPid()).toBeNull();
    expect(ep.listenAddress()).toBeNull();
    expect(rows.filter((r) => r.kind === 'socket.web.listen')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'socket.web.stop').map((r) => r.payload)).toEqual([{ reason: 'test' }]);
  });
});
