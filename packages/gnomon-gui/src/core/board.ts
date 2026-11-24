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
 * zoom, undo and redo, the theme. The stored shape vocabulary arrives with S1.3.
 */

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
 * agent the host named (`id` is the host-stamped author id the seal is worked out from, `name` the text beside
 * it); `unknown` is a mark with no author the host vouches for. It is never read from anything a person or an
 * agent typed: until S1.3 maps real rows, only the handle's `add` (the fixture) sets it.
 */
export type BoardAuthor = { cls: 'human' } | { cls: 'agent'; id: string; name: string } | { cls: 'unknown' };

/** What the host layer needs to know about one mark, to lay DOM over it. Scene units; see BoardView for the screen. */
export interface BoardMarkView {
  id: string;
  /** `stub`: a node of a kind this build cannot draw (fallback-node); `other`: an engine element outside the rail's kinds */
  kind: 'sticky' | 'rect' | 'ellipse' | 'arrow' | 'frame' | 'stroke' | 'text' | 'stub' | 'other';
  /** bounding box */
  x: number;
  y: number;
  width: number;
  height: number;
  /** the mark's first point (where a drawn mark's seal sits) */
  firstX: number;
  firstY: number;
  author: BoardAuthor;
  /** the mark's content-palette tokens (a label is always the default line) */
  line: string;
  fill: string | null;
  selected: boolean;
  /** a stub's kind exactly as it was given (the host pattern-checks it before showing it) */
  stubKind?: string;
  /** the mark this text is the label of, when it is one */
  labelOf?: string;
}

/** The viewport: a scene point (x, y) is drawn at ((x + scrollX) * zoom, (y + scrollY) * zoom) from the board's top-left. */
export interface BoardView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** A paste or a drop that reached the board. Reported, not acted on and not stopped (S1.3 intercepts: condition C8). */
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
 *  - `table`: tab-separated text pasted (the engine's chart dialog is not built into the board)
 *  - `mark`: a pasted mark of a kind the board does not have (`detail` names the engine type); it was removed
 */
export interface BoardRefusal {
  what: 'image' | 'scene-file' | 'library-file' | 'file' | 'table' | 'mark';
  why: 'no-image-kind' | 'no-file-drop' | 'no-table-kind' | 'not-a-board-kind';
  detail?: string;
}

/** A mark added through the handle (enough for the fixture and the probes; not the stored shape vocabulary). */
export interface BoardMark {
  type: 'rectangle' | 'ellipse' | 'text' | 'sticky' | 'arrow' | 'frame' | 'stub';
  /** who drew it (default: you). An agent's or an unknown hand's mark is drawn dashed; that is derived, never set */
  by?: BoardAuthor;
  /** a stub's kind */
  kind?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  /** content-palette tokens; a token that fails the palette's check draws as ink (line) or as no fill */
  line?: string;
  fill?: string | null;
  weight?: BoardWeight;
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
  /** Append marks to the scene; returns the scene's element count afterwards. */
  add(marks: readonly BoardMark[]): number;
  /** Non-deleted elements in the scene. */
  count(): number;
  /** Choose a rail tool. Throws on anything that is not in BOARD_TOOLS. */
  setTool(tool: BoardTool): void;
  /**
   * Set the current line, fill and/or weight from content-palette tokens. Applies to what is drawn next and to the
   * selected marks. A token that fails `contentColourCheck` is refused and nothing changes (never stepped to a
   * passing colour). `marker` is kept as the choice but draws as `bold` unless the tool is Stroke.
   */
  setStyle(style: Partial<BoardStyle>): { ok: true } | BoardStyleRefusal;
  /** Day or night: re-reads the skin and re-resolves every mark's colours through the content palette. */
  setTheme(theme: BoardTheme): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Back to 100%. */
  zoomReset(): void;
  /** Fit everything drawn into the pane. */
  zoomToFit(): void;
  undo(): void;
  redo(): void;
  state(): BoardState;
  /** Be told when `state()` would answer differently. Returns the unsubscribe. */
  onState(listener: (state: BoardState) => void): () => void;
  /** Every non-deleted mark, in paint order. */
  marks(): BoardMarkView[];
  view(): BoardView;
  /** Be told when `marks()` or `view()` would answer differently (a mark drawn or moved, a pan, a zoom, a resize). */
  onScene(listener: () => void): () => void;
  /** Give the board the keyboard (its drawing surface takes focus; the page does not scroll). */
  focus(): void;
  /** True while focus is inside the board (the surface or a text being typed). */
  hasFocus(): boolean;
  /**
   * Be told about a paste or a drop on the board, before the engine. A paste is reported and left alone (S1.3
   * intercepts it: condition C8); a drop that carries files is stopped here and also reported as a refusal.
   */
  onAttempt(listener: (attempt: BoardAttempt) => void): () => void;
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
