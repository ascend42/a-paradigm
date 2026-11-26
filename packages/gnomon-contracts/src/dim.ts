/**
 * @symbol #contract-dim-shape
 *
 * `dim-shape:v1`: the dimension vocabulary, a tolerant pure fold and a strict write validator (S1.2, spec §12.7).
 *
 * A dimension is the space; mediums (board, doodle, later ones) display things inside it. Its truth is a list of
 * op rows in the kernel log, appended by the dimension mod. Two rules shape this file:
 *
 *  - READS ARE TOLERANT. Rows are permanent, so `foldDimRow` never refuses and never throws: unknown kinds and
 *    unknown fields are carried and hashed; op types v1 does not know leave the state unchanged and are counted.
 *  - WRITES ARE CLOSED. `validateDimOps` refuses by name an unknown kind, an unknown field, an out-of-range
 *    value, a colour that fails the palette check, a ref outside the allowlist, an edit of another hand's node
 *    by an agent, and any text that matches a secret rule (op rows cannot be deleted later).
 *
 * `by` (who drew a node) is derived by the fold from the HOST-WRITTEN `payload.relayedFor` of the row that added
 * it. It is never stored on a node and never an op input. A row with no well-formed `relayedFor` folds as
 * `cls: 'unknown'`, never as human (Aegis ruling 5).
 *
 * IMPORTS: only `./internal.js`, `./content-palette.js` and `./secret-rules.js` (a test holds this), so the file
 * can be bundled into the mod tree. Pure functions, no DOM, no node:*.
 */
import { canonicalJson, deepFreeze, isPlainObject, sha256Tagged } from './internal.js';
import { contentColourCheck, contentContrastFix, contentPairCheck, type ContentColourCheck, type ContentContrastWhy, type ContentRole } from './content-palette.js';
import { secretKindsIn } from './secret-rules.js';

export const DIM_SHAPE_V1 = 'dim-shape:v1' as const;
/** events: `modns.gnomon.dimension.*` */
export const DIM_MOD_ID = 'gnomon.dimension' as const;
export const DIM_KINDS = Object.freeze({
  start: 'modns.gnomon.dimension.session.start',
  attach: 'modns.gnomon.dimension.attach',
  op: 'modns.gnomon.dimension.op',
  end: 'modns.gnomon.dimension.session.end',
} as const);
/** The row version this file writes. A higher `v` is folded by the v1 rules for the op types v1 knows. */
export const DIM_ROW_VERSION = 1 as const;

/** Closed core list (in clientApiId). Later kinds are namespaced, so they never move the id. */
export const DIM_CORE_KINDS = ['stroke', 'rect', 'ellipse', 'diamond', 'arrow', 'text', 'frame'] as const;
export type DimCoreKind = (typeof DIM_CORE_KINDS)[number];
/** Grammar: a core kind, or `<ns>:<kind>`. */
export const DIM_KIND_PATTERN = /^(?:[a-z][a-z0-9-]{0,23}:)?[a-z][a-z0-9-]{0,31}$/;
/** client-minted ULID (the same grammar as ids.ts, restated here because this file imports nothing from it) */
export const DIM_NODE_ID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** equals `ID_PATTERNS.dim` (a test holds this) */
export const DIM_ID_PATTERN = /^dim:[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** order key: base 62 over `0-9A-Za-z`, never ending in `0` */
export const DIM_Z_PATTERN = /^[0-9A-Za-z]{0,63}[1-9A-Za-z]$/;
export const DIM_REL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export const DIM_LIMITS = Object.freeze({
  opsPerRow: 64,
  coord: 1_000_000_000,
  size: 1_000_000_000,
  text: 4000,
  label: 200,
  title: 120,
  points: 4096,
  moveIds: 64,
  refs: 8,
  ref: 128,
  z: 64,
});

/**
 * Bounds on the work of the write validator's secret scan. NOT part of `DIM_LIMITS` and not an input of the client
 * API descriptor: they bound what one call may cost, they do not change what a valid row may hold.
 *  - `freeStringsPerNode`: a node with more free strings than this is read as ONE joined text; the ordered-pair
 *    read is skipped. A valid core node has at most 10 free strings (an arrow: `label`, `rel` and 8 `refs`), so
 *    only a node with unknown fields or too many refs is over it: an add or update that makes one is refused by
 *    the field checks, and a stored one (a hostile or later-version row) is read once, not pair by pair.
 *  - `stringsPerBatch`: the strings one batch may carry, counted from the same roots and to the same depth as the
 *    scan reads them (an add's `node`, an update's `patch`, else the op itself with its `type` left out). The
 *    largest valid batch (64 moves of 64 ids each) holds exactly this many; a batch over it is refused whole,
 *    `field-range` on `ops`, before anything is scanned.
 * Both bound the NUMBER of strings and of reads. Neither bounds a string's LENGTH: this contract has no byte bound
 * on an op or a batch (a `text` is refused over DIM_LIMITS.text only after it was scanned, and an unknown field
 * has no limit at all), so one call still costs time linear in the bytes it is given. The byte bound lives in the
 * caller: the dimension mod refuses ops over 16 KiB, 4,096 values or depth 32 before it calls the validator.
 */
export const DIM_SCAN_LIMITS = Object.freeze({ freeStringsPerNode: 16, stringsPerBatch: 4096 });

interface DimNodeBase {
  /** DIM_NODE_ID_PATTERN */
  id: string;
  kind: DimCoreKind;
  /** integer board units, y-down, |v| <= DIM_LIMITS.coord */
  x: number;
  y: number;
  /** order key, DIM_Z_PATTERN */
  z: string;
  /** integer tenths of a degree, 0..3599 */
  rot?: number;
  /** content-palette token, line role */
  color?: string;
  weight?: 1 | 2 | 3;
  /** id of a live `frame` node */
  parent?: string;
  refs?: string[];
}
export type DimNode =
  /** `points`: flat [x0,y0,x1,y1,…], integers relative to (x,y) */
  | (DimNodeBase & { kind: 'stroke'; points: number[] })
  | (DimNodeBase & { kind: 'rect' | 'ellipse' | 'diamond'; w: number; h: number; fill?: string; label?: string })
  | (DimNodeBase & { kind: 'arrow'; points: number[]; head?: 'none' | 'end' | 'both'; from?: string; to?: string; rel?: string; label?: string })
  | (DimNodeBase & { kind: 'text'; text: string; size?: 1 | 2 | 3 | 4; w?: number })
  | (DimNodeBase & { kind: 'frame'; w: number; h: number; title?: string });

const BASE_KEYS = ['id', 'kind', 'x', 'y', 'z', 'rot', 'color', 'weight', 'parent', 'refs'] as const;
const SHAPE_KEYS = [...BASE_KEYS, 'w', 'h', 'fill', 'label'] as const;
/** Closed key list per kind, used by the WRITE validator and by `dimViewOf`. */
export const DIM_NODE_KEYS: Readonly<Record<DimCoreKind, readonly string[]>> = deepFreeze({
  stroke: [...BASE_KEYS, 'points'],
  rect: [...SHAPE_KEYS],
  ellipse: [...SHAPE_KEYS],
  diamond: [...SHAPE_KEYS],
  arrow: [...BASE_KEYS, 'points', 'head', 'from', 'to', 'rel', 'label'],
  text: [...BASE_KEYS, 'text', 'size', 'w'],
  frame: [...BASE_KEYS, 'w', 'h', 'title'],
});
/** The keys an `add` must carry, per kind. Every other key of DIM_NODE_KEYS is optional (a `null` patch removes it). */
export const DIM_NODE_REQUIRED: Readonly<Record<DimCoreKind, readonly string[]>> = deepFreeze({
  stroke: ['id', 'kind', 'x', 'y', 'z', 'points'],
  rect: ['id', 'kind', 'x', 'y', 'z', 'w', 'h'],
  ellipse: ['id', 'kind', 'x', 'y', 'z', 'w', 'h'],
  diamond: ['id', 'kind', 'x', 'y', 'z', 'w', 'h'],
  arrow: ['id', 'kind', 'x', 'y', 'z', 'points'],
  text: ['id', 'kind', 'x', 'y', 'z', 'text'],
  frame: ['id', 'kind', 'x', 'y', 'z', 'w', 'h'],
});

export const DIM_OP_TYPES = ['add', 'update', 'move', 'delete', 'lock', 'unlock', 'clear'] as const;
export const DIM_WRITABLE_OP_TYPES = ['add', 'update', 'move', 'delete'] as const;
export const DIM_OP_KEYS: Readonly<Record<(typeof DIM_WRITABLE_OP_TYPES)[number], readonly string[]>> = deepFreeze({
  add: ['type', 'node'],
  update: ['type', 'id', 'patch'],
  move: ['type', 'ids', 'dx', 'dy'],
  delete: ['type', 'id'],
});
export type DimOp =
  | { type: 'add'; node: DimNode }
  /** `null` removes an optional field; `id` and `kind` are immutable */
  | { type: 'update'; id: string; patch: Record<string, unknown> }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'delete'; id: string }
  /** in the vocabulary, refused in S1 */
  | { type: 'lock' | 'unlock'; ids: string[] }
  | { type: 'clear'; scope: 'mine' | 'agents' | 'all' };

export const DIM_SURFACES = ['gui', 'cli', 'bridge', 'voice'] as const;
export const DIM_OPENED = ['command', 'menu', 'offer'] as const;

/** HOST-WRITTEN. The mod never builds it; a mod-supplied value is overwritten or removed by the host. */
export interface DimRowRelayedFor {
  principal: string;
  /** client relays only */
  connId?: string;
  surface: (typeof DIM_SURFACES)[number];
  /** tool calls only; present means an agent mark */
  agent?: string;
  /** tool calls only, when the mod is entitled */
  hsid?: string;
  turn?: string;
}
export interface DimOpRowPayload {
  v: 1;
  dim: string;
  ops: DimOp[];
  relayedFor: DimRowRelayedFor;
}
export interface DimSessionStartPayload {
  v: 1;
  dim: string;
  title: string;
  /** exactly one hsid in S1 */
  attached: [string];
  opened: (typeof DIM_OPENED)[number];
  relayedFor: DimRowRelayedFor;
}
export interface DimAttachPayload {
  v: 1;
  dim: string;
  hsid: string;
  relayedFor: DimRowRelayedFor;
}
export interface DimSessionEndPayload {
  v: 1;
  dim: string;
  ops: number;
  nodes: number;
  relayedFor?: DimRowRelayedFor;
}

/* ── refs (their own allowlist; never resolved, never a link in S1) ───────── */

export const DIM_REF_SCHEMES = ['sym', 'spec', 'td', 'l', 't', 'n', 's', 'wl', 'knot', 'dim'] as const;
export const DIM_REF_PATTERN = /^(sym|spec|td|l|t|n|s|wl|knot|dim):[A-Za-z0-9#$^!~][A-Za-z0-9._/#$^!~-]*(@[A-Za-z0-9][A-Za-z0-9._:-]{0,31})?$/;

export const DIM_REFUSAL_CODES = [
  'op-unknown', 'op-not-available', 'too-many-ops', 'kind-unknown', 'kind-not-core',
  'field-unknown', 'field-missing', 'field-type', 'field-range', 'id-bad', 'id-exists', 'id-missing', 'not-owner',
  'z-bad', 'colour-bad', 'ref-bad', 'ref-scheme', 'ref-too-long', 'ref-count', 'link-missing', 'parent-bad', 'secret',
] as const;
export type DimRefusalCode = (typeof DIM_REFUSAL_CODES)[number];

/** `null` means the ref may be stored. A ref is a plain string here: it is never parsed further or resolved. */
export function validateDimRef(v: unknown): DimRefusalCode | null {
  if (typeof v !== 'string') return 'ref-bad';
  if (v.length > DIM_LIMITS.ref) return 'ref-too-long';
  const scheme = /^([a-z][a-z0-9-]*):/.exec(v);
  if (!scheme) return 'ref-bad';
  if (!(DIM_REF_SCHEMES as readonly string[]).includes(scheme[1]!)) return 'ref-scheme';
  if (!DIM_REF_PATTERN.test(v) || v.includes('..') || v.includes('//')) return 'ref-bad';
  return null;
}

/* ── the tolerant fold ────────────────────────────────────────────────────── */

export interface DimRow {
  seq: number;
  kind: string;
  payload: unknown;
  causes?: readonly string[];
}
export const DIM_BY_CLASSES = ['human', 'agent', 'unknown'] as const;
/** Who drew a node. `unknown`: the row carried no well-formed host stamp, so no hand is vouched for. */
export interface DimBy {
  cls: (typeof DIM_BY_CLASSES)[number];
  principal: string;
  agent?: string;
}
export interface DimFoldNode {
  node: Record<string, unknown>;
  by: DimBy;
  hsid: string | null;
  addedSeq: number;
}
export interface DimState {
  dim: string | null;
  title: string;
  attached: readonly string[];
  ended: boolean;
  nodes: ReadonlyMap<string, DimFoldNode>;
  gone: ReadonlySet<string>;
  seq: number;
  /** ops applied */
  ops: number;
  /** rows and ops this fold could not apply (malformed, or a type v1 does not know) */
  unapplied: number;
}
interface Draft {
  dim: string | null;
  title: string;
  attached: string[];
  ended: boolean;
  nodes: Map<string, DimFoldNode>;
  gone: Set<string>;
  seq: number;
  ops: number;
  unapplied: number;
}

const UNKNOWN_BY: DimBy = Object.freeze({ cls: 'unknown', principal: 'unknown' });
const DROPPED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const COPY_DEPTH = 32;

/** A JSON copy that drops `__proto__`, `constructor` and `prototype` keys at any depth. Never throws. */
function copyJson(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (depth >= COPY_DEPTH) return null;
  if (Array.isArray(v)) return v.map((x) => copyJson(x, depth + 1));
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      if (DROPPED_KEYS.has(k)) continue;
      const x = v[k];
      if (x === undefined || typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint') continue;
      out[k] = copyJson(x, depth + 1);
    }
    return out;
  }
  return null;
}

/** An empty state. Pass `dim` to fold one dimension out of a log that holds several; else the first start row names it. */
export function emptyDimState(dim: string | null = null): DimState {
  return { dim, title: '', attached: [], ended: false, nodes: new Map(), gone: new Set(), seq: 0, ops: 0, unapplied: 0 };
}

function draftOf(s: DimState): Draft {
  return { dim: s.dim, title: s.title, attached: [...s.attached], ended: s.ended, nodes: new Map(s.nodes), gone: new Set(s.gone), seq: s.seq, ops: s.ops, unapplied: s.unapplied };
}

const NON_EMPTY = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
/** An OWN property, or undefined: nothing here is ever read through a prototype. */
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** `by` from the host stamp, or the unknown hand when the stamp is missing or malformed. */
function byOf(payload: Record<string, unknown>): DimBy {
  // own keys only (Aegis S1.2 A2): a stamp is never read through a prototype
  const r = own(payload, 'relayedFor');
  if (!isPlainObject(r)) return UNKNOWN_BY;
  const principal = own(r, 'principal');
  const surface = own(r, 'surface');
  const agent = own(r, 'agent');
  if (!NON_EMPTY(principal) || !(DIM_SURFACES as readonly unknown[]).includes(surface)) return UNKNOWN_BY;
  // a tool surface always names its agent: a bridge or voice stamp without one vouches for nobody (never human)
  if (agent === undefined) return surface === 'gui' || surface === 'cli' ? { cls: 'human', principal } : UNKNOWN_BY;
  if (!NON_EMPTY(agent)) return UNKNOWN_BY;
  return { cls: 'agent', principal, agent };
}

function hsidOf(attached: readonly string[], payload: unknown): string | null {
  const r = isPlainObject(payload) ? own(payload, 'relayedFor') : undefined;
  const h = isPlainObject(r) ? own(r, 'hsid') : undefined;
  if (NON_EMPTY(h)) return h;
  return attached.length === 1 ? attached[0]! : null;
}

/** The session a row belongs to: the host-stamped `hsid` of a tool row, else the single attached session. */
export function dimHsidOf(state: DimState, row: DimRow): string | null {
  return hsidOf(state.attached, row.payload);
}

/** Apply one op to the draft by the tolerant rules. Returns false when nothing was applied. */
function applyOp(d: Draft, op: unknown, by: DimBy, hsid: string | null, seq: number): boolean {
  if (!isPlainObject(op)) return false;
  switch (op.type) {
    case 'add': {
      const node = op.node;
      if (!isPlainObject(node) || typeof node.id !== 'string' || d.nodes.has(node.id) || d.gone.has(node.id)) return false;
      d.nodes.set(node.id, { node: copyJson(node) as Record<string, unknown>, by, hsid, addedSeq: seq });
      return true;
    }
    case 'update': {
      const cur = typeof op.id === 'string' ? d.nodes.get(op.id) : undefined;
      if (!cur || !isPlainObject(op.patch)) return false;
      const node = { ...cur.node };
      for (const k of Object.keys(op.patch)) {
        if (k === 'id' || k === 'kind' || DROPPED_KEYS.has(k)) continue;
        const v = op.patch[k];
        if (v === null) delete node[k];
        else if (v !== undefined) node[k] = copyJson(v);
      }
      d.nodes.set(op.id as string, { ...cur, node });
      return true;
    }
    case 'move': {
      if (!Array.isArray(op.ids) || !Number.isSafeInteger(op.dx) || !Number.isSafeInteger(op.dy)) return false;
      let moved = false;
      for (const id of op.ids) {
        const cur = typeof id === 'string' ? d.nodes.get(id) : undefined;
        if (!cur || typeof cur.node.x !== 'number' || typeof cur.node.y !== 'number') continue;
        d.nodes.set(id as string, { ...cur, node: { ...cur.node, x: cur.node.x + (op.dx as number), y: cur.node.y + (op.dy as number) } });
        moved = true;
      }
      return moved;
    }
    case 'delete': {
      if (typeof op.id !== 'string' || !d.nodes.has(op.id)) return false;
      d.nodes.delete(op.id);
      d.gone.add(op.id);
      return true;
    }
    default:
      // lock, unlock, clear and any later type: their meaning arrives with a higher row version
      return false;
  }
}

function applyRow(d: Draft, row: DimRow): void {
  if (!row || typeof row.kind !== 'string') return;
  const k = row.kind;
  if (k !== DIM_KINDS.start && k !== DIM_KINDS.attach && k !== DIM_KINDS.op && k !== DIM_KINDS.end) return;
  const p = row.payload;
  if (!isPlainObject(p) || !Number.isSafeInteger(p.v) || (p.v as number) < 1 || typeof p.dim !== 'string') {
    d.unapplied += 1;
    return;
  }
  if (d.dim === null) {
    if (k !== DIM_KINDS.start) return;
    d.dim = p.dim;
  } else if (p.dim !== d.dim) return;
  if (Number.isSafeInteger(row.seq)) d.seq = row.seq;
  if (k === DIM_KINDS.start) {
    // the first start names the dimension; a later one re-opens it (a dimension outlives its session)
    if (d.title === '' && typeof p.title === 'string') d.title = p.title;
    if (Array.isArray(p.attached)) for (const h of p.attached) if (NON_EMPTY(h) && !d.attached.includes(h)) d.attached.push(h);
    d.ended = false;
    return;
  }
  if (k === DIM_KINDS.attach) {
    if (NON_EMPTY(p.hsid)) {
      if (!d.attached.includes(p.hsid)) d.attached.push(p.hsid);
    } else d.unapplied += 1;
    return;
  }
  if (k === DIM_KINDS.end) {
    d.ended = true;
    return;
  }
  if (!Array.isArray(p.ops)) {
    d.unapplied += 1;
    return;
  }
  const by = byOf(p);
  const hsid = hsidOf(d.attached, p);
  for (const op of p.ops) {
    if (applyOp(d, op, by, hsid, d.seq)) d.ops += 1;
    else d.unapplied += 1;
  }
}

/**
 * Fold one row. Pure: the input state is not changed. Never throws.
 *
 * COST: each call copies the whole state (the `nodes` Map and the `gone` Set) before it applies the row, so one
 * call is O(nodes on the board) and folding n rows one call at a time is O(n²) entry copies (n add rows copy
 * n(n-1)/2 entries; test/dim-fold-cost.test.ts counts them). Use it for ONE new row on a live state. To replay or
 * scrub a range, call `foldDim(rows, upToSeq, from)` from a kept state instead: it copies `from` once and then
 * applies every row to that one draft, which is linear in the rows. A scrubber keeps a state every so many rows
 * and folds forward from the nearest one; it never reduces over `foldDimRow`.
 */
export function foldDimRow(state: DimState, row: DimRow): DimState {
  const d = draftOf(state);
  try {
    applyRow(d, row);
  } catch {
    return { ...state, unapplied: state.unapplied + 1 };
  }
  return d;
}

/**
 * Fold rows in order, optionally stopping after `upToSeq`. `from` continues an earlier fold (chunked replay).
 * One copy of `from`, then one pass over the rows: the linear way to replay or scrub (see `foldDimRow` for the cost
 * of going row by row).
 */
export function foldDim(rows: Iterable<DimRow>, upToSeq?: number, from: DimState = emptyDimState()): DimState {
  const d = draftOf(from);
  for (const row of rows) {
    if (upToSeq !== undefined && row && typeof row.seq === 'number' && row.seq > upToSeq) break;
    try {
      applyRow(d, row);
    } catch {
      d.unapplied += 1;
    }
  }
  return d;
}

/**
 * The hash input. `node` carries every field, known and carried through. `by` sits beside it, so a carried
 * field named `by` cannot collide. Left out: seq, addedSeq, connId, surface, hsid, attached, gone and the
 * counters, so the same ops replayed at other seqs hash the same. Strings are hashed as stored.
 */
export function dimCanonical(state: DimState): string {
  const nodes = [...state.nodes.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, n]) => ({ by: { cls: n.by.cls, principal: n.by.principal, ...(n.by.agent !== undefined ? { agent: n.by.agent } : {}) }, node: n.node }));
  return canonicalJson({ schema: DIM_SHAPE_V1, dim: state.dim, title: state.title, nodes });
}

/** `sha256:` + hex of `dimCanonical(state)`. */
export function dimHash(state: DimState): string {
  return sha256Tagged(dimCanonical(state));
}

/* ── z order ──────────────────────────────────────────────────────────────── */

const Z_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function zMid(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + zMid(a.slice(n), b.slice(n));
  }
  const da = a ? Z_DIGITS.indexOf(a[0]!) : 0;
  const db = b !== null ? Z_DIGITS.indexOf(b[0]!) : Z_DIGITS.length;
  if (db - da > 1) return Z_DIGITS[(da + db) >> 1]!;
  if (b !== null && b.length > 1) return b[0]!;
  return Z_DIGITS[da]! + zMid(a.slice(1), null);
}

const Z_BASE = 'V';
const Z_UPPER = Z_DIGITS.indexOf(Z_BASE); // heads from here up count upward
/** Digits after the head of an open-end key: the further the head is from the middle, the more digits it carries. */
const zTail = (head: number): number => (head >= Z_UPPER ? head - Z_UPPER : Z_UPPER - 1 - head);

/** The next open-end key above `a`: its counter part plus one. Growth is logarithmic in the number of appends. */
function zAfter(a: string): string {
  let head = Z_DIGITS.indexOf(a[0]!);
  if (head < Z_UPPER) return Z_BASE;
  let digits = a.slice(1, 1 + zTail(head)).padEnd(zTail(head), '0').split('').map((c) => Z_DIGITS.indexOf(c));
  for (;;) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === Z_DIGITS.length - 1) digits[i--] = 0;
    if (i >= 0) digits[i]! += 1;
    else {
      head += 1;
      if (head >= Z_DIGITS.length) throw new RangeError('dimZBetween: no key space left above');
      digits = new Array<number>(zTail(head)).fill(0);
    }
    // a key never ends in 0: step once more
    if (digits.length === 0 || digits[digits.length - 1] !== 0) return Z_DIGITS[head]! + digits.map((d) => Z_DIGITS[d]).join('');
  }
}

/** The next open-end key below `b`: its counter part minus one. */
function zBefore(b: string): string {
  let head = Z_DIGITS.indexOf(b[0]!);
  if (head >= Z_UPPER) return Z_DIGITS[Z_UPPER - 1]!;
  let digits = b.slice(1, 1 + zTail(head)).padEnd(zTail(head), '0').split('').map((c) => Z_DIGITS.indexOf(c));
  for (;;) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === 0) digits[i--] = Z_DIGITS.length - 1;
    if (i >= 0) digits[i]! -= 1;
    else {
      head -= 1;
      if (head < 0) throw new RangeError('dimZBetween: no key space left below');
      digits = new Array<number>(zTail(head)).fill(Z_DIGITS.length - 1);
    }
    const out = Z_DIGITS[head]! + digits.map((d) => Z_DIGITS[d]).join('');
    if (!out.endsWith('0')) return out;
  }
}

/**
 * A key strictly between `a` and `b` (`null` is an open end). The result never ends in `0` and is never longer
 * than DIM_LIMITS.z. Keys compare by code unit, so they sort the same in JS, SQLite and JSON, and a reorder is one
 * `update` of one node.
 *  - An OPEN end counts: "draw on top" and "send to back" step a counter whose length grows with the logarithm of
 *    the number of steps (the head character says how many digits follow), so ten thousand in a row stay short.
 *  - Between two keys it is the digit-wise midpoint, which adds a character about every six inserts at one spot.
 * Throws RangeError when a key is malformed, `a` is not below `b`, or no key of legal length fits: caller bugs
 * and exhaustion are never answered with a key that would fail DIM_Z_PATTERN. For stored data use `dimZPlace`.
 */
export function dimZBetween(a: string | null, b: string | null): string {
  if ((a !== null && !DIM_Z_PATTERN.test(a)) || (b !== null && !DIM_Z_PATTERN.test(b))) throw new RangeError('dimZBetween: malformed key');
  if (a !== null && b !== null && !(a < b)) throw new RangeError('dimZBetween: keys out of order');
  const out = a === null && b === null ? Z_BASE : b === null ? zAfter(a!) : a === null ? zBefore(b) : zMid(a, b);
  if (out.length > DIM_LIMITS.z || !DIM_Z_PATTERN.test(out) || (a !== null && !(a < out)) || (b !== null && !(out < b))) throw new RangeError('dimZBetween: no key of legal length fits here');
  return out;
}

/**
 * TOTAL placement for stored data (what a renderer calls when it derives a key for a new or moved mark from its
 * neighbours' stored `z`). The fold carries anything, so a neighbour's `z` may be malformed, missing, equal to
 * the other's or out of order. Rules, never a throw:
 *  - a neighbour whose `z` is not a well-formed key counts as an open end;
 *  - when nothing fits strictly between (equal keys, keys out of order, or no room left), the key is taken ABOVE
 *    the lower neighbour, and if even that has no room the lower neighbour's own key is reused (ties are ordered
 *    by id, `dimZCompare`). The mark is then drawn at or just above where it was dropped, never lost.
 */
export function dimZPlace(below: unknown, above: unknown): string {
  const a = typeof below === 'string' && DIM_Z_PATTERN.test(below) ? below : null;
  const b = typeof above === 'string' && DIM_Z_PATTERN.test(above) ? above : null;
  try {
    return dimZBetween(a, a !== null && b !== null && !(a < b) ? null : b);
  } catch {
    try {
      return dimZBetween(a, null);
    } catch {
      return a ?? b ?? Z_BASE;
    }
  }
}

/** Order by `z` (code units; a non-string `z` sorts first), ties broken by id. */
export function dimZCompare(a: { z: unknown; id: string }, b: { z: unknown; id: string }): number {
  const x = typeof a.z === 'string' ? a.z : '';
  const y = typeof b.z === 'string' ? b.z : '';
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ── the strict write validator ───────────────────────────────────────────── */

export interface DimActor {
  cls: 'human' | 'agent';
  principal: string;
  agent?: string;
}

/** Every field name a refusal may carry; anything else is reported as `unknown` (input is never echoed). */
export const DIM_FIELDS: readonly string[] = Object.freeze([
  ...new Set([...Object.values(DIM_NODE_KEYS).flat(), 'type', 'node', 'patch', 'ids', 'dx', 'dy', 'scope', 'ops', 'op', 'unknown']),
]);

/** One fixed sentence per code. A `fix` never contains input. */
export const DIM_REFUSAL_FIXES: Readonly<Record<DimRefusalCode, string>> = Object.freeze({
  'op-unknown': 'Use one of the op types add, update, move or delete.',
  'op-not-available': 'This op type is reserved and cannot be written yet; use add, update, move or delete.',
  'too-many-ops': 'Send at most 64 ops in one call; split the rest into further calls.',
  'kind-unknown': 'Use one of the core kinds: stroke, rect, ellipse, diamond, arrow, text or frame.',
  'kind-not-core': 'Only core kinds can be written or edited: stroke, rect, ellipse, diamond, arrow, text or frame.',
  'field-unknown': 'Remove the field; only the listed fields of the op and of this kind can be written, and id and kind cannot be changed.',
  'field-missing': 'Add the required field; an add needs id, kind, x, y, z and the fields its kind requires, and a required field cannot be removed.',
  'field-type': 'Give the field its listed type; coordinates, sizes and points are whole numbers.',
  'field-range': 'Keep the value inside the listed range or list of values for this field.',
  'id-bad': 'Use a 26-character ULID as the node id.',
  'id-exists': 'Mint a new id; an id is never reused, even after a delete.',
  'id-missing': 'Name a node that is on the board now; read the dimension again before editing.',
  'not-owner': 'Edit only the marks you drew; draw a new mark beside the one you want to change.',
  'z-bad': 'Use an order key of 1 to 64 characters from 0-9, A-Z and a-z that does not end in 0.',
  'colour-bad': 'Use a named swatch for this role, or a custom colour that keeps clear of the reserved colours.',
  'ref-bad': 'Write the ref as scheme:id with an optional @rev, using only letters, digits and . _ / # $ ^ ! ~ -.',
  'ref-scheme': 'Use one of the ref schemes sym, spec, td, l, t, n, s, wl, knot or dim.',
  'ref-too-long': 'Keep each ref to 128 characters or fewer.',
  'ref-count': 'Give at most 8 refs per node, each one once.',
  'link-missing': 'Point from and to at nodes that are on the board now, or leave them out.',
  'parent-bad': 'Set parent to the id of a frame that is on the board now; a frame cannot have a parent.',
  secret: 'Remove the credential from the text; op rows are permanent, so nothing that looks like a secret is stored.',
});

export interface DimRefusal {
  /** index into `ops`; -1 for the batch as a whole */
  index: number;
  /** a DIM_FIELDS name */
  field: string;
  code: DimRefusalCode;
  fix: string;
  /** colour-bad only: a named swatch from the closed list that may be used instead */
  swatch?: string;
  /** secret only: the rule kind that matched, never the text */
  rule?: string;
}
export interface DimValidation {
  ok: DimOp[];
  refused: DimRefusal[];
  secret: boolean;
}

/** What the scan drops before it reads: controls, formats, line and paragraph separators, non-spacing and enclosing marks, and every default-ignorable code point. */
const SCAN_STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}]/gu;
/** The S1.2 strip set, kept for the second scan text (`dimTextForScanS12`). */
const SCAN_STRIP_S12 = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * The text the secret scan reads: compatibility-decomposed (NFKD), stripped of `SCAN_STRIP`, then recomposed
 * (NFC). Without a stripped code point the result is exactly NFKC. Decomposing FIRST matters: a combining mark
 * that composes with the letter before it (an acute on `k`) would otherwise become one precomposed letter and
 * survive the strip. So a credential cut by zero-width characters, bidi marks, a soft hyphen, variation
 * selectors, the combining grapheme joiner, Hangul fillers or any combining accent reads as the credential, and an
 * accented letter reads as its base letter. Only the scan reads this text; what is stored is what was sent.
 *
 * The validator scans THREE texts of every string and reports the union: this one, `dimTextForScanS12` (the
 * S1.2 form) and the raw string. The S1.2 form is kept because this one can lose a word boundary the rules lean
 * on: an accented letter directly before a credential becomes a plain letter, and `\b` no longer sits between
 * them. Nothing the S1.2 scan caught is lost.
 *
 * RESIDUALS of the secret check (Aegis S1.2 nit 4, restated after the S1.4 P0 review): what `validateDimOps` does
 * NOT find. Stated here so no caller takes the check for a guarantee.
 *  - Visible separators. A credential broken by an ordinary space, by punctuation or by a spacing combining mark
 *    (`Mc`) is not rejoined. Every non-ASCII space (`Zs`: no-break, en, em, thin, ideographic) is folded to U+0020
 *    by the normalisation and stays, so it separates like a space. LF, CR and TAB are controls: they ARE stripped,
 *    so parts on lines of their own inside ONE string are rejoined and found.
 *  - Blank letters. U+2800 (braille pattern blank) and any other visible-as-nothing code point that is neither
 *    a mark, a format, a control nor default-ignorable is not stripped.
 *  - Look-alikes. Only compatibility forms are folded (fullwidth, ligatures, styled letters, accents). A Cyrillic
 *    or Greek letter standing in for a Latin one is not.
 *  - Encodings. Base64, hex, URL-encoded, reversed or otherwise transformed secrets, and secrets with no known
 *    format (a bare password), match no rule.
 *  - Structural strings. `id`, `kind`, `z`, `parent`, `from`, `to`, `color`, `fill` and `head` are each read alone
 *    but are never part of a join or a pair, so a credential split between one of them and a free string, or
 *    between two of them, is missed (each is pattern-checked, which leaves little room).
 *  - Three or more strings. The free strings of one node are read each by itself, all joined in sorted key
 *    order, and as ordered pairs. A credential split over three or more strings in an order that is not the join
 *    order (for example three refs out of order) is missed.
 *  - A node over `DIM_SCAN_LIMITS.freeStringsPerNode` free strings (never a valid one) is read as the join only,
 *    so a pair that is not adjacent in the join is missed there. A batch over `stringsPerBatch` is refused unread.
 *  - A node that already matches. What a touched node matched BEFORE an op, by its join or a pair, is not held
 *    against the op (an old row never blocks a clean edit). The cost: once a node matches a rule that way, a NEW
 *    split credential of the SAME rule written onto that node passes. A whole credential in one string is still
 *    refused, because each string is also read alone.
 *  - Two nodes. A credential split across nodes, or across dimensions, is never joined.
 *  - Numbers. `points` and every other integer can carry bytes; no number is read.
 *  - Field names. Only string VALUES are read, never keys (an unknown key is refused by name, not scanned).
 *  - The dimension `title` on the session.start row is outside this validator; the dimension mod checks it.
 *  - Reads. `dimViewOf` does not re-run the scan, and a row written before a rule existed is not re-read: what was
 *    stored is shown.
 */
export function dimTextForScan(s: string): string {
  return s.normalize('NFKD').replace(SCAN_STRIP, '').normalize('NFC');
}

/** The S1.2 scan text: NFKC, then controls, formats and line and paragraph separators removed. Still scanned. Module-private. */
function dimTextForScanS12(s: string): string {
  return s.normalize('NFKC').replace(SCAN_STRIP_S12, '');
}

const fieldName = (k: string): string => (DIM_FIELDS.includes(k) ? k : 'unknown');
const isCoreKind = (k: unknown): k is DimCoreKind => typeof k === 'string' && (DIM_CORE_KINDS as readonly string[]).includes(k);
const inRange = (v: unknown, lo: number, hi: number): boolean => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;

type Problem = { field: string; code: DimRefusalCode; swatch?: string; why?: ContentContrastWhy; night?: boolean };

/** A refused colour check as a problem on `field` (content_palette.contrast_rule: the why picks the fix sentence). */
const colourProblem = (field: string, c: Exclude<ContentColourCheck, { ok: true }>): Problem => ({ field, code: 'colour-bad', ...(c.offer ? { swatch: c.offer } : {}), ...(c.why ? { why: c.why, night: !!c.night } : {}) });

/**
 * contrast_rule.pair, on the node as it would stand after the op: the line on its own fill, judged on the field
 * being written (the line when both are written). Skipped when either field already has a problem.
 */
function pairProblems(kind: DimCoreKind, node: Record<string, unknown>, written: readonly string[], problems: readonly Problem[]): Problem[] {
  const field = written.includes('color') ? 'color' : written.includes('fill') ? 'fill' : null;
  if (!field || node.color === undefined || node.fill === undefined || problems.some((p) => p.field === 'color' || p.field === 'fill')) return [];
  const c = contentPairCheck(node.color, node.fill, field === 'color' ? 'line' : 'fill', { text: kind === 'text' });
  return c.ok ? [] : [colourProblem(field, c)];
}

/** Check one node field value against the running state. `self` is the node's own id. */
function checkField(d: { readonly nodes: ReadonlyMap<string, DimFoldNode> }, kind: DimCoreKind, self: string, key: string, v: unknown): Problem[] {
  const bad = (code: DimRefusalCode, extra: Partial<Problem> = {}): Problem[] => [{ field: key, code, ...extra }];
  const int = (lo: number, hi: number): Problem[] => (typeof v !== 'number' || !Number.isSafeInteger(v) ? bad('field-type') : inRange(v, lo, hi) ? [] : bad('field-range'));
  const str = (max: number, min = 0): Problem[] => (typeof v !== 'string' ? bad('field-type') : v.length < min || v.length > max ? bad('field-range') : []);
  switch (key) {
    case 'x':
    case 'y':
      return int(-DIM_LIMITS.coord, DIM_LIMITS.coord);
    case 'w':
    case 'h':
      return int(1, DIM_LIMITS.size);
    case 'z':
      return typeof v === 'string' && v.length <= DIM_LIMITS.z && DIM_Z_PATTERN.test(v) ? [] : bad('z-bad');
    case 'rot':
      return int(0, 3599);
    case 'weight':
      return int(1, 3);
    case 'size':
      return int(1, 4);
    case 'color':
    case 'fill': {
      const role: ContentRole = key === 'color' ? 'line' : 'fill';
      const c = contentColourCheck(v, role, { text: kind === 'text' });
      return c.ok ? [] : [colourProblem(key, c)];
    }
    case 'label':
      return str(DIM_LIMITS.label);
    case 'title':
      return str(DIM_LIMITS.title);
    case 'text':
      return str(DIM_LIMITS.text, 1);
    case 'head':
      return typeof v !== 'string' ? bad('field-type') : v === 'none' || v === 'end' || v === 'both' ? [] : bad('field-range');
    case 'rel':
      return typeof v !== 'string' ? bad('field-type') : DIM_REL_PATTERN.test(v) ? [] : bad('field-range');
    case 'points': {
      if (!Array.isArray(v)) return bad('field-type');
      const min = kind === 'arrow' ? 4 : 2;
      if (v.length < min || v.length > DIM_LIMITS.points || v.length % 2 !== 0) return bad('field-range');
      for (const n of v) {
        if (typeof n !== 'number' || !Number.isSafeInteger(n)) return bad('field-type');
        if (!inRange(n, -DIM_LIMITS.coord, DIM_LIMITS.coord)) return bad('field-range');
      }
      return [];
    }
    case 'from':
    case 'to': {
      if (typeof v !== 'string' || !DIM_NODE_ID_PATTERN.test(v)) return bad('id-bad');
      return v !== self && d.nodes.has(v) ? [] : bad('link-missing');
    }
    case 'parent': {
      if (typeof v !== 'string' || !DIM_NODE_ID_PATTERN.test(v)) return bad('id-bad');
      if (kind === 'frame' || v === self) return bad('parent-bad');
      return d.nodes.get(v)?.node.kind === 'frame' ? [] : bad('parent-bad');
    }
    case 'refs': {
      if (!Array.isArray(v)) return bad('field-type');
      if (v.length > DIM_LIMITS.refs || new Set(v).size !== v.length) return bad('ref-count');
      for (const r of v) {
        const code = validateDimRef(r);
        if (code) return bad(code);
      }
      return [];
    }
    default:
      return bad('field-unknown');
  }
}

function owns(actor: DimActor, by: DimBy): boolean {
  if (actor && actor.cls === 'human') return true;
  return !!actor && actor.cls === 'agent' && by.cls === 'agent' && by.principal === actor.principal && NON_EMPTY(actor.agent) && by.agent === actor.agent;
}

/** An existing node an op may edit: live, of a core kind, and the actor's own when the actor is an agent. */
function editable(d: Draft, actor: DimActor, id: unknown, field: string): { cur: DimFoldNode; kind: DimCoreKind } | Problem {
  if (typeof id !== 'string' || !DIM_NODE_ID_PATTERN.test(id)) return { field, code: 'id-bad' };
  const cur = d.nodes.get(id);
  if (!cur) return { field, code: 'id-missing' };
  if (!owns(actor, cur.by)) return { field, code: 'not-owner' };
  if (!isCoreKind(cur.node.kind)) return { field, code: 'kind-not-core' };
  return { cur, kind: cur.node.kind };
}

function checkOp(d: Draft, op: unknown, actor: DimActor): { problems: Problem[]; touched: string[] } {
  const problems: Problem[] = [];
  const touched: string[] = [];
  const out = { problems, touched };
  if (!isPlainObject(op)) return { problems: [{ field: 'op', code: 'field-type' }], touched };
  const type = op.type;
  if (typeof type !== 'string' || !(DIM_WRITABLE_OP_TYPES as readonly string[]).includes(type)) {
    const reserved = typeof type === 'string' && (DIM_OP_TYPES as readonly string[]).includes(type);
    return { problems: [{ field: 'type', code: reserved ? 'op-not-available' : 'op-unknown' }], touched };
  }
  const keys = DIM_OP_KEYS[type as (typeof DIM_WRITABLE_OP_TYPES)[number]];
  for (const k of Object.keys(op)) if (!keys.includes(k)) problems.push({ field: fieldName(k), code: 'field-unknown' });
  if (type === 'add') {
    const node = op.node;
    if (!isPlainObject(node)) return { problems: [...problems, { field: 'node', code: node === undefined ? 'field-missing' : 'field-type' }], touched };
    if (node.kind === undefined) return { problems: [...problems, { field: 'kind', code: 'field-missing' }], touched };
    if (typeof node.kind !== 'string' || !DIM_KIND_PATTERN.test(node.kind)) return { problems: [...problems, { field: 'kind', code: 'kind-unknown' }], touched };
    if (!isCoreKind(node.kind)) return { problems: [...problems, { field: 'kind', code: 'kind-not-core' }], touched };
    const kind = node.kind;
    const self = typeof node.id === 'string' ? node.id : '';
    for (const k of DIM_NODE_REQUIRED[kind]) if (node[k] === undefined || node[k] === null) problems.push({ field: k, code: 'field-missing' });
    for (const k of Object.keys(node)) {
      if (!DIM_NODE_KEYS[kind].includes(k)) problems.push({ field: fieldName(k), code: 'field-unknown' });
      else if (k === 'kind' || node[k] === undefined || node[k] === null) continue;
      else if (k === 'id') {
        if (!DIM_NODE_ID_PATTERN.test(self)) problems.push({ field: 'id', code: 'id-bad' });
        else if (d.nodes.has(self) || d.gone.has(self)) problems.push({ field: 'id', code: 'id-exists' });
      } else problems.push(...checkField(d, kind, self, k, node[k]));
    }
    for (const k of Object.keys(node)) if (node[k] === null && DIM_NODE_KEYS[kind].includes(k) && !DIM_NODE_REQUIRED[kind].includes(k)) problems.push({ field: k, code: 'field-type' });
    problems.push(...pairProblems(kind, { color: node.color ?? undefined, fill: node.fill ?? undefined }, Object.keys(node), problems));
    if (self) touched.push(self);
    return out;
  }
  if (type === 'update') {
    const e = editable(d, actor, op.id, 'id');
    if ('code' in e) return { problems: [...problems, e], touched };
    const patch = op.patch;
    if (!isPlainObject(patch)) return { problems: [...problems, { field: 'patch', code: patch === undefined ? 'field-missing' : 'field-type' }], touched };
    const pk = Object.keys(patch);
    if (pk.length === 0) problems.push({ field: 'patch', code: 'field-missing' });
    for (const k of pk) {
      if (k === 'id' || k === 'kind' || !DIM_NODE_KEYS[e.kind].includes(k)) problems.push({ field: fieldName(k), code: 'field-unknown' });
      else if (patch[k] === null) {
        if (DIM_NODE_REQUIRED[e.kind].includes(k)) problems.push({ field: k, code: 'field-missing' });
      } else if (patch[k] === undefined) problems.push({ field: k, code: 'field-type' });
      else problems.push(...checkField(d, e.kind, op.id as string, k, patch[k]));
    }
    const stands = (k: 'color' | 'fill'): unknown => (Object.prototype.hasOwnProperty.call(patch, k) ? (patch[k] ?? undefined) : e.cur.node[k]);
    problems.push(...pairProblems(e.kind, { color: stands('color'), fill: stands('fill') }, pk, problems));
    touched.push(op.id as string);
    return out;
  }
  if (type === 'move') {
    const ids = op.ids;
    if (!Array.isArray(ids)) problems.push({ field: 'ids', code: ids === undefined ? 'field-missing' : 'field-type' });
    else if (ids.length < 1 || ids.length > DIM_LIMITS.moveIds || new Set(ids).size !== ids.length) problems.push({ field: 'ids', code: 'field-range' });
    for (const k of ['dx', 'dy'] as const) {
      if (op[k] === undefined) problems.push({ field: k, code: 'field-missing' });
      else if (typeof op[k] !== 'number' || !Number.isSafeInteger(op[k])) problems.push({ field: k, code: 'field-type' });
      else if (!inRange(op[k], -DIM_LIMITS.coord, DIM_LIMITS.coord)) problems.push({ field: k, code: 'field-range' });
    }
    if (problems.length > 0 || !Array.isArray(ids)) return out;
    for (const id of ids) {
      const e = editable(d, actor, id, 'ids');
      if ('code' in e) {
        problems.push(e);
        continue;
      }
      const x = (e.cur.node.x as number) + (op.dx as number);
      const y = (e.cur.node.y as number) + (op.dy as number);
      if (!inRange(x, -DIM_LIMITS.coord, DIM_LIMITS.coord) || !inRange(y, -DIM_LIMITS.coord, DIM_LIMITS.coord)) problems.push({ field: 'ids', code: 'field-range' });
      // J3: a move changes no string, so the moved nodes are not re-read by the secret check
    }
    return out;
  }
  // delete
  const e = editable(d, actor, op.id, 'id');
  if ('code' in e) problems.push(e);
  return out;
}

/** Every string value at any depth, with the top-level field it sits under. */
function stringsOf(v: unknown, field: string, out: Array<{ field: string; text: string }>, depth = 0): void {
  if (typeof v === 'string') out.push({ field, text: v });
  else if (depth >= COPY_DEPTH) return;
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, field, out, depth + 1);
  else if (isPlainObject(v)) for (const k of Object.keys(v)) stringsOf(v[k], depth === 0 ? fieldName(k) : field, out, depth + 1);
}

/**
 * How many strings a value holds at any depth, counted only as far as `limit + 1`: the walk stops there, so the
 * cost of asking is bounded by the limit and not by the caller's input.
 */
function countStrings(v: unknown, limit: number, n = 0, depth = 0): number {
  if (typeof v === 'string') return n + 1;
  if (depth >= COPY_DEPTH) return n;
  if (Array.isArray(v)) {
    for (const x of v) {
      n = countStrings(x, limit, n, depth + 1);
      if (n > limit) return n;
    }
  } else if (isPlainObject(v)) {
    for (const k of Object.keys(v)) {
      n = countStrings(v[k], limit, n, depth + 1);
      if (n > limit) return n;
    }
  }
  return n;
}

/** The value whose strings the scan reads for one op: an add's node, an update's patch, else the op itself. */
const scanRoot = (op: unknown): unknown => (isPlainObject(op) ? (op.type === 'add' ? op.node : op.type === 'update' ? op.patch : op) : op);

/** Node fields whose values are fixed patterns, not free text: left out of the joined scan. */
const STRUCTURAL_KEYS = new Set(['id', 'kind', 'z', 'parent', 'from', 'to', 'color', 'fill', 'head']);

/**
 * Validate a batch of ops against a state, in order, against a running copy (a later op may cite an id an
 * earlier op added). Returns the ops that may be appended and one refusal per problem. A secret hit anywhere
 * refuses the whole batch (`ok: []`, `secret: true`).
 *
 * The secret check reads every string at any depth of every op, and for each node an op touches every string of
 * the node as it would stand, their concatenation and each ordered pair of them, so a credential split over two
 * updates or two fields of one node is found. What the check does not find is listed at `dimTextForScan`.
 *
 * The work is bounded by `DIM_SCAN_LIMITS`: a batch over `stringsPerBatch` strings is refused whole (`field-range`
 * on `ops`) before a string is read, and a node over `freeStringsPerNode` free strings is read as its join only.
 */
export function validateDimOps(state: DimState, ops: unknown, actor: DimActor, opts: { scan?: (text: string) => readonly string[] } = {}): DimValidation {
  const refuse = (index: number, p: Problem, extra: Partial<DimRefusal> = {}): DimRefusal => ({
    index,
    field: fieldName(p.field),
    code: p.code,
    fix: p.why && p.swatch !== undefined ? contentContrastFix(p.why, !!p.night, p.swatch) : DIM_REFUSAL_FIXES[p.code],
    ...(p.swatch !== undefined ? { swatch: p.swatch } : {}),
    ...extra,
  });
  if (!Array.isArray(ops)) return { ok: [], refused: [refuse(-1, { field: 'ops', code: 'field-type' })], secret: false };
  if (ops.length > DIM_LIMITS.opsPerRow) return { ok: [], refused: [refuse(-1, { field: 'ops', code: 'too-many-ops' })], secret: false };
  // the batch cap of the scan, before any string is read. Counted from scanRoot, the root the scan itself walks,
  // so a string the scan would read at its deepest level is counted; an op's own `type` is not (DIM_SCAN_LIMITS)
  let strings = 0;
  for (const op of ops) {
    const root = scanRoot(op);
    strings = countStrings(root, DIM_SCAN_LIMITS.stringsPerBatch + 1, strings) - (root === op && isPlainObject(op) && typeof op.type === 'string' ? 1 : 0);
    if (strings > DIM_SCAN_LIMITS.stringsPerBatch) return { ok: [], refused: [refuse(-1, { field: 'ops', code: 'field-range' })], secret: false };
  }
  const scan = opts.scan ?? secretKindsIn;
  /** The rules matched by one text in any of its three forms (see dimTextForScan); equal forms are read once. */
  const hits = (text: string): readonly string[] => {
    const forms = new Set([dimTextForScan(text), dimTextForScanS12(text), text]);
    if (forms.size === 1) return scan(text);
    const out = new Set<string>();
    for (const f of forms) for (const r of scan(f)) out.add(r);
    return [...out];
  };
  /**
   * The rules matched by a node's free-text strings read together: all of them joined, and each ordered pair.
   * Over DIM_SCAN_LIMITS.freeStringsPerNode strings only the join is read: the pair read is quadratic, and it runs
   * on refused ops and on stored nodes too, so it is never given a node no valid write can make.
   */
  const joined = (node: Record<string, unknown> | undefined): Set<string> => {
    const out = new Set<string>();
    if (!node) return out;
    const free: Array<{ field: string; text: string }> = [];
    for (const k of Object.keys(node).sort()) if (!STRUCTURAL_KEYS.has(k)) stringsOf(node[k], fieldName(k), free, 1);
    if (free.length < 2) return out;
    for (const r of hits(free.map((s) => s.text).join(''))) out.add(r);
    if (free.length > DIM_SCAN_LIMITS.freeStringsPerNode) return out;
    for (const x of free) for (const y of free) if (x !== y) for (const r of hits(x.text + y.text)) out.add(r);
    return out;
  };
  const d = draftOf(state);
  const by: DimBy = actor && actor.cls === 'agent' && NON_EMPTY(actor.agent) ? { cls: 'agent', principal: actor.principal, agent: actor.agent } : actor && actor.cls === 'human' ? { cls: 'human', principal: actor.principal } : UNKNOWN_BY;
  const ok: DimOp[] = [];
  const refused: DimRefusal[] = [];
  const secrets: DimRefusal[] = [];
  ops.forEach((op, index) => {
    const seen = new Set<string>();
    const note = (field: string, text: string): void => {
      for (const rule of hits(text)) {
        const key = `${field}\n${rule}`;
        if (seen.has(key)) continue;
        seen.add(key);
        secrets.push(refuse(index, { field, code: 'secret' }, { rule }));
      }
    };
    const own: Array<{ field: string; text: string }> = [];
    stringsOf(scanRoot(op), 'unknown', own);
    for (const s of own) note(s.field, s.text);
    const { problems, touched } = checkOp(d, op, actor);
    // what each touched node already matches by itself: an old row is never a reason to refuse a clean edit
    const before = new Map(touched.map((id) => [id, joined(d.nodes.get(id)?.node)]));
    // the node as it would stand after this op, whether or not the op passes the other checks
    const trial = problems.length === 0 ? d : draftOf(d);
    const applied = applyOp(trial, op, by, null, d.seq);
    if (seen.size === 0) {
      for (const id of touched) {
        const was = before.get(id)!;
        for (const rule of joined(trial.nodes.get(id)?.node)) {
          if (was.has(rule) || seen.has(rule)) continue;
          seen.add(rule);
          secrets.push(refuse(index, { field: 'unknown', code: 'secret' }, { rule }));
        }
      }
    }
    if (problems.length === 0 && applied) ok.push(copyJson(op) as DimOp);
    else if (problems.length === 0) refused.push(refuse(index, { field: 'op', code: 'field-type' }));
    else for (const p of problems) refused.push(refuse(index, p));
  });
  if (secrets.length > 0) return { ok: [], refused: secrets, secret: true };
  return { ok, refused, secret: false };
}

/* ── the view (what a tool or an export may read) ─────────────────────────── */

/** The fixed lead word of a fallback: an unknown kind is always shown as `kind <name>`, never as bare words. */
export const DIM_FALLBACK_LEAD = 'kind' as const;

/** The pattern-checked kind name of any stored value: the kind itself when it matches the grammar, else `unknown`. */
export function dimKindName(kind: unknown): string {
  return typeof kind === 'string' && DIM_KIND_PATTERN.test(kind) ? kind : 'unknown';
}

/** What a fallback mark may show: the fixed lead word and the pattern-checked kind name, nothing else. */
export function dimFallbackLabel(kind: unknown): string {
  return `${DIM_FALLBACK_LEAD} ${dimKindName(kind)}`;
}

/**
 * One node of a view. `core: true` does NOT mean the node is whole: a stored field that fails today's write check
 * is left out, a REQUIRED one included (a core node may come without `x`, `z`, `text`, `points`, `w` or `h`).
 * A reader must tolerate every field but `id`, `kind`, `core` and `by` being absent.
 */
export interface DimViewNode {
  /** always DIM_NODE_ID_PATTERN: a node stored under any other id is not in the view */
  id: string;
  kind: string;
  /** false: a kind this version does not know; only id, kind, x, y and by are shown */
  core: boolean;
  by: DimBy;
  [field: string]: unknown;
}
export interface DimView {
  v: 1;
  /** the stored id when it matches DIM_ID_PATTERN, else null */
  dim: string | null;
  /** the stored title when a title could be written so today (length, no invisible character), else '' */
  title: string;
  seq: number;
  nodes: DimViewNode[];
  legend: string[];
}

/**
 * What a `by.principal` may look like in a view: `p:<ns>/<name>` with an optional `@<rootKeyId8>`, lowercase letters,
 * digits and `. _ -` only, at most 92 characters. Every principal id the kernel mints matches (it is wider than
 * `ANY_PRINCIPAL_PATTERN` only in the length of the namespace; a test holds that), and no string with a space, an
 * upper-case letter, a control or a format character does.
 */
export const DIM_VIEW_PRINCIPAL_PATTERN = /^p:[a-z0-9]{1,16}\/[a-z0-9][a-z0-9._-]{0,63}(@[0-9a-f]{8})?$/;
/** What an agent label may look like in a view, and the label a tool stamp must carry: 1 to 64 of letters, digits and `. _ -`, starting with a letter or digit. */
export const DIM_AGENT_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * `by` as a view may show it (Aegis S1.4 P0 re-review). The fold derives `by` from the host stamp of a row, and a
 * row is permanent: a hostile or later-version row can carry any string as `principal` or `agent`, and a view is
 * read by a model. So the strings are checked HERE, and a `by` that fails is shown as the unknown hand, whole:
 *  - `cls` must be one of DIM_BY_CLASSES;
 *  - `principal` must match DIM_VIEW_PRINCIPAL_PATTERN (the unknown hand's fixed `unknown` is kept as it is);
 *  - an agent hand must carry an `agent` that matches DIM_AGENT_LABEL_PATTERN; a human hand carries none.
 * Nothing of a failed `by` is shown: not its class, not a cut-down principal. The fold and the hash are unchanged
 * (they keep what the row said); only what is SHOWN is bounded. Never throws.
 */
export function dimViewBy(by: unknown): DimBy {
  try {
    if (!isPlainObject(by)) return { ...UNKNOWN_BY };
    const cls = own(by, 'cls');
    const principal = own(by, 'principal');
    const agent = own(by, 'agent');
    if (cls === 'human' && typeof principal === 'string' && DIM_VIEW_PRINCIPAL_PATTERN.test(principal) && agent === undefined) return { cls: 'human', principal };
    if (cls === 'agent' && typeof principal === 'string' && DIM_VIEW_PRINCIPAL_PATTERN.test(principal) && typeof agent === 'string' && DIM_AGENT_LABEL_PATTERN.test(agent)) return { cls: 'agent', principal, agent };
  } catch {
    // a `by` that cannot be read vouches for nobody
  }
  return { ...UNKNOWN_BY };
}

/** The stored node id, when it is one a write could have minted; else undefined (the field is left out). */
const viewId = (v: unknown): string | undefined => (typeof v === 'string' && DIM_NODE_ID_PATTERN.test(v) ? v : undefined);

/** Code points no title may hold: the ones a reader cannot see. */
const VIEW_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * One stored field of a core node as the view may show it, or undefined to leave it out. The fold carries
 * anything (a row is permanent, and a hostile or later-version row is still a row), so no stored STRING reaches
 * the view unchecked: a field value must pass TODAY's write check for its field (Aegis S1.2 nit 5), and the
 * node id, the dimension id and the title are checked in `dimViewOf`. Two limits on that claim:
 *  - the view does NOT re-run the secret scan. A text that was stored before a rule existed, or by a row no
 *    validator read, is shown as stored;
 *  - `by` is bounded by `dimViewBy`: a principal or an agent label outside its pattern is shown as the unknown hand.
 * Per field:
 *  - `refs`: each ref is checked by itself; one that fails `validateDimRef` is left out, a repeat is shown once,
 *    and at most DIM_LIMITS.refs are shown. A stored empty list is shown as `[]`; a list whose every ref failed
 *    is left out.
 *  - `color`, `fill`: the current palette check; a token that fails it is left out (the renderer then draws ink
 *    or no fill, as `resolveContentColour` does).
 *  - `text`, `label`, `title`, `rel`, `head`, `z`, every number and `points`: the type, length, range and pattern
 *    checks of the validator; an over-long string or a value of the wrong type is left out.
 *  - `parent`, `from`, `to`: the id pattern only. Whether the node they name is still on the board is the
 *    reader's to resolve against the same view.
 */
function viewField(state: DimState, kind: DimCoreKind, id: string, key: string, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (key === 'parent' || key === 'from' || key === 'to') return viewId(v);
  if (key === 'refs') {
    if (!Array.isArray(v)) return undefined;
    const refs: string[] = [];
    for (const r of v) {
      if (refs.length >= DIM_LIMITS.refs) break;
      if (validateDimRef(r) === null && !refs.includes(r as string)) refs.push(r as string);
    }
    return refs.length > 0 || v.length === 0 ? refs : undefined;
  }
  // checkField reads the state's nodes only for the three link fields answered above
  if (checkField(state, kind, id, key, v).length > 0) return undefined;
  return Array.isArray(v) ? [...v] : v;
}

/**
 * The view of a state. A core node shows its `DIM_NODE_KEYS` fields and `by`, each field only when its stored
 * value passes today's write check (`viewField`). Any other node shows only id, the pattern-checked kind name,
 * x, y and `by`. Carried-through fields are left out entirely, and the legend is built from kind names and `by`
 * classes only. `by` is the BOUNDED one (`dimViewBy`): the legend counts the hand that is shown.
 *
 * Three more stored strings are checked here, because the fold accepts any string for each:
 *  - a node whose id is not DIM_NODE_ID_PATTERN is left out whole, core or not, and is not counted in the legend;
 *  - `title` is shown only when it is at most DIM_LIMITS.title long and holds no control, format, line-separator
 *    or paragraph-separator code point, else `''`;
 *  - `dim` is shown only when it matches DIM_ID_PATTERN, else `null`.
 */
export function dimViewOf(state: DimState): DimView {
  const entries = [...state.nodes.entries()].sort((a, b) => dimZCompare({ z: a[1].node.z, id: a[0] }, { z: b[1].node.z, id: b[0] }));
  const kinds = new Map<string, number>();
  const hands = new Map<string, number>();
  const nodes: DimViewNode[] = [];
  for (const [id, n] of entries) {
    if (!DIM_NODE_ID_PATTERN.test(id)) continue;
    const by = dimViewBy(n.by);
    const core = isCoreKind(n.node.kind);
    const out: DimViewNode = { id, kind: dimKindName(n.node.kind), core, by };
    const keys = core ? DIM_NODE_KEYS[n.node.kind as DimCoreKind] : ['x', 'y'];
    for (const k of keys) {
      if (k === 'id' || k === 'kind') continue;
      const v = core ? viewField(state, n.node.kind as DimCoreKind, id, k, n.node[k]) : n.node[k];
      if (core ? v !== undefined : typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    nodes.push(out);
    const label = core ? out.kind : dimFallbackLabel(n.node.kind);
    kinds.set(label, (kinds.get(label) ?? 0) + 1);
    hands.set(by.cls, (hands.get(by.cls) ?? 0) + 1);
  }
  const line = (m: Map<string, number>): string => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, c]) => `${k}: ${c}`).join(', ');
  const legend: string[] = [];
  if (kinds.size > 0) legend.push(`marks by kind: ${line(kinds)}`);
  if (hands.size > 0) legend.push(`marks by hand: ${line(hands)}`);
  const dim = typeof state.dim === 'string' && DIM_ID_PATTERN.test(state.dim) ? state.dim : null;
  const title = typeof state.title === 'string' && state.title.length <= DIM_LIMITS.title && !VIEW_INVISIBLE.test(state.title) ? state.title : '';
  return { v: 1, dim, title, seq: state.seq, nodes, legend };
}

/* ── auxiliary kinds and the write-grant fold (S1.4; NOT in the client API descriptor) ── */

/**
 * Two more row kinds of the dimension mod. They are NOT in `DIM_KINDS`, so the fold above ignores them, they are
 * outside `dimHash`, and they are not an input of the client API descriptor. The names are fixed: they enter
 * `DIM_KINDS` unchanged at the next `clientApiId` move (Aegis S1.4, F1).
 *  - `grant`: `{v, dim, hsid, write: boolean}`, whether an attached session's agent may draw.
 *  - `drawRefused`: a count row for a draw that had refusals; closed enums and counts only.
 */
export const DIM_AUX_KINDS = Object.freeze({
  grant: 'modns.gnomon.dimension.grant',
  drawRefused: 'modns.gnomon.dimension.draw.refused',
} as const);

export interface DimGrantPayload {
  v: 1;
  dim: string;
  hsid: string;
  write: boolean;
  relayedFor: DimRowRelayedFor;
}
/** The standing of one session: what its newest honoured grant row said, and that row's seq. */
export interface DimGrant {
  write: boolean;
  /** the seq of the row this entry came from: the high-water mark for that hsid */
  seq: number;
}
/**
 * hsid → its newest HONOURED grant row. A session with no entry has its default (`dimGrantDefault`).
 *
 * It is a Map on purpose. NEVER carry it through a plain object keyed by hsid (a keyframe, a state key, a tool
 * answer, `Object.fromEntries`): an hsid is a stored string, and `__proto__`, `constructor` or `toString` as a key
 * of a plain object either vanishes or answers with something that is not a grant. Serialise it as a list of
 * `[hsid, write, seq]` entries and rebuild the Map entry by entry.
 */
export type DimGrants = ReadonlyMap<string, DimGrant>;

export function emptyDimGrants(): DimGrants {
  return new Map();
}

/**
 * Is this a grant row of `dim` that the fold honours? Only a PERSON ON THE GNOMON WINDOW sets a grant (Aegis S1.4
 * M4): the row's host-written `relayedFor` must fold as the human hand AND carry `surface: 'gui'` and no `agent`
 * key. A grant row stamped `bridge`, `voice` or `cli`, one that names an agent, one with no principal and one with
 * no stamp at all change nothing: a tool call that managed to append the kind cannot grant itself the pen.
 *
 * FAILS CLOSED ON VERSION: an honoured row whose `v` is not the version this file reads (missing, 0, 2, not a
 * number) folds as `write: false` for its hsid, whatever its `write` says. This is an authorization row, not a
 * drawing: a reader that does not know what a later version means must not read it as "may draw". (The op fold
 * is the other way round on purpose: it reads a higher `v` by the v1 rules.)
 */
function honouredGrant(row: DimRow, dim: string): { hsid: string; write: boolean; seq: number } | null {
  if (!row || row.kind !== DIM_AUX_KINDS.grant || !Number.isSafeInteger(row.seq)) return null;
  const p = row.payload;
  if (!isPlainObject(p) || own(p, 'dim') !== dim) return null;
  const hsid = own(p, 'hsid');
  if (!NON_EMPTY(hsid)) return null;
  const r = own(p, 'relayedFor');
  if (!isPlainObject(r) || own(r, 'surface') !== 'gui' || Object.prototype.hasOwnProperty.call(r, 'agent')) return null;
  if (byOf(p).cls !== 'human') return null;
  if (own(p, 'v') !== DIM_ROW_VERSION) return { hsid, write: false, seq: row.seq };
  const write = own(p, 'write');
  if (typeof write !== 'boolean') return null;
  return { hsid, write, seq: row.seq };
}

/**
 * Fold grant rows of one dimension; `from` continues an earlier fold. The ONE grant fold: the dimension mod and
 * the page both call it, so what the page shows is what the mod enforces. Pure and tolerant: the input map is not
 * changed, rows of any other kind or dimension are skipped, and it never throws: not on a malformed row, not on
 * rows that cannot be iterated, and not on a `from` that is no Map, which is answered with an empty map.
 *  - `dim` must match DIM_ID_PATTERN; for any other value nothing is folded and a copy of `from` is returned.
 *  - The honoured row with the HIGHEST seq wins for an hsid. A row at or below the seq already folded for that
 *    hsid changes nothing, so a redelivered or re-read older row (a follow that reconnects, a page read twice)
 *    can never bring back a grant a later row revoked. A row with no integer seq is skipped.
 */
export function foldDimGrants(rows: Iterable<DimRow>, dim: string, from: DimGrants = emptyDimGrants()): DimGrants {
  let out: Map<string, DimGrant>;
  try {
    // a `from` that is not a Map of entries (a value rebuilt wrongly from a keyframe, null, a plain object) is
    // not continued: the fold starts from nothing, and every session is back on its default until rows say more
    out = from instanceof Map ? new Map(from) : new Map();
  } catch {
    out = new Map();
  }
  if (typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim)) return out;
  try {
    for (const row of rows) {
      try {
        const g = honouredGrant(row, dim);
        if (!g) continue;
        const cur: unknown = out.get(g.hsid);
        if (isPlainObject(cur) && Number.isSafeInteger(cur.seq) && g.seq <= (cur.seq as number)) continue;
        out.set(g.hsid, { write: g.write, seq: g.seq });
      } catch {
        // a malformed row grants nothing
      }
    }
  } catch {
    // `rows` that cannot be iterated fold nothing more
  }
  return out;
}

/** The grant of a session no honoured row names: the first attached session may draw, any later one may not. */
export function dimGrantDefault(state: DimState, hsid: string): boolean {
  return state.attached.length > 0 && state.attached[0] === hsid;
}

/**
 * The effective write grant: may this session's agent draw in the dimension? Its newest honoured grant row, else
 * the default. A session that is not attached may never draw, whatever a row says.
 *
 * It answers the GRANT only. It does not read `state.ended`: the caller refuses a draw in an ended dimension
 * itself, before or after asking this (the mod's `dim-ended`), and `grants` must be the fold of the same
 * dimension as `state`.
 */
export function dimMayDraw(state: DimState, grants: DimGrants, hsid: string): boolean {
  if (!NON_EMPTY(hsid) || !state.attached.includes(hsid)) return false;
  // a `grants` that is not a Map vouches for nothing, and an entry that is present but malformed (not an object, or
  // a `write` that is not exactly true) means "may not draw": only a missing entry falls back to the default
  if (!(grants instanceof Map)) return false;
  const g: unknown = grants.get(hsid);
  return g !== undefined ? isPlainObject(g) && g.write === true : dimGrantDefault(state, hsid);
}

/* ── agent tool helpers (S1.4; NOT in the client API descriptor) ──────────── */

/** A model's own id for one draw: 1 to 64 characters of `A-Z a-z 0-9 _ -`. It never reaches a row (see dimOpOid). */
export const DIM_OP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The `oid` an op row carries for a draw sent with an `opId` (Aegis S1.4 A8): the first 16 hex characters of
 * sha256 over `hsid`, a 0x00 byte, `dim`, a 0x00 byte and `opId`, as UTF-8. The input is unambiguous (none of
 * the three may hold a 0x00) and names the dimension, so the same `opId` in another session or dimension is
 * another oid. `null` when any part is out of its form. The model's string itself is never stored.
 */
export function dimOpOid(hsid: unknown, dim: unknown, opId: unknown): string | null {
  if (!NON_EMPTY(hsid) || hsid.includes('\u0000') || typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim) || typeof opId !== 'string' || !DIM_OP_ID_PATTERN.test(opId)) return null;
  return sha256Tagged(`${hsid}\u0000${dim}\u0000${opId}`).slice('sha256:'.length, 'sha256:'.length + 16);
}

/** The bounded hand of one stored row (`dimViewBy` of the fold's own reading of its stamp), for a change list. */
export function dimRowBy(row: DimRow): DimBy {
  try {
    return dimViewBy(isPlainObject(row?.payload) ? byOf(row.payload) : UNKNOWN_BY);
  } catch {
    return { ...UNKNOWN_BY };
  }
}

/* ── the published hash vector ────────────────────────────────────────────── */

/**
 * One fixed vector, published in the client API descriptor: these rows fold to this hash. A changed fold or
 * hash layout breaks the vector, and a changed vector moves `clientApiId`.
 */
export const DIM_HASH_VECTOR_ROWS: readonly DimRow[] = deepFreeze([
  {
    seq: 1,
    kind: DIM_KINDS.start,
    payload: { v: 1, dim: 'dim:01JD1MVECT0R00000000000001', title: 'Vector', attached: ['hsid-vector'], opened: 'command', relayedFor: { principal: 'p:vector/human', connId: 'conn:01JD1MVECT0R00000000000002', surface: 'gui' } },
  },
  {
    seq: 2,
    kind: DIM_KINDS.op,
    payload: {
      v: 1,
      dim: 'dim:01JD1MVECT0R00000000000001',
      ops: [
        { type: 'add', node: { id: '01JD1MVECT0R000000000000A1', kind: 'frame', x: 0, y: 0, z: 'V', w: 640, h: 480, title: 'Plan' } },
        { type: 'add', node: { id: '01JD1MVECT0R000000000000A2', kind: 'rect', x: 40, y: 40, z: 'W', w: 200, h: 120, fill: 'lemon', label: 'One', parent: '01JD1MVECT0R000000000000A1' } },
      ],
      relayedFor: { principal: 'p:vector/human', connId: 'conn:01JD1MVECT0R00000000000002', surface: 'gui' },
    },
  },
  {
    seq: 3,
    kind: DIM_KINDS.op,
    payload: {
      v: 1,
      dim: 'dim:01JD1MVECT0R00000000000001',
      ops: [
        { type: 'add', node: { id: '01JD1MVECT0R000000000000B1', kind: 'text', x: 300, y: 60, z: 'X', text: 'Two', color: 'cobalt', refs: ['sym:#dimension-mod'] } },
        { type: 'add', node: { id: '01JD1MVECT0R000000000000B2', kind: 'arrow', x: 240, y: 100, z: 'Y', points: [0, 0, 60, -20], head: 'end', from: '01JD1MVECT0R000000000000A2', to: '01JD1MVECT0R000000000000B1', rel: 'leads-to' } },
      ],
      relayedFor: { principal: 'p:vector/session', surface: 'bridge', agent: 'vector-agent', hsid: 'hsid-vector', turn: 'turn:hsid-vector/1' },
    },
    causes: ['turn:hsid-vector/1'],
  },
  {
    seq: 4,
    kind: DIM_KINDS.op,
    payload: {
      v: 1,
      dim: 'dim:01JD1MVECT0R00000000000001',
      ops: [
        { type: 'update', id: '01JD1MVECT0R000000000000A2', patch: { label: 'First', fill: null } },
        { type: 'move', ids: ['01JD1MVECT0R000000000000B1'], dx: 10, dy: -5 },
        { type: 'add', node: { id: '01JD1MVECT0R000000000000C1', kind: 'stroke', x: 5, y: 5, z: 'Z', points: [0, 0, 3, 4] } },
        { type: 'delete', id: '01JD1MVECT0R000000000000C1' },
      ],
      relayedFor: { principal: 'p:vector/human', surface: 'cli' },
    },
  },
  // the unknown hand, three ways (cls is hashed): no stamp at all; a tool surface with no agent; an unentitled
  // mod's tool row, which carries no principal
  {
    seq: 5,
    kind: DIM_KINDS.op,
    payload: { v: 1, dim: 'dim:01JD1MVECT0R00000000000001', ops: [{ type: 'add', node: { id: '01JD1MVECT0R000000000000D1', kind: 'ellipse', x: 400, y: 300, z: 'W1', w: 40, h: 40 } }] },
  },
  {
    seq: 6,
    kind: DIM_KINDS.op,
    payload: { v: 1, dim: 'dim:01JD1MVECT0R00000000000001', ops: [{ type: 'add', node: { id: '01JD1MVECT0R000000000000D2', kind: 'diamond', x: 460, y: 300, z: 'W2', w: 40, h: 40 } }], relayedFor: { principal: 'p:vector/session', surface: 'bridge' } },
  },
  {
    seq: 7,
    kind: DIM_KINDS.op,
    payload: { v: 1, dim: 'dim:01JD1MVECT0R00000000000001', ops: [{ type: 'add', node: { id: '01JD1MVECT0R000000000000D3', kind: 'text', x: 520, y: 300, z: 'W3', text: 'Three' } }], relayedFor: { surface: 'bridge', agent: 'other-agent' } },
  },
]);
export const DIM_HASH_VECTOR_HASH = 'sha256:d8b171c96fbdc391befc39a0553896a842f503ac8cc094ad4581f003fed4b596' as const;
