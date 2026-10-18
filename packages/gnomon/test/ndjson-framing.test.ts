/**
 * #socket framing (spec §4.9): one JSON object per line, ≤ 4 MiB per frame,
 * a longer line discarded to its newline and reported once, malformed lines
 * refused, partial lines buffered by BYTES (UTF-8 safe across chunk splits).
 */
import { describe, expect, it } from 'vitest';
import { decodeLine, encodeFrame, MAX_FRAME_BYTES, NdjsonDecoder } from '../src/kernel/socket/framing.js';
import { isRefusalV1 } from '@a-company/gnomon-contracts';
import { errorFrame, parseRequest, refusalWith, RPC_ERROR_CODES } from '../src/kernel/socket/rpc.js';

const b = (s: string) => Buffer.from(s, 'utf8');

describe('NdjsonDecoder', () => {
  it('defaults to the §4.9 4 MiB limit', () => {
    expect(MAX_FRAME_BYTES).toBe(4 * 1024 * 1024);
    expect(new NdjsonDecoder().maxFrameBytes).toBe(MAX_FRAME_BYTES);
  });

  it('decodes several frames in one chunk and skips blank lines', () => {
    const d = new NdjsonDecoder();
    expect(d.push(b('{"a":1}\n\n  \n{"b":2}\n'))).toEqual([
      { kind: 'frame', value: { a: 1 } },
      { kind: 'frame', value: { b: 2 } },
    ]);
  });

  it('buffers a partial line until its newline (byte-by-byte)', () => {
    const d = new NdjsonDecoder();
    const bytes = b('{"hello":"world","n":[1,2,3]}\n');
    const items = [];
    for (let i = 0; i < bytes.length; i++) items.push(...d.push(bytes.subarray(i, i + 1)));
    expect(items).toEqual([{ kind: 'frame', value: { hello: 'world', n: [1, 2, 3] } }]);
    expect(d.pendingBytes).toBe(0);
  });

  it('decodes a multi-byte UTF-8 character split across chunks', () => {
    const d = new NdjsonDecoder();
    const bytes = b('{"s":"gnomon ☀ 日時計"}\n');
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte sun
    expect(d.push(bytes.subarray(0, cut))).toEqual([]);
    expect(d.push(bytes.subarray(cut))).toEqual([{ kind: 'frame', value: { s: 'gnomon ☀ 日時計' } }]);
  });

  it('accepts CRLF line endings', () => {
    expect(new NdjsonDecoder().push(b('{"a":1}\r\n'))).toEqual([{ kind: 'frame', value: { a: 1 } }]);
  });

  it('refuses malformed lines and keeps going', () => {
    const d = new NdjsonDecoder();
    expect(d.push(b('{nope\n[1,2]\n42\nnull\n"s"\n{"ok":true}\n'))).toEqual([
      { kind: 'malformed', reason: 'json' },
      { kind: 'malformed', reason: 'not-object' },
      { kind: 'malformed', reason: 'not-object' },
      { kind: 'malformed', reason: 'not-object' },
      { kind: 'malformed', reason: 'not-object' },
      { kind: 'frame', value: { ok: true } },
    ]);
  });

  it('refuses invalid UTF-8', () => {
    const d = new NdjsonDecoder();
    expect(d.push(Buffer.concat([b('{"a":"'), Buffer.from([0xff, 0xfe]), b('"}\n')]))).toEqual([
      { kind: 'malformed', reason: 'utf8' },
    ]);
  });

  it('accepts a frame of exactly maxFrameBytes and refuses one byte more', () => {
    const max = 32;
    const exact = `{"p":"${'x'.repeat(max - 8)}"}`;
    expect(Buffer.byteLength(exact)).toBe(max);
    const d = new NdjsonDecoder(max);
    expect(d.push(b(`${exact}\n`))).toEqual([{ kind: 'frame', value: { p: 'x'.repeat(max - 8) } }]);
    const over = `{"p":"${'x'.repeat(max - 7)}"}`;
    expect(d.push(b(`${over}\n`))).toEqual([{ kind: 'oversize', bytes: max + 1 }]);
  });

  it('discards an oversize line spanning many chunks to its newline, reports it once, then recovers', () => {
    const max = 64;
    const d = new NdjsonDecoder(max);
    const items = [];
    items.push(...d.push(b('{"big":"')));
    for (let i = 0; i < 20; i++) {
      items.push(...d.push(b('y'.repeat(50))));
      expect(d.pendingBytes).toBeLessThanOrEqual(max); // never buffers past the limit
    }
    items.push(...d.push(b('"}\n{"next":1}\n')));
    expect(items).toEqual([
      { kind: 'oversize', bytes: 8 + 1000 + 2 },
      { kind: 'frame', value: { next: 1 } },
    ]);
  });

  it('end() reports an unterminated partial frame', () => {
    const d = new NdjsonDecoder();
    d.push(b('{"half":'));
    expect(d.end()).toEqual([{ kind: 'truncated', bytes: 8 }]);
    expect(d.end()).toEqual([]);
  });

  it('rejects a non-positive limit', () => {
    expect(() => new NdjsonDecoder(0)).toThrow(RangeError);
  });
});

describe('encodeFrame', () => {
  it('escapes embedded newlines so one frame is one line', () => {
    const buf = encodeFrame({ s: 'a\nb' });
    expect(buf.indexOf(0x0a)).toBe(buf.length - 1);
    expect(decodeLine(buf.subarray(0, -1))).toEqual({ kind: 'frame', value: { s: 'a\nb' } });
  });

  it('refuses a frame over the limit', () => {
    expect(() => encodeFrame({ s: 'x'.repeat(100) }, 50)).toThrow(RangeError);
  });
});

describe('gnomon-rpc:v1 request validation (refusal:v1 in error.data, M1.4)', () => {
  it('requires jsonrpc 2.0, the rpc tag and a method', () => {
    expect(parseRequest({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'hello' }).ok).toBe(true);
    const noTag = parseRequest({ jsonrpc: '2.0', id: 7, method: 'hello' });
    expect(noTag).toMatchObject({ ok: false, id: 7, refusal: { schemaVersion: 'refusal:v1', code: 'BAD_REQUEST', data: { reason: 'rpc-tag' } } });
    expect(parseRequest({ rpc: 'gnomon-rpc:v1', method: 'x' })).toMatchObject({ ok: false, refusal: { data: { reason: 'jsonrpc-version' } } });
    expect(parseRequest({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: {}, method: 'x' })).toMatchObject({
      ok: false,
      id: null,
      refusal: { data: { reason: 'request-id' } },
    });
    expect(parseRequest({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: '' })).toMatchObject({ ok: false, refusal: { data: { reason: 'method-missing' } } });
  });

  it('maps refusal codes onto the §4.9 code map and carries refusal:v1', () => {
    expect(RPC_ERROR_CODES).toMatchObject({ AUTH: -32001, FORBIDDEN: -32002, BAD_REQUEST: -32600, UNKNOWN_VERB: -32601, ENGINE: -32000, UNSUPPORTED: -32005 });
    const f = errorFrame(3, refusalWith('BAD_REQUEST', 'r', 'm'));
    expect(f).toMatchObject({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 3, error: { code: -32600, message: 'm', data: { schemaVersion: 'refusal:v1', code: 'BAD_REQUEST', data: { reason: 'r' } } } });
    expect(isRefusalV1(f.error.data, { mode: 'tolerant' })).toBe(true);
  });
});
