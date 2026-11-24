/**
 * The board rail's model (design component board-rail; boards S1.1 pass B): which key does what and WHEN, and how
 * the rail folds. G-DDL-08's key half lives here: no board key is handled while a card is focused.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_TOOLS } from '../src/core/board.js';
import { RAIL_GROUPS, RAIL_TOOLS, railKeyAction, railLayout, railNeed, railTitle, railTool, zoomPercent } from '../src/core/board-rail.js';

const ON = { boardFocused: true, editingText: false, cardFocused: false };

describe('#gui-board rail tools', () => {
  it('nine tools, the design\'s letters, every tool of the handle and no other', () => {
    expect(RAIL_TOOLS.map((t) => `${t.letter} ${t.tool}`)).toEqual(['V select', 'N sticky', 'T text', 'R rect', 'O ellipse', 'C arrow', 'F frame', 'P stroke', 'H hand']);
    expect(RAIL_TOOLS.map((t) => t.tool).sort()).toEqual([...BOARD_TOOLS].sort());
    expect(RAIL_GROUPS).toEqual([['select'], ['sticky', 'text'], ['rect', 'ellipse', 'arrow', 'frame'], ['stroke']]);
    expect(railTitle(railTool('arrow'))).toBe('Arrow · connect (C)');
    // no tool uses A or D (the letters that decide a card), and none repeats
    expect(RAIL_TOOLS.map((t) => t.letter)).not.toEqual(expect.arrayContaining(['A']));
    expect(RAIL_TOOLS.map((t) => t.letter)).not.toEqual(expect.arrayContaining(['D']));
    expect(new Set(RAIL_TOOLS.map((t) => t.letter)).size).toBe(9);
  });

  it('the glyphs are the design\'s paths', () => {
    expect(railTool('select').paths).toEqual(['M3.5 2 V13 L6.5 10.2 L8.6 14.5 L10.4 13.6 L8.3 9.4 L12.5 9.2 Z']);
    expect(railTool('sticky').dot).toEqual({ cx: 8, cy: 3.5, r: 1.75 });
    expect(railTool('ellipse').ellipse).toEqual({ cx: 8, cy: 8, rx: 5.75, ry: 4.25 });
    expect(railTool('frame').paths).toHaveLength(2);
    expect(railTool('stroke').paths[0]).toBe('M2.5 11.5 C3.5 6 6 5.5 7.2 8.6 S10.5 12.5 13.5 4.5');
  });
});

describe('#gui-board rail keys', () => {
  it('a letter chooses its tool, in either case, while the board has focus', () => {
    for (const t of RAIL_TOOLS) {
      expect(railKeyAction({ key: t.letter.toLowerCase() }, ON)).toEqual({ type: 'tool', tool: t.tool });
      expect(railKeyAction({ key: t.letter }, ON)).toEqual({ type: 'tool', tool: t.tool });
    }
    expect(railKeyAction({ key: 'Escape' }, ON)).toEqual({ type: 'tool', tool: 'select' });
    expect(railKeyAction({ key: '0', metaKey: true }, ON)).toEqual({ type: 'fit' });
    expect(railKeyAction({ key: '0', ctrlKey: true }, ON)).toEqual({ type: 'fit' });
  });

  it('G-DDL-08: NO board key is handled while a card is focused', () => {
    const card = { boardFocused: true, editingText: false, cardFocused: true };
    for (const key of [...RAIL_TOOLS.map((t) => t.letter), ...RAIL_TOOLS.map((t) => t.letter.toLowerCase()), 'Escape', 'a', 'd', 'Enter', ' ']) expect(railKeyAction({ key }, card), key).toBeNull();
    expect(railKeyAction({ key: '0', metaKey: true }, card)).toBeNull();
    // and with focus outside the board altogether (the composer, a card that is not reported): nothing either
    for (const t of RAIL_TOOLS) expect(railKeyAction({ key: t.letter }, { boardFocused: false, editingText: false, cardFocused: false })).toBeNull();
  });

  it('no letter acts while a text is being typed on the board', () => {
    const typing = { boardFocused: true, editingText: true, cardFocused: false };
    for (const t of RAIL_TOOLS) expect(railKeyAction({ key: t.letter.toLowerCase() }, typing), t.letter).toBeNull();
    expect(railKeyAction({ key: 'Escape' }, typing)).toBeNull(); // Esc ends the edit: the engine's, not the rail's
  });

  it('A, D, Enter, digits and any modified letter are never the rail\'s', () => {
    for (const key of ['a', 'A', 'd', 'D', 'Enter', '9', '1', 'k', 'e', 'q', '?', 'Tab', 'ArrowDown']) expect(railKeyAction({ key }, ON), key).toBeNull();
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) expect(railKeyAction({ key: 'n', ...mod }, ON), JSON.stringify(mod)).toBeNull();
    expect(railKeyAction({ key: '0', metaKey: true, shiftKey: true }, ON)).toBeNull();
  });
});

describe('#gui-board rail folding (design short_windows)', () => {
  const all = RAIL_GROUPS.flat();
  it('whole at 472; + and − leave under it; Hand and tools fold under 408', () => {
    expect(railLayout(472)).toEqual({ zoomKeys: true, hand: true, visible: all, folded: [] });
    expect(railLayout(538)).toEqual({ zoomKeys: true, hand: true, visible: all, folded: [] });
    expect(railLayout(471)).toEqual({ zoomKeys: false, hand: true, visible: all, folded: [] });
    expect(railLayout(408)).toEqual({ zoomKeys: false, hand: true, visible: all, folded: [] });
    expect(railLayout(407)).toEqual({ zoomKeys: false, hand: false, visible: all.filter((t) => t !== 'stroke'), folded: ['stroke', 'hand'] });
  });

  it('at 304 it is the rail the specimen draws: Select, Sticky, Text, Rectangle, Ellipse and ⋯ holding Arrow, Frame, Stroke, Hand', () => {
    expect(railLayout(304)).toEqual({ zoomKeys: false, hand: false, visible: ['select', 'sticky', 'text', 'rect', 'ellipse'], folded: ['arrow', 'frame', 'stroke', 'hand'] });
    expect([1, 2, 3, 4, 5].map(railNeed)).toEqual([367, 335, 303, 271, 230]);
  });

  it('Select, Sticky and Text never fold, however short', () => {
    for (const h of [232, 148, 60, 0]) expect(railLayout(h).visible).toEqual(['select', 'sticky', 'text']);
    expect(railLayout(0).folded).toEqual(['rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand']);
  });

  it('a folded tool that is chosen takes the last visible tool slot', () => {
    expect(railLayout(304, 'stroke')).toEqual({ zoomKeys: false, hand: false, visible: ['select', 'sticky', 'text', 'rect', 'stroke'], folded: ['ellipse', 'arrow', 'frame', 'hand'] });
    expect(railLayout(232, 'frame').visible).toEqual(['select', 'sticky', 'text', 'frame']);
    for (const h of [407, 350, 304, 260, 232]) for (const t of all) {
      const l = railLayout(h, t);
      expect(l.visible, `${h} ${t}`).toContain(t);
      expect([...l.visible, ...l.folded].sort(), `${h} ${t}`).toEqual([...all, 'hand'].sort());
    }
  });

  it('the percent key prints whole percents', () => {
    expect([1, 1.1, 0.5, 0.333].map(zoomPercent)).toEqual(['100%', '110%', '50%', '33%']);
  });
});
