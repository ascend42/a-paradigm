/**
 * #dimension-mod S1.4 (spec §12.7): the agent tools `dim-view` and `dim-draw`, the write grants, `dim.select`,
 * `dim.check`, the per-turn budget, the op id, the split and the count row, cancel, and the append budget. The REAL
 * mod tree runs as a child under the real ModHost with an in-memory log behind the real mod bridge
 * (test/dimension-helpers.ts). Tools are reached through `ModHost.callTool` with a whole `toolRelayedFor`, which is
 * what the bridge (P2) passes; G-DDL-03 and G-DDL-09 are checked here at the mod.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_AUX_KINDS, DIM_KINDS, dimHash, foldDimGrants, type DimState } from '@a-company/gnomon-contracts';
import { hostDir } from '../src/kernel/modhost/state.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { DIMENSION, DIMENSION_TREE, dimId, fakeLog, installDimension, rectOp, ulid } from './dimension-helpers.js';
import { host, rig as modRig } from './mod-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const REPO = 'repo:0123456789abcdef';
const REPOS: Record<string, string> = { [A]: REPO, [B]: REPO };
const HUMAN = 'p:00000000/founder';
const GUI = { principal: HUMAN, connId: 'conn:01JTESTGUI000000000000000', surface: 'gui' as const, principalClass: 'human' };
const CLI = { principal: HUMAN, connId: 'conn:01JTESTCLI000000000000000', surface: 'cli' as const, principalClass: 'human' };

type Res = Record<string, unknown> & { ok?: boolean; code?: string; seq?: number; hash?: string; grants?: Array<{ hsid: string; write: boolean }> };

/** The host-known value of a session's agent, as the bridge builds it. */
const agentOf = (hsid: string, turn = 1, agent = 'claude'): Record<string, string> => ({
  principal: `p:00000000/s-${hsid.slice(-8).toLowerCase()}`,
  surface: 'bridge',
  agent,
  hsid,
  turn: `turn:${hsid}/${turn}`,
});

async function toolRig(opts: { now?: () => number; callTimeoutMs?: number } = {}) {
  const r = modRig();
  cleanups.push(r.cleanup);
  installDimension(r);
  const log = fakeLog(opts.now ? { now: opts.now } : {});
  const stateFile = path.join(hostDir(r.home, DIMENSION), 'state.db');
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: opts.callTimeoutMs ?? 30_000, focusRepo: (hsid) => REPOS[hsid] ?? null });
  cleanups.push(() => h.stopAll());
  await h.start(DIMENSION);
  const run = async (commandId: string, args: Record<string, unknown>, hsid: string | null = A, who: Record<string, unknown> = GUI): Promise<Res> =>
    (await h.relayCommand({ name: DIMENSION, commandId, args: hsid ? { ...args, focus: { hsid } } : args, ...(who as typeof GUI) })) as Res;
  const tool = async (name: 'dim-view' | 'dim-draw', input: unknown, rf: Record<string, string> = agentOf(A)): Promise<Res> =>
    (await h.callTool(DIMENSION, name, input, { hsid: rf.hsid, toolRelayedFor: rf as never })) as Res;
  const restart = async (): Promise<void> => {
    await h.stop(DIMENSION);
    await h.start(DIMENSION);
  };
  const state = (): Record<string, unknown> => (fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>) : {});
  const dropState = async (keep: (k: string) => boolean): Promise<void> => {
    await h.stop(DIMENSION);
    const s = state();
    for (const k of Object.keys(s)) if (!keep(k)) delete s[k];
    fs.writeFileSync(stateFile, JSON.stringify(s));
    await h.start(DIMENSION);
  };
  /** A row written into the log by someone other than this mod (a forged or replayed row, for the fold tests). */
  const inject = (kind: string, payload: Record<string, unknown>): number => log.inject(kind, payload);
  const rowsOf = (kind: string) => log.rows.filter((x) => x.kind === kind);
  return { r, h, log, run, tool, restart, state, dropState, inject, rowsOf };
}
type Rig = Awaited<ReturnType<typeof toolRig>>;

/** A board opened by A, with B attached. */
async function board(w: Rig, n = 1): Promise<string> {
  const dim = dimId(n);
  expect(await w.run('dim.open', { dim, title: 'Plan', opened: 'command' })).toMatchObject({ ok: true });
  expect(await w.run('dim.attach', { dim }, B)).toMatchObject({ ok: true });
  return dim;
}

const loadModel = async () => (await import(pathToFileURL(path.join(DIMENSION_TREE, 'model.mjs')).href)) as Record<string, (...a: unknown[]) => unknown>;

describe('#dimension-mod write grants (S1.4 §4.3; Aegis M4, M9, M10)', () => {
  it('dim.open answers the effective grant map: the opener may draw, a later attached session may not', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = dimId(1);
    const opened = await w.run('dim.open', { dim, title: 'Plan', opened: 'command' });
    expect(opened.grants).toEqual([{ hsid: A, write: true }]);
    // M10: attaching a session writes no grant row
    await w.run('dim.attach', { dim }, B);
    expect(w.rowsOf(DIM_AUX_KINDS.grant)).toHaveLength(0);
    const re = await w.run('dim.open', { dim, opened: 'menu' });
    expect(re.grants).toEqual([
      { hsid: A, write: true },
      { hsid: B, write: false },
    ]);
  });

  it('dim.grant writes one gui-stamped row for the attached focus and answers the map the mod now enforces', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const on = await w.run('dim.grant', { dim, write: true }, B);
    expect(on).toMatchObject({ ok: true, dim });
    expect(on.grants).toEqual([
      { hsid: A, write: true },
      { hsid: B, write: true },
    ]);
    const off = await w.run('dim.grant', { dim, write: false }, A);
    expect(off.grants).toEqual([
      { hsid: A, write: false },
      { hsid: B, write: true },
    ]);
    const rows = w.rowsOf(DIM_AUX_KINDS.grant);
    expect(rows.map((x) => x.payload)).toEqual([
      { v: 1, dim, hsid: B, write: true, relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } },
      { v: 1, dim, hsid: A, write: false, relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } },
    ]);
    // the page's fold of the same rows says the same (one shared fold)
    const page = foldDimGrants(rows.map((x) => ({ seq: x.seq, kind: x.kind, payload: x.payload })), dim);
    expect([...page.entries()].map(([k, g]) => [k, g.write])).toEqual([
      [B, true],
      [A, false],
    ]);
  });

  it('refused: an unattached target, a write that is not a boolean, a cli or agent caller, an ended board; none writes a row', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = dimId(1);
    await w.run('dim.open', { dim, title: 'Plan', opened: 'command' });
    expect(await w.run('dim.grant', { dim, write: true }, B)).toMatchObject({ ok: false, code: 'not-attached' });
    await w.run('dim.attach', { dim }, B);
    for (const write of ['true', 1, null, undefined]) expect(await w.run('dim.grant', { dim, write }, B)).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await w.run('dim.grant', { dim, write: true }, B, CLI)).toMatchObject({ ok: false, code: 'not-human-gui' });
    await w.run('dim.close', { dim });
    expect(await w.run('dim.grant', { dim, write: true }, B)).toMatchObject({ ok: false, code: 'dim-ended' });
    expect(w.rowsOf(DIM_AUX_KINDS.grant)).toHaveLength(0);
  });

  it('a cold open folds the grant rows from the log (the pages read the grant kind), with no state at all', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.grant', { dim, write: true }, B);
    await w.run('dim.grant', { dim, write: false }, A);
    await w.dropState(() => false);
    const re = await w.run('dim.open', { dim, opened: 'menu' });
    expect(re.grants).toEqual([
      { hsid: A, write: false },
      { hsid: B, write: true },
    ]);
  });

  it('M4: a grant row in the log not stamped by a person on the window (bridge, voice, cli, an agent, unstamped) changes nothing', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const forged = [
      { principal: 'p:00000000/s-zzzzzzzb', surface: 'bridge', agent: 'claude', hsid: B },
      { principal: 'p:00000000/s-zzzzzzzb', surface: 'voice', agent: 'claude', hsid: B },
      { principal: HUMAN, surface: 'cli' },
      { principal: HUMAN, surface: 'gui', agent: 'claude' },
      undefined,
    ];
    for (const rf of forged) w.inject(DIM_AUX_KINDS.grant, { v: 1, dim, hsid: B, write: true, ...(rf ? { relayedFor: rf } : {}) });
    await w.dropState(() => false);
    expect((await w.run('dim.open', { dim, opened: 'menu' })).grants).toEqual([
      { hsid: A, write: true },
      { hsid: B, write: false },
    ]);
  });

  it('the keyframe (v 2) carries the grant map and op-id memo, is bound to its log id, and a v 1 keyframe is ignored, never read as "no grants"', async () => {
    const m = await loadModel();
    const state: DimState = { dim: 'dim:x', title: 't', attached: [A, B], ended: false, nodes: new Map(), gone: new Set(), seq: 9, ops: 0, unapplied: 0 };
    const grants = new Map([
      [B, { write: true, seq: 7 }],
      ['__proto__', { write: true, seq: 8 }],
    ]);
    const oids = new Map([['0123456789abcdef', { applied: 3, seq: 9 }]]);
    const enc = m.encodeKeyframe!(state, 'log:a', { grants, oids }) as { head: Record<string, unknown>; chunks: unknown[] };
    expect(enc.head.v).toBe(2);
    const dec = m.decodeKeyframe!(enc.head, enc.chunks, 'dim:x', 'log:a') as { state: DimState; grants: Map<string, unknown>; oids: Map<string, unknown> };
    expect(dimHash(dec.state)).toBe(dimHash(state));
    expect([...dec.grants.entries()]).toEqual([...grants.entries()]);
    expect(dec.grants.get('__proto__')).toEqual({ write: true, seq: 8 });
    expect([...dec.oids.entries()]).toEqual([...oids.entries()]);
    // another log: refused whole, grants included
    expect(m.decodeKeyframe!(enc.head, enc.chunks, 'dim:x', 'log:b')).toBeNull();
    // a changed grant breaks the sum
    const aux = enc.head.aux as { grants: unknown[][] };
    const flipped = { ...enc.head, aux: { ...aux, grants: aux.grants.map((g) => [g[0], !g[1], g[2]]) } };
    expect(m.decodeKeyframe!(flipped, enc.chunks, 'dim:x', 'log:a')).toBeNull();
    // a v 1 keyframe (S1.3) is ignored
    const { aux: _aux, ...v1 } = enc.head;
    expect(m.decodeKeyframe!({ ...v1, v: 1 }, enc.chunks, 'dim:x', 'log:a')).toBeNull();
  });

  it('a restarted mod opens from the keyframe written at a grant and still knows the grant', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.grant', { dim, write: true }, B);
    const head = w.state()[`kf:${dim.slice(4)}`] as { v: number; aux: { grants: unknown[] } };
    expect(head.v).toBe(2);
    expect(head.aux.grants).toEqual([[B, true, w.rowsOf(DIM_AUX_KINDS.grant)[0]!.seq]]);
    await w.restart();
    const re = await w.run('dim.open', { dim, opened: 'menu' });
    expect(re).toMatchObject({ ok: true });
    expect(re.grants).toEqual([
      { hsid: A, write: true },
      { hsid: B, write: true },
    ]);
  });
});


describe('#dimension-mod dim.select, dim.check and the hash on a dim.op answer (S1.4 §2, §5; Aegis C2.6)', () => {
  it('dim.op answers the hash of the fold at its seq', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const res = await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
    expect(res).toMatchObject({ ok: true, applied: 2 });
    expect(res.hash).toBe(dimHash(w.log.fold(dim)));
  });

  it('dim.check answers {seq, hash} at the latest row and writes nothing; it reads rows the mod did not answer for', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)] });
    const before = w.log.rows.length;
    const at = await w.run('dim.check', { dim });
    expect(at).toEqual({ ok: true, dim, seq: w.log.fold(dim).seq, hash: dimHash(w.log.fold(dim)) });
    // a row the mod's fold has not seen (another writer, or a reply it lost): the check reads the log to its head
    w.inject(DIM_KINDS.op, { v: 1, dim, ops: [rectOp(9)], relayedFor: { principal: 'p:00000000/s-zzzzzzzb', surface: 'bridge', agent: 'claude', hsid: B } });
    const after = await w.run('dim.check', { dim });
    expect(after.seq).toBe(w.log.fold(dim).seq);
    expect(after.hash).toBe(dimHash(w.log.fold(dim)));
    expect(w.log.rows.length).toBe(before + 1);
    // a command like every other: a person on the window, an attached session
    expect(await w.run('dim.check', { dim }, A, CLI)).toMatchObject({ ok: false, code: 'not-human-gui' });
  });

  it('dim.select keeps ids in memory only (no row, no state key), refuses a bad id or an unattached focus, and is empty after a restart', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const rows = w.log.rows.length;
    const keys = Object.keys(w.state()).sort();
    expect(await w.run('dim.select', { dim, ids: [ulid(1), ulid(2), ulid(1)] })).toEqual({ ok: true, dim, selected: 2 });
    expect(await w.run('dim.select', { dim, ids: ['nope'] })).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await w.run('dim.select', { dim, ids: Array.from({ length: 65 }, (_, i) => ulid(i)) })).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await w.run('dim.select', { dim, ids: [ulid(1)] }, A, CLI)).toMatchObject({ ok: false, code: 'not-human-gui' });
    expect(w.log.rows.length).toBe(rows);
    expect(Object.keys(w.state()).sort()).toEqual(keys);
    expect(JSON.stringify(w.state())).not.toContain(ulid(2));
  });
});

describe('#dimension-mod dim-view (S1.4 §2; G-DDL-03 view row; Aegis A3)', () => {
  it('defaults to the board this session opened last, appends nothing, every node carries its bounded by, carried fields are absent, strokes are a count and a box', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.op', {
      dim,
      ops: [rectOp(1, { label: 'auth' }), { type: 'add', node: { id: ulid(2), kind: 'stroke', x: 10, y: 20, z: 'W', points: [0, 0, 5, 9, -3, 4] } }],
    });
    // a carried-through field in a stored row (a later writer) is never shown
    w.inject(DIM_KINDS.op, { v: 1, dim, ops: [{ type: 'add', node: { id: ulid(3), kind: 'rect', x: 1, y: 1, z: 'X', w: 2, h: 2, future: 'carried' } }], relayedFor: { principal: HUMAN, surface: 'gui' } });
    await w.restart();
    const rows = w.log.rows.length;
    const v = await w.tool('dim-view', {});
    expect(v).toMatchObject({ v: 1, dim, title: 'Plan', open: true, mayDraw: true, budgetLeft: 64, selection: [] });
    expect(v.hash).toBe(dimHash(w.log.fold(dim)));
    expect(v.seq).toBe(w.log.fold(dim).seq);
    const nodes = v.nodes as Array<Record<string, unknown>>;
    expect(nodes.map((n) => n.id)).toEqual([ulid(1), ulid(2), ulid(3)]);
    for (const n of nodes) expect(n.by).toEqual({ cls: 'human', principal: HUMAN });
    expect(JSON.stringify(v)).not.toContain('carried');
    expect(nodes[1]).toMatchObject({ kind: 'stroke', points: 3, box: { x: 7, y: 20, w: 8, h: 9 } });
    expect(w.log.rows.length).toBe(rows);
    // B is attached but has no grant: it still views, and is told it may not draw
    const vb = await w.tool('dim-view', { dim }, agentOf(B));
    expect([vb.code, vb.mayDraw, vb.budgetLeft]).toEqual([undefined, false, 64]);
  });

  it('limit and truncated; since answers the change entries and only the touched live nodes; out of range is a reset', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const first = await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2), rectOp(3)] });
    const second = await w.run('dim.op', { dim, ops: [{ type: 'move', ids: [ulid(1)], dx: 1, dy: 1 }, { type: 'delete', id: ulid(2) }, rectOp(4)] });
    const lim = await w.tool('dim-view', { dim, limit: 2 });
    expect((lim.nodes as unknown[]).length).toBe(2);
    expect(lim.truncated).toEqual({ nodes: 3 });
    const ch = await w.tool('dim-view', { dim, since: first.seq });
    expect(ch.changes).toEqual([{ seq: second.seq, by: { cls: 'human', principal: HUMAN }, added: [ulid(4)], updated: [], moved: [ulid(1)], deleted: [ulid(2)] }]);
    expect((ch.nodes as Array<{ id: string }>).map((n) => n.id).sort()).toEqual([ulid(1), ulid(4)].sort());
    expect((await w.tool('dim-view', { dim, since: second.seq })).changes).toEqual([]);
    expect((await w.tool('dim-view', { dim, since: second.seq + 50 })).changes).toBe('reset');
    // more than a page of the log (the fake scans 10,000 rows a page) is a reset with the full view
    w.log.pad(20_000);
    await w.run('dim.op', { dim, ops: [rectOp(5)] });
    const far = await w.tool('dim-view', { dim, since: first.seq });
    expect(far.changes).toBe('reset');
    expect((far.nodes as unknown[]).length).toBe(4);
  });

  it('selection is the caller\'s own hsid\'s only (A3), from dim.select', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
    await w.run('dim.select', { dim, ids: [ulid(1)] }, A);
    await w.run('dim.select', { dim, ids: [ulid(2)] }, B);
    expect((await w.tool('dim-view', {}, agentOf(A))).selection).toEqual([ulid(1)]);
    expect((await w.tool('dim-view', { dim }, agentOf(B))).selection).toEqual([ulid(2)]);
    await w.restart();
    expect((await w.tool('dim-view', {}, agentOf(A))).selection).toEqual([]);
  });

  it('refusals: no open board, not attached, an unknown key, a bad dim, since or limit, a stamp that is not a whole agent, a turn of another session', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    expect(await w.tool('dim-view', {})).toMatchObject({ ok: false, code: 'no-open-dim' });
    const dim = dimId(1);
    await w.run('dim.open', { dim, title: 'Plan', opened: 'command' });
    expect(await w.tool('dim-view', { dim }, agentOf(B))).toMatchObject({ ok: false, code: 'not-attached' });
    expect(await w.tool('dim-view', {}, agentOf(B))).toMatchObject({ ok: false, code: 'no-open-dim' });
    for (const bad of [{ hsid: B }, { dim: 'dim:nope' }, { since: -1 }, { since: 1.5 }, { limit: 0 }, { limit: 501 }, { by: { cls: 'human' } }, ['x'], 'x']) {
      const res = await w.tool('dim-view', bad);
      expect([JSON.stringify(bad), res.ok, ['args-bad', 'dim-bad'].includes(res.code as string)]).toEqual([JSON.stringify(bad), false, true]);
    }
    const whole = agentOf(A);
    for (const rf of [{ ...whole, surface: 'gui' }, { ...whole, agent: 'bad label!' }, { ...whole, principal: 'p:EVIL' }, (({ agent: _a, ...x }) => x)(whole), (({ hsid: _h, ...x }) => x)(whole)]) expect((await w.tool('dim-view', {}, rf as Record<string, string>)).code).toBe('not-agent-tool');
    expect((await w.tool('dim-view', {}, { ...whole, turn: `turn:${B}/1` })).code).toBe('no-turn');
    expect((await w.tool('dim-view', {}, (({ turn: _t, ...x }) => x)(whole) as Record<string, string>)).code).toBe('no-turn');
  });
});
