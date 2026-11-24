/**
 * G-DDL-07 goldens (boards S1.1): the pixel side of the reskin oracle, shared by test/board-reskin.test.ts (the
 * committed goldens, every OS) and the one real-engine run in test/board-csp.test.ts (live captures).
 *
 * Goldens are Chromium captures at device pixel ratio 1 of the P12 harness page, each composed from the engine's
 * canvases on the theme's desk ground. They are compared as DECODED pixels, never as file bytes, with the tolerance
 * stated in TOLERANCE. GNOMON_UPDATE_GOLDENS=1 rewrites them from this machine's Chromium run instead of
 * comparing (look at the PNGs before committing them).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { CONTENT_RESERVED_COLOURS, CONTENT_SWATCH_NAMES, CONTENT_THEME_TOKENS, contentColourCheck, coloursClear, isNeutralColour, resolveContentColour } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { BOARD_FONT, BOARD_FONT_STRING, GROUND } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs build script (no types)
import { decodePng, pixelColours } from '../scripts/board-colours.mjs';

export const GOLDENS = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'test', 'goldens', 'board');
export const SHOTS = ['marks', 'selection', 'marquee', 'multi', 'binding', 'guides'] as const;
export const THEMES = ['day', 'night'] as const;
export type Theme = (typeof THEMES)[number];
export type Png = { width: number; height: number; channels: number; data: Buffer };

export const RESERVED: string[] = [...Object.values(CONTENT_RESERVED_COLOURS.day), ...Object.values(CONTENT_RESERVED_COLOURS.night)];
export const nearReserved = (hex: string): boolean => RESERVED.some((r) => !coloursClear(hex, r));

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** How far (per channel) a pixel may sit from the straight mix of two theme colours and still be that mix. */
const MIX_SLACK = 4;
/** True when a pixel is one of `palette` or an antialiased mix of two of them (every channel within MIX_SLACK). */
export function isMixOf(hex: string, palette: readonly string[]): boolean {
  const own = [...new Set(palette)].map(rgb);
  const p = rgb(hex);
  for (const a of own) {
    for (const b of own) {
      const span = a.map((v, i) => v - b[i]!);
      const k = span.reduce((best, v, i) => (Math.abs(v) > Math.abs(span[best]!) ? i : best), 0);
      const t = span[k] === 0 ? 0 : Math.min(1, Math.max(0, (p[k]! - b[k]!) / span[k]!));
      if (p.every((v, i) => Math.abs(v - (b[i]! + t * span[i]!)) <= MIX_SLACK)) return true;
    }
  }
  return false;
}

/**
 * What a capture holds that it must not (Mika's pass A finding 8). `stray`: every chromatic pixel that is not one of
 * the theme's own colours, a colour in `extra` (the content colours a capture was drawn with), or a mix of two of
 * them: an engine blue or violet is stray wherever it sits, not only near a reserved colour, and ONE pixel fails.
 * `reserved`: every chromatic pixel inside the minimum distance of a reserved colour, with no exemption (the
 * selection is the ink, so no theme colour the board draws with sits there).
 */
export function strayPixels(png: Png, theme: Theme, extra: readonly string[] = []): { stray: Array<[string, number]>; reserved: Array<[string, number]> } {
  const palette = [...Object.values(CONTENT_THEME_TOKENS[theme]), (GROUND as Record<Theme, string>)[theme], ...extra];
  const stray: Array<[string, number]> = [];
  const reserved: Array<[string, number]> = [];
  for (const [hex, n] of pixelColours(png) as Map<string, number>) {
    if (isNeutralColour(hex)) continue;
    if (!isMixOf(hex, palette)) stray.push([hex, n]);
    if (nearReserved(hex) && !extra.some((c) => isMixOf(hex, [c, (GROUND as Record<Theme, string>)[theme], ...Object.values(CONTENT_THEME_TOKENS[theme])]))) reserved.push([hex, n]);
  }
  return { stray, reserved };
}

/** Every colour the content-colour capture is drawn with, for a theme: each named line and fill value. */
export function contentColours(theme: Theme): string[] {
  const out: string[] = [];
  for (const name of CONTENT_SWATCH_NAMES) for (const role of ['line', 'fill'] as const) if (contentColourCheck(name, role).ok) out.push(resolveContentColour(name, role, theme)!);
  return [...new Set(out)];
}

/** Golden compare on DECODED pixels (never file bytes): the share of pixels with any channel more than 48 apart. */
export const TOLERANCE = { channel: 48, share: 0.002 };
export function differingShare(a: Png, b: Png): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let diff = 0;
  for (let i = 0, j = 0; i < a.data.length; i += a.channels, j += b.channels) {
    if (Math.abs(a.data[i]! - b.data[j]!) > TOLERANCE.channel || Math.abs(a.data[i + 1]! - b.data[j + 1]!) > TOLERANCE.channel || Math.abs(a.data[i + 2]! - b.data[j + 2]!) > TOLERANCE.channel) diff++;
  }
  return diff / (a.width * a.height);
}
export const golden = (name: string): Png => decodePng(readFileSync(path.join(GOLDENS, `${name}.png`))) as Png;


type Shot = { width: number; height: number; png: string };
export interface LiveRun {
  skin?: Record<Theme, Record<string, Shot>>;
  narrow?: { capture: Shot };
  colours?: Record<Theme, Shot>;
  canvasFonts?: string[];
  stockNodes?: string[];
  requests?: Array<{ path: string }>;
}

/**
 * The live half of G-DDL-07 for one finished engine run: no stock node, one canvas font string, one font request,
 * every capture clear of reserved colours, and (Chromium at device pixel ratio 1) every capture within the
 * tolerance of its golden.
 */
export function checkLiveReskin(name: string, family: string, r: LiveRun): void {
  expect(r.stockNodes, name).toEqual([]);
  expect(r.canvasFonts, name).toEqual([BOARD_FONT_STRING]);
  // the only font request is the bundle's own face: no Excalifont, Virgil or CDN path
  expect([...new Set((r.requests ?? []).map((q) => q.path).filter((p) => /font|woff|ttf/i.test(p)))], name).toEqual([`/${BOARD_FONT}`]);
  const shots: Array<[string, Theme, Shot]> = [...THEMES.flatMap((t) => SHOTS.map((s) => [`${s}-${t}`, t, r.skin![t]![s]!] as [string, Theme, Shot])), ['narrow-day', 'day', r.narrow!.capture]];
  // one capture per theme with a mark in every content colour: exactly those colours and the theme's own
  for (const theme of THEMES) {
    const png = decodePng(Buffer.from(r.colours![theme]!.png, 'base64')) as Png;
    expect(strayPixels(png, theme, contentColours(theme)).stray, `${name} colours-${theme}`).toEqual([]);
    shots.push([`colours-${theme}`, theme, r.colours![theme]!]);
  }
  for (const [shot, theme, cap] of shots) {
    if (shot.startsWith('colours-')) {
      const png = decodePng(Buffer.from(cap.png, 'base64')) as Png;
      if (family !== 'chromium' || png.width !== 1280) continue;
      if (process.env.GNOMON_UPDATE_GOLDENS === '1') writeFileSync(path.join(GOLDENS, `${shot}.png`), Buffer.from(cap.png, 'base64'));
      else expect(differingShare(golden(shot), png), `${name} ${shot}`).toBeLessThanOrEqual(TOLERANCE.share);
      continue;
    }
    const png = decodePng(Buffer.from(cap.png, 'base64')) as Png;
    expect(strayPixels(png, theme), `${name} ${shot}`).toEqual({ stray: [], reserved: [] });
    if (family !== 'chromium' || png.width !== golden(shot).width) continue; // goldens are Chromium at device pixel ratio 1
    if (process.env.GNOMON_UPDATE_GOLDENS === '1') {
      if (!existsSync(GOLDENS)) mkdirSync(GOLDENS, { recursive: true });
      writeFileSync(path.join(GOLDENS, `${shot}.png`), Buffer.from(cap.png, 'base64'));
    } else expect(differingShare(golden(shot), png), `${name} ${shot}: share of pixels more than ${TOLERANCE.channel} apart`).toBeLessThanOrEqual(TOLERANCE.share);
  }
}
