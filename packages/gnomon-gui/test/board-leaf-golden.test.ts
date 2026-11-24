/**
 * G-DDL-07 leaf goldens and the live parts of G-DDL-08 (boards S1.1 pass B), on the dev preview's board fixture in a
 * real Chrome (scripts/board-leaf-shots.mjs: real time, DevTools protocol, device pixel ratio 1).
 *
 * Goldens: the leaf with its rail, and with the tray open, in day and night, at a 1440 window and at the 1024
 * window whose centre column is the 424px leaf. Compared as DECODED pixels with the tolerance of
 * test/board-golden.ts; GNOMON_UPDATE_GOLDENS=1 rewrites them. The committed goldens are checked on every OS for
 * their sizes; the capture and compare run only where a Chrome is installed, and never on CI.
 *
 * G-DDL-08 ("the board leaf covers the centre column only and no board key is handled while a card is focused,
 * under every layout preset") is an S1.3 oracle: the leaf it speaks of is not built. What exists is checked here:
 * in the fixture layout the leaf never overlaps the stack, the pinned cards, the composer or the status line, and
 * with a card focused no rail letter and no untrusted press changes anything. WAITING for S1.3: every layout
 * preset, the leaf opened by the app itself, and the trusted waking press (a synthetic event is never trusted).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { decodePng } from '../scripts/board-colours.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { differingShare, TOLERANCE, type Png } from './board-golden.js';

const DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'test', 'goldens', 'leaf');
const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }] as const;
const STATES = ['open', 'tray'] as const;
const THEMES = ['day', 'night'] as const;
const NAMES = SIZES.flatMap((s) => STATES.flatMap((st) => THEMES.map((t) => `leaf-${st}-${t}-${s.width}`)));
const golden = (name: string): Png => decodePng(readFileSync(path.join(DIR, `${name}.png`))) as Png;

type Rect = { x: number; y: number; w: number; h: number } | null;
interface Facts { state: string; leaf: Rect; stage: Rect; rail: Rect; stack: Rect; pinned: Rect; composer: Rect; status: Rect; stock: string[] }
const overlaps = (a: Rect, b: Rect): boolean => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('G-DDL-07 leaf goldens (the committed files, every OS)', () => {
  it('are exactly the expected set, at the leaf\'s two widths', () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()).toEqual(NAMES.map((n) => `${n}.png`).sort());
    for (const n of NAMES) {
      const png = golden(n);
      // the centre column: 840px at a 1440 window, 424px at a 1024 window, less the pane's 1px edge
      expect(png.width, n).toBe(n.endsWith('-1440') ? 839 : 423);
      expect(png.height, n).toBeGreaterThan(300);
    }
  });
  it('the tray golden differs from the open one, and night from day', () => {
    for (const s of SIZES) for (const t of THEMES) expect(differingShare(golden(`leaf-open-${t}-${s.width}`), golden(`leaf-tray-${t}-${s.width}`)), `${t} ${s.width}`).toBeGreaterThan(0.01);
    for (const s of SIZES) expect(differingShare(golden(`leaf-open-day-${s.width}`), golden(`leaf-open-night-${s.width}`))).toBeGreaterThan(0.5);
  });
});

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('the board leaf in a real Chrome (dev preview fixture)', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());

  it('G-DDL-07: the leaf with rail and tray matches its goldens, day and night, at 1440 and at the 424px centre', async () => {
    for (const size of SIZES) {
      for (const state of STATES) {
        for (const theme of THEMES) {
          const name = `leaf-${state}-${theme}-${size.width}`;
          const { png, facts } = (await shootLeaf({ chrome, url: leafUrl(p.url, state, theme), ...size, clip: true })) as { png: Buffer; facts: Facts };
          expect(facts.state, name).toBe('open');
          expect(facts.stock, name).toEqual([]);
          if (process.env.GNOMON_UPDATE_GOLDENS === '1') {
            if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
            writeFileSync(path.join(DIR, `${name}.png`), png);
          } else expect(differingShare(golden(name), decodePng(png) as Png), `${name}: share of pixels more than ${TOLERANCE.channel} apart`).toBeLessThanOrEqual(TOLERANCE.share);
        }
      }
    }
  }, 300_000);

  it('G-DDL-08 (fixture layout): the leaf never covers the stack, the pinned cards, the composer or the status line', async () => {
    for (const size of SIZES) {
      for (const state of ['open', 'tray', 'yielded', 'failed', 'tiny']) {
        const { facts } = (await shootLeaf({ chrome, url: leafUrl(p.url, state, 'day'), ...size })) as { facts: Facts };
        for (const zone of ['stack', 'pinned', 'composer', 'status'] as const) {
          expect(facts[zone], `${state} ${size.width}: ${zone} is on the page`).not.toBeNull();
          expect(overlaps(facts.leaf, facts[zone]), `${state} ${size.width}: the leaf overlaps ${zone}`).toBe(false);
        }
        expect(facts.state, `${state} ${size.width}`).toBe(state === 'tray' ? 'open' : state === 'tiny' ? 'too-short' : state);
      }
    }
  }, 300_000);

  const B = 'globalThis.gnomonPreviewBoard';
  const TOOL = `${B}.state().tool`;
  const ACTIVE = "document.activeElement ? (document.activeElement.getAttribute('data-key') || (document.activeElement.closest('.bd-board') ? 'board' : document.activeElement.tagName.toLowerCase())) : null";
  const TRAY_OPEN = "!document.querySelector('#preview-board .bd-tray').hidden";
  const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), 1)", as: 'listening' };
  type Acted = Record<string, unknown>;
  const real = async (state: string, actions: unknown[], size = SIZES[0]): Promise<Acted> => ((await shootLeaf({ chrome, url: leafUrl(p.url, state, 'day'), ...size, actions })) as { acted: Acted }).acted;

  it('review B1 (REAL pointer and keys): every rail key takes its press, the tray opens by pointer, Tab and the arrows walk the whole rail', async () => {
    const tools = ['rect', 'ellipse', 'arrow', 'frame', 'stroke', 'sticky', 'text', 'hand', 'select'];
    const acted = await real('open', [
      ERRORS,
      ...tools.flatMap((t) => [{ press: `#preview-board [data-key="tool:${t}"]` }, { read: TOOL, as: `press:${t}` }]),
      { press: '#preview-board [data-key="ink"]' }, { read: TRAY_OPEN, as: 'trayByPointer' },
      { press: '#preview-board [data-key="ink"]' }, { read: TRAY_OPEN, as: 'trayClosedByPointer' },
      { press: '#preview-board [data-key="percent"]' }, { read: "!!document.querySelector('#preview-board .bd-menu')", as: 'zoomMenuByPointer' },
      { key: 'Escape' },
      // by keyboard: from the head's esc key, Tab lands on the rail's one tab stop; the arrows walk every key and wrap
      { read: "(document.querySelector('#preview-board .bd-head .key:last-child').focus(), 1)", as: 'f' },
      { key: 'Tab' }, { read: ACTIVE, as: 'tabInto' },
      ...Array.from({ length: 11 }, (_, i) => [{ key: 'ArrowDown' }, { read: ACTIVE, as: `down${i}` }]).flat(),
      { key: 'ArrowUp' }, { read: ACTIVE, as: 'up' },
      { key: 'Tab' }, { read: ACTIVE, as: 'tabOut' },
      { read: 'globalThis.__errs', as: 'errors' },
    ]);
    for (const t of tools) expect(acted[`press:${t}`], `a pointer press on ${t}`).toBe(t);
    expect([acted.trayByPointer, acted.trayClosedByPointer, acted.zoomMenuByPointer]).toEqual([true, false, true]);
    expect(acted.tabInto).toBe('tool:select');
    const walk = Array.from({ length: 11 }, (_, i) => acted[`down${i}`]);
    expect(walk).toEqual(['tool:sticky', 'tool:text', 'tool:rect', 'tool:ellipse', 'tool:arrow', 'tool:frame', 'tool:stroke', 'ink', 'tool:hand', 'percent', 'tool:select']);
    expect(acted.up).toBe('percent');
    expect(acted.tabOut).toBe('board'); // the board is the next stop; focus never falls to the page body
    expect(acted.errors).toEqual([]); // no "Maximum call stack size exceeded"
  }, 120_000);

  it('review B2 (REAL pointer and keys): choosing a well keeps focus in the tray, so Esc closes it and the letters work', async () => {
    const acted = await real('open', [
      ERRORS,
      { press: '#preview-board [data-key="ink"]' },
      { press: '#preview-board [data-key="line:cobalt"]' }, { read: `${B}.state().style.line`, as: 'line' }, { read: ACTIVE, as: 'afterLineWell' },
      { key: 'ArrowRight' }, { read: ACTIVE, as: 'arrowInRow' },
      { press: '#preview-board [data-key="fill:lemon"]' }, { read: `${B}.state().style.fill`, as: 'fill' }, { read: ACTIVE, as: 'afterFillWell' },
      { press: '#preview-board [data-key="weight:bold"]' }, { read: `${B}.state().style.weight`, as: 'weight' }, { read: ACTIVE, as: 'afterWeight' },
      { key: 'Escape' }, { read: TRAY_OPEN, as: 'openAfterEsc' }, { read: ACTIVE, as: 'afterEsc' },
      { key: 'r' }, { read: TOOL, as: 'letterAfterTray' },
      { read: 'globalThis.__errs', as: 'errors' },
    ]);
    expect(acted).toMatchObject({ line: 'cobalt', afterLineWell: 'line:cobalt', arrowInRow: 'line:orchid', fill: 'lemon', afterFillWell: 'fill:lemon', weight: 'bold', afterWeight: 'weight:bold', openAfterEsc: false, afterEsc: 'board', letterAfterTray: 'rect', errors: [] });
  }, 120_000);

  it('review B3: at a short window NO state draws anything over the stack, the pinned cards, the composer or the status line', async () => {
    for (const state of ['open', 'tray', 'empty', 'yielded', 'loading', 'failed', 'crashed']) {
      const { facts, acted } = (await shootLeaf({ chrome, url: leafUrl(p.url, state, 'day'), width: 1024, height: 560, actions: [{ read: "(() => { const l = document.querySelector('#preview-board .bd-leaf').getBoundingClientRect(); return [...document.querySelectorAll('#preview-board .bd-leaf *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && (b.bottom > l.bottom + 1 || b.right > l.right + 1) && !e.closest('[hidden]') && document.elementFromPoint(Math.min(b.right - 1, innerWidth - 1), Math.min(b.bottom - 1, innerHeight - 1)) === e; }).map((e) => e.className || e.tagName); })()", as: 'outside' }, { read: "document.querySelector('#preview-board .bd-keep').textContent", as: 'keep' }, { read: "document.querySelector('#preview-board .bd-leaf').classList.contains('too-short')", as: 'short' }] })) as { facts: Facts; acted: Acted };
      for (const zone of ['stack', 'pinned', 'composer', 'status'] as const) expect(overlaps(facts.leaf, facts[zone]), `${state}: the leaf overlaps ${zone}`).toBe(false);
      expect(acted.outside, `${state}: drawn outside the leaf`).toEqual([]);
      expect(acted.short, `${state}: under the least height nothing of the body is drawn`).toBe(true);
      expect(facts.rail?.h ?? 0, `${state}: the rail`).toBe(0);
      if (state === 'failed') expect(acted.keep).toBe('The board didn’t open · A part of it did not load.');
    }
  }, 300_000);

  it('review S4 (REAL input): while a card has the keys, a double-click, a wheel and a key change nothing; one press only wakes the board', async () => {
    const VIEW = `JSON.stringify(${B}.view())`;
    const acted = await real('open', [
      { read: VIEW, as: 'view0' }, { read: `${B}.count()`, as: 'count0' },
      { read: "(document.querySelector('#pinned .card button, #stack .card button').focus(), globalThis.gnomonPreviewLeaf.state())", as: 'leaf' },
      { dbl: '#preview-board .bd-stage', settle: 250 }, { read: `${B}.state().editingText`, as: 'editingAfterDbl' }, { read: `${B}.count()`, as: 'countAfterDbl' },
    ]);
    // the double-click's first press woke the board (focus moved, nothing drawn); it must not have started a text
    expect(acted, JSON.stringify(acted)).toMatchObject({ leaf: 'yielded', editingAfterDbl: false });
    expect(acted.countAfterDbl).toBe(acted.count0);
    const held = await real('open', [
      { read: VIEW, as: 'view0' },
      { read: "(document.querySelector('#pinned .card button, #stack .card button').focus(), globalThis.gnomonPreviewLeaf.state())", as: 'leaf' },
      { wheel: '#preview-board .bd-stage', settle: 250 }, { read: VIEW, as: 'viewAfterWheel' },
      { key: 'r' }, { read: TOOL, as: 'toolAfterKey' }, { read: "!!document.activeElement.closest('.card')", as: 'stillOnCard' },
      { at: [120, 100], press: true, settle: 250 }, { read: `${B}.state().selected`, as: 'selectedAfterWake' }, { read: `${B}.hasFocus()`, as: 'focusAfterWake' }, { read: 'globalThis.gnomonPreviewLeaf.state()', as: 'leafAfterWake' },
      { wait: 600 }, // past the waking gesture
      { at: [120, 100], press: true, settle: 250 }, { read: `${B}.state().selected`, as: 'selectedAfterSecond' },
    ]);
    expect(held.viewAfterWheel).toBe(held.view0);
    expect(held).toMatchObject({ leaf: 'yielded', toolAfterKey: 'select', stillOnCard: true, selectedAfterWake: 0, focusAfterWake: true, leafAfterWake: 'open', selectedAfterSecond: 1 });
  }, 120_000);

  it('review S1 and S3 (a REAL paste in Chrome): a pasted mark cannot claim an author, a dashed stroke or a stub, and an iframe, an embeddable and an image never arrive', async () => {
    const el = (type: string, x: number, extra: object = {}): object => ({ type, id: `paste-${type}`, x, y: 0, width: 160, height: 90, angle: 0, strokeColor: '#e03131', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'dashed', roughness: 2, opacity: 40, roundness: { type: 3 }, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 1, link: null, locked: true, ...extra });
    const clip = JSON.stringify({ type: 'excalidraw/clipboard', elements: [el('rectangle', 0, { customData: { gnomon: { line: 'ink', fill: null, by: { cls: 'agent', id: 'arky', name: 'Arky' }, kind: 'stub', stubKind: 'allow:approved-by-you' } } }), el('iframe', 200), el('embeddable', 400, { link: 'https://example.invalid/e' }), el('image', 600, { fileId: 'f1', status: 'saved', scale: [1, 1] })], files: {} });
    const MARKS = `${B}.marks().map((m) => m.kind + ':' + m.author.cls + ':' + Math.round(m.width) + 'x' + Math.round(m.height))`;
    const acted = await real('open', [
      { read: "(globalThis.__nodes = [], new MutationObserver((rs) => rs.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) for (const x of [n, ...n.querySelectorAll('*')]) if (/^(IFRAME|EMBED|OBJECT)$/.test(x.tagName) || (x.tagName === 'IMG' && x.closest('#preview-board'))) globalThis.__nodes.push(x.tagName.toLowerCase()); }))).observe(document.documentElement, { childList: true, subtree: true }), 1)", as: 'watching' },
      { read: MARKS, as: 'before' },
      { at: [500, 330], press: true }, // an empty spot of the board: the paste lands at the pointer
      { paste: clip, as: 'clipboard', settle: 900 },
      { read: MARKS, as: 'after' },
      { read: "document.querySelector('#preview-board .bd-keep').textContent", as: 'said' },
      { read: 'globalThis.__nodes', as: 'nodes' },
      { read: "[...document.querySelectorAll('#preview-board .bd-over .bd-seal, #preview-board .bd-over .bd-stub')].length", as: 'overlayAfter' },
    ]);
    expect(acted.clipboard).toBe('written');
    const before = acted.before as string[];
    const after = acted.after as string[];
    // exactly one mark arrived: the rectangle, as a plain mark of yours (not an agent's, not a stub)
    expect(after.length - before.length, JSON.stringify(acted)).toBe(1);
    expect(after.filter((m) => !before.includes(m))).toEqual(['rect:human:160x90']);
    expect(acted.nodes).toEqual([]);
    expect(String(acted.said)).toMatch(/isn’t a board mark|Images can’t go on a board/);
  }, 120_000);

  it('G-DDL-08 (keys): a rail letter acts with the board focused and does nothing while a card is focused; a refused colour changes nothing', async () => {
    const script = `
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const leaf = globalThis.gnomonPreviewLeaf, h = globalThis.gnomonPreviewBoard, root = document.getElementById('preview-board');
      const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const out = {};
      h.focus(); await wait(80);
      out.boardHasFocus = h.hasFocus();
      key('r'); await wait(80); out.withBoardFocused = h.state().tool;
      key('Escape'); await wait(80); out.afterEscape = h.state().tool;
      const card = document.querySelector('#pinned .card button, #stack .card button');
      card.focus(); await wait(120);
      out.leafWhileCard = leaf.state();
      out.keepLine = root.querySelector('.bd-keep').textContent;
      out.railDisabled = [...root.querySelectorAll('.bd-rail button')].every((b) => b.getAttribute('aria-disabled') === 'true');
      for (const k of ['r', 'n', 't', 'o', 'c', 'f', 'p', 'h', 'v', 'Escape']) { key(k); await wait(20); }
      await wait(80); out.withCardFocused = h.state().tool;
      out.focusStayedOnCard = !!document.activeElement.closest('.card');
      // an untrusted press on the board and on a rail key while yielded: nothing chosen, nothing drawn, focus not moved
      const before = h.count();
      const cv = root.querySelector('canvas.interactive'), b = cv.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: b.x + 110, clientY: b.y + 95, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }));
      root.querySelector('[data-tool="rect"]').click();
      await wait(120);
      out.afterYieldedPress = { tool: h.state().tool, selected: h.state().selected, added: h.count() - before, focusOnCard: !!document.activeElement.closest('.card') };
      // the tray: a refused colour shows why and an offer, and applies nothing
      h.focus(); await wait(120);
      root.querySelector('.bd-ink').click(); await wait(80);
      const styleBefore = JSON.stringify(h.state().style);
      root.querySelector('.bd-hex').focus(); await wait(60);
      const f = root.querySelector('.bd-hex');
      f.value = '#B4382A'; f.dispatchEvent(new Event('input', { bubbles: true })); await wait(60);
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(60);
      out.refusal = { line: root.querySelector('.bd-refuse')?.textContent, offers: [...root.querySelectorAll('.bd-refuse-row button')].map((x) => x.textContent), unchanged: JSON.stringify(h.state().style) === styleBefore, lettersWhileTyping: (key('n'), await wait(60), h.state().tool) };
      root.querySelector('.bd-refuse-row button').click(); await wait(80);
      out.afterOffer = h.state().style.line;
      return out;`;
    const { scripted } = (await shootLeaf({ chrome, url: leafUrl(p.url, 'open', 'day'), width: 1440, height: 900, script })) as { scripted: Record<string, unknown> };
    expect(scripted).toEqual({
      boardHasFocus: true,
      withBoardFocused: 'rect',
      afterEscape: 'select',
      leafWhileCard: 'yielded',
      keepLine: '◆ A card has the keys · click the board to draw',
      railDisabled: true,
      withCardFocused: 'select',
      focusStayedOnCard: true,
      afterYieldedPress: { tool: 'select', selected: 0, added: 0, focusOnCard: true },
      refusal: { line: '✕ not used · that is the failed colour', offers: ['Use raspberry'], unchanged: true, lettersWhileTyping: 'select' },
      afterOffer: 'raspberry',
    });
  }, 120_000);
});
