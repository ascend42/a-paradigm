/**
 * The normal form of a mark (boards S1.1; Mika's pass A findings 3 and 7; the engine-side half of condition C8):
 * whatever arrives on a board is repainted to this, and what is not a board type is removed. The live replay of a
 * paste is in the P12 harness where the browser lets a synthetic paste through; this is the rule itself.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_THEME_TOKENS, resolveContentColour } from '@a-company/gnomon-contracts';
import { BOARD_FONT_ID, BOARD_FONT_SIZE, BOARD_TYPES, FILLABLE, nearestWeight, normalOf, offNormal, strokeStyleOf } from '../src/board/normal.js';
import { gnomonBoardAdmit, gnomonBoardTypes, onBoardRefusal } from '../src/board/skin.js';

/** what the engine's own clipboard carries for a stock mark */
const STOCK = { strokeColor: '#e03131', backgroundColor: '#ffc9c9', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'dashed', roughness: 2, opacity: 40, roundness: { type: 3 }, link: 'https://example.invalid/' };

describe('#gui-board the normal form of a mark', () => {
  it('a pasted stock rectangle becomes solid, exact, opaque, square, unlinked, in ink with no fill, at a design weight', () => {
    const el = { type: 'rectangle', ...STOCK };
    expect(offNormal(el, null, 'day')).toBe(true);
    expect(normalOf(el, null, 'day')).toEqual({ strokeColor: CONTENT_THEME_TOKENS.day['text.primary'], backgroundColor: 'transparent', strokeStyle: 'solid', roughness: 0, fillStyle: 'solid', opacity: 100, roundness: null, link: null, locked: false, strokeWidth: 2 });
    expect(offNormal({ type: 'rectangle', ...normalOf(el, null, 'day') }, null, 'day')).toBe(false);
  });

  it('a person cannot make a dashed mark: only the host\'s word on the author changes the stroke', () => {
    expect(strokeStyleOf(undefined)).toBe('solid');
    expect(strokeStyleOf({ cls: 'human' })).toBe('solid');
    expect(strokeStyleOf({ cls: 'agent', id: 'arky', name: 'Arky' })).toBe('dashed');
    expect(strokeStyleOf({ cls: 'unknown' })).toBe('dashed');
    for (const type of BOARD_TYPES) expect(normalOf({ type, strokeStyle: 'dashed' } as never, { line: 'ink', fill: null }, 'night').strokeStyle, type).toBe('solid');
    expect(normalOf({ type: 'rectangle' }, { line: 'ink', fill: null, by: { cls: 'unknown' } }, 'day').strokeStyle).toBe('dashed');
    // an agent's mark that someone turned solid is put back to dashed, and yours that someone dashed to solid
    expect(offNormal({ type: 'ellipse', ...normalOf({ type: 'ellipse' }, { line: 'ink', fill: null }, 'day'), strokeStyle: 'solid' }, { line: 'ink', fill: null, by: { cls: 'agent', id: 'a', name: 'A' } }, 'day')).toBe(true);
  });

  it('what is not a board type must go: image, embeddable, iframe, line, magicframe (a diamond is a core kind since S1.3 and stays)', () => {
    expect([...BOARD_TYPES].sort()).toEqual(['arrow', 'diamond', 'ellipse', 'frame', 'freedraw', 'rectangle', 'text']);
    expect(offNormal({ type: 'diamond' }, null, 'day')).toBe(false);
    for (const type of ['image', 'embeddable', 'iframe', 'line', 'magicframe', 'selection']) expect(offNormal({ type }, null, 'day'), type).toBe(true);
    expect(offNormal({ type: 'image', isDeleted: true }, null, 'day')).toBe(false);
    expect([...FILLABLE].sort()).toEqual(['diamond', 'ellipse', 'rectangle']);
  });

  it('a pasted lock is taken off and a pasted arrow keeps no stock head: the ends that had one get the open arrow (none, end or both)', () => {
    expect(offNormal({ type: 'rectangle', locked: true } as never, null, 'day')).toBe(true);
    expect(normalOf({ type: 'arrow', endArrowhead: 'arrow' }, null, 'day')).toMatchObject({ startArrowhead: null, endArrowhead: 'arrow', locked: false });
    expect(offNormal({ type: 'arrow', startArrowhead: 'dot', endArrowhead: 'triangle' } as never, null, 'day')).toBe(true);
    expect(normalOf({ type: 'arrow', startArrowhead: 'dot', endArrowhead: 'triangle' }, null, 'day')).toMatchObject({ startArrowhead: 'arrow', endArrowhead: 'arrow' });
    expect(normalOf({ type: 'arrow', startArrowhead: null, endArrowhead: 'triangle' }, null, 'day')).toMatchObject({ startArrowhead: null, endArrowhead: 'arrow' });
    expect(normalOf({ type: 'arrow', startArrowhead: null, endArrowhead: null }, null, 'day')).toMatchObject({ startArrowhead: null, endArrowhead: null });
    // a start head never stands alone (`head` is none, end or both)
    expect(normalOf({ type: 'arrow', startArrowhead: 'arrow', endArrowhead: null }, null, 'day')).toMatchObject({ startArrowhead: 'arrow', endArrowhead: 'arrow' });
    for (const head of [{ startArrowhead: null, endArrowhead: null }, { startArrowhead: null, endArrowhead: 'arrow' }, { startArrowhead: 'arrow', endArrowhead: 'arrow' }]) expect(offNormal({ type: 'arrow', ...head } as never, null, 'day'), JSON.stringify(head)).toBe(false);
    expect('endArrowhead' in normalOf({ type: 'rectangle' }, null, 'day')).toBe(false);
  });

  it('the engine-side filter admits board types only, before anything is committed, and says what it refused', () => {
    const heard: string[] = [];
    const off = onBoardRefusal((what, detail) => void heard.push(`${what}:${detail}`));
    const kept = gnomonBoardAdmit([{ type: 'rectangle' }, { type: 'iframe' }, { type: 'embeddable' }, { type: 'image' }, { type: 'text' }, { type: 'diamond' }, { type: 42 }, null as never]);
    off();
    expect(kept.map((e) => e.type)).toEqual(['rectangle', 'text', 'diamond']);
    expect(heard).toEqual(['mark:iframe', 'mark:embeddable', 'image:image', 'mark:unknown', 'mark:unknown']);
    expect(gnomonBoardAdmit(null)).toEqual([]);
    expect([...gnomonBoardTypes].sort()).toEqual([...BOARD_TYPES].sort());
  });

  it('stroke widths land on the design\'s weights; frames, text and stubs keep theirs', () => {
    expect([0.5, 1, 2, 2.9, 3, 3.1, 4, 5.9, 6, 6.1, 8, 40].map(nearestWeight)).toEqual([2, 2, 2, 2, 2, 4, 4, 4, 4, 8, 8, 8]);
    expect(normalOf({ type: 'freedraw', strokeWidth: 36 }, null, 'day').strokeWidth).toBe(8);
    for (const el of [{ type: 'frame' }, { type: 'text' }]) expect('strokeWidth' in normalOf(el, null, 'day'), el.type).toBe(false);
    expect('strokeWidth' in normalOf({ type: 'rectangle', strokeWidth: 1 }, { line: 'graphite', fill: 'paper', kind: 'stub' }, 'day')).toBe(false);
  });

  it('text is the one face and size, whatever was pasted', () => {
    expect(normalOf({ type: 'text' }, null, 'day')).toMatchObject({ fontFamily: BOARD_FONT_ID, fontSize: BOARD_FONT_SIZE });
    expect([BOARD_FONT_ID, BOARD_FONT_SIZE]).toEqual([10, 13.5]);
    expect(offNormal({ type: 'text', fontFamily: 5, fontSize: 28 } as never, null, 'day')).toBe(true);
  });

  it('colours come from the tokens for the theme, through the palette; a fill shows only on a fillable mark', () => {
    const stamp = { line: 'cobalt', fill: 'sky' };
    for (const theme of ['day', 'night'] as const) {
      expect(normalOf({ type: 'rectangle' }, stamp, theme)).toMatchObject({ strokeColor: resolveContentColour('cobalt', 'line', theme), backgroundColor: resolveContentColour('sky', 'fill', theme) });
      expect(normalOf({ type: 'arrow' }, stamp, theme).backgroundColor).toBe('transparent');
      expect(normalOf({ type: 'text' }, stamp, theme).backgroundColor).toBe('transparent');
    }
    // a token that fails the palette's check draws as ink and as no fill, never as its own value
    expect(normalOf({ type: 'rectangle' }, { line: 'custom:#B4382A', fill: 'custom:#B4382A' }, 'day')).toMatchObject({ strokeColor: CONTENT_THEME_TOKENS.day['text.primary'], backgroundColor: 'transparent' });
  });
});
