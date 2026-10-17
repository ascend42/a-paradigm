// p11 transport child stand-in: a minimal RFC 6455 server over the node:http
// `upgrade` event, zero deps. Spawned by probe.mjs as a separate process so its
// RSS is the "transport child RSS" of spec §2.1 / §19.1 P11.
//
// Behaviour: echoes text/binary messages; text commands
//   frag:<n>          send "fragmented hello world ✓" as n fragments
//   ping:<payload>    send a ping, and when the pong arrives send "pong:<payload>"
//   close:<code>      start a close handshake with <code>
// Protocol errors close with 1002, invalid UTF-8 with 1007, oversize with 1009.
// IPC: {type:'stats'} -> {rss, maxRSSKiB, heapUsed, external, arrayBuffers}.
import { createHash } from 'node:crypto';
import http from 'node:http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 16 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
// Variant knob: GNOMON_P11_GC_EVERY_MB=<n> (needs --expose-gc) forces a GC after
// every n MB of payload received, to show what bounded external memory costs.
const GC_EVERY = Number(process.env.GNOMON_P11_GC_EVERY_MB || 0) * 1_000_000;
let sinceGc = 0;

function unmask(buf, mask) {
  // 32-bit XOR over an aligned copy; byte loop for the tail.
  let data = buf;
  if (data.byteOffset % 4 !== 0) data = Buffer.from(data);
  const words = data.length >>> 2;
  if (words > 0) {
    const m32 = mask.readUInt32LE(0);
    const view = new Uint32Array(data.buffer, data.byteOffset, words);
    for (let i = 0; i < words; i++) view[i] ^= m32;
  }
  for (let i = words << 2; i < data.length; i++) data[i] ^= mask[i & 3];
  return data;
}

function frameHeader(opcode, len, fin = true) {
  const b0 = (fin ? 0x80 : 0) | opcode;
  if (len < 126) return Buffer.from([b0, len]);
  if (len < 65536) {
    const h = Buffer.alloc(4);
    h[0] = b0;
    h[1] = 126;
    h.writeUInt16BE(len, 2);
    return h;
  }
  const h = Buffer.alloc(10);
  h[0] = b0;
  h[1] = 127;
  h.writeBigUInt64BE(BigInt(len), 2);
  return h;
}

function validCloseCode(code) {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999);
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.chunks = [];
    this.buffered = 0;
    this.frag = null; // {opcode, parts[], size}
    this.cur = null; // frame whose payload is being received
    this.closing = false;
    this.pendingPong = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('error', () => socket.destroy());
  }

  send(opcode, payload, fin = true) {
    if (this.socket.destroyed) return;
    this.socket.cork();
    this.socket.write(frameHeader(opcode, payload.length, fin));
    if (payload.length) this.socket.write(payload);
    this.socket.uncork();
    // Backpressure: stop reading while the peer is not draining our echoes.
    if (this.socket.writableNeedDrain && !this.socket.isPaused()) {
      this.socket.pause();
      this.socket.once('drain', () => this.socket.resume());
    }
  }

  close(code, reason = '') {
    if (this.closing) return;
    this.closing = true;
    const r = Buffer.from(reason);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.send(0x8, p);
    setTimeout(() => this.socket.destroy(), 200).unref();
  }

  fail(code) {
    this.close(code);
    this.chunks = [];
    this.buffered = 0;
    this.cur = null;
  }

  take(n) {
    // Remove n bytes from the chunk queue, concatenating only as needed.
    const first = this.chunks[0];
    let out;
    if (first.length >= n) {
      out = first.subarray(0, n);
      if (first.length === n) this.chunks.shift();
      else this.chunks[0] = first.subarray(n);
    } else {
      out = Buffer.allocUnsafe(n);
      let off = 0;
      while (off < n) {
        const c = this.chunks[0];
        const k = Math.min(c.length, n - off);
        c.copy(out, off, 0, k);
        off += k;
        if (k === c.length) this.chunks.shift();
        else this.chunks[0] = c.subarray(k);
      }
    }
    this.buffered -= n;
    return out;
  }

  peek(n) {
    if (this.chunks[0].length >= n) return this.chunks[0].subarray(0, n);
    const out = this.take(n);
    this.chunks.unshift(out);
    this.buffered += n;
    return out;
  }

  onData(d) {
    if (this.closing) return;
    this.chunks.push(d);
    this.buffered += d.length;
    while (!this.closing) {
      if (this.cur) {
        // Stream payload bytes straight into the preallocated frame buffer:
        // one copy, no chunk-queue retention for large frames.
        const c = this.cur;
        while (c.off < c.len && this.chunks.length) {
          const chunk = this.chunks[0];
          const k = Math.min(chunk.length, c.len - c.off);
          chunk.copy(c.buf, c.off, 0, k);
          c.off += k;
          this.buffered -= k;
          if (k === chunk.length) this.chunks.shift();
          else this.chunks[0] = chunk.subarray(k);
        }
        if (c.off < c.len) return;
        this.cur = null;
        if (GC_EVERY && typeof globalThis.gc === 'function' && (sinceGc += c.len) >= GC_EVERY) {
          sinceGc = 0;
          setImmediate(() => globalThis.gc());
        }
        this.onFrame(c.fin, c.opcode, c.len ? unmask(c.buf, c.mask) : Buffer.alloc(0));
        continue;
      }
      if (this.buffered < 2) return;
      const h = this.peek(2);
      const fin = (h[0] & 0x80) !== 0;
      const rsv = h[0] & 0x70;
      const opcode = h[0] & 0x0f;
      const masked = (h[1] & 0x80) !== 0;
      let len = h[1] & 0x7f;
      if (rsv) return this.fail(1002);
      if (!masked) return this.fail(1002);
      if (![0x0, 0x1, 0x2, 0x8, 0x9, 0xa].includes(opcode)) return this.fail(1002);
      let hdr = 2;
      if (len === 126) hdr = 4;
      else if (len === 127) hdr = 10;
      if (this.buffered < hdr + 4) return;
      const head = this.take(hdr + 4);
      if (len === 126) len = head.readUInt16BE(2);
      else if (len === 127) {
        const big = head.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.fail(1009);
        len = Number(big);
      }
      if (opcode >= 0x8 && (!fin || len > 125)) return this.fail(1002);
      if (len > MAX_MESSAGE) return this.fail(1009);
      // allocUnsafeSlow => own ArrayBuffer at offset 0 (aligned for the 32-bit unmask).
      const buf = len >= 4096 ? Buffer.allocUnsafeSlow(len) : Buffer.allocUnsafe(len);
      this.cur = { fin, opcode, len, mask: Buffer.from(head.subarray(hdr, hdr + 4)), buf, off: 0 };
    }
  }

  onFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      if (payload.length === 1) return this.fail(1002);
      if (payload.length >= 2) {
        const code = payload.readUInt16BE(0);
        if (!validCloseCode(code)) return this.fail(1002);
        try {
          utf8.decode(payload.subarray(2));
        } catch {
          return this.fail(1007);
        }
        return this.close(code, payload.subarray(2).toString());
      }
      return this.close(1000);
    }
    if (opcode === 0x9) return this.send(0xa, payload);
    if (opcode === 0xa) {
      if (this.pendingPong !== null && payload.toString() === this.pendingPong) {
        const p = this.pendingPong;
        this.pendingPong = null;
        this.send(0x1, Buffer.from(`pong:${p}`));
      }
      return;
    }
    if (opcode === 0x0) {
      if (!this.frag) return this.fail(1002);
      this.frag.parts.push(payload);
      this.frag.size += payload.length;
      if (this.frag.size > MAX_MESSAGE) return this.fail(1009);
      if (!fin) return;
      const msg = Buffer.concat(this.frag.parts, this.frag.size);
      const op = this.frag.opcode;
      this.frag = null;
      return this.onMessage(op, msg);
    }
    // 0x1 / 0x2
    if (this.frag) return this.fail(1002);
    if (!fin) {
      this.frag = { opcode, parts: [payload], size: payload.length };
      return;
    }
    this.onMessage(opcode, payload);
  }

  onMessage(opcode, msg) {
    if (opcode === 0x2) return this.send(0x2, msg);
    let text;
    try {
      text = utf8.decode(msg);
    } catch {
      return this.fail(1007);
    }
    if (text.startsWith('frag:')) {
      const n = Math.max(1, Number(text.slice(5)) || 1);
      const body = Buffer.from('fragmented hello world ✓');
      const step = Math.ceil(body.length / n);
      for (let i = 0; i < n; i++) {
        const part = body.subarray(i * step, Math.min(body.length, (i + 1) * step));
        this.send(i === 0 ? 0x1 : 0x0, part, i === n - 1);
      }
      return;
    }
    if (text.startsWith('ping:')) {
      this.pendingPong = text.slice(5);
      return this.send(0x9, Buffer.from(this.pendingPong));
    }
    if (text.startsWith('close:')) return this.close(Number(text.slice(6)), 'server-close');
    this.send(0x1, msg);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('upgrade required');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  new Conn(socket);
});

process.on('message', (m) => {
  if (m?.type === 'stats') {
    const mu = process.memoryUsage();
    process.send({ type: 'stats', rss: mu.rss, heapUsed: mu.heapUsed, external: mu.external, arrayBuffers: mu.arrayBuffers, maxRSSKiB: process.resourceUsage().maxRSS });
  }
});
process.on('disconnect', () => process.exit(0));

server.listen(0, '127.0.0.1', () => process.send({ type: 'listening', port: server.address().port }));
