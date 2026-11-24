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
  /** --ink: selection border, handle edge, chosen point, the frame title editor's rule */
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

/** The three derived alphas, all of the theme ink: a hovered line point, the binding highlight, the marquee wash. */
export const SKIN_ALPHA = { handleHover: 0.4, binding: 0.14, wash: 0.06 } as const;

/** The skin of one theme, derived from the theme tokens only. */
export function skinOf(theme: ContentTheme): BoardSkin {
  const t = CONTENT_THEME_TOKENS[theme];
  const ink = t['text.primary'];
  return {
    ink,
    sec: t['text.secondary'],
    sheet: t['surface.sheet'],
    // the selection is the ink in both themes: night --key-edge sits inside the reserved distance of sea-grey
    // (Mika's ruling, S1.1 pass A)
    selection: ink,
    handle: t['surface.sheet'],
    handleHover: alpha(ink, SKIN_ALPHA.handleHover),
    guide: ink,
    binding: alpha(ink, SKIN_ALPHA.binding),
    wash: alpha(ink, SKIN_ALPHA.wash),
    frame: t['text.secondary'],
  };
}

/** What the patched engine reads. One theme per page, so one object. */
export const gnomonBoardSkin: BoardSkin = skinOf('day');

export function applySkin(theme: ContentTheme): void {
  Object.assign(gnomonBoardSkin, skinOf(theme));
}

/**
 * The engine actions a key may run (patch `key-actions-allowlist`): delete the selection, select all,
 * zoom in and out, and finishing a mark with Esc or Enter. ⌘0 is the host's (it fits everything; Mika's ruling). Every other engine shortcut matches nothing.
 */
export const gnomonBoardKeyActions: ReadonlySet<string> = new Set(['deleteSelectedElements', 'selectAll', 'zoomIn', 'zoomOut', 'finalize']);

/** The board hosts that have yielded the keyboard to a card (handle.setYielded). */
const yieldedHosts = new Set<object>();
/** Set by the handle; cleared at unmount. */
export function setBoardYielded(host: object, on: boolean): void {
  if (on) yieldedHosts.add(host);
  else yieldedHosts.delete(host);
}
/**
 * Read by the patched engine (patches `yield-keyup`, `yield-gesture-*`): its document-level keyup and gesture
 * listeners return at once while a board on the page has yielded (G-DDL-08). A page shows one board at a time.
 */
export const gnomonBoardYielded = (): boolean => yieldedHosts.size > 0;

/** What the engine refused to do, for the host to say in its own words. */
export type BoardRefusalKind = 'image' | 'mark';
const refusalListeners = new Set<(what: BoardRefusalKind, detail?: string) => void>();
/**
 * Called by the patched engine (patches `image-insert-refused`, `paste-types-filtered`). Nothing is shown by the
 * engine itself. The listeners are module-wide: one board per page today, and a second board on a page would hear
 * the first one's refusals (recorded for S1.3, when a page may hold more than one).
 */
export function gnomonBoardRefuse(what: BoardRefusalKind, detail?: string): void {
  for (const l of [...refusalListeners]) l(what, detail);
}
export function onBoardRefusal(listener: (what: BoardRefusalKind, detail?: string) => void): () => void {
  refusalListeners.add(listener);
  return () => void refusalListeners.delete(listener);
}

/** The engine element types a board holds (src/board/normal.ts BOARD_TYPES holds the same list; a test compares). */
export const gnomonBoardTypes: ReadonlySet<string> = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'frame', 'freedraw', 'text']);
/**
 * Called by the patched engine on every paste or insert, BEFORE it commits anything (patch `paste-types-filtered`):
 * the elements of a board type, and a refusal for each one that is not. An image, an embeddable or an iframe
 * therefore never becomes a scene element, and no node for one is ever built.
 */
export function gnomonBoardAdmit<T extends { type?: unknown }>(elements: readonly T[] | null | undefined): T[] {
  const out: T[] = [];
  for (const el of elements ?? []) {
    if (el && typeof el.type === 'string' && gnomonBoardTypes.has(el.type)) out.push(el);
    else gnomonBoardRefuse(el && el.type === 'image' ? 'image' : 'mark', el && typeof el.type === 'string' ? el.type.slice(0, 24) : 'unknown');
  }
  return out;
}
