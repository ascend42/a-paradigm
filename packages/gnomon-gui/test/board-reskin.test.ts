/**
 * G-DDL-07 (spec §12.7; boards S1.1; design rule engine-wears-the-system; Aegis S1.1 ruling 8): nothing of the
 * drawing engine's own look ships.
 *
 *  - no Excalidraw font is requested and no engine family name reaches a canvas font string: one face, the bundle's
 *    own JetBrains Mono, one size;
 *  - roughness is 0;
 *  - no stock toolbar, menu, welcome-screen or image-tool node is in the DOM, at 1280 x 800 and at the 374px board
 *    of a 1024 window in a short pane (no phone layout);
 *  - the shipped chunk has no colour literal within the content palette's minimum distance of a reserved colour
 *    outside the per-patch allowlist (scripts/board-patches.mjs COLOUR_ALLOWLIST);
 *  - the day and night goldens (selection, the marquee, multi-select, the binding highlight, the guides) hold, and
 *    hold no chromatic pixel within that distance of a reserved colour.
 *
 * The static half runs on every OS against the bytes decoded from the kernel embed. The DOM, font and pixel half
 * needs a real engine: the P12 harness (packages/gnomon/probes/p12-excalidraw-csp/harness.mjs) runs the shipped
 * chunk under the unchanged CSP and reports; its predicate is unit-tested here on every OS, and on a developer
 * machine the engines run and Chromium's captures are compared with the goldens: that live half is asserted inside
 * the ONE engine run of test/board-csp.test.ts (checkLiveReskin in test/board-golden.ts), because two WKWebView
 * windows driven at once interfere with each other. On CI the probes job runs P12.
 *
 * Two limits, stated: (1) the text caret is DOM, not canvas, so it is checked as computed style (face, size,
 * caret colour), not as pixels; (2) a theme token is not a finding: night `--key-edge` (#C9DCD6), the colour the
 * design gives selection, is itself inside the minimum distance of night sea-grey, so pixels that are a theme
 * token of the capture's theme, or an antialiased mix of two of the theme's own colours, are exempt (and counted).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_MIN_DISTANCE, CONTENT_RESERVED_COLOURS, CONTENT_THEME_TOKENS, coloursClear } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { BOARD_FONT, BOARD_FONT_STRING, embeddedBundle, GROUND, NARROW, REFUSED_TOOLS, reskinProblems, RGB_INK, STOCK_SELECTORS, TOOLS } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { colourLiterals, pixelColours } from '../scripts/board-colours.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { COLOUR_ALLOWLIST, PATCHES } from '../scripts/board-patches.mjs';
import { BOARD_TOOLS, BOARD_WEIGHTS } from '../src/core/board.js';
import { gnomonBoardKeyActions, skinOf } from '../src/board/skin.js';
import { differingShare, golden, GOLDENS, isThemeMix, nearReserved, RESERVED, reservedPixels, SHOTS, THEMES, type Theme } from './board-golden.js';
import { RESKIN_CLEAN } from './board-reskin-sample.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bundle = embeddedBundle() as Map<string, Buffer>;
const text = (name: string): string => bundle.get(name)!.toString('utf8');
/** The palette's own values: the reserved colours and the theme tokens, as the bundled palette source spells them. */
const PALETTE_OWN = new Set([...RESERVED, ...THEMES.flatMap((t) => Object.values(CONTENT_THEME_TOKENS[t]))].map((h) => h.toLowerCase()));

describe('G-DDL-07 one face, one size, exact strokes (the shipped bytes)', () => {
  it('the chunk names one font file, the bundle\'s own JetBrains Mono, which ships with its licence; the stylesheet declares no face', () => {
    const js = text('board/board.js');
    expect([...js.matchAll(/["'`]([^"'`]*\.(?:woff2?|ttf|otf))["'`]/g)].map((m) => m[1])).toEqual([`../${BOARD_FONT}`]);
    expect(bundle.has(BOARD_FONT)).toBe(true);
    expect(bundle.get(BOARD_FONT)!.equals(readFileSync(path.join(ROOT, 'static', 'fonts', 'JetBrainsMono-Regular.woff2')))).toBe(true);
    expect(text('fonts/OFL-JetBrainsMono.txt')).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(text('board/board.css')).not.toMatch(/@font-face/);
  });

  it('the font string is a constant and the registry holds one family', () => {
    const js = text('board/board.js');
    expect(js).toContain(`'"JetBrains Mono", monospace'`);
    expect(BOARD_FONT_STRING).toBe('<size>px "JetBrains Mono", monospace');
    // the registry call the patch writes, and none of the engine's own registrations
    expect(js).toMatch(/\("JetBrains Mono",\{uri:"\.\.\/fonts\/JetBrainsMono-Regular\.woff2"\}\)/);
    for (const family of ['Excalifont', 'Virgil', 'Nunito', 'Comic Shanns', 'Cascadia', 'Lilita One', 'Liberation Sans', 'Helvetica']) expect(js, family).not.toMatch(new RegExp(`\\("${family}"[,)]`));
    const src = readFileSync(path.join(ROOT, 'src', 'board', 'index.ts'), 'utf8');
    expect(src).toMatch(/BOARD_FONT_SIZE = 13\.5;/);
    expect(src).toMatch(/BOARD_FONT_ID = 10;/);
    expect(src).toMatch(/currentItemRoughness: 0,/);
    expect(src).toMatch(/currentItemStrokeStyle: 'solid',/);
  });

  it('every S1.1 patch is in the manifest', () => {
    const ids = (PATCHES as Array<{ id: string }>).map((p) => p.id);
    for (const id of ['font-family-table', 'font-defaults', 'font-metrics', 'font-family-string', 'font-registry-empty', 'image-tool-removed', 'roughness-zero', 'skin-frame', 'skin-marquee', 'layer-ui-removed', 'loading-message-removed', 'phone-layout-removed', 'toast-removed', 'link-popup-removed', 'context-menu-removed', 'image-insert-refused', 'key-actions-allowlist', 'key-dialogs-removed', 'key-tools-removed', 'text-size-keys-removed', 'api-run-action', 'skin-selection', 'skin-point-hover', 'skin-point-handles', 'skin-binding', 'skin-box-highlight', 'skin-transform-handles', 'skin-guides', 'skin-guide-literals', 'css-engine-violets', 'eraser-cursor']) expect(ids, id).toContain(id);
  });

  it('the rail is nine tools, three weights and eight key actions; nothing of the engine\'s tool list', () => {
    expect([...BOARD_TOOLS]).toEqual(TOOLS);
    for (const t of REFUSED_TOOLS as string[]) expect(BOARD_TOOLS as readonly string[]).not.toContain(t);
    expect(BOARD_WEIGHTS).toEqual({ fine: 2, bold: 4, marker: 8 });
    expect([...gnomonBoardKeyActions].sort()).toEqual(['deleteSelectedElements', 'finalize', 'redo', 'resetZoom', 'selectAll', 'undo', 'zoomIn', 'zoomOut']);
  });

  it('the skin is the theme tokens and nothing else', () => {
    for (const theme of THEMES) {
      const t = CONTENT_THEME_TOKENS[theme];
      const s = skinOf(theme);
      expect([s.ink, s.sec, s.sheet, s.selection, s.handle, s.guide, s.frame]).toEqual([t['text.primary'], t['text.secondary'], t['surface.sheet'], t['line.key-edge'], t['surface.sheet'], t['text.primary'], t['text.secondary']]);
      for (const wash of [s.handleHover, s.binding, s.wash]) expect((colourLiterals(wash) as Array<{ hex: string }>).map((l) => l.hex)).toEqual([wash === s.handleHover ? t['line.key-edge'] : t['text.primary']]);
    }
    // the harness composes captures on the desk ground and expects each theme's ink for the caret: the same tokens
    const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
    for (const theme of THEMES) expect(new RegExp(`\\[data-theme="${theme}"\\] \\{[^}]*--ground: (#[0-9A-F]{6});`).exec(css)?.[1]).toBe((GROUND as Record<Theme, string>)[theme]);
    for (const theme of THEMES) expect((RGB_INK as Record<Theme, string>)[theme]).toBe(`rgb(${[1, 3, 5].map((i) => parseInt(CONTENT_THEME_TOKENS[theme]['text.primary'].slice(i, i + 2), 16)).join(', ')})`);
  });
});

describe('G-DDL-07 no colour literal near a reserved colour outside the per-patch allowlist', () => {
  type Entry = { file: string; by: string; why: string; literals: string[] };
  const allow = COLOUR_ALLOWLIST as Entry[];

  it('the scanner reads hex and rgb()/rgba() literals (a guard that cannot see is no guard)', () => {
    const found = (colourLiterals('a{color:#6965DB;b:#abc;c:rgba(105, 101, 219, 0.4);d:rgb(0,118,255)}x="#5b57d1",y="#nothex",z="#12345"') as Array<{ literal: string; hex: string }>).map((l) => `${l.literal}=${l.hex}`);
    expect(found).toEqual(['#6965db=#6965DB', '#abc=#AABBCC', 'rgba(105,101,219,0.4)=#6965DB', 'rgb(0,118,255)=#0076FF', '#5b57d1=#5B57D1']);
    // the engine's violet family is inside the distance of state.knot: the oracle would catch each of them
    for (const violet of ['#6965DB', '#5B57D1', '#5753D0', '#A8A5FF']) expect(nearReserved(violet), violet).toBe(true);
    // measured: the darkest of the family, #4A47B1, is outside the distance; the patch replaces it all the same
    expect(nearReserved('#4A47B1')).toBe(false);
    expect(CONTENT_MIN_DISTANCE).toBe(0.06);
  });

  it('every entry names a real patch (or says it is unreached) and says why', () => {
    const ids = new Set((PATCHES as Array<{ id: string }>).map((p) => p.id));
    for (const e of allow) {
      expect(e.by === 'unreached' || ids.has(e.by), e.by).toBe(true);
      expect(e.why.length, e.by).toBeGreaterThan(30);
      expect(['board/board.js', 'board/board.css']).toContain(e.file);
    }
  });

  it.each(['board/board.js', 'board/board.css'])('%s: the near-reserved literals are exactly the allowlisted ones', (file) => {
    const near = new Set<string>();
    for (const l of colourLiterals(text(file)) as Array<{ literal: string; hex: string }>) if (nearReserved(l.hex) && !PALETTE_OWN.has(l.literal)) near.add(l.literal);
    const allowed = allow.filter((e) => e.file === file).flatMap((e) => e.literals);
    expect(new Set(allowed).size, 'an allowlisted literal is listed twice').toBe(allowed.length);
    expect([...near].sort()).toEqual([...allowed].sort());
  });

  it('the palette\'s own values appear only in board.js (the bundled palette source), never in the stylesheet', () => {
    const css = (colourLiterals(text('board/board.css')) as Array<{ literal: string; hex: string }>).filter((l) => RESERVED.map((r) => r.toLowerCase()).includes(l.literal));
    expect(css).toEqual([]);
    // the five engine violets are gone from the bytes, not merely overridden
    for (const f of ['board/board.js', 'board/board.css']) expect(text(f), f).not.toMatch(/#(?:6965db|5b57d1|5753d0|4a47b1|a8a5ff|5e5ad8)\b|rgba\(105, ?101, ?219|rgba\(134, ?131, ?226|rgba\(177, ?151, ?252/i);
  });
});

describe('G-DDL-07 the day and night goldens (decoded pixels)', () => {
  const names = [...THEMES.flatMap((t) => SHOTS.map((s) => `${s}-${t}`)), 'narrow-day'];

  it('the goldens are exactly the expected set', () => {
    expect(readdirSync(GOLDENS).filter((f) => f.endsWith('.png')).sort()).toEqual(names.map((n) => `${n}.png`).sort());
  });

  it.each(names)('%s holds no chromatic pixel within the minimum distance of a reserved colour', (name) => {
    const theme = name.endsWith('-night') ? 'night' : 'day';
    const png = golden(name);
    const { bad } = reservedPixels(png, theme);
    expect(bad).toEqual([]);
    // it is a capture of the board on that theme's ground, not a blank or a white slab
    const colours = pixelColours(png) as Map<string, number>;
    expect((colours.get((GROUND as Record<Theme, string>)[theme]) ?? 0) / (png.width * png.height)).toBeGreaterThan(0.5);
    expect(colours.has('#FFFFFF')).toBe(false);
    expect(colours.size).toBeGreaterThan(20);
  });

  it('the states differ from the plain marks: selection, the marquee, the binding highlight and the guides were drawn', () => {
    for (const theme of THEMES) for (const shot of SHOTS.filter((s) => s !== 'marks')) expect(differingShare(golden(`marks-${theme}`), golden(`${shot}-${theme}`)), `${shot}-${theme}`).toBeGreaterThan(0.0001);
  });

  it('the 374px board is a board, not a phone layout: the golden is the narrow pane, drawn on', () => {
    const png = golden('narrow-day');
    expect([png.width, png.height]).toEqual([NARROW.width, NARROW.height]);
  });

  it('the theme-mix exemption is narrow: an engine violet, a red guide and a blue marquee are not theme mixes', () => {
    for (const theme of THEMES) for (const engine of ['#6965DB', '#A8A5FF', '#FF6B6B', '#0076FF', '#5E5AD8', '#B4382A', '#A8CFCB']) expect(isThemeMix(engine, theme), `${engine} ${theme}`).toBe(false);
    expect(isThemeMix('#C9DCD6', 'night')).toBe(true);
    expect(isThemeMix('#BDCFC9', 'night')).toBe(true); // key-edge over the night ground, antialiased
  });

  it('the exempt theme token is counted, not hidden: night key-edge sits inside the distance of night sea-grey', () => {
    expect(coloursClear(CONTENT_THEME_TOKENS.night['line.key-edge'], CONTENT_RESERVED_COLOURS.night['sea-grey']!)).toBe(false);
    expect(reservedPixels(golden('marquee-night'), 'night').tokens).toBeGreaterThan(0);
    for (const theme of THEMES) for (const shot of SHOTS) if (theme === 'day') expect(reservedPixels(golden(`${shot}-${theme}`), theme).tokens, `${shot}-${theme}`).toBe(0);
  });
});

describe('G-DDL-07 predicate: what a clean reskin run reports (every OS)', () => {
  const problems = (patch: Record<string, unknown>): string => (reskinProblems({ ...RESKIN_CLEAN, ...patch }) as string[]).join(' | ');
  it('a clean run has no problem', () => {
    expect(reskinProblems(RESKIN_CLEAN)).toEqual([]);
  });
  it.each([
    ['a stock toolbar node', { stockNodes: ['.App-toolbar'] }, /stock engine nodes in the DOM: \.App-toolbar/],
    ['the phone layout', { narrow: { ...(RESKIN_CLEAN.narrow as object), stock: ['.excalidraw--mobile'] } }, /374px board/],
    ['an engine tool accepted by the handle', { refusedTools: { ...(RESKIN_CLEAN.refusedTools as object), image: 'accepted' } }, /accepted the engine tool image/],
    ['an engine tool key', { toolKeys: { a: 'arrow' } }, /engine tool key a chose arrow/],
    ['the command palette', { commandPalette: { stock: ['.Modal'], dialogs: 1 } }, /command palette keys opened something/],
    ['a Library opened by a dropped file', { libraryDrop: { stock: ['.sidebar'], added: 0 } }, /dropped library file/],
    ['an image inserted by a dropped file', { imageTool: { afterKey: 'select', handle: 'refused', node: false, addedByDrop: 1 } }, /image tool is reachable/],
    ['the image tool chosen by its key', { imageTool: { afterKey: 'image', handle: 'refused', node: false, addedByDrop: 0 } }, /image tool is reachable/],
    ['an engine family in a canvas font string', { canvasFonts: ['<size>px Excalifont, Xiaolai, Segoe UI Emoji'] }, /canvas font strings other than the board face/],
    ['an engine font face on the page', { fontFaces: ['JetBrains Mono 400 loaded', 'Virgil 400 loaded'] }, /font faces on the page/],
    ['the board face not loaded', { fontFaces: ['JetBrains Mono 400 unloaded'] }, /font faces on the page/],
    ['a rough edge', { edge: { profiles: 5, opaque: 40 } }, /not exact \(roughness 0\)/],
    ['a missing capture', { skin: { day: RESKIN_CLEAN.skin && (RESKIN_CLEAN.skin as Record<string, unknown>).day, night: { ...((RESKIN_CLEAN.skin as Record<string, object>).night), guides: null } } }, /no night guides capture/],
    ['a caret in another face', { skin: { day: { ...((RESKIN_CLEAN.skin as Record<string, object>).day), caret: { caretColor: 'rgb(22, 21, 15)', fontFamily: 'Virgil', editing: true } }, night: (RESKIN_CLEAN.skin as Record<string, unknown>).night } }, /day: the text caret/],
    ['a colour that fails the palette accepted as a line', { style: { ...(RESKIN_CLEAN.style as object), refusedFill: { ok: true } } }, /style through the handle/],
    ['zoom that does not move', { zoom: { start: 1, afterIn: 1, afterOut: 1, afterReset: 1 } }, /zoom through the handle/],
  ] as Array<[string, Record<string, unknown>, RegExp]>)('not clean: %s', (_name, patch, why) => {
    expect(problems(patch)).toMatch(why);
  });
  it('the stock selectors name the toolbar, the menu, the welcome screen and the image tool', () => {
    for (const q of ['.App-toolbar', '.main-menu-trigger', '.welcome-screen-center', '[data-testid="toolbar-image"]', '.excalidraw--mobile', '.help-icon', '.HintViewer', '.zoom-actions']) expect(STOCK_SELECTORS).toContain(q);
  });
});

