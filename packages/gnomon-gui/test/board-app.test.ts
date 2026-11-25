/**
 * #gui-board-dock in the REAL APP on a real engine (boards S1.3 pass P4b-1): the dev preview serves the real
 * ui/app.ts over its fake kernel with the dimension mod's real checks behind it (`?dim=1`), in a real Chrome driven
 * with real pointer and key input over the DevTools protocol (a frame between pointer moves). Everything under test
 * is the shipped path: the app's own GnomonClient, followLog into both stores, DimSessions, the one sender with
 * stamps minted from the person's events, the dock, the leaf and the engine chunk through the lazy loader.
 * The real kernel and mod are driven by packages/gnomon/test/dimension-dogfood.test.ts.
 * Runs where a Chrome is installed, never on CI; run it ALONE (a loaded machine times it out).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { fixtureUrl, startPreview } from '../scripts/preview.mjs';
import { KEEP_COPY } from '../src/core/board-leaf.js';

const A = 'globalThis.gnomonPreviewApp';
const CUR = `${A}.board.dock.current()`;
const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message) + ' ' + String(e.error && e.error.stack).slice(0, 600))), 1)", as: 'listening' };
/** count every `mod.command` frame the page sends from here on */
const COUNT = { read: `(() => { const k = ${A}.kernel; if (!k.__n) { k.__n = { n: 0 }; const send = k.send.bind(k); k.send = (s) => { if (String(s).includes('"mod.command"')) k.__n.n++; return send(s); }; } return 1; })()`, as: 'counting' };
const FACTS = `(() => { try {
  const c = ${CUR}; const k = ${A}.kernel; const l = document.querySelector('.bd-host .bd-leaf'); const st = c ? c.session.status() : null; const hd = c ? c.leaf.handle() : null;
  const rows = k.rows.filter((r) => String(r.event.kind).startsWith('modns.gnomon.dimension.')).map((r) => String(r.event.kind).slice('modns.gnomon.dimension.'.length) + (r.event.payload.opened ? ':' + r.event.payload.opened : '') + (Array.isArray(r.event.payload.ops) ? ':' + r.event.payload.ops.map((o) => o.type).join('+') : ''));
  const tab = document.querySelector('.bd-edgetab'); const field = document.querySelector('.bd-host .bd-board textarea');
  return { open: !!l, title: l ? l.querySelector('.title').textContent : null, line: l ? l.querySelector('.bd-keep').textContent : null, inert: l ? (l.dataset.inert ?? '') : null, check: l ? (l.dataset.check ?? '') : null,
    tab: tab && !tab.hidden ? tab.textContent : null, rows, frames: k.__n ? k.__n.n : 0,
    phase: st && st.phase, keep: st && st.keep, link: st && st.link, pending: st && st.pending, nodes: c ? c.session.view().nodes.size : null, texts: c ? [...c.session.view().nodes.values()].filter((n) => n.node.kind === 'text').map((n) => n.node.text) : null,
    sameAsMod: c ? c.session.hash() === ${A}.mod.hash(c.session.dim) : null, marks: hd && hd.isAlive() ? hd.count() : null, drift: hd && hd.isAlive() ? hd.drift().length : null, tool: hd && hd.isAlive() ? hd.state().tool : null,
    field: field ? field.value : null, toasts: [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent), reconnect: !document.getElementById('reconnect').hidden,
    active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName + '.' + document.activeElement.className) : null, card: !!(document.activeElement && document.activeElement.closest('.card')), errs: (globalThis.__errs || []).length};
} catch (e) { return { threw: String(e && e.stack).slice(0, 500) }; } })()`;
const facts = (as: string) => ({ read: FACTS, as });
const SHOTS = process.env.GNOMON_SHOTS_DIR ?? '';
const keepShot = (name: string, png: Buffer): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `s14b-${name}.png`), png);
};
type Facts = { open: boolean; title: string | null; line: string | null; inert: string | null; check: string | null; tab: string | null; rows: string[]; frames: number; phase: string | null; keep: string | null; link: string | null; pending: number | null; nodes: number | null; texts: string[] | null; sameAsMod: boolean | null; marks: number | null; drift: number | null; tool: string | null; field: string | null; toasts: string[]; reconnect: boolean; active: string | null; card: boolean };
const type = (s: string): unknown[] => [...s].map((k) => ({ key: k, settle: 25 }));
const typeBoard = [{ press: '#composer-text' }, ...type('/board'), { key: 'Enter' }, { wait: 2500 }];
const drawRect = [{ press: '.bd-host [data-key="tool:rect"]' }, { drag: [[250, 200], [290, 225], [330, 250]] }, { wait: 500 }];
const foldByEsc = [{ press: '.bd-host .bd-head .spacer' }, { key: 'Escape' }, { wait: 900 }];

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('the board in the real app on a real engine: open, draw, fold, reopen, list, link, G-DDL-08', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { shot?: string; fixture?: string; theme?: string; width?: number; height?: number } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: `${fixtureUrl(p.url, o.fixture ?? 'desk', o.theme ?? 'day', 'off')}&dim=1`, width: o.width ?? 1440, height: o.height ?? 900, timeoutMs: 60_000, actions: [ERRORS, COUNT, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
    if (o.shot) keepShot(o.shot, r.png);
    return r.acted;
  };

  it('/board opens a new dimension titled with the session; a mark is drawn and saved; Esc folds it to the edge tab; ⌥B reopens it with its marks and the same hash; /boards lists it and a row opens it', async () => {
    const a = await real(
      [
        facts('start'), ...typeBoard, facts('opened'), ...drawRect, facts('drawn'), ...foldByEsc, facts('folded'),
        { key: 'b', alt: true }, { wait: 2200 }, facts('reopened'), { key: 'b', alt: true }, { wait: 900 }, facts('folded2'),
        { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { wait: 400 },
        { read: `({ head: document.querySelector('#palette-list .menu-h')?.textContent ?? null, rows: [...document.querySelectorAll('#palette-list [data-dim]')].map((r) => r.textContent), composer: document.getElementById('composer-text').value })`, as: 'list' },
        { key: 'Enter' }, { wait: 2200 }, facts('fromList'),
      ],
      { shot: 'app-board-1440-day' },
    );
    const f = (k: string): Facts => a[k] as Facts;
    if (process.env.GNOMON_DEBUG) console.log(JSON.stringify(a, null, 1));
    expect(a.errors).toEqual([]);
    expect(f('start')).toMatchObject({ open: false, tab: null, rows: [], frames: 0 });
    // ONE dim.open on the Enter that ran the command (`command`), titled with the session's name; focus is on the board
    expect(f('opened')).toMatchObject({ open: true, phase: 'open', link: 'up', keep: 'saved', rows: ['session.start:command'], frames: 1, nodes: 0, sameAsMod: true, inert: '' });
    expect(f('opened').title).toMatch(/^Totals are off by a cent/);
    expect(f('opened').line).toMatch(/opened from \/board/);
    expect(f('opened').active).toMatch(/excalidraw/);
    // never a bare "verified": the check reads "checked up to" the point the mod vouched for
    expect(f('opened').check).toMatch(/^Checked up to change \d+/);
    expect(f('drawn')).toMatchObject({ rows: ['session.start:command', 'op:add'], frames: 2, nodes: 1, marks: 1, pending: 0, keep: 'saved', sameAsMod: true, drift: 0 });
    // the check does not vouch for the row after its point
    expect(f('drawn').check).toMatch(/^Checked up to change \d+ of \d+$/);
    // Esc folds: dim.close, the leaf goes, the edge tab `<title> · board` shows, focus returns
    expect(f('folded')).toMatchObject({ open: false, rows: ['session.start:command', 'op:add', 'session.end'], frames: 3 });
    expect(f('folded').tab).toMatch(/^Totals are off by a cen… · board$/);
    // ⌥B (a `menu` entry) reopens the same dimension: the mark is there and the fold is the mod's
    expect(f('reopened')).toMatchObject({ open: true, phase: 'open', nodes: 1, marks: 1, sameAsMod: true, drift: 0, frames: 4, line: KEEP_COPY.reopens });
    expect(f('reopened').rows.slice(3)).toEqual(['session.start:menu']);
    // ⌥B again folds it
    expect(f('folded2')).toMatchObject({ open: false, frames: 5 });
    // /boards: the palette as the Dimensions list, this repo's dimensions; the composer keeps no command text
    const list = a.list as { head: string | null; rows: string[]; composer: string };
    expect(list.head).toBe('Dimensions');
    expect(list.composer).toBe('');
    expect(list.rows).toHaveLength(1);
    // the time is the kernel's `lastAt` (hh:mm today, else the date: the preview's clocks are not the same day)
    expect(list.rows[0]).toMatch(/^Totals are off by a cent.*(\d\d:\d\d|[A-Z][a-z]{2} \d{1,2}) · ended · opening it starts it again$/);
    // Enter on the row opens it on that press (typed: `command`)
    expect(f('fromList')).toMatchObject({ open: true, phase: 'open', nodes: 1, marks: 1, sameAsMod: true, frames: 6 });
    expect(f('fromList').rows.slice(-1)).toEqual(['session.start:command']);
  }, 180_000);

  it('the ⋯ menu row opens it as a `menu` entry; `/board <title>` names a new one (`user`); a synthetic key or click opens nothing and sends nothing', async () => {
    const untrusted = `(() => {
      const ta = document.getElementById('composer-text'); ta.value = '/board'; ta.focus();
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '∫', code: 'KeyB', altKey: true, bubbles: true, cancelable: true }));
      document.getElementById('more-btn').click(); document.getElementById('board-open').click();
      const tab = document.querySelector('.bd-edgetab'); if (tab) tab.click();
      const v = ta.value; ta.value = ''; return v;
    })()`;
    const a = await real([
      { read: untrusted, as: 'u1' }, { wait: 600 }, facts('untrusted-first'),
      { press: '#more-btn' }, { read: `({ disabled: document.getElementById('board-open').getAttribute('aria-disabled'), text: document.getElementById('board-open').textContent, title: document.getElementById('board-open').title })`, as: 'row' },
      { press: '#board-open' }, { wait: 2500 }, facts('menu'), ...foldByEsc, facts('folded'),
      { read: untrusted, as: 'u2' }, { wait: 600 }, facts('untrusted-with-board'),
      { press: '#composer-text' }, ...type('/board plan B'), { key: 'Enter' }, { wait: 2500 }, facts('titled'),
      { read: `${A}.kernel.rows.filter((r) => String(r.event.kind).endsWith('session.start')).map((r) => [r.event.payload.title, r.event.payload.titleFrom ?? null])`, as: 'titles' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('untrusted-first')).toMatchObject({ open: false, rows: [], frames: 0 });
    expect(a.row).toMatchObject({ disabled: null, text: 'Open board' });
    expect(f('menu')).toMatchObject({ open: true, phase: 'open', rows: ['session.start:menu'], frames: 1 });
    expect(f('menu').line).toMatch(/opened from the ⋯ menu/);
    expect(f('folded')).toMatchObject({ open: false, frames: 2 });
    // with a board to reopen: a synthetic Enter, ⌥B, menu click and tab click still open nothing and send nothing
    expect(f('untrusted-with-board')).toMatchObject({ open: false, frames: 2, rows: f('folded').rows });
    expect(f('titled')).toMatchObject({ open: true, phase: 'open', title: 'plan B', frames: 3 });
    expect((a.titles as unknown[][]).map((t) => t[0])).toEqual([expect.stringMatching(/^Totals are off/), 'plan B']);
  }, 180_000);

  it('the link goes while a text is being typed: the field stays open, Esc does not lose the words, the fold is not said saved; back up, the words return only into a text the person opens, and their own press commits them', async () => {
    const a = await real(
      [
        ...typeBoard, ...drawRect, facts('before'),
        { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('held'), facts('typing'),
        { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, facts('down'),
        { key: 'Escape' }, { wait: 300 }, facts('esc-down'), ...type('!'), { wait: 200 }, facts('typed-down'),
        { press: '#reconnect-btn' }, { wait: 3000 }, facts('back'),
        { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 600 }, facts('reopened-text'),
        { at: [200, 330], press: true }, { wait: 900 }, facts('committed'),
      ],
      { shot: 'app-link-back' },
    );
    const f = (k: string): Facts => a[k] as Facts;
    if (process.env.GNOMON_DEBUG) console.log(JSON.stringify(a, null, 1));
    expect(a.errors).toEqual([]);
    expect(f('typing')).toMatchObject({ field: 'held', nodes: 1, frames: 2 });
    // down: held still, the field still open with its words, nothing sent; the line says the words are held
    expect(f('down')).toMatchObject({ open: true, inert: 'link-down', link: 'down', field: 'held', frames: 2, line: KEEP_COPY.wordsHeld });
    // Esc does not end the edit: the words are there, and the line says so
    expect(f('esc-down')).toMatchObject({ open: true, field: 'held', line: KEEP_COPY.wordsHeld, frames: 2 });
    expect(f('typed-down')).toMatchObject({ field: 'held!', frames: 2 });
    // back: a NEW leaf on the new connection; nothing was committed; the line never says everything is saved
    expect(f('back')).toMatchObject({ open: true, link: 'up', inert: '', nodes: 1, texts: [], field: null, sameAsMod: true, line: KEEP_COPY.wordsWait });
    expect(f('back').line).not.toMatch(/everything here is saved/);
    // the person opens a text: the held words are put in it, uncommitted
    expect(f('reopened-text')).toMatchObject({ field: 'held!', nodes: 1, line: KEEP_COPY.wordsBack });
    // their own press commits it, on a stamp of the new connection
    expect(f('committed')).toMatchObject({ nodes: 2, texts: ['held!'], pending: 0, keep: 'saved', sameAsMod: true, field: null });
    expect(f('committed').rows.slice(-1)).toEqual(['op:add']);
  }, 180_000);

  it('held still, the leaf still folds (Esc and the esc key) and a fold while down is not a close; with nothing pending the line is "Reconnecting" alone', async () => {
    const a = await real(
      [...typeBoard, ...drawRect, { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, facts('down'), { key: 'Escape' }, { wait: 500 }, facts('folded')],
      { shot: 'app-link-down' },
    );
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('down')).toMatchObject({ open: true, inert: 'link-down', line: 'Reconnecting', frames: 2 });
    expect(f('folded')).toMatchObject({ open: false, frames: 2 });
    expect(f('folded').tab).toMatch(/· board$/);
  }, 120_000);

  it('G-DDL-08 core: with a card focused no key reaches the board (no op, no frame, no engine change), ⌥B included; no card focus runs during a board text edit', async () => {
    const KEYS: Array<Record<string, unknown>> = [{ key: 'a' }, { key: 'd' }, { key: 'y' }, { key: 'n' }, { key: '1' }, { key: '2' }, { key: 'o', meta: true }, { key: 's', meta: true }, { key: 'e', meta: true, shift: true }, { key: 'z', meta: true }, { key: 'v', meta: true, commands: ['paste'] }, { key: 'b', alt: true }, { key: 'Escape' }, { key: 'Enter' }];
    const focusCard = { read: `(() => { const c = document.querySelector('#stack .card [data-decision], #pinned .card [data-decision], #stack .card button, #pinned .card button'); if (c) c.focus(); return !!(document.activeElement && document.activeElement.closest('.card')); })()`, as: 'focused' };
    const steps = KEYS.flatMap((k, i) => [{ ...focusCard, as: `card${i}` }, { ...k, settle: 120 }, facts(`k${i}`)]);
    const a = await real([
      ...typeBoard, ...drawRect, { press: '.bd-host [data-key="tool:select"]' }, facts('before'), ...steps,
      // a text being typed on the board: a programmatic card focus does not run
      { at: [200, 330], press: true }, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('ab'),
      { read: `(() => { const id = document.querySelector('#stack .card')?.dataset.cardId ?? document.querySelector('#stack [data-card-id]')?.dataset.cardId ?? null; if (id) ${A}.board.focusCard(id); return { id, tag: document.activeElement.tagName, card: !!document.activeElement.closest('.card'), editing: ${A}.board.dock.editingText() }; })()`, as: 'midword' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    const before = f('before');
    expect(before).toMatchObject({ open: true, nodes: 1, marks: 1, frames: 2, tool: 'select' });
    KEYS.forEach((k, i) => {
      const name = `${k.meta ? 'Cmd+' : ''}${k.shift ? 'Shift+' : ''}${k.alt ? 'Alt+' : ''}${String(k.key)}`;
      expect(a[`card${i}`], `a card had focus for ${name}`).toBe(true);
      expect(f(`k${i}`), name).toMatchObject({ open: true, frames: before.frames, rows: before.rows, nodes: before.nodes, marks: before.marks, drift: 0, tool: before.tool, pending: 0 });
    });
    expect(a.midword).toMatchObject({ tag: 'TEXTAREA', card: false, editing: true });
    expect((a.midword as { id: string | null }).id).not.toBeNull();
  }, 240_000);

  it.each([
    { width: 1440, height: 900, fixture: 'desk', theme: 'day', pinned: 'own' },
    { width: 1024, height: 768, fixture: 'desk', theme: 'night', pinned: 'own' },
    { width: 1440, height: 900, fixture: 'always-scopes', theme: 'night', pinned: 'two' },
    { width: 1024, height: 768, fixture: 'always-scopes', theme: 'day', pinned: 'two' },
  ])('G-DDL-08 layout at $width×$height ($fixture): the leaf lies inside the centre column and meets none of the stack, the status strip, the pinned zone or the composer', async ({ width, height, fixture, theme, pinned }) => {
    const RECTS = `(() => { const r = (q) => { const e = typeof q === 'string' ? document.querySelector(q) : q; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; };
      return { leaf: r('.bd-host .bd-leaf'), pane: r('#pane-transcript'), stack: r('#stack'), status: r('#status-line'), pinned: r('#pinned'), composer: r('#composer'), cards: document.querySelectorAll('#pinned .card').length, head: r('.bd-host .bd-head'), toast: r('#toasts'), line: (() => { const k = document.querySelector('.bd-host .bd-keep'); return k ? k.scrollWidth <= k.clientWidth + 1 : null; })() }; })()`;
    const first = pinned === 'two' ? [] : [{ read: `(() => { const rows = [...document.querySelectorAll('#session-list [data-hsid]')]; const idle = rows.find((x) => /idle/.test(x.textContent)); return idle ? idle.dataset.hsid : null; })()`, as: 'idle' }];
    // 0 pinned: an idle session of the fixture is focused; 2 pinned: one of the fixture's three is decided by a real press
    const zero = pinned === 'two' ? [{ press: '#pinned .card [data-decision="deny"]' }, { wait: 900 }] : [{ read: `(() => { const rows = [...document.querySelectorAll('#session-list [data-hsid]')]; const idle = rows.find((x) => /idle/.test(x.textContent)); if (idle) idle.click(); return !!idle; })()`, as: 'switched' }, { wait: 400 }];
    const a = await real([...first, ...zero, ...typeBoard, { read: RECTS, as: 'rects' }], { fixture, theme, width, height, shot: `app-board-${width}-${theme}-${pinned === 'two' ? 'pinned2' : 'pinned0'}` });
    expect(a.errors).toEqual([]);
    type R = { x: number; y: number; r: number; b: number } | null;
    const r = a.rects as { leaf: R; pane: R; stack: R; status: R; pinned: R; composer: R; cards: number; line: boolean | null };
    expect(r.cards).toBe(pinned === 'two' ? 2 : 0);
    expect(r.leaf).not.toBeNull();
    const leaf = r.leaf!;
    const pane = r.pane!;
    expect(leaf.x).toBeGreaterThanOrEqual(pane.x - 0.5);
    expect(leaf.r).toBeLessThanOrEqual(pane.r + 0.5);
    expect(leaf.y).toBeGreaterThanOrEqual(pane.y - 0.5);
    expect(leaf.b).toBeLessThanOrEqual(pane.b + 0.5);
    const meets = (o: R): boolean => !!o && o.r > o.x && o.b > o.y && leaf.x < o.r - 0.5 && o.x < leaf.r - 0.5 && leaf.y < o.b - 0.5 && o.y < leaf.b - 0.5;
    for (const [name, zone] of [['stack', r.stack], ['status strip', r.status], ['pinned zone', r.pinned], ['composer', r.composer]] as const) expect(meets(zone), name).toBe(false);
    expect(r.composer).not.toBeNull();
    expect(r.stack).not.toBeNull();
  }, 120_000);
});
