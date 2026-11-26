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
 * What the rail is made of, in px (styles.css `.bd-rail`, `.bd-row`, `.bd-brk`, `.bd-grow`): its top and bottom
 * padding together, a key's row, the gap between any two things in it, a group's tick with its margins, and the least
 * the spacer above the zoom keys takes. `railNeed` adds them up; a real-engine test holds the sum to the paint.
 */
export const RAIL_METRICS = { pad: 16, row: 28, gap: 4, tick: 5, spacer: 4 } as const;
/** The design's measured heights (`short_windows`, `heights`): the whole rail, and once + and − are in the percent key's menu. */
export const RAIL_HEIGHT = { whole: 472, noZoomKeys: 408 } as const;
/** Tools fold from the bottom of the list, in this order, into the ⋯ key. Select never folds by height. */
export const RAIL_FOLD_ORDER: readonly BoardTool[] = ['stroke', 'frame', 'arrow', 'ellipse', 'rect', 'text', 'sticky'];
/** With this many tool slots or more the rail is the design's always-visible set (Select, Sticky, Text) or fuller. */
export const RAIL_ALWAYS_SLOTS = 3;

export interface RailLayout {
  /** + and − are their own keys (else they are in the percent key's menu) */
  zoomKeys: boolean;
  /** Hand is its own key (else it is in the ⋯ menu; Space still pans) */
  hand: boolean;
  /** tools drawn as keys, top down */
  visible: BoardTool[];
  /** tools in the ⋯ menu, top down ([] means no ⋯ key) */
  folded: BoardTool[];
  /** the shortest rail: no ticks and no spacer (its graduations stay: design `fold.tight`) */
  tight: boolean;
  /**
   * A chosen folded tool standing in the last slot (design `fold.guest_tick`): `tool` stands in the row of `for`, the
   * tool it displaced, inside that group's ticks. It brings no tick of its own, so the rail's need is the need of the
   * unchosen layout. Absent when every visible tool is in its own place.
   */
  guest?: { tool: BoardTool; for: BoardTool };
}

/** The visible tools as the unchosen layout has them: a guest is counted as the tool whose row it stands in. */
export const railOwnTools = (l: RailLayout): BoardTool[] => l.visible.map((t) => (l.guest && t === l.guest.tool ? l.guest.for : t));
/**
 * The rail's groups as drawn, top down: the groups of the unchosen layout, with a guest in the row of the tool it
 * displaced. A tick is drawn between two of these and never before a guest (design `fold.guest_tick`).
 */
export function railDrawGroups(l: RailLayout): BoardTool[][] {
  const own = railOwnTools(l);
  return RAIL_GROUPS.map((g) => g.filter((t) => own.includes(t)).map((t) => (l.guest && t === l.guest.for ? l.guest.tool : t))).filter((g) => g.length > 0);
}

/** The height a rail drawn as `l` takes: every row, tick and gap of it, and its padding. */
export function railNeed(l: RailLayout): number {
  // the groups of the UNCHOSEN layout: a guest stands inside the displaced tool's group and adds no tick
  const own = railOwnTools(l);
  const groups = RAIL_GROUPS.filter((g) => g.some((t) => own.includes(t))).length;
  const rows = l.visible.length + (l.folded.length ? 1 : 0) + 1 + (l.hand ? 1 : 0) + (l.zoomKeys ? 2 : 0) + 1;
  const ticks = l.tight ? 0 : groups; // one between groups, and one before line-and-fill
  const spacer = l.tight ? 0 : 1;
  const m = RAIL_METRICS;
  return m.pad + rows * m.row + ticks * m.tick + spacer * m.spacer + (rows + ticks + spacer - 1) * m.gap;
}

/** The rail with `slots` tool keys and the rest in ⋯: a folded tool that is chosen takes the last visible slot. */
function folded(slots: number, chosen: BoardTool, tight: boolean): RailLayout {
  const all = RAIL_GROUPS.flat();
  const own = all.slice(0, slots);
  if (!all.includes(chosen) || own.includes(chosen)) return { zoomKeys: false, hand: false, visible: own, folded: [...all.filter((t) => !own.includes(t)), 'hand'], tight };
  const visible = [...own.slice(0, -1), chosen];
  return { zoomKeys: false, hand: false, visible, folded: [...all.filter((t) => !visible.includes(t)), 'hand'], tight, guest: { tool: chosen, for: own[own.length - 1]! } };
}

/**
 * How the rail is drawn in `height` px (design `short_windows`). It never scrolls and is never taller than its room:
 * the fullest of these that fits is drawn. Whole; then + and − go into the percent key's menu; then Hand goes into
 * the ⋯ key and tools fold into it from the bottom of the list, as many as needed, down to Select, Sticky and Text
 * (the design's always-visible set, with ⋯, line-and-fill and the percent). A folded tool that is chosen takes the
 * last visible tool slot.
 *
 * Under 230px (design `fold.steps`) the same fold goes on, Text and then Sticky, and last the ticks and the spacer go
 * (`tight`, 140px): Select (or the chosen tool), ⋯, line-and-fill and the percent. The graduations stay. Every letter
 * still works and every tool is in ⋯. A chosen tool never changes the need: it swaps exactly one key.
 */
export function railLayout(height: number, chosen: BoardTool = 'select'): RailLayout {
  const all = RAIL_GROUPS.flat();
  const steps: RailLayout[] = [
    { zoomKeys: true, hand: true, visible: all, folded: [], tight: false },
    { zoomKeys: false, hand: true, visible: all, folded: [], tight: false },
  ];
  for (let slots = all.length - 1; slots >= 1; slots--) steps.push(folded(slots, chosen, false));
  steps.push(folded(1, chosen, true));
  return steps.find((l) => railNeed(l) <= height) ?? steps[steps.length - 1]!;
}

/** `100%` for the percent key. */
export const zoomPercent = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/**
 * The height of a leaf menu that scrolls (design `menus_scroll`): the cut passes THROUGH A LINE OF TEXT, never
 * between two rows, so a cut row always says there is more. `first` is the distance from the menu's top edge to its
 * first row's top (its border and padding), `pitch` a row and the gap after it, `rows` how many rows it holds, and
 * `tail` what of the cut row shows: half a row for one-line rows (14px of 28), 30px for the Dimensions list's
 * two-line rows (through the second line). Null when the whole menu fits `room` (it does not scroll).
 */
export function menuCutHeight(m: { room: number; natural: number; first: number; pitch: number; rows: number; tail: number }): number | null {
  if (m.natural <= m.room) return null;
  const whole = Math.max(0, Math.min(m.rows - 1, Math.floor((m.room - m.first - m.tail) / m.pitch)));
  return m.first + whole * m.pitch + m.tail;
}
/** what of a cut one-line menu row shows (half of a 28px row) and of a cut two-line Dimensions row (design `menus_scroll`) */
export const MENU_CUT_TAIL = { oneLine: 14, twoLine: 30 } as const;
