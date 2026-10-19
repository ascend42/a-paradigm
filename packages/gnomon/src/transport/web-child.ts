/**
 * @symbol #web-endpoint
 *
 * The `gnomon-web` transport child (spec §2.1, §11.2 rule 1b, §15.5
 * `transport` profile): HTTP parsing, the RFC 6455 upgrade and framing, and
 * static serving of the PINNED bundle bytes — nothing else. It owns no key,
 * no home and no rule: it forwards `{rid, method, path, headers}` for HTTP and
 * upgrades and `{rid, data}` for text frames over stdout, and writes back only
 * what the kernel tells it on stdin (protocol.ts). Its own answers are the
 * mechanical ones: the RFC 6455 close codes (ws-codec.ts), ping/pong, a
 * 503 if the kernel never answers a request, and a 404 for a static file the
 * kernel named that the hashed bundle does not hold — each with the kernel's
 * rule-6 default headers from the config.
 *
 * Per connection: the inbound frame cap starts at the pre-auth 16 KiB and is
 * raised only by a kernel `limit` record (sent on authentication); unsent
 * bytes above `writeHighWater` are reported as `pressure`, and `drain` only
 * once they are back at or below `writeLowWater` (hysteresis), and
 * a connection whose unsent bytes pass `maxSocketBuffer` (8 MiB) is closed
 * 1008 (backpressure).
 *
 * No socket of its own (§15.5, T-2026-10-18-020): the child opens, binds and
 * listens on nothing — its profile has no network-* rule. The KERNEL listens
 * on 127.0.0.1 and hands each accepted, unread socket over the IPC channel
 * (`io.onSocket`); the child serves it like an accepted connection. Sockets
 * handed before `ready` are destroyed. The bundle is hashed and loaded into
 * memory BEFORE `ready`, and served from that memory, so the bytes served are
 * the bytes hashed (`G-WEB-08`). No token ever reaches this process on argv, env or
 * stdin config; it sees the WebSocket frames it relays and never interprets
 * them (A24-1).
 */
import * as http from 'node:http';
import type { Duplex } from 'node:stream';
import { NdjsonDecoder } from '../kernel/socket/framing.js';
import { hashBundleDir, type HashedBundle } from '../kernel/web/bundle.js';
import {
  CHANNEL_MAX_RECORD_BYTES,
  encodeRecord,
  flattenHeaders,
  type ChildConfig,
  type ChildRecord,
  type HeaderMap,
  type KernelRecord,
} from '../kernel/web/protocol.js';
import { acceptKey, closeFrame, CLOSE_CODES, encodeWsFrame, FrameDecoder, OP } from './ws-codec.js';

/** A request the kernel did not answer in this long is answered 503 by the child. */
export const KERNEL_ANSWER_TIMEOUT_MS = 10_000;
/** A handed socket must deliver complete request headers within this long (slowloris bound, enforced per socket). */
export const HEADERS_TIMEOUT_MS = 10_000;
/** …and a complete request body within this long after its headers. */
export const REQUEST_TIMEOUT_MS = 30_000;

interface WsConn {
  socket: Duplex & { writableLength?: number };
  pressured: boolean;
  decoder: FrameDecoder;
  missed: number;
  timer: NodeJS.Timeout | null;
  reported: boolean;
  closing: boolean;
}

export interface WebChildIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  exit: (code: number) => void;
  /** Registers the receiver of connected sockets the kernel hands over (the IPC channel); the child listens on nothing. */
  onSocket: (accept: (socket: Duplex) => void) => void;
}

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 421: 'Misdirected Request', 426: 'Upgrade Required', 503: 'Service Unavailable' };

export function runWebChild(io: WebChildIo): void {
  const decoder = new NdjsonDecoder(CHANNEL_MAX_RECORD_BYTES);
  let config: ChildConfig | null = null;
  let bundle: HashedBundle | null = null;
  let server: http.Server | null = null;
  let nextRid = 1;
  const pendingHttp = new Map<number, { res: http.ServerResponse; method: string; timer: NodeJS.Timeout }>();
  const pendingUpgrade = new Map<number, { socket: Duplex; head: Buffer; key: string; timer: NodeJS.Timeout }>();
  const ws = new Map<number, WsConn>();
  let ended = false;

  const emit = (r: ChildRecord): void => {
    if (!ended) io.output.write(encodeRecord(r));
  };
  const finish = (code: number): void => {
    if (ended) return;
    for (const c of ws.values()) c.socket.destroy();
    for (const p of pendingUpgrade.values()) p.socket.destroy();
    server?.close();
    ended = true;
    io.exit(code);
  };
  const fatal = (why: string): void => {
    emit({ t: 'fatal', why });
    finish(1);
  };

  const reportClosed = (rid: number, code: number, why: string): void => {
    const c = ws.get(rid);
    if (!c || c.reported) return;
    c.reported = true;
    if (c.timer) clearInterval(c.timer);
    ws.delete(rid);
    emit({ t: 'closed', rid, code, why });
  };
  const closeWs = (rid: number, code: number, why: string): void => {
    const c = ws.get(rid);
    if (!c) return;
    if (!c.closing) {
      c.closing = true;
      c.socket.write(closeFrame(code));
    }
    c.socket.end();
    setTimeout(() => c.socket.destroy(), 1000).unref();
    reportClosed(rid, code, why);
  };

  const rawRefuse = (socket: Duplex, status: number, headers: HeaderMap): void => {
    const lines = [`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}`, 'Content-Length: 0', 'Connection: close'];
    for (const [k, v] of Object.entries({ ...config!.defaultHeaders, ...headers })) lines.push(`${k}: ${v}`);
    socket.end(`${lines.join('\r\n')}\r\n\r\n`);
  };

  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const rid = nextRid++;
    const max = config!.maxBodyBytes;
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true; // stop collecting; the kernel answers 413
        chunks.length = 0;
      } else chunks.push(c);
    });
    req.on('end', () => {
      const timer = setTimeout(() => {
        pendingHttp.delete(rid);
        res.writeHead(503, { ...config!.defaultHeaders, 'content-length': '0' }).end();
      }, config!.answerTimeoutMs ?? KERNEL_ANSWER_TIMEOUT_MS);
      timer.unref();
      pendingHttp.set(rid, { res, method: req.method ?? 'GET', timer });
      const body = chunks.length ? Buffer.concat(chunks).toString('base64') : undefined;
      emit({ t: 'http', rid, method: req.method ?? '', path: req.url ?? '', headers: flattenHeaders(req.headers), ...(body ? { body } : {}), ...(over ? { bodyOver: true } : {}) });
    });
    req.on('error', () => res.destroy());
  };

  const onUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    const rid = nextRid++;
    socket.on('error', () => socket.destroy());
    const timer = setTimeout(() => {
      pendingUpgrade.delete(rid);
      rawRefuse(socket, 503, {});
    }, config!.answerTimeoutMs ?? KERNEL_ANSWER_TIMEOUT_MS);
    timer.unref();
    pendingUpgrade.set(rid, { socket, head: Buffer.from(head), key: String(req.headers['sec-websocket-key'] ?? ''), timer });
    socket.on('close', () => {
      const p = pendingUpgrade.get(rid);
      if (p) {
        clearTimeout(p.timer);
        pendingUpgrade.delete(rid);
      }
    });
    emit({ t: 'upgrade', rid, method: req.method ?? '', path: req.url ?? '', headers: flattenHeaders(req.headers) });
  };

  const accept = (rid: number): void => {
    const p = pendingUpgrade.get(rid);
    if (!p) return;
    clearTimeout(p.timer);
    pendingUpgrade.delete(rid);
    const { socket } = p;
    // No Sec-WebSocket-Extensions and no Sec-WebSocket-Protocol: nothing is negotiated (§4.9).
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(p.key)}\r\n\r\n`);
    const c: WsConn = { socket, pressured: false, decoder: new FrameDecoder(config!.preAuthMaxFrameBytes), missed: 0, timer: null, reported: false, closing: false };
    socket.on('drain', () => {
      if (c.pressured && (socket.writableLength ?? 0) <= Math.min(config!.writeLowWater ?? config!.writeHighWater, config!.writeHighWater)) {
        c.pressured = false;
        emit({ t: 'drain', rid });
      }
    });
    ws.set(rid, c);
    c.timer = setInterval(() => {
      if (c.missed >= config!.missedPongs) return closeWs(rid, CLOSE_CODES.GOING_AWAY, 'missed-pongs');
      c.missed++;
      socket.write(encodeWsFrame(OP.PING));
    }, config!.pingMs);
    c.timer.unref();
    const onData = (chunk: Buffer): void => {
      for (const e of c.decoder.push(chunk)) {
        if (e.kind === 'text') emit({ t: 'frame', rid, data: e.data.toString('base64') });
        else if (e.kind === 'ping') socket.write(encodeWsFrame(OP.PONG, e.data));
        else if (e.kind === 'pong') c.missed = 0;
        else if (e.kind === 'close') {
          if (!c.closing) {
            c.closing = true;
            socket.write(closeFrame(e.code)); // mirrored
          }
          socket.end();
          reportClosed(rid, e.code ?? CLOSE_CODES.NO_STATUS, 'peer-close');
        } else closeWs(rid, e.code, e.why);
      }
    };
    socket.on('data', onData);
    socket.on('close', () => reportClosed(rid, CLOSE_CODES.ABNORMAL, 'socket-closed'));
    // the http server's sockets are half-open capable: a peer FIN must end ours too
    socket.on('end', () => {
      socket.destroy();
      reportClosed(rid, CLOSE_CODES.ABNORMAL, 'peer-ended');
    });
    if (p.head.length) onData(p.head);
  };

  const onKernel = (r: KernelRecord): void => {
    switch (r.t) {
      case 'config':
        return; // only the first record configures
      case 'respond': {
        const h = pendingHttp.get(r.rid);
        if (h) {
          clearTimeout(h.timer);
          pendingHttp.delete(r.rid);
          const body = r.body ? Buffer.from(r.body, 'base64') : Buffer.alloc(0);
          h.res.writeHead(r.status, { ...r.headers, 'content-length': String(body.length) });
          h.res.end(h.method === 'HEAD' ? undefined : body);
          return;
        }
        const u = pendingUpgrade.get(r.rid);
        if (u) {
          clearTimeout(u.timer);
          pendingUpgrade.delete(r.rid);
          rawRefuse(u.socket, r.status, r.headers);
        }
        return;
      }
      case 'static': {
        const h = pendingHttp.get(r.rid);
        if (!h) return;
        clearTimeout(h.timer);
        pendingHttp.delete(r.rid);
        const bytes = bundle!.files.get(r.file);
        if (!bytes) {
          h.res.writeHead(404, { ...config!.defaultHeaders, ...r.headers, 'content-length': '0' }).end();
          return;
        }
        h.res.writeHead(200, { ...r.headers, 'content-length': String(bytes.length) });
        h.res.end(h.method === 'HEAD' ? undefined : bytes);
        return;
      }
      case 'accept':
        return accept(r.rid);
      case 'send': {
        const c = ws.get(r.rid);
        if (!c || c.closing) return;
        c.socket.write(encodeWsFrame(OP.TEXT, Buffer.from(r.data, 'base64')));
        const queued = c.socket.writableLength ?? 0;
        if (queued > config!.maxSocketBuffer) return closeWs(r.rid, CLOSE_CODES.POLICY, 'backpressure');
        if (!c.pressured && queued > config!.writeHighWater) {
          c.pressured = true;
          emit({ t: 'pressure', rid: r.rid, bytes: queued });
        }
        return;
      }
      case 'limit': {
        const c = ws.get(r.rid);
        if (c) c.decoder.setMaxPayload(Math.min(r.maxFrameBytes, config!.maxFrameBytes));
        return;
      }
      case 'close': {
        if (ws.has(r.rid)) return closeWs(r.rid, r.code, 'kernel-close');
        const u = pendingUpgrade.get(r.rid);
        if (u) {
          clearTimeout(u.timer);
          pendingUpgrade.delete(r.rid);
          u.socket.destroy();
        }
        return;
      }
      case 'shutdown':
        return finish(0);
    }
  };

  const start = (cfg: ChildConfig): void => {
    config = cfg;
    try {
      bundle = hashBundleDir(cfg.bundleDir);
    } catch (err) {
      return fatal(`bundle: ${err instanceof Error ? err.message : String(err)}`);
    }
    const s = http.createServer({ maxHeaderSize: 16 * 1024 }, onRequest);
    server = s;
    // Node enforces headersTimeout/requestTimeout only for a server that LISTENED (its connection checker starts on
    // 'listening'); this one never listens, so the same bounds are per-socket deadlines below (slowloris, round 2).
    s.headersTimeout = cfg.headersTimeoutMs ?? HEADERS_TIMEOUT_MS;
    s.requestTimeout = cfg.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    s.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      const sock = req.socket;
      arm(sock, s.requestTimeout); // headers are in: the rest of the request (the body) has its own bound
      req.on('end', () => disarm(sock));
      // keep-alive: the next request's headers are bounded again from the moment this response is written
      res.on('finish', () => {
        if (!sock.destroyed) arm(sock, s.headersTimeout);
      });
    });
    s.on('upgrade', (_req: http.IncomingMessage, socket: Duplex) => disarm(socket)); // the kernel's answer timer and the WS ping take over
    s.on('upgrade', onUpgrade);
    s.on('clientError', (_err, socket) => socket.destroy());
    emit({ t: 'ready', bundleHash: bundle!.hash, files: bundle!.files.size });
  };

  // Per-socket deadline: a handed socket whose request headers are not complete within headersTimeout (or whose
  // body is not complete within requestTimeout) is destroyed.
  const deadlines = new WeakMap<Duplex, NodeJS.Timeout>();
  const disarm = (socket: Duplex): void => {
    const t = deadlines.get(socket);
    if (t) clearTimeout(t);
    deadlines.delete(socket);
  };
  const arm = (socket: Duplex, ms: number): void => {
    disarm(socket);
    const t = setTimeout(() => {
      deadlines.delete(socket);
      socket.destroy();
    }, ms);
    t.unref();
    deadlines.set(socket, t);
  };

  io.onSocket((socket) => {
    // a handed socket is served exactly like an accepted connection; none before ready, none after the end
    if (ended || server === null) return void socket.destroy();
    arm(socket, server.headersTimeout);
    socket.once('close', () => disarm(socket));
    server.emit('connection', socket);
  });

  io.input.on('data', (chunk: Buffer) => {
    for (const item of decoder.push(chunk)) {
      if (item.kind !== 'frame') return fatal(`channel: ${item.kind}`);
      const r = item.value as unknown as KernelRecord;
      if (config === null) {
        if (r.t !== 'config') return fatal('channel: the first record must be config');
        start(r);
      } else onKernel(r);
    }
  });
  io.input.on('end', () => finish(0)); // the kernel went away: so do we
}
