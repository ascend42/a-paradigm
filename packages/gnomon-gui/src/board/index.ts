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
import { CONTENT_DEFAULTS, contentColourCheck } from '@a-company/gnomon-contracts';
import { BOARD_TOOLS, BOARD_WEIGHTS } from '../core/board.js';
import type { BoardAttempt, BoardAuthor, BoardHandle, BoardMark, BoardMarkView, BoardMountOptions, BoardRefusal, BoardState, BoardStyle, BoardStyleRefusal, BoardTheme, BoardTool, BoardView } from '../core/board.js';
import { BOARD_FONT_ID, BOARD_FONT_SIZE, BOARD_TYPES, FILLABLE, fillColour, lineColour, normalOf, offNormal, strokeStyleOf } from './normal.js';
import { applySkin, gnomonBoardSkin, onBoardRefusal } from './skin.js';

declare const __GNOMON_BOARD_ENGINE__: string;

/** `<name>@<version>` of the engine, stamped by the build from the installed package. */
export const BOARD_ENGINE: string = __GNOMON_BOARD_ENGINE__;

/** The one text face (patches font-family-table, font-registry-empty): its engine family id, name and size. */
export { BOARD_FONT_ID, BOARD_FONT_SIZE };
export const BOARD_FONT_FAMILY = 'JetBrains Mono';

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
  readonly strokeStyle?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly points?: ReadonlyArray<readonly [number, number]>;
  readonly containerId?: string | null;
  readonly strokeWidth?: number;
  readonly customData?: Record<string, unknown>;
}
/** `newElementWith` over the structural type: a changed copy of the same element. */
const changed = <T extends Element>(el: T, updates: Record<string, unknown>): T => newElementWith(el as never, updates as never) as T;
type EngineTool = 'selection' | 'rectangle' | 'ellipse' | 'arrow' | 'frame' | 'freedraw' | 'text' | 'hand';

/** What a mark remembers about its colours: tokens, never hex. `kind` marks a sticky (drawn as a rectangle). */
interface Stamp {
  line: string;
  fill: string | null;
  kind?: 'sticky' | 'stub';
  /** the host's word on who drew it; absent means you */
  by?: BoardAuthor;
  stubKind?: string;
}
const HUMAN: BoardAuthor = { cls: 'human' };
/** Only a well-formed author survives a round trip through an element's customData; anything else is the unknown hand. */
const authorOf = (v: unknown): BoardAuthor | undefined => {
  if (v === undefined) return undefined;
  const a = v as { cls?: unknown; id?: unknown; name?: unknown } | null;
  if (a && a.cls === 'human') return HUMAN;
  if (a && a.cls === 'agent' && typeof a.id === 'string' && a.id.length > 0 && typeof a.name === 'string') return { cls: 'agent', id: a.id, name: a.name };
  return { cls: 'unknown' };
};
const VIEW_KIND: Readonly<Record<string, BoardMarkView['kind']>> = { rectangle: 'rect', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', freedraw: 'stroke', text: 'text' };
/** A stub is never smaller than this (design component fallback-node). */
const STUB_MIN = { width: 156, height: 52 };
/** A stub that names no size is this wide: its fixed line is 40 characters and needs 284px on one line (Mika, S1.1 review ruling 6). */
const STUB_DEFAULT_WIDTH = 288;

const ENGINE_TOOL: Readonly<Record<BoardTool, EngineTool>> = { select: 'selection', sticky: 'rectangle', text: 'text', rect: 'rectangle', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', stroke: 'freedraw', hand: 'hand' };
const RAIL_TOOL: Readonly<Record<EngineTool, BoardTool>> = { selection: 'select', rectangle: 'rect', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', freedraw: 'stroke', text: 'text', hand: 'hand' };
/** The engine actions the handle may run through `gnomonAction`. */
const HANDLE_ACTIONS = ['zoomIn', 'zoomOut', 'resetZoom', 'zoomToFit', 'undo', 'redo'] as const;
/** The tokens an element carries. NOTHING else is read from an element: not an author, not a kind (review S1). */
const tokensOf = (el: Element): { line: string; fill: string | null } | null => {
  const g = (el.customData as { gnomon?: { line?: unknown; fill?: unknown } } | undefined)?.gnomon;
  return g && typeof g.line === 'string' ? { line: g.line, fill: typeof g.fill === 'string' ? g.fill : null } : null;
};
/** True when an element's customData carries anything but the two tokens (a forged author, kind or stub kind). */
const carriesMore = (el: Element): boolean => {
  const g = (el.customData as { gnomon?: Record<string, unknown> } | undefined)?.gnomon;
  return !!g && Object.keys(g).some((k) => k !== 'line' && k !== 'fill');
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
      // Who drew a mark, whether it is a sticky or a stub, and a stub's kind: the handle's OWN record, keyed by
      // element id and written only by add() (and, for a sticky you draw, by the tool you drew it with). An element
      // that is not in it is a plain mark of yours, whatever it says about itself: a paste, a drop or a copy makes
      // new ids, so none of them can carry an author, a dashed stroke, a seal or a stub (review S1).
      const trusted = new Map<string, { kind?: 'sticky' | 'stub'; by?: BoardAuthor; stubKind?: string }>();
      const stampOf = (el: Element): Stamp | null => {
        const t = tokensOf(el);
        const rec = trusted.get(el.id);
        return t ? { ...t, ...(rec?.kind ? { kind: rec.kind } : {}), ...(rec?.by ? { by: rec.by } : {}), ...(rec?.stubKind !== undefined ? { stubKind: rec.stubKind } : {}) } : null;
      };
      const stateListeners = new Set<(state: BoardState) => void>();
      let lastState = '';
      let recolouring = false;
      const live = (): ReturnType<Api['getSceneElements']> => {
        if (dead !== null) throw new Error(`the board engine has stopped: ${dead}`);
        return api.getSceneElements();
      };
      const snapshot = (): BoardState => {
        const s = api.getAppState();
        const els = api.getSceneElements() as unknown as Element[];
        const ids = new Set(els.map((el) => el.id));
        return { tool, zoom: s.zoom.value, style: { ...style }, theme, marks: els.filter((el) => !el.containerId).length, selected: Object.keys(s.selectedElementIds).filter((id) => ids.has(id)).length, editingText: s.editingTextElement != null || s.editingFrame != null };
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
      // every mark is held to its normal form (src/board/normal.ts): token colours, a derived stroke, one look
      const painted = (el: Element): Record<string, unknown> => normalOf(el, stampOf(el), theme);
      const mismatched = (el: Element): boolean => offNormal(el, stampOf(el), theme);
      const refusedListeners = new Set<(r: BoardRefusal) => void>();
      const refuse = (r: BoardRefusal): void => {
        if (dead === null) for (const l of [...refusedListeners]) l(r);
      };
      const sceneListeners = new Set<() => void>();
      const sceneChanged = (): void => {
        if (dead === null) for (const l of [...sceneListeners]) l();
      };
      const surface = (): HTMLElement | null => host.querySelector<HTMLElement>('.excalidraw-container');
      const viewOf = (el: Element, selected: Record<string, unknown>): BoardMarkView => {
        const g = stampOf(el);
        const xs = el.points?.length ? el.points.map((p) => p[0]) : [0, el.width];
        const ys = el.points?.length ? el.points.map((p) => p[1]) : [0, el.height];
        const left = el.x + Math.min(...xs);
        const top = el.y + Math.min(...ys);
        return {
          id: el.id,
          kind: g?.kind ?? VIEW_KIND[el.type] ?? 'other',
          x: left,
          y: top,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          firstX: el.x,
          firstY: el.y,
          author: g?.by ?? HUMAN,
          line: g?.line ?? CONTENT_DEFAULTS.line,
          fill: g?.fill ?? null,
          selected: selected[el.id] === true,
          ...(g?.stubKind !== undefined ? { stubKind: g.stubKind } : {}),
          ...(el.containerId ? { labelOf: el.containerId } : {}),
        };
      };
      /** Repaint every mark from its tokens (a theme change, or an undo that brought back another theme's colours). */
      const recolourAll = (): void => {
        if (dead !== null) return;
        recolouring = true;
        try {
          const all = api.getSceneElementsIncludingDeleted();
          const dropped: string[] = [];
          const next = all.map((el) => {
            if (!mismatched(el)) return el;
            if (BOARD_TYPES.has(el.type)) return changed(el, painted(el));
            dropped.push(el.type); // an image, an embed, an iframe, a diamond, a line: not a board kind
            return changed(el, { isDeleted: true });
          });
          api.updateScene({ elements: next, appState: current() as never, captureUpdate: CaptureUpdateAction.NEVER });
          for (const type of dropped) refuse({ what: type === 'image' ? 'image' : 'mark', why: type === 'image' ? 'no-image-kind' : 'not-a-board-kind', detail: type });
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
          if (!tokensOf(el as unknown as Element) || carriesMore(el as unknown as Element)) {
            // tokens only: whatever else a pasted element says about itself (an author, a kind) is dropped here.
            // A label inside a sticky or a shape is always the default ink, whatever line is current.
            const had = tokensOf(el as unknown as Element);
            const tokens = had ?? { line: (el as unknown as Element).containerId ? CONTENT_DEFAULTS.line : style.line, fill: FILLABLE.has(el.type) ? fillToken() : null };
            if (!had && tool === 'sticky' && el.type === 'rectangle' && el.id === appState.newElement?.id) trusted.set(el.id, { kind: 'sticky' });
            mutateElement(el as never, { customData: { ...el.customData, gnomon: tokens } } as never, false);
          }
          if (mismatched(el) && el.id !== appState.newElement?.id) repaint = true;
        }
        if (repaint) queueMicrotask(recolourAll);
        announce();
        sceneChanged();
      });
      const unsubscribeScroll = api.onScrollChange(sceneChanged);
      // paste and drop are REPORTED from the capture phase and left alone: what the board does with them is S1.3's
      // to decide (condition C8), and this hook is how the leaf will see them first
      const attemptListeners = new Set<(a: BoardAttempt) => void>();
      const attempt = (kind: BoardAttempt['kind']) => (e: Event): void => {
        const dt = kind === 'paste' ? (e as ClipboardEvent).clipboardData : (e as DragEvent).dataTransfer;
        for (const l of [...attemptListeners]) l({ kind, types: [...(dt?.types ?? [])], files: dt?.files.length ?? 0 });
      };
      const onPaste = attempt('paste');
      const onDrop = attempt('drop');
      const unsubscribeRefusal = onBoardRefusal((what, detail) => refuse(what === 'image' ? { what, why: 'no-image-kind' } : { what, why: 'not-a-board-kind', ...(detail ? { detail } : {}) }));
      // A drop that carries files never reaches the engine: a dropped scene file replaced the whole board with the
      // stock look and raised an img-src refusal, and a library file filled a Library nobody can open (Mika, S1.1
      // pass A finding 1). The pointer says so while it hovers.
      const LIBRARY_MIME = 'application/vnd.excalidrawlib+json';
      const onDragOver = (e: DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      };
      // EVERY drop is refused, with or without files (review S2): a drag that carries the library type and no file
      // was read by the engine and inserted as elements
      const onFileDrop = (e: DragEvent): void => {
        onDrop(e);
        e.preventDefault();
        e.stopPropagation();
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length === 0) return void refuse({ what: [...(e.dataTransfer?.types ?? [])].includes(LIBRARY_MIME) ? 'library-file' : 'file', why: 'no-file-drop' });
        for (const f of files) {
          const name = f.name.toLowerCase();
          const what: BoardRefusal['what'] = f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name) ? 'image' : name.endsWith('.excalidrawlib') ? 'library-file' : name.endsWith('.excalidraw') || name.endsWith('.json') ? 'scene-file' : 'file';
          refuse({ what, why: what === 'image' ? 'no-image-kind' : 'no-file-drop' });
        }
      };
      // tab-separated text would open the engine's chart dialog, which is not built: nothing happens, so say so
      const onTablePaste = (e: ClipboardEvent): void => {
        onPaste(e);
        const rows = (e.clipboardData?.getData('text/plain') ?? '').trim().split(/\r?\n/);
        if (rows.length >= 2 && rows.every((r) => r.includes('\t'))) refuse({ what: 'table', why: 'no-table-kind' });
      };
      host.addEventListener('dragover', onDragOver, true);
      host.addEventListener('paste', onTablePaste, true);
      host.addEventListener('drop', onFileDrop, true);
      const run = (name: (typeof HANDLE_ACTIONS)[number]): void => {
        live();
        api.gnomonAction(name);
        announce();
      };
      const skeletonOf = (m: BoardMark): Record<string, unknown> => {
        const sticky = m.type === 'sticky';
        const by = authorOf(m.by);
        const id = crypto.randomUUID();
        const record = (kind?: 'sticky' | 'stub', stubKind?: string): void => void trusted.set(id, { ...(kind ? { kind } : {}), ...(by && by.cls !== 'human' ? { by } : {}), ...(stubKind !== undefined ? { stubKind } : {}) });
        if (m.type === 'stub') {
          // a node this build cannot draw: the scrap (paper, a 1px secondary edge) is an engine rectangle so it can be
          // selected, moved and deleted; its words and pin are the host's
          record('stub', String(m.kind ?? ''));
          const stamp = { line: 'graphite', fill: 'paper' };
          return { id, type: 'rectangle', x: m.x, y: m.y, width: Math.max(STUB_MIN.width, m.width ?? STUB_DEFAULT_WIDTH), height: Math.max(STUB_MIN.height, m.height ?? 0), strokeColor: lineColour(stamp.line, theme), backgroundColor: fillColour(stamp.fill, theme), strokeWidth: 1, strokeStyle: strokeStyleOf(by), fillStyle: 'solid', roughness: 0, roundness: null, customData: { gnomon: stamp } };
        }
        record(sticky ? 'sticky' : undefined);
        const stamp = { line: m.line ?? CONTENT_DEFAULTS.line, fill: sticky ? (m.fill ?? CONTENT_DEFAULTS.stickyFill) : m.type === 'rectangle' || m.type === 'ellipse' ? (m.fill ?? null) : null };
        const text = { fontSize: BOARD_FONT_SIZE, fontFamily: BOARD_FONT_ID };
        const base = { id, x: m.x, y: m.y, strokeColor: lineColour(stamp.line, theme), backgroundColor: fillColour(stamp.fill, theme), strokeWidth: BOARD_WEIGHTS[m.weight === 'marker' ? 'bold' : (m.weight ?? 'fine')], strokeStyle: strokeStyleOf(by), fillStyle: 'solid', roughness: 0, roundness: null, customData: { gnomon: stamp } };
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
          // regenerateIds: false. The engine replaces every skeleton id by default; the authorship record is keyed by
          // the id skeletonOf made, so with new ids every added mark was a plain mark of yours (review round 2, R1)
          const added = convertToExcalidrawElements(marks.map(skeletonOf) as Skeleton, { regenerateIds: false });
          // never an undo step: the first undo after it used to take every added mark with it (Mika, pass A finding 2)
          api.updateScene({ elements: [...before, ...added], captureUpdate: CaptureUpdateAction.NEVER });
          announce();
          return live().length;
        },
        count: () => live().length,
        setTool(next: BoardTool): void {
          live();
          if (!BOARD_TOOLS.includes(next)) throw new Error(`the board has no ${String(next)} tool`);
          tool = next;
          // choosing a drawing tool lets go of the selection, so the first click draws (it used to only deselect)
          api.updateScene({ appState: { ...current(), ...(next === 'select' || next === 'hand' ? {} : { selectedElementIds: {}, selectedGroupIds: {} }) } as never, captureUpdate: CaptureUpdateAction.NEVER });
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
            const old: Stamp = stampOf(el as unknown as Element) ?? { line: CONTENT_DEFAULTS.line, fill: null };
            if (old.kind === 'stub') return el; // a stub is moved and deleted, never restyled
            const label = !!(el as unknown as Element).containerId;
            if (label && next.fill === undefined && next.weight === undefined) return el; // a label stays the default ink
            const stamp: Stamp = { ...old, ...(next.line !== undefined && !label ? { line: next.line } : {}), ...(next.fill !== undefined && FILLABLE.has(el.type) ? { fill: next.fill ?? (old.kind === 'sticky' ? CONTENT_DEFAULTS.stickyFill : null) } : {}) };
            touched = true;
            return changed(el, {
              strokeColor: lineColour(stamp.line, theme),
              backgroundColor: fillColour(FILLABLE.has(el.type) ? stamp.fill : null, theme),
              ...(next.weight !== undefined && el.type !== 'text' && el.type !== 'frame' ? { strokeWidth: BOARD_WEIGHTS[next.weight === 'marker' && el.type !== 'freedraw' ? 'bold' : next.weight] } : {}),
              customData: { ...el.customData, gnomon: { line: stamp.line, fill: stamp.fill } },
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
        marks(): BoardMarkView[] {
          const selected = api.getAppState().selectedElementIds as Record<string, unknown>;
          return (live() as unknown as Element[]).map((el) => viewOf(el, selected));
        },
        view(): BoardView {
          live();
          const s = api.getAppState();
          return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value, width: s.width, height: s.height };
        },
        onScene(listener) {
          sceneListeners.add(listener);
          return () => void sceneListeners.delete(listener);
        },
        focus: () => void (live(), surface()?.focus({ preventScroll: true })),
        hasFocus: () => dead === null && host.contains(document.activeElement),
        onAttempt(listener) {
          attemptListeners.add(listener);
          return () => void attemptListeners.delete(listener);
        },
        onRefusal(listener) {
          refusedListeners.add(listener);
          return () => void refusedListeners.delete(listener);
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
          unsubscribeScroll();
          unsubscribeRefusal();
          host.removeEventListener('paste', onTablePaste, true);
          host.removeEventListener('drop', onFileDrop, true);
          host.removeEventListener('dragover', onDragOver, true);
          stateListeners.clear();
          sceneListeners.clear();
          attemptListeners.clear();
          refusedListeners.clear();
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
        // The face is loaded through its own FontFace objects (the engine's registration, and the page's @font-face
        // when it has one): every one of them, so the first text never measures with a fallback.
        const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === BOARD_FONT_FAMILY && (f.weight === '400' || f.weight === 'normal') && f.style === 'normal');
        if (faces.length === 0) return fail(new Error('the board text face is not registered'));
        void Promise.all(faces.map((f) => f.load())).then(
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(handleOf(api));
          },
          () => fail(new Error('the board text face did not load')),
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
