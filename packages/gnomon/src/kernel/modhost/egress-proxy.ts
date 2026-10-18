/**
 * @symbol #mod-host
 *
 * The kernel's loopback egress proxy for one mod (spec §3.8, §12.3 `network`,
 * §15.4 `grant.egress`, §15.5 row `mod`: "network only to the kernel egress
 * proxy port"). One listener per mod on `127.0.0.1:<ephemeral>`, so every
 * tunnel is attributable to exactly one mod; the `mod` profile allows
 * outbound only to that port.
 *
 * Only `CONNECT host:443` is served (TLS end to end; the proxy never sees
 * plaintext). The host must be in the mod's allowlist = the hosts its
 * manifest declares ∩ its root-signed `grant.egress` rows (loadMod already
 * refused a mod whose declared hosts are not all granted). Refused, each with
 * `mod.effect.refused{name, effect:'network', host, why}`:
 *   - anything but CONNECT (`method`), a port other than 443 (`port`);
 *   - an IP literal, a single-label or private name, an Anthropic host
 *     (`checkEgressHost`, manifest/egress.ts — the same check as manifests and
 *     grant rows; G-MAN-01);
 *   - a host outside the allowlist (`ungranted`);
 *   - any tunnel opened while the mod's call in force lacks `network`
 *     (`effect`; "in force" = the call in force when the CONNECT arrives —
 *     calls are serialized; call-id binding is slice 2);
 *   - a granted name that RESOLVES to a loopback, private, link-local or
 *     unspecified address (`private-address`: DNS cannot be used to reach the
 *     kernel's own endpoints or the LAN).
 * The dialer is a seam (`dial`) so tests can stand a local server in for the
 * internet; the address check runs on whatever the resolver returned.
 */
import * as dns from 'node:dns';
import * as net from 'node:net';
import { checkEgressHost } from '../manifest/egress.js';
import type { ManifestEventSink } from '../manifest/refusal.js';

export const EGRESS_PORTS: ReadonlySet<number> = new Set([443]);
const MAX_HEAD = 8 * 1024;
/** Aegis F4: a request head must arrive within this; concurrent connections are capped; an idle tunnel is closed. */
export const EGRESS_LIMITS = Object.freeze({ headMs: 5_000, maxConnections: 16, idleMs: 60_000 });

/** The dialer (a test seam): RESOLVE first; the proxy checks the address; only then CONNECT to that address (no second lookup to race). */
export interface EgressDial {
  resolve(host: string): Promise<string>;
  connect(address: string, port: number): net.Socket;
}

export const defaultDial: EgressDial = {
  resolve: async (host) => (await dns.promises.lookup(host)).address,
  connect: (address, port) => net.connect({ host: address, port }),
};

function v4NonPublic(a: string): boolean {
  const [x, y, z] = a.split('.').map(Number) as [number, number, number];
  return (
    x === 0 || x === 10 || x === 127 || x >= 224 || // this-net, private, loopback, multicast + reserved
    (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) ||
    (x === 100 && y >= 64 && y <= 127) || // CGNAT 100.64/10
    (x === 198 && (y === 18 || y === 19)) || // benchmarking 198.18/15
    (x === 192 && y === 0 && (z === 0 || z === 2)) || // IETF 192.0.0/24, TEST-NET-1
    (x === 198 && y === 51 && z === 100) || (x === 203 && y === 0 && z === 113) // TEST-NET-2/3
  );
}

/** Expand an IPv6 literal to 8 16-bit groups (an embedded dotted v4 tail becomes two groups). */
function v6Groups(a: string): number[] | null {
  let s = a;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const [p, q, r, t] = v4[1]!.split('.').map(Number) as [number, number, number, number];
    s = `${s.slice(0, -v4[1]!.length)}${((p << 8) | q).toString(16)}:${((r << 8) | t).toString(16)}`;
  }
  const [head, tail] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  const all = [...h, ...Array(fill).fill('0'), ...t].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}

/**
 * Not a public unicast address (fail closed, Aegis C6): IPv4 loopback, private,
 * link-local, CGNAT, benchmarking, IETF/TEST-NETs, multicast, reserved; IPv6
 * unspecified, loopback, link-local fe80::/10, site-local fec0::/10, ULA
 * fc00::/7, multicast, and every form that EMBEDS an IPv4 address
 * (v4-mapped ::ffff:0:0/96, v4-compatible ::/96, NAT64 64:ff9b::/96) judged by
 * that embedded address.
 */
export function isNonPublicAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  if (net.isIPv4(a)) return v4NonPublic(a);
  if (!net.isIPv6(a)) return true; // not an address at all
  const g = v6Groups(a);
  if (!g) return true;
  const embedded = (): string => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  const zero5 = g.slice(0, 5).every((n) => n === 0);
  if (zero5 && g[5] === 0xffff) return v4NonPublic(embedded()); // ::ffff:a.b.c.d
  if (zero5 && g[5] === 0) return g[6] === 0 && g[7]! <= 1 ? true : v4NonPublic(embedded()); // ::, ::1, ::a.b.c.d
  if (g[0] === 0x2002) return v4NonPublic(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`); // 6to4 2002::/16
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return v4NonPublic(embedded()); // NAT64
  const top = g[0]!;
  return (top & 0xffc0) === 0xfe80 || (top & 0xffc0) === 0xfec0 || (top & 0xfe00) === 0xfc00 || (top & 0xff00) === 0xff00;
}

function hostAllowed(host: string, allow: ReadonlySet<string>): boolean {
  for (const g of allow) {
    if (g === host) return true;
    if (g.startsWith('*.') && host.endsWith(g.slice(1)) && host.length > g.length - 1) return true;
  }
  return false;
}

export interface EgressProxyOptions {
  name: string;
  hosts: ReadonlySet<string>;
  emit: ManifestEventSink;
  dial?: EgressDial;
  /** false while the mod's call in force lacks `network` (the host's per-call effect check) */
  allowNow?: () => boolean;
}

export class EgressProxy {
  readonly #o: EgressProxyOptions;
  readonly #server: net.Server;
  readonly #sockets = new Set<net.Socket>();
  readonly #refused = new WeakSet<net.Socket>();
  #port = 0;
  tunnels = 0;

  constructor(o: EgressProxyOptions) {
    this.#o = o;
    this.#server = net.createServer((s) => this.#serve(s));
    this.#server.maxConnections = EGRESS_LIMITS.maxConnections;
  }

  /** Aegis F2: destroy every connection and tunnel (both ends) — called when the call that may have opened them ends. */
  closeTunnels(): void {
    for (const s of this.#sockets) s.destroy();
    this.#sockets.clear();
  }

  get port(): number {
    return this.#port;
  }

  listen(): Promise<number> {
    return new Promise((res, rej) => {
      this.#server.once('error', rej);
      this.#server.listen(0, '127.0.0.1', () => {
        this.#port = (this.#server.address() as net.AddressInfo).port;
        res(this.#port);
      });
    });
  }

  async close(): Promise<void> {
    for (const s of this.#sockets) s.destroy();
    await new Promise<void>((r) => this.#server.close(() => r()));
  }

  #refuse(s: net.Socket, status: string, host: string, why: string): void {
    // F3: once per connection — stop reading, emit once, answer, then destroy
    if (this.#refused.has(s)) return;
    this.#refused.add(s);
    s.removeAllListeners('data');
    s.pause();
    this.#o.emit('mod.effect.refused', { name: this.#o.name, effect: 'network', host, why });
    s.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => s.destroy());
  }

  #serve(s: net.Socket): void {
    this.#sockets.add(s);
    s.on('close', () => this.#sockets.delete(s));
    s.on('error', () => undefined);
    s.setTimeout(EGRESS_LIMITS.idleMs, () => s.destroy());
    const deadline = setTimeout(() => this.#refuse(s, '408 Request Timeout', '', 'head-timeout'), EGRESS_LIMITS.headMs);
    deadline.unref();
    s.once('close', () => clearTimeout(deadline));
    let head = Buffer.alloc(0);
    const onData = (c: Buffer): void => {
      head = Buffer.concat([head, c]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > MAX_HEAD) this.#refuse(s, '431 Request Header Fields Too Large', '', 'head');
        return;
      }
      clearTimeout(deadline);
      s.off('data', onData);
      s.pause();
      const line = head.subarray(0, head.indexOf('\r\n')).toString('latin1');
      const rest = head.subarray(end + 4);
      void this.#connect(s, line, rest);
    };
    s.on('data', onData);
  }

  async #connect(s: net.Socket, line: string, rest: Buffer): Promise<void> {
    const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line);
    if (!m || m[1] !== 'CONNECT') return this.#refuse(s, '405 Method Not Allowed', m?.[2] ?? '', 'method');
    const target = m[2]!;
    const colon = target.lastIndexOf(':');
    const rawHost = colon > 0 ? target.slice(0, colon) : target;
    const port = colon > 0 ? Number(target.slice(colon + 1)) : NaN;
    if (this.#o.allowNow && !this.#o.allowNow()) return this.#refuse(s, '403 Forbidden', rawHost, 'effect');
    if (!EGRESS_PORTS.has(port)) return this.#refuse(s, '403 Forbidden', rawHost, 'port');
    const verdict = checkEgressHost(rawHost.replace(/^\[|\]$/g, ''));
    if (!verdict.ok) return this.#refuse(s, '403 Forbidden', verdict.host, verdict.why);
    if (!hostAllowed(verdict.host, this.#o.hosts)) return this.#refuse(s, '403 Forbidden', verdict.host, 'ungranted');
    const dial = this.#o.dial ?? defaultDial;
    let address: string;
    try {
      address = await dial.resolve(verdict.host);
    } catch {
      return this.#refuse(s, '502 Bad Gateway', verdict.host, 'unreachable');
    }
    if (isNonPublicAddress(address)) return this.#refuse(s, '403 Forbidden', verdict.host, 'private-address');
    const up = { socket: dial.connect(address, port) };
    if (s.destroyed) {
      up.socket.destroy();
      return;
    }
    this.#sockets.add(up.socket);
    up.socket.setTimeout(EGRESS_LIMITS.idleMs, () => up.socket.destroy());
    s.on('close', () => up.socket.destroy());
    up.socket.on('close', () => this.#sockets.delete(up.socket));
    up.socket.on('error', () => s.destroy());
    const go = (): void => {
      this.tunnels++;
      s.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (rest.length) up.socket.write(rest);
      s.pipe(up.socket);
      up.socket.pipe(s);
      s.resume();
    };
    if (up.socket.connecting) up.socket.once('connect', go);
    else go();
  }
}
