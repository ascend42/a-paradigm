/**
 * @symbol #web-endpoint
 *
 * #web-endpoint HTTP rules (spec §11.2 rules 3–6 and 8) — PURE decisions the
 * kernel takes on the records the transport child forwards. Nothing here
 * touches a socket; endpoint.ts turns a verdict into a child record.
 *
 *   rule 4 (DNS rebinding, `G-WEB-03`): `Host` must equal `127.0.0.1:<port>`
 *     exactly, else 421 + socket.auth.fail{reason:'host'} — before any routing.
 *   rule 3 (origin lock, `G-WEB-02`): every WebSocket upgrade and every
 *     non-static request carries `Origin: http://127.0.0.1:<port>` exactly —
 *     the one origin (rule 10) — else 403 with no body + socket.auth.fail
 *     {reason:'origin'}. Static files skip the origin check (public bytes).
 *   The two credentialed routes `/diag` and `/blob/<sha>` are POST: browsers
 *   send `Origin` on a same-origin POST (never on a same-origin GET), and the
 *   page sends them with `referrerPolicy: 'same-origin'` (under the page's
 *   `no-referrer` policy a POST would carry `Origin: null`).
 *   rule 5 (CSRF, `G-WEB-04`): no cookie is set or read; `Sec-Fetch-Site` must
 *     be present and `same-origin` or `none` on every non-static request
 *     (the upgrade included), else 403 + socket.auth.fail{reason:'sec-fetch-site'};
 *     the only HTTP credential is `X-Gnomon-Token` (a live GUI token) on
 *     `/diag` and `/blob/<sha>`. There is no HTTP RPC: verbs travel on the
 *     authenticated WebSocket only.
 *   rule 6 (headers, `G-WEB-06`): the fixed CSP, COOP, CORP, nosniff,
 *     no-referrer on every response the kernel decides (the child's own
 *     503/404 carry childDefaultHeaders: the same set with a stricter CSP,
 *     `default-src 'none'` and no script/connect sources), `Cache-Control: no-store` on non-static
 *     ones, never an `Access-Control-Allow-Origin`; static paths are
 *     path-normalized (a `..` segment, a backslash, a NUL or an undecodable
 *     escape is refused) and confined to the pinned bundle (the child serves
 *     only the in-memory files it hashed); `/blob` serves PNG, JPEG and WebP
 *     only, by content sniffing — never SVG, never by stored metadata.
 */

import type { HeaderMap } from './protocol.js';

export type FailReason = 'host' | 'origin' | 'sec-fetch-site';

export const expectedHost = (port: number): string => `127.0.0.1:${port}`;
export const expectedOrigin = (port: number): string => `http://127.0.0.1:${port}`;

/** §11.2 rule 6, verbatim. */
export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob:",
    "font-src 'self'",
    `connect-src ws://127.0.0.1:${port} http://127.0.0.1:${port}`,
    "worker-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The headers every response carries (rule 6); `nonStatic` adds `Cache-Control: no-store`. */
export function securityHeaders(port: number, nonStatic: boolean): HeaderMap {
  return {
    'content-security-policy': contentSecurityPolicy(port),
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(nonStatic ? { 'cache-control': 'no-store' } : {}),
  };
}

/** Headers on the responses the CHILD writes on its own (503 / 404): rule 6, with the strictest CSP. */
export function childDefaultHeaders(): HeaderMap {
  return {
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  };
}

const MIME: Readonly<Record<string, string>> = Object.freeze({
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json',
});

/** Content type of a bundle file by extension (the kernel names the file; it never reads GUI code). */
export function staticContentType(file: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/**
 * Normalize a request target into a bundle-relative file. Refuses (null) a
 * query-less path that is not absolute, contains `..`/`.` segments, a
 * backslash, a NUL, an undecodable escape, or an encoded slash.
 */
export function bundlePath(target: string): string | null {
  const q = target.indexOf('?');
  const raw = q === -1 ? target : target.slice(0, q);
  if (!raw.startsWith('/') || raw.includes('\\') || /%2f|%5c|%00/i.test(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segs = decoded.split('/').slice(1);
  if (segs.some((s) => s === '..' || s === '.')) return null;
  const rel = segs.filter((s) => s.length > 0).join('/');
  return rel === '' ? 'index.html' : rel;
}

export type HttpRoute =
  | { kind: 'refuse'; status: number; fail?: FailReason; nonStatic: boolean }
  | { kind: 'static'; file: string; contentType: string }
  | { kind: 'diag' }
  | { kind: 'blob'; sha: string };

/** The non-static routes: `/rpc` and `/diag` exactly; only `/blob/` is a prefix. */
const isNonStatic = (p: string): boolean => p === '/rpc' || p === '/diag' || p === '/blob' || p.startsWith('/blob/');

/** Origin + Sec-Fetch-Site for a non-static request or an upgrade (rules 3, 5). */
export function checkCrossSite(headers: HeaderMap, port: number): FailReason | null {
  if (headers.origin !== expectedOrigin(port)) return 'origin';
  const sfs = headers['sec-fetch-site'];
  if (sfs !== 'same-origin' && sfs !== 'none') return 'sec-fetch-site';
  return null;
}

/** Route a plain HTTP request (never an upgrade). */
export function routeHttp(req: { method: string; path: string; headers: HeaderMap }, port: number): HttpRoute {
  if (req.headers.host !== expectedHost(port)) return { kind: 'refuse', status: 421, fail: 'host', nonStatic: true };
  const q = req.path.indexOf('?');
  const p = q === -1 ? req.path : req.path.slice(0, q);
  if (isNonStatic(p)) {
    const bad = checkCrossSite(req.headers, port);
    if (bad) return { kind: 'refuse', status: 403, fail: bad, nonStatic: true };
    if (p === '/rpc') return { kind: 'refuse', status: 426, nonStatic: true }; // the WebSocket only; no HTTP RPC
    if (p === '/diag') return req.method === 'POST' ? { kind: 'diag' } : { kind: 'refuse', status: 405, nonStatic: true };
    const m = /^\/blob\/([0-9a-f]{64})$/.exec(p);
    if (!m) return { kind: 'refuse', status: 404, nonStatic: true };
    // POST (Aegis M1.10 ruling): a same-origin GET carries no Origin, and rule 3 needs the exact Origin on every non-static route
    return req.method === 'POST' ? { kind: 'blob', sha: m[1]! } : { kind: 'refuse', status: 405, nonStatic: true };
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return { kind: 'refuse', status: 405, nonStatic: false };
  const file = bundlePath(req.path);
  if (file === null) return { kind: 'refuse', status: 404, nonStatic: false };
  return { kind: 'static', file, contentType: staticContentType(file) };
}

export type UpgradeVerdict = { ok: true } | { ok: false; status: number; fail?: FailReason; headers?: HeaderMap };

/** Decide a WebSocket upgrade (rules 3–5; RFC 6455 §4.2.1 handshake shape). Extensions are never negotiated. */
export function decideUpgrade(req: { method: string; path: string; headers: HeaderMap }, port: number): UpgradeVerdict {
  const h = req.headers;
  if (h.host !== expectedHost(port)) return { ok: false, status: 421, fail: 'host' };
  const bad = checkCrossSite(h, port);
  if (bad) return { ok: false, status: 403, fail: bad };
  if (req.path !== '/rpc') return { ok: false, status: 404 };
  if (req.method !== 'GET') return { ok: false, status: 400 };
  if (!/(^|,)\s*websocket\s*(,|$)/i.test(h.upgrade ?? '') || !/(^|,)\s*upgrade\s*(,|$)/i.test(h.connection ?? '')) return { ok: false, status: 400 };
  if (h['sec-websocket-version'] !== '13') return { ok: false, status: 426, headers: { 'sec-websocket-version': '13' } };
  const key = h['sec-websocket-key'] ?? '';
  if (!/^[A-Za-z0-9+/]{22}==$/.test(key) || Buffer.from(key, 'base64').length !== 16) return { ok: false, status: 400 };
  return { ok: true };
}

/** `/blob` content sniffing: the raster type of the bytes, or null (SVG, HTML, anything else ⇒ refused). */
export function sniffRaster(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Rule 8: token exchange and Reconnect ≤ `max` attempts per `windowMs` per
 * connection, after which that connection is closed.
 */
export class AttemptLimiter {
  readonly #at: number[] = [];
  constructor(
    readonly max: number = 5,
    readonly windowMs: number = 60_000,
  ) {}
  /** Record an attempt at `now`; false = over the limit (close the connection). */
  attempt(now: number): boolean {
    while (this.#at.length && now - this.#at[0]! >= this.windowMs) this.#at.shift();
    this.#at.push(now);
    return this.#at.length <= this.max;
  }
}
