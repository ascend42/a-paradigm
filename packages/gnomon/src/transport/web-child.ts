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
 * bytes above `writeHighWater` are reported as `pressure` (then `drain`), and
 * a connection whose unsent bytes pass `maxSocketBuffer` (8 MiB) is closed
 * 1008 (backpressure).
 *
 * Bind: 127.0.0.1 only (an IPv4 literal; no option widens it, §11.2 rule 1),
 * the OS-chosen ephemeral port unless the kernel asks for the previous port
 * after a restart. The bundle is hashed and loaded into memory BEFORE the
 * listen, and served from that memory, so the bytes served are the bytes
 * hashed (`G-WEB-08`). No token ever reaches this process on argv, env or
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
      if (c.pressured && (socket.writableLength ?? 0) <= config!.writeHighWater) {
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
    s.headersTimeout = 10_000;
    s.requestTimeout = 30_000;
    s.on('upgrade', onUpgrade);
    s.on('clientError', (_err, socket) => socket.destroy());
    const listen = (port: number): void => {
      s.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port !== 0) return listen(0); // previous port taken: a new ephemeral one
        fatal(`listen: ${err.code ?? err.message}`);
      });
      s.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        const a = s.address();
        if (a === null || typeof a === 'string' || a.address !== '127.0.0.1') return fatal('listen: not bound to 127.0.0.1');
        emit({ t: 'ready', port: a.port, bundleHash: bundle!.hash, files: bundle!.files.size });
      });
    };
    listen(cfg.port);
  };

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
