/**
 * Boards S1.1 item 0a: the vertical metrics the engine places board text by are READ from the bundled face, never
 * remembered. scripts/board-font.mjs parses the WOFF2 tables; the `font-metrics` patch is built from
 * BOARD_FONT_METRICS; this test fails when the two disagree, and when the patch text or the shipped chunk carry
 * anything else.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { embeddedBundle } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { woff2Metrics, woff2Tables } from '../scripts/board-font.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { BOARD_FONT_METRICS, boardLineHeight, PATCHES } from '../scripts/board-patches.mjs';

const FONTS = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'static', 'fonts');
const font = (name: string): Buffer => readFileSync(path.join(FONTS, name));

describe('#gui-board font metrics come from the font file', () => {
  const measured = woff2Metrics(font('JetBrainsMono-Regular.woff2')) as { unitsPerEm: number; ascender: number; descender: number; lineGap: number; os2: { typoAscender: number; typoDescender: number; typoLineGap: number; winAscent: number; winDescent: number; useTypoMetrics: boolean } | null };

  it('BOARD_FONT_METRICS is what head and hhea of JetBrainsMono-Regular.woff2 say', () => {
    expect({ unitsPerEm: measured.unitsPerEm, ascender: measured.ascender, descender: measured.descender, lineGap: measured.lineGap }).toEqual({ ...BOARD_FONT_METRICS });
    // every platform reads the same numbers from this face: hhea, OS/2 typo and OS/2 win agree
    expect(measured.os2).toEqual({ typoAscender: measured.ascender, typoDescender: measured.descender, typoLineGap: measured.lineGap, winAscent: measured.ascender, winDescent: -measured.descender, useTypoMetrics: true });
  });

  it('the font-metrics patch writes exactly those numbers, and the line is the face\'s own', () => {
    const patch = (PATCHES as Array<{ id: string; replace: string }>).find((p) => p.id === 'font-metrics')!;
    const m = /unitsPerEm:(-?[\d.e]+),ascender:(-?[\d.]+),descender:(-?[\d.]+),lineHeight:(-?[\d.]+)/.exec(patch.replace)!;
    expect(m.slice(1).map(Number)).toEqual([measured.unitsPerEm, measured.ascender, measured.descender, (measured.ascender - measured.descender + measured.lineGap) / measured.unitsPerEm]);
    expect(boardLineHeight(BOARD_FONT_METRICS)).toBe(1.32);
  });

  it('the shipped chunk carries them', () => {
    const js = (embeddedBundle() as Map<string, Buffer>).get('board/board.js')!.toString('utf8');
    expect(js).toMatch(/\{metrics:\{unitsPerEm:1e3,ascender:1020,descender:-300,lineHeight:1\.32\}\}/);
  });

  it('the reader is a reader: it tells two faces apart and refuses what is not WOFF2', () => {
    const fraunces = woff2Metrics(font('Fraunces-opsz-wght.woff2')) as { unitsPerEm: number; ascender: number };
    expect([fraunces.unitsPerEm, fraunces.ascender]).not.toEqual([measured.unitsPerEm, measured.ascender]);
    expect((woff2Tables(font('JetBrainsMono-Regular.woff2')) as Map<string, Buffer>).get('hhea')!.length).toBe(36);
    expect(() => woff2Metrics(Buffer.from('not a font at all, just some text'))).toThrow(/not a WOFF2/);
    // the weights the GUI ships share the metrics, so a board in another weight would measure the same
    for (const w of ['Medium', 'SemiBold']) expect(woff2Metrics(font(`JetBrainsMono-${w}.woff2`))).toMatchObject({ ...BOARD_FONT_METRICS });
  });
});
