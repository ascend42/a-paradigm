/**
 * #gui-dim-undo (boards S1.3, draft point 6; Aegis B3): inverse ops and the undo bounds.
 */
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash, foldDim } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { DIM_UNDO_LIMITS, invertDimOps, planUndo } from '../src/core/dim-undo.js';

const DIM = 'dim:01JD1MVECT0R00000000000001';
const HUMAN = { principal: 'p:me/human', surface: 'gui' };
const AGENT = { principal: 'p:me/session', surface: 'bridge', agent: 'kit', hsid: 'hsid-1' };
const ME = { cls: 'human' as const, principal: 'p:me/human' };
const ULID = (n: number): string => `01JD1MVND0${String(n).padStart(16, '0')}`;
const start: DimRow = { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'Undo', attached: ['hsid-1'], opened: 'command', relayedFor: HUMAN } };
const opRow = (seq: number, ops: unknown[], relayedFor: unknown = HUMAN): DimRow => ({ seq, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops, relayedFor } });
const minter = (from = 500): (() => string) => {
  let n = from;
  return () => ULID(n++);
};

const BASE: DimOp[] = [
  { type: 'add', node: { id: ULID(1), kind: 'frame', x: 0, y: 0, z: 'V', w: 400, h: 300, title: 'F' } },
  { type: 'add', node: { id: ULID(2), kind: 'rect', x: 10, y: 10, z: 'W', w: 50, h: 40, fill: 'lemon', label: 'a', parent: ULID(1) } },
  { type: 'add', node: { id: ULID(3), kind: 'ellipse', x: 200, y: 10, z: 'X', w: 50, h: 40 } },
  { type: 'add', node: { id: ULID(4), kind: 'arrow', x: 60, y: 30, z: 'Y', points: [0, 0, 140, 0], from: ULID(2), to: ULID(3) } },
];
const base = (): DimState => foldDim([start, opRow(2, BASE)]);
const apply = (state: DimState, ops: readonly DimOp[], seq: number): DimState => foldDim([opRow(seq, [...ops])], undefined, state);

/** ops, then their inverse, lands on the same hash as before. */
function roundTrip(before: DimState, ops: DimOp[]): { inverse: DimOp[]; after: DimState; back: DimState } {
  const after = apply(before, ops, 10);
  const plan = planUndo({ before, rows: [ops], current: after, actor: ME, mint: minter() });
  if (!plan.ok) throw new Error(`undo refused: ${plan.code} ${plan.refusal?.code ?? ''} ${plan.refusal?.field ?? ''}`);
  return { inverse: plan.ops, after, back: apply(after, plan.ops, 11) };
}

describe('#gui-dim-undo invertDimOps', () => {
  it('add inverts to delete', () => {
    const before = base();
    const { inverse, back } = roundTrip(before, [{ type: 'add', node: { id: ULID(9), kind: 'text', x: 1, y: 2, z: 'Z', text: 'hi' } }]);
    expect(inverse).toEqual([{ type: 'delete', id: ULID(9) }]);
    expect(dimHash(back)).toBe(dimHash(before));
  });

  it('update inverts to the prior values, null for a key that was absent', () => {
    const before = base();
    const { inverse, back } = roundTrip(before, [{ type: 'update', id: ULID(2), patch: { label: 'b', fill: null, color: 'cobalt', w: 99 } }]);
    expect(inverse).toEqual([{ type: 'update', id: ULID(2), patch: { label: 'a', fill: 'lemon', color: null, w: 50 } }]);
    expect(dimHash(back)).toBe(dimHash(before));
  });

  it('move inverts to the negated move; several ops invert last first', () => {
    const before = base();
    const ops: DimOp[] = [
      { type: 'move', ids: [ULID(2), ULID(3)], dx: 5, dy: -7 },
      { type: 'update', id: ULID(2), patch: { x: 100 } },
      { type: 'move', ids: [ULID(2)], dx: 0, dy: 1 },
    ];
    const { inverse, back } = roundTrip(before, ops);
    expect(inverse).toEqual([
      { type: 'move', ids: [ULID(2)], dx: 0, dy: -1 },
      { type: 'update', id: ULID(2), patch: { x: 15 } },
      { type: 'move', ids: [ULID(2), ULID(3)], dx: -5, dy: 7 },
    ]);
    expect(dimHash(back)).toBe(dimHash(before));
  });

  it('delete of a node others pointed at: a NEW id, and from, to and parent follow it', () => {
    const before = base();
    // the rect is the arrow's `from`; the frame is the rect's parent
    const { inverse, after, back } = roundTrip(before, [{ type: 'delete', id: ULID(2) }, { type: 'delete', id: ULID(1) }]);
    expect(after.nodes.has(ULID(2))).toBe(false);
    expect(inverse).toEqual([
      { type: 'add', node: { id: ULID(501), kind: 'frame', x: 0, y: 0, z: 'V', w: 400, h: 300, title: 'F' } },
      { type: 'add', node: { id: ULID(500), kind: 'rect', x: 10, y: 10, z: 'W', w: 50, h: 40, fill: 'lemon', label: 'a', parent: ULID(501) } },
      { type: 'update', id: ULID(4), patch: { from: ULID(500) } },
    ]);
    expect(back.nodes.has(ULID(2))).toBe(false);
    expect(back.gone.has(ULID(2))).toBe(true);
    expect(back.nodes.get(ULID(4))!.node.from).toBe(ULID(500));
    expect(back.nodes.get(ULID(500))!.node.parent).toBe(ULID(501));
    expect(back.nodes.size).toBe(before.nodes.size);
  });

  it('a delete after the engine cleared the pointer: the restored pointer names the new id, not the dead one', () => {
    const before = base();
    const { inverse, back } = roundTrip(before, [{ type: 'update', id: ULID(4), patch: { to: null } }, { type: 'delete', id: ULID(3) }]);
    expect(inverse).toEqual([
      { type: 'add', node: { id: ULID(500), kind: 'ellipse', x: 200, y: 10, z: 'X', w: 50, h: 40 } },
      { type: 'update', id: ULID(4), patch: { to: ULID(500) } },
    ]);
    expect(back.nodes.get(ULID(4))!.node.to).toBe(ULID(500));
  });

  it('an edit then a delete of one node, and a deleted arrow with its target: every mention is renamed', () => {
    const before = base();
    const { inverse, back } = roundTrip(before, [
      { type: 'update', id: ULID(3), patch: { w: 77 } },
      { type: 'move', ids: [ULID(3), ULID(4)], dx: 1, dy: 1 },
      { type: 'delete', id: ULID(3) },
      { type: 'delete', id: ULID(4) },
    ]);
    expect(inverse.map((o) => o.type)).toEqual(['add', 'add', 'move', 'update']);
    expect(JSON.stringify(inverse)).not.toContain(ULID(3));
    expect(JSON.stringify(inverse)).not.toContain(ULID(4));
    const ellipse = back.nodes.get(ULID(500))!.node;
    expect(ellipse).toMatchObject({ kind: 'ellipse', x: 200, y: 10, w: 50 });
    expect(back.nodes.get(ULID(501))!.node).toMatchObject({ kind: 'arrow', x: 60, y: 30, from: ULID(2), to: ULID(500) });
  });

  it('an op the fold skipped has no inverse, and nothing is minted for it', () => {
    let minted = 0;
    const inverse = invertDimOps(base(), [
      { type: 'delete', id: ULID(77) },
      { type: 'add', node: { id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 } },
      { type: 'update', id: ULID(78), patch: { x: 1 } },
      { type: 'move', ids: [ULID(79)], dx: 1, dy: 1 },
      { type: 'clear', scope: 'all' },
    ], () => (minted++, ULID(600)));
    expect(inverse).toEqual([]);
    expect(minted).toBe(0);
  });

  it('never copies a prototype key from a patch into the inverse', () => {
    const patch = JSON.parse('{"__proto__":{"x":1},"constructor":1,"label":"z"}') as Record<string, unknown>;
    expect(invertDimOps(base(), [{ type: 'update', id: ULID(2), patch }], minter())).toEqual([{ type: 'update', id: ULID(2), patch: { label: 'a' } }]);
  });
});

describe('#gui-dim-undo planUndo (Aegis B3)', () => {
  it('undoing a delete of an agent mark re-adds it as the person’s own (stated)', () => {
    const before = foldDim([opRow(3, [{ type: 'add', node: { id: ULID(8), kind: 'rect', x: 0, y: 0, z: 'Z', w: 5, h: 5 } }], AGENT)], undefined, base());
    expect(before.nodes.get(ULID(8))!.by.cls).toBe('agent');
    const { back } = roundTrip(before, [{ type: 'delete', id: ULID(8) }]);
    expect(back.nodes.get(ULID(500))!.by).toEqual({ cls: 'human', principal: 'p:me/human' });
  });

  it('refuses whole an inverse over 64 ops', () => {
    const marks: DimOp[] = [];
    for (let i = 0; i < 40; i++) marks.push({ type: 'add', node: { id: ULID(100 + i), kind: 'rect', x: i, y: 0, z: 'V', w: 5, h: 5 } });
    // each rect has an arrow from it: deleting the 40 rects inverts to 40 adds and 40 pointer updates
    const arrows: DimOp[] = marks.map((_, i) => ({ type: 'add', node: { id: ULID(200 + i), kind: 'arrow', x: 0, y: 0, z: 'W', points: [0, 0, 5, 5], from: ULID(100 + i) } }));
    const before = foldDim([start, opRow(2, marks), opRow(3, arrows)]);
    const dels: DimOp[] = marks.map((_, i) => ({ type: 'delete', id: ULID(100 + i) }));
    const after = apply(before, dels, 4);
    expect(invertDimOps(before, dels, minter())).toHaveLength(80);
    expect(planUndo({ before, rows: [dels], current: after, actor: ME, mint: minter() })).toEqual({ ok: false, code: 'too-many-ops' });
    // 32 of them fit exactly
    expect(planUndo({ before, rows: [dels.slice(0, 32)], current: apply(before, dels.slice(0, 32), 4), actor: ME, mint: minter() })).toMatchObject({ ok: true });
  });

  it('refuses whole an undo of more than 4 rows, and accepts 4', () => {
    const before = base();
    const rows: DimOp[][] = [1, 2, 3, 4, 5].map((i) => [{ type: 'move', ids: [ULID(3)], dx: i, dy: 0 }]);
    let after = before;
    rows.forEach((r, i) => (after = apply(after, r, 10 + i)));
    expect(DIM_UNDO_LIMITS).toEqual({ ops: 64, rows: 4 });
    expect(planUndo({ before, rows, current: after, actor: ME, mint: minter() })).toEqual({ ok: false, code: 'too-many-rows' });
    let four = before;
    rows.slice(0, 4).forEach((r, i) => (four = apply(four, r, 10 + i)));
    const plan = planUndo({ before, rows: rows.slice(0, 4), current: four, actor: ME, mint: minter() });
    expect(plan.ok && plan.ops).toHaveLength(4);
    expect(dimHash(apply(four, plan.ok ? plan.ops : [], 20))).toBe(dimHash(before));
  });

  it('goes through the validator: an inverse that no longer fits the board is refused whole, with the code', () => {
    const before = base();
    const ops: DimOp[] = [{ type: 'update', id: ULID(3), patch: { w: 60 } }, { type: 'move', ids: [ULID(2)], dx: 1, dy: 0 }];
    // someone deleted the ellipse since
    const current = apply(apply(before, ops, 10), [{ type: 'delete', id: ULID(3) }], 11);
    expect(planUndo({ before, rows: [ops], current, actor: ME, mint: minter() })).toMatchObject({ ok: false, code: 'invalid', refusal: { code: 'id-missing', field: 'id' } });
    // an agent may not undo by editing a person's mark
    expect(planUndo({ before, rows: [ops], current: apply(before, ops, 10), actor: { cls: 'agent', principal: 'p', agent: 'a' }, mint: minter() })).toMatchObject({ ok: false, code: 'invalid', refusal: { code: 'not-owner' } });
    expect(planUndo({ before, rows: [[{ type: 'delete', id: ULID(99) }]], current: before, actor: ME, mint: minter() })).toEqual({ ok: false, code: 'nothing' });
  });

  it('a re-added node of a kind this version cannot write is refused whole', () => {
    const before = foldDim([opRow(3, [{ type: 'add', node: { id: ULID(8), kind: 'acme:chart', x: 0, y: 0, z: 'Z' } }])], undefined, base());
    const ops: DimOp[] = [{ type: 'move', ids: [ULID(3)], dx: 1, dy: 0 }, { type: 'delete', id: ULID(8) }];
    expect(planUndo({ before, rows: [ops], current: apply(before, ops, 10), actor: ME, mint: minter() })).toMatchObject({ ok: false, code: 'invalid', refusal: { code: 'kind-not-core' } });
  });

  it('10. a re-added node carries no link to a node that has gone since, and a restored link to one becomes no link', () => {
    const before = base();
    // I delete the rect (child of the frame, the arrow's `from`) and clear the arrow's `to`
    const ops: DimOp[] = [{ type: 'update', id: ULID(4), patch: { to: null } }, { type: 'delete', id: ULID(2) }];
    // since then someone deleted the frame and the ellipse
    const current = apply(apply(before, ops, 10), [{ type: 'delete', id: ULID(1) }, { type: 'delete', id: ULID(3) }], 11);
    const plan = planUndo({ before, rows: [ops], current, actor: ME, mint: minter() });
    expect(plan).toEqual({
      ok: true,
      ops: [
        { type: 'add', node: { id: ULID(500), kind: 'rect', x: 10, y: 10, z: 'W', w: 50, h: 40, fill: 'lemon', label: 'a' } },
        { type: 'update', id: ULID(4), patch: { from: ULID(500) } },
        { type: 'update', id: ULID(4), patch: { to: null } },
      ],
    });
    // without the board as it stands, the links are kept as they were (and the validator refuses them)
    expect(JSON.stringify(invertDimOps(before, ops, minter()))).toContain(`"parent":"${ULID(1)}"`);
  });

  it('10. only a link that STILL names the old id is re-pointed: a re-point made since is left alone', () => {
    const before = base();
    const ops: DimOp[] = [{ type: 'delete', id: ULID(2) }];
    const other: DimOp = { type: 'add', node: { id: ULID(9), kind: 'rect', x: 0, y: 99, z: 'Z', w: 5, h: 5 } };
    // someone re-pointed the arrow's `from` at another mark after my delete
    const current = apply(apply(apply(before, ops, 10), [other], 11), [{ type: 'update', id: ULID(4), patch: { from: ULID(9) } }], 12);
    const plan = planUndo({ before, rows: [ops], current, actor: ME, mint: minter() });
    expect(plan.ok && plan.ops.map((o) => o.type)).toEqual(['add']);
    const back = apply(current, plan.ok ? plan.ops : [], 13);
    expect(back.nodes.get(ULID(4))!.node.from).toBe(ULID(9));
    expect(back.nodes.get(ULID(500))!.node.parent).toBe(ULID(1));
    // and with nobody in between, the stale link is re-pointed as before
    const quiet = planUndo({ before, rows: [ops], current: apply(before, ops, 10), actor: ME, mint: minter() });
    expect(quiet.ok && quiet.ops[1]).toEqual({ type: 'update', id: ULID(4), patch: { from: ULID(500) } });
  });
});
