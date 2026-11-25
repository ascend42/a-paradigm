/**
 * #gui-dim-session in a REAL engine (boards S1.3 pass P4a): the dev preview's `?board=live` fixture in a real
 * Chrome, driven with real pointer, key and clipboard input over the DevTools protocol (a frame between pointer
 * moves). The loop under test is the real one end to end EXCEPT the kernel: the page's own GnomonClient, followLog,
 * DimSessions, DimStore, DimLive, the one sender with stamps minted from the engine's trusted events, the board
 * handle and the leaf, over the preview's fake kernel, which answers with the dimension mod's real checks and fold
 * (src/preview/dim-mod.ts). The real kernel and mod are driven by packages/gnomon/test/dimension-dogfood.test.ts.
 * Runs where a Chrome is installed, never on CI; run it ALONE (a loaded machine times it out).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { FIXTURE_DIM, fixtureId } from '../src/preview/board-fixture.js';

const SIZE = { width: 1440, height: 900 };
const B = 'globalThis.gnomonPreviewBoard';
const L = 'globalThis.gnomonPreviewLive';
const DIM = `'${FIXTURE_DIM}'`;
const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), 1)", as: 'listening' };
/** what the loop holds now: the session's status, the store's fold against the mod's, and the board against the fold */
const FACTS = `(() => { const s = ${L}.session; const st = s.status(); const rows = ${L}.dims.rows(${DIM}); return { keep: st.keep, link: st.link, pending: st.pending, canUndo: st.canUndo, nodes: s.view().nodes.size, rows: rows.length, lastOps: rows[rows.length - 1].payload.ops ? rows[rows.length - 1].payload.ops.map((o) => o.type) : null, sameAsMod: s.hash() === ${L}.mod.hash(${DIM}), stored: ${B}.isAlive() ? ${B}.marks().filter((m) => !m.labelOf).every((m) => m.node !== null) : null, drift: ${B}.isAlive() ? ${B}.drift().length : null, marks: ${B}.isAlive() ? ${B}.marks().filter((m) => !m.labelOf).length : null, selected: ${B}.isAlive() ? ${B}.state().selected : null, notices: ${L}.notices.map((n) => n.about + ':' + n.code), line: document.querySelector('#preview-board .bd-keep').textContent }; })()`;
const facts = (as: string) => ({ read: FACTS, as });
const SHOTS = process.env.GNOMON_SHOTS_DIR ?? '';
const keep = (name: string, png: Buffer): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `s14a-${name}.png`), png);
};
type Facts = { keep: string; link: string; pending: number; canUndo: boolean; nodes: number; rows: number; lastOps: string[] | null; sameAsMod: boolean; stored: boolean | null; drift: number | null; marks: number | null; selected: number | null; notices: string[]; line: string };

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('the live loop on a real engine: draw, confirm, refuse, undo, paste, link', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], marks: string | null = null, shot: string | null = null): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'live', 'day', marks), ...SIZE, timeoutMs: 60_000, actions: [ERRORS, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
    if (shot) keep(shot, r.png);
    return r.acted;
  };
  const drawRect = [{ press: '#preview-board [data-key="tool:rect"]' }, { drag: [[450, 300], [500, 330], [550, 360]] }, { wait: 400 }];

  it('a drawn mark is shown at once, sent on a stamp from its own pointer-up, and persists through the row round trip; Cmd+Z then undoes it', async () => {
    const a = await real([facts('start'), ...drawRect, facts('drawn'), { key: 'z', meta: true }, { wait: 400 }, facts('undone'), { key: 'z', meta: true, shift: true }, { wait: 200 }, facts('redo')], null, 'live-drawn-undone');
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('start')).toMatchObject({ keep: 'saved', link: 'up', pending: 0, canUndo: false, sameAsMod: true, drift: 0, notices: [] });
    // the mark is in the log as a row of mine, the board holds it under its node id, and the fold is the mod's
    expect(f('drawn')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: f('start').nodes + 1, rows: f('start').rows + 1, lastOps: ['add'], sameAsMod: true, stored: true, drift: 0, notices: [] });
    // Cmd+Z: the inverse went through the same path as a row, and the mark is gone from the board
    expect(f('undone')).toMatchObject({ keep: 'saved', pending: 0, canUndo: false, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows + 2, lastOps: ['delete'], sameAsMod: true, drift: 0, notices: [] });
    // redo is not built: it is said, never sent
    expect(f('redo')).toMatchObject({ rows: f('start').rows + 2, notices: ['undo:redo-unavailable'], line: 'Redo isn’t on the board yet' });
  }, 120_000);

  it('an edit the mod refuses is put back on the board and the leaf says so in one line', async () => {
    const a = await real([facts('start'), { read: `(${L}.mod.refuseNext = 'ops-refused', 1)`, as: 'armed' }, ...drawRect, facts('refused'), { wait: 100 }], null, 'live-refused-line');
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('refused')).toMatchObject({ keep: 'saved', pending: 0, canUndo: false, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows, sameAsMod: true, drift: 0, notices: ['edit:id-missing'], line: 'That change wasn’t kept · the board is as it was' });
  }, 120_000);

  it('a copy of 64 marks pasted back is 64 clones over several rows, selected; ONE Cmd+Z takes them all', async () => {
    const a = await real(
      [
        facts('start'),
        // a marquee over the whole grid, a real copy, a real paste
        { drag: [[8, 8], [200, 150], [440, 306]] }, { read: `${B}.state().selected`, as: 'picked' },
        { key: 'c', meta: true, commands: ['copy'] }, { wait: 150 },
        { key: 'v', meta: true, commands: ['paste'] }, { wait: 1500 }, facts('pasted'),
        { read: `${L}.dims.rows(${DIM}).slice(-3).map((r) => r.payload.ops.length)`, as: 'tail' },
        { key: 'z', meta: true }, { wait: 800 }, facts('undone'),
      ],
      'many',
      'live-paste-64',
    );
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(a.picked).toBe(64);
    const rows = f('pasted').rows - f('start').rows;
    expect(rows).toBeGreaterThan(1); // too heavy for one row
    expect(rows).toBeLessThanOrEqual(4);
    expect(f('pasted')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: 128, selected: 64, sameAsMod: true, stored: true, notices: [] });
    expect(f('undone')).toMatchObject({ keep: 'saved', pending: 0, nodes: 64, rows: f('pasted').rows + 1, sameAsMod: true, notices: [] });
    expect(f('undone').lastOps).toEqual(Array(64).fill('delete'));
  }, 120_000);

  it('review leftovers in the engine: words selected in the chrome are copied as themselves (N3); a paste that is too long only AFTER cleaning is refused with its line (N1); pastes step and the step starts again', async () => {
    const long = `${'a'.repeat(3990)}${'\u202e'.repeat(8)}`;
    const a = await real([
      facts('start'),
      // a mark is selected on the board, then the title's words are selected in the leaf's head
      { at: [272, 86], press: true }, { read: `${B}.state().selected`, as: 'selected' },
      { read: `(getSelection().selectAllChildren(document.querySelector('#preview-board .bd-head .title')), getSelection().toString())`, as: 'chosen' },
      { key: 'c', meta: true, commands: ['copy'] }, { wait: 150 },
      { await: 'navigator.clipboard.readText()', as: 'clipboard' },
      { read: '(getSelection().removeAllRanges(), 1)', as: 'cleared' },
      // 3,998 characters as pasted; over 4,000 once the bidi controls are made visible
      { at: [640, 420], press: true }, { paste: long }, { wait: 300 }, facts('long'),
      // three pastes one after another step down and right; a press starts the step again
      { paste: 'one' }, { wait: 300 }, { paste: 'one' }, { wait: 300 }, { paste: 'one' }, { wait: 300 },
      { at: [640, 420], press: true }, { paste: 'one' }, { wait: 300 },
      { read: `[...${L}.session.view().nodes.values()].map((n) => n.node).filter((n) => n.kind === 'text' && n.text === 'one').map((n) => [n.x, n.y])`, as: 'ones' },
      facts('end'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(a.selected).toBe(1);
    expect(a.chosen).toBe('auth handoff');
    expect(a.clipboard).toBe('auth handoff');
    expect(long.length).toBeLessThan(4000);
    expect(f('long')).toMatchObject({ nodes: f('start').nodes, rows: f('start').rows, line: 'One mark holds 4,000 characters · paste or type less' });
    const ones = a.ones as Array<[number, number]>;
    expect(ones).toHaveLength(4);
    expect([ones[1]![0] - ones[0]![0], ones[2]![0] - ones[1]![0]]).toEqual([16, 16]);
    expect(ones[3]).toEqual(ones[0]); // the step started again
    expect(f('end')).toMatchObject({ keep: 'saved', pending: 0, nodes: f('start').nodes + 4, sameAsMod: true });
  }, 120_000);

  it('B4: link down holds the board still for as long as it lasts: the line stays past six seconds, the rail is dimmed, and a draw, a paste and a key add nothing and raise nothing', async () => {
    const down = await real([
      facts('start'), { read: `(${L}.down(), 1)`, as: 'd' }, { wait: 7000 }, facts('down'),
      { read: `({ inert: ${L}.leaf.el.dataset.inert, rail: document.querySelector('#preview-board .bd-rail').className, off: [...document.querySelectorAll('#preview-board .bd-rail [data-tool]')].every((b) => b.getAttribute('aria-disabled') === 'true') })`, as: 'held' },
      ...drawRect, { paste: 'words while down' }, { wait: 300 }, { at: [272, 86], press: true }, { key: 'Delete' }, { wait: 300 },
      facts('after'), { read: `${L}.leaf.el.isConnected`, as: 'leafStays' },
    ], null, 'live-link-down');
    const f = (k: string): Facts => down[k] as Facts;
    expect(down.errors).toEqual([]);
    expect(down.held).toEqual({ inert: 'link-down', rail: 'bd-rail yielded', off: true });
    expect(f('down')).toMatchObject({ link: 'down', notices: ['link:link-down'], line: 'Reconnecting' });
    // nothing was shown and then taken away: no mark, no row, no further notice, the same line
    expect(f('after')).toMatchObject({ link: 'down', pending: 0, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows, selected: 0, notices: ['link:link-down'], line: 'Reconnecting' });
    expect(down.leafStays).toBe(true);
  }, 120_000);

  it('B6: link up: a new session and a new leaf that opens where the old one was looking and says the link is back; a drawn mark persists again', async () => {
    const up = await real([
      facts('start'),
      { read: `(${B}.zoomIn(), 1)`, as: 'z' }, { wait: 200 }, { wheel: '#preview-board .bd-stage' }, { wait: 200 },
      { read: `(globalThis.__old = { session: ${L}.session, leaf: ${L}.leaf, view: ${B}.view() }, ${L}.down(), 1)`, as: 'd' }, { wait: 300 },
      { await: `${L}.up().then(() => new Promise((r) => setTimeout(r, 1500))).then(() => 1)`, as: 'upped' },
      { read: `({ newSession: ${L}.session !== globalThis.__old.session, oldDead: !globalThis.__old.session.alive, oldLeafGone: !globalThis.__old.leaf.el.isConnected, newLeaf: ${L}.leaf !== globalThis.__old.leaf && ${L}.leaf.el.isConnected, leaves: document.querySelectorAll('#preview-board .bd-leaf').length, inert: ${L}.leaf.el.dataset.inert || '' })`, as: 'rebuilt' },
      { read: `({ was: [globalThis.__old.view.scrollX, globalThis.__old.view.scrollY, globalThis.__old.view.zoom], now: [${B}.view().scrollX, ${B}.view().scrollY, ${B}.view().zoom] })`, as: 'view' },
      facts('back'), { read: `(${B}.zoomReset(), 1)`, as: 'z2' }, { wait: 200 }, ...drawRect, facts('drawn'),
    ], null, 'live-link-up');
    const g = (k: string): Facts => up[k] as Facts;
    expect(up.errors).toEqual([]);
    expect(up.rebuilt).toEqual({ newSession: true, oldDead: true, oldLeafGone: true, newLeaf: true, leaves: 1, inert: '' });
    const view = up.view as { was: number[]; now: number[] };
    expect(view.was[2]).toBeGreaterThan(1);
    expect(view.was[1]).not.toBe(0);
    expect(view.now).toEqual(view.was);
    expect(g('back')).toMatchObject({ link: 'up', keep: 'saved', canUndo: false, nodes: g('start').nodes, sameAsMod: true, line: 'Reconnected · everything here is saved' });
    expect(g('drawn')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: g('start').nodes + 1, rows: g('start').rows + 1, sameAsMod: true, stored: true });
  }, 180_000);

  it('B5: a slow save is shown, and when the mod never answers the marks drawn meanwhile fall together with one line', async () => {
    const a = await real([
      facts('start'), { read: `(${L}.mod.silent = true, 1)`, as: 'silent' },
      ...drawRect, { wait: 700 }, facts('slow'),
      { press: '#preview-board [data-key="tool:rect"]' }, { drag: [[600, 300], [640, 330], [680, 360]] }, { wait: 300 }, facts('two'),
      { wait: 8600 }, facts('gone'),
    ], null, 'live-slow-save');
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('slow')).toMatchObject({ keep: 'saving', pending: 1, nodes: f('start').nodes + 1, line: 'Saving…', notices: [] });
    expect(f('two')).toMatchObject({ keep: 'saving', pending: 2, nodes: f('start').nodes + 2, line: 'Saving…' });
    expect(f('gone')).toMatchObject({ keep: 'saved', pending: 0, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows, notices: ['edit:timeout'], line: '2 changes may not be saved · fold and reopen to check' });
  }, 120_000);

  it('C2: a paste with the keyboard in the composer or on a card reaches no board listener; any control of the chrome keeps its own paste (N2); select() skips a fallback stub', async () => {
    const a = await real([
      facts('start'),
      { read: `(globalThis.__heard = 0, ${B}.onPasteText(() => void globalThis.__heard++), ${B}.onAttempt(() => void globalThis.__heard++), 1)`, as: 'listening2' },
      // the composer
      { press: '#composer-text' }, { paste: 'to the composer' }, { wait: 250 },
      { read: `document.querySelector('#composer-text').value`, as: 'composer' },
      // a card's own key has the focus
      { read: `(document.querySelector('#pinned .card button, #stack .card button').focus(), document.activeElement.tagName)`, as: 'card' }, { paste: 'to a card' }, { wait: 250 },
      { read: 'globalThis.__heard', as: 'heardOutside' }, facts('outside'),
      // controls of the leaf's chrome that are not text inputs: each keeps its paste
      { read: `(() => { const h = document.querySelector('#preview-board .bd-head'); h.insertAdjacentHTML('beforeend', '<input id="n2n" type="number"><input id="n2e" type="email"><select id="n2s"><option>one</option></select><span id="n2c" contenteditable="true">·</span>'); return 1; })()`, as: 'made' },
      { press: '#n2n' }, { paste: '42' }, { wait: 200 },
      { press: '#n2e' }, { paste: 'a@b.example' }, { wait: 200 },
      { press: '#n2c' }, { paste: 'editable words' }, { wait: 200 },
      { read: `(document.querySelector('#n2s').focus(), 1)`, as: 'sel' }, { paste: 'into a select' }, { wait: 200 },
      { read: `({ n: document.querySelector('#n2n').value, e: document.querySelector('#n2e').value, c: document.querySelector('#n2c').textContent })`, as: 'chrome' },
      { read: 'globalThis.__heard', as: 'heardChrome' }, facts('chromeAfter'),
      // select(): the stub is skipped, the rect is selected
      { read: `(${B}.select(['${fixtureId(9)}', '${fixtureId(2)}']), 1)`, as: 'sel2' }, { wait: 300 },
      { read: `({ n: ${B}.state().selected, kinds: ${B}.marks().filter((m) => m.selected).map((m) => m.kind) })`, as: 'picked' },
      { read: `(${B}.select(['${fixtureId(9)}']), 1)`, as: 'sel3' }, { wait: 300 },
      { read: `${B}.state().selected`, as: 'stubOnly' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(a.composer).toBe('to the composer');
    expect(a.card).toBe('BUTTON');
    expect(a.heardOutside).toBe(0);
    expect(f('outside')).toMatchObject({ nodes: f('start').nodes, rows: f('start').rows, notices: [] });
    expect(a.chrome).toMatchObject({ n: '42', e: 'a@b.example' });
    expect(String((a.chrome as { c: string }).c)).toContain('editable words');
    expect(a.heardChrome).toBe(0);
    expect(f('chromeAfter')).toMatchObject({ nodes: f('start').nodes, rows: f('start').rows, notices: [] });
    expect(a.picked).toEqual({ n: 1, kinds: ['sticky'] });
    expect(a.stubOnly).toBe(0);
  }, 120_000);

  it('C2: a copy made before the link went down is forgotten: after the reconnect its paste gives the bare words, never a clone', async () => {
    const a = await real([
      facts('start'),
      { at: [272, 86], press: true }, { key: 'c', meta: true, commands: ['copy'] }, { wait: 150 },
      { read: `(${L}.down(), 1)`, as: 'd' }, { wait: 300 },
      { await: `${L}.up().then(() => new Promise((r) => setTimeout(r, 1500))).then(() => 1)`, as: 'upped' },
      { at: [640, 420], press: true }, { key: 'v', meta: true, commands: ['paste'] }, { wait: 600 }, facts('pasted'),
      { read: `(() => { const rows = ${L}.dims.rows(${DIM}); return rows[rows.length - 1].payload.ops.map((o) => [o.type, o.node && o.node.kind, o.node && o.node.text]); })()`, as: 'ops' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('pasted')).toMatchObject({ link: 'up', nodes: f('start').nodes + 1, rows: f('start').rows + 1, sameAsMod: true });
    expect(a.ops).toEqual([['add', 'text', 'broker']]);
  }, 120_000);

  it('C2: a long scribble the handle cuts into pieces goes as several rows (in all over what one row may hold) and ONE Cmd+Z takes it back', async () => {
    // a zigzag of 2,300 corners, drawn with real pointer moves, a frame apart
    const path: number[][] = Array.from({ length: 2300 }, (_, i) => [60 + Math.round(i * 0.3), i % 2 ? 330 : 190]);
    const a = await real([
      facts('start'),
      { press: '#preview-board [data-key="tool:stroke"]' }, { drag: path, settle: 1500 }, { wait: 2500 }, facts('drawn'),
      { read: `(() => { const rows = ${L}.dims.rows(${DIM}).slice(0); return rows.map((r) => ({ ops: (r.payload.ops || []).map((o) => o.type + ':' + (o.node ? o.node.kind : '')), bytes: JSON.stringify(r.payload.ops || []).length, values: (r.payload.ops || []).reduce((n, o) => n + (o.node && o.node.points ? o.node.points.length : 0), 0) })); })()`, as: 'rows' },
      { key: 'z', meta: true }, { wait: 1500 }, facts('undone'),
    ], 'empty');
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    const rows = (a.rows as Array<{ ops: string[]; bytes: number; values: number }>).slice(f('start').rows);
    const pieces = rows.flatMap((r) => r.ops);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p === 'add:stroke')).toBe(true);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThanOrEqual(4);
    // together the pieces are over what ONE row may hold (16 KiB, or 4,096 keys and elements: here the points), each row is under it
    const total = { bytes: rows.reduce((n, r) => n + r.bytes, 0), values: rows.reduce((n, r) => n + r.values, 0) };
    expect(total.bytes > 16 * 1024 || total.values > 4096, JSON.stringify(total)).toBe(true);
    for (const r of rows) expect(r.bytes < 16 * 1024 && r.values < 4096, JSON.stringify(r)).toBe(true);
    expect(f('drawn')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: pieces.length, stored: true, sameAsMod: true, notices: [] });
    expect(f('undone')).toMatchObject({ keep: 'saved', pending: 0, nodes: 0, rows: f('drawn').rows + 1, sameAsMod: true, notices: [] });
    expect(f('undone').lastOps).toEqual(Array(pieces.length).fill('delete'));
  }, 300_000);
});
