/**
 * @symbol #gui-board
 *
 * The board engine's skin (boards S1.1, oracle G-DDL-07; design rule
 * engine-wears-the-system). The engine stays in its light theme; everything it
 * draws that is not a mark (selection, handles, guides, the binding highlight,
 * the marquee, frames, the eraser cursor) reads its colour from
 * `gnomonBoardSkin` at draw time. scripts/board-patches.mjs replaces the
 * engine's own colour literals with reads of this object, so day and night are
 * a change of this object and never an engine theme.
 *
 * The values are the Gnomon theme tokens the content palette is tested
 * against (`CONTENT_THEME_TOKENS` in gnomon-contracts, compared with
 * foundations.color by the palette test): no second palette lives here.
 */
import { CONTENT_THEME_TOKENS, type ContentTheme } from '@a-company/gnomon-contracts';

export interface BoardSkin {
  /** --ink: text caret, guides */
  ink: string;
  /** --sec: frame edge and frame title */
  sec: string;
  /** --sheet: handle fill, the eraser ring's fill */
  sheet: string;
  /** --key-edge: selection border, handle edge, chosen point */
  selection: string;
  handle: string;
  handleHover: string;
  guide: string;
  /** a wash of --ink under a mark an arrow is about to bind to */
  binding: string;
  /** a lighter wash of --ink inside the selection marquee */
  wash: string;
  frame: string;
}

const alpha = (hex: string, a: number): string => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

/** The skin of one theme, derived from the theme tokens only. */
export function skinOf(theme: ContentTheme): BoardSkin {
  const t = CONTENT_THEME_TOKENS[theme];
  const ink = t['text.primary'];
  const edge = t['line.key-edge'];
  return {
    ink,
    sec: t['text.secondary'],
    sheet: t['surface.sheet'],
    selection: edge,
    handle: t['surface.sheet'],
    handleHover: alpha(edge, 0.4),
    guide: ink,
    binding: alpha(ink, 0.14),
    wash: alpha(ink, 0.06),
    frame: t['text.secondary'],
  };
}

/** What the patched engine reads. One theme per page, so one object. */
export const gnomonBoardSkin: BoardSkin = skinOf('day');

export function applySkin(theme: ContentTheme): void {
  Object.assign(gnomonBoardSkin, skinOf(theme));
}

/**
 * The engine actions a key may run (patch `key-actions-allowlist`): undo, redo, delete the selection, select all,
 * zoom in, out and to 100%, and finishing a mark with Esc or Enter. Every other engine shortcut matches nothing.
 */
export const gnomonBoardKeyActions: ReadonlySet<string> = new Set(['undo', 'redo', 'deleteSelectedElements', 'selectAll', 'zoomIn', 'zoomOut', 'resetZoom', 'finalize']);
