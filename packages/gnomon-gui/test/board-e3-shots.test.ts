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
const SHOTS = path.resolve('../../.e3-logs/shots');
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

  // another-hand-is-signed: an agent restyles your rect and writes into your sticky, another agent restyles that
  // agent's words, an agent changes a labelled arrow of yours, a 14px agent box changed by another agent, and a forged
  // restoredFrom on an agent's add (never solid, never your pin); the rect selected so the engine's handles show
  const signed = (zoom: number) => [
    { read: `(() => { const s = ${L}.session; const k = ${L}.kernel; const dim = '${FIXTURE_DIM}';
        const nodes = [...s.view().nodes.entries()]; const mine = nodes.filter(([, v]) => v.by.cls === 'human');
        const rect = mine.find(([, v]) => v.node.kind === 'rect' && !v.node.label); const sticky = mine.find(([, v]) => v.node.kind === 'rect' && typeof v.node.label === 'string'); const arrow = mine.find(([, v]) => v.node.kind === 'arrow' && v.node.label);
        const put = (agent, n, ops, extra) => { const payload = Object.assign({ v: 1, dim, ops, relayedFor: { principal: 'p:7k2m9q4x/' + agent, surface: 'bridge', agent, hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB', turn: 'turn:hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB/' + n } }, extra || {}); const seq = k.append('modns.gnomon.dimension.op', payload, undefined, { scope: { repo: 'repo:0123456789abcdef' } }); ${L}.mod.landedElsewhere({ seq, kind: 'modns.gnomon.dimension.op', payload }); };
        const ops = [];
        if (rect) ops.push({ type: 'update', id: rect[0], patch: { color: 'raspberry' } });
        if (sticky) ops.push({ type: 'update', id: sticky[0], patch: { label: 'words by claude' } });
        if (arrow) ops.push({ type: 'update', id: arrow[0], patch: { color: 'cobalt' } });
        ops.push({ type: 'add', node: { id: '01JD1MSMALLBOX000000000014', kind: 'rect', x: 40, y: 330, z: 'V9', w: 14, h: 14 } });
        ops.push({ type: 'add', node: { id: '01JD1MFORGED00000000000099', kind: 'rect', x: 600, y: 330, z: 'VA', w: 60, h: 40 } });
        put('claude', 1, ops, { undo: { of: { principal: 'p:7k2m9q4x/matt', act: '01JD1M0000000000000000ACT9' }, restored: [['01JD1MFORGED00000000000099', '01JD1MNEVERDELETED00000000', { cls: 'human', principal: 'p:7k2m9q4x/matt' }]] } });
        const later = [{ type: 'update', id: '01JD1MSMALLBOX000000000014', patch: { color: 'leaf' } }];
        if (sticky) later.push({ type: 'update', id: sticky[0], patch: { fill: 'sky' } });
        put('mika', 2, later);
        return JSON.stringify({ rect: rect && rect[0] }); })()`, as: 'drawn' },
    { wait: 900 },
    { read: `(() => { const s = ${L}.session; const r = [...s.view().nodes.entries()].find(([, v]) => v.by.cls === 'human' && v.node.kind === 'rect' && !v.node.label); if (r) ${B}.select([r[0]]); ${B}.setView({ zoom: ${zoom}, scrollX: 0, scrollY: 0 }); return 1; })()`, as: 'set' },
    { wait: 900 },
  ];
  for (const theme of ['day', 'night'] as const)
    for (const zoom of [0.25, 0.49, 0.5, 1, 4])
      it(`another-hand-is-signed ${theme} ${zoom * 100}%`, async () => {
        const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'live', theme, 'sample'), width: 1440, height: 900, timeoutMs: 90_000, actions: signed(zoom) })) as { png: Buffer };
        mkdirSync(CAND, { recursive: true });
        writeFileSync(path.join(CAND, `another-hand-is-signed-${theme}-${Math.round(zoom * 100)}.png`), r.png);
        expect(r.png.length).toBeGreaterThan(1000);
      }, 120_000);
});
