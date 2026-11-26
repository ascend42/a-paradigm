/**
 * #gui-dim-live (boards S1.3, draft point 6; Mika's open items 1 and 2; Aegis B3): the live controller.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow } from '@a-company/gnomon-contracts';
import { DIM_COMMAND_REFUSALS, DIM_LIVE_LIMITS, DIM_LIVE_SEND_GAP_MS, DIM_LIVE_TIMEOUT_MS, DimLive, dimAckOf } from '../src/core/dim-live.js';
import type { DimLiveBatch } from '../src/core/dim-live.js';
import { DimStore } from '../src/core/dim-store.js';
import { gestureOf } from '../src/core/gesture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIM = 'dim:01JD1MVECT0R00000000000001';
const ME = { cls: 'human' as const, principal: 'p:me/human' };
const HUMAN = { principal: 'p:me/human', surface: 'gui' };
const ULID = (n: number): string => `01JD1M11VE${String(n).padStart(16, '0')}`;
const rect = (n: number, extra: Record<string, unknown> = {}): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'rect', x: n, y: 0, z: 'V', w: 10, h: 10, ...extra } as never });
const press = (now: number) => gestureOf({ isTrusted: true, type: 'pointerup' }, now)!;

/** A store, a controller, a clock and a fake mod that appends on demand. */
function rig(o: { connId?: string; stamp?: unknown } = {}) {
  const STAMP = o.stamp ?? HUMAN;
  const store = new DimStore();
  let seq = 1;
  let now = 1000;
  let minted = 700;
  const sent: DimLiveBatch[] = [];
  store.apply([{ seq: seq++, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'Live', attached: ['hsid-1'], opened: 'command', relayedFor: HUMAN } }]);
  const live = new DimLive({ dim: DIM, me: ME, ...(o.connId ? { connId: o.connId } : {}), stateAt: (s) => store.stateAt(DIM, s), send: (b) => void sent.push(b), now: () => now, mint: () => ULID(minted++) });
  /** the row object only: the store has not folded it yet */
  const make = (ops: readonly DimOp[], relayedFor: unknown = STAMP): DimRow => ({ seq: seq++, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: [...ops], relayedFor } });
  /** the mod appends a row with these ops; returns the row as the subscription would deliver it */
  const append = (ops: readonly DimOp[], relayedFor: unknown = STAMP): DimRow => store.apply([make(ops, relayedFor)]).get(DIM)![0]!;
  /** let the send gap pass and tick, so a queued batch goes out */
  const gap = (): void => {
    now += DIM_LIVE_SEND_GAP_MS;
    live.timeout();
  };
  return { store, live, sent, append, make, gap, tick: (ms: number) => (now += ms), now: () => now, nodes: () => [...live.view().nodes.keys()], confirmedNodes: () => [...store.stateAt(DIM).nodes.keys()] };
}

const OK = { changed: true, resync: false, notice: null };
const NOTHING = { changed: false, resync: false, notice: null };
const confirmNext = (r: ReturnType<typeof rig>): DimRow => {
  const b = r.sent[r.sent.length - 1]!;
  const row = r.append(b.ops);
  r.live.ack(b.id, { ok: true, seq: row.seq, refused: [] });
  r.live.row(row);
  r.gap();
  return row;
};

describe('#gui-dim-live the write path', () => {
  it('Mika P0b S2b: a colour the contrast rule refuses names its part in the notice, as a closed word', () => {
    const r = rig();
    const res = r.live.local([rect(1, { color: 'custom:#858585', fill: 'cobalt' })], press(r.now()));
    expect(res.notice).toMatchObject({ code: 'colour-bad', field: 'color', why: 'pair-line' });
    expect(r.live.local([rect(2, { color: 'custom:#B4382A' })], press(r.now())).notice).toMatchObject({ code: 'colour-bad', field: 'color', why: null });
  });
  it('view is the confirmed fold plus pending batches drawn as me; ack then row confirms', () => {
    const r = rig();
    expect(r.live.status()).toEqual({ keep: 'saved', link: 'up', pending: 0, inFlight: false, canUndo: false, since: null });
    expect(r.live.local([rect(1)], press(r.now()))).toEqual(OK);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ id: 1, ops: [rect(1)] });
    expect(r.nodes()).toEqual([ULID(1)]);
    expect(r.confirmedNodes()).toEqual([]);
    expect(r.live.view().nodes.get(ULID(1))!.by).toEqual({ cls: 'human', principal: 'p:me/human' });
    expect(r.live.view().seq).toBe(1);
    expect(r.live.status()).toMatchObject({ keep: 'saving', pending: 1, inFlight: true, canUndo: false, since: 1000 });
    const row = r.append(r.sent[0]!.ops, { principal: 'p:someone/else', surface: 'gui' });
    expect(r.live.ack(1, { ok: true, seq: row.seq, refused: [] })).toEqual(NOTHING);
    expect(r.live.status().inFlight).toBe(true);
    expect(r.live.row(row)).toEqual(OK);
    expect(r.live.status()).toMatchObject({ keep: 'saved', pending: 0, inFlight: false, canUndo: true, since: null });
    expect(dimHash(r.live.view())).toBe(dimHash(r.store.stateAt(DIM)));
  });

  it('8. an edit with no gesture is never shown: not-sent notice, resync, nothing pending', () => {
    const r = rig();
    expect(r.live.local([rect(1)], null)).toEqual({ changed: false, resync: true, notice: { code: 'not-sent', field: 'ops', why: 'gesture-missing', lost: 1 } });
    expect(r.nodes()).toEqual([]);
    expect(r.sent).toEqual([]);
    expect(r.live.status().pending).toBe(0);
  });

  it('8. the NEWEST stamp rides a coalesced batch, and a stamp-less edit never replaces a queued stamp', () => {
    const r = rig();
    const g1 = press(r.now());
    const g2 = press(r.now());
    const g3 = press(r.now());
    r.live.local([rect(1)], g1);
    r.live.local([rect(2)], g2);
    r.live.local([rect(3)], g3);
    expect(r.live.local([rect(4)], null).notice?.code).toBe('not-sent');
    confirmNext(r);
    expect(r.sent[0]!.gesture).toBe(g1);
    expect(r.sent[1]).toMatchObject({ ops: [rect(2), rect(3)] });
    expect(r.sent[1]!.gesture).toBe(g3);
  });

  it('12. a row of mine that lands before its ack and differs from what was sent is never applied twice', () => {
    const r = rig({ connId: 'conn:me' });
    const mine = { ...HUMAN, connId: 'conn:me' };
    r.live.local([rect(1, { x: 1 })], press(r.now()));
    r.live.row(r.append(r.sent[0]!.ops, mine));
    r.gap();
    // Probe's case: a move and an update of a node someone has just deleted; the mod keeps only the move
    r.live.row(r.append([rect(2)], mine));
    r.live.row(r.append([{ type: 'delete', id: ULID(2) }], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' }));
    const sentOps: DimOp[] = [{ type: 'move', ids: [ULID(1)], dx: 5, dy: 0 }, { type: 'update', id: ULID(1), patch: { w: 77 } }];
    r.live.local(sentOps, press(r.now()));
    expect(r.live.view().nodes.get(ULID(1))!.node).toMatchObject({ x: 6, w: 77 });
    const row = r.append([sentOps[0]!], mine);
    expect(r.live.row(row)).toEqual(OK);
    // before the ack: the row is in, the batch is no longer laid over it (x is 6, never 11)
    expect(r.live.view().nodes.get(ULID(1))!.node).toMatchObject({ x: 6, w: 10 });
    expect(r.live.status()).toMatchObject({ inFlight: true, pending: 1 });
    expect(r.live.ack(2, { ok: true, seq: row.seq, refused: [{ field: 'w', code: 'field-range' }] })).toEqual({ changed: true, resync: true, notice: { code: 'field-range', field: 'w', why: null, lost: 1 } });
    expect(r.live.status()).toMatchObject({ inFlight: false, pending: 0, canUndo: true });
    // the undo entry is what the ROW carried
    r.gap();
    r.live.undo(press(r.now()));
    expect(r.sent[r.sent.length - 1]!.ops).toEqual([{ type: 'move', ids: [ULID(1)], dx: -5, dy: 0 }]);
  });

  it('12. the ack is lost after my row landed: the row stands, the ops it lacks are reported, and it can be undone', () => {
    const r = rig();
    r.live.local([rect(1), rect(2)], press(r.now()));
    const row = r.append([rect(1)]);
    r.live.row(row);
    expect(r.nodes()).toEqual([ULID(1)]);
    r.tick(DIM_LIVE_TIMEOUT_MS);
    expect(r.live.timeout()).toEqual({ changed: true, resync: true, notice: { code: 'ops-refused', field: 'ops', why: 'no-ack', lost: 1 } });
    expect(r.nodes()).toEqual([ULID(1)]);
    expect(r.live.status()).toMatchObject({ pending: 0, canUndo: true });
    // the same through a failed send that may have been delivered
    const r2 = rig();
    r2.live.local([rect(1), rect(2)], press(r2.now()));
    r2.live.row(r2.append([rect(1), rect(2)].slice(0, 1)));
    expect(r2.live.ack(1, { ok: false, code: 'no-answer' }).notice).toEqual({ code: 'ops-refused', field: 'ops', why: 'no-ack', lost: 1 });
    expect(r2.live.status().canUndo).toBe(true);
    // a definite refusal is not rescued by a row: the batch is dropped
    const r3 = rig();
    r3.live.local([rect(1), rect(2)], press(r3.now()));
    r3.live.row(r3.append([rect(9)]));
    expect(r3.live.ack(1, { ok: false, code: 'read-only', why: 'command-read' }).notice).toMatchObject({ code: 'read-only', lost: 2 });
  });

  it('12. view() is safe whichever comes first, the store folding a row or row() being told', () => {
    const r = rig();
    r.live.local([rect(1), { type: 'move', ids: [ULID(1)], dx: 5, dy: 0 }], press(r.now()));
    expect(r.live.view().nodes.get(ULID(1))!.node.x).toBe(6);
    // the store folds first; row() has not been called yet
    const row = r.append(r.sent[0]!.ops);
    expect(r.store.stateAt(DIM).nodes.get(ULID(1))!.node.x).toBe(6);
    expect(r.live.view().nodes.get(ULID(1))!.node.x).toBe(6);
    expect(r.live.view().seq).toBe(1);
    r.live.row(row);
    expect(r.live.view().nodes.get(ULID(1))!.node.x).toBe(6);
    expect(r.live.view().seq).toBe(row.seq);
    // row() first, the store after: the view is the confirmed state without the row, with no overlay of it
    const r2 = rig();
    r2.live.local([rect(1), { type: 'move', ids: [ULID(1)], dx: 5, dy: 0 }], press(r2.now()));
    const later = r2.make(r2.sent[0]!.ops);
    r2.live.row(later);
    expect(r2.live.status().pending).toBe(0);
    r2.store.apply([later]);
    expect(r2.live.view().nodes.get(ULID(1))!.node.x).toBe(6);
  });

  it('13. early confirm reads the stamp by own keys and tells another tab of the same principal apart by connId', () => {
    const ops = [rect(1)];
    // another tab: same principal, another connection
    const r = rig({ connId: 'conn:me' });
    r.live.local(ops, press(r.now()));
    r.live.row(r.append(ops, { ...HUMAN, connId: 'conn:other-tab' }));
    expect(r.live.status().inFlight).toBe(true);
    // my connection
    const r1 = rig({ connId: 'conn:me' });
    r1.live.local(ops, press(r1.now()));
    r1.live.row(r1.append(ops, { ...HUMAN, connId: 'conn:me' }));
    expect(r1.live.status().inFlight).toBe(false);
    // a stamp read through a prototype is no stamp
    const r2 = rig();
    r2.live.local(ops, press(r2.now()));
    r2.live.row(r2.append(ops, Object.create(HUMAN)));
    r2.live.row(r2.append(ops, Object.assign(Object.create({ principal: 'p:me/human' }), { surface: 'gui' })));
    expect(r2.live.status().inFlight).toBe(true);
    // an agent row under my principal, or another surface, is not mine
    r2.live.row(r2.append(ops, { ...HUMAN, agent: 'kit' }));
    r2.live.row(r2.append(ops, { principal: 'p:me/human', surface: 'cli' }));
    expect(r2.live.status().inFlight).toBe(true);
    // with no connId known to the page, the principal decides (stated: two tabs cannot be told apart then)
    const r3 = rig();
    r3.live.local(ops, press(r3.now()));
    r3.live.row(r3.append(ops, { ...HUMAN, connId: 'conn:any' }));
    expect(r3.live.status().inFlight).toBe(false);
  });

  it('13. more early rows than the buffer holds: the acked row still confirms, never a false no-row drop', () => {
    // the host stamps this page's rows with a principal the page does not expect, so no row is taken for mine early
    const r = rig({ stamp: { principal: 'p:me/other-form', surface: 'gui' } });
    r.live.local([rect(1)], press(r.now()));
    const mineRow = r.append(r.sent[0]!.ops);
    r.live.row(mineRow);
    for (let i = 0; i < DIM_LIVE_LIMITS.seen + 20; i++) r.live.row(r.append([rect(1000 + i)], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' }));
    expect(r.live.status().inFlight).toBe(true);
    expect(r.live.ack(1, { ok: true, seq: mineRow.seq, refused: [] })).toEqual(OK);
    expect(r.live.status()).toMatchObject({ inFlight: false, pending: 0, canUndo: true });
    r.tick(DIM_LIVE_TIMEOUT_MS * 2);
    expect(r.live.timeout()).toEqual(NOTHING);
    // the buffer starts empty for the next send: an old row's seq is not mistaken for the new batch's
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.ack(2, { ok: true, seq: 999_999, refused: [] })).toEqual(NOTHING);
    expect(r.live.status().inFlight).toBe(true);
  });

  it('one send in flight; a queued edit joins the batch still waiting when both fit one row, else it starts another (an action is never cut across two batches)', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local([rect(2)], press(r.now()));
    r.live.local([rect(3), rect(4)], press(r.now()));
    expect(r.sent).toHaveLength(1);
    expect(r.live.status()).toMatchObject({ pending: 2, inFlight: true });
    const many: DimOp[] = [];
    for (let i = 0; i < 62; i++) many.push(rect(100 + i));
    r.live.local(many, press(r.now()));
    expect(r.live.status().pending).toBe(3);
    confirmNext(r);
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]!.ops).toEqual([rect(2), rect(3), rect(4)]);
    expect(r.live.status()).toMatchObject({ pending: 2, inFlight: true });
    expect(r.nodes()).toHaveLength(66);
  });

  it('a merge fills a batch to exactly 64 ops (3 + 61) and not one more', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now())); // in flight
    r.live.local([rect(2), rect(3), rect(4)], press(r.now()));
    r.live.local(Array.from({ length: 61 }, (_, i) => rect(100 + i)), press(r.now()));
    expect(r.live.status().pending).toBe(2);
    r.live.local([rect(500)], press(r.now()));
    expect(r.live.status().pending).toBe(3);
    confirmNext(r);
    expect(r.sent[1]!.ops).toHaveLength(64);
    expect(r.sent[1]!.ops.slice(0, 3)).toEqual([rect(2), rect(3), rect(4)]);
    confirmNext(r);
    expect(r.sent[2]!.ops).toEqual([rect(500)]);
  });

  it('18. sends are spaced: a queued batch waits for the gap, and nextDeadline says when', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local([rect(2)], press(r.now()));
    const row = r.append(r.sent[0]!.ops);
    r.live.row(row);
    // confirmed at the same instant it was sent: the next one is not sent yet
    expect(r.sent).toHaveLength(1);
    expect(r.live.status()).toMatchObject({ inFlight: false, pending: 1 });
    expect(r.live.nextDeadline()).toBe(1000 + DIM_LIVE_SEND_GAP_MS);
    r.tick(DIM_LIVE_SEND_GAP_MS - 1);
    expect(r.live.timeout()).toEqual(NOTHING);
    r.tick(1);
    expect(r.live.timeout()).toEqual(OK);
    expect(r.sent).toHaveLength(2);
    expect(DIM_LIVE_SEND_GAP_MS).toBeGreaterThanOrEqual(1000 / 20);
  });

  it('an action of more than 64 ops could never be undone within the bound, so it is refused whole; heavy actions are groups of rows; too many waiting edits are refused whole with a notice', () => {
    const r = rig();
    const many: DimOp[] = [];
    for (let i = 0; i < 130; i++) many.push(rect(100 + i));
    expect(r.live.local(many, press(r.now()))).toEqual({ changed: false, resync: true, notice: { code: 'not-undoable', field: 'ops', why: 'too-many-ops', lost: 130 } });
    expect(r.live.status().pending).toBe(0);
    expect(r.sent).toEqual([]);
    const heavy = (from: number): DimOp[] => Array.from({ length: 9 }, (_, i) => ({ type: 'add', node: { id: ULID(from + i), kind: 'text', x: i, y: 0, z: 'V', text: 'w'.repeat(3900) } as never }));
    // five actions of three rows each: 15 pending; a sixth does not fit the 16
    for (let k = 0; k < 5; k++) expect(r.live.local(heavy(1000 + k * 20), press(r.now())).changed).toBe(true);
    expect(r.live.status().pending).toBe(15);
    expect(r.sent).toHaveLength(1);
    expect(r.live.local(heavy(5000), press(r.now()))).toEqual({ changed: false, resync: true, notice: { code: 'busy', field: 'ops', why: null, lost: 9 } });
    expect(r.live.status().pending).toBe(15);
    expect(r.nodes()).toHaveLength(45);
  });

  it('14. a locally refused op is named with resync and never queued; a secret queues nothing', () => {
    const r = rig();
    const res = r.live.local([rect(1), rect(2, { link: 'https://x.example' }), rect(3, { color: 'url(x)' })], press(r.now()));
    expect(res).toEqual({ changed: true, resync: true, notice: { code: 'field-unknown', field: 'unknown', why: null, lost: 2 } });
    expect(r.sent[0]!.ops).toEqual([rect(1)]);
    const s = r.live.local([rect(4), rect(5, { label: 'AKIAIOSFODNN7EXAMPLE secret key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' })], press(r.now()));
    expect(s).toMatchObject({ changed: false, resync: true, notice: { code: 'secret', lost: 2 } });
    expect(r.live.status().pending).toBe(1);
    expect(r.live.local([], press(r.now()))).toEqual(NOTHING);
  });
});

describe('#gui-dim-live a mark never vanishes silently', () => {
  it('refusal: the batch is dropped with one notice naming the field and the code, and the caller is told to resync', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    expect(r.live.ack(1, { ok: true, seq: null, refused: [{ field: 'z', code: 'z-bad' }] })).toEqual({ changed: true, resync: true, notice: { code: 'z-bad', field: 'z', why: null, lost: 1 } });
    expect(r.nodes()).toEqual([]);
    expect(r.live.status()).toMatchObject({ keep: 'saved', pending: 0, inFlight: false, canUndo: false });
    r.gap();
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.ack(2, { ok: false, code: 'gesture-refused', why: 'spent' })).toEqual({ changed: true, resync: true, notice: { code: 'gesture-refused', field: 'ops', why: 'spent', lost: 1 } });
    expect(r.live.ack(2, { ok: false, code: 'refused' })).toEqual(NOTHING);
    // a long stroke the mod will not hold in one row: the notice carries its code (splitting is a later pass)
    r.gap();
    r.live.local([rect(3)], press(r.now()));
    expect(r.live.ack(3, dimAckOf({ ok: false, code: 'row-too-large', fix: 'x' })).notice).toEqual({ code: 'row-too-large', field: 'ops', why: null, lost: 1 });
  });

  it('timeout: 8 s with no ack and no row drops the batch; not before', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    expect(r.live.nextDeadline()).toBe(r.now() + DIM_LIVE_TIMEOUT_MS);
    r.tick(DIM_LIVE_TIMEOUT_MS - 1);
    expect(r.live.timeout()).toEqual(NOTHING);
    r.tick(1);
    expect(r.live.timeout()).toEqual({ changed: true, resync: true, notice: { code: 'timeout', field: 'ops', why: 'no-ack', lost: 1 } });
    expect(r.nodes()).toEqual([]);
    expect(r.live.nextDeadline()).toBeNull();
    // the row turns up after all: it is simply the confirmed state, and the late ack is ignored
    const row = r.append(r.sent[0]!.ops);
    r.live.row(row);
    expect(r.live.ack(1, { ok: true, seq: row.seq, refused: [] })).toEqual(NOTHING);
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
    expect(r.live.status().pending).toBe(4);
    const res = r.live.ack(1, { ok: false, code: 'read-only', why: 'command-read' });
    // lost: the add, the move of it and the update of it
    expect(res).toEqual({ changed: true, resync: true, notice: { code: 'read-only', field: 'ops', why: 'command-read', lost: 3 } });
    expect(r.live.view().nodes.has(ULID(1))).toBe(false);
    expect(r.live.view().nodes.get(ULID(2))!.node.w).toBe(30);
    // the survivors go out
    r.gap();
    expect(r.sent[1]!.ops).toEqual([rect(2)]);
    expect(r.live.status()).toMatchObject({ pending: 3, inFlight: true });
  });

  it('link down: nothing is sent, a new edit is refused with a notice, pending rolls back at the timeout', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.link(false)).toEqual(OK);
    expect(r.live.link(false)).toEqual(NOTHING);
    expect(r.live.status()).toMatchObject({ keep: 'not-saved', link: 'down', pending: 2, since: 1000 });
    expect(r.live.local([rect(3)], press(r.now()))).toEqual({ changed: false, resync: true, notice: { code: 'link-down', field: 'ops', why: null, lost: 1 } });
    r.tick(DIM_LIVE_TIMEOUT_MS);
    // the in-flight batch first; the queued one was not sent meanwhile
    // the in-flight batch and what waited behind it fall TOGETHER, under one notice
    expect(r.live.timeout()).toEqual({ changed: true, resync: true, notice: { code: 'link-down', field: 'ops', why: 'no-ack', lost: 2 } });
    expect(r.sent).toHaveLength(1);
    expect(r.live.status()).toMatchObject({ keep: 'saved', link: 'down', pending: 0 });
    expect(r.nodes()).toEqual([]);
    expect(r.live.timeout()).toEqual(NOTHING);
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
    r.tick(DIM_LIVE_SEND_GAP_MS);
    r.live.link(true);
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]!.ops).toEqual([rect(2)]);
  });
});

describe('#gui-dim-live undo (Aegis B3)', () => {
  it('undoes only confirmed rows of this page, newest first, as a validated inverse sent like any edit', () => {
    const r = rig();
    // another hand's row is never an undo entry
    r.live.row(r.append([rect(40)], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' }));
    expect(r.live.undo(press(r.now()))).toEqual({ changed: false, resync: false, notice: { code: 'undo-nothing', field: 'ops', why: null, lost: 0 } });
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    r.live.local([{ type: 'move', ids: [ULID(1)], dx: 5, dy: 5 }], press(r.now()));
    confirmNext(r);
    const g = press(r.now());
    expect(r.live.undo(g)).toEqual(OK);
    expect(r.sent[2]).toMatchObject({ ops: [{ type: 'move', ids: [ULID(1)], dx: -5, dy: -5 }], gesture: g });
    confirmNext(r);
    // the undo's own row is not an undo entry (no redo in S1.3): the next undo takes the add
    expect(r.live.undo(press(r.now())).changed).toBe(true);
    expect(r.sent[3]!.ops).toEqual([{ type: 'delete', id: ULID(1) }]);
    confirmNext(r);
    expect(r.live.status().canUndo).toBe(false);
    expect(r.confirmedNodes()).toEqual([ULID(40)]);
  });

  it('8. undo with no gesture burns nothing: holding the key down repeats with a null stamp', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    for (let i = 0; i < 5; i++) expect(r.live.undo(null)).toEqual({ changed: false, resync: false, notice: { code: 'not-sent', field: 'ops', why: 'gesture-missing', lost: 0 } });
    expect(r.sent).toHaveLength(1);
    expect(r.live.status()).toMatchObject({ canUndo: true, pending: 0 });
    expect(r.live.undo(press(r.now())).changed).toBe(true);
    expect(r.sent[1]!.ops).toEqual([{ type: 'delete', id: ULID(1) }]);
  });

  it('9. the entry leaves the list only when its inverse is confirmed: a failed send keeps it', () => {
    for (const fail of ['refused', 'timeout'] as const) {
      const r = rig();
      r.live.local([rect(1)], press(r.now()));
      confirmNext(r);
      r.live.undo(press(r.now()));
      expect(r.live.status()).toMatchObject({ canUndo: false, pending: 1 });
      if (fail === 'refused') expect(r.live.ack(2, { ok: false, code: 'gesture-refused', why: 'spent' }).notice?.code).toBe('gesture-refused');
      else {
        r.tick(DIM_LIVE_TIMEOUT_MS);
        expect(r.live.timeout().notice?.code).toBe('timeout');
      }
      // the mark is back on the board and the undo is still there
      expect(r.nodes()).toEqual([ULID(1)]);
      expect(r.live.status()).toMatchObject({ canUndo: true, pending: 0 });
      r.gap();
      expect(r.live.undo(press(r.now()))).toEqual(OK);
      expect(r.sent[r.sent.length - 1]!.ops).toEqual([{ type: 'delete', id: ULID(1) }]);
      confirmNext(r);
      expect(r.live.status().canUndo).toBe(false);
      expect(r.confirmedNodes()).toEqual([]);
    }
  });

  it('10. an entry that can never be undone is dropped with one notice and the older ones stay reachable', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    r.live.local([rect(2)], press(r.now()));
    confirmNext(r);
    r.live.local([{ type: 'update', id: ULID(2), patch: { w: 99 } }], press(r.now()));
    confirmNext(r);
    // someone deletes mark 2: the top entry (the update of it) and the one under it (the add of it) can never apply
    r.live.row(r.append([{ type: 'delete', id: ULID(2) }], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' }));
    const sent = r.sent.length;
    expect(r.live.undo(press(r.now()))).toEqual({ changed: true, resync: false, notice: { code: 'undo-invalid', field: 'id', why: 'id-missing', lost: 0 } });
    expect(r.live.undo(press(r.now())).notice).toMatchObject({ code: 'undo-invalid', why: 'id-missing' });
    expect(r.sent).toHaveLength(sent);
    expect(r.live.status().canUndo).toBe(true);
    // the oldest entry is reached
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    expect(r.sent[sent]!.ops).toEqual([{ type: 'delete', id: ULID(1) }]);
  });

  it('10. undo of my delete after someone removed what it was tied to: the mark comes back without the dead links', () => {
    const r = rig();
    r.live.local([{ type: 'add', node: { id: ULID(1), kind: 'frame', x: 0, y: 0, z: 'V', w: 100, h: 100 } }, rect(2, { parent: ULID(1) })], press(r.now()));
    confirmNext(r);
    r.live.local([{ type: 'delete', id: ULID(2) }], press(r.now()));
    confirmNext(r);
    r.live.row(r.append([{ type: 'delete', id: ULID(1) }], { principal: 'p:me/session', surface: 'bridge', agent: 'kit' }));
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    expect(r.sent[r.sent.length - 1]!.ops).toEqual([{ type: 'add', node: { id: ULID(700), kind: 'rect', x: 2, y: 0, z: 'V', w: 10, h: 10 } }]);
  });

  it('11. undo does nothing while a batch of mine is pending, and canUndo is false until it confirms', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.status()).toMatchObject({ canUndo: false, pending: 1 });
    expect(r.live.undo(press(r.now()))).toEqual(NOTHING);
    expect(r.sent).toHaveLength(2);
    expect(r.nodes().sort()).toEqual([ULID(1), ULID(2)]);
    confirmNext(r);
    expect(r.live.status().canUndo).toBe(true);
    // it now undoes the mark just drawn, not the one before it
    r.live.undo(press(r.now()));
    expect(r.sent[2]!.ops).toEqual([{ type: 'delete', id: ULID(2) }]);
    // and an undo in flight blocks the next undo too
    expect(r.live.undo(press(r.now()))).toEqual(NOTHING);
  });

  it('undo of a delete re-adds under a minted id; an undo is never merged into a queued edit', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    confirmNext(r);
    r.live.local([{ type: 'delete', id: ULID(1) }], press(r.now()));
    confirmNext(r);
    expect(r.live.undo(press(r.now())).changed).toBe(true);
    r.live.local([rect(3)], press(r.now()));
    r.live.local([rect(4)], press(r.now()));
    // in flight: the undo; queued: one batch of the two edits
    expect(r.live.status().pending).toBe(2);
    expect(r.sent[2]!.ops).toHaveLength(1);
    expect(r.live.view().nodes.get(ULID(700))!.node).toMatchObject({ kind: 'rect', x: 1 });
    expect(r.live.view().gone.has(ULID(1))).toBe(true);
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
  it('18. dimAckOf reads the mod’s real replies exactly, and nothing else', () => {
    expect(dimAckOf({ ok: true, dim: DIM, seq: 9, applied: 2, refused: [] })).toEqual({ ok: true, seq: 9, refused: [] });
    // partial application: the row was appended, `refused` lists the ops left out
    expect(dimAckOf({ ok: true, dim: DIM, seq: 9, applied: 1, refused: [{ index: 1, field: 'z', code: 'z-bad', fix: 'x' }] })).toEqual({ ok: true, seq: 9, refused: [{ field: 'z', code: 'z-bad' }] });
    // refusals that name ops: the first op refusal is the notice, the mod's code is the why
    expect(dimAckOf({ ok: false, code: 'ops-refused', fix: 'x', refused: [{ index: 0, field: 'w', code: 'field-range', fix: 'y' }] })).toEqual({ ok: false, code: 'field-range', field: 'w', why: 'ops-refused' });
    expect(dimAckOf({ ok: false, code: 'secret', fix: 'x', refused: [{ index: 0, field: 'text', code: 'secret', rule: 'aws' }] })).toEqual({ ok: false, code: 'secret', field: 'text', why: 'secret' });
    for (const code of DIM_COMMAND_REFUSALS) expect(dimAckOf({ ok: false, code, fix: 'a fixed sentence' })).toEqual({ ok: false, code, why: null });
    expect(DIM_COMMAND_REFUSALS).toHaveLength(20);
    // input is never echoed: an unlisted code, field or op code becomes a fixed word
    expect(dimAckOf({ ok: false, code: '<b>x</b>', fix: 'x' })).toEqual({ ok: false, code: 'refused', why: null });
    expect(dimAckOf({ ok: true, seq: 9, refused: [{ field: '<i>', code: 'made-up' }] })).toEqual({ ok: true, seq: 9, refused: [{ field: 'unknown', code: 'refused' }] });
    // not a reply of the mod
    for (const bad of [null, undefined, 'ok', [], {}, { seq: 9, refused: [] }, { result: { ok: true, seq: 9 } }, { ok: true }, { ok: true, seq: '9' }, { ok: true, seq: 0 }, { ok: 'true', seq: 9 }, { ok: false }]) expect(dimAckOf(bad)).toEqual({ ok: false, code: 'refused', why: null });
  });

  it('a row of another dimension changes nothing', () => {
    const r = rig();
    expect(r.live.row({ seq: 50, kind: DIM_KINDS.op, payload: { v: 1, dim: 'dim:01JD1MVECT0R00000000000009', ops: [] } })).toEqual(NOTHING);
  });

  it('has no timer, no DOM, no log line and no row-by-row fold', () => {
    for (const file of ['dim-live.ts', 'dim-undo.ts']) {
      const src = readFileSync(path.join(ROOT, 'src', 'core', file), 'utf8');
      expect(src).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.|document\.|window\.|console\.|foldDimRow/);
    }
  });
});

describe('#gui-dim-live rows that fit, and one action is one undo step (P4a)', () => {
  const text = (n: number, chars: number): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'text', x: n, y: 0, z: 'V', text: 'w'.repeat(chars) } as never });

  it('an action over the row budget is sent as several rows on ONE stamp, each within the budget, in order; undo takes them all in one step', () => {
    const r = rig();
    // 9 marks of 3,900 characters: about 35 KiB, so three rows
    const ops = Array.from({ length: 9 }, (_, i) => text(1 + i, 3900));
    const g = press(r.now());
    expect(r.live.local(ops, g)).toEqual(OK);
    const pending = r.live.status().pending;
    expect(pending).toBeGreaterThan(1);
    expect(pending).toBeLessThanOrEqual(4);
    const rows: DimRow[] = [];
    for (let i = 0; i < pending; i++) rows.push(confirmNext(r));
    expect(r.sent).toHaveLength(pending);
    expect(r.sent.every((b) => b.gesture === g)).toBe(true);
    expect(r.sent.flatMap((b) => b.ops)).toEqual(ops);
    for (const b of r.sent) expect(JSON.stringify(b.ops).length).toBeLessThan(16 * 1024 - 512);
    expect(r.live.status()).toMatchObject({ pending: 0, canUndo: true });
    expect(r.nodes()).toHaveLength(9);
    // ONE undo: nine deletes in one row
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    expect(r.sent).toHaveLength(pending + 1);
    expect(r.sent[pending]!.ops.map((o) => o.type)).toEqual(Array(9).fill('delete'));
    confirmNext(r);
    expect(r.nodes()).toEqual([]);
    expect(r.live.status().canUndo).toBe(false);
    expect(r.live.undo(press(r.now())).notice?.code).toBe('undo-nothing');
  });

  it('a 64-clone paste whose clones are heavy is split by size, never over 64 ops a row, and undoes in one step', () => {
    const r = rig();
    const ops = Array.from({ length: 64 }, (_, i) => text(1 + i, 600));
    expect(r.live.local(ops, press(r.now()))).toEqual(OK);
    const n = r.live.status().pending;
    expect(n).toBe(3);
    for (let i = 0; i < n; i++) confirmNext(r);
    expect(r.nodes()).toHaveLength(64);
    r.live.undo(press(r.now()));
    expect(r.sent[n]!.ops).toHaveLength(64);
    confirmNext(r);
    expect(r.nodes()).toEqual([]);
  });

  it('an action that needs more than DIM_ACTION_ROWS rows, or holds one op that fits no row, is refused whole: nothing pending, one notice', () => {
    const r = rig();
    const ops = Array.from({ length: 20 }, (_, i) => text(1 + i, 3900));
    expect(r.live.local(ops, press(r.now()))).toEqual({ changed: false, resync: true, notice: { code: 'too-large', field: 'ops', why: null, lost: 20 } });
    // one op that fits no row: valid for the validator (2,048 points), too many bytes for any row
    const points = Array.from({ length: 4096 }, (_, i) => (i % 2 ? 9_999_000 + i : -9_999_000 - i));
    const res = r.live.local([{ type: 'add', node: { id: ULID(50), kind: 'stroke', x: 0, y: 0, z: 'V', points } as never }], press(r.now()));
    expect(res).toEqual({ changed: false, resync: true, notice: { code: 'row-too-large', field: 'ops', why: null, lost: 1 } });
    expect(r.live.status().pending).toBe(0);
    expect(r.sent).toEqual([]);
  });

  it('a refused row of a group takes the rows still waiting with it, under one notice; the rows already kept are one undo entry', () => {
    const r = rig();
    const ops = Array.from({ length: 9 }, (_, i) => text(1 + i, 3900));
    r.live.local(ops, press(r.now()));
    const n = r.live.status().pending;
    expect(n).toBe(3);
    confirmNext(r);
    const second = r.sent[1]!;
    const waiting = r.sent.length;
    const res = r.live.ack(second.id, { ok: false, code: 'gesture-refused', why: 'spent' });
    expect(res).toEqual({ changed: true, resync: true, notice: { code: 'gesture-refused', field: 'ops', why: 'spent', lost: 9 - r.sent[0]!.ops.length } });
    expect(r.live.status()).toMatchObject({ pending: 0, canUndo: true });
    r.gap();
    expect(r.sent).toHaveLength(waiting); // nothing more went out on that stamp
    expect(r.nodes()).toHaveLength(r.sent[0]!.ops.length);
    r.live.undo(press(r.now()));
    confirmNext(r);
    expect(r.nodes()).toEqual([]);
  });

  it('a merged batch never goes over the row budget: a second heavy edit starts its own batch', () => {
    const r = rig();
    r.live.local([rect(900)], press(r.now())); // in flight
    r.live.local([text(1, 3900), text(2, 3900)], press(r.now()));
    r.live.local([text(3, 3900), text(4, 3900)], press(r.now()));
    expect(r.live.status().pending).toBe(3);
    r.live.local([rect(901)], press(r.now()));
    expect(r.live.status().pending).toBe(3); // a light one still joins the last
  });

  it('the inverse of a heavy delete is itself packed into rows; the entry leaves the list at its last row', () => {
    const r = rig();
    const adds = Array.from({ length: 8 }, (_, i) => text(1 + i, 3900));
    r.live.local(adds, press(r.now()));
    while (r.live.status().pending > 0) confirmNext(r);
    const dels: DimOp[] = adds.map((_, i) => ({ type: 'delete', id: ULID(1 + i) }));
    r.live.local(dels, press(r.now()));
    expect(r.live.status().pending).toBe(1);
    confirmNext(r);
    expect(r.nodes()).toEqual([]);
    const before = r.sent.length;
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    const rows = r.live.status().pending;
    expect(rows).toBeGreaterThan(1);
    confirmNext(r);
    expect(r.live.status().canUndo).toBe(false); // still pending
    while (r.live.status().pending > 0) confirmNext(r);
    expect(r.sent.length - before).toBe(rows);
    expect(r.nodes()).toHaveLength(8);
    // the delete is undone; the next undo reaches the adds (their ids are gone: the re-added marks are other nodes)
    expect(r.live.status().canUndo).toBe(true);
  });
});

describe('#gui-dim-live review of PR #118: a send that waits its turn', () => {
  it('with `leaves`, a batch handed over is not dropped by the timeout until it has left; flying() says whether it may still go; the wait counts from left()', () => {
    const store = new DimStore();
    store.apply([{ seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'Live', attached: ['hsid-1'], opened: 'command', relayedFor: HUMAN } }]);
    let now = 1000;
    const sent: DimLiveBatch[] = [];
    const live = new DimLive({ dim: DIM, me: ME, stateAt: (s) => store.stateAt(DIM, s), send: (b) => void sent.push(b), now: () => now, mint: () => ULID(900), leaves: true });
    const g = press(now);
    live.local([rect(1)], g);
    expect(live.flying(sent[0]!.id)).toBe(true);
    expect(live.rides(g)).toBe(true);
    expect(live.pendingOps()).toBe(1);
    expect(live.nextDeadline()).toBeNull();
    now += DIM_LIVE_TIMEOUT_MS * 3;
    expect(live.timeout()).toEqual(NOTHING); // still waiting its turn: not lost
    live.left(sent[0]!.id);
    expect(live.nextDeadline()).toBe(now + DIM_LIVE_TIMEOUT_MS);
    now += DIM_LIVE_TIMEOUT_MS - 1;
    expect(live.timeout()).toEqual(NOTHING);
    now += 1;
    expect(live.timeout().notice).toMatchObject({ code: 'timeout', why: 'no-ack', lost: 1 });
    expect(live.flying(sent[0]!.id)).toBe(false); // dropped: its command must not go out now
    expect(live.rides(g)).toBe(false);
    expect(live.pendingOps()).toBe(0);
    // link down: one that never left falls at the timeout since it was queued
    live.local([rect(2)], press(now));
    live.link(false);
    expect(live.nextDeadline()).toBe(now + DIM_LIVE_TIMEOUT_MS);
    now += DIM_LIVE_TIMEOUT_MS;
    expect(live.timeout().notice).toMatchObject({ code: 'link-down', lost: 1 });
  });
});

describe('#gui-dim-live review of PR #118, group B: every action that is sent can be undone', () => {
  const text = (n: number, chars: number): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'text', x: n, y: 0, z: 'V', text: 'w'.repeat(chars) } as never });
  const settle = (r: ReturnType<typeof rig>): void => {
    while (r.live.status().pending > 0) confirmNext(r);
  };

  it('B1: a delete of 65 marks is refused at the delete, whole, and nothing is sent; 64 go and are undone in one step', () => {
    const r = rig();
    for (let k = 0; k < 2; k++) {
      r.live.local(Array.from({ length: 40 }, (_, i) => rect(1 + k * 40 + i)), press(r.now()));
      settle(r);
    }
    const before = r.sent.length;
    const del = (n: number): DimOp[] => Array.from({ length: n }, (_, i) => ({ type: 'delete', id: ULID(1 + i) }));
    expect(r.live.local(del(65), press(r.now()))).toEqual({ changed: false, resync: true, notice: { code: 'not-undoable', field: 'ops', why: 'delete', lost: 65 } });
    expect(r.sent).toHaveLength(before);
    expect(r.nodes()).toHaveLength(80);
    expect(r.live.local(del(64), press(r.now()))).toEqual(OK);
    settle(r);
    expect(r.nodes()).toHaveLength(16);
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    settle(r);
    expect(r.nodes()).toHaveLength(80);
  });

  it('B2: an action whose inverse would need more rows than one stamp carries is refused at the action (five heavy marks deleted in one row need five rows back)', () => {
    const r = rig();
    for (let i = 0; i < 5; i++) {
      r.live.local([{ type: 'add', node: { id: ULID(1 + i), kind: 'stroke', x: 0, y: i * 10, z: 'V', points: Array.from({ length: 1900 }, (_, j) => (j % 2 ? 100000 + j : -100000 - j)) } as never }], press(r.now()));
      settle(r);
    }
    expect(r.nodes()).toHaveLength(5);
    const before = r.sent.length;
    const res = r.live.local(Array.from({ length: 5 }, (_, i) => ({ type: 'delete', id: ULID(1 + i) }) as DimOp), press(r.now()));
    expect(res).toEqual({ changed: false, resync: true, notice: { code: 'not-undoable', field: 'ops', why: 'delete', lost: 5 } });
    expect(r.sent).toHaveLength(before);
    // four of them can come back in four rows: that delete goes, and its undo is one step
    expect(r.live.local(Array.from({ length: 4 }, (_, i) => ({ type: 'delete', id: ULID(1 + i) }) as DimOp), press(r.now()))).toEqual(OK);
    settle(r);
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    expect(r.live.status().pending).toBe(4);
    settle(r);
    expect(r.nodes()).toHaveLength(5);
  });

  it('B2: two edits merge into one batch only while the merged batch can still be undone as one', () => {
    const r = rig();
    r.live.local([rect(900)], press(r.now())); // in flight
    r.live.local(Array.from({ length: 40 }, (_, i) => rect(1 + i)), press(r.now()));
    r.live.local(Array.from({ length: 24 }, (_, i) => rect(100 + i)), press(r.now()));
    expect(r.live.status().pending).toBe(2); // 40 + 24 = 64: one batch, undoable as one
    r.live.local([rect(200)], press(r.now()));
    expect(r.live.status().pending).toBe(3); // a 65th op starts its own
  });

  it('B3: a group is undone row by row against the state just before each row: another hand\'s change between two rows is what comes back', () => {
    const r = rig();
    // X exists, with words; mine
    r.live.local([{ type: 'add', node: { id: ULID(50), kind: 'text', x: 5, y: 5, z: 'V', text: 'first words' } as never }], press(r.now()));
    settle(r);
    // one action of mine in two rows: heavy adds, then (in the last row) the delete of X
    const action: DimOp[] = [...Array.from({ length: 6 }, (_, i) => text(1 + i, 3900)), { type: 'delete', id: ULID(50) }];
    r.live.local(action, press(r.now()));
    expect(r.live.status().pending).toBe(2);
    // row 1 of mine lands
    const b1 = r.sent[r.sent.length - 1]!;
    const row1 = r.append(b1.ops);
    r.live.ack(b1.id, { ok: true, seq: row1.seq, refused: [] });
    r.live.row(row1);
    // BETWEEN my two rows another hand rewrites X
    r.live.row(r.append([{ type: 'update', id: ULID(50), patch: { text: 'their newer words' } }], { principal: 'p:someone/else', connId: 'conn:x', surface: 'gui' }));
    r.gap();
    // row 2 of mine (it deletes X) lands
    confirmNext(r);
    expect(r.live.status()).toMatchObject({ pending: 0, canUndo: true });
    expect(r.live.view().nodes.has(ULID(50))).toBe(false);
    // ONE undo: X comes back with the words it had just before MY delete, not the words from before the action
    expect(r.live.undo(press(r.now()))).toEqual(OK);
    const inverse = r.sent[r.sent.length - 1]!.ops;
    const readd = inverse.find((o) => o.type === 'add') as { node: { text: string } };
    expect(readd.node.text).toBe('their newer words');
    expect(inverse.filter((o) => o.type === 'delete')).toHaveLength(6);
  });

  it('B5: when the mod does not answer, the batch in flight and everything waiting behind it fall together, with one notice', () => {
    const r = rig();
    r.live.local([rect(1)], press(r.now()));
    r.live.local(Array.from({ length: 9 }, (_, i) => text(10 + i, 3900)), press(r.now()));
    r.live.local([rect(2)], press(r.now()));
    expect(r.live.status().pending).toBe(5);
    r.tick(DIM_LIVE_TIMEOUT_MS);
    expect(r.live.timeout()).toEqual({ changed: true, resync: true, notice: { code: 'timeout', field: 'ops', why: 'no-ack', lost: 11 } });
    expect(r.live.status()).toMatchObject({ pending: 0, keep: 'saved' });
    expect(r.sent).toHaveLength(1);
    expect(r.live.timeout()).toEqual(NOTHING);
  });
});

