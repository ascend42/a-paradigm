/**
 * S1.4 P4b "GUI live" (#gui-dim-session, #gui-dim-store, #gui-board-turn, #gui-board-leaf), in Node on fake timers
 * and a fake client: the draw key's sender and states (Aegis P4-design rulings 1 and 3, M9, M10), the dim.select
 * sender, the hash point after an agent turn (Aegis C2.6), the arrival line, the removed-mid-drag line and the turn
 * strip's tail. Each Aegis condition is one `it`. The DOM conditions (a key's box, focus) are in the real-engine
 * file test/board-grant-key.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIM_AUX_KINDS, DIM_KINDS, dimAttrDigest, dimHash } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import type { BoardHandle } from '../src/core/board.js';
import { arrivalLine, countSlot, GRANT_COPY, removedLine } from '../src/core/board-leaf.js';
import { latestTurn, rowText, turnStripRows, type LatestTurn } from '../src/core/board-turn.js';
import { DIM_GRANT_QUIET_MS, DIM_SEND_LIMITS, DimSessions, type DimSession, type DimSessionNotice } from '../src/core/dim-session.js';
import { DimStore, parseTurnRef } from '../src/core/dim-store.js';

const ULID = (n: number): string => `01JD1M${String(n).padStart(20, '0')}`;
const DIM = `dim:${ULID(1)}`;
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const ME = 'p:00000000/founder';
const press = (type = 'click'): Event => ({ isTrusted: true, type }) as unknown as Event;
const rect = (n: number): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'rect', x: n, y: 0, z: 'V', w: 10, h: 10 } as never });
const turn = (hsid: string, n: number): string => `turn:${hsid}/${n}`;

interface Call {
  commandId: string;
  args: Record<string, unknown>;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

/** A fake client and a tiny mod: open answers the grant map (M9), grant appends a grant row, check answers the fold. */
function world(o: { live?: (hsid: string) => boolean; attached?: string[] } = {}) {
  const store = new DimStore();
  const calls: Call[] = [];
  const sessions = new DimSessions({ store, ...(o.live ? { live: o.live } : {}), mint: (() => { let n = 5000; return () => ULID(n++); })() });
  let seq = 0;
  const gui = (conn = 'conn:A') => ({ principal: ME, connId: conn, surface: 'gui' });
  const append = (kind: string, payload: Record<string, unknown>, stamp: Record<string, unknown> = gui(), causes?: string[]): DimRow => {
    const row = { seq: ++seq, kind, payload: { v: 1, ...payload, relayedFor: stamp }, ...(causes ? { causes } : {}) };
    sessions.apply([row]);
    return row as DimRow;
  };
  const agentOp = (hsid: string, n: number, ops: DimOp[]): DimRow => append(DIM_KINDS.op, { dim: DIM, ops }, { principal: `p:00000000/s-${hsid.slice(-4)}`, surface: 'bridge', agent: 'claude', hsid }, [turn(hsid, n)]);
  const result = (hsid: string, n: number): void => void sessions.apply([{ seq: ++seq, kind: 'turn.result', payload: { hsid, turn: turn(hsid, n) } }]);
  const grantList = (): Array<{ hsid: string; write: boolean }> => {
    const st = store.stateAt(DIM);
    const g = store.grants(DIM);
    return st.attached.map((h, i) => ({ hsid: h, write: g.has(h) ? g.get(h)!.write : i === 0 }));
  };
  const answer = (c: Call): void => {
    if (c.commandId === 'dim.attach') {
      const r = append(DIM_KINDS.attach, { dim: DIM, hsid: (c.args.focus as { hsid: string }).hsid });
      return c.resolve({ result: { ok: true, already: false, dim: DIM, seq: r.seq } });
    }
    if (c.commandId === 'dim.open') {
      const r = store.has(DIM) ? append(DIM_KINDS.start, { dim: DIM, attached: store.stateAt(DIM).attached, opened: 'command' }) : append(DIM_KINDS.start, { dim: DIM, title: 'Plan', attached: o.attached ?? [A], opened: 'command' });
      return c.resolve({ result: { ok: true, created: true, dim: DIM, seq: r.seq, hash: dimHash(store.stateAt(DIM)), attr: dimAttrDigest(store.stateAt(DIM)), grants: grantList() } });
    }
    if (c.commandId === 'dim.grant') {
      const r = append(DIM_AUX_KINDS.grant, { dim: DIM, hsid: (c.args.focus as { hsid: string }).hsid, write: c.args.write });
      return c.resolve({ result: { ok: true, dim: DIM, seq: r.seq, grants: grantList() } });
    }
    if (c.commandId === 'dim.check') return c.resolve({ result: { ok: true, dim: DIM, seq: store.stateAt(DIM).seq, hash: dimHash(store.stateAt(DIM)), attr: dimAttrDigest(store.stateAt(DIM)) } });
    if (c.commandId === 'dim.op') {
      const r = append(DIM_KINDS.op, { dim: DIM, ops: c.args.ops });
      return c.resolve({ result: { ok: true, dim: DIM, seq: r.seq, hash: dimHash(store.stateAt(DIM)), attr: dimAttrDigest(store.stateAt(DIM)), applied: (c.args.ops as unknown[]).length, refused: [] } });
    }
    if (c.commandId === 'dim.select') return c.resolve({ result: { ok: true, dim: DIM, selected: (c.args.ids as unknown[]).length } });
    c.resolve({ result: { ok: false, code: 'command-unknown' } });
  };
  let auto = true;
  const client = () => ({
    call: <T,>(method: string, params?: unknown): Promise<T> => {
      expect(method).toBe('mod.command');
      const p = params as { commandId: string; args: Record<string, unknown> };
      return new Promise<T>((resolve, reject) => {
        const c: Call = { commandId: p.commandId, args: p.args, resolve: resolve as (v: unknown) => void, reject };
        calls.push(c);
        if (auto) answer(c);
      });
    },
  });
  sessions.connect({ client: client() as never, principal: ME, connId: 'conn:A' });
  return {
    store, sessions, calls, append, agentOp, result, answer, gui,
    hold: (): void => void (auto = false),
    free: (): void => void (auto = true),
    reconnect: (): DimSession[] => sessions.connect({ client: client() as never, principal: ME, connId: 'conn:B' }),
    of: (id: string) => calls.filter((c) => c.commandId === id),
  };
}

function fakeHandle() {
  let gone: ((r: { what: 'gone'; id: string; change: 'moving' | 'changing' }) => void) | null = null;
  const handle = {
    isAlive: () => true,
    render: (_s: DimState) => undefined,
    onEdit: () => () => undefined,
    onUndoKey: () => () => undefined,
    onGone: (fn: typeof gone) => ((gone = fn), () => void (gone = null)),
  } as unknown as BoardHandle;
  return { handle, gone: (id: string, change: 'moving' | 'changing' = 'moving') => gone?.({ what: 'gone', id, change }) };
}

const flush = async (ms = 0): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms));

async function opened(w: ReturnType<typeof world>): Promise<{ s: DimSession; n: DimSessionNotice[]; h: ReturnType<typeof fakeHandle> }> {
  const s = w.sessions.open({ dim: DIM, hsid: A, opened: 'command', title: 'Plan' }, press('click'));
  const n: DimSessionNotice[] = [];
  s.onChange((c) => void (c.notice && n.push(c.notice)));
  const h = fakeHandle();
  s.attachHandle(h.handle);
  await flush(DIM_SEND_LIMITS.gapMs);
  return { s, n, h };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe('S1.4 P4b the draw key: Aegis P4-design ruling 1 (one trusted press, explicit target)', () => {
  it('the key is there from the open answer, "may edit" for the first attached session, and is told ONCE after the board confirmed it (Aegis A3, D1)', async () => {
    const w = world();
    const { s, n } = await opened(w);
    expect(s.grantKeys()).toEqual([{ hsid: A, write: true, state: 'live', since: null }]);
    expect(n.filter((x) => x.about === 'grant')).toEqual([expect.objectContaining({ code: 'grant-default', hsid: A, write: true })]);
  });

  it('a press sends an EXPLICIT target with focus {hsid: target}; two presses racing a foreign grant row never invert the person\'s intent', async () => {
    const w = world({ attached: [A, B] });
    const { s } = await opened(w);
    // B starts off (later attached): the key shows what the board confirmed
    expect(s.grantKeys().map((k) => [k.hsid, k.write])).toEqual([[A, true], [B, false]]);
    w.hold();
    expect(s.grant(B, press())).toBe(true);
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(w.of('dim.grant').map((c) => [c.args.write, c.args.focus])).toEqual([[true, { hsid: B }]]);
    // another window turns B on too while ours is in flight; a second press now is DROPPED (pending)
    w.append(DIM_AUX_KINDS.grant, { dim: DIM, hsid: B, write: true }, w.gui('conn:other'));
    expect(s.grant(B, press())).toBe(false);
    w.answer(w.of('dim.grant')[0]!);
    w.free();
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(s.grantKeys().find((k) => k.hsid === B)).toMatchObject({ write: true, state: 'live' });
    // the other window turns B off; the person's next press reads the CONFIRMED state (off) and asks for ON, as the key showed
    w.append(DIM_AUX_KINDS.grant, { dim: DIM, hsid: B, write: false }, w.gui('conn:other'));
    expect(s.grantKeys().find((k) => k.hsid === B)!.write).toBe(false);
    s.grant(B, press());
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(w.of('dim.grant').map((c) => c.args.write)).toEqual([true, true]);
    // never a toggle on the wire: every grant carries a boolean target and no other key of its own
    for (const c of w.of('dim.grant')) expect(Object.keys(c.args).sort()).toEqual(['dim', 'focus', 'gesture', 'write']);
  });

  it('an untrusted press, a held key (no stamp) and a press for a session that is not attached send nothing', async () => {
    const w = world();
    const { s } = await opened(w);
    expect(s.grant(A, { isTrusted: false, type: 'click' } as Event)).toBe(false);
    expect(s.grant(A, { isTrusted: true, type: 'keydown', repeat: true } as unknown as Event)).toBe(false);
    expect(s.grant(B, press())).toBe(false);
    expect(s.grant(A, null)).toBe(false);
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(w.of('dim.grant')).toEqual([]);
  });

  it('M9: a failed revoke leaves the key reading "may edit"; past 300 ms the pending key keeps the CONFIRMED words', async () => {
    const w = world();
    const { s, n } = await opened(w);
    w.hold();
    s.grant(A, press());
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(s.grantKeys()[0]).toMatchObject({ write: true, state: 'pending' });
    await flush(DIM_GRANT_QUIET_MS);
    expect(s.grantKeys()[0]).toMatchObject({ write: true, state: 'pending' });
    w.of('dim.grant')[0]!.resolve({ result: { ok: false, code: 'dim-ended' } });
    await flush();
    expect(s.grantKeys()[0]).toMatchObject({ write: true, state: 'live' });
    expect(n.at(-1)).toMatchObject({ about: 'grant', code: 'grant-refused', write: true });
  });

  it('M10: attaching a session sends no grant (an open that attaches sends attach and open only)', async () => {
    const w = world();
    // the dimension exists with A attached; B opens it, so B is attached first, on the same stamp
    w.append(DIM_KINDS.start, { dim: DIM, title: 'Plan', attached: [A], opened: 'command' });
    const s = w.sessions.open({ dim: DIM, hsid: B, opened: 'menu' }, press('click'));
    await flush(DIM_SEND_LIMITS.gapMs * 4);
    expect(s.status().phase).toBe('open');
    expect(w.calls.map((c) => c.commandId)).toEqual(['dim.attach', 'dim.open']);
    // B attached later: off by default, and nothing said for it (no default grant to confirm)
    expect(s.grantKeys().map((k) => [k.hsid, k.write])).toEqual([[A, true], [B, false]]);
  });
});

describe('S1.4 P4b the draw key: Aegis ruling 3 (link down) and the non-live session', () => {
  it('a press while the link is down is dropped, never queued; after the reconnect no dim.grant is sent', async () => {
    const w = world();
    const { s } = await opened(w);
    w.sessions.linkDown();
    // both states take the disabled look while down
    expect(s.grantKeys()[0]).toMatchObject({ write: true, state: 'down' });
    expect(s.grant(A, press())).toBe(false);
    const [back] = w.reconnect();
    await flush(DIM_SEND_LIMITS.gapMs * 4);
    expect(w.of('dim.grant')).toEqual([]);
    expect(back!.grantKeys()[0]).toMatchObject({ state: 'live' });
  });

  it('on return the key stays disabled until the grant map has arrived, and a flip from a SECOND connection while the first was down shows before it enables', async () => {
    const w = world();
    const { s } = await opened(w);
    w.sessions.linkDown();
    // a second connection turns A off while this page is down (the row is read in the backlog before connect)
    w.append(DIM_AUX_KINDS.grant, { dim: DIM, hsid: A, write: false }, w.gui('conn:other'));
    expect(s.grantKeys()[0]!.state).toBe('down');
    const [back] = w.reconnect();
    expect(back!.grantKeys()[0]).toEqual({ hsid: A, write: false, state: 'live', since: null });
  });

  it('a session that is NOT live has its key disabled (idle), never "may not edit"; it enables as soon as it is live', async () => {
    let live = false;
    const w = world({ live: () => live });
    const { s } = await opened(w);
    expect(s.grantKeys()[0]).toMatchObject({ write: true, state: 'idle' });
    expect(s.grant(A, press())).toBe(false);
    live = true;
    expect(s.grantKeys()[0]!.state).toBe('live');
  });
});

describe('S1.4 P4b dim.select: lowest priority, latest wins, per hsid', () => {
  it('is dropped while an edit batch waits; the latest wins; it names this session\'s hsid only', async () => {
    const w = world({ attached: [A, B] });
    const { s } = await opened(w);
    w.hold();
    s.edit([rect(1)], press('pointerup'));
    s.select([ULID(1)], press('pointerup'));
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(w.of('dim.select')).toEqual([]);
    w.answer(w.of('dim.op')[0]!);
    await flush(DIM_SEND_LIMITS.gapMs);
    s.select([ULID(1)], press('pointerup'));
    s.select([ULID(2)], press('pointerup'));
    s.select([ULID(3)], press('pointerup'));
    await flush(DIM_SEND_LIMITS.gapMs);
    w.answer(w.of('dim.select')[0]!);
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(w.of('dim.select').map((c) => c.args.ids)).toEqual([[ULID(1)], [ULID(3)]]);
    for (const c of w.of('dim.select')) expect(c.args.focus).toEqual({ hsid: A });
  });
});

describe('S1.4 P4b the hash point after an agent turn (Aegis C2.6) and the arrival line', () => {
  it('dim.check is asked ONCE per agent turn (not per row), on the person\'s next trusted press; its hash and attr are recorded', async () => {
    const w = world();
    const { s } = await opened(w);
    w.agentOp(A, 1, [rect(1)]);
    w.agentOp(A, 1, [rect(2)]);
    w.agentOp(A, 1, [rect(3)]);
    expect(s.status().checkDue).toBe(false);
    w.result(A, 1);
    expect(s.status().checkDue).toBe(true);
    s.touch(press('pointerup'));
    s.touch(press('pointerup'));
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(w.of('dim.check')).toHaveLength(1);
    expect(s.status()).toMatchObject({ checkDue: false, verified: true, checkedSeq: w.store.stateAt(DIM).seq, attr: { seq: w.store.stateAt(DIM).seq, attr: dimAttrDigest(w.store.stateAt(DIM)) } });
    // a second turn is a second point
    w.agentOp(A, 2, [rect(4)]);
    w.result(A, 2);
    s.touch(press('keydown'));
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(w.of('dim.check')).toHaveLength(2);
  });

  it('the person\'s own dim.op answer is a hash point too (hash on the ok answer), so a turn it already vouches for asks for no check', async () => {
    const w = world();
    const { s } = await opened(w);
    w.agentOp(A, 1, [rect(1)]);
    s.edit([rect(9)], press('pointerup'));
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(s.status()).toMatchObject({ verified: true, checkedSeq: w.store.stateAt(DIM).seq });
    w.result(A, 1);
    expect(s.status().checkDue).toBe(false);
  });

  it('ONE arrival line per agent turn, counted from rows; nothing when nothing landed; a result read again says nothing more', async () => {
    const w = world();
    const { s, n } = await opened(w);
    w.agentOp(A, 1, [rect(1), rect(2)]);
    w.agentOp(A, 1, [rect(3), { type: 'update', id: ULID(1), patch: { line: 'ink' } } as never]);
    w.result(A, 1);
    w.result(A, 1);
    const arrived = n.filter((x) => x.about === 'hand' && x.code === 'arrived');
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toMatchObject({ agent: 'claude', marks: { added: 3, changed: 0, removed: 0 } });
    expect(arrivalLine('Claude', arrived[0]!.marks!)).toBe('Claude added 3 marks');
    // a turn of rows that changed and removed: one line, its parts
    w.agentOp(A, 2, [{ type: 'move', ids: [ULID(1), ULID(2)], dx: 5, dy: 0 } as never, { type: 'delete', id: ULID(3) } as never]);
    w.result(A, 2);
    expect(n.filter((x) => x.code === 'arrived').at(-1)!.marks).toEqual({ added: 0, changed: 2, removed: 1 });
    expect(arrivalLine('Claude', { added: 0, changed: 2, removed: 1 })).toBe('Claude changed 2 marks and removed 1');
    expect(arrivalLine('Claude', { added: 3, changed: 2, removed: 1 })).toBe('Claude added 3 marks, changed 2 and removed 1');
    expect(arrivalLine('Claude', { added: 1, changed: 0, removed: 0 })).toBe('Claude added 1 mark');
    expect(arrivalLine('Claude', { added: 0, changed: 0, removed: 0 })).toBeNull();
    // a turn with no rows on this board says nothing
    w.result(A, 3);
    expect(n.filter((x) => x.code === 'arrived')).toHaveLength(2);
    // a person's row is never an agent turn
    w.append(DIM_KINDS.op, { dim: DIM, ops: [rect(7)] }, w.gui('conn:other'), [turn(A, 4)]);
    w.result(A, 4);
    expect(n.filter((x) => x.code === 'arrived')).toHaveLength(2);
  });
});

describe('S1.4 P4b the removed-mid-drag line', () => {
  it('the handle\'s {what: gone, id} is said with WHO removed the mark, from the recent foreign rows', async () => {
    const w = world();
    const { n, h } = await opened(w);
    w.agentOp(A, 1, [rect(1)]);
    w.agentOp(A, 1, [{ type: 'delete', id: ULID(1) } as never]);
    h.gone(ULID(1), 'moving');
    expect(n.at(-1)).toMatchObject({ about: 'hand', code: 'gone', agent: 'claude', change: 'moving' });
    expect(removedLine('Claude', 'moving')).toBe('Claude removed the mark you were moving');
    expect(removedLine('Claude in billing-ui', 'changing')).toBe('Claude in billing-ui removed the mark you were changing');
    // not a refusal: no ✕, never error, failed or conflict
    expect(removedLine('Claude', 'moving')).not.toMatch(/✕|error|failed|conflict/i);
  });
});

describe('S1.4 P4b the turn strip tail', () => {
  const ended = (drew: LatestTurn['drew']): LatestTurn => ({ none: false, you: { text: 'sketch it', at: '14:05', waiting: false }, refused: null, working: null, reply: 'I drew the handoff.', ended: { words: null, tone: 'quiet' }, more: null, drew });

  it('counts from ROWS of the latest ended turn (DimSessions.drewFor), never from the reply', async () => {
    const w = world();
    await opened(w);
    w.agentOp(A, 1, [rect(1), rect(2), rect(3)]);
    expect(w.sessions.drewFor(A)).toBeNull(); // the turn has not ended
    w.result(A, 1);
    expect(w.sessions.drewFor(A)).toEqual({ added: 3, changed: 0, removed: 0 });
    // a reply that claims 99 marks changes nothing: the tail reads the rows
    const rows = turnStripRows({ ...ended(w.sessions.drewFor(A)), reply: 'I drew 99 marks' }, 'Claude', 400);
    expect(rowText(rows.at(-1)!.parts)).toBe('Claude · I drew 99 marks · drew 3 on the board');
  });

  it('a turn that only changed reads "changed N"; tight rows drop " on the board" (level 4) then "stopped: " (level 5); the count never drops', () => {
    const t = ended({ added: 0, changed: 2, removed: 1 });
    expect(rowText(turnStripRows(t, 'Claude', 400).at(-1)!.parts)).toBe('Claude · I drew the handoff. · changed 3 on the board');
    const lim: LatestTurn = { ...ended({ added: 64, changed: 0, removed: 0 }), ended: { words: 'stopped: step limit 200', tone: 'warn' }, more: 'needs' };
    const parts = turnStripRows(lim, 'Claude', 400).at(-1)!.parts;
    expect([0, 3, 4, 5].map((l) => rowText(parts, l as 0 | 3 | 4 | 5))).toEqual(['Claude · I drew the handoff. · stopped: step limit 200 · drew 64 on the board · needs you', 'stopped: step limit 200 · drew 64 on the board · needs you', 'stopped: step limit 200 · drew 64 · needs you', 'step limit 200 · drew 64 · needs you']);
    // never while the turn runs, never before it ended
    expect(rowText(turnStripRows({ ...t, ended: null, reply: null }, 'Claude', 400).at(-1)!.parts)).not.toMatch(/drew|changed/);
    expect(latestTurn([]).drew).toBeUndefined();
  });
});

describe('S1.4 P4b words and parsing', () => {
  it('the face is "may edit" / "may not edit" (E-design edit_anything); a count over 999 is "999+"', () => {
    expect([GRANT_COPY.on, GRANT_COPY.off]).toEqual(['may edit', 'may not edit']);
    expect(GRANT_COPY.off.length).toBeLessThanOrEqual(12);
    expect([countSlot(9), countSlot(999), countSlot(1000)]).toEqual(['9', '999', '999+']);
    for (const w of [GRANT_COPY.titleOn('Claude'), GRANT_COPY.titleOff('Claude'), GRANT_COPY.titleDown, GRANT_COPY.spokenOn('Claude')]) expect(w).not.toMatch(/\b(Allow|Deny|Approve|Trust|Grant|Always|permission|access)\b/);
  });
  it('a turn ref is the kernel\'s turnId and nothing else', () => {
    expect(parseTurnRef(turn(A, 3))).toEqual({ hsid: A, n: 3 });
    for (const bad of ['turn:/1', `turn:${A}/0`, `turn:${A}/x`, `${A}/1`, 7, null]) expect(parseTurnRef(bad)).toBeNull();
  });
});
