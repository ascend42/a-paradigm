/**
 * S1.4 P5 C2b (Aegis ruling 3; T-2026-11-26-003 stays open at medium): the bound that keeps a mod's `log.read`
 * reply under the 4 MiB frame, pinned. A page stops once its rows reach PAGE_MAX_BYTES (2 MiB) and may then hold
 * one more row; a row over ROW_MAX_BYTES (1 MiB) is an `oversize` stub. Row size is measured on the row's JSON, so
 * characters the frame escapes are already counted. The worst page, through the real readOnePage: rows up to the
 * 2 MiB stop, then one row just under 1 MiB, every string full of characters JSON escapes. encodeFrame of the
 * reply does not throw.
 */
import { describe, expect, it } from 'vitest';
import { encodeFrame, MAX_FRAME_BYTES } from '../src/kernel/socket/framing.js';
import { PAGE_MAX_BYTES, readOnePage, ROW_MAX_BYTES } from '../src/kernel/socket/log-read.js';

// each of these is written as an escape by JSON.stringify: 2 to 6 bytes for one character
const NASTY = '"\\\u0001\u001b\b\f\n\r\t\u0000\u007f';
const rowOf = (seq: number, chars: number) => ({ seq, view: 'full', event: { kind: 'modns.gnomon.dimension.op', principal: 'p:abcdefgh/mod-gnomon.dimension', seq, payload: { dim: 'dim:x', blob: NASTY.repeat(Math.ceil(chars / NASTY.length)).slice(0, chars) } } });
const bytesOf = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));

describe('a worst-case log.read page fits the 4 MiB frame (Aegis ruling 3)', () => {
  it('rows to the 2 MiB stop, then one row just under 1 MiB, all escape-heavy: encodeFrame of the reply does not throw', () => {
    // fill to just below the stop with ~64 KiB rows, then the one big row the page still takes
    const rows: unknown[] = [];
    let total = 0;
    let seq = 0;
    while (total < PAGE_MAX_BYTES - 70_000) {
      const r = rowOf(++seq, 10_000); // ~10k escape chars ≈ 64 KiB of JSON
      rows.push(r);
      total += bytesOf(r);
    }
    // the last small row that crosses nothing, then the row that makes the page stop: just under 1 MiB
    let chars = 150_000;
    let big = rowOf(++seq, chars);
    while (bytesOf(big) < ROW_MAX_BYTES - 4_096) big = rowOf(seq, (chars += 4_000));
    while (bytesOf(big) > ROW_MAX_BYTES) big = rowOf(seq, (chars -= 100));
    rows.push(big);
    const all = [...rows, rowOf(++seq, 10_000)]; // one after the stop: never taken
    const log = {
      logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ',
      releasedHead: () => seq,
      readPage: (o: { visit: (v: unknown) => boolean }) => {
        let last = 0;
        for (const r of all) {
          last = (r as { seq: number }).seq;
          if (!o.visit(r)) break;
        }
        return { lastScanned: last, caughtUp: false };
      },
    };
    const page = readOnePage(log as never, { reader: { class: 'mod' } } as never, { since: 0, limit: 1000 } as never) as { rows: Array<{ view: string }> };
    expect(page.rows.length).toBe(rows.length); // the stop took the big row and nothing after it
    expect(page.rows.every((r) => r.view !== 'oversize')).toBe(true);
    const frame = encodeFrame({ jsonrpc: '2.0', id: 'call-1', result: page });
    expect(frame.length).toBeLessThan(MAX_FRAME_BYTES);
    expect(frame.length).toBeGreaterThan(PAGE_MAX_BYTES + ROW_MAX_BYTES - 200_000); // it really is the worst case
  });
});
