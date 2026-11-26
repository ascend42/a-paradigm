/**
 * The host layer's arithmetic (design components pin, author-seal, fallback-node; boards S1.1 pass B): where a pin,
 * a seal, an agent text's box and a stub's words go on the screen for a given viewport, and who is in the foot.
 */
import { describe, expect, it } from 'vitest';
import type { BoardAuthor, BoardMarkView, BoardView } from '../src/core/board.js';
import { boardAgentName, CHIP_OFF, chipWidth, hsidShort, lineSealPoint, SELECTED_OFF, sessionLabel, RING_HALF, ENGINE_DASHES, FRAME_NARROW, handKey, hoveredMark, letterPx, lineRingPoint, LOW_ZOOM, PIN_HALF, RING_OFF, SEAL_ALWAYS, selectionLine, sessionShort, tooSmall, footHands, handName, handOf, isScrap, markBox, markSealPoint, overlayItems, SEAL_GAP, SEAL_HALF, TEXTBOX_PAD, TEXTBOX_TOP, toScreen } from '../src/core/board-overlay.js';
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

  it('ink drawn on the desk has no pin; an agent\'s shape or arrow shows its seal just off its first point only while selected', () => {
    expect(overlayItems([mark({ id: 'r', kind: 'rect' }), mark({ id: 'f', kind: 'frame' }), mark({ id: 't', kind: 'text' })], VIEW)).toEqual([]);
    expect(overlayItems([mark({ id: 'r', kind: 'arrow', author: ARKY, firstX: 130, firstY: 70 })], VIEW)).toEqual([]);
    // selected: the full seal BESIDE the first run (Mika R1: never inside the shape an arrow starts from), the name as a chip beside it
    const at = lineSealPoint(mark({ id: 'r', kind: 'arrow', firstX: 130, firstY: 70 }), VIEW, SEAL_HALF);
    expect(overlayItems([mark({ id: 'r', kind: 'arrow', author: ARKY, firstX: 130, firstY: 70, selected: true })], VIEW)).toEqual([{ type: 'seal', id: 'r', ...at, seal: sealOf('arky', 'Arky'), name: 'Arky', on: 'mark' }, { type: 'chip', id: 'r', left: at.left + CHIP_OFF, top: at.top, name: 'Arky' }]);
    // the unknown hand's 8px pin stands its own half plus the gap off the mark: about half a seal's distance
    const pin = markSealPoint(mark({ id: 'r', kind: 'rect' }), VIEW, PIN_HALF);
    const seal = markSealPoint(mark({ id: 'r', kind: 'rect' }), VIEW);
    // (Mika L2) a SELECTED shape's hollow pin stands clear of the engine's corner handles: right − 7, bottom + 7
    const sel = { left: 100 + 120 - SELECTED_OFF, top: 50 + 80 + SELECTED_OFF };
    expect(overlayItems([mark({ id: 'r', kind: 'rect', author: NOBODY, selected: true })], VIEW)).toEqual([{ type: 'hollow', id: 'r', ...sel }, { type: 'chip', id: 'r', left: sel.left + PIN_HALF + 4, top: sel.top, name: 'unknown hand' }]);
    // hovered (not selected) it stays at its seal point
    expect(overlayItems([mark({ id: 'r', kind: 'rect', author: NOBODY })], VIEW, { hovered: 'r' })[0]).toEqual({ type: 'hollow', id: 'r', ...pin });
    const first = { left: (mark({ id: 'r', kind: 'rect' }).firstX + VIEW.scrollX) * VIEW.zoom, top: (mark({ id: 'r', kind: 'rect' }).firstY + VIEW.scrollY) * VIEW.zoom };
    const far = (q: { left: number; top: number }): number => Math.hypot(q.left - first.left, q.top - first.top);
    expect(far(pin)).toBeCloseTo(PIN_HALF + SEAL_GAP, 5);
    expect(far(pin)).toBeLessThanOrEqual(far(seal) / 2 + 0.5);
    // a frame narrower than FRAME_NARROW: the seal stands just outside its right corner, clear of a long title
    const narrow = mark({ id: 'f', kind: 'frame', x: 100, y: 100, width: 60, height: 60, firstX: 100, firstY: 100 });
    const nb = { left: (100 + VIEW.scrollX) * VIEW.zoom, width: 60 * VIEW.zoom };
    if (nb.width < FRAME_NARROW) expect(markSealPoint(narrow, VIEW).left - SEAL_HALF).toBeGreaterThanOrEqual(nb.left + nb.width);
    const wide = mark({ id: 'f', kind: 'frame', x: 100, y: 100, width: 300, height: 60, firstX: 100, firstY: 100 });
    expect(markSealPoint(wide, VIEW).left).toBe((100 + 300 + VIEW.scrollX) * VIEW.zoom - SEAL_HALF);
    expect(overlayItems([mark({ id: 'r', kind: 'rect', selected: true })], VIEW)).toEqual([]);
  });

  it('a text that is not yours is ALWAYS boxed, with the seal (or the hollow pin) on its top edge', () => {
    const [box, seal] = overlayItems([mark({ id: 't', kind: 'text', author: ARKY })], VIEW);
    expect(box).toEqual({ type: 'textbox', id: 't', form: 'box', left: 100 - TEXTBOX_PAD, top: 50 - TEXTBOX_TOP, width: 120 + 2 * TEXTBOX_PAD, height: 80 + TEXTBOX_TOP + TEXTBOX_PAD });
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

describe('#gui-board where a drawn mark\'s seal stands (review batch C1)', () => {
  const view: BoardView = { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 };
  const stroke = (o: Partial<BoardMarkView>): BoardMarkView => mark({ id: 's', kind: 'stroke', x: 200, y: 200, width: 300, height: 40, firstX: 200, firstY: 220, secondX: 210, secondY: 220, ...o });
  it('S1.4 P4a: a stroke of another hand is dashed by the engine, so its seal is on demand; selected, it never sits ON the first point', () => {
    expect(ENGINE_DASHES.has('stroke') && ENGINE_DASHES.has('frame') && !ENGINE_DASHES.has('text')).toBe(true);
    expect([...SEAL_ALWAYS]).toEqual(['frame']);
    expect(overlayItems([stroke({ author: ARKY })], view)).toEqual([]);
    const [seal] = overlayItems([stroke({ author: ARKY, selected: true })], view) as Array<{ type: string; left: number; top: number }>;
    expect(seal!.type).toBe('seal');
    // (Mika R1) beside the middle of the first run (200..210 at y 220), on its upper side, its rim 2px clear of the line's edge
    expect(seal!.left).toBeCloseTo(205);
    expect(seal!.top).toBeCloseTo(220 - (SEAL_HALF + 2 + 1));
    // a 6px stroke is not hidden: the seal's box does not reach its first point
    const tiny = markSealPoint(stroke({ width: 6, height: 0, y: 220, secondX: 206, secondY: 220 }), view);
    expect(tiny.left + SEAL_HALF).toBeLessThanOrEqual(200 - SEAL_GAP + 1e-9);
    expect(overlayItems([stroke({ author: NOBODY, selected: true })], view)[0]!.type).toBe('hollow');
    expect(overlayItems([stroke({ author: NOBODY })], view)).toEqual([]);
    expect(overlayItems([stroke({})], view)).toEqual([]);
    // a frame's seal is always on, on its top edge
    expect(overlayItems([mark({ id: 'f', kind: 'frame', author: ARKY })], view).map((i) => i.type)).toEqual(['seal']);
  });
  it('a frame carries it on its top edge at the right corner, clear of the title', () => {
    const at = markSealPoint(mark({ id: 'f', kind: 'frame', x: 100, y: 100, width: 300, height: 200, firstX: 100, firstY: 100 }), view);
    expect(at).toEqual({ left: 100 + 300 - SEAL_HALF, top: 100 });
  });
  it('with the first point out of view the seal is clamped into the part of the mark that is in view; with none in view it is not moved', () => {
    // panned so the stroke's first 250 units are off the left edge
    const panned: BoardView = { ...view, scrollX: -450 };
    const at = markSealPoint(stroke({}), panned);
    expect(toScreen(panned, 200, 220).left).toBeLessThan(0);
    expect(at.left).toBeGreaterThanOrEqual(SEAL_HALF);
    expect(at.left).toBeLessThanOrEqual(50 + SEAL_HALF + SEAL_GAP);
    expect(at.top).toBeGreaterThanOrEqual(SEAL_HALF);
    // a frame scrolled so its right corner is off the right edge
    const frame = mark({ id: 'f', kind: 'frame', x: 600, y: 100, width: 400, height: 200, firstX: 600, firstY: 100 });
    expect(markSealPoint(frame, view).left).toBe(view.width - SEAL_HALF);
    // nothing in view: left where it would be (and so not drawn in view)
    const gone: BoardView = { ...view, scrollX: -2000 };
    expect(markSealPoint(stroke({}), gone).left).toBeLessThan(0);
  });
  it('an agent\'s name is never dressed up or taken for the person or for nobody (review batch C4)', () => {
    expect(boardAgentName('arky')).toBe('arky');
    // hidden, bidi and control characters go through the contracts sanitizer: none reaches the page
    const dressed = boardAgentName('  ar\u200Bky\u202E \n two ');
    expect(dressed).not.toMatch(/[\u200B\u202E\n]/);
    expect(dressed.startsWith('arky')).toBe(true);
    for (const id of ['you', 'You', ' YOU ', 'unknown hand', 'Unknown', 'y\u200Bou']) expect(boardAgentName(id).startsWith('agent '), id).toBe(true);
    expect(boardAgentName('\u200B')).toBe('agent (no name)');
    // and the overlay and the foot never show the raw id
    const fake: BoardAuthor = { cls: 'agent', id: 'x1', name: 'You' };
    expect((overlayItems([mark({ id: 's', kind: 'stroke', author: fake, selected: true })], VIEW)[0] as { name: string }).name).toBe('agent You');
    expect((footHands([mark({ id: 's', kind: 'stroke', author: fake })])[1] as { name: string }).name).toBe('agent You');
    expect(boardAgentName('your-agent')).toBe('your-agent');
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

describe('#gui-board S1.4 P4a: the ring, the too-small rule, the text forms, hover and the hands (design author-seal)', () => {
  const at = (zoom: number): BoardView => ({ scrollX: 0, scrollY: 0, zoom, width: 1600, height: 1200 });
  const types = (items: Array<{ type: string }>): string[] => items.map((i) => i.type);
  it('under 50% (zoom < 0.5) every seal and hollow pin is the ring, every agent or unknown drawn mark carries one; 50% exactly is a seal', () => {
    expect(LOW_ZOOM).toBe(0.5);
    const marks = [mark({ id: 'a', kind: 'sticky', author: ARKY }), mark({ id: 'b', kind: 'sticky', author: NOBODY }), mark({ id: 'c', kind: 'rect', author: ARKY }), mark({ id: 'd', kind: 'frame', author: NOBODY }), mark({ id: 'e', kind: 'sticky' })];
    expect(types(overlayItems(marks, at(0.49)))).toEqual(['ring', 'ring', 'ring', 'ring', 'pin']);
    expect(types(overlayItems(marks, at(0.5)))).toEqual(['seal', 'hollow', 'hollow', 'pin']);
    // the person's pin is marked low under 50% (the night pin fills); never a ring
    expect(overlayItems(marks, at(0.49)).at(-1)).toMatchObject({ type: 'pin', low: true });
    expect(overlayItems(marks, at(0.5)).at(-1)).not.toHaveProperty('low');
  });
  it('hover and selection give back the full seal or hollow pin and the name as a chip, at any zoom', () => {
    const r = mark({ id: 'c', kind: 'rect', author: ARKY });
    expect(types(overlayItems([{ ...r, selected: true }], at(0.25)))).toEqual(['seal', 'chip']);
    expect(types(overlayItems([r], at(0.25), { hovered: 'c' }))).toEqual(['seal', 'chip']);
    expect(types(overlayItems([mark({ id: 'u', kind: 'sticky', author: NOBODY })], at(0.25), { hovered: 'u' }))).toEqual(['hollow', 'chip']);
    expect(types(overlayItems([mark({ id: 'y', kind: 'rect' })], at(0.25), { hovered: 'y' }))).toEqual([]);
  });
  it('the too-small ring: a run under two periods of its own dash (fine 20, bold 40, marker 80), and under 14px on the screen', () => {
    const s = (w: number, len: number, kind: BoardMarkView['kind'] = 'stroke'): BoardMarkView => mark({ id: 's', kind, author: ARKY, width: len, height: kind === 'stroke' ? 2 : 200, strokeWidth: w });
    for (const [w, edge] of [[2, 20], [4, 40], [8, 80]] as const) {
      expect(tooSmall(s(w, edge - 1), 1), `w${w} under`).toBe(true);
      expect(tooSmall(s(w, edge), 1), `w${w} at`).toBe(false);
    }
    // a closed mark's run is its SHORTER side
    expect(tooSmall(mark({ id: 'b', kind: 'rect', width: 300, height: 19, strokeWidth: 2 }), 1)).toBe(true);
    // a 20 by 10 box at 25%: 5 by 2.5px on the screen
    expect(tooSmall(mark({ id: 'b', kind: 'rect', width: 20, height: 10, strokeWidth: 2 }), 0.25)).toBe(true);
    // the screen rule: a 30-unit fine stroke at 40% is 12px, under 14
    expect(tooSmall(s(2, 30), 0.4)).toBe(true);
    expect(tooSmall(s(2, 30), 1)).toBe(false);
    // and the overlay draws it at 100%, beside the line
    const short = mark({ id: 's', kind: 'stroke', author: ARKY, x: 100, y: 100, width: 15, height: 0, firstX: 100, firstY: 100, secondX: 115, secondY: 100, strokeWidth: 2 });
    expect(overlayItems([short], at(1))).toEqual([{ type: 'ring', id: 's', ...lineRingPoint(short, at(1)) }]);
  });
  it('an arrow\'s and a stroke\'s ring stands 5px off the middle of its first run, square to it, on its upper side (left for an upright run)', () => {
    const v = at(1);
    expect(RING_OFF).toBe(5);
    // fine (2 units): the edge is 1px off the centre at 100%, so the ring's centre is 6 off
    expect(lineRingPoint({ firstX: 100, firstY: 100, secondX: 140, secondY: 100 }, v)).toEqual({ left: 120, top: 94 });
    expect(lineRingPoint({ firstX: 140, firstY: 100, secondX: 100, secondY: 100 }, v)).toEqual({ left: 120, top: 94 });
    expect(lineRingPoint({ firstX: 100, firstY: 100, secondX: 100, secondY: 160 }, v)).toEqual({ left: 94, top: 130 });
    expect(lineRingPoint({ firstX: 100, firstY: 160, secondX: 100, secondY: 100 }, v)).toEqual({ left: 94, top: 130 });
    // (Mika R3) a marker (8 units): 4px of line, then the ring's half and 2px: clear of the line at 100% and at 40%
    for (const z of [1, 0.4]) {
      const r = lineRingPoint({ firstX: 100, firstY: 100, secondX: 200, secondY: 100, strokeWidth: 8 }, at(z));
      const lineTop = 100 * z - (8 * z) / 2;
      expect(lineTop - (r.top + RING_HALF), `zoom ${z}`).toBeCloseTo(2);
    }
  });
  it('agent text is never an empty box and never neither form: box at 50% and over, tight under, a rule under 4px letters, PER MARK (Aegis ruling 2)', () => {
    const t = (textSize: number): BoardMarkView => mark({ id: 't', kind: 'text', author: ARKY, textSize });
    const form = (m: BoardMarkView, z: number, o = {}): string => (overlayItems([m], at(z), o).find((i) => i.type === 'textbox') as { form: string }).form;
    expect(form(t(13.5), 0.5)).toBe('box');
    expect(form(t(13.5), 0.49)).toBe('tight');
    // at 30% a large text keeps its box and a small one takes the rule: never by zoom alone
    expect(letterPx(t(40), 0.3)).toBeGreaterThanOrEqual(4);
    expect(form(t(40), 0.3)).toBe('tight');
    expect(letterPx(t(13.5), 0.3)).toBeLessThan(4);
    expect(form(t(13.5), 0.3)).toBe('rule');
    // the unknown hand: the same forms
    expect(form(mark({ id: 't', kind: 'text', author: NOBODY, textSize: 13.5 }), 0.3)).toBe('rule');
    // every low form carries the ring; hover gives back the full box and seal
    for (const z of [0.25, 0.3, 0.4, 0.49]) for (const size of [4, 13.5, 40]) {
      const items = overlayItems([t(size)], at(z));
      expect(types(items).sort(), `${z} ${size}`).toEqual(['ring', 'textbox']);
    }
    expect(types(overlayItems([t(13.5)], at(0.25), { hovered: 't' }))).toEqual(['textbox', 'seal', 'chip']);
    expect(form(t(13.5), 0.25, { hovered: 't' })).toBe('box');
  });
  it('hover names the TOPMOST mark of another hand under the pointer, its box grown by 4px; yours and labels are never named', () => {
    const v = at(1);
    const a = mark({ id: 'a', kind: 'rect', author: ARKY, x: 100, y: 100, width: 100, height: 100 });
    const b = mark({ id: 'b', kind: 'rect', author: NOBODY, x: 150, y: 150, width: 100, height: 100 });
    const y = mark({ id: 'y', kind: 'rect', x: 0, y: 0, width: 400, height: 400 });
    expect(hoveredMark([a, b, y], v, { left: 170, top: 170 })).toBe('b');
    expect(hoveredMark([a, b], v, { left: 97, top: 120 })).toBe('a');
    expect(hoveredMark([a, b], v, { left: 95, top: 120 })).toBe(null);
    expect(hoveredMark([y], v, { left: 10, top: 10 })).toBe(null);
    expect(hoveredMark([a], v, null)).toBe(null);
  });
  it('one selected mark of another hand: the whole line \'<name> · ◇ <session>\'; several, or yours: no line', () => {
    const claude: BoardAuthor = { cls: 'agent', id: handKey('p:gnomon/s1', 'claude'), name: 'claude', principal: 'p:gnomon/s1', session: 'a-very-long-session-name-here' };
    // (Mika R5) the page's NAME for the session, cut at 16; a session the page does not know: its short id
    const names = (h: string): string | null => (h === 'a-very-long-session-name-here' ? 'Totals are off by a cent' : null);
    expect(selectionLine([mark({ id: 'a', kind: 'rect', author: claude, selected: true })], names)).toBe(`claude · ◇ ${sessionShort('Totals are off by a cent')}`);
    expect(selectionLine([mark({ id: 'a', kind: 'rect', author: claude, selected: true })])).toBe(`claude · ◇ ${hsidShort('a-very-long-session-name-here')}`);
    expect(hsidShort('a-very-long-session-name-here')).toBe('ame-here');
    expect(sessionLabel('h1', () => 'fix-auth')).toBe('fix-auth');
    expect([...sessionShort('a-very-long-session-name-here')]).toHaveLength(16);
    expect(selectionLine([mark({ id: 'a', kind: 'rect', author: NOBODY, selected: true })])).toBe('unknown hand');
    expect(selectionLine([mark({ id: 'a', kind: 'rect', author: claude, selected: true }), mark({ id: 'b', kind: 'rect', author: claude, selected: true })])).toBe(null);
    expect(selectionLine([mark({ id: 'a', kind: 'rect', selected: true })])).toBe(null);
  });
  it('a hand is its principal plus agent: two sessions\' Claudes are two hands, and each carries its session hint', () => {
    expect(handKey('p:a', 'claude')).not.toBe(handKey('p:b', 'claude'));
    expect(handKey('p:a', 'bclaude')).not.toBe(handKey('p:ab', 'claude'));
    const c1: BoardAuthor = { cls: 'agent', id: handKey('p:a', 'claude'), name: 'claude', session: 'fix-auth' };
    const c2: BoardAuthor = { cls: 'agent', id: handKey('p:b', 'claude'), name: 'claude', session: 'billing-ui' };
    const feet = footHands([mark({ id: '1', kind: 'rect', author: c1 }), mark({ id: '2', kind: 'rect', author: c2 }), mark({ id: '3', kind: 'rect', author: c1 })], (h) => h);
    expect(feet.map((f) => (f.hand === 'agent' ? `${f.name}:${f.session}:${f.n}` : f.hand))).toEqual(['you', 'claude:fix-auth:2', 'claude:billing-ui:1']);
    // seals differ by input (cut or bead may still collide: the session's name is what tells them apart)
    const [, f1, f2] = feet as Array<{ seal: { cut: string; bead: number } }>;
    expect(f1!.seal).not.toBe(f2!.seal);
    // one Claude alone: no hint
    expect((footHands([mark({ id: '1', kind: 'rect', author: c1 })])[1] as { session?: string }).session).toBeUndefined();
  });
});

describe('#gui-board S1.4 P4a after Mika\'s review (R2, R4, L1)', () => {
  const at = (zoom: number, width = 800): BoardView => ({ scrollX: 0, scrollY: 0, zoom, width, height: 600 });
  it('R2: the chip is kept whole in view: near the right edge it stands to the left of its seal', () => {
    const long = { cls: 'agent' as const, id: 'x', name: 'a-very-long-agent-name-that-runs-to-48-characters' };
    const m = mark({ id: 'r', kind: 'rect', author: long, x: 700, y: 100, width: 80, height: 40, firstX: 700, firstY: 100, selected: false });
    const items = overlayItems([m], at(1), { hovered: 'r' });
    const seal = items.find((i) => i.type === 'seal') as { left: number };
    const chip = items.find((i) => i.type === 'chip') as { left: number; name: string };
    const w = chipWidth(handName(chip.name));
    expect(chip.left + w).toBeLessThanOrEqual(800 - 4);
    expect(chip.left + w).toBeLessThanOrEqual(seal.left);
    // with room it stays on the right
    const near = overlayItems([{ ...m, x: 100, firstX: 100 }], at(1), { hovered: 'r' }).find((i) => i.type === 'chip') as { left: number };
    expect(near.left).toBeGreaterThan(100);
  });
  it('R4: under 50% the tight box gives the ring its half and 2px above the letters; 2px on the sides and foot', () => {
    const t = mark({ id: 't', kind: 'text', author: ARKY, textSize: 13.5, x: 100, y: 100, width: 100, height: 20 });
    const items = overlayItems([t], at(0.41));
    const box = items.find((i) => i.type === 'textbox') as { top: number; left: number; height: number; form: string };
    const ring = items.find((i) => i.type === 'ring') as { top: number };
    expect(box.form).toBe('tight');
    const lettersTop = 100 * 0.41;
    expect(lettersTop - (ring.top + RING_HALF)).toBeCloseTo(2);
    expect(box.left).toBeCloseTo(100 * 0.41 - 2);
    expect(box.top + box.height).toBeCloseTo((100 + 20) * 0.41 + 2);
  });
  it('L1: the too-small run is two periods AS PAINTED, floors included; a frame\'s is 20px on the screen', () => {
    const s = (len: number, w = 2): BoardMarkView => mark({ id: 's', kind: 'stroke', width: len, height: 0, strokeWidth: w });
    // fine at 75%: max(3,4) + max(4.5,3) = 8.5px a period, so a run under 17px (22.6 units) rings
    expect(tooSmall(s(22), 0.75)).toBe(true);
    expect(tooSmall(s(23), 0.75)).toBe(false);
    expect(tooSmall(mark({ id: 'f', kind: 'frame', width: 100, height: 79 }), 0.25)).toBe(true);
    expect(tooSmall(mark({ id: 'f', kind: 'frame', width: 100, height: 80 }), 0.25)).toBe(false);
  });
});
