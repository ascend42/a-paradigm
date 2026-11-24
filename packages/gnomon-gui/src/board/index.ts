/**
 * @symbol #gui-board
 *
 * #gui-board chunk entry (spec §12.7, boards S1.0): the only module that
 * imports React and Excalidraw. scripts/board-build.mjs bundles it as one ES
 * module, `board/board.js` + `board/board.css`, with the engine patched and
 * pruned at build time (scripts/board-patches.mjs); core/board.ts loads it
 * with `import()` when a board opens.
 *
 * S1.0 mounts the stock engine with the props that are security posture, not
 * look: no global keyboard capture, no embeddables, no file open or save, one
 * fixed theme and language. The reskin is S1.1.
 */
import './asset-path.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { convertToExcalidrawElements, Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { BoardHandle, BoardMark, BoardMountOptions, BoardTool } from '../core/board.js';

declare const __GNOMON_BOARD_ENGINE__: string;

/** `<name>@<version>` of the engine, stamped by the build from the installed package. */
export const BOARD_ENGINE: string = __GNOMON_BOARD_ENGINE__;

type Api = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]['excalidrawAPI']>>[0];
type Skeleton = Parameters<typeof convertToExcalidrawElements>[0];

const skeletonOf = (m: BoardMark): Record<string, unknown> =>
  m.type === 'text' ? { type: 'text', x: m.x, y: m.y, text: m.text ?? '' } : { type: m.type, x: m.x, y: m.y, width: m.width ?? 120, height: m.height ?? 80 };

const DEFAULT_MOUNT_TIMEOUT_MS = 15_000;
const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** How often the mount looks at the engine's loading flag while it initialises its scene. */
const READY_POLL_MS = 5;

export function mountBoard(host: HTMLElement, options: BoardMountOptions = {}): Promise<BoardHandle> {
  return new Promise<BoardHandle>((resolve, reject) => {
    const listeners: Array<(error: Error) => void> = options.onError ? [options.onError] : [];
    let settled = false;
    let dead: string | null = null;
    // Before the mount resolves an engine error rejects it. Afterwards the board is dead: its listeners are told,
    // and with none registered the error goes to the page's error event instead of nowhere (these two root
    // options REPLACE React's default reporting).
    const crashed = (e: unknown): void => {
      const error = asError(e);
      if (!settled) return fail(error);
      dead ??= error.message || 'the engine threw';
      if (listeners.length === 0) return void globalThis.reportError(error);
      for (const l of [...listeners]) l(error);
    };
    // React 19 root options (the workspace's hoisted @types/react-dom is the 18 line, which does not know them yet)
    const rootOptions = { onUncaughtError: crashed, onCaughtError: crashed };
    const root = createRoot(host, rootOptions as Parameters<typeof createRoot>[1]);
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(poll);
      root.unmount();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('the board engine did not come up in time')), options.timeoutMs ?? DEFAULT_MOUNT_TIMEOUT_MS);
    let poll: ReturnType<typeof setTimeout> | undefined;
    const handleOf = (api: Api): BoardHandle => {
      const live = (): ReturnType<Api['getSceneElements']> => {
        if (dead !== null) throw new Error(`the board engine has stopped: ${dead}`);
        return api.getSceneElements();
      };
      return {
        add(marks: readonly BoardMark[]): number {
          const before = live();
          const added = convertToExcalidrawElements(marks.map(skeletonOf) as Skeleton);
          api.updateScene({ elements: [...before, ...added] });
          return live().length;
        },
        count: () => live().length,
        setTool: (tool: BoardTool) => void (live(), api.setActiveTool({ type: tool })),
        exportPng: async () => exportToBlob({ elements: live(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles(), mimeType: 'image/png' }),
        onError: (listener) => void listeners.push(listener),
        isAlive: () => dead === null,
        unmount: () => {
          dead ??= 'unmounted';
          root.unmount();
        },
      };
    };
    // The engine hands out its API while it is still constructing; its scene is initialised later (an async step
    // that REPLACES the scene's elements and then clears `isLoading`). Resolving before that would let a mark
    // added in the same tick be wiped a few milliseconds on, so the mount waits for the flag.
    const ready = (api: Api): void => {
      const check = (): void => {
        if (settled) return;
        if (api.getAppState().isLoading) return void (poll = setTimeout(check, READY_POLL_MS));
        settled = true;
        clearTimeout(timer);
        resolve(handleOf(api));
      };
      check();
    };
    root.render(
      createElement(Excalidraw, {
        excalidrawAPI: ready,
        langCode: 'en',
        theme: 'light',
        autoFocus: false,
        handleKeyboardGlobally: false,
        validateEmbeddable: false,
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } },
      }),
    );
  });
}
