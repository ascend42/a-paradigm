/**
 * The board rail's model (design component board-rail; boards S1.1 pass B): which key does what and WHEN, and how
 * the rail folds. G-DDL-08's key half lives here: no board key is handled while a card is focused.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_TOOLS } from '../src/core/board.js';
import { BOARD_MIN_HEIGHT } from '../src/core/board-leaf.js';
import { MENU_CUT_TAIL, menuCutHeight, RAIL_GROUPS, RAIL_HEIGHT, RAIL_TOOLS, railDrawGroups, railKeyAction, railLayout, railNeed, railOwnTools, railTitle, railTool, zoomPercent } from '../src/core/board-rail.js';

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
  const whole = { zoomKeys: true, hand: true, visible: all, folded: [], tight: false };
  it('whole at 472; + and − leave under it; Hand and tools fold under 408', () => {
    expect(railLayout(472)).toEqual(whole);
    expect(railLayout(538)).toEqual(whole);
    expect(railLayout(471)).toEqual({ ...whole, zoomKeys: false });
    expect(railLayout(408)).toEqual({ ...whole, zoomKeys: false });
    expect(railLayout(407)).toEqual({ zoomKeys: false, hand: false, visible: all.filter((t) => t !== 'stroke'), folded: ['stroke', 'hand'], tight: false });
  });

  it('the heights are the design\'s: 472 whole, 408 without + and −, then 367, 335, 303, 271 and 230 as tools fold', () => {
    expect(railNeed(railLayout(9999))).toBe(RAIL_HEIGHT.whole);
    expect(railNeed(railLayout(RAIL_HEIGHT.whole - 1))).toBe(RAIL_HEIGHT.noZoomKeys);
    expect([407, 366, 334, 302, 270].map((h) => railNeed(railLayout(h)))).toEqual([367, 335, 303, 271, 230]);
  });

  it('at 304 it is the rail the specimen draws: Select, Sticky, Text, Rectangle, Ellipse and ⋯ holding Arrow, Frame, Stroke, Hand', () => {
    expect(railLayout(304)).toEqual({ zoomKeys: false, hand: false, visible: ['select', 'sticky', 'text', 'rect', 'ellipse'], folded: ['arrow', 'frame', 'stroke', 'hand'], tight: false });
  });

  it('Select, Sticky and Text never fold while their rail fits (230px, the design\'s always-visible set)', () => {
    for (const h of [232, 231, 230]) expect(railLayout(h)).toMatchObject({ visible: ['select', 'sticky', 'text'], folded: ['rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand'], tight: false });
  });

  it('T-2026-11-25-004: under 230 the fold goes on (Text, then Sticky, then the ticks and the spacer), so the rail fits the least board the leaf draws', () => {
    expect(railLayout(229)).toMatchObject({ visible: ['select', 'sticky'], tight: false });
    expect(railLayout(198)).toMatchObject({ visible: ['select', 'sticky'], tight: false });
    expect(railLayout(197)).toMatchObject({ visible: ['select'], tight: false });
    expect(railLayout(190).folded).toEqual(['sticky', 'text', 'rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand']);
    expect(railLayout(157)).toMatchObject({ visible: ['select'], tight: false });
    expect(railLayout(156)).toMatchObject({ visible: ['select'], tight: true });
    expect(railLayout(BOARD_MIN_HEIGHT)).toMatchObject({ visible: ['select'], tight: true });
    // THE RULE: at every height a board can have, with any tool chosen, the rail is no taller than its room
    for (let h = BOARD_MIN_HEIGHT; h <= 600; h++) for (const t of [...all, 'hand'] as const) expect(railNeed(railLayout(h, t)), `${h} ${t}`).toBeLessThanOrEqual(h);
    // and it is the FULLEST that fits: one more tool slot would not
    for (let h = BOARD_MIN_HEIGHT; h < 408; h++) {
      const l = railLayout(h);
      if (l.tight) expect(railNeed({ ...l, tight: false }), `${h}`).toBeGreaterThan(h);
      if (!l.tight && l.visible.length < all.length - 1) expect(railNeed({ ...l, visible: all.slice(0, l.visible.length + 1), folded: [...all.slice(l.visible.length + 1), 'hand'] }), `${h}`).toBeGreaterThan(h);
    }
    // under the least board height the leaf draws no rail at all; the model still answers its shortest form
    expect(railLayout(0)).toMatchObject({ visible: ['select'], tight: true });
    expect(railNeed(railLayout(0))).toBeLessThanOrEqual(BOARD_MIN_HEIGHT);
  });

  it('a folded tool that is chosen takes the last visible tool slot, and never adds a row', () => {
    // (design fold.guest_tick: a guest stands in the displaced tool's row and brings no tick, so the specimen's 304
    // holds the same five slots with Stroke chosen as with nothing chosen; it used to hold one fewer)
    expect(railLayout(304, 'stroke')).toEqual({ zoomKeys: false, hand: false, visible: ['select', 'sticky', 'text', 'rect', 'stroke'], folded: ['ellipse', 'arrow', 'frame', 'hand'], tight: false, guest: { tool: 'stroke', for: 'ellipse' } });
    // (it used to be APPENDED when the last visible tool could not fold: a seventh row that ran over the foot)
    expect(railLayout(239, 'frame').visible).toEqual(['select', 'sticky', 'frame']);
    // (from 230 to 238px a guest from another group used to cost both Sticky and Text)
    expect(railLayout(232, 'frame').visible).toEqual(['select', 'sticky', 'frame']);
    expect(railLayout(230, 'frame').visible).toEqual(['select', 'sticky', 'frame']);
    expect(railLayout(304).guest).toBeUndefined();
    expect(railLayout(BOARD_MIN_HEIGHT, 'frame')).toMatchObject({ visible: ['frame'], tight: true });
    expect(railLayout(BOARD_MIN_HEIGHT, 'frame').folded).toContain('select');
    for (const h of [407, 350, 304, 260, 232, 200, 160, BOARD_MIN_HEIGHT]) for (const t of all) {
      const l = railLayout(h, t);
      expect(l.visible, `${h} ${t}`).toContain(t);
      expect([...l.visible, ...l.folded].sort(), `${h} ${t}`).toEqual([...all, 'hand'].sort());
      expect(l.visible.length, `${h} ${t}: a chosen tool never adds a row`).toBeLessThanOrEqual(railLayout(h).visible.length);
    }
  });

  it('design fold.guest_tick: a chosen tool never changes the rail\'s need or its number of slots, and no tick is drawn before a guest', () => {
    for (let h = 0; h <= 480; h++) for (const t of [...all, 'hand'] as const) {
      const l = railLayout(h, t);
      expect(railNeed(l), `${h} ${t}`).toBe(railNeed(railLayout(h)));
      expect(l.visible.length, `${h} ${t}`).toBe(railLayout(h).visible.length);
      // the drawn groups are the unchosen layout's: the guest is inside the displaced tool's group
      expect(railDrawGroups(l).map((g) => g.length), `${h} ${t}`).toEqual(railDrawGroups(railLayout(h)).map((g) => g.length));
      if (l.guest) expect(railOwnTools(l), `${h} ${t}`).toEqual(railLayout(h).visible);
    }
    expect(railDrawGroups(railLayout(230, 'frame'))).toEqual([['select'], ['sticky', 'frame']]);
  });

  it('design menus_scroll: a menu that scrolls is cut through a row: whole rows and half a row (one-line), whole rows and 30px (two-line); none when it fits', () => {
    // a 4px padding and a 1px border before the first row; 28px rows 2px apart
    const m = { first: 5, pitch: 30, rows: 8, natural: 5 + 8 * 28 + 7 * 2 + 5 };
    expect(menuCutHeight({ ...m, room: 400, tail: MENU_CUT_TAIL.oneLine })).toBeNull();
    for (let room = 40; room < m.natural; room++) {
      const hgt = menuCutHeight({ ...m, room, tail: MENU_CUT_TAIL.oneLine })!;
      expect(hgt, `${room}`).toBeLessThanOrEqual(room);
      expect((hgt - 5 - 14) % 30, `${room}: the cut is not half a row`).toBe(0);
      expect(hgt + 30, `${room}: one more row would have fit`).toBeGreaterThan(room);
    }
    expect(menuCutHeight({ ...m, room: 182, tail: MENU_CUT_TAIL.oneLine })).toBe(5 + 5 * 30 + 14);
    expect(menuCutHeight({ first: 5, pitch: 44, rows: 50, natural: 2000, room: 300, tail: MENU_CUT_TAIL.twoLine })).toBe(5 + 6 * 44 + 30);
  });

  it('the percent key prints whole percents', () => {
    expect([1, 1.1, 0.5, 0.333].map(zoomPercent)).toEqual(['100%', '110%', '50%', '33%']);
  });
});
