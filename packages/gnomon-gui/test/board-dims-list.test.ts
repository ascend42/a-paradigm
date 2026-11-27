/**
 * S1.4 the Dimensions list (design components.dimension-list; S1.3 P4b-3 rulings "Dimensions list"; Aegis C4.1 to
 * C4.8; Mika D1 to D6), in a REAL engine and a real Chrome (skipped on CI; run locally, alone, with a Chrome
 * installed). The preview's `&dims=1` gives the leaf its head key's own list over fixture listings, through the real
 * core/board-open.ts rows; a press is checked at the press as the dock checks it. With GNOMON_SHOTS_DIR set it saves
 * the list open, day and night, at 1024, 1280, 1440 and a 560 window, for Mika.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';

const LEAF = 'globalThis.gnomonPreviewLeaf';
const ME = 'hsid-preview';
const OTHER = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const today = new Date();
const at = (h: number, m: number): string => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).toISOString();
const L = (n: number, o: Record<string, unknown> = {}) => ({ dim: `dim:01HDIM${String(n).padStart(20, '0')}`, title: `Board ${n}`, repo: 'repo:aa', firstSeq: n, lastSeq: n * 10, rows: 4, nodes: 2, ended: false, attached: [ME], firstAt: at(9, 0), lastAt: at(10, n % 60), partial: false, ...o });
const set = (d: Record<string, unknown>): string => `(globalThis.gnomonPreviewDims = Object.assign({ listings: [], hsid: '${ME}', repo: null, openDim: null, check: null, opening: [], names: { '${ME}': 'Totals are off by a cent', '${OTHER}': 'billing-ui follow-up' } }, ${JSON.stringify(d)}), 1)`;
const KEY = '.bd-leaf .bd-head .key[aria-controls^="bd-dims-"]';
const rows = `[...document.querySelectorAll('.bd-dims .bd-dr')].map((r) => ({ dim: r.dataset.dim, title: r.querySelector('.t').textContent, l2: r.querySelector('.l2').textContent, mark: r.querySelector('.dm').textContent, checked: r.getAttribute('aria-checked'), role: r.getAttribute('role'), disabled: r.getAttribute('aria-disabled') }))`;
const active = `(() => { const a = document.activeElement; return a ? (a.dataset && a.dataset.dim ? 'row:' + a.dataset.dim : a.className || a.tagName) : null; })()`;
const presses = '(globalThis.gnomonPreviewDimPresses ?? [])';
const SHOTS = process.env.GNOMON_SHOTS_DIR ?? '';
const keep = (name: string, png: Buffer): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `dl-${name}.png`), png);
};

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('S1.4 the Dimensions list under the head key, in a real engine', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { theme?: 'day' | 'night'; width?: number; height?: number; shot?: string; board?: string } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: `${leafUrl(p.url, o.board ?? 'open', o.theme ?? 'day', 'empty')}&dims=1`, width: o.width ?? 1280, height: o.height ?? 800, timeoutMs: 90_000, actions })) as { png: Buffer; acted: Record<string, unknown> };
    if (o.shot) keep(o.shot, r.png);
    return r.acted;
  };
  const SAMPLE = {
    openDim: L(3).dim,
    check: { line: 'checked up to the last change', bad: false },
    opening: [{ dim: 'dim:01HPENDING000000000000000', title: '' }],
    listings: [
      L(1, { title: 'Release checklist', ended: true, lastAt: '2025-11-24T10:00:00.000Z' }),
      L(2, { title: 'Voice ladder sketch', ended: true, partial: true }),
      L(3, { title: 'Totals are off by a cent' }),
      L(4, { title: 'Mods bridge map', attached: [ME, OTHER] }),
      L(5, { title: 'auth handoff and the mods bridge credential', attached: [OTHER] }),
    ],
  };

  it('the head key opens the leaf\'s own list (role menu, menuitemradio rows, aria-checked on the open row, which is first and focused); the rows\' words; Esc closes it ONLY, focus back on the key', async () => {
    const a = await real([
      { read: set(SAMPLE), as: 's' }, { wait: 100 },
      { read: `(() => { const k = document.querySelector('${KEY}'); return { popup: k.getAttribute('aria-haspopup'), expanded: k.getAttribute('aria-expanded'), title: k.title }; })()`, as: 'key' },
      { press: KEY }, { wait: 300 },
      { read: rows, as: 'rows' }, { read: active, as: 'focus' },
      { read: `(() => { const m = document.querySelector('.bd-dims'); return { role: m.getAttribute('role'), label: m.getAttribute('aria-label'), afterKey: m.previousElementSibling === document.querySelector('${KEY}'), find: m.querySelector('.bd-dfind').textContent, expanded: document.querySelector('${KEY}').getAttribute('aria-expanded') }; })()`, as: 'menu' },
      { key: 'Escape' }, { wait: 200 },
      { read: `!!document.querySelector('.bd-dims')`, as: 'stillOpen' }, { read: active, as: 'back' }, { read: `globalThis.gnomonPreviewFolds ?? 0`, as: 'folds' }, { read: presses, as: 'presses' },
    ]);
    expect(a.key).toEqual({ popup: 'menu', expanded: 'false', title: 'Dimensions in this project' });
    expect(a.menu).toEqual({ role: 'menu', label: 'Dimensions in this project', afterKey: true, find: 'Find a dimension…/boards', expanded: 'true' });
    const r = a.rows as Array<{ title: string; l2: string; mark: string; checked: string; role: string }>;
    expect(r.map((x) => [x.mark, x.title, x.l2])).toEqual([
      ['●', 'Totals are off by a cent', 'open here · checked up to the last change'],
      ['…', 'Untitled', 'didn’t finish opening · a press tries again'],
      ['●', 'auth handoff and the mods bridge credential', '◇ billing-ui foll… · opening attaches this session'],
      ['●', 'Mods bridge map', 'attached ◇ Totals are off… +1'],
      ['○', 'Voice ladder sketch', 'folded · opening shows part of it'],
      ['○', 'Release checklist', 'folded · opening starts it again'],
    ]);
    expect(r.map((x) => x.checked)).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(new Set(r.map((x) => x.role))).toEqual(new Set(['menuitemradio']));
    expect(a.focus).toBe(`row:${L(3).dim}`);
    expect(a.stillOpen).toBe(false);
    expect(a.back).toMatch(/^key quiet/);
    expect(a.folds).toBe(0);
    expect(a.presses).toEqual([]);
  }, 180_000);

  it('aegis C4.1: listings of two repos show one project\'s rows; C4.2: a title that fails reads Untitled, control and bidi characters go, set as text', async () => {
    const a = await real([
      { read: set({ listings: [L(1, { title: 'mine' }), L(2, { title: 'theirs', repo: 'repo:bb', attached: [OTHER] }), L(3, { title: '‮evil\u0007 <img src=x onerror=globalThis.__x=1>' }), L(4, { title: '​\u0000' })] }), as: 's' },
      { press: KEY }, { wait: 300 }, { read: rows, as: 'rows' }, { read: `[document.querySelectorAll('.bd-dims img').length, globalThis.__x ?? null]`, as: 'img' },
    ]);
    const t = (a.rows as Array<{ title: string }>).map((x) => x.title);
    expect(t).not.toContain('theirs');
    expect(t).toContain('mine');
    expect(t).toContain('Untitled');
    const evil = t.find((x) => x.includes('evil'))!;
    expect(evil).not.toMatch(/[‮\u0007]/);
    expect(a.img).toEqual([0, null]);
  }, 180_000);

  it('mika D1: with 50 rows the open row (the oldest) is first and in view; D2: the rows that scroll are cut through a second line; the find row stays in view', async () => {
    const many = Array.from({ length: 50 }, (_, i) => L(i + 1));
    const a = await real([
      { read: set({ listings: many, openDim: L(1).dim, check: { line: 'checked up to the last change', bad: false } }), as: 's' },
      { press: KEY }, { wait: 300 },
      { read: `(() => { const m = document.querySelector('.bd-dims').getBoundingClientRect(); const cur = document.querySelector('.bd-dims .bd-dr.current').getBoundingClientRect(); const sc = document.querySelector('.bd-dscroll'); const s = sc.getBoundingClientRect(); const cutRow = [...sc.querySelectorAll('.bd-dr')].find((r) => { const b = r.getBoundingClientRect(); return b.top < s.bottom && b.bottom > s.bottom; }); const l2 = cutRow ? cutRow.querySelector('.l2').getBoundingClientRect() : null; const find = document.querySelector('.bd-dfind').getBoundingClientRect(); const foot = document.querySelector('.bd-foot').getBoundingClientRect(); return { first: document.querySelector('.bd-dims > .bd-dr') === document.querySelector('.bd-dr.current'), inView: cur.top >= m.top && cur.bottom <= m.bottom, scrolls: sc.scrollHeight > sc.clientHeight, cutInL2: !!l2 && l2.top < s.bottom && l2.bottom > s.bottom, cutAt: cutRow ? Math.round(s.bottom - cutRow.getBoundingClientRect().top) : null, findIn: find.bottom <= m.bottom + 0.5, aboveFoot: m.bottom <= foot.top - 7.5 }; })()`, as: 'geo' },
      { read: active, as: 'focus' },
    ], { shot: 'list-50-day-1280' });
    expect(a.geo).toEqual({ first: true, inView: true, scrolls: true, cutInL2: true, cutAt: 30, findIn: true, aboveFoot: true });
    expect(a.focus).toBe(`row:${L(1).dim}`);
  }, 180_000);

  it('mika D5 / aegis C4.6: an agent writing to another dimension moves no row while the list is open and takes no focus; words change in place; a new dimension joins the end', async () => {
    const a = await real([
      { read: set(SAMPLE), as: 's' }, { press: KEY }, { wait: 300 }, { key: 'ArrowDown' }, { key: 'ArrowDown' }, { wait: 100 },
      { read: rows, as: 'before' }, { read: active, as: 'f0' },
      { read: `(globalThis.gnomonPreviewDims.listings.find((l) => l.dim === '${L(1).dim}').lastSeq = 9999, globalThis.gnomonPreviewDims.listings.find((l) => l.dim === '${L(1).dim}').ended = false, globalThis.gnomonPreviewDims.listings.push(${JSON.stringify(L(9, { title: 'Newest', lastSeq: 99999 }))}), ${LEAF}.refreshDims(), 1)`, as: 'w' }, { wait: 150 },
      { read: rows, as: 'after' }, { read: active, as: 'f1' },
    ]);
    const before = (a.before as Array<{ dim: string }>).map((r) => r.dim);
    const after = a.after as Array<{ dim: string; l2: string; mark: string }>;
    expect(after.map((r) => r.dim)).toEqual([...before, L(9).dim]);
    expect(after.find((r) => r.dim === L(1).dim)!.mark).toBe('●');
    expect(a.f1).toBe(a.f0);
  }, 180_000);

  it('aegis C4.8: the Enter that opened the list and a held Enter open no row; typeahead moves focus only; a synthetic click sends nothing; a real press sends one; C4.5: a press after attached changed sends nothing and the row redraws', async () => {
    const a = await real([
      { read: set(SAMPLE), as: 's' },
      { read: `(document.querySelector('${KEY}').focus(), 1)`, as: 'f' }, { key: 'Enter', text: '\r', held: 3 }, { wait: 200 }, { read: active, as: 'opened' }, { read: presses, as: 'p0' },
      { key: 'm' }, { wait: 100 }, { read: active, as: 'typed' }, { read: presses, as: 'p1' },
      { read: `(document.querySelector('.bd-dims .bd-dr[data-dim="${L(5).dim}"]').click(), document.querySelector('.bd-dims .bd-dr[data-dim="${L(5).dim}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })), ${presses}.length)`, as: 'synthetic' },
      // C4.5: the other session detaches from L(5) between the drawing and the press
      { read: `(globalThis.gnomonPreviewDims.listings.find((l) => l.dim === '${L(5).dim}').attached = [], 1)`, as: 'changed' },
      { press: `.bd-dims .bd-dr[data-dim="${L(5).dim}"]` }, { wait: 200 }, { read: presses, as: 'p2' }, { read: rows, as: 'redrawn' },
      { press: `.bd-dims .bd-dr[data-dim="${L(4).dim}"]` }, { wait: 200 }, { read: presses, as: 'p3' }, { read: `!!document.querySelector('.bd-dims')`, as: 'open' },
    ]);
    expect(a.opened).toBe(`row:${L(3).dim}`);
    expect(a.p0).toEqual([]);
    expect(a.typed).toBe(`row:${L(4).dim}`);
    expect(a.p1).toEqual([]);
    expect(a.synthetic).toBe(0);
    expect(a.p2).toEqual([]);
    expect((a.redrawn as Array<{ dim: string; l2: string }>).find((r) => r.dim === L(5).dim)!.l2).toBe('opening attaches this session');
    expect(a.p3).toEqual([{ dim: L(4).dim, attach: false, type: 'click' }]);
    expect(a.open).toBe(false);
  }, 180_000);

  it('aegis C4.7: link down, every row and the find row are aria-disabled, the first line says so, a press sends nothing (and nothing fires when the link is back)', async () => {
    const a = await real([
      { read: set(SAMPLE), as: 's' }, { read: `(${LEAF}.setInert('link-down'), 1)`, as: 'down' }, { wait: 150 },
      { press: KEY }, { wait: 300 }, { read: rows, as: 'rows' }, { read: `document.querySelector('.bd-dims .bd-dnote')?.textContent ?? null`, as: 'note' }, { read: `document.querySelector('.bd-dfind').getAttribute('aria-disabled')`, as: 'find' },
      { press: `.bd-dims .bd-dr[data-dim="${L(5).dim}"]` }, { wait: 150 },
      { read: `(${LEAF}.setInert(null), 1)`, as: 'up' }, { wait: 300 }, { read: presses, as: 'p' },
    ]);
    expect((a.rows as Array<{ disabled: string | null }>).every((r) => r.disabled === 'true')).toBe(true);
    expect(a.note).toBe('Not connected · nothing can be opened yet');
    expect(a.find).toBe('true');
    expect(a.p).toEqual([]);
  }, 180_000);

  it('mika D6: the open row on focus is on --sheet (no fold fill), its mismatch in --fail; D4: \'open here · \' goes before the check is cut', async () => {
    const a = await real([
      { read: set({ ...SAMPLE, check: { line: 'doesn’t match the saved board', bad: true } }), as: 's' }, { read: `(document.querySelector('${KEY}').focus(), 1)`, as: 'f' }, { key: 'Enter', text: '\r' }, { wait: 300 },
      { read: `(() => { const r = document.querySelector('.bd-dr.current'); const cs = getComputedStyle(r); const l2 = r.querySelector('.l2'); const probe = document.createElement('span'); probe.style.color = 'var(--fail)'; document.body.append(probe); const fail = getComputedStyle(probe).color; probe.remove(); return { focused: document.activeElement === r && r.matches(':focus-visible'), bg: cs.backgroundColor, l2: getComputedStyle(l2).color === fail, text: l2.textContent }; })()`, as: 'cur' },
    ], { width: 560, shot: 'list-mismatch-day-560' });
    const cur = a.cur as { focused: boolean; bg: string; l2: boolean; text: string };
    expect(cur.focused).toBe(true);
    expect(cur.bg).toBe('rgba(0, 0, 0, 0)');
    expect(cur.l2).toBe(true);
    expect(['open here · doesn’t match the saved board', 'doesn’t match the saved board']).toContain(cur.text);
  }, 180_000);

  it('mika D3: under 87px of room the head key opens the palette\'s list instead (aria-haspopup dialog); the find row opens the palette\'s list; ↓ on the key opens the menu', async () => {
    const room = `(() => { const k = document.querySelector('.bd-leaf .bd-head .key[aria-controls^="bd-dims-"]').getBoundingClientRect(); const f = document.querySelector('.bd-foot').getBoundingClientRect(); return Math.round(f.top - 8 - (k.bottom + 4)); })()`;
    const t = await real([
      { read: set(SAMPLE), as: 's' }, { read: `(document.getElementById('preview-board').style.height = '165px', 1)`, as: 'h' }, { wait: 400 }, { read: room, as: 'room' }, { read: `document.querySelector('${KEY}').getAttribute('aria-haspopup')`, as: 'popup' },
      { press: KEY }, { wait: 300 }, { read: `!!document.querySelector('.bd-dims')`, as: 'menu' }, { read: '(globalThis.gnomonPreviewPalette ?? []).length', as: 'palette' },
    ], { board: 'tiny' });
    expect(t.room as number).toBeLessThan(87);
    expect(t.popup).toBe('dialog');
    expect(t.menu).toBe(false);
    expect(t.palette).toBe(1);
    const a = await real([
      { read: set(SAMPLE), as: 's' }, { read: `(document.querySelector('${KEY}').focus(), 1)`, as: 'f' }, { key: 'ArrowDown' }, { wait: 200 }, { read: `!!document.querySelector('.bd-dims')`, as: 'down' },
      { key: 'End' }, { wait: 100 }, { read: `document.activeElement.classList.contains('bd-dfind')`, as: 'end' },
      { press: '.bd-dims .bd-dfind' }, { wait: 200 }, { read: '(globalThis.gnomonPreviewPalette ?? []).length', as: 'palette' }, { read: `!!document.querySelector('.bd-dims')`, as: 'closed' }, { read: presses, as: 'p' },
    ]);
    expect(a.down).toBe(true);
    expect(a.end).toBe(true);
    expect(a.palette).toBe(1);
    expect(a.closed).toBe(false);
    expect(a.p).toEqual([]);
  }, 180_000);
  it('mika D4: where \'open here · <the check>\' would be cut, \'open here · \' goes and the check is never cut', async () => {
    const a = await real([
      { read: set({ ...SAMPLE, check: { line: 'checked up to an older change', bad: false } }), as: 's' }, { read: `(Object.assign(document.getElementById('preview-board').style, { right: 'auto', width: '303px' }), 1)`, as: 'w' }, { wait: 400 }, { press: KEY }, { wait: 300 },
      { read: `(() => { const l2 = document.querySelector('.bd-dr.current .l2'); const shown = l2.textContent; const cut = l2.scrollWidth > l2.clientWidth + 0.5; l2.textContent = 'open here · ' + shown.replace(/^open here · /, ''); const fullCut = l2.scrollWidth > l2.clientWidth + 0.5; l2.textContent = shown; return { shown, cut, fullCut }; })()`, as: 'l2' },
    ], { width: 560 });
    const l2 = a.l2 as { shown: string; cut: boolean; fullCut: boolean };
    expect(l2.fullCut, 'the case under test: the whole line does not fit').toBe(true);
    expect(l2.shown).toBe('checked up to an older change');
    expect(l2.cut).toBe(false);
  }, 180_000);
  it('shots: the list open, day and night, at 1024, 1280, 1440 and a 560 window', async () => {
    for (const width of [1024, 1280, 1440, 560]) for (const theme of ['day', 'night'] as const) {
      const a = await real([{ read: set(SAMPLE), as: 's' }, { press: KEY }, { wait: 300 }, { read: `(() => { const m = document.querySelector('.bd-dims').getBoundingClientRect(); const leaf = document.querySelector('.bd-leaf').getBoundingClientRect(); return m.left >= leaf.left + 13.5 && m.right <= leaf.right; })()`, as: 'inside' }], { width, theme, shot: `list-open-${theme}-${width}` });
      expect(a.inside, `${width} ${theme}`).toBe(true);
    }
  }, 600_000);
});
