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
import { railLayout, railNeed } from '../src/core/board-rail.js';
import { differingShare, TOLERANCE, type Png } from './board-golden.js';

const DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'test', 'goldens', 'leaf');
const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }] as const;
const STATES = ['open', 'tray'] as const;
const THEMES = ['day', 'night'] as const;
const NAMES = SIZES.flatMap((s) => STATES.flatMap((st) => THEMES.map((t) => `leaf-${st}-${t}-${s.width}`)));
const golden = (name: string): Png => decodePng(readFileSync(path.join(DIR, `${name}.png`))) as Png;

type Rect = { x: number; y: number; w: number; h: number } | null;
interface Facts { overlay: { seals: number; stubs: number; stubWords: string[]; pins: number; textboxes: number }; foot: string; state: string; leaf: Rect; stage: Rect; rail: Rect; stack: Rect; pinned: Rect; composer: Rect; status: Rect; stock: string[] }
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
          // the fixture's hands are on the board, read from the fold's `by` (S1.3): 3 seals (two scraps and a text),
          // 2 stubs with their words, your 3 pins (a filled, labelled rect is a sticky: the broker is one), and five
          // hands in the foot (review round 2: a golden of a board with none of them once passed)
          expect(facts.overlay, name).toEqual({ seals: 3, stubs: 2, stubWords: ['kind live:session', 'kind allow:approved-by-you'], pins: 3, textboxes: 1 });
          if (size.width === 1440) expect(facts.foot, name).toBe('you 5 · A arky 3 · L luna 1 · Q quill 1 · unknown hand 1'); // each agent's seal letter, then its id (agents have no display name yet)
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
  const real = async (state: string, actions: unknown[], size: { width: number; height: number } = SIZES[0]): Promise<Acted> => ((await shootLeaf({ chrome, url: leafUrl(p.url, state, 'day'), ...size, timeoutMs: 120_000, actions })) as { acted: Acted }).acted;

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

  it('T-2026-11-25-004 (real paint): at EVERY height a board can have the rail is no taller than its room and no rail key meets the foot, with any tool chosen; the rail\'s arithmetic is its paint; a ⋯ menu stays inside the board', async () => {
    // the leaf is made 1px shorter at a time, from its whole height to the too-short state; then each tool is chosen
    // at the heights where the bug was reported (about 190px of board) and at the rail's own steps
    const SWEEP = `(async () => { const host = document.getElementById('preview-board'); const leaf = globalThis.gnomonPreviewLeaf; const hd = ${B}; const fr = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const full = Math.round(host.getBoundingClientRect().height); const chrome = full - leaf.room();
      const look = () => { const rail = host.querySelector('.bd-rail'); const foot = host.querySelector('.bd-foot').getBoundingClientRect(); const body = host.querySelector('.bd-body').getBoundingClientRect(); const keys = [...rail.querySelectorAll(':scope > .bd-row > button')].map((k) => k.getBoundingClientRect());
        const kids = [...rail.children]; const natural = 16 + kids.reduce((n, k) => n + (k.classList.contains('bd-grow') ? 4 : k.getBoundingClientRect().height + (k.classList.contains('bd-brk') ? 4 : 0)), 0) + 4 * (kids.length - 1);
        return { room: leaf.room(), body: Math.round(body.height), over: rail.scrollHeight - rail.clientHeight, lastKey: keys.length ? Math.round(foot.top - Math.max(...keys.map((k) => k.bottom))) : null, keys: keys.length, shortKey: keys.some((k) => Math.round(k.height) !== 28), natural: Math.round(natural), ticks: [...rail.querySelectorAll('.bd-brk')].filter((t) => t.getBoundingClientRect().height < 0.99).length, tight: rail.classList.contains('tight'), tools: [...rail.querySelectorAll('[data-tool]')].map((t) => t.dataset.tool), state: leaf.state() }; };
      const steps = []; let tooShortAt = null;
      for (let h = full; h >= chrome + 120; h--) { host.style.height = h + 'px'; await fr(); const s = look(); if (s.state === 'too-short') { tooShortAt = tooShortAt ?? s.room; continue; } steps.push(s); }
      const chosen = [];
      for (const room of [472, 408, 367, 312, 304, 271, 239, 232, 230, 229, 198, 197, 190, 161, 157, 156, 148]) { if (chrome + room > full) continue; host.style.height = (chrome + room) + 'px'; await fr();
        for (const t of ['select', 'sticky', 'text', 'rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand']) { hd.setTool(t); await fr(); const s = look(); chosen.push({ ...s, want: t, shown: s.tools.includes(t) || t === 'hand' }); } }
      // Mika R3: ONE abrupt shrink from the whole height (a pinned card arriving), to each side of every fold step
      hd.setTool('select'); const jumps = [];
      for (const room of [300, 266, 226, 197, 153, 150, 148]) { host.style.height = full + 'px'; await fr(); await fr(); host.style.height = (chrome + room) + 'px'; await fr(); jumps.push({ ...look(), target: room, keepH: Math.round(host.querySelector('.bd-keep').getBoundingClientRect().height), headH: Math.round(host.querySelector('.bd-head').getBoundingClientRect().height) }); }
      host.style.height = full + 'px'; await fr(); const rest = { keepH: Math.round(host.querySelector('.bd-keep').getBoundingClientRect().height), headH: Math.round(host.querySelector('.bd-head').getBoundingClientRect().height) };
      hd.setTool('select'); host.style.height = (chrome + 190) + 'px'; await fr();
      return { full, chrome, steps, chosen, tooShortAt, jumps, rest, at190: look() }; })()`;
    const MENU = `(() => { const host = document.getElementById('preview-board'); const m = host.querySelector('.bd-menu'); const st = host.querySelector('.bd-stage').getBoundingClientRect(); const leaf = host.querySelector('.bd-leaf').getBoundingClientRect(); if (!m) return null; const b = m.getBoundingClientRect(); const items = [...m.querySelectorAll('.bd-mi')];
      return { top: Math.round(b.top - st.top), bottom: Math.round(st.bottom - b.bottom), insideLeaf: b.top >= leaf.top && b.bottom <= leaf.bottom, items: items.map((i) => i.textContent), scrolls: m.scrollHeight > m.clientHeight + 1, firstReachable: (() => { const r = items[0].getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && items[0].contains(e); })() }; })()`;
    const acted = (await real('open', [ERRORS, { await: SWEEP, as: 'sweep' }, { press: '#preview-board [data-key="more"]' }, { read: MENU, as: 'menu' }, { press: '#preview-board .bd-menu .bd-mi' }, { read: TOOL, as: 'picked' }, { read: 'globalThis.__errs', as: 'errors' }], { width: 1024, height: 900 })) as Acted;
    type Step = { room: number; body: number; over: number; lastKey: number | null; keys: number; shortKey: boolean; natural: number; ticks: number; tight: boolean; tools: string[]; state: string };
    const sweep = acted.sweep as { full: number; chrome: number; steps: Step[]; chosen: Array<Step & { want: string; shown: boolean }>; tooShortAt: number | null; at190: Step; jumps: Array<Step & { target: number; keepH: number; headH: number }>; rest: { keepH: number; headH: number } };
    expect(acted.errors).toEqual([]);
    // the sweep really covered the short boards, down to the least the leaf draws
    expect(sweep.steps.length).toBeGreaterThan(200);
    for (const s of [...sweep.steps, ...sweep.chosen]) {
      const at = `board ${s.room}px${'want' in s ? `, ${String((s as { want: string }).want)} chosen` : ''}`;
      // the room the leaf reports is the body it draws (it was 3px more: the foot was counted as 29px of its 32)
      expect(s.body, at).toBe(s.room);
      expect(s.over, `${at}: the rail is taller than its room`).toBeLessThanOrEqual(0);
      expect(s.lastKey, `${at}: the last rail key is ${s.lastKey}px from the foot`).toBeGreaterThanOrEqual(4);
      expect(s.shortKey, `${at}: a key lost height`).toBe(false);
      expect(s.ticks, `${at}: a tick lost its height`).toBe(0);
      // what core/board-rail.ts adds up is what is painted
      expect(s.natural, at).toBe(railNeed(railLayout(s.room, ('want' in s ? (s as { want: string }).want : 'select') as never)));
      expect(s.natural, at).toBeLessThanOrEqual(s.room);
    }
    // Mika R3: after ONE abrupt shrink the head and the keep line keep their height, the leaf reads its real room,
    // and the rail is the layout of that room: 8px from the foot (24 when tight), never the taller one it had
    expect(sweep.jumps.map((j) => j.target)).toEqual([300, 266, 226, 197, 153, 150, 148]);
    for (const j of sweep.jumps) {
      const at = `one step down to ${j.target}px`;
      expect([j.headH, j.keepH], `${at}: the head or the keep line was squeezed`).toEqual([sweep.rest.headH, sweep.rest.keepH]);
      expect(j.room, at).toBe(j.target);
      expect(j.body, at).toBe(j.target);
      expect(j.natural, `${at}: the rail kept a layout taller than its room`).toBe(railNeed(railLayout(j.target)));
      expect(j.over, at).toBeLessThanOrEqual(0);
      expect(j.lastKey, `${at}: the last key is ${j.lastKey}px from the foot`).toBeGreaterThanOrEqual(8);
      expect(j.tight, at).toBe(j.target < 157);
    }
    // (after the rail-versus-room lines above, so a rail that overflows fails THERE and not at this count)
    expect(Math.min(...sweep.steps.map((s) => s.room))).toBe(148);
    expect(sweep.tooShortAt).toBe(147);
    for (const c of sweep.chosen) expect(c.shown, `board ${c.room}px: ${c.want} is chosen and not on the rail`).toBe(true);
    // the reported case: about 190px of board. Select, ⋯, line-and-fill and the percent, clear of the foot
    expect(sweep.at190).toMatchObject({ keys: 4, tools: ['select'], tight: false, over: 0 });
    // its ⋯ menu holds every other tool, lies inside the board's own area and its first row can be pressed
    const menu = acted.menu as { top: number; bottom: number; insideLeaf: boolean; items: string[]; scrolls: boolean; firstReachable: boolean };
    expect(menu.items.map((i) => i.replace(/[A-Z]$/, ''))).toEqual(['Sticky', 'Text', 'Rectangle', 'Ellipse', 'Arrow · connect', 'Frame', 'Stroke', 'Hand: drag to move the view'].map((n) => n.replace(/^Hand.*/, 'Hand')));
    expect(menu.top).toBeGreaterThanOrEqual(4);
    expect(menu.bottom).toBeGreaterThanOrEqual(0);
    expect(menu.insideLeaf).toBe(true);
    expect(menu.firstReachable).toBe(true);
    expect(acted.picked).toBe('sticky');
  }, 300_000);

  it('review round 2 (REAL input): a zoom-menu item returns focus to the board, and the custom colour lines read once', async () => {
    const acted = await real('open', [
      { press: '#preview-board [data-key="percent"]' },
      { press: '#preview-board .bd-menu .bd-mi' }, { read: ACTIVE, as: 'afterMenuItem' }, { read: `${B}.state().zoom > 1`, as: 'zoomed' },
      { press: '#preview-board [data-key="ink"]' },
      { read: "(() => { const f = document.querySelector('#preview-board .bd-hex'); f.focus(); f.value = '#111111'; f.dispatchEvent(new Event('input', { bubbles: true })); return [...document.querySelectorAll('#preview-board .bd-tr .meta, #preview-board .bd-refuse')].map((e) => e.textContent); })()", as: 'nearInk' },
    ]);
    expect(acted).toMatchObject({ afterMenuItem: 'board', zoomed: true });
    // #111111 passes as a line and is refused as a fill: one night value quoted, the role named once
    expect(acted.nearInk).toEqual([expect.stringMatching(/^custom · at night #[0-9A-F]{6} as a line$/), '✕ not used · as a fill it would hide the ink drawn on it']);
  }, 120_000);

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

  it('review S1 and S3, since C8 (a REAL paste in Chrome): pasted engine content is words, one text mark of yours; nothing in it can claim an author or a stub, and an iframe, an embeddable and an image never arrive (the cases are in test/board-c8.test.ts)', async () => {
    const el = (type: string, x: number, extra: object = {}): object => ({ type, id: `paste-${type}`, x, y: 0, width: 160, height: 90, angle: 0, strokeColor: '#e03131', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'dashed', roughness: 2, opacity: 40, roundness: { type: 3 }, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 1, link: null, locked: true, ...extra });
    const clip = JSON.stringify({ type: 'excalidraw/clipboard', elements: [el('rectangle', 0, { customData: { gnomon: { line: 'ink', fill: null, by: { cls: 'agent', id: 'arky', name: 'Arky' }, kind: 'stub', stubKind: 'allow:approved-by-you' } } }), el('iframe', 200), el('embeddable', 400, { link: 'https://example.invalid/e' }), el('image', 600, { fileId: 'f1', status: 'saved', scale: [1, 1] })], files: {} });
    const MARKS = `${B}.marks().map((m) => m.kind + ':' + m.author.cls + (m.kind === 'text' ? '' : ':' + Math.round(m.width) + 'x' + Math.round(m.height)))`;
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
    // exactly one mark arrived: the pasted JSON as words, a text of yours (not a rectangle, not an agent's, not a stub)
    expect(after.length - before.length, JSON.stringify(acted)).toBe(1);
    expect(after.filter((m) => m === 'text:human').length - before.filter((m) => m === 'text:human').length).toBe(1);
    expect(after.filter((m) => m.startsWith('stub') || m.startsWith('other')).length).toBe(before.filter((m) => m.startsWith('stub') || m.startsWith('other')).length);
    expect(acted.nodes).toEqual([]);
    // a copy of an agent's mark is a new element: it is yours, solid and unsealed (Alt-drag and copy/paste alike)
    const copied = await real('open', [
      { read: `${B}.marks().filter((m) => m.author.cls === 'agent').length`, as: 'agentBefore' },
      { read: `${B}.marks().length`, as: 'before' },
      { at: [262, 204], press: true }, // the edge of Arky's ellipse: selects it
      { read: `${B}.state().selected`, as: 'selected' },
      { key: 'c', meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', commands: ['copy'] },
      { key: 'v', meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', commands: ['paste'], settle: 800 },
      { read: `${B}.marks().length`, as: 'after' },
      { read: `${B}.marks().filter((m) => m.author.cls === 'agent').length`, as: 'agentAfter' },
    ]);
    // the copy came back as ONE more mark, and it is not the agent's
    expect(copied.selected).toBe(1);
    expect((copied.after as number) - (copied.before as number), JSON.stringify(copied)).toBe(2); // the ellipse and its label
    expect(copied.agentAfter, JSON.stringify(copied)).toBe(copied.agentBefore);
    // an SVG source pasted as text: its source arrives as words, and no image node is made (R5)
    const svg = await real('open', [
      { read: `${B}.count()`, as: 'before' },
      { at: [500, 330], press: true },
      { paste: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>', as: 'clipboard', settle: 900 },
      { read: `${B}.count()`, as: 'after' },
      { read: `${B}.state().selected`, as: 'selected' },
      { read: "document.querySelectorAll('#preview-board img').length", as: 'imgs' },
      { read: "document.querySelector('#preview-board .bd-keep').textContent", as: 'said' },
    ]);
    expect(svg).toMatchObject({ clipboard: 'written', imgs: 0 });
    expect((svg.after as number) - (svg.before as number)).toBe(1);
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
