/**
 * @symbol #gui-board
 *
 * The content tray's model (design component content-tray): which wells each row offers, and what a typed custom
 * colour becomes. PURE: no DOM. Every colour question goes to the ONE shared check in gnomon-contracts
 * (`contentColourCheck`): a colour that fails is refused with the nearest named swatch offered, never applied and
 * never stepped towards a passing one (Aegis ruling 3). The same row serves the contrast refusals of
 * content_palette.contrast_rule, with their own words and their own offered swatch.
 */
import { CONTENT_MIN_DISTANCE, CONTENT_NEUTRALS, CONTENT_RESERVED_COLOURS, CONTENT_SWATCHES, colourDistanceQSq, contentColourCheck, contentContrastWords, contentPairCheck, LAB_QUANTUM, nightOf, type ContentContrastWhy, type ContentRole } from '@a-company/gnomon-contracts';
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
 * What the colour is drawn on: `text` when the colour is a text mark's (read as words: the 4.5 floor), `others`,
 * the other colour of each mark it would be drawn with (the fill when a line is judged, the line when a fill is;
 * `null` for none), against which contrast_rule.pair judges it, and `chosen` when no mark exists yet (the tool's
 * held style): the pair words then say "the chosen fill" and "the chosen line" (orchestrator's ruling on Mika's
 * P0b question; Luna may refine). `other` is the one-mark form of `others`.
 */
export interface CustomContext {
  text?: boolean;
  other?: string | null;
  others?: ReadonlyArray<string | null>;
  chosen?: boolean;
}

/** A contrast refusal's words for the context: "this mark's" before a mark exists reads "the chosen". */
const contrastWhy = (why: ContentContrastWhy, night: boolean, ctx: CustomContext): string => {
  const said = contentContrastWords(why, night);
  return ctx.chosen ? said.replace("this mark's fill", 'the chosen fill').replace("this mark's line", 'the chosen line') : said;
};

/** The ONE shared check of a token in a context: the role alone, then the pair against every other colour. */
export function judgeToken(token: string, role: ContentRole, ctx: CustomContext = {}): { ok: true } | { ok: false; why: string; offer: string | null; contrast: boolean } {
  const use = { text: role === 'line' && !!ctx.text };
  const alone = contentColourCheck(token, role, use);
  let check = alone;
  for (const other of alone.ok ? [...(ctx.others ?? []), ...(ctx.other !== undefined ? [ctx.other] : [])] : []) {
    if (!other) continue;
    const c = role === 'line' ? contentPairCheck(token, other, 'line', use) : contentPairCheck(other, token, 'fill', use);
    if (!c.ok) {
      check = c;
      break;
    }
  }
  if (check.ok) return { ok: true };
  return check.why ? { ok: false, why: contrastWhy(check.why, !!check.night, ctx), offer: check.offer, contrast: true } : { ok: false, why: '', offer: check.offer, contrast: false };
}

/** The refusal row's line: the role is named after "not used" when it must be (Mika P0b C1), the why stays whole. */
export const trayRefusalLine = (why: string, role: ContentRole | null): string => (role ? `✕ not used as a ${role} · ${why}` : `✕ not used · ${why}`);

/**
 * The tool's held style judged as the tool would draw it (Mika P0b S1): what would be refused once the first mark
 * is made, one entry per failing role, each with its own offered key. Nothing is substituted.
 */
export function heldRefusals(style: { line: string; fill: string | null }, ctx: { line: CustomContext; fill: CustomContext | null }): Array<{ role: ContentRole; why: string; offer: string | null; line: string }> {
  const out: Array<{ role: ContentRole; why: string; offer: string | null; line: string }> = [];
  const line = judgeToken(style.line, 'line', ctx.line);
  if (!line.ok) out.push({ role: 'line', why: line.why || 'that colour can’t be used here', offer: line.offer, line: trayRefusalLine(line.why || 'that colour can’t be used here', 'line') });
  if (ctx.fill && style.fill !== null) {
    const fill = judgeToken(style.fill, 'fill', ctx.fill);
    if (!fill.ok) out.push({ role: 'fill', why: fill.why || 'that colour can’t be used here', offer: fill.offer, line: trayRefusalLine(fill.why || 'that colour can’t be used here', 'fill') });
  }
  return out;
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
  const check = judgeToken(token, role, ctx);
  if (check.ok) {
    const night = { line: nightOf(hex, 'line'), fill: nightOf(hex, 'fill') };
    return { ok: true, token, hex, night, line: `custom · at night ${night.line} as a line, ${night.fill} as a fill` };
  }
  // the contrast rule: its own words, ' at night' when only the night value fails, and its own offer
  if (check.contrast) return { ok: false, why: check.why, offer: check.offer, line: trayRefusalLine(check.why, null) };
  const day = nearestReserved(hex, 'day');
  const night = nearestReserved(nightOf(hex, role), 'night');
  // not near any reserved colour: the fill guard refused it (a fill may not sit on the ink or the key edge)
  const reach = (CONTENT_MIN_DISTANCE * LAB_QUANTUM) ** 2;
  const why = Math.min(day.d, night.d) >= reach ? 'as a fill it would hide the ink drawn on it' : night.d < day.d ? `at night this is ${reservedWords(night.name)}` : `that is ${reservedWords(day.name)}`;
  return { ok: false, why, offer: check.offer, line: `✕ not used · ${why}` };
}
