/**
 * @symbol #gui-board
 *
 * #gui-board loader (spec §12.7 "The GUI hosts the canvas directly", §11.2
 * rule 6; boards S1.0). The board engine (Excalidraw + React) is a SEPARATE
 * ES module, `board/board.js` in the pinned bundle, fetched by `import()` the
 * first time a board opens: app.js never imports React or anything under
 * src/board (test/board-isolation.test.ts), so a session that never opens a
 * board never parses the engine. Both files are same-origin members of the
 * hashed bundle tree, so `script-src 'self'` and `style-src 'self'` cover
 * them and the CSP is unchanged.
 *
 * This file is the whole surface core/ and ui/ may use: types plus the lazy
 * loader. Since S1.1 the engine is a bare drawing surface (its own toolbar,
 * menus and panels are removed at build time) and the handle is what a rail
 * drives it with: tools, line, fill and weight from content-palette tokens,
 * zoom, the theme. Since S1.3 (pass P3b) the board is a VIEW of a folded
 * dimension (`dim-shape:v1`): `render(state)` draws it, `onEdit` reports what a
 * person changed as ops, and the engine's own history is not used (undo is the
 * host's: `onUndoKey`). Only types are imported from the contracts here.
 */
import type { DimOp, DimState } from '@a-company/gnomon-contracts';

/** Bundle-relative paths of the board chunk (scripts/board-build.mjs emits exactly these names). */
export const BOARD_SCRIPT = 'board/board.js';
export const BOARD_STYLES = 'board/board.css';

/**
 * The tools of the Gnomon rail (design component board-rail), by the rail's names. Nothing else exists: the
 * engine's image, line, diamond, eraser, laser, embed and Mermaid tools cannot be chosen through the handle, and
 * the engine's own toolbar and tool keys are removed at build time.
 */
export const BOARD_TOOLS = ['select', 'sticky', 'text', 'rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand'] as const;
export type BoardTool = (typeof BOARD_TOOLS)[number];

/** Stroke weights of the content tray, in board units: fine 2, bold 4, marker 8 (marker draws with Stroke only). */
export const BOARD_WEIGHTS = { fine: 2, bold: 4, marker: 8 } as const;
export type BoardWeight = keyof typeof BOARD_WEIGHTS;
export type BoardTheme = 'day' | 'night';

/** The current line, fill and weight, as `content-palette:v1` tokens (a swatch name or `custom:#rrggbb`). */
export interface BoardStyle {
  /** a line token; `ink` by default */
  line: string;
  /** a fill token, or null for no fill */
  fill: string | null;
  weight: BoardWeight;
}

/** A style change that was not applied: the token fails the content palette's check. Nothing was stored. */
export interface BoardStyleRefusal {
  ok: false;
  field: 'line' | 'fill' | 'weight';
  /** the nearest named swatch for that role, when the palette offers one */
  offer: string | null;
}

/**
 * Who drew a mark, as the HOST knows it (design component author-seal: three hands). `human` is you; `agent` is an
 * agent the host named (`id` is the host-stamped agent id the seal is worked out from, `name` the text beside it:
 * the same id until a later pass gives agents display names; the leaf shows it through
 * core/board-overlay.ts boardAgentName, never raw); `unknown` is a mark with no author the host vouches
 * for. It is read ONLY from the `by` of the folded dimension the board last rendered, never from an element, so
 * nothing pasted, dropped or copied can carry one.
 */
/** The key a hand's seal and foot entry are worked out from: the host-stamped principal plus agent, length-prefixed (design author-seal derivation.input), so two sessions' Claudes are two hands. */
export const handKey = (principal: string, agent: string): string => `${[...principal].length}:${principal}${agent}`;

export type BoardAuthor = { cls: 'human' } | { cls: 'agent'; id: string; name: string; principal?: string; session?: string } | { cls: 'unknown' };

/** What the host layer needs to know about one mark, to lay DOM over it. Scene units; see BoardView for the screen. */
export interface BoardMarkView {
  /** the ENGINE's id of the element (minted by the handle; never the node id) */
  id: string;
  /** the node id in the rendered dimension; null for a mark drawn since the last render and for a label */
  node: string | null;
  /** `stub`: a node of a kind this build cannot draw (fallback-node); `other`: an engine element outside the rail's kinds */
  kind: 'sticky' | 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'frame' | 'stroke' | 'text' | 'stub' | 'other';
  /** bounding box */
  x: number;
  y: number;
  width: number;
  height: number;
  /** the mark's first point (a drawn mark's seal stands just off it) */
  firstX: number;
  firstY: number;
  /** the second point of a stroke or an arrow, when it has one (the seal stands on the far side of the first from it) */
  secondX?: number;
  secondY?: number;
  author: BoardAuthor;
  /** the mark's content-palette tokens (a label is always the default line) */
  line: string;
  fill: string | null;
  selected: boolean;
  /** the pointer is over this mark (design author-seal naming.hover; core/board-overlay.ts hoveredMark) */
  hovered?: boolean;
  /** the engine width of the mark's line (its weight), for the too-small rule */
  strokeWidth?: number;
  /** a text's letter size in board units (every board text is BOARD_FONT_SIZE today), for its letters' height on the screen */
  textSize?: number;
  /** a stub's kind exactly as it was given (the host pattern-checks it before showing it) */
  stubKind?: string;
  /** the mark this text is the label of, when it is one */
  labelOf?: string;
  /**
   * S1.4 E3 item 1 (author-seal.other_hands, .restored; fold fields outside the hash): the newest hand that changed
   * it, the newest OTHER hand that changed it (the countermark), the other hand whose words are in it, and the
   * ORIGINAL hand of a mark an undo re-added. Each from the rendered fold only, as `author` is.
   */
  changedBy?: BoardAuthor;
  otherBy?: BoardAuthor;
  wordsBy?: BoardAuthor;
  restoredFrom?: BoardAuthor;
  /** S1.4 E3: the mark's rotation in radians (the fold's `rot`, as the engine draws it): the countermark turns with it */
  angle?: number;
  /** an open mark's (stroke, arrow) last run, scene units: the countermark stands at 80% of it (R2) */
  lastRun?: { x1: number; y1: number; x2: number; y2: number };
  /** a bound label's box, scene units: the words sign spans it (R9); an arrow's countermark stands past it (R2) */
  labelBox?: { x: number; y: number; width: number; height: number };
}

/** The viewport: a scene point (x, y) is drawn at ((x + scrollX) * zoom, (y + scrollY) * zoom) from the board's top-left. */
export interface BoardView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** A paste or a drop that reached the board, as it was stopped before the engine (condition C8): what it offered, never its content. */
export interface BoardAttempt {
  kind: 'paste' | 'drop';
  /** the DataTransfer types offered, never their content */
  types: string[];
  files: number;
}

/**
 * Something the board refused, for the leaf to say in its own words (the engine shows nothing).
 *  - `image`: an image insert (a picked, pasted or dropped image, SVG source or HTML carrying one); no image kind until S2
 *  - `scene-file`, `library-file`, `file`: a file dropped on the board; the drop never reaches the engine
 *  - `drag` with `no-drop`: a drag that carries no file (selected text, a link): nothing can be dropped on a board
 *  - `file` with `no-file-paste`: a file on the clipboard; `paste` with `no-plain-text`: a paste that offers no plain
 *    text (an image copied from a page, a rich fragment with no text form). Nothing was added
 *  - `text` with `too-long`: pasted or typed words over what one mark may hold (`detail` is the limit). A paste
 *    adds nothing; a typed text goes back to what it was
 *  - `clipboard` with `nothing-held`: the pasted line stands for board marks this page no longer holds (said by
 *    the leaf, which owns the copy register; the handle never raises it)
 *  - `mark`: a pasted mark of a kind the board does not have (`detail` names the engine type); it was removed
 *  - `fallback`: a press on a mark this build cannot draw (`detail` is its kind). It is locked in the engine: it
 *    starts no drag, shows no handles and cannot be selected or deleted, so the leaf says why nothing happened
 */
export interface BoardRefusal {
  what: 'image' | 'scene-file' | 'library-file' | 'file' | 'drag' | 'mark' | 'fallback' | 'paste' | 'text' | 'clipboard';
  why: 'no-image-kind' | 'no-file-drop' | 'no-drop' | 'no-file-paste' | 'no-plain-text' | 'too-long' | 'nothing-held' | 'not-stored' | 'not-a-board-kind' | 'kept-as-it-is';
  detail?: string;
}

/** What a rail needs to draw itself; read with `state()` or pushed to `onState` listeners when it changes. */
export interface BoardState {
  tool: BoardTool;
  /** 1 is 100% */
  zoom: number;
  style: BoardStyle;
  theme: BoardTheme;
  /** non-deleted marks; a label inside a sticky or a shape is part of its mark, not one more */
  marks: number;
  /** selected marks that exist (never an id of something refused or undone) */
  selected: number;
  /** true while a text or a frame's title is being typed: single-letter tool keys must not act */
  editingText: boolean;
}

export interface BoardHandle {
  /**
   * Draw a folded dimension. The scene is DIFFED against it and updated outside the engine's history; a mark being
   * drawn, dragged or typed at that moment is left alone and is diffed against this state when the gesture ends.
   * NEVER fires `onEdit` (Aegis A1): a rendered row is not a gesture. Authorship, sticky and stub are read from
   * this state only. ONE handle shows ONE dimension: a state whose `dim` differs from the first one rendered throws
   * (on a dimension switch or a `cursor-epoch` reset the caller unmounts and mounts a new handle).
   */
  render(state: DimState): void;
  /**
   * Be told what a person changed, as ops against the state last rendered: once at pointer-up (a drag is one
   * `move`), at a text commit, at a delete, at a restyle of the selection. Never for a selection, a pan, a zoom, a
   * hover or a render. `cause` is the trusted DOM event that ended the gesture (the last pointerup or keydown the
   * board saw), for the gesture stamp; null when there was none. The ops are NOT validated here. A change that
   * maps to no op is undone on the board and not reported. ONLY marks the person touched are in the ops, and a
   * mark in hand is compared with the node it was drawn from: a remote change that landed mid-gesture is kept.
   * "Touched" is what the person had in hand (the selection, a mark being drawn, a text being typed), with its
   * label, the arrows tied to it and a frame's children: an engine change to any other mark is never in the ops.
   * `cause` is cleared after every report. Returns the unsubscribe.
   */
  onEdit(listener: (ops: DimOp[], cause: Event | null) => void): () => void;
  /**
   * Be told when Cmd/Ctrl+Z (`redo` false) or Cmd/Ctrl+Shift+Z / Ctrl+Y (`redo` true) is pressed in the board while
   * no text is being typed. The engine has no undo of its own (boards S1.3): the host inverts ops. The event is
   * the listener's own trusted keydown; its default is prevented. Returns the unsubscribe.
   */
  onUndoKey(listener: (event: KeyboardEvent, redo: boolean) => void): () => void;
  /**
   * S1.4 P4b: be told when, at the drop, a mark the person had in hand is no longer in the rendered state (another
   * hand removed it during the gesture). No op is made for it (it is not added back) and it leaves the board;
   * `change` is `moving` for a drag, `changing` for a resize, a restyle or a text edit. Never a refusal.
   */
  onGone?(listener: (report: { what: 'gone'; id: string; change: 'moving' | 'changing' }) => void): () => void;
  /**
   * While yielded (a card has the keyboard) the board reports no edit and the engine's document-level keyup and
   * gesture listeners do nothing (G-DDL-08).
   */
  setYielded(on: boolean): void;
  /**
   * The UNFILTERED diff of the scene against the state last rendered: empty when the board shows exactly that
   * state (a board holding a malformed order key always drifts by its re-key). A probe for tests and diagnostics;
   * never sent.
   */
  drift(): DimOp[];
  /** Non-deleted elements in the scene. */
  count(): number;
  /** Choose a rail tool. Throws on anything that is not in BOARD_TOOLS. */
  setTool(tool: BoardTool): void;
  /**
   * Set the current line, fill and/or weight from content-palette tokens. Applies to what is drawn next and to the
   * selected marks. A token that fails `contentColourCheck` is refused and nothing changes (never stepped to a
   * passing colour). `marker` is kept as the choice but draws as `bold` unless the tool is Stroke. `by` is the
   * rail's own trusted event (the press on a well): a restyle of the selection is reported as an edit only with
   * one, and it is that edit's `cause`; without it the restyle is put back.
   */
  setStyle(style: Partial<BoardStyle>, by?: Event | null): { ok: true } | BoardStyleRefusal;
  /** Day or night: re-reads the skin and re-resolves every mark's colours through the content palette. */
  setTheme(theme: BoardTheme): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Back to 100%. */
  zoomReset(): void;
  /** Fit everything drawn into the pane. */
  zoomToFit(): void;
  state(): BoardState;
  /** Be told when `state()` would answer differently. Returns the unsubscribe. */
  onState(listener: (state: BoardState) => void): () => void;
  /** Every non-deleted mark, in paint order. */
  marks(): BoardMarkView[];
  view(): BoardView;
  /**
   * Put the viewport where it was (the pan and the zoom of an earlier `view()`): a board mounted again for the same
   * dimension after a reconnect opens where the person was looking. Never an edit; values that are not finite, or
   * a zoom outside 10% to 3000%, are ignored.
   */
  setView(view: Pick<BoardView, 'scrollX' | 'scrollY' | 'zoom'>): void;
  /** Be told when `marks()` or `view()` would answer differently (a mark drawn or moved, a pan, a zoom, a resize). */
  onScene(listener: () => void): () => void;
  /** Give the board the keyboard (its drawing surface takes focus; the page does not scroll). */
  focus(): void;
  /** True while focus is inside the board (the surface or a text being typed). */
  hasFocus(): boolean;
  /**
   * Be told about a paste or a drop on the board, as it is stopped before the engine (condition C8): the types
   * offered and the file count, never the content. Every drop, and every paste outside a text being typed, is
   * stopped; what was refused is also said through `onRefusal`.
   */
  onAttempt(listener: (attempt: BoardAttempt) => void): () => void;
  /**
   * Be told when a person pastes plain text on the board (not into a text being typed, which takes it natively).
   * The handle adds NOTHING itself and never parses the text: the listener decides what the words become (the leaf:
   * clones of its own copy, or one text mark). `cause` is the trusted `paste` event, for the gesture stamp. A paste
   * that carries a file, offers no plain text or is over `DIM_LIMITS.text` is refused instead (`onRefusal`).
   */
  onPasteText(listener: (text: string, cause: ClipboardEvent) => void): () => void;
  /**
   * Be told when a person copies on the board, with the NODE ids of the selected marks the rendered state holds
   * (paint order; possibly none). The listener answers the plain text for the system clipboard, synchronously; the
   * handle puts it there as `text/plain` and nothing else. An empty answer leaves the clipboard as it is. The
   * engine never writes the clipboard.
   */
  onCopy(listener: (nodeIds: string[], cause: ClipboardEvent) => string | null | void): () => void;
  /**
   * As `onCopy`, for a cut: the listener answers the text AND the node ids its register took (a frame's children
   * with it); EXACTLY those nodes are deleted, and no others, reported through `onEdit` as the person's deletes.
   * An empty answer cuts nothing. `cause` here and on that edit is the Cmd/Ctrl+X keydown when the cut
   * came from the keyboard (a gesture stamp can be minted from it), else the `cut` event. A copy or
   * a cut whose selection includes a mark not stored yet takes nothing: it is refused (`clipboard`, `not-stored`)
   * and `onCopyOutside` listeners are told, so a stale copy cannot be pasted in its place.
   */
  onCut(listener: (nodeIds: string[], cause: Event) => { text: string; ids: string[] } | null | void): () => void;
  /**
   * Select exactly these nodes (the marks a paste just added), once every one of them is rendered: at once when
   * they are, else after the render that brings them. Dropped if the person presses or types first. Selecting is
   * never an edit.
   */
  select(nodeIds: readonly string[]): void;
  /** Be told when a copy or a cut happens anywhere else on the page, so the caller can forget what it held. */
  onCopyOutside(listener: () => void): () => void;
  /** Be told when the board refused something, so the leaf can say so. The engine itself shows nothing. */
  onRefusal(listener: (refusal: BoardRefusal) => void): () => void;
  /** The scene as a PNG on the theme's ground, rendered on a canvas (the GUI never exports SVG, §12.7). */
  exportPng(): Promise<Blob>;
  /**
   * Be told when the engine throws AFTER the mount resolved (a render crash); the caller shows it and unmounts.
   * With no listener registered the error is not swallowed: it goes to the page's error event (reportError).
   */
  onError(listener: (error: Error) => void): void;
  /** False once the engine has crashed or the board was unmounted; every other method then throws. */
  isAlive(): boolean;
  unmount(): void;
}

export interface BoardMountOptions {
  /** Same as handle.onError, registered before the first render. */
  onError?: (error: Error) => void;
  /** How long the engine may take to come up before the mount rejects and unmounts (default 15 s). */
  timeoutMs?: number;
  /** The theme to draw in (default day). Change it later with handle.setTheme. */
  theme?: BoardTheme;
  /**
   * The leaf's own element around the board (head, rail, tray, foot). A paste, a copy or a cut made with the
   * keyboard focus on that chrome is the board's (it used to add nothing and say nothing); a text field of the
   * chrome keeps its own. Drags over it are the leaf's to refuse.
   */
  chrome?: HTMLElement;
  /**
   * PROBE BUILD ONLY. The chunk that ships IGNORES it: the branch that reads it is removed at build time (define
   * `__GNOMON_BOARD_PROBE__` is false in scripts/board-build.mjs; test/board-patches.test.ts holds that the pinned
   * `board/board.js` does not contain the word). Only the probe build the P12 harness makes for WKWebView, which
   * has no trusted input, lets untrusted pointer and key events count as a person's input.
   */
  syntheticInput?: boolean;
}

export interface BoardModule {
  /** `<name>@<version>` of the engine built into the chunk. */
  readonly BOARD_ENGINE: string;
  /**
   * Mount a board into `host` (which must have a size). Resolves once the engine has finished initialising its
   * scene and the board's text face has loaded, so a mark added in the same tick stays and text measures with the
   * bundled face; rejects (and unmounts) when the engine throws first or does not
   * come up within `timeoutMs`.
   */
  mountBoard(host: HTMLElement, options?: BoardMountOptions): Promise<BoardHandle>;
}

interface LoaderLink {
  rel: string;
  href: string;
  dataset: Record<string, string | undefined>;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
}
interface LoaderDoc {
  readonly baseURI: string;
  readonly head: { appendChild(node: unknown): unknown };
  createElement(tag: 'link'): LoaderLink;
}

/** How long the chunk and its stylesheet may take to load before the open fails. */
export const LOAD_TIMEOUT_MS = 20_000;

let pending: Promise<BoardModule> | null = null;

/** The absolute URL of a bundle member, resolved against the page (never a second origin). */
export const boardUrl = (member: string, baseURI: string): string => new URL(member, baseURI).href;

/**
 * Load the board chunk once: the stylesheet (a `<link>`, never inline style) AND the module. It resolves only when
 * both have loaded, so a board never mounts unstyled. A failed load is not cached and leaves no link behind: the
 * next open starts clean, and the caller shows the failure.
 */
export function loadBoard(doc: LoaderDoc = document as unknown as LoaderDoc, importer: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url), timeoutMs: number = LOAD_TIMEOUT_MS): Promise<BoardModule> {
  if (pending) return pending;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = boardUrl(BOARD_STYLES, doc.baseURI);
  link.dataset.gnomonBoard = '1';
  const styled = new Promise<void>((resolve, reject) => {
    link.onload = () => resolve();
    link.onerror = () => reject(new Error('the board stylesheet did not load'));
  });
  doc.head.appendChild(link);
  // a stylesheet or module that never settles (a stalled connection) is a failed load, not a board that never opens
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('the board did not load in time')), timeoutMs);
  });
  const loaded = Promise.all([importer(boardUrl(BOARD_SCRIPT, doc.baseURI)), styled]);
  loaded.catch(() => undefined); // the race below reports it; a late rejection after a timeout is not unhandled
  const p = Promise.race([loaded, timedOut]).finally(() => clearTimeout(timer)).then(([m]) => {
    const mod = m as Partial<BoardModule> | null;
    if (!mod || typeof mod.mountBoard !== 'function' || typeof mod.BOARD_ENGINE !== 'string') throw new Error('the board chunk did not export mountBoard');
    return mod as BoardModule;
  });
  pending = p;
  p.catch(() => {
    if (pending === p) pending = null;
    link.onload = link.onerror = null;
    link.remove();
  });
  return p;
}

/** Test seam: forget the cached load. */
export function resetBoardLoader(): void {
  pending = null;
}
