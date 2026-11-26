/**
 * #gui-board-dock in the REAL APP on a real engine (boards S1.3 pass P4b-1): the dev preview serves the real
 * ui/app.ts over its fake kernel with the dimension mod's real checks behind it (`?dim=1`), in a real Chrome driven
 * with real pointer and key input over the DevTools protocol (a frame between pointer moves). Everything under test
 * is the shipped path: the app's own GnomonClient, followLog into both stores, DimSessions, the one sender with
 * stamps minted from the person's events, the dock, the leaf and the engine chunk through the lazy loader.
 * The real kernel and mod are driven by packages/gnomon/test/dimension-dogfood.test.ts.
 * Runs where a Chrome is installed; run it ALONE (a loaded machine times it out). On CI it runs only on the leg
 * that asks for it (GNOMON_BROWSER_TESTS=1: the `board-browser` job of .github/workflows/gnomon.yml, macos-15), and
 * there a missing Chrome FAILS the run, it never skips. Every other CI leg skips it, as before.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { embeddedBundle } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { fixtureUrl, startPreview } from '../scripts/preview.mjs';
import { KEEP_COPY } from '../src/core/board-leaf.js';
import { TURN_COPY } from '../src/core/board-turn.js';

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
    chk: (() => { const foot = l ? l.querySelector('.bd-foot') : null; const c = foot ? foot.querySelector('.bd-check') : null; if (!c) return null; const b = c.getBoundingClientRect(); const fb = foot.getBoundingClientRect(); const hands = [...foot.querySelectorAll('.bd-hand')].map((x) => x.getBoundingClientRect().right);
      return { text: c.textContent, bad: c.classList.contains('bad'), whole: b.width > 0 && b.height > 0 && b.left >= fb.left && b.right <= fb.right + 0.5 && c.scrollWidth <= c.clientWidth + 1 && hands.every((r) => r <= b.left), title: l.querySelector('.bd-g').getAttribute('title') }; })(),
    active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName + '.' + document.activeElement.className) : null, card: !!(document.activeElement && document.activeElement.closest('.card')), errs: (globalThis.__errs || []).length};
} catch (e) { return { threw: String(e && e.stack).slice(0, 500) }; } })()`;
const facts = (as: string) => ({ read: FACTS, as });
const SHOTS = process.env.GNOMON_SHOTS_DIR ?? '';
const keepShot = (name: string, png: Buffer): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `s14b-${name}.png`), png);
};
const fa = (a: Record<string, unknown>, k: string): Facts => a[k] as Facts;
type Facts = { chk: { text: string; bad: boolean; whole: boolean; title: string | null } | null; open: boolean; title: string | null; line: string | null; inert: string | null; check: string | null; tab: string | null; rows: string[]; frames: number; phase: string | null; keep: string | null; link: string | null; pending: number | null; nodes: number | null; texts: string[] | null; sameAsMod: boolean | null; marks: number | null; drift: number | null; tool: string | null; field: string | null; toasts: string[]; reconnect: boolean; active: string | null; card: boolean };
const type = (s: string): unknown[] => [...s].map((k) => ({ key: k, settle: 25 }));
/** the board is OPEN: its leaf has left `loading` with a live engine handle and the session's open has been answered (never a fixed sleep: Probe saw rows fail under load) */
const BOARD_UP = `(() => { const c = ${CUR}; if (!c) return false; const hd = c.leaf.handle(); return c.leaf.state() !== 'loading' && !!hd && hd.isAlive() && c.session.status().phase !== 'opening'; })()`;
const typeBoard = [{ press: '#composer-text' }, ...type('/board'), { key: 'Enter' }, { until: BOARD_UP, as: 'the board open after /board', timeoutMs: 30_000 }, { wait: 300 }];
const drawRect = [{ press: '.bd-host [data-key="tool:rect"]' }, { drag: [[250, 200], [290, 225], [330, 250]] }, { wait: 500 }];
const foldByEsc = [{ press: '.bd-host .bd-head .spacer' }, { key: 'Escape' }, { wait: 900 }];
/* #gui-board-turn: the focused session, turns driven as the kernel would write them, and what the strip shows */
const HS = `document.querySelector('#session-list .session-row.active').dataset.hsid`;
const append = (kind: string, payload: Record<string, unknown>): { read: string; as: string } => ({ read: `${A}.kernel.append(${JSON.stringify(kind)}, Object.assign({ hsid: ${HS} }, ${JSON.stringify(payload)}), ${HS})`, as: `appended-${kind}-${JSON.stringify(payload).length}` });
const replyRow = (text: string) => append('turn.event', { type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) });
const toolRow = (command: string) => append('turn.event', { type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command } }] } }) });
/** the preview reads the fixtures' afternoon (Date.now shifted); rows appended here carry the real time: the clocks need the real one */
const realClock = { read: `(Date.now = () => new Date().getTime(), 1)`, as: 'realClock' };
const toIdle = [{ read: `(() => { const rows = [...document.querySelectorAll('#session-list [data-hsid]')]; const idle = rows.find((x) => /idle/.test(x.textContent)); if (idle) idle.click(); return !!idle; })()`, as: 'idle' }, { wait: 400 }];
const sendTyped = (t: string) => [{ press: '#composer-text' }, ...type(t), { key: 'Enter' }, { wait: 500 }];
const STRIP = `(() => { const s = document.getElementById('board-turn'); const key = s.querySelector('.bd-turn-key'); const wk = s.querySelector('[data-strip-work]'); const vp = document.getElementById('viewport');
  return { shown: !s.hidden && s.getBoundingClientRect().height > 0, rows: [...s.querySelectorAll('.bd-turn-r')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()), kinds: [...s.querySelectorAll('.bd-turn-r')].map((r) => r.className),
    keyTitle: key ? key.title : null, work: wk ? { label: wk.getAttribute('aria-label'), expanded: wk.hasAttribute('aria-expanded'), caret: !!wk.querySelector('.caret'), clock: wk.querySelector('.live-clock').textContent } : null,
    live: !!s.querySelector('[aria-live]') || s.hasAttribute('aria-live'), said: (document.querySelector('.bd-host .bd-leaf [role="status"]') || {}).textContent ?? null,
    atEnd: vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2, chatWork: (() => { const k = vp.querySelector('.work-key'); return k ? { expanded: k.getAttribute('aria-expanded'), focused: document.activeElement === k, steps: !!vp.querySelector('ol.steps') } : null; })() }; })()`;
type Strip = { shown: boolean; rows: string[]; kinds: string[]; keyTitle: string | null; work: { label: string; expanded: boolean; caret: boolean; clock: string } | null; live: boolean; said: string | null; atEnd: boolean; chatWork: { expanded: string | null; focused: boolean; steps: boolean } | null };
const strip = (as: string) => ({ read: STRIP, as });

describe('the hash-mismatch hook is the PREVIEW mod\'s and is in nothing the kernel serves (a test switch on a security rule is never a runtime option)', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const TOKENS = ['wrongHashNext'];
  it('no shipped source names it: only src/preview does, and the page\'s own check (core/dim-session.ts) has no switch', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const shipped = walk(path.join(ROOT, 'src')).filter((f) => !f.split(path.sep).includes('preview') && /\.(ts|css|js)$/.test(f));
    expect(shipped.length).toBeGreaterThan(50);
    for (const f of shipped) for (const t of TOKENS) expect(readFileSync(f, 'utf8').includes(t), `${path.relative(ROOT, f)} names ${t}`).toBe(false);
    expect(readFileSync(path.join(ROOT, 'src', 'preview', 'dim-mod.ts'), 'utf8')).toContain('wrongHashNext');
    // and none IMPORTS anything of the preview (an import would bring the hook in without ever naming it)
    const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"`]([^'"`]+)['"`]/g;
    let imports = 0;
    for (const f of shipped) {
      for (const m of readFileSync(f, 'utf8').matchAll(IMPORT)) {
        imports++;
        expect(/(^|\/)preview(\/|$)|preview\.(m?js|ts)$/.test(m[1]!), `${path.relative(ROOT, f)} imports ${m[1]}`).toBe(false);
      }
    }
    expect(imports).toBeGreaterThan(200); // the scan really read import lines
    // (the scan can see such an import: the preview's own entry has them, of shipped code)
    expect([...readFileSync(path.join(ROOT, 'src', 'preview', 'main.ts'), 'utf8').matchAll(IMPORT)].length).toBeGreaterThan(5);
    expect(/(^|\/)preview(\/|$)/.test('../preview/dim-mod.js')).toBe(true);
    // the check itself: one comparison, no flag, no environment, no option that could skip it
    const check = readFileSync(path.join(ROOT, 'src', 'core', 'dim-session.ts'), 'utf8');
    expect(check).toContain('const same = dimHash(store.stateAt(this.dim, v.seq)) === v.hash;');
    expect(check).not.toMatch(/__GNOMON_PREVIEW__|process\.env|skipCheck|noVerify/);
  });
  it('the pinned bundle (what the kernel serves) holds neither the hook nor the preview mod', () => {
    const bundle = embeddedBundle() as Map<string, Buffer>;
    expect(bundle.size).toBeGreaterThan(3);
    const has = (name: string, token: string): boolean => bundle.get(name)!.toString('utf8').includes(token);
    // POSITIVE CONTROL: the same scan finds a string that IS shipped, in the app and in the board chunk, so a "no"
    // below is a real no (the files are there, decoded, and searchable)
    expect([...bundle.keys()]).toEqual(expect.arrayContaining(['app.js', 'board/board.js']));
    expect(has('app.js', 'not checked yet')).toBe(true);
    expect(has('app.js', 'Dimensions in this project (/boards)')).toBe(true);
    expect(has('board/board.js', 'excalidraw')).toBe(true);
    let scanned = 0;
    for (const name of bundle.keys()) {
      if (!/\.(js|css|html)$/.test(name)) continue;
      scanned++;
      for (const t of [...TOKENS, 'PreviewDimMod', 'refuseNext', 'FakeKernel', 'preview-gui-token']) expect(has(name, t), `${name} holds ${t}`).toBe(false);
    }
    expect(scanned).toBeGreaterThanOrEqual(4);
  });
});

const chrome = findChrome() as string | null;
/** asked for by name (the CI leg that runs it): then nothing about the host may skip it */
const ASKED = process.env.GNOMON_BROWSER_TESTS === '1';
describe.skipIf(ASKED ? false : !!process.env.CI || !chrome)('the board in the real app on a real engine: open, draw, fold, reopen, list, link, G-DDL-08', () => {
  it('a Chrome is installed where this suite is asked for', () => {
    expect(chrome, 'GNOMON_BROWSER_TESTS=1 and no Chrome on this host (set GNOMON_CHROME to its path)').not.toBeNull();
  });
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { shot?: string; fixture?: string; theme?: string; width?: number; height?: number; cpuThrottle?: number } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: `${fixtureUrl(p.url, o.fixture ?? 'desk', o.theme ?? 'day', 'off')}&dim=1`, width: o.width ?? 1440, height: o.height ?? 900, timeoutMs: 60_000, cpuThrottle: o.cpuThrottle ?? 0, actions: [ERRORS, COUNT, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
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
    // never a bare "verified" and no log row on the face (design check.words): a new board has no mark to check yet
    expect(f('opened').check).toBe('nothing to check yet');
    expect(f('drawn')).toMatchObject({ rows: ['session.start:command', 'op:add'], frames: 2, nodes: 1, marks: 1, pending: 0, keep: 'saved', sameAsMod: true, drift: 0 });
    // the check does not vouch for the row after its point
    expect(f('drawn').check).toBe('checked up to 1 change ago');
    // P4b-3: the check is READ ON THE LEAF, whole, at the foot's right end (it was a hover title on the head's 8px glyph)
    expect(f('opened').chk).toMatchObject({ text: f('opened').check, bad: false, whole: true, title: null });
    expect(f('drawn').chk).toMatchObject({ text: f('drawn').check, bad: false, whole: true });
    expect(f('drawn').chk!.text).toBe('checked up to 1 change ago');
    expect(f('reopened').chk).toMatchObject({ bad: false, whole: true });
    expect(f('reopened').chk!.text).toBe('checked up to the last change');
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

  it('a principal change drops held words (Aegis, option b): the link goes mid-text, the page comes back as SOMEONE ELSE, and the words are gone, said once, never waiting and never put into a text that person opens', async () => {
    const WHO = `(() => { const k = ${A}.kernel; return k.principal; })()`;
    const a = await real([
      ...typeBoard, { read: WHO, as: 'me' },
      { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('secret'), facts('typing'),
      { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, facts('down'),
      // the next connection authenticates as another principal (the preview kernel's test hook)
      { read: `(() => { const k = ${A}.kernel; k.principal = k.principal.replace(/[^/]*$/, 'someone-else'); return k.principal; })()`, as: 'other' },
      { press: '#reconnect-btn' }, { wait: 3000 }, facts('back'),
      { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 700 }, facts('text-opened'),
      { at: [200, 330], press: true }, { wait: 900 }, facts('after'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(a.other).not.toBe(a.me);
    expect(String(a.other)).toMatch(/someone-else$/);
    expect(f('typing')).toMatchObject({ field: 'secret', frames: 1 });
    // down: the words are held, as for anyone
    expect(f('down')).toMatchObject({ open: true, link: 'down', field: 'secret', line: KEEP_COPY.wordsHeld });
    // back as someone else: the board is there, the words are NOT waiting, and their loss is said (once)
    expect(f('back')).toMatchObject({ open: true, link: 'up', inert: '', field: null, texts: [] });
    expect(f('back').line).not.toBe(KEEP_COPY.wordsWait);
    expect(f('back').toasts.filter((t) => t.includes(KEEP_COPY.wordsGone))).toHaveLength(1);
    // a text that person opens is empty: nothing of the first person's words reaches it, the board or the log
    expect(f('text-opened')).toMatchObject({ field: '' });
    expect(f('text-opened').line).not.toBe(KEEP_COPY.wordsBack);
    expect(f('after').texts).toEqual([]);
    expect(f('after').rows.filter((r) => r.startsWith('op'))).toEqual([]);
    expect(f('after').toasts.filter((t) => t.includes(KEEP_COPY.wordsGone)).length).toBeLessThanOrEqual(1);
  }, 120_000);

  it.each(['link-down', 'out-of-date'] as const)('keys at the engine\'s DOCUMENT listeners while the leaf is held still (%s): with a mark on the board, real Cmd+A, Delete, Backspace, arrows, tool letters and digits, Cmd+A, Cmd+D, Cmd+Z and Cmd+V change nothing in the engine and send nothing, with focus on the board and off it', async (why) => {
    // the preview mod's own hook: its next dim.open answers a hash that is not its fold's, once (src/preview/dim-mod.ts)
    const lie = `(${A}.mod.wrongHashNext = true, 1)`;
    // what the ENGINE holds (not the fold): every mark's place and size, the selection, the tool, the view
    const ENGINE = `(() => { const c = ${CUR}; const hd = c && c.leaf.handle(); if (!hd || !hd.isAlive()) return null; const st = hd.state(); const v = hd.view(); return JSON.stringify({ marks: hd.marks().map((m) => [m.id ?? null, Math.round(m.x ?? m.left ?? 0), Math.round(m.y ?? m.top ?? 0), Math.round(m.width ?? m.w ?? 0), Math.round(m.height ?? m.h ?? 0)]), count: hd.count(), drift: hd.drift().length, tool: st.tool, selected: st.selected, editing: st.editingText, zoom: v.zoom, sx: Math.round(v.scrollX), sy: Math.round(v.scrollY) }); })()`;
    const KEYS: Array<Record<string, unknown>> = [{ key: 'a', meta: true }, { key: 'Delete' }, { key: 'Backspace' }, { key: 'ArrowRight' }, { key: 'ArrowDown' }, { key: 'r' }, { key: 'o' }, { key: 't' }, { key: 'n' }, { key: '2' }, { key: '7' }, { key: 'd', meta: true }, { key: 'z', meta: true }, { key: 'z', meta: true, shift: true }, { key: 'v', meta: true, commands: ['paste'] }, { key: 'x', meta: true, commands: ['cut'] }, { key: 'Enter' }, { key: ' ' }];
    const press = (tag: string) => KEYS.flatMap((k, i) => [{ ...k, settle: 90 }, { read: ENGINE, as: `${tag}${i}` }, facts(`${tag}f${i}`)]);
    const hold = why === 'link-down'
      ? [{ read: `(${A}.down(), 1)`, as: 'held' }, { wait: 500 }]
      // a board with a mark that then opens out of date: folded, the mod made to answer a wrong hash, reopened
      : [...foldByEsc, { read: lie, as: 'held' }, { key: 'b', alt: true }, { wait: 2500 }];
    const a = await real([
      ...typeBoard, ...drawRect, { press: '.bd-host [data-key="tool:select"]' }, { at: [290, 225], press: true }, { wait: 200 }, { read: ENGINE, as: 'drawn' },
      ...hold, facts('heldFacts'), { read: ENGINE, as: 'before' },
      // focus where the engine's own canvas is (its container keeps focus from the press before the hold, or takes this one)
      { read: `(() => { const c = ${CUR}; c.leaf.handle().focus(); return document.activeElement ? document.activeElement.className : null; })()`, as: 'focusOn' },
      ...press('on'),
      // focus off the board: the page body (the document's listeners hear these too)
      { press: '#pane-stack .pane-head h2, #pane-stack .pane-head .title, #pane-stack .pane-head' }, { read: `(() => { const e = document.activeElement; return !e || !e.closest('.bd-host'); })()`, as: 'focusOff' }, facts('offStart'),
      ...press('off'),
      // the APP's own shortcuts still work with focus on the held-still board: ⌘K opens the palette, ⌥B folds the board
      { read: `(() => { const c = ${CUR}; c.leaf.handle().focus(); return document.activeElement ? document.activeElement.className : null; })()`, as: 'focusAgain' },
      { key: 'k', meta: true }, { wait: 300 }, { read: `!document.getElementById('palette').hidden`, as: 'palette' }, { key: 'Escape' }, { wait: 300 }, { read: `!document.getElementById('palette').hidden`, as: 'paletteClosed' }, facts('afterPalette'),
      { read: `(() => { const c = ${CUR}; c.leaf.handle().focus(); return 1; })()`, as: 'focusThird' },
      { key: 'b', alt: true }, { wait: 900 }, facts('afterAltB'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(String(a.focusAgain)).toMatch(/excalidraw/);
    expect(a.palette, '⌘K with focus on the held-still board opens the palette').toBe(true);
    expect(a.paletteClosed).toBe(false);
    expect(f('afterPalette')).toMatchObject({ open: true, inert: why });
    expect(f('afterAltB').open, '⌥B with focus on the held-still board folds it').toBe(false);
    const drawn = JSON.parse(String(a.drawn)) as { count: number; selected: number };
    expect(drawn.count).toBe(1);
    expect(f('heldFacts')).toMatchObject({ open: true, inert: why, nodes: 1, marks: 1 });
    const before = String(a.before);
    const frames = f('heldFacts').frames;
    const rows = f('heldFacts').rows;
    expect(JSON.parse(before)).toMatchObject({ count: 1, drift: 0, editing: false });
    expect(String(a.focusOn)).toMatch(/excalidraw/);
    expect(a.focusOff).toBe(true);
    // (the press that took focus off the board did nothing else: the board is as it was)
    expect(f('offStart')).toMatchObject({ open: true, inert: why, card: false });
    for (const tag of ['on', 'off']) {
      KEYS.forEach((k, i) => {
        const name = `${tag} the board: ${k.meta ? 'Cmd+' : ''}${k.shift ? 'Shift+' : ''}${String(k.key)}`;
        expect(JSON.parse(String(a[`${tag}${i}`])), name).toEqual(JSON.parse(before));
        expect(f(`${tag}f${i}`), name).toMatchObject({ open: true, inert: why, frames, rows, nodes: 1, marks: 1, field: null, pending: 0 });
      });
    }
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

  it('#gui-board-turn: with the board open the latest turn shows under it: the message sent, the working key ticking (no caret, named for the chat), then the reply and how it ended; never a live region', async () => {
    const a = await real([
      realClock, ...toIdle, ...typeBoard, strip('before'), facts('opened'),
      ...sendTyped('Why are totals off by a cent'), strip('sent'),
      append('turn.sent', { turn: 'turn:p4b2/1' }), { wait: 400 }, strip('running'), { wait: 2300 }, strip('ticked'),
      replyRow('I traced it to lineTotal() rounding each line, but ran out of turns before the fix.'), append('turn.result', { subtype: 'error_max_turns', is_error: true, turn: 'turn:p4b2/1' }), { wait: 500 }, strip('ended'), facts('after'),
    ], { width: 1440, height: 900 });
    const s = (k: string): Strip => a[k] as Strip;
    expect(a.errors).toEqual([]);
    // the idle session's last turn, before anything is sent from here
    expect(s('before').shown).toBe(true);
    expect(s('before').rows[0]).toMatch(/^you · .+ · \d\d:\d\d$/);
    expect(s('before').rows[1]).toMatch(/^Claude · .+ show chat$/);
    expect(s('before').keyTitle).toBe(TURN_COPY.showChatTitle);
    // sent with the board open: the board stays, the message is on the you row (a message, never a board op)
    expect(s('sent').rows[0]).toMatch(/^you · Why are totals off by a cent · \d\d:\d\d$/);
    expect(s('sent').rows[1]).toBe('waiting show chat');
    expect(s('running').work).toMatchObject({ expanded: false, caret: false, label: 'working… · show its steps in the chat' });
    expect(s('ticked').work!.clock).not.toBe(s('running').work!.clock);
    expect(s('ended').work).toBeNull();
    expect(s('ended').rows[1]).toBe('Claude · I traced it to lineTotal() rounding each line, but ran out of turns before the fix. · stopped: turn limit show chat');
    for (const k of ['before', 'sent', 'running', 'ended']) expect(s(k).live, k).toBe(false);
    expect(fa(a, 'after')).toMatchObject({ open: true, frames: fa(a, 'opened').frames, rows: fa(a, 'opened').rows });
  }, 120_000);

  it('#gui-board-turn: Esc in the composer folds the board and focus stays in the composer; a synthetic Esc there folds nothing and says nothing; on a held board it says the held line', async () => {
    const synthEsc = `(() => { const t = document.getElementById('composer-text'); t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return document.activeElement.id; })()`;
    const a = await real([
      ...typeBoard, { press: '#composer-text' }, { read: `(document.querySelector('.bd-host .bd-leaf [role="status"]').textContent = '', 1)`, as: 'hush' }, { read: synthEsc, as: 'synth' }, { wait: 500 }, facts('synthetic'), strip('synthetic-strip'),
      { key: 'Escape' }, { wait: 900 }, facts('folded'),
      { key: 'b', alt: true }, { wait: 2200 }, facts('reopened'),
    ]);
    expect(a.errors).toEqual([]);
    expect(fa(a, 'synthetic')).toMatchObject({ open: true, toasts: [], active: 'composer-text' });
    expect((a['synthetic-strip'] as Strip).said).toBe('');
    // a real Esc: dim.close, the leaf folds to its edge tab, the composer keeps the focus (and its words)
    expect(fa(a, 'folded')).toMatchObject({ open: false, active: 'composer-text' });
    expect(fa(a, 'folded').rows.slice(-1)).toEqual(['session.end']);
    expect(fa(a, 'folded').tab).toMatch(/· board$/);
    expect(fa(a, 'reopened')).toMatchObject({ open: true, sameAsMod: true });
    // held still with typed words: Esc from the composer does not fold, and the leaf says its held line again
    const b = await real([
      ...typeBoard, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('held'),
      { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 500 }, { read: `(document.getElementById('composer-text').focus(), document.querySelector('.bd-host .bd-leaf [role="status"]').textContent = '', document.activeElement.id)`, as: 'inComposer' },
      { key: 'Escape' }, { wait: 500 }, facts('esc'), strip('esc-strip'),
    ]);
    expect(b.errors).toEqual([]);
    expect(b.inComposer).toBe('composer-text');
    expect(fa(b, 'esc')).toMatchObject({ open: true, field: 'held', toasts: [] });
    expect((b['esc-strip'] as Strip).said).toBe(KEEP_COPY.wordsHeld);
    expect((b['esc-strip'] as Strip).keyTitle).toBe(TURN_COPY.keptTitle);
  }, 180_000);

  it('#gui-board-turn: show chat: a synthetic press does nothing and says nothing; a real press folds, focus in the chat at its latest row; ⌥B reopens the same board; held still it does not fold and says why', async () => {
    const synth = `(() => { document.querySelector('.bd-host .bd-leaf [role="status"]').textContent = ''; document.querySelector('#board-turn .bd-turn-key').click(); document.querySelector('#board-turn .bd-turn-key').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`;
    const a = await real([
      ...typeBoard, ...drawRect, { read: `(globalThis.__hash = ${CUR}.session.hash(), 1)`, as: 'h' },
      { read: synth, as: 's' }, { wait: 500 }, facts('synthetic'), strip('synthetic-strip'),
      { press: '#board-turn .bd-turn-key' }, { wait: 900 }, facts('shown'), strip('shown-strip'),
      { key: 'b', alt: true }, { wait: 2200 }, facts('reopened'), { read: `${CUR}.session.hash() === globalThis.__hash`, as: 'sameHash' },
    ]);
    expect(a.errors).toEqual([]);
    expect(fa(a, 'synthetic')).toMatchObject({ open: true, toasts: [], frames: 2 });
    expect((a['synthetic-strip'] as Strip).said).toBe('');
    expect(fa(a, 'shown')).toMatchObject({ open: false, active: 'viewport' });
    expect(fa(a, 'shown').rows.slice(-1)).toEqual(['session.end']);
    const shown = a['shown-strip'] as Strip;
    expect(shown.shown).toBe(false);
    expect(shown.atEnd).toBe(true);
    expect(fa(a, 'reopened')).toMatchObject({ open: true, marks: 1, sameAsMod: true });
    expect(a.sameHash).toBe(true);
    // held still with a change not saved: the key's title says it is kept open; a real press keeps the board and says the held line
    const b = await real([
      ...typeBoard, { read: `(${A}.mod.silent = true, 1)`, as: 'silent' }, ...drawRect,
      { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 800 }, strip('down'),
      // an untrusted Esc from outside the leaf on the held board: told nothing (the trust check comes before the held line)
      { read: `(document.querySelector('.bd-host .bd-leaf [role="status"]').textContent = '', document.querySelector('#board-turn .bd-turn-key').focus(), document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), 1)`, as: 'synthEsc' }, { wait: 400 }, strip('synth-esc'),
      { read: `(document.querySelector('.bd-host .bd-leaf [role="status"]').textContent = '', document.querySelector('#board-turn .bd-turn-key').focus(), document.activeElement.className)`, as: 'focused' },
      { key: 'Enter', text: '\r' }, { wait: 500 }, facts('pressed'), strip('pressed-strip'),
    ]);
    expect(b.errors).toEqual([]);
    expect((b.down as Strip).keyTitle).toBe(TURN_COPY.keptTitle);
    expect((b['synth-esc'] as Strip).said).toBe('');
    expect(b.focused).toMatch(/bd-turn-key/);
    expect(fa(b, 'pressed')).toMatchObject({ open: true, toasts: [] });
    expect((b['pressed-strip'] as Strip).said).toBe(KEEP_COPY.notSavedOff);
  }, 180_000);

  it('#gui-board-turn (Probe D): reopened from the edge tab, then Esc in the composer folds it and focus stays in the composer (never back to the tab that opened it)', async () => {
    const a = await real([
      ...typeBoard, ...foldByEsc, facts('folded1'),
      { press: '#pane-transcript > .bd-edgetab' }, { wait: 2200 }, facts('reopened'),
      { press: '#composer-text' }, { key: 'Escape' }, { wait: 900 }, facts('folded2'),
    ]);
    expect(a.errors).toEqual([]);
    expect(fa(a, 'folded1').open).toBe(false);
    expect(fa(a, 'reopened').open).toBe(true);
    expect(fa(a, 'folded2')).toMatchObject({ open: false, active: 'composer-text' });
  }, 120_000);

  it('#gui-board-turn (Probe E): at 1024 a long reply that stopped at the turn limit with live choices drops the reply; the end words and needs you stay and the line fits', async () => {
    const long = `${'The totals drift because each line is rounded before the sum, and the discount is applied after rounding, so three-line orders lose a cent. '.repeat(3).slice(0, 400)}\n\nWhich rounding should totals use?\n\nA  Banker’s rounding\nB  Half up`;
    const FIT = `(() => { const row = document.querySelector('#board-turn .bd-turn-turn'); const line = row.querySelector('.bd-turn-line'); return { cls: row.className, text: line.innerText.replace(/\\s+/g, ' ').trim(), fits: line.scrollWidth <= line.clientWidth + 1 }; })()`;
    const a = await real([
      realClock, ...toIdle, ...typeBoard, ...sendTyped('why are totals off'), append('turn.sent', { turn: 'turn:p4b2/e' }), replyRow(long), append('turn.result', { subtype: 'error_max_turns', is_error: true, turn: 'turn:p4b2/e' }), { wait: 700 }, { read: FIT, as: 'fit' },
    ], { width: 1024, height: 768 });
    expect(a.errors).toEqual([]);
    const r = a.fit as { cls: string; text: string; fits: boolean };
    expect(r.cls).toMatch(/\btight-[123]\b/);
    expect(r.text.endsWith('stopped: turn limit · needs you'), r.text).toBe(true);
    expect(r.fits).toBe(true);
  }, 120_000);

  it('#gui-board-turn (Aegis L3): show chat keeps its focus when the strip repaints under it', async () => {
    const a = await real([
      realClock, ...toIdle, ...typeBoard, { read: `(document.querySelector('#board-turn .bd-turn-key').focus(), document.activeElement.className)`, as: 'before' },
      append('turn.sent', { turn: 'turn:p4b2/l3' }), { wait: 400 }, replyRow('A new reply repaints the row.'), append('turn.result', { subtype: 'success', turn: 'turn:p4b2/l3' }), { wait: 500 },
      { read: `({ active: document.activeElement.className, row: document.querySelector('#board-turn .bd-turn-turn').innerText })`, as: 'after' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.before).toMatch(/bd-turn-key/);
    expect((a.after as { row: string }).row).toMatch(/A new reply repaints the row/);
    expect((a.after as { active: string }).active).toMatch(/bd-turn-key/);
  }, 120_000);

  it('P4b-4 too short in the app (aegis C3_1, C3_2 ruled, C3_4): a text open on the board when the pinned zone grows; keys typed across the change reach neither the text, a card nor the composer and focus stays; show chat and ⌥B do not fold the held words; a pending change still settles', async () => {
    const SHORTEN = (on: boolean) => ({ read: `(() => { const p = document.getElementById('pinned'); const c = ${CUR}; if (${on}) p.style.paddingTop = Math.max(0, c.leaf.room() - 100) + 'px'; else p.style.paddingTop = ''; return 1; })()`, as: `short-${on}` });
    const SEE = `(() => { const c = ${CUR}; const f = document.querySelector('.bd-host .bd-board textarea'); const k = ${A}.kernel; return { state: c ? c.leaf.state() : null, field: f ? f.value : null, focusIsField: !!f && document.activeElement === f, composer: document.getElementById('composer-text').value, approve: k.__approve.n, frames: k.__n.n, line: document.querySelector('.bd-host .bd-keep').textContent, open: !!c, pending: c ? c.session.status().pending : null, sameAsMod: c ? c.session.hash() === ${A}.mod.hash(c.session.dim) : null, rows: k.rows.filter((r) => String(r.event.kind).endsWith('dimension.op')).length }; })()`;
    const see = (as: string) => ({ read: SEE, as });
    const a = await real([
      ...toIdle, ...typeBoard,
      // C3_4: a change in flight when the board goes too short still settles and is stored
      ...drawRect, SHORTEN(true), { until: `${CUR}.leaf.state() === 'too-short' && ${CUR}.session.status().pending === 0`, as: 'settled while too short', timeoutMs: 15_000 }, see('settled'), SHORTEN(false), { until: `${CUR}.leaf.state() !== 'too-short'`, as: 'room again' },
      { press: '.bd-host [data-key="tool:text"]' }, { at: [200, 330], press: true }, { until: `!!document.querySelector('.bd-host .bd-board textarea')`, as: 'a text open' }, ...type('hello'), see('typing'),
      SHORTEN(true), { until: `${CUR}.leaf.state() === 'too-short'`, as: 'too short' }, ...type('adyn`'), { key: ' ' }, { key: 'Enter', text: '\r' }, { key: 'Escape' }, see('typed'),
      // aegis F5: the check is painted again when the words become held (C1.4: never "the last change" with words held)
      { read: `${CUR}.leaf.el.dataset.check`, as: 'checkHeld' },
      { press: '#board-turn .bd-turn-key' }, { key: 'b', alt: true }, see('folds'),
    ]);
    expect(a.errors).toEqual([]);
    type See = { state: string; field: string | null; focusIsField: boolean; composer: string; approve: number; frames: number; line: string; open: boolean; pending: number; sameAsMod: boolean; rows: number };
    const S = (k: string): See => a[k] as See;
    expect(S('settled')).toMatchObject({ state: 'too-short', pending: 0, sameAsMod: true });
    expect(S('settled').rows).toBeGreaterThan(0);
    expect(S('typing')).toMatchObject({ field: 'hello', focusIsField: true });
    // C3_1: nothing typed in the change reached the text, a card or the composer, and focus did not move
    expect(S('typed')).toMatchObject({ state: 'too-short', field: 'hello', focusIsField: true, composer: S('typing').composer, approve: S('typing').approve, frames: S('typing').frames });
    expect(S('typed').line).toBe('No room to draw · your words are kept on this page');
    expect(a.checkHeld).toBe('checked up to an older change');
    // ruled C3_2: show chat and ⌥B refuse to fold while the words are held, and say so
    expect(S('folds')).toMatchObject({ open: true, field: 'hello', frames: S('typing').frames, line: 'No room to draw · your words are kept on this page' });
  }, 180_000);

  it('aegis C2.2 (design check.signs.unchecked): a session resumed after the link comes back keeps this page\'s check (DimSessions holds it across the rebuild), so the unchecked state does not persist there; the lead stands exactly while the check is null', async () => {
    const LEAD = `(() => { const c = ${CUR}; if (!c) return null; const s = c.session.status(); return { verified: s.verified, checkedSeq: s.checkedSeq, phase: s.phase, line: c.leaf.el.querySelector('.bd-keep').textContent, inFoot: c.leaf.checkShown(), place: c.leaf.el.dataset.checkPlace ?? null }; })()`;
    const narrow = { read: `(document.querySelector('.bd-host').style.width = '240px', 1)`, as: 'narrow' };
    const a = await real([
      ...typeBoard, ...drawRect, narrow, { wait: 300 }, { read: LEAD, as: 'before' },
      { read: `(${A}.down(), 1)`, as: 'down' }, { until: `${CUR} && ${CUR}.session.status().link === 'down'`, as: 'the link down' },
      { press: '#reconnect-btn' }, { until: `!!${CUR} && ${CUR}.session.status().link === 'up' && ${CUR}.leaf.state() !== 'loading'`, as: 'resumed', timeoutMs: 20_000 }, narrow, { until: `!/^Reconnected/.test(${CUR}.leaf.el.querySelector('.bd-keep').textContent)`, as: 'the said Reconnected line gone', timeoutMs: 15_000 }, { read: LEAD, as: 'resumed' },
      { read: `(${CUR}.leaf.setCheck('not checked yet', 'none', { open: true }), ${CUR}.leaf.el.querySelector('.bd-keep').textContent)`, as: 'forced' },
    ]);
    expect(a.errors).toEqual([]);
    type L = { verified: boolean | null; checkedSeq: number | null; phase: string; line: string; inFoot: boolean; place: string | null };
    expect((a.before as L).verified).toBe(true);
    expect((a.before as L).line).not.toMatch(/^not checked yet · /);
    const r = a.resumed as L;
    // FOUND (C2.2's risk, answered by the build): the rebuilt session reads the page's own map of answered hashes, so a
    // resumed board is checked at once and no unchecked state persists across a reconnect
    expect(r).toMatchObject({ verified: true, phase: 'open', inFoot: false });
    expect(r.checkedSeq).toBe((a.before as L).checkedSeq);
    expect(r.line).not.toMatch(/^not checked yet · /);
    // and the lead is tied to the check alone: the same resumed leaf told it has no check leads at once
    expect(a.forced as string).toMatch(/^not checked yet · /);
  }, 180_000);

  describe('aegis F1: words held by a too-short board are never thrown away silently by a leave that is not a fold', () => {
    const SHORT = `(() => { const p = document.getElementById('pinned'); const c = ${CUR}; p.style.paddingTop = Math.max(0, c.leaf.room() - 100) + 'px'; return 1; })()`;
    const SEEF1 = `(() => { const c = ${CUR}; const f = document.querySelector('.bd-host .bd-board textarea'); return { open: !!c, title: c ? c.leaf.el.querySelector('.title').textContent : null, field: f ? f.value : null, line: c ? c.leaf.el.querySelector('.bd-keep').textContent : null, toasts: [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent), hsid: c ? c.session.hsid : null }; })()`;
    const holdHello = [{ press: '.bd-host [data-key="tool:text"]' }, { at: [200, 330], press: true }, { until: `!!document.querySelector('.bd-host .bd-board textarea')`, as: 'a text open' }, ...type('hello'), { read: SHORT, as: 'short' }, { until: `${CUR}.leaf.state() === 'too-short' && ${CUR}.leaf.holdsWords()`, as: 'words held while too short' }];
    it('a session switch (which cannot be refused) says the words are gone, by their first characters', async () => {
      const other = `(() => { const r = [...document.querySelectorAll('#session-list .session-row[data-hsid]')].find((x) => !x.classList.contains('active')); if (!r) return null; r.id = 'f1-other'; return r.dataset.hsid; })()`;
      const a = await real([...toIdle, ...typeBoard, ...holdHello, { read: other, as: 'other' }, { press: '#f1-other' }, { until: `!${CUR}`, as: 'the leaf left (the switch says what it lost as it goes)', timeoutMs: 15_000 }, { read: SEEF1, as: 'after' }]);
      expect(a.errors).toEqual([]);
      expect(a.other).toBeTruthy();
      const toasts = (a.after as { toasts: string[] }).toasts;
      expect(toasts.some((t) => t.includes('The words you were typing weren’t saved · “hello”')), JSON.stringify(toasts)).toBe(true);
    }, 180_000);
    it('a pick of another board in the Dimensions list (/boards) is refused and says the held line; the words stay', async () => {
      const a = await real([
        ...toIdle, ...typeBoard, ...foldByEsc, { press: '#composer-text' }, ...type('/board plan B'), { key: 'Enter' }, { until: `${BOARD_UP} && ${CUR}.leaf.el.querySelector('.title').textContent === 'plan B'`, as: 'plan B open', timeoutMs: 30_000 },
        ...holdHello, { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { until: `document.querySelectorAll('#palette-list [data-dim]').length >= 2`, as: 'the list' },
        { read: `[...document.querySelectorAll('#palette-list [data-dim]')].map((r) => r.textContent)`, as: 'rows' }, { key: 'ArrowDown' }, { key: 'Enter' }, { wait: 300 }, { read: SEEF1, as: 'after' },
      ]);
      expect(a.errors).toEqual([]);
      expect((a.rows as string[])[1]).not.toMatch(/plan B/);
      expect(a.after).toMatchObject({ open: true, title: 'plan B', field: 'hello', line: 'No room to draw · your words are kept on this page' });
      expect((a.after as { toasts: string[] }).toasts.filter((t) => /weren.t saved/.test(t))).toEqual([]);
    }, 240_000);
  });

  it('aegis F2: the open Dimensions list keeps its order and its selection by dim: an agent row that would re-sort it does not change what Enter opens', async () => {
    // a row of the dimension mod on `dim`, as an agent's attach would be written (the principal and scope of the log's last dimension row)
    const agentRow = (dimExpr: string) => ({ read: `(() => { const k = ${A}.kernel; const last = k.rows.filter((r) => String(r.event.kind).startsWith('modns.gnomon.dimension.')).pop(); const dim = ${dimExpr}; const id = '01JF2AGENT' + String(k.rows.length).padStart(16, '0'); return k.append('modns.gnomon.dimension.op', { v: 1, dim, ops: [{ type: 'add', node: { id, kind: 'rect', x: 40, y: 40, z: 'V' + k.rows.length, w: 30, h: 20 } }], relayedFor: last.event.payload.relayedFor }, undefined, { principal: last.event.principal, scope: last.event.scope }); })()`, as: `agent-${dimExpr.length}-${Math.random()}` });
    const ROWS = `[...document.querySelectorAll('#palette-list [data-dim]')].map((r) => ({ dim: r.dataset.dim, title: r.querySelector('.pal-title').textContent, sel: r.classList.contains('sel') }))`;
    const b = await real([
      ...toIdle, ...typeBoard, ...foldByEsc,
      { press: '#composer-text' }, ...type('/board plan B'), { key: 'Enter' }, { until: `${BOARD_UP} && ${CUR}.leaf.el.querySelector('.title').textContent === 'plan B'`, as: 'plan B open', timeoutMs: 30_000 }, { read: `${CUR}.session.dim`, as: 'dimB' }, ...foldByEsc,
      { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { until: `document.querySelectorAll('#palette-list [data-dim]').length >= 2`, as: 'list 1' }, { key: 'ArrowDown' }, { key: 'Enter' }, { until: `${BOARD_UP} && ${CUR}.leaf.el.querySelector('.title').textContent !== 'plan B'`, as: 'A open', timeoutMs: 30_000 }, { read: `${CUR}.session.dim`, as: 'dimA' },
      agentRow(`${JSON.stringify('')} || [...${A}.board.dock.rows()].find((r) => r.title === 'plan B').dim`),
      { press: '#composer-text' }, ...type('/boards'), { key: 'Enter' }, { until: `document.querySelectorAll('#palette-list [data-dim]').length >= 2`, as: 'list 2' }, { read: ROWS, as: 'before' },
      // the person is on plan B's row (the first); an agent then writes on the open board A: it would re-sort A first
      agentRow(`${CUR}.session.dim`), { until: `(${A}.board.dock.rows()[0] || {}).dim === ${CUR}.session.dim && ${CUR}.session.view().nodes.size > 0`, as: 'rows() re-sorted by the agent row, and the open board drew it' }, { read: ROWS, as: 'after' },
      { key: 'Enter' }, { until: `document.getElementById('palette').hidden && !!${CUR} && ${CUR}.leaf.state() !== 'loading'`, as: 'what Enter opened is up', timeoutMs: 20_000 }, { read: `${CUR}.leaf.el.querySelector('.title').textContent`, as: 'opened' },
    ]);
    expect(b.errors).toEqual([]);
    type Row = { dim: string; title: string; sel: boolean };
    expect((b.before as Row[])[0]).toMatchObject({ title: 'plan B', sel: true });
    expect((b.after as Row[]).map((r) => r.dim)).toEqual((b.before as Row[]).map((r) => r.dim));
    expect((b.after as Row[]).find((r) => r.sel)!.title).toBe('plan B');
    expect(b.opened).toBe('plan B');
  }, 300_000);

  it('#gui-board-turn (Aegis L2): a double press on show chat folds once and the first press’s focus move holds (the chat at its latest row)', async () => {
    const a = await real([
      // (the fold is waited for by condition, then the focus move it ends with: a fixed 900ms failed once under a loaded full run)
      ...typeBoard, { press: '#board-turn .bd-turn-key', settle: 0 }, { press: '#board-turn .bd-turn-key' }, { until: `!${CUR}`, as: 'the board folded', timeoutMs: 15_000 }, { until: `document.getElementById('board-turn').hidden`, as: 'the strip gone', timeoutMs: 15_000 }, facts('shown'),
    ]);
    expect(a.errors).toEqual([]);
    expect(fa(a, 'shown')).toMatchObject({ open: false, active: 'viewport' });
  }, 120_000);

  it('T-2026-11-26-001 (under CPU throttling, as on CI): the second press of a fast double press on show chat lands where the strip was, after the fold, and focus stays in the chat', async () => {
    // the cause, traced: at 6x the second press arrives after the fold, on the page's header (no focus there), and its
    // mousedown blurred the chat to BODY. A person's fast double press does the same: fixed in the product (app.ts showChatAt)
    const a = await real([
      ...typeBoard, { press: '#board-turn .bd-turn-key', settle: 0 }, { press: '#board-turn .bd-turn-key' }, { until: `!${CUR}`, as: 'the board folded', timeoutMs: 30_000 }, { until: `document.getElementById('board-turn').hidden`, as: 'the strip gone', timeoutMs: 30_000 }, facts('shown'),
    ], { cpuThrottle: 6 });
    expect(a.errors).toEqual([]);
    expect(fa(a, 'shown')).toMatchObject({ open: false, active: 'viewport' });
  }, 240_000);

  it('#gui-board-turn (Mika 3): a size change inside the leaf alone (the pane and the feed keep theirs) re-reads the room: under 300px the strip goes to one row', async () => {
    const ROWS = `(() => { const c = ${CUR}; return { rows: document.querySelectorAll('#board-turn .bd-turn-r').length, room: c.leaf.room() + document.getElementById('board-turn').offsetHeight }; })()`;
    const a = await real([
      ...toIdle, ...typeBoard, { read: ROWS, as: 'open' },
      { read: `(document.querySelector('.bd-host .bd-head').style.paddingBottom = (${CUR}.leaf.room() - 200) + 'px', 1)`, as: 'grown' }, { wait: 600 }, { read: ROWS, as: 'shrunk' },
    ], { width: 1440, height: 900 });
    expect(a.errors).toEqual([]);
    expect(a.open).toMatchObject({ rows: 2 });
    expect((a.shrunk as { room: number }).room).toBeLessThan(300);
    expect(a.shrunk).toMatchObject({ rows: 1 });
  }, 120_000);

  it('#gui-board-turn: a real press on the strip’s working key folds the board, leaves its steps unfolded in the chat and puts focus on that key there; a synthetic one does nothing', async () => {
    const a = await real([
      realClock, ...toIdle, ...typeBoard, ...sendTyped('run the totals tests'), append('turn.sent', { turn: 'turn:p4b2/2' }), toolRow('npm test -- --filter totals'), { wait: 600 }, strip('running'),
      { read: `(document.querySelector('#board-turn [data-strip-work]').click(), 1)`, as: 'synth' }, { wait: 500 }, facts('synthetic'),
      { press: '#board-turn [data-strip-work]' }, { wait: 900 }, facts('pressed'), strip('chat'),
    ]);
    expect(a.errors).toEqual([]);
    expect((a.running as Strip).work).toMatchObject({ expanded: false, caret: false });
    expect((a.running as Strip).work!.label).toBe('Bash · npm test -- --filter totals · show its steps in the chat');
    expect(fa(a, 'synthetic')).toMatchObject({ open: true, toasts: [] });
    expect(fa(a, 'pressed').open).toBe(false);
    expect((a.chat as Strip).chatWork).toEqual({ expanded: 'true', focused: true, steps: true });
  }, 120_000);

  it('#gui-board-turn: the strip’s words never reach the board by a drag; the person’s own paste of them adds exactly one text node through the checked path', async () => {
    const words = { read: `document.querySelector('#board-turn .bd-turn-you .said').textContent`, as: 'words' };
    const a = await real([
      ...toIdle, ...typeBoard, words, facts('before'),
      { drop: { items: [{ mimeType: 'text/plain', data: 'Tighten the tells copy on the landing card.' }] }, at: [200, 200] }, { wait: 500 }, facts('dropped'),
      { press: '.bd-host [data-key="tool:select"]' }, { at: [200, 330], press: true }, { paste: 'Tighten the tells copy on the landing card.', as: 'clip' }, { wait: 900 }, facts('pasted'),
    ]);
    expect(a.errors).toEqual([]);
    expect(a.words).toBe('Tighten the tells copy on the landing card.');
    const before = fa(a, 'before');
    expect(fa(a, 'dropped')).toMatchObject({ nodes: before.nodes, frames: before.frames, rows: before.rows });
    expect(fa(a, 'pasted')).toMatchObject({ nodes: (before.nodes ?? 0) + 1, texts: ['Tighten the tells copy on the landing card.'], sameAsMod: true, pending: 0 });
    expect(fa(a, 'pasted').rows.slice(before.rows.length)).toEqual(['op:add']);
  }, 120_000);

  it.each(['desk', 'loops'])('edge-tab clearance (%s): with the board tab (and the Loops tab) folded at the chat’s edge, no message meets a tab; the rows step back out when no tab shows', async (fixture) => {
    const MEET = `(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, r: b.right, y: b.y, b: b.bottom }; }; const tabs = [...document.querySelectorAll('#pane-transcript > .lp-edgetab')].filter((t) => !t.hidden).map(r); const rows = [...document.querySelectorAll('#viewport > .trow')]; const bodies = [...document.querySelectorAll('#viewport > .trow .body')].map(r);
      return { tabs: tabs.length, bodies: bodies.length, over: bodies.filter((b) => tabs.some((t) => b.r > t.x - 0.5 && b.x < t.r && b.b > t.y && b.y < t.b)).length, gap: Math.min(...bodies.map((b) => Math.min(...tabs.map((t) => t.x - b.r)))), rowRight: rows.length ? Math.round(document.getElementById('viewport').getBoundingClientRect().right - rows[0].getBoundingClientRect().right) : null }; })()`;
    const a = await real([{ read: MEET, as: 'before' }, ...typeBoard, ...foldByEsc, { wait: 300 }, { read: MEET, as: 'folded' }], { fixture, width: 1024, height: 768 });
    expect(a.errors).toEqual([]);
    const m = a.folded as { tabs: number; bodies: number; over: number; gap: number; rowRight: number };
    expect(m.tabs).toBe(fixture === 'loops' ? 2 : 1);
    expect(m.bodies).toBeGreaterThan(0);
    expect(m.over).toBe(0);
    expect(m.gap).toBeGreaterThanOrEqual(8);
    expect(m.rowRight).toBe(14);
    // no tab yet on the desk (no board, no loops): the rows keep the whole width
    if (fixture === 'desk') expect(a.before).toMatchObject({ tabs: 0, rowRight: 0 });
  }, 120_000);

  it.each(['desk', 'loops'])('with a board open nothing under the leaf takes focus (%s): the chat header keys, the conversation and the Loops tab are inert; the leaf, then the turn strip, come before the pinned cards and the composer', async (fixture) => {
    const STATE = `(() => { const p = document.getElementById('pane-transcript'); const host = p.querySelector('.bd-host'); return { head: p.querySelector(':scope > .pane-head').inert, viewport: document.getElementById('viewport').inert, before: !!(host.compareDocumentPosition(document.getElementById('composer')) & Node.DOCUMENT_POSITION_FOLLOWING), pinnedAfter: !!(host.compareDocumentPosition(document.getElementById('pinned')) & Node.DOCUMENT_POSITION_FOLLOWING) }; })()`;
    const WHERE = `(() => { const e = document.activeElement; return e ? (e.closest('.bd-host') ? 'leaf' : e.closest('#board-turn') ? 'turn' : e.closest('#pane-transcript > .pane-head') ? 'UNDER:head' : e.closest('#viewport') ? 'UNDER:viewport' : e.matches('.lp-edgetab:not(.bd-edgetab)') ? 'UNDER:loops-tab' : e.closest('#pinned') ? 'pinned' : e.closest('#composer') ? 'composer' : e.closest('#pane-transcript') ? 'pane:' + (e.id || e.className) : 'elsewhere') : 'none'; })()`;
    const LOOPS = `(() => { const t = document.querySelector('#pane-transcript > .lp-edgetab:not(.bd-edgetab)'); return { shown: !!t && !t.hidden, inert: !!t && t.inert }; })()`;
    // the backward walk starts on the first stop after the leaf (a pinned card's key): from the composer's field it
    // could not start, as Shift+Tab there cycles the run mode (§11.5) and never moves focus
    const FROM_PINNED = `(() => { const e = document.querySelector('#pinned .card button:not([disabled]), #pinned .card [tabindex="0"]'); if (!e) return null; e.focus(); return document.activeElement === e ? (e.dataset.decision || e.id || e.className) : null; })()`;
    const walk = Array.from({ length: 14 }, (_, i) => [{ key: 'Tab', shift: true, settle: 60 }, { read: WHERE, as: `t${i}` }]).flat();
    const forward = Array.from({ length: 16 }, (_, i) => [{ key: 'Tab', settle: 60 }, { read: WHERE, as: `f${i}` }]).flat();
    const a = await real([{ read: STATE, as: 'closed' }, { read: LOOPS, as: 'loopsClosed' }, ...typeBoard, { read: STATE, as: 'open' }, { read: LOOPS, as: 'loopsOpen' }, { press: '.bd-host .bd-head .spacer' }, ...forward, { read: FROM_PINNED, as: 'from' }, ...walk, ...foldByEsc, facts('folded'), { read: STATE, as: 'after' }, { read: LOOPS, as: 'loopsAfter' }], { fixture });
    expect(a.errors).toEqual([]);
    expect(a.closed).toMatchObject({ head: false, viewport: false, before: true, pinnedAfter: true });
    expect(a.open).toMatchObject({ head: true, viewport: true });
    const stops = Array.from({ length: 14 }, (_, i) => a[`t${i}`] as string);
    // the Loops edge tab (the loops fixture shows it) is out of the focus order while a board is open, and back after
    if (fixture === 'loops') expect([a.loopsClosed, a.loopsOpen, a.loopsAfter]).toEqual([{ shown: true, inert: false }, { shown: true, inert: true }, { shown: true, inert: false }]);
    // Shift+Tab back from the pinned card: the turn strip, then into the leaf, never onto something under it
    expect(a.from, 'a pinned card key to start the backward walk from').not.toBeNull();
    expect(stops[0], `the backward walk: ${stops.join(' ')}`).toBe('turn');
    expect(stops.slice(stops.indexOf('turn')).find((x) => x !== 'turn')).toBe('leaf');
    expect(stops.filter((s) => s.startsWith('UNDER'))).toEqual([]);
    expect(stops, `the backward walk: ${stops.join(' ')}`).toContain('leaf');
    // Tab forward from the leaf's head: the leaf's own stops, then the pinned cards or the composer, never under it
    const fwd = Array.from({ length: 16 }, (_, i) => a[`f${i}`] as string);
    expect(fwd.filter((s) => s.startsWith('UNDER'))).toEqual([]);
    expect(fwd[0]).toBe('leaf');
    const left = fwd.find((s) => s !== 'leaf');
    expect(left, `after the leaf comes the turn strip: ${fwd.join(' ')}`).toBe('turn');
    const then = fwd.slice(fwd.indexOf('turn')).find((s) => s !== 'turn');
    expect(['pinned', 'composer'], `after the strip comes ${String(then)}: ${fwd.join(' ')}`).toContain(then);
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

  it('the head\'s Dimensions ▾ key (design board-leaf anatomy) opens the same list as /boards on a real press; a synthetic press opens nothing; Esc closes the list and leaves the board open with focus back on the key; a row of the open board puts the keys on it', async () => {
    const KEY = `(() => { const k = [...document.querySelectorAll('.bd-host .bd-head .key')].find((x) => /^Dimensions/.test(x.textContent)); return k ? { text: k.textContent, title: k.title, disabled: k.getAttribute('aria-disabled'), popup: k.getAttribute('aria-haspopup'), focused: document.activeElement === k } : null; })()`;
    const LIST = `({ open: !document.getElementById('palette').hidden, head: document.querySelector('#palette-list .menu-h')?.textContent ?? null, placeholder: document.getElementById('palette-input').placeholder, rows: [...document.querySelectorAll('#palette-list [data-dim]')].map((r) => r.textContent) })`;
    const a = await real([
      ...typeBoard, { read: KEY, as: 'key' },
      // a real press
      { press: '.bd-host .bd-head .key[aria-haspopup="dialog"]' }, { wait: 400 }, { read: LIST, as: 'list' }, facts('listOpen'),
      { key: 'Escape' }, { wait: 400 }, { read: LIST, as: 'closed' }, facts('afterEsc'), { read: KEY, as: 'keyAfter' },
      // again, and Enter on its row: the board this session has open takes the keys (nothing is sent)
      { press: '.bd-host .bd-head .key[aria-haspopup="dialog"]' }, { wait: 400 }, { key: 'Enter' }, { wait: 700 }, { read: LIST, as: 'chosen' }, facts('afterRow'),
    ]);
    // untrusted, in a run of its own (so this is the assertion that fails when the trusted rule goes, not the driver):
    // a synthetic click and a synthetic Enter on the key open nothing
    const s = await real([
      ...typeBoard,
      { read: `(() => { const k = [...document.querySelectorAll('.bd-host .bd-head .key')].find((x) => /^Dimensions/.test(x.textContent)); k.click(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()`, as: 'synth' }, { wait: 400 }, { read: LIST, as: 'afterSynth' }, facts('synthFacts'),
    ]);
    expect(s.synth).toBe(1);
    expect(s.afterSynth, 'a synthetic press on Dimensions ▾ opened the list').toMatchObject({ open: false });
    expect(s.synthFacts).toMatchObject({ open: true, frames: 1 });
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    // the specimen's key: its words, its title, a key that presses
    expect(a.key).toMatchObject({ text: 'Dimensions ▾', title: 'Dimensions in this project (/boards)', disabled: null, popup: 'dialog' });
    expect(a.list).toMatchObject({ open: true, head: 'Dimensions', placeholder: 'find a dimension' });
    expect((a.list as { rows: string[] }).rows).toHaveLength(1);
    expect((a.list as { rows: string[] }).rows[0]).toMatch(/^Totals are off by a cent/);
    // the list is over the board, not in its place: the board stays open and nothing was sent for it
    expect(f('listOpen')).toMatchObject({ open: true, frames: 1, rows: ['session.start:command'] });
    expect(a.closed).toMatchObject({ open: false });
    expect(f('afterEsc')).toMatchObject({ open: true, frames: 1, rows: ['session.start:command'] });
    expect(a.keyAfter).toMatchObject({ focused: true });
    expect(a.chosen).toMatchObject({ open: false });
    expect(f('afterRow')).toMatchObject({ open: true, frames: 1, rows: ['session.start:command'] });
    expect(f('afterRow').active).toMatch(/excalidraw/);
  }, 120_000);

  it('a HELD Enter on the head\'s Dimensions ▾ key opens the list and chooses nothing: the repeats neither pick row 0 nor leave the open board; a synthetic click on the palette\'s "Dimensions: list" row opens nothing', async () => {
    const LIST = `({ open: !document.getElementById('palette').hidden, dims: document.getElementById('palette-input').placeholder === 'find a dimension', rows: document.querySelectorAll('#palette-list [data-dim]').length })`;
    const a = await real([
      ...typeBoard, facts('before'),
      { read: `(() => { const k = document.querySelector('.bd-host .bd-head .key[aria-haspopup="dialog"]'); k.focus(); return document.activeElement === k; })()`, as: 'onKey' },
      // Enter pressed and HELD: the first key-down presses the key, three repeats follow before the release
      { key: 'Enter', text: '\r', held: 3, settle: 400 }, { read: LIST, as: 'held' }, facts('afterHeld'),
      { key: 'Escape' }, { wait: 300 },
      // the palette's own row, by a synthetic click
      { key: 'k', meta: true }, { wait: 200 }, ...type('Dimensions: list'), { wait: 200 },
      { read: `(() => { const row = document.querySelector('#palette-list .pal-row.sel') || document.querySelector('#palette-list .pal-row'); const t = row ? row.textContent : null; if (row) row.click(); return t; })()`, as: 'synthRow' }, { wait: 400 }, { read: LIST, as: 'afterSynth' },
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(a.onKey).toBe(true);
    // the list is open, still the Dimensions list with its row, and nothing was chosen by the repeats
    expect(a.held, 'a held Enter chose a row (the list closed)').toMatchObject({ open: true, dims: true, rows: 1 });
    expect(f('afterHeld')).toMatchObject({ open: true, frames: f('before').frames, rows: f('before').rows });
    expect(String(a.synthRow)).toMatch(/^Dimensions/);
    expect(a.afterSynth, 'a synthetic click on the palette row opened the Dimensions list').toMatchObject({ dims: false });
  }, 120_000);

  const toDecide = [{ key: 'k', meta: true }, { wait: 200 }, ...type('Layout: Decide'), { wait: 200 }, { key: 'Enter' }, { wait: 500 }];
  it('design check.place and signs (aegis C1.7, C2.1, C2.2, C2.5): the hands alone decide whether the check is in the foot, at 303, 424 and 680px, whatever it says; unchecked and not in the foot, the line under the head leads with "not checked yet"; the mismatch fact is --fail at 500; the palette row carries the check', async () => {
    const WORDS = ['checked up to the last change', 'checked up to 999+ changes ago', 'nothing to check yet', 'not checked yet', 'doesn’t match the saved board'];
    const PLACE = `(async () => { const c = ${CUR}; const l = c.leaf.el; const fr = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const out = {};
      for (const w of ${JSON.stringify(WORDS)}) { c.leaf.setCheck(w, w === 'not checked yet' ? 'none' : w.startsWith('doesn') ? 'bad' : 'ok', { title: 'log row 79; this board’s latest is row 81', open: true }); await fr();
        const k = l.querySelector('.bd-foot .bd-check'); out[w] = { shown: c.leaf.checkShown(), drawn: !!k, whole: !k || k.scrollWidth <= k.clientWidth + 1, title: k ? k.title : null, lead: l.querySelector('.bd-keep').textContent.startsWith('not checked yet · ') }; }
      return { width: Math.round(l.getBoundingClientRect().width), out }; })()`;
    const at680 = { read: `(document.querySelector('.bd-host').style.width = '680px', 1)`, as: 'w680' };
    const rows = { read: `${A}.board.dock.rows().filter((r) => r.check).map((r) => r.check)`, as: 'rows' };
    const narrow = await real([...toDecide, ...typeBoard, { await: PLACE, as: 'place' }, rows], { fixture: 'always-scopes', width: 1024, height: 768 });
    const desk = await real([...typeBoard, { await: PLACE, as: 'place' }, at680, { wait: 300 }, { await: PLACE, as: 'wide' }, { read: `(document.querySelector('.bd-host').style.width = '240px', 1)`, as: 'w240' }, { wait: 300 }, { await: PLACE, as: 'tight' }], { width: 1024, height: 768 });
    expect(narrow.errors).toEqual([]);
    expect(desk.errors).toEqual([]);
    type P = { width: number; out: Record<string, { shown: boolean; drawn: boolean; whole: boolean; title: string | null; lead: boolean }> };
    // (240px is under the supported 300: the foot there has no room for the check, which proves the other side of the rule)
    for (const [name, p] of [['303', narrow.place], ['424', desk.place], ['680', desk.wide], ['240', desk.tight]] as const) {
      const q = p as P;
      const shown = new Set(Object.values(q.out).map((v) => v.shown));
      expect(shown.size, `${name} (${q.width}px): the check's presence changed with its words`).toBe(1);
      for (const [w, v] of Object.entries(q.out)) {
        expect(v.drawn, `${name} ${w}`).toBe(v.shown);
        expect(v.whole, `${name} ${w}: cut`).toBe(true);
        if (v.drawn) expect(v.title, `${name} ${w}`).toBe('log row 79; this board’s latest is row 81');
        // C2.2: the lead only for the unchecked board whose check is not in the foot
        expect(v.lead, `${name} ${w}: the lead`).toBe(w === 'not checked yet' && !v.shown);
      }
    }
    expect((narrow.place as P).width).toBeLessThanOrEqual(304);
    expect(Object.values((desk.place as P).out)[0]!.shown).toBe(true);
    expect(Object.values((desk.tight as P).out)[0]!.shown).toBe(false);
    expect((desk.tight as P).out['not checked yet']!.lead).toBe(true);
    // C2.5: the second home ships with the rule: the open board's row in the palette's list holds the check
    expect(narrow.rows).toHaveLength(1);
    expect((narrow.rows as string[])[0]).toMatch(/^(nothing to check yet|checked up to |not checked yet)/);
  }, 180_000);

  it('Mika R2: a line that states something in the keep line\'s place (marks missing, part of the board, words waiting) draws in ink; opening, folding and saving stay quiet', async () => {
    const LINE = `(() => { const k = document.querySelector('.bd-host .bd-keep'); return { text: k.textContent, ink: k.classList.contains('bd-said-line'), colour: getComputedStyle(k).color }; })()`;
    const set = (line: string | null, as: string) => [{ read: `(${CUR}.leaf.setKeep(${JSON.stringify(line)}), 1)`, as: `set-${as}` }, { wait: line === KEEP_COPY.saving ? 800 : 150 }, { read: LINE, as }];
    const a = await real([...typeBoard, { read: LINE, as: 'usual' }, ...set(KEEP_COPY.dropped, 'dropped'), ...set(KEEP_COPY.partial, 'partial'), ...set(KEEP_COPY.wordsWait, 'wordsWait'), ...set(KEEP_COPY.saving, 'saving'), ...set(KEEP_COPY.opening, 'opening'), ...set(KEEP_COPY.folding, 'folding'), ...set(null, 'back')]);
    expect(a.errors).toEqual([]);
    type L = { text: string; ink: boolean; colour: string };
    const l = (k: string): L => a[k] as L;
    expect(l('usual')).toMatchObject({ ink: false });
    for (const [k, words] of [['dropped', KEEP_COPY.dropped], ['partial', KEEP_COPY.partial], ['wordsWait', KEEP_COPY.wordsWait]] as const) {
      expect(l(k), `${k} is said in ink`).toMatchObject({ text: words, ink: true });
      expect(l(k).colour, k).not.toBe(l('usual').colour);
    }
    for (const [k, words] of [['saving', KEEP_COPY.saving], ['opening', KEEP_COPY.opening], ['folding', KEEP_COPY.folding]] as const) expect(l(k), `${k} stays quiet`).toMatchObject({ text: words, ink: false, colour: l('usual').colour });
    expect(l('back')).toMatchObject({ ink: false, text: l('usual').text });
  }, 120_000);

  it('Probe: a board that is out of date (a driven hash mismatch) is held still: a real drag and real keys add nothing and send nothing, and Esc still folds it', async () => {
    // the preview mod's own hook: its next dim.open answers a hash that is not its fold's, once (src/preview/dim-mod.ts)
    const lie = `(${A}.mod.wrongHashNext = true, 1)`;
    const a = await real([
      { read: lie, as: 'lie' }, ...typeBoard, facts('opened'),
      { read: `(() => { const f = document.querySelector('.bd-host .bd-keep .bd-fail-fact'); const probe = document.createElement('span'); probe.style.color = 'var(--fail)'; document.body.append(probe); const fail = getComputedStyle(probe).color; probe.remove(); return f ? { text: f.textContent, colour: getComputedStyle(f).color, fail, weight: getComputedStyle(f).fontWeight, rest: getComputedStyle(f.parentElement).color } : null; })()`, as: 'fact' },
      { read: `(() => { const k = ${A}.kernel; k.__before = k.__n.n; return 1; })()`, as: 'm' },
      { press: '.bd-host [data-key="tool:rect"]' }, { drag: [[250, 200], [290, 225], [330, 250]] }, { wait: 400 }, ...type('nt'), { at: [200, 330], press: true }, ...type('zz'), { key: 'Delete' }, { wait: 400 }, facts('poked'),
      { key: 'Escape' }, { wait: 900 }, facts('folded'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('opened')).toMatchObject({ open: true, inert: 'out-of-date', line: 'This board is out of date · fold it and open it again' });
    expect(f('opened').check).toBe('doesn’t match the saved board');
    // design check.signs.mismatch: the FACT in --fail at 500, the rest in ink
    const fact = a.fact as { text: string; colour: string; fail: string; weight: string; rest: string };
    expect(fact).toMatchObject({ text: 'This board is out of date', weight: '500' });
    expect(fact.colour).toBe(fact.fail);
    expect(fact.rest).not.toBe(fact.fail);
    // the foot says it in the failed colour, whole; what to do about it is the line under the head
    expect(f('opened').chk).toMatchObject({ text: f('opened').check, bad: true, whole: true });
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
      // (the press that wakes the board is one whole gesture: for 500ms after it nothing more reaches the engine. The
      // page now paints at full speed in the harness, so the next press must wait that out, as a person's does)
      { at: [200, 330], press: true }, { wait: 650 }, { press: '.bd-host [data-key="tool:text"]' }, { at: [420, 120], press: true }, { wait: 300 }, ...type('ab'),
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
      return { leaf: r('.bd-host .bd-leaf'), turn: r('#board-turn'), turnRows: document.querySelectorAll('#board-turn .bd-turn-r').length, roomWithout: (() => { const c = globalThis.gnomonPreviewApp.board.dock.current(); return c ? c.leaf.room() + document.getElementById('board-turn').offsetHeight : null; })(), pane: r('#pane-transcript'), stack: r('#stack'), status: r('#status-line'), pinned: r('#pinned'), composer: r('#composer'), cards: document.querySelectorAll('#pinned .card').length, head: r('.bd-host .bd-head'), toast: r('#toasts'), line: (() => { const k = document.querySelector('.bd-host .bd-keep'); return k ? k.scrollWidth <= k.clientWidth + 1 : null; })() }; })()`;
    const first = pinned === 'two' ? [] : [{ read: `(() => { const rows = [...document.querySelectorAll('#session-list [data-hsid]')]; const idle = rows.find((x) => /idle/.test(x.textContent)); return idle ? idle.dataset.hsid : null; })()`, as: 'idle' }];
    // 0 pinned: an idle session of the fixture is focused; 2 pinned: one of the fixture's three is decided by a real press
    const zero = pinned === 'two' ? [{ press: '#pinned .card [data-decision="deny"]' }, { wait: 900 }] : [{ read: `(() => { const rows = [...document.querySelectorAll('#session-list [data-hsid]')]; const idle = rows.find((x) => /idle/.test(x.textContent)); if (idle) idle.click(); return !!idle; })()`, as: 'switched' }, { wait: 400 }];
    const a = await real([...first, ...zero, ...typeBoard, { read: RECTS, as: 'rects' }, facts('f'), { read: `(() => { const c = ${CUR}; return c ? c.leaf.state() : null; })()`, as: 'state' }], { fixture, theme, width, height, shot: `app-board-${width}-${theme}-${pinned === 'two' ? 'pinned2' : 'pinned0'}` });
    expect(a.errors).toEqual([]);
    // P4b-3: wherever the leaf draws its foot, the check stands whole in it beside the hands (the 424px leaf included)
    if (a.state !== 'too-short') {
      // design check.place: in the foot WHOLE when it fits after the hands, else not at all (never cut)
      const chk = fa(a, 'f').chk;
      if (chk) expect(chk, `the check at ${width}×${height}`).toMatchObject({ bad: false, whole: true });
      expect(fa(a, 'f').check).toMatch(/^(nothing to check yet|checked up to )/);
    }
    type R = { x: number; y: number; r: number; b: number } | null;
    const r = a.rects as { leaf: R; turn: R; turnRows: number; roomWithout: number | null; pane: R; stack: R; status: R; pinned: R; composer: R; cards: number; line: boolean | null };
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
    // #gui-board-turn: the strip shows under the leaf, inside the centre column, clear of the pinned zone and the composer
    const turn = r.turn!;
    expect(turn.b - turn.y).toBeGreaterThan(20);
    expect(r.turnRows).toBeGreaterThanOrEqual(1);
    // Mika 3: the row count follows the room the board has NOW (measured without the strip), not the room at open
    expect(r.turnRows, `room without the strip ${r.roomWithout}`).toBe((r.roomWithout ?? 0) >= 300 ? 2 : 1);
    expect(turn.y).toBeGreaterThanOrEqual(leaf.b - 0.5);
    expect(turn.x).toBeGreaterThanOrEqual(pane.x - 0.5);
    expect(turn.r).toBeLessThanOrEqual(pane.r + 0.5);
    const meetsTurn = (o: R): boolean => !!o && o.r > o.x && o.b > o.y && turn.x < o.r - 0.5 && o.x < turn.r - 0.5 && turn.y < o.b - 0.5 && o.y < turn.b - 0.5;
    for (const [name, zone] of [['pinned zone', r.pinned], ['composer', r.composer], ['stack', r.stack]] as const) expect(meetsTurn(zone), `the strip meets the ${name}`).toBe(false);
  }, 120_000);

  // G-DDL-08 in full (boards S1.3 P4b-3): "the board leaf covers the centre column only and no board key is handled
  // while a card is focused, under every layout preset". Each preset is chosen from the palette by real keys; the
  // fixture holds three pinned cards, so the board is at its shortest. The last two rows are the windows of
  // T-2026-11-25-004 (about 190px of board), where the rail's last key used to lie over the foot.
  it.each([
    ...['desk', 'focus', 'decide'].flatMap((preset) => [{ preset, width: 1024, height: 768 }, { preset, width: 1280, height: 800 }, { preset, width: 640, height: 400 }]),
    // one row under a 4× CPU slowdown: the wait for the board is a condition, so a slow machine changes nothing
    { preset: 'decide', width: 1280, height: 800, slow: 4 },
    { preset: 'desk', width: 1280, height: 640, deny: 2 },
    { preset: 'desk', width: 1024, height: 520, idle: true },
  ] as Array<{ preset: string; width: number; height: number; deny?: number; idle?: boolean; slow?: number }>)('G-DDL-08 under the $preset preset at $width×$height (deny $deny, idle $idle, slow $slow): the leaf and the strip meet no other zone, the rail stays clear of the foot, and with a card focused no key reaches the board', async ({ preset, width, height, deny = 0, idle = false, slow = 0 }) => {
    const title = { desk: 'Layout: Desk', focus: 'Layout: Focus', decide: 'Layout: Decide' }[preset]!;
    const RECTS = `(() => { const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; };
      const rail = document.querySelector('.bd-host .bd-rail'); const foot = document.querySelector('.bd-host .bd-foot'); const keys = rail ? [...rail.querySelectorAll('button')].map((k) => k.getBoundingClientRect()).filter((k) => k.height > 0) : [];
      const c = ${CUR}; const leafEl = document.querySelector('.bd-host .bd-leaf');
      return { leaf: r('.bd-host .bd-leaf'), turn: r('#board-turn'), pane: r('#pane-transcript'), stack: r('#stack'), status: r('#status-line'), pinned: r('#pinned'), composer: r('#composer'), sessions: r('#pane-sessions'), workshop: r('#workshop'), header: r('#app-header, header'),
        visible: document.visibilityState, focus: document.hasFocus(),
        layout: JSON.parse(localStorage.getItem('gnomon.gui.layout') || '{}').name ?? null, state: c ? c.leaf.state() : null, room: c ? c.leaf.room() : null,
        rail: rail && keys.length ? { over: rail.scrollHeight - rail.clientHeight, keys: keys.length, gap: Math.round(foot.getBoundingClientRect().top - Math.max(...keys.map((k) => k.bottom))) } : null,
        outside: leafEl ? [...leafEl.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); const l = leafEl.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.bd-board') && (b.bottom > l.bottom + 1 || b.right > l.right + 1 || b.top < l.top - 1 || b.left < l.left - 1)
          // …and is really PAINTED there (the leaf clips what runs past it: a too-short leaf cuts its one line, it does not draw over the strip)
          && [[Math.min(b.right - 1, innerWidth - 1), Math.min(b.bottom - 1, innerHeight - 1)], [Math.max(b.left + 1, 0), Math.min(b.bottom - 1, innerHeight - 1)], [Math.min(b.right - 1, innerWidth - 1), Math.max(b.top + 1, 0)]].some(([x, y]) => (x > l.right || y > l.bottom || x < l.left || y < l.top) && e.contains(document.elementFromPoint(x, y))); }).map((e) => e.className).slice(0, 5) : null,
        leafH: leafEl ? Math.round(leafEl.getBoundingClientRect().height) : null, keepCut: (() => { const k = leafEl && leafEl.querySelector('.bd-keep'); return k ? Math.round(k.getBoundingClientRect().bottom - leafEl.getBoundingClientRect().bottom) : null; })() }; })()`;
    // a card that can take focus under this preset (Focus hides the stack: the pinned cards are the ones left)
    const focusCard = { read: `(() => { for (const c of document.querySelectorAll('#pinned .card [data-decision], #stack .card [data-decision], #pinned .card button, #stack .card button')) { c.focus(); if (document.activeElement === c) return true; } return false; })()`, as: 'focused' };
    const KEYS: Array<Record<string, unknown>> = [{ key: 'a' }, { key: 'd' }, { key: 'n' }, { key: 'r' }, { key: 't' }, { key: 'v' }, { key: '1' }, { key: 'Delete' }, { key: 'Backspace' }, { key: 'z', meta: true }, { key: 'a', meta: true }, { key: 'v', meta: true, commands: ['paste'] }, { key: 'b', alt: true }, { key: 'Escape' }];
    const steps = KEYS.flatMap((k, i) => [{ ...focusCard, as: `card${i}` }, { ...k, settle: 100 }, facts(`k${i}`)]);
    const a = await real(
      [
        { key: 'k', meta: true }, { wait: 200 }, ...type(title), { wait: 200 }, { read: `(document.querySelector('#palette-list .pal-row.sel') || {}).textContent ?? null`, as: 'row' }, { key: 'Enter' }, { wait: 500 },
        // the reported windows: pinned cards are decided by real presses until the board has the room the report names
        ...Array.from({ length: deny }, () => [{ press: '#pinned .card [data-decision="deny"]' }, { wait: 900 }]).flat(),
        // (or a session with no pinned card at all: the stack's cards are then the ones a key could reach)
        ...(idle ? toIdle : []),
        ...typeBoard, { read: RECTS, as: 'rects' },
        facts('before'), ...steps,
      ],
      { fixture: idle ? 'desk' : 'always-scopes', width, height, cpuThrottle: slow, shot: `app-ddl08-${preset}-${width}x${height}` },
    );
    expect(a.errors).toEqual([]);
    expect(String(a.row)).toContain(title);
    type R = { x: number; y: number; r: number; b: number } | null;
    const r = a.rects as { leaf: R; turn: R; pane: R; stack: R; status: R; pinned: R; composer: R; sessions: R; workshop: R; layout: string | null; state: string | null; room: number | null; rail: { over: number; keys: number; gap: number } | null; outside: string[] | null; visible: string };
    if (process.env.GNOMON_MEASURE) appendFileSync(process.env.GNOMON_MEASURE, `G-DDL-08 ${preset} ${width}x${height}${deny ? ` deny${deny}` : ''}${idle ? ' idle' : ''}${slow ? ` slow${slow}` : ''}: leafH=${(r as unknown as { leafH: number }).leafH} keepCut=${(r as unknown as { keepCut: number }).keepCut} state=${r.state} room=${r.room} strip=${r.turn ? Math.round(r.turn.b - r.turn.y) : null} rail=${JSON.stringify(r.rail)} pane=${Math.round(r.pane!.r - r.pane!.x)}\n`);
    expect(r.layout).toBe(preset);
    // the page PAINTS while it is measured (Probe: it went hidden when the palette closed, and every rect below was of a frozen page)
    expect(r.visible).toBe('visible');
    expect(r.leaf, 'the board opened').not.toBeNull();
    // the turn strip is drawn (it was 0×0 on the hidden page, so "the strip meets nothing" proved nothing)
    expect(r.turn, 'the turn strip').not.toBeNull();
    expect(r.turn!.b - r.turn!.y, 'the turn strip has height').toBeGreaterThanOrEqual(28);
    expect(r.turn!.y, 'the strip starts where the leaf ends').toBeGreaterThanOrEqual(r.leaf!.b - 0.5);
    const leaf = r.leaf!;
    const pane = r.pane!;
    // inside the centre column
    expect(leaf.x).toBeGreaterThanOrEqual(pane.x - 0.5);
    expect(leaf.r).toBeLessThanOrEqual(pane.r + 0.5);
    expect(leaf.y).toBeGreaterThanOrEqual(pane.y - 0.5);
    expect(leaf.b).toBeLessThanOrEqual(pane.b + 0.5);
    const meets = (o: R, w: NonNullable<R>): boolean => !!o && o.r > o.x && o.b > o.y && w.x < o.r - 0.5 && o.x < w.r - 0.5 && w.y < o.b - 0.5 && o.y < w.b - 0.5;
    // the stack, the status strip, the pinned cards and the composer (and the sessions rail and the Workshop where the preset shows them)
    for (const [name, zone] of [['stack', r.stack], ['status strip', r.status], ['pinned zone', r.pinned], ['composer', r.composer], ['sessions rail', r.sessions], ['Workshop', r.workshop]] as const) {
      expect(meets(zone, leaf), `the leaf meets the ${name}`).toBe(false);
      expect(meets(zone, r.turn!), `the turn strip meets the ${name}`).toBe(false);
    }
    // the zones the preset keeps are really on the page (so "meets none" is not a hidden zone passing)
    expect(r.composer && r.composer.b > r.composer.y, 'the composer shows').toBe(true);
    if (!idle) expect(!!r.pinned && r.pinned.b > r.pinned.y, 'the pinned zone shows').toBe(true);
    // (under 900px the stack is a drawer in every preset; over it, Focus is the chat alone and takes the whole desk)
    if (width > 900) {
      expect(!!r.stack && r.stack.r > r.stack.x && r.stack.b > r.stack.y, 'the stack').toBe(preset !== 'focus');
      expect(!!r.sessions && r.sessions.r > r.sessions.x && r.sessions.b > r.sessions.y, 'the sessions rail').toBe(preset !== 'focus');
      expect(pane.r - pane.x, 'the centre column').toBeGreaterThanOrEqual(preset === 'focus' ? width - 1 : 300);
    }
    // nothing of the leaf is drawn outside it, and the rail (when the board is tall enough to have one) is clear of the foot
    expect(r.outside).toEqual([]);
    // the two reported windows have a short board that CAN be drawn on, under the height the always-visible rail needs
    if (deny > 0 || idle) expect(r.room, `the board's room (${r.state})`).toSatisfy((n: number) => n >= 148 && n < 230);
    if (r.state === 'too-short') expect(r.rail).toBeNull();
    else {
      expect(r.rail, `a rail at ${r.room}px of board`).not.toBeNull();
      expect(r.rail!.over, `the rail is taller than its room (${r.room}px of board)`).toBeLessThanOrEqual(0);
      expect(r.rail!.gap, `the last rail key is ${r.rail!.gap}px from the foot (${r.room}px of board)`).toBeGreaterThanOrEqual(4);
    }
    // with a card focused: no op, no frame, no row, no fold, no tool change, whatever the key
    const f = (k: string): Facts => a[k] as Facts;
    const before = f('before');
    expect(before).toMatchObject({ open: true, rows: ['session.start:command'], frames: 1 });
    KEYS.forEach((k, i) => {
      const name = `${k.meta ? 'Cmd+' : ''}${k.alt ? 'Alt+' : ''}${String(k.key)}`;
      expect(a[`card${i}`], `a card had focus for ${name}`).toBe(true);
      expect(f(`k${i}`), name).toMatchObject({ open: true, frames: before.frames, rows: before.rows, nodes: before.nodes, marks: before.marks, tool: before.tool, pending: 0, card: true });
    });
  }, 180_000);
});
