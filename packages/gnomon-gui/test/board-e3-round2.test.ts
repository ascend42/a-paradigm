/** S1.4 E3 round 2 item 4: the word steps, the rotated countermark and the cut-out hit rules (pure). */
import { describe, expect, it } from 'vitest';
import type { BoardMarkView, BoardView } from '../src/core/board.js';
import { COUNTER, countermarkPoint, cutoutAt, markBox } from '../src/core/board-overlay.js';
import { markStripRow, noticeStripRow, rowText, type NoticeFacts } from '../src/core/board-turn.js';

const N = (o: Partial<NoticeFacts> = {}): NoticeFacts => ({ key: 'k', rev: 1, state: 'standing', changed: 3, removed: 0, otherChanged: 0, otherRemoved: 0, lead: null, at: 0, ...o });
const V: BoardView = { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 };
const mark = (o: Partial<BoardMarkView> & { id: string }): BoardMarkView => ({ node: o.id, kind: 'rect', x: 100, y: 100, width: 100, height: 50, firstX: 100, firstY: 100, author: { cls: 'human' }, line: 'ink', fill: null, selected: false, ...o });

describe('E3 round 2 word steps', () => {
  it('the mark row: the time goes, then " this mark" gives way to " it"; "Claude changed it" is never dropped', () => {
    const r = markStripRow({ key: 'k', rev: 1, id: 'n', name: 'Claude', removed: false, time: '14:20' });
    expect(rowText(r.parts)).toBe('Claude changed this mark · 14:20');
    expect(rowText(r.parts, 1)).toBe('Claude changed this mark');
    expect(rowText(r.parts, 2)).toBe('Claude changed it');
    expect(r.title).toBe('Claude changed this mark · 14:20');
  });
  it('the notice ladder: time, the session\'s name, " before it was stopped" to " before stopped", then " of your marks"', () => {
    const r = noticeStripRow(N({ stopped: true }), 'Claude', { others: [], more: 0, time: '14:20', session: 'billing-ui' });
    expect(rowText(r.parts)).toBe('Claude in billing-ui changed 3 of your marks before it was stopped · 14:20');
    expect(rowText(r.parts, 1)).toBe('Claude in billing-ui changed 3 of your marks before it was stopped');
    expect(rowText(r.parts, 2)).toBe('Claude changed 3 of your marks before it was stopped');
    expect(rowText(r.parts, 3)).toBe('Claude changed 3 of your marks before stopped');
    expect(rowText(r.parts, 4)).toBe('Claude changed 3 before stopped');
    expect(r.title).toBe('Claude in billing-ui changed 3 of your marks before it was stopped · 14:20');
  });
});

describe('E3 round 2 the rotated countermark', () => {
  it('turns with the mark about its centre (the engine turns its handles so)', () => {
    const plain = countermarkPoint(mark({ id: 'a' }), V);
    const b = markBox(V, mark({ id: 'a' }));
    expect(plain).toEqual({ left: b.left + b.width - COUNTER.dx, top: b.top + b.height + COUNTER.dy });
    const turned = countermarkPoint(mark({ id: 'a', angle: Math.PI }), V);
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    expect(turned.left).toBeCloseTo(2 * cx - plain.left, 6);
    expect(turned.top).toBeCloseTo(2 * cy - plain.top, 6);
  });
});

describe('E3 round 2 cut-out hit rules (R7)', () => {
  const cutouts = [{ node: 'gone', x: 300, y: 300, width: 80, height: 40 }];
  const at = { x: 320, y: 320 };
  it('a still click with Select where no mark lies selects the cut-out', () => {
    expect(cutoutAt(at, { still: true, tool: 'select', marks: [], view: V, cutouts })).toBe('gone');
  });
  it('a marquee (a press that moved), another tool, or a mark now lying there: the engine\'s, never the cut-out', () => {
    expect(cutoutAt(at, { still: false, tool: 'select', marks: [], view: V, cutouts })).toBeNull();
    expect(cutoutAt(at, { still: true, tool: 'rect', marks: [], view: V, cutouts })).toBeNull();
    expect(cutoutAt(at, { still: true, tool: 'select', marks: [mark({ id: 'm', x: 310, y: 310, width: 30, height: 30 })], view: V, cutouts })).toBeNull();
  });
});

describe('E3 review D4 (Mika): the +k and undo keys\' names', () => {
  it('"1 more change" when k is 1; the undo key\'s name carries the undid lead', () => {
    expect(noticeStripRow(N(), 'Claude', { others: [], more: 1, time: '10:07' }).aria?.more).toBe('1 more change you can undo');
    expect(noticeStripRow(N(), 'Claude', { others: [], more: 2, time: '10:07' }).aria?.more).toBe('2 more changes you can undo');
    expect(noticeStripRow(N({ lead: 'undid', changed: 1 }), 'Claude', { others: [], more: 0, time: '10:07' }).aria?.undo).toBe('Undo Claude’s turn of 10:07 · it undid your change and changed 1 of your marks');
    expect(noticeStripRow(N({ lead: 'undid', changed: 0 }), 'Claude', { others: [], more: 0, time: '10:07' }).aria?.undo).toBe('Undo Claude’s turn of 10:07 · it undid your change');
  });
});
