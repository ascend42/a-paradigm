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
const COUNT = { read: `(() => { const k = ${A}.kernel; if (!k.__n) { k.__n = { n: 0 }; const send = k.send.bind(k); k.__g = []; k.__approve = { n: 0 }; k.send = (s) => { if (String(s).includes('"mod.command"')) { k.__n.n++; try { const m = JSON.parse(s); k.__g.push([m.params.commandId, m.params.args.gesture ? m.params.args.gesture.n : null]); } catch {} } if (String(s).includes('"method":"approve"')) k.__approve.n++; return send(s); }; } return 1; })()`, as: 'counting' };
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
    expect(f('reopened')).toMatchObject({ open: true, phase: 'open', nodes: 1, marks: 1, sameAsMod: true, drift: 0, frames: 4 });
    // their own fold undone: no line about an ended dimension
    expect(f('reopened').line).toMatch(/opened here/);
    expect(f('reopened').rows.slice(3)).toEqual(['session.start:menu']);
    // ⌥B again folds it
    expect(f('folded2')).toMatchObject({ open: false, frames: 5 });
    // /boards: the palette as the Dimensions list, this repo's dimensions; the composer keeps no command text
    const list = a.list as { head: string | null; rows: string[]; composer: string };
    expect(list.head).toBe('Dimensions');
    expect(list.composer).toBe('');
    expect(list.rows).toHaveLength(1);
    // the time is the kernel's `lastAt` (hh:mm today, else the date: the preview's clocks are not the same day)
    expect(list.rows[0]).toMatch(/^Totals are off by a cent.*(\d\d:\d\d|[A-Z][a-z]{2} \d{1,2}) · folded$/);
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
    // Aegis N2: an untrusted press says nothing either (the hidden edge tab's synthetic click on a session with no
    // board used to raise "This session has no board yet" before the trust check)
    expect(f('untrusted-first')).toMatchObject({ open: false, rows: [], frames: 0, toasts: [] });
    expect(a.row).toMatchObject({ disabled: null, text: 'Open board' });
    expect(f('menu')).toMatchObject({ open: true, phase: 'open', rows: ['session.start:menu'], frames: 1 });
    expect(f('menu').line).toMatch(/opened here · \d\d:\d\d$/);
    expect(f('folded')).toMatchObject({ open: false, frames: 2 });
    // with a board to reopen: a synthetic Enter, ⌥B, menu click and tab click still open nothing and send nothing
    expect(f('untrusted-with-board')).toMatchObject({ open: false, frames: 2, rows: f('folded').rows });
    expect(f('titled')).toMatchObject({ open: true, phase: 'open', title: 'plan B', frames: 3 });
    expect((a.titles as unknown[][]).map((t) => t[0])).toEqual(['Totals are off by a cent on 3-line orders. Find out why.', 'plan B']);
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
    );
    const f = (k: string): Facts => a[k] as Facts;
    if (process.env.GNOMON_DEBUG) console.log(JSON.stringify(a, null, 1));
    expect(a.errors).toEqual([]);
    expect(f('typing')).toMatchObject({ field: 'held', nodes: 1, frames: 2 });
    // down: held still, the field still open with its words, nothing sent; the line says the words are held
    expect(f('down')).toMatchObject({ open: true, inert: 'link-down', link: 'down', field: 'held', frames: 2, line: KEEP_COPY.wordsHeld });
    // (nothing is coming by itself here: the line says "Not connected", as the Reconnect dialog does)
    expect(KEEP_COPY.wordsHeld).toMatch(/^Not connected/);
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
      [...typeBoard, ...drawRect, { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, facts('down'), { read: `(document.querySelector('.bd-host .bd-head .key:last-child').click(), document.querySelector('.bd-host .bd-leaf').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), 1)`, as: 'synthetic' }, { wait: 400 }, facts('untrusted'), { key: 'Escape' }, { wait: 500 }, facts('folded')],
    );
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('down')).toMatchObject({ open: true, inert: 'link-down', line: 'Not connected', frames: 2 });
    // an untrusted esc click and Esc key fold nothing, held still or not (Aegis L2)
    expect(f('untrusted')).toMatchObject({ open: true, inert: 'link-down' });
    expect(f('folded')).toMatchObject({ open: false, frames: 2 });
    expect(f('folded').tab).toMatch(/· board$/);
  }, 120_000);

  it('Aegis N1: after a Reconnect run from the palette (the old socket still open) the old socket feeds nothing: no row, no toast, no second follow', async () => {
    // the first socket's own delivery, kept before the Reconnect gives the kernel a new connection; and every log.read
    const KEEP = `(() => { const k = ${A}.kernel; k.__oldMsg = k.onMessage; k.__reads = 0; const send = k.send.bind(k); k.send = (s) => { if (String(s).includes('"log.read"')) k.__reads++; return send(s); }; return typeof k.__oldMsg; })()`;
    // a kernel-written row the page would toast (a standing grant used), and the end of a follow page
    const frame = (via: string, seq: string): string => `(() => { const k = ${A}.kernel; const base = k.rows.find((r) => r.view === 'full' && /\\/kernel$/.test(String(r.event.principal))); const seq = k.rows[k.rows.length - 1].seq + ${seq}; const event = { ...base.event, seq, at: new Date().toISOString(), kind: 'grant.standing.used', payload: { grantId: 'grant:probe-' + seq, tuple: 'voice-arm:allow', decision: 'allow' } }; delete event.session; delete event.scope; const say = ${via}; k.__readsBefore = k.__reads; say(JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: 'event', params: { row: { seq, view: 'full', event } } })); if (${seq} === 1) say(JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: 'event', params: { end: { since: seq } } })); return seq; })()`;
    const said = { read: `({ toasts: [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent).filter((t) => /today.s grant/.test(t)), reads: ${A}.kernel.__reads - ${A}.kernel.__readsBefore, reconnect: !document.getElementById('reconnect').hidden })`, as: '' };
    const a = await real([
      { read: KEEP, as: 'kept' },
      { key: 'k', meta: true }, { wait: 200 }, ...type('reconnect'), { wait: 200 }, { key: 'Enter' }, { wait: 2500 },
      { read: `({ reads: ${A}.kernel.__reads, reconnect: !document.getElementById('reconnect').hidden, live: ${A}.kernel.onMessage !== ${A}.kernel.__oldMsg })`, as: 'back' },
      { read: frame(`k.__oldMsg`, '1'), as: 'oldSeq' }, { wait: 900 }, { ...said, as: 'old' },
      // the control: the same kind of row on the LIVE socket is applied and toasted
      { read: frame(`k.onMessage`, '2'), as: 'liveSeq' }, { wait: 900 }, { ...said, as: 'live' },
    ]);
    if (process.env.GNOMON_DEBUG) console.log(JSON.stringify(a, null, 1));
    expect(a.errors).toEqual([]);
    expect(a.kept).toBe('function');
    // the Reconnect made a second connection live and read the log on it (its page, then the follow)
    expect(a.back).toMatchObject({ reconnect: false, live: true });
    expect((a.back as { reads: number }).reads).toBeGreaterThan(0);
    // the old socket's row and its end of page: nothing applied, nothing said, no second follow over it
    expect(a.old).toEqual({ toasts: [], reads: 0, reconnect: false });
    expect(a.live).toMatchObject({ reconnect: false });
    expect((a.live as { toasts: string[] }).toasts).toHaveLength(1);
  }, 120_000);

  it('Aegis H1: a block button naming board.open or dimensions.list does nothing and sends nothing on a real press', async () => {
    const plant = (cmd: string): string => `(() => { const b = document.createElement('button'); b.type = 'button'; b.id = 'planted-' + ${JSON.stringify(cmd)}.replace('.', '-'); b.className = 'blk blk-button'; b.dataset.command = ${JSON.stringify(cmd)}; b.textContent = 'Allow'; document.getElementById('pinned').prepend(b); return b.id; })()`;
    const a = await real([
      { read: plant('board.open'), as: 'p1' }, { read: plant('dimensions.list'), as: 'p2' },
      { press: '#planted-board-open' }, { wait: 800 }, facts('board'),
      { press: '#planted-dimensions-list' }, { wait: 500 }, facts('list'), { read: `document.getElementById('palette').hidden`, as: 'paletteHidden' },
      // the control: a command a block MAY name does run from the same place
      { read: plant('theme.night'), as: 'p3' }, { press: '#planted-theme-night' }, { wait: 300 }, { read: 'document.documentElement.dataset.theme', as: 'theme' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('board')).toMatchObject({ open: false, rows: [], frames: 0 });
    expect(f('list')).toMatchObject({ open: false, rows: [], frames: 0 });
    expect(a.paletteHidden).toBe(true);
    expect(a.theme).toBe('night');
  }, 120_000);

  it('Mika blocker: a press on the Reconnect scrim then Esc does not fold a board holding typed words; the dialog sits clear of the field', async () => {
    const a = await real(
      [
        ...typeBoard, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('held'),
        { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, facts('down'),
        { read: `(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; }; return { card: r(document.querySelector('#reconnect .sheet-card')), field: r(document.querySelector('.bd-host .bd-board textarea')), line: r(document.querySelector('.bd-host .bd-keep')), stage: r(document.querySelector('.bd-host .bd-stage')) }; })()`, as: 'rects' },
        { press: '#status-line' }, { wait: 200 }, facts('pressed'), { read: `(document.querySelector('.bd-host .bd-leaf [role="status"]').textContent = '', 1)`, as: 'hushed' },
        { key: 'Escape' }, { wait: 500 }, facts('esc'), { read: `document.querySelector('.bd-host .bd-leaf [role="status"]').textContent`, as: 'said' },
      ],
      { shot: 'app-link-down' },
    );
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('down')).toMatchObject({ open: true, inert: 'link-down', field: 'held', line: KEEP_COPY.wordsHeld, reconnect: true });
    // the press landed on the scrim and took focus out of the field
    expect(f('pressed').active).not.toMatch(/TEXTAREA/);
    // Esc from outside the leaf: the board stays, the words stay, nothing is said lost because nothing was
    expect(f('esc')).toMatchObject({ open: true, field: 'held', line: KEEP_COPY.wordsHeld, toasts: [] });
    // Mika 1: and the Esc is not met with silence: the leaf says its held line again (as an Esc inside it does)
    expect(a.said).toBe(KEEP_COPY.wordsHeld);
    type R = { x: number; y: number; r: number; b: number };
    const r = a.rects as { card: R; field: R; line: R; stage: R };
    const meets = (p: R, q: R): boolean => p.x < q.r && q.x < p.r && p.y < q.b && q.y < p.b;
    expect(meets(r.card, r.field)).toBe(false);
    expect(meets(r.card, r.line)).toBe(false);
    expect(r.card.y).toBeGreaterThanOrEqual(r.stage.b - 1);
  }, 120_000);

  it('Mika blocker: a mark in flight when the link goes, then a fold while down, is said lost', async () => {
    const a = await real([
      ...typeBoard, { read: `(${A}.mod.silent = true, 1)`, as: 'silent' }, ...drawRect, facts('pending'),
      { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 800 }, facts('down'), { key: 'Escape' }, { wait: 600 }, facts('folded'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('pending').pending).toBeGreaterThan(0);
    // not saved, and nothing is coming: the line says both
    expect(f('down')).toMatchObject({ open: true, inert: 'link-down', line: KEEP_COPY.notSavedOff });
    // the fold came from the leaf itself: it folds, and the loss is SAID
    expect(f('folded').open).toBe(false);
    expect(f('folded').toasts.join(' | ')).toContain(KEEP_COPY.changesGone(1));
  }, 120_000);

  it('Mika blocker: after the link returns the cue that words are waiting stays up; a fold before a text is opened says the words were not saved', async () => {
    const a = await real(
      [
        ...typeBoard, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('held'),
        { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, { press: '#reconnect-btn' }, { wait: 3000 }, facts('back'), { wait: 7000 }, facts('later'),
        { read: `(() => { globalThis.__shot = 1; return 1; })()`, as: 'mark' },
      ],
      { shot: 'app-link-back' },
    );
    const b = await real([
      ...typeBoard, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('held'),
      { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, { press: '#reconnect-btn' }, { wait: 3000 },
      { press: '.bd-host .bd-head .spacer' }, { key: 'Escape' }, { wait: 900 }, facts('folded'),
    ]);
    a.folded = b.folded;
    expect(b.errors).toEqual([]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('back')).toMatchObject({ open: true, link: 'up', line: KEEP_COPY.wordsWait });
    // well past the six seconds a said line lasts: the cue is still up, and never "everything here is saved"
    expect(f('later')).toMatchObject({ open: true, link: 'up', line: KEEP_COPY.wordsWait });
    expect(f('folded').open).toBe(false);
    expect(f('folded').toasts.join(' | ')).toContain(KEEP_COPY.wordsGone);
  }, 120_000);

  it('ordinary use: /board sent with the SEND key opens a board and is never a message; the stored title is the whole name; an emoji title is cleaned and accepted; a refused title says why and leaves no leaf', async () => {
    const SENT = `${A}.kernel.__sent ?? (() => { const k = ${A}.kernel; k.__sent = []; const send = k.send.bind(k); k.send = (s) => { try { const m = JSON.parse(s); if (m.method === 'session.send' || m.method === 'session.open') k.__sent.push(m.method); } catch {} return send(s); }; return k.__sent; })()`;
    const titles = { read: `${A}.kernel.rows.filter((r) => String(r.event.kind).endsWith('session.start')).map((r) => r.event.payload.title)`, as: 'titles' };
    const a = await real([
      { read: `(${SENT}, 1)`, as: 'watching' },
      { press: '#composer-text' }, ...type('/board'), { press: '#composer-send' }, { wait: 2500 }, facts('sent'), { read: `({ sent: ${A}.kernel.__sent, composer: document.getElementById('composer-text').value })`, as: 'afterSend' },
      ...foldByEsc,
      { press: '#composer-text' }, ...type('/board '), { read: `(() => { const t = document.getElementById('composer-text'); t.value = '/board 👩‍👩‍👧 plan'; return t.value.length; })()`, as: 'emoji' }, { key: 'Enter' }, { wait: 2500 }, facts('emojiOpen'),
      ...foldByEsc,
      { press: '#composer-text' }, ...type('/board ghp_abcdefghijklmnopqrstuvwxyz0123456789'), { key: 'Enter' }, { wait: 2500 }, facts('refused'), titles,
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    // the send key's own click opened it, recorded as typed (`command`, as Enter is: the person typed /board);
    // nothing went to the agent, the composer is empty
    expect(f('sent')).toMatchObject({ open: true, phase: 'open', rows: ['session.start:command'] });
    expect(a.afterSend).toEqual({ sent: [], composer: '' });
    // the log holds the session's whole name, not the display cut with its …
    expect((a.titles as string[])[0]).toBe('Totals are off by a cent on 3-line orders. Find out why.');
    // a title with a zero-width joiner is cleaned page-side and accepted
    expect(f('emojiOpen')).toMatchObject({ open: true, phase: 'open', title: '👩👩👧 plan' });
    // and it is SENT cleaned: the log holds the title the leaf shows
    expect((a.titles as string[])[1]).toBe('👩👩👧 plan');
    // a title the mod refuses: no leaf is left up, the line says what is wrong with the TITLE, no row was written
    expect(f('refused').open).toBe(false);
    expect(f('refused').toasts.join(' | ')).toContain('That title looks like a credential · use another');
    expect(a.titles as string[]).toHaveLength(2);
  }, 180_000);

  it('with a board open nothing under the leaf takes focus: the chat header keys and the conversation are inert, and the leaf comes before the composer', async () => {
    const STATE = `(() => { const p = document.getElementById('pane-transcript'); const host = p.querySelector('.bd-host'); return { head: p.querySelector(':scope > .pane-head').inert, viewport: document.getElementById('viewport').inert, before: !!(host.compareDocumentPosition(document.getElementById('composer')) & Node.DOCUMENT_POSITION_FOLLOWING), pinnedAfter: !!(host.compareDocumentPosition(document.getElementById('pinned')) & Node.DOCUMENT_POSITION_FOLLOWING) }; })()`;
    const WHERE = `(() => { const e = document.activeElement; return e ? (e.closest('.bd-host') ? 'leaf' : e.closest('#pane-transcript > .pane-head') ? 'UNDER:head' : e.closest('#viewport') ? 'UNDER:viewport' : e.closest('#pinned') ? 'pinned' : e.closest('#composer') ? 'composer' : e.closest('#pane-transcript') ? 'pane:' + (e.id || e.className) : 'elsewhere') : 'none'; })()`;
    // the backward walk starts on the first stop after the leaf (a pinned card's key): from the composer's field it
    // could not start, as Shift+Tab there cycles the run mode (§11.5) and never moves focus
    const FROM_PINNED = `(() => { const e = document.querySelector('#pinned .card button:not([disabled]), #pinned .card [tabindex="0"]'); if (!e) return null; e.focus(); return document.activeElement === e ? (e.dataset.decision || e.id || e.className) : null; })()`;
    const walk = Array.from({ length: 14 }, (_, i) => [{ key: 'Tab', shift: true, settle: 60 }, { read: WHERE, as: `t${i}` }]).flat();
    const forward = Array.from({ length: 16 }, (_, i) => [{ key: 'Tab', settle: 60 }, { read: WHERE, as: `f${i}` }]).flat();
    const a = await real([{ read: STATE, as: 'closed' }, ...typeBoard, { read: STATE, as: 'open' }, { press: '.bd-host .bd-head .spacer' }, ...forward, { read: FROM_PINNED, as: 'from' }, ...walk, ...foldByEsc, facts('folded'), { read: STATE, as: 'after' }]);
    expect(a.errors).toEqual([]);
    expect(a.closed).toMatchObject({ head: false, viewport: false, before: true, pinnedAfter: true });
    expect(a.open).toMatchObject({ head: true, viewport: true });
    const stops = Array.from({ length: 14 }, (_, i) => a[`t${i}`] as string);
    // Shift+Tab back from the pinned card: into the leaf, never onto something under it
    expect(a.from, 'a pinned card key to start the backward walk from').not.toBeNull();
    expect(stops[0]).toBe('leaf');
    expect(stops.filter((s) => s.startsWith('UNDER'))).toEqual([]);
    expect(stops, `the backward walk: ${stops.join(' ')}`).toContain('leaf');
    // Tab forward from the leaf's head: the leaf's own stops, then the pinned cards or the composer, never under it
    const fwd = Array.from({ length: 16 }, (_, i) => a[`f${i}`] as string);
    expect(fwd.filter((s) => s.startsWith('UNDER'))).toEqual([]);
    expect(fwd[0]).toBe('leaf');
    const left = fwd.find((s) => s !== 'leaf');
    expect(['pinned', 'composer'], `after the leaf comes ${String(left)}: ${fwd.join(' ')}`).toContain(left);
    expect((a.folded as Facts).open).toBe(false);
    expect(a.after).toMatchObject({ head: false, viewport: false });
  }, 120_000);

  it('Probe: a card decides the same with and without a board open (a real Space and a real Enter on its key), and card letters typed on a focused board decide nothing', async () => {
    const focus = (label: string): string => `(() => { const all = [...document.querySelectorAll('#stack [data-decision]')]; const b = all.find((x) => x.textContent.trim().toLowerCase() === ${JSON.stringify(label)}.toLowerCase()); if (!b) return { missing: all.map((x) => x.textContent.trim() + '/' + x.tagName).slice(0, 12), stack: document.getElementById('stack').children.length }; b.focus(); return { id: b.dataset.cardId, decision: b.dataset.decision }; })()`;
    const state = `({ approve: ${A}.kernel.__approve.n, cards: document.querySelectorAll('#stack .card').length, frames: ${A}.kernel.__n.n })`;
    const acts = [
      { read: focus('Allow'), as: 'fAllow' }, { key: ' ', settle: 500 }, { read: state, as: 'sAllow' },
      { read: focus('Accept'), as: 'fAccept' }, { key: 'Enter', text: '\r', settle: 500 }, { read: state, as: 'sAccept' },
      { read: focus('Resolve'), as: 'fResolve' }, { key: ' ', settle: 500 }, { read: state, as: 'sResolve' },
    ];
    const without = await real([{ read: state, as: 's0' }, ...acts]);
    const withBoard = await real([...typeBoard, ...drawRect, facts('before'), { read: state, as: 's0' }, ...acts, facts('after')]);
    if (process.env.GNOMON_DEBUG) console.log('CARD', JSON.stringify(without));
    expect(without.errors).toEqual([]);
    expect(withBoard.errors).toEqual([]);
    type S = { approve: number; cards: number; frames: number };
    const d = (r: Record<string, unknown>, k: string): number => (r[k] as S).approve - (r.s0 as S).approve;
    // the real activation reaches the kernel as a decision (the test's own check that Space and Enter activate)
    expect(d(without, 'sAllow')).toBe(1);
    for (const k of ['sAllow', 'sAccept', 'sResolve']) expect(d(withBoard, k), `${k} with a board open`).toBe(d(without, k));
    for (const k of ['fAllow', 'fAccept', 'fResolve']) expect(withBoard[k], k).toEqual(without[k]);
    // and the board took none of it
    const before = withBoard.before as Facts;
    expect(withBoard.after).toMatchObject({ open: true, frames: before.frames, rows: before.rows, nodes: before.nodes, marks: before.marks, drift: 0 });
    // the other way: letters a card would read, typed with the BOARD focused, decide nothing
    const typed = await real([...typeBoard, { read: state, as: 's0' }, { press: '.bd-host [data-key="tool:select"]' }, { at: [200, 330], press: true }, ...type('adyn12'), { key: ' ' }, { wait: 300 }, { read: state, as: 's1' }, facts('f')]);
    expect(typed.errors).toEqual([]);
    expect((typed.s1 as S).approve).toBe((typed.s0 as S).approve);
    expect((typed.s1 as S).cards).toBe((typed.s0 as S).cards);
    expect(typed.f).toMatchObject({ open: true, nodes: 0, rows: ['session.start:command'] });
  }, 300_000);

  it('Probe: a synthetic click or Enter on the palette row "Open board" and on a /boards row opens nothing; a row of another session attaches then opens on ONE stamp', async () => {
    const synth = `(() => { const i = document.getElementById('palette-input'); const row = document.querySelector('#palette-list .pal-row.sel') || document.querySelector('#palette-list .pal-row'); const text = row ? row.textContent : null; if (row) row.click(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); return text; })()`;
    const tagIdle = `(() => { const rows = [...document.querySelectorAll('#session-list [data-hsid]')]; const idle = rows.find((x) => /idle/.test(x.textContent)); idle.dataset.probeIdle = '1'; return idle.dataset.hsid; })()`;
    const a = await real([
      // the palette's own row, untrusted
      { key: 'k', meta: true }, { wait: 200 }, ...type('open board'), { wait: 200 }, { read: synth, as: 'palRow' }, { wait: 600 }, facts('palette'), { key: 'Escape' }, { key: 'Escape' },
      // a dimension of this session, folded; then its /boards row, untrusted
      ...typeBoard, ...foldByEsc, { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { wait: 400 },
      { read: `document.getElementById('palette-input').placeholder`, as: 'placeholder' }, { read: synth, as: 'listRow' }, { wait: 600 }, facts('list'), { key: 'Escape' }, { key: 'Escape' }, { wait: 200 },
      // another session, by a real press on its row: with no board yet its repo is not known, so /boards lists nothing
      { read: tagIdle, as: 'hsid2' }, { press: '#session-list [data-probe-idle]' }, { wait: 400 },
      { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { wait: 400 }, { read: `({ head: document.querySelector('#palette-list .menu-h')?.textContent ?? null, open: !document.getElementById('palette').hidden, rows: [...document.querySelectorAll('#palette-list [data-dim]')].map((r) => r.textContent) })`, as: 'unknownRows' }, { key: 'Escape' }, { key: 'Escape' }, { wait: 200 },
      // its own board (so its repo is known), folded; then the FIRST session's row from /boards
      ...typeBoard, ...foldByEsc, facts('second'),
      { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { wait: 400 }, { read: `[...document.querySelectorAll('#palette-list [data-dim]')].map((r) => r.textContent)`, as: 'rows' },
      ...type('Totals'), { wait: 200 }, { read: `[...document.querySelectorAll('#palette-list [data-dim]')].map((r) => r.textContent)`, as: 'filtered' }, { key: 'Enter' }, { wait: 2500 }, facts('attached'),
      { read: `${A}.kernel.__g`, as: 'stamps' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(String(a.palRow)).toMatch(/^Open board/);
    expect(f('palette')).toMatchObject({ open: false, rows: [], frames: 0 });
    expect(a.placeholder).toBe('find a dimension');
    expect(String(a.listRow)).toMatch(/^Totals are off/);
    expect(f('list')).toMatchObject({ open: false, frames: 2 });
    // the second session, before it has a board of its own: its repo is unknown, and no other repo's board is listed
    expect(a.unknownRows).toMatchObject({ open: true, head: 'Dimensions' });
    expect((a.unknownRows as { rows: string[] }).rows).toEqual([]);
    // the second session lists both dimensions of the repo; the first session's says it is not this session's yet
    expect(a.rows as string[]).toHaveLength(2);
    expect((a.filtered as string[])[0]).toMatch(/^Totals are off.*not this session’s yet$/);
    // ONE press: dim.attach then dim.open, both on the same stamp
    expect(f('attached')).toMatchObject({ open: true, phase: 'open' });
    expect(f('attached').rows.slice(-2)).toEqual(['attach', 'session.start:command']);
    const stamps = a.stamps as Array<[string, number | null]>;
    expect(stamps.slice(-2).map((s) => s[0])).toEqual(['dim.attach', 'dim.open']);
    expect(stamps[stamps.length - 1]![1]).toBe(stamps[stamps.length - 2]![1]);
    expect(stamps[stamps.length - 1]![1]).not.toBeNull();
  }, 240_000);

  it('Probe: a board that is out of date (a driven hash mismatch) is held still: a real drag and real keys add nothing and send nothing, and Esc still folds it', async () => {
    const lie = `(() => { const m = ${A}.mod; const run = m.run.bind(m); m.run = (...x) => { const r = run(...x); if (x[0] === 'dim.open' && r && r.ok) r.hash = 'sha256:' + '0'.repeat(64); return r; }; return 1; })()`;
    const a = await real([
      { read: lie, as: 'lie' }, ...typeBoard, facts('opened'),
      { read: `(() => { const k = ${A}.kernel; k.__before = k.__n.n; return 1; })()`, as: 'm' },
      { press: '.bd-host [data-key="tool:rect"]' }, { drag: [[250, 200], [290, 225], [330, 250]] }, { wait: 400 }, ...type('nt'), { at: [200, 330], press: true }, ...type('zz'), { key: 'Delete' }, { wait: 400 }, facts('poked'),
      { key: 'Escape' }, { wait: 900 }, facts('folded'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('opened')).toMatchObject({ open: true, inert: 'out-of-date', line: 'This board is out of date · fold it and open it again' });
    expect(f('opened').check).toMatch(/^Did not match at change \d+/);
    // real input on the held-still board: no mark, no row, no command left the page
    expect(f('poked')).toMatchObject({ open: true, inert: 'out-of-date', nodes: 0, marks: 0, rows: ['session.start:command'], frames: f('opened').frames, field: null });
    // the line tells the person to fold, and the fold works
    expect(f('folded').open).toBe(false);
  }, 120_000);

  it('G-DDL-08 core: with a card focused no key reaches the board (no op, no frame, no engine change), ⌥B included; no card focus runs during a board text edit', async () => {
    const KEYS: Array<Record<string, unknown>> = [{ key: 'a' }, { key: 'd' }, { key: 'y' }, { key: 'n' }, { key: '1' }, { key: '2' }, { key: 'o', meta: true }, { key: 's', meta: true }, { key: 'e', meta: true, shift: true }, { key: 'z', meta: true }, { key: 'v', meta: true, commands: ['paste'] }, { key: 'b', alt: true }, { key: 'Escape' }, { key: 'Enter' }];
    const focusCard = { read: `(() => { const c = document.querySelector('#stack .card [data-decision], #pinned .card [data-decision], #stack .card button, #pinned .card button'); if (c) c.focus(); return !!(document.activeElement && document.activeElement.closest('.card')); })()`, as: 'focused' };
    const steps = KEYS.flatMap((k, i) => [{ ...focusCard, as: `card${i}` }, { ...k, settle: 120 }, facts(`k${i}`)]);
    const a = await real([
      ...typeBoard, ...drawRect, { press: '.bd-host [data-key="tool:select"]' }, facts('before'), ...steps,
      // a text being typed on the board: a programmatic card focus does not run
      { at: [200, 330], press: true }, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('ab'),
      { read: `(() => { const id = document.querySelector('#stack .card')?.dataset.cardId ?? document.querySelector('#stack [data-card-id]')?.dataset.cardId ?? null; if (id) ${A}.board.focusCard(id); return { id, tag: document.activeElement.tagName, card: !!document.activeElement.closest('.card'), editing: ${A}.board.dock.editingText(), toasts: [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent) }; })()`, as: 'midword' },
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
    // and it is SAID (Aegis L5): the card waits, it is not silently skipped
    expect((a.midword as { toasts: string[] }).toasts.join(' | ')).toContain(KEEP_COPY.cardWaits);
    expect((a.midword as { id: string | null }).id).not.toBeNull();
  }, 240_000);

  it.each([
    { width: 1440, height: 900, fixture: 'desk', theme: 'day', pinned: 'own' },
    { width: 1024, height: 768, fixture: 'desk', theme: 'night', pinned: 'own' },
    { width: 1440, height: 900, fixture: 'always-scopes', theme: 'night', pinned: 'two' },
    { width: 1024, height: 768, fixture: 'always-scopes', theme: 'day', pinned: 'two' },
    { width: 1280, height: 800, fixture: 'desk', theme: 'day', pinned: 'own' },
    { width: 1280, height: 800, fixture: 'always-scopes', theme: 'day', pinned: 'two' },
    { width: 640, height: 400, fixture: 'desk', theme: 'day', pinned: 'own' },
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
