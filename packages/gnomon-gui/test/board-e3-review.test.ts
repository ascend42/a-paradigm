/**
 * S1.4 E3 review fixes (Mika B1 to C5, Aegis N-5) in the REAL app, on real paint: the notice's words cut only by
 * the ladder or the two-line step, focus after undo, the +k menu's place and roles, its closing, pending and held keys.
 * Skipped on CI and without a Chrome, like test/board-e3-app.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { fixtureUrl, startPreview } from '../scripts/preview.mjs';

const A = 'globalThis.gnomonPreviewApp';
const CUR = `${A}.board.dock.current()`;
/** the agent's session: the focused, attached session (a real agent draws on a board its session is attached to) */
const AG_JS = `${CUR}.session.hsid`;
const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), 1)", as: 'listening' };
/** every mod.command the page sends from here on, by command id */
const COUNT = { read: `(() => { const k = ${A}.kernel; if (!k.__g) { k.__g = []; const send = k.send.bind(k); k.send = (s) => { if (String(s).includes('"mod.command"')) { try { const m = JSON.parse(s); k.__g.push(m.params.commandId); } catch {} } return send(s); }; } return 1; })()`, as: 'counting' };
/** everything the leaf speaks from here on (the polite status line) */
const SPOKEN = { read: `(() => { globalThis.__said = []; const last = new WeakMap(); new MutationObserver(() => { for (const e of document.querySelectorAll('.sr-only[role="status"]')) { const t = e.textContent; if (t && last.get(e) !== t) { last.set(e, t); globalThis.__said.push(t); } } }).observe(document.body, { subtree: true, childList: true, characterData: true }); return 1; })()`, as: 'spoken' };
const DESELECT = [{ press: '.bd-host [data-key="tool:select"]' }, { press: '.bd-host .bd-stage', at: [120, 12] }, { wait: 300 }];
const type = (s: string): unknown[] => [...s].map((k) => ({ key: k, settle: 25 }));
const BOARD_UP = `(() => { const c = ${CUR}; if (!c) return false; const hd = c.leaf.handle(); return c.leaf.state() !== 'loading' && !!hd && hd.isAlive() && c.session.status().phase !== 'opening'; })()`;
const openBoard = [{ press: '#composer-text' }, ...type('/board'), { key: 'Enter' }, { until: BOARD_UP, as: 'board up', timeoutMs: 30_000 }, { wait: 300 }];
/** a rect of the person's, then nothing selected (a still click with Select on empty board): the slot shows notices, not a mark row */
const rectAt = (x: number, y: number) => [{ press: '.bd-host [data-key="tool:rect"]' }, { drag: [[x, y], [x + 40, y + 25], [x + 80, y + 50]] }, { wait: 500 }, ...DESELECT];
/**
 * An agent turn `n` as the kernel writes it: its op row (the bridge's stamp), folded by the stand-in mod too, then its
 * `turn.result`. `ops` is a function body over `mine` (the person's node ids, oldest first) and `acts` (their acts).
 */
const turn = (n: number, ops: string, o: { mod?: boolean; extra?: string; modAgent?: string } = {}) => ({
  read: `(() => { const k = ${A}.kernel; const s = ${CUR}.session; const dim = s.dim; const AG = ${AG_JS};
    const mine = [...s.view().nodes.entries()].filter(([, v]) => v.by.cls === 'human').sort((a, b) => a[1].addedSeq - b[1].addedSeq).map(([id]) => id);
    const acts = k.rows.filter((r) => r.event.kind === 'modns.gnomon.dimension.op' && r.event.payload.act).map((r) => r.event.payload.act);
    const scope = k.rows.find((r) => String(r.event.kind).startsWith('modns.gnomon.dimension.')).event.scope;
    const payload = Object.assign({ v: 1, dim, ops: (() => { ${ops} })(), relayedFor: { principal: 'p:7k2m9q4x/claude', surface: 'bridge', agent: 'claude', hsid: AG, turn: 'turn:' + AG + '/${n}' } }, ${o.extra ?? '{}'});
    const seq = k.append('modns.gnomon.dimension.op', payload, undefined, { scope });
    ${o.mod === false ? '' : `${A}.mod.landedElsewhere({ seq, kind: 'modns.gnomon.dimension.op', payload: Object.assign({}, payload${o.modAgent ? `, { relayedFor: Object.assign({}, payload.relayedFor, { agent: '${o.modAgent}', principal: 'p:7k2m9q4x/${o.modAgent}' }) }` : ''}) });`}
    k.append('turn.result', { turn: 'turn:' + AG + '/${n}' }, AG);
    return seq; })()`,
  as: `turn-${n}`,
});
const recolour = (i: number, colour = 'cobalt') => `return [{ type: 'update', id: mine[${i}], patch: { color: '${colour}' } }];`;
const STRIP = `(() => { const c = ${CUR}; const v = c ? c.session.noticeView() : null; const row = document.querySelector('#board-turn .bd-turn-notice, #board-turn .bd-turn-mark'); const line = row ? row.querySelector('.bd-turn-line') : null; const leaf = document.querySelector('.bd-host .bd-leaf');
  return { shown: v && v.shown ? v.shown.key : null, state: v && v.shown ? v.shown.state : null, behind: v ? v.behind.map((n) => n.key) : [], mark: v && v.mark ? v.mark : null, sent: ${A}.kernel.__g ? ${A}.kernel.__g.slice() : [], keys: [...document.querySelectorAll('#board-turn [data-undo-key]')].map((k) => k.textContent),
    row: row ? { kind: row.className, words: line.textContent, title: row.title, over: line.scrollWidth > line.clientWidth + 0.5, twoLine: row.classList.contains('two-line'), h: row.getBoundingClientRect().height } : null,
    keep: leaf ? leaf.querySelector('.bd-keep').textContent : null, leafW: leaf ? Math.round(leaf.getBoundingClientRect().width) : null,
    active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null, nodes: c ? c.session.view().nodes.size : null, said: globalThis.__said || [] }; })()`;
const strip = (as: string) => ({ read: STRIP, as });
type Strip = { shown: string | null; state: string | null; behind: string[]; mark: { id: string; removed: boolean } | null; sent: string[]; keys: string[]; row: { kind: string; words: string; title: string; over: boolean; twoLine: boolean; h: number } | null; keep: string | null; leafW: number | null; active: string | null; nodes: number | null; said: string[] };
/** the notices' keys are `turn:<hsid>/<n>`: compared by their turn number */
const T = (k: number): RegExp => new RegExp(`^turn:.*/${k}$`);
const count = (s: Strip, id: string): number => s.sent.filter((x) => x === id).length;
/** a key in the strip, after its 500 ms arming (U1) */
const ARM = { wait: 700 };
const KEY = (word: string, scope = '#board-turn .bd-turn-notice') => `${scope} [data-undo-key^="${word}|"]`;


const type2 = type;
const toDecide = [{ key: 'k', meta: true }, { wait: 200 }, ...type2('Layout: Decide'), { wait: 200 }, { key: 'Enter' }, { wait: 500 }];
/** the long form: 'Claude undid your change and removed 1 of your marks' (the undid lead from the person's act, N3) */
const LONG = (n = 1) => turn(n, `return [{ type: 'delete', id: mine[1] }, { type: 'update', id: mine[0], patch: { color: 'leaf' } }];`, { extra: `{ undo: { of: { principal: 'p:7k2m9q4x/matt', act: acts[acts.length - 1] } } }` });
/** every drawn part of the notice's words: is any cut inside (an ellipsis), and the words as painted */
const PARTS = { read: `(() => { const row = document.querySelector('#board-turn .bd-turn-notice'); const line = row.querySelector('.bd-turn-line');
  const parts = [...line.querySelectorAll(':scope > span')].filter((e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length);
  const leaf = document.querySelector('.bd-host .bd-leaf');
  return { leafW: Math.round(leaf.getBoundingClientRect().width), stripW: Math.round(document.querySelector('#board-turn').getBoundingClientRect().width), cut: parts.filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => e.textContent), painted: parts.map((e) => e.textContent).join(''), over: line.scrollWidth > line.clientWidth + 0.5, cls: row.className }; })()`, as: 'parts' };
type Parts = { leafW: number; stripW: number; cut: string[]; painted: string; over: boolean; cls: string };
const BOX = (q: string) => `(() => { const e = document.querySelector(${JSON.stringify(q)}); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; })()`;
const MENU_FOOT = { read: `({ menu: ${BOX('#board-turn .bd-undo-menu')}, foot: ${BOX('.bd-host .bd-foot')}, stage: ${BOX('.bd-host .bd-stage')}, more: ${BOX('#board-turn [data-undo-key^="more|"]')}, after: (() => { const m = document.querySelector('#board-turn .bd-undo-menu'); return m && m.previousElementSibling ? m.previousElementSibling.dataset.undoKey || null : null; })(), role: (() => { const m = document.querySelector('#board-turn .bd-undo-menu'); return m ? [m.getAttribute('role'), ...[...m.querySelectorAll('[role]')].map((e) => e.getAttribute('role'))] : null; })() })`, as: 'mf' };
type Box = { l: number; t: number; r: number; b: number } | null;
const meets = (a: Box, b: Box): boolean => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const FOCUS = (q: string) => ({ read: `(document.querySelector(${JSON.stringify(q)}).focus(), document.activeElement.dataset.undoKey || null)`, as: 'focused' });
const ACTIVE = (as: string) => ({ read: `({ key: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.undoKey || null : null, tag: document.activeElement ? document.activeElement.tagName : null, menu: !!document.querySelector('#board-turn .bd-undo-menu'), frozen: ${CUR}.session.noticeView ? null : null })`, as });

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('S1.4 E3 review fixes in the real app (Mika B1 to C5)', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => void (p = await startPreview({ port: 0 })), 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { theme?: string; width?: number; height?: number } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: `${fixtureUrl(p.url, 'desk', o.theme ?? 'day', 'off')}&dim=1`, width: o.width ?? 1440, height: o.height ?? 900, timeoutMs: 90_000, actions: [ERRORS, COUNT, SPOKEN, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
    return r.acted;
  };
  const S = (a: Record<string, unknown>, k: string): Strip => a[k] as Strip;

  for (const width of [1280, 1024])
    it(`B1 (real paint): at a ${width} window the notice's words are never cut inside a part; the ladder or the two-line step runs instead`, async () => {
      const a = await real([...openBoard, ...rectAt(160, 160), ...rectAt(320, 160), LONG(), { wait: 600 }, PARTS], { width, height: 820 });
      expect(a.errors).toEqual([]);
      const s = a.parts as Parts;
      expect(s.cut).toEqual([]);
      expect(s.over).toBe(false);
      expect(s.painted).toMatch(/^Claude undid your change/);
      expect(s.painted).toMatch(/1/);
      // at these leaves the whole form does not fit beside the keys: a step ran
      expect(s.cls).toMatch(/tight-|two-line/);
    }, 120_000);

  it('B2: Enter on undo leaves focus on redo (the same row, the same column), and the held Enter does not redo', async () => {
    const a = await real([...openBoard, ...rectAt(220, 180), turn(1, recolour(0)), ARM, FOCUS(KEY('undo')), { key: 'Enter', text: '\r', held: 20 }, { wait: 800 }, ACTIVE('after'), strip('s')]);
    expect(a.errors).toEqual([]);
    expect(count(S(a, 's'), 'dim.undo')).toBe(1);
    expect(S(a, 's').state).toBe('done');
    expect((a.after as { key: string | null }).key ?? 'no key focused').toMatch(/^redo\|/);
  }, 120_000);

  for (const o of [{ width: 1280, decide: false }, { width: 1024, decide: true }])
    it(`B3, C2: the +k menu never meets the hands foot (${o.width}${o.decide ? ', Decide: a 303 leaf' : ''}); it follows the +k key in the DOM, its right edge on it, with no menu roles`, async () => {
      // (the marks are drawn at the desk's leaf; Decide's 303px leaf is too narrow for the rail's tools)
      const a = await real([...openBoard, ...rectAt(30, 120), ...rectAt(110, 120), ...rectAt(190, 120), turn(1, recolour(0)), turn(2, recolour(1)), turn(3, recolour(2)), ...(o.decide ? [{ press: '#composer-text' }, ...toDecide, { wait: 600 }] : []), ARM, { press: KEY('more') }, ARM, MENU_FOOT, { read: `Math.round(document.querySelector('.bd-host .bd-leaf').getBoundingClientRect().width)`, as: 'leafW' }], { width: o.width, height: 900 });
      expect(a.errors).toEqual([]);
      const m = a.mf as { menu: Box; foot: Box; stage: Box; more: Box; after: string | null; role: Array<string | null> };
      expect(m.menu).not.toBeNull();
      expect(meets(m.menu, m.foot)).toBe(false);
      // inside the leaf: never under the sessions column
      expect(m.menu!.l).toBeGreaterThanOrEqual(m.stage!.l - 1);
      // (Mika r3: at the 303 leaf the rows do not fit left of the key: the right edge goes out to the stage's)
      if (o.decide) expect(m.menu!.r).toBeLessThanOrEqual(m.stage!.r);
      else expect(Math.abs(m.menu!.r - m.more!.r)).toBeLessThanOrEqual(1);
      expect(m.after).toMatch(/^more\|/);
      expect(m.role).toEqual([null]);
      if (o.decide) expect(a.leafW).toBeLessThan(340);
    }, 120_000);

  it('C1: the menu closes when focus leaves the strip, and on a press outside; the freeze then ends', async () => {
    const a = await real([...openBoard, ...rectAt(30, 120), ...rectAt(110, 120), turn(1, recolour(0)), turn(2, recolour(1)), ARM, FOCUS(KEY('more')), { key: 'Enter', text: '\r' }, ARM, ACTIVE('open'), { read: `(document.querySelector('#composer-text').focus(), 1)`, as: 'away' }, { wait: 200 }, ACTIVE('blurred'),
      FOCUS(KEY('more')), { key: 'Enter', text: '\r' }, ARM, ACTIVE('open2'), { move: '#composer-text' }, { press: '.bd-host .bd-stage', at: [400, 300] }, { wait: 300 }, ACTIVE('pressed'), { read: `${CUR}.session.noticeView().shown !== null`, as: 'shown' }]);
    expect(a.errors).toEqual([]);
    expect((a.open as { menu: boolean }).menu).toBe(true);
    expect((a.blurred as { menu: boolean }).menu).toBe(false);
    expect((a.open2 as { menu: boolean }).menu).toBe(true);
    expect((a.pressed as { menu: boolean }).menu).toBe(false);
  }, 120_000);

  it('C2: a notice brought from the menu takes the slot and focus goes to the slot\'s undo key', async () => {
    const a = await real([...openBoard, ...rectAt(30, 120), ...rectAt(110, 120), turn(1, recolour(0)), turn(2, recolour(1)), ARM, { press: KEY('more') }, ARM, { press: '#board-turn .bd-undo-menu .bd-menu-words' }, { wait: 600 }, ACTIVE('after'), strip('s')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 's').shown).toMatch(T(1));
    expect((a.after as { key: string }).key).toMatch(/^undo\|turn:.*\/1\|/);
  }, 120_000);

  it('C4: the pressed key is aria-busy at once, and after 300 ms shows the 9px working mark before its words', async () => {
    const SWALLOW = { read: `(() => { const k = ${A}.kernel; const send = k.send.bind(k); k.send = (s) => (String(s).includes('"dim.undo"') ? undefined : send(s)); return 1; })()`, as: 'swallow' };
    const K = `document.querySelector('#board-turn .bd-turn-notice .bd-undo-col [data-undo-key]')`;
    const READ = (as: string) => ({ read: `({ busy: ${K}.getAttribute('aria-busy'), spin: (() => { const s = ${K}.querySelector('.spin'); if (!s) return null; const b = s.getBoundingClientRect(); return { w: Math.round(b.width), first: ${K}.firstChild === s }; })(), words: ${K}.textContent })`, as });
    const a = await real([...openBoard, ...rectAt(220, 180), turn(1, recolour(0)), ARM, SWALLOW, { press: KEY('undo') }, { wait: 40, settle: 0 }, READ('early'), { wait: 700 }, READ('slow')]);
    expect(a.errors).toEqual([]);
    expect(a.early).toMatchObject({ busy: 'true', spin: null });
    expect(a.slow).toMatchObject({ busy: 'true', spin: { w: 9, first: true }, words: 'undo' });
  }, 120_000);

  it('C5, N-5: a held key names the real hold in its title and description, and moves from one hold\'s words to the next', async () => {
    const D = `document.querySelector('#board-turn [data-undo-key^="dismiss|"]')`;
    const READ = (as: string) => ({ read: `({ title: ${D}.title, desc: ${D}.getAttribute('aria-description'), label: ${D}.getAttribute('aria-label') })`, as });
    const a = await real([...openBoard, ...rectAt(220, 180), turn(1, recolour(0)), ARM, READ('before'), { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 800 }, READ('down'), { press: '#reconnect-btn' }, { wait: 4000 }, { read: `({ held: ${CUR}.session.noticeView().held, rc: !document.getElementById('reconnect').hidden })`, as: 'held' }, READ('catching')]);
    expect(a.errors).toEqual([]);
    const before = a.before as { title: string; label: string | null };
    expect(a.down).toMatchObject({ title: 'Not connected · this can’t be undone until the board is back', desc: 'Not connected · this can’t be undone until the board is back', label: before.label });
    expect(a.catching).toMatchObject({ title: 'Catching up with the board · this can be pressed in a moment', desc: 'Catching up with the board · this can be pressed in a moment', label: before.label });
    expect(before.title).toBe('Keep these changes · after this, undo them mark by mark while the board still can');
    // (the way back to the key's own title needs a check point after a press: stated, not driven here)
  }, 120_000);

  // ── round 3 (Mika r3 items 1 and 2) ──
  const LONG_NAME = 'billing-totals-review-agent';
  /** the long form by an agent whose label is long */
  const LONGN = (n = 1) => { const t = LONG(n) as { read: string; as: string }; return { ...t, read: t.read.split("agent: 'claude'").join(`agent: '${LONG_NAME}'`).split('p:7k2m9q4x/claude').join(`p:7k2m9q4x/${LONG_NAME}`) }; };
  /** the visible text that begins each wrapped line of the notice (Mika r4 F1) */
  const STARTS = { read: `[...document.querySelectorAll('#board-turn .bd-turn-notice .bd-turn-line .ln-start')].map((e) => [...e.childNodes].filter((c) => !(c.nodeType === 1 && getComputedStyle(c).display === 'none')).map((c) => c.textContent).join(''))`, as: 'starts' };
  const SHOTS_R3 = '../../.e3fix-logs/shots/r4';
  const realShot = async (actions: unknown[], o: { width: number; height: number; shot: string; theme?: string }): Promise<Record<string, unknown>> => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const r = (await shootLeaf({ chrome, url: `${fixtureUrl(p.url, 'desk', o.theme ?? 'day', 'off')}&dim=1`, width: o.width, height: o.height, timeoutMs: 90_000, actions: [ERRORS, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
    mkdirSync(SHOTS_R3, { recursive: true });
    writeFileSync(`${SHOTS_R3}/${o.shot}.png`, r.png);
    return r.acted;
  };
  for (const o of [{ leaf: 423, decide: false }, { leaf: 303, decide: true }])
    for (const theme of ['day', 'night'])
      it(`r3 D3 (real paint): at the ${o.leaf} leaf a long agent name is cut, never the counts or the undid lead (${theme})`, async () => {
        const a = await realShot([...openBoard, ...rectAt(160, 160), ...rectAt(320, 160), LONGN(), ...(o.decide ? [{ press: '#composer-text' }, ...toDecide] : []), { wait: 700 }, PARTS, STARTS], { width: 1024, height: 900, theme, shot: `long-name-${theme}-leaf${o.leaf}` });
        expect(a.errors).toEqual([]);
        const s = a.parts as Parts;
        expect(Math.abs(s.leafW - o.leaf)).toBeLessThanOrEqual(2);
        expect(s.cut).toEqual([]);
        expect(s.over).toBe(false);
        expect(s.painted).toMatch(/undid your change and changed 1 · removed 1/);
        expect(s.painted).not.toContain(LONG_NAME);
        expect(s.painted).toMatch(/^billing-tota…/);
        expect(s.cls).toMatch(/two-line/);
        // Mika r4 F1: a wrapped line never starts with a space
        const starts = a.starts as string[];
        if (s.cls.includes('wrap')) expect(starts.length).toBeGreaterThan(0);
        for (const t of starts) expect(t.startsWith(' '), JSON.stringify(starts)).toBe(false);
      }, 120_000);

  const MENU_ROWS = { read: `(() => { const b = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }; const m = document.querySelector('#board-turn .bd-undo-menu');
    return { menu: b(m), stage: b(document.querySelector('.bd-host .bd-stage')), foot: b(document.querySelector('.bd-host .bd-foot')), leafW: Math.round(document.querySelector('.bd-host .bd-leaf').getBoundingClientRect().width),
      rows: [...m.querySelectorAll('.bd-menu-row')].map((row) => { const w = row.querySelector('.bd-menu-words'); const parts = [...w.querySelectorAll(':scope > span')].filter((e) => getComputedStyle(e).display !== 'none'); return { key: b(row.querySelector('[data-undo-key^="undo|"]')), words: parts.map((e) => e.textContent).join(''), clipped: w.scrollWidth > w.clientWidth + 0.5 }; }) }; })()`, as: 'rows' };
  type MenuRows = { menu: NonNullable<Box>; stage: NonNullable<Box>; foot: NonNullable<Box>; leafW: number; rows: Array<{ key: NonNullable<Box>; words: string; clipped: boolean }> };
  const inside = (a: NonNullable<Box>, b: NonNullable<Box>): boolean => a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;
  for (const o of [{ leaf: 303, width: 1024, decide: true }, { leaf: 423, width: 1024, decide: false }, { leaf: 560, width: 1161, decide: false }])
    for (const theme of ['day', 'night'])
      it(`r3 item 2: the +k menu at the ${o.leaf} leaf: rows keep their time, their undo keys inside the menu, the menu inside the stage and clear of the foot (${theme})`, async () => {
        const a = await realShot([...openBoard, ...rectAt(30, 120), ...rectAt(110, 120), ...rectAt(190, 120), turn(1, recolour(0)), turn(2, recolour(1)), turn(3, recolour(2)), ...(o.decide ? [{ press: '#composer-text' }, ...toDecide, { wait: 600 }] : []), ARM, { press: KEY('more') }, ARM, MENU_ROWS], { width: o.width, height: 900, theme, shot: `menu-${theme}-leaf${o.leaf}` });
        expect(a.errors).toEqual([]);
        const m = a.rows as MenuRows;
        expect(Math.abs(m.leafW - o.leaf)).toBeLessThanOrEqual(2);
        expect(inside(m.menu, m.stage)).toBe(true);
        expect(meets(m.menu, m.foot)).toBe(false);
        expect(m.rows).toHaveLength(2);
        for (const r of m.rows) {
          expect(inside(r.key, m.menu)).toBe(true);
          expect(r.words).toMatch(/^Claude changed 1.* · \d\d:\d\d$/);
          expect(r.clipped).toBe(false);
        }
      }, 120_000);

  const LONG_RECOLOUR = (n: number, i: number) => { const t = turn(n, recolour(i)) as { read: string; as: string }; return { ...t, read: t.read.split("agent: 'claude'").join(`agent: '${LONG_NAME}'`).split('p:7k2m9q4x/claude').join(`p:7k2m9q4x/${LONG_NAME}`) }; };
  for (const theme of ['day', 'night'])
    it(`r4 F2: at the 303 leaf with a long agent name, every +k menu row's time is wholly visible (${theme})`, async () => {
      const TIMES = { read: `(() => { const b = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }; const m = document.querySelector('#board-turn .bd-undo-menu');
        return { menu: b(m), rows: [...m.querySelectorAll('.bd-menu-row')].map((row) => { const w = row.querySelector('.bd-menu-words'); const t = w.querySelector('.t'); return { words: b(w), t: t && getComputedStyle(t).display !== 'none' ? b(t) : null, key: b(row.querySelector('[data-undo-key^="undo|"]')), cls: row.className }; }) }; })()`, as: 'times' };
      const a = await realShot([...openBoard, ...rectAt(30, 120), ...rectAt(110, 120), ...rectAt(190, 120), LONG_RECOLOUR(1, 0), LONG_RECOLOUR(2, 1), LONG_RECOLOUR(3, 2), { press: '#composer-text' }, ...toDecide, { wait: 600 }, ARM, { press: KEY('more') }, ARM, TIMES], { width: 1024, height: 900, theme, shot: `menu-${theme}-leaf303-long` });
      expect(a.errors).toEqual([]);
      const m = a.times as { menu: NonNullable<Box>; rows: Array<{ words: NonNullable<Box>; t: Box; key: NonNullable<Box>; cls: string }> };
      expect(m.rows).toHaveLength(2);
      for (const r of m.rows) {
        expect(r.t, r.cls).not.toBeNull();
        expect(inside(r.t!, r.words)).toBe(true);
        expect(inside(r.key, m.menu)).toBe(true);
      }
    }, 120_000);
});
