import { TEST_CLIENT_NONCE } from './daemon-helpers.js';
/**
 * Raw HTTP / RFC 6455 client helpers for the #web-endpoint tests (spec §11.2,
 * §4.9). Raw sockets on purpose: the tests must send headers a browser would
 * never let a page forge (Host, Origin, Sec-Fetch-Site) and frames no
 * well-behaved client sends (unmasked, fragmented, binary, RSV1).
 */
import * as net from 'node:net';
import { encodeClientFrame, OP } from '../src/transport/ws-codec.js';

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export const ORIGIN = (port: number): string => `http://127.0.0.1:${port}`;
export const GOOD = (port: number): Record<string, string> => ({ Host: `127.0.0.1:${port}`, Origin: ORIGIN(port), 'Sec-Fetch-Site': 'same-origin' });

function parseHead(buf: Buffer): { status: number; headers: Record<string, string>; rest: Buffer } | null {
  const end = buf.indexOf('\r\n\r\n');
  if (end === -1) return null;
  const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
  const status = Number(lines[0]!.split(' ')[1]);
  const headers: Record<string, string> = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':');
    const k = l.slice(0, i).trim().toLowerCase();
    headers[k] = headers[k] ? `${headers[k]}, ${l.slice(i + 1).trim()}` : l.slice(i + 1).trim();
  }
  return { status, headers, rest: buf.subarray(end + 4) };
}

/** One HTTP/1.1 request with exactly these headers (no implicit Host), `Connection: close`. */
export function rawHttp(port: number, method: string, target: string, headers: Record<string, string>, body?: Buffer, host = '127.0.0.1'): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const chunks: Buffer[] = [];
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', reject);
    sock.on('close', () => {
      const head = parseHead(Buffer.concat(chunks));
      if (!head) return reject(new Error('no HTTP response'));
      const len = Number(head.headers['content-length'] ?? head.rest.length);
      resolve({ status: head.status, headers: head.headers, body: head.rest.subarray(0, len) });
    });
    const h = { ...headers, Connection: 'close', ...(body ? { 'Content-Length': String(body.length) } : {}) };
    sock.write(`${method} ${target} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (body) sock.write(body);
  });
}

export interface ServerFrame {
  op: number;
  fin: boolean;
  payload: Buffer;
  closeCode?: number;
}

export interface RawWs {
  status: number;
  headers: Record<string, string>;
  frames: ServerFrame[];
  sendText(s: string): void;
  sendJson(v: unknown): void;
  sendRaw(b: Buffer): void;
  /** Next text frame parsed as JSON (skips pings). */
  nextJson(timeoutMs?: number): Promise<Record<string, unknown>>;
  /** Resolves with the close code the server sent (or 1006 if the socket just ended). */
  closed(timeoutMs?: number): Promise<number>;
  end(): void;
  socket: net.Socket;
}

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

export function wsConnect(port: number, headers: Record<string, string> = GOOD(port), target = '/rpc'): Promise<RawWs> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let closeCode: number | null = null;
    let ended = false;
    const frames: ServerFrame[] = [];
    const waiters: Array<() => void> = [];
    const wake = (): void => {
      for (const w of waiters.splice(0)) w();
    };
    const parseFrames = (): void => {
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0]! & 0x80) !== 0;
        const op = buf[0]! & 0x0f;
        let len = buf[1]! & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = buf.readUInt32BE(6);
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        const f: ServerFrame = { op, fin, payload: Buffer.from(payload) };
        if (op === OP.CLOSE) {
          f.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          closeCode = f.closeCode;
        }
        frames.push(f);
      }
    };
    sock.on('data', (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      if (!upgraded) {
        const head = parseHead(buf);
        if (!head) return;
        upgraded = true;
        buf = head.rest;
        const api: RawWs = {
          status: head.status,
          headers: head.headers,
          frames,
          socket: sock,
          sendText: (s) => sock.write(encodeClientFrame(OP.TEXT, Buffer.from(s, 'utf8'))),
          sendJson: (v) => sock.write(encodeClientFrame(OP.TEXT, Buffer.from(JSON.stringify(v), 'utf8'))),
          sendRaw: (b) => sock.write(b),
          nextJson: (timeoutMs = 5000) =>
            new Promise((res, rej) => {
              const deadline = setTimeout(() => rej(new Error('no frame')), timeoutMs);
              const check = (): void => {
                const i = frames.findIndex((f) => f.op === OP.TEXT);
                if (i !== -1) {
                  clearTimeout(deadline);
                  const [f] = frames.splice(i, 1);
                  return res(JSON.parse(f!.payload.toString('utf8')) as Record<string, unknown>);
                }
                if (closeCode !== null || ended) {
                  clearTimeout(deadline);
                  return rej(new Error(`closed ${closeCode ?? 1006}`));
                }
                waiters.push(check);
              };
              check();
            }),
          closed: (timeoutMs = 8000) =>
            new Promise((res, rej) => {
              const deadline = setTimeout(() => rej(new Error('not closed')), timeoutMs);
              const check = (): void => {
                if (closeCode !== null || ended) {
                  clearTimeout(deadline);
                  return res(closeCode ?? 1006);
                }
                waiters.push(check);
              };
              check();
            }),
          end: () => sock.destroy(),
        };
        resolve(api);
      }
      parseFrames();
      wake();
    });
    sock.on('close', () => {
      ended = true;
      if (!upgraded) {
        const head = parseHead(buf);
        if (head) {
          upgraded = true;
          resolve({ status: head.status, headers: head.headers, frames, socket: sock, sendText: () => undefined, sendJson: () => undefined, sendRaw: () => undefined, nextJson: () => Promise.reject(new Error('refused')), closed: () => Promise.resolve(1006), end: () => undefined });
        } else reject(new Error('connection closed before a response'));
      }
      wake();
    });
    sock.on('error', () => undefined);
    const h = { ...headers, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': KEY, 'Sec-WebSocket-Version': '13' };
    sock.write(`GET ${target} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
  });
}

export const rpc = (id: number, method: string, params?: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id, method, ...(params !== undefined ? { params } : {}) });
export const HELLO = (surface = 'browser'): Record<string, unknown> => ({ clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: TEST_CLIENT_NONCE, client: { name: 'gnomon-gui-test', version: '0.0.0', surface } });
