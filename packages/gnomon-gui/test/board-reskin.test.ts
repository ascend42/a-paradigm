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
 * The pixel rule (Mika's pass A finding 8): on the ink-only goldens ANY chromatic pixel that is not a mix of the
 * theme's own colours fails, one pixel is enough, and none may sit near a reserved colour, with no exemption (the
 * selection is the ink in both themes). One golden per theme holds a mark in every content colour and allows
 * exactly those. One limit, stated: the text caret is DOM, not canvas, so it is checked as computed style.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_MIN_DISTANCE, CONTENT_RESERVED_COLOURS, CONTENT_THEME_TOKENS, coloursClear } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { BOARD_FONT, BOARD_FONT_STRING, embeddedBundle, exercisedChecks, GROUND, NARROW, REFUSED_TOOLS, reskinProblems, RGB_INK, STOCK_SELECTORS, TOOLS } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { colourLiterals, pixelColours } from '../scripts/board-colours.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { COLOUR_ALLOWLIST, PATCHES } from '../scripts/board-patches.mjs';
import { BOARD_TOOLS, BOARD_WEIGHTS } from '../src/core/board.js';
import { gnomonBoardKeyActions, SKIN_ALPHA, skinOf } from '../src/board/skin.js';
import { contentColours, differingShare, golden, GOLDENS, isMixOf, nearReserved, RESERVED, SHOTS, strayPixels, THEMES, type Theme } from './board-golden.js';
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
    const normal = readFileSync(path.join(ROOT, 'src', 'board', 'normal.ts'), 'utf8');
    expect(normal).toMatch(/BOARD_FONT_SIZE = 13\.5;/);
    expect(normal).toMatch(/BOARD_FONT_ID = 10;/);
    expect(src).toMatch(/currentItemRoughness: 0,/);
    expect(src).toMatch(/currentItemStrokeStyle: 'solid',/);
  });

  it('the handle has no add(), undo() or redo(), keeps no authorship record, and gives the engine only what the map built and the normal form completed (S1.3)', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'board', 'index.ts'), 'utf8');
    expect(src).not.toMatch(/convertToExcalidrawElements/);
    expect(src).not.toMatch(/\btrusted\b|skeletonOf|\badd\(marks|undo: \(\)|redo: \(\)/);
    // one place elements enter the scene from a state: dimToElements → complete (normalOf) → restoreElements
    expect(src.match(/dimToElements\(/g)).toHaveLength(1);
    expect(src.match(/restoreElements\(/g)).toHaveLength(1);
    expect(src).toMatch(/const out: Record<string, unknown> = \{ \.\.\.el, \.\.\.normalOf\(/);
    // every scene update the handle makes is outside the engine's history
    expect(src.match(/captureUpdate: CaptureUpdateAction\.NEVER/g)!.length).toBe(src.match(/captureUpdate:/g)!.length);
    // an engine id is minted by the handle and is never the node id
    expect(src).toMatch(/tie\(\(engineId = `g-\$\{crypto\.randomUUID\(\)\}`\), nodeId\)/);
    const core = readFileSync(path.join(ROOT, 'src', 'core', 'board.ts'), 'utf8');
    expect(core).not.toMatch(/\badd\(|\bundo\(\)|\bredo\(\)|interface BoardMark\b/);
  });

  it('every S1.1 patch is in the manifest', () => {
    const ids = (PATCHES as Array<{ id: string }>).map((p) => p.id);
    for (const id of ['font-family-table', 'font-defaults', 'font-metrics', 'font-family-string', 'font-registry-empty', 'image-tool-removed', 'roughness-zero', 'skin-frame', 'skin-marquee', 'layer-ui-removed', 'loading-message-removed', 'phone-layout-removed', 'toast-removed', 'link-popup-removed', 'context-menu-removed', 'image-insert-refused', 'key-actions-allowlist', 'key-dialogs-removed', 'key-tools-removed', 'text-size-keys-removed', 'api-run-action', 'paste-types-filtered', 'stroke-exact', 'frame-name-editor', 'frame-name-editor-ink', 'frame-name-editor-keys', 'frame-name-title', 'skin-selection', 'skin-point-hover', 'skin-point-handles', 'skin-binding', 'skin-box-highlight', 'skin-transform-handles', 'skin-guides', 'skin-guide-literals', 'css-engine-violets', 'eraser-cursor']) expect(ids, id).toContain(id);
  });

  it('the rail is nine tools, three weights and five key actions (⌘0 is the host\'s: it fits; undo and redo are the host\'s since S1.3); nothing of the engine\'s tool list', () => {
    expect([...BOARD_TOOLS]).toEqual(TOOLS);
    for (const t of REFUSED_TOOLS as string[]) expect(BOARD_TOOLS as readonly string[]).not.toContain(t);
    expect(BOARD_WEIGHTS).toEqual({ fine: 2, bold: 4, marker: 8 });
    expect([...gnomonBoardKeyActions].sort()).toEqual(['deleteSelectedElements', 'finalize', 'selectAll', 'zoomIn', 'zoomOut']);
  });

  it('the skin is the theme tokens and nothing else', () => {
    for (const theme of THEMES) {
      const t = CONTENT_THEME_TOKENS[theme];
      const s = skinOf(theme);
      expect([s.ink, s.sec, s.sheet, s.selection, s.handle, s.guide, s.frame]).toEqual([t['text.primary'], t['text.secondary'], t['surface.sheet'], t['text.primary'], t['surface.sheet'], t['text.primary'], t['text.secondary']]);
      for (const wash of [s.handleHover, s.binding, s.wash]) expect((colourLiterals(wash) as Array<{ hex: string }>).map((l) => l.hex)).toEqual([t['text.primary']]);
    }
    // the harness composes captures on the desk ground and expects each theme's ink for the caret: the same tokens
    const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
    // the selection is the ink in both themes (Mika's ruling): night key-edge sits inside the distance of sea-grey
    expect(coloursClear(CONTENT_THEME_TOKENS.night['line.key-edge'], CONTENT_RESERVED_COLOURS.night['sea-grey']!)).toBe(false);
    expect(SKIN_ALPHA).toEqual({ handleHover: 0.4, binding: 0.14, wash: 0.06 });
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
  const ink = [...THEMES.flatMap((t) => SHOTS.map((s) => `${s}-${t}`)), 'narrow-day'];
  const names = [...ink, 'colours-day', 'colours-night'];
  const themeOf = (name: string): Theme => (name.endsWith('-night') ? 'night' : 'day');

  it('the goldens are exactly the expected set', () => {
    expect(readdirSync(GOLDENS).filter((f) => f.endsWith('.png')).sort()).toEqual(names.map((n) => `${n}.png`).sort());
  });

  it.each(ink)('%s (ink only): not ONE chromatic pixel that is not a mix of the theme\'s own colours, and none near a reserved colour', (name) => {
    const theme = themeOf(name);
    const png = golden(name);
    expect(strayPixels(png, theme)).toEqual({ stray: [], reserved: [] });
    // it is a capture of the board on that theme's ground, not a blank or a white slab
    const colours = pixelColours(png) as Map<string, number>;
    expect((colours.get((GROUND as Record<Theme, string>)[theme]) ?? 0) / (png.width * png.height)).toBeGreaterThan(0.5);
    expect(colours.has('#FFFFFF')).toBe(false);
    expect(colours.size).toBeGreaterThan(20);
  });

  it.each(['colours-day', 'colours-night'])('%s: a mark in every content colour, and exactly those colours beside the theme\'s own', (name) => {
    const theme = themeOf(name);
    const png = golden(name);
    const allowed = contentColours(theme);
    expect(allowed).toHaveLength(14); // ink, graphite and five hues as lines; paper, lemon and five hues as fills
    expect(strayPixels(png, theme, allowed).stray).toEqual([]);
    // every content colour is really in the capture (the allowlist is exact, not generous)
    const colours = pixelColours(png) as Map<string, number>;
    for (const c of allowed) expect(colours.get(c) ?? 0, `${name} ${c}`).toBeGreaterThan(20);
    // and without the allowlist the same capture fails: the rule sees content colours
    expect(strayPixels(png, theme).stray.length).toBeGreaterThan(5);
  });

  it('the states differ from the plain marks: selection, the marquee, the binding highlight and the guides were drawn', () => {
    for (const theme of THEMES) for (const shot of SHOTS.filter((s) => s !== 'marks')) expect(differingShare(golden(`marks-${theme}`), golden(`${shot}-${theme}`)), `${shot}-${theme}`).toBeGreaterThan(0.0001);
  });

  it('the 374px board is a board, not a phone layout: the golden is the narrow pane, drawn on', () => {
    const png = golden('narrow-day');
    expect([png.width, png.height]).toEqual([NARROW.width, NARROW.height]);
  });

  it('the rule sees a stock colour come back: one pixel of an engine colour is stray, wherever it is and in either theme', () => {
    const palette = (theme: Theme): string[] => [...Object.values(CONTENT_THEME_TOKENS[theme]), (GROUND as Record<Theme, string>)[theme]];
    // the engine's violets and blues, its red guide, a reserved colour: none is a mix of a theme's own colours
    for (const theme of THEMES) for (const engine of ['#6965DB', '#A8A5FF', '#5E5AD8', '#0076FF', '#1971C2', '#FF6B6B', '#B4382A', '#A8CFCB']) expect(isMixOf(engine, palette(theme)), `${engine} ${theme}`).toBe(false);
    // planted: ONE violet pixel in an otherwise clean golden is reported (the 0.2% compare tolerance would pass it)
    for (const theme of THEMES) {
      const png = golden(`selection-${theme}`);
      const planted = { ...png, data: Buffer.from(png.data) };
      planted.data.set([0x69, 0x65, 0xdb], 4 * png.channels);
      expect(strayPixels(planted, theme).stray).toEqual([['#6965DB', 1]]);
      expect(differingShare(png, planted)).toBeLessThan(0.002);
    }
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
    ['an image inserted by a dropped file', { imageTool: { afterKey: 'select', handle: 'refused', node: false, addedByDrop: 1, refused: ['image:no-image-kind'], attempts: ['drop:1'] } }, /image tool is reachable/],
    ['the image tool chosen by its key', { imageTool: { afterKey: 'image', handle: 'refused', node: false, addedByDrop: 0, refused: ['image:no-image-kind'], attempts: ['drop:1'] } }, /image tool is reachable/],
    ['a refused image the host was never told about', { imageTool: { afterKey: 'select', handle: 'refused', node: false, addedByDrop: 0, refused: [], attempts: ['drop:1'] } }, /refused image was not reported to the host/],
    ['a host view that lost a mark', { hostView: { marks: ['rect:human:40,40,160,80'], view: { zoom: 1 }, focus: true } }, /host view of the marks/],
    ['an engine family in a canvas font string', { canvasFonts: ['<size>px Excalifont, Xiaolai, Segoe UI Emoji'] }, /canvas font strings other than the board face/],
    ['an engine font face on the page', { fontFaces: ['JetBrains Mono 400 loaded', 'Virgil 400 loaded'] }, /font faces on the page/],
    ['the board face not loaded', { fontFaces: ['JetBrains Mono 400 unloaded'] }, /font faces on the page/],
    ['a rough edge', { edge: { profiles: 5, opaque: 40 } }, /not exact \(roughness 0\)/],
    ['a missing capture', { skin: { day: RESKIN_CLEAN.skin && (RESKIN_CLEAN.skin as Record<string, unknown>).day, night: { ...((RESKIN_CLEAN.skin as Record<string, object>).night), guides: null } } }, /no night guides capture/],
    ['a caret in another face', { skin: { day: { ...((RESKIN_CLEAN.skin as Record<string, object>).day), caret: { caretColor: 'rgb(22, 21, 15)', fontFamily: 'Virgil', editing: true } }, night: (RESKIN_CLEAN.skin as Record<string, unknown>).night } }, /day: the text caret/],
    ['an undo that takes programmatic adds with it', { fix: { ...(RESKIN_CLEAN.fix as object), undo: { afterDraw: 2, afterUndo: 0 } } }, /undo after a programmatic add/],
    ['a click after a shape that only deselects', { fix: { ...(RESKIN_CLEAN.fix as object), textAfterShape: { selectedBefore: 1, selectedAfterTool: 1, editing: false } } }, /text did not start on the first click/],
    ['a dropped scene file that reached the engine', { fix: { ...(RESKIN_CLEAN.fix as object), sceneDrop: { added: 1, said: [], dragStopped: false } } }, /dropped scene file reached the board/],
    ['a pasted dashed mark that stayed dashed', { fix: { ...(RESKIN_CLEAN.fix as object), paste: { added: 1, said: ['mark:diamond', 'mark:line'], found: true, edgeGaps: 9, fillAlpha: 0, edgeRgb: [22, 21, 15], line: 'ink', fillToken: null } } }, /pasted engine content kept its stock look/],
    ['a drag of the library type with no file that reached the engine', { fix: { ...(RESKIN_CLEAN.fix as object), dataDrop: { added: 1, said: [], stopped: false, stock: [] } } }, /drag of the library type with no file reached the board/],
    ['a pasted mark that kept a forged author', { fix: { ...(RESKIN_CLEAN.fix as object), hostile: { added: 1, said: ['image', 'mark:embeddable', 'mark:iframe'], nodes: [], violations: 0, forged: { kind: 'rect', author: 'agent', stubKind: null, edgeGaps: 7 } } } }, /hostile pasted content got through/],
    ['a pasted mark that became a stub', { fix: { ...(RESKIN_CLEAN.fix as object), hostile: { added: 1, said: ['image', 'mark:embeddable', 'mark:iframe'], nodes: [], violations: 0, forged: { kind: 'stub', author: 'human', stubKind: 'allow:approved-by-you', edgeGaps: 0 } } } }, /hostile pasted content got through/],
    ['an iframe node that existed for one commit', { fix: { ...(RESKIN_CLEAN.fix as object), hostile: { added: 1, said: ['image', 'mark:embeddable', 'mark:iframe'], nodes: ['iframe'], violations: 0, forged: { kind: 'rect', author: 'human', stubKind: null, edgeGaps: 0 } } } }, /hostile pasted content got through/],
    ['an img node from a paste the browser otherwise ignored', { fix: { ...(RESKIN_CLEAN.fix as object), hostile: { unsupported: 'x', nodes: ['img'] } } }, /hostile pasted content got through/],
    ['a CSP violation raised by a paste', { fix: { ...(RESKIN_CLEAN.fix as object), hostile: { added: 1, said: ['image', 'mark:embeddable', 'mark:iframe'], nodes: [], violations: 2, forged: { kind: 'rect', author: 'human', stubKind: null, edgeGaps: 0 } } } }, /hostile pasted content got through/],
    ['host-added marks that all came back as yours (the engine replaced their ids)', { fix: { ...(RESKIN_CLEAN.fix as object), hands: ['rect:human:60', 'ellipse:human:60', 'rect:human:288', 'rect:human:80', 'text:human:62'], agentEdgeGaps: 0 } }, /marks added by the host lost their hand/],
    ['an agent mark drawn solid', { fix: { ...(RESKIN_CLEAN.fix as object), agentEdgeGaps: 0 } }, /marks added by the host lost their hand/],
    ['a stock frame title editor', { fix: { ...(RESKIN_CLEAN.fix as object), frame: { title: 'a frame title that is long enough to be cut off', weight: '600', editor: { fontFamily: 'Times', fontSize: '14px', fontWeight: '400', color: 'rgb(61, 61, 61)', radius: '4px', editing: true }, afterEsc: { input: true, editing: true } } } }, /the frame title/],
    ['a label in the current line colour', { fix: { ...(RESKIN_CLEAN.fix as object), label: { lines: ['raspberry'], marksAdded: 1 } } }, /a label in a sticky/],
    ['a missing content-colour capture', { colours: { day: RESKIN_CLEAN.colours && (RESKIN_CLEAN.colours as Record<string, unknown>).day } }, /no night content-colour capture/],
    ['a colour that fails the palette accepted as a line', { style: { ...(RESKIN_CLEAN.style as object), refusedFill: { ok: true } } }, /style through the handle/],
    ['zoom that does not move', { zoom: { start: 1, afterIn: 1, afterOut: 1, afterReset: 1 } }, /zoom through the handle/],
  ] as Array<[string, Record<string, unknown>, RegExp]>)('not clean: %s', (_name, patch, why) => {
    expect(problems(patch)).toMatch(why);
  });
  it('a check a browser reports as unsupported did NOT run there: it is not counted as exercised', () => {
    expect(Object.values(exercisedChecks(RESKIN_CLEAN)).every(Boolean)).toBe(true);
    const skipped = exercisedChecks({ ...RESKIN_CLEAN, libraryDrop: { unsupported: 'x' }, fix: { ...(RESKIN_CLEAN.fix as object), paste: { unsupported: 'x' }, hostile: { unsupported: 'x', nodes: [] }, dataDrop: { unsupported: 'x' } } }) as Record<string, boolean>;
    expect(skipped).toEqual({ 'library-file drop': false, 'image-file drop': true, 'scene-file drop': true, 'library-type drag (no file)': false, 'paste: stock marks': false, 'paste: forged author, iframe, embeddable, image': false });
    expect(Object.values(exercisedChecks({})).some(Boolean)).toBe(false);
  });
  it('the stock selectors name the toolbar, the menu, the welcome screen and the image tool', () => {
    for (const q of ['.App-toolbar', '.main-menu-trigger', '.welcome-screen-center', '[data-testid="toolbar-image"]', '.excalidraw--mobile', '.help-icon', '.HintViewer', '.zoom-actions']) expect(STOCK_SELECTORS).toContain(q);
  });
});

