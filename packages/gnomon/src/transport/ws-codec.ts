/**
 * @symbol #web-endpoint
 *
 * RFC 6455 server framing for the `gnomon-web` transport child (spec §4.9
 * "RFC 6455 as implemented", `G-WEB-07`; probe p11-ws-framing). Zero deps:
 * Node 24 ships a WebSocket client, not a server.
 *
 * As implemented (the refusals are the child's only own answers, A24-1):
 *   - text frames only: a binary frame ⇒ close 1003;
 *   - no fragmentation: FIN=0 or a continuation opcode ⇒ close 1009;
 *   - no extensions are ever negotiated, so any RSV bit (a compressed frame) ⇒ 1002;
 *   - client frames must be masked ⇒ 1002 otherwise;
 *   - reserved opcodes, a control frame over 125 bytes or fragmented, a 64-bit
 *     length with the top bit set, a 1-byte close payload or an invalid close
 *     code ⇒ 1002 (p11 cases 2.5, 3.1, 4.1, 5.1, 7.3, 7.9);
 *   - invalid UTF-8 in a text frame or a close reason ⇒ 1007 (p11 6.3, 7.5);
 *   - a payload over the cap (4 MiB) ⇒ 1009, refused from the header before
 *     any payload is buffered;
 *   - a close is answered with the mirrored code (p11 7.1, 7.7).
 * After a failure or a close the decoder ignores every further byte.
 */
import { createHash } from 'node:crypto';

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OP = Object.freeze({ CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa });

export const CLOSE_CODES = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL: 1002,
  UNSUPPORTED_DATA: 1003,
  NO_STATUS: 1005,
  ABNORMAL: 1006,
  INVALID_PAYLOAD: 1007,
  POLICY: 1008,
  TOO_BIG: 1009,
  TRY_AGAIN_LATER: 1013,
});

export type WsEvent =
  | { kind: 'text'; data: Buffer }
  | { kind: 'ping'; data: Buffer }
  | { kind: 'pong'; data: Buffer }
  | { kind: 'close'; code: number | null; reason: Buffer }
  | { kind: 'fail'; code: number; why: string };

/** A close code a peer may send (RFC 6455 §7.4; 1004–1006 and 1015 are never on the wire). */
export function validCloseCode(c: number): boolean {
  return (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) || (c >= 3000 && c <= 4999);
}

/** Sec-WebSocket-Accept for a client key. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
function isUtf8(b: Buffer): boolean {
  try {
    utf8.decode(b);
    return true;
  } catch {
    return false;
  }
}

interface FrameHead {
  op: number;
  /** Header bytes incl. the mask key. */
  off: number;
  len: number;
}

/**
 * Incremental decoder. Chunks are kept in a list and concatenated ONCE per
 * frame, when the whole frame is present (no O(n²) re-concatenation of a
 * large frame arriving in many chunks); the ≤ 14 header bytes are peeked.
 */
export class FrameDecoder {
  #chunks: Buffer[] = [];
  #len = 0;
  #head: FrameHead | null = null;
  #done = false;
  #max: number;
  constructor(maxPayload: number) {
    this.#max = maxPayload;
  }

  get done(): boolean {
    return this.#done;
  }

  get maxPayload(): number {
    return this.#max;
  }

  /** Change the payload cap for the frames that follow (16 KiB pre-auth, raised on authentication). */
  setMaxPayload(n: number): void {
    this.#max = n;
  }

  #peek(n: number): Buffer {
    if (this.#chunks[0]!.length >= n) return this.#chunks[0]!;
    const parts: Buffer[] = [];
    let got = 0;
    for (const c of this.#chunks) {
      parts.push(c);
      got += c.length;
      if (got >= n) break;
    }
    return Buffer.concat(parts, got);
  }

  #take(n: number): Buffer {
    const parts: Buffer[] = [];
    let got = 0;
    while (got < n) {
      const c = this.#chunks[0]!;
      const want = n - got;
      if (c.length <= want) {
        parts.push(c);
        got += c.length;
        this.#chunks.shift();
      } else {
        parts.push(c.subarray(0, want));
        this.#chunks[0] = c.subarray(want);
        got += want;
      }
    }
    this.#len -= n;
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts, n);
  }

  /** Parse (and validate) the next frame header; null = need more bytes; a fail event = refused. */
  #parseHead(): FrameHead | WsEvent | null {
    const b = this.#peek(Math.min(this.#len, 14));
    if (b.length < 2) return null;
    const fin = (b[0]! & 0x80) !== 0;
    const rsv = b[0]! & 0x70;
    const op = b[0]! & 0x0f;
    const masked = (b[1]! & 0x80) !== 0;
    const len7 = b[1]! & 0x7f;
    const fail = (code: number, why: string): WsEvent => ({ kind: 'fail', code, why });
    if (rsv !== 0) return fail(CLOSE_CODES.PROTOCOL, 'rsv-bits'); // no extension is negotiated (permessage-deflate refused)
    const control = op >= 0x8;
    if (!([OP.CONT, OP.TEXT, OP.BINARY, OP.CLOSE, OP.PING, OP.PONG] as number[]).includes(op)) return fail(CLOSE_CODES.PROTOCOL, 'reserved-opcode');
    if (control && (!fin || len7 > 125)) return fail(CLOSE_CODES.PROTOCOL, 'bad-control-frame');
    if (op === OP.BINARY) return fail(CLOSE_CODES.UNSUPPORTED_DATA, 'binary-frame');
    if (op === OP.CONT || (op === OP.TEXT && !fin)) return fail(CLOSE_CODES.TOO_BIG, 'fragmented');
    if (!masked) return fail(CLOSE_CODES.PROTOCOL, 'unmasked');
    let off = 2;
    let len = len7;
    if (len7 === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len7 === 127) {
      if (b.length < 10) return null;
      const hi = b.readUInt32BE(2);
      if (hi & 0x80000000) return fail(CLOSE_CODES.PROTOCOL, 'length-msb');
      if (hi !== 0) return fail(CLOSE_CODES.TOO_BIG, 'oversize');
      len = b.readUInt32BE(6);
      off = 10;
    }
    if (len > this.#max) return fail(CLOSE_CODES.TOO_BIG, 'oversize');
    return { op, off: off + 4, len };
  }

  push(chunk: Buffer): WsEvent[] {
    if (this.#done) return [];
    if (chunk.length) {
      this.#chunks.push(Buffer.from(chunk));
      this.#len += chunk.length;
    }
    const out: WsEvent[] = [];
    const fail = (code: number, why: string): WsEvent[] => {
      this.#done = true;
      this.#chunks = [];
      this.#len = 0;
      out.push({ kind: 'fail', code, why });
      return out;
    };
    for (;;) {
      if (!this.#head) {
        if (this.#len < 2) return out;
        const h = this.#parseHead();
        if (h === null) return out;
        if ('kind' in h) {
          const f = h as Extract<WsEvent, { kind: 'fail' }>;
          return fail(f.code, f.why);
        }
        this.#head = h;
      }
      const { op, off, len } = this.#head;
      if (this.#len < off + len) return out;
      const frame = this.#take(off + len);
      this.#head = null;
      const mask = frame.subarray(off - 4, off);
      const payload = Buffer.from(frame.subarray(off, off + len));
      for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
      if (op === OP.TEXT) {
        if (!isUtf8(payload)) return fail(CLOSE_CODES.INVALID_PAYLOAD, 'invalid-utf8');
        out.push({ kind: 'text', data: payload });
      } else if (op === OP.PING) out.push({ kind: 'ping', data: payload });
      else if (op === OP.PONG) out.push({ kind: 'pong', data: payload });
      else {
        // close
        if (payload.length === 1) return fail(CLOSE_CODES.PROTOCOL, 'close-payload');
        if (payload.length === 0) {
          this.#done = true;
          out.push({ kind: 'close', code: null, reason: Buffer.alloc(0) });
          return out;
        }
        const code = payload.readUInt16BE(0);
        if (!validCloseCode(code)) return fail(CLOSE_CODES.PROTOCOL, 'close-code');
        const reason = payload.subarray(2);
        if (!isUtf8(reason)) return fail(CLOSE_CODES.INVALID_PAYLOAD, 'close-reason-utf8');
        this.#done = true;
        out.push({ kind: 'close', code, reason });
        return out;
      }
    }
  }
}

/** One unmasked server frame, FIN set (the server never fragments). */
export function encodeWsFrame(op: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const n = payload.length;
  let head: Buffer;
  if (n < 126) {
    head = Buffer.from([0x80 | op, n]);
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | op;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 127;
    head.writeUInt32BE(Math.floor(n / 2 ** 32), 2);
    head.writeUInt32BE(n >>> 0, 6);
  }
  return Buffer.concat([head, payload]);
}

/** A close frame payload: the 2-byte code, or nothing for "no status". */
export function closeFrame(code: number | null): Buffer {
  if (code === null) return encodeWsFrame(OP.CLOSE);
  const p = Buffer.alloc(2);
  p.writeUInt16BE(code, 0);
  return encodeWsFrame(OP.CLOSE, p);
}

/** A masked CLIENT frame (tests and raw clients only; the server never masks). */
export function encodeClientFrame(op: number, payload: Buffer, opts: { fin?: boolean; rsv?: number; mask?: boolean; len?: number } = {}): Buffer {
  const fin = opts.fin ?? true;
  const masked = opts.mask ?? true;
  const n = opts.len ?? payload.length;
  const b0 = (fin ? 0x80 : 0) | ((opts.rsv ?? 0) << 4) | op;
  let head: Buffer;
  if (n < 126) head = Buffer.from([b0, (masked ? 0x80 : 0) | n]);
  else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = b0;
    head[1] = (masked ? 0x80 : 0) | 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = b0;
    head[1] = (masked ? 0x80 : 0) | 127;
    head.writeUInt32BE(Math.floor(n / 2 ** 32), 2);
    head.writeUInt32BE(n >>> 0, 6);
  }
  if (!masked) return Buffer.concat([head, payload]);
  const key = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i]! ^= key[i & 3]!;
  return Buffer.concat([head, key, body]);
}
