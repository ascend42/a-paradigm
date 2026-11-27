/**
 * S1.4 E3, the session half: one act per action, the ⌘Z the mod plans (Aegis P4a review, REQUIRED), the notices
 * and their keys (U1 to U3, S1 to S3, N1 to N3, V1), and the A1 line. In Node, on fake timers and a fake client whose
 * `dim.undo` plans with the contracts' own `planDimUndo` and writes the mod's marker (as index.mjs undoCore does).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIM_KINDS, dimAttrDigest, dimChangeSetOf, dimHash, dimUndoMarkOf, planDimUndo } from '@a-company/gnomon-contracts';
import type { DimChangeSet, DimOp, DimRow } from '@a-company/gnomon-contracts';
import { dimHandOf } from '../src/board/dim-map.js';
import type { BoardHandle } from '../src/core/board.js';
import { DIM_NOTICE_CAP, DIM_REDO_WINDOW_MS, DimNotices } from '../src/core/dim-notices.js';
import { DIM_SEND_LIMITS, DimSessions, type DimSession, type DimSessionNotice } from '../src/core/dim-session.js';
import { DimStore } from '../src/core/dim-store.js';

const ULID = (n: number): string => `01JD1M${String(n).padStart(20, '0')}`;
const DIM = `dim:${ULID(1)}`;
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const AG = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const ME = 'p:00000000/founder';
const rect = (n: number): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'rect', x: n, y: 0, z: 'V', w: 10, h: 10 } as never });
const press = (type = 'pointerup', more: Record<string, unknown> = {}): Event => ({ isTrusted: true, type, detail: 1, ...more }) as unknown as Event;
const flush = async (ms = 0): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms));

interface Call {
  commandId: string;
  args: Record<string, unknown>;
}

function world() {
  const store = new DimStore();
  const calls: Call[] = [];
  let n = 7000;
  const sessions = new DimSessions({ store, mint: () => ULID(n++) });
  let seq = 0;
  const human = { principal: ME, connId: 'conn:A', surface: 'gui' };
  const agentStamp = (agent: string, t: number) => ({ principal: `p:00000000/${agent}`, surface: 'bridge', agent, hsid: AG, turn: `turn:${AG}/${t}` });
  const push = (kind: string, payload: Record<string, unknown>): DimRow => {
    const row = { seq: ++seq, kind, payload: { v: 1, dim: DIM, ...payload } } as DimRow;
    sessions.apply([row]);
    return row;
  };
  const undo = (a: Record<string, unknown>): Record<string, unknown> => {
    const of = a.of as Record<string, string>;
    const cs: DimChangeSet = 'act' in of ? { kind: 'act', principal: of.principal!, act: of.act! } : { kind: 'turn', hsid: of.hsid!, turn: of.turn! };
    const rows = store.rows(DIM).filter((r) => r.kind === DIM_KINDS.op);
    const key = (c: DimChangeSet | null): string => (c ? JSON.stringify(c) : '');
    const mine = rows.filter((r) => key(dimChangeSetOf(r)) === key(cs));
    if (mine.length === 0) return { ok: false, code: 'undo-expired' };
    const plan = planDimUndo({ rows: mine.map((r) => ({ before: store.stateAt(DIM, r.seq - 1), ops: (r.payload as { ops: unknown[] }).ops, seq: r.seq })), after: rows.filter((r) => r.seq > mine[0]!.seq && !mine.includes(r)), current: store.stateAt(DIM), actor: { cls: 'human', principal: ME }, mint: () => ULID(n++), of: cs, ...(a.ids ? { ids: a.ids as string[] } : {}) });
    if (plan.ops.length === 0) return { ok: false, code: 'undo-nothing' };
    push(DIM_KINDS.op, { ops: plan.ops, act: ULID(n++), undo: { of, ...(plan.restored.length ? { restored: plan.restored } : {}) }, relayedFor: human });
    return { ok: true, dim: DIM, seq, hash: dimHash(store.stateAt(DIM)), applied: plan.applied, skipped: plan.skipped };
  };
  const hold = { undo: false, seen: false, refuse: false };
  const o = { check: {} as { hash?: string; attr?: string }, turns: 0, pins: null as Array<{ hsid: string; turn: string }> | null };
  const waiting: Array<() => void> = [];
  const client = {
    call: <T>(_m: string, params?: unknown): Promise<T> => {
      const p = params as { commandId: string; args: Record<string, unknown> };
      calls.push({ commandId: p.commandId, args: p.args });
      const run = (): unknown => {
        const a = p.args;
        if (p.commandId === 'dim.open') {
          const row = push(DIM_KINDS.start, { title: 'Plan', attached: [HSID, AG], opened: 'command', relayedFor: human });
          return { ok: true, created: true, dim: DIM, seq: row.seq, hash: dimHash(store.stateAt(DIM)), ...(o.pins ? { pins: o.pins } : {}) };
        }
        if (p.commandId === 'dim.op') {
          const row = push(DIM_KINDS.op, { ops: a.ops, ...(a.act ? { act: a.act } : {}), relayedFor: human });
          return { ok: true, dim: DIM, seq: row.seq, applied: (a.ops as unknown[]).length, refused: [] };
        }
        if (p.commandId === 'dim.undo') return hold.refuse ? { ok: false, code: 'append-busy' } : undo(a);
        if (p.commandId === 'dim.seen') return { ok: true, dim: DIM, released: true };
        if (p.commandId === 'dim.check') return { ok: true, dim: DIM, seq: store.stateAt(DIM).seq, hash: o.check.hash ?? dimHash(store.stateAt(DIM)), attr: o.check.attr ?? dimAttrDigest(store.stateAt(DIM)), ...(o.pins ? { pins: o.pins } : {}) };
        return { ok: true, already: true, dim: DIM, seq };
      };
      return new Promise<T>((resolve) => {
        const go = (): void => resolve({ result: run() } as T);
        if ((p.commandId === 'dim.undo' && hold.undo) || (p.commandId === 'dim.seen' && hold.seen)) waiting.push(go);
        else go();
      });
    },
  };
  sessions.connect({ client: client as never, principal: ME, connId: 'conn:A' });
  /** an agent turn `t` of `agent`: its op rows, then its turn.result row */
  const turn = (agent: string, t: number, ops: DimOp[], extra: Record<string, unknown> = {}): void => {
    push(DIM_KINDS.op, { ops, relayedFor: agentStamp(agent, t), ...extra });
    sessions.apply([{ seq: ++seq, kind: 'turn.result', payload: { turn: `turn:${AG}/${t}` } }]);
  };
  const of = (kind: string) => calls.filter((c) => c.commandId === kind);
  return {
    store, sessions, calls, of, push, turn, human, agentStamp, hold, waiting, release: () => waiting.splice(0).forEach((f) => f()),
    set check(v: { hash?: string; attr?: string }) { o.check = v; },
    set pins(v: Array<{ hsid: string; turn: string }> | null) { o.pins = v; },
    get turns() { return o.turns; },
    set turns(v: number) { o.turns = v; },
  };
}

async function opened(w: ReturnType<typeof world>): Promise<{ s: DimSession; notices: DimSessionNotice[]; undoKey: (e?: Event) => void }> {
  const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'command', title: 'Plan' }, press('click'));
  await flush(DIM_SEND_LIMITS.gapMs);
  expect(await s.opened()).toBe(true);
  let undoKey: ((e: KeyboardEvent, redo: boolean) => void) | null = null;
  const handle = { isAlive: () => true, render: () => undefined, onEdit: () => () => undefined, onUndoKey: (fn: typeof undoKey) => ((undoKey = fn), () => undefined) } as unknown as BoardHandle;
  s.attachHandle(handle);
  const notices: DimSessionNotice[] = [];
  s.onChange((c) => void (c.notice && notices.push(c.notice)));
  return { s, notices, undoKey: (e = press('keydown')) => undoKey?.(e as KeyboardEvent, false) };
}

/** a person's mark (seq'd as mine) and an agent turn that changed it: a standing notice */
async function withNotice(w: ReturnType<typeof world>, s: DimSession, t: number, id: number): Promise<string> {
  s.edit([rect(id)], press());
  await flush(DIM_SEND_LIMITS.gapMs * 2);
  w.turn('claude', t, [{ type: 'update', id: ULID(id), patch: { color: 'cobalt' } } as DimOp]);
  return `turn:${AG}/${t}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe('E3 item 7: one act per action, never merged', () => {
  it('every dim.op carries an act; two actions never share one; no dim.op ever carries an undo marker', async () => {
    const w = world();
    const { s, undoKey } = await opened(w);
    s.edit([rect(1)], press());
    s.edit([rect(2)], press());
    await flush(500);
    const ops = w.of('dim.op');
    expect(ops).toHaveLength(2);
    expect(ops[0]!.args.act).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ops[1]!.args.act).not.toBe(ops[0]!.args.act);
    // a plain ⌘Z of my own add goes through the page's planner (dim.op), with a fresh act and NO marker
    undoKey();
    await flush(500);
    const z = w.of('dim.op')[2]!;
    expect(z.args.ops).toEqual([{ type: 'delete', id: ULID(2) }]);
    expect(Object.keys(z.args)).not.toContain('undo');
    expect(z.args.act).not.toBe(ops[1]!.args.act);
    expect(w.of('dim.undo')).toHaveLength(0);
  });
});

describe('E3 REQUIRED (Aegis, P4a review): ⌘Z of a delete of another hand\'s mark goes through the mod', () => {
  it('the re-added mark keeps the agent\'s hand: the row\'s restored holds [newId, oldId, the agent\'s hand], drawn dashed', async () => {
    const w = world();
    const { s, undoKey } = await opened(w);
    // an agent drew a mark; the person deletes it; ⌘Z
    w.turn('claude', 1, [rect(40)]);
    s.edit([{ type: 'delete', id: ULID(40) } as DimOp], press('keydown'));
    await flush(500);
    const del = w.of('dim.op').at(-1)!;
    undoKey();
    await flush(500);
    // no dim.op from the page's planner: ONE dim.undo naming this person's act, with the base it was drawn at
    expect(w.of('dim.op').at(-1)).toBe(del);
    const u = w.of('dim.undo');
    expect(u).toHaveLength(1);
    expect(u[0]!.args).toMatchObject({ of: { principal: ME, act: del.args.act }, base: expect.any(Number) });
    const row = w.store.rows(DIM).at(-1)!;
    const mark = dimUndoMarkOf(row)!;
    expect(mark.restored).toHaveLength(1);
    const [entry] = mark.restored;
    expect(entry!.oldId).toBe(ULID(40));
    expect(entry!.by).toMatchObject({ cls: 'agent', agent: 'claude' });
    const node = w.store.stateAt(DIM).nodes.get(entry!.newId)!;
    expect(node.restoredFrom?.by).toMatchObject({ cls: 'agent', agent: 'claude' });
    // drawn in the agent's hand: dashed and sealed as the agent (dimHandOf is what dim-map and the seal read)
    expect(dimHandOf(node)).toMatchObject({ cls: 'agent', agent: 'claude' });
    // the entry left: a second ⌘Z has nothing of it
    expect(s.status().canUndo).toBe(false);
  });
});

describe('E3 notices and their keys', () => {
  it('U1: a double click on undo sends ONE dim.undo and no redo', async () => {
    const w = world();
    const { s } = await opened(w);
    const key = await withNotice(w, s, 1, 10);
    const n = s.noticeView().shown!;
    expect(n.key).toBe(key);
    w.hold.undo = true;
    expect(s.undoNotice(key, n.rev, press('click', { detail: 1 }))).toBe(true);
    expect(s.undoNotice(key, n.rev, press('click', { detail: 2 }))).toBe(false);
    await flush(200);
    w.release();
    await flush(200);
    expect(s.noticeView().shown).toMatchObject({ key, state: 'done' });
    // the second press of the double click lands on redo: dropped
    expect(s.redoNotice(key, press('click', { detail: 2 }))).toBe(false);
    expect(w.of('dim.undo')).toHaveLength(1);
    // the redo window gives way after six seconds
    await flush(DIM_REDO_WINDOW_MS);
    expect(s.noticeView().shown).toBeNull();
  });

  it('U1/S2: a double click on dismiss with two notices standing sends ONE dim.seen; the second still stands', async () => {
    const w = world();
    const { s } = await opened(w);
    const k1 = await withNotice(w, s, 1, 10);
    const k2 = await withNotice(w, s, 2, 11);
    expect(s.noticeView().shown!.key).toBe(k2);
    w.hold.seen = true;
    expect(s.dismissNotice(k2, press('click', { detail: 1 }))).toBe(true);
    expect(s.dismissNotice(k2, press('click', { detail: 2 }))).toBe(false);
    await flush(200);
    w.release();
    await flush(200);
    expect(w.of('dim.seen')).toHaveLength(1);
    expect(w.of('dim.seen')[0]!.args.of).toEqual({ hsid: AG, turn: k2 });
    expect(s.noticeView().shown!.key).toBe(k1);
    // the next notice's dismiss, pressed by the second click, is dropped
    expect(s.dismissNotice(k1, press('click', { detail: 2 }))).toBe(false);
    expect(w.of('dim.seen')).toHaveLength(1);
  });

  it('U2: a notice arriving during hover does not take the slot; dismiss releases the one shown; the new one stands', async () => {
    const w = world();
    const { s } = await opened(w);
    const k1 = await withNotice(w, s, 1, 10);
    s.freezeNotices(true);
    const k2 = await withNotice(w, s, 2, 11);
    expect(s.noticeView().shown!.key).toBe(k1);
    expect(s.noticeView().behind.map((n) => n.key)).toEqual([k2]);
    s.dismissNotice(k1, press('click'));
    await flush(200);
    expect(w.of('dim.seen').map((c) => c.args.of)).toEqual([{ hsid: AG, turn: k1 }]);
    expect(s.noticeView().shown!.key).toBe(k2);
  });

  it('V1: with 3 standing, undoing the oldest from the menu releases nothing else', async () => {
    const w = world();
    const { s } = await opened(w);
    const k1 = await withNotice(w, s, 1, 10);
    const k2 = await withNotice(w, s, 2, 11);
    const k3 = await withNotice(w, s, 3, 12);
    s.freezeNotices(true); // the menu is open
    expect(s.noticeView().behind.map((n) => n.key)).toEqual([k2, k1]);
    const old = s.noticeView().behind[1]!;
    expect(s.undoNotice(k1, old.rev, press('click'))).toBe(true);
    await flush(200);
    expect(w.of('dim.seen')).toHaveLength(0);
    expect(w.of('dim.undo')[0]!.args).toMatchObject({ of: { hsid: AG, turn: k1 } });
    expect(s.noticeView().shown!.key).toBe(k3);
    expect(s.noticeView().behind.map((n) => n.key)).toEqual([k2]);
  });

  it('S3/N2: a ninth notice sends no dim.seen, and its line names the hand and the time', async () => {
    const w = world();
    const { s, notices } = await opened(w);
    for (let t = 1; t <= DIM_NOTICE_CAP + 1; t++) await withNotice(w, s, t, 10 + t);
    expect(w.of('dim.seen')).toHaveLength(0);
    const out = notices.filter((n) => n.code === 'pushed-out');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ about: 'undo', agent: 'claude', at: expect.any(Number) });
    expect(s.noticeView().behind).toHaveLength(DIM_NOTICE_CAP - 1);
  });

  it('a press drawn from fewer rows than the set now has sends nothing (the set changed)', async () => {
    const w = world();
    const { s } = await opened(w);
    const key = await withNotice(w, s, 1, 10);
    const rev = s.noticeView().shown!.rev;
    w.push(DIM_KINDS.op, { ops: [{ type: 'update', id: ULID(10), patch: { color: 'leaf' } }], relayedFor: w.agentStamp('claude', 1) });
    expect(s.undoNotice(key, rev, press('click'))).toBe(false);
    expect(w.of('dim.undo')).toHaveLength(0);
  });

  it('an untrusted press, or one while the link is down, is dropped and never replayed', async () => {
    const w = world();
    const { s } = await opened(w);
    const key = await withNotice(w, s, 1, 10);
    const rev = s.noticeView().shown!.rev;
    expect(s.undoNotice(key, rev, { isTrusted: false, type: 'click', detail: 1 } as unknown as Event)).toBe(false);
    w.sessions.linkDown();
    expect(s.undoNotice(key, rev, press('click'))).toBe(false);
    expect(s.noticeView().held).toBe('link-down');
    expect(w.of('dim.undo')).toHaveLength(0);
  });

  it('N3: an agent\'s undo of another agent\'s turn never raises "your change"; of a person\'s act it does', async () => {
    const w = world();
    const { s } = await opened(w);
    w.turn('mika', 1, [rect(30)]);
    w.turn('luna', 2, [{ type: 'delete', id: ULID(30) } as DimOp], { undo: { of: { hsid: AG, turn: `turn:${AG}/1` } } });
    expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/2`, lead: null, otherRemoved: 1, removed: 0 });
    s.edit([rect(31)], press());
    await flush(500);
    const act = w.of('dim.op').at(-1)!.args.act as string;
    w.turn('luna', 3, [{ type: 'delete', id: ULID(31) } as DimOp], { undo: { of: { principal: ME, act } } });
    expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/3`, lead: 'undid', removed: 1 });
  });

  it('U3: redo names the person\'s own undo set', async () => {
    const w = world();
    const { s } = await opened(w);
    const key = await withNotice(w, s, 1, 10);
    s.undoNotice(key, s.noticeView().shown!.rev, press('click'));
    await flush(200);
    const undoAct = (w.store.rows(DIM).at(-1)!.payload as { act: string }).act;
    expect(s.redoNotice(key, press('click'))).toBe(true);
    await flush(200);
    expect(w.of('dim.undo')[1]!.args).toEqual(expect.objectContaining({ of: { principal: ME, act: undoAct } }));
  });
});

describe('E3 item 5 (aegis A1): the 1b line only when the hash matched and only attr differs', () => {
  it('attrOff for an attr-only mismatch; not when the hash differs too; cleared at a later matching point', async () => {
    const w = world();
    const { s } = await opened(w);
    const check = async (o: { hash?: string; attr?: string }): Promise<void> => {
      w.check = o;
      w.turn('claude', ++w.turns, [rect(60 + w.turns)]);
      s.touch(press());
      await flush(100);
    };
    await check({ attr: `sha256:${'1'.repeat(64)}` });
    expect(s.status()).toMatchObject({ verified: true, attrOff: true });
    await check({});
    expect(s.status().attrOff).toBe(false);
    await check({ hash: `sha256:${'2'.repeat(64)}`, attr: `sha256:${'1'.repeat(64)}` });
    expect(s.status()).toMatchObject({ verified: false, attrOff: false });
  });
});

describe('E3 round 2: the notices follow the mod\'s pins', () => {
  it('at a check, a notice whose set the mod no longer pins leaves (dismissed on another page); a pinned one stays', async () => {
    const w = world();
    const { s } = await opened(w);
    const k1 = await withNotice(w, s, 1, 10);
    const k2 = await withNotice(w, s, 2, 11);
    w.pins = [{ hsid: AG, turn: k1 }];
    s.touch(press());
    await flush(200);
    expect(s.noticeView().shown!.key).toBe(k1);
    expect(s.noticeView().behind).toHaveLength(0);
    expect(w.of('dim.seen')).toHaveLength(0);
    void k2;
  });
  it('a reload: the open answer\'s pins raise the notices from the rows the page already holds', async () => {
    const w = world();
    // an agent turn on the board before the page opened it (the backlog)
    w.push(DIM_KINDS.start, { title: 'Plan', attached: [HSID, AG], opened: 'command', relayedFor: w.human });
    w.push(DIM_KINDS.op, { ops: [rect(10)], act: ULID(90), relayedFor: w.human });
    w.turn('claude', 1, [{ type: 'update', id: ULID(10), patch: { color: 'cobalt' } } as DimOp]);
    w.pins = [{ hsid: AG, turn: `turn:${AG}/1` }];
    const { s } = await opened(w);
    expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/1`, changed: 1 });
  });
});

describe('E3 round 2 item 4: the mark row, cut-outs, before it was stopped', () => {
  it('one selected mark an agent changed shows its row; its undo is dim.undo with ids [that mark]; two selected show none', async () => {
    const w = world();
    const { s } = await opened(w);
    const key = await withNotice(w, s, 1, 10);
    s.select([ULID(10)], press());
    expect(s.noticeView().mark).toMatchObject({ key, id: ULID(10), removed: false });
    s.select([ULID(10), ULID(11)], press());
    expect(s.noticeView().mark).toBeNull();
    s.select([ULID(10)], press());
    const m = s.noticeView().mark!;
    expect(s.undoMark(m.id, m.key, m.rev, press('click'))).toBe(true);
    await flush(200);
    expect(w.of('dim.undo')[0]!.args).toMatchObject({ of: { hsid: AG, turn: key }, ids: [ULID(10)] });
  });
  it('a selected cut-out of your removed mark shows put back; a selection of marks ends it', async () => {
    const w = world();
    const { s } = await opened(w);
    s.edit([rect(20)], press());
    await flush(200);
    w.turn('claude', 1, [{ type: 'delete', id: ULID(20) } as DimOp]);
    expect(s.boardMarks().cutouts).toMatchObject([{ node: ULID(20), x: 20, y: 0, width: 10, height: 10 }]);
    s.selectCutout(ULID(20));
    expect(s.noticeView().mark).toMatchObject({ id: ULID(20), removed: true });
    s.select([ULID(5)], press());
    expect(s.noticeView().mark).toBeNull();
  });
  it('turning a hand off while its turn runs raises that turn\'s notice at once, marked stopped (DimNotices)', () => {
    const n = new DimNotices({ me: ME });
    const before = { dim: DIM, title: '', attached: [], ended: false, nodes: new Map([[ULID(30), { node: { id: ULID(30), kind: 'rect' }, by: { cls: 'human', principal: ME }, hsid: null, addedSeq: 1 }]]), gone: new Set(), seq: 1, ops: 1, unapplied: 0 } as never;
    n.row({ seq: 2, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: [{ type: 'update', id: ULID(30), patch: { color: 'cobalt' } }], relayedFor: { principal: 'p:00000000/claude', surface: 'bridge', agent: 'claude', hsid: AG, turn: `turn:${AG}/1` } } } as DimRow, before);
    expect(n.shown()).toBeNull();
    const run = n.runningOf(AG);
    expect(run).toBe(`turn:${AG}/1`);
    n.ended(run!, 5, { stopped: true });
    expect(n.shown()).toMatchObject({ key: run, stopped: true, changed: 1 });
  });
});

describe('E3 round 2 revert gaps', () => {
  it('dismiss names only the SHOWN notice: a single press on a notice behind the slot sends nothing', async () => {
    const w = world();
    const { s } = await opened(w);
    const k1 = await withNotice(w, s, 1, 10);
    await withNotice(w, s, 2, 11);
    expect(s.dismissNotice(k1, press('click'))).toBe(false);
    await flush(200);
    expect(w.of('dim.seen')).toHaveLength(0);
  });
  it('N3: a marker naming a person act the page never saw raises no "your change"', async () => {
    const w = world();
    const { s } = await opened(w);
    s.edit([rect(40)], press());
    await flush(200);
    w.turn('luna', 1, [{ type: 'update', id: ULID(40), patch: { color: 'cobalt' } } as DimOp], { undo: { of: { principal: ME, act: ULID(999) } } });
    expect(s.noticeView().shown).toMatchObject({ lead: null, changed: 1 });
  });
});

describe('E3 round 3: R3, this session\'s own turn', () => {
  it('an own turn that touched only its own marks raises no notice; its key undoes it (dim.undo of that turn), once', async () => {
    const w = world();
    const { s } = await opened(w);
    const own = (t: number) => ({ principal: 'p:00000000/claude', surface: 'bridge', agent: 'claude', hsid: HSID, turn: `turn:${HSID}/${t}` });
    w.push(DIM_KINDS.op, { ops: [rect(50)], relayedFor: own(1) });
    w.sessions.apply([{ seq: 9_000, kind: 'turn.result', payload: { turn: `turn:${HSID}/1` } }]);
    const v = s.noticeView();
    expect(v.shown).toBeNull();
    expect(v.own).toEqual({ key: `turn:${HSID}/1`, rev: 1 });
    expect(s.undoOwn(v.own!.key, v.own!.rev, press('click'))).toBe(true);
    await flush(200);
    expect(w.of('dim.undo')[0]!.args).toMatchObject({ of: { hsid: HSID, turn: `turn:${HSID}/1` } });
    expect(s.noticeView().own).toBeNull();
  });
});


describe('E3 review group A (Aegis A2, A3, N-1)', () => {
  const AT = '2023-11-14T10:00:00.000Z';
  it('A2: a pin naming a running turn raises no notice until the page saw it close; N-1: it shows that time', () => {
    const w = world();
    w.push(DIM_KINDS.start, { title: 'Plan', attached: [HSID, AG], opened: 'command', relayedFor: w.human });
    w.push(DIM_KINDS.op, { ops: [rect(10)], act: ULID(90), relayedFor: w.human });
    // the agent's first row touches the person's mark: the mod pins it now, while the turn runs
    w.push(DIM_KINDS.op, { ops: [{ type: 'update', id: ULID(10), patch: { color: 'cobalt' } }], relayedFor: w.agentStamp('claude', 1) });
    const nb = new DimNotices({ me: ME });
    for (const r of w.store.rows(DIM)) if (r.kind === DIM_KINDS.op) nb.row(r, w.store.stateAt(DIM, r.seq - 1));
    const k = `turn:${AG}/1`;
    expect(nb.follow([k], () => undefined, 5, () => null)).toEqual({ moved: false, gone: [], pushed: [] });
    expect(nb.shown()).toBeNull();
    const f = nb.follow([k], () => undefined, 9, (t) => (t === k ? Date.parse(AT) : null));
    expect(f.moved).toBe(true);
    expect(nb.shown()).toMatchObject({ key: k, changed: 1, at: Date.parse(AT) });
  });

  it('N-1: a notice raised by follow at a reload shows the turn\'s own time, not the reload\'s', async () => {
    const w = world();
    w.push(DIM_KINDS.start, { title: 'Plan', attached: [HSID, AG], opened: 'command', relayedFor: w.human });
    w.push(DIM_KINDS.op, { ops: [rect(10)], act: ULID(90), relayedFor: w.human });
    w.push(DIM_KINDS.op, { ops: [{ type: 'update', id: ULID(10), patch: { color: 'cobalt' } }], relayedFor: w.agentStamp('claude', 1) });
    w.sessions.apply([{ seq: 400, kind: 'turn.result', at: AT, payload: { turn: `turn:${AG}/1` } }]);
    w.pins = [{ hsid: AG, turn: `turn:${AG}/1` }];
    const { s } = await opened(w);
    expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/1`, at: Date.parse(AT) });
  });

  it('A3: a ninth pushed out while the board is folded is said at the next open, once', async () => {
    const w = world();
    const first = await opened(w);
    first.s.edit([rect(30)], press());
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    for (let t = 1; t <= DIM_NOTICE_CAP; t++) await withNotice(w, first.s, t, 10 + t);
    expect(await first.s.fold(press('keydown'))).toBe(true);
    w.turn('claude', 9, [{ type: 'update', id: ULID(30), patch: { color: 'cobalt' } } as DimOp]);
    const lines: DimSessionNotice[] = [];
    const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'command', title: 'Plan' }, press('click'));
    s.onChange((c) => void (c.notice && lines.push(c.notice)));
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(await s.opened()).toBe(true);
    expect(lines.filter((n) => n.code === 'pushed-out')).toEqual([expect.objectContaining({ about: 'undo', agent: 'claude', at: expect.any(Number) })]);
  });

  it('A3: a notice follow removes that this page never pressed is said once (N2); one this page dismissed is not', async () => {
    const w = world();
    const { s, notices } = await opened(w);
    const k1 = await withNotice(w, s, 1, 10);
    const k2 = await withNotice(w, s, 2, 11);
    // dismiss the shown one (k2) here, its answer held; then a third turn, and a check that pins only the third
    w.hold.seen = true;
    expect(s.dismissNotice(k2, press())).toBe(true);
    await flush(10);
    const k3 = await withNotice(w, s, 3, 12);
    w.pins = [{ hsid: AG, turn: k3 }];
    s.touch(press());
    await flush(200);
    expect(s.noticeView().shown!.key).toBe(k3);
    const out = notices.filter((n) => n.code === 'no-longer' || n.code === 'pushed-out');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: 'no-longer', agent: 'claude', at: expect.any(Number) });
    w.release();
    void k1;
  });

  it('N-3: an own turn whose notice was dismissed shows no own-turn key (it raised a notice once)', async () => {
    const w = world();
    const { s } = await opened(w);
    s.edit([rect(60)], press());
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    const own = { principal: 'p:00000000/claude', surface: 'bridge', agent: 'claude', hsid: HSID, turn: `turn:${HSID}/1` };
    w.push(DIM_KINDS.op, { ops: [{ type: 'update', id: ULID(60), patch: { color: 'cobalt' } }], relayedFor: own });
    w.sessions.apply([{ seq: 9_000, kind: 'turn.result', payload: { turn: `turn:${HSID}/1` } }]);
    expect(s.noticeView().shown!.key).toBe(`turn:${HSID}/1`);
    expect(s.dismissNotice(`turn:${HSID}/1`, press())).toBe(true);
    await flush(50);
    expect(s.noticeView().shown).toBeNull();
    expect(s.noticeView().own).toBeNull();
  });

  it('r3 item 5: a ninth keeps the push-out words; a notice the mod let go says it is no longer on the strip', async () => {
    const w = world();
    const { s, notices } = await opened(w);
    const keys: string[] = [];
    for (let t = 1; t <= DIM_NOTICE_CAP; t++) keys.push(await withNotice(w, s, t, 10 + t));
    // turn 9 of another page's session: its rows land here, its notice is raised by the pins (a reload's way)
    expect(notices.filter((n) => n.code === 'pushed-out')).toHaveLength(0);
    const k9 = await withNotice(w, s, DIM_NOTICE_CAP + 1, 30);
    expect(notices.filter((n) => n.code === 'pushed-out')).toHaveLength(1);
    w.pins = [...keys.slice(2), k9].map((turn) => ({ hsid: AG, turn }));
    s.touch(press());
    await flush(200);
    const gone = notices.filter((n) => n.code === 'no-longer');
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ about: 'undo', agent: 'claude', at: expect.any(Number) });
  });

  it('r3 F-2: a refused press does not silence the line said when the mod later lets that notice go', async () => {
    const w = world();
    const { s, notices } = await opened(w);
    await withNotice(w, s, 1, 10);
    const k2 = await withNotice(w, s, 2, 11);
    w.hold.refuse = true;
    const v = s.noticeView().shown!;
    expect(s.undoNotice(k2, v.rev, press())).toBe(true);
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(w.of('dim.undo')).toHaveLength(1);
    expect(s.noticeView().shown!.key).toBe(k2);
    await withNotice(w, s, 3, 12);
    w.pins = [{ hsid: AG, turn: `turn:${AG}/3` }];
    s.touch(press());
    await flush(200);
    expect(notices.filter((n) => n.code === 'no-longer')).toHaveLength(2);
  });

  it('r3 F-3: a folded board\'s notice shows its turn.result row\'s time', async () => {
    const w = world();
    const { s } = await opened(w);
    s.edit([rect(40)], press());
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(await s.fold(press('keydown'))).toBe(true);
    w.push(DIM_KINDS.op, { ops: [{ type: 'update', id: ULID(40), patch: { color: 'cobalt' } }], relayedFor: w.agentStamp('claude', 1) });
    w.sessions.apply([{ seq: 800, kind: 'turn.result', at: AT, payload: { turn: `turn:${AG}/1` } }]);
    expect(w.sessions.standingFor(DIM)[0]).toMatchObject({ key: `turn:${AG}/1`, at: Date.parse(AT) });
  });

  describe('r3 F-1: a pinned turn whose turn.result never comes is raised as stopped', () => {
    const backlog = (w: ReturnType<typeof world>): void => {
      w.push(DIM_KINDS.start, { title: 'Plan', attached: [HSID, AG], opened: 'command', relayedFor: w.human });
      w.push(DIM_KINDS.op, { ops: [rect(10)], act: ULID(90), relayedFor: w.human });
      w.push(DIM_KINDS.op, { ops: [{ type: 'update', id: ULID(10), patch: { color: 'cobalt' } }], relayedFor: w.agentStamp('claude', 1) });
      w.pins = [{ hsid: AG, turn: `turn:${AG}/1` }];
    };
    it('when its session is gone', async () => {
      const w = world();
      backlog(w);
      const { s } = await opened(w);
      expect(s.noticeView().shown).toBeNull();
      w.sessions.apply([{ seq: 700, kind: 'session.exited', session: AG, payload: { code: 0 } }]);
      expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/1`, stopped: true });
    });
    it('when a later turn of that session writes a row', async () => {
      const w = world();
      backlog(w);
      const { s } = await opened(w);
      expect(s.noticeView().shown).toBeNull();
      w.sessions.apply([{ seq: 700, kind: 'tool.call', session: AG, payload: { turn: `turn:${AG}/2` } }]);
      expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/1`, stopped: true });
    });
    it('when it has waited past the live timeout', async () => {
      const w = world();
      backlog(w);
      const { s } = await opened(w);
      expect(s.noticeView().shown).toBeNull();
      await flush(4000);
      expect(s.noticeView().shown).toBeNull();
      await flush(5000);
      expect(s.noticeView().shown).toMatchObject({ key: `turn:${AG}/1`, stopped: true });
    });
  });
});
