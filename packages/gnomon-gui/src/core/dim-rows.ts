/**
 * @symbol #gui-dim-session
 *
 * Rows that fit (boards S1.3 pass P4a). The dimension mod refuses WHOLE any `dim.op` whose row would be over the
 * host's row limits (16 KiB of canonical JSON with the host's stamp, 4,096 keys and elements, depth 32), and a row
 * holds at most `DIM_LIMITS.opsPerRow` ops. So one action of a person (a paste of 64 clones, a long scribble the
 * handle cut into pieces) is PACKED here into as many rows as it needs, in order, before anything is sent. PURE.
 *
 * The budget is deliberately under the host's: the page cannot see the stamp the host writes into the row
 * (`relayedFor`: the principal, the connection, the surface), so `DIM_ROW_BUDGET` leaves room for it and for the
 * row's own envelope. An op that does not fit a row by itself cannot be sent at all: `packDimRows` answers null and
 * the caller refuses the whole action with a line (never a silent loss).
 *
 * ONE ACTION IS AT MOST `DIM_ACTION_ROWS` ROWS. That number is the gesture stamp's fan-out (core/gesture.ts: one
 * stamp rides at most four commands, and the kernel holds the same number) and Aegis B3's bound on the rows one
 * undo may take. An action that needs more is refused whole.
 */
import { DIM_LIMITS } from '@a-company/gnomon-contracts';
import type { DimOp } from '@a-company/gnomon-contracts';

/** What one row's ops may cost, under the host's 16 KiB, 4,096 values and depth 32 (the rest is the stamp's and the envelope's). */
export const DIM_ROW_BUDGET = Object.freeze({ bytes: 16 * 1024 - 768, values: 4096 - 96, depth: 28 });
/** The most rows one action may become: the gesture stamp's fan-out and B3's rows per undo. */
export const DIM_ACTION_ROWS = 4;

const utf8 = new TextEncoder();

/** The cost of one value in a row: its JSON bytes, its keys and elements (as the host's walk counts them), its depth. */
export function dimRowCost(v: unknown): { bytes: number; values: number; depth: number } {
  let values = 0;
  let depth = 0;
  const stack: Array<{ v: unknown; d: number }> = [{ v, d: 1 }];
  while (stack.length > 0) {
    const { v: x, d } = stack.pop()!;
    if (x === null || typeof x !== 'object') continue;
    if (d > depth) depth = d;
    const kids = Array.isArray(x) ? x : Object.values(x as Record<string, unknown>);
    values += kids.length;
    // far over any budget already: stop walking (the answer is "does not fit" either way)
    if (values > DIM_ROW_BUDGET.values * 4 || d > 64) return { bytes: Number.MAX_SAFE_INTEGER, values, depth: d };
    for (const k of kids) if (k !== null && typeof k === 'object') stack.push({ v: k, d: d + 1 });
  }
  let bytes: number;
  try {
    bytes = utf8.encode(JSON.stringify(v) ?? '').length;
  } catch {
    bytes = Number.MAX_SAFE_INTEGER;
  }
  return { bytes, values, depth };
}

/**
 * Split ops into rows that each fit, keeping their order (an add stays before the op that cites it). Null when one
 * op does not fit a row by itself. An empty list is no rows.
 */
export function packDimRows(ops: readonly DimOp[]): DimOp[][] | null {
  const rows: DimOp[][] = [];
  let row: DimOp[] = [];
  let bytes = 0;
  let values = 0;
  for (const op of ops) {
    const c = dimRowCost(op);
    // one more element of `ops`, and its comma
    const b = c.bytes + 1;
    const n = c.values + 1;
    if (b > DIM_ROW_BUDGET.bytes || n > DIM_ROW_BUDGET.values || c.depth > DIM_ROW_BUDGET.depth) return null;
    if (row.length > 0 && (row.length >= DIM_LIMITS.opsPerRow || bytes + b > DIM_ROW_BUDGET.bytes || values + n > DIM_ROW_BUDGET.values)) {
      rows.push(row);
      row = [];
      bytes = 0;
      values = 0;
    }
    row.push(op);
    bytes += b;
    values += n;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** True when these ops fit ONE row. */
export const fitsOneDimRow = (ops: readonly DimOp[]): boolean => {
  const rows = packDimRows(ops);
  return rows !== null && rows.length <= 1;
};
