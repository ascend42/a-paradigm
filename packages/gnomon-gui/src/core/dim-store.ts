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
 *  - Dimensions: at most `DIM_STORE_LIMITS.dims`. A row naming one more is not kept and is counted in `stats().dropped`.
 *  - Rows: kept whole for every held dimension, by reference (the payload is not copied). The log is the bound: one
 *    row is at most what the kernel lets a mod append, and nothing here outlives `reset()`.
 *  - Kept states: at most `DIM_STORE_LIMITS.keyframesPerDim` per dimension, plus the head. A kept state is one Map
 *    of entries that share their node objects with the next one, so it costs pointers, not copies of the marks.
 *    When a dimension outgrows its kept states, every other one is dropped and that dimension's spacing doubles:
 *    a scrub folds at most 512 rows up to 32,768 rows, at most 1,024 up to 65,536, and so on.
 */
import { DIM_ID_PATTERN, DIM_KINDS, emptyDimState, foldDim, isPlainObject } from '@a-company/gnomon-contracts';
import type { DimRow, DimState } from '@a-company/gnomon-contracts';

export const DIM_STORE_LIMITS = Object.freeze({ keyframeEvery: 512, keyframesPerDim: 64, dims: 512 });

const KINDS: ReadonlySet<string> = new Set(Object.values(DIM_KINDS));

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
}

export interface DimStoreStats {
  dims: number;
  rows: number;
  keyframes: number;
  /** rows that named a dimension beyond the cap */
  dropped: number;
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
}

export class DimStore {
  #dims = new Map<string, Entry>();
  #lastByHsid = new Map<string, string>();
  #dropped = 0;
  #lastScrubRows = 0;
  #scrubRows = 0;

  /**
   * Take log rows (any kinds, in log order; a page or one followed row). Rows that are not dimension rows, that
   * name no well-formed dimension, or whose seq this dimension has already seen are skipped. Returns the rows
   * newly kept, by dimension, in order: what a live controller is told about.
   */
  apply(rows: readonly unknown[]): Map<string, DimRow[]> {
    const fresh = new Map<string, DimRow[]>();
    for (const raw of rows) {
      if (!isPlainObject(raw) || typeof raw.kind !== 'string' || !KINDS.has(raw.kind) || !Number.isSafeInteger(raw.seq)) continue;
      const payload = raw.payload;
      const dim = isPlainObject(payload) ? payload.dim : undefined;
      if (typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim)) continue;
      let entry = this.#dims.get(dim);
      if (!entry) {
        if (this.#dims.size >= DIM_STORE_LIMITS.dims) {
          this.#dropped += 1;
          continue;
        }
        entry = { dim, rows: [], repo: null, head: emptyDimState(dim), every: DIM_STORE_LIMITS.keyframeEvery, keyframes: [] };
        this.#dims.set(dim, entry);
      }
      const seq = raw.seq as number;
      if (entry.rows.length > 0 && seq <= entry.rows[entry.rows.length - 1]!.seq) continue;
      const row: DimRow = { seq, kind: raw.kind, payload, ...(Array.isArray(raw.causes) ? { causes: raw.causes as string[] } : {}) };
      const scope = raw.scope;
      if (entry.repo === null && isPlainObject(scope) && typeof scope.repo === 'string' && scope.repo.length > 0) entry.repo = scope.repo;
      const p = payload as Record<string, unknown>;
      if (row.kind === DIM_KINDS.start && Array.isArray(p.attached)) {
        for (const h of p.attached) if (typeof h === 'string' && h.length > 0) this.#lastByHsid.set(h, dim);
      } else if (row.kind === DIM_KINDS.attach && typeof p.hsid === 'string' && p.hsid.length > 0) this.#lastByHsid.set(p.hsid, dim);
      const list = fresh.get(dim) ?? [];
      list.push(row);
      fresh.set(dim, list);
    }
    for (const [dim, added] of fresh) this.#extend(this.#dims.get(dim)!, added);
    return fresh;
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
   */
  stateAt(dim: string, seq?: number): DimState {
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

  has(dim: string): boolean {
    return this.#dims.has(dim);
  }

  /** Every held dimension, or those whose rows carry this repo scope, most recently written first. */
  list(repo?: string): DimListing[] {
    const out: DimListing[] = [];
    for (const e of this.#dims.values()) {
      if (repo !== undefined && e.repo !== repo) continue;
      out.push({ dim: e.dim, title: e.head.title, repo: e.repo, firstSeq: e.rows[0]!.seq, lastSeq: e.rows[e.rows.length - 1]!.seq, rows: e.rows.length, nodes: e.head.nodes.size, ended: e.head.ended, attached: e.head.attached });
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
    return { dims: this.#dims.size, rows, keyframes, dropped: this.#dropped, lastScrubRows: this.#lastScrubRows, scrubRows: this.#scrubRows };
  }

  /** Forget everything (the log was replaced: `cursor-epoch`). */
  reset(): void {
    this.#dims.clear();
    this.#lastByHsid.clear();
    this.#dropped = 0;
    this.#lastScrubRows = 0;
    this.#scrubRows = 0;
  }
}
