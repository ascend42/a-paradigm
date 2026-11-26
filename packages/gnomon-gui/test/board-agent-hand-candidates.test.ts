/**
 * #gui-board S1.4 P4a CANDIDATE goldens for Mika (design author-seal; rule small-hand-is-a-ring). Rendered only with
 * GNOMON_P4A_CANDIDATES=1, into test/goldens/candidates/p4a/, never over a committed golden. Nothing here asserts a
 * picture: Mika looks at them first, then they are promoted (or not) in a later pass.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'goldens', 'candidates', 'p4a');
const SIZE = { width: 1440, height: 900 };
const B = 'globalThis.gnomonPreviewBoard';
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
/** each case: the marks (all the agent's unless said), the zoom, and the scene point to centre */
const CASES: Record<string, { marks: unknown[]; zoom: number; at: [number, number] }> = {};
for (const z of [0.25, 1, 4]) {
  CASES[`stroke-${z * 100}`] = { marks: [{ hand: 'arky', marks: [{ kind: 'stroke', x: 600, y: 400, points: [0, 0, 40, -20, 80, 10, 120, -10], weight: 2 }] }], zoom: z, at: [660, 400] };
  CASES[`frame-${z * 100}`] = { marks: [{ hand: 'arky', marks: [{ kind: 'frame', x: 600, y: 330, w: z === 4 ? 160 : 400, h: z === 4 ? 90 : 280, title: 'plan' }] }], zoom: z, at: z === 4 ? [680, 375] : [800, 470] };
  CASES[`text-${z * 100}`] = { marks: [{ hand: 'arky', marks: [{ kind: 'text', x: 600, y: 400, text: 'the agent wrote this' }] }], zoom: z, at: [680, 410] };
}
const MIX = [{ hand: 'arky', marks: [{ kind: 'rect', x: 500, y: 350, w: 120, h: 70, label: 'store', fill: 'lemon' }, { kind: 'rect', x: 660, y: 350, w: 100, h: 60 }, { kind: 'arrow', x: 560, y: 430, points: [0, 0, 160, 40] }, { kind: 'text', x: 500, y: 500, text: 'agent words' }] }, { hand: null, marks: [{ kind: 'ellipse', x: 800, y: 350, w: 80, h: 60 }] }, { hand: 'you', marks: [{ kind: 'rect', x: 800, y: 450, w: 100, h: 60, label: 'mine', fill: 'sky' }] }];
for (const z of [0.49, 0.5]) CASES[`mix-${Math.round(z * 100)}`] = { marks: MIX, zoom: z, at: [700, 430] };
// the 4px letter boundary: 13.5 x 0.73 x zoom crosses 4 at about 40.6%
for (const z of [0.4, 0.41]) CASES[`text-boundary-${Math.round(z * 100)}`] = { marks: [{ hand: 'arky', marks: [{ kind: 'text', x: 600, y: 400, text: 'letters at the boundary' }] }], zoom: z, at: [680, 410] };
CASES['box-14px-100'] = { marks: [{ hand: 'arky', marks: [{ kind: 'rect', x: 640, y: 380, w: 40, h: 14 }] }], zoom: 1, at: [660, 387] };
CASES['marker-under-80-100'] = { marks: [{ hand: 'arky', marks: [{ kind: 'stroke', x: 620, y: 400, points: [0, 0, 70, 0], weight: 3 }] }], zoom: 1, at: [655, 400] };
CASES['box-20x10-25'] = { marks: [{ hand: 'arky', marks: [{ kind: 'rect', x: 640, y: 380, w: 20, h: 10 }] }], zoom: 0.25, at: [650, 385] };

const chrome = findChrome() as string | null;
describe.skipIf(!process.env.GNOMON_P4A_CANDIDATES || !chrome)('#gui-board S1.4 P4a candidate goldens (for Mika; not a check)', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
    mkdirSync(OUT, { recursive: true });
  }, 60_000);
  afterAll(() => p.close());
  it.each(Object.keys(CASES).flatMap((k) => (['day', 'night'] as const).map((t) => [k, t] as const)))('%s %s', async (name, theme) => {
    const c = CASES[name]!;
    const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'open', theme, 'empty'), ...SIZE, script: `${HELPERS}
      board.render(globalThis.gnomonPreviewState(${JSON.stringify(c.marks)}));
      const got = await zoomTo(${c.zoom});
      await centreOn(${c.at[0]}, ${c.at[1]});
      return { zoom: got };` })) as { png: Buffer; scripted: { zoom: number } };
    expect(Math.abs(r.scripted.zoom - c.zoom)).toBeLessThan(0.011);
    writeFileSync(path.join(OUT, `agent-${name}-${theme}.png`), r.png);
  }, 120_000);
});
