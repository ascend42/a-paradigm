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
 *    value, a colour that fails the palette check, a ref outside the allowlist, an edit by an actor that is not a
 *    well-formed hand (`dimMayEdit`), and any text that matches a secret rule (op rows cannot be deleted later).
 *    Any well-formed hand may edit any mark, whoever drew it (S1.4 edit-anything); every change is attributed in
 *    the fold (`changedBy`, `otherBy`, `wordsBy`, `restoredFrom`, outside the hash) and can be undone
 *    (`planDimUndo`).
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
/**
 * One node of the fold. `by` is the hand that ADDED it and never changes. The optional attribution fields (S1.4
 * edit-anything, Aegis rulings 2 and 4: G1, G5) are set ONLY by the fold's `applyOp` when an op actually applies;
 * an add sets none of them but `restoredFrom`. They are OUTSIDE the hash (`dimCanonical` hashes `{by, node}`
 * only), so "checked up to" vouches for content and adder, never for attribution: that is vouched for only by
 * `dimAttrDigest`.
 *  - `changedBy`, `changedSeq`, `changedHsid`: the newest applied update or move, by any hand.
 *  - `otherBy`, `otherSeq`: the newest applied update or move by a hand that is not `by`. It survives a later
 *    change by `by` itself, so "who changed what" never silently disappears.
 *  - `wordsBy`, `wordsSeq` (G1): the newest applied update by a hand that is not `by` that wrote or cleared a
 *    free-text field (`text`, `label`, `title`, `refs`). A later restyle by another hand does not move it.
 *  - `otherBy` and `wordsBy` compare the editor with the ORIGINAL hand (`restoredFrom.by ?? by`, Aegis I-2), so
 *    an undoer who re-added a mark and then rewrites it is still a hand other than the mark's own.
 *  - On a re-add, `wordsBy` and `otherBy` are carried over from the deleted mark through the honoured restored
 *    entry (Aegis I-1), so another hand's words never turn into the undoer's by a delete and an undo.
 *  - `restoredFrom` (G5): on a node re-added by an undo, the old id and the ORIGINAL hand, read from the row's
 *    undo marker through `dimUndoMarkOf` only (never from an op).
 */
export interface DimFoldNode {
  node: Record<string, unknown>;
  by: DimBy;
  hsid: string | null;
  addedSeq: number;
  changedBy?: DimBy;
  changedSeq?: number;
  changedHsid?: string | null;
  otherBy?: DimBy;
  otherSeq?: number;
  wordsBy?: DimBy;
  wordsSeq?: number;
  restoredFrom?: { id: string; by: DimBy };
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

/** Two hands are the same hand: the same class, principal and agent label. */
function sameHand(a: DimBy, b: DimBy): boolean {
  return a.cls === b.cls && a.principal === b.principal && a.agent === b.agent;
}

/** The free-text fields of a node: writing or clearing one by another hand sets `wordsBy` (Aegis G1). */
const WORDS_KEYS = new Set(['text', 'label', 'title', 'refs']);

/** The attribution of an applied update or move (see `DimFoldNode`). */
function changed(cur: DimFoldNode, node: Record<string, unknown>, by: DimBy, hsid: string | null, seq: number, words: boolean): DimFoldNode {
  const out: DimFoldNode = { ...cur, node, changedBy: by, changedSeq: seq, changedHsid: hsid };
  // the ORIGINAL hand (Aegis I-2): on a mark re-added by an undo, `by` is the undoer, not whose mark it was
  const original = cur.restoredFrom?.by ?? cur.by;
  if (!sameHand(by, original)) {
    out.otherBy = by;
    out.otherSeq = seq;
    if (words) {
      out.wordsBy = by;
      out.wordsSeq = seq;
    }
  }
  return out;
}

/**
 * Apply one op to the draft by the tolerant rules. Returns false when nothing was applied. `restored` maps a
 * re-added node's new id to what it was restored from (the row's honoured undo marker, `dimUndoMarkOf`).
 */
function applyOp(d: Draft, op: unknown, by: DimBy, hsid: string | null, seq: number, restored?: ReadonlyMap<string, { id: string; by: DimBy; wordsBy?: DimBy; otherBy?: DimBy }>): boolean {
  if (!isPlainObject(op)) return false;
  switch (op.type) {
    case 'add': {
      const node = op.node;
      if (!isPlainObject(node) || typeof node.id !== 'string' || d.nodes.has(node.id) || d.gone.has(node.id)) return false;
      const from = restored?.get(node.id);
      const fresh: DimFoldNode = { node: copyJson(node) as Record<string, unknown>, by, hsid, addedSeq: seq };
      if (from) {
        // G5 and I-1: the original hand, and who had written into or changed the mark before it was deleted
        fresh.restoredFrom = { id: from.id, by: from.by };
        if (from.wordsBy) (fresh.wordsBy = from.wordsBy), (fresh.wordsSeq = seq);
        if (from.otherBy) (fresh.otherBy = from.otherBy), (fresh.otherSeq = seq);
      }
      d.nodes.set(node.id, fresh);
      return true;
    }
    case 'update': {
      const cur = typeof op.id === 'string' ? d.nodes.get(op.id) : undefined;
      if (!cur || !isPlainObject(op.patch)) return false;
      const node = { ...cur.node };
      let words = false;
      for (const k of Object.keys(op.patch)) {
        if (k === 'id' || k === 'kind' || DROPPED_KEYS.has(k)) continue;
        const v = op.patch[k];
        if (v === null) delete node[k];
        else if (v !== undefined) node[k] = copyJson(v);
        if (v !== undefined && WORDS_KEYS.has(k)) words = true;
      }
      d.nodes.set(op.id as string, changed(cur, node, by, hsid, seq, words));
      return true;
    }
    case 'move': {
      if (!Array.isArray(op.ids) || !Number.isSafeInteger(op.dx) || !Number.isSafeInteger(op.dy)) return false;
      let moved = false;
      for (const id of op.ids) {
        const cur = typeof id === 'string' ? d.nodes.get(id) : undefined;
        if (!cur || typeof cur.node.x !== 'number' || typeof cur.node.y !== 'number') continue;
        d.nodes.set(id as string, changed(cur, { ...cur.node, x: cur.node.x + (op.dx as number), y: cur.node.y + (op.dy as number) }, by, hsid, seq, false));
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
  // G5: a node this row re-adds through an undo carries what it was restored from, read by the one reader only
  const mark = own(p, 'undo') !== undefined ? dimUndoMarkOf(row) : null;
  const restored = mark && mark.restored.length > 0 ? new Map(mark.restored.map((r) => [r.newId, { id: r.oldId, by: r.by, ...(r.wordsBy ? { wordsBy: r.wordsBy } : {}), ...(r.otherBy ? { otherBy: r.otherBy } : {}) }])) : undefined;
  for (const op of p.ops) {
    if (applyOp(d, op, by, hsid, d.seq, restored)) d.ops += 1;
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
 * counters, so the same ops replayed at other seqs hash the same. Strings are hashed as stored. Also left out
 * (S1.4 edit-anything, Aegis ruling 2): the attribution fields `changedBy`, `changedSeq`, `changedHsid`,
 * `otherBy`, `otherSeq`, `wordsBy`, `wordsSeq` and `restoredFrom`. The hash vouches for content and adder only;
 * attribution is vouched for by `dimAttrDigest`.
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

/** A hand as the digests read it: its three strings, or the unknown hand. Never throws. */
function handKey(by: unknown): Record<string, string> | null {
  if (by === undefined) return null;
  if (!isPlainObject(by)) return { cls: 'unknown', principal: 'unknown' };
  const cls = own(by, 'cls');
  const principal = own(by, 'principal');
  const agent = own(by, 'agent');
  if (typeof cls !== 'string' || typeof principal !== 'string' || (agent !== undefined && typeof agent !== 'string')) return { cls: 'unknown', principal: 'unknown' };
  return { cls, principal, ...(agent !== undefined ? { agent } : {}) };
}

/**
 * The attribution digest (S1.4 edit-anything, Aegis G7): `sha256:` + hex over `(id, changedBy, otherBy, wordsBy,
 * restoredFrom)` of every node that carries any of them, in id order. UNHASHED in the sense of the contract: it is
 * not `dimHash`, not in the client API descriptor and moves no id. `dimHash` vouches for content and adder;
 * this vouches for attribution: the mod and the page run the one fold, so two sides that fold the same rows with
 * the same stamps answer the same digest, and a row whose stamp differs between them shows here while `dimHash`
 * still matches. Seqs and `changedHsid` are left out (the same ops replayed at other seqs digest the same).
 * Pure, never throws.
 */
export function dimAttrDigest(state: DimState): string {
  const nodes: unknown[] = [];
  try {
    const ids = [...state.nodes.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const id of ids) {
      const n = state.nodes.get(id)!;
      const rf: unknown = n.restoredFrom;
      const restored = isPlainObject(rf) ? { id: typeof own(rf, 'id') === 'string' ? own(rf, 'id') : null, by: handKey(own(rf, 'by')) } : null;
      const entry = [id, handKey(n.changedBy), handKey(n.otherBy), handKey(n.wordsBy), restored];
      if (entry.slice(1).some((x) => x !== null)) nodes.push(entry);
    }
  } catch {
    return sha256Tagged(canonicalJson({ schema: 'dim-attr:v1', unreadable: true }));
  }
  return sha256Tagged(canonicalJson({ schema: 'dim-attr:v1', nodes }));
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
  'not-owner': 'This board no longer refuses an edit for the hand that drew a mark; view the board again and retry.',
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

type Problem = { field: string; code: DimRefusalCode; swatch?: string };

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

/**
 * May this actor edit (update, move or delete) a core mark? S1.4 edit-anything (founder decision TD-2026-11-26-715;
 * Aegis E0): ANY well-formed hand may edit ANY mark, whoever drew it. The hand that drew a node is no longer
 * compared. Fails closed: true only for a human with a non-empty principal, or an agent with a non-empty principal
 * AND a non-empty agent label; `null`, an unknown class, an empty principal, an agent with no label or a human
 * that carries an `agent` key is false.
 * The refusal for a false answer stays `not-owner` (the code is hashed in the client API descriptor, so it keeps its
 * place in DIM_REFUSAL_CODES; no well-formed actor reaches it).
 */
export function dimMayEdit(actor: unknown): boolean {
  if (!isPlainObject(actor)) return false;
  const cls = own(actor, 'cls');
  if (!NON_EMPTY(own(actor, 'principal'))) return false;
  // a human hand carries no agent label, as the fold's `byOf` reads a stamp (Judge nit 7)
  if (cls === 'human') return !Object.prototype.hasOwnProperty.call(actor, 'agent');
  return cls === 'agent' && NON_EMPTY(own(actor, 'agent'));
}

/** An existing node an op may edit: live, of a core kind, and the actor a well-formed hand (`dimMayEdit`). */
function editable(d: Draft, actor: DimActor, id: unknown, field: string): { cur: DimFoldNode; kind: DimCoreKind } | Problem {
  if (typeof id !== 'string' || !DIM_NODE_ID_PATTERN.test(id)) return { field, code: 'id-bad' };
  const cur = d.nodes.get(id);
  if (!cur) return { field, code: 'id-missing' };
  if (!dimMayEdit(actor)) return { field, code: 'not-owner' };
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
    fix: DIM_REFUSAL_FIXES[p.code],
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
    // the trial sets attribution on the running copy (or its own copy) only, never on the caller's state
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
 * A reader must tolerate every field but `id`, `kind`, `core` and `by` being absent. Any node, core or not, may
 * also carry the attribution fields (`changedBy`, `otherBy`, `wordsBy`, `restoredFrom`; S1.4 E0).
 */
export interface DimViewNode {
  /** always DIM_NODE_ID_PATTERN: a node stored under any other id is not in the view */
  id: string;
  kind: string;
  /** false: a kind this version does not know; only id, kind, x, y, by and the attribution fields are shown */
  core: boolean;
  by: DimBy;
  /**
   * Attribution (S1.4 edit-anything; Aegis G1, G5), each shown only when the fold holds it and each hand bounded by
   * `dimViewBy`. Seqs are not shown. `restoredFrom.id` is shown only when it matches DIM_NODE_ID_PATTERN, else the
   * whole entry is left out. None is hashed; no stored node field can collide (fields are DIM_NODE_KEYS only).
   */
  changedBy?: DimBy;
  otherBy?: DimBy;
  wordsBy?: DimBy;
  restoredFrom?: { id: string; by: DimBy };
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
 * The view of a state. A core node shows its `DIM_NODE_KEYS` fields, `by` and, when the fold holds them, the
 * attribution `changedBy`, `otherBy`, `wordsBy` and `restoredFrom` (every hand through `dimViewBy`), each field only when its stored
 * value passes today's write check (`viewField`). Any other node shows only id, the pattern-checked kind name, its attribution,
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
    if (n.changedBy !== undefined) out.changedBy = dimViewBy(n.changedBy);
    if (n.otherBy !== undefined) out.otherBy = dimViewBy(n.otherBy);
    if (n.wordsBy !== undefined) out.wordsBy = dimViewBy(n.wordsBy);
    const rf: unknown = n.restoredFrom;
    if (isPlainObject(rf) && viewId(own(rf, 'id')) !== undefined) out.restoredFrom = { id: own(rf, 'id') as string, by: dimViewBy(own(rf, 'by')) };
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

/* ── change-set and undo markers (S1.4 edit-anything; Aegis ruling 3; NOT in the client API descriptor) ── */

/**
 * Two payload keys an op row may carry beside `v`, `dim`, `ops` and `relayedFor`, written by the dimension mod
 * only (E1): `act` (a person's action id) and `undo` (what an undo row undid). Neither is read by the fold's hash,
 * and no op key, kind or refusal code is added for them. These readers are the ONE way to honour them; a marker
 * they do not honour means nothing. Own keys only, pattern-checked, capped; never throw.
 */
/** A person's action id: a ULID, as a node id. */
export const DIM_ACT_PATTERN = DIM_NODE_ID_PATTERN;
/** At most this many ids (`undo.ids`) and restored entries (`undo.restored`) are honoured on one marker. */
export const DIM_UNDO_MARK_LIMITS = Object.freeze({ ids: 64, restored: 64 });
/** The `<n>` of `turn:<hsid>/<n>`, as the mod's `toolActorOf` reads it. */
const TURN_N = /^[1-9][0-9]{0,14}$/;
const HSID_MAX = 128;

/** An op row's payload and its stamp, or null (another kind, no payload). */
function opPayloadOf(row: unknown): Record<string, unknown> | null {
  if (!isPlainObject(row) || own(row, 'kind') !== DIM_KINDS.op) return null;
  const p = own(row, 'payload');
  return isPlainObject(p) ? p : null;
}

/** `turn` when it is exactly `turn:<hsid>/<n>` of this hsid, else null. */
function turnOf(hsid: unknown, turn: unknown): string | null {
  if (!NON_EMPTY(hsid) || hsid.length > HSID_MAX || typeof turn !== 'string') return null;
  const prefix = `turn:${hsid}/`;
  return turn.startsWith(prefix) && TURN_N.test(turn.slice(prefix.length)) ? turn : null;
}

/** A person's action of one op row. */
export interface DimAct {
  principal: string;
  act: string;
}
/**
 * The person's action an op row belongs to, or null. Honoured ONLY on a row stamped by a person on the Gnomon
 * window: the stamp folds as the human hand, `surface: 'gui'`, and no `agent` key. An `act` on any other row (an
 * agent's, a cli one, an unstamped one) is ignored. The identity is `(principal, act)`, never `act` alone: a second
 * person reusing the first person's act id is another action.
 */
export function dimActOf(row: DimRow): DimAct | null {
  try {
    const p = opPayloadOf(row);
    if (!p) return null;
    const act = own(p, 'act');
    if (typeof act !== 'string' || !DIM_ACT_PATTERN.test(act)) return null;
    const r = own(p, 'relayedFor');
    if (!isPlainObject(r) || own(r, 'surface') !== 'gui' || Object.prototype.hasOwnProperty.call(r, 'agent')) return null;
    const by = byOf(p);
    return by.cls === 'human' ? { principal: by.principal, act } : null;
  } catch {
    return null;
  }
}

/** The change-set (undo unit) of one op row: a person's action, or an agent session's turn. */
export type DimChangeSet = { kind: 'act'; principal: string; act: string } | { kind: 'turn'; hsid: string; turn: string };
/**
 * The change-set an op row belongs to, or null (a row no undo can name). A person's set is `(principal, act)`
 * (`dimActOf`). An agent's set is `(stamp.hsid, turn)`, honoured only on a row whose stamp folds as an agent hand and
 * whose `turn` is exactly `turn:<stamp.hsid>/<n>`; an `act` on such a row is ignored.
 */
export function dimChangeSetOf(row: DimRow): DimChangeSet | null {
  try {
    const a = dimActOf(row);
    if (a) return { kind: 'act', principal: a.principal, act: a.act };
    const p = opPayloadOf(row);
    if (!p || byOf(p).cls !== 'agent') return null;
    const r = own(p, 'relayedFor') as Record<string, unknown>;
    const hsid = own(r, 'hsid');
    const turn = turnOf(hsid, own(r, 'turn'));
    return turn ? { kind: 'turn', hsid: hsid as string, turn } : null;
  } catch {
    return null;
  }
}

/** One honoured restored entry: the re-added node's new id, the id it was restored from, and the ORIGINAL hand. */
export interface DimRestored {
  newId: string;
  oldId: string;
  /** bounded by `dimViewBy`: a hand outside the view patterns is the unknown hand (fails closed, never human) */
  by: DimBy;
  /** Aegis I-1: the deleted mark's `wordsBy` and `otherBy`, carried to the re-add; each bounded by `dimViewBy` */
  wordsBy?: DimBy;
  otherBy?: DimBy;
}
export interface DimUndoMark {
  of: DimChangeSet;
  /** the scope the undo was asked for, when it was */
  ids?: string[];
  restored: DimRestored[];
}
/**
 * The undo marker of an op row, or null. `undo: {of, ids?, restored?}`:
 *  - the row must be an op row stamped by a person on the Gnomon window (`surface: 'gui'`, no `agent` key) or by an
 *    agent (a stamp that folds as the agent hand); any other marker (a cli row, an unstamped row) is ignored;
 *  - the marker's own keys are exactly `of`, `ids?` and `restored?`; any other key makes it null;
 *  - `of` is honoured only in its two forms, with exactly these own keys: `{hsid, turn}` with `turn` exactly
 *    `turn:<hsid>/<n>`, or `{principal, act}` with a non-empty principal and a ULID act; else the marker is null;
 *  - `ids`, when present, is 1 to 64 distinct node ids, else the marker is null;
 *  - `restored` is at most 64 entries (more: the marker is null); each entry `[newId, oldId, by, wordsBy?, otherBy?]`
 *    (the last two `null` or left out when the deleted mark had none) is honoured only
 *    when both are node ids, `newId` is the id of an `add` op IN THE SAME ROW, and no earlier entry named it. An
 *    entry that fails is dropped by itself. `by` is bounded by `dimViewBy`.
 * The fold reads `restored` through this reader only (`restoredFrom`); it never changes `by`.
 */
export function dimUndoMarkOf(row: DimRow): DimUndoMark | null {
  try {
    const p = opPayloadOf(row);
    if (!p) return null;
    // the stamp rule of `act` (Judge nit 7): a person on the Gnomon window (gui, no agent key), or an agent stamp
    const hand = byOf(p);
    const r = own(p, 'relayedFor');
    if (hand.cls === 'unknown' || !isPlainObject(r)) return null;
    if (hand.cls === 'human' && (own(r, 'surface') !== 'gui' || Object.prototype.hasOwnProperty.call(r, 'agent'))) return null;
    const u = own(p, 'undo');
    if (!isPlainObject(u)) return null;
    for (const k of Object.keys(u)) if (k !== 'of' && k !== 'ids' && k !== 'restored') return null;
    const o = own(u, 'of');
    if (!isPlainObject(o)) return null;
    const ok = Object.keys(o).sort().join(',');
    let of: DimChangeSet;
    if (ok === 'hsid,turn') {
      const turn = turnOf(own(o, 'hsid'), own(o, 'turn'));
      if (!turn) return null;
      of = { kind: 'turn', hsid: own(o, 'hsid') as string, turn };
    } else if (ok === 'act,principal') {
      const principal = own(o, 'principal');
      const act = own(o, 'act');
      if (!NON_EMPTY(principal) || typeof act !== 'string' || !DIM_ACT_PATTERN.test(act)) return null;
      of = { kind: 'act', principal, act };
    } else return null;
    const out: DimUndoMark = { of, restored: [] };
    const ids = own(u, 'ids');
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > DIM_UNDO_MARK_LIMITS.ids || new Set(ids).size !== ids.length) return null;
      if (!ids.every((x) => typeof x === 'string' && DIM_NODE_ID_PATTERN.test(x))) return null;
      out.ids = [...(ids as string[])];
    }
    const restored = own(u, 'restored');
    if (restored !== undefined) {
      if (!Array.isArray(restored) || restored.length > DIM_UNDO_MARK_LIMITS.restored) return null;
      const ops = own(p, 'ops');
      const added = new Set<string>();
      if (Array.isArray(ops)) {
        for (const op of ops) {
          if (!isPlainObject(op) || own(op, 'type') !== 'add') continue;
          const node = own(op, 'node');
          const nid = isPlainObject(node) ? own(node, 'id') : undefined;
          if (typeof nid === 'string') added.add(nid);
        }
      }
      const seen = new Set<string>();
      for (const e of restored) {
        if (!Array.isArray(e) || e.length < 3 || e.length > 5) continue;
        const [newId, oldId, by, wordsBy, otherBy] = e as unknown[];
        if (typeof newId !== 'string' || typeof oldId !== 'string' || !DIM_NODE_ID_PATTERN.test(newId) || !DIM_NODE_ID_PATTERN.test(oldId)) continue;
        if (!added.has(newId) || seen.has(newId) || newId === oldId) continue;
        seen.add(newId);
        out.restored.push({ newId, oldId, by: dimViewBy(by), ...(wordsBy != null ? { wordsBy: dimViewBy(wordsBy) } : {}), ...(otherBy != null ? { otherBy: dimViewBy(otherBy) } : {}) });
      }
    }
    return out;
  } catch {
    return null;
  }
}

/* ── the undo planner (S1.4 edit-anything; Aegis ruling 4, G3, G5; NOT in the client API descriptor) ── */

const LINK_KEYS = ['from', 'to', 'parent'] as const;

/**
 * What happened to the board after the change-set's rows. Every entry holds the NEWEST seq at which a later row did
 * it, so the planner asks "changed after THIS set row?" (Judge I-2: a row of another hand landing between two rows
 * of the set wins over the earlier row's inverse). A row with no integer seq counts as after every set row.
 */
interface DimLater {
  /** id → field → newest seq a later row changed it */
  fields: Map<string, Map<string, number>>;
  /** id → newest seq any later row updated, moved or deleted it */
  touched: Map<string, number>;
  /** id → newest seq a later row deleted it */
  deleted: Map<string, number>;
  /** old ids an undo already restored, whose re-add stands (a marker whose re-add failed counts for nothing) */
  restoredOld: Set<string>;
  /** marks a continuation row of THIS set (an earlier call's undo row) already undid: left out silently */
  done: Set<string>;
}

const sameSet = (a: DimChangeSet, b: DimChangeSet): boolean =>
  a.kind === 'act' ? b.kind === 'act' && a.principal === b.principal && a.act === b.act : b.kind === 'turn' && a.hsid === b.hsid && a.turn === b.turn;

function laterOf(after: Iterable<DimRow>, current: DimState, setSeqs: ReadonlySet<number>, o: { of?: DimChangeSet; undoer?: DimBy; setDeleted?: ReadonlySet<string> } = {}): DimLater {
  const of = o.of;
  const out: DimLater = { fields: new Map(), touched: new Map(), deleted: new Map(), restoredOld: new Set(), done: new Set() };
  // Aegis N-1: every honoured restored entry with its marker row's seq, judged AFTER the loop, when every later
  // delete is known; `dels` holds the newest delete of each id by ANY row, continuation rows included
  const entries: Array<{ newId: string; oldId: string; seq: number; continuation: boolean }> = [];
  const dels = new Map<string, number>();
  const newest = (m: Map<string, number>, id: string, seq: number): void => {
    if (!(m.get(id)! >= seq)) m.set(id, seq);
  };
  const field = (id: unknown, k: string, seq: number): void => {
    if (typeof id !== 'string') return;
    newest(out.touched, id, seq);
    let f = out.fields.get(id);
    if (!f) out.fields.set(id, (f = new Map()));
    if (!(f.get(k)! >= seq)) f.set(k, seq);
  };
  try {
    for (const row of after) {
      const p = opPayloadOf(row);
      if (!p) continue;
      const seq = Number.isSafeInteger(row.seq) ? row.seq : Number.POSITIVE_INFINITY;
      if (setSeqs.has(seq)) continue; // a row of the set itself is never a later change
      const ops = own(p, 'ops');
      const mark = own(p, 'undo') !== undefined ? dimUndoMarkOf(row) : null;
      if (Array.isArray(ops)) for (const op of ops) if (isPlainObject(op) && own(op, 'type') === 'delete' && typeof own(op, 'id') === 'string') newest(dels, own(op, 'id') as string, seq);
      // Aegis N-2: a continuation is bound to the undoer's hand when the caller names it
      const continuation = !!of && !!mark && sameSet(mark.of, of) && (!o.undoer || sameHand(byOf(p), o.undoer));
      if (mark) for (const r of mark.restored) entries.push({ newId: r.newId, oldId: r.oldId, seq, continuation });
      if (continuation && mark) {
        // a continuation (Judge I-3): an earlier call of THIS undo. Its marks are done, never a conflict. A link
        // re-point it wrote belongs to that re-add's mark only when it names a re-added node whose old id is one the
        // SET deleted (Aegis N-2); its restored old ids are done only when the re-add stands (after the loop).
        const fresh = new Map(mark.restored.map((r) => [r.newId, r.oldId]));
        const ours = (v: unknown): boolean => typeof v === 'string' && fresh.has(v) && !!o.setDeleted?.has(fresh.get(v)!);
        if (Array.isArray(ops)) {
          for (const op of ops) {
            if (!isPlainObject(op)) continue;
            const type = own(op, 'type');
            if (type === 'update' && isPlainObject(own(op, 'patch'))) {
              const patch = own(op, 'patch') as Record<string, unknown>;
              const repoint = Object.keys(patch).length > 0 && Object.keys(patch).every((k) => (LINK_KEYS as readonly string[]).includes(k) && ours(patch[k]));
              if (!repoint && typeof own(op, 'id') === 'string') out.done.add(own(op, 'id') as string);
            } else if (type === 'move' && Array.isArray(own(op, 'ids'))) for (const id of own(op, 'ids') as unknown[]) (typeof id === 'string' && out.done.add(id));
            else if (type === 'delete' && typeof own(op, 'id') === 'string') out.done.add(own(op, 'id') as string);
          }
        }
        continue;
      }
      if (Array.isArray(ops)) {
        for (const op of ops) {
          if (!isPlainObject(op)) continue;
          const type = own(op, 'type');
          if (type === 'update' && isPlainObject(own(op, 'patch'))) for (const k of Object.keys(own(op, 'patch') as object)) field(own(op, 'id'), k, seq);
          else if (type === 'move' && Array.isArray(own(op, 'ids'))) for (const id of own(op, 'ids') as unknown[]) (field(id, 'x', seq), field(id, 'y', seq));
          else if (type === 'delete' && typeof own(op, 'id') === 'string') (newest(out.touched, own(op, 'id') as string, seq), newest(out.deleted, own(op, 'id') as string, seq));
        }
      }
    }
  } catch {
    // rows that cannot be read add nothing more
  }
  // Judge nit 6 and Aegis N-1: a restored entry counts only when its re-add LANDED: it stands now as that restore,
  // or it is gone now and a row AFTER the marker row deleted it. A marker whose re-add failed in the fold (an id
  // clash, with a live id or with one deleted earlier) leaves its old id undoable.
  for (const e of entries) {
    const now = current.nodes.get(e.newId);
    const landed = now ? now.restoredFrom?.id === e.oldId : current.gone.has(e.newId) && (dels.get(e.newId) ?? Number.NEGATIVE_INFINITY) > e.seq;
    if (!landed) continue;
    if (e.continuation) out.done.add(e.oldId);
    else out.restoredOld.add(e.oldId);
  }
  for (const n of current.nodes.values()) if (n.restoredFrom && typeof n.restoredFrom.id === 'string') out.restoredOld.add(n.restoredFrom.id);
  return out;
}

/**
 * The state after one op, by the fold's own rules (a synthetic row with no seq, so the state's seq does not move).
 * The synthetic row has no stamp, so a node an op of the SAME row adds folds with the unknown hand in the stepped
 * state. That is harmless: the planner reads only a stepped node's content and presence; the hand, `restoredFrom`
 * and attribution of a deleted node are read from the state before the set row (`row.before`), where the fold of
 * the real, stamped rows put them, except for a node added and deleted inside one row (the unknown hand, which
 * fails closed: the page dashes it).
 */
const undoStep = (state: DimState, op: unknown): DimState => foldDim([{ seq: Number.NaN, kind: DIM_KINDS.op, payload: { v: 1, dim: state.dim ?? '', ops: [op] } }], undefined, state);

interface DimInverse {
  /** in output order; `unit` groups the ops of one mark (a re-add with its link re-points is one unit) */
  entries: Array<{ unit: string; op: DimOp }>;
  /** unit of a re-add → [newId, oldId, the original hand] */
  restored: Map<string, DimRestoredEntry>;
  /** node id → why its inverse was left out */
  skipped: Map<string, 'changed' | 'gone'>;
}

/**
 * The inverse of rows, each against the state just before it, with one rename map across them all (the page's B3
 * algorithm, moved here so the page and the mod share it). With `later` (the planner), an inverse that would undo a
 * field a later row changed, or a node gone now, is left out and recorded in `skipped`.
 */
function invertCore(rows: ReadonlyArray<{ before: DimState; ops: readonly unknown[]; seq?: number }>, mint: () => string, current: DimState | undefined, o: { later?: DimLater; ids?: ReadonlySet<string> } = {}): DimInverse {
  const adds: Array<{ tier: number; unit: string; op: DimOp }> = [];
  const rest: Array<Array<{ unit: string; op: DimOp; repoint?: true }>> = [];
  const renamed = new Map<string, string>();
  const restored = new Map<string, DimRestoredEntry>();
  const skipped = new Map<string, 'changed' | 'gone'>();
  // per MARK, one reason: gone wins over changed (a mark deleted since is gone, whatever else changed it)
  const skip = (id: string, why: 'changed' | 'gone'): void => {
    if (!skipped.has(id) || why === 'gone') skipped.set(id, why);
  };
  const later = o.later;
  const inScope = (id: unknown): boolean => !o.ids || (typeof id === 'string' && o.ids.has(id));
  for (const row of rows) {
    let state = row.before.dim === null ? { ...row.before, dim: '' } : row.before;
    // "later" is measured from THIS set row (Judge I-2); a row with no seq is before every later row
    const at = Number.isSafeInteger(row.seq) ? (row.seq as number) : Number.NEGATIVE_INFINITY;
    const since = (m: ReadonlyMap<string, number> | undefined, id: string): boolean => (m?.get(id) ?? Number.NEGATIVE_INFINITY) > at;
    const fieldSince = (id: string, k: string): boolean => (later?.fields.get(id)?.get(k) ?? Number.NEGATIVE_INFINITY) > at;
    const done = (id: unknown): boolean => typeof id === 'string' && !!later?.done.has(id);
    for (const op of row.ops) {
      const inv: Array<{ unit: string; op: DimOp; repoint?: true }> = [];
      if (isPlainObject(op)) {
        if (op.type === 'add') {
          const id = isPlainObject(op.node) ? op.node.id : undefined;
          if (typeof id === 'string' && !state.nodes.has(id) && !state.gone.has(id) && inScope(id) && !done(id)) {
            // a mark the set added and another hand deleted since is gone, not changed (Judge nit 5)
            if (later && since(later.deleted, id)) skip(id, 'gone');
            else if (later && since(later.touched, id)) skip(id, 'changed');
            else inv.push({ unit: `n:${id}`, op: { type: 'delete', id } });
          }
        } else if (op.type === 'update') {
          const cur = typeof op.id === 'string' ? state.nodes.get(op.id) : undefined;
          if (cur && isPlainObject(op.patch) && inScope(op.id) && !done(op.id)) {
            const patch: Record<string, unknown> = {};
            for (const k of Object.keys(op.patch)) {
              if (k === 'id' || k === 'kind' || DROPPED_KEYS.has(k) || op.patch[k] === undefined) continue;
              if (later && fieldSince(op.id as string, k)) {
                skip(op.id as string, 'changed');
                continue;
              }
              const prior = own(cur.node, k);
              patch[k] = prior === undefined ? null : copyJson(prior);
            }
            if (Object.keys(patch).length > 0) inv.push({ unit: `n:${op.id as string}`, op: { type: 'update', id: op.id as string, patch } });
          }
        } else if (op.type === 'move') {
          let ids = Array.isArray(op.ids) ? op.ids.filter((id): id is string => typeof id === 'string' && state.nodes.has(id) && inScope(id) && !done(id)) : [];
          if (later) {
            ids = ids.filter((id) => {
              const moved = fieldSince(id, 'x') || fieldSince(id, 'y');
              if (moved) skip(id, 'changed');
              return !moved;
            });
          }
          if (ids.length > 0 && Number.isSafeInteger(op.dx) && Number.isSafeInteger(op.dy)) {
            const dx = -(op.dx as number) || 0;
            const dy = -(op.dy as number) || 0;
            // the planner validates per mark, so its moves are one id each; the page keeps one move
            if (later) for (const id of ids) inv.push({ unit: `n:${id}`, op: { type: 'move', ids: [id], dx, dy } });
            else inv.push({ unit: `n:${ids[0]!}`, op: { type: 'move', ids, dx, dy } });
          }
        } else if (op.type === 'delete') {
          const cur = typeof op.id === 'string' ? state.nodes.get(op.id) : undefined;
          if (cur && inScope(op.id) && !done(op.id)) {
            if (later?.restoredOld.has(op.id as string)) skip(op.id as string, 'changed');
            else {
              const id = mint();
              // one unit per MARK: the re-add, its re-points and any earlier inverse of the same mark
              const unit = `n:${op.id as string}`;
              renamed.set(op.id as string, id);
              // G5: the ORIGINAL hand: the restored-from hand of a mark that was itself restored, else its adder
              // I-1: the deleted mark's words and other hand ride along, so the re-add keeps them
              const entry: DimRestoredEntry = [id, op.id as string, cur.restoredFrom?.by ?? cur.by];
              if (cur.wordsBy || cur.otherBy) entry.push(cur.wordsBy ?? null, cur.otherBy ?? null);
              restored.set(unit, entry);
              const kind = own(cur.node, 'kind');
              adds.push({ tier: kind === 'frame' ? 0 : kind === 'arrow' ? 2 : 1, unit, op: { type: 'add', node: { ...(copyJson(cur.node) as Record<string, unknown>), id } as unknown as DimNode } });
              // what pointed at it then, and still does now, points at the re-added node
              for (const [otherId, other] of (current ?? state).nodes) {
                if (otherId === op.id) continue;
                const patch: Record<string, unknown> = {};
                for (const k of LINK_KEYS) if (own(other.node, k) === op.id) patch[k] = id;
                if (Object.keys(patch).length > 0) inv.push({ unit, op: { type: 'update', id: otherId, patch }, repoint: true });
              }
            }
          }
        }
      }
      rest.push(inv);
      state = undoStep(state, op);
    }
  }
  const name = (id: string): string => renamed.get(id) ?? id;
  const entries: Array<{ unit: string; op: DimOp; repoint?: true }> = [...adds.sort((a, b) => a.tier - b.tier).map((a) => ({ unit: a.unit, op: a.op })), ...rest.reverse().flat()];
  // an id that was deleted is gone for good: every mention of it becomes the re-added node's id
  const readded = new Set(renamed.values());
  const there = (id: string): boolean => !current || current.nodes.has(id) || readded.has(id);
  const out: Array<{ unit: string; op: DimOp; repoint?: true }> = [];
  for (const e of entries) {
    const op = e.op;
    if (op.type === 'add') {
      const node = op.node as unknown as Record<string, unknown>;
      for (const k of LINK_KEYS) {
        if (typeof node[k] !== 'string') continue;
        node[k] = name(node[k] as string);
        if (!there(node[k] as string)) delete node[k];
      }
    } else if (op.type === 'update') {
      op.id = name(op.id);
      for (const k of LINK_KEYS) {
        if (typeof op.patch[k] !== 'string') continue;
        op.patch[k] = name(op.patch[k] as string);
        if (!there(op.patch[k] as string)) op.patch[k] = null;
      }
    } else if (op.type === 'move') op.ids = [...new Set(op.ids.map(name))];
    else if (op.type === 'delete') op.id = name(op.id);
    // the planner: an inverse of a node that is gone now (deleted later by any hand) is left out
    if (later && op.type !== 'add') {
      const target = op.type === 'move' ? op.ids[0] : op.type === 'update' || op.type === 'delete' ? op.id : undefined;
      if (target !== undefined && !there(target)) {
        if (!e.repoint) skip(e.unit.slice(2), 'gone');
        continue;
      }
    }
    out.push(e);
  }
  return { entries: out, restored, skipped };
}

/**
 * The page's inverse of several rows of ONE action (#gui-dim-undo, Aegis B3), each against the state just before
 * that row, with one rename map across them all. Rows oldest first. Re-adds first (frames, then marks, then arrows),
 * then the other inverses, last op first. Given `current`, a re-added node carries no link to a node gone since,
 * and only a link that STILL names the old id is re-pointed. No conflict skipping: that is `planDimUndo`.
 */
export function dimInvertRows(rows: ReadonlyArray<{ before: DimState; ops: readonly unknown[] }>, mint: () => string, current?: DimState): DimOp[] {
  return invertCore(rows, mint, current).entries.map((e) => e.op);
}

/** One restored entry as the mod writes it on the undo row: `[newId, oldId, by, wordsBy?, otherBy?]`. */
export type DimRestoredEntry = [string, string, DimBy, (DimBy | null)?, (DimBy | null)?];

/** What `planDimUndo` hands back. `ops` is always a batch `validateDimOps` accepted WHOLE as `actor`, or empty. */
export interface DimUndoPlan {
  ops: DimOp[];
  /** `[newId, oldId, by, wordsBy?, otherBy?]` for every re-add in `ops`; `by` is the ORIGINAL hand (Aegis G5) */
  restored: Array<DimRestoredEntry>;
  /**
   * Counted per MARK, each mark once (a mark both updated and deleted by the set is one mark). These are the
   * inputs of the undo's answer line and of the page's notice (Luna's words, E-design): "N marks changed since were
   * left as they are" is `changed + partial`; "removed since" is `gone`; "could not be restored" is `refused`.
   *  - `changed`: left whole, because another hand changed it after the set (or it was already restored);
   *  - `gone`: left, because it is not on the board now (deleted after the set by any hand);
   *  - `refused`: left, because today's validator refused its inverse as the undoer (G3);
   *  - `partial`: undone, but some of its fields were left because another hand changed them since (inside `applied`).
   */
  skipped: { changed: number; gone: number; refused: number; partial: number };
  /** marks the plan changes (partial ones included) */
  applied: number;
  /** true when marks were left for a further call (one call holds at most DIM_LIMITS.opsPerRow ops) */
  more: boolean;
}

/**
 * Plan the undo of one change-set (S1.4 edit-anything, Arky §3.1, Aegis ruling 4). Pure; never throws.
 *  - `rows`: the set's op lists, oldest first, each with the state just before it and its `seq`;
 *  - `after`: EVERY op row that is not a row of the set and landed after the set's first row, any hand, oldest
 *    first (rows between two rows of the set included: a field is "changed since" when a row after THAT set row
 *    changed it, Judge I-2);
 *  - `of`: the set being undone. A row in `after` whose honoured undo marker names it is an earlier call of this
 *    undo (a continuation, `more`): its marks are done and never counted as conflicts (Judge I-3), when its re-adds
 *    landed; with `undoer`, only a marker on a row of that hand is a continuation (Aegis N-2);
 *  - `current`: the board now; `actor`: THE UNDOER (a person for `dim.undo`, the calling agent for `dim-undo`);
 *  - `mint`: the caller's id minter. New ids are never taken from input or from a marker;
 *  - `ids`: an optional scope (old ids), to undo one hand's change to some marks only.
 * Field-level inverse: an update restores each field to its prior value, a move applies the negated delta, an add
 * is deleted, a delete is re-added under a NEW id with links re-pointed only where a link still names the old id
 * now, recorded in `restored` with the original hand and the mark's `wordsBy`/`otherBy`. LATER CHANGES WIN: a
 * field any hand changed after its set row, a node touched after its add, a node gone now and a mark already
 * restored are left as they are and counted, never a whole refusal.
 * VALIDATION (G3): each mark's ops are validated as the undoer (cumulatively, in plan order, so a re-added arrow
 * may cite a re-added node); a refused mark is dropped into `skipped.refused` (a restored text that now matches a
 * secret rule, a colour that now fails the palette). The remainder is then validated whole against `current`; a
 * mark that batch refuses is dropped too, at most twice; a batch never accepted whole is never handed back (the
 * plan is then empty, every mark refused). Undo of an undo is the same call on the undo row's set.
 */
export function planDimUndo(o: {
  rows: ReadonlyArray<{ before: DimState; ops: readonly unknown[]; seq?: number }>;
  after: Iterable<DimRow>;
  current: DimState;
  actor: DimActor;
  mint: () => string;
  of?: DimChangeSet;
  /** the undoer's hand as stamped on its rows: when given, only a marker on a row of THIS hand is a continuation */
  undoer?: DimBy;
  ids?: readonly string[];
  scan?: (text: string) => readonly string[];
}): DimUndoPlan {
  const empty = (): DimUndoPlan => ({ ops: [], restored: [], skipped: { changed: 0, gone: 0, refused: 0, partial: 0 }, applied: 0, more: false });
  try {
    if (!Array.isArray(o.rows) || !o.current || typeof o.mint !== 'function') return empty();
    const setSeqs = new Set(o.rows.map((r) => r.seq).filter((x): x is number => Number.isSafeInteger(x)));
    const setDeleted = new Set<string>();
    for (const r of o.rows) if (Array.isArray(r.ops)) for (const op of r.ops) if (isPlainObject(op) && op.type === 'delete' && typeof op.id === 'string') setDeleted.add(op.id);
    const undoer = o.undoer !== undefined ? dimViewBy(o.undoer) : undefined;
    const later = laterOf(o.after ?? [], o.current, setSeqs, { ...(o.of ? { of: o.of } : {}), ...(undoer ? { undoer } : {}), setDeleted });
    const inv = invertCore(o.rows, o.mint, o.current, { later, ...(Array.isArray(o.ids) ? { ids: new Set(o.ids) } : {}) });
    const order: string[] = [];
    const units = new Map<string, DimOp[]>();
    for (const e of inv.entries) {
      let u = units.get(e.unit);
      if (!u) (units.set(e.unit, (u = [])), order.push(e.unit));
      u.push(e.op);
    }
    const refused = new Set<string>();
    const opts = o.scan ? { scan: o.scan } : {};
    const whole = (v: DimValidation, n: number): boolean => !v.secret && v.refused.length === 0 && v.ok.length === n;
    // per mark, as the undoer, against the board as the accepted marks before it leave it
    const accepted: string[] = [];
    let s = o.current;
    for (const u of order) {
      const ops = units.get(u)!;
      const v = validateDimOps(s, ops, o.actor, opts);
      if (!whole(v, ops.length)) {
        refused.add(u);
        continue;
      }
      accepted.push(u);
      for (const op of v.ok) s = undoStep(s, op);
    }
    // one call holds at most opsPerRow ops: whole marks up to it, the rest for a further call
    let keep: string[] = [];
    let n = 0;
    let more = false;
    for (const u of accepted) {
      const c = units.get(u)!.length;
      if (n + c > DIM_LIMITS.opsPerRow) {
        more = true;
        break;
      }
      keep.push(u);
      n += c;
    }
    const deferred = new Set(accepted.filter((u) => !keep.includes(u)));
    /** the per-mark counts, given the marks that land */
    const tally = (landed: readonly string[]): DimUndoPlan['skipped'] & { applied: number } => {
      const out = { changed: 0, gone: 0, refused: 0, partial: 0, applied: landed.length };
      const lands = new Set(landed);
      for (const u of refused) if (!lands.has(u)) out.refused += 1;
      for (const [id, why] of inv.skipped) {
        const u = `n:${id}`;
        if (lands.has(u)) {
          if (why === 'changed') out.partial += 1;
        } else if (!refused.has(u) && !deferred.has(u)) out[why] += 1;
      }
      return out;
    };
    for (let round = 0; round < 2; round++) {
      const set = new Set(keep);
      const entries = inv.entries.filter((e) => set.has(e.unit));
      const ops = entries.map((e) => e.op);
      if (ops.length === 0) break;
      const v = validateDimOps(o.current, ops, o.actor, opts);
      if (whole(v, ops.length)) {
        const { applied, ...skipped } = tally(keep);
        return { ops: v.ok, restored: keep.flatMap((u) => (inv.restored.has(u) ? [inv.restored.get(u)!] : [])), skipped, applied, more };
      }
      // drop every mark the whole batch refused (by op index), then try once more
      const bad = new Set(v.refused.map((r) => (r.index >= 0 && r.index < entries.length ? entries[r.index]!.unit : '*')));
      if (bad.has('*')) break;
      for (const u of bad) refused.add(u);
      keep = keep.filter((u) => !bad.has(u));
    }
    for (const u of keep) refused.add(u);
    const { applied: _none, ...skipped } = tally([]);
    return { ops: [], restored: [], skipped, applied: 0, more };
  } catch {
    return empty();
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
