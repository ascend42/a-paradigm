/**
 * S1.4 E3 items 2 and 3 (design author-seal.other_hands, .restored, board-trace, turn_strip.notice.cut_out; Mika R1,
 * R2, R7, R9; rule another-hand-is-signed): the countermark, the words sign, the cut-out and the trace, as the pure
 * overlay lays them out. Geometry only; the rendered goldens are in .e3-logs/shots for Mika.
 */
import { describe, expect, it } from 'vitest';
import type { BoardAuthor, BoardMarkView, BoardView } from '../src/core/board.js';
import { COUNTER, CUTOUT, TRACE_MAX, countermarkPoint, markBox, overlayItems, traceOutCopy, traceOutOfView, type OverlayItem } from '../src/core/board-overlay.js';

const YOU: BoardAuthor = { cls: 'human' };
const CLAUDE: BoardAuthor = { cls: 'agent', id: '9:p:x/agentclaude', name: 'claude' };
const MIKA: BoardAuthor = { cls: 'agent', id: '9:p:x/agentmika', name: 'mika' };
const at = (zoom: number): BoardView => ({ scrollX: 0, scrollY: 0, zoom, width: 1600, height: 1200 });
const mark = (o: Partial<BoardMarkView> & { id: string; kind: BoardMarkView['kind'] }): BoardMarkView => ({ node: o.id, x: 100, y: 50, width: 120, height: 80, firstX: 100, firstY: 50, author: YOU, line: 'ink', fill: null, selected: false, ...o });
const of = (items: OverlayItem[], type: OverlayItem['type']) => items.filter((i) => i.type === type) as Array<OverlayItem & { left: number; top: number }>;

describe('E3 the countermark (R1): under the bottom edge, clear of the engine\'s SE handle at every zoom', () => {
  for (const zoom of [0.25, 0.49, 0.5, 1, 4]) {
    it(`at ${zoom * 100}%: an agent's change of your rect signs at (right - 7, bottom + 7), outside [right, right+8] x [bottom, bottom+8]`, () => {
      const m = mark({ id: 'r', kind: 'rect', otherBy: CLAUDE, changedBy: CLAUDE });
      const items = overlayItems([m], at(zoom));
      const c = of(items, 'counter');
      expect(c).toHaveLength(1);
      const b = markBox(at(zoom), m);
      const right = b.left + b.width;
      const bottom = b.top + b.height;
      expect(c[0]).toMatchObject({ left: right - COUNTER.dx, top: bottom + COUNTER.dy, disc: false });
      // its 6px box never enters the handle square
      expect(c[0]!.left + COUNTER.half).toBeLessThanOrEqual(right - COUNTER.clear);
    });
  }
  it('selected: the full head at (right - 13, bottom + 15), its chip to the right with its top at bottom + 12; nothing in the handle square', () => {
    const m = mark({ id: 'r', kind: 'rect', otherBy: CLAUDE, selected: true });
    const items = overlayItems([m], at(1));
    const b = markBox(at(1), m);
    const seal = items.find((i) => i.type === 'seal')!;
    expect(seal).toMatchObject({ left: b.left + b.width - 13, top: b.top + b.height + 15 });
    const chip = items.find((i) => i.type === 'chip')! as { left: number; top: number };
    expect(chip.top - 9).toBe(b.top + b.height + 12);
    expect(chip.left).toBeGreaterThan(b.left + b.width - 13);
    expect(of(items, 'counter')).toHaveLength(0);
  });
  it('your change of an agent\'s mark is a filled disc; your own mark changed only by you has none', () => {
    expect(of(overlayItems([mark({ id: 'a', kind: 'rect', author: CLAUDE, otherBy: YOU })], at(1)), 'counter')[0]).toMatchObject({ disc: true });
    expect(of(overlayItems([mark({ id: 'b', kind: 'rect', changedBy: YOU })], at(1)), 'counter')).toHaveLength(0);
  });
  it('a 14px agent box changed by another agent: the two rings stand at least 4px apart', () => {
    const m = mark({ id: 't', kind: 'stroke', author: MIKA, otherBy: CLAUDE, width: 14, height: 14, firstX: 100 + 14, firstY: 50 + 14 });
    const items = overlayItems([m], at(0.25));
    const c = of(items, 'counter')[0]!;
    for (const r of [...of(items, 'ring'), ...of(items, 'seal')]) expect(Math.hypot(c.left - r.left, c.top - r.top)).toBeGreaterThanOrEqual(3 + 3 + COUNTER.clear - 1e-9);
  });
});

describe('E3 the countermark on an open mark (R2)', () => {
  it('80% of the last run, 5px on the lower side', () => {
    const m = mark({ id: 'a', kind: 'arrow', x: 0, y: 100, width: 100, height: 0, lastRun: { x1: 0, y1: 100, x2: 100, y2: 100 }, otherBy: CLAUDE });
    expect(countermarkPoint(m, at(1))).toEqual({ left: 80, top: 105 });
  });
  it('with a bound label: past the label box\'s end edge + 4 when that is further along', () => {
    const m = mark({ id: 'a', kind: 'arrow', x: 0, y: 100, width: 100, height: 0, lastRun: { x1: 0, y1: 100, x2: 100, y2: 100 }, labelBox: { x: 40, y: 92, width: 50, height: 16 }, otherBy: CLAUDE });
    expect(countermarkPoint(m, at(1))).toEqual({ left: 94, top: 105 });
  });
});

describe('E3 words by another hand (R9) and the text box (item 2)', () => {
  it('a dashed rule along the bottom of the label box; its seal at the right end, clamped inside the mark', () => {
    const m = mark({ id: 's', kind: 'sticky', wordsBy: CLAUDE, labelBox: { x: 110, y: 70, width: 200, height: 20 } });
    const items = overlayItems([m], at(1));
    expect(of(items, 'words')[0]).toMatchObject({ left: 110, top: 90, width: 200 });
    const seal = items.filter((i) => i.type === 'seal').at(-1)!;
    const b = markBox(at(1), m);
    expect(seal.left).toBeLessThanOrEqual(b.left + b.width);
  });
  it('a text is unboxed only when its hand and its words are both yours', () => {
    expect(of(overlayItems([mark({ id: 't', kind: 'text' })], at(1)), 'textbox')).toHaveLength(0);
    expect(of(overlayItems([mark({ id: 't', kind: 'text', wordsBy: CLAUDE })], at(1)), 'textbox')).toHaveLength(1);
  });
  it('words by another hand survive a second agent\'s restyle: both the words sign and the countermark show', () => {
    const items = overlayItems([mark({ id: 's', kind: 'sticky', wordsBy: CLAUDE, otherBy: MIKA, changedBy: MIKA, labelBox: { x: 110, y: 70, width: 60, height: 20 } })], at(1));
    expect(of(items, 'words')).toHaveLength(1);
    expect(of(items, 'counter')).toHaveLength(1);
  });
});

describe('E3 cut-outs (R7) and the trace', () => {
  it('tick arms are min(6, a quarter of the shorter side); a box under 12px ticks a 12px square', () => {
    const big = of(overlayItems([], at(1), { cutouts: [{ node: 'n', x: 0, y: 0, width: 100, height: 60, by: CLAUDE }] }), 'cutout')[0] as unknown as { arm: number };
    expect(big.arm).toBe(CUTOUT.arm);
    const small = of(overlayItems([], at(0.25), { cutouts: [{ node: 'n', x: 0, y: 0, width: 40, height: 20, by: CLAUDE }] }), 'cutout')[0] as unknown as { arm: number; width: number };
    expect(small.width).toBe(CUTOUT.min + 4);
    expect(small.arm).toBe(CUTOUT.min / 4);
  });
  it('the trace outlines the traced marks 2px out, at most 64', () => {
    const marks = Array.from({ length: 70 }, (_, i) => mark({ id: `m${i}`, kind: 'rect' }));
    const items = overlayItems(marks, at(1), { trace: new Set(marks.map((m) => m.node!)) });
    const t = of(items, 'trace');
    expect(t).toHaveLength(TRACE_MAX);
    expect(t[0]).toMatchObject({ left: 98, top: 48 });
  });
});

describe('E3 review C3 (Mika; the orchestrator\'s ruling): the words sign never covers the words', () => {
  const HALF: Record<string, number> = { seal: 11, ring: 3, counter: COUNTER.half };
  const cases = [
    { name: 'short words', labelBox: { x: 110, y: 70, width: 40, height: 20 } },
    { name: 'words to the right edge', labelBox: { x: 104, y: 60, width: 112, height: 20 } },
    { name: 'words to the bottom right', labelBox: { x: 104, y: 104, width: 112, height: 22 } },
    { name: 'one line filling the mark', labelBox: { x: 100, y: 50, width: 120, height: 80 } },
  ];
  for (const zoom of [0.25, 0.5, 1, 4])
    for (const c of cases)
      for (const by of [CLAUDE, YOU])
        it(`at ${zoom * 100}%, ${c.name}, words by ${by.cls}: the sign's box never meets the label's box`, () => {
          const m = mark({ id: 's', kind: 'sticky', author: by.cls === 'human' ? MIKA : YOU, wordsBy: by, labelBox: c.labelBox });
          const items = overlayItems([m], at(zoom));
          const words = of(items, 'words')[0]!;
          expect(words).toBeDefined();
          const lab = { l: c.labelBox.x * zoom, t: c.labelBox.y * zoom, r: (c.labelBox.x + c.labelBox.width) * zoom, b: (c.labelBox.y + c.labelBox.height) * zoom };
          // the words sign is the last seal, ring or counter drawn for the mark
          const sign = items.filter((i) => i.type === 'seal' || i.type === 'ring' || i.type === 'counter').at(-1) as OverlayItem & { left: number; top: number };
          expect(sign).toBeDefined();
          const h = HALF[sign.type]!;
          const meets = sign.left - h < lab.r && lab.l < sign.left + h && sign.top - h < lab.b && lab.t < sign.top + h;
          expect(meets, JSON.stringify({ sign, lab })).toBe(false);
        });
});

describe('E3 review D2 (Mika): the trace under 50%, a tiny box, marks out of view', () => {
  it('under 50% the box stands 1px out; at 50% and over, 2px', () => {
    const m = mark({ id: 'r', kind: 'rect' });
    const lo = of(overlayItems([m], at(0.49), { trace: new Set(['r']) }), 'trace')[0]!;
    const b = markBox(at(0.49), m);
    expect(lo).toMatchObject({ left: b.left - 1, top: b.top - 1, width: b.width + 2 });
    expect(of(overlayItems([m], at(0.5), { trace: new Set(['r']) }), 'trace')[0]).toMatchObject({ left: markBox(at(0.5), m).left - 2 });
  });
  it('a box under 6px on the screen is the 6px dashed ring at its centre', () => {
    const m = mark({ id: 'r', kind: 'rect', width: 16, height: 16 });
    const t = of(overlayItems([m], at(0.25), { trace: new Set(['r']) }), 'trace')[0] as OverlayItem & { left: number; top: number; width: number; ring?: boolean };
    const b = markBox(at(0.25), m);
    expect(t).toMatchObject({ ring: true, width: 6, height: 6, left: b.left + b.width / 2 - 3, top: b.top + b.height / 2 - 3 });
  });
  it('counts the traced marks wholly out of view, and says it', () => {
    const marks = [mark({ id: 'a', kind: 'rect' }), mark({ id: 'b', kind: 'rect', x: 5000 }), mark({ id: 'c', kind: 'rect', y: -900 })];
    expect(traceOutOfView(marks, at(1), new Set(['a', 'b', 'c']))).toBe(2);
    expect(traceOutCopy(2)).toBe('2 of these marks are out of view');
  });
});

describe('E3 review D1 (Mika): the hover chips and heads', () => {
  const chips = (items: OverlayItem[]) => items.filter((i) => i.type === 'chip').map((i) => { const c = i as OverlayItem & { name: string; lead?: string }; return `${c.lead ?? ''}|${c.name}`; });
  it('hovered, an agent\'s change reads "changed by Claude"; words by an agent read "words by Claude"', () => {
    expect(chips(overlayItems([mark({ id: 'r', kind: 'rect', otherBy: CLAUDE, changedBy: CLAUDE, hovered: true })], at(1)))).toContain('changed by|Claude');
    expect(chips(overlayItems([mark({ id: 's', kind: 'sticky', wordsBy: CLAUDE, labelBox: { x: 110, y: 70, width: 40, height: 20 }, hovered: true })], at(1)))).toContain('words by|Claude');
  });
  it('an open mark (an arrow) has its hover head too; your change of another hand\'s mark reads "changed by you"', () => {
    const arrow = mark({ id: 'a', kind: 'arrow', x: 0, y: 100, width: 100, height: 0, lastRun: { x1: 0, y1: 100, x2: 100, y2: 100 }, author: MIKA, otherBy: CLAUDE, hovered: true });
    expect(chips(overlayItems([arrow], at(1)))).toContain('changed by|Claude');
    expect(chips(overlayItems([mark({ id: 'r', kind: 'rect', author: MIKA, otherBy: YOU, changedBy: YOU, hovered: true })], at(1)))).toContain('changed by|you');
  });
});
