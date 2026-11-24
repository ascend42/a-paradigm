/**
 * @symbol #gui-board
 *
 * What a mark on a board must look like, whatever arrived (drawn, pasted, restored by an undo): the engine-side half
 * of condition C8 (boards S1.1; Mika's pass A finding 3). PURE: no DOM, no engine import. src/board/index.ts applies
 * it to every element on every change; test/board-normal.test.ts holds it.
 *
 * A person cannot make a dashed, rough, hachured, translucent, rounded or linked mark by any route: the stroke is
 * solid unless the HOST says another hand drew it, and every other look is fixed.
 */
import { CONTENT_DEFAULTS, CONTENT_THEME_TOKENS, resolveContentColour } from '@a-company/gnomon-contracts';
import { BOARD_WEIGHTS, type BoardAuthor, type BoardTheme } from '../core/board.js';

/** The engine element types a board holds. Anything else (image, embeddable, iframe, diamond, line …) is removed. */
export const BOARD_TYPES: ReadonlySet<string> = new Set(['rectangle', 'ellipse', 'arrow', 'frame', 'freedraw', 'text']);
/** Element types whose background is a fill a person chose. */
export const FILLABLE: ReadonlySet<string> = new Set(['rectangle', 'ellipse']);
export const BOARD_FONT_ID = 10;
export const BOARD_FONT_SIZE = 13.5;

const WEIGHTS: readonly number[] = Object.values(BOARD_WEIGHTS);
/** The design's weight nearest to a stroke width (a tie goes to the lighter). */
export const nearestWeight = (w: number): number => WEIGHTS.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), WEIGHTS[0]!);
/** Solid means the host vouches for you; every other hand is dashed. Derived from the author, never an input. */
export const strokeStyleOf = (by: BoardAuthor | undefined): 'solid' | 'dashed' => (by && by.cls !== 'human' ? 'dashed' : 'solid');
export const lineColour = (token: unknown, theme: BoardTheme): string => resolveContentColour(token, 'line', theme) ?? CONTENT_THEME_TOKENS[theme]['text.primary'];
export const fillColour = (token: unknown, theme: BoardTheme): string => (token === null ? null : resolveContentColour(token, 'fill', theme)) ?? 'transparent';

export interface MarkStamp {
  line: string;
  fill: string | null;
  kind?: 'sticky' | 'stub';
  by?: BoardAuthor;
}

/** The properties an element of a board type must have, for its stamp (none: default ink, no fill, yours) and theme. */
export function normalOf(el: { type: string; strokeWidth?: number }, stamp: MarkStamp | null, theme: BoardTheme): Record<string, unknown> {
  return {
    strokeColor: lineColour(stamp?.line ?? CONTENT_DEFAULTS.line, theme),
    backgroundColor: fillColour(stamp && FILLABLE.has(el.type) ? stamp.fill : null, theme),
    strokeStyle: strokeStyleOf(stamp?.by),
    roughness: 0,
    fillStyle: 'solid',
    opacity: 100,
    roundness: null,
    link: null,
    ...(el.type === 'frame' || el.type === 'text' || stamp?.kind === 'stub' ? {} : { strokeWidth: nearestWeight(el.strokeWidth ?? BOARD_WEIGHTS.fine) }),
    ...(el.type === 'text' ? { fontFamily: BOARD_FONT_ID, fontSize: BOARD_FONT_SIZE } : {}),
  };
}

/** True when a live element is not in its normal form (or is not a board type at all, and must go). */
export function offNormal(el: { type: string; isDeleted?: boolean; strokeWidth?: number }, stamp: MarkStamp | null, theme: BoardTheme): boolean {
  if (el.isDeleted) return false;
  if (!BOARD_TYPES.has(el.type)) return true;
  const want = normalOf(el, stamp, theme);
  const have = el as unknown as Record<string, unknown>;
  return Object.keys(want).some((k) => have[k] !== undefined && have[k] !== want[k]);
}
