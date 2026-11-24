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
 * loader. The handle is the S1.0 harness surface (mount, add a mark, switch
 * tool, PNG export); the `doodle-shape:v1` mapping arrives with S1.2.
 */

/** Bundle-relative paths of the board chunk (scripts/board-build.mjs emits exactly these names). */
export const BOARD_SCRIPT = 'board/board.js';
export const BOARD_STYLES = 'board/board.css';

export type BoardTool = 'selection' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'freedraw' | 'text' | 'eraser' | 'laser' | 'hand';

/** A mark added through the handle (S1.0: enough to prove draw and export; not the stored shape vocabulary). */
export interface BoardMark {
  type: 'rectangle' | 'ellipse' | 'diamond' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
}

export interface BoardHandle {
  /** Append marks to the scene; returns the scene's element count afterwards. */
  add(marks: readonly BoardMark[]): number;
  /** Non-deleted elements in the scene. */
  count(): number;
  setTool(tool: BoardTool): void;
  /** The scene as a PNG, rendered on a canvas (the GUI never exports SVG, §12.7). */
  exportPng(): Promise<Blob>;
  /**
   * Be told when the engine throws AFTER the mount resolved (a render crash); the caller shows it and unmounts.
   * With no listener registered the error is not swallowed: it goes to the page's error event (reportError).
   */
  onError(listener: (error: Error) => void): void;
  /** False once the engine has crashed or the board was unmounted; add, count, setTool and exportPng then throw. */
  isAlive(): boolean;
  unmount(): void;
}

export interface BoardMountOptions {
  /** Same as handle.onError, registered before the first render. */
  onError?: (error: Error) => void;
  /** How long the engine may take to come up before the mount rejects and unmounts (default 15 s). */
  timeoutMs?: number;
}

export interface BoardModule {
  /** `<name>@<version>` of the engine built into the chunk. */
  readonly BOARD_ENGINE: string;
  /**
   * Mount a board into `host` (which must have a size). Resolves once the engine has finished initialising its
   * scene, so a mark added in the same tick stays; rejects (and unmounts) when the engine throws first or does not
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
