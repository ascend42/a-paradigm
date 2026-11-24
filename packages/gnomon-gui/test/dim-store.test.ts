/**
 * #gui-dim-store (boards S1.3, draft point 6; oracle G-DDL-01): rows per dimension, kept states, scrubbing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIM_HASH_VECTOR_HASH, DIM_HASH_VECTOR_ROWS, DIM_KINDS, dimHash, foldDim } from '@a-company/gnomon-contracts';
import { DIM_STORE_LIMITS, DimSeqError, DimStore } from '../src/core/dim-store.js';

/**
 * G-DDL-01 counts the rows the STORE hands to the contract's fold, with a spy on `foldDim` itself (not the store's
 * own counter): each call records how many rows it was given.
 */
const spy = vi.hoisted(() => ({ calls: [] as number[] }));
vi.mock('@a-company/gnomon-contracts', async (original) => {
  const real = await original<typeof import('@a-company/gnomon-contracts')>();
  return {
    ...real,
    foldDim: (rows: Iterable<import('@a-company/gnomon-contracts').DimRow>, upToSeq?: number, from?: import('@a-company/gnomon-contracts').DimState) => {
      const list = [...rows];
      spy.calls.push(list.length);
      return real.foldDim(list, upToSeq, from);
    },
  };
});
beforeEach(() => void (spy.calls.length = 0));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dimId = (n: number): string => `dim:01JD1MST0RE${String(n).padStart(15, '0')}`;
const nodeId = (n: number): string => `01JD1MN0DE${String(n).padStart(16, '0')}`;
const HUMAN = { principal: 'p:me/human', surface: 'gui' };

const startRow = (seq: number, dim: string, extra: Record<string, unknown> = {}, scope?: unknown): Record<string, unknown> => ({
  seq, kind: DIM_KINDS.start, payload: { v: 1, dim, title: `Board ${dim.slice(-2)}`, attached: ['hsid-a'], opened: 'command', relayedFor: HUMAN, ...extra }, ...(scope ? { scope } : {}),
});
const addRow = (seq: number, dim: string, n: number): Record<string, unknown> => ({
  seq, kind: DIM_KINDS.op, payload: { v: 1, dim, ops: [{ type: 'add', node: { id: nodeId(n), kind: 'rect', x: n, y: n, z: 'V', w: 10, h: 10 } }], relayedFor: HUMAN },
});

/** One dimension of 10,000 one-op rows, interleaved with unrelated rows (seq = 2 * index + 10). */
function bigLog(): { rows: Array<Record<string, unknown>>; dim: string } {
  const dim = dimId(1);
  const rows: Array<Record<string, unknown>> = [startRow(1, dim)];
  for (let i = 0; i < 10_000; i++) {
    rows.push(addRow(10 + 2 * i, dim, i));
    rows.push({ seq: 11 + 2 * i, kind: 'provider.event', payload: { n: i } });
  }
  return { rows, dim };
}

describe('#gui-dim-store G-DDL-01: scrubbing folds from a kept state', () => {
  it('10,000 one-op rows, 20 scrubs: each folds at most 512 rows (counted on foldDim), and answers what a full fold answers', () => {
    const { rows, dim } = bigLog();
    const store = new DimStore();
    for (let i = 0; i < rows.length; i += 1000) store.apply(rows.slice(i, i + 1000));
    expect(store.stats()).toMatchObject({ dims: 1, rows: 10_001, keyframes: Math.floor(10_001 / 512), dropped: 0 });
    const dimRows = store.rows(dim);
    // 18 seqs spread over the log (on a row and between rows), the row just before a kept state and the row at one
    const seqs: number[] = [];
    for (let s = 0; s < 18; s++) seqs.push(10 + 2 * ((s * 4999 + 257) % 10_000) + (s % 2));
    seqs.push(dimRows[2 * 512 - 2]!.seq, dimRows[3 * 512 - 1]!.seq);
    expect(seqs).toHaveLength(20);
    let total = 0;
    let worst = 0;
    for (const seq of seqs) {
      spy.calls.length = 0;
      const state = store.stateAt(dim, seq);
      // one foldDim call at most per scrub, of at most 512 rows
      expect(spy.calls.length).toBeLessThanOrEqual(1);
      const folded = spy.calls[0] ?? 0;
      expect(folded).toBeLessThanOrEqual(DIM_STORE_LIMITS.keyframeEvery);
      expect(store.stats().lastScrubRows).toBe(folded);
      total += folded;
      worst = Math.max(worst, folded);
      expect(state.nodes.size).toBe(dimRows.filter((r) => r.seq <= seq).length - 1);
      expect(state.seq).toBeLessThanOrEqual(seq);
    }
    // the row just before a kept state is the worst case (511 rows from the one before); the row AT one folds none
    expect(worst).toBe(DIM_STORE_LIMITS.keyframeEvery - 1);
    spy.calls.length = 0;
    store.stateAt(dim, dimRows[3 * 512 - 1]!.seq);
    expect(spy.calls).toEqual([]);
    expect(store.stats().scrubRows).toBe(total);
    // three of them against the linear fold of everything, by hash
    for (const seq of [10, 5133, 20_007]) expect(dimHash(store.stateAt(dim, seq))).toBe(dimHash(foldDim(dimRows, seq)));
  });

  it('the head, a seq past the head and a seq before the first row fold nothing', () => {
    const { rows, dim } = bigLog();
    const store = new DimStore();
    store.apply(rows);
    expect(store.stateAt(dim).nodes.size).toBe(10_000);
    expect(store.stats().lastScrubRows).toBe(0);
    expect(store.stateAt(dim, 9_999_999)).toBe(store.stateAt(dim));
    expect(store.stats().lastScrubRows).toBe(0);
    expect(store.stateAt(dim, 0).nodes.size).toBe(0);
    expect(store.stats().lastScrubRows).toBe(0);
    expect(store.stateAt(dimId(99)).dim).toBe(dimId(99));
  });

  it('dim-store.ts never calls the row-by-row fold', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'core', 'dim-store.ts'), 'utf8');
    expect(src).not.toMatch(/foldDimRow/);
    expect(src).toMatch(/foldDim\(/);
    expect(src).not.toMatch(/console\./);
  });

  it('a dimension that outgrows its kept states doubles its spacing instead of growing', () => {
    const dim = dimId(2);
    const store = new DimStore();
    const n = DIM_STORE_LIMITS.keyframeEvery * (DIM_STORE_LIMITS.keyframesPerDim + 1);
    const rows = [startRow(1, dim)];
    for (let i = 0; i < n; i++) rows.push({ seq: 2 + i, kind: DIM_KINDS.attach, payload: { v: 1, dim, hsid: 'hsid-a' } });
    store.apply(rows);
    expect(store.stats().keyframes).toBeLessThanOrEqual(DIM_STORE_LIMITS.keyframesPerDim);
    store.stateAt(dim, n - 3);
    expect(store.stats().lastScrubRows).toBeLessThanOrEqual(2 * DIM_STORE_LIMITS.keyframeEvery);
    expect(store.stateAt(dim, n - 3).seq).toBe(n - 3);
  });
});

describe('#gui-dim-store rows, lists and reconnect', () => {
  it('folds the published vector to its hash, one row at a time or in one page', () => {
    const a = new DimStore();
    a.apply(DIM_HASH_VECTOR_ROWS);
    const b = new DimStore();
    for (const row of DIM_HASH_VECTOR_ROWS) b.apply([row]);
    const dim = 'dim:01JD1MVECT0R00000000000001';
    expect(dimHash(a.stateAt(dim))).toBe(DIM_HASH_VECTOR_HASH);
    expect(dimHash(b.stateAt(dim))).toBe(DIM_HASH_VECTOR_HASH);
    expect(dimHash(a.stateAt(dim, 3))).toBe(dimHash(foldDim(DIM_HASH_VECTOR_ROWS, 3)));
  });

  it('reconnect: resuming from the cursor (with an overlap) hashes the same as a full re-read', () => {
    const { rows, dim } = bigLog();
    const full = new DimStore();
    full.apply(rows);
    const resumed = new DimStore();
    const cut = 7_301;
    resumed.apply(rows.slice(0, cut));
    // the resumed read starts a few rows before the cursor: rows already seen are skipped
    const again = resumed.apply(rows.slice(cut - 40));
    expect(again.get(dim)!.length).toBe(rows.slice(cut).filter((r) => r.kind !== 'provider.event').length);
    expect(resumed.stats().rows).toBe(full.stats().rows);
    expect(dimHash(resumed.stateAt(dim))).toBe(dimHash(full.stateAt(dim)));
    expect(dimHash(resumed.stateAt(dim))).toBe(dimHash(foldDim(full.rows(dim))));
    expect(dimHash(resumed.stateAt(dim, 9_000))).toBe(dimHash(full.stateAt(dim, 9_000)));
    // a replaced log: everything is forgotten
    resumed.reset();
    expect(resumed.stats()).toMatchObject({ dims: 0, rows: 0, keyframes: 0 });
    expect(resumed.list()).toEqual([]);
  });

  it('apply returns the newly kept rows by dimension and skips what is not a dimension row', () => {
    const store = new DimStore();
    const fresh = store.apply([
      startRow(1, dimId(1)),
      { seq: 2, kind: 'provider.event', payload: { dim: dimId(1) } },
      { seq: 3, kind: DIM_KINDS.op, payload: { v: 1, dim: 'dim:nope', ops: [] } },
      { seq: 4, kind: DIM_KINDS.op, payload: 'text' },
      { seq: 'x', kind: DIM_KINDS.op, payload: { v: 1, dim: dimId(1), ops: [] } },
      null,
      addRow(5, dimId(1), 1),
      startRow(6, dimId(2)),
    ]);
    expect([...fresh.keys()]).toEqual([dimId(1), dimId(2)]);
    expect(fresh.get(dimId(1))!.map((r) => r.seq)).toEqual([1, 5]);
    expect(store.stats()).toMatchObject({ dims: 2, rows: 3 });
  });

  it('lists dimensions by the repo scope on their rows, most recently written first', () => {
    const store = new DimStore();
    store.apply([
      startRow(1, dimId(1), {}, { repo: 'repo:aaaaaaaaaaaaaaaa' }),
      startRow(2, dimId(2), {}, { repo: 'repo:bbbbbbbbbbbbbbbb' }),
      startRow(3, dimId(3)),
      { ...addRow(4, dimId(1), 1), scope: { repo: 'repo:cccccccccccccccc' } },
      { seq: 5, kind: DIM_KINDS.end, payload: { v: 1, dim: dimId(2), ops: 0, nodes: 0 } },
    ]);
    expect(store.list().map((d) => d.dim)).toEqual([dimId(2), dimId(1), dimId(3)]);
    expect(store.list('repo:aaaaaaaaaaaaaaaa')).toEqual([{ dim: dimId(1), title: 'Board 01', repo: 'repo:aaaaaaaaaaaaaaaa', firstSeq: 1, lastSeq: 4, rows: 2, nodes: 1, ended: false, attached: ['hsid-a'], firstAt: null, lastAt: null, partial: false }]);
    expect(store.list('repo:bbbbbbbbbbbbbbbb')[0]).toMatchObject({ ended: true });
    expect(store.list('repo:zzzz')).toEqual([]);
    expect(store.list().find((d) => d.dim === dimId(3))!.repo).toBeNull();
  });

  it('remembers the last dimension per session from start and attach rows', () => {
    const store = new DimStore();
    store.apply([
      startRow(1, dimId(1)),
      startRow(2, dimId(2), { attached: ['hsid-b'] }),
      { seq: 3, kind: DIM_KINDS.attach, payload: { v: 1, dim: dimId(2), hsid: 'hsid-a' } },
    ]);
    expect(store.lastDimOf('hsid-a')).toBe(dimId(2));
    expect(store.lastDimOf('hsid-b')).toBe(dimId(2));
    store.apply([startRow(4, dimId(1))]);
    expect(store.lastDimOf('hsid-a')).toBe(dimId(1));
    expect(store.lastDimOf('hsid-none')).toBeNull();
  });

  it('15. at the cap a new dimension evicts the least recently written one, ended ones first, never a pinned one', () => {
    const store = new DimStore();
    const cap = DIM_STORE_LIMITS.dims;
    let seq = 1;
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < cap; i++) rows.push(startRow(seq++, dimId(i)));
    store.apply(rows);
    // the open board is the OLDEST one: it has a mark and is pinned
    store.pin(dimId(0));
    store.apply([addRow(seq++, dimId(0), 1)]);
    store.apply([{ seq: seq++, kind: DIM_KINDS.end, payload: { v: 1, dim: dimId(7), ops: 0, nodes: 0 } }]);
    expect(store.lastDimOf('hsid-a')).toBe(dimId(cap - 1));
    // one more dimension: the ended one goes first, though it was written last
    store.apply([startRow(seq++, dimId(cap))]);
    expect(store.has(dimId(7))).toBe(false);
    expect(store.has(dimId(cap))).toBe(true);
    // then the least recently written live one (1, since 0 was written again and is pinned anyway)
    store.apply([startRow(seq++, dimId(cap + 1))]);
    expect(store.has(dimId(1))).toBe(false);
    expect(store.has(dimId(0))).toBe(true);
    expect(store.stateAt(dimId(0)).nodes.size).toBe(1);
    expect(store.stats()).toMatchObject({ dims: cap, dropped: 0, evicted: 2, pinned: 1 });
    // the open board keeps its marks however many dimensions pass by
    const flood: Array<Record<string, unknown>> = [];
    for (let i = 0; i < cap + 50; i++) flood.push(startRow(seq++, dimId(5000 + i)));
    for (let i = 0; i < flood.length; i += 100) store.apply(flood.slice(i, i + 100));
    expect(store.stateAt(dimId(0)).nodes.size).toBe(1);
    expect(store.stats().dims).toBe(cap);
    expect(store.stats().dropped).toBe(0);
    // an evicted dimension that is written again is held from then on and says it is partial
    store.apply([addRow(seq++, dimId(7), 3)]);
    expect(store.list().find((d) => d.dim === dimId(7))).toMatchObject({ partial: true, rows: 1 });
    expect(store.list().find((d) => d.dim === dimId(0))).toMatchObject({ partial: false });
    // unpinned, it can go like any other
    store.unpin(dimId(0));
    const more: Array<Record<string, unknown>> = [];
    for (let i = 0; i < cap; i++) more.push(startRow(seq++, dimId(9000 + i)));
    for (let i = 0; i < more.length; i += 100) store.apply(more.slice(i, i + 100));
    expect(store.has(dimId(0))).toBe(false);
  });

  it('15. a row is dropped (and counted) only when nothing may be evicted', () => {
    const store = new DimStore();
    const rows = [];
    // one page naming more dimensions than the cap: none of them may evict another of the same page
    for (let i = 0; i < DIM_STORE_LIMITS.dims + 3; i++) rows.push(startRow(i + 1, dimId(i)));
    store.apply(rows);
    expect(store.stats()).toMatchObject({ dims: DIM_STORE_LIMITS.dims, dropped: 3, evicted: 0 });
    expect(store.has(dimId(DIM_STORE_LIMITS.dims))).toBe(false);
    // the next page can
    store.apply([startRow(9000, dimId(DIM_STORE_LIMITS.dims))]);
    expect(store.stats()).toMatchObject({ dims: DIM_STORE_LIMITS.dims, dropped: 3, evicted: 1 });
  });

  it('16. a listing carries the log time of its first and last row', () => {
    const store = new DimStore();
    store.apply([
      { ...startRow(1, dimId(1)), at: '2026-11-24T08:00:00.000Z' },
      { ...addRow(2, dimId(1), 1), at: '2026-11-24T08:05:00.000Z' },
      startRow(3, dimId(2)),
    ]);
    store.apply([{ ...addRow(4, dimId(1), 2), at: '2026-11-24T09:00:00.000Z' }, { ...addRow(5, dimId(1), 3), at: 12345 }]);
    expect(store.list().find((d) => d.dim === dimId(1))).toMatchObject({ firstAt: '2026-11-24T08:00:00.000Z', lastAt: '2026-11-24T09:00:00.000Z' });
    expect(store.list().find((d) => d.dim === dimId(2))).toMatchObject({ firstAt: null, lastAt: null });
  });

  it('16. stateAt with a seq that is not a whole number throws a typed error, never an empty board', () => {
    const store = new DimStore();
    store.apply([startRow(1, dimId(1)), addRow(2, dimId(1), 1)]);
    for (const bad of [Number.NaN, 1.5, Infinity, -Infinity, '2' as unknown as number, null as unknown as number]) expect(() => store.stateAt(dimId(1), bad)).toThrow(DimSeqError);
    expect(() => store.stateAt(dimId(99), Number.NaN)).toThrow(RangeError);
    expect(store.stateAt(dimId(1), undefined).nodes.size).toBe(1);
    expect(store.stateAt(dimId(1), 2).nodes.size).toBe(1);
    expect(store.stateAt(dimId(1), -1).nodes.size).toBe(0);
  });
});
