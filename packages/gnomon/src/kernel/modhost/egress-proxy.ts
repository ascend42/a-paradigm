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
 *     (`effect`; the host serializes calls, so "in force" is exact);
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

export type EgressDial = (host: string, port: number) => Promise<{ socket: net.Socket; address: string }>;

/** Default dialer: resolve once, connect to the resolved address (no second lookup to race). */
export const defaultDial: EgressDial = async (host, port) => {
  const { address } = await dns.promises.lookup(host);
  return { socket: net.connect({ host: address, port }), address };
};

/** Loopback, private, link-local, CGNAT, multicast or unspecified (IPv4 / IPv6, incl. v4-mapped). */
export function isNonPublicAddress(addr: string): boolean {
  let a = addr.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1]!;
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number) as [number, number];
    return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224;
  }
  if (net.isIPv6(a)) return a === '::' || a === '::1' || a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('ff');
  return true; // not an address at all: fail closed
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
  #port = 0;
  tunnels = 0;

  constructor(o: EgressProxyOptions) {
    this.#o = o;
    this.#server = net.createServer((s) => this.#serve(s));
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
    this.#o.emit('mod.effect.refused', { name: this.#o.name, effect: 'network', host, why });
    s.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  #serve(s: net.Socket): void {
    this.#sockets.add(s);
    s.on('close', () => this.#sockets.delete(s));
    s.on('error', () => undefined);
    let head = Buffer.alloc(0);
    const onData = (c: Buffer): void => {
      head = Buffer.concat([head, c]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > MAX_HEAD) this.#refuse(s, '431 Request Header Fields Too Large', '', 'head');
        return;
      }
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
    let up: { socket: net.Socket; address: string };
    try {
      up = await (this.#o.dial ?? defaultDial)(verdict.host, port);
    } catch {
      return this.#refuse(s, '502 Bad Gateway', verdict.host, 'unreachable');
    }
    if (isNonPublicAddress(up.address)) {
      up.socket.destroy();
      return this.#refuse(s, '403 Forbidden', verdict.host, 'private-address');
    }
    this.#sockets.add(up.socket);
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
