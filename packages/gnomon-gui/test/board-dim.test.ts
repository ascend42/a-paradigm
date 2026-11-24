/**
 * The board handle renders from the folded dimension and reports edits as ops (boards S1.3 pass P3b), through the
 * REAL engine: the dev preview's board fixture in a real Chrome, driven with real pointer and key input over the
 * DevTools protocol (scripts/board-leaf-shots.mjs; a frame between pointer moves). The fixture's marks are rows
 * folded by `foldDim`; an edit the board reports is appended as a row of yours and rendered back, as the live leaf
 * will do. Runs where a Chrome is installed, never on CI (as test/board-leaf-golden.test.ts).
 *
 * Held here: render() never reports an edit (Aegis A1); a selection, a marquee, a pan, a zoom and a hover report
 * none, even on a board holding a malformed order key; a drag is ONE move at pointer-up; draw, move, recolour,
 * relabel and delete each report exactly their ops, and after those ops are folded and rendered a second diff is
 * empty; a remote add or move that lands mid-drag yields no delete or update of that node; Cmd+Z reaches the host
 * and changes nothing in the engine; and a mark of another hand is never drawn the same as yours, per kind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIM_NODE_ID_PATTERN, validateDimOps, type DimOp } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { boardFixture, fixtureId, fixtureRows } from '../src/preview/board-fixture.js';
import { ENGINE_DASHES } from '../src/core/board-overlay.js';

const SIZE = { width: 1440, height: 900 };
const B = 'globalThis.gnomonPreviewBoard';
const D = 'globalThis.gnomonPreviewDim';
const EDITS = `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`;
const COUNT = `${D}.edits.length`;
const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), 1)", as: 'listening' };
const MARKS = `${B}.marks().filter((m) => !m.labelOf).map((m) => m.kind + ':' + m.author.cls).sort().join(' ')`;
/** node ids of the sample fixture (src/preview/board-fixture.ts, in order) */
const FRAME = fixtureId(0);
const BROKER = fixtureId(2);
const KERNEL = fixtureId(4);
const LUNA = fixtureId(6);
type Edit = { ops: DimOp[]; cause: string | null };
type Acted = Record<string, unknown>;

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('the board handle on a folded dimension, in a real engine', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], marks: string | null = null): Promise<Acted> => ((await shootLeaf({ chrome, url: leafUrl(p.url, 'open', 'day', marks), ...SIZE, actions: [ERRORS, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { acted: Acted }).acted;

  it('render() reports no edit: the first render, the same state again, a remote row, and a theme change', async () => {
    const a = await real([
      { read: COUNT, as: 'first' },
      { read: `(${B}.render(${D}.state()), 1)`, as: 'r1' }, { wait: 150 }, { read: COUNT, as: 'again' },
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${fixtureId(900)}', kind: 'rect', x: 460, y: 240, z: 'zz', w: 60, h: 40, fill: 'sky' } }, { type: 'move', ids: ['${LUNA}'], dx: 4, dy: 6 }], 'arky')), 1)`, as: 'r2' }, { wait: 150 }, { read: COUNT, as: 'remote' },
      { read: `(${B}.setTheme('night'), ${B}.setTheme('day'), 1)`, as: 't' }, { wait: 200 }, { read: COUNT, as: 'theme' },
      // and the first input after it is still not an edit
      { at: [600, 400], press: true }, { read: COUNT, as: 'click' },
      { read: MARKS, as: 'marks' },
    ]);
    expect(a).toMatchObject({ first: 0, again: 0, remote: 0, theme: 0, click: 0, errors: [] });
    // the hands are the fold's: the remote rect is the agent's
    expect(a.marks).toBe('arrow:agent arrow:human ellipse:agent frame:human rect:agent rect:unknown sticky:agent sticky:human sticky:human stub:agent stub:human text:agent');
  }, 120_000);

  it('a selection, a marquee, a pan, a zoom and a hover report nothing, even on a board holding a malformed order key', async () => {
    const a = await real([
      // an agent's row with an order key no version of the contract writes: the map would re-key it in ANY diff
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${fixtureId(901)}', kind: 'rect', x: 470, y: 250, z: '!!', w: 60, h: 40 } }], 'arky')), 1)`, as: 'r' },
      { at: [272, 86], press: true }, { read: `${B}.state().selected`, as: 'selected' },
      { drag: [[560, 300], [620, 340], [700, 400]] },
      { move: '#preview-board .bd-stage' },
      { wheel: '#preview-board .bd-stage' }, { read: `${B}.view().scrollY`, as: 'panned' },
      { read: `(${B}.zoomIn(), ${B}.zoomIn(), 1)`, as: 'z' }, { wait: 150 }, { read: `${B}.state().zoom`, as: 'zoom' },
      { read: `(${B}.zoomReset(), ${B}.zoomToFit(), 1)`, as: 'z2' }, { wait: 150 },
      { press: '#preview-board [data-key="tool:hand"]' }, { drag: [[500, 300], [540, 330], [560, 360]] },
      { press: '#preview-board [data-key="tool:select"]' },
      { read: COUNT, as: 'edits' },
    ]);
    expect(a.selected).toBe(1);
    expect(a.panned).not.toBe(0);
    expect(a.zoom).toBeGreaterThan(1);
    expect(a).toMatchObject({ edits: 0, errors: [] });
  }, 120_000);

  it('draw, move, recolour, relabel and delete each report exactly their ops; folded and rendered back, a second diff is empty', async () => {
    const a = await real([
      // draw
      { press: '#preview-board [data-key="tool:rect"]' }, { drag: [[450, 260], [500, 300], [550, 330]] }, { read: EDITS, as: 'draw' },
      // move: a drag through several frames is ONE move
      { press: '#preview-board [data-key="tool:select"]' },
      { drag: [[272, 86], [280, 90], [290, 96], [300, 104], [302, 106]] }, { read: EDITS, as: 'move' },
      // recolour: the tray's own well, by pointer, with the mark selected
      { press: '#preview-board [data-key="ink"]' }, { press: '#preview-board [data-key="line:leaf"]' }, { read: EDITS, as: 'recolour' },
      { press: '#preview-board [data-key="ink"]' },
      // relabel: open the label, type, leave
      { dbl: true, at: [302, 106] }, { key: 'x' }, { key: 'Escape' }, { read: EDITS, as: 'relabel' },
      // delete
      { at: [302, 80], press: true }, { read: `${B}.state().selected`, as: 'selectedForDelete' }, { key: 'Delete' }, { read: EDITS, as: 'delete' },
      // every op above was folded and rendered back by the fixture: nothing more is reported by more input
      { at: [640, 420], press: true }, { drag: [[600, 380], [660, 420]] }, { read: `(${B}.render(${D}.state()), 1)`, as: 'r' }, { at: [640, 420], press: true },
      { read: EDITS, as: 'final' },
      // the WHOLE scene against the state, unfiltered: the board shows exactly what the fold holds
      { read: `${B}.drift()`, as: 'drift' },
      { read: `${B}.marks().filter((m) => m.node !== null).every((m) => m.id !== m.node && !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(m.id))`, as: 'engineIdsAreNotNodeIds' },
      { read: `${B}.marks().filter((m) => !m.labelOf).every((m) => m.node !== null)`, as: 'allStored' },
    ]);
    expect(a.errors).toEqual([]);
    const edits = (k: string): Edit[] => a[k] as Edit[];
    // draw: one add, a rect of yours where it was drawn, under a minted ULID
    expect(edits('draw')).toHaveLength(1);
    const add = edits('draw')[0]!.ops;
    expect(add).toHaveLength(1);
    // (the stage does not start on a whole pixel, so a drawn mark may land one unit off the pointer)
    const node = (add[0] as unknown as { type: string; node: Record<string, number | string> }).node;
    expect(add[0]!.type).toBe('add');
    expect(Object.keys(node).sort()).toEqual(['h', 'id', 'kind', 'w', 'x', 'y', 'z']);
    expect(node.kind).toBe('rect');
    for (const [k, want] of [['x', 450], ['y', 260], ['w', 100], ['h', 70]] as const) expect(Math.abs((node[k] as number) - want), k).toBeLessThanOrEqual(1);
    const drawn = (add[0] as { node: { id: string } }).node.id;
    expect(drawn).toMatch(DIM_NODE_ID_PATTERN);
    expect(edits('draw')[0]!.cause).toBe('pointerup');
    // move: ONE op, a move of the one mark (its label is part of it)
    expect(edits('move')).toHaveLength(2);
    // (object snapping may pull the drop a few units: the op is what the engine shows, one move, whole units)
    const move = edits('move')[1]!.ops as Array<{ type: string; ids: string[]; dx: number; dy: number }>;
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ type: 'move', ids: [BROKER] });
    expect(Object.keys(move[0]!).sort()).toEqual(['dx', 'dy', 'ids', 'type']);
    expect(Math.abs(move[0]!.dx - 30) + Math.abs(move[0]!.dy - 20)).toBeLessThanOrEqual(16);
    expect(Number.isInteger(move[0]!.dx) && Number.isInteger(move[0]!.dy)).toBe(true);
    // recolour
    expect(edits('recolour')).toHaveLength(3);
    expect(edits('recolour')[2]!.ops).toEqual([{ type: 'update', id: BROKER, patch: { color: 'leaf' } }]);
    // relabel
    expect(edits('relabel')).toHaveLength(4);
    expect(edits('relabel')[3]!.ops).toEqual([{ type: 'update', id: BROKER, patch: { label: 'x' } }]); // opening a label selects its words: the key replaces them
    // delete
    expect(a.selectedForDelete).toBe(1);
    expect(edits('delete')).toHaveLength(5);
    expect(edits('delete')[4]!.ops).toEqual([{ type: 'delete', id: BROKER }]);
    expect(edits('delete')[4]!.cause).toBe('keydown');
    // the second diff is empty
    expect(edits('final')).toHaveLength(5);
    expect(a.drift).toEqual([]);
    expect(edits('recolour')[2]!.cause).toBe('click'); // the tray's own press, not the last pointer-up on the board
    expect(a.engineIdsAreNotNodeIds).toBe(true);
    expect(a.allStored).toBe(true);
    // and every reported batch is one the write validator takes from a person, in order
    const fx = boardFixture('sample');
    for (const e of edits('final')) {
      const v = validateDimOps(fx.state(), e.ops, { cls: 'human', principal: 'p:preview/matt' } as never);
      expect(v.refused ?? [], JSON.stringify(e.ops)).toEqual([]);
      fx.apply(e.ops);
    }
    expect(fx.state().nodes.has(BROKER)).toBe(false);
    expect(fx.state().nodes.has(drawn)).toBe(true);
    expect(fx.state().nodes.size).toBe(11); // the sample's 11 marks, less the one deleted, plus the one drawn
    expect(fixtureRows('sample')).toHaveLength(8);
  }, 180_000);

  it('a remote add and a remote move that land mid-drag yield no delete and no update of those nodes; the drag is one move', async () => {
    const remote = `[{ type: 'add', node: { id: '${fixtureId(902)}', kind: 'rect', x: 480, y: 250, z: 'zz', w: 60, h: 40, fill: 'sky' } }, { type: 'move', ids: ['${LUNA}'], dx: 10, dy: 12 }]`;
    const at = (id: string): string => `(() => { const m = ${B}.marks().find((m) => m.node === '${id}'); return m ? [Math.round(m.x), Math.round(m.y)] : null; })()`;
    const a = await real([
      { hold: [[272, 200], [280, 208], [290, 216]] },
      { read: at(KERNEL), as: 'kernelMid' },
      { read: `(${B}.render(${D}.apply(${remote}, 'arky')), 1)`, as: 'r' }, { wait: 120 },
      { read: COUNT, as: 'midDrag' },
      { read: at(KERNEL), as: 'kernelAfterRender' }, { read: at(LUNA), as: 'luna' }, { read: at(fixtureId(902)), as: 'added' },
      { hold: null, release: [300, 230] },
      { read: EDITS, as: 'edits' },
      { read: at(KERNEL), as: 'kernelEnd' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.midDrag).toBe(0);
    // the mark in hand was not put back by the render; the remote rows are on the board
    expect(a.kernelAfterRender).toEqual(a.kernelMid);
    expect(a.luna).toEqual([54, 172]);
    expect(a.added).toEqual([480, 250]);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    const move = edits[0]!.ops as Array<{ type: string; ids: string[]; dx: number; dy: number }>;
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ type: 'move', ids: [KERNEL] });
    expect(Math.abs(move[0]!.dx - 28) + Math.abs(move[0]!.dy - 30)).toBeLessThanOrEqual(16);
    // where the fold now has it is where the person dropped it
    expect(a.kernelEnd).toEqual([212 + move[0]!.dx, 168 + move[0]!.dy]);
  }, 120_000);

  it('Cmd+Z and Cmd+Shift+Z reach the host as keys and change nothing in the engine; a restyle with no event of the rail\'s is put back', async () => {
    const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
    const a = await real([
      { press: '#preview-board [data-key="tool:rect"]' }, { drag: [[450, 260], [500, 300], [550, 330]] },
      { read: `${B}.count()`, as: 'before' },
      { at: [640, 420], press: true },
      { key: 'z', ...mod }, { key: 'z', ...mod, shift: true },
      { read: `${D}.undoKeys`, as: 'keys' }, { read: `${B}.count()`, as: 'after' }, { read: COUNT, as: 'edits' },
      { read: `Object.keys(${B}).filter((k) => k === 'undo' || k === 'redo' || k === 'add')`, as: 'gone' },
      // a programmatic restyle of the selection carries no event of the rail's: it is put back, never reported
      { at: [500, 262], press: true }, { read: `${B}.state().selected`, as: 'selected' },
      { read: `(${B}.setStyle({ line: 'leaf' }), 1)`, as: 's' }, { wait: 200 },
      { read: COUNT, as: 'afterBareRestyle' }, { read: `${B}.drift()`, as: 'driftAfterBareRestyle' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.keys).toEqual(['undo', 'redo']);
    expect(a.after).toBe(a.before);
    expect(a.gone).toEqual([]);
    expect(a).toMatchObject({ edits: 1, selected: 1, afterBareRestyle: 1, driftAfterBareRestyle: [] });
  }, 120_000);

  // ── review batch A (PR #116): a change reported as the person's that was not ──
  /** The engine's own App instance, found through React from the DOM (what a probe uses to make an engine-origin change). */
  const APP = "(() => { const el = document.querySelector('#preview-board .excalidraw'); let f = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))]; while (f && !(f.stateNode && f.stateNode.scene && f.stateNode.scene.replaceAllElements)) f = f.return; return f.stateNode; })()";
  /** Count every scene replacement from here on (a put-back that never ends shows as thousands). */
  const WATCH = { read: `(() => { const app = ${APP}; globalThis.__app = app; globalThis.__calls = 0; const real = app.scene.replaceAllElements.bind(app.scene); app.scene.replaceAllElements = (...a) => { globalThis.__calls++; return real(...a); }; return 1; })()`, as: 'watching' };
  const CALLS = 'globalThis.__calls';
  const posOf = (id: string): string => `(() => { const m = ${B}.marks().find((m) => m.node === '${id}'); return m ? [Math.round(m.x), Math.round(m.y)] : null; })()`;
  const nodeOf = (id: string): string => `(() => { const n = ${D}.state().nodes.get('${id}'); return n ? n.node : null; })()`;
  /** Keep the handle yielded whatever the leaf says on its next draw (the leaf sets it from card focus each frame). */
  const YIELD = { read: `(() => { const h = ${B}; h.setYielded(true); h.setYielded = () => undefined; return 1; })()`, as: 'yielded' };

  it('A1: an engine change nobody made is put back once, in a bounded number of scene calls, and the next click reports nothing', async () => {
    const a = await real([
      WATCH,
      { read: `(() => { const app = globalThis.__app; const id = ${B}.marks().find((m) => m.node === '${KERNEL}').id; app.scene.replaceAllElements(app.scene.getElementsIncludingDeleted().map((e) => (e.id === id ? { ...e, x: e.x + 10, version: e.version + 1 } : e))); app.scene.triggerUpdate(); return 1; })()`, as: 'changed' },
      { wait: 700 },
      { read: CALLS, as: 'calls' }, { read: posOf(KERNEL), as: 'kernel' }, { read: COUNT, as: 'edits' },
      { at: [640, 420], press: true }, { at: [272, 200], press: true },
      { read: COUNT, as: 'editsAfterClicks' }, { read: `${B}.drift()`, as: 'drift' }, { read: CALLS, as: 'callsEnd' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.calls as number).toBeLessThanOrEqual(6); // the change itself, one put-back, and what the engine does around them (it was 6,402)
    expect(a.callsEnd as number).toBeLessThanOrEqual(12);
    expect(a.kernel).toEqual([212, 168]);
    expect(a).toMatchObject({ edits: 0, editsAfterClicks: 0, drift: [] });
  }, 120_000);

  it('A1: while yielded, a drag and a Delete on a SELECTED filled mark are put back, report nothing and do not spin', async () => {
    const a = await real([
      { at: [272, 200], press: true }, { read: `${B}.state().selected`, as: 'selected' },
      WATCH, YIELD,
      { drag: [[272, 200], [290, 214], [310, 230], [330, 250]] }, { wait: 400 },
      { read: CALLS, as: 'callsAfterDrag' }, { read: posOf(KERNEL), as: 'afterDrag' }, { read: COUNT, as: 'editsAfterDrag' },
      { at: [272, 200], press: true }, { read: `${B}.state().selected`, as: 'selectedAgain' },
      { key: 'Delete' }, { wait: 400 },
      { read: CALLS, as: 'callsAfterDelete' }, { read: posOf(KERNEL), as: 'afterDelete' }, { read: COUNT, as: 'editsAfterDelete' }, { read: `${B}.drift()`, as: 'drift' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a).toMatchObject({ selected: 1, selectedAgain: 1, editsAfterDrag: 0, editsAfterDelete: 0, drift: [] });
    expect(a.afterDrag).toEqual([212, 168]);
    expect(a.afterDelete).toEqual([212, 168]);
    expect(a.callsAfterDrag as number).toBeLessThanOrEqual(40);
    expect((a.callsAfterDelete as number) - (a.callsAfterDrag as number)).toBeLessThanOrEqual(20);
  }, 120_000);

  it('A3: an untrusted key is not a person: a synthetic Delete on a selected mark is put back and reports nothing, and a click that changed nothing leaves nothing armed', async () => {
    const a = await real([
      { at: [272, 200], press: true }, { read: `${B}.state().selected`, as: 'selected' },
      { read: `(document.querySelector('#preview-board .excalidraw-container').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true })), 1)`, as: 'k' }, { wait: 300 },
      { read: posOf(KERNEL), as: 'kernel' }, { read: COUNT, as: 'edits' },
      // the real click above changed nothing, so an engine change after it is nobody's
      { read: `(() => { const app = ${APP}; const id = ${B}.marks().find((m) => m.node === '${LUNA}').id; app.scene.replaceAllElements(app.scene.getElementsIncludingDeleted().map((e) => (e.id === id ? { ...e, y: e.y + 9, version: e.version + 1 } : e))); app.scene.triggerUpdate(); return 1; })()`, as: 'c' }, { wait: 300 },
      { read: posOf(LUNA), as: 'luna' }, { read: COUNT, as: 'editsEnd' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a).toMatchObject({ selected: 1, edits: 0, editsEnd: 0 });
    expect(a.kernel).toEqual([212, 168]);
    expect(a.luna).toEqual([44, 160]);
  }, 120_000);

  it('A4: a remote change to the mark IN HAND is kept: the drop reports one move and none of the fields the other hand changed', async () => {
    const remote = `[{ type: 'move', ids: ['${KERNEL}'], dx: 60, dy: 0 }, { type: 'update', id: '${KERNEL}', patch: { color: 'raspberry', label: 'core' } }]`;
    const a = await real([
      { hold: [[272, 200], [280, 208], [290, 216]] },
      { read: `(${B}.render(${D}.apply(${remote}, 'arky')), 1)`, as: 'r' }, { wait: 120 },
      { hold: null, release: [300, 230] },
      { read: EDITS, as: 'edits' }, { read: nodeOf(KERNEL), as: 'node' }, { read: `${B}.drift()`, as: 'drift' },
    ]);
    expect(a.errors).toEqual([]);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    const move = edits[0]!.ops as Array<{ type: string; ids: string[]; dx: number; dy: number }>;
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ type: 'move', ids: [KERNEL] });
    expect(Math.abs(move[0]!.dx - 28) + Math.abs(move[0]!.dy - 30)).toBeLessThanOrEqual(16);
    // the fold has BOTH: the agent's move, colour and label, and the person's drag on top
    expect(a.node).toMatchObject({ color: 'raspberry', label: 'core', x: 212 + 60 + move[0]!.dx, y: 168 + move[0]!.dy });
    expect(a.drift).toEqual([]);
  }, 120_000);

  it('A5: on a board holding a malformed order key, an edit of ANOTHER mark reports only that mark', async () => {
    const a = await real([
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${fixtureId(901)}', kind: 'rect', x: 470, y: 250, z: '!!', w: 60, h: 40 } }], 'arky')), 1)`, as: 'r' },
      { read: `${B}.drift().map((o) => o.type + ':' + (o.id || ''))`, as: 'driftBefore' },
      { drag: [[272, 86], [280, 90], [290, 96], [302, 106]] },
      { read: EDITS, as: 'edits' },
    ]);
    expect(a.errors).toEqual([]);
    // the whole-scene diff does hold the re-key (so the filter is what keeps it out)
    expect(a.driftBefore).toEqual([`update:${fixtureId(901)}`]);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.ops).toHaveLength(1);
    expect(edits[0]!.ops[0]).toMatchObject({ type: 'move', ids: [BROKER] });
  }, 120_000);

  it('A6: a label opened and left as it was reports nothing, also when it wraps taller than its stored box', async () => {
    const a = await real([
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${fixtureId(903)}', kind: 'rect', x: 460, y: 240, z: 'zz', w: 70, h: 24, fill: 'sky', label: 'a label that wraps well past its box' } }])), 1)`, as: 'r' }, { wait: 150 },
      { dbl: true, at: [495, 252] }, { read: `${B}.state().editingText`, as: 'editing' },
      { key: 'Escape' }, { wait: 250 },
      { read: COUNT, as: 'edits' }, { read: nodeOf(fixtureId(903)), as: 'node' }, { read: `${B}.drift()`, as: 'drift' },
      // and a label that IS changed is still reported
      { dbl: true, at: [495, 252] }, { key: 'x' }, { key: 'Escape' }, { wait: 250 },
      { read: EDITS, as: 'changed' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.editing).toBe(true);
    expect(a.edits).toBe(0);
    expect(a.node).toMatchObject({ w: 70, h: 24 });
    expect(a.drift).toEqual([]);
    const changed = a.changed as Edit[];
    expect(changed).toHaveLength(1);
    expect((changed[0]!.ops[0] as { patch: Record<string, unknown> }).patch.label).toBe('x');
  }, 120_000);

  it('A7: moving one shape of a stored bound arrow moves only that end: the other end and the stored route stay', async () => {
    const A = fixtureId(910), Bn = fixtureId(911), ARROW = fixtureId(912);
    const rows = `[{ type: 'add', node: { id: '${A}', kind: 'rect', x: 420, y: 240, z: 'za', w: 60, h: 40, fill: 'sky' } }, { type: 'add', node: { id: '${Bn}', kind: 'rect', x: 600, y: 240, z: 'zb', w: 60, h: 40, fill: 'sky' } }, { type: 'add', node: { id: '${ARROW}', kind: 'arrow', x: 480, y: 260, z: 'zc', points: [0, 0, 120, 0], from: '${A}', to: '${Bn}', label: 'to' } }]`;
    const a = await real([
      { read: `(${B}.render(${D}.apply(${rows}, 'arky')), 1)`, as: 'r' }, { wait: 150 },
      { drag: [[630, 260], [640, 270], [655, 290], [670, 310]] },
      { read: EDITS, as: 'edits' }, { read: nodeOf(ARROW), as: 'arrow' }, { read: nodeOf(Bn), as: 'b' }, { read: `${B}.drift()`, as: 'drift' },
    ]);
    expect(a.errors).toEqual([]);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    const b = a.b as { x: number; y: number };
    const [dx, dy] = [b.x - 600, b.y - 240];
    expect(Math.abs(dx - 40) + Math.abs(dy - 50)).toBeLessThanOrEqual(16);
    // the arrow's start did not move (it was jumping 30 units into the shape that stayed); its end went with its shape
    expect(a.arrow).toMatchObject({ x: 480, y: 260, points: [0, 0, 120 + dx, dy], from: A, to: Bn, label: 'to' });
    expect(edits[0]!.ops.map((o) => o.type).sort()).toEqual(['move', 'update']);
    expect(edits[0]!.ops.find((o) => o.type === 'move')).toMatchObject({ ids: [Bn] });
    expect(a.drift).toEqual([]);
  }, 120_000);

  it('A8: Cmd+Z with a mark in hand does not reach the host; a card taking the keyboard mid-drag puts the mark back', async () => {
    const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
    const a = await real([
      { hold: [[272, 200], [280, 208], [290, 216]] },
      { key: 'z', ...mod },
      { read: `${D}.undoKeys`, as: 'keysMidDrag' },
      YIELD,
      { hold: null, release: [300, 230] }, { wait: 300 },
      { read: COUNT, as: 'edits' }, { read: posOf(KERNEL), as: 'kernel' }, { read: `${B}.drift()`, as: 'drift' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.keysMidDrag).toEqual([]);
    expect(a).toMatchObject({ edits: 0, drift: [] });
    expect(a.kernel).toEqual([212, 168]);
  }, 120_000);

  // ── review batch B: strokes ──
  const INK = (x: number, y: number): string => `document.querySelector('#preview-board canvas.static').getContext('2d').getImageData(${x}, ${y}, 1, 1).data[3]`;

  it('B1, B4: a stroke rendered from the fold reaches its last point, and a stored stroke of one point is a dot that stays', async () => {
    const LINE = fixtureId(920), DOT = fixtureId(921);
    const a = await real([
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${LINE}', kind: 'stroke', x: 460, y: 300, z: 'za', points: [0, 0, 50, 0, 100, 0], weight: 3 } }, { type: 'add', node: { id: '${DOT}', kind: 'stroke', x: 460, y: 360, z: 'zb', points: [0, 0], weight: 3 } }], 'arky')), 1)`, as: 'r' }, { wait: 300 },
      { read: INK(510, 300), as: 'middle' }, { read: INK(557, 300), as: 'nearEnd' }, { read: INK(575, 300), as: 'past' },
      { read: INK(460, 360), as: 'dot' },
      { read: `${B}.marks().filter((m) => m.node === '${DOT}').length`, as: 'dotShown' },
      { read: `${B}.drift()`, as: 'drift' }, { read: COUNT, as: 'edits' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.middle as number).toBeGreaterThan(200);
    expect(a.nearEnd as number, 'the stroke reaches 3 units short of its last point (it stopped about 7 short)').toBeGreaterThan(200);
    expect(a.past).toBe(0);
    expect(a.dot as number).toBeGreaterThan(200);
    expect(a).toMatchObject({ dotShown: 1, drift: [], edits: 0 });
  }, 120_000);

  it('B3: a stroke drawn slowly at 400% is thinned at half a unit: far fewer points than samples, no point twice, and it comes back as drawn', async () => {
    const path: Array<[number, number]> = Array.from({ length: 90 }, (_, i) => [300 + i * 2, Math.round(300 + 60 * Math.sin(i / 14))]);
    const a = await real([
      { read: `(async () => { for (let i = 0; i < 30; i++) { ${B}.zoomIn(); await new Promise((r) => setTimeout(r, 20)); } return 1; })() && 1`, as: 'z' }, { wait: 900 },
      { read: `${B}.state().zoom`, as: 'zoom' },
      { press: '#preview-board [data-key="tool:stroke"]' },
      { drag: path }, { wait: 200 },
      { read: EDITS, as: 'edits' }, { read: `${B}.drift()`, as: 'drift' },
    ], 'empty');
    expect(a.errors).toEqual([]);
    expect(a.zoom).toBe(4);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.ops).toHaveLength(1);
    const pts = (edits[0]!.ops[0] as unknown as { node: { kind: string; points: number[] } }).node.points;
    const n = pts.length / 2;
    // 90 samples over about 45 board units: whole units would keep some 45 stepped points
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThan(30);
    for (let i = 2; i < pts.length; i += 2) expect(pts[i] === pts[i - 2] && pts[i + 1] === pts[i - 1], `point ${i / 2} repeats the one before`).toBe(false);
    expect(a.drift).toEqual([]);
  }, 120_000);

  it('B2: a stroke that cannot fit one row within the tolerance ceiling is reported as several strokes, end to end, each within the limits', async () => {
    // a real press and release with the Stroke tool; the 3,000 corners are put into the stroke in hand (nobody can draw them in a test's time)
    const a = await real([
      { press: '#preview-board [data-key="tool:stroke"]' },
      { hold: [[300, 300], [304, 302], [308, 300]] },
      { read: `(() => { const app = ${APP}; const el = app.state.newElement; const pts = []; for (let i = 0; i < 3000; i++) pts.push([i * 7, (i % 2) * 60]); app.scene.mutateElement ? app.scene.mutateElement(el, { points: pts }) : Object.assign(el, { points: pts, version: el.version + 1 }); return el.points.length; })()`, as: 'stuffed' },
      { hold: null, release: [312, 302] }, { wait: 400 },
      { read: EDITS, as: 'edits' }, { read: `${B}.drift()`, as: 'drift' },
    ], 'empty');
    expect(a.errors).toEqual([]);
    expect(a.stuffed as number).toBeGreaterThanOrEqual(3000);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    const adds = edits[0]!.ops as unknown as Array<{ type: string; node: { kind: string; x: number; y: number; points: number[] } }>;
    expect(adds.length).toBeGreaterThanOrEqual(2);
    let corners = 0;
    for (const [i, op] of adds.entries()) {
      expect(op.type).toBe('add');
      expect(op.node.kind).toBe('stroke');
      expect(op.node.points.length).toBeLessThanOrEqual(1900 * 2);
      expect(JSON.stringify(op.node.points).length).toBeLessThanOrEqual(12 * 1024);
      corners += op.node.points.length / 2 - (i > 0 ? 1 : 0);
      // each piece starts where the one before it ended
      if (i > 0) {
        const before = adds[i - 1]!.node;
        expect([op.node.x, op.node.y]).toEqual([before.x + before.points.at(-2)!, before.y + before.points.at(-1)!]);
      }
    }
    expect(corners).toBeGreaterThanOrEqual(3000); // nothing was flattened
    expect(validateDimOps(boardFixture('empty').state(), adds, { cls: 'human', principal: 'p:preview/matt' } as never).refused ?? []).toEqual([]);
    expect(a.drift).toEqual([]);
  }, 120_000);

  // ── review batch C: display ──
  it('C1: panned so an agent stroke\'s first point is off-screen, its seal is still in view, and it never covers the first point', async () => {
    const S = fixtureId(930);
    const rect = (q: string): string => `(() => { const e = document.querySelector(${JSON.stringify(q)}); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; })()`;
    const a = await real([
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${S}', kind: 'stroke', x: 60, y: 200, z: 'za', points: [0, 0, 200, 10, 400, 0, 700, 30] } }], 'arky')), 1)`, as: 'r' }, { wait: 250 },
      { read: rect('#preview-board .bd-over .bd-seal'), as: 'sealAtRest' }, { read: rect('#preview-board .bd-stage'), as: 'stage' },
      // pan left by hand until the first point is out of view
      { press: '#preview-board [data-key="tool:hand"]' }, { drag: [[500, 380], [400, 380], [300, 380], [200, 380]] }, { wait: 250 },
      { read: `${B}.view().scrollX`, as: 'scrollX' },
      { read: rect('#preview-board .bd-over .bd-seal'), as: 'sealPanned' }, { read: `document.querySelectorAll('#preview-board .bd-over .bd-seal').length`, as: 'seals' },
      { read: COUNT, as: 'edits' },
    ], 'empty');
    expect(a.errors).toEqual([]);
    const stage = a.stage as number[];
    const rest = a.sealAtRest as number[];
    // at rest: left of the first point (stage x 60), 2px clear of it, not on it
    expect(rest[2]! - stage[0]!).toBeLessThanOrEqual(60 - 1);
    expect(a.scrollX as number).toBeLessThan(-100);
    const panned = a.sealPanned as number[];
    expect(a.seals).toBe(1);
    expect(panned[0]!).toBeGreaterThanOrEqual(stage[0]! - 1);
    expect(panned[2]!).toBeLessThanOrEqual(stage[2]! + 1);
    expect(a.edits).toBe(0);
  }, 120_000);

  it('C2, C3: a fallback mark starts no drag, shows no selection and is not deleted, and the leaf says why; a long kind stays on one line; the foot is 32px with and without a seal', async () => {
    const LONG = fixtureId(931);
    const a = await real([
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${LONG}', kind: 'a-very-long-namespace-x:a-kind-name-that-runs-to-the-limit-x', x: 380, y: 230 } }], 'arky')), 1)`, as: 'r' }, { wait: 250 },
      { read: `document.querySelector('#preview-board .bd-foot').getBoundingClientRect().height`, as: 'footWithSeals' },
      // the fixture's own stub at (380, 56), 288 by 52: drag it, then press it and Delete
      { drag: [[500, 80], [520, 110], [540, 150], [560, 190]] }, { wait: 250 },
      { read: `${B}.marks().filter((m) => m.kind === 'stub').map((m) => [Math.round(m.x), Math.round(m.y)]).sort((p, q) => p[1] - q[1])`, as: 'stubsAfterDrag' },
      { at: [640, 420], press: true },
      { at: [500, 80], press: true }, { read: `${B}.state().selected`, as: 'selected' },
      { read: `document.querySelector('#preview-board .bd-keep').textContent`, as: 'said' },
      { key: 'Delete' }, { wait: 250 },
      { read: `${B}.marks().filter((m) => m.kind === 'stub').length`, as: 'stubs' },
      { read: COUNT, as: 'edits' }, { read: `${B}.drift()`, as: 'drift' },
      { read: `[...document.querySelectorAll('#preview-board .bd-stub')].map((e) => { const k = e.querySelector('.bd-stub-k'); const n = e.querySelector('.bd-stub-n'); const b = e.getBoundingClientRect(); return { lineK: Math.round(k.getBoundingClientRect().height), fits: n.getBoundingClientRect().bottom <= b.bottom + 0.5, kWithin: k.getBoundingClientRect().right <= b.right + 0.5 }; })`, as: 'stubBoxes' },
      { read: `(${B}.render(globalThis.gnomonPreviewState([{ hand: 'you', marks: [{ kind: 'rect', x: 40, y: 40, w: 60, h: 40 }] }])), 1)`, as: 'r2' }, { wait: 250 },
      { read: `document.querySelector('#preview-board .bd-foot').getBoundingClientRect().height`, as: 'footNoSeals' },
    ]);
    expect(a.errors).toEqual([]);
    expect(a.stubsAfterDrag).toEqual([[380, 56], [380, 136], [380, 230]]);
    expect(a.selected).toBe(0);
    expect(a.said).toContain('kept as it is');
    expect(a).toMatchObject({ stubs: 3, edits: 0, drift: [] });
    for (const b of a.stubBoxes as Array<{ lineK: number; fits: boolean; kWithin: boolean }>) {
      expect(b.lineK).toBeLessThanOrEqual(22); // one line, never two
      expect(b.fits).toBe(true);
      expect(b.kWithin).toBe(true);
    }
    expect(a.footWithSeals).toBe(32);
    expect(a.footNoSeals).toBe(32);
  }, 120_000);

  it('a mark of another hand is never drawn the same as yours: the engine dashes it, or the host lays a seal or a hollow pin over it', async () => {
    const MARK: Record<string, Record<string, unknown>> = {
      text: { kind: 'text', x: 60, y: 60, text: 'plain text' },
      stroke: { kind: 'stroke', x: 60, y: 90, points: [0, 0, 6, 9, 13, 15, 22, 12, 34, -2, 46, -18, 58, -30] },
      frame: { kind: 'frame', x: 40, y: 40, w: 200, h: 120, title: 'frame' },
      rect: { kind: 'rect', x: 60, y: 60, w: 100, h: 60 },
      ellipse: { kind: 'ellipse', x: 60, y: 60, w: 100, h: 60 },
      diamond: { kind: 'diamond', x: 60, y: 60, w: 100, h: 60 },
      arrow: { kind: 'arrow', x: 60, y: 60, points: [0, 0, 100, 40] },
    };
    const script = `
      const frames = (n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });
      const board = ${B};
      // the same 320 by 220 corner of the engine's static canvas each time (the stage's height follows the foot, which is taller when it holds a seal)
      const pixels = () => { const c = document.createElement('canvas'); c.width = 320; c.height = 220; c.getContext('2d').drawImage(document.querySelector('#preview-board canvas.static'), 0, 0); return c.toDataURL(); };
      const over = () => [...document.querySelectorAll('#preview-board .bd-over > *')].map((e) => String(e.className.baseVal ?? e.className)).sort().join(' ');
      const out = {};
      for (const [kind, mark] of Object.entries(${JSON.stringify(MARK)})) {
        const row = {};
        for (const hand of ['you', 'arky', null]) {
          board.render(globalThis.gnomonPreviewState([{ hand, marks: [mark] }]));
          await frames(6);
          await new Promise((r) => setTimeout(r, 250));
          await frames(2);
          row[hand ?? 'unknown'] = { pixels: pixels(), over: over() };
        }
        out[kind] = { enginePixelsDifferAgent: row.you.pixels !== row.arky.pixels, enginePixelsDifferUnknown: row.you.pixels !== row.unknown.pixels, you: row.you.over, agent: row.arky.over, unknown: row.unknown.over };
      }
      return out;`;
    const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'open', 'day', 'empty'), ...SIZE, script })) as { scripted: Record<string, { enginePixelsDifferAgent: boolean; enginePixelsDifferUnknown: boolean; you: string; agent: string; unknown: string }> };
    for (const [kind, row] of Object.entries(r.scripted)) {
      // what the engine does with the dashed stroke, per kind, is pinned here: ENGINE_DASHES says where the overlay must carry it
      expect(row.enginePixelsDifferAgent, `${kind}: the engine draws an agent's mark differently`).toBe(ENGINE_DASHES.has(kind as never));
      expect(row.enginePixelsDifferUnknown, `${kind}: the engine draws an unknown hand's mark differently`).toBe(ENGINE_DASHES.has(kind as never));
      // never identical to yours: for a kind the engine does not dash, the overlay differs, and always (nothing is selected)
      if (!ENGINE_DASHES.has(kind as never)) {
        expect(row.you, kind).not.toContain('bd-seal');
        expect(row.agent, kind).toContain('bd-seal');
        expect(row.unknown, kind).toContain('unk');
        expect(row.agent, kind).not.toBe(row.you);
        expect(row.unknown, kind).not.toBe(row.you);
      }
    }
    expect(Object.keys(r.scripted).sort()).toEqual(['arrow', 'diamond', 'ellipse', 'frame', 'rect', 'stroke', 'text']);
  }, 120_000);
});
