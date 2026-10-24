/**
 * @symbol #socket
 *
 * #socket (spec §4.9) — length-safe NDJSON framing for `gnomon-rpc:v1`.
 *
 * One JSON object per `\n`-terminated line, at most 4 MiB per frame; a longer
 * line is discarded up to its newline and reported once as `oversize` (the
 * server answers BAD_REQUEST). Buffering is BYTE-based so a multi-byte UTF-8
 * character split across chunks decodes correctly (Warpline's string-concat
 * splitter, server.ts:599, did not). Invalid UTF-8, invalid JSON and any
 * non-object value are `malformed`. Lifted in spirit from
 * packages/warpline/src/daemon/protocol.ts (copied, never imported).
 */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

const NL = 0x0a;
const CR = 0x0d;

export type MalformedReason = 'utf8' | 'json' | 'not-object';

export type DecodedItem =
  | { kind: 'frame'; value: Record<string, unknown> }
  | { kind: 'malformed'; reason: MalformedReason }
  | { kind: 'oversize'; bytes: number }
  | { kind: 'truncated'; bytes: number };

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function decodeLine(line: Buffer): DecodedItem | null {
  let end = line.length;
  if (end > 0 && line[end - 1] === CR) end--;
  const body = line.subarray(0, end);
  let text: string;
  try {
    text = utf8.decode(body);
  } catch {
    return { kind: 'malformed', reason: 'utf8' };
  }
  if (text.trim() === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'malformed', reason: 'json' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'malformed', reason: 'not-object' };
  }
  return { kind: 'frame', value: value as Record<string, unknown> };
}

export class NdjsonDecoder {
  maxFrameBytes: number;
  private pending: Buffer[] = [];
  private pendingLen = 0;
  private discarding = false;
  private discarded = 0;

  constructor(maxFrameBytes: number = MAX_FRAME_BYTES) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1) throw new RangeError('maxFrameBytes must be a positive integer');
    this.maxFrameBytes = maxFrameBytes;
  }

  /** Change the inbound limit (e.g. 16 KiB pre-auth, raised after auth). Applies to the next bytes. */
  setMaxFrameBytes(n: number): void {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('maxFrameBytes must be a positive integer');
    this.maxFrameBytes = n;
  }

  /** Bytes buffered toward the current (incomplete) frame; never exceeds maxFrameBytes. */
  get pendingBytes(): number {
    return this.pendingLen;
  }

  push(chunk: Buffer | Uint8Array): DecodedItem[] {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const out: DecodedItem[] = [];
    let offset = 0;
    while (offset <= buf.length) {
      const idx = buf.indexOf(NL, offset);
      if (idx === -1) {
        const rest = buf.subarray(offset);
        if (rest.length === 0) break;
        if (this.discarding) {
          this.discarded += rest.length;
        } else if (this.pendingLen + rest.length > this.maxFrameBytes) {
          this.discarding = true;
          this.discarded = this.pendingLen + rest.length;
          this.pending = [];
          this.pendingLen = 0;
        } else {
          this.pending.push(Buffer.from(rest)); // copy: never retain the socket's chunk
          this.pendingLen += rest.length;
        }
        break;
      }
      const seg = buf.subarray(offset, idx);
      offset = idx + 1;
      if (this.discarding) {
        out.push({ kind: 'oversize', bytes: this.discarded + seg.length });
        this.discarding = false;
        this.discarded = 0;
        continue;
      }
      const lineLen = this.pendingLen + seg.length;
      if (lineLen > this.maxFrameBytes) {
        this.pending = [];
        this.pendingLen = 0;
        out.push({ kind: 'oversize', bytes: lineLen });
        continue;
      }
      const line = this.pendingLen === 0 ? seg : Buffer.concat([...this.pending, seg], lineLen);
      this.pending = [];
      this.pendingLen = 0;
      const item = decodeLine(line);
      if (item) out.push(item);
    }
    return out;
  }

  /** The stream ended: report an unterminated partial frame, if any. */
  end(): DecodedItem[] {
    const bytes = this.discarding ? this.discarded : this.pendingLen;
    const had = this.discarding || this.pendingLen > 0;
    this.pending = [];
    this.pendingLen = 0;
    this.discarding = false;
    this.discarded = 0;
    return had ? [{ kind: 'truncated', bytes }] : [];
  }
}

/** Encode one frame. JSON.stringify escapes newlines, so a frame is always one line. */
export function encodeFrame(value: unknown, maxFrameBytes: number = MAX_FRAME_BYTES): Buffer {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('frame is not JSON-serialisable');
  const bytes = Buffer.from(`${text}\n`, 'utf8');
  if (bytes.length - 1 > maxFrameBytes) throw new RangeError(`frame of ${bytes.length - 1} bytes exceeds ${maxFrameBytes}`);
  return bytes;
}
