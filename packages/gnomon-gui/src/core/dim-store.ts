/**
 * @symbol #gui-dim-store
 *
 * The dimensions the page has read from the log (boards S1.3, draft point 6 "read path"; oracle G-DDL-01). PURE:
 * no DOM, no socket, no timer. The caller hands it the same rows the GUI store follows (core/client.ts followLog);
 * it keeps the rows of the four `DIM_KINDS` per dimension, the state at the head, and a state every
 * `DIM_STORE_LIMITS.keyframeEvery` rows, so a scrub folds forward from the nearest kept state.
 *
 * FOLDING. Every fold here is one `foldDim(rows, upToSeq, from)` call: one copy of the kept state, then one pass.
 * The row-by-row form of the contracts package is never called in this file (its doc comment gives the quadratic
 * cost; test/dim-store.test.ts scans this source for it).
 *
 * BOUNDS (memory).
 *  - Dimensions: at most `DIM_STORE_LIMITS.dims`. A row naming one more EVICTS the least recently written
 *    dimension (an ended one before a live one). A dimension the caller has pinned (`pin(dim)`: the board that is
 *    open) is never evicted, nor is one that has rows in the page being applied. Only when nothing may be evicted
 *    is the row not kept; it is then counted in `stats().dropped`. A dimension that was evicted and is written
 *    again is held from that row on and listed `partial: true`: its state is not the whole dimension.
 *  - Rows: kept whole for every held dimension, by reference (the payload is not copied). The log is the bound: one
 *    row is at most what the kernel lets a mod append, and nothing here outlives `reset()`.
 *  - Kept states: at most `DIM_STORE_LIMITS.keyframesPerDim` per dimension, plus the head. A kept state is one Map
 *    of entries that share their node objects with the next one, so it costs pointers, not copies of the marks.
 *    When a dimension outgrows its kept states, every other one is dropped and that dimension's spacing doubles:
 *    a scrub folds at most 512 rows up to 32,768 rows, at most 1,024 up to 65,536, and so on.
 */
import { DIM_AUX_KINDS, DIM_ID_PATTERN, DIM_KINDS, emptyDimGrants, emptyDimState, foldDim, foldDimGrants, isPlainObject } from '@a-company/gnomon-contracts';
import type { DimGrants } from '@a-company/gnomon-contracts';
import type { DimRow, DimState } from '@a-company/gnomon-contracts';

export const DIM_STORE_LIMITS = Object.freeze({ keyframeEvery: 512, keyframesPerDim: 64, dims: 512 });

const KINDS: ReadonlySet<string> = new Set(Object.values(DIM_KINDS));

/** S1.4 P4b: how many agent turns the store keeps a count for (the turn strip's tail and the arrival line read them). */
export const DIM_TURN_MEMORY = 64;
/** A turn ref the kernel stamps into `causes` (gnomon-contracts ids.ts turnId: `turn:<hsid>/<n>`). */
const TURN_REF = /^turn:([^/\s]{1,128})\/([1-9][0-9]{0,15})$/;
export const parseTurnRef = (ref: unknown): { hsid: string; n: number } | null => {
  const m = typeof ref === 'string' ? TURN_REF.exec(ref) : null;
  return m ? { hsid: m[1]!, n: Number(m[2]) } : null;
};

/**
 * What one agent turn did on one board, counted FROM ROWS (never from the reply): the marks it added, the marks it
 * restyled or moved (`changed`) and the marks it removed. `touched` is changed and removed together, by node.
 */
export interface DimTurnMarks {
  added: number;
  changed: number;
  removed: number;
}
interface TurnEntry {
  hsid: string;
  n: number;
  /** dim → node ids by what was done to them */
  dims: Map<string, { added: Set<string>; changed: Set<string>; removed: Set<string>; lastSeq: number }>;
  /** the agent's label as the host stamped it (boardAgentName makes it a name) */
  agent: string;
}
/** An op row written through a TOOL surface (the bridge, voice) by an agent: the host's stamp, own keys only. */
function agentStampOf(payload: Record<string, unknown>): { agent: string } | null {
  const r = Object.prototype.hasOwnProperty.call(payload, 'relayedFor') ? payload.relayedFor : undefined;
  if (!isPlainObject(r)) return null;
  const agent = Object.prototype.hasOwnProperty.call(r, 'agent') ? r.agent : undefined;
  const surface = Object.prototype.hasOwnProperty.call(r, 'surface') ? r.surface : undefined;
  if (typeof agent !== 'string' || agent.length === 0 || (surface !== 'bridge' && surface !== 'voice')) return null;
  return { agent };
}

/** One dimension as a list shows it. */
export interface DimListing {
  dim: string;
  title: string;
  /** the repo scope the host stamped on its rows (`repo:<hex>`), or null when no row carried one */
  repo: string | null;
  firstSeq: number;
  lastSeq: number;
  rows: number;
  nodes: number;
  ended: boolean;
  attached: readonly string[];
  /** the log's time of the first and the last row held (the row's `at`, as the kernel wrote it), or null */
  firstAt: string | null;
  lastAt: string | null;
  /** true when earlier rows of this dimension were evicted: the state is not the whole dimension */
  partial: boolean;
}

/** `stateAt` was asked for a seq that is not a whole number: a caller bug, never answered with an empty board. */
export class DimSeqError extends RangeError {
  constructor() {
    super('stateAt: seq must be a safe integer');
    this.name = 'DimSeqError';
  }
}

export interface DimStoreStats {
  dims: number;
  rows: number;
  keyframes: number;
  /** rows not kept: they named a dimension beyond the cap and nothing could be evicted */
  dropped: number;
  /** dimensions evicted to make room */
  evicted: number;
  pinned: number;
  /** rows folded by the last `stateAt` call (0 when it was answered from a kept state alone) */
  lastScrubRows: number;
  /** rows folded by every `stateAt` call so far */
  scrubRows: number;
}

interface Entry {
  dim: string;
  rows: DimRow[];
  repo: string | null;
  /** the state after every row */
  head: DimState;
  /** rows between kept states (doubles when the dimension outgrows its kept states) */
  every: number;
  /** `keyframes[j]` is the state after the first `(j + 1) * every` rows */
  keyframes: DimState[];
  firstAt: string | null;
  lastAt: string | null;
  partial: boolean;
}

const atOf = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 40 ? v : null);
/** How many evicted ids are remembered (to mark a dimension that comes back as partial). */
const EVICTED_MEMORY = 4096;

export class DimStore {
  #dims = new Map<string, Entry>();
  #lastByHsid = new Map<string, string>();
  #pinned = new Set<string>();
  #evictedIds = new Set<string>();
  #evicted = 0;
  #dropped = 0;
  /** dim → the shared grant fold (gnomon-contracts foldDimGrants, the one the mod enforces with); never in `rows` */
  readonly #grants = new Map<string, DimGrants>();
  /** dim → the highest seq of ANY dimension row the store has taken for it (grant rows included) */
  readonly #lastAny = new Map<string, number>();
  /** dims whose grant fold moved in the last `apply` */
  #grantMoved = new Set<string>();
  /** turn ref → what that agent turn did, newest last, at most DIM_TURN_MEMORY */
  readonly #turns = new Map<string, TurnEntry>();
  #lastScrubRows = 0;
  #scrubRows = 0;

  /**
   * Take log rows (any kinds, in log order; a page or one followed row). Rows that are not dimension rows, that
   * name no well-formed dimension, or whose seq this dimension has already seen are skipped. Returns the rows
   * newly kept, by dimension, in order: what a live controller is told about.
   */
  apply(rows: readonly unknown[]): Map<string, DimRow[]> {
    const fresh = new Map<string, DimRow[]>();
    this.#grantMoved = new Set();
    for (const raw of rows) {
      if (isPlainObject(raw) && raw.kind === DIM_AUX_KINDS.grant && Number.isSafeInteger(raw.seq)) {
        this.#takeGrant(raw);
        continue;
      }
      if (!isPlainObject(raw) || typeof raw.kind !== 'string' || !KINDS.has(raw.kind) || !Number.isSafeInteger(raw.seq)) continue;
      const payload = raw.payload;
      const dim = isPlainObject(payload) ? payload.dim : undefined;
      if (typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim)) continue;
      let entry = this.#dims.get(dim);
      if (!entry) {
        if (this.#dims.size >= DIM_STORE_LIMITS.dims && !this.#evict(fresh)) {
          this.#dropped += 1;
          continue;
        }
        entry = { dim, rows: [], repo: null, head: emptyDimState(dim), every: DIM_STORE_LIMITS.keyframeEvery, keyframes: [], firstAt: null, lastAt: null, partial: this.#evictedIds.has(dim) };
        this.#dims.set(dim, entry);
      }
      const seq = raw.seq as number;
      if (entry.rows.length > 0 && seq <= entry.rows[entry.rows.length - 1]!.seq) continue;
      const row: DimRow = { seq, kind: raw.kind, payload, ...(Array.isArray(raw.causes) ? { causes: raw.causes as string[] } : {}) };
      const at = atOf(raw.at);
      if (entry.rows.length === 0 && !fresh.has(dim)) entry.firstAt = at;
      entry.lastAt = at ?? entry.lastAt;
      const scope = raw.scope;
      if (entry.repo === null && isPlainObject(scope) && typeof scope.repo === 'string' && scope.repo.length > 0) entry.repo = scope.repo;
      const p = payload as Record<string, unknown>;
      if (row.kind === DIM_KINDS.start && Array.isArray(p.attached)) {
        for (const h of p.attached) if (typeof h === 'string' && h.length > 0) this.#lastByHsid.set(h, dim);
      } else if (row.kind === DIM_KINDS.attach && typeof p.hsid === 'string' && p.hsid.length > 0) this.#lastByHsid.set(p.hsid, dim);
      if (row.kind === DIM_KINDS.op) this.#countTurn(dim, row);
      if (seq > (this.#lastAny.get(dim) ?? 0)) this.#lastAny.set(dim, seq);
      const list = fresh.get(dim) ?? [];
      list.push(row);
      fresh.set(dim, list);
    }
    for (const [dim, added] of fresh) this.#extend(this.#dims.get(dim)!, added);
    return fresh;
  }

  /** A grant row: folded through the ONE shared grant fold (Aegis M9); it never enters `rows` or the published fold. */
  #takeGrant(raw: Record<string, unknown>): void {
    const payload = raw.payload;
    const dim = isPlainObject(payload) ? payload.dim : undefined;
    if (typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim)) return;
    const seq = raw.seq as number;
    const was = this.#grants.get(dim) ?? emptyDimGrants();
    const next = foldDimGrants([{ seq, kind: raw.kind as string, payload }], dim, was);
    if (seq > (this.#lastAny.get(dim) ?? 0)) this.#lastAny.set(dim, seq);
    this.#grants.set(dim, next);
    this.#grantMoved.add(dim);
  }

  /** An op row an agent wrote through a tool surface, naming a turn in `causes`: counted for that turn. */
  #countTurn(dim: string, row: DimRow): void {
    const p = row.payload as Record<string, unknown>;
    const who = agentStampOf(p);
    if (!who || !Array.isArray(row.causes)) return;
    const ref = row.causes.find((c) => parseTurnRef(c) !== null);
    const t = ref !== undefined ? parseTurnRef(ref) : null;
    const ops = Object.prototype.hasOwnProperty.call(p, 'ops') ? p.ops : undefined;
    if (!t || !Array.isArray(ops)) return;
    let e = this.#turns.get(ref as string);
    if (!e) {
      while (this.#turns.size >= DIM_TURN_MEMORY) this.#turns.delete(this.#turns.keys().next().value as string);
      e = { hsid: t.hsid, n: t.n, dims: new Map(), agent: who.agent };
      this.#turns.set(ref as string, e);
    }
    let d = e.dims.get(dim);
    if (!d) e.dims.set(dim, (d = { added: new Set(), changed: new Set(), removed: new Set(), lastSeq: row.seq }));
    d.lastSeq = row.seq;
    for (const op of ops) {
      if (!isPlainObject(op)) continue;
      if (op.type === 'add' && isPlainObject(op.node) && typeof op.node.id === 'string') d.added.add(op.node.id);
      else if (op.type === 'update' && typeof op.id === 'string') d.changed.add(op.id);
      else if (op.type === 'delete' && typeof op.id === 'string') {
        d.removed.add(op.id);
        d.changed.delete(op.id);
      } else if (op.type === 'move' && Array.isArray(op.ids)) for (const id of op.ids) if (typeof id === 'string') d.changed.add(id);
    }
    // a mark the turn added and then changed is still one mark it added
    for (const id of d.added) d.changed.delete(id);
  }

  /**
   * What an agent turn did, counted from its rows: on one board (`dim`) or on every board it touched. Null when the
   * store holds no tool row naming that turn.
   */
  turnMarks(ref: string, dim?: string): (DimTurnMarks & { agent: string; lastSeq: number }) | null {
    const e = this.#turns.get(ref);
    if (!e) return null;
    const out = { added: 0, changed: 0, removed: 0, agent: e.agent, lastSeq: 0 };
    let any = false;
    for (const [d, c] of e.dims) {
      if (dim !== undefined && d !== dim) continue;
      any = true;
      out.added += c.added.size;
      out.changed += c.changed.size;
      out.removed += c.removed.size;
      out.lastSeq = Math.max(out.lastSeq, c.lastSeq);
    }
    return any ? out : null;
  }

  /** The turn refs of `hsid` the store holds counts for whose number is at or below `n` (what one result closes). */
  turnsUpTo(hsid: string, n: number): string[] {
    const out: string[] = [];
    for (const [ref, e] of this.#turns) if (e.hsid === hsid && e.n <= n) out.push(ref);
    return out;
  }

  /** The grant fold of a dimension from the rows (an empty fold, every session on its default, when none came). */
  grants(dim: string): DimGrants {
    return this.#grants.get(dim) ?? emptyDimGrants();
  }

  /** The highest seq of any row of this dimension the store took, grant rows included (0 for none). */
  lastSeqOf(dim: string): number {
    return this.#lastAny.get(dim) ?? 0;
  }

  /** The dimensions whose grant fold moved in the last `apply`. */
  grantsMoved(): ReadonlySet<string> {
    return this.#grantMoved;
  }

  /**
   * Make room for one more dimension: forget the least recently written one that is not pinned and has no rows in
   * the page being applied, an ended one first. False when there is none.
   */
  #evict(fresh: ReadonlyMap<string, DimRow[]>): boolean {
    let victim: Entry | null = null;
    const lastSeq = (e: Entry): number => (e.rows.length > 0 ? e.rows[e.rows.length - 1]!.seq : Number.MAX_SAFE_INTEGER);
    for (const e of this.#dims.values()) {
      if (this.#pinned.has(e.dim) || fresh.has(e.dim) || e.rows.length === 0) continue;
      if (victim === null || (e.head.ended && !victim.head.ended) || (e.head.ended === victim.head.ended && lastSeq(e) < lastSeq(victim))) victim = e;
    }
    if (!victim) return false;
    this.#dims.delete(victim.dim);
    this.#grants.delete(victim.dim);
    this.#lastAny.delete(victim.dim);
    for (const [hsid, dim] of this.#lastByHsid) if (dim === victim.dim) this.#lastByHsid.delete(hsid);
    if (this.#evictedIds.size >= EVICTED_MEMORY) this.#evictedIds.delete(this.#evictedIds.values().next().value as string);
    this.#evictedIds.add(victim.dim);
    this.#evicted += 1;
    return true;
  }

  /** Keep a dimension whatever the cap says (the board that is open). Unpin it when the board closes. */
  pin(dim: string): void {
    this.#pinned.add(dim);
  }

  unpin(dim: string): void {
    this.#pinned.delete(dim);
  }

  /** Fold the new rows onto the head, stopping at each keyframe boundary to keep the state there. */
  #extend(entry: Entry, added: readonly DimRow[]): void {
    let at = 0;
    while (at < added.length) {
      const have = entry.rows.length;
      const take = Math.min(added.length - at, entry.every - (have % entry.every));
      const chunk = added.slice(at, at + take);
      entry.head = foldDim(chunk, undefined, entry.head);
      for (const row of chunk) entry.rows.push(row);
      at += take;
      if (entry.rows.length % entry.every === 0) {
        entry.keyframes.push(entry.head);
        if (entry.keyframes.length > DIM_STORE_LIMITS.keyframesPerDim) {
          entry.keyframes = entry.keyframes.filter((_, j) => j % 2 === 1);
          entry.every *= 2;
        }
      }
    }
  }

  /**
   * The state of a dimension after the row at `seq` (or at the head when `seq` is left out). A dimension the store
   * does not hold answers an empty state. The result is a kept state or a fresh fold: treat it as read-only.
   * Throws `DimSeqError` for a seq that is given and is not a safe integer (NaN, a fraction, a string).
   */
  stateAt(dim: string, seq?: number): DimState {
    if (seq !== undefined && !Number.isSafeInteger(seq)) throw new DimSeqError();
    this.#lastScrubRows = 0;
    const entry = this.#dims.get(dim);
    if (!entry) return emptyDimState(dim);
    const rows = entry.rows;
    if (seq === undefined || rows.length === 0 || seq >= rows[rows.length - 1]!.seq) return entry.head;
    // how many rows have a seq at or below the target
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]!.seq <= seq) lo = mid + 1;
      else hi = mid;
    }
    const k = Math.floor(lo / entry.every);
    const from = k === 0 ? emptyDimState(dim) : entry.keyframes[k - 1]!;
    const tail = rows.slice(k * entry.every, lo);
    this.#lastScrubRows = tail.length;
    this.#scrubRows += tail.length;
    return tail.length === 0 ? from : foldDim(tail, seq, from);
  }

  /** The rows held for a dimension, in log order (read-only). */
  rows(dim: string): readonly DimRow[] {
    return this.#dims.get(dim)?.rows ?? [];
  }

  /**
   * How many of this dimension's held rows have a seq above `seq` (the check's k, design board-leaf.check, aegis
   * C1.1: a row count, never a seq difference; every row kind, C1.2). 0 for a dimension it does not hold.
   */
  rowsAfter(dim: string, seq: number): number {
    const rows = this.#dims.get(dim)?.rows ?? [];
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]!.seq <= seq) lo = mid + 1;
      else hi = mid;
    }
    return rows.length - lo;
  }

  has(dim: string): boolean {
    return this.#dims.has(dim);
  }

  /** Every held dimension, or those whose rows carry this repo scope, most recently written first. */
  list(repo?: string): DimListing[] {
    const out: DimListing[] = [];
    for (const e of this.#dims.values()) {
      if (repo !== undefined && e.repo !== repo) continue;
      out.push({ dim: e.dim, title: e.head.title, repo: e.repo, firstSeq: e.rows[0]!.seq, lastSeq: e.rows[e.rows.length - 1]!.seq, rows: e.rows.length, nodes: e.head.nodes.size, ended: e.head.ended, attached: e.head.attached, firstAt: e.firstAt, lastAt: e.lastAt, partial: e.partial });
    }
    return out.sort((a, b) => b.lastSeq - a.lastSeq);
  }

  /** The dimension this session last opened or was attached to, or null. */
  lastDimOf(hsid: string): string | null {
    return this.#lastByHsid.get(hsid) ?? null;
  }

  stats(): DimStoreStats {
    let rows = 0;
    let keyframes = 0;
    for (const e of this.#dims.values()) {
      rows += e.rows.length;
      keyframes += e.keyframes.length;
    }
    return { dims: this.#dims.size, rows, keyframes, dropped: this.#dropped, evicted: this.#evicted, pinned: this.#pinned.size, lastScrubRows: this.#lastScrubRows, scrubRows: this.#scrubRows };
  }

  /** Forget everything but the pins (the log was replaced: `cursor-epoch`). */
  reset(): void {
    this.#dims.clear();
    this.#grants.clear();
    this.#lastAny.clear();
    this.#turns.clear();
    this.#grantMoved = new Set();
    this.#lastByHsid.clear();
    this.#evictedIds.clear();
    this.#evicted = 0;
    this.#dropped = 0;
    this.#lastScrubRows = 0;
    this.#scrubRows = 0;
  }
}
