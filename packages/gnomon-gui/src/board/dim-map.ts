/**
 * @symbol #gui-dim-map
 *
 * The two-way map between a folded dimension (`dim-shape:v1`, gnomon-contracts) and the board engine's elements
 * (boards S1.3, draft point 5; condition C4; Aegis A6). PURE: no DOM, no engine import (not even a type import:
 * test/board-isolation.test.ts allows the engine's name in src/board/index.ts only, so the element shape is the
 * structural `EngineElement` below). Unit tests load it in Node.
 *
 * FORWARD (`dimToElements`): every element is BUILT from the closed key list `DIM_ENGINE_KEYS`. No node key is
 * copied onto an element, so a stored `link`, `embeddable`, free `customData` or prototype key can never reach the
 * engine. The stroke is dashed when the fold says an agent or an unknown hand drew the node, whatever the node
 * looks like (`dimIsSticky` is paint only and never changes that). A node this build cannot draw is a fixed
 * rectangle whose words are `dimFallbackLabel(kind)`.
 *
 * REVERSE (`elementsToOps`): a diff of the engine's elements against the state they were rendered from. Both sides
 * are read through the same engine-side reader, so a field the engine does not carry (`refs`, `rel`, a text's
 * `size` and `w`) is never patched, and a node the fold carried in a non-canonical form causes no op until a person
 * changes it. Defaults are left out of an `add` (ink line, fine weight, an end head, no rotation).
 *
 * Not written here, by rule: an op on a node of a non-core kind or on a core node drawn as a fallback (the write
 * validator refuses those), an element whose node id was deleted before (ids are never reused), an element of a
 * type the board does not have, and a text with no characters.
 */
import { CONTENT_DEFAULTS, CONTENT_SWATCH_NAME_PATTERN, DIM_CORE_KINDS, DIM_LIMITS, DIM_Z_PATTERN, dimFallbackLabel, dimZCompare, dimZPlace, isContentColour } from '@a-company/gnomon-contracts';
import type { DimCoreKind, DimFoldNode, DimNode, DimOp, DimState } from '@a-company/gnomon-contracts';
import { BOARD_WEIGHTS, type BoardTheme } from '../core/board.js';
import { fillColour, lineColour } from './normal.js';

/** Injected by the handle, which mints the ULIDs: a stable two-way id table. */
export interface DimMapIds {
  /** the node id of an engine element (minted on first sight of a new element) */
  nodeOf(engineId: string): string;
  /** the engine id of a node */
  engineOf(nodeId: string): string;
}

export interface EngineBinding {
  elementId: string;
  focus: number;
  gap: number;
}
/** The whole of an element this map writes or reads. Structural: the engine's own union is wider. */
export interface EngineElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed';
  points?: Array<[number, number]>;
  text?: string;
  containerId?: string | null;
  frameId?: string | null;
  startBinding?: EngineBinding | null;
  endBinding?: EngineBinding | null;
  boundElements?: Array<{ type: 'arrow' | 'text'; id: string }> | null;
  startArrowhead?: 'arrow' | null;
  endArrowhead?: 'arrow' | null;
  name?: string | null;
  customData?: { gnomon: { line: string; fill: string | null } };
}
/** What `elementsToOps` reads of an element: the same keys, all but id and type optional, plus the engine's tombstone. */
export type EngineElementIn = { readonly id: string; readonly type: string; readonly isDeleted?: boolean } & { readonly [K in Exclude<keyof EngineElement, 'id' | 'type' | 'customData'>]?: unknown } & { readonly customData?: unknown };

/** The closed list of keys an emitted element may carry (a test holds every emitted element to it). */
export const DIM_ENGINE_KEYS: readonly string[] = Object.freeze([
  'id', 'type', 'x', 'y', 'width', 'height', 'angle', 'points',
  'strokeColor', 'backgroundColor', 'strokeWidth', 'strokeStyle',
  'text', 'containerId', 'frameId', 'startBinding', 'endBinding', 'boundElements', 'startArrowhead', 'endArrowhead', 'name', 'customData',
]);

/** The current line and fill tokens, for a mark drawn since the last render. `sticky`: the Sticky tool is the one drawing. */
export interface DimMapStyle {
  line: string;
  fill: string | null;
  sticky?: boolean;
}

/**
 * AGREEMENT with ./normal.ts (boards S1.3 pass P3b; test/dim-map.test.ts holds it for every kind, hand and style):
 * every type emitted here is in normal.ts BOARD_TYPES, `diamond` takes a fill in both, and an arrow's `head`
 * (none, end, both) survives normalOf, which fixes only the SHAPE of a head. So completing this map's output
 * through normalOf and reading it back yields no op.
 */
const KIND_TYPE: Readonly<Record<DimCoreKind, string>> = { stroke: 'freedraw', rect: 'rectangle', ellipse: 'ellipse', diamond: 'diamond', arrow: 'arrow', text: 'text', frame: 'frame' };
const TYPE_KIND: ReadonlyMap<string, DimCoreKind> = new Map(DIM_CORE_KINDS.map((k) => [KIND_TYPE[k], k]));
const FILL_KINDS: ReadonlySet<string> = new Set(['rect', 'ellipse', 'diamond']);
const LABEL_KINDS: ReadonlySet<string> = new Set(['rect', 'ellipse', 'diamond', 'arrow']);
const LABEL_TYPES: ReadonlySet<string> = new Set(['rectangle', 'ellipse', 'diamond', 'arrow']);
const WEIGHT_WIDTHS: readonly number[] = [BOARD_WEIGHTS.fine, BOARD_WEIGHTS.bold, BOARD_WEIGHTS.marker];
/** A fallback mark's fixed box and tokens (design component fallback-node; the same numbers as the S1.1 stub). */
export const DIM_FALLBACK_BOX = Object.freeze({ width: 288, height: 52, line: 'graphite', fill: 'paper' });
const LABEL_SUFFIX = ':label';
/** The engine id of the text element that shows a node's label (derived, so a re-render keeps it). */
export const dimLabelId = (engineId: string): string => `${engineId}${LABEL_SUFFIX}`;

const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCore = (k: unknown): k is DimCoreKind => typeof k === 'string' && (DIM_CORE_KINDS as readonly string[]).includes(k);
const flatPoints = (v: unknown, min: number): number[] | null => (Array.isArray(v) && v.length >= min && v.length % 2 === 0 && v.every(num) ? (v as number[]) : null);

/**
 * A sticky is a rect with a named fill and a label key (founder default F3). PAINT ONLY (Aegis A6): it picks the
 * scrap look and the pin. No gate reads it, and it never changes whose hand a mark is drawn in.
 */
export function dimIsSticky(node: Record<string, unknown>): boolean {
  const fill = own(node, 'fill');
  return own(node, 'kind') === 'rect' && typeof fill === 'string' && CONTENT_SWATCH_NAME_PATTERN.test(fill) && isContentColour(fill, 'fill') && typeof own(node, 'label') === 'string';
}

/** True when a node is drawn as the fallback box: a kind this build does not know, or a core node without the fields its kind is drawn from. */
export const dimIsFallback = (node: Record<string, unknown>): boolean => !drawable(node);

/** True when a core node has the fields its kind is drawn from; anything else is drawn as a fallback. */
function drawable(node: Record<string, unknown>): node is Record<string, unknown> & { kind: DimCoreKind; x: number; y: number } {
  const kind = own(node, 'kind');
  if (!isCore(kind) || !num(own(node, 'x')) || !num(own(node, 'y'))) return false;
  // over the write limits (a row from a later version, or a hostile one): the fallback box, never the payload
  if (kind === 'stroke' || kind === 'arrow') {
    const pts = own(node, 'points');
    return Array.isArray(pts) && pts.length <= DIM_LIMITS.points && flatPoints(pts, kind === 'arrow' ? 4 : 2) !== null;
  }
  if (kind === 'text') {
    const text = own(node, 'text');
    return typeof text === 'string' && text.length <= DIM_LIMITS.text;
  }
  const w = own(node, 'w');
  const h = own(node, 'h');
  return num(w) && num(h) && w > 0 && h > 0;
}

interface Built {
  main: EngineElement;
  label: EngineElement | null;
}

function build(nodeId: string, n: DimFoldNode, theme: BoardTheme, ids: DimMapIds, live: ReadonlyMap<string, DimFoldNode>): Built {
  const node = n.node;
  const id = ids.engineOf(nodeId);
  // fails closed: solid only for a hand the fold calls human; a missing `by` or a class this build does not know is dashed
  const strokeStyle = (n.by as { cls?: unknown } | undefined)?.cls === 'human' ? 'solid' : 'dashed';
  const x0 = num(own(node, 'x')) ? Math.round(own(node, 'x') as number) : 0;
  const y0 = num(own(node, 'y')) ? Math.round(own(node, 'y') as number) : 0;
  const parentId = own(node, 'parent');
  const frameId = typeof parentId === 'string' && own(live.get(parentId)?.node ?? {}, 'kind') === 'frame' ? ids.engineOf(parentId) : null;
  const labelEl = (text: string, cx: number, cy: number): EngineElement => ({
    id: dimLabelId(id), type: 'text', x: cx, y: cy, width: 0, height: 0, angle: 0,
    strokeColor: lineColour(CONTENT_DEFAULTS.line, theme), backgroundColor: 'transparent', strokeWidth: BOARD_WEIGHTS.fine, strokeStyle: 'solid',
    text, containerId: id, frameId, customData: { gnomon: { line: CONTENT_DEFAULTS.line, fill: null } },
  });
  if (!drawable(node)) {
    const tokens = { line: DIM_FALLBACK_BOX.line, fill: DIM_FALLBACK_BOX.fill };
    const label = labelEl(dimFallbackLabel(own(node, 'kind')), x0 + DIM_FALLBACK_BOX.width / 2, y0 + DIM_FALLBACK_BOX.height / 2);
    return {
      main: {
        id, type: 'rectangle', x: x0, y: y0, width: DIM_FALLBACK_BOX.width, height: DIM_FALLBACK_BOX.height, angle: 0,
        strokeColor: lineColour(tokens.line, theme), backgroundColor: fillColour(tokens.fill, theme), strokeWidth: 1, strokeStyle,
        frameId: null, boundElements: [{ type: 'text', id: label.id }], customData: { gnomon: tokens },
      },
      label: { ...label, frameId: null },
    };
  }
  const kind = node.kind;
  const color = own(node, 'color');
  const fill = own(node, 'fill');
  const tokens = { line: isContentColour(color, 'line') ? color : CONTENT_DEFAULTS.line, fill: FILL_KINDS.has(kind) && isContentColour(fill, 'fill') ? fill : null };
  const weight = own(node, 'weight');
  const rot = own(node, 'rot');
  let mid: [number, number] | null = null;
  const main: EngineElement = {
    id, type: KIND_TYPE[kind], x: x0, y: y0, width: 0, height: 0,
    angle: num(rot) ? (rot / 1800) * Math.PI : 0,
    strokeColor: lineColour(tokens.line, theme), backgroundColor: fillColour(tokens.fill, theme),
    strokeWidth: kind === 'text' || kind === 'frame' ? BOARD_WEIGHTS.fine : (WEIGHT_WIDTHS[(weight === 2 || weight === 3 ? weight : 1) - 1] as number),
    strokeStyle,
    frameId: kind === 'frame' ? null : frameId,
    customData: { gnomon: tokens },
  };
  if (kind === 'stroke' || kind === 'arrow') {
    // the engine wants a linear element's first point at the origin: shift the element instead ("Linear element is not normalized")
    const flat = own(node, 'points') as number[];
    const px = Math.round(flat[0] as number);
    const py = Math.round(flat[1] as number);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < flat.length; i += 2) points.push([Math.round(flat[i] as number) - px, Math.round(flat[i + 1] as number) - py]);
    // a loop, not a spread: a long stroke must not overflow the call stack
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const [qx, qy] of points) {
      if (qx < minX) minX = qx;
      if (qx > maxX) maxX = qx;
      if (qy < minY) minY = qy;
      if (qy > maxY) maxY = qy;
    }
    main.x = x0 + px;
    main.y = y0 + py;
    main.points = points;
    main.width = maxX - minX;
    main.height = maxY - minY;
    // a line may run left or up of its first point: its middle is the middle of its points
    mid = [main.x + Math.round((minX + maxX) / 2), main.y + Math.round((minY + maxY) / 2)];
  } else if (kind === 'text') {
    const w = own(node, 'w');
    main.text = node.text as string;
    if (num(w) && w > 0) main.width = Math.round(w);
  } else {
    main.width = Math.max(1, Math.round(node.w as number));
    main.height = Math.max(1, Math.round(node.h as number));
  }
  if (kind === 'frame') {
    const title = own(node, 'title');
    main.name = typeof title === 'string' && title.length > 0 ? title : null;
  }
  if (kind === 'arrow') {
    const head = own(node, 'head');
    main.startArrowhead = head === 'both' ? 'arrow' : null;
    main.endArrowhead = head === 'none' ? null : 'arrow';
    for (const [key, slot] of [['from', 'startBinding'], ['to', 'endBinding']] as const) {
      const target = own(node, key);
      main[slot] = typeof target === 'string' && target !== nodeId && live.has(target) ? { elementId: ids.engineOf(target), focus: 0, gap: 0 } : null;
    }
  }
  const text = LABEL_KINDS.has(kind) ? own(node, 'label') : undefined;
  const at = mid ?? [main.x + Math.round(main.width / 2), main.y + Math.round(main.height / 2)];
  const label = typeof text === 'string' && text.length > 0 && text.length <= DIM_LIMITS.label ? labelEl(text, at[0], at[1]) : null;
  if (label) main.boundElements = [{ type: 'text', id: label.id }];
  return { main, label };
}

/**
 * The elements of a state, in paint order (`dimZCompare`), a label straight after its mark. A text element and a
 * label carry no measured size: the handle measures them with the engine when it renders.
 */
export function dimToElements(state: DimState, theme: BoardTheme, ids: DimMapIds): EngineElement[] {
  const entries = [...state.nodes.entries()].sort((a, b) => dimZCompare({ z: own(a[1].node, 'z'), id: a[0] }, { z: own(b[1].node, 'z'), id: b[0] }));
  const built = entries.map(([nodeId, n]) => build(nodeId, n, theme, ids, state.nodes));
  // an arrow's ends are also listed on the marks it is tied to
  const byId = new Map(built.map((b) => [b.main.id, b.main]));
  for (const b of built) {
    for (const bind of [b.main.startBinding, b.main.endBinding]) {
      const target = bind ? byId.get(bind.elementId) : undefined;
      if (target && !(target.boundElements ?? []).some((e) => e.id === b.main.id)) target.boundElements = [...(target.boundElements ?? []), { type: 'arrow', id: b.main.id }];
    }
  }
  return built.flatMap((b) => (b.label ? [b.main, b.label] : [b.main]));
}

/* ── reverse ──────────────────────────────────────────────────────────────── */

type Fields = Record<string, unknown>;

interface ReadCtx {
  /** live main elements by engine id */
  mains: ReadonlyMap<string, EngineElementIn>;
  /** label text by container engine id */
  labels: ReadonlyMap<string, string>;
  /** engine id → node id, for a live main element only (never mints for anything else) */
  nodeIdOf(engineId: string): string | null;
}

const bindingTarget = (v: unknown): string | null => {
  const id = v && typeof v === 'object' ? (v as { elementId?: unknown }).elementId : undefined;
  return typeof id === 'string' ? id : null;
};

/** The node fields an element stands for, defaults left out. `null` when the element is not a mark the board stores. */
function read(el: EngineElementIn, selfNodeId: string, style: DimMapStyle, ctx: ReadCtx): (Fields & { kind: DimCoreKind }) | null {
  const kind = TYPE_KIND.get(el.type);
  if (!kind || !num(el.x) || !num(el.y)) return null;
  const out: Fields & { kind: DimCoreKind } = { kind, x: Math.round(el.x), y: Math.round(el.y) };
  const g = el.customData && typeof el.customData === 'object' ? own(el.customData as Record<string, unknown>, 'gnomon') : undefined;
  const had = g && typeof g === 'object' && typeof (g as { line?: unknown }).line === 'string' ? (g as { line: unknown; fill?: unknown }) : null;
  const line = had ? had.line : style.line;
  const fill = had ? had.fill : style.fill;
  if (isContentColour(line, 'line') && line !== CONTENT_DEFAULTS.line) out.color = line;
  if (FILL_KINDS.has(kind) && isContentColour(fill, 'fill')) out.fill = fill;
  if (num(el.angle)) {
    const rot = ((Math.round((el.angle * 1800) / Math.PI) % 3600) + 3600) % 3600;
    if (rot !== 0) out.rot = rot;
  }
  if (kind !== 'text' && kind !== 'frame' && num(el.strokeWidth)) {
    const sw = el.strokeWidth;
    const weight = 1 + WEIGHT_WIDTHS.reduce((best, w, i) => (Math.abs(w - sw) < Math.abs((WEIGHT_WIDTHS[best] as number) - sw) ? i : best), 0);
    if (weight !== 1) out.weight = weight;
  }
  if (kind === 'stroke' || kind === 'arrow') {
    const pts = Array.isArray(el.points) ? el.points : [];
    const flat: number[] = [];
    for (const p of pts) {
      if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) return null;
      flat.push(Math.round(p[0]), Math.round(p[1]));
    }
    if (flat.length < (kind === 'arrow' ? 4 : 2)) return null;
    out.points = flat;
  } else if (kind === 'text') {
    if (typeof el.text !== 'string' || el.text.length === 0) return null;
    out.text = el.text;
  } else {
    if (!num(el.width) || !num(el.height)) return null;
    out.w = Math.max(1, Math.round(Math.abs(el.width)));
    out.h = Math.max(1, Math.round(Math.abs(el.height)));
  }
  if (kind === 'frame') {
    if (typeof el.name === 'string' && el.name.length > 0) out.title = el.name;
  } else if (typeof el.frameId === 'string' && ctx.mains.get(el.frameId)?.type === 'frame') {
    const parent = ctx.nodeIdOf(el.frameId);
    if (parent !== null && parent !== selfNodeId) out.parent = parent;
  }
  if (kind === 'arrow') {
    const start = el.startArrowhead != null;
    const end = el.endArrowhead != null;
    if (start) out.head = 'both';
    else if (!end) out.head = 'none';
    for (const [key, slot] of [['from', 'startBinding'], ['to', 'endBinding']] as const) {
      const target = bindingTarget(el[slot]);
      const nodeId = target !== null && ctx.mains.has(target) ? ctx.nodeIdOf(target) : null;
      if (nodeId !== null && nodeId !== selfNodeId) out[key] = nodeId;
    }
  }
  if (LABEL_KINDS.has(kind)) {
    const label = ctx.labels.get(el.id);
    if (label !== undefined && label.length > 0) out.label = label;
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Indexes (into `keys`) of one longest strictly increasing run by `dimZCompare`: the marks whose order key stays. */
function keepers(keys: ReadonlyArray<{ z: unknown; id: string }>): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array<number>(keys.length).fill(-1);
  keys.forEach((k, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dimZCompare(keys[tails[mid] as number]!, k) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] as number;
    tails[lo] = i;
  });
  const out = new Set<number>();
  for (let i = tails.length > 0 ? (tails[tails.length - 1] as number) : -1; i >= 0; i = prev[i] as number) out.add(i);
  return out;
}

/**
 * The ops that turn `prev` into what the engine shows now. `elements` is the engine's whole scene in paint order;
 * `prev` is the state those elements were last rendered from. Order of the result: adds (frames, then marks, then
 * arrows, so a later op may cite an earlier one), updates, moves, deletes. A pure translation of several marks is
 * ONE move. Nothing is validated here: the caller sends the ops through `validateDimOps`.
 */
export function elementsToOps(prev: DimState, elements: readonly EngineElementIn[], ids: DimMapIds, style: DimMapStyle): DimOp[] {
  const mains = new Map<string, EngineElementIn>();
  const labels = new Map<string, string>();
  const order: EngineElementIn[] = [];
  // a text is a label only of a live mark that can carry one; a `containerId` naming nothing is no container
  const carriers = new Set<string>();
  for (const el of elements) if (el && !el.isDeleted && typeof el.id === 'string' && LABEL_TYPES.has(el.type)) carriers.add(el.id);
  for (const el of elements) {
    if (!el || el.isDeleted || typeof el.id !== 'string' || typeof el.type !== 'string') continue;
    if (el.type === 'text' && typeof el.containerId === 'string' && el.containerId !== el.id && carriers.has(el.containerId)) {
      if (typeof el.text === 'string' && !labels.has(el.containerId)) labels.set(el.containerId, el.text);
      continue;
    }
    if (!TYPE_KIND.has(el.type) || mains.has(el.id)) continue;
    mains.set(el.id, el);
    order.push(el);
  }
  // an element that is not a stored node and does not read as a mark (a text with no characters, a line with one
  // point) is not in the scene as far as the diff goes, and no id is minted for it
  const known = new Set([...prev.nodes.keys()].map((nodeId) => ids.engineOf(nodeId)));
  const dry: ReadCtx = { mains, labels, nodeIdOf: () => null };
  for (const el of [...order]) {
    if (known.has(el.id) || read(el, '', style, dry)) continue;
    mains.delete(el.id);
    order.splice(order.indexOf(el), 1);
  }
  const nodeIds = new Map<string, string>();
  const nodeIdOf = (engineId: string): string | null => {
    if (!mains.has(engineId)) return null;
    let id = nodeIds.get(engineId);
    if (id === undefined) nodeIds.set(engineId, (id = ids.nodeOf(engineId)));
    return id;
  };
  const ctx: ReadCtx = { mains, labels, nodeIdOf };

  // what the previous state looked like to the engine, read the same way
  const prevEls = dimToElements(prev, 'day', ids);
  const prevMains = new Map<string, EngineElementIn>();
  const prevLabels = new Map<string, string>();
  for (const el of prevEls) {
    if (el.type === 'text' && typeof el.containerId === 'string') prevLabels.set(el.containerId, el.text ?? '');
    else prevMains.set(el.id, el);
  }
  const prevCtx: ReadCtx = { mains: prevMains, labels: prevLabels, nodeIdOf: (engineId) => (prevMains.has(engineId) ? ids.nodeOf(engineId) : null) };

  interface Item {
    nodeId: string;
    now: Fields & { kind: DimCoreKind };
    /** the stored node, when it is one this map may edit */
    was: (Fields & { kind: DimCoreKind }) | null;
    z: unknown;
    fresh: boolean;
  }
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const el of order) {
    const nodeId = nodeIdOf(el.id) as string;
    seen.add(nodeId);
    if (prev.gone.has(nodeId)) continue;
    const stored = prev.nodes.get(nodeId);
    const now = read(el, nodeId, style, ctx);
    if (!stored) {
      if (!now) continue;
      // the Sticky tool draws a filled, labelled rect: the label key is what makes it one
      if (style.sticky && now.kind === 'rect' && now.label === undefined) now.label = '';
      items.push({ nodeId, now, was: null, z: undefined, fresh: true });
      continue;
    }
    const prevEl = prevMains.get(ids.engineOf(nodeId));
    const was = prevEl ? read(prevEl, nodeId, style, prevCtx) : null;
    // a fallback mark, a mark of another kind, or an element that no longer reads as a mark: an anchor in the order, never edited
    const editable = !!now && !!was && drawable(stored.node) && stored.node.kind === now.kind && was.kind === now.kind;
    items.push({ nodeId, now: now ?? { kind: 'rect' }, was: editable ? was : null, z: own(stored.node, 'z'), fresh: false });
  }

  // order keys: the longest run already in order keeps its keys; every other mark is placed between its neighbours
  // (a stored key that is not a well-formed order key is never kept: a legal key cannot be placed against it)
  const wellFormed = (z: unknown): boolean => typeof z === 'string' && z.length <= DIM_LIMITS.z && DIM_Z_PATTERN.test(z);
  const stored = items.map((it, i) => ({ it, i })).filter((x) => !x.it.fresh && wellFormed(x.it.z));
  const kept = keepers(stored.map((x) => ({ z: x.it.z, id: x.it.nodeId })));
  const keeps = new Set(stored.filter((_, n) => kept.has(n)).map((x) => x.i));
  const zOf: unknown[] = items.map((it) => it.z);
  const placed = new Map<number, string>();
  // Walk in paint order. A kept mark stays only while it still sorts above the mark before it: a key placed next to
  // equal, malformed or exhausted neighbours can land above the next kept mark, which is then placed in its turn,
  // so ONE diff always leaves the stored order equal to the order on screen.
  let last: { z: unknown; id: string } | null = null;
  items.forEach((it, i) => {
    const self = { z: it.z, id: it.nodeId };
    if (keeps.has(i) && (last === null || dimZCompare(last, self) < 0)) {
      last = self;
      return;
    }
    // an uneditable mark that is out of order stays where its key puts it
    if (!it.fresh && it.was === null) return;
    let above: unknown = null;
    for (let j = i + 1; j < items.length; j++) {
      if (keeps.has(j)) {
        above = items[j]!.z;
        break;
      }
    }
    const z = dimZPlace(last === null ? null : last.z, above);
    placed.set(i, z);
    zOf[i] = z;
    last = { z, id: it.nodeId };
  });

  const adds: Array<{ tier: number; op: DimOp }> = [];
  const updates: DimOp[] = [];
  const moves = new Map<string, { dx: number; dy: number; ids: string[] }>();
  items.forEach((it, i) => {
    if (it.fresh) {
      const { kind, ...rest } = it.now;
      adds.push({ tier: kind === 'frame' ? 0 : kind === 'arrow' ? 2 : 1, op: { type: 'add', node: { id: it.nodeId, kind, ...rest, z: zOf[i] as string } as unknown as DimNode } });
      return;
    }
    if (!it.was) return;
    const patch: Fields = {};
    for (const k of new Set([...Object.keys(it.now), ...Object.keys(it.was)])) {
      if (k === 'kind' || same(it.now[k], it.was[k])) continue;
      patch[k] = it.now[k] === undefined ? null : it.now[k];
    }
    // an emptied label of a sticky keeps its key (the key is what makes the rect a sticky)
    if (patch.label === null && it.now.kind === 'rect' && dimIsSticky(prev.nodes.get(it.nodeId)!.node)) patch.label = '';
    const z = placed.get(i);
    // Points are stored relative to (x, y), and the engine's x and y are those of the FIRST point. So for a line,
    // x, y and points travel together: a patch that names one of them restates all three in the engine's terms.
    // (A stored line whose points do not start at the origin would otherwise jump by its first point.) A pure
    // drag stays a relative move, which is right whatever the stored origin is.
    const linear = it.now.kind === 'stroke' || it.now.kind === 'arrow';
    const pureMove = z === undefined && Object.keys(patch).length > 0 && Object.keys(patch).every((k) => k === 'x' || k === 'y');
    if (linear && !pureMove && ('points' in patch || 'x' in patch || 'y' in patch)) {
      patch.x = it.now.x;
      patch.y = it.now.y;
      patch.points = it.now.points;
    }
    const keys = Object.keys(patch);
    if (z === undefined && keys.length > 0 && keys.every((k) => k === 'x' || k === 'y')) {
      const dx = (it.now.x as number) - (it.was.x as number);
      const dy = (it.now.y as number) - (it.was.y as number);
      const key = `${dx},${dy}`;
      const m = moves.get(key) ?? { dx, dy, ids: [] };
      m.ids.push(it.nodeId);
      moves.set(key, m);
      return;
    }
    if (z !== undefined) patch.z = z;
    if (Object.keys(patch).length > 0) updates.push({ type: 'update', id: it.nodeId, patch });
  });

  const ops: DimOp[] = adds.sort((a, b) => a.tier - b.tier).map((a) => a.op);
  ops.push(...updates);
  for (const m of moves.values()) for (let i = 0; i < m.ids.length; i += DIM_LIMITS.moveIds) ops.push({ type: 'move', ids: m.ids.slice(i, i + DIM_LIMITS.moveIds), dx: m.dx, dy: m.dy });
  for (const [nodeId, n] of prev.nodes) if (!seen.has(nodeId) && !mains.has(ids.engineOf(nodeId)) && drawable(n.node)) ops.push({ type: 'delete', id: nodeId });
  return ops;
}
