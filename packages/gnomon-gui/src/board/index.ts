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

export function mountBoard(host: HTMLElement, options: BoardMountOptions = {}): Promise<BoardHandle> {
  return new Promise<BoardHandle>((resolve, reject) => {
    const listeners: Array<(error: Error) => void> = options.onError ? [options.onError] : [];
    let settled = false;
    // before the mount resolves an engine error rejects it; afterwards it goes to the handle's listeners
    const crashed = (e: unknown): void => {
      if (!settled) fail(asError(e));
      else for (const l of [...listeners]) l(asError(e));
    };
    // React 19 root options (the workspace's hoisted @types/react-dom is the 18 line, which does not know them yet)
    const rootOptions = { onUncaughtError: crashed, onCaughtError: crashed };
    const root = createRoot(host, rootOptions as Parameters<typeof createRoot>[1]);
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      root.unmount();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('the board engine did not come up in time')), options.timeoutMs ?? DEFAULT_MOUNT_TIMEOUT_MS);
    const ready = (api: Api): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const live = (): ReturnType<Api['getSceneElements']> => api.getSceneElements();
      resolve({
        add(marks: readonly BoardMark[]): number {
          const added = convertToExcalidrawElements(marks.map(skeletonOf) as Skeleton);
          api.updateScene({ elements: [...live(), ...added] });
          return live().length;
        },
        count: () => live().length,
        setTool: (tool: BoardTool) => api.setActiveTool({ type: tool }),
        exportPng: () => exportToBlob({ elements: live(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles(), mimeType: 'image/png' }),
        onError: (listener) => void listeners.push(listener),
        unmount: () => root.unmount(),
      });
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
