/**
 * The host layer's arithmetic (design components pin, author-seal, fallback-node; boards S1.1 pass B): where a pin,
 * a seal, an agent text's box and a stub's words go on the screen for a given viewport, and who is in the foot.
 */
import { describe, expect, it } from 'vitest';
import type { BoardAuthor, BoardMarkView, BoardView } from '../src/core/board.js';
import { footHands, handName, handOf, isScrap, markBox, overlayItems, TEXTBOX_PAD, TEXTBOX_TOP, toScreen } from '../src/core/board-overlay.js';
import { sealOf } from '../src/core/board-seal.js';

const VIEW: BoardView = { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 };
const YOU: BoardAuthor = { cls: 'human' };
const ARKY: BoardAuthor = { cls: 'agent', id: 'arky', name: 'Arky' };
const NOBODY: BoardAuthor = { cls: 'unknown' };
const mark = (o: Partial<BoardMarkView> & { id: string; kind: BoardMarkView['kind'] }): BoardMarkView => ({ x: 100, y: 50, width: 120, height: 80, firstX: 100, firstY: 50, author: YOU, line: 'ink', fill: null, selected: false, ...o });

describe('#gui-board overlay transform', () => {
  it('screen = (scene + scroll) × zoom', () => {
    expect(toScreen(VIEW, 100, 50)).toEqual({ left: 100, top: 50 });
    expect(toScreen({ ...VIEW, scrollX: -40, scrollY: 25 }, 100, 50)).toEqual({ left: 60, top: 75 });
    expect(toScreen({ ...VIEW, zoom: 2 }, 100, 50)).toEqual({ left: 200, top: 100 });
    expect(toScreen({ ...VIEW, scrollX: -40, scrollY: 25, zoom: 0.5 }, 100, 50)).toEqual({ left: 30, top: 37.5 });
    expect(markBox({ ...VIEW, scrollX: 10, scrollY: 10, zoom: 1.5 }, { x: 0, y: 0, width: 120, height: 80 })).toEqual({ left: 15, top: 15, width: 180, height: 120 });
  });

  it('a pin stays on the centre of its scrap\'s top edge through pan and zoom, at its own screen size', () => {
    const sticky = mark({ id: 's', kind: 'sticky' });
    for (const view of [VIEW, { ...VIEW, scrollX: -300, scrollY: 120 }, { ...VIEW, zoom: 0.5 }, { ...VIEW, zoom: 3, scrollX: 17, scrollY: -9 }]) {
      const box = markBox(view, sticky);
      expect(overlayItems([sticky], view)).toEqual([{ type: 'pin', id: 's', left: box.left + box.width / 2, top: box.top }]);
    }
  });
});

describe('#gui-board the three hands', () => {
  it('yours, an agent\'s, the unknown hand', () => {
    expect([handOf(YOU), handOf(ARKY), handOf(NOBODY)]).toEqual(['you', 'agent', 'unknown']);
    expect([isScrap('sticky'), isScrap('stub'), isScrap('rect'), isScrap('text'), isScrap('frame')]).toEqual([true, true, false, false, false]);
  });

  it('a scrap is always pinned: plain for you, the seal for an agent, hollow for the unknown hand', () => {
    const items = overlayItems([mark({ id: 'a', kind: 'sticky' }), mark({ id: 'b', kind: 'sticky', author: ARKY }), mark({ id: 'c', kind: 'sticky', author: NOBODY })], VIEW);
    expect(items.map((i) => i.type)).toEqual(['pin', 'seal', 'hollow']);
    expect(items[1]).toMatchObject({ type: 'seal', on: 'pin', name: 'Arky', seal: sealOf('arky', 'Arky'), left: 160, top: 50 });
  });

  it('ink drawn on the desk has no pin; an agent\'s drawn mark shows its seal at its first point only while selected', () => {
    expect(overlayItems([mark({ id: 'r', kind: 'rect' }), mark({ id: 'f', kind: 'frame' }), mark({ id: 't', kind: 'text' })], VIEW)).toEqual([]);
    expect(overlayItems([mark({ id: 'r', kind: 'arrow', author: ARKY, firstX: 130, firstY: 70 })], VIEW)).toEqual([]);
    expect(overlayItems([mark({ id: 'r', kind: 'arrow', author: ARKY, firstX: 130, firstY: 70, selected: true })], VIEW)).toEqual([{ type: 'seal', id: 'r', left: 130, top: 70, seal: sealOf('arky', 'Arky'), name: 'Arky', on: 'mark' }]);
    expect(overlayItems([mark({ id: 'r', kind: 'rect', author: NOBODY, selected: true })], VIEW)).toEqual([{ type: 'hollow', id: 'r', left: 100, top: 50 }]);
    expect(overlayItems([mark({ id: 'r', kind: 'rect', selected: true })], VIEW)).toEqual([]);
  });

  it('a text that is not yours is ALWAYS boxed, with the seal (or the hollow pin) on its top edge', () => {
    const [box, seal] = overlayItems([mark({ id: 't', kind: 'text', author: ARKY })], VIEW);
    expect(box).toEqual({ type: 'textbox', id: 't', left: 100 - TEXTBOX_PAD, top: 50 - TEXTBOX_TOP, width: 120 + 2 * TEXTBOX_PAD, height: 80 + TEXTBOX_TOP + TEXTBOX_PAD });
    expect(seal).toMatchObject({ type: 'seal', on: 'text', left: 160, top: 50 - TEXTBOX_TOP });
    expect(TEXTBOX_TOP).toBe(12);
    expect(overlayItems([mark({ id: 't', kind: 'text', author: NOBODY })], VIEW).map((i) => i.type)).toEqual(['textbox', 'hollow']);
  });

  it('a label inside a mark carries nothing of its own', () => {
    expect(overlayItems([mark({ id: 'l', kind: 'text', author: ARKY, labelOf: 's' })], VIEW)).toEqual([]);
  });

  it('a stub is a pinned scrap whose words are the host\'s; an agent\'s is dashed and sealed', () => {
    const items = overlayItems([mark({ id: 'k', kind: 'stub', stubKind: 'live:session' }), mark({ id: 'm', kind: 'stub', stubKind: 'allow:approved-by-you', author: ARKY })], { ...VIEW, zoom: 2 });
    expect(items.map((i) => i.type)).toEqual(['stub', 'pin', 'stub', 'seal']);
    expect(items[0]).toEqual({ type: 'stub', id: 'k', left: 200, top: 100, width: 240, height: 160, kind: 'live:session', dashed: false });
    expect(items[2]).toMatchObject({ kind: 'allow:approved-by-you', dashed: true });
  });
});

describe('#gui-board hands foot', () => {
  it('you first and always, then each agent in order of first mark, then the unknown hand; labels are not counted', () => {
    const luna: BoardAuthor = { cls: 'agent', id: 'luna', name: 'Luna' };
    const marks = [mark({ id: '1', kind: 'rect', author: luna }), mark({ id: '2', kind: 'sticky' }), mark({ id: '2l', kind: 'text', labelOf: '2' }), mark({ id: '3', kind: 'rect', author: ARKY }), mark({ id: '4', kind: 'text', author: NOBODY }), mark({ id: '5', kind: 'arrow', author: luna })];
    expect(footHands(marks)).toEqual([{ hand: 'you', n: 1 }, { hand: 'agent', id: 'luna', name: 'Luna', n: 2, seal: sealOf('luna', 'Luna') }, { hand: 'agent', id: 'arky', name: 'Arky', n: 1, seal: sealOf('arky', 'Arky') }, { hand: 'unknown', n: 1 }]);
    expect(footHands([])).toEqual([{ hand: 'you', n: 0 }]);
  });
  it('a name beside a seal is length-capped', () => {
    expect(handName('Arky')).toBe('Arky');
    expect([...handName('x'.repeat(60))]).toHaveLength(24);
    expect(handName('x'.repeat(60)).endsWith('…')).toBe(true);
  });
});
