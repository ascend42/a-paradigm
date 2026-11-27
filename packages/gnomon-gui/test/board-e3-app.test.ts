/**
 * S1.4 E3 in the REAL app on a real engine (the dev preview's full app, `&dim=1`, with the turn strip): the notices'
 * keys driven with real pointer input over the DevTools protocol, agent turns written as the kernel would write them
 * (an op row with the bridge's stamp, then the turn's `turn.result`), the stand-in mod folding the same rows.
 * Aegis's list-10 tests at the strip, Mika R4/R5/R7. Skipped on CI and without a Chrome, like test/board-app.test.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
const DESELECT = [{ press: '.bd-host [data-key="tool:select"]' }, { press: '.bd-host .bd-stage', at: [640, 30] }, { wait: 300 }];
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

const SHOTS = path.resolve('../../.e3-logs/shots');
const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('S1.4 E3 in the real app: the notices\' keys in the turn strip', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => void (p = await startPreview({ port: 0 })), 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { theme?: string; width?: number; height?: number; shot?: string } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: `${fixtureUrl(p.url, 'desk', o.theme ?? 'day', 'off')}&dim=1`, width: o.width ?? 1440, height: o.height ?? 900, timeoutMs: 90_000, actions: [ERRORS, COUNT, SPOKEN, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
    if (o.shot) {
      mkdirSync(SHOTS, { recursive: true });
      writeFileSync(path.join(SHOTS, `${o.shot}.png`), r.png);
    }
    return r.acted;
  };
  const S = (a: Record<string, unknown>, k: string): Strip => a[k] as Strip;

  it('U1: a double click on undo sends ONE dim.undo and no redo; the row stays in its redo window', async () => {
    const a = await real([...openBoard, ...rectAt(220, 180), turn(1, recolour(0)), ARM, strip('before'), { dbl: KEY('undo') }, { wait: 1500 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'before').shown).toMatch(T(1));
    expect(count(S(a, 'after'), 'dim.undo')).toBe(1);
    expect(S(a, 'after').shown).toMatch(T(1));
    expect(S(a, 'after').state).toBe('done');
    expect(S(a, 'after').keys).toContain('redo');
  }, 120_000);

  it('U1/S2: a double click on dismiss with two notices standing sends ONE dim.seen; the second still stands', async () => {
    const a = await real([...openBoard, ...rectAt(160, 160), ...rectAt(320, 160), turn(1, recolour(0)), turn(2, recolour(1)), ARM, { dbl: KEY('dismiss') }, { wait: 1500 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(count(S(a, 'after'), 'dim.seen')).toBe(1);
    expect(S(a, 'after').shown).toMatch(T(1));
  }, 120_000);

  it('U2: a notice arriving while the pointer is on the strip does not take the slot; dismiss releases the one shown', async () => {
    const a = await real([...openBoard, ...rectAt(160, 160), ...rectAt(320, 160), turn(1, recolour(0)), ARM, { move: '#board-turn .bd-turn-notice .bd-turn-line' }, turn(2, recolour(1)), { wait: 400 }, strip('held'), { press: KEY('dismiss') }, { wait: 1200 }, { move: '#composer-text' }, { wait: 400 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'held').shown).toMatch(T(1));
    expect(S(a, 'held').behind.map(String)).toEqual([expect.stringMatching(T(2))]);
    expect(S(a, 'after').shown).toMatch(T(2));
    expect(count(S(a, 'after'), 'dim.seen')).toBe(1);
  }, 120_000);

  it('V1: with 3 notices standing, undoing the oldest from the +k menu releases nothing else', async () => {
    const a = await real([...openBoard, ...rectAt(120, 160), ...rectAt(240, 160), ...rectAt(360, 160), turn(1, recolour(0)), turn(2, recolour(1)), turn(3, recolour(2)), ARM, { press: KEY('more') }, ARM, strip('open'), { press: '#board-turn .bd-undo-menu .bd-menu-row:last-child [data-undo-key^="undo|"]' }, { wait: 1500 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'open').behind).toEqual([expect.stringMatching(T(2)), expect.stringMatching(T(1))]);
    expect(count(S(a, 'after'), 'dim.undo')).toBe(1);
    expect(count(S(a, 'after'), 'dim.seen')).toBe(0);
    expect(S(a, 'after').shown).toMatch(T(3));
    expect(S(a, 'after').behind).toEqual([expect.stringMatching(T(2))]);
  }, 120_000);

  it('S3/N2: a ninth notice sends no dim.seen, and the line names the hand and the time', async () => {
    const rects = Array.from({ length: 9 }, (_, i) => rectAt(60 + (i % 5) * 100, 120 + Math.floor(i / 5) * 90)).flat();
    const turns = Array.from({ length: 9 }, (_, i) => turn(i + 1, recolour(i)));
    const a = await real([...openBoard, ...rects, ...turns, { wait: 500 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(count(S(a, 'after'), 'dim.seen')).toBe(0);
    expect(S(a, 'after').keep).toMatch(/^An older change of Claude’s from \d\d:\d\d can’t be undone in one step now/);
    expect(S(a, 'after').behind).toHaveLength(7);
  }, 180_000);

  it('a focused key whose row leaves sends focus to the board, never to another key', async () => {
    const a = await real([...openBoard, ...rectAt(220, 180), turn(1, recolour(0)), ARM, { press: KEY('dismiss') }, { wait: 1500 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'after').shown).toBeNull();
    expect(S(a, 'after').active).toMatch(/excalidraw/);
  }, 120_000);

  for (const width of [1440, 1280, 1024]) {
    it(`the long forms at a ${width} window: the words never overflow beside the keys; the two-line step when they must`, async () => {
      // 'Claude undid your change and removed 1 of your marks' (the undid lead from the person's act, N3)
      const a = await real([...openBoard, ...rectAt(160, 160), ...rectAt(320, 160), turn(1, `return [{ type: 'delete', id: mine[1] }];`, { extra: `{ undo: { of: { principal: 'p:7k2m9q4x/matt', act: acts[acts.length - 1] } } }` }), { wait: 600 }, strip('long')], { width, shot: `e3-strip-long-${width}` });
      expect(a.errors).toEqual([]);
      const s = S(a, 'long');
      expect(s.row!.title).toMatch(/^Claude undid your change and removed 1 of your marks/);
      expect(s.row!.over).toBe(false);
      expect(s.row!.words).toMatch(/^Claude undid your change/);
      if (s.row!.twoLine) expect(s.row!.h).toBeGreaterThanOrEqual(47);
    }, 120_000);
  }

  it('R7: a cut-out is selected only by a still click with Select; a tool drawn over it is the engine\'s', async () => {
    const a = await real([
      ...openBoard, ...rectAt(220, 180), turn(1, `return [{ type: 'delete', id: mine[0] }];`), { wait: 600 }, strip('cut'),
      // a rect drawn across the cut-out: a new mark, no cut-out selected
      ...rectAt(270, 210), strip('drawn'),
      // Select, then a still click inside the cut-out where no mark lies (its lower right corner)
      { press: '.bd-host [data-key="tool:select"]' }, { press: '.bd-host .bd-stage', at: [240, 195] }, { wait: 500 }, strip('picked'),
    ]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'cut').nodes).toBe(0);
    expect(S(a, 'drawn').nodes).toBe(1);
    expect(S(a, 'drawn').mark).toBeNull();
    expect(S(a, 'picked').mark).toMatchObject({ removed: true });
    expect(S(a, 'picked').keys).toContain('put back');
  }, 120_000);

  it('G7/A1: an attribution the mod does not hold, with the content hash matching, shows the 1b line', async () => {
    // an EDITED STAMP (Aegis A1's test): the stand-in mod folds the same ops under another agent's stamp, so the
    // content hash matches at the next check point and only the attribution digest differs
    const a = await real([...openBoard, ...rectAt(220, 180), turn(1, recolour(0), { modAgent: 'mika' }), { wait: 400 }, { press: '.bd-host .bd-stage', at: [500, 380] }, { wait: 1200 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'after').keep).toBe('Who changed what couldn’t be checked · the marks themselves match');
  }, 120_000);

  it('D1: a default-on grant is said ONCE on the open that made the board', async () => {
    const a = await real([...openBoard, ...rectAt(220, 180), { wait: 800 }, strip('after')]);
    expect(a.errors).toEqual([]);
    expect(S(a, 'after').said.filter((t) => t === 'Claude may edit this board: it can change and remove any mark'), JSON.stringify(S(a, 'after').said)).toHaveLength(1);
  }, 120_000);
});
