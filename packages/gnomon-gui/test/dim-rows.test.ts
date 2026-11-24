/**
 * #gui-dim-session core/dim-rows.ts (boards S1.3 pass P4a; review of PR #118): rows that fit, at their edges.
 */
import { describe, expect, it } from 'vitest';
import { DIM_LIMITS } from '@a-company/gnomon-contracts';
import type { DimOp } from '@a-company/gnomon-contracts';
import { DIM_ACTION_ROWS, DIM_ROW_BUDGET, dimRowCost, fitsOneDimRow, packDimRows } from '../src/core/dim-rows.js';

const ULID = (n: number): string => `01JD1M${String(n).padStart(20, '0')}`;
const rect = (n: number): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'rect', x: n, y: 0, z: 'V', w: 10, h: 10 } as never });
/** a text op whose row cost is exactly `bytes` (its JSON bytes plus the one comma) */
const textOf = (n: number, bytes: number): DimOp => {
  const empty = dimRowCost({ type: 'add', node: { id: ULID(n), kind: 'text', x: 0, y: 0, z: 'V', text: '' } }).bytes + 1;
  return { type: 'add', node: { id: ULID(n), kind: 'text', x: 0, y: 0, z: 'V', text: 'w'.repeat(bytes - empty) } as never };
};

describe('#gui-dim-session rows that fit', () => {
  it('the budget is under the host limits it stands in for, and one action is as many rows as one stamp carries', () => {
    expect(DIM_ROW_BUDGET.bytes).toBeLessThan(16 * 1024);
    expect(DIM_ROW_BUDGET.values).toBeLessThan(4096);
    expect(DIM_ROW_BUDGET.depth).toBeLessThan(32);
    expect(DIM_ACTION_ROWS).toBe(4);
  });

  it('exactly at the byte budget is one row; one byte more is two; an op one byte over the budget fits no row', () => {
    const half = DIM_ROW_BUDGET.bytes / 2;
    expect(Number.isInteger(half)).toBe(true);
    expect(packDimRows([textOf(1, half), textOf(2, half)])).toHaveLength(1);
    expect(fitsOneDimRow([textOf(1, half), textOf(2, half)])).toBe(true);
    const two = packDimRows([textOf(1, half), textOf(2, half + 1)])!;
    expect(two.map((r) => r.length)).toEqual([1, 1]);
    expect(fitsOneDimRow([textOf(1, half), textOf(2, half + 1)])).toBe(false);
    expect(packDimRows([textOf(1, DIM_ROW_BUDGET.bytes)])).toHaveLength(1);
    expect(packDimRows([textOf(1, DIM_ROW_BUDGET.bytes + 1)])).toBeNull();
    // and it is null whatever stands beside it
    expect(packDimRows([rect(1), textOf(2, DIM_ROW_BUDGET.bytes + 1), rect(3)])).toBeNull();
  });

  it('64 ops are one row and the 65th starts the next; order is kept', () => {
    const ops = Array.from({ length: 65 }, (_, i) => rect(i));
    expect(DIM_LIMITS.opsPerRow).toBe(64);
    expect(packDimRows(ops.slice(0, 64))!.map((r) => r.length)).toEqual([64]);
    const rows = packDimRows(ops)!;
    expect(rows.map((r) => r.length)).toEqual([64, 1]);
    expect(rows.flat()).toEqual(ops);
    expect(packDimRows([])).toEqual([]);
  });

  it('four rows against five: the packer answers the rows, and the caller holds the bound', () => {
    const full = (n: number): DimOp => textOf(n, DIM_ROW_BUDGET.bytes);
    expect(packDimRows([full(1), full(2), full(3), full(4)])).toHaveLength(DIM_ACTION_ROWS);
    expect(packDimRows([full(1), full(2), full(3), full(4), full(5)])!.length).toBeGreaterThan(DIM_ACTION_ROWS);
  });

  it('the count of keys and elements is held too: a stroke of too many points fits no row; depth over the budget fits no row', () => {
    const stroke = (points: number): DimOp => ({ type: 'add', node: { id: ULID(1), kind: 'stroke', x: 0, y: 0, z: 'V', points: Array.from({ length: points }, () => 1) } as never });
    expect(dimRowCost(stroke(10)).values).toBe(2 + 6 + 10);
    expect(packDimRows([stroke(DIM_ROW_BUDGET.values - 9)])).toHaveLength(1);
    expect(packDimRows([stroke(DIM_ROW_BUDGET.values - 8)])).toBeNull();
    let deep: unknown = 1;
    for (let i = 0; i < DIM_ROW_BUDGET.depth + 1; i++) deep = [deep];
    expect(packDimRows([{ type: 'update', id: ULID(1), patch: { deep } } as never])).toBeNull();
  });
});
