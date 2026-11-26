/**
 * @symbol #gui-board
 *
 * The content tray's model (design component content-tray): which wells each row offers, and what a typed custom
 * colour becomes. PURE: no DOM. Every colour question goes to the ONE shared check in gnomon-contracts
 * (`contentColourCheck`): a colour that fails is refused with the nearest named swatch offered, never applied and
 * never stepped towards a passing one (Aegis ruling 3). The same row serves the contrast refusals of
 * content_palette.contrast_rule, with their own words and their own offered swatch.
 */
import { CONTENT_MIN_DISTANCE, CONTENT_NEUTRALS, CONTENT_RESERVED_COLOURS, CONTENT_SWATCHES, colourDistanceQSq, contentColourCheck, contentContrastWords, contentPairCheck, LAB_QUANTUM, nightOf, type ContentRole } from '@a-company/gnomon-contracts';
import type { BoardWeight } from './board.js';

/** line: ink, graphite, then the hues that have a line value (lemon has none). */
export const TRAY_LINE: readonly string[] = [...Object.entries(CONTENT_NEUTRALS).filter(([, n]) => n.role === 'line').map(([name]) => name), ...CONTENT_SWATCHES.filter((s) => s.day.line).map((s) => s.name)];
/** fill: none (null, the slashed well), paper, then every hue. */
export const TRAY_FILL: ReadonlyArray<string | null> = [null, ...Object.entries(CONTENT_NEUTRALS).filter(([, n]) => n.role === 'fill').map(([name]) => name), ...CONTENT_SWATCHES.filter((s) => s.day.fill).map((s) => s.name)];
export const TRAY_WEIGHTS: readonly BoardWeight[] = ['fine', 'bold', 'marker'];
export const MARKER_OFF_TITLE = 'Marker is for the Stroke tool';
/** A well's name: its swatch name, `none` for no fill, `custom` for a typed colour. */
export const wellName = (token: string | null): string => (token === null ? 'none' : token.startsWith('custom:') ? 'custom' : token);

export type CustomEntry =
  | { ok: true; token: string; hex: string; night: { line: string; fill: string }; line: string }
  | { ok: false; why: string; offer: string | null; line: string };

/** In plain words, which kind of reserved colour a token name is. The token's own name stays in the raw view. */
const reservedWords = (name: string): string => (name.startsWith('state.fail') ? 'the failed colour' : name.startsWith('state.warn') ? 'the warning colour' : name.startsWith('state.knot') ? 'the knot colour' : 'a project colour');

/** The reserved colour of `theme` nearest to `hex`, by the palette's own metric. */
function nearestReserved(hex: string, theme: 'day' | 'night'): { name: string; d: number } {
  let best = { name: '', d: Infinity };
  for (const [name, value] of Object.entries(CONTENT_RESERVED_COLOURS[theme])) {
    const d = colourDistanceQSq(hex, value);
    if (d < best.d) best = { name, d };
  }
  return best;
}

/**
 * What the colour is drawn on: `text` when the tool draws a text mark (its colour is read as words: the 4.5
 * floor), and `other`, the mark's other colour as the tool would draw it (the fill when a line is typed, the line
 * when a fill is typed), against which contrast_rule.pair judges the typed one.
 */
export interface CustomContext {
  text?: boolean;
  other?: string | null;
}

/**
 * What a typed hex becomes for `role`. Passing: the storable token, its night values and the line the tray prints
 * ('custom · at night #… as a line, #… as a fill'). Failing: nothing to store; why in plain words, and the nearest
 * named swatch to offer ('✕ not used · <why>', then one quiet key 'Use <swatch>').
 */
export function customEntry(text: string, role: ContentRole, ctx: CustomContext = {}): CustomEntry {
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(text.trim());
  if (!m) return { ok: false, why: 'six hex digits make a colour, like #00897B', offer: null, line: '✕ not used · six hex digits make a colour, like #00897B' };
  const hex = `#${m[1]!.toUpperCase()}`;
  const token = `custom:${hex}`;
  const use = { text: role === 'line' && !!ctx.text };
  const alone = contentColourCheck(token, role, use);
  const check = alone.ok && ctx.other ? (role === 'line' ? contentPairCheck(token, ctx.other, 'line', use) : contentPairCheck(ctx.other, token, 'fill', use)) : alone;
  if (check.ok) {
    const night = { line: nightOf(hex, 'line'), fill: nightOf(hex, 'fill') };
    return { ok: true, token, hex, night, line: `custom · at night ${night.line} as a line, ${night.fill} as a fill` };
  }
  // the contrast rule: its own words, ' at night' when only the night value fails, and its own offer
  if (check.why) {
    const why = contentContrastWords(check.why, !!check.night);
    return { ok: false, why, offer: check.offer, line: `✕ not used · ${why}` };
  }
  const day = nearestReserved(hex, 'day');
  const night = nearestReserved(nightOf(hex, role), 'night');
  // not near any reserved colour: the fill guard refused it (a fill may not sit on the ink or the key edge)
  const reach = (CONTENT_MIN_DISTANCE * LAB_QUANTUM) ** 2;
  const why = Math.min(day.d, night.d) >= reach ? 'as a fill it would hide the ink drawn on it' : night.d < day.d ? `at night this is ${reservedWords(night.name)}` : `that is ${reservedWords(day.name)}`;
  return { ok: false, why, offer: check.offer, line: `✕ not used · ${why}` };
}
