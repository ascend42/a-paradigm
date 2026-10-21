/**
 * #web-endpoint units (spec §11.2, §4.9): the pure HTTP rules (G-WEB-02/03/04/06),
 * the RFC 6455 codec refusals (G-WEB-07, probe p11-ws-framing), the launch-token
 * classification (G-WEB-05) and the bundle pin (G-WEB-08). Platform-independent.
 */
import { describe, expect, it } from 'vitest';
import {
  AttemptLimiter,
  bundlePath,
  contentSecurityPolicy,
  decideUpgrade,
  GuiAccess,
  LAUNCH_TOKEN_TTL_MS,
  PLACEHOLDER_BUNDLE_HASH,
  placeholderFiles,
  GUI_BUNDLE_HASH,
  guiBundleFiles,
  routeHttp,
  securityHeaders,
  sniffRaster,
  staticContentType,
  treeHashOf,
} from '../src/kernel/web/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashBundleDir } from '../src/kernel/web/bundle.js';
import { materializeGuiBundle } from '../src/kernel/web/gui-pin.js';
import { transportLaunchPlan } from '../src/kernel/sandbox/index.js';
import { validateChildRecord } from '../src/kernel/web/protocol.js';
import { acceptKey, encodeClientFrame, FrameDecoder, OP, validCloseCode } from '../src/transport/ws-codec.js';

const P = 51234;
const H = { host: `127.0.0.1:${P}`, origin: `http://127.0.0.1:${P}`, 'sec-fetch-site': 'same-origin' };
const UP = { ...H, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };

describe('G-WEB-03 DNS rebinding: Host must be 127.0.0.1:<port> before any routing', () => {
  it.each(['attacker.example:51234', 'localhost:51234', '127.0.0.1', '127.0.0.1:1', '[::1]:51234', ''])('Host %j ⇒ 421 host', (host) => {
    expect(routeHttp({ method: 'GET', path: '/', headers: { ...H, host } }, P)).toMatchObject({ kind: 'refuse', status: 421, fail: 'host' });
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers: { ...UP, host } }, P)).toMatchObject({ ok: false, status: 421, fail: 'host' });
  });
});

describe('G-WEB-02 origin lock (one origin) and G-WEB-04 Sec-Fetch-Site', () => {
  it.each([undefined, 'http://evil.example', 'http://localhost:51234', 'https://127.0.0.1:51234', 'tauri://localhost', 'null'])('Origin %j on the upgrade and non-static routes ⇒ 403 origin', (origin) => {
    const headers = { ...UP, ...(origin === undefined ? {} : { origin }) };
    if (origin === undefined) delete (headers as Record<string, string>).origin;
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers }, P)).toMatchObject({ ok: false, status: 403, fail: 'origin' });
    expect(routeHttp({ method: 'POST', path: '/diag', headers }, P)).toMatchObject({ kind: 'refuse', status: 403, fail: 'origin' });
    expect(routeHttp({ method: 'POST', path: `/blob/${'a'.repeat(64)}`, headers }, P)).toMatchObject({ kind: 'refuse', status: 403, fail: 'origin' });
  });
  it.each(['cross-site', 'same-site'])('Sec-Fetch-Site %j ⇒ 403 on an upgrade and a non-static route', (sfs) => {
    const headers: Record<string, string> = { ...UP, 'sec-fetch-site': sfs };
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers }, P)).toMatchObject({ ok: false, fail: 'sec-fetch-site' });
    expect(routeHttp({ method: 'POST', path: '/diag', headers }, P)).toMatchObject({ kind: 'refuse', fail: 'sec-fetch-site' });
  });
  it('a MISSING Sec-Fetch-Site passes an upgrade with the exact Origin (Chrome sends none on the WebSocket handshake), and the token-gated /diag and /blob POSTs (flagged sfsAbsent), never /rpc', () => {
    const headers: Record<string, string> = { ...UP };
    delete headers['sec-fetch-site'];
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers }, P)).toEqual({ ok: true });
    expect(routeHttp({ method: 'POST', path: '/diag', headers }, P)).toEqual({ kind: 'diag', sfsAbsent: true });
    expect(routeHttp({ method: 'POST', path: `/blob/${'a'.repeat(64)}`, headers }, P)).toEqual({ kind: 'blob', sha: 'a'.repeat(64), sfsAbsent: true });
    expect(routeHttp({ method: 'POST', path: '/rpc', headers }, P)).toMatchObject({ kind: 'refuse', fail: 'sec-fetch-site' });
    expect(routeHttp({ method: 'POST', path: '/diag', headers: { ...headers, origin: 'http://evil.example' } }, P)).toMatchObject({ kind: 'refuse', fail: 'origin' });
    expect(routeHttp({ method: 'POST', path: '/diag', headers: H }, P)).toEqual({ kind: 'diag' });
    const foreign = { ...headers, origin: 'http://evil.example' };
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers: foreign }, P)).toMatchObject({ ok: false, fail: 'origin' });
  });
  it('same-origin and none pass; static files skip the origin check; there is no HTTP RPC', () => {
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers: UP }, P)).toEqual({ ok: true });
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers: { ...UP, 'sec-fetch-site': 'none' } }, P)).toEqual({ ok: true });
    expect(routeHttp({ method: 'GET', path: '/', headers: { host: H.host } }, P)).toMatchObject({ kind: 'static', file: 'index.html' });
    expect(routeHttp({ method: 'POST', path: '/rpc', headers: H }, P)).toMatchObject({ kind: 'refuse', status: 426 });
    expect(routeHttp({ method: 'POST', path: '/', headers: H }, P)).toMatchObject({ kind: 'refuse', status: 405 });
  });
  it('/rpc and /diag match exactly, only /blob/ is a prefix; /blob and /diag are POST (GET/HEAD 405)', () => {
    expect(routeHttp({ method: 'GET', path: '/rpcx', headers: { host: H.host } }, P)).toMatchObject({ kind: 'static', file: 'rpcx' });
    expect(routeHttp({ method: 'GET', path: '/diagnostics.js', headers: { host: H.host } }, P)).toMatchObject({ kind: 'static' });
    const sha = 'a'.repeat(64);
    expect(routeHttp({ method: 'POST', path: `/blob/${sha}`, headers: H }, P)).toEqual({ kind: 'blob', sha });
    for (const m of ['GET', 'HEAD']) {
      expect(routeHttp({ method: m, path: `/blob/${sha}`, headers: H }, P)).toMatchObject({ kind: 'refuse', status: 405 });
      expect(routeHttp({ method: m, path: '/diag', headers: H }, P)).toMatchObject({ kind: 'refuse', status: 405 });
    }
  });
  it.todo('M1.10 (G-WEB-02, real browser engines): a fixture page in Chromium/WebKit/Gecko proves POST /diag and /blob send the exact Origin with referrerPolicy same-origin, and that a cross-origin page cannot');
  it('the handshake shape: version 13, a 16-byte key, path /rpc', () => {
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers: { ...UP, 'sec-websocket-version': '8' } }, P)).toMatchObject({ ok: false, status: 426 });
    expect(decideUpgrade({ method: 'GET', path: '/rpc', headers: { ...UP, 'sec-websocket-key': 'short' } }, P)).toMatchObject({ ok: false, status: 400 });
    expect(decideUpgrade({ method: 'GET', path: '/x', headers: UP }, P)).toMatchObject({ ok: false, status: 404 });
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo='); // RFC 6455 §1.3
  });
});

describe('G-WEB-06 headers, CSP, traversal, raster-only /blob', () => {
  it('the CSP is §11.2 rule 6 verbatim; every response carries COOP/CORP/nosniff/no-referrer; never ACAO', () => {
    expect(contentSecurityPolicy(P)).toBe(
      `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src ws://127.0.0.1:${P} http://127.0.0.1:${P}; worker-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    );
    const s = securityHeaders(P, false);
    const n = securityHeaders(P, true);
    for (const h of [s, n]) {
      expect(h).toMatchObject({ 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      expect(Object.keys(h).some((k) => k.startsWith('access-control') || k === 'set-cookie')).toBe(false);
      expect(contentSecurityPolicy(P)).not.toContain('data:');
    }
    expect(n['cache-control']).toBe('no-store');
    expect(s['cache-control']).toBeUndefined();
  });
  it.each(['/../etc/passwd', '/a/../../x', '/%2e%2e/x', '/..%2fx', '/a%5cb', '/a\\b', '/%00', '/%zz', 'relative', '/./index.html'])('traversal %j ⇒ refused', (t) => {
    expect(bundlePath(t)).toBeNull();
    expect(routeHttp({ method: 'GET', path: t, headers: { host: H.host } }, P)).toMatchObject({ kind: 'refuse', status: 404 });
  });
  it('normal paths map into the bundle', () => {
    expect(bundlePath('/')).toBe('index.html');
    expect(bundlePath('/app.js?v=1')).toBe('app.js');
    expect(bundlePath('/assets/a%20b.css')).toBe('assets/a b.css');
  });
  it('sniffing: PNG/JPEG/WebP only; SVG, HTML, a PNG extension on script bytes ⇒ null', () => {
    expect(sniffRaster(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).toBe('image/png');
    expect(sniffRaster(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffRaster(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<?xml version="1.0"?><svg/>', '<html><script>x</script>', 'GIF89a']) expect(sniffRaster(Buffer.from(s))).toBeNull();
  });
});

describe('rule 8: ≤ 5 auth attempts per minute per connection', () => {
  it('the sixth attempt inside the window is refused; the window slides', () => {
    const l = new AttemptLimiter();
    for (let i = 0; i < 5; i++) expect(l.attempt(1000 + i)).toBe(true);
    expect(l.attempt(1006)).toBe(false);
    expect(new AttemptLimiter().attempt(0)).toBe(true);
    const m = new AttemptLimiter(1, 60_000);
    expect(m.attempt(0)).toBe(true);
    expect(m.attempt(60_000)).toBe(true);
  });
});

describe('G-WEB-07 RFC 6455 refusals in the codec (p11-ws-framing cases + §4.9 deviations)', () => {
  const dec = (b: Buffer) => new FrameDecoder(4 * 1024 * 1024).push(b);
  const t = (s: string) => Buffer.from(s, 'utf8');
  it('a masked text frame decodes; ping/pong pass through', () => {
    expect(dec(encodeClientFrame(OP.TEXT, t('héllo')))).toEqual([{ kind: 'text', data: t('héllo') }]);
    expect(dec(encodeClientFrame(OP.PING, t('abc')))[0]).toMatchObject({ kind: 'ping' });
  });
  it.each([
    ['binary ⇒ 1003', encodeClientFrame(OP.BINARY, t('x')), 1003],
    ['FIN=0 text ⇒ 1009 (no fragmentation)', encodeClientFrame(OP.TEXT, t('x'), { fin: false }), 1009],
    ['continuation ⇒ 1009', encodeClientFrame(OP.CONT, t('x')), 1009],
    ['RSV1 (permessage-deflate) ⇒ 1002', encodeClientFrame(OP.TEXT, t('x'), { rsv: 4 }), 1002],
    ['unmasked ⇒ 1002', encodeClientFrame(OP.TEXT, t('x'), { mask: false }), 1002],
    ['reserved opcode 3 ⇒ 1002', encodeClientFrame(3, t('x')), 1002],
    ['ping 126 bytes ⇒ 1002', encodeClientFrame(OP.PING, Buffer.alloc(126)), 1002],
    ['fragmented ping ⇒ 1002', encodeClientFrame(OP.PING, t('x'), { fin: false }), 1002],
    ['invalid UTF-8 ⇒ 1007', encodeClientFrame(OP.TEXT, Buffer.from([0xc3, 0x28])), 1007],
    ['oversize header ⇒ 1009 before any payload', encodeClientFrame(OP.TEXT, Buffer.alloc(0), { len: 4 * 1024 * 1024 + 1 }), 1009],
    ['close with 1-byte payload ⇒ 1002', encodeClientFrame(OP.CLOSE, Buffer.from([3])), 1002],
    ['close code 1005 ⇒ 1002', encodeClientFrame(OP.CLOSE, Buffer.from([0x03, 0xed])), 1002],
    ['close reason invalid UTF-8 ⇒ 1007', encodeClientFrame(OP.CLOSE, Buffer.from([0x03, 0xe8, 0xc3, 0x28])), 1007],
  ])('%s', (_n, frame, code) => {
    expect(dec(frame)).toEqual([expect.objectContaining({ kind: 'fail', code })]);
  });
  it('a valid close is reported with its code (mirrored by the child); nothing after it decodes', () => {
    const d = new FrameDecoder(1024);
    expect(d.push(Buffer.concat([encodeClientFrame(OP.CLOSE, Buffer.from([0x0f, 0xa0])), encodeClientFrame(OP.TEXT, t('late'))]))).toEqual([{ kind: 'close', code: 4000, reason: Buffer.alloc(0) }]);
    expect(d.push(encodeClientFrame(OP.TEXT, t('x')))).toEqual([]);
    for (const c of [999, 1004, 1005, 1006, 1015, 1016, 2999, 5000]) expect(validCloseCode(c)).toBe(false);
    for (const c of [1000, 1001, 1011, 3000, 4999]) expect(validCloseCode(c)).toBe(true);
  });
  it('the payload cap can be raised after construction (child: 16 KiB pre-auth, then the kernel `limit`)', () => {
    const d = new FrameDecoder(16 * 1024);
    expect(d.push(encodeClientFrame(OP.TEXT, Buffer.alloc(16 * 1024, 0x61)))).toHaveLength(1);
    d.setMaxPayload(4 * 1024 * 1024);
    expect(d.push(encodeClientFrame(OP.TEXT, Buffer.alloc(20 * 1024, 0x61)))).toEqual([{ kind: 'text', data: Buffer.alloc(20 * 1024, 0x61) }]);
    expect(new FrameDecoder(16 * 1024).push(encodeClientFrame(OP.TEXT, Buffer.alloc(16 * 1024 + 1)))).toEqual([expect.objectContaining({ kind: 'fail', code: 1009 })]);
  });
  it('byte-at-a-time delivery decodes the same frame (length boundaries 125/126/65536)', () => {
    for (const n of [125, 126, 65535, 65536]) {
      const d = new FrameDecoder(1 << 20);
      const f = encodeClientFrame(OP.TEXT, Buffer.alloc(n, 0x61));
      const out = [];
      for (let i = 0; i < f.length; i += 997) out.push(...d.push(f.subarray(i, i + 997)));
      expect(out).toEqual([{ kind: 'text', data: Buffer.alloc(n, 0x61) }]);
    }
  });
});

describe('G-WEB-05 launch token classification (theft inside the TTL, replay after it)', () => {
  const bind = { deviceId: 'dev:00000000/mac-1', principal: 'p:00000000/founder', askedBy: 'conn:A' };
  it('fresh once; second presentation inside the TTL is theft naming the consumer; after the TTL a replay', () => {
    const now = { t: 1_000_000 };
    const g = new GuiAccess(() => now.t);
    const { launchToken, expiresAt } = g.mint(bind);
    expect(expiresAt - now.t).toBe(LAUNCH_TOKEN_TTL_MS);
    expect(launchToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(g.exchange(launchToken, 'conn:W1')).toEqual({ kind: 'fresh', binding: bind });
    now.t += LAUNCH_TOKEN_TTL_MS;
    expect(g.exchange(launchToken, 'conn:W2')).toEqual({ kind: 'theft', consumedBy: 'conn:W1' });
    now.t += 1;
    expect(g.exchange(launchToken, 'conn:W3')).toEqual({ kind: 'replay', consumedBy: 'conn:W1' });
  });
  it('an unconsumed token dies at its TTL; unknown and malformed tokens are unknown; the kernel keeps digests only', () => {
    const now = { t: 0 };
    const g = new GuiAccess(() => now.t);
    const { launchToken } = g.mint(bind);
    now.t = LAUNCH_TOKEN_TTL_MS + 1;
    expect(g.exchange(launchToken, 'conn:W')).toEqual({ kind: 'expired' });
    expect(g.exchange('x'.repeat(43), 'conn:W')).toEqual({ kind: 'unknown' });
    expect(g.exchange(42, 'conn:W')).toEqual({ kind: 'unknown' });
    expect(JSON.stringify(g.sessions()) + JSON.stringify(g)).not.toContain(launchToken);
  });
  it('GUI session tokens: found by token, gone with their session, capped at 12 h', () => {
    const now = { t: 0 };
    const g = new GuiAccess(() => now.t);
    const { guiToken, session } = g.issue({ connId: 'conn:W', deviceId: bind.deviceId, principal: bind.principal, surface: 'browser', via: 'launch' });
    expect(g.sessionForToken(guiToken)?.connId).toBe('conn:W');
    expect(JSON.stringify(g.sessions())).not.toContain(guiToken);
    now.t = session.expiresAt;
    expect(g.sessionForToken(guiToken)).toBeUndefined();
    expect(g.expired()).toEqual(['conn:W']);
    expect(g.end('conn:W')).toBe(true);
    expect(g.sessionForToken(guiToken)).toBeUndefined();
  });
});

describe('G-WEB-08 bundle pin', () => {
  it('the placeholder pin literal equals the tree hash of the placeholder bytes; any byte change moves it', () => {
    expect(treeHashOf(placeholderFiles())).toBe(PLACEHOLDER_BUNDLE_HASH);
    const f = placeholderFiles();
    f.set('app.js', Buffer.concat([f.get('app.js')!, Buffer.from(' ')]));
    expect(treeHashOf(f)).not.toBe(PLACEHOLDER_BUNDLE_HASH);
    const g = placeholderFiles();
    g.set('extra.js', Buffer.from('x'));
    expect(treeHashOf(g)).not.toBe(PLACEHOLDER_BUNDLE_HASH);
  });
  it('the placeholder has no inline script, no eval and no data: URL (loads under the rule-6 CSP)', () => {
    const html = placeholderFiles().get('index.html')!.toString();
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    for (const v of placeholderFiles().values()) expect(v.toString()).not.toMatch(/\beval\(|data:|new Function/);
  });
  it('M1.10: the #gui pin literal equals the tree hash of the embedded GUI bytes; any byte change moves it', () => {
    expect(GUI_BUNDLE_HASH).toBe('sha256:40ded79d8949c4342c0198068164e20d94785bc2b70ec09b64ee651980964828');
    expect(treeHashOf(guiBundleFiles())).toBe(GUI_BUNDLE_HASH);
    const f = guiBundleFiles();
    f.set('app.js', Buffer.concat([f.get('app.js')!, Buffer.from(' ')]));
    expect(treeHashOf(f)).not.toBe(GUI_BUNDLE_HASH);
    expect([...guiBundleFiles().keys()].sort()).toEqual([
      'app.js', 'boot.js',
      'fonts/Fraunces-opsz-wght.woff2', 'fonts/JetBrainsMono-Medium.woff2', 'fonts/JetBrainsMono-Regular.woff2', 'fonts/JetBrainsMono-SemiBold.woff2',
      'fonts/OFL-Fraunces.txt', 'fonts/OFL-JetBrainsMono.txt',
      'grain.svg', 'index.html', 'styles.css',
    ]);
  });
  it('S1: binary bundle files survive the base64 embed raw (woff2 magic + the kernel serves them as font/woff2)', () => {
    const fonts = [...guiBundleFiles()].filter(([n]) => n.endsWith('.woff2'));
    expect(fonts.length).toBe(4);
    for (const [n, b] of fonts) {
      expect(b.subarray(0, 4).toString('latin1'), n).toBe('wOF2');
      expect(b.includes(Buffer.from([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd])), `${n} looks utf8-mangled`).toBe(false);
      expect(staticContentType(n)).toBe('font/woff2');
    }
    expect(staticContentType('grain.svg')).toBe('image/svg+xml'); // the bundle's own grain (static only; /blob refuses SVG)
  });
  it('Aegis S1 L1: materializeGuiBundle writes the pinned tree (sub-directories included) and it re-hashes to the pin', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'gnomon-gui-pin-'));
    try {
      const dir = materializeGuiBundle(home);
      expect(hashBundleDir(dir).hash).toBe(GUI_BUNDLE_HASH);
      expect(materializeGuiBundle(home)).toBe(dir); // a second start replaces the tree (rmSync then wx writes)
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it('M1.10: the #gui bundle has no inline script, no eval, no data: URL, no HTML sinks and no remote load (rule-6 CSP)', () => {
    const files = guiBundleFiles();
    const html = files.get('index.html')!.toString();
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=/i);
    expect(html.indexOf('/boot.js')).toBeLessThan(html.indexOf('/app.js')); // fragment read-and-clear runs first
    const binary = (n: string): boolean => /\.(woff2?|ttf|png|jpe?g|webp|wasm)$/.test(n); // opaque bytes: not code, never scanned as text
    for (const [n, v] of files) {
      if (binary(n)) continue;
      const s = v.toString();
      if (n.endsWith('.txt')) { // the OFL licences: inert text, but no data: URL
        expect(s, n).not.toMatch(/data:[a-z]+\//);
        continue;
      }
      if (n.endsWith('.svg')) expect(s, n).not.toMatch(/<script|foreignObject|\son[a-z]+=|href/i); // Aegis S1 L2: an SVG is an image, never active
      expect(s, n).not.toMatch(/\beval\(|new Function|data:[a-z]+\/|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
      expect(s, n).not.toMatch(/(src|href)\s*=\s*["']?https?:|@import|url\(\s*["']?https?:/);
    }
  });
});

describe('the transport profile is looked up per platform and fails closed (§15.5, G-WIN-05)', () => {
  it.each(['linux', 'win32', 'freebsd'])('%s has no transport backend ⇒ sandbox-unavailable (never an unsandboxed child)', (platform) => {
    expect(() => transportLaunchPlan({ scriptPath: '/x.js', bundleDir: '/b' }, platform)).toThrow(expect.objectContaining({ reason: 'sandbox-unavailable' }));
  });
});

describe('child records are validated strictly (Aegis C1)', () => {
  const L = { maxFrameBytes: 4 * 1024 * 1024, maxBodyBytes: 64 * 1024 };
  it('the closed shapes pass', () => {
    for (const r of [
      { t: 'ready', bundleHash: 'sha256:x', files: 2 },
      { t: 'http', rid: 1, method: 'GET', path: '/', headers: { host: 'h' } },
      { t: 'http', rid: 2, method: 'POST', path: '/diag', headers: {}, body: 'eA==', bodyOver: true },
      { t: 'upgrade', rid: 3, method: 'GET', path: '/rpc', headers: {} },
      { t: 'frame', rid: 3, data: 'e30=' },
      { t: 'closed', rid: 3, code: 1006, why: 'x' },
      { t: 'pressure', rid: 3, bytes: 5 },
      { t: 'drain', rid: 3 },
      { t: 'fatal', why: 'x' },
    ])
      expect(validateChildRecord(r, L), JSON.stringify(r)).toEqual(r);
  });
  it.each([
    { t: 'http', rid: 1 },
    { t: 'frame', rid: 1, data: 42 },
    { t: 'frame', rid: 1, data: 'not base64!' },
    { t: 'frame', rid: 0, data: '' },
    { t: 'frame', rid: 1.5, data: '' },
    { t: 'frame', rid: 2 ** 60, data: '' },
    { t: 'frame', rid: 1, data: '', extra: 1 },
    { t: 'http', rid: 1, method: 'GET', path: '/', headers: { a: 1 } },
    { t: 'http', rid: 1, method: 'GET', path: '/', headers: [] },
    { t: 'http', rid: 1, method: 'G'.repeat(17), path: '/', headers: {} },
    { t: 'http', rid: 1, method: 'GET', path: 'x'.repeat(8193), headers: {} },
    { t: 'ready', port: 1, bundleHash: 'x', files: 1 }, // the child reports no port: the kernel listens (§15.5)
    { t: 'ready', bundleHash: 'x', files: -1 },
    { t: 'closed', rid: 1, code: '1000', why: '' },
    { t: 'nope' },
    { t: 'constructor' },
    null,
    [],
    'x',
  ])('%j is refused', (r) => {
    expect(validateChildRecord(r, L)).toBeNull();
  });
});
