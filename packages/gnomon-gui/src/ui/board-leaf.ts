/**
 * @symbol #gui-board
 *
 * The board leaf's host layer (boards S1.1 pass B; design components board-leaf, board-rail, content-tray,
 * author-seal, pin, fallback-node, all `proposed`): the head, the keep line, the tool rail, the content tray, the
 * pins, seals and stubs laid over the engine's marks, the hands foot, and the loading, failed, too-short, yielded
 * and empty states. The engine is touched ONLY through the handle of core/board.ts.
 *
 * Mounted in the shipped app by the dock (ui/board-dock.ts, boards S1.3 P4b-1) and by the dev preview fixtures. The
 * engine is never in the app bundle: it arrives through the lazy loader the leaf is handed (the isolation test).
 *
 * No inline style attribute is written: sizes and positions go through CSSOM properties, classes do the rest.
 */
import { CONTENT_DEFAULTS, DIM_FALLBACK_LEAD, DIM_LIMITS, dimKindName, resolveContentColour } from '@a-company/gnomon-contracts';
import type { DimOp, DimState } from '@a-company/gnomon-contracts';
import type { BoardHandle, BoardModule, BoardState, BoardTheme, BoardTool, BoardWeight } from '../core/board.js';
import { DimClipboard, dimPastedWords, dimPasteTextOp } from '../core/dim-clipboard.js';
import { CHECK_GAP, CHECK_LONGEST, countSlot, GRANT_COPY, OUT_OF_DATE_FACT, UNCHECKED_LEAD, BOARD_BODY_MIN, BOARD_MIN_HEIGHT, TOO_SHORT_SPEAK_MS, tooShortLine, failedCause, INERT_COPY, KEEP_COPY, KEEP_SLOW_MS, keepParts, type LeafInert, LEAF_COPY, leafStateOf, LOADING_QUIET_MS, CLIP_COPY, refusalLine, refusalLineOf, type LeafLoad, type LeafState, type OpenedHow } from '../core/board-leaf.js';
import { footHands, handName, hoveredMark, overlayItems, selectionLine, type OverlayOptions } from '../core/board-overlay.js';
import { DIM_GRANT_QUIET_MS } from '../core/dim-session.js';
import { MENU_CUT_TAIL, menuCutHeight, railDrawGroups, railKeyAction, railLayout, railTitle, railTool, zoomPercent, type RailTool } from '../core/board-rail.js';
import { sealOf, SEAL_BEAD_RADIUS, SEAL_CENTRE, SEAL_POLYGONS, SEAL_ROUND_RADIUS, SEAL_VIEWBOX, sealBeadPoint, sealLetterBaseline, type Seal } from '../core/board-seal.js';
import { customEntry, heldRefusals, MARKER_OFF_TITLE, TRAY_FILL, trayRefusalLine, TRAY_LINE, TRAY_WEIGHTS, wellName, type CustomContext } from '../core/board-tray.js';

export interface BoardLeafOptions {
  title: string;
  project: string;
  /** the project swatch's hue class (h0 … h5), as elsewhere in the console */
  projectHue?: string;
  session: string;
  /** (design author-seal session_hint; Mika R5) the page's own name for a host session id, null when it does not know it */
  sessionName?: (hsid: string) => string | null;
  more?: number;
  how: OpenedHow;
  agent?: string;
  /** hh:mm */
  time: string;
  theme: BoardTheme;
  /** the lazy loader of core/board.ts, handed in by whoever opens the leaf; a rejection is the failed state */
  load: () => Promise<BoardModule>;
  /** true while a card in the stack or the pinned zone has focus: the board then takes no key */
  cardFocused: () => boolean;
  /** S1.4 E3: the cut-outs and the trace the overlay draws (the session's), when there are any */
  overlayExtras?: () => Pick<OverlayOptions, 'cutouts' | 'trace'>;
  /** called once the engine is up (the fixture adds its marks here) */
  onReady?: (handle: BoardHandle) => void;
  /** Esc with nothing else to leave, or the head's esc key: with the trusted event that asked (the fold's gesture stamp is minted from it) */
  onFold?: (cause: Event) => void;
  /**
   * The dimension as the leaf's owner holds it now (the live controller's view; the fixture's fold). A copy reads
   * the copied nodes from it and a paste is placed on top of it. Without it nothing is copied and nothing pasted.
   */
  view?: () => DimState | null;
  /**
   * Ops the PERSON made outside a drawing gesture (a paste of the leaf's own copy, a pasted text), with the trusted
   * event that caused them. The owner sends them through the SAME path as the handle's `onEdit` ops (one sender,
   * one validator); the leaf applies nothing itself.
   */
  onOps?: (ops: DimOp[], cause: Event | null) => void;
  /** A new node id (a ULID) for each pasted mark; the leaf mints its own when none is given. */
  mint?: () => string;
  /**
   * The head's `Dimensions ▾` key (design board-leaf anatomy: "this project's dimensions, the same list as /boards"),
   * with the press that asked. Without it (the dev fixtures) the key is drawn disabled.
   */
  onDimensions?: (cause: Event) => void;
  /** The leaf began or stopped holding words while too short (aegis F5): the check's words depend on it. */
  onHoldChange?: () => void;
  /** How many cards are pinned in this session now: the too-short line names deciding one only when there is one (design `too_short.line`). */
  pinned?: () => number;
  /**
   * S1.4 P4b: the draw keys of the hands foot (design components.draw-grant), one per ATTACHED session in attach
   * order, as the live loop last confirmed them (core/dim-session.ts grantKeys) with each hand's name. Without it
   * the foot draws no key.
   */
  grants?: () => LeafGrant[];
  /** A press on a draw key: the TRUSTED pointer, or Space / Enter on the key itself (never anything else). */
  onGrant?: (hsid: string, cause: Event) => void;
  /** True while show chat does NOT fold the board (held still with words or unsaved changes): the head's esc is then the pointer's only fold and never leaves the head (design widths_narrow.luna_final.H1). */
  kept?: () => boolean;
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A new node id (a ULID, `DIM_NODE_ID_PATTERN`): the time, then 80 bits from `crypto.getRandomValues`. */
function mintNodeId(): string {
  let t = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = B32[t % 32] + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (const b of crypto.getRandomValues(new Uint8Array(16))) tail += B32[b % 32];
  return head + tail;
}

/** One draw key as the leaf draws it: core/dim-session.ts DimGrantKey plus the hand's name (and a local model's flag). */
export interface LeafGrant {
  hsid: string;
  write: boolean;
  state: 'live' | 'pending' | 'busy' | 'down' | 'unknown' | 'idle' | 'unsure';
  since: number | null;
  /** the session's agent: 'Claude' (named from the SESSION, never from a mark, so a first mark never resizes it) */
  name: string;
  /** the session's name, shown when two hands would read the same (author-seal session_hint) */
  session?: string | null;
  /** a local model session: its hand reads "can't draw on a board yet" and has no key (draw-grant no-key) */
  local?: boolean;
}

export interface BoardLeaf {
  /** S1.4 E3: focus goes to the board (a focused strip key's row left) */
  focusBoard?(): void;
  /** S1.4 E3: draw the overlay again (the notices' cut-outs or trace moved) */
  redrawOver?(): void;
  el: HTMLElement;
  /** S1.4 P4b: one line to a screen reader only (the polite status line), never the keep line: the arrival line, a confirmed grant */
  speak(line: string): void;
  /** S1.4 P4b: draw the foot again (the grants changed) */
  drawFoot(): void;
  handle(): BoardHandle | null;
  state(): LeafState;
  setTheme(theme: BoardTheme): void;
  /** load again from scratch (the head's Try again) */
  retry(): void;
  /** Say one line in the keep line's place and to a screen reader (a notice of the live loop, in the leaf's own words). */
  say(line: string): void;
  /** Held still: say the held line again (an Esc from outside the leaf that must not fold it). Nothing when not held. */
  sayHeld(): void;
  /** Too short with words in an open text (design too_short, aegis C3_2): a fold now would lose them, so none folds it. */
  holdsWords(): boolean;
  /** The height the board has now (the leaf less its head, keep line and foot): #gui-board-turn's room. */
  room(): number;
  /** Forget the copy register (the kernel link went down). */
  forget(): void;
  /**
   * Hold the board still and say why for as long as it lasts (the link is down; the fold is out of date), or let it
   * go (null). The picture stays; the rail is dimmed; no press, drag, paste or key draws anything; the line stays in
   * the keep line's place and is announced once.
   */
  setInert(why: LeafInert | null): void;
  /** The live loop's keep state in the keep line's place (core/board-leaf.ts `keepStateLine`: `Saving…`, a board held in part), or null for the usual keep line. A save is shown only once it is slow. */
  setKeep(line: string | null): void;
  /** The dimension's title once the fold holds it (the head, its title= and the region's names). */
  setTitle(title: string): void;
  /**
   * The check (core/board-leaf.ts `checkLine`): at the foot's right end when its longest wording and its gap fit after
   * the hands (design check.place), else not; `bad` draws it in --fail. `title` is the log's rows (C1.7); `open`: the
   * board is open, so an unchecked board leads the line under the head when the check is not in the foot (C2.2).
   */
  setCheck(line: string, tone?: 'ok' | 'none' | 'bad', o?: { title?: string; open?: boolean }): void;
  /** True while the check is drawn in the foot (tests). */
  checkShown(): boolean;
  /** Other words for the held-still line while it lasts (`Not saved · reconnecting` when something is pending), or null for its own. */
  setInertLine(line: string | null): void;
  /**
   * The words of a text being typed on the board now, or null when none is open. Read through the paste sanitizer
   * and cut to the text limit: page memory only (Aegis, option b). Nothing is committed and the engine is not told.
   */
  typed(): string | null;
  /**
   * Put held words back into a text the PERSON has just opened and not typed in: true when they went in. Never
   * opens an edit and never commits one: the person's next trusted press or key does that.
   */
  putTyped(words: string): boolean;
  /**
   * Empty the open text without committing it (a switch that has already said the words are gone): the blur that
   * follows then has nothing to store, so the line "weren't saved" is never false (aegis re-check of F1).
   */
  clearTyped(): void;
  /** Be told when the person opens a text on the board (the field took focus). Returns the unsubscribe. */
  onTextOpen(listener: () => void): () => void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** the foot's height, its dashed rule included (styles.css .bd-foot: 32px, border-box) */
const FOOT_HEIGHT = 32;
/** design hands_foot.overflow (1): a session's name in the foot is cut down to this many characters before it goes */
const SESSION_FLOOR = 5;
type Attrs = Record<string, string | number | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', attrs: Attrs = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : String(v));
  e.append(...kids);
  return e;
}
function svg(tag: string, attrs: Attrs = {}, ...kids: Array<Node | string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

function glyph(t: RailTool): SVGElement {
  return svg(
    'svg',
    { class: 'bd-i', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
    ...t.paths.map((d) => svg('path', { d })),
    ...(t.ellipse ? [svg('ellipse', t.ellipse)] : []),
    ...(t.dot ? [svg('circle', { ...t.dot, class: 'solid' })] : []),
  );
}

/** A seal, 22 square on screen (the 18 box plus the overhang of the diamond, the hex and a bead on a point). */
export function sealElement(seal: Seal, name: string, cls = ''): SVGElement {
  const cut = seal.cut === 'round' ? svg('circle', { class: 'sl-cut', cx: SEAL_CENTRE, cy: SEAL_CENTRE, r: SEAL_ROUND_RADIUS }) : svg('polygon', { class: 'sl-cut', points: SEAL_POLYGONS[seal.cut].map((p) => p.join(',')).join(' ') });
  const bead = sealBeadPoint(seal.cut, seal.bead);
  return svg('svg', { class: `bd-seal ${cls}`.trim(), viewBox: SEAL_VIEWBOX, width: 22, height: 22, role: 'img', 'aria-label': name }, cut, svg('text', { x: SEAL_CENTRE, y: sealLetterBaseline(seal.cut), 'text-anchor': 'middle' }, seal.letter), svg('circle', { class: 'sl-bead', cx: bead.x, cy: bead.y, r: SEAL_BEAD_RADIUS }));
}

/** the marks that carry a fill (a label is never one) */
const FILL_MARKS: ReadonlySet<string> = new Set(['sticky', 'rect', 'ellipse', 'diamond']);
/** the overlay's element names the mark it signs (data-for): the goldens check each sign is inside the leaf */
const forMark = <T extends HTMLElement | SVGElement>(e: T, id: string): T => (e.setAttribute('data-for', id), e);
const place = (e: HTMLElement | SVGElement, left: number, top: number): void => void (e.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`);
/** The platform's own shortcut modifier is ⌘ on macOS (the console is desktop only: Mac first, Windows later). */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const isField = (n: Element | null): boolean => !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA');

export function mountBoardLeaf(parent: HTMLElement, o: BoardLeafOptions): BoardLeaf {
  let handle: BoardHandle | null = null;
  let load: LeafLoad = 'loading';
  let cause = '';
  let theme = o.theme;
  let trayOpen = false;
  let menu: 'more' | 'zoom' | null = null;
  let quiet = true;
  let said = '';
  let saidTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const offs: Array<() => void> = [];
  // The copy register (core/dim-clipboard.ts; condition C8, Aegis A6): ONE per leaf, in memory only. A copy on the
  // board remembers the selected nodes and answers the plain text for the system clipboard; a paste of that same
  // text adds clones as the person's own ops; any other pasted text becomes one text mark. It is forgotten on window
  // blur, when the leaf goes, and on a copy or cut anywhere else on the page. So a copy that had words, pasted
  // after a blur, arrives as those bare words (fail-safe: decided here, for Aegis to confirm), and the stand-in line
  // of a wordless copy pasted with nothing held adds nothing and says so.
  const clip = new DimClipboard();
  const forget = (): void => clip.clear();
  window.addEventListener('blur', forget);
  const copied = (ids: string[]): string => {
    const view = o.view?.() ?? null;
    if (!view) return clip.clear(), '';
    const r = clip.copy(view, ids);
    if (r.skipped > 0) say(CLIP_COPY.leftOut(r.skipped)); // what was left out is said, never silent
    return r.text;
  };
  /** A cut takes the WHOLE selection (a frame's children with it) or nothing: the handle deletes exactly `ids`. */
  const cutTaken = (ids: string[]): { text: string; ids: string[] } | null => {
    const view = o.view?.() ?? null;
    if (!view) return clip.clear(), null;
    const r = clip.copy(view, ids);
    if (r.copied === 0) return null;
    if (r.skipped > 0) return clip.clear(), say(CLIP_COPY.cutRefused), null;
    return { text: r.text, ids: r.ids };
  };
  // ONE step for pastes made one after another, words and clones alike: each sits a step down and right of the
  // last. It starts again after any other action (a press, a key that is not the paste's own), when the view moves,
  // and when something else is pasted.
  let pasteStep = -1;
  let pastedAt = '';
  let pastedText = '';
  const otherAction = (e: Event): void => {
    if (e instanceof KeyboardEvent && (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v'))) return;
    pasteStep = -1;
  };
  const pasted = (hd: BoardHandle, text: string, cause: Event): void => {
    const view = o.view?.() ?? null;
    if (!view || !o.onOps) return;
    const v = hd.view();
    const box = { x: -v.scrollX, y: -v.scrollY, w: v.width / v.zoom, h: v.height / v.zoom };
    const where = `${v.scrollX},${v.scrollY},${v.zoom}`;
    const step = where === pastedAt && text === pastedText ? pasteStep + 1 : 0;
    const r = clip.paste(text, view, o.mint ?? mintNodeId, box, { repeat: step });
    if (r.kind === 'nothing-held') return say(refusalLine('clipboard'));
    // the length is checked AFTER the words are cleaned (Aegis N1): a bidi control becomes a visible glyph, so
    // cleaned words can be longer than what was pasted, and a text over the limit would fail at the validator unsaid
    if (r.kind === 'text' && dimPastedWords(text).length > DIM_LIMITS.text) return say(refusalLineOf({ what: 'text', why: 'too-long', detail: String(DIM_LIMITS.text) }));
    pasteStep = step;
    pastedAt = where;
    pastedText = text;
    // what was pasted is what is selected afterwards (the originals used to stay selected: Delete took THEM)
    const sent = (ops: DimOp[]): void => {
      o.onOps!(ops, cause);
      if (hd.isAlive()) hd.select(ops.flatMap((op) => (op.type === 'add' ? [op.node.id] : [])));
    };
    if (r.kind === 'clones') return void (r.ops.length > 0 && sent(r.ops));
    // a text pasted again with the view where it was steps down and right, so it never sits exactly on the last one
    const op = dimPasteTextOp(text, view, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, o.mint ?? mintNodeId, { repeat: step, top: box.y });
    if (op) sent([op]);
  };

  // ── the frame ────────────────────────────────────────────────────────────
  const titleEl = h('span', 'title', { title: o.title }, o.title);
  const headKey = h('button', 'key quiet', { type: 'button' });
  const escKey = h('button', 'key quiet', { type: 'button', title: 'Fold to the edge tab (Esc)' }, 'esc');
  const glyphEl = h('span', 'bd-g', { 'aria-hidden': 'true' }, '◰');
  const head = h('div', 'lp-head bd-head', {}, glyphEl, titleEl, h('span', 'bd-medium', {}, LEAF_COPY.medium), h('button', 'key quiet rename-btn', { type: 'button', 'aria-label': 'Rename dimension', 'aria-disabled': 'true', title: 'Rename is not built yet' }, '✎'), h('span', 'spacer'), headKey, escKey);
  const keep = h('div', 'lp-keep bd-keep');
  const rail = h('div', 'bd-rail', { role: 'radiogroup', 'aria-label': 'Board tools', 'aria-orientation': 'vertical' });
  // the drawing surface is one region with a name; its description is the empty note's hint (design `tab_order`)
  const boardHost = h('div', 'bd-board', { role: 'application', 'aria-roledescription': 'board', 'aria-label': `Board: ${o.title}`, 'aria-description': LEAF_COPY.emptyHint });
  // what the board refused is said here, under the head, and announced
  // always in the tree, so a screen reader hears each refusal; the keep line shows the same words
  const saidLine = h('span', 'sr-only', { role: 'status', 'aria-live': 'polite' });
  const over = h('div', 'bd-over', { 'aria-hidden': 'true' });
  const tray = h('div', 'bd-tray', { role: 'group', 'aria-label': 'Line and fill', hidden: true });
  // Mika P0b P1: a key that takes focus in the tray is scrolled into the tray's view, so focus is never hidden
  tray.addEventListener('focusin', (e) => (e.target as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
  const note = h('div', 'bd-scrap bd-note', { hidden: true });
  const stage = h('div', 'bd-stage', {}, boardHost, over, tray, note);
  const foot = h('div', 'bd-foot', { 'aria-label': 'Hands on this board' });
  // (mika 2: the check's place is on the root from the first draw, as data-check is)
  const el = h('div', 'bd-leaf', { role: 'region', 'aria-label': `Dimension: ${o.title}`, 'data-check-place': 'list' }, head, keep, saidLine, h('div', 'bd-body', {}, rail, stage), foot);
  parent.appendChild(el);

  const st = (): BoardState | null => (handle && handle.isAlive() ? handle.state() : null);
  const leafState = (): LeafState => leafStateOf({ load, alive: !handle || handle.isAlive(), boardHeight: boardHeight(), cardFocused: o.cardFocused(), marks: st()?.marks ?? 0 });
  /** the height the board has (or would have, when the body is hidden): the leaf less its head, keep line and foot */
  const boardHeight = (): number => Math.max(0, el.clientHeight - head.offsetHeight - keep.offsetHeight - FOOT_HEIGHT);
  /** under the least height a board can be drawn on, whatever the state: the body and the foot are not drawn */
  const short = (): boolean => boardHeight() < BOARD_MIN_HEIGHT;
  let inert: LeafInert | null = null;
  let inertLine: string | null = null;
  let inertSaid: string | null = null;
  let inertSaidTimer: ReturnType<typeof setTimeout> | undefined;
  const inertWords = (): string => (inert ? (inertSaid ?? inertLine ?? INERT_COPY[inert]) : '');
  /** One line said while the board is held still (in the held-still line's place, for a few seconds, and announced). */
  const sayHeld = (text: string): void => {
    inertSaid = text;
    saidLine.textContent = text;
    clearTimeout(inertSaidTimer);
    inertSaidTimer = setTimeout(() => ((inertSaid = null), draw()), 4000);
    draw();
  };
  let keepLine: string | null = null;
  let keepShown: string | null = null;
  let keepTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Too short to draw on (design `too_short`, aegis C3_3): the board is SHOWN and held still for its own reason. Its
   * own flag, never `inert` (that is the dock's one slot for the link and a mismatch): the head keys, the fold and
   * the foot keep working. Set by `draw` from the board's height, so it follows every resize.
   */
  let tooShort = false;
  let tooShortSpokeAt = -Infinity;
  /** a trusted press on the board has not been released yet: a drag or a stroke in hand (aegis C3_5) */
  let pressing = false;
  /** the board takes no input: a card has the keys, the board is held still, or it is too short to draw on */
  const yielded = (): boolean => load === 'ready' && (o.cardFocused() || inert !== null || tooShort);
  /** too short with words held in an open text: no fold may take them (aegis C3_2; ruled: the kept-open guard) */
  const holdsWords = (): boolean => tooShort && !!boardField()?.value;
  /** A fold the person asked for in the leaf (Esc, the head's esc key): refused, and the held line said, while words are held. */
  // (aegis F3: an out-of-date board can never store the words, and its line says "fold it": the fold goes ahead and
  // the dock says the words are gone)
  const foldAsk = (e: Event): void => (holdsWords() && inert !== 'out-of-date' ? say(shortLine()) : o.onFold?.(e));
  /** the too-short line now: words held in an open text first, then whether a card is pinned */
  const shortLine = (): string => tooShortLine({ pinned: o.pinned?.() ?? 0, words: !!boardField()?.value });
  const colour = (token: string | null, role: 'line' | 'fill'): string => (token === null ? 'transparent' : (resolveContentColour(token, role, theme) ?? 'transparent'));

  // ── head and keep line ───────────────────────────────────────────────────
  function drawHead(state: LeafState): void {
    keepResting = false;
    const failed = state === 'failed';
    headKey.textContent = failed ? LEAF_COPY.tryAgain : LEAF_COPY.dimensions;
    // the key opens the same list as /boards (the design's words); a leaf nobody gave a list to draws it disabled
    headKey.title = failed ? '' : o.onDimensions ? LEAF_COPY.dimensionsTitle : 'Type /boards for this project’s dimensions';
    if (failed || o.onDimensions) headKey.removeAttribute('aria-disabled');
    else headKey.setAttribute('aria-disabled', 'true');
    if (!failed && o.onDimensions) headKey.setAttribute('aria-haspopup', 'dialog');
    else headKey.removeAttribute('aria-haspopup');
    // Mika R2: a line that STATES something in the keep line's place draws in ink (marks missing, part of the board,
    // words waiting), as the refusals and the held-still lines do; opening, folding and saving pass by quietly
    const stated = keepShown !== null && keepShown !== KEEP_COPY.opening && keepShown !== KEEP_COPY.folding && keepShown !== KEEP_COPY.saving;
    keep.className = `lp-keep bd-keep${state === 'yielded' ? ' bd-yield' : ''}${said || inert || stated || state === 'too-short' ? ' bd-said-line' : ''}`;
    keep.replaceChildren();
    // held still: its line stays for as long as it lasts, over anything else the keep line would say
    if (inert && state !== 'failed' && state !== 'loading') {
      keep.title = inertWords();
      // the mismatch's FACT in --fail at 500, the rest in ink (design check.signs.mismatch)
      const w = inertWords();
      if (inert === 'out-of-date' && w.startsWith(OUT_OF_DATE_FACT)) return void keep.append(h('span', 'bd-fail-fact', {}, OUT_OF_DATE_FACT), w.slice(OUT_OF_DATE_FACT.length));
      return void keep.append(w);
    }
    // what the board refused is said in the keep line's place (as the yielded line is), so nothing below moves
    if (said && state !== 'failed' && state !== 'loading') {
      keep.title = said;
      return void keep.append(said);
    }
    // too short to hold the failed note: the head keeps the Try again key and this one line says what and why
    if (state === 'failed' && short()) {
      keep.title = `${LEAF_COPY.failedTitle} · ${cause}`;
      return void keep.append(keep.title);
    }
    // open, unchecked and the check not in the foot: 'not checked yet · ' leads lines 3 to 7 (design check.signs.unchecked)
    const lead0 = checkOpen && checkTone === 'none' && !checkInFoot && state !== 'loading';
    // mika 1 (ruled): on the two lines about missing marks the lead goes AFTER the fact, so the fact survives the cut
    // at 303px ('Earlier marks aren't shown here · not checked yet · …'); before every other line, as ruled
    const missing = state !== 'too-short' && state !== 'yielded' && (keepShown === KEEP_COPY.partial || keepShown === KEEP_COPY.dropped);
    const lead = lead0 && !missing;
    if (lead) {
      const stated = state === 'too-short' || state === 'yielded' || !!keepShown && keepShown !== KEEP_COPY.opening && keepShown !== KEEP_COPY.folding && keepShown !== KEEP_COPY.saving;
      keep.append(stated ? UNCHECKED_LEAD.stated : UNCHECKED_LEAD.quiet);
    }
    const led = (t: string): string => (lead ? (keep.textContent ?? '') + t : t);
    // one line, cut from its end with …; the whole text is always in title=
    keep.title = state === 'loading' ? '' : state === 'too-short' ? shortLine() : state === 'yielded' ? LEAF_COPY.yielded : '';
    if (state === 'loading') return void keep.append(quiet ? '' : LEAF_COPY.loading);
    if (state === 'too-short') return void ((keep.title = led(shortLine())), keep.append(shortLine()));
    if (state === 'yielded') return void ((keep.title = led(`◆ ${LEAF_COPY.yielded}`)), keep.append(h('span', 'bd-yield-m', { 'aria-hidden': 'true' }, '◆'), ` ${LEAF_COPY.yielded}`));
    // the live loop's own state (a slow save, a board held in part) takes the keep line's place while it lasts
    if (keepShown) {
      const shown = lead0 && missing ? keepShown.replace(' · ', ` · ${UNCHECKED_LEAD.quiet}`) : keepShown;
      keep.title = led(shown);
      return void keep.append(shown);
    }
    // one selected mark of another hand: its whole line takes the RESTING line's place only (design author-seal naming.selection)
    selLine = handle && handle.isAlive() ? selectionLine(handle.marks(), o.sessionName) : null;
    keepResting = true;
    if (selLine) {
      keep.title = selLine;
      return void keep.append(h('bdi', '', {}, selLine));
    }
    const k = keepParts(o);
    const text = `dimension in ${k.project} · attached ◇ ${k.session} · ${k.opened} · ${k.time}`;
    keep.title = led(text);
    keep.append('dimension in ', h('span', `swatch ${o.projectHue ?? 'h0'}`), ` ${k.project} · attached ◇ ${k.session} · ${k.opened} · ${k.time}`);
  }

  /**
   * The narrow head (design widths_narrow, luna_final H1 and H2): ornament goes before a control and the title last.
   * '› board' goes under 520px (styles.css). Then ONE draw: the glyph and esc are put back, the title measured with the
   * head's own paint, and they are dropped in order while the title would still be cut: the ◰ glyph, then (in a leaf
   * under 340px, and only while show chat folds) the esc key. Then the title is cut with …. Rename and Dimensions never go.
   */
  const HEAD_ESC_MIN = 340;
  function fitHead(): void {
    glyphEl.style.display = '';
    escKey.style.display = '';
    const cut = (): boolean => titleEl.scrollWidth > titleEl.clientWidth + 0.5;
    if (!cut()) return;
    glyphEl.style.display = 'none';
    if (cut() && el.getBoundingClientRect().width < HEAD_ESC_MIN && !(holdsWords() || o.kept?.())) escKey.style.display = 'none';
  }

  // ── the rail ─────────────────────────────────────────────────────────────
  function act(run: () => void, press?: Event): void {
    // while a card has the keys the first press only wakes the board: focus moves, nothing is chosen or drawn
    if (yielded()) {
      if (!press || press.isTrusted) handle?.focus();
      return;
    }
    run();
  }
  const row = (letter: string, key: HTMLElement, ...extra: Node[]): HTMLElement => h('span', 'bd-row', {}, h('kbd', '', {}, letter), key, ...extra);
  function toolKey(t: RailTool, s: BoardState | null, off: boolean): HTMLElement {
    const on = s?.tool === t.tool;
    const b = h('button', `key quiet seg-key bd-tool${on && !off ? ' current' : ''}`, { type: 'button', role: 'radio', 'aria-checked': on && !off ? 'true' : 'false', 'aria-disabled': off ? 'true' : undefined, title: t.tool === 'hand' ? 'Hand: drag to move the view (H, or hold Space)' : railTitle(t), 'aria-label': t.name.replace(' · connect', ''), tabindex: on || (!s && t.tool === 'select') ? 0 : -1, 'data-tool': t.tool, 'data-key': `tool:${t.tool}` });
    b.append(glyph(t));
    b.addEventListener('click', (e) => act(() => chooseTool(t.tool), e));
    return b;
  }
  const quietKey = (cls: string, label: string, title: string, off: boolean, run: (e: Event) => void, attrs: Attrs = {}): HTMLElement => {
    const b = h('button', `key quiet ${cls}`, { type: 'button', title, 'aria-disabled': off ? 'true' : undefined, tabindex: -1, ...attrs }, label);
    b.addEventListener('click', (e) => (off ? act(() => undefined, e) : act(() => run(e), e)));
    return b;
  };
  function menuOf(items: Array<{ label: string; letter?: string; glyph?: SVGElement; run: () => void }>): HTMLElement {
    const m = h('div', 'bd-menu', { role: 'menu' });
    for (const it of items) {
      const b = h('button', 'bd-mi', { type: 'button', role: 'menuitem' }, ...(it.glyph ? [it.glyph] : []), it.label, ...(it.letter ? [h('kbd', '', {}, it.letter)] : []));
      b.addEventListener('click', () => {
        menu = null;
        it.run();
        draw();
        handle?.focus(); // the menu is gone: the keyboard goes back to the board, never to the page body
      });
      m.append(b);
    }
    return m;
  }
  /**
   * The contexts a colour is judged in for `tool` (Mika P0b S1, S2): the text floor for the text tool or a selected
   * text mark; the pair against the colour the tool draws with (`chosen`: no mark yet) or against each selected
   * mark's other colour. `fill` is null when the tool draws no fill.
   */
  function trayContexts(tool: BoardTool, style: { line: string; fill: string | null }): { line: CustomContext; fill: CustomContext | null } {
    if (tool === 'select') {
      const sel = handle && handle.isAlive() ? handle.marks().filter((m) => m.selected && !m.labelOf) : [];
      const fillable = sel.filter((m) => FILL_MARKS.has(m.kind));
      return { line: { text: sel.some((m) => m.kind === 'text'), others: fillable.map((m) => m.fill) }, fill: { others: fillable.map((m) => m.line) } };
    }
    const drawsFill = tool === 'rect' || tool === 'ellipse' || tool === 'sticky';
    const fillNow = tool === 'sticky' ? (style.fill ?? CONTENT_DEFAULTS.stickyFill) : drawsFill ? style.fill : null;
    return { line: { text: tool === 'text', other: fillNow, chosen: true }, fill: drawsFill ? { other: style.line, chosen: true } : null };
  }
  /** the tool the person chose while the held style would be refused by it: switched to once a passing colour is chosen */
  let pendingTool: BoardTool | null = null;
  function chooseTool(tool: BoardTool): void {
    const s = st();
    // Mika P0b S1: a held style the tool would refuse is said BEFORE the first mark, so typed words are never lost.
    // The tool waits; the tray opens on the refusal with its offered key. No colour is substituted.
    if (s && (tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'sticky')) {
      const held = heldRefusals(s.style, trayContexts(tool, s.style));
      if (held.length) {
        pendingTool = tool;
        trayOpen = true;
        trayKey = '';
        draw();
        tray.querySelector<HTMLElement>('[data-key^="held:"]')?.focus();
        return;
      }
    }
    pendingTool = null;
    handle?.setTool(tool);
    handle?.focus();
  }
  function drawRail(state: LeafState): void {
    const s = st();
    const off = (state !== 'open' && state !== 'empty') || inert !== null;
    const lay = railLayout(boardHeight() || 9999, s?.tool ?? 'select');
    rail.className = `bd-rail${off ? ' yielded' : ''}${lay.tight ? ' tight' : ''}`;
    const style = s?.style ?? { line: CONTENT_DEFAULTS.line, fill: null, weight: 'fine' as BoardWeight };
    // the rail is rebuilt only when what it shows has changed: a rebuild under a pointer press loses the press, and a
    // rebuild on a focus move sent focus round in a loop (review B1)
    const key = JSON.stringify([off, s?.tool ?? null, lay, menu, zoomPercent(s?.zoom ?? 1), style.line, style.fill, trayOpen, theme]);
    if (key === railKey) return;
    railKey = key;
    const kids: Node[] = [];
    let first = true;
    // the groups of the unchosen layout: a chosen folded tool stands in the row of the tool it displaced, inside that
    // group's ticks, and no tick is drawn before it (design `fold.guest_tick`)
    for (const all of railDrawGroups(lay)) {
      if (!first && !lay.tight) kids.push(h('span', 'bd-brk', { 'aria-hidden': 'true' }));
      first = false;
      for (const t of all) kids.push(row(off ? '' : railTool(t).letter, toolKey(railTool(t), s, off)));
    }
    if (lay.folded.length) {
      const names = lay.folded.map((t) => `${railTool(t).name.replace(' · connect', '')} (${railTool(t).letter})`).join(', ');
      const more = quietKey('bd-tool bd-more', '⋯', `More tools: ${names}`, off, () => void ((menu = menu === 'more' ? null : 'more'), draw()), { 'aria-haspopup': 'menu', 'aria-label': 'More tools', 'aria-expanded': menu === 'more' ? 'true' : 'false', 'data-key': 'more' });
      kids.push(row('', more, ...(menu === 'more' && !off ? [menuOf(lay.folded.map((t) => ({ label: railTool(t).name, letter: railTool(t).letter, glyph: glyph(railTool(t)), run: () => chooseTool(t) })))] : [])));
    }
    if (!lay.tight) kids.push(h('span', 'bd-brk', { 'aria-hidden': 'true' }));
    const ink = quietKey('bd-tool bd-ink', '', 'Line and fill', off, () => void ((trayOpen = !trayOpen), draw()), { 'aria-label': `Line ${wellName(style.line)}, fill ${wellName(style.fill)}`, 'aria-expanded': trayOpen ? 'true' : 'false', 'data-key': 'ink' });
    const wl = h('span', 'bd-well line');
    wl.style.setProperty('--wl', colour(style.line, 'line'));
    const wf = h('span', `bd-well fill${style.fill === null ? ' c-none' : ''}`);
    if (style.fill !== null) wf.style.setProperty('--wf', colour(style.fill, 'fill'));
    ink.append(wl, wf);
    kids.push(row('', ink));
    if (!lay.tight) kids.push(h('span', 'bd-grow'));
    if (lay.hand) kids.push(row(off ? '' : 'H', toolKey(railTool('hand'), s, off)));
    if (lay.zoomKeys) kids.push(row('', quietKey('bd-tool', '+', 'Zoom in (⌘ +)', off, () => handle?.zoomIn(), { 'aria-label': 'Zoom in', 'data-key': 'zoom-in' })));
    const pct = quietKey('bd-zoom', zoomPercent(s?.zoom ?? 1), lay.zoomKeys ? 'Fit everything (⌘ 0)' : 'Zoom', off, () => (lay.zoomKeys ? handle?.zoomToFit() : void ((menu = menu === 'zoom' ? null : 'zoom'), draw())), lay.zoomKeys ? { 'data-key': 'percent' } : { 'aria-haspopup': 'menu', 'aria-expanded': menu === 'zoom' ? 'true' : 'false', 'data-key': 'percent' });
    kids.push(row('', pct, ...(menu === 'zoom' && !lay.zoomKeys && !off ? [menuOf([{ label: 'Zoom in', letter: '⌘ +', run: () => handle?.zoomIn() }, { label: 'Fit everything', letter: '⌘ 0', run: () => handle?.zoomToFit() }, { label: 'Zoom out', letter: '⌘ −', run: () => handle?.zoomOut() }])] : [])));
    if (lay.zoomKeys) kids.push(row('', quietKey('bd-tool', '−', 'Zoom out (⌘ −)', off, () => handle?.zoomOut(), { 'aria-label': 'Zoom out', 'data-key': 'zoom-out' })));
    const focused = rail.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-key') : null;
    rail.replaceChildren(...kids);
    // focus goes back to the same key (every rail key has a data-key), or to the chosen tool when that key is gone
    if (focused) (rail.querySelector<HTMLElement>(`[data-key="${focused}"]`) ?? rail.querySelector<HTMLElement>('[tabindex="0"]'))?.focus();
    placeMenu();
  }
  /**
   * An open rail menu stays inside the board's own area (T-2026-11-25-004): it hangs up from its key, and on a short
   * board that ran it over the head and out of the leaf's top, where its first rows could not be reached. It is moved
   * down to fit and, when it is taller than the board, scrolls inside itself. Sizes are CSSOM properties.
   */
  function placeMenu(): void {
    const m = rail.querySelector<HTMLElement>('.bd-menu');
    if (!m) return;
    const room = stage.getBoundingClientRect();
    const edge = 4;
    const avail = Math.max(0, Math.floor(room.height - 2 * edge));
    // a menu taller than its room is cut THROUGH a row (design `menus_scroll`): whole rows and half of the next
    m.style.maxHeight = '';
    const items = [...m.querySelectorAll<HTMLElement>('.bd-mi')];
    const cut = items.length > 1 ? menuCutHeight({ room: avail, natural: m.offsetHeight, first: items[0]!.offsetTop + m.clientTop, pitch: items[1]!.offsetTop - items[0]!.offsetTop, rows: items.length, tail: MENU_CUT_TAIL.oneLine }) : null;
    // (the cut row's half shows INSIDE the border: the bottom border is added to the border-box height)
    m.style.maxHeight = `${cut === null ? avail : cut + (m.offsetHeight - m.clientHeight - m.clientTop)}px`;
    const box = m.getBoundingClientRect();
    const over = room.top + edge - box.top;
    if (over > 0) m.style.bottom = `${-Math.ceil(over)}px`;
  }

  // ── the tray ─────────────────────────────────────────────────────────────
  let hexText = '';
  let trayKey = '';
  let railKey = '';
  function drawTray(state: LeafState): void {
    const s = st();
    tray.hidden = !trayOpen || !s || (state !== 'open' && state !== 'empty');
    if (tray.hidden) return void (trayKey = '');
    const style = s!.style;
    // the tray is rebuilt only when what it shows has changed: a focus move must not replace a field being typed in
    const ctxs = trayContexts(s!.tool, style);
    // what is selected, for the shown wells and the pair (Mika P0b S2): one shared value per role, else the style
    const sel = s!.tool === 'select' && handle && handle.isAlive() ? handle.marks().filter((m) => m.selected && !m.labelOf) : [];
    const shared = <T,>(xs: T[]): T | undefined => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : undefined);
    const shownLine = shared(sel.map((m) => m.line)) ?? style.line;
    const fillSel = sel.filter((m) => FILL_MARKS.has(m.kind));
    const shownFill = fillSel.length ? (shared(fillSel.map((m) => m.fill)) ?? style.fill) : style.fill;
    const key = JSON.stringify([style, s!.tool, theme, pendingTool, sel.map((m) => [m.kind, m.line, m.fill])]);
    if (key === trayKey) return;
    trayKey = key;
    // each row is ONE tab stop; the arrow keys move within it (design content-tray: a radiogroup per row)
    const roving = (row: HTMLElement): void => {
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const keys = [...row.querySelectorAll<HTMLElement>('button:not([disabled])')];
        const at = keys.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        e.preventDefault();
        keys[(at + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]!.focus();
      });
    };
    const wells = (role: 'line' | 'fill', tokens: ReadonlyArray<string | null>, chosen: string | null): HTMLElement => {
      const name = h('span', 'bd-wn', {}, wellName(chosen));
      const r = h('div', 'bd-tr', { role: 'radiogroup', 'aria-label': role }, h('span', 'bd-tl', {}, role));
      const anyChosen = tokens.includes(chosen);
      tokens.forEach((t, n) => {
        const on = t === chosen;
        const w = h('button', `bd-well ${role}${t === null ? ' c-none' : ''}${on ? ' sel' : ''}`, { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', title: wellName(t), 'aria-label': wellName(t), tabindex: on || (!anyChosen && n === 0) ? 0 : -1, 'data-key': `${role}:${t ?? 'none'}` });
        if (t !== null) w.style.setProperty(role === 'line' ? '--wl' : '--wf', colour(t, role));
        const show = (): void => void (name.textContent = wellName(t));
        const back = (): void => void (name.textContent = wellName(chosen));
        w.addEventListener('pointerenter', show);
        w.addEventListener('focus', show);
        w.addEventListener('pointerleave', back);
        w.addEventListener('blur', back);
        w.addEventListener('click', (e) => {
          handle?.setStyle(role === 'line' ? { line: t as string } : { fill: t }, e);
          draw();
        });
        r.append(w);
      });
      r.append(name);
      roving(r);
      return r;
    };
    const weight = h('div', 'bd-tr', { role: 'group', 'aria-label': 'weight' }, h('span', 'bd-tl', {}, 'weight'));
    for (const wgt of TRAY_WEIGHTS) {
      const off = wgt === 'marker' && s!.tool !== 'stroke';
      const b = h('button', `key quiet seg-key${style.weight === wgt ? ' current' : ''}`, { type: 'button', 'aria-pressed': style.weight === wgt ? 'true' : 'false', disabled: off, title: off ? MARKER_OFF_TITLE : undefined, tabindex: style.weight === wgt ? 0 : -1, 'data-key': `weight:${wgt}` }, wgt);
      b.addEventListener('click', (e) => {
        handle?.setStyle({ weight: wgt }, e);
        draw();
      });
      weight.append(b);
    }
    roving(weight);
    const field = h('input', 'field bd-hex', { 'aria-label': 'Custom colour, hex', value: hexText, spellcheck: 'false', autocomplete: 'off', maxlength: 7, 'data-key': 'hex' });
    const custom = h('div', 'bd-tr', {}, h('span', 'bd-tl', {}, 'custom'), field);
    const answer = h('div', 'bd-refuse-row', { role: 'status' });
    const read = (): void => {
      hexText = field.value;
      custom.querySelectorAll('.bd-well, .meta').forEach((n) => n.remove());
      answer.replaceChildren();
      if (!hexText.trim()) return;
      // one well per role the colour passes for: "use as line", "use as fill". Nothing is applied until one is pressed.
      // judged as the tool would draw it, or against the selection (trayContexts)
      const entries = (['line', 'fill'] as const).map((role) => ({ role, c: customEntry(hexText, role, (role === 'line' ? ctxs.line : ctxs.fill) ?? {}) }));
      const passing = entries.filter((e) => e.c.ok);
      for (const { role, c } of passing) {
        if (!c.ok) continue;
        const w = h('button', `bd-well ${role}`, { type: 'button', title: `use as ${role}`, 'aria-label': `Use this colour as the ${role}`, 'data-key': `custom:${role}` });
        w.style.setProperty(role === 'line' ? '--wl' : '--wf', colour(c.token, role));
        w.addEventListener('click', (e) => {
          handle?.setStyle(role === 'line' ? { line: c.token } : { fill: c.token }, e);
          draw();
        });
        custom.append(w);
      }
      // the night values are quoted only for the roles the colour is offered in
      const first = passing[0]?.c;
      if (first?.ok) custom.append(h('span', 'meta', {}, `custom · at night ${passing.map(({ role, c }) => (c.ok ? `${c.night[role]} as a ${role}` : '')).join(', ')}`));
      // a role the colour fails for: nothing is applied and nothing is substituted; the nearest swatch is an offer
      // Mika P0b S3, C1: refused for both roles for ONE reason, it is said once; otherwise each role is said with its
      // own reason and its own key, the role after 'not used' ('✕ not used as a fill · <why>')
      const failing = entries.filter((e) => !e.c.ok);
      const once = failing.length === 2 && !failing[0]!.c.ok && !failing[1]!.c.ok && failing[0]!.c.why === failing[1]!.c.why && failing[0]!.c.offer === failing[1]!.c.offer;
      for (const { role, c } of once ? failing.slice(0, 1) : failing) {
        if (c.ok) continue;
        // a why that already names its role (the distance rule's 'as a fill it would hide …') is not named twice
        const named = !once && !c.why.includes(`as a ${role}`);
        answer.append(h('span', 'bd-refuse', {}, named ? trayRefusalLine(c.why, role) : c.line));
        if (c.offer) {
          const offer = c.offer;
          const b = h('button', 'key quiet', { type: 'button', 'data-key': `offer:${role}` }, named ? `Use ${offer} as the ${role}` : `Use ${offer}`);
          b.addEventListener('click', (e) => {
            hexText = '';
            trayKey = '';
            handle?.setStyle(role === 'line' ? { line: offer } : { fill: offer }, e);
            draw();
          });
          answer.append(b);
        }
      }
    };
    field.addEventListener('input', read);
    // the control that had focus keeps it through the rebuild (review B2: choosing a well dropped focus to the body,
    // so Esc no longer closed the tray and the tool letters did nothing)
    const focused = tray.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-key') : null;
    // the held style as the waiting tool would draw it (Mika P0b S1): its refusal and its own key, before any mark
    const held = h('div', 'bd-refuse-row', { role: 'status' });
    for (const r of pendingTool ? heldRefusals(style, trayContexts(pendingTool, style)) : []) {
      held.append(h('span', 'bd-refuse', {}, r.line));
      if (!r.offer) continue;
      const offer = r.offer;
      const b = h('button', 'key quiet', { type: 'button', 'data-key': `held:${r.role}` }, `Use ${offer} as the ${r.role}`);
      b.addEventListener('click', (e) => {
        handle?.setStyle(r.role === 'line' ? { line: offer } : { fill: offer }, e);
        const next = pendingTool;
        const now = st();
        if (next && now && heldRefusals(now.style, trayContexts(next, now.style)).length === 0) {
          pendingTool = null;
          handle?.setTool(next);
        }
        trayKey = '';
        draw();
      });
      held.append(b);
    }
    tray.replaceChildren(wells('line', TRAY_LINE, shownLine), wells('fill', TRAY_FILL, shownFill), weight, custom, answer, ...(held.childElementCount ? [held] : []));
    read();
    if (focused) {
      const again = tray.querySelector<HTMLElement>(`[data-key="${focused}"]`) ?? tray.querySelector<HTMLElement>('[tabindex="0"]');
      again?.focus();
      if (again === field) field.setSelectionRange(hexText.length, hexText.length);
    }
  }

  // ── the overlay: pins, seals, an agent text's box, a stub's words ────────
  function drawOver(): void {
    if (!handle || !handle.isAlive()) return void over.replaceChildren();
    const kids: Array<HTMLElement | SVGElement> = [];
    const marks = handle.marks();
    const view = handle.view();
    hovered = hoveredMark(marks, view, pointerAt);
    for (const it of overlayItems(marks, view, { hovered, theme, ...(o.overlayExtras?.() ?? {}) })) {
      if (it.type === 'pin' || it.type === 'hollow') {
        const p = h('span', `bd-pin${it.type === 'hollow' ? ' unk' : ''}${it.type === 'pin' && it.low ? ' low' : ''}`);
        place(p, it.left - 4, it.top - 4);
        kids.push(forMark(p, it.id));
      } else if (it.type === 'ring') {
        // the seal's rim with everything taken out: no letter, no name, no title, no pointer (design author-seal seal.ring)
        const r = h('span', 'bd-ring');
        place(r, it.left - 3, it.top - 3);
        kids.push(forMark(r, it.id));
      } else if (it.type === 'chip') {
        // the hand's name, a bidi-isolated text node cut at 24 characters; the name is the authority
        // (Mika E3 D1: 'changed by Claude', 'words by Claude': the lead is the page's words, the name an isolate)
        const c = h('span', 'chip', {}, ...(it.lead ? [`${it.lead} `] : []), h('bdi', '', {}, handName(it.name)));
        place(c, it.left, it.top - 9);
        kids.push(forMark(c, it.id));
      } else if (it.type === 'seal') {
        const s = sealElement(it.seal, it.name);
        place(s, it.left - 11, it.top - 11);
        kids.push(forMark(s, it.id));
      } else if (it.type === 'counter') {
        // S1.4 E3 countermark: the ring's shape (a filled disc for you); nothing to press, no title, no pointer
        const r = h('span', `bd-ring bd-counter${it.disc ? ' disc' : ''}`, { 'aria-hidden': 'true' });
        place(r, it.left - 3, it.top - 3);
        kids.push(forMark(r, it.id));
      } else if (it.type === 'words') {
        const w = h('span', 'bd-words', { 'aria-hidden': 'true' });
        place(w, it.left, it.top);
        w.style.width = `${Math.round(it.width)}px`;
        kids.push(forMark(w, it.id));
      } else if (it.type === 'cutout') {
        // four corner ticks round the removed mark's last box: no fill, no words, nothing between the ticks
        const c = h('div', `bd-cutout${it.traced ? ' traced' : ''}`, { 'aria-hidden': 'true' }, ...['tl', 'tr', 'bl', 'br'].map((k) => h('span', `bd-tick ${k}`)));
        place(c, it.left, it.top);
        c.style.width = `${Math.round(it.width)}px`;
        c.style.height = `${Math.round(it.height)}px`;
        c.style.setProperty('--arm', `${Math.max(1, Math.round(it.arm))}px`);
        kids.push(forMark(c, it.id));
      } else if (it.type === 'trace') {
        const t = h('div', it.ring ? 'bd-trace ring' : 'bd-trace', { 'aria-hidden': 'true' });
        place(t, it.left, it.top);
        t.style.width = `${Math.round(it.width)}px`;
        t.style.height = `${Math.round(it.height)}px`;
        kids.push(forMark(t, it.id));
      } else if (it.type === 'textbox') {
        const b = h('div', `bd-textbox${it.form === 'box' ? '' : ` ${it.form}`}`);
        place(b, it.left, it.top);
        b.style.width = `${Math.round(it.width)}px`;
        b.style.height = `${Math.round(it.height)}px`;
        kids.push(forMark(b, it.id));
      } else {
        // the only text taken from the node is its kind, pattern-checked by the contracts; the lead word is never dropped
        const name = dimKindName(it.kind);
        const b = h('div', `bd-stub${it.dashed ? ' agent' : ''}`, {}, h('span', 'bd-stub-k', { title: name }, h('span', 'bd-stub-l', {}, DIM_FALLBACK_LEAD), name.length > 36 ? `${name.slice(0, 35)}…` : name), h('span', 'bd-stub-n', {}, LEAF_COPY.stubNote));
        place(b, it.left, it.top);
        b.style.width = `${Math.round(it.width)}px`;
        b.style.height = `${Math.round(it.height)}px`;
        kids.push(forMark(b, it.id));
      }
    }
    over.replaceChildren(...kids);
  }

  // ── notes and the foot ───────────────────────────────────────────────────
  function drawNote(state: LeafState): void {
    note.hidden = state !== 'empty' && state !== 'failed';
    if (note.hidden) return;
    const pin = h('span', 'bd-pin', { 'aria-hidden': 'true' });
    if (state === 'empty') note.replaceChildren(pin, h('p', 'bd-en-t', {}, LEAF_COPY.emptyTitle), h('p', '', {}, LEAF_COPY.emptyHint));
    else note.replaceChildren(pin, h('p', 'bd-en-t', {}, LEAF_COPY.failedTitle), h('p', '', {}, cause), h('p', '', {}, LEAF_COPY.failedNext));
  }
  /**
   * S1.4 P4b: one hand per attached session, each with ITS key. The hand's span and its parts are made ONCE per
   * session and updated in place (aegis I-4), and the hand is named from its SESSION, never from its first mark, so
   * no agent activity can resize a hand, move a key or drop a key's focus.
   */
  interface KeyedHand { hand: HTMLElement; seal: SVGElement; sealSig: string; name: HTMLElement; hint: HTMLElement; hintName: HTMLElement; count: HTMLElement; key: HTMLButtonElement | null; note: HTMLElement; full: string; session: string | null }
  const grantEls = new Map<string, KeyedHand>();
  let grantQuietTimer: ReturnType<typeof setTimeout> | null = null;
  function grantKey(hsid: string): HTMLButtonElement {
    const key = h('button', 'key quiet bd-grant', { type: 'button', 'data-grant': hsid });
    // a press is the pointer's own click, or Space / Enter on the key itself; both arrive as the key's click
    key.addEventListener('click', (e) => {
      if (e.isTrusted !== true || key.getAttribute('aria-disabled') === 'true') return;
      o.onGrant?.(hsid, e);
    });
    // aegis I-1: a HELD Enter fires a trusted click per auto-repeat on a button; only the first key-down presses
    key.addEventListener('keydown', (e) => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    return key;
  }
  function paintKey(key: HTMLButtonElement, g: LeafGrant, now: number): void {
    const words = g.write ? GRANT_COPY.on : GRANT_COPY.off;
    const name = g.session ? `${g.name} in ${g.session}` : g.name;
    const quiet = g.since !== null && now - g.since < DIM_GRANT_QUIET_MS;
    // under 300 ms nothing changes (no flash); past it every key takes the disabled look and the pressed one the working mark
    const working = g.state === 'pending' && !quiet;
    const disabled = g.state === 'down' || g.state === 'unknown' || g.state === 'idle' || g.state === 'unsure' || (g.state === 'busy' && !quiet) || working;
    // (mika F10: a key that is only busy with ANOTHER key's change keeps its own sentence)
    const label = g.state === 'down' ? GRANT_COPY.titleDown : g.state === 'idle' ? GRANT_COPY.titleIdle(name, g.write) : g.state === 'unknown' ? GRANT_COPY.titleUnknown(name) : g.state === 'unsure' ? GRANT_COPY.titleUnsure(name) : g.state === 'pending' ? GRANT_COPY.titlePending(name, words) : g.write ? GRANT_COPY.titleOn(name) : GRANT_COPY.titleOff(name);
    const sig = `${words}|${label}|${disabled}|${working}`;
    if (key.dataset.sig === sig) return;
    key.dataset.sig = sig;
    key.setAttribute('aria-label', label);
    if (disabled) key.setAttribute('aria-disabled', 'true');
    else key.removeAttribute('aria-disabled');
    if (working) key.setAttribute('aria-busy', 'true');
    else key.removeAttribute('aria-busy');
    key.dataset.state = g.write ? 'on' : 'off';
    const glyph = h('span', 'bd-grant-g', { 'aria-hidden': 'true' });
    if (working) glyph.append(h('span', 'spin'));
    else if (g.write) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 18 12');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '12');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M1 6.25H17');
      path.setAttribute('class', 'bd-grant-line');
      svg.append(path);
      glyph.append(svg);
    }
    // the pointer's tip on the words, so a screen reader is not told the sentence twice (mika)
    key.replaceChildren(glyph, h('span', 'bd-grant-w', { title: label }, words));
  }
  /** Children in order, moving nothing that is already where it goes (a focused key is never detached). */
  function syncKids(parent: HTMLElement, kids: readonly Node[]): void {
    const want = new Set(kids);
    for (const c of [...parent.childNodes]) if (!want.has(c)) parent.removeChild(c);
    for (let i = 0; i < kids.length; i++) {
      const at = parent.childNodes[i];
      if (at !== kids[i]) parent.insertBefore(kids[i]!, at ?? null);
    }
    while (parent.childNodes.length > kids.length) parent.removeChild(parent.lastChild!);
  }
  const setText = (el: HTMLElement, text: string): void => void (el.textContent !== text && (el.textContent = text));
  function keyedHand(g: LeafGrant): KeyedHand {
    let e = grantEls.get(g.hsid);
    if (!e) {
      const name = h('bdi', '');
      const hintName = h('bdi', '');
      const hint = h('span', 'bd-hand-s', {}, '◇ ', hintName);
      const count = h('span', 'bd-count');
      const key = g.local ? null : grantKey(g.hsid);
      // mika F7 / F4: the no-key line and the not-running note sit after the count (or the key) with the hand's own gap
      const note = h('span', 'bd-hand-s bd-hand-note');
      const seal = sealElement(sealOf(g.hsid, g.name), g.name);
      const hand = h('span', 'bd-hand bd-hand-keyed', { 'data-hand': g.hsid }, seal, name, hint, count, ...(key ? [key] : []), note);
      e = { hand, seal, sealSig: '', name, hint, hintName, count, key, note, full: '', session: null };
      grantEls.set(g.hsid, e);
    }
    return e;
  }
  /** The keyed hand as it reads with room: its whole name, its whole session name. */
  function fullHand(e: KeyedHand): void {
    e.name.hidden = false;
    e.hint.hidden = e.session === null;
    if (e.session !== null) setText(e.hintName, e.session);
  }
  // the hands foot's '+<k> ▾' (design hands_foot.overflow; T-2026-11-26-004): the hands that do not fit, in the
  // leaf's one menu component (.bd-menu, as the notices' +k menu: upward over the board, its right edge on its key,
  // in the DOM right after the key; no menu roles, the key has aria-expanded and aria-controls)
  let handsOpen = false;
  let shownIds: Set<string> | null = null;
  let behindHands: Node[] = [];
  const handsMenuId = `bd-hands-menu-${Math.random().toString(36).slice(2, 8)}`;
  let moreEl: HTMLButtonElement | null = null;
  const handsMenu = h('div', 'bd-menu bd-hands-menu', { id: handsMenuId });
  function moreKey(n: number): HTMLButtonElement {
    if (!moreEl) {
      moreEl = h('button', 'key quiet bd-hands-more', { type: 'button', 'aria-controls': handsMenuId, 'aria-expanded': 'false' }) as HTMLButtonElement;
      moreEl.addEventListener('click', (e) => {
        // the person's own press only; opening leaves focus on the key (aegis)
        if (e.isTrusted !== true) return;
        if (handsOpen) return closeHands(true);
        handsOpen = true;
        moreEl!.setAttribute('aria-expanded', 'true');
        drawFoot();
      });
    }
    setText(moreEl, `+${n} ▾`);
    moreEl.setAttribute('aria-label', `${n} more ${n === 1 ? 'hand' : 'hands'}`);
    return moreEl;
  }
  function closeHands(back: boolean): void {
    if (!handsOpen) return;
    handsOpen = false;
    // focus first, then the rows go: a removed focused key would drop focus to the body
    if (back && moreEl?.isConnected) moreEl.focus({ preventScroll: true });
    handsMenu.replaceChildren();
    handsMenu.remove();
    moreEl?.setAttribute('aria-expanded', 'false');
    drawFoot();
  }
  /** One row per hand behind the key, in the foot's order, each whole: seal, name, ◇ session, count, its own key. */
  function drawHandsMenu(): void {
    if (!moreEl) return;
    const rows = behindHands.map((k) => {
      const ke = [...grantEls.values()].find((e) => e.hand === k);
      if (ke) {
        fullHand(ke);
        ke.hand.removeAttribute('title');
      }
      const id = (k as HTMLElement).dataset.hand ?? '';
      const row = [...handsMenu.children].find((r) => (r as HTMLElement).dataset.handRow === id) ?? h('div', 'bd-menu-row bd-hands-row', { 'data-hand-row': id });
      syncKids(row as HTMLElement, [k]);
      return row;
    });
    syncKids(handsMenu, rows);
    if (handsMenu.previousElementSibling !== moreEl) moreEl.after(handsMenu);
    // above the foot, never over it; its right edge on the key; inside the leaf (never past its left inset); its
    // height up to the head's bottom, the rows scrolling inside (board-centre-only)
    const f = foot.getBoundingClientRect();
    const k = moreEl.getBoundingClientRect();
    const top = head.getBoundingClientRect().bottom + 4;
    // (as the notices' menu, Mika E3 r3) its right edge on the key while its rows fit left of it; else out to the
    // foot's right inset; a row that still does not fit cuts its name and session with … (whole in title=)
    const left = f.left + 14;
    handsMenu.style.maxWidth = '';
    handsMenu.style.right = `${Math.max(0, f.right - k.right)}px`;
    const natural = handsMenu.scrollWidth;
    const wide = natural > k.right - left;
    handsMenu.style.right = `${wide ? 14 : Math.max(0, f.right - k.right)}px`;
    handsMenu.style.maxWidth = `${Math.max(0, (wide ? f.right - 14 : k.right) - left)}px`;
    for (const r of handsMenu.children) {
      const hand = r.firstElementChild as HTMLElement | null;
      if (!hand) continue;
      const cut = hand.scrollWidth > hand.clientWidth + 0.5;
      const full = hand.querySelector('svg')?.getAttribute('aria-label') ?? '';
      if (cut && full) hand.title = full;
      else hand.removeAttribute('title');
    }
    handsMenu.style.maxHeight = `${Math.max(0, f.top - 4 - top)}px`;
  }
  let footDrawing = false;
  function drawFoot(): void {
    footDrawing = true;
    try {
      drawFootNow();
    } finally {
      footDrawing = false;
    }
  }
  function drawFootNow(): void {
    const kids: Node[] = [];
    const marks = handle && handle.isAlive() ? handle.marks() : [];
    const hands = handle && handle.isAlive() ? footHands(marks, o.sessionName) : [{ hand: 'you' as const, n: 0 }];
    const grants = o.grants?.() ?? [];
    const now = Date.now();
    const slot = (n: number): HTMLElement => h('span', 'bd-count', n > 999 ? { title: String(n) } : {}, countSlot(n));
    // the hands of attached sessions, from their marks (a hand is its session's when its marks name that session)
    const byHsid = new Map<string, { id: string; n: number }>();
    for (const m of marks) {
      if (m.labelOf || m.author.cls !== 'agent' || !m.author.session) continue;
      const a = byHsid.get(m.author.session) ?? { id: m.author.id, n: 0 };
      a.n++;
      byHsid.set(m.author.session, a);
    }
    const keyed = new Set<string>();
    for (const f of hands) {
      if (f.hand === 'you') kids.push(h('span', 'bd-hand', {}, h('span', 'bd-pin inline', { 'aria-hidden': 'true' }), ' you ', slot(f.n)));
    }
    const live = new Set<string>();
    const keyedEls: KeyedHand[] = [];
    for (const g of grants) {
      live.add(g.hsid);
      const mine = byHsid.get(g.hsid);
      if (mine) keyed.add(mine.id);
      const e = keyedHand(g);
      // named from the SESSION (aegis I-4); the seal follows the marks' own hand once there is one (same size)
      const full = g.session ? `${g.name}, ${g.session}` : g.name;
      const sealSig = `${mine?.id ?? g.hsid}|${full}`;
      if (e.sealSig !== sealSig) {
        const seal = sealElement(sealOf(mine?.id ?? g.hsid, g.name), full);
        e.hand.replaceChild(seal, e.seal);
        e.seal = seal;
        e.sealSig = sealSig;
      }
      if (e.full !== full) {
        e.full = full;
        e.name.title = full;
        setText(e.name, handName(g.name));
      }
      e.session = g.session ?? null;
      if (g.session) e.hint.title = g.session;
      fullHand(e);
      const n = mine?.n ?? 0;
      setText(e.count, countSlot(n));
      if (n > 999) e.count.title = String(n);
      else e.count.removeAttribute('title');
      if (e.key) paintKey(e.key, g, now);
      // mika F4: a session that is not running says so after its key, as the no-key line does
      const note = g.local ? `· ${GRANT_COPY.noKey}` : g.state === 'idle' ? `· ${GRANT_COPY.notRunning}` : '';
      setText(e.note, note);
      e.note.hidden = note === '';
      keyedEls.push(e);
      kids.push(e.hand);
    }
    // a hand whose key went (its session detached) takes focus with it to the board, never to another key (aegis)
    for (const [hsid, e] of [...grantEls]) {
      if (live.has(hsid)) continue;
      const had = !!e.key && document.activeElement === e.key;
      grantEls.delete(hsid);
      if (had) queueMicrotask(() => handle?.focus());
    }
    for (const f of hands) {
      if (f.hand === 'agent' && !keyed.has(f.id)) {
        const name = h('bdi', '', { title: f.session ? `${f.name}, ${f.session}` : f.name }, handName(f.name));
        // two agent hands that would read the same: each carries its session, ◇ and the name cut at 16 (session_hint)
        const hint = f.session ? [' ', h('span', 'bd-hand-s', { title: f.session }, '◇ ', h('bdi', '', {}, f.session))] : [];
        kids.push(h('span', 'bd-hand', { 'data-hand': `agent:${f.id}` }, sealElement(f.seal, f.session ? `${f.name}, ${f.session}` : f.name), ' ', name, ...hint, ' ', slot(f.n)));
      } else if (f.hand === 'unknown') kids.push(h('span', 'bd-hand', { 'data-hand': 'unknown' }, h('span', 'bd-pin unk inline', { 'aria-hidden': 'true' }), ` ${LEAF_COPY.unknownHand} `, slot(f.n)));
    }
    // (the hands go into the foot through lay() below: a key in the open menu is never moved back first)
    // a pending change past its quiet: drawn again then
    const pend = grants.find((g) => g.since !== null && now - g.since < DIM_GRANT_QUIET_MS);
    if (pend && grantQuietTimer === null) grantQuietTimer = setTimeout(() => ((grantQuietTimer = null), drawFoot()), DIM_GRANT_QUIET_MS - (now - pend.since!) + 5);
    // mika F1 / aegis I-5 (design hands_foot.overflow): a draw key is never clipped while a step remains, in order:
    // (0) a not-running note goes first, from the last hand back (its meaning stays in the key's sentence; ruling F1-b);
    // (1) from the last keyed hand back, its session's name is cut to 5 characters and …;
    // (2a, mika F1-a) on EVERY keyed hand that shows a session, at once, the shared name ('Claude') goes: the session
    //     is what tells two Claudes apart; (2b) only then the session, from the last hand back, and last a lone name;
    // (3) hands that still do not fit, from the last, go behind '+<k> ▾' (T-2026-11-26-004), whose menu holds them
    //     whole, each keyed one with its own draw key. Each split starts again from whole hands (a hand put behind
    //     gives the ones left their words back). 'you' and the first attached hand stay, except where even that
    //     does not fit (hands_foot.narrow): then every hand is a menu row.
    // A hand whose words went carries them whole in title= (and in the seal's accessible name and the key's sentence)
    const over = (): boolean => foot.scrollWidth > foot.clientWidth + 0.5;
    const fit = (shown: readonly KeyedHand[]): void => {
      for (const e of shown) {
        fullHand(e);
        e.note.hidden = e.note.textContent === '';
      }
      const back = [...shown].reverse();
      for (const e of back) {
        if (!over()) break;
        if (!e.note.hidden && e.key) e.note.hidden = true;
      }
      for (const e of back) {
        if (!over()) break;
        if (e.session !== null && [...e.session].length > SESSION_FLOOR) setText(e.hintName, `${[...e.session].slice(0, SESSION_FLOOR).join('').trimEnd()}…`);
      }
      if (over()) for (const e of shown) if (e.session !== null) e.name.hidden = true;
      for (const e of back) {
        if (!over()) break;
        e.hint.hidden = true;
        e.name.hidden = true;
      }
    };
    const idOf = (k: Node): string => (k as HTMLElement).dataset?.hand ?? '';
    const youEl = kids[0]!;
    const rest = kids.slice(1);
    const keyedOf = (k: Node): KeyedHand | undefined => keyedEls.find((e) => e.hand === k);
    const lay = (shown: readonly Node[], behindN: number): void => {
      syncKids(foot, [youEl, ...shown, ...(behindN > 0 ? [moreKey(behindN), ...(handsOpen ? [handsMenu] : [])] : [])]);
      fit(shown.map(keyedOf).filter((e): e is KeyedHand => !!e));
    };
    // ORDER AND FOCUS: while the menu is open or focus is in the foot, the split is frozen (no hand moves in or out
    // of the foot under the pointer or the focus); a hand that arrives then joins the end of the menu
    const frozen = handsOpen || foot.contains(document.activeElement);
    let behind: Node[];
    if (frozen && shownIds) {
      const shown = rest.filter((k) => shownIds!.has(idOf(k)));
      behind = rest.filter((k) => !shownIds!.has(idOf(k)));
      lay(shown, behind.length);
    } else {
      let cut = 0;
      lay(rest, 0);
      // the first attached hand stays while '+<k> ▾' has room beside it; a lone hand never goes (hands_foot.narrow)
      while (over() && cut < (rest.length < 2 ? 0 : rest.length)) {
        cut++;
        lay(rest.slice(0, rest.length - cut), cut);
      }
      behind = rest.slice(rest.length - cut);
      shownIds = new Set(rest.slice(0, rest.length - cut).map(idOf));
    }
    for (const e of keyedEls) {
      const gone = e.name.hidden || (e.session !== null && (e.hint.hidden || e.hintName.textContent !== e.session));
      if (gone && foot.contains(e.hand)) e.hand.title = e.full;
      else e.hand.removeAttribute('title');
    }
    behindHands = behind;
    if (!behind.length && handsOpen) closeHands(false);
    // The check: decided by THE HANDS ALONE (design check.place). It is in the foot when its LONGEST wording and its
    // gap fit after the hands, whatever it says now; never cut, no short form. Measured with the foot's own paint.
    const used = foot.lastElementChild ? foot.lastElementChild.getBoundingClientRect().right - foot.getBoundingClientRect().left : 0;
    const pad = parseFloat(getComputedStyle(foot).paddingRight) || 0;
    const probe = h('span', 'bd-check bd-check-probe', { 'aria-hidden': 'true' }, CHECK_LONGEST);
    foot.append(probe);
    const need = probe.getBoundingClientRect().width + CHECK_GAP;
    probe.remove();
    const fits = !!checkWords && foot.clientWidth > 0 && used + need <= foot.clientWidth - pad + 0.5;
    if (fits) foot.append(h('span', `bd-check${checkTone === 'bad' ? ' bad' : ''}`, { title: checkTitleText }, checkWords));
    if (handsOpen && behind.length) drawHandsMenu();
    if (fits !== checkInFoot) {
      checkInFoot = fits;
      el.dataset.checkPlace = fits ? 'foot' : 'list';
      if (!drawing) drawHead(leafState());
    }
  }
  let checkWords = '';
  let checkTitleText = '';
  let checkOpen = false;
  let checkInFoot = false;
  let checkTone: 'ok' | 'none' | 'bad' = 'none';
  let saidAt = 0;
  function say(text: string): void {
    // the same line while it is still showing is not announced a second time (a drag from the rail onto the board
    // is refused by the leaf's guard and by the board: it is said once)
    const again = text === said && Date.now() - saidAt < 1500;
    said = text;
    saidAt = Date.now();
    if (!again) saidLine.textContent = text;
    clearTimeout(saidTimer);
    saidTimer = setTimeout(unsay, 6000);
    draw();
  }
  /** The refusal line goes after six seconds, or as soon as something else is done on the board. */
  function unsay(): void {
    if (!said) return;
    said = '';
    saidLine.textContent = '';
    clearTimeout(saidTimer);
    draw();
  }

  /**
   * Into or out of too short. In: menus and the tray close, the line is spoken once (never again within 1.5s,
   * aegis C3_6), and a drag in hand is said: the engine, yielded, puts it back (C3_5). An open text keeps its words
   * in its field, held: no key reaches it and no blur commits it while too short (C3_2). Out: words still in their
   * field are said to be back.
   */
  function shortChanged(now: boolean): void {
    if (now === tooShort) return;
    tooShort = now;
    railKey = '';
    if (now) {
      trayOpen = false;
      menu = null;
      const line = pressing ? KEEP_COPY.changeBack : shortLine();
      if (pressing) say(line);
      else if (performance.now() - tooShortSpokeAt >= TOO_SHORT_SPEAK_MS) saidLine.textContent = line;
      tooShortSpokeAt = performance.now();
    } else if (boardField()?.value) say(KEEP_COPY.wordsBack);
  }
  let heldWas = false;
  let drawing = false;
  let again = false;
  function draw(): void {
    // one draw at a time: a draw that moves focus must not start another inside itself (review B1)
    if (drawing) return void (again = true);
    drawing = true;
    try {
      const state = leafState();
      // under the floor there is no rail, in EVERY state (review B3: loading and failed used to draw the rail over the
      // pinned card and the composer); the board is shown, held still, and the foot stays (design too_short.shows)
      el.classList.toggle('too-short', short());
      el.classList.toggle('no-body', boardHeight() < BOARD_BODY_MIN);
      // (a hidden host has no height: that is not "too short", aegis F1: the dock hides it before a leave)
      shortChanged(load === 'ready' && el.getClientRects().length > 0 && short());
      el.dataset.state = state;
      // the failed note stands on the bare desk: nothing of a stopped engine is left showing
      boardHost.hidden = state === 'failed';
      over.hidden = state === 'failed';
      // the foot first: whether the check is in it decides the line under the head's lead (check.signs.unchecked)
      drawFoot();
      drawHead(state);
      fitHead();
      // aegis F5: the check reads differently while words are held: the owner paints it again on a flip
      const hw = holdsWords();
      if (hw !== heldWas) {
        heldWas = hw;
        queueMicrotask(() => o.onHoldChange?.());
      }
      drawRail(state);
      drawTray(state);
      drawNote(state);
      drawOver();
      wasYielded = yielded();
      // while a card has the keyboard the engine's document-level listeners do nothing (G-DDL-08)
      if (handle?.isAlive()) handle.setYielded(wasYielded);
    } finally {
      drawing = false;
    }
    if (again) {
      again = false;
      draw();
    }
  }
  let wasYielded = false;
  /** pins, seals and the foot follow the scene once per frame, however many changes a frame holds */
  let sceneFrame = 0;
  const sceneSoon = (): void => {
    if (sceneFrame) return;
    sceneFrame = requestAnimationFrame(() => {
      sceneFrame = 0;
      drawOver();
      drawFoot();
      // the selection line follows a selection that moved from one mark to another. Only the keep line's words
      // change, and only while it shows the resting or selection line: a draw() or drawHead() here moved focus
      // during a fold (board-app Aegis L2)
      if (keepResting && handle?.isAlive()) {
        const line = selectionLine(handle.marks(), o.sessionName);
        if (line !== null && line !== selLine) {
          selLine = line;
          keep.title = line;
          keep.replaceChildren(h('bdi', '', {}, line));
        }
      }
    });
  };
  // the pointer over a mark of another hand gives back its seal and name (design author-seal naming.hover): the
  // host reads the pointer's place and nothing else; listening is passive and never stops an event
  let pointerAt: { left: number; top: number } | null = null;
  let hovered: string | null = null;
  let selLine: string | null = null;
  /** the keep line shows the resting line or the selection line (nothing else would give way to the selection line) */
  let keepResting = false;
  let hoverFrame = 0;
  const hoverSoon = (): void => {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (handle?.isAlive() && hoveredMark(handle.marks(), handle.view(), pointerAt) !== hovered) drawOver();
    });
  };
  boardHost.addEventListener('pointermove', (e) => {
    const b = boardHost.getBoundingClientRect();
    pointerAt = { left: e.clientX - b.left, top: e.clientY - b.top };
    hoverSoon();
  }, { passive: true });
  boardHost.addEventListener('pointerleave', () => {
    pointerAt = null;
    hoverSoon();
  }, { passive: true });

  // ── loading the engine ───────────────────────────────────────────────────
  function fail(error: unknown, afterMount: boolean): void {
    cause = failedCause(error, afterMount);
    load = 'failed';
    trayOpen = false;
    draw();
    headKey.focus(); // Try again is where the keyboard is, not the page body
  }
  function start(): void {
    const mine = ++generation;
    handle?.unmount();
    handle = null;
    load = 'loading';
    quiet = true;
    setTimeout(() => {
      if (mine === generation && load === 'loading') {
        quiet = false;
        draw();
      }
    }, LOADING_QUIET_MS);
    draw();
    if (!o.cardFocused()) headKey.focus(); // while it loads the keyboard is in the head, not on the page body
    o.load()
      .then((m) => m.mountBoard(boardHost, { theme, chrome: el, onError: (err) => mine === generation && fail(err, true) }))
      .then(
        (hd) => {
          if (mine !== generation) return hd.unmount();
          handle = hd;
          load = 'ready';
          offs.push(
            hd.onState(() => {
              if (said && Date.now() - saidAt > 400) unsay(); // something else was done: the refusal has been read
              draw();
            }),
            hd.onScene(sceneSoon),
            hd.onRefusal((r) => say(refusalLineOf(r))),
            hd.onCopy((ids) => copied(ids)),
            hd.onCut((ids) => cutTaken(ids)),
            hd.onCopyOutside(forget),
            hd.onPasteText((text, cause) => pasted(hd, text, cause)),
          );
          try {
            o.onReady?.(hd);
          } catch (err) {
            globalThis.reportError(err); // the opener's mistake is reported, and the board still opens
          }
          draw();
          // opening moves focus to the board, unless a card has the keys; a leaf too short to draw on has no board
          // to focus, so the head key takes it (never the page body)
          if (!o.cardFocused()) short() ? headKey.focus() : hd.focus();
        },
        (err: unknown) => mine === generation && fail(err, false),
      );
  }

  // ── keys and presses ─────────────────────────────────────────────────────
  /**
   * The APP's own shortcuts (ui/app.ts: the palette, the board's ⌥B, Settings, New session, the bare mic key). None is
   * an engine action, so a board held still lets them through to the page (Aegis, review of PR #123: the stop that
   * keeps keys from the engine had swallowed them, and ⌥B could not fold a board that says "fold it").
   */
  const appShortcut = (e: KeyboardEvent): boolean => {
    const cmd = (e.metaKey || e.ctrlKey) && !e.altKey;
    if (cmd && !e.shiftKey && ['k', ',', 'n'].includes(e.key.toLowerCase())) return true;
    if (e.code === 'KeyB' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) return true;
    return e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey;
  };
  const onKey = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    // the hands menu: Esc closes it ONLY and returns focus to '+<k> ▾' (the leaf stays open); ↓ from the key goes
    // into its rows, ↑ ↓ move between the rows' keys
    if (handsOpen && active instanceof HTMLElement && foot.contains(active)) {
      if (e.key === 'Escape') return void (e.preventDefault(), e.stopPropagation(), closeHands(true));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const keys = [...handsMenu.querySelectorAll<HTMLElement>('.bd-grant')];
        const at = keys.indexOf(active);
        const next = active === moreEl ? (e.key === 'ArrowDown' ? keys[0] : undefined) : at >= 0 ? keys[at + (e.key === 'ArrowDown' ? 1 : -1)] : undefined;
        if (next) next.focus();
        if (active === moreEl || at >= 0) return void (e.preventDefault(), e.stopPropagation());
      }
    }
    const s = st();
    // held still (the link is down, the fold is out of date) Esc folds the leaf at once: there is no tool to leave
    // and the held-still line tells the person to fold (a text being typed while down keeps its field: guardTypedKey)
    if (e.key === 'Escape' && (inert !== null || tooShort) && !o.cardFocused() && el.contains(active) && !(isField(active) && boardHost.contains(active))) return void foldAsk(e);
    // a field of the engine's own (a text being typed, a frame title being renamed) keeps every key
    if (isField(active) && boardHost.contains(active)) return;
    if (e.key === 'Escape' && !o.cardFocused() && el.contains(active) && !s?.editingText && (!s || s.tool === 'select')) {
      // Esc order: a text edit or the tool first (the rail action below), then the tray, then the leaf folds
      if (menu) return void ((menu = null), draw(), e.stopPropagation());
      if (trayOpen) return void ((trayOpen = false), draw(), handle?.focus(), e.stopPropagation());
      return void o.onFold?.(e);
    }
    if (isField(active) && !boardHost.contains(active)) return;
    // Held still: no key chooses a tool, and no key reaches the engine from the board (found by the inert-keys test:
    // a letter still changed the tool, and Cmd+A selected every mark through the engine's own key handler, which
    // setYielded does not cover; its document-level listeners it does). The person may still LOOK AROUND: the zoom
    // keys pass, and Tab still leaves the board.
    if (inert !== null || tooShort) {
      const looks = (e.metaKey || e.ctrlKey) && !e.altKey && ['+', '=', '-', '0'].includes(e.key);
      if (!looks) {
        if (e.key !== 'Tab' && !appShortcut(e) && boardHost.contains(active)) e.stopPropagation();
        return;
      }
    }
    const a = railKeyAction(e, { boardFocused: el.contains(active), editingText: s?.editingText ?? false, cardFocused: o.cardFocused() });
    if (!a || !handle || !s) return;
    e.preventDefault();
    e.stopPropagation();
    if (a.type === 'fit') handle.zoomToFit();
    else chooseTool(a.tool);
  };
  el.addEventListener('keydown', onKey, true);
  // Cmd/Ctrl+D with the keyboard anywhere in the leaf never reaches the browser (its bookmark sheet)
  el.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'd') e.preventDefault();
  }, true);
  // ONE guard for the whole leaf: nothing can be dropped on its head, rail, tray or foot either. (Over the board
  // itself the handle refuses first and says what it was; this is everything around it, and the leaf while it has
  // no board.) Said once per drag.
  let dragSaid = false;
  const dragGuard = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    if (e.type === 'dragenter' && !dragSaid) {
      dragSaid = true;
      const types = [...(e.dataTransfer?.types ?? [])];
      say(refusalLine(types.includes('Files') ? 'file' : 'drag'));
    }
    if (e.type === 'drop') dragSaid = false;
  };
  for (const type of ['dragenter', 'dragover', 'drop'] as const) el.addEventListener(type, dragGuard, true);
  el.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) dragSaid = false;
  }, true);
  // a refusal has been read once the person does anything else: it goes at the next press or key (it used to stay
  // through a press on empty ground and through selecting another mark)
  el.addEventListener('pointerdown', unsay, true);
  el.addEventListener('keydown', unsay, true);
  el.addEventListener('pointerdown', otherAction, true);
  el.addEventListener('keydown', otherAction, true);
  // the rail is one tab stop; ↑ and ↓ move within it
  rail.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const keys = [...rail.querySelectorAll<HTMLElement>('button')];
    const i = keys.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    keys[(i + (e.key === 'ArrowDown' ? 1 : keys.length - 1)) % keys.length]!.focus();
  });
  // a press on the board while a card has the keys only wakes it: it never reaches the engine
  // The waking press is one whole gesture: for the length of a double-click after it, nothing more of that gesture
  // reaches the engine (its release, its click, a second press, the double-click that would start a text).
  const WAKE_HOLD_MS = 500;
  let wakeUntil = 0;
  const onWake = (e: Event): void => {
    // held still: a press does nothing at all (it does not wake the board either); too short, it says the line again
    if (inert !== null || tooShort) {
      e.preventDefault();
      e.stopPropagation();
      if (inert === null && e.isTrusted) say(shortLine());
      return;
    }
    if (e.isTrusted) pressing = true;
    if (!yielded()) {
      if (performance.now() < wakeUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.isTrusted) {
      wakeUntil = performance.now() + WAKE_HOLD_MS;
      handle?.focus();
    }
  };
  stage.addEventListener('pointerdown', onWake, true);
  const released = (): void => void (pressing = false);
  window.addEventListener('pointerup', released, true);
  window.addEventListener('pointercancel', released, true);
  // and nothing else reaches the engine while yielded (review S4): a double-click, a wheel, a drop, a context menu
  const onHeld = (e: Event): void => {
    if (!yielded() && performance.now() >= wakeUntil) return;
    if (e.type === 'wheel' && (inert !== null || tooShort) && !o.cardFocused()) return; // held still: the wheel still pans and zooms
    e.preventDefault();
    e.stopPropagation();
  };
  // (touchmove, touchend and touchcancel too: the engine handles touches on its canvas. Its keyup and Safari
  // gesture listeners are on the DOCUMENT and cannot be stopped from here: recorded for S1.3)
  for (const type of ['pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'dragover', 'drop', 'paste', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) stage.addEventListener(type, onHeld, true);
  // held still (the link is down, the fold is out of date) the person may still LOOK AROUND: the wheel pans and
  // zooms (never an edit); while a card has the keys it does not
  stage.addEventListener('wheel', onHeld, { capture: true, passive: false });
  // A text being typed when the link goes down (Mika, final; Aegis option b): its commit is REFUSED while down and
  // the field stays open with its words. Esc, Cmd/Ctrl+Enter and Tab would end the edit; a blur would commit it.
  const boardField = (): HTMLTextAreaElement | null => boardHost.querySelector('textarea');
  const guardTypedKey = (e: KeyboardEvent): void => {
    if (e.target !== boardField()) return;
    // too short (aegis C3_1, C3_2): NO key reaches the open text (its words are held as they are), and a key that
    // would end the edit says why; the app's own shortcuts still pass. Link down and too short both: the link's line.
    if (tooShort && inert !== 'link-down') {
      // (aegis F4: only the app's chords pass, ⌘K, ⌘, ⌘N and ⌥B; a bare ` would type into the held text)
      // (aegis re-check of F4: the platform's own modifier only, ⌘ on macOS, Ctrl elsewhere: on a Mac Ctrl+K is an
      // editing key of the text, not the palette)
      const own = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const chord = own && !e.altKey && !e.shiftKey && ['k', ',', 'n'].includes(e.key.toLowerCase());
      const altB = e.code === 'KeyB' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
      if (chord || altB || ['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape' || e.key === 'Tab' || e.key === 'Enter') say(shortLine());
      return;
    }
    if (inert !== 'link-down') return;
    if (e.key !== 'Escape' && e.key !== 'Tab' && !(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sayHeld(inertLine ?? KEEP_COPY.wordsHeld);
  };
  // a copy or a cut while held still takes nothing (the register was forgotten with the link): said, never silent
  const heldCopy = (e: Event): void => {
    if (inert === null || e.target === boardField()) return;
    sayHeld(inert === 'link-down' ? KEEP_COPY.copyDown : INERT_COPY['out-of-date']);
  };
  el.addEventListener('copy', heldCopy, true);
  el.addEventListener('cut', heldCopy, true);
  let going = false;
  const guardTypedBlur = (e: Event): void => {
    if (going || (inert !== 'link-down' && !tooShort) || e.target !== boardField()) return;
    // a host being hidden is the leaf going (a switch): its blur is not guarded by a too-short state it never had
    if (inert !== 'link-down' && el.getClientRects().length === 0) return;
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', guardTypedKey, true);
  el.addEventListener('blur', guardTypedBlur, true);
  el.addEventListener('focusout', guardTypedBlur, true);
  const textOpen = new Set<() => void>();
  el.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLTextAreaElement && boardHost.contains(e.target)) for (const fn of [...textOpen]) fn();
  }, true);
  headKey.addEventListener('click', (e) => (load === 'failed' ? start() : o.onDimensions?.(e)));
  escKey.addEventListener('click', foldAsk);
  // the leaf redraws on a focus move ONLY when the yield state flips (review B1: redrawing on every focusin replaced
  // the rail key under the pointer and looped with the redraw's own refocus)
  const onFocus = (): void => void queueMicrotask(() => yielded() !== wasYielded && draw());
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  // the hands menu closes where it is when focus leaves the foot and its menu, or on a press outside them
  // (a redraw moves no focused key: a focusout it causes is not focus leaving)
  foot.addEventListener('focusout', (e) => {
    if (!handsOpen || footDrawing || (e.relatedTarget instanceof Node && foot.contains(e.relatedTarget))) return;
    closeHands(false);
  });
  const outsideHands = (e: Event): void => void (handsOpen && !(e.target instanceof Node && foot.contains(e.target)) && closeHands(false));
  document.addEventListener('pointerdown', outsideHands, true);
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => draw());
  ro?.observe(el);

  start();
  return {
    focusBoard: () => handle?.focus(),
    redrawOver: () => drawOver(),
    el,
    speak(line) {
      // a polite line only: the keep line stays the person's own (design said.arrival). Cleared, then set on the next
      // frame (mika F8, aegis N-10), so the same words said twice are announced twice
      saidLine.textContent = '';
      requestAnimationFrame(() => void (saidLine.textContent = line));
    },
    drawFoot: () => drawFoot(),
    handle: () => handle,
    state: leafState,
    setTheme(next) {
      theme = next;
      handle?.setTheme(next);
      draw(); // (the title's face is wider at night: the head is measured again, H2)
    },
    retry: start,
    say,
    room: () => boardHeight(),
    sayHeld() {
      if (inert) sayHeld(inertLine ?? INERT_COPY[inert]);
      else if (holdsWords()) say(shortLine());
    },
    holdsWords,
    forget,
    setInert(why) {
      if (why === inert) return;
      inert = why;
      if (!why) inertLine = inertSaid = null;
      el.dataset.inert = why ?? '';
      if (why) {
        // one line, announced once; whatever was being said gives way to it
        said = '';
        clearTimeout(saidTimer);
        saidLine.textContent = inertWords();
        trayOpen = false;
        menu = null;
      } else saidLine.textContent = '';
      railKey = '';
      draw();
    },
    setKeep(line) {
      if (line === keepLine) return;
      keepLine = line;
      clearTimeout(keepTimer);
      if (line === null || line !== KEEP_COPY.saving) {
        keepShown = line;
        return draw();
      }
      // a save is shown only once it is slow
      keepTimer = setTimeout(() => {
        keepShown = keepLine;
        draw();
      }, KEEP_SLOW_MS);
    },
    setTitle(title) {
      if (!title || title === titleEl.textContent) return;
      titleEl.textContent = title;
      titleEl.title = title;
      boardHost.setAttribute('aria-label', `Board: ${title}`);
      el.setAttribute('aria-label', `Dimension: ${title}`);
      fitHead();
    },
    setCheck(line, tone = 'ok', co = {}) {
      const title = co.title ?? '';
      const open = co.open ?? true;
      if (line === checkWords && tone === checkTone && title === checkTitleText && open === checkOpen) return;
      checkWords = line;
      checkTone = tone;
      checkTitleText = title;
      checkOpen = open;
      // the root keeps the check and its tone whether or not the line is drawn (aegis C2.3)
      el.dataset.check = line;
      el.dataset.checkTone = tone;
      draw();
    },
    checkShown: () => checkInFoot,
    setInertLine(line) {
      if (line === inertLine) return;
      inertLine = line;
      if (inert) draw();
    },
    typed() {
      const f = boardField();
      if (!f) return null;
      return dimPastedWords(f.value).slice(0, DIM_LIMITS.text);
    },
    putTyped(words) {
      const f = boardField();
      if (!f || f.value !== '' || inert !== null) return false;
      f.value = dimPastedWords(words).slice(0, DIM_LIMITS.text);
      f.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    clearTyped() {
      const f = boardField();
      if (!f || f.value === '') return;
      f.value = '';
      f.dispatchEvent(new Event('input', { bubbles: true }));
    },
    onTextOpen(listener) {
      textOpen.add(listener);
      return () => void textOpen.delete(listener);
    },
    destroy() {
      window.removeEventListener('keydown', guardTypedKey, true);
      window.removeEventListener('pointerup', released, true);
      window.removeEventListener('pointercancel', released, true);
      clearTimeout(inertSaidTimer);
      // A text still open when the leaf goes: its field is ended first, so the engine takes its own window listeners
      // down with it (left up, the next press on ANY board ran the dead editor's submit and threw in a frame).
      // Nothing is sent: whoever destroys a leaf has already stopped listening to its handle.
      going = true;
      try {
        boardField()?.dispatchEvent(new FocusEvent('blur'));
      } catch {
        /* the engine is going anyway */
      }
      generation++;
      clearTimeout(saidTimer);
      clearTimeout(keepTimer);
      for (const off of offs.splice(0)) off();
      window.removeEventListener('blur', forget);
      clip.clear();
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocus);
      document.removeEventListener('pointerdown', outsideHands, true);
      cancelAnimationFrame(sceneFrame);
      ro?.disconnect();
      handle?.unmount();
      el.remove();
    },
  };
}

/** Under this much board height the leaf keeps its head and one line (re-exported for the fixtures). */
export { BOARD_MIN_HEIGHT };
