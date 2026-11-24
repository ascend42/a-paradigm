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
import { contentColourCheck, type ContentRole } from './content-palette.js';
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

/** `by` from the host stamp, or the unknown hand when the stamp is missing or malformed. */
function byOf(payload: Record<string, unknown>): DimBy {
  const r = payload.relayedFor;
  if (!isPlainObject(r) || !NON_EMPTY(r.principal) || !(DIM_SURFACES as readonly unknown[]).includes(r.surface)) return UNKNOWN_BY;
  if (r.agent === undefined) return { cls: 'human', principal: r.principal };
  if (!NON_EMPTY(r.agent)) return UNKNOWN_BY;
  return { cls: 'agent', principal: r.principal, agent: r.agent };
}

function hsidOf(attached: readonly string[], payload: unknown): string | null {
  const r = isPlainObject(payload) ? payload.relayedFor : undefined;
  if (isPlainObject(r) && NON_EMPTY(r.hsid)) return r.hsid;
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

/** Fold one row. Pure: the input state is not changed. Never throws. */
export function foldDimRow(state: DimState, row: DimRow): DimState {
  const d = draftOf(state);
  try {
    applyRow(d, row);
  } catch {
    return { ...state, unapplied: state.unapplied + 1 };
  }
  return d;
}

/** Fold rows in order, optionally stopping after `upToSeq`. `from` continues an earlier fold (chunked replay). */
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

/**
 * A key strictly between `a` and `b` by digit-wise midpoint (`null` is an open end). The result never ends in
 * `0`. Keys compare by code unit, so they sort the same in JS, SQLite and JSON, and a reorder is one `update`
 * of one node. Throws RangeError when a key is malformed or `a` is not below `b`: that is a caller bug.
 */
export function dimZBetween(a: string | null, b: string | null): string {
  if ((a !== null && !DIM_Z_PATTERN.test(a)) || (b !== null && !DIM_Z_PATTERN.test(b))) throw new RangeError('dimZBetween: malformed key');
  if (a !== null && b !== null && !(a < b)) throw new RangeError('dimZBetween: keys out of order');
  return zMid(a ?? '', b);
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

/** NFKC, then every control, format, line-separator and paragraph-separator code point removed. */
export function dimTextForScan(s: string): string {
  return s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '');
}

const fieldName = (k: string): string => (DIM_FIELDS.includes(k) ? k : 'unknown');
const isCoreKind = (k: unknown): k is DimCoreKind => typeof k === 'string' && (DIM_CORE_KINDS as readonly string[]).includes(k);
const inRange = (v: unknown, lo: number, hi: number): boolean => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;

type Problem = { field: string; code: DimRefusalCode; swatch?: string };

/** Check one node field value against the running state. `self` is the node's own id. */
function checkField(d: Draft, kind: DimCoreKind, self: string, key: string, v: unknown): Problem[] {
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
      const c = contentColourCheck(v, role);
      return c.ok ? [] : bad('colour-bad', c.offer ? { swatch: c.offer } : {});
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
      touched.push(id as string);
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

/** Node fields whose values are fixed patterns, not free text: left out of the joined scan. */
const STRUCTURAL_KEYS = new Set(['id', 'kind', 'z', 'parent', 'from', 'to', 'color', 'fill', 'head']);

/**
 * Validate a batch of ops against a state, in order, against a running copy (a later op may cite an id an
 * earlier op added). Returns the ops that may be appended and one refusal per problem. A secret hit anywhere
 * refuses the whole batch (`ok: []`, `secret: true`).
 *
 * The secret check reads every string at any depth of every op, and for each node an op touches every string of
 * the node as it would stand, their concatenation and each ordered pair of them, so a credential split over two
 * updates or two fields of one node is found. Stated residual: a credential split across two NODES, or broken
 * by ordinary spaces, is not found.
 */
export function validateDimOps(state: DimState, ops: unknown, actor: DimActor, opts: { scan?: (text: string) => readonly string[] } = {}): DimValidation {
  const refuse = (index: number, p: Problem, extra: Partial<DimRefusal> = {}): DimRefusal => ({
    index,
    field: fieldName(p.field),
    code: p.code,
    fix: DIM_REFUSAL_FIXES[p.code],
    ...(p.swatch !== undefined ? { swatch: p.swatch } : {}),
    ...extra,
  });
  if (!Array.isArray(ops)) return { ok: [], refused: [refuse(-1, { field: 'ops', code: 'field-type' })], secret: false };
  if (ops.length > DIM_LIMITS.opsPerRow) return { ok: [], refused: [refuse(-1, { field: 'ops', code: 'too-many-ops' })], secret: false };
  const scan = opts.scan ?? secretKindsIn;
  const hits = (text: string): readonly string[] => {
    const norm = dimTextForScan(text);
    const a = scan(norm);
    return norm === text ? a : [...new Set([...a, ...scan(text)])];
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
    stringsOf(isPlainObject(op) ? (op.type === 'add' ? op.node : op.type === 'update' ? op.patch : op) : op, 'unknown', own);
    for (const s of own) note(s.field, s.text);
    const { problems, touched } = checkOp(d, op, actor);
    // the node as it would stand after this op, whether or not the op passes the other checks
    const trial = problems.length === 0 ? d : draftOf(d);
    const applied = applyOp(trial, op, by, null, d.seq);
    if (seen.size === 0) {
      for (const id of touched) {
        const node = trial.nodes.get(id)?.node;
        if (!node) continue;
        const free: Array<{ field: string; text: string }> = [];
        for (const k of Object.keys(node).sort()) if (!STRUCTURAL_KEYS.has(k)) stringsOf(node[k], fieldName(k), free, 1);
        if (free.length < 2) continue;
        note('unknown', free.map((s) => s.text).join(''));
        for (const a of free) for (const b of free) if (a !== b) note('unknown', a.text + b.text);
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

export interface DimViewNode {
  id: string;
  kind: string;
  /** false: a kind this version does not know; only id, kind, x, y and by are shown */
  core: boolean;
  by: DimBy;
  [field: string]: unknown;
}
export interface DimView {
  v: 1;
  dim: string | null;
  title: string;
  seq: number;
  nodes: DimViewNode[];
  legend: string[];
}

const viewable = (v: unknown): boolean =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.every((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))));

/**
 * The view of a state. A core node shows its `DIM_NODE_KEYS` fields and `by`. Any other node shows only id, the
 * pattern-checked kind name, x, y and `by`. Carried-through fields are left out entirely, and the legend is
 * built from kind names and `by` classes only.
 */
export function dimViewOf(state: DimState): DimView {
  const entries = [...state.nodes.entries()].sort((a, b) => dimZCompare({ z: a[1].node.z, id: a[0] }, { z: b[1].node.z, id: b[0] }));
  const kinds = new Map<string, number>();
  const hands = new Map<string, number>();
  const nodes: DimViewNode[] = [];
  for (const [id, n] of entries) {
    const by: DimBy = { cls: n.by.cls, principal: n.by.principal, ...(n.by.agent !== undefined ? { agent: n.by.agent } : {}) };
    const core = isCoreKind(n.node.kind);
    const out: DimViewNode = { id, kind: dimKindName(n.node.kind), core, by };
    const keys = core ? DIM_NODE_KEYS[n.node.kind as DimCoreKind] : ['x', 'y'];
    for (const k of keys) {
      if (k === 'id' || k === 'kind') continue;
      const v = n.node[k];
      if (core ? viewable(v) : typeof v === 'number' && Number.isFinite(v)) out[k] = Array.isArray(v) ? [...v] : v;
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
  return { v: 1, dim: state.dim, title: state.title, seq: state.seq, nodes, legend };
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
]);
export const DIM_HASH_VECTOR_HASH = 'sha256:f8aca26992fe143d58e3078b588350aa78518e4c657146283699a8aacbea5ff3' as const;
