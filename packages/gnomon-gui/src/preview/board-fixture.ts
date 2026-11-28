/**
 * @symbol #gui-preview
 *
 * DEV ONLY: the board fixture's dimension (boards S1.3 pass P3b). The marks are ROWS of `dim-shape:v1`, stamped
 * as the host stamps them, and folded by `foldDim`: whose hand a mark is in comes from the fold's `by` and from
 * nowhere else. `apply` is the fixture's stand-in for the live loop (a board edit becomes one more row of yours).
 * Sets: `sample` (the leaf goldens), `matrix` (every kind and style per hand, the G-DDL-07 board goldens), `many`
 * (64 marks, for the live loop's 64-clone paste), `empty`.
 */
import { DIM_KINDS, foldDim, type DimOp, type DimRow, type DimState } from '@a-company/gnomon-contracts';

export const FIXTURE_DIM = 'dim:01JF1XTVRE000000000000000D';
const HUMAN = { principal: 'p:preview/matt', connId: 'conn:preview', surface: 'gui' };
const agent = (id: string, hsid?: string): Record<string, unknown> => ({ principal: `p:preview/${id}`, connId: 'conn:preview', surface: 'bridge', agent: id, ...(hsid ? { hsid } : {}) });
/** null: a row with no host stamp, which folds as the unknown hand */
export type FixtureHand = 'you' | 'arky' | 'luna' | 'quill' | null;
const stampOf = (hand: FixtureHand, hsid?: string): Record<string, unknown> => (hand === null ? {} : { relayedFor: hand === 'you' ? HUMAN : agent(hand, hsid) });

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A fixed, well-formed node id for the n-th fixture mark. */
export const fixtureId = (n: number): string => `01JF1XTVRE0000000000000${B32[Math.floor(n / 1024) % 32]}${B32[Math.floor(n / 32) % 32]}${B32[n % 32]}`;
const Z = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** An order key for the n-th mark (ascending). */
export const fixtureZ = (n: number): string => `${Z[Math.floor(n / Z.length)]}${Z[n % Z.length]}`;

type Mark = Record<string, unknown> & { kind: string; x: number; y: number };
/** `hsid` (S1.4 P4b): the session an agent hand's rows are stamped with (the foot names a keyed hand by it) */
interface Group { hand: FixtureHand; marks: Mark[]; hsid?: string }

/** The sample's frame is its first mark: the marks drawn inside it say so, as the board would store them. */
const IN = { parent: fixtureId(0) };
const SAMPLE: Group[] = [
  { hand: 'you', marks: [
    { kind: 'frame', x: 24, y: 28, w: 330, h: 262, title: 'auth handoff' },
    { kind: 'rect', x: 44, y: 56, w: 132, h: 76, fill: 'lemon', label: 'token expires\nbefore the retry', ...IN },
    { kind: 'rect', x: 212, y: 56, w: 120, h: 60, color: 'cobalt', fill: 'sky', label: 'broker', ...IN },
    { kind: 'arrow', x: 258, y: 120, points: [0, 0, 14, 44], color: 'raspberry', weight: 2, ...IN },
  ] },
  { hand: 'arky', marks: [
    { kind: 'ellipse', x: 212, y: 168, w: 120, h: 64, color: 'leaf', fill: 'leaf', label: 'kernel', ...IN },
    { kind: 'arrow', x: 180, y: 92, points: [0, 0, 28, 0], color: 'graphite', ...IN },
  ] },
  { hand: 'luna', marks: [{ kind: 'rect', x: 44, y: 160, w: 132, h: 60, fill: 'orchid', label: 'who signs\nthe second hop?', ...IN }] },
  { hand: 'quill', marks: [{ kind: 'text', x: 48, y: 250, text: 'checked against the log', ...IN }] },
  { hand: null, marks: [{ kind: 'rect', x: 212, y: 246, w: 120, h: 30, ...IN }] },
  { hand: 'you', marks: [{ kind: 'live:session', x: 380, y: 56 }] },
  { hand: 'arky', marks: [{ kind: 'allow:approved-by-you', x: 380, y: 136 }] },
];

/** A short freehand stroke (a tick), as flat points from its first point. */
const TICK = [0, 0, 6, 9, 13, 15, 22, 12, 34, -2, 46, -18, 58, -30];
/**
 * Every kind and style, once per hand, in three columns (you, an agent, the unknown hand): stroke, rect, filled
 * rect, sticky, ellipse, diamond, filled diamond, the three arrow heads, a labelled right-to-left arrow, text, a
 * frame, a bold and a marker weight, a rotated rect, and a fallback.
 */
function matrix(): Group[] {
  const column = (dx: number): Mark[] => [
    { kind: 'frame', x: dx + 8, y: 16, w: 392, h: 96, title: 'frame' },
    { kind: 'stroke', x: dx + 24, y: 70, points: TICK },
    { kind: 'stroke', x: dx + 100, y: 70, points: TICK, weight: 2, color: 'cobalt' },
    { kind: 'stroke', x: dx + 176, y: 70, points: TICK, weight: 3, color: 'raspberry' },
    { kind: 'text', x: dx + 260, y: 52, text: 'plain text' },
    { kind: 'rect', x: dx + 16, y: 136, w: 84, h: 52 },
    { kind: 'rect', x: dx + 116, y: 136, w: 84, h: 52, color: 'cobalt', fill: 'sky' },
    { kind: 'rect', x: dx + 216, y: 136, w: 84, h: 52, fill: 'lemon', label: 'sticky' },
    { kind: 'rect', x: dx + 316, y: 136, w: 84, h: 52, weight: 2, rot: 150 },
    { kind: 'ellipse', x: dx + 16, y: 212, w: 84, h: 52 },
    { kind: 'ellipse', x: dx + 116, y: 212, w: 84, h: 52, color: 'leaf', fill: 'leaf', label: 'label' },
    { kind: 'diamond', x: dx + 216, y: 208, w: 84, h: 60 },
    { kind: 'diamond', x: dx + 316, y: 208, w: 84, h: 60, color: 'tangerine', fill: 'orchid', label: 'if' },
    { kind: 'arrow', x: dx + 16, y: 300, points: [0, 0, 84, 0], head: 'none' },
    { kind: 'arrow', x: dx + 116, y: 300, points: [0, 0, 84, 0] },
    { kind: 'arrow', x: dx + 216, y: 300, points: [0, 0, 84, 0], head: 'both', weight: 2 },
    // right to left: its points run left of its first point
    { kind: 'arrow', x: dx + 400, y: 300, points: [0, 0, -84, 0], color: 'graphite', label: 'back' },
    { kind: 'arrow', x: dx + 16, y: 336, points: [0, 0, 40, 28, 84, 0], color: 'raspberry' },
    { kind: 'live:session', x: dx + 112, y: 328 },
  ];
  return [{ hand: 'you', marks: column(0) }, { hand: 'arky', marks: column(424) }, { hand: null, marks: column(848) }];
}

/** 64 labelled rects of yours in an 8 by 8 grid: a copy of all of them is the most a paste may add, and too much for one row. */
function many(): Group[] {
  const marks: Mark[] = [];
  for (let i = 0; i < 64; i++) marks.push({ kind: 'rect', x: 24 + (i % 8) * 50, y: 24 + Math.floor(i / 8) * 34, w: 40, h: 24, label: `${i} ${'board mark '.repeat(17)}`.slice(0, 190) });
  return [{ hand: 'you', marks }];
}

export const FIXTURE_SETS: Readonly<Record<string, () => Group[]>> = { sample: () => SAMPLE, matrix, many, empty: () => [] };

export interface BoardFixture {
  rows: DimRow[];
  state(): DimState;
  /** Append ops as one row of yours (or of `hand`); returns the new fold. */
  apply(ops: readonly DimOp[], hand?: FixtureHand): DimState;
  /** Every edit the board reported, in order (tests read it). */
  edits: Array<{ ops: DimOp[]; cause: string | null }>;
  undoKeys: string[];
  /** true: reported edits are recorded and NOT rendered back (a test then renders by hand) */
  held: boolean;
}

export type FixtureGroup = Group;
/** The fold of ad hoc groups (a test builds one mark per hand with it). */
export const fixtureState = (groups: Group[]): DimState => foldDim(rowsOf(groups));

export function fixtureRows(set: string): DimRow[] {
  return rowsOf((FIXTURE_SETS[set] ?? FIXTURE_SETS.sample!)());
}
function rowsOf(groups: Group[]): DimRow[] {
  const rows: DimRow[] = [{ seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: FIXTURE_DIM, title: 'auth handoff', attached: ['hsid-preview'], opened: 'command', relayedFor: HUMAN } }];
  let n = 0;
  for (const g of groups) {
    const ops = g.marks.map((m) => ({ type: 'add', node: { id: fixtureId(n), z: fixtureZ(n++), ...m } }));
    rows.push({ seq: rows.length + 1, kind: DIM_KINDS.op, payload: { v: 1, dim: FIXTURE_DIM, ops, ...stampOf(g.hand, g.hsid) } });
  }
  return rows;
}

export function boardFixture(set: string): BoardFixture {
  const rows = fixtureRows(set);
  const fx: BoardFixture = {
    rows,
    state: () => foldDim(rows),
    apply(ops, hand = 'you') {
      rows.push({ seq: rows.length + 1, kind: DIM_KINDS.op, payload: { v: 1, dim: FIXTURE_DIM, ops: [...ops], ...stampOf(hand) } });
      return foldDim(rows);
    },
    edits: [],
    undoKeys: [],
    held: false,
  };
  return fx;
}
