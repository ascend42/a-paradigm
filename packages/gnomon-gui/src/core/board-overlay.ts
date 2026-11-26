/**
 * @symbol #gui-board
 *
 * The board's host layer, as arithmetic (design components pin, author-seal, fallback-node). The engine draws marks;
 * pins, seals, an agent text's dashed box and a stub's words are host DOM laid over them in SCREEN space: they track
 * the viewport and never scale with the board. PURE: no DOM. ui/board-leaf.ts places what this file computes.
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { BOARD_WEIGHTS, type BoardAuthor, type BoardMarkView, type BoardTheme, type BoardView } from './board.js';
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
  /** your plain pin, centred on a scrap's top edge (`low`: under 50%, where the night pin fills) */
  | { type: 'pin'; id: string; left: number; top: number; low?: true }
  /** the unknown hand's hollow pin */
  | { type: 'hollow'; id: string; left: number; top: number }
  /** an agent's seal: a scrap's pin head, the top edge of its text, the first point of its stroke or frame, or the first point of its selected drawn mark */
  | { type: 'seal'; id: string; left: number; top: number; seal: Seal; name: string; on: 'pin' | 'text' | 'mark' }
  /** the 6px ring (design author-seal seal.ring): a seal or hollow pin under 50%, and a mark too short to show its dash */
  | { type: 'ring'; id: string; left: number; top: number }
  /** the hand's name as a chip beside its seal or hollow pin, on hover and selection (design author-seal naming) */
  | { type: 'chip'; id: string; left: number; top: number; name: string }
  /**
   * round a text that is not yours: `box` the dashed box with its padding (at 50% and over, and on hover or
   * selection), `tight` the box 2px off the letters (under 50%), `rule` a dashed rule under the text when its
   * letters are under 4px tall on the screen (Aegis, S1.4 P4-design ruling 2: per mark, never by zoom alone)
   */
  | { type: 'textbox'; id: string; left: number; top: number; width: number; height: number; form: 'box' | 'tight' | 'rule' }
  /** a stub's words, over its scrap */
  | { type: 'stub'; id: string; left: number; top: number; width: number; height: number; kind: string; dashed: boolean };

/**
 * The kinds whose stroke the engine draws dashed for a hand that is not yours. It does NOT dash a freehand stroke
 * (a filled outline), a frame (its own fixed edge) or a text (glyphs): for those the mark the host lays over them
 * is the whole distinction, so it is always on, not only while the mark is selected (boards S1.3 pass P3b;
 * test/board-dim.test.ts compares the engine's pixels per kind).
 */
export const ENGINE_DASHES: ReadonlySet<BoardMarkView['kind']> = new Set(['rect', 'sticky', 'ellipse', 'diamond', 'arrow', 'stub', 'stroke', 'frame']);
/**
 * S1.4 P4a: an agent's stroke is the engine's dashed `line` (src/board/dim-map.ts), so it joins the shapes and
 * arrows: its seal is on demand. A frame's edge is dashed by the engine (patch frame-edge-dashed), and its seal is
 * still ALWAYS on its top edge, because a frame's title is the agent's words (design author-seal strokes.agent-frame).
 */
export const SEAL_ALWAYS: ReadonlySet<BoardMarkView['kind']> = new Set(['frame']);
/** Under this zoom (zoom < 0.5, so 50% exactly is a seal) every seal and hollow pin is the ring (design author-seal strokes.low-zoom). */
export const LOW_ZOOM = 0.5;
/** The ring: 6px across (half 3), standing 2px clear of a line, so its centre is 5px off the run. */
export const RING_HALF = 3;
export const RING_OFF = RING_HALF + 2;
/** Agent text whose letters are under this many px tall on the screen gets the rule, not a box (Aegis ruling 2). */
export const TEXT_RULE_PX = 4;
/** The board face's cap height over its size (JetBrains Mono: 730 of 1000 units). */
export const CAP_HEIGHT = 0.73;
/** Under 50% the text box stands this far off the letters. */
export const TEXTBOX_TIGHT = 2;
/** The hover box: a mark's screen box grown by this much. */
export const HOVER_GROW = 4;
/**
 * The screen floor is in force (patch dash-screen-floor: a dash never under 4px on, 3px off on the screen), so a
 * period on the screen is never under 7px and a run under 14px cannot show two (design author-seal strokes.too-small).
 */
export const DASH_FLOOR_RUN_PX = 14;

/** An agent text's box stands this far off the glyphs. */
export const TEXTBOX_PAD = 4;
/** …and this far above them, so the seal on its top edge does not cover the first line (Mika, S1.1 review). */
export const TEXTBOX_TOP = 12;

/** Half of a seal's 22px box, and how far its rim stands off the first point of a drawn mark. */
export const SEAL_HALF = 11;
export const SEAL_GAP = 2;
/** Half of the unknown hand's 8px hollow pin: it stands its own half plus the gap off the mark, not a seal's (it read as detached). */
export const PIN_HALF = 4;
/** A frame narrower than this on screen has no room for its title and a seal on its top edge: the seal stands just outside the right corner. */
export const FRAME_NARROW = 80;

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
export function markSealPoint(m: Pick<BoardMarkView, 'kind' | 'x' | 'y' | 'width' | 'height' | 'firstX' | 'firstY' | 'secondX' | 'secondY'>, view: BoardView, half: number = SEAL_HALF): { left: number; top: number } {
  const box = markBox(view, m);
  const first = toScreen(view, m.firstX, m.firstY);
  let at: { left: number; top: number };
  // (a narrow frame: just outside the right corner, so the seal never meets a long title)
  if (m.kind === 'frame') at = { left: box.width < FRAME_NARROW ? box.left + box.width + half + SEAL_GAP : box.left + box.width - half, top: box.top };
  else {
    const second = m.secondX !== undefined && m.secondY !== undefined ? toScreen(view, m.secondX, m.secondY) : null;
    let ux = second ? first.left - second.left : -1;
    let uy = second ? first.top - second.top : -1;
    const len = Math.hypot(ux, uy);
    if (len === 0) [ux, uy] = [-Math.SQRT1_2, -Math.SQRT1_2];
    else [ux, uy] = [ux / len, uy / len];
    at = { left: first.left + ux * (half + SEAL_GAP), top: first.top + uy * (half + SEAL_GAP) };
  }
  // the part of the mark's box that is in view, grown by the seal's stand-off (a seal rightly stands just outside the box)
  const pad = half + SEAL_GAP;
  const visible = box.left < view.width && box.left + box.width > 0 && box.top < view.height && box.top + box.height > 0;
  if (!visible) return at; // nothing of the mark is in view
  // the seal's centre stays within the grown box AND a whole seal inside the viewport
  const clamp = (v: number, lo: number, hi: number, size: number): number => {
    const a = Math.max(half, lo);
    const b = Math.min(size - half, hi);
    return b < a ? Math.min(size - half, Math.max(half, v)) : Math.min(b, Math.max(a, v));
  };
  return { left: clamp(at.left, box.left - pad, box.left + box.width + pad, view.width), top: clamp(at.top, box.top - pad, box.top + box.height + pad, view.height) };
}

/** The engine width of a mark's weight (a mark view with no width is drawn fine). */
const widthOf = (m: Pick<BoardMarkView, 'strokeWidth'>): number => (typeof m.strokeWidth === 'number' && m.strokeWidth > 0 ? m.strokeWidth : BOARD_WEIGHTS.fine);

/**
 * True when a mark's dashed run is shorter than TWO PERIODS of its own dash (design author-seal strokes.too-small):
 * a period is 5 times the weight in board units (2w on, 3w off), so fine under 20, bold under 40, marker under 80.
 * The run is an open mark's (stroke, arrow) longer box side and a closed mark's shorter side. With the screen floor
 * in force the same run is also compared on the screen, with 14px: the one closed-mark (and open-mark) rule in px.
 */
export function tooSmall(m: Pick<BoardMarkView, 'kind' | 'width' | 'height' | 'strokeWidth'>, zoom: number): boolean {
  const open = m.kind === 'stroke' || m.kind === 'arrow';
  const run = (open ? Math.max(m.width, m.height) : Math.min(m.width, m.height)) * zoom;
  // a frame's dash is 6 on, 4 off on the SCREEN whatever its weight (patch frame-edge-dashed)
  if (m.kind === 'frame') return run < 20;
  // (Mika L1) the period exactly as painted: 2w on, 3w off in board units, each part floored at 4px and 3px on the screen
  const wz = widthOf(m) * zoom;
  return run < 2 * (Math.max(2 * wz, 4) + Math.max(3 * wz, 3));
}

/**
 * Where the ring of an arrow or a stroke stands (design author-seal seal.ring, Mika R6 as Luna ruled it): beside the
 * line, 5px off the middle of its first run, square to it, on its upper side (the left side for an upright run),
 * clamped into view. Never at the seal point, which is inside whatever an arrow starts from.
 */
export function lineRingPoint(m: Pick<BoardMarkView, 'firstX' | 'firstY' | 'secondX' | 'secondY' | 'strokeWidth'>, view: BoardView, half: number = RING_HALF): { left: number; top: number } {
  // (Mika R3) measured from the line's EDGE, not its centre: a marker's half width is 4px at 100%
  const off = half + 2 + (widthOf(m) * view.zoom) / 2;
  const a = toScreen(view, m.firstX, m.firstY);
  const b = m.secondX !== undefined && m.secondY !== undefined ? toScreen(view, m.secondX, m.secondY) : a;
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  const len = Math.hypot(dx, dy);
  let nx = len === 0 ? 0 : -dy / len;
  let ny = len === 0 ? -1 : dx / len;
  // the upper side; for an upright run (a normal with no up or down in it) the left side
  if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)) [nx, ny] = [-nx, -ny];
  const at = { left: (a.left + b.left) / 2 + nx * off, top: (a.top + b.top) / 2 + ny * off };
  return { left: Math.min(view.width - half, Math.max(half, at.left)), top: Math.min(view.height - half, Math.max(half, at.top)) };
}
/** (Mika R1) where a hovered or selected stroke's or arrow's seal or hollow pin stands: beside its first run, as the ring, never on the line or inside the shape an arrow starts from. */
export const lineSealPoint = (m: Pick<BoardMarkView, 'firstX' | 'firstY' | 'secondX' | 'secondY' | 'strokeWidth'>, view: BoardView, half: number): { left: number; top: number } => lineRingPoint(m, view, half);

/** The on-screen height of a text mark's letters. */
export const letterPx = (m: Pick<BoardMarkView, 'textSize'>, zoom: number): number => (typeof m.textSize === 'number' ? m.textSize : 13.5) * zoom * CAP_HEIGHT;

/**
 * The mark the pointer names (design author-seal naming.hover): the TOPMOST mark of a hand that is not the
 * person's whose screen box, grown by 4px, holds the pointer. A label is never one (its mark is). The host's own
 * arithmetic: no engine fact is read. `marks` are in paint order, the last on top.
 */
export function hoveredMark(marks: readonly BoardMarkView[], view: BoardView, pointer: { left: number; top: number } | null): string | null {
  if (!pointer) return null;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]!;
    if (m.labelOf || m.author.cls === 'human') continue;
    const b = markBox(view, m);
    if (pointer.left >= b.left - HOVER_GROW && pointer.left <= b.left + b.width + HOVER_GROW && pointer.top >= b.top - HOVER_GROW && pointer.top <= b.top + b.height + HOVER_GROW) return m.id;
  }
  return null;
}

/** What the overlay is drawn for, beyond the marks and the view. */
export interface OverlayOptions {
  /** the engine id of the mark under the pointer (hoveredMark), if any */
  hovered?: string | null;
  theme?: BoardTheme;
}

/** The chip stands this far to the right of the centre of the seal or hollow pin it names. */
export const CHIP_OFF = SEAL_HALF + 4;
/** The system chip (static/styles.css .chip): mono 10.5 (advance 0.6em), 6px padding, 1px edge, 18px tall. */
export const CHIP_ADVANCE = 6.3;
export const chipWidth = (name: string): number => Math.ceil([...name].length * CHIP_ADVANCE + 2 * 6 + 2);
/** The engine's transform handles (excalidraw 0.18.1 chunk-K2UTITRG.js: `Qp={mouse:8,…}` and the handle margin `l=4` of its handle layout). */
export const ENGINE_HANDLE_SIZE = 8;
export const ENGINE_HANDLE_MARGIN = 4;
/** (Mika L2a) how far below a selected box the engine's selection padding and its handle's half reach. */
export const ENGINE_HANDLE_REACH = ENGINE_HANDLE_MARGIN + ENGINE_HANDLE_SIZE / 2;
/** The chip is 18px tall: its half. */
export const CHIP_HALF = 9;
/**
 * (Mika L2, L2a) a SELECTED shape's seal or hollow pin, and its chip, stand clear of the engine's bottom-right resize
 * handle by 2px: 7px in from the right edge, and below the box by the handle's reach, 2px and the chip's half.
 */
export const SELECTED_OFF = 7;
export const SELECTED_BELOW = ENGINE_HANDLE_REACH + 2 + CHIP_HALF;

/**
 * Everything the host draws over the marks, in paint order. `left`/`top` of a pin, hollow pin, seal or ring is the
 * point it is CENTRED on; a chip's is its left edge and vertical centre. A label (the text inside a sticky or a
 * shape) gets nothing: its scrap or shape carries the hand.
 *
 * Under 50% (design author-seal strokes.low-zoom, rule small-hand-is-a-ring) every seal and hollow pin is the ring
 * and every drawn mark that is not the person's carries one; hover and selection give back the full seal or pin and
 * the name as a chip, at any zoom. A mark too short to show two periods of its dash carries the ring at every zoom.
 */
export function overlayItems(marks: readonly BoardMarkView[], view: BoardView, opts: OverlayOptions = {}): OverlayItem[] {
  const out: OverlayItem[] = [];
  const low = view.zoom < LOW_ZOOM;
  // (Mika R2) the chip is kept whole in view: past the right edge it stands to the LEFT of its seal; its top is clamped
  const chip = (id: string, at: { left: number; top: number }, half: number, name: string): void => {
    const shown = handName(name);
    const w = chipWidth(shown);
    const right = at.left + half + 4;
    const left = right + w > view.width - 4 ? at.left - half - 4 - w : right;
    out.push({ type: 'chip', id, left: Math.max(4, left), top: Math.min(view.height - 9, Math.max(9, at.top)), name });
  };
  const named = (m: BoardMarkView, at: { left: number; top: number }, on: 'pin' | 'text' | 'mark', shown: boolean, half: number): void => {
    if (m.author.cls === 'agent') {
      const name = boardAgentName(m.author.name);
      out.push({ type: 'seal', id: m.id, ...at, seal: sealOf(m.author.id, name), name, on });
      if (shown) chip(m.id, at, Math.max(half, SEAL_HALF), name);
    } else if (m.author.cls === 'unknown') {
      out.push({ type: 'hollow', id: m.id, ...at });
      if (shown) chip(m.id, at, PIN_HALF, 'unknown hand');
    }
  };
  for (const m of marks) {
    if (m.labelOf) continue;
    const box = markBox(view, m);
    const hand = handOf(m.author);
    const shown = hand !== 'you' && (m.selected || m.hovered === true || opts.hovered === m.id);
    const head = { left: box.left + box.width / 2, top: box.top };
    if (m.kind === 'stub') out.push({ type: 'stub', id: m.id, ...box, kind: m.stubKind ?? '', dashed: hand !== 'you' });
    if (isScrap(m.kind)) {
      if (hand === 'you') out.push({ type: 'pin', id: m.id, ...head, ...(low ? { low: true as const } : {}) });
      else if (low && !shown) out.push({ type: 'ring', id: m.id, ...head });
      else named(m, head, 'pin', shown, SEAL_HALF);
    } else if (m.kind === 'text' && hand !== 'you') {
      // never an empty box and never neither form: box, tight box or rule, each with its seal or ring
      const form: 'box' | 'tight' | 'rule' = shown || !low ? 'box' : letterPx(m, view.zoom) < TEXT_RULE_PX ? 'rule' : 'tight';
      if (form === 'box') {
        out.push({ type: 'textbox', id: m.id, form, left: box.left - TEXTBOX_PAD, top: box.top - TEXTBOX_TOP, width: box.width + 2 * TEXTBOX_PAD, height: box.height + TEXTBOX_TOP + TEXTBOX_PAD });
        named(m, { left: head.left, top: head.top - TEXTBOX_TOP }, 'text', shown, SEAL_HALF);
      } else if (form === 'tight') {
        // (Mika R4) 2px on the sides and the foot; the top gives the ring its half and 2px so it never touches a letter
        const top = RING_HALF + 2;
        out.push({ type: 'textbox', id: m.id, form, left: box.left - TEXTBOX_TIGHT, top: box.top - top, width: box.width + 2 * TEXTBOX_TIGHT, height: box.height + TEXTBOX_TIGHT + top });
        out.push({ type: 'ring', id: m.id, left: head.left, top: box.top - top });
      } else {
        const y = box.top + box.height + 1;
        out.push({ type: 'textbox', id: m.id, form, left: box.left, top: y, width: Math.max(1, box.width), height: 1 });
        out.push({ type: 'ring', id: m.id, left: box.left - RING_OFF, top: y });
      }
    } else if (hand !== 'you') {
      const line = m.kind === 'stroke' || m.kind === 'arrow';
      const pinHalf = hand === 'agent' ? SEAL_HALF : PIN_HALF;
      const selectedAt = (): { left: number; top: number } => ({ left: box.left + box.width - SELECTED_OFF, top: box.top + box.height + SELECTED_BELOW });
      if (shown) named(m, line ? lineSealPoint(m, view, pinHalf) : m.selected && m.kind !== 'frame' ? selectedAt() : markSealPoint(m, view, pinHalf), 'mark', true, pinHalf);
      else if (low || tooSmall(m, view.zoom)) out.push({ type: 'ring', id: m.id, ...(line ? lineRingPoint(m, view) : markSealPoint(m, view, RING_HALF)) });
      else if (SEAL_ALWAYS.has(m.kind) || !ENGINE_DASHES.has(m.kind)) named(m, markSealPoint(m, view, pinHalf), 'mark', false, pinHalf);
    }
  }
  return out;
}

/**
 * The line in the leaf's line while ONE mark of a hand that is not the person's is selected (design author-seal
 * naming.selection): '<name> · ◇ <session>' (the fold carries no time for a mark yet, so no 'hh:mm'). Null for any
 * other selection. The session is cut at 16 characters.
 */
export function selectionLine(marks: readonly BoardMarkView[], sessionName?: SessionNameOf): string | null {
  const picked = marks.filter((m) => m.selected && !m.labelOf);
  if (picked.length !== 1) return null;
  const a = picked[0]!.author;
  if (a.cls === 'human') return null;
  const name = a.cls === 'agent' ? boardAgentName(a.name) : 'unknown hand';
  const session = a.cls === 'agent' && a.session ? sessionLabel(a.session, sessionName) : null;
  return session ? `${name} · ◇ ${session}` : name;
}

/** The page's own name for a host session id, or null when the page does not know that session (never from the fold). */
export type SessionNameOf = (hsid: string) => string | null;
/** The short id shown for a session this page does not know (design author-seal session_hint.unknown_session). */
export const hsidShort = (hsid: string): string => sanitizeDisplayText(String(hsid)).text.replace(/[^A-Za-z0-9-]/g, '').slice(-8);
/** (Mika R5) a session as a line or the foot shows it: its name, cut at 16, or its short id when the page does not know it. */
export const sessionLabel = (hsid: string, sessionName?: SessionNameOf): string => {
  const name = sessionName?.(hsid);
  return name ? sessionShort(name) : hsidShort(hsid);
};
/** A session's name in any line: cut at 16 characters (design author-seal session_hint). */
export const SESSION_MAX = 16;
export const sessionShort = (session: string): string => {
  const clean = sanitizeDisplayText(String(session)).text.replace(/\s+/g, ' ').trim();
  return [...clean].length > SESSION_MAX ? `${[...clean].slice(0, SESSION_MAX - 1).join('')}…` : clean;
};

export { handKey } from './board.js';

export type FootHand = { hand: 'you'; n: number } | { hand: 'agent'; id: string; name: string; n: number; seal: Seal; session?: string } | { hand: 'unknown'; n: number };

/**
 * The hands foot (design board-leaf `anatomy`): 'you <n>' first and always, then each agent in order of first mark,
 * then 'unknown hand <n>' after every named hand. A label is not counted apart from its mark. A hand is its
 * principal plus agent (handKey), so two sessions' agents are two hands; when two agent hands would read the same
 * name, each carries its session (design author-seal session_hint), from the first of its marks.
 */
export function footHands(marks: readonly BoardMarkView[], sessionName?: SessionNameOf): FootHand[] {
  let you = 0;
  let unknown = 0;
  const agents = new Map<string, { name: string; n: number; session?: string }>();
  for (const m of marks) {
    if (m.labelOf) continue;
    if (m.author.cls === 'human') you++;
    else if (m.author.cls === 'unknown') unknown++;
    else {
      const a = agents.get(m.author.id) ?? { name: boardAgentName(m.author.name), n: 0, ...(m.author.session ? { session: m.author.session } : {}) };
      a.n++;
      agents.set(m.author.id, a);
    }
  }
  const names = new Map<string, number>();
  for (const a of agents.values()) names.set(a.name, (names.get(a.name) ?? 0) + 1);
  return [
    { hand: 'you', n: you },
    ...[...agents].map(([id, a]) => ({ hand: 'agent' as const, id, name: a.name, n: a.n, seal: sealOf(id, a.name), ...((names.get(a.name) ?? 0) > 1 && a.session ? { session: sessionLabel(a.session, sessionName) } : {}) })),
    ...(unknown > 0 ? [{ hand: 'unknown' as const, n: unknown }] : []),
  ];
}

/** The longest name shown beside a seal (a bidi-isolated text node; the whole name stays in title=). */
export const HAND_NAME_MAX = 24;
export const handName = (name: string): string => ([...name].length > HAND_NAME_MAX ? `${[...name].slice(0, HAND_NAME_MAX - 1).join('')}…` : name);
