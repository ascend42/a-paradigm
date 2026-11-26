/**
 * #gui-board S1.4 P4a, in a REAL engine (skipped on CI, run locally with GNOMON_BROWSER_TESTS=1 as the other
 * real-engine files): the three engine proofs Luna's record left pending (design author-seal
 * luna_final_s14.pending_engine_proof), Aegis's `line` conditions (S1.4 draft question 6), and the marked-up text
 * an agent draws staying literal text.
 *
 *  1. an agent's stroke, drawn as the engine's `line`, is dashed along its WHOLE length (every run of a polyline);
 *  2. an agent's frame has one edge, dashed on all four sides (patch frame-edge-dashed), at 25%, 100% and 400%;
 *  3. the screen floor (patch dash-screen-floor): at 25% the painted period is never under 7px.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { boardFixture, fixtureId } from '../src/preview/board-fixture.js';
import { planUndo } from '../src/core/dim-undo.js';

const SIZE = { width: 1440, height: 900 };
const B = 'globalThis.gnomonPreviewBoard';
const D = 'globalThis.gnomonPreviewDim';

/** In-page helpers: frames, an exact zoom (0.1 steps, then a ctrl-wheel for the rest), and the canvas's alpha along a run. */
const HELPERS = `
  const board = ${B};
  const frames = (n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });
  const settle = async () => { await frames(4); await new Promise((r) => setTimeout(r, 250)); await frames(2); };
  const zoomTo = async (z) => {
    board.zoomReset(); await settle();
    for (let i = 0; i < 40 && board.view().zoom - z > 0.1 - 1e-6; i++) { board.zoomOut(); await frames(2); }
    for (let i = 0; i < 40 && z - board.view().zoom > 0.1 - 1e-6; i++) { board.zoomIn(); await frames(2); }
    const rest = board.view().zoom - z;
    if (Math.abs(rest) > 1e-6) {
      const c = document.querySelector('#preview-board canvas.interactive') ?? document.querySelector('#preview-board canvas.static');
      const b = c.getBoundingClientRect();
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: rest * 100, ctrlKey: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true }));
    }
    await settle();
    return board.view().zoom;
  };
  /** pan (a plain wheel, which the engine reads as a scroll) until scene point (x, y) is at the middle of the view */
  const centreOn = async (x, y) => {
    for (let i = 0; i < 4; i++) {
      const v = board.view(); const sx = (x + v.scrollX) * v.zoom; const sy = (y + v.scrollY) * v.zoom;
      const dx = sx - v.width / 2; const dy = sy - v.height / 2;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
      const c = document.querySelector('#preview-board canvas.interactive') ?? canvas();
      const b = c.getBoundingClientRect();
      c.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true }));
      await settle();
    }
  };
  const canvas = () => document.querySelector('#preview-board canvas.static');
  const dpr = () => window.devicePixelRatio || 1;
  const scr = (x, y) => { const v = board.view(); return [(x + v.scrollX) * v.zoom, (y + v.scrollY) * v.zoom]; };
  /** max alpha across a 3px band square to the run, sampled every css px along a run from a to b (scene units) */
  const along = (a, b) => {
    const ctx = canvas().getContext('2d'); const k = dpr();
    const [x0, y0] = scr(a[0], a[1]); const [x1, y1] = scr(b[0], b[1]);
    const len = Math.hypot(x1 - x0, y1 - y0); const ux = (x1 - x0) / len; const uy = (y1 - y0) / len;
    const out = [];
    for (let t = 0; t <= len; t++) {
      let m = 0;
      for (let s = -1.5; s <= 1.5; s += 0.5) {
        const px = Math.round((x0 + ux * t - uy * s) * k); const py = Math.round((y0 + uy * t + ux * s) * k);
        if (px < 0 || py < 0 || px >= canvas().width || py >= canvas().height) { m = -1; break; }
        m = Math.max(m, ctx.getImageData(px, py, 1, 1).data[3]);
      }
      out.push(m);
    }
    return out;
  };
  /** on/off runs of a sampled run (cut 10px off each end, where caps and corners stand): gaps and periods in css px */
  const runs = (alpha) => {
    const xs = alpha.slice(10, -10).filter((v) => v >= 0);
    const gaps = []; let off = 0; let ons = 0; let on = false;
    for (const v of xs) {
      if (v < 60) { off++; if (on) { on = false; ons++; } }
      else { if (off > 0 && ons > 0) gaps.push(off); off = 0; on = true; }
    }
    return { n: xs.length, gaps: gaps.length, period: gaps.length ? xs.length / gaps.length : null };
  };
`;

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('#gui-board S1.4 P4a: an agent\'s hand in a real engine', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const scripted = async (body: string, theme: 'day' | 'night' = 'day'): Promise<Record<string, unknown>> =>
    ((await shootLeaf({ chrome, url: leafUrl(p.url, 'open', theme, 'empty'), ...SIZE, script: `${HELPERS}\n${body}` })) as { scripted: Record<string, unknown> }).scripted;

  it('PROOF 1: an agent\'s stroke is dashed along its whole length, every run of a polyline; the person\'s is solid', async () => {
    const r = await scripted(`
      const pts = [0, 0, 300, 0, 300, 200, 600, 200];
      const out = {};
      for (const hand of ['you', 'arky', null]) {
        board.render(globalThis.gnomonPreviewState([{ hand, marks: [{ kind: 'stroke', x: 100, y: 150, points: pts }] }]));
        await zoomTo(1);
        out[hand ?? 'unknown'] = [runs(along([100, 150], [400, 150])), runs(along([400, 150], [400, 350])), runs(along([400, 350], [700, 350]))];
      }
      return out;`);
    const per = r as Record<string, Array<{ n: number; gaps: number; period: number | null }>>;
    for (const seg of per.you!) expect(seg.gaps, 'the person\'s stroke is solid').toBe(0);
    for (const hand of ['arky', 'unknown']) {
      for (const seg of per[hand]!) {
        // fine weight: 4 on, 6 off in board units, a period of 10 at 100%; every run is dashed, not only the first
        expect(seg.gaps, `${hand}: gaps along a run of ${seg.n}px`).toBeGreaterThanOrEqual(Math.floor(seg.n / 10) - 2);
        expect(seg.period!, hand).toBeGreaterThan(8.5);
        expect(seg.period!, hand).toBeLessThan(11.5);
      }
    }
  }, 120_000);

  it('PROOF 2: an agent\'s frame has one edge, dashed on all four sides at 25%, 100% and 400%; the person\'s is solid', async () => {
    const r = await scripted(`
      const out = {};
      for (const hand of ['you', 'arky']) {
        for (const z of [0.25, 1, 4]) {
          // the frame fits the 790 by 445 leaf at each zoom: 400 by 280 at 25% and 100%, 160 by 90 at 400%
          const [w, hh] = z === 4 ? [160, 90] : [400, 280];
          const fx = 600, fy = 330;
          board.render(globalThis.gnomonPreviewState([{ hand, marks: [{ kind: 'frame', x: fx, y: fy, w, h: hh, title: 'plan' }] }]));
          const got = await zoomTo(z);
          await centreOn(fx + w / 2, fy + hh / 2);
          const sides = { top: along([fx, fy], [fx + w, fy]), right: along([fx + w, fy], [fx + w, fy + hh]), bottom: along([fx + w, fy + hh], [fx, fy + hh]), left: along([fx, fy + hh], [fx, fy]) };
          out[hand + '@' + z] = { zoom: got, ...Object.fromEntries(Object.entries(sides).map(([k, v]) => [k, runs(v)])) };
        }
      }
      return out;`);
    for (const [key, row] of Object.entries(r as Record<string, Record<string, { n: number; gaps: number } | number>>)) {
      const [hand, z] = key.split('@');
      expect(Math.abs((row.zoom as number) - Number(z)), `${key} reached its zoom`).toBeLessThan(0.011);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const s = row[side] as { n: number; gaps: number };
        if (hand === 'you') expect(s.gaps, `${key} ${side}`).toBe(0);
        // 6 on, 4 off on the SCREEN at every zoom: a period of 10px
        else expect(s.gaps, `${key} ${side} (${s.n}px)`).toBeGreaterThanOrEqual(Math.max(1, Math.floor(s.n / 10) - 2));
      }
      // the frame panned to the middle of the view: all four sides in view and long enough to count, at every zoom
      for (const k of ['top', 'right', 'bottom', 'left']) expect((row[k] as { n: number }).n, `${key} ${k} in view`).toBeGreaterThanOrEqual(z === '0.25' ? 40 : 200);
    }

  }, 180_000);

  it('PROOF 3: the screen floor: at 25% an agent stroke\'s dash keeps a period of 7px or more on the screen (unfloored it is 2.5px and closes)', async () => {
    const r = await scripted(`
      board.render(globalThis.gnomonPreviewState([{ hand: 'arky', marks: [{ kind: 'stroke', x: 100, y: 150, points: [0, 0, 1200, 0] }, { kind: 'rect', x: 100, y: 300, w: 1200, h: 400 }] }]));
      const out = {};
      for (const z of [0.25, 0.49, 1]) { const got = await zoomTo(z); out[z] = { zoom: got, line: runs(along([100, 150], [1300, 150])), rect: runs(along([100, 300], [1300, 300])) }; }
      return out;`);
    const at = r as Record<string, { zoom: number; line: { n: number; gaps: number; period: number }; rect: { n: number; gaps: number; period: number } }>;
    for (const z of ['0.25', '0.49']) {
      for (const k of ['line', 'rect'] as const) {
        expect(at[z]![k].gaps, `${z} ${k} is still dashed`).toBeGreaterThanOrEqual(Math.floor(at[z]![k].n / 10));
        expect(at[z]![k].period, `${z} ${k}`).toBeGreaterThanOrEqual(6.5);
      }
    }
    // at 100% the floor does nothing: the board-unit period of 10 (measured on the rect's top edge)
    expect(at['1']!.rect.period).toBeGreaterThan(8.5);
    expect(at['1']!.rect.period).toBeLessThan(11.5);
  }, 120_000);

  it('Aegis: no new node ever comes from a `line`: the l key, an alt-drag duplicate of an agent stroke, engine clipboard JSON holding a line, an undo that restores one', async () => {
    const S = fixtureId(940);
    const json = JSON.stringify({ type: 'excalidraw/clipboard', elements: [{ id: 'pasted-line', type: 'line', x: 10, y: 10, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeStyle: 'dashed', strokeColor: '#000', strokeWidth: 2, version: 1 }], files: {} });
    // the inverse the app's undo (core/dim-undo.ts planUndo, wired in DimLive; the preview leaf only records the key)
    // makes of the person's delete of the agent's stroke
    const fx = boardFixture('empty');
    const before = fx.apply([{ type: 'add', node: { id: S, kind: 'stroke', x: 200, y: 200, z: 'za', points: [0, 0, 300, 0] } } as never], 'arky');
    const after = fx.apply([{ type: 'delete', id: S }], 'you');
    const plan = planUndo({ before, rows: [[{ type: 'delete', id: S }]], current: after, actor: { cls: 'human', principal: 'p:preview/matt' }, mint: () => fixtureId(941) }) as { ok: boolean; ops?: unknown[] };
    expect(plan.ok).toBe(true);
    const lines = `${B}.marks().filter((m) => !m.labelOf && m.kind === 'stroke').map((m) => m.author.cls + (m.node ? '' : ':new')).sort().join(' ')`;
    const adds = `${D}.edits.flatMap((e) => e.ops).filter((o) => o.type === 'add').map((o) => o.node.kind)`;
    const acted = ((await shootLeaf({
      chrome, url: leafUrl(p.url, 'open', 'day', 'empty'), ...SIZE,
      actions: [
        { read: "(globalThis.__said = [], globalThis.gnomonPreviewBoard.onRefusal((r) => __said.push(r.what + ':' + r.why + ':' + (r.detail ?? ''))), 1)", as: 'l0' },
        { read: `(${B}.render(${D}.apply([{ type: 'add', node: { id: '${S}', kind: 'stroke', x: 200, y: 200, z: 'za', points: [0, 0, 300, 0] } }], 'arky')), 1)`, as: 'r' }, { wait: 300 },
        // the l key, then a drag on the empty desk
        { at: [700, 600], press: true }, { key: 'l' }, { drag: [[700, 500], [760, 520], [820, 540]] }, { wait: 250 },
        { read: lines, as: 'afterL' }, { read: adds, as: 'addsAfterL' },
        // an alt-drag of the agent stroke
        { press: '#preview-board [data-key="tool:select"]' }, { drag: [[350, 200], [370, 240], [390, 280]], alt: true }, { wait: 250 },
        { read: lines, as: 'afterAlt' }, { read: adds, as: 'addsAfterAlt' },
        // engine clipboard JSON with a line in it, pasted for real: it is words at most, never a line
        { at: [700, 650], press: true }, { paste: json }, { wait: 300 },
        { read: lines, as: 'afterPaste' }, { read: `${D}.edits.flatMap((e) => e.ops).filter((o) => o.type === 'add').map((o) => o.node.kind + ':' + (o.node.kind === 'text' ? o.node.text.startsWith('{') : ''))`, as: 'addsAfterPaste' },
        // delete the agent stroke, then undo: the host re-adds it as the person's (dim-undo, stated); never a line without its agent
        { read: `(${B}.select(['${S}']), 1)`, as: 'sel' }, { wait: 250 }, { read: `(${B}.focus(), ${B}.state().selected)`, as: 'selected' },
        { key: 'Delete' }, { wait: 300 }, { read: lines, as: 'afterDelete' }, { read: `[...${D}.state().nodes.values()].filter((n) => n.node.kind === 'stroke').map((n) => n.by.cls).join(' ')`, as: 'foldAfterDelete' }, { key: 'z', meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' }, { wait: 400 },
        // (Aegis) the engine's own history is inert: after Delete and the undo key, BEFORE any re-render, no line is
        // live in the engine and no add was sent; and a bare z (no chord) changes nothing either
        { read: lines, as: 'beforeRerender' }, { read: `${D}.edits.flatMap((e) => e.ops).filter((o) => o.type === 'add').length`, as: 'addsBeforeRerender' },
        { read: `${B}.marks().length`, as: 'marksBeforeRerender' },
        { key: 'z' }, { wait: 300 }, { read: lines, as: 'afterBareZ' }, { read: `${D}.edits.flatMap((e) => e.ops).filter((o) => o.type === 'add').length`, as: 'addsAfterBareZ' },
        { read: `${D}.undoKeys ? ${D}.undoKeys.length : globalThis.gnomonPreviewDim.undoKeys?.length ?? -1`, as: 'undoKeys' },
        // the undo's ops, applied as the person's (as the app's sender does), and rendered
        { read: `(${B}.render(${D}.apply(${JSON.stringify(plan.ops)}, 'you')), 1)`, as: 'undone' }, { wait: 300 },
        { read: lines, as: 'afterUndo' }, { read: `[...${D}.state().nodes.values()].filter((n) => n.node.kind === 'stroke').map((n) => n.by.cls).join(' ')`, as: 'foldAfterUndo' },
        { read: `${B}.marks().filter((m) => !m.labelOf && m.kind === 'stroke').map((m) => m.node === '${S}')`, as: 'sameIdAfterUndo' }, { read: 'globalThis.__said', as: 'said' }, { read: `${B}.drift()`, as: 'drift' },
      ],
    })) as { acted: Record<string, unknown> }).acted;
    // the l key draws nothing that stays, and nothing is added
    expect(acted.afterL).toBe('agent');
    expect(acted.addsAfterL).toEqual([]);
    // the alt-drag moves (or leaves) the one stroke: no duplicate
    expect(acted.afterAlt).toBe('agent');
    expect(acted.addsAfterAlt).toEqual([]);
    // the pasted JSON is at most one literal text node: never a stroke
    expect(acted.afterPaste).toBe('agent');
    for (const a of acted.addsAfterPaste as string[]) expect(a).toBe('text:true');
    // after the undo: no agent line stands without its node; a restored stroke is the person's, so freehand and solid
    // the delete really took the agent's stroke (selected by id through the handle)
    expect(acted.selected).toBe(1);
    expect(acted.afterDelete).toBe('');
    expect(acted.foldAfterDelete).toBe('');
    expect(acted.beforeRerender).toBe('');
    expect(acted.addsBeforeRerender).toBe(0);
    expect(acted.marksBeforeRerender).toBe(0);
    expect(acted.afterBareZ).toBe('');
    expect(acted.addsAfterBareZ).toBe(0);
    // TODAY's dim-undo re-adds it under a NEW id as the person's: a freehand, solid stroke, never a line without its
    // agent. Pass E0 (contracts) changes the shared undo planner so a re-add keeps its original hand: when it lands,
    // this becomes 'agent' (a dashed line again) and the new-id check stays
    expect(acted.afterUndo).toBe('human');
    expect(acted.foldAfterUndo).toBe('human');
    expect(acted.sameIdAfterUndo).toEqual([false]);
    expect((acted.said as string[]).filter((x) => !x.endsWith(':line'))).toEqual([]);
    expect(acted.drift).toEqual([]);
  }, 120_000);

  it('marked-up text an agent draws (HTML, Markdown, SVG source) stays literal text: the engine holds the same characters and draws no image', async () => {
    const texts = ['<b>bold</b> <img src=x onerror=alert(1)>', '# Title\n**strong** [link](https://example.com)', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="9" height="9"/></svg>'];
    const r = await scripted(`
      globalThis.__alerted = 0; window.alert = () => { globalThis.__alerted++; };
      const texts = ${JSON.stringify(texts)};
      const D = globalThis.gnomonPreviewDim;
      board.render(D.apply(texts.map((text, i) => ({ type: 'add', node: { id: ${JSON.stringify(fixtureId(950).slice(0, -2))} + String(10 + i), kind: 'text', x: 100, y: 100 + i * 120, z: 'z' + i, text } })), 'arky'));
      await settle();
      const marks = board.marks().filter((m) => !m.labelOf);
      return {
        kinds: marks.map((m) => m.kind + ':' + m.author.cls),
        images: document.querySelectorAll('#preview-board img, #preview-board svg image, #preview-board .excalidraw svg rect').length,
        boxes: document.querySelectorAll('#preview-board .bd-over .bd-textbox').length,
        alerted: globalThis.__alerted,
        texts: [...D.state().nodes.values()].map((n) => n.node.text),
        canvasText: (() => { const c = document.querySelector('#preview-board canvas.static'); return c.width > 0; })(),
      };`);
    expect(r.kinds).toEqual(['text:agent', 'text:agent', 'text:agent']);
    expect(r.texts).toEqual(texts);
    expect(r.images).toBe(0);
    expect(r.boxes).toBe(3);
    expect(r.alerted).toBe(0);
  }, 120_000);
});
