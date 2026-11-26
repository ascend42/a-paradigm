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
import { CONTENT_DEFAULTS, CONTENT_THEME_TOKENS, resolveContentColour, resolveContentPair } from '@a-company/gnomon-contracts';
import { BOARD_WEIGHTS, type BoardAuthor, type BoardTheme } from '../core/board.js';

/**
 * The engine element types a board holds: one per core kind of `dim-shape:v1` (src/board/dim-map.ts maps them, and
 * test/dim-map.test.ts holds the two files to each other). Anything else (image, embeddable, iframe, line …) is
 * removed. A diamond has no rail tool: the board draws and edits one that is stored, and cannot start one.
 */
export const BOARD_TYPES: ReadonlySet<string> = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'frame', 'freedraw', 'text']);
/**
 * S1.4 P4a (Aegis, S1.4 draft question 6): `line` is a board type for ONE element only: the one the handle's
 * rendered fold maps to a stroke whose `by` is not human (the stamp's `agentStroke`, set by the handle from the
 * fold, never from the element). Every other `line` (the `l` key, a paste, a duplicate, a restore) is removed and
 * refused as before. The check is on (type, mapped node), never on the type alone.
 */
export const isBoardType = (type: string, stamp: MarkStamp | null): boolean => BOARD_TYPES.has(type) || (type === 'line' && stamp?.agentStroke === true && stamp.by !== undefined && stamp.by.cls !== 'human');
/** Element types whose background is a fill a person chose. */
export const FILLABLE: ReadonlySet<string> = new Set(['rectangle', 'ellipse', 'diamond']);
export const BOARD_FONT_ID = 10;
export const BOARD_FONT_SIZE = 13.5;

const WEIGHTS: readonly number[] = Object.values(BOARD_WEIGHTS);
/** The design's weight nearest to a stroke width (a tie goes to the lighter). */
export const nearestWeight = (w: number): number => WEIGHTS.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), WEIGHTS[0]!);
/** Solid means the host vouches for you; every other hand is dashed. Derived from the author, never an input. */
export const strokeStyleOf = (by: BoardAuthor | undefined): 'solid' | 'dashed' => (by && by.cls !== 'human' ? 'dashed' : 'solid');
export const lineColour = (token: unknown, theme: BoardTheme): string => resolveContentColour(token, 'line', theme) ?? CONTENT_THEME_TOKENS[theme]['text.primary'];
export const fillColour = (token: unknown, theme: BoardTheme): string => (token === null ? null : resolveContentColour(token, 'fill', theme)) ?? 'transparent';
/**
 * A mark's two colours as painted (content_palette.contrast_rule, at paint): the stored tokens are rechecked and
 * never trusted. A text mark's colour is held to the text floor; a line that fails draws as ink, a fill that
 * fails as none, and a line that fails against its own fill as ink. Nothing stored is rewritten.
 */
export function paintOf(type: string, line: unknown, fill: unknown, theme: BoardTheme): { strokeColor: string; backgroundColor: string } {
  const p = resolveContentPair(line, FILLABLE.has(type) ? fill : null, theme, { text: type === 'text' });
  return { strokeColor: p.line, backgroundColor: p.fill ?? 'transparent' };
}

/**
 * What a mark is painted from. `line` and `fill` are content-palette tokens kept on the element (the palette checks
 * them on every paint). `kind` and `by` are NOT read from the element: the handle reads them from the folded
 * dimension it last rendered (boards S1.3), so nothing pasted, dropped or copied can claim an author, a dashed
 * stroke or a stub.
 */
export interface MarkStamp {
  line: string;
  fill: string | null;
  kind?: 'sticky' | 'stub';
  by?: BoardAuthor;
  /** the fold maps this element's id to a stroke another hand drew (src/board/dim-map.ts dimIsAgentStroke) */
  agentStroke?: true;
}

/** The properties an element of a board type must have, for its stamp (none: default ink, no fill, yours) and theme. */
export function normalOf(el: { type: string; strokeWidth?: number; startArrowhead?: unknown; endArrowhead?: unknown }, stamp: MarkStamp | null, theme: BoardTheme): Record<string, unknown> {
  return {
    ...paintOf(el.type, stamp?.line ?? CONTENT_DEFAULTS.line, stamp ? stamp.fill : null, theme),
    strokeStyle: strokeStyleOf(stamp?.by),
    roughness: 0,
    fillStyle: 'solid',
    opacity: 100,
    roundness: null,
    link: null,
    // a pasted lock could never be undone (the board has no lock key). ONE mark is locked, by the handle: a
    // fallback (a node this build cannot draw) starts no drag and shows no handles, since no op may touch it
    locked: stamp?.kind === 'stub',
    // WHICH ends carry a head is the arrow's own (`head` of dim-shape:v1: none, end or both, so a start head never
    // stands without an end head); the SHAPE of a head is fixed: the open arrow, never a stock triangle, bar or dot
    // an agent's stroke drawn as a `line`: no head at either end, tied to nothing, never filled (a closed run of
    // points would otherwise fill), its dash from `by` above (Aegis, S1.4 draft question 6)
    ...(el.type === 'line' ? { startArrowhead: null, endArrowhead: null, startBinding: null, endBinding: null, backgroundColor: 'transparent' } : {}),
    ...(el.type === 'arrow' ? { startArrowhead: el.startArrowhead != null ? 'arrow' : null, endArrowhead: el.startArrowhead != null || el.endArrowhead != null ? 'arrow' : null } : {}),
    ...(el.type === 'frame' || el.type === 'text' || stamp?.kind === 'stub' ? {} : { strokeWidth: nearestWeight(el.strokeWidth ?? BOARD_WEIGHTS.fine) }),
    ...(el.type === 'text' ? { fontFamily: BOARD_FONT_ID, fontSize: BOARD_FONT_SIZE } : {}),
  };
}

/** True when a live element is not in its normal form (or is not a board type at all, and must go). */
export function offNormal(el: { type: string; isDeleted?: boolean; strokeWidth?: number; startArrowhead?: unknown; endArrowhead?: unknown }, stamp: MarkStamp | null, theme: BoardTheme): boolean {
  if (el.isDeleted) return false;
  if (!isBoardType(el.type, stamp)) return true;
  const want = normalOf(el, stamp, theme);
  const have = el as unknown as Record<string, unknown>;
  return Object.keys(want).some((k) => have[k] !== undefined && have[k] !== want[k]);
}
