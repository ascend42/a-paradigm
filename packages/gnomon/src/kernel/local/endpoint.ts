/**
 * @symbol #local-runner
 * @symbol ^subscription-only
 *
 * The kernel's loopback/LAN rule for `gnomon-local` endpoints (spec §13.1,
 * §3.4 "Law 7 inside the broker", §10 law 7; G-SUB-06). The kernel decides
 * FIRST (a configured endpoint outside loopback/RFC 1918 refuses every local
 * open BILLING_REFUSED); the child re-checks the same rule (packages/
 * gnomon-local/src/endpoint.ts — a userland package the kernel never
 * imports). test/local-runner.test.ts holds both copies to ONE table.
 *
 * Classification is on the URL parser's NORMALISED host, never a string
 * prefix (`10.evil.example` is a hostname, `0x7f.1` is 127.0.0.1):
 *   loopback  127.0.0.0/8, ::1, `localhost`, ::ffff:127.x
 *   lan       RFC 1918 (10/8, 172.16/12, 192.168/16) and the IPv6 analogue
 *             fc00::/7 (ULA), ::ffff:<rfc1918>
 * REFUSED: any other hostname (no DNS: a name can rebind to anything — and
 *   Anthropic's hosts are names, refused `anthropic-host`), link-local
 *   169.254/16 and fe80::/10 (the cloud metadata address lives there),
 *   0.0.0.0/8 and ::, every public address, userinfo in the URL, a scheme
 *   other than http/https, port 0, and any port the caller forbids (the web
 *   endpoint's port: the session profile denies connects to it).
 */
import net from 'node:net';

export type EndpointClass = 'loopback' | 'lan';
export type EndpointRefusal = 'malformed' | 'scheme' | 'userinfo' | 'hostname' | 'anthropic-host' | 'link-local' | 'unspecified' | 'public' | 'port';

export type EndpointVerdict = { ok: true; base: string; host: string; port: number; class: EndpointClass } | { ok: false; why: EndpointRefusal; host: string | null };

const ANTHROPIC = /(^|\.)(anthropic\.com|claude\.ai|claude\.com)$/i;

function v4Class(h: string): EndpointClass | 'link-local' | 'unspecified' | 'public' {
  const [a, b] = h.split('.').map(Number) as [number, number];
  if (a === 127) return 'loopback';
  if (a === 0) return 'unspecified';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'lan';
  if (a === 169 && b === 254) return 'link-local';
  return 'public';
}

function v6Class(h: string): EndpointClass | 'link-local' | 'unspecified' | 'public' {
  const x = h.toLowerCase();
  if (x === '::1') return 'loopback';
  if (x === '::') return 'unspecified';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return v4Class(mapped[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return v4Class(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(x)) return 'lan';
  if (/^fe[89ab][0-9a-f]:/.test(x)) return 'link-local';
  return 'public';
}

/** Classify an endpoint base URL; `forbiddenPorts` are refused `port` (the kernel's web endpoint). */
export function classifyEndpoint(base: string, forbiddenPorts: readonly number[] = []): EndpointVerdict {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return { ok: false, why: 'malformed', host: null };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, why: 'scheme', host };
  if (u.username || u.password) return { ok: false, why: 'userinfo', host };
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  let cls: ReturnType<typeof v4Class>;
  const ip = net.isIP(host);
  if (ip === 4) cls = v4Class(host);
  else if (ip === 6) cls = v6Class(host);
  else if (host.toLowerCase() === 'localhost') cls = 'loopback';
  else return { ok: false, why: ANTHROPIC.test(host) ? 'anthropic-host' : 'hostname', host };
  if (cls === 'link-local' || cls === 'unspecified' || cls === 'public') return { ok: false, why: cls, host };
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || forbiddenPorts.includes(port)) return { ok: false, why: 'port', host };
  const path = u.pathname.replace(/\/+$/, '');
  return { ok: true, base: `${u.protocol}//${u.host}${path}`, host, port, class: cls };
}
