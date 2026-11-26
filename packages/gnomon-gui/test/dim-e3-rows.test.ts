/**
 * S1.4 E3 item 0 (Luna's open item 6; Aegis: blocks E3): the page store keeps `relayedFor.turn` and `act` on the
 * rows it follows. Driven through the page's own path: a WIRE row (`{seq, view: 'full', event}`), through
 * `DimSessions.apply` (wireRowOf) into the `DimStore`, and read back with the contracts' own readers.
 */
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, dimActOf, dimChangeSetOf, dimUndoMarkOf } from '@a-company/gnomon-contracts';
import { DimSessions } from '../src/core/dim-session.js';
import { DimStore } from '../src/core/dim-store.js';

const ULID = (n: number): string => `01JD1M${String(n).padStart(20, '0')}`;
const DIM = `dim:${ULID(1)}`;
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const wire = (seq: number, kind: string, payload: Record<string, unknown>) => ({ seq, view: 'full', event: { kind, at: '2026-11-26T14:20:00.000Z', payload } });

describe('E3 item 0: the page store keeps relayedFor.turn and act', () => {
  it('an agent row keeps relayedFor.turn and hsid, a person row keeps act, an undo row keeps its marker: each reads back as its change-set', () => {
    const store = new DimStore();
    const sessions = new DimSessions({ store });
    const human = { principal: 'p:me', connId: 'conn:A', surface: 'gui' };
    const agent = { principal: 'p:me/session', surface: 'bridge', agent: 'claude', hsid: HSID, turn: `turn:${HSID}/3` };
    sessions.apply([
      wire(1, DIM_KINDS.start, { v: 1, dim: DIM, title: 'Plan', attached: [HSID], opened: 'command', relayedFor: human }),
      wire(2, DIM_KINDS.op, { v: 1, dim: DIM, ops: [{ type: 'add', node: { id: ULID(10), kind: 'rect', x: 0, y: 0, z: 'V', w: 10, h: 10 } }], act: ULID(20), relayedFor: human }),
      wire(3, DIM_KINDS.op, { v: 1, dim: DIM, ops: [{ type: 'update', id: ULID(10), set: { color: 'ink' } }], relayedFor: agent }),
      wire(4, DIM_KINDS.op, { v: 1, dim: DIM, ops: [{ type: 'update', id: ULID(10), set: { color: 'graphite' } }], act: ULID(21), undo: { of: { hsid: HSID, turn: `turn:${HSID}/3` } }, relayedFor: human }),
    ]);
    const rows = store.rows(DIM);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    const p3 = rows[2]!.payload as { relayedFor: Record<string, unknown> };
    expect(p3.relayedFor.turn).toBe(`turn:${HSID}/3`);
    expect(p3.relayedFor.hsid).toBe(HSID);
    expect((rows[1]!.payload as { act?: unknown }).act).toBe(ULID(20));
    expect(dimActOf(rows[1]!)).toEqual({ principal: 'p:me', act: ULID(20) });
    expect(dimChangeSetOf(rows[2]!)).toEqual({ kind: 'turn', hsid: HSID, turn: `turn:${HSID}/3` });
    expect(dimUndoMarkOf(rows[3]!)?.of).toEqual({ kind: 'turn', hsid: HSID, turn: `turn:${HSID}/3` });
    expect(dimChangeSetOf(rows[3]!)).toEqual({ kind: 'act', principal: 'p:me', act: ULID(21) });
  });
});
