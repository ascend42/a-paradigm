/**
 * S1.4 E3 shots for Mika (item 7). Runs ONLY when asked: GNOMON_E3_SHOTS=1 (it takes minutes and asserts little).
 *  - the turn strip's states in the real app, day and night, at a 1024 and a 1280 window and a 1161 window, whose leaf is
 *    about 560px: into .e3-logs/shots/e3-strip-<state>-<theme>-<window>-leaf<px>.png;
 *  - rule another-hand-is-signed on the live board at 25, 49, 50, 100 and 400%, day and night: into
 *    test/goldens/candidates/e3/ as CANDIDATES (never over a committed golden).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { fixtureUrl, startPreview } from '../scripts/preview.mjs';
import { FIXTURE_DIM } from '../src/preview/board-fixture.js';

const A = 'globalThis.gnomonPreviewApp';
const CUR = `${A}.board.dock.current()`;
const L = 'globalThis.gnomonPreviewLive';
const B = 'globalThis.gnomonPreviewBoard';
const SHOTS = path.resolve('../../.e3fix-logs/shots/r3');
const CAND = path.resolve('test/goldens/candidates/e3');
const type = (s: string): unknown[] => [...s].map((k) => ({ key: k, settle: 25 }));
const BOARD_UP = `(() => { const c = ${CUR}; if (!c) return false; const hd = c.leaf.handle(); return c.leaf.state() !== 'loading' && !!hd && hd.isAlive() && c.session.status().phase !== 'opening'; })()`;
const openBoard = [{ press: '#composer-text' }, ...type('/board'), { key: 'Enter' }, { until: BOARD_UP, as: 'up', timeoutMs: 30_000 }, { wait: 300 }];
const DESELECT = [{ press: '.bd-host [data-key="tool:select"]' }, { press: '.bd-host .bd-stage', at: [120, 12] }, { wait: 300 }];
const rectAt = (x: number, y: number) => [{ press: '.bd-host [data-key="tool:rect"]' }, { drag: [[x, y], [x + 40, y + 25], [x + 80, y + 50]] }, { wait: 500 }, ...DESELECT];
const turn = (n: number, ops: string, extra = '{}') => ({
  read: `(() => { const k = ${A}.kernel; const s = ${CUR}.session; const dim = s.dim; const AG = s.hsid;
    const mine = [...s.view().nodes.entries()].filter(([, v]) => v.by.cls === 'human').sort((a, b) => a[1].addedSeq - b[1].addedSeq).map(([id]) => id);
    const acts = k.rows.filter((r) => r.event.kind === 'modns.gnomon.dimension.op' && r.event.payload.act).map((r) => r.event.payload.act);
    const scope = k.rows.find((r) => String(r.event.kind).startsWith('modns.gnomon.dimension.')).event.scope;
    const payload = Object.assign({ v: 1, dim, ops: (() => { ${ops} })(), relayedFor: { principal: 'p:7k2m9q4x/claude', surface: 'bridge', agent: 'claude', hsid: AG, turn: 'turn:' + AG + '/${n}' } }, ${extra});
    const seq = k.append('modns.gnomon.dimension.op', payload, undefined, { scope });
    ${A}.mod.landedElsewhere({ seq, kind: 'modns.gnomon.dimension.op', payload: Object.assign({}, payload) });
    k.append('turn.result', { turn: 'turn:' + AG + '/${n}' }, AG);
    return seq; })()`,
  as: `turn-${n}`,
});
const recolour = (i: number) => `return [{ type: 'update', id: mine[${i}], patch: { color: 'cobalt' } }];`;
const ARM = { wait: 700 };
const KEY = (word: string) => `#board-turn [data-undo-key^="${word}|"]`;
const LEAFW = { read: `Math.round(document.querySelector('.bd-host .bd-leaf').getBoundingClientRect().width)`, as: 'leafW' };
/** swallow the page's dim.undo frames: the answer never comes, so the key stays pending */
const SWALLOW = { read: `(() => { const k = ${A}.kernel; const send = k.send.bind(k); k.send = (s) => (String(s).includes('"dim.undo"') ? undefined : send(s)); return 1; })()`, as: 'swallow' };

const STATES: Record<string, unknown[]> = {
  notice: [...rectAt(160, 160), ...rectAt(320, 160), turn(1, recolour(0)), turn(2, `return [{ type: 'update', id: mine[1], patch: { color: 'leaf' } }, { type: 'delete', id: mine[0] }];`), ARM],
  menu: [...rectAt(30, 150), ...rectAt(120, 150), ...rectAt(210, 150), turn(1, recolour(0)), turn(2, recolour(1)), turn(3, recolour(2)), ARM, { press: KEY('more') }, ARM],
  mark: [...rectAt(220, 180), turn(1, recolour(0)), ARM, { press: '.bd-host .bd-stage', at: [260, 205] }, { wait: 500 }],
  pending: [...rectAt(220, 180), turn(1, recolour(0)), ARM, SWALLOW, { press: KEY('undo') }, { wait: 800 }],
  'link-down': [...rectAt(220, 180), turn(1, recolour(0)), ARM, { read: `(${A}.down(), 1)`, as: 'down' }, { wait: 800 }],
  redo: [...rectAt(220, 180), turn(1, recolour(0)), ARM, { press: KEY('undo') }, { wait: 1000 }],
  'two-line': [...rectAt(160, 160), ...rectAt(320, 160), turn(1, `return [{ type: 'delete', id: mine[1] }, { type: 'update', id: mine[0], patch: { color: 'leaf' } }];`, `{ undo: { of: { principal: 'p:7k2m9q4x/matt', act: acts[acts.length - 1] } } }`), ARM],
};

const chrome = findChrome() as string | null;
describe.skipIf(!process.env.GNOMON_E3_SHOTS || !chrome)('S1.4 E3 shots for Mika', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => void (p = await startPreview({ port: 0 })), 60_000);
  afterAll(() => p.close());

  for (const theme of ['day', 'night'] as const)
    for (const width of [1024, 1280, 1161])
      for (const [state, actions] of Object.entries(STATES))
        it(`strip ${state} ${theme} ${width}`, async () => {
          const r = (await shootLeaf({ chrome, url: `${fixtureUrl(p.url, 'desk', theme, 'off')}&dim=1`, width, height: 820, timeoutMs: 90_000, actions: [...openBoard, ...actions, LEAFW] })) as { png: Buffer; acted: Record<string, unknown> };
          mkdirSync(SHOTS, { recursive: true });
          writeFileSync(path.join(SHOTS, `e3-strip-${state}-${theme}-${width}-leaf${r.acted.leafW}.png`), r.png);
          expect(r.png.length).toBeGreaterThan(1000);
        }, 120_000);

  // another-hand-is-signed (E3 review E1; Mika r3 item 3): the cases sit in EMPTY board space below the fixture's frame
  // (origin 40, 640), never on its own marks. The person's own rows add an unlabelled rect, a labelled one-run arrow
  // and a labelled rect (a sticky); Claude restyles the rect, writes into the sticky, recolours the arrow, adds a 14px box and a text,
  // removes that text, and carries a forged restoredFrom; the person puts the text back (an undo marker naming
  // Claude's turn, the restored hand Claude's) and changes the 14px box; Mika restyles the sticky. The rect is
  // selected so the engine's handles show; the view is centred on the cases' bounds; every sign of a case must be
  // inside the stage before the shot. A missing case throws.
  const OX = 40;
  const OY = 640;
  const CASES = { w: 220, h: 172 };
  const caseId = (t: string): string => ('01JD1ME1' + t).padEnd(26, '0');
  const signed = (zoom: number) => [
    { read: `(() => { const s = ${L}.session; const k = ${L}.kernel; const dim = '${FIXTURE_DIM}'; const X = ${OX}, Y = ${OY};
        const scope = { repo: 'repo:0123456789abcdef' };
        const me = [...s.view().nodes.values()].find((v) => v.by.cls === 'human');
        if (!me) throw new Error('no person mark in the fixture');
        const human = { principal: me.by.principal, connId: 'conn:preview', surface: 'gui' };
        const AG = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
        const stamp = (agent, n) => ({ principal: 'p:7k2m9q4x/' + agent, surface: 'bridge', agent, hsid: AG, turn: 'turn:' + AG + '/' + n });
        const land = (payload) => { const seq = k.append('modns.gnomon.dimension.op', payload, undefined, { scope }); ${L}.mod.landedElsewhere({ seq, kind: 'modns.gnomon.dimension.op', payload }); };
        const id = (t) => ('01JD1ME1' + t).padEnd(26, '0');
        const R = id('RECT'), AR = id('ARRW'), ST = id('STKY'), BX = id('BXAA'), TX = id('TEXT'), TX2 = id('TEXTB'), FG = id('FRGD');
        land({ v: 1, dim, act: id('ACTA'), relayedFor: human, ops: [
          { type: 'add', node: { id: R, kind: 'rect', x: X, y: Y, z: 'W1', w: 64, h: 40 } },
          { type: 'add', node: { id: AR, kind: 'arrow', x: X, y: Y + 100, z: 'W2', points: [0, 0, 70, 0], label: 'to' } },
          { type: 'add', node: { id: ST, kind: 'rect', x: X + 130, y: Y, z: 'W3', w: 90, h: 50, fill: 'lemon', label: 'my words' } } ] });
        land({ v: 1, dim, relayedFor: stamp('claude', 1), ops: [
          { type: 'update', id: R, patch: { color: 'raspberry' } },
          { type: 'update', id: ST, patch: { label: 'words by claude' } },
          { type: 'update', id: AR, patch: { color: 'cobalt' } },
          { type: 'add', node: { id: BX, kind: 'rect', x: X, y: Y + 150, z: 'W4', w: 14, h: 14 } },
          { type: 'add', node: { id: TX, kind: 'text', x: X + 140, y: Y + 96, z: 'W5', text: 'claude' } },
          { type: 'add', node: { id: FG, kind: 'rect', x: X + 60, y: Y + 146, z: 'W6', w: 40, h: 26 } } ],
          undo: { of: { principal: me.by.principal, act: '01JD1M0000000000000000ACT9' }, restored: [[FG, id('NEVER'), { cls: 'human', principal: me.by.principal }]] } });
        land({ v: 1, dim, relayedFor: stamp('claude', 2), ops: [{ type: 'delete', id: TX }] });
        land({ v: 1, dim, act: id('ACTB'), relayedFor: human, ops: [{ type: 'add', node: { id: TX2, kind: 'text', x: X + 140, y: Y + 96, z: 'W7', text: 'claude' } }],
          undo: { of: { hsid: AG, turn: 'turn:' + AG + '/2' }, restored: [[TX2, TX, { cls: 'agent', principal: 'p:7k2m9q4x/claude', agent: 'claude' }]] } });
        land({ v: 1, dim, act: id('ACTC'), relayedFor: human, ops: [{ type: 'update', id: BX, patch: { color: 'leaf' } }] });
        land({ v: 1, dim, relayedFor: stamp('mika', 3), ops: [{ type: 'update', id: ST, patch: { fill: 'sky' } }] });
        return 1; })()`, as: 'put' },
    { wait: 900 },
    { read: `(() => { const v = ${L}.session.view().nodes; const id = (t) => ('01JD1ME1' + t).padEnd(26, '0'); const tx = v.get(id('TEXTB'));
        return JSON.stringify({ need: { rect: v.has(id('RECT')), arrow: v.has(id('ARRW')), sticky: v.has(id('STKY')), box: v.has(id('BXAA')), putBack: !!tx && !!tx.restoredFrom, forged: v.has(id('FRGD')) } }); })()`, as: 'drawn' },
    // centred on the cases' bounds at this zoom
    { read: `(() => { const v = ${B}.view(); const z = ${zoom}; ${B}.select(['${caseId('RECT')}']); ${B}.setView({ zoom: z, scrollX: v.width / (2 * z) - (${OX} + ${CASES.w} / 2), scrollY: v.height / (2 * z) - (${OY} + ${CASES.h} / 2) }); return 1; })()`, as: 'set' },
    { wait: 900 },
    { read: `(() => { const ids = new Set(${JSON.stringify(['RECT', 'ARRW', 'STKY', 'BXAA', 'TEXTB', 'FRGD'].map(caseId))}); const marks = ${B}.marks().filter((m) => ids.has(m.node)).map((m) => m.id);
        const stage = document.querySelector('.bd-stage').getBoundingClientRect();
        const signs = [...document.querySelectorAll('.bd-over [data-for]')].filter((e) => marks.includes(e.getAttribute('data-for')) && !e.classList.contains('bd-trace'));
        const out = signs.filter((e) => { const r = e.getBoundingClientRect(); return r.left < stage.left - 0.5 || r.right > stage.right + 0.5 || r.top < stage.top - 0.5 || r.bottom > stage.bottom + 0.5; }).map((e) => e.className + ' ' + e.getAttribute('data-for'));
        return JSON.stringify({ count: signs.length, out }); })()`, as: 'signs' },
  ];
  for (const theme of ['day', 'night'] as const)
    for (const zoom of [0.25, 0.49, 0.5, 1, 4])
      it(`another-hand-is-signed ${theme} ${zoom * 100}%`, async () => {
        const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'live', theme, 'sample'), width: 1700, height: 1200, timeoutMs: 90_000, actions: signed(zoom) })) as { png: Buffer; acted: Record<string, unknown> };
        // E3 review E1: every case is drawn, or the shot fails loudly
        const drawn = JSON.parse(String(r.acted.drawn)) as { need: Record<string, boolean> };
        expect(drawn.need).toEqual({ rect: true, arrow: true, sticky: true, box: true, putBack: true, forged: true });
        const signs = JSON.parse(String(r.acted.signs)) as { count: number; out: string[] };
        expect(signs.count).toBeGreaterThan(5);
        expect(signs.out).toEqual([]);
        mkdirSync(CAND, { recursive: true });
        writeFileSync(path.join(CAND, `another-hand-is-signed-${theme}-${Math.round(zoom * 100)}.png`), r.png);
        expect(r.png.length).toBeGreaterThan(1000);
      }, 120_000);
});
