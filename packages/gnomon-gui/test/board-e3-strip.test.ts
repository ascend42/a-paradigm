/**
 * S1.4 E3 items 4 and 5 (design board-leaf.turn_strip.notice, undo-key, said.undo, keep_words 1b): the notice and
 * mark rows as core orders them, and the lines the leaf says.
 */
import { describe, expect, it } from 'vitest';
import { markStripRow, noticeStripRow, rowText, withSlot, type NoticeFacts } from '../src/core/board-turn.js';
import { keepStateLine, UNDO_COPY, undoLine } from '../src/core/board-leaf.js';

const N = (o: Partial<NoticeFacts> = {}): NoticeFacts => ({ key: 'turn:h/1', rev: 2, state: 'standing', changed: 3, removed: 2, otherChanged: 0, otherRemoved: 0, lead: null, at: 0, ...o });
const time = '14:20';

describe('E3 the notice row', () => {
  it('changed and removed counted apart, of your marks, the time; drops the time, then (level 5) " of your marks"; never the name or counts', () => {
    const r = noticeStripRow(N(), 'Claude', { others: [], more: 0, time });
    expect(rowText(r.parts)).toBe('Claude changed 3 · removed 2 of your marks · 14:20');
    expect(rowText(r.parts, 1)).toBe('Claude changed 3 · removed 2 of your marks');
    expect(rowText(r.parts, 4)).toBe('Claude changed 3 · removed 2 of your marks');
    expect(rowText(r.parts, 5)).toBe('Claude changed 3 · removed 2');
    expect(r.keys).toEqual({ right: 'dismiss', undo: 'undo', more: 0 });
    expect(r.title).toBe('Claude changed 3 · removed 2 of your marks · 14:20');
  });
  it('a zero part is left out; the undid lead leads and is never dropped (N3 decides it, not words)', () => {
    expect(rowText(noticeStripRow(N({ changed: 0 }), 'Claude', { others: [], more: 0, time }).parts, 5)).toBe('Claude removed 2');
    expect(rowText(noticeStripRow(N({ changed: 0, removed: 0, lead: 'undid' }), 'Claude', { others: [], more: 0, time }).parts, 5)).toBe('Claude undid your change');
    expect(rowText(noticeStripRow(N({ changed: 0, lead: 'undid' }), 'Claude', { others: [], more: 0, time }).parts)).toBe('Claude undid your change and removed 2 of your marks · 14:20');
    expect(rowText(noticeStripRow(N({ changed: 0, removed: 0, lead: 'put-back' }), 'Claude', { others: [], more: 0, time }).parts, 5)).toBe('Claude put back what you undid');
  });
  it('another agent\'s marks only: "of Mika\'s marks"; more than one hand: "of other hands\' marks"', () => {
    expect(rowText(noticeStripRow(N({ changed: 0, removed: 0, otherChanged: 2 }), 'Claude', { others: ['Mika'], more: 0, time }).parts, 5)).toBe('Claude changed 2 of Mika’s marks');
    expect(rowText(noticeStripRow(N({ changed: 0, removed: 0, otherChanged: 2 }), 'Claude', { others: ['Mika', 'Luna'], more: 0, time }).parts, 5)).toBe('Claude changed 2 of other hands’ marks');
  });
  it('the redo window (R8): "Undone · Claude changed 3 · removed 2", redo in the undo column, the right column empty, no +k', () => {
    const r = noticeStripRow(N({ state: 'done' }), 'Claude', { others: [], more: 2, time });
    expect(rowText(r.parts)).toBe('Undone · Claude changed 3 · removed 2');
    expect(r.keys).toEqual({ right: null, undo: 'redo', more: 0 });
  });
  it('+k is its own column, named "<k> more changes you can undo"', () => {
    const r = noticeStripRow(N(), 'Claude', { others: [], more: 2, time });
    expect(r.keys?.more).toBe(2);
    expect(r.aria?.more).toBe('2 more changes you can undo');
  });
  it('a notice takes the you row\'s slot; the turn row stays', () => {
    const slot = noticeStripRow(N(), 'Claude', { others: [], more: 0, time });
    expect(withSlot([{ kind: 'you', parts: [] }, { kind: 'turn', parts: [] }], slot).map((r) => r.kind)).toEqual(['notice', 'turn']);
    expect(withSlot([{ kind: 'turn', parts: [] }], slot).map((r) => r.kind)).toEqual(['notice', 'turn']);
  });
});

describe('E3 the mark row', () => {
  it('one key in the undo column, the right column empty; put back for a removed mark of yours', () => {
    const c = markStripRow({ key: 'k', rev: 1, id: 'n', name: 'Claude', removed: false, time });
    expect(rowText(c.parts)).toBe('Claude changed this mark · 14:20');
    expect(c.keys).toEqual({ right: null, undo: 'undo', more: 0 });
    const r = markStripRow({ key: 'k', rev: 1, id: 'n', name: 'Claude', removed: true, time });
    expect(rowText(r.parts, 1)).toBe('Claude removed your mark');
    expect(r.keys?.undo).toBe('put back');
  });
});

describe('E3 said.undo and the 1b line', () => {
  const hh = (): string => '14:20';
  it('done, partial, more, expired, nothing, busy, other, redone, pushed out (N2 names hand and time)', () => {
    expect(undoLine({ code: 'undo-done', scope: 'turn' }, 'Claude', hh)).toBe('Undid Claude’s turn');
    expect(undoLine({ code: 'undo-done', scope: 'turn', skipped: { changed: 2, gone: 0, refused: 1 } }, 'Claude', hh)).toBe('Undid Claude’s turn · 2 marks changed since were left as they are, 1 couldn’t be put back');
    expect(undoLine({ code: 'undo-done', scope: 'mark', removed: true }, 'Claude', hh)).toBe('Put back your mark');
    expect(undoLine({ code: 'undo-more' }, 'Claude', hh)).toBe('Undid part of Claude’s turn · undo again for the rest');
    expect(undoLine({ code: 'undo-expired' }, 'Claude', hh)).toBe(UNDO_COPY.expired);
    expect(undoLine({ code: 'undo-nothing' }, 'Claude', hh)).toBe(UNDO_COPY.nothing);
    expect(undoLine({ code: 'undo-busy' }, 'Claude', hh)).toBe(UNDO_COPY.busy);
    expect(undoLine({ code: 'undo-other' }, 'Claude', hh)).toBe(UNDO_COPY.other);
    expect(undoLine({ code: 'redone' }, 'Claude', hh)).toBe('Redone · Claude’s changes are back');
    expect(undoLine({ code: 'pushed-out', at: 1 }, 'Claude', hh)).toBe('An older change of Claude’s from 14:20 can’t be undone in one step now');
    // the person's own ⌘Z that the mod planned says nothing when whole
    expect(undoLine({ code: 'undo-done', scope: 'own' }, 'Claude', hh)).toBeNull();
  });
  it('the 1b line stands over the passing states while attrOff', () => {
    expect(keepStateLine({ keep: 'saving', link: 'up', pending: 1, attrOff: true })).toBe(UNDO_COPY.attrOff);
    expect(keepStateLine({ keep: 'saving', link: 'up', pending: 1, attrOff: false })).toBe('saving…');
  });
});
