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
import { CaptureUpdateAction, Excalidraw, exportToBlob, mutateElement, newElementWith, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './skin.css';
import { CONTENT_DEFAULTS, contentColourCheck, DIM_LIMITS, emptyDimState, foldDim } from '@a-company/gnomon-contracts';
import type { DimFoldNode, DimOp, DimState } from '@a-company/gnomon-contracts';
import { BOARD_TOOLS, BOARD_WEIGHTS } from '../core/board.js';
import type { BoardAttempt, BoardAuthor, BoardHandle, BoardMarkView, BoardMountOptions, BoardRefusal, BoardState, BoardStyle, BoardStyleRefusal, BoardTheme, BoardTool, BoardView } from '../core/board.js';
import { dimIsFallback, dimIsSticky, dimLabelId, dimToElements, elementsToOps, type DimMapIds, type EngineElement } from './dim-map.js';
import { BOARD_FONT_ID, BOARD_FONT_SIZE, BOARD_TYPES, FILLABLE, fillColour, lineColour, normalOf, offNormal } from './normal.js';
import { fitStroke } from './simplify.js';
import { applySkin, gnomonBoardRuns, gnomonBoardSkin, onBoardRefusal, setBoardYielded } from './skin.js';

declare const __GNOMON_BOARD_ENGINE__: string;
/**
 * Build-time only (scripts/board-build.mjs): false in the chunk that ships, so the branch that lets untrusted events
 * count as input is REMOVED from the pinned bytes (test/board-patches.test.ts reads them). True only in the probe
 * build the P12 harness makes for WKWebView, which is never embedded and never served by the kernel.
 */
declare const __GNOMON_BOARD_PROBE__: boolean;

/** `<name>@<version>` of the engine, stamped by the build from the installed package. */
export const BOARD_ENGINE: string = __GNOMON_BOARD_ENGINE__;

/** The one text face (patches font-family-table, font-registry-empty): its engine family id, name and size. */
export { BOARD_FONT_ID, BOARD_FONT_SIZE };
/**
 * The fold, for a page that has only this chunk (the P12 probe harness builds its fixture states with it). The app
 * folds with its own copy; a state is plain data, so either copy's states render.
 */
export { emptyDimState, foldDim };
/**
 * How often the ENGINE's own paste, copy and cut handlers were entered on this page (patches `engine-paste-removed`,
 * `engine-copy-removed`, `engine-cut-removed` count and return). A board stops those events before the engine, so
 * every number stays 0: test/board-c8.test.ts and the P12 probe read it. Diagnostic; nothing is decided from it.
 */
export const boardEngineRuns = (): { paste: number; copy: number; cut: number } => ({ ...gnomonBoardRuns });
export const BOARD_FONT_FAMILY = 'JetBrains Mono';

type StockApi = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]['excalidrawAPI']>>[0];
/** The imperative API plus the one method patch `api-run-action` adds. */
type Api = StockApi & { gnomonAction(name: string, value?: unknown): void };
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
/** What the handle reads of an element to tell whether it changed: the engine raises `version` on every mutation. */
interface Versioned extends Element {
  readonly version: number;
  readonly index?: string | null;
  readonly seed?: number;
  readonly text?: string;
  readonly originalText?: string;
}
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 26 random characters (130 bits) from `crypto.getRandomValues`, which needs no secure context (`randomUUID` does). */
function randomId(): string {
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(26))) out += B32[b % 32];
  return out;
}
/** A new node id (a ULID: `DIM_NODE_ID_PATTERN`). Minted here, in the handle, for a mark a person drew. */
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
/** `newElementWith` over the structural type: a changed copy of the same element. */
const changed = <T extends Element>(el: T, updates: Record<string, unknown>): T => newElementWith(el as never, updates as never) as T;
type EngineTool = 'selection' | 'rectangle' | 'ellipse' | 'arrow' | 'frame' | 'freedraw' | 'text' | 'hand';

/** What a mark remembers about its colours: tokens, never hex. `kind` marks a sticky (drawn as a rectangle). */
interface Stamp {
  line: string;
  fill: string | null;
  kind?: 'sticky' | 'stub';
  /** who the rendered dimension says drew it; absent means you */
  by?: BoardAuthor;
  stubKind?: string;
}
const HUMAN: BoardAuthor = { cls: 'human' };
const VIEW_KIND: Readonly<Record<string, BoardMarkView['kind']>> = { rectangle: 'rect', ellipse: 'ellipse', diamond: 'diamond', arrow: 'arrow', frame: 'frame', freedraw: 'stroke', text: 'text' };
const ENGINE_TOOL: Readonly<Record<BoardTool, EngineTool>> = { select: 'selection', sticky: 'rectangle', text: 'text', rect: 'rectangle', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', stroke: 'freedraw', hand: 'hand' };
const RAIL_TOOL: Readonly<Record<EngineTool, BoardTool>> = { selection: 'select', rectangle: 'rect', ellipse: 'ellipse', arrow: 'arrow', frame: 'frame', freedraw: 'stroke', text: 'text', hand: 'hand' };
/** The engine actions the handle may run through `gnomonAction`. */
const HANDLE_ACTIONS = ['zoomIn', 'zoomOut', 'resetZoom', 'zoomToFit'] as const;
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
/** The engine MIME of a library drag. */
const LIBRARY_MIME = 'application/vnd.excalidrawlib+json';
/** True for a field that takes pasted text natively AS PLAIN TEXT (a textarea, a text input): never a contenteditable. */
const takesPlainText = (t: EventTarget | null): boolean => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'search'));
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
      // ── the rendered dimension ────────────────────────────────────────────
      // `prev` is EXACTLY the state the scene was last rendered from: the diff's other side, and the only place
      // an author, a sticky or a stub is read from (an element says nothing about itself but its two tokens).
      let prev: DimState = emptyDimState();
      // engine id ↔ node id, minted here and nowhere else (Aegis): an engine id is never a node id
      const engineByNode = new Map<string, string>();
      const nodeByEngine = new Map<string, string>();
      const tie = (engineId: string, nodeId: string): void => void (engineByNode.set(nodeId, engineId), nodeByEngine.set(engineId, nodeId));
      const ids: DimMapIds = {
        nodeOf(engineId) {
          let nodeId = nodeByEngine.get(engineId);
          if (nodeId === undefined) tie(engineId, (nodeId = mintNodeId()));
          return nodeId;
        },
        engineOf(nodeId) {
          let engineId = engineByNode.get(nodeId);
          if (engineId === undefined) tie((engineId = `g-${randomId()}`), nodeId);
          return engineId;
        },
      };
      /** The stored node an element stands for, in a state (never mints an id; a label and a new mark have none). */
      const foldNodeOf = (engineId: string, state: DimState = prev): DimFoldNode | undefined => {
        const nodeId = nodeByEngine.get(engineId);
        return nodeId === undefined ? undefined : state.nodes.get(nodeId);
      };
      const authorIn = (n: DimFoldNode | undefined): BoardAuthor | undefined => {
        if (!n) return undefined; // not in the rendered state: drawn since, so yours
        const by = n.by as { cls?: unknown; agent?: unknown } | undefined;
        if (by?.cls === 'human') return HUMAN;
        if (by?.cls === 'agent' && typeof by.agent === 'string' && by.agent.length > 0) return { cls: 'agent', id: by.agent, name: by.agent };
        return { cls: 'unknown' };
      };
      const stampOf = (el: Element, state: DimState = prev): Stamp | null => {
        const t = tokensOf(el);
        if (!t) return null;
        const n = foldNodeOf(el.id, state);
        const by = authorIn(n);
        const kind = !n ? (stickyDrawn.has(el.id) ? 'sticky' : undefined) : dimIsFallback(n.node) ? 'stub' : dimIsSticky(n.node) ? 'sticky' : undefined;
        return { ...t, ...(kind ? { kind } : {}), ...(by && by.cls !== 'human' ? { by } : {}), ...(kind === 'stub' ? { stubKind: String(n!.node.kind ?? '') } : {}) };
      };
      /** Rects drawn with the Sticky tool since the last edit was reported (the tool has gone back to Select by then). */
      const stickyDrawn = new Set<string>();

      // ── what counts as an edit ────────────────────────────────────────────
      // The engine's own signal for "this element changed" is the element's `version`, which it raises on every
      // mutation and on nothing else: a selection, a pan, a zoom and a hover leave every version alone. `base` is
      // each element's version when the handle last rendered or reported; `rendered` is the version and the mapped
      // content an element had when render() last built it.
      const base = new Map<string, number>();
      const rendered = new Map<string, { sig: string; version: number }>();
      /** Mains really in the scene after a render: a node the engine could not hold is never reported as deleted. */
      const shown = new Set<string>();
      const all = (): readonly Versioned[] => api.getSceneElementsIncludingDeleted() as unknown as readonly Versioned[];
      const isDirty = (el: Versioned): boolean => base.get(el.id) !== el.version;
      const dirty = (): boolean => all().some(isDirty);
      const rebase = (): void => {
        base.clear();
        for (const el of all()) base.set(el.id, el.version);
      };
      /** Run a change the HANDLE makes: whatever it touches that was unchanged before stays unchanged. */
      const own = (fn: () => void): void => {
        const before = new Map<string, number>();
        const wasDirty = new Set<string>();
        for (const el of all()) {
          before.set(el.id, el.version);
          if (isDirty(el)) wasDirty.add(el.id);
        }
        try {
          fn();
        } finally {
          const now = new Set<string>();
          for (const el of all()) {
            now.add(el.id);
            if (!wasDirty.has(el.id)) base.set(el.id, el.version);
            const r = rendered.get(el.id);
            if (r && before.has(el.id) && r.version === before.get(el.id)) r.version = el.version;
          }
          for (const id of [...base.keys()]) if (!now.has(id)) base.delete(id);
        }
      };
      let pointerDown = false;
      /** A person has acted on the board since the last render or report: an engine change with no input is never an edit. */
      let touched = false;
      let cause: Event | null = null;
      let yielded = false;
      /** Put-backs in a row with no input between them: the second one stops (an engine that keeps normalising cannot loop). */
      let putBacks = 0;
      /**
       * What the person had in hand since the last render or report: the selection, a mark being drawn, a text being
       * typed. Only these (with their labels, the arrows tied to them and a frame's children) may be in an edit.
       */
      const handled = new Set<string>();
      const note = (s: { selectedElementIds: Record<string, unknown>; newElement?: unknown; editingTextElement?: unknown; multiElement?: unknown }): void => {
        for (const id of Object.keys(s.selectedElementIds)) handled.add(id);
        for (const el of [s.newElement, s.editingTextElement, s.multiElement] as Array<{ id?: string; containerId?: string | null } | null | undefined>) {
          if (el?.id) handled.add(el.id);
          if (el?.containerId) handled.add(el.containerId);
        }
      };
      /** The person is no longer acting: nothing stays armed for a later engine change. */
      const disarm = (): void => {
        touched = false;
        cause = null;
        handled.clear();
      };
      /**
       * What the ENGINE changed on marks nobody had in hand, per node, as the diff against the rendered state says it:
       * left standing until the next render, and taken OUT of a later real edit of that mark (the person's edit must
       * not carry the engine's delta).
       */
      const standing = new Map<string, { patch: Map<string, string>; dx: number; dy: number }>();
      const stand = (ops: readonly DimOp[]): void => {
        const at = (id: string): { patch: Map<string, string>; dx: number; dy: number } => standing.get(id) ?? (standing.set(id, { patch: new Map(), dx: 0, dy: 0 }), standing.get(id)!);
        for (const op of ops) {
          if (op.type === 'update') for (const [k, v] of Object.entries(op.patch as Record<string, unknown>)) at(op.id).patch.set(k, JSON.stringify(v));
          else if (op.type === 'move') for (const id of op.ids) Object.assign(at(id), { dx: op.dx, dy: op.dy });
        }
      };
      /** An op of the person's, less what the engine had already changed on that mark by itself. */
      const lessStanding = (op: DimOp): DimOp[] => {
        if (standing.size === 0) return [op];
        if (op.type === 'update') {
          const st = standing.get(op.id);
          if (!st) return [op];
          // (a change of place and of something else is ONE update carrying x and y: the engine's own shift is taken out of it)
          const at = prev.nodes.get(op.id)?.node as { x?: unknown; y?: unknown } | undefined;
          const shifted = (k: string, v: unknown): boolean => (k === 'x' || k === 'y') && (st.dx !== 0 || st.dy !== 0) && typeof at?.[k] === 'number' && v === (at[k] as number) + (k === 'x' ? st.dx : st.dy);
          const patch = Object.fromEntries(Object.entries(op.patch as Record<string, unknown>).filter(([k, v]) => st.patch.get(k) !== JSON.stringify(v) && !shifted(k, v)));
          return Object.keys(patch).length > 0 ? [{ ...op, patch } as DimOp] : [];
        }
        if (op.type !== 'move') return [op];
        const plain = op.ids.filter((id) => !standing.get(id)?.dx && !standing.get(id)?.dy);
        const out: DimOp[] = plain.length > 0 ? [{ ...op, ids: plain }] : [];
        for (const id of op.ids) {
          const st = standing.get(id);
          if (!st || (!st.dx && !st.dy) || (op.dx === st.dx && op.dy === st.dy)) continue;
          out.push({ ...op, ids: [id], dx: op.dx - st.dx, dy: op.dy - st.dy });
        }
        return out;
      };
      /** The last keydown a person made, for a cut made with the keyboard (a `cut` event itself carries no gesture stamp). */
      let lastKey: KeyboardEvent | null = null;
      /** The dimension this handle shows: one handle per dimension (the caller unmounts and mounts for another). */
      let shows: string | null = null;
      /** The stored node each main element was last BUILT from: what the person saw when they took a mark in hand. */
      const seen = new Map<string, Record<string, unknown>>();
      /** The text being typed, as it was when it was opened: a text opened and left as it was is not an edit. */
      let typing: { id: string; containerId: string | null; text: string } | null = null;
      /** Elements the engine changed around a text that was opened and not changed (its box refitted): not the person's. */
      const untouched = new Set<string>();
      /** Only an event the browser itself made is a person's input (`isTrusted`). A probe build alone also honours the mount option: see the define. */
      const counts = (e: Event): boolean => e.isTrusted || (__GNOMON_BOARD_PROBE__ && options.syntheticInput === true);
      const busy = (): boolean => {
        const s = api.getAppState();
        return pointerDown || s.newElement != null || s.editingTextElement != null || s.editingFrame != null || s.multiElement != null || s.selectedElementsAreBeingDragged === true || s.isResizing === true || s.isRotating === true;
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
        const present = new Set(els.map((el) => el.id));
        return { tool, zoom: s.zoom.value, style: { ...style }, theme, marks: els.filter((el) => !el.containerId).length, selected: Object.keys(s.selectedElementIds).filter((id) => present.has(id)).length, editingText: s.editingTextElement != null || s.editingFrame != null };
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
        // a loop, not a spread: a long stroke must not overflow the call stack
        let minX = 0;
        let maxX = el.points?.length ? 0 : el.width;
        let minY = 0;
        let maxY = el.points?.length ? 0 : el.height;
        for (const p of el.points ?? []) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        const nodeId = nodeByEngine.get(el.id);
        return {
          id: el.id,
          node: nodeId !== undefined && prev.nodes.has(nodeId) ? nodeId : null,
          kind: g?.kind ?? VIEW_KIND[el.type] ?? 'other',
          x: el.x + minX,
          y: el.y + minY,
          width: maxX - minX,
          height: maxY - minY,
          firstX: el.x,
          firstY: el.y,
          ...(el.points && el.points.length > 1 ? { secondX: el.x + el.points[1]![0], secondY: el.y + el.points[1]![1] } : {}),
          author: g?.by ?? HUMAN,
          line: g?.line ?? CONTENT_DEFAULTS.line,
          fill: g?.fill ?? null,
          selected: selected[el.id] === true,
          ...(g?.stubKind !== undefined ? { stubKind: g.stubKind } : {}),
          ...(el.containerId ? { labelOf: el.containerId } : {}),
        };
      };
      /** Repaint every mark from its tokens (a theme change, or a paste that brought another look). */
      const recolourAll = (): void => {
        if (dead !== null) return;
        recolouring = true;
        try {
          own(() => {
            const dropped: string[] = [];
            const next = api.getSceneElementsIncludingDeleted().map((el) => {
              if (!mismatched(el as unknown as Element)) return el;
              if (BOARD_TYPES.has(el.type)) return changed(el, painted(el as unknown as Element));
              dropped.push(el.type); // an image, an embed, an iframe, a line: not a board kind
              return changed(el, { isDeleted: true });
            });
            api.updateScene({ elements: next, appState: current() as never, captureUpdate: CaptureUpdateAction.NEVER });
            for (const type of dropped) refuse({ what: type === 'image' ? 'image' : 'mark', why: type === 'image' ? 'no-image-kind' : 'not-a-board-kind', detail: type });
          });
        } finally {
          recolouring = false;
        }
      };

      // ── render: the state is the truth, the scene is diffed against it ────
      /** One element of the map's output, completed to the board's normal form BEFORE the engine sees it. */
      const complete = (el: EngineElement, state: DimState): Record<string, unknown> => {
        const label = el.type === 'text' && typeof el.containerId === 'string';
        const n = label ? undefined : foldNodeOf(el.id, state);
        const stub = !!n && dimIsFallback(n.node);
        const by = authorIn(n);
        const stamp: Stamp = { line: el.customData?.gnomon.line ?? CONTENT_DEFAULTS.line, fill: el.customData?.gnomon.fill ?? null, ...(stub ? { kind: 'stub' as const } : {}), ...(by && by.cls !== 'human' ? { by } : {}) };
        const out: Record<string, unknown> = { ...el, ...normalOf(el, label ? { line: stamp.line, fill: null } : stamp, theme), groupIds: [] };
        if (el.type === 'text') Object.assign(out, { originalText: el.text ?? '', textAlign: label ? 'center' : 'left', verticalAlign: label ? 'middle' : 'top', autoResize: label || !(el.width > 0), ...(el.width > 0 ? {} : { width: 1 }) });
        // (a text with no size is dropped by the engine before it measures it, so it is 1 wide until it has; it
        // carries NO height, or the engine would work a line height out of it)
        if (el.type === 'freedraw') {
          // a stored stroke of ONE point is a dot: the engine holds no stroke of fewer than two points
          const points = el.points && el.points.length === 1 ? [el.points[0]!, el.points[0]!] : (el.points ?? []);
          // `lastCommittedPoint` is what makes the engine draw a stroke to its END: without it every stroke
          // re-rendered from the fold stopped some 7px short (Mika, review batch B1)
          Object.assign(out, { points, pressures: [], simulatePressure: true, lastCommittedPoint: points.length > 0 ? points[points.length - 1] : null });
        }
        if (el.type === 'arrow') Object.assign(out, { elbowed: false });
        // a fallback's words are the host's (one owner: the overlay cuts them to the scrap; a label here would say the kind twice)
        if (stub) out.boundElements = (el.boundElements ?? []).filter((b) => b.type !== 'text');
        return out;
      };
      const renderNow = (state: DimState): void => {
        standing.clear(); // every mark not in hand is rebuilt from the state below
        own(() => {
          const s = api.getAppState();
          const scene = new Map(all().map((el) => [el.id, el]));
          // what a person has in hand is left alone: it is diffed against `state` when the gesture ends
          const held = new Set<string>();
          for (const el of [s.newElement, s.editingTextElement, s.multiElement] as Array<{ id?: string; containerId?: string | null } | null>) {
            if (el?.id) held.add(el.id);
            if (el?.containerId) held.add(el.containerId);
          }
          if (pointerDown) for (const id of Object.keys(s.selectedElementIds)) held.add(id);
          const keepAsIs = (el: Versioned | undefined): boolean => !!el && (held.has(el.id) || isDirty(el));
          const stubs = new Set<string>();
          for (const [nodeId, n] of state.nodes) if (dimIsFallback(n.node)) stubs.add(dimLabelId(ids.engineOf(nodeId)));
          const target = dimToElements(state, theme, ids).filter((el) => !stubs.has(el.id));
          const next: unknown[] = [];
          const fresh = new Map<string, string>();
          const inTarget = new Set<string>();
          for (const el of target) {
            inTarget.add(el.id);
            const have = scene.get(el.id);
            if (keepAsIs(have)) {
              next.push(have);
              continue;
            }
            const done = complete(el, state);
            const sig = JSON.stringify(done);
            const r = rendered.get(el.id);
            const stored = el.type === 'text' && typeof el.containerId === 'string' ? undefined : foldNodeOf(el.id, state)?.node;
            if (stored) seen.set(el.id, stored);
            if (have && !have.isDeleted && r && r.sig === sig && r.version === have.version) {
              next.push(have);
              continue;
            }
            fresh.set(el.id, sig);
            next.push({ ...done, version: (have?.version ?? 0) + 1, versionNonce: crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1, index: have?.index ?? null, seed: have?.seed ?? 1, isDeleted: false });
          }
          // a mark drawn since the last render stays on top; anything else the state does not hold is gone
          for (const el of scene.values()) if (!inTarget.has(el.id) && !el.isDeleted && keepAsIs(el)) next.push(el);
          // the engine fills in what an element of each type needs and measures every text with its own metrics
          const restored = new Map((restoreElements(next as never, null, { refreshDimensions: true, repairBindings: true }) as unknown as Versioned[]).map((el) => [el.id, el]));
          const final = (next as Versioned[]).map((el) => {
            if (!fresh.has(el.id)) return el;
            const done = restored.get(el.id);
            if (!done) return null; // the engine holds no such element (a text with no size, a line with one point)
            const want = target.find((t) => t.id === el.id)!;
            // a label is centred on the point the map gave it; a line's label is placed by the engine as it draws
            // (the engine's restore clears a stroke's `lastCommittedPoint`: it is set again here, see complete())
            if (done.type === 'freedraw' && done.points?.length) return { ...done, lastCommittedPoint: done.points[done.points.length - 1] };
            if (done.type !== 'text') return done;
            return done.containerId ? { ...done, x: want.x - done.width / 2, y: want.y - done.height / 2 } : { ...done, x: want.x, y: want.y };
          }).filter((el): el is Versioned => el !== null);
          api.updateScene({ elements: final as never, captureUpdate: CaptureUpdateAction.NEVER });
          shown.clear();
          for (const el of all()) {
            const sig = fresh.get(el.id);
            if (sig !== undefined) rendered.set(el.id, { sig, version: el.version });
            if (!el.isDeleted && inTarget.has(el.id)) shown.add(el.id);
          }
          for (const id of [...rendered.keys()]) if (!inTarget.has(id)) rendered.delete(id);
          for (const id of [...seen.keys()]) if (!inTarget.has(id)) seen.delete(id);
          prev = state;
          // the id table keeps only what the state or the scene still holds
          const present = new Set(all().map((el) => el.id));
          for (const [engineId, nodeId] of [...nodeByEngine]) {
            if (state.nodes.has(nodeId) || present.has(engineId)) continue;
            nodeByEngine.delete(engineId);
            engineByNode.delete(nodeId);
          }
          for (const id of [...stickyDrawn]) if (!present.has(id) || nodeByEngine.has(id)) stickyDrawn.delete(id);
        });
        // nothing reads the engine's history (undo is the host's), so it is emptied here and at every report
        api.history.clear();
        announce();
        sceneChanged();
      };

      // ── edits: the scene diffed against `prev`, once a gesture has ended ──
      const editListeners = new Set<(ops: DimOp[], cause: Event | null) => void>();
      const undoListeners = new Set<(event: KeyboardEvent, redo: boolean) => void>();
      /** A new freehand stroke is fitted to the size a row may carry before it is read (src/board/simplify.ts). */
      const fitNewStrokes = (): void => {
        const thin = api.getAppState().zoom.value > 1;
        const extra: unknown[] = [];
        for (const el of api.getSceneElements() as unknown as Element[]) {
          if (el.type !== 'freedraw' || !el.points || foldNodeOf(el.id) || !isDirty(el as Versioned)) continue;
          // above 100% there are several samples per board unit, and whole-unit rounding leaves them as steps
          const fit = fitStroke(el.points.map((p) => [p[0], p[1]] as const), { thin });
          const first = fit.strokes[0]!;
          if (first.length === 0) continue;
          const shape = (pts: ReadonlyArray<readonly [number, number]>): Record<string, unknown> => {
            const o = pts[0]!;
            const rel = (pts.length === 1 ? [o, o] : pts).map(([x, y]) => [x - o[0], y - o[1]] as [number, number]);
            let w = 0;
            let h = 0;
            let minX = 0;
            let minY = 0;
            for (const [x, y] of rel) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
            }
            for (const [x, y] of rel) {
              if (x - minX > w) w = x - minX;
              if (y - minY > h) h = y - minY;
            }
            return { x: el.x + o[0], y: el.y + o[1], points: rel, width: w, height: h, pressures: [], simulatePressure: true, lastCommittedPoint: rel[rel.length - 1] };
          };
          mutateElement(el as never, shape(first) as never, false);
          // a stroke that cannot fit one row within the tolerance ceiling is several strokes, end to end: never lost
          for (const piece of fit.strokes.slice(1)) {
            const id = `g-${randomId()}`;
            if (handled.has(el.id)) handled.add(id); // a piece of the stroke the person drew is theirs too
            extra.push(changed(el, { ...shape(piece), id, index: null }));
          }
        }
        if (extra.length > 0) api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...extra] as never, captureUpdate: CaptureUpdateAction.NEVER });
      };
      /** Everything back to the state last rendered, with nothing left counted as changed. Always terminates. */
      const putBack = (): void => {
        disarm();
        untouched.clear();
        if (++putBacks > 2) {
          // the engine keeps changing what it is given: its form stands until the next render, and what it changed
          // is remembered so that a later real edit of one of those marks reports the person's change alone
          stand(diff(prev));
          rebase();
          return;
        }
        rebase();
        renderNow(prev);
        rebase();
      };
      /**
       * A stored arrow tied to a shape keeps its stored geometry (the map ties it with no focus and no gap, so the
       * engine would re-route BOTH ends to the shapes' centres when either shape moves). An arrow the person did
       * not take in hand has each end carried by exactly what its own shape moved, and nothing else.
       */
      const followArrows = (selected: Record<string, unknown>, was: ReadonlyMap<string, EngineElement>): void => {
        const scene = new Map(all().map((el) => [el.id, el]));
        for (const el of scene.values()) {
          const old = was.get(el.id);
          if (el.type !== 'arrow' || el.isDeleted || !isDirty(el) || selected[el.id] === true || !old?.points || !el.points || old.points.length !== el.points.length) continue;
          const shift = (bind: { elementId: string } | null | undefined): [number, number] => {
            const now = bind ? scene.get(bind.elementId) : undefined;
            const then = bind ? was.get(bind.elementId) : undefined;
            return now && then && !now.isDeleted ? [now.x - then.x, now.y - then.y] : [0, 0];
          };
          const a = shift(old.startBinding);
          const z = shift(old.endBinding);
          const last = old.points.length - 1;
          // absolute points: the first follows its shape, the last follows its own, the ones between stay
          const abs = old.points.map(([px, py], i) => [old.x + px + (i === 0 ? a[0] : i === last ? z[0] : 0), old.y + py + (i === 0 ? a[1] : i === last ? z[1] : 0)] as const);
          const points = abs.map(([px, py]) => [px - abs[0]![0], py - abs[0]![1]]);
          if (el.x === abs[0]![0] && el.y === abs[0]![1] && JSON.stringify(el.points) === JSON.stringify(points)) continue;
          mutateElement(el as never, { x: abs[0]![0], y: abs[0]![1], points } as never, false);
        }
      };
      /** The unfiltered diff of the scene against the state last rendered. */
      const diff = (basis: DimState): DimOp[] => {
        // a wrapped text holds its line breaks in `text`: what was typed is `originalText`
        const scene = all().map((el) => {
          if (el.type === 'text' && typeof el.originalText === 'string' && el.originalText !== el.text) return { ...el, text: el.originalText };
          // a stored dot is one point; the engine holds it as the same point twice
          const stored = el.type === 'freedraw' && el.points?.length === 2 ? seen.get(el.id)?.points : undefined;
          if (Array.isArray(stored) && stored.length === 2 && el.points![0]![0] === el.points![1]![0] && el.points![0]![1] === el.points![1]![1]) return { ...el, points: [el.points![0]] };
          return el;
        });
        const gone = (op: DimOp): boolean => op.type === 'delete' && !shown.has(ids.engineOf(op.id));
        return elementsToOps(basis, scene as never, ids, { line: style.line, fill: style.fill, sticky: stickyDrawn.size > 0 }).filter((op) => !gone(op));
      };
      let flushQueued = false;
      const flush = (): void => {
        flushQueued = false;
        if (dead !== null || recolouring || busy()) return;
        if (!dirty()) {
          // the gesture is over and changed nothing: it does not stay armed for a later engine change
          return disarm();
        }
        // an engine change nobody made (a reflow after a render), or one made while a card has the keyboard, is
        // not an edit, and is not kept either
        if (!touched || yielded) return putBack();
        putBacks = 0;
        const s = api.getAppState();
        note(s as never);
        const was = new Map(dimToElements(prev, theme, ids).map((el) => [el.id, el]));
        followArrows(s.selectedElementIds as Record<string, unknown>, was);
        fitNewStrokes();
        // What the person had in hand reaches: its label (and a label's mark), a frame's children, and the arrows
        // tied to it, now or in the rendered state. Nothing else may be in the edit, whatever the engine bumped.
        type Tied = Versioned & { frameId?: string | null; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null; name?: string | null };
        const scene = all() as readonly Tied[];
        const reach = new Set(handled);
        for (const el of scene) if (typeof el.containerId === 'string' && reach.has(el.id)) reach.add(el.containerId);
        const tiedTo = (el: { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null } | undefined): boolean => !!el && ((!!el.startBinding && reach.has(el.startBinding.elementId)) || (!!el.endBinding && reach.has(el.endBinding.elementId)));
        for (const el of scene) if (typeof el.frameId === 'string' && reach.has(el.frameId)) reach.add(el.id);
        for (const el of scene) if (el.type === 'arrow' && (tiedTo(el) || tiedTo(was.get(el.id)))) reach.add(el.id);
        for (const el of scene) if (typeof el.containerId === 'string' && reach.has(el.containerId)) reach.add(el.id);
        // ONLY what the person touched is reported: of those, the elements whose version moved since the last render or report
        const mine = new Set<string>();
        // words over what a row may carry are never read by the map: refused, and the mark (a label's mark with
        // it, which the engine resized around the words) goes back as it was
        const tooLong = new Set<string>();
        for (const el of scene) {
          if (!isDirty(el) || !reach.has(el.id) || (el.type !== 'text' && el.type !== 'frame')) continue;
          const label = el.type === 'text' && typeof el.containerId === 'string';
          const words = el.type === 'text' ? (el.originalText ?? el.text ?? '') : typeof el.name === 'string' ? el.name : '';
          const limit = el.type === 'frame' ? DIM_LIMITS.title : label ? DIM_LIMITS.label : DIM_LIMITS.text;
          if (words.length <= limit) continue;
          tooLong.add(el.id);
          if (label) tooLong.add(el.containerId!);
          refuse({ what: 'text', why: 'too-long', detail: String(limit) });
        }
        const cutBack = tooLong.size > 0;
        for (const el of scene) {
          if (!isDirty(el) || untouched.has(el.id) || !reach.has(el.id) || tooLong.has(el.id)) continue;
          mine.add(el.type === 'text' && typeof el.containerId === 'string' ? el.containerId : el.id);
        }
        // a mark in hand is compared with the node it was DRAWN from, so a remote change that landed during the
        // gesture is not undone by the drop: the ops are the person's own delta, applied on top of the newest state
        let basis = prev;
        const nodes = new Map(prev.nodes);
        for (const engineId of mine) {
          const nodeId = nodeByEngine.get(engineId);
          const cur = nodeId === undefined ? undefined : prev.nodes.get(nodeId);
          const was = seen.get(engineId);
          if (nodeId !== undefined && cur && was && was !== cur.node) nodes.set(nodeId, { ...cur, node: was });
        }
        basis = { ...prev, nodes };
        const touchedNode = (nodeId: string): boolean => mine.has(ids.engineOf(nodeId));
        const ops: DimOp[] = [];
        const strays: DimOp[] = [];
        for (const op of diff(basis)) {
          if (op.type === 'move') {
            const moved = op.ids.filter(touchedNode);
            if (moved.length > 0) ops.push(...lessStanding({ ...op, ids: moved }));
            if (moved.length < op.ids.length) strays.push({ ...op, ids: op.ids.filter((id) => !touchedNode(id)) });
          } else if (op.type === 'add' ? touchedNode(op.node.id) : (op.type === 'update' || op.type === 'delete') && touchedNode(op.id)) ops.push(...lessStanding(op));
          else strays.push(op);
        }
        // what the engine changed on a mark nobody held stands until the next render, out of every later edit
        // (a refused text is not standing: it is put back below)
        const refusedNode = (id: string): boolean => tooLong.has(ids.engineOf(id));
        stand(strays.filter((op) => !(op.type === 'move' ? op.ids.some(refusedNode) : op.type === 'add' ? refusedNode(op.node.id) : (op.type === 'update' || op.type === 'delete') && refusedNode(op.id))));
        const why = cause;
        rebase();
        disarm();
        untouched.clear();
        stickyDrawn.clear();
        api.history.clear();
        // a change that maps to no op (a text opened and left as it was) is put back
        if (ops.length === 0) return putBack();
        putBacks = 0;
        for (const l of [...editListeners]) l(ops, why);
        // a refused text is put back as the state has it (the listener may not have rendered)
        if (cutBack && dead === null) renderNow(prev);
      };
      const queueFlush = (): void => {
        if (flushQueued || dead !== null) return;
        flushQueued = true;
        queueMicrotask(flush);
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
            if (!had && tool === 'sticky' && el.type === 'rectangle' && el.id === appState.newElement?.id) stickyDrawn.add(el.id);
            mutateElement(el as never, { customData: { ...el.customData, gnomon: tokens } } as never, false);
          }
          if (mismatched(el as unknown as Element) && el.id !== appState.newElement?.id) repaint = true;
        }
        // a text opened and closed with the words it had: whatever the engine refitted around it is not an edit
        const editing = appState.editingTextElement as { id: string; containerId?: string | null; originalText?: string; text?: string } | null;
        if (editing && typing?.id !== editing.id) {
          const stored = elements.find((el) => el.id === editing.id) as { originalText?: string; text?: string } | undefined;
          typing = { id: editing.id, containerId: editing.containerId ?? null, text: base.has(editing.id) ? (stored?.originalText ?? stored?.text ?? '') : '\u0000new' };
        } else if (!editing && typing) {
          const now = elements.find((el) => el.id === typing!.id) as { originalText?: string; text?: string; isDeleted?: boolean } | undefined;
          if (now && !now.isDeleted && (now.originalText ?? now.text ?? '') === typing.text) {
            untouched.add(typing.id);
            if (typing.containerId) untouched.add(typing.containerId);
          }
          typing = null;
        }
        if (touched) note(appState as never);
        if (repaint) queueMicrotask(recolourAll);
        announce();
        sceneChanged();
        queueFlush();
      });
      const unsubscribeScroll = api.onScrollChange(sceneChanged);
      // the pointer and the keys a person uses on the board: what makes a later engine change an edit, and the
      // event its gesture stamp is minted from (the leaf's; the handle only hands the event on)
      let downAt: { x: number; y: number } | null = null;
      /** A press that lands on a fallback mark and goes nowhere: the mark is locked, so the leaf is told why nothing happened. */
      const pressOnFallback = (e: Event): void => {
        const p = e as PointerEvent;
        const from = downAt;
        downAt = null;
        if (!from || tool !== 'select' || Math.hypot(p.clientX - from.x, p.clientY - from.y) > 4) return;
        const box = surface()?.getBoundingClientRect();
        if (!box) return;
        const s = api.getAppState();
        const x = (p.clientX - box.left) / s.zoom.value - s.scrollX;
        const y = (p.clientY - box.top) / s.zoom.value - s.scrollY;
        for (const el of [...(api.getSceneElements() as unknown as Element[])].reverse()) {
          if (x < el.x || y < el.y || x > el.x + el.width || y > el.y + el.height) continue;
          const st = stampOf(el);
          if (st?.kind === 'stub') return refuse({ what: 'fallback', why: 'kept-as-it-is', detail: st.stubKind ?? '' });
          if (el.type !== 'frame') return; // the press was on a mark above it
        }
      };
      const onDown = (e: Event): void => {
        pointerDown = true;
        downAt = counts(e) ? { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY } : null;
        if (!counts(e)) return;
        touched = true;
        putBacks = 0;
        lastKey = null;
        note(api.getAppState() as never);
      };
      const onUp = (e: Event): void => {
        if (!pointerDown) return;
        pointerDown = false;
        if (counts(e)) {
          cause = e;
          pressOnFallback(e);
        }
        // the engine settles its own state after this event: look once it has
        setTimeout(queueFlush, 0);
      };
      const onKey = (e: KeyboardEvent): void => {
        if (!counts(e)) return;
        touched = true;
        putBacks = 0;
        cause = e;
        lastKey = e;
        note(api.getAppState() as never);
        setTimeout(queueFlush, 0);
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        if (!mod || e.altKey || (key !== 'z' && !(key === 'y' && e.ctrlKey && !e.metaKey))) return;
        const s = api.getAppState();
        if (s.editingTextElement != null || s.editingFrame != null) return; // a text being typed keeps its own undo
        e.preventDefault();
        // not while a card has the keyboard, not for a key held down, and not with a mark in hand (mid-drag)
        if (yielded || e.repeat || busy()) return;
        for (const l of [...undoListeners]) l(e, key === 'y' || e.shiftKey);
      };
      const onInput = (e: Event): void => {
        if (!counts(e)) return;
        touched = true;
        putBacks = 0;
        note(api.getAppState() as never);
        setTimeout(queueFlush, 0);
      };
      host.addEventListener('pointerdown', onDown, true);
      host.addEventListener('keydown', onKey, true);
      host.addEventListener('input', onInput, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      // ── paste, copy, cut and drop: contained BEFORE the engine (condition C8) ──
      // Per-board listeners on the document, capture phase. They act only when the event's target or the focused
      // element is inside THIS host (containment, never a tag), and they are removed at unmount. The engine's own
      // paste, copy and cut handlers (document, bubble phase) therefore never run, and patches `engine-paste-removed`,
      // `engine-copy-removed` and `engine-cut-removed` make them count and return if one ever did.
      const attemptListeners = new Set<(a: BoardAttempt) => void>();
      const attempt = (kind: BoardAttempt['kind'], dt: DataTransfer | null): void => {
        for (const l of [...attemptListeners]) l({ kind, types: [...(dt?.types ?? [])], files: dt?.files.length ?? 0 });
      };
      const within = (e: Event): boolean => (e.target instanceof Node && host.contains(e.target)) || host.contains(document.activeElement);
      /** A text field of this board that is being typed in (the engine's text editor, a frame's title): it pastes natively. */
      const typingIn = (e: Event): boolean => e.target instanceof Node && host.contains(e.target) && takesPlainText(e.target);
      const pasteListeners = new Set<(text: string, cause: ClipboardEvent) => void>();
      const copyListeners = new Set<(nodeIds: string[], cause: ClipboardEvent) => string | null | void>();
      const cutListeners = new Set<(nodeIds: string[], cause: Event) => string | null | void>();
      const outsideListeners = new Set<() => void>();
      const onPasteFirst = (e: ClipboardEvent): void => {
        if (dead !== null || !within(e)) return;
        // In a text being typed the field takes the paste itself, as plain text (rich HTML arrives as its text, a
        // file as nothing); the engine's handlers on the field and on the document never see the event. The words
        // reach the state only when the text is committed, through the edit path.
        if (typingIn(e)) return void e.stopImmediatePropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        const dt = e.clipboardData;
        attempt('paste', dt);
        const files = [...(dt?.files ?? [])];
        if (files.length > 0 || [...(dt?.items ?? [])].some((i) => i.kind === 'file')) {
          const image = files.some((f) => f.type.startsWith('image/')) || [...(dt?.items ?? [])].some((i) => i.kind === 'file' && i.type.startsWith('image/'));
          return refuse(image ? { what: 'image', why: 'no-image-kind' } : { what: 'file', why: 'no-file-paste' });
        }
        // the text is NEVER parsed: SVG source, engine JSON and HTML source are words like any other
        const text = dt?.getData('text/plain') ?? '';
        if (text.length === 0) return refuse({ what: 'paste', why: 'no-plain-text' });
        if (text.length > DIM_LIMITS.text) return refuse({ what: 'text', why: 'too-long', detail: String(DIM_LIMITS.text) });
        if (!counts(e) || yielded) return; // a paste no person made is stopped and goes no further
        for (const l of [...pasteListeners]) l(text, e);
      };
      /** The node ids of the selected marks the rendered state holds, in paint order; `all` is false when one is not stored yet. */
      const selectedNodes = (): { ids: string[]; all: boolean } => {
        const selected = api.getAppState().selectedElementIds as Record<string, unknown>;
        const out: string[] = [];
        let every = true;
        for (const el of api.getSceneElements() as unknown as Element[]) {
          if (selected[el.id] !== true || el.containerId) continue;
          const nodeId = nodeByEngine.get(el.id);
          if (nodeId !== undefined && prev.nodes.has(nodeId)) out.push(nodeId);
          else every = false;
        }
        return { ids: out, all: every };
      };
      const onCopyFirst = (cut: boolean) => (e: ClipboardEvent): void => {
        if (dead !== null) return;
        // a copy or a cut made anywhere else on the page: the caller forgets what it held
        if (!within(e)) return void [...outsideListeners].forEach((l) => l());
        // the words being typed are copied by the field itself
        if (typingIn(e)) return void e.stopImmediatePropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!counts(e) || yielded) return;
        const sel = selectedNodes();
        // a cut made with the keyboard is stamped from its key (a `cut` event carries no gesture stamp)
        const key = lastKey && (lastKey.metaKey || lastKey.ctrlKey) && lastKey.key.toLowerCase() === 'x' ? lastKey : null;
        let text = '';
        if (cut) for (const l of [...cutListeners]) text = String(l(sel.ids, key ?? e) ?? '') || text;
        else for (const l of [...copyListeners]) text = String(l(sel.ids, e) ?? '') || text;
        if (text.length === 0) return; // nothing was taken: the system clipboard is left as it is
        // plain text and nothing else: no HTML, no engine type, no custom type
        e.clipboardData?.setData('text/plain', text);
        // a cut removes what was copied, as the person's own edit; with a mark not stored yet it only copies
        if (!cut || !sel.all || busy()) return;
        touched = true;
        putBacks = 0;
        cause = key ?? e;
        note(api.getAppState() as never);
        const selected = api.getAppState().selectedElementIds as Record<string, unknown>;
        const going = new Set<string>();
        const scene = api.getSceneElementsIncludingDeleted() as unknown as Array<Element & { frameId?: string | null }>;
        for (const el of scene) if (selected[el.id] === true && !el.isDeleted) going.add(el.id);
        for (const el of scene) if (typeof el.frameId === 'string' && going.has(el.frameId)) going.add(el.id);
        for (const el of scene) if (typeof el.containerId === 'string' && going.has(el.containerId)) going.add(el.id);
        api.updateScene({ elements: scene.map((el) => (going.has(el.id) && !el.isDeleted ? changed(el, { isDeleted: true }) : el)) as never, appState: { selectedElementIds: {}, selectedGroupIds: {} } as never, captureUpdate: CaptureUpdateAction.NEVER });
        queueFlush();
      };
      const onCopyHere = onCopyFirst(false);
      const onCutHere = onCopyFirst(true);
      const unsubscribeRefusal = onBoardRefusal((what, detail) => refuse(what === 'image' ? { what, why: 'no-image-kind' } : { what, why: 'not-a-board-kind', ...(detail ? { detail } : {}) }));
      // A drop never reaches the engine: a dropped scene file replaced the whole board with the stock look and
      // raised an img-src refusal, and a library file filled a Library nobody can open (Mika, S1.1 pass A finding
      // 1). The pointer says so while it hovers.
      const onDragOver = (e: DragEvent): void => {
        if (dead !== null || !within(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      };
      // EVERY drop is refused, with or without files (review S2): a drag that carries the library type and no file
      // was read by the engine and inserted as elements
      const onFileDrop = (e: DragEvent): void => {
        if (dead !== null || !(e.target instanceof Node && host.contains(e.target))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // (a drop arrives here only where the browser fires one after a refused dragover, or from a script)
        const said = dragSaid;
        dragSaid = false;
        if (said) return;
        attempt('drop', e.dataTransfer);
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length === 0) return void refuse({ what: [...(e.dataTransfer?.types ?? [])].includes(LIBRARY_MIME) ? 'library-file' : 'file', why: 'no-file-drop' });
        for (const f of files) {
          const name = f.name.toLowerCase();
          const what: BoardRefusal['what'] = f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name) ? 'image' : name.endsWith('.excalidrawlib') ? 'library-file' : name.endsWith('.excalidraw') || name.endsWith('.json') ? 'scene-file' : 'file';
          refuse({ what, why: what === 'image' ? 'no-image-kind' : 'no-file-drop' });
        }
      };
      const onDragOverHere = (e: DragEvent): void => {
        if (e.target instanceof Node && host.contains(e.target)) onDragOver(e);
      };
      // A real drag never gets as far as `drop` (the dragover above answers "none", so the browser ends it with a
      // dragleave): the refusal is said ONCE per drag, when it enters the board, from the types the drag offers
      // (file names are not readable before a drop, so a scene file is a `file` here).
      let dragSaid = false;
      const onDragEnter = (e: DragEvent): void => {
        if (dead !== null || !(e.target instanceof Node && host.contains(e.target))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (dragSaid) return;
        dragSaid = true;
        const dt = e.dataTransfer;
        attempt('drop', dt);
        const items = [...(dt?.items ?? [])];
        const types = [...(dt?.types ?? [])];
        refuse(items.some((i) => i.kind === 'file' && i.type.startsWith('image/')) ? { what: 'image', why: 'no-image-kind' } : { what: types.includes(LIBRARY_MIME) ? 'library-file' : 'file', why: 'no-file-drop' });
      };
      const onDragGone = (e: DragEvent): void => {
        // the drag left the board (or ended): the next one that enters is said again
        if (e.type !== 'dragleave' || !(e.relatedTarget instanceof Node && host.contains(e.relatedTarget))) dragSaid = false;
      };
      document.addEventListener('paste', onPasteFirst, true);
      document.addEventListener('copy', onCopyHere, true);
      document.addEventListener('cut', onCutHere, true);
      document.addEventListener('dragover', onDragOverHere, true);
      document.addEventListener('dragenter', onDragEnter, true);
      document.addEventListener('dragleave', onDragGone, true);
      document.addEventListener('dragend', onDragGone, true);
      document.addEventListener('drop', onFileDrop, true);
      const run = (name: (typeof HANDLE_ACTIONS)[number]): void => {
        live();
        api.gnomonAction(name);
        announce();
      };
      const refusal = (field: BoardStyleRefusal['field'], offer: string | null = null): BoardStyleRefusal => ({ ok: false, field, offer });
      rebase();
      return {
        render(state: DimState): void {
          live();
          // a rendered row is not a gesture (Aegis A1): unless a person has a mark in hand, nothing the engine does
          // from here on is an edit until they act again
          // one handle per dimension: another dimension is another mount (its ids, its undo and its marks in hand)
          if (state.dim !== shows) {
            if (shows !== null) throw new Error('this board shows another dimension: unmount it and mount a new one');
            shows = state.dim;
          }
          if (!busy() && !dirty()) disarm();
          putBacks = 0;
          renderNow(state);
        },
        onEdit(listener) {
          editListeners.add(listener);
          return () => void editListeners.delete(listener);
        },
        onUndoKey(listener) {
          undoListeners.add(listener);
          return () => void undoListeners.delete(listener);
        },
        setYielded(on: boolean): void {
          yielded = on === true;
          setBoardYielded(host, yielded);
          // a mark displaced when the card took the keyboard is put back once the engine lets go of it
          if (yielded) queueFlush();
        },
        drift: () => (live(), diff(prev)),
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
        setStyle(next: Partial<BoardStyle>, by: Event | null = null) {
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
          let restyled = false;
          const elements = api.getSceneElementsIncludingDeleted().map((el) => {
            if (!selected[el.id] || el.isDeleted) return el;
            const old: Stamp = stampOf(el as unknown as Element) ?? { line: CONTENT_DEFAULTS.line, fill: null };
            if (old.kind === 'stub') return el; // a stub is never restyled
            const label = !!(el as unknown as Element).containerId;
            if (label && next.fill === undefined && next.weight === undefined) return el; // a label stays the default ink
            const stamp: Stamp = { ...old, ...(next.line !== undefined && !label ? { line: next.line } : {}), ...(next.fill !== undefined && FILLABLE.has(el.type) ? { fill: next.fill ?? (old.kind === 'sticky' ? CONTENT_DEFAULTS.stickyFill : null) } : {}) };
            restyled = true;
            return changed(el, {
              strokeColor: lineColour(stamp.line, theme),
              backgroundColor: fillColour(FILLABLE.has(el.type) ? stamp.fill : null, theme),
              ...(next.weight !== undefined && el.type !== 'text' && el.type !== 'frame' ? { strokeWidth: BOARD_WEIGHTS[next.weight === 'marker' && el.type !== 'freedraw' ? 'bold' : next.weight] } : {}),
              customData: { ...el.customData, gnomon: { line: stamp.line, fill: stamp.fill } },
            });
          });
          // restyling the selection is the person's edit (the rail's key called this): it is reported like any other
          if (restyled) {
            note(api.getAppState() as never);
            touched = by !== null && counts(by);
            cause = touched ? by : null;
            putBacks = 0;
          }
          api.updateScene({ ...(restyled ? { elements } : {}), appState: current() as never, captureUpdate: CaptureUpdateAction.NEVER });
          announce();
          if (restyled) queueFlush();
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
        onPasteText(listener) {
          pasteListeners.add(listener);
          return () => void pasteListeners.delete(listener);
        },
        onCopy(listener) {
          copyListeners.add(listener);
          return () => void copyListeners.delete(listener);
        },
        onCut(listener) {
          cutListeners.add(listener);
          return () => void cutListeners.delete(listener);
        },
        onCopyOutside(listener) {
          outsideListeners.add(listener);
          return () => void outsideListeners.delete(listener);
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
          setBoardYielded(host, false);
          host.removeEventListener('pointerdown', onDown, true);
          host.removeEventListener('keydown', onKey, true);
          host.removeEventListener('input', onInput, true);
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onUp, true);
          document.removeEventListener('paste', onPasteFirst, true);
          document.removeEventListener('copy', onCopyHere, true);
          document.removeEventListener('cut', onCutHere, true);
          document.removeEventListener('dragover', onDragOverHere, true);
          document.removeEventListener('dragenter', onDragEnter, true);
          document.removeEventListener('dragleave', onDragGone, true);
          document.removeEventListener('dragend', onDragGone, true);
          document.removeEventListener('drop', onFileDrop, true);
          pasteListeners.clear();
          copyListeners.clear();
          cutListeners.clear();
          outsideListeners.clear();
          stateListeners.clear();
          sceneListeners.clear();
          attemptListeners.clear();
          refusedListeners.clear();
          editListeners.clear();
          undoListeners.clear();
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
