/**
 * @symbol #gui-board
 *
 * #gui-board chunk entry (spec §12.7, boards S1.0 and S1.1): the only module
 * that imports React and Excalidraw. scripts/board-build.mjs bundles it as one
 * ES module, `board/board.js` + `board/board.css`, with the engine patched and
 * pruned at build time (scripts/board-patches.mjs); core/board.ts loads it
 * with `import()` when a board opens.
 *
 * Since S1.1 the engine is a bare drawing surface (oracle G-DDL-07, design
 * rule engine-wears-the-system): its UI layer is not rendered, and the handle
 * returned here is what a Gnomon rail drives it with. Colours never come from
 * the engine: every mark carries its `content-palette:v1` tokens
 * (`customData.gnomon`) and is painted with `resolveContentColour` for the
 * active theme; what is not a mark reads `gnomonBoardSkin` (skin.ts). The
 * engine itself stays in its light theme.
 */
import './asset-path.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob, mutateElement, newElementWith } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './skin.css';
import { CONTENT_DEFAULTS, contentColourCheck, resolveContentColour } from '@a-company/gnomon-contracts';
import { BOARD_TOOLS, BOARD_WEIGHTS } from '../core/board.js';
import type { BoardHandle, BoardMark, BoardMountOptions, BoardState, BoardStyle, BoardStyleRefusal, BoardTheme, BoardTool } from '../core/board.js';
import { applySkin, gnomonBoardSkin } from './skin.js';

declare const __GNOMON_BOARD_ENGINE__: string;

/** `<name>@<version>` of the engine, stamped by the build from the installed package. */
export const BOARD_ENGINE: string = __GNOMON_BOARD_ENGINE__;

/** The one text face (patches font-family-table, font-registry-empty): its engine family id, name and size. */
export const BOARD_FONT_ID = 10;
export const BOARD_FONT_FAMILY = 'JetBrains Mono';
export const BOARD_FONT_SIZE = 13.5;

type StockApi = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]['excalidrawAPI']>>[0];
/** The imperative API plus the one method patch `api-run-action` adds. */
type Api = StockApi & { gnomonAction(name: string, value?: unknown): void };
type Skeleton = Parameters<typeof convertToExcalidrawElements>[0];
/** The fields of an engine element the handle reads (structural: the engine's own union is wider). */
interface Element {
  readonly id: string;
  readonly type: string;
  readonly strokeColor: string;
  readonly backgroundColor: string;
  readonly isDeleted: boolean;
  readonly customData?: Record<string, unknown>;
}
/** `newElementWith` over the structural type: a changed copy of the same element. */
const changed = <T extends Element>(el: T, updates: Record<string, unknown>): T => newElementWith(el as never, updates as never) as T;
type EngineTool = 'selection' | 'rectangle' | 'ellipse' | 'arrow' | 'frame' | 'freedraw' | 'text' | 'hand';

/** What a mark remembers about its colours: tokens, never hex. `kind` marks a sticky (drawn as a rectangle). */
interface Stamp {
  line: string;
  fill: string | null;
  kind?: 'sticky';
}

const ENGINE_TOOL: Readonly<Record<BoardTool, EngineTool>> = { select: 'selection', sticky: 'rectangle', text: 'text', rect: 'rectangle', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', stroke: 'freedraw', hand: 'hand' };
const RAIL_TOOL: Readonly<Record<EngineTool, BoardTool>> = { selection: 'select', rectangle: 'rect', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', freedraw: 'stroke', text: 'text', hand: 'hand' };
/** The engine actions the handle may run through `gnomonAction`. */
const HANDLE_ACTIONS = ['zoomIn', 'zoomOut', 'resetZoom', 'zoomToFit', 'undo', 'redo'] as const;
/** Element types whose background is a fill a person chose. */
const FILLABLE = new Set(['rectangle', 'ellipse', 'diamond']);

const lineColour = (token: unknown, theme: BoardTheme): string => resolveContentColour(token, 'line', theme) ?? gnomonBoardSkin.ink;
const fillColour = (token: unknown, theme: BoardTheme): string => (token === null ? null : resolveContentColour(token, 'fill', theme)) ?? 'transparent';
const stampOf = (el: Element): Stamp | null => {
  const g = (el.customData as { gnomon?: Partial<Stamp> } | undefined)?.gnomon;
  return g && typeof g.line === 'string' ? { line: g.line, fill: typeof g.fill === 'string' ? g.fill : null, ...(g.kind === 'sticky' ? { kind: 'sticky' as const } : {}) } : null;
};

const DEFAULT_MOUNT_TIMEOUT_MS = 15_000;
const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** How often the mount looks at the engine's loading flag while it initialises its scene. */
const READY_POLL_MS = 5;

export function mountBoard(host: HTMLElement, options: BoardMountOptions = {}): Promise<BoardHandle> {
  return new Promise<BoardHandle>((resolve, reject) => {
    const listeners: Array<(error: Error) => void> = options.onError ? [options.onError] : [];
    let settled = false;
    let dead: string | null = null;
    let theme: BoardTheme = options.theme === 'night' ? 'night' : 'day';
    let style: BoardStyle = { line: CONTENT_DEFAULTS.line, fill: null, weight: 'fine' };
    let tool: BoardTool = 'select';
    applySkin(theme);
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

    /** The fill token the next mark gets: a sticky is never unfilled. */
    const fillToken = (): string | null => (tool === 'sticky' ? (style.fill ?? CONTENT_DEFAULTS.stickyFill) : style.fill);
    /** `marker` is for Stroke only; with any other tool it draws as `bold`. */
    const weightNow = (): number => BOARD_WEIGHTS[style.weight === 'marker' && tool !== 'stroke' ? 'bold' : style.weight];
    /** The engine's "current item" state, always derived: solid, exact, one face, one size. */
    const current = (): Record<string, unknown> => ({
      currentItemStrokeColor: lineColour(style.line, theme),
      currentItemBackgroundColor: fillColour(fillToken(), theme),
      currentItemStrokeWidth: weightNow(),
      currentItemFillStyle: 'solid',
      currentItemStrokeStyle: 'solid',
      currentItemRoughness: 0,
      currentItemOpacity: 100,
      currentItemRoundness: 'sharp',
      currentItemFontFamily: BOARD_FONT_ID,
      currentItemFontSize: BOARD_FONT_SIZE,
      currentItemTextAlign: 'left',
    });

    const handleOf = (api: Api): BoardHandle => {
      const stateListeners = new Set<(state: BoardState) => void>();
      let lastState = '';
      let recolouring = false;
      const live = (): ReturnType<Api['getSceneElements']> => {
        if (dead !== null) throw new Error(`the board engine has stopped: ${dead}`);
        return api.getSceneElements();
      };
      const snapshot = (): BoardState => {
        const s = api.getAppState();
        return { tool, zoom: s.zoom.value, style: { ...style }, theme, marks: api.getSceneElements().length, selected: Object.keys(s.selectedElementIds).length, editingText: s.editingTextElement != null };
      };
      const announce = (): void => {
        if (dead !== null) return;
        const now = snapshot();
        const key = JSON.stringify(now);
        if (key === lastState) return;
        lastState = key;
        for (const l of [...stateListeners]) l(now);
      };
      const pushCurrent = (): void => api.updateScene({ appState: current() as never, captureUpdate: CaptureUpdateAction.NEVER });
      /** The colours a stamped mark has in this theme. A mark with no stamp is ink with no fill. */
      const painted = (el: Element): { strokeColor: string; backgroundColor: string } => {
        const g = stampOf(el);
        return { strokeColor: lineColour(g?.line ?? CONTENT_DEFAULTS.line, theme), backgroundColor: fillColour(g && FILLABLE.has(el.type) ? g.fill : null, theme) };
      };
      const mismatched = (el: Element): boolean => {
        const want = painted(el);
        return el.strokeColor !== want.strokeColor || el.backgroundColor !== want.backgroundColor;
      };
      /** Repaint every mark from its tokens (a theme change, or an undo that brought back another theme's colours). */
      const recolourAll = (): void => {
        if (dead !== null) return;
        recolouring = true;
        try {
          const all = api.getSceneElementsIncludingDeleted();
          api.updateScene({ elements: all.map((el) => (mismatched(el) ? changed(el, painted(el)) : el)), appState: current() as never, captureUpdate: CaptureUpdateAction.NEVER });
        } finally {
          recolouring = false;
        }
      };
      // The engine tells the handle about every change: a mark drawn by pointer gets its tokens here (in place, so
      // a mark still being dragged out is not replaced under the engine), the rail tool follows the engine's tool
      // (it returns to Select after a shape), and colours that do not match their tokens are repainted.
      const unsubscribe = api.onChange((elements, appState) => {
        if (dead !== null || recolouring) return;
        const engineTool = appState.activeTool.type as EngineTool;
        if (!(engineTool in RAIL_TOOL)) api.setActiveTool({ type: 'selection' });
        else if (ENGINE_TOOL[tool] !== engineTool) {
          const wasSticky = tool === 'sticky';
          tool = RAIL_TOOL[engineTool];
          if (wasSticky) queueMicrotask(() => dead === null && pushCurrent());
        }
        let repaint = false;
        for (const el of elements) {
          if (!stampOf(el)) {
            const stamp: Stamp = { line: style.line, fill: FILLABLE.has(el.type) ? fillToken() : null, ...(tool === 'sticky' && el.type === 'rectangle' ? { kind: 'sticky' as const } : {}) };
            mutateElement(el as never, { customData: { ...el.customData, gnomon: stamp } } as never, false);
          }
          if (mismatched(el) && el.id !== appState.newElement?.id) repaint = true;
        }
        if (repaint) queueMicrotask(recolourAll);
        announce();
      });
      const run = (name: (typeof HANDLE_ACTIONS)[number]): void => {
        live();
        api.gnomonAction(name);
        announce();
      };
      const skeletonOf = (m: BoardMark): Record<string, unknown> => {
        const sticky = m.type === 'sticky';
        const stamp: Stamp = { line: m.line ?? CONTENT_DEFAULTS.line, fill: sticky ? (m.fill ?? CONTENT_DEFAULTS.stickyFill) : m.type === 'rectangle' || m.type === 'ellipse' ? (m.fill ?? null) : null, ...(sticky ? { kind: 'sticky' as const } : {}) };
        const text = { fontSize: BOARD_FONT_SIZE, fontFamily: BOARD_FONT_ID };
        const base = { x: m.x, y: m.y, strokeColor: lineColour(stamp.line, theme), backgroundColor: fillColour(stamp.fill, theme), strokeWidth: BOARD_WEIGHTS[m.weight === 'marker' ? 'bold' : (m.weight ?? 'fine')], strokeStyle: 'solid', fillStyle: 'solid', roughness: 0, roundness: null, customData: { gnomon: stamp } };
        if (m.type === 'text') return { ...base, ...text, type: 'text', text: m.text ?? '' };
        if (m.type === 'arrow') return { ...base, type: 'arrow', width: m.width ?? 120, height: m.height ?? 0, endArrowhead: 'arrow' };
        if (m.type === 'frame') return { ...base, type: 'frame', children: [], width: m.width ?? 240, height: m.height ?? 160, ...(m.text ? { name: m.text } : {}) };
        const label = m.text ? { label: { ...text, text: m.text, strokeColor: lineColour(CONTENT_DEFAULTS.line, theme), customData: { gnomon: { line: CONTENT_DEFAULTS.line, fill: null } } } } : {};
        return { ...base, ...label, type: sticky ? 'rectangle' : m.type, width: m.width ?? 120, height: m.height ?? 80 };
      };
      const refusal = (field: BoardStyleRefusal['field'], offer: string | null = null): BoardStyleRefusal => ({ ok: false, field, offer });
      return {
        add(marks: readonly BoardMark[]): number {
          const before = live();
          const added = convertToExcalidrawElements(marks.map(skeletonOf) as Skeleton);
          api.updateScene({ elements: [...before, ...added] });
          announce();
          return live().length;
        },
        count: () => live().length,
        setTool(next: BoardTool): void {
          live();
          if (!BOARD_TOOLS.includes(next)) throw new Error(`the board has no ${String(next)} tool`);
          tool = next;
          pushCurrent();
          api.setActiveTool({ type: ENGINE_TOOL[next] });
          announce();
        },
        setStyle(next: Partial<BoardStyle>) {
          live();
          if (next.line !== undefined) {
            const c = contentColourCheck(next.line, 'line');
            if (!c.ok) return refusal('line', c.offer);
          }
          if (next.fill !== undefined && next.fill !== null) {
            const c = contentColourCheck(next.fill, 'fill');
            if (!c.ok) return refusal('fill', c.offer);
          }
          if (next.weight !== undefined && !Object.prototype.hasOwnProperty.call(BOARD_WEIGHTS, next.weight)) return refusal('weight');
          style = { line: next.line ?? style.line, fill: next.fill === undefined ? style.fill : next.fill, weight: next.weight ?? style.weight };
          const selected = api.getAppState().selectedElementIds;
          let touched = false;
          const elements = api.getSceneElementsIncludingDeleted().map((el) => {
            if (!selected[el.id] || el.isDeleted) return el;
            const old = stampOf(el) ?? { line: CONTENT_DEFAULTS.line, fill: null };
            const stamp: Stamp = { ...old, ...(next.line !== undefined ? { line: next.line } : {}), ...(next.fill !== undefined && FILLABLE.has(el.type) ? { fill: next.fill ?? (old.kind === 'sticky' ? CONTENT_DEFAULTS.stickyFill : null) } : {}) };
            touched = true;
            return changed(el, {
              strokeColor: lineColour(stamp.line, theme),
              backgroundColor: fillColour(FILLABLE.has(el.type) ? stamp.fill : null, theme),
              ...(next.weight !== undefined && el.type !== 'text' && el.type !== 'frame' ? { strokeWidth: BOARD_WEIGHTS[next.weight === 'marker' && el.type !== 'freedraw' ? 'bold' : next.weight] } : {}),
              customData: { ...el.customData, gnomon: stamp },
            });
          });
          api.updateScene({ ...(touched ? { elements } : {}), appState: current() as never, captureUpdate: touched ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER });
          announce();
          return { ok: true as const };
        },
        setTheme(next: BoardTheme): void {
          live();
          theme = next === 'night' ? 'night' : 'day';
          applySkin(theme);
          recolourAll();
          api.refresh();
          announce();
        },
        zoomIn: () => run('zoomIn'),
        zoomOut: () => run('zoomOut'),
        zoomReset: () => run('resetZoom'),
        zoomToFit: () => run('zoomToFit'),
        undo: () => run('undo'),
        redo: () => run('redo'),
        state: () => (live(), snapshot()),
        onState(listener) {
          stateListeners.add(listener);
          return () => void stateListeners.delete(listener);
        },
        exportPng: async () => {
          const ground = getComputedStyle(host).getPropertyValue('--ground').trim() || gnomonBoardSkin.sheet;
          return exportToBlob({ elements: live(), appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: ground }, files: api.getFiles(), mimeType: 'image/png' });
        },
        onError: (listener) => void listeners.push(listener),
        isAlive: () => dead === null,
        unmount: () => {
          dead ??= 'unmounted';
          unsubscribe();
          stateListeners.clear();
          root.unmount();
        },
      };
    };
    // The engine hands out its API while it is still constructing; its scene is initialised later (an async step
    // that REPLACES the scene's elements and then clears `isLoading`). Resolving before that would let a mark
    // added in the same tick be wiped a few milliseconds on, so the mount waits for the flag. It then waits for
    // the board's one text face (the engine has registered it with the page by now), so the first text measures
    // with JetBrains Mono and never with a fallback.
    const ready = (api: Api): void => {
      const check = (): void => {
        if (settled) return;
        if (api.getAppState().isLoading) return void (poll = setTimeout(check, READY_POLL_MS));
        void document.fonts.load(`400 ${BOARD_FONT_SIZE}px "${BOARD_FONT_FAMILY}"`).then(
          (faces) => {
            if (settled) return;
            if (faces.length === 0) return fail(new Error('the board text face did not load'));
            settled = true;
            clearTimeout(timer);
            resolve(handleOf(api));
          },
          (e: unknown) => fail(asError(e)),
        );
      };
      check();
    };
    root.render(
      createElement(Excalidraw, {
        excalidrawAPI: ready as (api: StockApi) => void,
        langCode: 'en',
        theme: 'light',
        autoFocus: false,
        handleKeyboardGlobally: false,
        validateEmbeddable: false,
        aiEnabled: false,
        viewModeEnabled: false,
        zenModeEnabled: false,
        gridModeEnabled: false,
        objectsSnapModeEnabled: true,
        initialData: { appState: { viewBackgroundColor: 'transparent', objectsSnapModeEnabled: true, ...current() } as never },
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } },
      }),
    );
  });
}
