/**
 * @symbol #gui-board
 *
 * The board's host layer, as arithmetic (design components pin, author-seal, fallback-node). The engine draws marks;
 * pins, seals, an agent text's dashed box and a stub's words are host DOM laid over them in SCREEN space: they track
 * the viewport and never scale with the board. PURE: no DOM. ui/board-leaf.ts places what this file computes.
 */
import type { BoardAuthor, BoardMarkView, BoardView } from './board.js';
import { sealOf, type Seal } from './board-seal.js';

/** A scene point on the screen, in px from the board's top-left. */
export const toScreen = (view: BoardView, x: number, y: number): { left: number; top: number } => ({ left: (x + view.scrollX) * view.zoom, top: (y + view.scrollY) * view.zoom });
/** A mark's bounding box on the screen. */
export const markBox = (view: BoardView, m: Pick<BoardMarkView, 'x' | 'y' | 'width' | 'height'>): { left: number; top: number; width: number; height: number } => ({ ...toScreen(view, m.x, m.y), width: m.width * view.zoom, height: m.height * view.zoom });

/** The three hands (design author-seal `grammar`). */
export type Hand = 'you' | 'agent' | 'unknown';
export const handOf = (a: BoardAuthor): Hand => (a.cls === 'human' ? 'you' : a.cls === 'agent' ? 'agent' : 'unknown');
/** Paper sits on the desk and is pinned; ink drawn on the desk is not (design pin `scrap`). */
export const isScrap = (kind: BoardMarkView['kind']): boolean => kind === 'sticky' || kind === 'stub';

export type OverlayItem =
  /** your plain pin, centred on a scrap's top edge */
  | { type: 'pin'; id: string; left: number; top: number }
  /** the unknown hand's hollow pin */
  | { type: 'hollow'; id: string; left: number; top: number }
  /** an agent's seal: a scrap's pin head, the top edge of its text, or the first point of its selected drawn mark */
  | { type: 'seal'; id: string; left: number; top: number; seal: Seal; name: string; on: 'pin' | 'text' | 'mark' }
  /** the dashed box round a text that is not yours (always on) */
  | { type: 'textbox'; id: string; left: number; top: number; width: number; height: number }
  /** a stub's words, over its scrap */
  | { type: 'stub'; id: string; left: number; top: number; width: number; height: number; kind: string; dashed: boolean };

/** An agent text's box stands this far off the glyphs. */
export const TEXTBOX_PAD = 4;
/** …and this far above them, so the seal on its top edge does not cover the first line (Mika, S1.1 review). */
export const TEXTBOX_TOP = 12;

/**
 * Everything the host draws over the marks, in paint order. `left`/`top` of a pin, hollow pin or seal is the point it
 * is CENTRED on. A label (the text inside a sticky or a shape) gets nothing: its scrap or shape carries the hand.
 */
export function overlayItems(marks: readonly BoardMarkView[], view: BoardView): OverlayItem[] {
  const out: OverlayItem[] = [];
  for (const m of marks) {
    if (m.labelOf) continue;
    const box = markBox(view, m);
    const hand = handOf(m.author);
    const head = { left: box.left + box.width / 2, top: box.top };
    if (m.kind === 'stub') out.push({ type: 'stub', id: m.id, ...box, kind: m.stubKind ?? '', dashed: hand !== 'you' });
    if (isScrap(m.kind) || (m.kind === 'text' && hand !== 'you')) {
      if (m.kind === 'text') out.push({ type: 'textbox', id: m.id, left: box.left - TEXTBOX_PAD, top: box.top - TEXTBOX_TOP, width: box.width + 2 * TEXTBOX_PAD, height: box.height + TEXTBOX_TOP + TEXTBOX_PAD });
      const at = m.kind === 'text' ? { left: head.left, top: head.top - TEXTBOX_TOP } : head;
      if (m.author.cls === 'agent') out.push({ type: 'seal', id: m.id, ...at, seal: sealOf(m.author.id, m.author.name), name: m.author.name, on: m.kind === 'text' ? 'text' : 'pin' });
      else out.push({ type: hand === 'you' ? 'pin' : 'hollow', id: m.id, ...at });
    } else if (m.selected && m.author.cls === 'agent') {
      out.push({ type: 'seal', id: m.id, ...toScreen(view, m.firstX, m.firstY), seal: sealOf(m.author.id, m.author.name), name: m.author.name, on: 'mark' });
    } else if (m.selected && hand === 'unknown') out.push({ type: 'hollow', id: m.id, ...toScreen(view, m.firstX, m.firstY) });
  }
  return out;
}

export type FootHand = { hand: 'you'; n: number } | { hand: 'agent'; id: string; name: string; n: number; seal: Seal } | { hand: 'unknown'; n: number };

/**
 * The hands foot (design board-leaf `anatomy`): 'you <n>' first and always, then each agent in order of first mark,
 * then 'unknown hand <n>' after every named hand. A label is not counted apart from its mark.
 */
export function footHands(marks: readonly BoardMarkView[]): FootHand[] {
  let you = 0;
  let unknown = 0;
  const agents = new Map<string, { name: string; n: number }>();
  for (const m of marks) {
    if (m.labelOf) continue;
    if (m.author.cls === 'human') you++;
    else if (m.author.cls === 'unknown') unknown++;
    else {
      const a = agents.get(m.author.id) ?? { name: m.author.name, n: 0 };
      a.n++;
      agents.set(m.author.id, a);
    }
  }
  return [{ hand: 'you', n: you }, ...[...agents].map(([id, a]) => ({ hand: 'agent' as const, id, name: a.name, n: a.n, seal: sealOf(id, a.name) })), ...(unknown > 0 ? [{ hand: 'unknown' as const, n: unknown }] : [])];
}

/** The longest name shown beside a seal (a bidi-isolated text node; the whole name stays in title=). */
export const HAND_NAME_MAX = 24;
export const handName = (name: string): string => ([...name].length > HAND_NAME_MAX ? `${[...name].slice(0, HAND_NAME_MAX - 1).join('')}…` : name);
