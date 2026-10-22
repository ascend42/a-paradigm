/**
 * @symbol #gui-loops
 *
 * #gui-loops graph layout (design-system components.loop-graph; Atelier 2026-10-22-gnomon-loops-ui board loop-detail).
 * PURE: a loop's nodes and edges, with its last loop run on them, laid out for an SVG inside the graph's own frame.
 *
 *   - Left to right when the drawing fits the frame at 100% (box 124×48, 64px between boxes, every straight label in
 *     its gap); otherwise top to bottom: the main path down a centre column (box 104–124 wide, sized to its text),
 *     terminals in a left lane, back and skip edges in a right lane with their labels beside them.
 *   - Labels sit only in the gaps between boxes or beside a lane, never on a box; 4px from the frame edge.
 *   - Outcome labels collapse: every outcome to one target is "any"; a node's longest multi-outcome label (over 12
 *     characters) when it has other targets is "else". Edges with the same target and label merge into one bus with
 *     one label. The full outcome list is the edge's title and is in the node's accessible name.
 *   - Verdicts read by mark (✓ ✕ ? … ● ·), by edge weight (the last run's path solid, the rest dashed) and by box edge
 *     (failed heavy, waiting dotted, not reached dashed). Colour is a second cue only (CSS).
 *   - A node's type line fits its box: truncated with … (a call's callee truncates first), the full text in title.
 */
import type { LoopNodeShape, LoopRun } from './loops.js';

export const BOX_H = 48;
export const BOX_W_MAX = 124;
export const BOX_W_MIN = 104;
const GAP_LTR = 64;
const GAP_TTB = 48;
const TERM_W = 64;
const TERM_H = 28;
const PAD = 8;
const LANE = 12;
/** advance widths of JetBrains Mono at 11.5px (ids) and 10.5px (labels, type lines): 0.6em */
export const CH_ID = 6.9;
export const CH_L = 6.3;
export const textW = (s: string, ch = CH_L): number => [...s].length * ch;

export type BoxCls = '' | 'fail' | 'wait' | 'never' | 'run';
export interface GBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mark: string;
  visits: number;
  ty: string;
  tyFull: string;
  cls: BoxCls;
  label: string;
}
export interface GTerm {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GEdge {
  d: string;
  taken: boolean;
  label: string;
  full: string;
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
  arrow: boolean;
}
export interface GraphLayout {
  orient: 'ltr' | 'ttb';
  w: number;
  h: number;
  boxes: GBox[];
  terms: GTerm[];
  edges: GEdge[];
}

interface Group {
  from: string;
  to: string;
  outcomes: string[];
  label: string;
  taken: boolean;
  back: boolean;
}

const isTerm = (t: string): boolean => t.startsWith('@');

/** DFS from start, first outcome first: the main path reads down (or across) in the order a pass walks it. */
export function nodeOrder(nodes: readonly LoopNodeShape[], start: string): string[] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const seen: string[] = [];
  const walk = (id: string): void => {
    if (seen.includes(id) || !by.has(id)) return;
    seen.push(id);
    for (const t of Object.values(by.get(id)!.on)) if (!isTerm(t)) walk(t);
  };
  walk(start);
  for (const n of nodes) if (!seen.includes(n.id)) walk(n.id);
  return seen;
}

/** The edges of a node, grouped by target, with the collapsed labels (any / else). */
export function edgeGroups(n: LoopNodeShape, rank: Map<string, number>, taken: ReadonlySet<string>): Group[] {
  const by = new Map<string, string[]>();
  for (const [o, t] of Object.entries(n.on)) by.set(t, [...(by.get(t) ?? []), o]);
  const gs: Group[] = [...by.entries()].map(([to, outcomes]) => ({ from: n.id, to, outcomes, label: outcomes.join(' · '), taken: taken.has(`${n.id}>${to}`), back: !isTerm(to) && (rank.get(to) ?? 0) <= (rank.get(n.id) ?? 0) }));
  if (gs.length === 1) gs[0]!.label = 'any';
  else {
    const long = gs.filter((g) => g.outcomes.length > 1 && g.label.length > 12).sort((a, b) => b.label.length - a.label.length)[0];
    if (long) long.label = 'else';
  }
  for (const g of gs) if (g.back) g.label += ' ↺';
  return gs;
}

/** Truncate to a width with …; the full text stays in title. */
export function fitText(s: string, maxW: number, ch = CH_L): string {
  if (textW(s, ch) <= maxW) return s;
  const n = Math.max(1, Math.floor(maxW / ch) - 1);
  return `${[...s].slice(0, n).join('')}…`;
}

const typeLine = (n: LoopNodeShape): string => (n.type === 'call' ? `call · ↗ ${n.callee ?? ''}` : [n.type, n.role ?? n.as].filter(Boolean).join(' · '));

export interface GraphInput {
  nodes: readonly LoopNodeShape[];
  start: string;
  run?: LoopRun;
  /** the run is still in flight (its last node's target is waiting, or running) */
  live?: boolean;
}

function runFacts(g: GraphInput): { last: Map<string, string>; visits: Map<string, number>; taken: Set<string>; waiting: string | null } {
  const last = new Map<string, string>();
  const visits = new Map<string, number>();
  const taken = new Set<string>();
  const on = new Map(g.nodes.map((n) => [n.id, n.on]));
  let waiting: string | null = null;
  for (const r of g.run?.nodes ?? []) {
    last.set(r.nodeId, r.verdict);
    visits.set(r.nodeId, (visits.get(r.nodeId) ?? 0) + 1);
    const to = r.next ?? (r.edge ? on.get(r.nodeId)?.[r.edge] : undefined);
    if (to) taken.add(`${r.nodeId}>${to}`);
  }
  const tail = g.run?.nodes[g.run.nodes.length - 1];
  if (g.live && tail) {
    const to = tail.next ?? (tail.edge ? on.get(tail.nodeId)?.[tail.edge] : undefined);
    if (to && !isTerm(to)) waiting = to;
  }
  return { last, visits, taken, waiting };
}

function makeBox(n: LoopNodeShape, x: number, y: number, w: number, f: ReturnType<typeof runFacts>, groups: Group[]): GBox {
  const v = f.last.get(n.id);
  const waiting = f.waiting === n.id;
  const mark = waiting ? '…' : v === undefined ? '·' : v === 'pass' ? '✓' : v === 'fail' || v === 'error' ? '✕' : v === 'unsure' || v === 'unavailable' ? '?' : '·';
  const cls: BoxCls = waiting ? 'wait' : v === undefined ? 'never' : mark === '✕' ? 'fail' : '';
  const visits = f.visits.get(n.id) ?? 0;
  const tyFull = typeLine(n);
  const ty = fitText(tyFull, w - 16);
  const said = waiting ? 'waiting' : v === undefined ? 'not reached in the last loop run' : `last verdict ${v}`;
  const edges = groups.map((gr) => `${gr.outcomes.join(', ')} → ${gr.to}`).join('; ');
  return { id: n.id, x, y, w, h: BOX_H, mark, visits, ty, tyFull, cls, label: `${n.id} (${tyFull}): ${said}${visits > 1 ? `, ${visits} visits` : ''}${edges ? `; ${edges}` : ''}` };
}

function boxWidth(n: LoopNodeShape, ltr: boolean): number {
  if (ltr) return BOX_W_MAX;
  const need = Math.max(textW(n.id, CH_ID) + 16 + 24 + 20, textW(typeLine(n)) + 16);
  return Math.max(BOX_W_MIN, Math.min(BOX_W_MAX, Math.ceil(need)));
}

/** Lay the graph out for a frame `frameW` wide (the drawing room inside the graph frame). */
export function layoutGraph(g: GraphInput, frameW: number): GraphLayout {
  const order = nodeOrder(g.nodes, g.start);
  const rank = new Map(order.map((id, i) => [id, i]));
  const by = new Map(g.nodes.map((n) => [n.id, n]));
  const f = runFacts(g);
  const groups = new Map(order.map((id) => [id, edgeGroups(by.get(id)!, rank, f.taken)]));
  return tryLtr(order, by, groups, f, frameW) ?? ttb(order, by, groups, f, frameW);
}

function tryLtr(order: string[], by: Map<string, LoopNodeShape>, groups: Map<string, Group[]>, f: ReturnType<typeof runFacts>, frameW: number): GraphLayout | null {
  const n = order.length;
  const W = BOX_W_MAX;
  const width = PAD * 2 + n * W + (n - 1) * GAP_LTR;
  if (width > frameW) return null;
  const all = [...groups.values()].flat();
  const rank = new Map(order.map((id, i) => [id, i]));
  const xOf = (id: string): number => PAD + (rank.get(id) ?? 0) * (W + GAP_LTR);
  // arcs above the row: interval levels, each level 22px; a straight label must fit its 64px gap
  const arcs = all.filter((e) => !isTerm(e.to) && (rank.get(e.to)! !== rank.get(e.from)! + 1));
  const straight = all.filter((e) => !isTerm(e.to) && rank.get(e.to)! === rank.get(e.from)! + 1);
  if (straight.some((e) => textW(e.label) > GAP_LTR - 8)) return null;
  const levels: Array<Array<[number, number]>> = [];
  const lvOf = new Map<Group, number>();
  for (const a of arcs.sort((p, q) => Math.abs(rank.get(p.to)! - rank.get(p.from)!) - Math.abs(rank.get(q.to)! - rank.get(q.from)!))) {
    const x1 = xOf(a.from) + W / 2;
    const x2 = xOf(a.to) + W / 2;
    const mid = (x1 + x2) / 2;
    const lw = textW(a.label) + 8;
    const span: [number, number] = [Math.min(x1, x2, mid - lw / 2), Math.max(x1, x2, mid + lw / 2)];
    let lv = 0;
    while (levels[lv]?.some(([s, e]) => !(span[1] < s || span[0] > e))) lv++;
    (levels[lv] ??= []).push(span);
    lvOf.set(a, lv);
    if (span[0] < 4 || span[1] > frameW - 4) return null;
  }
  const top = PAD + levels.length * 22 + (levels.length ? 8 : 0);
  // terminals below their source box, side by side
  const terms: GTerm[] = [];
  const edges: GEdge[] = [];
  const tCount = new Map<string, number>();
  for (const e of all.filter((x) => isTerm(x.to))) {
    const k = tCount.get(e.from) ?? 0;
    tCount.set(e.from, k + 1);
    const tx = xOf(e.from) + k * (TERM_W + 12);
    if (tx + TERM_W > (rank.get(e.from)! === order.length - 1 ? frameW - 4 : xOf(e.from) + W + GAP_LTR - 4)) return null;
    const ty = top + BOX_H + 40;
    terms.push({ id: e.to, x: tx, y: ty, w: TERM_W, h: TERM_H });
    const cx = tx + TERM_W / 2;
    edges.push({ d: `M${cx},${top + BOX_H} L${cx},${ty}`, taken: e.taken, label: e.label, full: `${e.outcomes.join(', ')} → ${e.to}`, lx: cx + 6, ly: top + BOX_H + 24, anchor: 'start', arrow: true });
  }
  const boxes = order.map((id) => makeBox(by.get(id)!, xOf(id), top, W, f, groups.get(id)!));
  const my = top + BOX_H / 2;
  for (const e of straight) {
    const x1 = xOf(e.from) + W;
    const x2 = xOf(e.to);
    edges.push({ d: `M${x1},${my} L${x2},${my}`, taken: e.taken, label: e.label, full: `${e.outcomes.join(', ')} → ${e.to}`, lx: (x1 + x2) / 2, ly: my - 6, anchor: 'middle', arrow: true });
  }
  for (const a of arcs) {
    const lv = lvOf.get(a)!;
    const x1 = xOf(a.from) + W / 2 + 10;
    const x2 = xOf(a.to) + W / 2 - 10;
    const ly = top - 8 - lv * 22;
    edges.push({ d: `M${x1},${top} C${x1},${ly - 6} ${x2},${ly - 6} ${x2},${top}`, taken: a.taken, label: a.label, full: `${a.outcomes.join(', ')} → ${a.to}`, lx: (x1 + x2) / 2, ly: ly - 2, anchor: 'middle', arrow: true });
  }
  const h = terms.length ? top + BOX_H + 40 + TERM_H + PAD : top + BOX_H + PAD;
  return { orient: 'ltr', w: width, h, boxes, terms, edges };
}

function ttb(order: string[], by: Map<string, LoopNodeShape>, groups: Map<string, Group[]>, f: ReturnType<typeof runFacts>, frameW: number): GraphLayout {
  const all = [...groups.values()].flat();
  const hasTerms = all.some((e) => isTerm(e.to));
  const W = Math.max(...order.map((id) => boxWidth(by.get(id)!, false)), BOX_W_MIN);
  const bx = hasTerms ? PAD + TERM_W + 64 : PAD;
  const rank = new Map(order.map((id, i) => [id, i]));
  const yOf = (id: string): number => PAD + 6 + (rank.get(id) ?? 0) * (BOX_H + GAP_TTB);
  const cx = bx + W / 2;
  const right = bx + W;
  const edges: GEdge[] = [];
  const terms: GTerm[] = [];
  // buses: every non-adjacent edge, plus any adjacent edge sharing a (target, label) with another edge
  const key = (e: Group): string => `${e.to}\u0000${e.label}`;
  const count = new Map<string, number>();
  for (const e of all) if (!isTerm(e.to)) count.set(key(e), (count.get(key(e)) ?? 0) + 1);
  const adjacent = (e: Group): boolean => rank.get(e.to)! === rank.get(e.from)! + 1;
  const busEdges = all.filter((e) => !isTerm(e.to) && (!adjacent(e) || (count.get(key(e)) ?? 0) > 1));
  const straight = all.filter((e) => !isTerm(e.to) && !busEdges.includes(e));
  const buses = new Map<string, Group[]>();
  for (const e of busEdges) buses.set(key(e), [...(buses.get(key(e)) ?? []), e]);
  // lanes: interval colouring on the y spans (out at box.y+16, in at box.y+32)
  const lanes: Array<Array<[number, number]>> = [];
  const placed: Array<{ gs: Group[]; lane: number; y1: number; y2: number; ty: number }> = [];
  for (const gs of [...buses.values()].sort((a, b) => Math.min(...a.map((e) => yOf(e.from))) - Math.min(...b.map((e) => yOf(e.from))))) {
    const ty = yOf(gs[0]!.to) + 32;
    const ys = [...gs.map((e) => yOf(e.from) + 16), ty];
    const y1 = Math.min(...ys);
    const y2 = Math.max(...ys);
    let lane = 0;
    while (lanes[lane]?.some(([s, e]) => !(y2 < s - 4 || y1 > e + 4))) lane++;
    (lanes[lane] ??= []).push([y1, y2]);
    placed.push({ gs, lane, y1, y2, ty });
  }
  const laneX = (l: number): number => right + 14 + l * LANE;
  let maxX = right + PAD;
  const labelSlots: Array<[number, number]> = [];
  for (const p of placed) {
    const lx = laneX(p.lane);
    const taken = p.gs.some((e) => e.taken);
    const parts: string[] = [];
    for (const e of p.gs) parts.push(`M${right},${yOf(e.from) + 16} H${lx}`);
    parts.push(`M${lx},${p.y1} V${p.y2}`);
    // the arrow: one stub into the target
    edges.push({ d: parts.join(' '), taken, label: '', full: '', lx: 0, ly: 0, anchor: 'start', arrow: false });
    // the label beside the outermost lane that crosses its y, never on a box, pushed down past an earlier label
    let ly = Math.round((p.y1 + p.y2) / 2) + 4;
    while (labelSlots.some(([a, b]) => ly > a - 2 && ly - 11 < b + 2)) ly += 14;
    labelSlots.push([ly - 11, ly]);
    const outer = Math.max(lx, ...placed.filter((q) => q.y1 <= ly && q.y2 >= ly - 11).map((q) => laneX(q.lane)));
    const label = p.gs[0]!.label;
    const lxl = outer + 4;
    maxX = Math.max(maxX, lxl + textW(label) + 4, lx + PAD);
    edges.push({ d: `M${lx},${p.ty} H${right}`, taken, label, full: p.gs.map((e) => `${e.from}: ${e.outcomes.join(', ')} → ${e.to}`).join('; '), lx: lxl, ly, anchor: 'start', arrow: true });
  }
  const firstLane = placed.length ? laneX(0) : frameW;
  for (const e of straight) {
    const y1 = yOf(e.from) + BOX_H;
    const y2 = yOf(e.to);
    const w = textW(e.label);
    const rightFits = cx + 6 + w <= Math.min(firstLane - 4, Math.max(frameW, maxX) - 4);
    edges.push({ d: `M${cx},${y1} L${cx},${y2}`, taken: e.taken, label: e.label, full: `${e.outcomes.join(', ')} → ${e.to}`, lx: rightFits ? cx + 6 : cx - 6, ly: Math.round((y1 + y2) / 2) + 4, anchor: rightFits ? 'start' : 'end', arrow: true });
  }
  const tCount = new Map<string, number>();
  for (const e of all.filter((x) => isTerm(x.to))) {
    const k = tCount.get(e.from) ?? 0;
    tCount.set(e.from, k + 1);
    const ty = yOf(e.from) - 6 + k * 34;
    terms.push({ id: e.to, x: PAD, y: ty, w: TERM_W, h: TERM_H });
    const ey = ty + TERM_H / 2;
    edges.push({ d: `M${bx},${ey} L${PAD + TERM_W},${ey}`, taken: e.taken, label: fitText(e.label, 64 - 8), full: `${e.outcomes.join(', ')} → ${e.to}`, lx: PAD + TERM_W + 32, ly: ey - 4, anchor: 'middle', arrow: true });
  }
  const boxes = order.map((id) => makeBox(by.get(id)!, bx, yOf(id), W, f, groups.get(id)!));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h), ...terms.map((t) => t.y + t.h), ...edges.map((e) => e.ly)) + PAD;
  return { orient: 'ttb', w: Math.ceil(Math.max(maxX, right + PAD)), h: Math.ceil(bottom), boxes, terms, edges };
}

/** The zoom the graph shows at: fit (null) never scales above 100%, and scales below only when the drawing is wider. */
export function graphScale(zoom: number | null, layoutW: number, frameW: number): number {
  if (zoom === null) return Math.min(1, frameW / Math.max(1, layoutW));
  return Math.max(0.25, Math.min(2, zoom));
}
export const ZOOM_STEP = 1.25;
