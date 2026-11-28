/**
 * The cost shape of the dimension fold (performance audit 2026-11-24, finding 10). `foldDimRow` copies the whole
 * state per row, so a row-by-row replay is quadratic; `foldDim(rows, upToSeq, from)` copies `from` once and is
 * linear in the rows. A scrub must use `foldDim` from a kept state.
 *
 * Nothing here reads a clock. The work is COUNTED: while a fold runs, the global `Map` and `Set` constructors are
 * replaced by subclasses that count each construction from an existing Map / Set and the entries it copied. That
 * is exactly what `draftOf` does (`new Map(s.nodes)`, `new Set(s.gone)` and, from S1.4 E1, `new Map(s.goneBy)`, so
 * one state copy is TWO Map copies: `goneBy` holds one entry per deleted id); the fold builds no other collection.
 */
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash, emptyDimState, foldDim, foldDimRow, type DimRow, type DimState } from '../src/dim.js';

const DIM = 'dim-cost';
const START: DimRow = { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'cost', attached: ['hs-cost'] } };
const id = (i: number): string => `01JD1MC0ST${String(i).padStart(16, '0')}`;
/** One `add` per row, seqs 2..n+1. */
function addRows(n: number, firstNode = 0): DimRow[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: firstNode + i + 2,
    kind: DIM_KINDS.op,
    payload: { v: 1, dim: DIM, ops: [{ type: 'add', node: { id: id(firstNode + i), kind: 'rect', x: i, y: i, z: 'k' } }], relayedFor: { principal: 'p:cost/human', surface: 'gui' } },
  }));
}

interface Work {
  mapCopies: number;
  mapEntries: number;
  setCopies: number;
  setEntries: number;
}

/** Run `fn` with the collection copies it makes counted. The real constructors are restored whatever happens. */
function counted<T>(fn: () => T): { out: T; work: Work } {
  const work: Work = { mapCopies: 0, mapEntries: 0, setCopies: 0, setEntries: 0 };
  const RealMap = globalThis.Map;
  const RealSet = globalThis.Set;
  class CountingMap<K, V> extends RealMap<K, V> {
    constructor(from?: Iterable<readonly [K, V]> | null) {
      super(from);
      if (from instanceof RealMap) {
        work.mapCopies += 1;
        work.mapEntries += from.size;
      }
    }
  }
  class CountingSet<V> extends RealSet<V> {
    constructor(from?: Iterable<V> | null) {
      super(from);
      if (from instanceof RealSet) {
        work.setCopies += 1;
        work.setEntries += from.size;
      }
    }
  }
  globalThis.Map = CountingMap as MapConstructor;
  globalThis.Set = CountingSet as SetConstructor;
  try {
    return { out: fn(), work };
  } finally {
    globalThis.Map = RealMap;
    globalThis.Set = RealSet;
  }
}

const rowByRow = (rows: readonly DimRow[], from: DimState = emptyDimState()): DimState => rows.reduce(foldDimRow, from);

describe('fold cost: foldDim is linear in the rows', () => {
  it('the counter sees a copy (it is not blind)', () => {
    const src = new Map([[1, 1], [2, 2]]);
    const { work } = counted(() => [new Map(src), new Set(new Set([1, 2, 3])), new Map(), new Map([[1, 1]])]);
    // a fresh Map / Set, or one built from an array, is not a copy of a collection
    expect(work).toEqual({ mapCopies: 1, mapEntries: 2, setCopies: 1, setEntries: 3 });
  });

  it.each([[500], [2000], [8000]])('%i rows: one copy of the state, whatever the row count', (n) => {
    const rows = [START, ...addRows(n)];
    const { out, work } = counted(() => foldDim(rows));
    expect(out.nodes.size).toBe(n);
    expect(out.ops).toBe(n);
    expect(out.unapplied).toBe(0);
    // the empty `from` is copied once; no row copies anything
    expect(work).toEqual({ mapCopies: 2, mapEntries: 0, setCopies: 1, setEntries: 0 });
  });

  it('continuing from a kept state copies that state once: the copy cost is the board, not the rows', () => {
    const kept = foldDim([START, ...addRows(1000)]);
    for (const n of [10, 1000, 4000]) {
      const { out, work } = counted(() => foldDim(addRows(n, 1000), undefined, kept));
      expect(out.nodes.size).toBe(1000 + n);
      expect(work).toEqual({ mapCopies: 2, mapEntries: 1000, setCopies: 1, setEntries: 0 });
    }
    expect(kept.nodes.size).toBe(1000); // the kept state is not changed
  });

  it('upToSeq stops the pass without another copy', () => {
    const rows = [START, ...addRows(2000)];
    const { out, work } = counted(() => foldDim(rows, 501));
    expect(out.nodes.size).toBe(500);
    expect(out.seq).toBe(501);
    expect(work.mapCopies).toBe(2);
  });
});

describe('fold cost: foldDimRow copies the state per row (why a scrub must not reduce over it)', () => {
  // If foldDimRow is ever given a cheaper state (a persistent structure), these counts drop: update them AND the
  // COST paragraph of its doc comment in src/dim.ts together.
  it.each([[200], [400], [800]])('%i add rows one call at a time copy n(n-1)/2 node entries', (n) => {
    const rows = addRows(n);
    const start = foldDim([START]);
    const { out, work } = counted(() => rowByRow(rows, start));
    expect(out.nodes.size).toBe(n);
    expect(work.mapCopies).toBe(2 * n);
    expect(work.setCopies).toBe(n);
    expect(work.mapEntries).toBe((n * (n - 1)) / 2);
  });

  it('doubling the rows quadruples the row-by-row copies and leaves foldDim at one', () => {
    const start = foldDim([START]);
    const entries = (n: number): number => counted(() => rowByRow(addRows(n), start)).work.mapEntries;
    const copies = (n: number): number => counted(() => foldDim(addRows(n), undefined, start)).work.mapCopies;
    const [a, b] = [entries(300), entries(600)];
    expect(b / a).toBeGreaterThan(3.9);
    expect(b / a).toBeLessThan(4.1);
    expect([copies(300), copies(600)]).toEqual([2, 2]);
  });

  it('a scrub from kept states does the same work as the row-by-row fold in a fraction of the copies, with the same hash', () => {
    const n = 1000;
    const every = 100;
    const rows = [START, ...addRows(n)];
    const slow = counted(() => rowByRow(rows));
    // keep a state every 100 rows, then fold forward from the nearest one (here: each kept state in turn)
    const fast = counted(() => {
      let s = emptyDimState();
      for (let i = 0; i < rows.length; i += every) s = foldDim(rows.slice(i, i + every), undefined, s);
      return s;
    });
    expect(dimHash(fast.out)).toBe(dimHash(slow.out));
    expect(fast.out.nodes.size).toBe(n);
    expect({ seq: fast.out.seq, ops: fast.out.ops, unapplied: fast.out.unapplied, attached: fast.out.attached }).toEqual({ seq: slow.out.seq, ops: slow.out.ops, unapplied: slow.out.unapplied, attached: slow.out.attached });
    expect(fast.work.mapCopies).toBe(2 * Math.ceil(rows.length / every));
    expect(slow.work.mapCopies).toBe(2 * rows.length);
    expect(fast.work.mapEntries * 50).toBeLessThan(slow.work.mapEntries);
  });

  it('foldDimRow stays pure: the state it was given is not changed', () => {
    const s0 = foldDim([START, ...addRows(3)]);
    const before = dimHash(s0);
    const s1 = foldDimRow(s0, addRows(1, 3)[0]!);
    expect(s1.nodes.size).toBe(4);
    expect(s0.nodes.size).toBe(3);
    expect(dimHash(s0)).toBe(before);
  });
});
