/**
 * @symbol #gui-board
 *
 * The board rail's model (design component board-rail): the tools, their letters and glyphs, which key does what and
 * when, and how the rail folds in a short pane. PURE: no DOM. ui/board-leaf.ts draws it.
 */
import type { BoardTool } from './board.js';

export interface RailTool {
  tool: BoardTool;
  letter: string;
  /** the accessible name */
  name: string;
  /** title= text, without the letter */
  title: string;
  /** SVG path data on a 16 grid (design `glyph_paths`, copied from the rendered specimen) */
  paths: readonly string[];
  /** the one filled dot (the sticky's pin head) */
  dot?: { cx: number; cy: number; r: number };
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
}

export const RAIL_TOOLS: readonly RailTool[] = [
  { tool: 'select', letter: 'V', name: 'Select', title: 'Select', paths: ['M3.5 2 V13 L6.5 10.2 L8.6 14.5 L10.4 13.6 L8.3 9.4 L12.5 9.2 Z'] },
  { tool: 'sticky', letter: 'N', name: 'Sticky', title: 'Sticky', paths: ['M2.5 3.5 H13.5 V10 L10 13.5 H2.5 Z M13.5 10 H10 V13.5'], dot: { cx: 8, cy: 3.5, r: 1.75 } },
  { tool: 'text', letter: 'T', name: 'Text', title: 'Text', paths: ['M3.5 5.5 V3.5 H12.5 V5.5 M8 3.5 V12.5 M6 12.5 H10'] },
  { tool: 'rect', letter: 'R', name: 'Rectangle', title: 'Rectangle', paths: ['M2.5 4 H13.5 V12 H2.5 Z'] },
  { tool: 'ellipse', letter: 'O', name: 'Ellipse', title: 'Ellipse', paths: [], ellipse: { cx: 8, cy: 8, rx: 5.75, ry: 4.25 } },
  { tool: 'arrow', letter: 'C', name: 'Arrow · connect', title: 'Arrow · connect', paths: ['M3 13 L12.5 3.5 M7 3.5 H12.5 V9'] },
  { tool: 'frame', letter: 'F', name: 'Frame', title: 'Frame', paths: ['M2 5.5 V2.5 H5 M11 2.5 H14 V5.5 M14 10.5 V13.5 H11 M5 13.5 H2 V10.5', 'M6.5 2.5 H9.5'] },
  { tool: 'stroke', letter: 'P', name: 'Stroke', title: 'Stroke', paths: ['M2.5 11.5 C3.5 6 6 5.5 7.2 8.6 S10.5 12.5 13.5 4.5'] },
  { tool: 'hand', letter: 'H', name: 'Hand', title: 'Hand: drag to move the view', paths: ['M8 2 V14 M2 8 H14 M6 4 L8 2 L10 4 M6 12 L8 14 L10 12 M4 6 L2 8 L4 10 M12 6 L14 8 L12 10'] },
];
/** The drawing tools, top down, in their groups (a 10px tick ends a group). Hand sits with the zoom keys below. */
export const RAIL_GROUPS: ReadonlyArray<readonly BoardTool[]> = [['select'], ['sticky', 'text'], ['rect', 'ellipse', 'arrow', 'frame'], ['stroke']];
export const railTool = (tool: BoardTool): RailTool => RAIL_TOOLS.find((t) => t.tool === tool)!;
export const railTitle = (t: RailTool): string => `${t.title} (${t.letter})`;

export type RailAction = { type: 'tool'; tool: BoardTool } | { type: 'fit' };

export interface RailKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}
export interface RailKeyContext {
  /** focus is inside the board (its surface or its rail) */
  boardFocused: boolean;
  /** a text is being typed on the board */
  editingText: boolean;
  /** a card in the stack or the pinned zone has focus: the board takes no key at all */
  cardFocused: boolean;
}

/**
 * What a key press does on the board, or null (the key is not the rail's). A single letter acts only while focus is
 * in the board, no text is being typed and no card is focused; no tool uses A or D (they decide cards), Enter, or a
 * modifier. Esc returns to Select. ⌘0 / Ctrl+0 fits everything (the engine's own ⌘+, ⌘− and undo keys are left to it).
 */
export function railKeyAction(e: RailKey, ctx: RailKeyContext): RailAction | null {
  if (ctx.cardFocused || !ctx.boardFocused || ctx.editingText) return null;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '0') return { type: 'fit' };
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === 'Escape') return { type: 'tool', tool: 'select' };
  if (e.key.length !== 1) return null;
  const t = RAIL_TOOLS.find((x) => x.letter === e.key.toUpperCase());
  return t ? { type: 'tool', tool: t.tool } : null;
}

/**
 * Heights the rail needs (design `short_windows`, measured there): whole, and once + and − have gone into the
 * percent key's menu. Each tool folded after that saves a 32px row, and a group that empties saves its 9px tick.
 */
export const RAIL_HEIGHT = { whole: 472, noZoomKeys: 408, row: 32, tick: 9 } as const;
/** Tools fold from the bottom of the list, in this order, into the ⋯ key. */
export const RAIL_FOLD_ORDER: readonly BoardTool[] = ['stroke', 'frame', 'arrow', 'ellipse', 'rect'];
/** The height the rail needs with `n` tools folded (1 to 5): 367, 335, 303, 271, 230. */
export const railNeed = (n: number): number => RAIL_HEIGHT.noZoomKeys - RAIL_HEIGHT.row * n - RAIL_HEIGHT.tick * ((n >= 1 ? 1 : 0) + (n >= 5 ? 1 : 0));

export interface RailLayout {
  /** + and − are their own keys (else they are in the percent key's menu) */
  zoomKeys: boolean;
  /** Hand is its own key (else it is in the ⋯ menu; Space still pans) */
  hand: boolean;
  /** tools drawn as keys, top down */
  visible: BoardTool[];
  /** tools in the ⋯ menu, top down ([] means no ⋯ key) */
  folded: BoardTool[];
}

/**
 * How the rail is drawn in `height` px (design `short_windows`). It never scrolls. Under 472: + and − go into the
 * percent key's menu. Under 408: Hand goes into the ⋯ key, and tools fold into it from the bottom of the list, as
 * many as needed. A folded tool that is chosen takes the last visible tool slot. Select, Sticky, Text, ⋯,
 * line-and-fill and the percent are always there.
 */
export function railLayout(height: number, chosen: BoardTool = 'select'): RailLayout {
  const all = RAIL_GROUPS.flat();
  if (height >= RAIL_HEIGHT.whole) return { zoomKeys: true, hand: true, visible: all, folded: [] };
  if (height >= RAIL_HEIGHT.noZoomKeys) return { zoomKeys: false, hand: true, visible: all, folded: [] };
  let n = 1;
  while (n < RAIL_FOLD_ORDER.length && railNeed(n) > height) n++;
  const out = new Set<BoardTool>(RAIL_FOLD_ORDER.slice(0, n));
  let visible = all.filter((t) => !out.has(t));
  if (out.has(chosen)) {
    // the chosen tool takes the last visible tool slot; a foldable tool it displaces folds in its place
    const last = visible[visible.length - 1]!;
    if (RAIL_FOLD_ORDER.includes(last)) {
      visible = [...visible.slice(0, -1), chosen];
      out.add(last);
    } else visible = [...visible, chosen];
    out.delete(chosen);
  }
  return { zoomKeys: false, hand: false, visible, folded: [...all.filter((t) => out.has(t)), 'hand'] };
}

/** `100%` for the percent key. */
export const zoomPercent = (zoom: number): string => `${Math.round(zoom * 100)}%`;
