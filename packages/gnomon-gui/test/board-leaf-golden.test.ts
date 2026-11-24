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
