/**
 * #gui-dim-session (boards S1.3 pass P4a): the live loop as one unit, in Node, on fake timers and a fake client.
 * The real kernel and the real mod are driven by packages/gnomon/test/dimension-dogfood.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIM_KINDS, dimHash, foldDim } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import type { BoardHandle } from '../src/core/board.js';
import { RpcError } from '../src/core/client.js';
import { DIM_LIVE_TIMEOUT_MS } from '../src/core/dim-live.js';
import { DIM_SEND_LIMITS, DimSendLimiter, DimSessions, modAnswerOf, type DimSession, type DimSessionNotice, type DimSessionsEvent } from '../src/core/dim-session.js';
import { DimStore } from '../src/core/dim-store.js';
import { GESTURE_MAX_AGE_MS } from '../src/core/gesture.js';

const ULID = (n: number): string => `01JD1M${String(n).padStart(20, '0')}`;
const DIM = `dim:${ULID(1)}`;
const DIM2 = `dim:${ULID(2)}`;
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const ME = 'p:00000000/founder';
const rect = (n: number, extra: Record<string, unknown> = {}): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'rect', x: n, y: 0, z: 'V', w: 10, h: 10, ...extra } as never });
const text = (n: number, chars: number): DimOp => ({ type: 'add', node: { id: ULID(n), kind: 'text', x: n, y: 0, z: 'V', text: 'w'.repeat(chars) } as never });
const press = (type = 'pointerup', more: Record<string, unknown> = {}): Event => ({ isTrusted: true, type, ...more }) as unknown as Event;

interface Call {
  commandId: string;
  args: Record<string, unknown>;
  at: number;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

/** A client that records every relay call and lets the test settle it; `auto` answers as a tiny mod would and feeds the row back. */
function world(o: { auto?: boolean; connId?: string } = {}) {
  const store = new DimStore();
  const calls: Call[] = [];
  const sessions = new DimSessions({ store, mint: (() => { let n = 5000; return () => ULID(n++); })() });
  let seq = 0;
  const connId = o.connId ?? 'conn:A';
  const stamp = (conn = connId) => ({ principal: ME, connId: conn, surface: 'gui' });
  const append = (kind: string, payload: Record<string, unknown>, conn = connId): DimRow => {
    const row = { seq: ++seq, kind, payload: { v: 1, ...payload, relayedFor: stamp(conn) } };
    sessions.apply([row]);
    return row;
  };
  const answer = (c: Call): void => {
    const dim = c.args.dim as string;
    if (c.commandId === 'dim.open') {
      const row = append(DIM_KINDS.start, { dim, ...(store.has(dim) ? {} : { title: (c.args.title as string) ?? 'Board' }), attached: [HSID], opened: c.args.opened });
      c.resolve({ result: { ok: true, created: true, dim, seq: row.seq, hash: dimHash(store.stateAt(dim)) } });
    } else if (c.commandId === 'dim.op') {
      const row = append(DIM_KINDS.op, { dim, ops: c.args.ops });
      c.resolve({ result: { ok: true, dim, seq: row.seq, applied: (c.args.ops as unknown[]).length, refused: [] } });
    } else if (c.commandId === 'dim.close') {
      const row = append(DIM_KINDS.end, { dim, ops: 0, nodes: 0 });
      c.resolve({ result: { ok: true, already: false, dim, seq: row.seq, hash: dimHash(store.stateAt(dim)) } });
    } else c.resolve({ result: { ok: true, already: true, dim, seq } });
  };
  const client = {
    call: <T>(method: string, params?: unknown): Promise<T> => {
      expect(method).toBe('mod.command');
      const p = params as { name: string; commandId: string; args: Record<string, unknown> };
      expect(p.name).toBe('gnomon.dimension');
      return new Promise<T>((resolve, reject) => {
        const c: Call = { commandId: p.commandId, args: p.args, at: Date.now(), resolve: resolve as (v: unknown) => void, reject };
        calls.push(c);
        if (o.auto) answer(c);
      });
    },
  };
  sessions.connect({ client: client as never, principal: ME, connId });
  const events: DimSessionsEvent[] = [];
  sessions.onEvent((e) => void events.push(e));
  return { store, sessions, calls, client, append, answer, events, ops: () => calls.filter((c) => c.commandId === 'dim.op') };
}

function fakeHandle() {
  const rendered: DimState[] = [];
  let edit: ((ops: DimOp[], cause: Event | null) => void) | null = null;
  let undoKey: ((e: KeyboardEvent, redo: boolean) => void) | null = null;
  const handle = {
    isAlive: () => true,
    render: (s: DimState) => void rendered.push(s),
    onEdit: (fn: typeof edit) => ((edit = fn), () => void (edit = null)),
    onUndoKey: (fn: typeof undoKey) => ((undoKey = fn), () => void (undoKey = null)),
  } as unknown as BoardHandle;
  return { handle, rendered, edit: (ops: DimOp[], cause: Event | null) => edit?.(ops, cause), undoKey: (redo = false, e: Event = press('keydown')) => undoKey?.(e as KeyboardEvent, redo), listening: () => edit !== null, last: () => rendered[rendered.length - 1]! };
}

function watch(s: DimSession): DimSessionNotice[] {
  const notices: DimSessionNotice[] = [];
  s.onChange((c) => void (c.notice && notices.push(c.notice)));
  return notices;
}

const flush = async (ms = 0): Promise<void> => void (await vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('#gui-dim-session open, edit, confirm', () => {
  it('dim.open goes ONCE, on the stamp of the press; ops wait for it; an edit is sent with the session focus and a stamp, and is saved when its row arrives', async () => {
    const w = world();
    const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'command', title: 'Plan' }, press('click'));
    const h = fakeHandle();
    s.attachHandle(h.handle);
    expect(s.status()).toMatchObject({ phase: 'opening', keep: 'saved', link: 'up', dim: DIM, hsid: HSID, verified: null });
    expect(w.store.stats().pinned).toBe(1);
    h.edit([rect(1)], press());
    await flush();
    // only the open went out: the op waits for it
    expect(w.calls.map((c) => c.commandId)).toEqual(['dim.open']);
    expect(w.calls[0]!.args).toEqual({ opened: 'command', title: 'Plan', dim: DIM, focus: { hsid: HSID }, gesture: { n: 1, kind: 'menu' } });
    expect(s.status()).toMatchObject({ keep: 'saving', pending: 1 });
    expect(h.last().nodes.has(ULID(1))).toBe(true); // optimistic
    w.answer(w.calls[0]!);
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(await s.opened()).toBe(true);
    expect(w.calls.map((c) => c.commandId)).toEqual(['dim.open', 'dim.op']);
    expect(w.calls[1]!.args).toEqual({ ops: [rect(1)], dim: DIM, focus: { hsid: HSID }, gesture: { n: 2, kind: 'pointer' } });
    w.answer(w.calls[1]!);
    await flush();
    expect(s.status()).toMatchObject({ phase: 'open', keep: 'saved', pending: 0, canUndo: true, title: 'Plan', verified: true, partial: false, dropped: 0 });
    expect(dimHash(h.last())).toBe(dimHash(w.store.stateAt(DIM)));
    expect(s.hash()).toBe(dimHash(foldDim(w.store.rows(DIM))));
    // a second open of the same dimension answers the same session and sends nothing
    expect(w.sessions.open({ dim: DIM, hsid: HSID, opened: 'menu' }, press('click'))).toBe(s);
    await flush(1000);
    expect(w.calls).toHaveLength(2);
  });

  it('a dimension the store holds but this session is not attached to: dim.attach then dim.open, both on the one stamp', async () => {
    const w = world({ auto: true });
    w.append(DIM_KINDS.start, { dim: DIM, title: 'Theirs', attached: ['hsid:other'], opened: 'command' });
    const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'menu' }, press('click'));
    await flush(200);
    expect(await s.opened()).toBe(true);
    expect(w.calls.map((c) => [c.commandId, (c.args.gesture as { n: number }).n])).toEqual([['dim.attach', 1], ['dim.open', 1]]);
  });

  it('an open with no stamp, or one the mod refuses, fails with a notice and sends no op', async () => {
    const w = world();
    const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'command' }, null);
    const n = watch(s);
    await flush();
    expect(await s.opened()).toBe(false);
    expect(s.status().phase).toBe('failed');
    expect(s.lastNotice()).toEqual({ about: 'open', code: 'not-sent', field: 'dim', why: 'gesture-missing', lost: 0 });
    expect(w.calls).toEqual([]);
    s.edit([rect(1)], press());
    await flush();
    expect(w.calls).toEqual([]);
    expect(n.map((x) => x.code)).toEqual(['not-open']);
    expect(s.status().pending).toBe(0);
    s.destroy();
    const t = w.sessions.open({ dim: DIM2, hsid: HSID, opened: 'command' }, press('click'));
    await flush();
    w.calls[0]!.resolve({ result: { ok: false, code: 'dim-cap', fix: 'x' } });
    expect(await t.opened()).toBe(false);
    expect(t.lastNotice()).toMatchObject({ about: 'open', code: 'open-failed', why: 'dim-cap' });
  });

  it('the hash the mod answered is compared with the fold at that seq: a different fold is said once', async () => {
    const w = world();
    const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'command', title: 'Plan' }, press('click'));
    const n = watch(s);
    await flush();
    const row = w.append(DIM_KINDS.start, { dim: DIM, title: 'Plan', attached: [HSID], opened: 'command' });
    w.calls[0]!.resolve({ result: { ok: true, created: true, dim: DIM, seq: row.seq, hash: 'sha256:not-this' } });
    await flush();
    expect(s.status().verified).toBe(false);
    expect(n).toEqual([{ about: 'check', code: 'hash-mismatch', field: 'dim', why: null, lost: 0 }]);
    w.append(DIM_KINDS.op, { dim: DIM, ops: [rect(1)] }, 'conn:other');
    expect(n).toHaveLength(1);
  });

  it('modAnswerOf reads the relay wrapper and a bare answer alike', () => {
    expect(modAnswerOf({ result: { ok: true, seq: 3 } })).toEqual({ ok: true, seq: 3 });
    expect(modAnswerOf({ ok: false, code: 'dim-ended' })).toEqual({ ok: false, code: 'dim-ended' });
    expect(modAnswerOf(null)).toBeNull();
  });
});

async function opened(w: ReturnType<typeof world>, dim = DIM): Promise<{ s: DimSession; h: ReturnType<typeof fakeHandle>; n: DimSessionNotice[] }> {
  const s = w.sessions.open({ dim, hsid: HSID, opened: 'command', title: 'Plan' }, press('click'));
  const h = fakeHandle();
  s.attachHandle(h.handle);
  await flush();
  const open = w.calls.find((c) => c.commandId === 'dim.open' && c.args.dim === dim)!;
  w.answer(open);
  await flush(DIM_SEND_LIMITS.gapMs);
  return { s, h, n: watch(s) };
}

describe('#gui-dim-session stamps and failure', () => {
  it('an edit whose cause yields no stamp (none, untrusted, a key held down) is put back with render and said; nothing is sent', async () => {
    const w = world();
    const { s, h, n } = await opened(w);
    const before = w.calls.length;
    for (const cause of [null, { isTrusted: false, type: 'pointerup' } as unknown as Event, press('keydown', { repeat: true }), press('mousemove')]) {
      const renders = h.rendered.length;
      h.edit([rect(1)], cause);
      expect(h.rendered.length).toBe(renders + 1); // put back
      expect(h.last().nodes.size).toBe(0);
    }
    await flush(1000);
    expect(w.calls).toHaveLength(before);
    expect(n).toHaveLength(4);
    expect(n[0]).toEqual({ about: 'edit', code: 'not-sent', field: 'ops', why: 'gesture-missing', lost: 1 });
    expect(s.status()).toMatchObject({ keep: 'saved', pending: 0 });
  });

  it('a stamp that has expired when its turn comes is not sent: the batch is dropped, the board re-rendered, ONE notice', async () => {
    const w = world();
    const s = w.sessions.open({ dim: DIM, hsid: HSID, opened: 'command', title: 'Plan' }, press('click'));
    const h = fakeHandle();
    s.attachHandle(h.handle);
    const n = watch(s);
    await flush();
    h.edit([rect(1)], press());
    // the open is slow; the wall clock passes the stamp's life without a timer firing
    vi.setSystemTime(Date.now() + GESTURE_MAX_AGE_MS + 1);
    w.answer(w.calls[0]!);
    await flush();
    expect(w.ops()).toEqual([]);
    expect(n.filter((x) => x.about === 'edit')).toEqual([{ about: 'edit', code: 'not-sent', field: 'ops', why: 'gesture-expired', lost: 1 }]);
    expect(h.last().nodes.size).toBe(0);
    expect(s.status()).toMatchObject({ keep: 'saved', pending: 0 });
    await flush(DIM_LIVE_TIMEOUT_MS * 2);
    expect(w.ops()).toEqual([]);
  });

  it('`spent` and `replayed` from the kernel are never retried, and the rest of that action never goes out on the stamp', async () => {
    const w = world();
    const { s, h, n } = await opened(w);
    const gestureRefused = (why: string): RpcError => new RpcError({ code: 'FORBIDDEN', reason: 'ungranted', message: 'x', next: [], data: { needs: 'gesture', why } });
    h.edit([rect(1)], press());
    await flush();
    w.ops()[0]!.reject(gestureRefused('replayed'));
    await flush(DIM_LIVE_TIMEOUT_MS * 3);
    expect(w.ops()).toHaveLength(1);
    expect(n).toEqual([{ about: 'edit', code: 'gesture-refused', field: 'ops', why: 'replayed', lost: 1 }]);
    expect(h.last().nodes.size).toBe(0);
    // a three-row action: the first row lands, the second is refused `spent`, the third is never sent
    const big = Array.from({ length: 9 }, (_, i) => text(10 + i, 3900));
    h.edit(big, press());
    await flush(DIM_SEND_LIMITS.gapMs);
    expect(s.status().pending).toBe(3);
    w.answer(w.ops()[1]!);
    await flush(DIM_SEND_LIMITS.gapMs * 2);
    expect(w.ops()).toHaveLength(3);
    w.ops()[2]!.reject(gestureRefused('spent'));
    await flush(DIM_LIVE_TIMEOUT_MS * 3);
    expect(w.ops()).toHaveLength(3);
    expect(n[1]).toMatchObject({ code: 'gesture-refused', why: 'spent' });
    expect(n).toHaveLength(2);
    expect(s.status()).toMatchObject({ pending: 0, keep: 'saved' });
    expect(h.last().nodes.size).toBe((w.ops()[1]!.args.ops as unknown[]).length);
    // every row of the action rode the same stamp number
    expect(new Set(w.ops().slice(1).map((c) => (c.args.gesture as { n: number }).n)).size).toBe(1);
  });

  it('a batch the mod refuses rolls back: re-rendered from view(), ONE notice naming field and code as data', async () => {
    const w = world();
    const { s, h, n } = await opened(w);
    h.edit([rect(1)], press());
    await flush();
    expect(h.last().nodes.size).toBe(1);
    w.ops()[0]!.resolve({ result: { ok: false, code: 'ops-refused', fix: 'x', refused: [{ index: 0, field: 'id', code: 'id-reused' }] } });
    await flush();
    expect(h.last().nodes.size).toBe(0);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ about: 'edit', field: 'id', why: 'ops-refused', lost: 1 });
    expect(s.status()).toMatchObject({ keep: 'saved', pending: 0, canUndo: false });
  });

  it('no answer and no row: the batch is dropped at the timeout by the ONE timer, with a notice', async () => {
    const w = world();
    const { s, h, n } = await opened(w);
    h.edit([rect(1)], press());
    await flush(DIM_LIVE_TIMEOUT_MS - 1);
    expect(s.status().pending).toBe(1);
    await flush(2);
    expect(s.status()).toMatchObject({ pending: 0, keep: 'saved' });
    expect(n).toEqual([{ about: 'edit', code: 'timeout', field: 'ops', why: 'no-ack', lost: 1 }]);
    expect(h.last().nodes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a row of the same principal from ANOTHER connection does not confirm my batch (Session.connId is passed to DimLive)', async () => {
    const w = world();
    const { s, h } = await opened(w);
    h.edit([rect(1)], press());
    await flush();
    w.append(DIM_KINDS.op, { dim: DIM, ops: [rect(1)] }, 'conn:other-tab');
    expect(s.status()).toMatchObject({ pending: 1, inFlight: true });
    const mine = w.append(DIM_KINDS.op, { dim: DIM, ops: [{ type: 'update', id: ULID(1), patch: { w: 11 } }] });
    w.ops()[0]!.resolve({ result: { ok: true, dim: DIM, seq: mine.seq, applied: 1, refused: [] } });
    await flush();
    expect(s.status().pending).toBe(0);
  });
});

describe('#gui-dim-session undo', () => {
  it('Cmd+Z sends the inverse through the same path on its own stamp; a multi-row action is undone in one step; redo is said, not sent', async () => {
    const w = world({ auto: true });
    const { s, h, n } = await opened(w);
    h.edit([rect(1)], press());
    await flush(200);
    const clean = dimHash(w.store.stateAt(DIM));
    const big = Array.from({ length: 9 }, (_, i) => text(10 + i, 3900));
    h.edit(big, press('paste'));
    await flush(1000);
    expect(s.status()).toMatchObject({ pending: 0, canUndo: true });
    expect(w.ops()).toHaveLength(4);
    expect(s.view().nodes.size).toBe(10);
    h.undoKey();
    await flush(200);
    expect(w.ops()).toHaveLength(5);
    expect((w.ops()[4]!.args.ops as DimOp[]).map((o) => o.type)).toEqual(Array(9).fill('delete'));
    expect((w.ops()[4]!.args.gesture as { kind: string }).kind).toBe('key');
    expect(dimHash(w.store.stateAt(DIM))).not.toBe(''); // the fold moved; the marks are those before the paste
    expect([...s.view().nodes.keys()]).toEqual([ULID(1)]);
    expect([...w.store.stateAt(DIM).nodes.keys()]).toEqual([...foldDim(w.store.rows(DIM)).nodes.keys()]);
    h.undoKey();
    await flush(200);
    expect(s.view().nodes.size).toBe(0);
    expect(clean).not.toBe(dimHash(w.store.stateAt(DIM)));
    h.undoKey(true);
    expect(n[n.length - 1]).toMatchObject({ about: 'undo', code: 'redo-unavailable' });
    h.undoKey(false, press('keydown', { repeat: true }));
    expect(n[n.length - 1]).toMatchObject({ about: 'undo', code: 'not-sent' });
    await flush(200);
    expect(w.ops()).toHaveLength(6);
  });
});

describe('#gui-dim-session link and lifecycle', () => {
  it('link down: sending stops, a new edit is refused and put back, pending rolls back at the timeout, the leaf forgets its copy; there is no offline queue', async () => {
    const w = world();
    const { s, h, n } = await opened(w);
    const leaf = { destroy: vi.fn(), forget: vi.fn() };
    s.bindLeaf(leaf);
    h.edit([rect(1)], press());
    await flush();
    h.edit([rect(2)], press());
    w.sessions.linkDown();
    expect(leaf.forget).toHaveBeenCalledTimes(1);
    expect(s.status()).toMatchObject({ keep: 'not-saved', link: 'down', pending: 2 });
    expect(n).toEqual([{ about: 'link', code: 'link-down', field: 'ops', why: null, lost: 0 }]);
    h.edit([rect(3)], press());
    expect(n[1]).toEqual({ about: 'edit', code: 'link-down', field: 'ops', why: null, lost: 1 });
    expect(h.last().nodes.has(ULID(3))).toBe(false);
    await flush(DIM_LIVE_TIMEOUT_MS + 100);
    expect(s.status()).toMatchObject({ keep: 'saved', link: 'down', pending: 0 });
    expect(h.last().nodes.size).toBe(0);
    expect(n.slice(2).map((x) => x.code)).toEqual(['link-down', 'link-down']);
    expect(w.ops()).toHaveLength(1); // the second batch never went
    expect(leaf.destroy).not.toHaveBeenCalled();
  });

  it('reconnect: every session is destroyed and built again (a new DimLive, the leaf destroyed, no undo carried over), and NO command is sent', async () => {
    const w = world({ auto: true });
    const { s, h } = await opened(w);
    const leaf = { destroy: vi.fn(), forget: vi.fn() };
    s.bindLeaf(leaf);
    h.edit([rect(1)], press());
    await flush(200);
    expect(s.status().canUndo).toBe(true);
    const sent = w.calls.length;
    w.sessions.linkDown();
    const client2 = { call: vi.fn(() => new Promise(() => undefined)) };
    const [t] = w.sessions.connect({ client: client2 as never, principal: ME, connId: 'conn:B' });
    expect(t).not.toBe(s);
    expect(s.alive).toBe(false);
    expect(leaf.destroy).toHaveBeenCalledTimes(1);
    expect(h.listening()).toBe(false);
    expect(w.events.map((e) => e.type)).toEqual(['opened', 'destroyed', 'opened', 'rebuilt']);
    expect(w.events[1]).toMatchObject({ type: 'destroyed', why: 'link' });
    expect(w.sessions.get(DIM)).toBe(t);
    expect(t!.status()).toMatchObject({ phase: 'open', link: 'up', keep: 'saved', canUndo: false, verified: true });
    expect(dimHash(t!.view())).toBe(dimHash(w.store.stateAt(DIM)));
    await flush(1000);
    expect(w.calls).toHaveLength(sent);
    expect(client2.call).not.toHaveBeenCalled();
    expect(w.store.stats().pinned).toBe(1);
    // the new session sends on the NEW client, and its stamp numbering starts again at 1
    const h2 = fakeHandle();
    t!.attachHandle(h2.handle);
    h2.edit([rect(2)], press());
    await flush();
    expect(client2.call).toHaveBeenCalledTimes(1);
    expect((client2.call.mock.calls[0] as unknown as [string, { args: { gesture: { n: number } } }])[1].args.gesture.n).toBe(1);
    // an old handle's edit reaches nothing
    h.edit([rect(3)], press());
    s.edit([rect(3)], press());
    await flush();
    expect(client2.call).toHaveBeenCalledTimes(1);
  });

  it('cursor-epoch: reset() empties the DimStore and destroys every session and its leaf', async () => {
    const w = world({ auto: true });
    const { s } = await opened(w);
    const leaf = { destroy: vi.fn() };
    s.bindLeaf(leaf);
    expect(w.store.has(DIM)).toBe(true);
    w.sessions.reset();
    expect(w.store.has(DIM)).toBe(false);
    expect(w.store.stats()).toMatchObject({ dims: 0, pinned: 0 });
    expect(s.alive).toBe(false);
    expect(leaf.destroy).toHaveBeenCalledTimes(1);
    expect(w.sessions.list()).toEqual([]);
    expect(w.events[w.events.length - 1]).toMatchObject({ type: 'destroyed', why: 'reset' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fold: dim.close goes after what is pending has settled, on the fold press; the session is destroyed and unpinned; with no stamp it stays', async () => {
    const w = world();
    const { s, h, n } = await opened(w);
    expect(await s.fold(null)).toBe(false);
    expect(n[0]).toMatchObject({ about: 'close', code: 'not-sent' });
    h.edit([rect(1)], press());
    await flush();
    const done = s.fold(press('keydown'));
    await flush(100);
    expect(s.status().phase).toBe('closing');
    expect(w.calls.map((c) => c.commandId)).toEqual(['dim.open', 'dim.op']);
    w.answer(w.ops()[0]!);
    await flush(100);
    expect(w.calls.map((c) => c.commandId)).toEqual(['dim.open', 'dim.op', 'dim.close']);
    w.answer(w.calls[2]!);
    expect(await done).toBe(true);
    expect(s.alive).toBe(false);
    expect(s.status().phase).toBe('closed');
    expect(w.store.stats().pinned).toBe(0);
    expect(w.events[w.events.length - 1]).toMatchObject({ type: 'destroyed', why: 'fold' });
    expect(w.sessions.get(DIM)).toBeNull();
  });

  it('a dimension switch: one handle per dimension, the old session and leaf go, edits to the old one reach nothing', async () => {
    const w = world({ auto: true });
    const a = await opened(w, DIM);
    const leaf = { destroy: vi.fn() };
    a.s.bindLeaf(leaf);
    a.s.destroy('switch');
    expect(leaf.destroy).toHaveBeenCalledTimes(1);
    const b = await opened(w, DIM2);
    const before = w.calls.length;
    a.h.edit([rect(1)], press());
    a.s.edit([rect(1)], press());
    await flush(200);
    expect(w.calls).toHaveLength(before);
    b.h.edit([rect(2)], press());
    await flush(200);
    expect(w.ops().map((c) => c.args.dim)).toEqual([DIM2]);
    expect(a.s.leafOptions().view()).toBeNull();
    // a leaf bound to a dead session is destroyed at once
    const late = { destroy: vi.fn() };
    a.s.bindLeaf(late);
    expect(late.destroy).toHaveBeenCalledTimes(1);
  });

  it('the leaf wiring: view() is the same view the handle is rendered from, and onOps goes to the same sender', async () => {
    const w = world({ auto: true });
    const { s, h } = await opened(w);
    const o = s.leafOptions();
    o.onOps([rect(1)], press('paste'));
    expect(dimHash(o.view()!)).toBe(dimHash(h.last()));
    await flush(200);
    expect(w.ops()).toHaveLength(1);
    expect((w.ops()[0]!.args.gesture as { kind: string }).kind).toBe('paste');
    expect(o.mint()).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe('#gui-dim-session the shared send limiter', () => {
  it('the limiter alone: never two slots closer than the gap, never more than perWindow in any window, under the host limit', () => {
    expect(DIM_SEND_LIMITS.perWindow).toBeLessThan(DIM_SEND_LIMITS.hostPerSecond);
    const l = new DimSendLimiter();
    const at: number[] = [];
    for (let i = 0; i < 200; i++) at.push(l.reserve(0));
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(DIM_SEND_LIMITS.gapMs);
    for (const t of at) expect(at.filter((x) => x >= t && x < t + DIM_SEND_LIMITS.windowMs).length).toBeLessThanOrEqual(DIM_SEND_LIMITS.perWindow);
    // an idle limiter gives a slot at once
    expect(l.reserve(at[at.length - 1]! + 5000)).toBe(at[at.length - 1]! + 5000);
  });

  it('two open dimensions share it: 60 edits on each, as fast as the page can make them, stay under the host limit together', async () => {
    const w = world({ auto: true });
    const a = await opened(w, DIM);
    const b = await opened(w, DIM2);
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      // each waits for the last to be confirmed, so nothing coalesces: one command per edit
      a.h.edit([rect(100 + i)], press());
      b.h.edit([rect(300 + i)], press());
      await flush(1);
      while (a.s.status().pending > 0 || b.s.status().pending > 0) await flush(5);
    }
    const sent = w.ops().map((c) => c.at - t0);
    expect(sent).toHaveLength(120);
    for (const t of sent) expect(sent.filter((x) => x >= t && x < t + 1000).length).toBeLessThanOrEqual(DIM_SEND_LIMITS.perWindow);
    expect(new Set(w.ops().map((c) => c.args.dim))).toEqual(new Set([DIM, DIM2]));
    expect(a.s.view().nodes.size + b.s.view().nodes.size).toBe(120);
    process.stdout.write(`limiter: 120 commands over two dimensions in ${sent[sent.length - 1]! - sent[0]!} ms of the injected clock; the busiest second held ${Math.max(...sent.map((t) => sent.filter((x) => x >= t && x < t + 1000).length))}\n`);
  });
});
