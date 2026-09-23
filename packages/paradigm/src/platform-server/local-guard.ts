/**
 * #local-guard — request-time enforcement of the portal.yaml `^local-only` gate.
 *
 * The platform server binds loopback by default, but the socket bind alone does
 * NOT stop a browser page on ANY origin from issuing a CORS "simple request"
 * (POST with no preflight) to http://127.0.0.1:<port>/api/... and mutating the
 * user's global ~/.claude memory (or the task DAG). This middleware closes that
 * hole at the request layer — a CSRF / DNS-rebinding guard — while leaving GET /
 * HEAD reads and same-origin UI fetches untouched.
 *
 * Two independent checks, applied ONLY to state-changing methods on /api/*:
 *   1. Host header — the host portion MUST be loopback ({localhost,127.0.0.1,::1}).
 *      Blocks DNS-rebinding (attacker DNS → 127.0.0.1 but Host: evil.com) and,
 *      deliberately, LAN mutations even when the operator runs --host 0.0.0.0.
 *   2. Origin header (when present) — its host MUST be loopback. Same-origin UI
 *      fetches carry the loopback platform origin and pass; cross-origin
 *      evil.com fails. Non-browser clients (curl, tests, server-to-server) send
 *      no Origin and pass this check (still gated by the Host check).
 *
 * GET/HEAD are never gated (read-only dashboards keep working).
 */

import type { Request, Response, NextFunction } from 'express';

/** The only host portions we treat as loopback. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Extract the bare host from a Host / Origin header value, stripping an optional
 * scheme, brackets around an IPv6 literal, and a trailing :port.
 *
 *   localhost            → localhost
 *   localhost:3000       → localhost
 *   127.0.0.1:8080       → 127.0.0.1
 *   ::1                  → ::1        (bare IPv6, no port — Host form)
 *   [::1]:3000           → ::1        (bracketed IPv6 + port)
 *   http://localhost:5173 → localhost (Origin form)
 *   https://evil.com     → evil.com
 */
function extractHost(headerValue: string): string {
  let host = headerValue.trim();

  // Strip a scheme (Origin headers are full URLs: `http://host:port`).
  const scheme = host.indexOf('://');
  if (scheme !== -1) host = host.slice(scheme + 3);

  // Strip any path/query that might follow (defensive — Origin has none).
  const slash = host.indexOf('/');
  if (slash !== -1) host = host.slice(0, slash);

  if (host.startsWith('[')) {
    // Bracketed IPv6 literal: [::1] or [::1]:port → take what's inside.
    const end = host.indexOf(']');
    return (end !== -1 ? host.slice(1, end) : host.slice(1)).toLowerCase();
  }

  // A bare IPv6 literal (e.g. `::1`) contains multiple colons and no port.
  if (host.split(':').length > 2) return host.toLowerCase();

  // host or host:port
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  return host.toLowerCase();
}

/**
 * True iff the header value's host portion is a loopback host. Empty / missing
 * → false (callers decide whether absence is allowed for their check).
 */
export function isLoopbackHost(headerValue: string | undefined | null): boolean {
  if (!headerValue) return false;
  return LOOPBACK_HOSTS.has(extractHost(headerValue));
}

/**
 * Reflect the request Origin into Access-Control-Allow-Origin ONLY when it is a
 * loopback origin; otherwise omit ACAO entirely. Replaces the old wildcard `*`.
 * Defense-in-depth behind the request gate — the UI is same-origin so this never
 * affects it. Also short-circuits OPTIONS preflights with 204.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && isLoopbackHost(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

/**
 * Request-time `^local-only` guard. Rejects state-changing requests whose Host
 * is non-loopback, or whose (present) Origin is non-loopback, with a small JSON
 * 403 — before the body is parsed. Reads (GET/HEAD) pass untouched.
 */
export function localOnlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  // 1. Host must be loopback (blocks DNS-rebinding + LAN mutations).
  if (!isLoopbackHost(req.headers.host)) {
    res.status(403).json({ error: 'blocked: non-local request' });
    return;
  }

  // 2. If an Origin is present it must be loopback (blocks cross-origin CSRF).
  //    Absent Origin (curl / tests / server-to-server) passes this check.
  const origin = req.headers.origin;
  if (origin && !isLoopbackHost(origin)) {
    res.status(403).json({ error: 'blocked: non-local request' });
    return;
  }

  next();
}
