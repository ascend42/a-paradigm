/**
 * #gui-dim-live (boards S1.3, draft point 6; Mika's open items 1 and 2; Aegis B3): the live controller.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow } from '@a-company/gnomon-contracts';
import { DIM_LIVE_LIMITS, DIM_LIVE_TIMEOUT_MS, DimLive, dimAckOf } from '../src/core/dim-live.js';
import type { DimLiveBatch } from '../src/core/dim-live.js';
import { DimStore } from '../src/core/dim-store.js';
import { gestureOf } from '../src/core/gesture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIM = 'dim:01JD1MVECT0R00000000000001';
const ME = { cls: 'human' as const, principal: 'p:me/human' };
const HUMAN = { principal: 'p:me/human', surface: 'gui' };
const ULID = (n: number): string => `01JD1M11VE${String(n).padStart(16, '0')}`;
const rect = (n: number, extra: Record<string, unknown> = {}): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'rect', x: n, y: 0, z: 'V', w: 10, h: 10, ...extra } as never });
const press = (now: number) => gestureOf({ isTrusted: true, type: 'pointerup' }, now);

/** A store, a controller, a clock and a fake mod that appends on demand. */
function rig() {
  const store = new DimStore();
  let seq = 1;
  let now = 1000;
  let minted = 700;
  const sent: DimLiveBatch[] = [];
  store.apply([{ seq: seq++, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'Live', attached: ['hsid-1'], opened: 'command', relayedFor: HUMAN } }]);
  const live = new DimLive({ dim: DIM, me: ME, stateAt: (s) => store.stateAt(DIM, s), send: (b) => void sent.push(b), now: () => now, mint: () => ULID(minted++) });
  /** the mod appends a row with these ops; returns the row as the subscription would deliver it */
  const append = (ops: readonly DimOp[], relayedFor: unknown = HUMAN): DimRow => {
    const row = { seq: seq++, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: [...ops], relayedFor } };
    return store.apply([row]).get(DIM)![0]!;
  };
  return { store, live, sent, append, tick: (ms: number) => (now += ms), now: () => now, nodes: () => [...live.view().nodes.keys()], confirmedNodes: () => [...store.stateAt(DIM).nodes.keys()] };
}

describe('#gui-dim-live the write path', () => {
  it('view is the confirmed fold plus pending batches drawn as me; ack then row confirms', () => {
    const r = rig();
    expect(r.live.status()).toMatchObject({ keep: 'saved', pending: 0, inFlight: false, canUndo: false });
    expect(r.live.local([rect(1)], press(r.now()))).toEqual({ changed: true, notice: null });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ id: 1, ops: [rect(1)] });
    expect(r.nodes()).toEqual([ULID(1)]);
    expect(r.confirmedNodes()).toEqual([]);
    expect(r.live.view().nodes.get(ULID(1))!.by).toEqual({ cls: 'human', principal: 'p:me/human' });
    expect(r.live.view().seq).toBe(1);
    expect(r.live.status()).toMatchObject({ keep: 'saving', pending: 1, inFlight: true });
    const row = r.append(r.sent[0]!.ops);
    expect(r.live.ack(1, { ok: true, seq: row.seq, refused: [] })).toEqual({ changed: false, notice: null });
    expect(r.live.status().inFlight).toBe(true);
    expect(r.live.row(row)).toEqual({ changed: true, notice: null });
    expect(r.live.status()).toMatchObject({ keep: 'saved', pending: 0, inFlight: false, canUndo: true });
    expect(dimHash(r.live.view())).toBe(dimHash(r.store.stateAt(DIM)));
  });

  it('reorder: a row that arrives before its ack confirms when the ack names it', () => {
    const r = rig();
    r.live.local([rect(1), rect(2, { label: 'no' })], press(r.now()));
    // the mod kept one op of two, so the row does not carry the batch's ops verbatim
    const other = r.append([rect(50)], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' });
    r.live.row(other);
    const row = r.append([rect(1)]);
    r.live.row(row);
    expect(r.live.status().inFlight).toBe(true);
    const res = r.live.ack(1, { ok: true, seq: row.seq, refused: [{ field: 'label', code: 'secret' }] });
    expect(res).toEqual({ changed: true, notice: { code: 'secret', field: 'label', why: null, lost: 1 } });
    expect(r.live.status()).toMatchObject({ pending: 0, inFlight: false });
    expect(r.nodes().sort()).toEqual([ULID(1), ULID(50)]);
  });

  it('reorder: a row carrying exactly the in-flight ops under my stamp confirms at once; the late ack is ignored', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local([{ type: 'move', ids: [ULID(1)], dx: 5, dy: 0 }], press(r.now()));
    const row = r.append(r.sent[0]!.ops);
    r.live.row(row);
    // confirmed, and the queued move went out: the mark is never drawn moved twice
    expect(r.sent.map((b) => b.id)).toEqual([1, 2]);
    expect(r.live.view().nodes.get(ULID(1))!.node.x).toBe(6);
    expect(r.live.ack(1, { ok: true, seq: row.seq, refused: [] })).toEqual({ changed: false, notice: null });
    // the same ops from another hand do not confirm mine
    const r2 = rig();
    r2.live.local([rect(1)], press(r2.now()));
    r2.live.row(r2.append([rect(1)], { principal: 'p:other/human', surface: 'gui' }));
    expect(r2.live.status().inFlight).toBe(true);
  });

  it('one send in flight; queued edits coalesce up to 64 ops, then start another batch', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    const g2 = press(r.now());
    const g3 = press(r.now());
    r.live.local([rect(2)], g2);
    r.live.local([rect(3), rect(4)], g3);
    expect(r.sent).toHaveLength(1);
    expect(r.live.status()).toMatchObject({ pending: 2, inFlight: true });
    const many: DimOp[] = [];
    for (let i = 0; i < 62; i++) many.push(rect(100 + i));
    r.live.local(many, press(r.now()));
    expect(r.live.status().pending).toBe(3);
    const row = r.append(r.sent[0]!.ops);
    r.live.ack(1, { ok: true, seq: row.seq, refused: [] });
    r.live.row(row);
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]!.ops).toHaveLength(64);
    expect(r.sent[1]!.ops.slice(0, 3)).toEqual([rect(2), rect(3), rect(4)]);
    expect(r.live.status()).toMatchObject({ pending: 2, inFlight: true });
    expect(r.nodes()).toHaveLength(66);
  });

  it('an edit of more than 64 ops is split into rows; too many waiting edits are refused whole with a notice', () => {
    const r = rig();
    const many: DimOp[] = [];
    for (let i = 0; i < 130; i++) many.push(rect(100 + i));
    expect(r.live.local(many, press(r.now())).changed).toBe(true);
    expect(r.live.status().pending).toBe(3);
    expect(r.sent[0]!.ops).toHaveLength(64);
    const big: DimOp[] = [];
    for (let i = 0; i < 64 * DIM_LIVE_LIMITS.pending; i++) big.push(rect(1000 + i));
    expect(r.live.local(big, press(r.now()))).toEqual({ changed: false, notice: { code: 'busy', field: 'ops', why: null, lost: big.length } });
    expect(r.live.status().pending).toBe(3);
    expect(r.nodes()).toHaveLength(130);
  });

  it('a locally refused op is named and never queued; a secret queues nothing', () => {
    const r = rig();
    const res = r.live.local([rect(1), rect(2, { link: 'https://x.example' }), rect(3, { color: 'url(x)' })], press(r.now()));
    expect(res).toEqual({ changed: true, notice: { code: 'field-unknown', field: 'unknown', why: null, lost: 2 } });
    expect(r.sent[0]!.ops).toEqual([rect(1)]);
    const s = r.live.local([rect(4), rect(5, { label: 'AKIAIOSFODNN7EXAMPLE secret key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' })], press(r.now()));
    expect(s.changed).toBe(false);
    expect(s.notice).toMatchObject({ code: 'secret', lost: 2 });
    expect(r.live.status().pending).toBe(1);
    expect(r.live.local([], press(r.now()))).toEqual({ changed: false, notice: null });
  });
});

describe('#gui-dim-live a mark never vanishes silently', () => {
  it('refusal: the batch is dropped with one notice naming the field and the code', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    expect(r.live.ack(1, { ok: true, seq: null, refused: [{ field: 'z', code: 'z-bad' }] })).toEqual({ changed: true, notice: { code: 'z-bad', field: 'z', why: null, lost: 1 } });
    expect(r.nodes()).toEqual([]);
    expect(r.live.status()).toMatchObject({ keep: 'saved', pending: 0, inFlight: false, canUndo: false });
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.ack(2, { ok: false, code: 'gesture-refused', why: 'spent' })).toEqual({ changed: true, notice: { code: 'gesture-refused', field: 'ops', why: 'spent', lost: 1 } });
    expect(r.live.ack(2, { ok: false, code: 'refused' })).toEqual({ changed: false, notice: null });
  });

  it('timeout: 8 s with no ack and no row drops the batch; not before', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    expect(r.live.nextDeadline()).toBe(r.now() + DIM_LIVE_TIMEOUT_MS);
    r.tick(DIM_LIVE_TIMEOUT_MS - 1);
    expect(r.live.timeout()).toEqual({ changed: false, notice: null });
    r.tick(1);
    expect(r.live.timeout()).toEqual({ changed: true, notice: { code: 'timeout', field: 'ops', why: 'no-ack', lost: 1 } });
    expect(r.nodes()).toEqual([]);
    expect(r.live.nextDeadline()).toBeNull();
    // the row turns up after all: it is simply the confirmed state, and the late ack is ignored
    const row = r.append(r.sent[0]!.ops);
    r.live.row(row);
    expect(r.live.ack(1, { ok: true, seq: row.seq, refused: [] })).toEqual({ changed: false, notice: null });
    expect(r.nodes()).toEqual([ULID(1)]);
    expect(r.live.status().canUndo).toBe(false);
  });

  it('an acked batch whose row does not arrive within 8 s of the ack is dropped with a notice too', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.tick(5000);
    r.live.ack(1, { ok: true, seq: 99, refused: [] });
    r.tick(5000);
    expect(r.live.timeout().notice).toBeNull();
    r.tick(3000);
    expect(r.live.timeout().notice).toEqual({ code: 'timeout', field: 'ops', why: 'no-row', lost: 1 });
  });

  it('a later batch that depended on a dropped one loses the ops that no longer hold: ONE notice counts them all', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local([{ type: 'move', ids: [ULID(1)], dx: 5, dy: 0 }, rect(2)], press(r.now()));
    const many: DimOp[] = [];
    for (let i = 0; i < 63; i++) many.push(rect(100 + i));
    r.live.local(many, press(r.now()));
    r.live.local([{ type: 'update', id: ULID(1), patch: { w: 20 } }, { type: 'update', id: ULID(2), patch: { w: 30 } }], press(r.now()));
    expect(r.live.status().pending).toBe(3);
    const res = r.live.ack(1, { ok: false, code: 'read-only', why: 'command-read' });
    // lost: the add, the move of it and the update of it
    expect(res).toEqual({ changed: true, notice: { code: 'read-only', field: 'ops', why: 'command-read', lost: 3 } });
    expect(r.live.view().nodes.has(ULID(1))).toBe(false);
    expect(r.live.view().nodes.get(ULID(2))!.node.w).toBe(30);
    // the survivors went out
    expect(r.sent[1]!.ops[0]).toEqual(rect(2));
    expect(r.sent[1]!.ops).toHaveLength(63);
    expect(r.live.status()).toMatchObject({ pending: 2, inFlight: true });
  });

  it('link down: nothing is sent, a new edit is refused with a notice, pending rolls back at the timeout', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.link(false)).toEqual({ changed: true, notice: null });
    expect(r.live.link(false)).toEqual({ changed: false, notice: null });
    expect(r.live.status()).toMatchObject({ keep: 'not-saved', link: 'down', pending: 2 });
    expect(r.live.local([rect(3)], press(r.now()))).toEqual({ changed: false, notice: { code: 'link-down', field: 'ops', why: null, lost: 1 } });
    expect(r.live.undo(press(r.now())).notice?.code).toBe('undo-nothing');
    r.tick(DIM_LIVE_TIMEOUT_MS);
    // the in-flight batch first; the queued one was not sent meanwhile
    expect(r.live.timeout()).toEqual({ changed: true, notice: { code: 'link-down', field: 'ops', why: 'no-ack', lost: 1 } });
    expect(r.sent).toHaveLength(1);
    expect(r.live.timeout()).toEqual({ changed: true, notice: { code: 'link-down', field: 'ops', why: null, lost: 1 } });
    expect(r.live.status()).toMatchObject({ keep: 'saved', link: 'down', pending: 0 });
    expect(r.nodes()).toEqual([]);
    expect(r.live.timeout()).toEqual({ changed: false, notice: null });
  });

  it('link back up within the timeout sends what is still queued', () => {
    const r = rig();
    r.live.link(false);
    r.live.link(true);
    r.live.local([rect(1)], press(r.now()));
    r.live.local([rect(2)], press(r.now()));
    r.live.link(false);
    r.live.ack(1, { ok: false, code: 'link-down' });
    expect(r.sent).toHaveLength(1);
    r.live.link(true);
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]!.ops).toEqual([rect(2)]);
  });
});

describe('#gui-dim-live undo (Aegis B3)', () => {
  const confirmNext = (r: ReturnType<typeof rig>): DimRow => {
    const b = r.sent[r.sent.length - 1]!;
    const row = r.append(b.ops);
    r.live.ack(b.id, { ok: true, seq: row.seq, refused: [] });
    r.live.row(row);
    return row;
  };

  it('undoes only confirmed rows of this page, newest first, as a validated inverse sent like any edit', () => {
    const r = rig();
    // another hand's row is never an undo entry
    r.live.row(r.append([rect(40)], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' }));
    expect(r.live.undo(press(r.now()))).toEqual({ changed: false, notice: { code: 'undo-nothing', field: 'ops', why: null, lost: 0 } });
    r.live.local([rect(1)], press(r.now()));
    // pending, not confirmed: still nothing to undo
    expect(r.live.undo(press(r.now())).notice?.code).toBe('undo-nothing');
    confirmNext(r);
    r.live.local([{ type: 'move', ids: [ULID(1)], dx: 5, dy: 5 }], press(r.now()));
    confirmNext(r);
    const g = press(r.now());
    expect(r.live.undo(g)).toEqual({ changed: true, notice: null });
    expect(r.sent[2]).toMatchObject({ ops: [{ type: 'move', ids: [ULID(1)], dx: -5, dy: -5 }], gesture: g });
    confirmNext(r);
    // the undo's own row is not an undo entry (no redo in S1.3): the next undo takes the add
    expect(r.live.undo(press(r.now())).changed).toBe(true);
    expect(r.sent[3]!.ops).toEqual([{ type: 'delete', id: ULID(1) }]);
    confirmNext(r);
    expect(r.live.status().canUndo).toBe(false);
    expect(r.confirmedNodes()).toEqual([ULID(40)]);
  });

  it('undo of a delete re-adds under a minted id; an undo is never merged into a queued edit', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    r.live.local([{ type: 'delete', id: ULID(1) }], press(r.now()));
    confirmNext(r);
    r.live.local([rect(2)], press(r.now()));
    r.live.local([rect(3)], press(r.now()));
    expect(r.live.undo(press(r.now())).changed).toBe(true);
    r.live.local([rect(4)], press(r.now()));
    // in flight: rect 2; queued: [rect 3], [undo], [rect 4]
    expect(r.live.status().pending).toBe(4);
    expect(r.live.view().nodes.get(ULID(700))!.node).toMatchObject({ kind: 'rect', x: 1 });
    expect(r.live.view().gone.has(ULID(1))).toBe(true);
  });

  it('an inverse that no longer validates is refused whole with a notice, and nothing is sent', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    r.live.local([{ type: 'update', id: ULID(1), patch: { w: 99 } }], press(r.now()));
    confirmNext(r);
    r.live.row(r.append([{ type: 'delete', id: ULID(1) }]));
    const before = r.sent.length;
    expect(r.live.undo(press(r.now()))).toEqual({ changed: false, notice: { code: 'undo-invalid', field: 'id', why: 'id-missing', lost: 0 } });
    expect(r.sent).toHaveLength(before);
  });

  it('remembers a bounded number of undo entries', () => {
    const r = rig();
    for (let i = 0; i < DIM_LIVE_LIMITS.undo + 5; i++) {
      r.live.local([rect(i + 1)], press(r.now()));
      confirmNext(r);
    }
    let undone = 0;
    while (r.live.status().canUndo) {
      r.live.undo(press(r.now()));
      confirmNext(r);
      undone += 1;
    }
    expect(undone).toBe(DIM_LIVE_LIMITS.undo);
    expect(r.confirmedNodes()).toHaveLength(5);
  });
});

describe('#gui-dim-live helpers and source rules', () => {
  it('dimAckOf reads the mod result, bare or wrapped, and never echoes input', () => {
    expect(dimAckOf({ seq: 9, refused: [] })).toEqual({ ok: true, seq: 9, refused: [] });
    expect(dimAckOf({ result: { seq: 9, refused: [{ index: 0, field: 'z', code: 'z-bad', fix: 'x' }] } })).toEqual({ ok: true, seq: 9, refused: [{ field: 'z', code: 'z-bad' }] });
    expect(dimAckOf({ refused: [{ field: 'text', code: 'secret' }] })).toEqual({ ok: true, seq: null, refused: [{ field: 'text', code: 'secret' }] });
    expect(dimAckOf({ refused: 'not-attached' })).toEqual({ ok: false, code: 'refused', why: 'not-attached' });
    expect(dimAckOf({ refused: '<b>x</b>' })).toEqual({ ok: false, code: 'refused', why: null });
    expect(dimAckOf(null)).toEqual({ ok: false, code: 'refused', why: null });
    expect(dimAckOf({ seq: '9' })).toEqual({ ok: true, seq: null, refused: [] });
  });

  it('a row of another dimension changes nothing', () => {
    const r = rig();
    expect(r.live.row({ seq: 50, kind: DIM_KINDS.op, payload: { v: 1, dim: 'dim:01JD1MVECT0R00000000000009', ops: [] } })).toEqual({ changed: false, notice: null });
  });

  it('has no timer, no DOM, no log line and no row-by-row fold', () => {
    for (const file of ['dim-live.ts', 'dim-undo.ts']) {
      const src = readFileSync(path.join(ROOT, 'src', 'core', file), 'utf8');
      expect(src).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.|document\.|window\.|console\.|foldDimRow/);
    }
  });
});
