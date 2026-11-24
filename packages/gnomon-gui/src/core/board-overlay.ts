/**
 * @symbol #gui-board
 *
 * The board's host layer, as arithmetic (design components pin, author-seal, fallback-node). The engine draws marks;
 * pins, seals, an agent text's dashed box and a stub's words are host DOM laid over them in SCREEN space: they track
 * the viewport and never scale with the board. PURE: no DOM. ui/board-leaf.ts places what this file computes.
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import type { BoardAuthor, BoardMarkView, BoardView } from './board.js';
import { sealOf, type Seal } from './board-seal.js';

/** A scene point on the screen, in px from the board's top-left. */
export const toScreen = (view: BoardView, x: number, y: number): { left: number; top: number } => ({ left: (x + view.scrollX) * view.zoom, top: (y + view.scrollY) * view.zoom });
/** A mark's bounding box on the screen. */
export const markBox = (view: BoardView, m: Pick<BoardMarkView, 'x' | 'y' | 'width' | 'height'>): { left: number; top: number; width: number; height: number } => ({ ...toScreen(view, m.x, m.y), width: m.width * view.zoom, height: m.height * view.zoom });

/** The words the leaf uses for the two hands that are not agents: an agent's name may never read as either. */
export const BOARD_RESERVED_NAMES: readonly string[] = Object.freeze(['you', 'unknown hand', 'unknown']);
/**
 * The name shown for an agent, from its host-stamped id (agents have no display name yet; Aegis, review batch C4).
 * It goes through the ONE contracts sanitizer (hidden, control and bidi characters cannot dress a name up), runs of
 * space become one space, and a name that is empty or reads as `you` or `unknown hand` is shown as `agent <id>`, so
 * no agent can be taken for the person or for nobody. PURE. The seal's text, `title` and `aria-label` all use it.
 */
export function boardAgentName(id: string): string {
  const clean = sanitizeDisplayText(String(id)).text.replace(/\s+/g, ' ').trim();
  if (clean.length === 0) return 'agent (no name)';
  return BOARD_RESERVED_NAMES.includes(clean.toLowerCase()) ? `agent ${clean}` : clean;
}

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
  /** an agent's seal: a scrap's pin head, the top edge of its text, the first point of its stroke or frame, or the first point of its selected drawn mark */
  | { type: 'seal'; id: string; left: number; top: number; seal: Seal; name: string; on: 'pin' | 'text' | 'mark' }
  /** the dashed box round a text that is not yours (always on) */
  | { type: 'textbox'; id: string; left: number; top: number; width: number; height: number }
  /** a stub's words, over its scrap */
  | { type: 'stub'; id: string; left: number; top: number; width: number; height: number; kind: string; dashed: boolean };

/**
 * The kinds whose stroke the engine draws dashed for a hand that is not yours. It does NOT dash a freehand stroke
 * (a filled outline), a frame (its own fixed edge) or a text (glyphs): for those the mark the host lays over them
 * is the whole distinction, so it is always on, not only while the mark is selected (boards S1.3 pass P3b;
 * test/board-dim.test.ts compares the engine's pixels per kind).
 */
export const ENGINE_DASHES: ReadonlySet<BoardMarkView['kind']> = new Set(['rect', 'sticky', 'ellipse', 'diamond', 'arrow', 'stub']);

/** An agent text's box stands this far off the glyphs. */
export const TEXTBOX_PAD = 4;
/** …and this far above them, so the seal on its top edge does not cover the first line (Mika, S1.1 review). */
export const TEXTBOX_TOP = 12;

/** Half of a seal's 22px box, and how far its rim stands off the first point of a drawn mark. */
export const SEAL_HALF = 11;
export const SEAL_GAP = 2;

/**
 * Where the seal or hollow pin of a drawn mark (a stroke, a frame, a selected shape or arrow) is centred, in screen
 * px (Aegis M4, Mika 5). It never sits ON the mark's first point, where it covered the start of a stroke, hid a
 * short one and covered the first letter of a frame's title:
 *  - a stroke or an arrow: 2px clear of the first point, on the far side from the second point;
 *  - a frame: on its top edge, at the right corner (the title is at the left);
 *  - anything else: 2px clear of the first point, up and to the left.
 * It is then CLAMPED into the part of the mark's box that is in view, whenever any part is: a mark whose first
 * point is scrolled off still shows whose it is.
 */
export function markSealPoint(m: Pick<BoardMarkView, 'kind' | 'x' | 'y' | 'width' | 'height' | 'firstX' | 'firstY' | 'secondX' | 'secondY'>, view: BoardView): { left: number; top: number } {
  const box = markBox(view, m);
  const first = toScreen(view, m.firstX, m.firstY);
  let at: { left: number; top: number };
  if (m.kind === 'frame') at = { left: box.left + box.width - SEAL_HALF, top: box.top };
  else {
    const second = m.secondX !== undefined && m.secondY !== undefined ? toScreen(view, m.secondX, m.secondY) : null;
    let ux = second ? first.left - second.left : -1;
    let uy = second ? first.top - second.top : -1;
    const len = Math.hypot(ux, uy);
    if (len === 0) [ux, uy] = [-Math.SQRT1_2, -Math.SQRT1_2];
    else [ux, uy] = [ux / len, uy / len];
    at = { left: first.left + ux * (SEAL_HALF + SEAL_GAP), top: first.top + uy * (SEAL_HALF + SEAL_GAP) };
  }
  // the part of the mark's box that is in view, grown by the seal's stand-off (a seal rightly stands just outside the box)
  const pad = SEAL_HALF + SEAL_GAP;
  const visible = box.left < view.width && box.left + box.width > 0 && box.top < view.height && box.top + box.height > 0;
  if (!visible) return at; // nothing of the mark is in view
  // the seal's centre stays within the grown box AND a whole seal inside the viewport
  const clamp = (v: number, lo: number, hi: number, size: number): number => {
    const a = Math.max(SEAL_HALF, lo);
    const b = Math.min(size - SEAL_HALF, hi);
    return b < a ? Math.min(size - SEAL_HALF, Math.max(SEAL_HALF, v)) : Math.min(b, Math.max(a, v));
  };
  return { left: clamp(at.left, box.left - pad, box.left + box.width + pad, view.width), top: clamp(at.top, box.top - pad, box.top + box.height + pad, view.height) };
}

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
      if (m.author.cls === 'agent') out.push({ type: 'seal', id: m.id, ...at, seal: sealOf(m.author.id, boardAgentName(m.author.name)), name: boardAgentName(m.author.name), on: m.kind === 'text' ? 'text' : 'pin' });
      else out.push({ type: hand === 'you' ? 'pin' : 'hollow', id: m.id, ...at });
    } else if ((m.selected || !ENGINE_DASHES.has(m.kind)) && m.author.cls === 'agent') {
      out.push({ type: 'seal', id: m.id, ...markSealPoint(m, view), seal: sealOf(m.author.id, boardAgentName(m.author.name)), name: boardAgentName(m.author.name), on: 'mark' });
    } else if ((m.selected || !ENGINE_DASHES.has(m.kind)) && hand === 'unknown') out.push({ type: 'hollow', id: m.id, ...markSealPoint(m, view) });
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
      const a = agents.get(m.author.id) ?? { name: boardAgentName(m.author.name), n: 0 };
      a.n++;
      agents.set(m.author.id, a);
    }
  }
  return [{ hand: 'you', n: you }, ...[...agents].map(([id, a]) => ({ hand: 'agent' as const, id, name: a.name, n: a.n, seal: sealOf(id, a.name) })), ...(unknown > 0 ? [{ hand: 'unknown' as const, n: unknown }] : [])];
}

/** The longest name shown beside a seal (a bidi-isolated text node; the whole name stays in title=). */
export const HAND_NAME_MAX = 24;
export const handName = (name: string): string => ([...name].length > HAND_NAME_MAX ? `${[...name].slice(0, HAND_NAME_MAX - 1).join('')}…` : name);
