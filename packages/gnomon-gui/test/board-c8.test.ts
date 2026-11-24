/**
 * Condition C8 (boards S1.3 pass P3b-2; s1-scale-amendments §10; Aegis A5 and A6): paste, copy, cut, drop and
 * duplicate are contained BEFORE the board engine. Through the REAL engine: the dev preview's board fixture in a
 * real Chrome over the DevTools protocol, with a REAL paste (the clipboard is written and the platform's paste
 * chord pressed, the mechanism of commit 97f2ae82), a real copy and cut, real drags from outside the page, and
 * real pointer and key input (scripts/board-leaf-shots.mjs). Runs where a Chrome is installed, never on CI.
 *
 * EVERY case holds: zero CSP rows; no `iframe`, `img`, `embed` or `object` node under the board's host; no engine
 * element outside the board's kinds (an image, an iframe, an embeddable); the handle alive; the engine's own
 * paste, copy and cut handlers never entered (`boardEngineRuns()`: patches `engine-*-removed` count); and either
 * exactly one `onPasteText` carrying the literal text, or a refusal.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DIM_NODE_ID_PATTERN, validateDimOps, type DimOp } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { boardFixture, fixtureId } from '../src/preview/board-fixture.js';
import { dimStandInLine } from '../src/core/dim-clipboard.js';

const SIZE = { width: 1440, height: 900 };
const B = 'globalThis.gnomonPreviewBoard';
const D = 'globalThis.gnomonPreviewDim';
const HOST = "document.querySelector('#preview-board .bd-stage')";
/** Listen from the first action on: pastes the handle reported, refusals, CSP rows, page errors, and a tripwire global. */
const WATCH = {
  read: `(globalThis.__c8 = { pastes: [], said: [], csp: [], errs: [], copies: 0 }, ${B}.onPasteText((t) => __c8.pastes.push(t)), ${B}.onRefusal((r) => __c8.said.push(r.what + ':' + r.why)), document.addEventListener('securitypolicyviolation', (e) => __c8.csp.push(e.effectiveDirective)), addEventListener('error', (e) => __c8.errs.push(String(e.message))), 1)`,
  as: 'watching',
};
/**
 * Run between a clipboard write and its paste. Chrome's own `clipboard.write` parses the HTML it is handed, and a
 * handler attribute in it raises a script-src-attr row AT THE WRITE (measured: the row precedes the paste event).
 * That row is the test's own write, not the board's: it is set apart here and counted, so "zero CSP rows" is held
 * for everything the paste itself does.
 */
const WROTE = "(() => { const rows = __c8.csp.splice(0); __c8.wrote = (__c8.wrote ?? 0) + rows.filter((d) => d === 'script-src-attr').length; __c8.csp.push(...rows.filter((d) => d !== 'script-src-attr')); })()";
/** Read just before a clipboard write: no CSP row may be waiting (a late row of the case before would otherwise be taken for the write's). */
const CLEAR = { read: '__c8.csp.slice()', as: 'cspBeforeWrite' };
/** What every case is judged on. */
const FACTS = `({ csp: __c8.csp.slice(), errs: __c8.errs.slice(), nodes: ${HOST}.querySelectorAll('iframe, img, embed, object, svg image').length, foreign: ${B}.marks().filter((m) => m.kind === 'other').length, alive: ${B}.isAlive(), runs: globalThis.gnomonPreviewBoardModule.boardEngineRuns(), pastes: __c8.pastes.splice(0), said: __c8.said.splice(0), count: ${B}.count(), edits: ${D}.edits.length, pwn: globalThis.__pwn ?? null, texts: [...${D}.state().nodes.values()].filter((n) => n.node.kind === 'text').map((n) => n.node.text) })`;
interface Facts { csp: string[]; errs: string[]; nodes: number; foreign: number; alive: boolean; runs: { paste: number; copy: number; cut: number; drop: number }; pastes: string[]; said: string[]; count: number; edits: number; pwn: unknown; texts: string[] }
type Acted = Record<string, unknown>;
type Edit = { ops: DimOp[]; cause: string | null };
const facts = (as: string): { read: string; as: string } => ({ read: FACTS, as });
/** The invariants of every case. */
function contained(f: Facts, name: string): void {
  expect(f.csp, `${name}: CSP rows`).toEqual([]);
  expect(f.errs, `${name}: page errors`).toEqual([]);
  expect(f.nodes, `${name}: iframe/img/embed nodes under the host`).toBe(0);
  expect(f.foreign, `${name}: elements outside the board's kinds`).toBe(0);
  expect(f.alive, `${name}: the handle is alive`).toBe(true);
  expect(f.runs, `${name}: the engine's own handlers`).toEqual({ paste: 0, copy: 0, cut: 0, drop: 0 });
  expect(f.pwn, `${name}: no handler ran`).toBeNull();
}
/** Exactly one onPasteText with the literal text, which became exactly one more mark: a text node holding it. */
function pastedAsText(f: Facts, before: Facts, text: string, name: string): void {
  contained(f, name);
  expect(f.pastes, `${name}: onPasteText`).toEqual([text]);
  expect(f.said, `${name}: no refusal`).toEqual([]);
  expect(f.count - before.count, `${name}: one mark more`).toBe(1);
  expect(f.texts.filter((t) => t === text.replace(/\r\n?/g, '\n')), `${name}: a text node with the literal words`).toHaveLength(1);
}
/** A refusal and nothing else. */
function refused(f: Facts, before: Facts, said: string[], name: string): void {
  contained(f, name);
  expect(f.pastes, `${name}: no onPasteText`).toEqual([]);
  expect(f.said, `${name}: the refusal`).toEqual(said);
  expect(f.count, `${name}: nothing added`).toBe(before.count);
  expect(f.edits, `${name}: no edit`).toBe(before.edits);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="teal"/></svg>';
/** A 1x1 PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const el = (type: string, x: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type, id: `c8-${type}`, x, y: 0, width: 160, height: 90, angle: 0, strokeColor: '#e03131', backgroundColor: '#ffc9c9', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'dashed', roughness: 2, opacity: 60, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra });
const V2 = JSON.stringify({ type: 'excalidraw/clipboard', elements: [el('image', 0, { fileId: 'f1', status: 'saved', scale: [1, 1] }), el('rectangle', 200)], files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: `data:image/png;base64,${PNG}`, created: 1 } } });
const IFRAME = JSON.stringify({ type: 'excalidraw/clipboard', elements: [el('iframe', 0, { customData: { generationData: { status: 'done', html: '<img src=x onerror="window.__pwn=1">' } } }), el('embeddable', 200, { link: 'https://example.invalid/embed' })], files: {} });
const FRAME = JSON.stringify({ type: 'excalidraw/clipboard', elements: [el('frame', 0, { name: { toString: 'x', a: 1 } })], files: {} });
const HTML = '<img src=x onerror="window.__pwn=2">';
/** An empty spot of the sample fixture's stage. */
const EMPTY: [number, number] = [640, 420];

const YOU = { cls: 'human', principal: 'p:preview/matt' } as never;
const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('C8: paste, copy, cut, drop and duplicate are contained before the engine (real Chrome, real input)', () => {
  let p: { url: string; close: () => Promise<void> };
  let dir = '';
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
    dir = mkdtempSync(path.join(os.tmpdir(), 'gnomon-c8-'));
    writeFileSync(path.join(dir, 'drop.png'), Buffer.from(PNG, 'base64'));
    writeFileSync(path.join(dir, 'drop.svg'), SVG);
    writeFileSync(path.join(dir, 'scene.excalidraw'), JSON.stringify({ type: 'excalidraw', version: 2, source: 'c8', elements: [el('rectangle', 10), el('image', 300, { fileId: 'f1', status: 'saved' })], appState: { viewBackgroundColor: '#ff0000' }, files: {} }));
  }, 60_000);
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await p.close();
  });
  const real = async (actions: unknown[], marks: string | null = null): Promise<Acted> => ((await shootLeaf({ chrome, url: leafUrl(p.url, 'open', 'day', marks), ...SIZE, actions: [WATCH, ...actions] })) as { acted: Acted }).acted;
  const diagCsp = async (): Promise<string> => (await (await fetch(`${p.url}/diag`)).text()).split('\n')[0]!;
  /** CSP rows the preview server has been sent so far (every page of this file posts to the same server). */
  const cspRows = async (): Promise<number> => Number(/, (\d+) CSP row/.exec(await diagCsp())?.[1] ?? Number.NaN);
  let rowsBefore = 0;
  beforeEach(async () => {
    rowsBefore = await cspRows();
  });
  /** The first line /diag must show after a case whose own clipboard writes raised `wrote` rows. */
  const diagWant = async (wrote: number): Promise<string> => (await diagCsp()).replace(/, \d+ CSP row\(s\)$/, `, ${rowsBefore + wrote} CSP row(s)`);
  const aim = { at: EMPTY, press: true };

  it('a paste on the board is never parsed: SVG source (V1), engine JSON with an image and a dataURL (V2), with an iframe, with a frame whose name is an object, HTML with a handler (V7) and a PNG (V3); then exportPng (V6) and the image tool (V5)', async () => {
    const a = await real([
      facts('start'),
      aim, { paste: SVG }, { wait: 250 }, facts('v1'),
      aim, { paste: V2 }, { wait: 250 }, facts('v2'),
      aim, { paste: IFRAME }, { wait: 250 }, facts('iframe'),
      aim, { paste: FRAME }, { wait: 250 }, facts('frame'),
      // V7: HTML only, then HTML with a plain-text form
      aim, CLEAR, { clip: { 'text/html': HTML }, between: WROTE }, { wait: 250 }, facts('v7'),
      aim, { ...CLEAR, as: 'cspBeforeWrite2' }, { clip: { 'text/html': HTML, 'text/plain': 'words' }, between: WROTE }, { wait: 250 }, facts('v7b'),
      // V3: a PNG on the clipboard
      aim, { clip: { 'image/png': PNG }, as: 'pngClip' }, { wait: 250 }, facts('v3'),
      // a text over what one mark may hold
      aim, { paste: 'x'.repeat(4001) }, { wait: 250 }, facts('long'),
      // the stand-in line of a wordless copy, with nothing held: nothing is added and the leaf says so
      aim, { paste: dimStandInLine(2) }, { wait: 250 }, facts('standIn'),
      { read: "document.querySelector('#preview-board .bd-said, #preview-board [aria-live]')?.textContent ?? ''", as: 'standInLine' },
      // V6: the PNG export still works and still asks for nothing
      { await: `${B}.exportPng().then(async (b) => ({ type: b.type, size: b.size, head: [...new Uint8Array(await b.slice(0, 4).arrayBuffer())] }))`, as: 'png' },
      facts('v6'),
      // V5: no image tool, by handle, by key or by a legacy file input
      { read: `(() => { try { ${B}.setTool('image'); return 'chosen'; } catch (e) { return 'refused'; } })()`, as: 'imageTool' },
      aim, { key: '9' }, { wait: 150 },
      { read: `({ tool: ${B}.state().tool, inputs: document.querySelectorAll('input[type=file]').length, button: !!document.querySelector('[data-testid="toolbar-image"]') })`, as: 'v5' },
      facts('end'),
      // a rendered frame whose title is an object (a hostile or later-version row): the engine does not crash
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${fixtureId(950)}', kind: 'frame', x: 700, y: 500, z: 'zzz', w: 120, h: 80, title: { a: 1 } } }], 'arky')), 1)`, as: 'r' }, { wait: 250 },
      facts('frameRow'),
      { read: '__c8.wrote ?? 0', as: 'wrote' },
      // every negative judged above after a fixed wait is judged again at the end
      { wait: 600 }, facts('final'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    pastedAsText(f('v1'), f('start'), SVG, 'V1 SVG source');
    pastedAsText(f('v2'), f('v1'), V2, 'V2 engine JSON with an image and a dataURL');
    pastedAsText(f('iframe'), f('v2'), IFRAME, 'engine JSON with an iframe carrying html');
    pastedAsText(f('frame'), f('iframe'), FRAME, 'engine JSON with a frame whose name is an object');
    refused(f('v7'), f('frame'), ['paste:no-plain-text'], 'V7 HTML with a handler and no text form');
    pastedAsText(f('v7b'), f('v7'), 'words', 'V7 HTML with a text form: the words, never the markup');
    expect(a.pngClip).toBe('written');
    refused(f('v3'), f('v7b'), ['image:no-image-kind'], 'V3 a PNG on the clipboard');
    refused(f('long'), f('v3'), ['text:too-long'], 'a text over the limit');
    // the handle hands the stand-in line on as text; the LEAF adds nothing and says so
    contained(f('standIn'), 'the stand-in line with nothing held');
    expect(f('standIn').pastes).toEqual([dimStandInLine(2)]);
    expect(f('standIn').count).toBe(f('long').count);
    expect(f('standIn').edits).toBe(f('long').edits);
    expect(String(a.standInLine)).toContain('no longer held');
    expect(a.png).toMatchObject({ type: 'image/png', head: [0x89, 0x50, 0x4e, 0x47] });
    contained(f('v6'), 'V6 exportPng after V1 to V3');
    expect(a.imageTool).toBe('refused');
    expect(a.v5).toEqual({ tool: 'select', inputs: 0, button: false });
    contained(f('end'), 'V5 the image tool');
    expect(f('end').count).toBe(f('standIn').count);
    contained(f('frameRow'), 'a rendered frame whose title is an object');
    contained(f('final'), 'at the end');
    expect(f('final').count).toBe(f('frameRow').count);
    expect(f('final').edits).toBe(f('frameRow').edits);
    expect([a.cspBeforeWrite, a.cspBeforeWrite2]).toEqual([[], []]);
    expect(a.wrote).toBe(2); // one script-src-attr row per HTML write of the test's own, and nothing else
    // the only CSP rows of the whole run are the ones the test's own clipboard writes raised
    expect(await diagCsp()).toBe(await diagWant(a.wrote as number));
  }, 180_000);

  it('every drop is refused: a PNG and an SVG file (V4), a scene file (the scene is not replaced), and a library-type drag with no file', async () => {
    const a = await real([
      facts('start'),
      { read: `${B}.marks().map((m) => m.id).join()`, as: 'sceneBefore' },
      { drop: { files: [path.join(dir, 'drop.png'), path.join(dir, 'drop.svg')] }, at: EMPTY }, { wait: 250 }, facts('v4'),
      { drop: { files: [path.join(dir, 'scene.excalidraw')] }, at: EMPTY }, { wait: 250 }, facts('scene'),
      { drop: { items: [{ mimeType: 'application/vnd.excalidrawlib+json', data: JSON.stringify({ itemIds: ['x'] }) }, { mimeType: 'text/plain', data: 'dragged words' }] }, at: EMPTY }, { wait: 250 }, facts('library'),
      { read: `${B}.marks().map((m) => m.id).join()`, as: 'sceneAfter' },
      { wait: 600 }, facts('final'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    // (a real drag is refused once, as it enters the board: the browser never fires `drop` after a refused dragover)
    refused(f('v4'), f('start'), ['image:no-image-kind'], 'V4 a dropped PNG and SVG');
    // (file names cannot be read before a drop: a scene file is refused as a file)
    refused(f('scene'), f('v4'), ['file:no-file-drop'], 'a dropped .excalidraw file');
    refused(f('library'), f('scene'), ['library-file:no-file-drop'], 'a library-type drag with no file');
    expect(a.sceneAfter).toBe(a.sceneBefore);
    contained(f('final'), 'at the end');
    expect(f('final').count).toBe(f('start').count);
    expect(await diagCsp()).toMatch(/, \d+ CSP row\(s\)$/);
    expect(await cspRows()).toBe(rowsBefore);
  }, 120_000);

  it('into a text being typed, a paste is the field\'s own plain-text paste: rich HTML, a file, and an IME composition (Aegis A5)', async () => {
    const TA = `${HOST}.querySelector('textarea')`;
    const a = await real([
      facts('start'),
      { press: '#preview-board [data-key="tool:text"]' }, { at: EMPTY, press: true }, { wait: 200 },
      { read: `!!${TA} && document.activeElement === ${TA}`, as: 'typing' },
      CLEAR, { clip: { 'text/html': `<b>bold</b> ${HTML}<i>words</i>`, 'text/plain': 'bold words' }, between: WROTE }, { wait: 250 },
      { read: `${TA}.value`, as: 'afterHtml' }, facts('html'),
      { clip: { 'image/png': PNG } }, { wait: 250 },
      { read: `${TA}.value`, as: 'afterFile' }, facts('file'),
      { ime: 'にほ', commit: '日本' }, { wait: 250 },
      { read: `${TA}.value`, as: 'afterIme' }, facts('ime'),
      // an engine clipboard payload pasted into the field is words too
      { paste: IFRAME }, { wait: 250 }, { read: `${TA}.value.length`, as: 'afterJson' }, facts('json'),
      { key: 'Escape' }, { wait: 300 },
      { read: `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`, as: 'edits' }, facts('committed'),
      { read: '__c8.wrote ?? 0', as: 'wrote' },
      { wait: 600 }, facts('final'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.typing).toBe(true);
    for (const k of ['html', 'file', 'ime', 'json', 'committed']) {
      contained(f(k), `text field: ${k}`);
      expect(f(k).pastes, `text field ${k}: the handle reports no paste`).toEqual([]);
      expect(f(k).said, `text field ${k}: no refusal`).toEqual([]);
    }
    expect(a.afterHtml).toBe('bold words');
    expect(a.afterFile).toBe('bold words');
    expect(a.afterIme).toBe('bold words日本');
    expect(a.afterJson).toBe('bold words日本'.length + IFRAME.length);
    // the words reach the state only at commit, through the edit path: ONE add of a text node, valid, yours
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.ops).toHaveLength(1);
    expect(edits[0]!.ops[0]).toMatchObject({ type: 'add', node: { kind: 'text', text: `bold words日本${IFRAME}` } });
    expect(validateDimOps(boardFixture('sample').state(), edits[0]!.ops, YOU).refused ?? []).toEqual([]);
    expect(f('committed').count - f('start').count).toBe(1);
    contained(f('final'), 'at the end');
    expect(f('final').count).toBe(f('committed').count);
    expect(a.cspBeforeWrite).toEqual([]);
    expect(a.wrote).toBe(1);
    expect(await diagCsp()).toBe(await diagWant(a.wrote as number));
  }, 120_000);

  it('copy puts plain text and nothing else on the clipboard; pasting it adds clones with new ids, links remapped, authored by the paster; a CRLF clipboard still matches; cut deletes through the edit path; Alt+drag is a move', async () => {
    const CLIPBOARD = `navigator.clipboard.read().then(async (items) => ({ types: items.flatMap((i) => [...i.types]), text: await navigator.clipboard.readText() }))`;
    const NODES = `[...${D}.state().nodes.entries()].map(([id, n]) => ({ id, by: n.by, node: n.node }))`;
    const a = await real([
      facts('start'),
      // two marks of an agent's with labels, and a labelled arrow tied to both
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${fixtureId(960)}', kind: 'rect', x: 560, y: 500, z: 'zx', w: 90, h: 50, label: 'alpha' } }, { type: 'add', node: { id: '${fixtureId(961)}', kind: 'ellipse', x: 760, y: 500, z: 'zy', w: 90, h: 50, label: 'beta', fill: 'sky' } }, { type: 'add', node: { id: '${fixtureId(962)}', kind: 'arrow', x: 650, y: 525, z: 'zz', points: [0, 0, 110, 0], from: '${fixtureId(960)}', to: '${fixtureId(961)}', label: 'calls' } }], 'arky')), 1)`, as: 'r' }, { wait: 250 },
      { read: NODES, as: 'nodes0' },
      // select exactly the three, copy
      { read: `(${B}.focus(), ${B}.select(['${fixtureId(960)}', '${fixtureId(961)}', '${fixtureId(962)}']), 1)`, as: 's' }, { wait: 150 },
      { read: `${B}.state().selected`, as: 'selected' },
      { key: 'c', meta: true, commands: ['copy'] }, { wait: 250 },
      { await: CLIPBOARD, as: 'clipboard' }, facts('copied'),
      // paste it back: clones
      { key: 'v', meta: true, commands: ['paste'] }, { wait: 400 },
      { read: `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`, as: 'editsPaste' }, { read: NODES, as: 'nodes1' }, facts('pasted'),
      // the same text as a Windows clipboard hands it back
      { await: `navigator.clipboard.readText().then((t) => navigator.clipboard.writeText(t.replace(/\\n/g, '\\r\\n'))).then(() => navigator.clipboard.readText())`, as: 'crlfText' },
      { key: 'v', meta: true, commands: ['paste'] }, { wait: 400 },
      { read: `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`, as: 'editsCrlf' }, facts('crlf'),
      // cut one mark
      { read: `(${B}.select(['${fixtureId(2)}']), 1)`, as: 's2' }, { read: `${B}.marks().filter((m) => m.selected).map((m) => m.node)`, as: 'cutSel' },
      { key: 'x', meta: true, commands: ['cut'] }, { wait: 400 },
      { await: CLIPBOARD, as: 'clipboardCut' },
      { read: `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`, as: 'editsCut' }, facts('cut'),
      // Alt+drag a mark: an ordinary move, never a duplicate
      { drag: [[110, 215], [130, 230], [160, 250], [170, 255]], alt: true }, { wait: 300 },
      { read: `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`, as: 'editsAlt' }, facts('alt'),
      // Cmd+D: nothing
      { key: 'd', meta: true }, { wait: 200 }, facts('cmdD'),
      { wait: 600 }, facts('final'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    type N = { id: string; by: { cls?: string }; node: Record<string, unknown> };
    const nodes0 = a.nodes0 as N[];
    expect(a.selected).toBe(3);
    // copy: text/plain only, the words of the copied marks
    contained(f('copied'), 'copy');
    const clipboard = a.clipboard as { types: string[]; text: string };
    expect(clipboard.types).toEqual(['text/plain']);
    expect(clipboard.text).toBe('alpha\nbeta\ncalls'); // the copied marks' words, in paint order, and nothing else
    expect(f('copied').edits).toBe(f('start').edits);
    // paste: ONE batch of adds, each a new id, links inside the copied set remapped to the clones, nothing else carried
    contained(f('pasted'), 'paste of a copy');
    expect(f('pasted').pastes).toEqual([clipboard.text]);
    const paste = (a.editsPaste as Edit[]).at(-1)!;
    expect(paste.cause).toBe('paste');
    expect(paste.ops.every((o) => o.type === 'add')).toBe(true);
    const adds = paste.ops as Array<{ type: 'add'; node: Record<string, unknown> & { id: string } }>;
    const old = new Set(nodes0.map((n) => n.id));
    const fresh = new Set(adds.map((o) => o.node.id));
    expect(fresh.size).toBe(adds.length);
    for (const o of adds) {
      expect(o.node.id).toMatch(DIM_NODE_ID_PATTERN);
      expect(old.has(o.node.id)).toBe(false);
      for (const k of ['from', 'to', 'parent']) if (k in o.node) expect(fresh.has(o.node[k] as string), `${k} names a clone`).toBe(true);
      expect(Object.keys(o.node).filter((k) => k === 'by' || k === 'refs' || k === 'rel')).toEqual([]);
    }
    const tied = adds.find((o) => o.node.kind === 'arrow' && o.node.label === 'calls')!;
    expect(tied, 'the bound arrow came along').toBeDefined();
    expect(adds.find((o) => o.node.id === tied.node.from)?.node).toMatchObject({ kind: 'rect', label: 'alpha' });
    expect(adds.find((o) => o.node.id === tied.node.to)?.node).toMatchObject({ kind: 'ellipse', label: 'beta', fill: 'sky' });
    expect([tied.node.from, tied.node.to]).not.toContain(fixtureId(960));
    expect(validateDimOps(boardFixture('sample').state(), paste.ops, YOU).refused ?? []).toEqual([]);
    // authored by the paster: every clone is yours in the fold, whoever drew the original
    const nodes1 = a.nodes1 as N[];
    expect(nodes0.some((n) => n.by?.cls === 'agent')).toBe(true);
    for (const o of adds) expect(nodes1.find((n) => n.id === o.node.id)?.by?.cls, 'the clone is the paster\'s').toBe('human');
    // CRLF: the same copy matches again
    expect(a.crlfText).toEqual(expect.stringContaining('\r\n'));
    contained(f('crlf'), 'a CRLF clipboard');
    const crlf = (a.editsCrlf as Edit[]).at(-1)!;
    expect((a.editsCrlf as Edit[]).length).toBe((a.editsPaste as Edit[]).length + 1);
    expect(crlf.ops).toHaveLength(adds.length);
    expect(crlf.ops.every((o) => o.type === 'add')).toBe(true);
    // cut: plain text on the clipboard, the mark deleted as the person's own op
    contained(f('cut'), 'cut');
    expect(a.cutSel).toEqual([fixtureId(2)]); // the labelled rect "broker", by name
    expect((a.clipboardCut as { text: string }).text).toBe('broker');
    expect((a.clipboardCut as { types: string[] }).types).toEqual(['text/plain']);
    const cut = (a.editsCut as Edit[]).at(-1)!;
    expect(cut.ops).toEqual([{ type: 'delete', id: (a.cutSel as string[])[0] }]);
    expect(cut.cause).toBe('keydown');
    // Alt+drag: one move of the one mark, no add
    contained(f('alt'), 'Alt+drag');
    const alt = a.editsAlt as Edit[];
    expect(alt.length).toBe((a.editsCut as Edit[]).length + 1);
    expect(alt.at(-1)!.ops.map((o) => o.type)).toEqual(['move']);
    expect(f('alt').count).toBe(f('cut').count);
    contained(f('cmdD'), 'Cmd+D');
    expect(f('cmdD').count).toBe(f('alt').count);
    expect(f('cmdD').edits).toBe(f('alt').edits);
    contained(f('final'), 'at the end');
    expect(f('final').count).toBe(f('cmdD').count);
    expect(f('final').edits).toBe(f('cmdD').edits);
    expect(await cspRows()).toBe(rowsBefore);
  }, 180_000);

  // ── the review of PR #117, group A: marks lost or destroyed ──
  const EDITS = `${D}.edits.map((e) => ({ ops: e.ops, cause: e.cause }))`;
  const SELECTED = `${B}.marks().filter((m) => m.selected && !m.labelOf).map((m) => m.node)`;
  const LINE = "document.querySelector('#preview-board .bd-keep').textContent";
  const IDS = `[...${D}.state().nodes.keys()]`;
  const CLIPTEXT = 'navigator.clipboard.readText()';
  const FRAME = fixtureId(0);
  const BROKER = fixtureId(2);
  const sel = (ids: string[]): { read: string; as: string } => ({ read: `(${B}.focus(), ${B}.select(${JSON.stringify(ids)}), ${B}.state().selected)`, as: 'sel' });
  const copy = { key: 'c', meta: true, commands: ['copy'] };
  const cutKey = { key: 'x', meta: true, commands: ['cut'] };
  const pasteKey = { key: 'v', meta: true, commands: ['paste'] };

  it('A1: what a paste added is what is selected afterwards: Delete removes only the paste, clones and pasted text alike', async () => {
    const a = await real([
      { read: IDS, as: 'ids0' },
      sel([BROKER]), copy, { wait: 200 }, pasteKey, { wait: 400 },
      { read: EDITS, as: 'afterPaste' }, { read: SELECTED, as: 'selectedClone' },
      { key: 'Delete' }, { wait: 300 }, { read: EDITS, as: 'afterDelete' }, { read: IDS, as: 'ids1' },
      aim, { paste: 'pasted words' }, { wait: 400 }, { read: EDITS, as: 'afterText' }, { read: SELECTED, as: 'selectedText' },
      { key: 'Delete' }, { wait: 300 }, { read: EDITS, as: 'afterDelete2' }, { read: IDS, as: 'ids2' },
    ]);
    const adds = ((a.afterPaste as Edit[]).at(-1)!.ops as Array<{ type: string; node: { id: string } }>).map((o) => o.node.id);
    expect(adds).toHaveLength(1);
    expect(a.selectedClone).toEqual(adds);
    expect((a.afterDelete as Edit[]).at(-1)!.ops).toEqual([{ type: 'delete', id: adds[0] }]);
    expect(a.ids1).toEqual(a.ids0); // the original is still there, the clone is gone
    const text = ((a.afterText as Edit[]).at(-1)!.ops as Array<{ type: string; node: { id: string; kind: string } }>)[0]!.node;
    expect(text.kind).toBe('text');
    expect(a.selectedText).toEqual([text.id]);
    expect((a.afterDelete2 as Edit[]).at(-1)!.ops).toEqual([{ type: 'delete', id: text.id }]);
    expect(a.ids2).toEqual(a.ids0);
  }, 120_000);

  it('A2: a frame travels with its children, a cut deletes exactly what the register took, and a selection over the cap is refused whole (a copy says what it left out)', async () => {
    const NODES = `[...${D}.state().nodes.entries()].map(([id, n]) => ({ id, parent: n.node.parent ?? null, kind: n.node.kind }))`;
    const many = Array.from({ length: 70 }, (_, i) => ({ type: 'add', node: { id: fixtureId(1000 + i), kind: 'rect', x: 700 + (i % 10) * 30, y: 60 + Math.floor(i / 10) * 30, z: `zz${String(i).padStart(2, '0')}`, w: 20, h: 20 } }));
    const a = await real([
      { read: NODES, as: 'nodes0' },
      // cut the frame alone: its children go with it, and nothing else
      sel([FRAME]), cutKey, { wait: 400 }, { read: EDITS, as: 'cutFrame' }, { read: NODES, as: 'nodes1' },
      pasteKey, { wait: 400 }, { read: EDITS, as: 'pasteFrame' },
      // 70 more marks: Cmd+A, Cmd+X is refused whole
      { read: `(${B}.render(${D}.apply(${JSON.stringify(many)}, 'arky')), 1)`, as: 'r' }, { wait: 300 },
      { await: `navigator.clipboard.writeText('sentinel').then(() => 1)`, as: 'w' },
      aim, { key: 'a', meta: true, commands: ['selectAll'] }, { wait: 150 }, { read: `${B}.state().selected`, as: 'selectedAll' },
      { read: `${D}.edits.length`, as: 'editsBeforeCut' }, { read: `${B}.count()`, as: 'countBeforeCut' },
      cutKey, { wait: 400 }, { read: `${D}.edits.length`, as: 'editsAfterCut' }, { read: `${B}.count()`, as: 'countAfterCut' }, { read: LINE, as: 'cutLine' }, { await: CLIPTEXT, as: 'clipAfterCut' },
      // a copy of the same selection takes 64 and says how many it left out
      copy, { wait: 300 }, { read: LINE, as: 'copyLine' },
      pasteKey, { wait: 500 }, { read: EDITS, as: 'pasteMany' },
    ]);
    type N = { id: string; parent: string | null; kind: string };
    const nodes0 = a.nodes0 as N[];
    const children = nodes0.filter((n) => n.parent === FRAME).map((n) => n.id);
    expect(children.length).toBeGreaterThan(3);
    const cut = (a.cutFrame as Edit[]).at(-1)!;
    expect(cut.ops.every((o) => o.type === 'delete')).toBe(true);
    expect((cut.ops as Array<{ id: string }>).map((o) => o.id).sort()).toEqual([FRAME, ...children].sort());
    expect((a.nodes1 as N[]).map((n) => n.id).sort()).toEqual(nodes0.filter((n) => n.id !== FRAME && n.parent !== FRAME).map((n) => n.id).sort());
    // the paste brings back the frame WITH its children, each tied to the new frame
    const back = (a.pasteFrame as Edit[]).at(-1)!.ops as Array<{ type: string; node: { id: string; kind: string; parent?: string } }>;
    expect(back).toHaveLength(children.length + 1);
    const frame = back.find((o) => o.node.kind === 'frame')!.node;
    expect(back.filter((o) => o.node.kind !== 'frame').every((o) => o.node.parent === frame.id)).toBe(true);
    // over the cap: the cut is refused whole, with a line, and the clipboard is not touched
    expect(a.selectedAll as number).toBeGreaterThan(64);
    expect(a.editsAfterCut).toBe(a.editsBeforeCut);
    expect(a.countAfterCut).toBe(a.countBeforeCut);
    expect(String(a.cutLine)).toContain('nothing was cut');
    expect(a.clipAfterCut).toBe('sentinel');
    // the copy says what it left out, and the paste is the 64 it took
    expect(String(a.copyLine)).toMatch(/^\d+ marks were left out of the copy/);
    const pasted = (a.pasteMany as Edit[]).at(-1)!;
    expect(pasted.cause).toBe('paste');
    expect(pasted.ops).toHaveLength(64);
  }, 180_000);

  it('A3: a copy or a cut of a mark not stored yet takes nothing, says so, and forgets the older copy so it cannot be pasted in its place', async () => {
    const a = await real([
      sel([BROKER]), copy, { wait: 200 },
      // from here on the fixture records edits and does NOT store them: a drawn mark stays unstored
      { read: `(${D}.held = true, 1)`, as: 'held' },
      { press: '#preview-board [data-key="tool:rect"]' }, { drag: [[450, 300], [500, 330], [540, 360]] }, { wait: 200 },
      { read: `${B}.marks().filter((m) => m.selected).map((m) => m.node)`, as: 'selectedNew' },
      { read: `${D}.edits.length`, as: 'edits0' },
      cutKey, { wait: 300 }, { read: LINE, as: 'cutLine' }, { read: `${B}.count()`, as: 'countAfterCut' },
      { read: `(globalThis.__c8.said.splice(0))`, as: 'said' },
      copy, { wait: 300 }, { read: LINE, as: 'copyLine' },
      // the older copy's words are still on the clipboard: pasted now, they are words, never clones
      pasteKey, { wait: 400 }, { read: EDITS, as: 'edits' },
    ]);
    expect(a.selectedNew).toEqual([null]);
    expect(String(a.cutLine)).toContain('isn’t saved yet');
    expect(String(a.copyLine)).toContain('isn’t saved yet');
    expect(a.said).toEqual(['clipboard:not-stored']);
    const edits = a.edits as Edit[];
    expect(edits.length).toBe((a.edits0 as number) + 1); // the paste alone: the cut deleted nothing
    const op = edits.at(-1)!.ops as Array<{ type: string; node: { kind: string; text?: string } }>;
    expect(op).toHaveLength(1);
    expect(op[0]!.node).toMatchObject({ kind: 'text', text: 'broker' });
  }, 120_000);

  it('A4: words that would take a text being typed over its limit are refused at the paste, and what was typed is kept', async () => {
    const TA = `${HOST}.querySelector('textarea')`;
    const a = await real([
      { press: '#preview-board [data-key="tool:text"]' }, { at: EMPTY, press: true }, { wait: 200 },
      { key: 'a' }, { key: 'b' },
      { paste: 'x'.repeat(3999) }, { wait: 300 }, { read: `${TA}.value`, as: 'value' }, facts('refusedPaste'),
      { paste: 'x'.repeat(3998) }, { wait: 300 }, { read: `${TA}.value.length`, as: 'fits' },
      { key: 'Escape' }, { wait: 300 }, { read: EDITS, as: 'edits' }, { read: LINE, as: 'line' },
    ]);
    expect(a.value).toBe('ab');
    expect((a.refusedPaste as Facts).said).toEqual(['text:too-long']);
    expect(a.fits).toBe(4000);
    const edits = a.edits as Edit[];
    expect(edits).toHaveLength(1);
    expect((edits[0]!.ops[0] as unknown as { node: { text: string } }).node.text).toBe(`ab${'x'.repeat(3998)}`);
  }, 120_000);

  it('A5: a mark copied and pasted back inside its frame, which still stands, stays in that frame', async () => {
    const a = await real([
      sel([BROKER]), copy, { wait: 200 }, pasteKey, { wait: 400 }, { read: EDITS, as: 'edits' },
    ]);
    const add = ((a.edits as Edit[]).at(-1)!.ops as Array<{ type: string; node: { id: string; parent?: string; label?: string } }>)[0]!.node;
    expect(add).toMatchObject({ label: 'broker', parent: FRAME });
    expect(add.id).not.toBe(BROKER);
  }, 120_000);

  // ── the review of PR #117, group B: the second line, and keys ──
  const APP = "(() => { const el = document.querySelector('#preview-board .excalidraw'); let f = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))]; while (f && !(f.stateNode && f.stateNode.scene && f.stateNode.scene.replaceAllElements)) f = f.return; return f.stateNode; })()";
  const RUNS = 'globalThis.gnomonPreviewBoardModule.boardEngineRuns()';
  const VIEW = `(() => { const v = ${B}.view(); return [Math.round(v.scrollX), Math.round(v.scrollY), v.zoom]; })()`;
  const STATE = `JSON.stringify([...${D}.state().nodes.entries()])`;

  it('B5: each second-line patch holds with the first line bypassed: the engine\'s own paste, copy, cut, drop and duplicate handlers, called directly, count and do nothing', async () => {
    const a = await real([
      sel([BROKER]),
      { read: `${B}.count()`, as: 'count0' }, { read: STATE, as: 'state0' },
      { read: `(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(V2)}); ${APP}.pasteFromClipboard(new ClipboardEvent('paste', { clipboardData: dt, cancelable: true })); return 1; })()`, as: 'p' }, { wait: 500 },
      { read: RUNS, as: 'afterPaste' }, { read: `${B}.count()`, as: 'countPaste' },
      { read: `(() => { const dt = new DataTransfer(); ${APP}.onCopy(new ClipboardEvent('copy', { clipboardData: dt, cancelable: true })); return [...dt.types]; })()`, as: 'copyTypes' },
      { read: `(() => { const dt = new DataTransfer(); ${APP}.onCut(new ClipboardEvent('cut', { clipboardData: dt, cancelable: true })); return [...dt.types]; })()`, as: 'cutTypes' }, { wait: 300 },
      { read: RUNS, as: 'afterCut' }, { read: `${B}.count()`, as: 'countCut' },
      { read: `(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify({ type: 'excalidraw', version: 2, elements: [el('rectangle', 10)], appState: {}, files: {} }))}], 'scene.excalidraw', { type: 'application/json' })); let stopped = 0; ${APP}.handleAppOnDrop({ dataTransfer: dt, clientX: 600, clientY: 400, preventDefault() { stopped++; }, stopPropagation() {} }); return stopped; })()`, as: 'dropStopped' }, { wait: 500 },
      { read: RUNS, as: 'afterDrop' }, { read: `${B}.count()`, as: 'countDrop' },
      { read: `(() => { const app = ${APP}; app.actionManager.executeAction(app.actionManager.actions.duplicateSelection); return 1; })()`, as: 'd' }, { wait: 300 },
      { read: `${B}.count()`, as: 'countDup' }, { read: `${D}.edits.length`, as: 'edits' }, { read: STATE, as: 'state1' },
      // the text editor's own paste handler is not installed
      { press: '#preview-board [data-key="tool:text"]' }, { at: EMPTY, press: true }, { wait: 200 },
      { read: `${HOST}.querySelector('textarea').onpaste`, as: 'onpaste' }, { key: 'Escape' },
    ]);
    expect(a.afterPaste).toEqual({ paste: 1, copy: 0, cut: 0, drop: 0 });
    expect(a.copyTypes).toEqual([]);
    expect(a.cutTypes).toEqual([]);
    expect(a.afterCut).toEqual({ paste: 1, copy: 1, cut: 1, drop: 0 });
    expect(a.afterDrop).toEqual({ paste: 1, copy: 1, cut: 1, drop: 1 });
    expect(a.dropStopped).toBe(1);
    for (const k of ['countPaste', 'countCut', 'countDrop', 'countDup']) expect(a[k], k).toBe(a.count0);
    expect(a.edits).toBe(0);
    expect(a.state1).toBe(a.state0);
    expect(a.onpaste).toBeNull();
  }, 120_000);

  it('B7: a paste and a copy made elsewhere on the page are not counted against the board; with the keyboard on the board\'s own rail a paste is the board\'s', async () => {
    const a = await real([
      { read: "(() => { const t = document.querySelector('#composer textarea, #composer input, textarea'); t.focus(); return document.activeElement === t && !document.querySelector('#preview-board').contains(t); })()", as: 'outside' },
      { paste: 'typed elsewhere' }, { wait: 250 }, { key: 'a', meta: true, commands: ['selectAll'] }, { key: 'c', meta: true, commands: ['copy'] }, { wait: 250 },
      facts('elsewhere'),
      // focus a rail key (inside the leaf, outside the engine's host) and paste
      { read: "(() => { const k = document.querySelector('#preview-board [data-key=\"tool:select\"]'); k.focus(); return document.activeElement === k; })()", as: 'onRail' },
      { paste: 'from the rail' }, { wait: 400 }, facts('rail'),
    ]);
    expect(a.outside).toBe(true);
    const f = (k: string): Facts => a[k] as Facts;
    contained(f('elsewhere'), 'a paste and a copy in the composer');
    expect(f('elsewhere').pastes).toEqual([]);
    expect(a.onRail).toBe(true);
    pastedAsText(f('rail'), f('elsewhere'), 'from the rail', 'a paste with the keyboard on the rail');
  }, 120_000);

  it('B2 and B3: a sweep of key chords leaves the board as it was; Cmd+Arrow and Alt+Arrow make nothing, select nothing else and do not move the view', async () => {
    const keys = [...'abcdefghijklmnopqrstuvwxyz123456789[];\',./\\'];
    const mods: Array<Record<string, boolean>> = [{ meta: true }, { meta: true, shift: true }, { meta: true, alt: true }, { alt: true }, { alt: true, shift: true }, { ctrl: true }];
    // not swept: Cmd+A (select all) and Cmd+0/-/= (zoom) are the documented keys
    const chords = mods.flatMap((m) => keys.filter((k) => !(m.meta && !m.shift && !m.alt && k === 'a')).map((k) => ({ key: k, ...m, settle: 8 })));
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].flatMap((k) => [{ key: k, meta: true, settle: 60 }, { key: k, alt: true, settle: 60 }]);
    const a = await real([
      sel([BROKER]), { read: STATE, as: 'state0' }, { read: VIEW, as: 'view0' }, { read: `${B}.count()`, as: 'count0' },
      ...arrows, { wait: 500 },
      { read: VIEW, as: 'viewArrows' }, { read: SELECTED, as: 'selectedArrows' }, { read: `${B}.count()`, as: 'countArrows' }, { read: `${D}.edits.length`, as: 'editsArrows' },
      ...chords, { wait: 600 },
      { read: STATE, as: 'state1' }, { read: VIEW, as: 'view1' }, { read: `${B}.count()`, as: 'count1' }, { read: SELECTED, as: 'selected1' },
      { read: `${D}.edits.length`, as: 'edits' }, { read: `${B}.state()`, as: 'st' }, facts('end'),
      { read: `${HOST}.querySelectorAll('.Modal, .Dialog, [role="dialog"], .popover, .context-menu, .dropdown-menu').length`, as: 'dialogs' },
    ]);
    expect(chords.length).toBeGreaterThan(150);
    expect(a.viewArrows).toEqual(a.view0);
    expect(a.selectedArrows).toEqual([BROKER]);
    expect(a.countArrows).toBe(a.count0);
    expect(a.editsArrows).toBe(0);
    expect(a.state1).toBe(a.state0);
    expect(a.view1).toEqual(a.view0);
    expect(a.count1).toBe(a.count0);
    expect(a.selected1).toEqual([BROKER]);
    expect(a.edits).toBe(0);
    expect(a.st).toMatchObject({ tool: 'select', editingText: false });
    expect(a.dialogs).toBe(0);
    contained(a.end as Facts, 'after the key sweep');
  }, 240_000);

  it('B1: a scene file dropped while the engine is up and its handle is not (loading), and a drop after the handle has died, reach nothing', async () => {
    const drop = (target: string): string => `(() => { const dt = new DataTransfer(); dt.items.add(new File(['{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}'], 'scene.excalidraw', { type: 'application/json' })); const t = ${target}; const over = new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }); t.dispatchEvent(over); const ev = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }); t.dispatchEvent(ev); return { stopped: ev.defaultPrevented, over: over.defaultPrevented }; })()`;
    const a = await real([
      // a second board, mounted by hand. The first drop is made the moment the engine's canvas exists, before
      // mountBoard resolves; then its engine is made to throw while rendering (the handle is dead, the guard is
      // still installed) and a second drop is made on whatever of it is left in the page
      { await: `new Promise((done) => { const div = document.createElement('div'); div.id = 'c8-second'; div.className = 'bd-board'; document.querySelector('#preview-board .bd-stage').appendChild(div); const out = { resolved: false }; new MutationObserver((_r, mo) => { const c = div.querySelector('canvas'); if (!c || out.loading) return; mo.disconnect(); out.loading = Object.assign(${drop('c')}, { resolvedAtDrop: out.resolved }); }).observe(div, { childList: true, subtree: true }); globalThis.gnomonPreviewBoardModule.mountBoard(div, { onError() { out.crashed = true; } }).then((h) => { out.resolved = true; setTimeout(() => { try { out.count = h.count(); const el = div.querySelector('.excalidraw'); let f = el[Object.keys(el).find((k) => k.startsWith('__reactFiber'))]; while (f && !(f.stateNode && f.stateNode.scene && f.stateNode.scene.replaceAllElements)) f = f.return; try { f.stateNode.setState(() => { throw new Error('c8: the engine stopped'); }); } catch (e) { /* reported through the root */ } setTimeout(() => { try { out.alive = h.isAlive(); const left = div.querySelector('canvas') ?? div; out.dead = ${drop('left')}; out.runs = ${RUNS}; h.unmount(); div.remove(); done(out); } catch (e) { done({ failed: 'late: ' + (e && e.stack || e) }); } }, 400); } catch (e) { done({ failed: 'crash: ' + (e && e.stack || e) }); } }, 400); }, (e) => done({ failed: String(e) })); })`, as: 'second' },
      // and a REAL drop on the leaf afterwards goes nowhere
      { drop: { files: [path.join(dir, 'scene.excalidraw')] }, at: EMPTY }, { wait: 400 },
      { read: RUNS, as: 'runs' }, { read: 'location.pathname + location.search', as: 'where' },
      { read: "document.querySelectorAll('#preview-board iframe, #preview-board img').length", as: 'nodes' }, facts('end'),
    ]);
    const second = a.second as { loading?: { stopped: boolean; over: boolean; resolvedAtDrop: boolean }; dead?: { stopped: boolean; over: boolean }; alive?: boolean; crashed?: boolean; count?: number; runs?: Record<string, number>; failed?: string };
    expect(second.failed).toBeUndefined();
    expect(second.loading).toEqual({ stopped: true, over: true, resolvedAtDrop: false });
    expect(second.count).toBe(0);
    expect(second).toMatchObject({ crashed: true, alive: false });
    expect(second.dead).toEqual({ stopped: true, over: true });
    expect(second.runs).toEqual({ paste: 0, copy: 0, cut: 0, drop: 0 });
    expect(a.runs).toEqual({ paste: 0, copy: 0, cut: 0, drop: 0 });
    expect(String(a.where)).toContain('board=open'); // the page did not navigate to the dropped file
    expect(a.nodes).toBe(0);
    expect((a.end as Facts).alive).toBe(true); // the leaf's own board is untouched
  }, 120_000);

  // ── the review of PR #117, group C: where things land, and words ──
  it('C1: clones pasted after panning away land in view; a second text paste steps off the first; a long paste starts in view', async () => {
    const BOX = `(() => { const v = ${B}.view(); return { x: -v.scrollX, y: -v.scrollY, w: v.width / v.zoom, h: v.height / v.zoom }; })()`;
    const a = await real([
      sel([BROKER]), copy, { wait: 200 },
      { wheel: '#preview-board .bd-stage' }, { wheel: '#preview-board .bd-stage' }, { wheel: '#preview-board .bd-stage' }, { wheel: '#preview-board .bd-stage' }, { wheel: '#preview-board .bd-stage' }, { wait: 300 },
      { read: BOX, as: 'box' },
      { read: `(${B}.focus(), 1)`, as: 'f' }, pasteKey, { wait: 400 }, { read: EDITS, as: 'clone' },
      { read: `(${B}.focus(), 1)`, as: 'f2' }, { paste: 'first words' }, { wait: 300 }, { read: `(${B}.focus(), 1)`, as: 'f3' }, { paste: 'first words' }, { wait: 300 }, { read: EDITS, as: 'texts' },
      { read: `(${B}.focus(), 1)`, as: 'f4' }, { paste: Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n') }, { wait: 400 }, { read: EDITS, as: 'tall' },
    ]);
    const box = a.box as { x: number; y: number; w: number; h: number };
    expect(box.y).toBeGreaterThan(600); // panned well away from where the copy was made
    const clone = ((a.clone as Edit[]).at(-1)!.ops as Array<{ node: { x: number; y: number; w: number; h: number } }>)[0]!.node;
    expect(Math.abs(clone.x + clone.w / 2 - (box.x + box.w / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(clone.y + clone.h / 2 - (box.y + box.h / 2))).toBeLessThanOrEqual(1);
    const texts = (a.texts as Edit[]).slice(-2).map((e) => (e.ops as Array<{ node: { x: number; y: number } }>)[0]!.node);
    expect([texts[1]!.x - texts[0]!.x, texts[1]!.y - texts[0]!.y]).toEqual([16, 16]);
    expect(Math.abs(texts[0]!.x + (11 * 8.0625) / 2 - (box.x + box.w / 2))).toBeLessThanOrEqual(1); // the BOX is centred, not its corner
    const tall = ((a.tall as Edit[]).at(-1)!.ops as Array<{ node: { y: number } }>)[0]!.node;
    expect(tall.y).toBeGreaterThanOrEqual(box.y); // its top is in view
    expect(tall.y).toBeLessThan(box.y + box.h / 2);
  }, 120_000);

  it('C2, C3, C4, C5: Cmd+D stays out of the browser; the rail refuses a file drag; a pasted file, a text drag, look-alike words, white space and control characters each get the right answer; the lines say what happened', async () => {
    const esc = fixtureId(980);
    const big = [981, 982, 983].map((n, i) => ({ type: 'add', node: { id: fixtureId(n), kind: 'text', x: 700, y: 60 + i * 30, z: `zy${i}`, text: String(i).repeat(1500) } }));
    const a = await real([
      facts('start'),
      // C2: Cmd+D with the board focused is default-prevented
      { read: `(globalThis.__d = [], window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'd') globalThis.__d.push(e.defaultPrevented); }), ${B}.focus(), 1)`, as: 'w' },
      { key: 'd', meta: true }, { read: "(() => { document.querySelector('#preview-board [data-key=\"tool:select\"]').focus(); return 1; })()", as: 'rf' }, { key: 'd', meta: true }, { read: 'globalThis.__d', as: 'cmdD' },
      // C2: a file dragged onto the rail (left of the stage) is refused by the leaf
      { drop: { files: [path.join(dir, 'drop.png')] }, at: [-24, 60] }, { wait: 300 }, { read: LINE, as: 'railLine' }, facts('rail'),
      // C3: a text-only drag over the board
      aim, { drop: { items: [{ mimeType: 'text/plain', data: 'dragged words' }] }, at: EMPTY }, { wait: 300 }, { read: LINE, as: 'dragLine' }, facts('drag'),
      // C3: a file PASTE has its own line (a text file: an image has the image line)
      aim, { read: `(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' })); globalThis.__fp = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }); document.querySelector('#preview-board .excalidraw-container').dispatchEvent(globalThis.__fp); return globalThis.__fp.defaultPrevented; })()`, as: 'filePasteStopped' }, { wait: 200 }, { read: LINE, as: 'filePasteLine' }, facts('filePaste'),
      // C5: the lines
      aim, { clip: { 'text/html': '<b>x</b>' } }, { wait: 300 }, { read: LINE, as: 'htmlLine' }, facts('html'),
      aim, { paste: 'x'.repeat(4001) }, { wait: 300 }, { read: LINE, as: 'longLine' }, facts('long'),
      // C3: words that only look like the stand-in line are words; white space is nothing, silently
      aim, { paste: ' (3 board marks) ' }, { wait: 300 }, { read: LINE, as: 'lookalikeLine' }, facts('lookalike'),
      aim, { paste: '  \n\t ' }, { wait: 300 }, { read: LINE, as: 'blankLine' }, facts('blank'),
      // C3: control characters never become part of a mark
      aim, { paste: 'a\u001b[31mb\u0007c' }, { wait: 300 }, facts('control'),
      // C3: a mark an agent wrote with ESC and a bidi override: the copy puts neither on the clipboard
      { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${esc}', kind: 'text', x: 700, y: 20, z: 'zx', text: 'run\\u001b[2J \\u202Erm\\u200B -rf' } }], 'arky')), 1)`, as: 'r' }, { wait: 250 },
      sel([esc]), copy, { wait: 250 }, { await: CLIPTEXT, as: 'cleanCopy' },
      // C4: a copy whose words are over the limit goes under the stand-in line and still pastes back as clones
      { read: `(${B}.render(${D}.apply(${JSON.stringify(big)}, 'arky')), 1)`, as: 'r2' }, { wait: 250 },
      sel([981, 982, 983].map(fixtureId)), copy, { wait: 250 }, { await: CLIPTEXT, as: 'bigCopy' },
      pasteKey, { wait: 500 }, { read: EDITS, as: 'bigPaste' }, facts('end'),
    ]);
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.cmdD).toEqual([true, true]);
    expect(String(a.railLine)).toContain('Files can’t be dropped');
    refused(f('rail'), f('start'), [], 'a file dragged onto the rail');
    expect(String(a.dragLine)).toContain('Nothing can be dropped on a board');
    refused(f('drag'), f('rail'), ['drag:no-drop'], 'a text-only drag');
    expect(a.filePasteStopped).toBe(true);
    expect(String(a.filePasteLine)).toContain('Files can’t be pasted');
    refused(f('filePaste'), f('drag'), ['file:no-file-paste'], 'a pasted file');
    expect(String(a.htmlLine)).toBe('Only words can be pasted on a board · nothing was added');
    refused(f('html'), f('filePaste'), ['paste:no-plain-text'], 'a paste with no plain text');
    expect(String(a.longLine)).toContain('4,000');
    expect(String(a.longLine)).not.toContain('nothing was changed');
    refused(f('long'), f('html'), ['text:too-long'], 'a text over the limit');
    pastedAsText(f('lookalike'), f('long'), ' (3 board marks) ', 'words that look like the stand-in line');
    expect(String(a.lookalikeLine)).not.toContain('no longer held');
    refused(f('blank'), f('lookalike'), [], 'a paste of white space');
    expect(String(a.blankLine)).toContain('dimension in'); // nothing is said: the keep line stands
    contained(f('control'), 'a paste with control characters');
    expect(f('control').texts).toContain('abc');
    expect(a.cleanCopy).toBe('run ⟨RLO⟩rm -rf'); // no ESC, and the override is a visible glyph, never live
    expect(a.bigCopy).toBe(dimStandInLine(3));
    const back = (a.bigPaste as Edit[]).at(-1)!;
    expect(back.ops).toHaveLength(3);
    expect(back.ops.every((o) => o.type === 'add')).toBe(true);
    contained(f('end'), 'at the end');
  }, 180_000);
});
