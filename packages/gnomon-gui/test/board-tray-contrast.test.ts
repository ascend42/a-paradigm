/**
 * The content tray and the contrast rule in a REAL Chrome (dev preview fixture; scripts/board-leaf-shots.mjs: real
 * pointer and keys over the DevTools protocol). Mika's P0b review: S1 (a held style the next tool would refuse is
 * said before the first mark, so typed words are never lost), S3 and C1 (both roles' reasons, each with its role and
 * its own key), P1 (at a 303px leaf the tray with a refusal stays inside the stage and its keys can be pressed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyDimState, validateDimOps, type DimOp } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';
import { fixtureId } from '../src/preview/board-fixture.js';

const B = 'globalThis.gnomonPreviewBoard';
const D = 'globalThis.gnomonPreviewDim';
const TOOL = `${B}.state().tool`;
const ACTIVE = "document.activeElement ? (document.activeElement.getAttribute('data-key') || (document.activeElement.closest('.bd-board') ? 'board' : document.activeElement.tagName.toLowerCase())) : null";
const TRAY_OPEN = "!document.querySelector('#preview-board .bd-tray').hidden";
const REFUSALS = "[...document.querySelectorAll('#preview-board .bd-tray .bd-refuse')].map((n) => n.textContent)";
const KEYS = "[...document.querySelectorAll('#preview-board .bd-tray [data-key^=\"offer:\"], #preview-board .bd-tray [data-key^=\"held:\"]')].map((n) => n.getAttribute('data-key') + '=' + n.textContent)";
const ERRORS = { read: "(globalThis.__errs = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), 1)", as: 'listening' };
const typed = (s: string): unknown[] => [...s].map((ch) => ({ key: ch, text: ch }));
/** every tray key that offers a colour: inside the stage, inside the tray's visible box, and the topmost thing under its centre once focused */
const REACH = `(() => { const tray = document.querySelector('#preview-board .bd-tray'); const stage = tray.parentElement.getBoundingClientRect(); const out = { trayInStage: tray.getBoundingClientRect().bottom <= stage.bottom + 0.5, keys: [] };
  for (const k of tray.querySelectorAll('[data-key^="offer:"], [data-key^="held:"]')) { k.focus(); const r = k.getBoundingClientRect(); const t = tray.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.keys.push({ key: k.getAttribute('data-key'), inStage: r.top >= stage.top - 0.5 && r.bottom <= stage.bottom + 0.5, inTray: r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5, pressable: top === k || k.contains(top) }); }
  return out; })()`;
type Acted = Record<string, unknown>;

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('#gui-board the tray and the contrast rule, in a real Chrome', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], size = { width: 1440, height: 900 }): Promise<Acted> => ((await shootLeaf({ chrome, url: leafUrl(p.url, 'open', 'day'), ...size, timeoutMs: 120_000, actions })) as { acted: Acted }).acted;

  it('S1 (REAL pointer and keys): a line that passes under select and fails as words waits at the text tool; the tray says why, its key applies a passing colour, and the typed words are kept', async () => {
    const acted = await real([
      ERRORS,
      { press: '#preview-board [data-key="ink"]' },
      { press: '#preview-board [data-key="hex"]' }, ...typed('767676'),
      { press: '#preview-board [data-key="custom:line"]' }, { read: `${B}.state().style.line`, as: 'held' },
      { press: '#preview-board [data-key="tool:text"]' }, { wait: 100 },
      { read: TOOL, as: 'toolWhileRefused' }, { read: TRAY_OPEN, as: 'trayOpen' }, { read: REFUSALS, as: 'said' }, { read: KEYS, as: 'keys' }, { read: ACTIVE, as: 'focus' },
      { press: '#preview-board [data-key="held:line"]' }, { wait: 100 },
      { read: `${B}.state().style.line`, as: 'chosen' }, { read: TOOL, as: 'toolAfter' },
      { read: `(${D}.edits.length = 0, 1)`, as: 'cleared' },
      { at: [520, 300], press: true, settle: 250 }, ...typed('kept'), { key: 'Escape' }, { wait: 500 },
      { read: `JSON.stringify(${D}.edits.flatMap((e) => e.ops))`, as: 'ops' },
      { read: 'globalThis.__errs', as: 'errors' },
    ]);
    expect(acted).toMatchObject({ held: 'custom:#767676', toolWhileRefused: 'select', trayOpen: true, focus: 'held:line', chosen: 'graphite', toolAfter: 'text', errors: [] });
    // the held line's refusal is said with its role and key (the typed hex, still in the field, is judged as a fill too)
    expect(acted.said).toContain('✕ not used as a line · too faint to read as words');
    expect(acted.keys).toContain('held:line=Use graphite as the line');
    const ops = JSON.parse(acted.ops as string) as DimOp[];
    const words = ops.filter((o) => o.type === 'add' && (o.node as { kind?: string }).kind === 'text');
    expect(words.map((o) => (o as { node: { text: string } }).node.text)).toEqual(['kept']);
    // what was reported is what the host keeps: the validator refuses nothing of it
    expect(validateDimOps(emptyDimState(), words, { cls: 'human', principal: 'p:me/human' }).refused).toEqual([]);
  }, 120_000);

  it('S2 (REAL keys): with a filled mark selected the tray judges a typed line against that mark\'s fill, and the fill row shows the mark\'s fill', async () => {
    const acted = await real([
      ERRORS,
      { read: `(${B}.select(['${fixtureId(6)}']), 1)`, as: 'select' }, { wait: 300 },
      { read: `${B}.marks().filter((m) => m.selected && !m.labelOf).map((m) => m.kind + ':' + m.fill).join() + '|' + ${B}.marks().filter((m) => m.node === '${fixtureId(6)}').map((m) => m.kind).join()`, as: 'selected' },
      { press: '#preview-board [data-key="ink"]' },
      { read: "document.querySelector('#preview-board .bd-tray [role=radiogroup][aria-label=fill] .bd-wn').textContent", as: 'fillShown' },
      { press: '#preview-board [data-key="hex"]' }, ...typed('0088BB'), { wait: 100 },
      { read: REFUSALS, as: 'said' }, { read: KEYS, as: 'keys' },
      { read: 'globalThis.__errs', as: 'errors' },
    ]);
    const fill = String(acted.selected).split('|')[0]!.split(':')[1];
    expect(acted.selected).toMatch(/^sticky:/);
    expect(acted.fillShown).toBe(fill);
    expect(acted.said).toContain("✕ not used as a line · it would not show against this mark's fill");
    expect(acted.keys).toContain('offer:line=Use ink as the line');
    expect(acted.errors).toEqual([]);
  }, 120_000);

  for (const size of [{ width: 1024, height: 768 }, { width: 1280, height: 640 }]) {
    it(`S3, C1, P1 at ${size.width}x${size.height} with a 303px leaf: both roles' reasons, each with its role and key; the tray stays in the stage and every key can be pressed`, async () => {
      const acted = await real([
        ERRORS,
        { read: "(document.getElementById('preview-board').style.width = '303px', 1)", as: 'narrow' }, { wait: 200 },
        { press: '#preview-board [data-key="ink"]' },
        { press: '#preview-board [data-key="line:graphite"]' },
        { key: 'r' }, { read: TOOL, as: 'tool' },
        { press: '#preview-board [data-key="hex"]' }, ...typed('00B4F5'), { wait: 100 },
        { read: REFUSALS, as: 'said' }, { read: KEYS, as: 'keys' }, { read: REACH, as: 'reach' },
        { read: 'globalThis.__errs', as: 'errors' },
      ], size);
      expect(acted.tool).toBe('rect');
      expect(acted.said).toEqual(['✕ not used as a line · too faint to see on the board', '✕ not used as a fill · the chosen line would not show against it at night']);
      expect(acted.keys).toEqual(['offer:line=Use sky as the line', 'offer:fill=Use paper as the fill']);
      const reach = acted.reach as { trayInStage: boolean; keys: Array<{ key: string; inStage: boolean; inTray: boolean; pressable: boolean }> };
      expect(reach.trayInStage).toBe(true);
      for (const k of reach.keys) expect(k).toEqual({ key: k.key, inStage: true, inTray: true, pressable: true });
      expect(acted.errors).toEqual([]);
    }, 120_000);
  }
});
