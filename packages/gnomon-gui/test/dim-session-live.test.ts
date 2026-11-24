/**
 * #gui-dim-session in a REAL engine (boards S1.3 pass P4a): the dev preview's `?board=live` fixture in a real
 * Chrome, driven with real pointer, key and clipboard input over the DevTools protocol (a frame between pointer
 * moves). The loop under test is the real one end to end EXCEPT the kernel: the page's own GnomonClient, followLog,
 * DimSessions, DimStore, DimLive, the one sender with stamps minted from the engine's trusted events, the board
 * handle and the leaf, over the preview's fake kernel, which answers with the dimension mod's real checks and fold
 * (src/preview/dim-mod.ts). The real kernel and mod are driven by packages/gnomon/test/dimension-dogfood.test.ts.
 * Runs where a Chrome is installed, never on CI; run it ALONE (a loaded machine times it out).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { FIXTURE_DIM } from '../src/preview/board-fixture.js';

const SIZE = { width: 1440, height: 900 };
const B = 'globalThis.gnomonPreviewBoard';
const L = 'globalThis.gnomonPreviewLive';
const DIM = `'${FIXTURE_DIM}'`;
const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), 1)", as: 'listening' };
/** what the loop holds now: the session's status, the store's fold against the mod's, and the board against the fold */
const FACTS = `(() => { const s = ${L}.session; const st = s.status(); const rows = ${L}.dims.rows(${DIM}); return { keep: st.keep, link: st.link, pending: st.pending, canUndo: st.canUndo, nodes: s.view().nodes.size, rows: rows.length, lastOps: rows[rows.length - 1].payload.ops ? rows[rows.length - 1].payload.ops.map((o) => o.type) : null, sameAsMod: s.hash() === ${L}.mod.hash(${DIM}), stored: ${B}.isAlive() ? ${B}.marks().filter((m) => !m.labelOf).every((m) => m.node !== null) : null, drift: ${B}.isAlive() ? ${B}.drift().length : null, marks: ${B}.isAlive() ? ${B}.marks().filter((m) => !m.labelOf).length : null, selected: ${B}.isAlive() ? ${B}.state().selected : null, notices: ${L}.notices.map((n) => n.about + ':' + n.code), line: document.querySelector('#preview-board .bd-keep').textContent }; })()`;
const facts = (as: string) => ({ read: FACTS, as });
const SHOTS = process.env.GNOMON_SHOTS_DIR ?? '';
const keep = (name: string, png: Buffer): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `s14a-${name}.png`), png);
};
type Facts = { keep: string; link: string; pending: number; canUndo: boolean; nodes: number; rows: number; lastOps: string[] | null; sameAsMod: boolean; stored: boolean | null; drift: number | null; marks: number | null; selected: number | null; notices: string[]; line: string };

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('the live loop on a real engine: draw, confirm, refuse, undo, paste, link', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], marks: string | null = null, shot: string | null = null): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'live', 'day', marks), ...SIZE, timeoutMs: 60_000, actions: [ERRORS, ...actions, { read: 'globalThis.__errs', as: 'errors' }] })) as { png: Buffer; acted: Record<string, unknown> };
    if (shot) keep(shot, r.png);
    return r.acted;
  };
  const drawRect = [{ press: '#preview-board [data-key="tool:rect"]' }, { drag: [[450, 300], [500, 330], [550, 360]] }, { wait: 400 }];

  it('a drawn mark is shown at once, sent on a stamp from its own pointer-up, and persists through the row round trip; Cmd+Z then undoes it', async () => {
    const a = await real([facts('start'), ...drawRect, facts('drawn'), { key: 'z', meta: true }, { wait: 400 }, facts('undone'), { key: 'z', meta: true, shift: true }, { wait: 200 }, facts('redo')], null, 'live-drawn-undone');
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('start')).toMatchObject({ keep: 'saved', link: 'up', pending: 0, canUndo: false, sameAsMod: true, drift: 0, notices: [] });
    // the mark is in the log as a row of mine, the board holds it under its node id, and the fold is the mod's
    expect(f('drawn')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: f('start').nodes + 1, rows: f('start').rows + 1, lastOps: ['add'], sameAsMod: true, stored: true, drift: 0, notices: [] });
    // Cmd+Z: the inverse went through the same path as a row, and the mark is gone from the board
    expect(f('undone')).toMatchObject({ keep: 'saved', pending: 0, canUndo: false, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows + 2, lastOps: ['delete'], sameAsMod: true, drift: 0, notices: [] });
    // redo is not built: it is said, never sent
    expect(f('redo')).toMatchObject({ rows: f('start').rows + 2, notices: ['undo:redo-unavailable'], line: 'Redo isn’t on the board yet' });
  }, 120_000);

  it('an edit the mod refuses is put back on the board and the leaf says so in one line', async () => {
    const a = await real([facts('start'), { read: `(${L}.mod.refuseNext = 'ops-refused', 1)`, as: 'armed' }, ...drawRect, facts('refused'), { wait: 100 }], null, 'live-refused-line');
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(f('refused')).toMatchObject({ keep: 'saved', pending: 0, canUndo: false, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows, sameAsMod: true, drift: 0, notices: ['edit:id-missing'], line: 'That change wasn’t kept · the board is as it was' });
  }, 120_000);

  it('a copy of 64 marks pasted back is 64 clones over several rows, selected; ONE Cmd+Z takes them all', async () => {
    const a = await real(
      [
        facts('start'),
        // a marquee over the whole grid, a real copy, a real paste
        { drag: [[8, 8], [200, 150], [440, 306]] }, { read: `${B}.state().selected`, as: 'picked' },
        { key: 'c', meta: true, commands: ['copy'] }, { wait: 150 },
        { key: 'v', meta: true, commands: ['paste'] }, { wait: 1500 }, facts('pasted'),
        { read: `${L}.dims.rows(${DIM}).slice(-3).map((r) => r.payload.ops.length)`, as: 'tail' },
        { key: 'z', meta: true }, { wait: 800 }, facts('undone'),
      ],
      'many',
      'live-paste-64',
    );
    const f = (k: string): Facts => a[k] as Facts;
    expect(a.errors).toEqual([]);
    expect(a.picked).toBe(64);
    const rows = f('pasted').rows - f('start').rows;
    expect(rows).toBeGreaterThan(1); // too heavy for one row
    expect(rows).toBeLessThanOrEqual(4);
    expect(f('pasted')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: 128, selected: 64, sameAsMod: true, stored: true, notices: [] });
    expect(f('undone')).toMatchObject({ keep: 'saved', pending: 0, nodes: 64, rows: f('pasted').rows + 1, sameAsMod: true, notices: [] });
    expect(f('undone').lastOps).toEqual(Array(64).fill('delete'));
  }, 120_000);

  it('link down: an edit is put back and said; link up: a new session and a new leaf, and a drawn mark persists again', async () => {
    const down = await real([facts('start'), { read: `(${L}.down(), 1)`, as: 'd' }, { wait: 300 }, facts('down'), ...drawRect, facts('edit'), { read: `${L}.leaf.el.isConnected`, as: 'leafStays' }], null, 'live-link-down');
    const f = (k: string): Facts => down[k] as Facts;
    expect(down.errors).toEqual([]);
    expect(f('down')).toMatchObject({ link: 'down', notices: ['link:link-down'], line: 'Not saved · reconnecting' });
    expect(f('edit')).toMatchObject({ link: 'down', pending: 0, nodes: f('start').nodes, marks: f('start').marks, rows: f('start').rows, notices: ['link:link-down', 'edit:link-down'], line: 'The link is down · that change wasn’t saved' });
    expect(down.leafStays).toBe(true);
    const up = await real([
      facts('start'),
      { read: `(globalThis.__old = { session: ${L}.session, leaf: ${L}.leaf }, ${L}.down(), 1)`, as: 'd' }, { wait: 300 },
      { await: `${L}.up().then(() => new Promise((r) => setTimeout(r, 1500))).then(() => 1)`, as: 'upped' },
      { read: `({ newSession: ${L}.session !== globalThis.__old.session, oldDead: !globalThis.__old.session.alive, oldLeafGone: !globalThis.__old.leaf.el.isConnected, newLeaf: ${L}.leaf !== globalThis.__old.leaf && ${L}.leaf.el.isConnected, leaves: document.querySelectorAll('#preview-board .bd-leaf').length })`, as: 'rebuilt' },
      facts('back'), ...drawRect, facts('drawn'),
    ], null, 'live-link-up');
    const g = (k: string): Facts => up[k] as Facts;
    expect(up.errors).toEqual([]);
    expect(up.rebuilt).toEqual({ newSession: true, oldDead: true, oldLeafGone: true, newLeaf: true, leaves: 1 });
    expect(g('back')).toMatchObject({ link: 'up', keep: 'saved', canUndo: false, nodes: g('start').nodes, sameAsMod: true, drift: 0 });
    expect(g('drawn')).toMatchObject({ keep: 'saved', pending: 0, canUndo: true, nodes: g('start').nodes + 1, rows: g('start').rows + 1, sameAsMod: true, stored: true });
  }, 180_000);
});
