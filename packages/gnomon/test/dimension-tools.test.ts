/**
 * #dimension-mod S1.4 (spec §12.7): the agent tools `dim-view` and `dim-draw`, the write grants, `dim.select`,
 * `dim.check`, the per-turn budget, the op id, the split and the count row, cancel, and the append budget. The REAL
 * mod tree runs as a child under the real ModHost with an in-memory log behind the real mod bridge
 * (test/dimension-helpers.ts). Tools are reached through `ModHost.callTool` with a whole `toolRelayedFor`, which is
 * what the bridge (P2) passes; G-DDL-03 and G-DDL-09 are checked here at the mod.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_AUX_KINDS, DIM_KINDS, dimHash, foldDimGrants, type DimState } from '@a-company/gnomon-contracts';
import { hostDir } from '../src/kernel/modhost/state.js';
import { unsandboxedModLauncher, withPinTablesForTest } from '../src/kernel/testing.js';
import { PKG_ROOT } from './helpers.js';
import { DIMENSION, DIMENSION_TREE, dimId, fakeLog, installDimension, installTree, rectOp, ulid } from './dimension-helpers.js';
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

async function toolRig(opts: { now?: () => number; callTimeoutMs?: number; launcher?: typeof unsandboxedModLauncher } = {}) {
  const r = modRig();
  cleanups.push(r.cleanup);
  installDimension(r);
  const log = fakeLog(opts.now ? { now: opts.now } : {});
  const stateFile = path.join(hostDir(r.home, DIMENSION), 'state.db');
  const { h } = host(r, { launcher: opts.launcher ?? unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: opts.callTimeoutMs ?? 30_000, focusRepo: (hsid) => REPOS[hsid] ?? null });
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

const ops = (n: number, from = 1, more: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => rectOp(from + i, more));
/** Text marks that need four rows of about 15 KiB: the whole per-call byte budget of one draw. */
const fullDraw = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'add', node: { id: ulid(500 + i), kind: 'text', x: i, y: i, z: 'V', text: 'plan the auth handoff step by step '.repeat(26) } }));
const opRows = (w: Rig) => w.rowsOf(DIM_KINDS.op);
const countRows = (w: Rig) => w.rowsOf(DIM_AUX_KINDS.drawRefused);

describe('#dimension-mod dim-draw: G-DDL-03 at the mod (S1.4 §2, §3)', () => {
  it('an agent adds 3 marks: one row, the nodes fold agent from the host stamp, created has the 3 ids (minted, new:<key> and given)', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const res = await w.tool('dim-draw', {
      ops: [
        { type: 'add', node: { id: 'new:box', kind: 'rect', x: 0, y: 0, w: 10, h: 10 } },
        { type: 'add', node: { kind: 'text', x: 0, y: 20, text: 'note' } },
        { type: 'add', node: { id: ulid(7), kind: 'arrow', x: 0, y: 0, z: 'k', points: [0, 0, 5, 5], from: 'new:box' } },
      ],
    });
    expect(res).toMatchObject({ ok: true, dim, applied: 3, refused: [], budgetLeft: 61 });
    expect(opRows(w)).toHaveLength(1);
    const created = res.created as Array<{ index: number; key?: string; id: string }>;
    expect(created.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(created[0]!.key).toBe('box');
    expect(created[2]!.id).toBe(ulid(7));
    const f = w.log.fold(dim);
    for (const c of created) expect(f.nodes.get(c.id)!.by).toEqual({ cls: 'agent', principal: agentOf(A).principal, agent: 'claude' });
    // new:<key> resolved to the minted id; the stored op has exactly the op keys (no sugar stored)
    expect(f.nodes.get(ulid(7))!.node.from).toBe(created[0]!.id);
    expect(JSON.stringify(opRows(w)[0]!.payload)).not.toContain('new:');
    expect(res.hash).toBe(dimHash(f));
    // an add with no z is placed on top
    const zs = created.map((c) => f.nodes.get(c.id)!.node.z as string);
    expect(zs[1]! > zs[0]!).toBe(true);
  });

  it('contrast (S1.4 P0b, Aegis F1): an agent\'s refused pair gets the validator\'s contrast sentence naming ink, and none of its input', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.grant', { dim, write: true }, A);
    const res = await w.tool('dim-draw', { ops: [rectOp(1, { color: 'custom:#858585', fill: 'cobalt' })] }, agentOf(A));
    expect(res.refused).toEqual([{ index: 0, field: 'color', code: 'colour-bad', fix: "It would not show against this mark's fill: use ink, or a line with at least 3:1 against the fill in both themes." }]);
    expect(JSON.stringify(res)).not.toMatch(/858585|cobalt/i);
    expect(w.log.fold(dim).nodes.has(ulid(1))).toBe(false);
  });

  it('edit-anything (S1.4 E0): an agent updates, moves and deletes a person\'s mark and another agent\'s mark', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.grant', { dim, write: true }, B);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(3)] });
    const mine = await w.tool('dim-draw', { ops: [rectOp(2)] }, agentOf(B));
    expect(mine).toMatchObject({ applied: 1 });
    const before = opRows(w).length;
    for (const op of [{ type: 'update', id: ulid(1), patch: { label: 'x' } }, { type: 'move', ids: [ulid(1)], dx: 1, dy: 1 }, { type: 'update', id: ulid(2), patch: { label: 'from A' } }, { type: 'delete', id: ulid(3) }]) {
      const res = await w.tool('dim-draw', { ops: [op] }, agentOf(A));
      expect([res.ok, res.applied]).toEqual([true, 1]);
    }
    expect(opRows(w)).toHaveLength(before + 4);
    const f = w.log.fold(dim);
    const x0 = (rectOp(1) as { node: { x: number; y: number } }).node;
    expect(f.nodes.get(ulid(1))!.node).toMatchObject({ label: 'x', x: x0.x + 1, y: x0.y + 1 });
    expect(f.nodes.get(ulid(1))!.by.cls).toBe('human');
    // attribution (outside the hash): the person's mark names the agent that changed it; B's mark names A
    const handA = { cls: 'agent', principal: agentOf(A).principal, agent: 'claude' };
    expect([f.nodes.get(ulid(1))!.otherBy, f.nodes.get(ulid(1))!.changedBy, f.nodes.get(ulid(1))!.wordsBy]).toEqual([handA, handA, handA]);
    expect(f.nodes.get(ulid(2))!.node.label).toBe('from A');
    expect(f.nodes.get(ulid(2))!.otherBy).toEqual(handA);
    expect(f.nodes.has(ulid(3))).toBe(false);
    expect((await w.tool('dim-draw', { ops: [{ type: 'update', id: ulid(2), patch: { label: 'mine' } }] }, agentOf(B))).applied).toBe(1);
  });

  it('G-DDL-09: link, by, relayedFor and an unknown field are refused by name; identity in input changes nothing', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    for (const [extra, field] of [[{ link: 'x' }, 'unknown'], [{ by: { cls: 'human', principal: HUMAN } }, 'unknown'], [{ relayedFor: { surface: 'gui' } }, 'unknown'], [{ colour: 'red' }, 'unknown']] as const) {
      const res = await w.tool('dim-draw', { ops: [rectOp(1, extra)] });
      expect(res.refused).toEqual([{ index: 0, field, code: 'field-unknown', fix: expect.any(String) }]);
    }
    // identity anywhere in input: refused as an unknown top-level key, or ignored; the row's hand is the stamp's
    expect((await w.tool('dim-draw', { ops: [rectOp(1)], hsid: B, principal: HUMAN })).code).toBe('args-bad');
    const ok = await w.tool('dim-draw', { ops: [{ type: 'add', node: { id: ulid(2), kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 } }] });
    expect(ok.applied).toBe(1);
    expect(opRows(w).at(-1)!.payload.relayedFor).toEqual(agentOf(A));
    expect(w.log.fold(dim).nodes.get(ulid(2))!.by.cls).toBe('agent');
    // A5: a voice stamp folds agent too, and gets the same refusals
    const voice = { ...agentOf(A), surface: 'voice' };
    expect((await w.tool('dim-draw', { ops: [rectOp(1, { link: 'x' })] }, voice)).refused).toEqual((await w.tool('dim-draw', { ops: [rectOp(1, { link: 'x' })] })).refused);
  });

  it('65 ops in one call: too-many-ops and no row; a 64-op batch over one row lands as several rows in order, all folded', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const many = await w.tool('dim-draw', { ops: ops(65) });
    expect([many.ok, many.code, (many.refused as Array<{ code: string }>)[0]!.code]).toEqual([false, 'ops-refused', 'too-many-ops']);
    expect(opRows(w)).toHaveLength(0);
    const big = await w.tool('dim-draw', { ops: ops(64, 100, { label: 'x'.repeat(190) }) });
    expect(big).toMatchObject({ ok: true, applied: 64, refused: [] });
    const rows = opRows(w);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(rows.flatMap((r) => (r.payload.ops as Array<{ node: { id: string } }>).map((o) => o.node.id))).toEqual(ops(64, 100).map((o) => (o.node as { id: string }).id));
    expect(w.log.fold(dim).nodes.size).toBe(64);
  });

  it('a secret in op 60 of 64: no op row at all, one count row of closed keys', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const batch = ops(64);
    batch[59] = { type: 'add', node: { id: ulid(60), kind: 'text', x: 0, y: 0, z: 'V', text: 'key AKIAIOSFODNN7EXAMPLE' } };
    const res = await w.tool('dim-draw', { ops: batch });
    expect([res.ok, res.code]).toEqual([false, 'secret']);
    expect(opRows(w)).toHaveLength(0);
    expect(countRows(w)).toHaveLength(1);
    expect(countRows(w)[0]!.payload).toEqual({ v: 1, dim, n: 1, by: { 'text|secret': 1 }, relayedFor: agentOf(A) });
    expect(JSON.stringify(countRows(w))).not.toContain('AKIA');
  });

  it('M8: 40 ops then 40 in the same turn: 24 applied, 16 turn-budget; a new turn resets; an older turn has nothing left', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    expect((await w.tool('dim-draw', { ops: ops(40, 1) }, agentOf(A, 3))).applied).toBe(40);
    const second = await w.tool('dim-draw', { ops: ops(40, 100) }, agentOf(A, 3));
    expect([second.applied, second.budgetLeft]).toEqual([24, 0]);
    expect((second.refused as Array<{ code: string; index: number }>).map((r) => [r.index, r.code])).toEqual(Array.from({ length: 16 }, (_, i) => [24 + i, 'turn-budget']));
    expect(await w.tool('dim-draw', { ops: ops(1, 300) }, agentOf(A, 3))).toMatchObject({ ok: false, code: 'turn-budget', budgetLeft: 0 });
    expect((await w.tool('dim-draw', { ops: ops(1, 300) }, agentOf(A, 4))).applied).toBe(1);
    expect(await w.tool('dim-draw', { ops: ops(1, 301) }, agentOf(A, 2))).toMatchObject({ ok: false, code: 'turn-budget' });
  });

  it('M8: the charge is written before the first row: a mod killed after the charge has less budget after its restart', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    // the append fails: the charge stands (never refunded), as it would after a crash between charge and append
    w.log.failAppends = 1;
    const res = await w.tool('dim-draw', { ops: ops(10) });
    expect([res.ok, res.code]).toEqual([false, 'append-failed']);
    expect(opRows(w)).toHaveLength(0);
    await w.restart();
    expect((await w.tool('dim-view', {})).budgetLeft).toBe(54);
    expect(w.state().turns).toEqual([[A, 1, 10, 1]]);
  });

  it('M8: 17 sessions drawing do not reset the first one\'s count (the state is keyed by hsid)', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.tool('dim-draw', { ops: ops(60) });
    const s = w.state();
    // 17 more sessions charged in this turn, written as the mod writes them
    const others = Array.from({ length: 17 }, (_, i) => [`hsid:v1:01HZZZZZZZZZZZZZZZZZZZZ${String(i).padStart(3, '0')}`, 1, 5, 0]);
    await w.dropState(() => true);
    s.turns = [...(s.turns as unknown[]), ...others];
    await w.h.stop(DIMENSION);
    fs.writeFileSync(path.join(hostDir(w.r.home, DIMENSION), 'state.db'), JSON.stringify(s));
    await w.h.start(DIMENSION);
    expect((await w.tool('dim-view', { dim })).budgetLeft).toBe(4);
  });

  it('A8: the same opId and input once: one set of rows, repeat: true, budget charged once; other input: op-id-reused', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    const first = await w.tool('dim-draw', { ops: ops(3), opId: 'draw-1' });
    const again = await w.tool('dim-draw', { ops: ops(3), opId: 'draw-1' });
    expect(again).toMatchObject({ ok: true, applied: 3, repeat: true, budgetLeft: 61, seq: first.seq });
    expect(opRows(w)).toHaveLength(1);
    expect(await w.tool('dim-draw', { ops: ops(2, 50), opId: 'draw-1' })).toMatchObject({ ok: false, code: 'op-id-reused' });
    expect(opRows(w)).toHaveLength(1);
    expect(await w.tool('dim-draw', { ops: ops(1), opId: 'bad id!' })).toMatchObject({ ok: false, code: 'op-id-bad' });
  });

  it('A8: after memory and keyframe are gone, an oid found in the rows never appends again, whatever the input', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    await w.tool('dim-draw', { ops: ops(3), opId: 'draw-1' });
    // memory (restart) and every keyframe gone; the index stays (a tool never adopts a dimension, I-1)
    await w.dropState((k) => !k.startsWith('kf:'));
    const res = await w.tool('dim-draw', { ops: ops(5, 40), opId: 'draw-1' });
    expect(res).toMatchObject({ ok: true, repeat: true, applied: 3, inputUnknown: true, created: [] });
    // F3: the answer says the ops were never compared, and to view the board
    expect(res.fix).toMatch(/not compared and nothing was written\. Use dim-view/);
    expect(opRows(w)).toHaveLength(1);
  });

  it('A8: a draw cut short (2 of 4 rows landed) answers a repeat counting only the rows that carry its oid, and never appends the rest', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    let n = 0;
    w.log.afterAppend = (row) => {
      if (row.kind === DIM_KINDS.op && ++n === 2) w.log.failAppends = 1;
    };
    const big = ops(64, 100, { label: 'x'.repeat(190) });
    const cut = await w.tool('dim-draw', { ops: big, opId: 'big-1' });
    expect(cut.ok).toBe(true);
    const landedOps = opRows(w).reduce((a, r) => a + (r.payload.ops as unknown[]).length, 0);
    expect(cut.applied).toBe(landedOps);
    w.log.afterAppend = null;
    await w.restart();
    const re = await w.tool('dim-draw', { ops: big, opId: 'big-1' });
    expect(re).toMatchObject({ ok: true, repeat: true, applied: landedOps });
    expect(opRows(w).reduce((a, r) => a + (r.payload.ops as unknown[]).length, 0)).toBe(landedOps);
  });

  it('A8: actor, attached, ended and grant run before the memo: a revoked session gets its refusal, not the stored answer', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.tool('dim-draw', { ops: ops(2), opId: 'once' });
    await w.run('dim.grant', { dim, write: false }, A);
    expect(await w.tool('dim-draw', { ops: ops(2), opId: 'once' })).toMatchObject({ ok: false, code: 'write-not-granted' });
  });

  it('A8: the model\'s opId reaches no row, refusal, state key or keyframe', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const marker = 'MARKERopId0123456789';
    await w.tool('dim-draw', { ops: ops(3), opId: marker });
    await w.tool('dim-draw', { ops: ops(1, 90, { link: 'x' }), opId: `${marker}2` });
    const refusedRes = await w.tool('dim-draw', { ops: ops(2, 50), opId: marker });
    await w.run('dim.close', { dim });
    expect(JSON.stringify(w.log.rows)).not.toContain('MARKER');
    expect(JSON.stringify(refusedRes)).not.toContain('MARKER');
    expect(JSON.stringify(w.state())).not.toContain('MARKER');
    expect(opRows(w)[0]!.payload.oid).toMatch(/^[0-9a-f]{16}$/);
  });

  it('grant off, then on, then revoked: write-not-granted, applied, write-not-granted', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    expect(await w.tool('dim-draw', { ops: ops(1) }, agentOf(B))).toMatchObject({ ok: false, code: 'write-not-granted' });
    await w.run('dim.grant', { dim, write: true }, B);
    expect((await w.tool('dim-draw', { ops: ops(1) }, agentOf(B))).applied).toBe(1);
    await w.run('dim.grant', { dim, write: false }, B);
    expect(await w.tool('dim-draw', { ops: ops(1, 5) }, agentOf(B))).toMatchObject({ ok: false, code: 'write-not-granted' });
  });

  it('M9: revoked after row 2 of 4: rows 3 and 4 never land and are listed write-not-granted', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    let n = 0;
    w.log.afterAppend = (row) => {
      if (row.kind === DIM_KINDS.op && ++n === 2) w.inject(DIM_AUX_KINDS.grant, { v: 1, dim, hsid: A, write: false, relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
    };
    const res = await w.tool('dim-draw', { ops: fullDraw(60) });
    expect(opRows(w)).toHaveLength(2);
    const landedOps = opRows(w).reduce((a, r) => a + (r.payload.ops as unknown[]).length, 0);
    expect(res.applied).toBe(landedOps);
    const refused = res.refused as Array<{ index: number; code: string }>;
    expect(refused.length).toBe(60 - landedOps);
    expect(refused.every((r) => r.code === 'write-not-granted')).toBe(true);
    // the plan was four rows: the two that never landed are the revoked ones
    expect(refused.map((r) => r.index)).toEqual(Array.from({ length: 60 - landedOps }, (_, i) => landedOps + i));
  });

  it('not attached; ended; no open dimension: not-attached; dim-ended; no-open-dim', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    expect(await w.tool('dim-draw', { ops: ops(1) })).toMatchObject({ code: 'no-open-dim' });
    const dim = dimId(1);
    await w.run('dim.open', { dim, title: 'Plan', opened: 'command' });
    expect(await w.tool('dim-draw', { dim, ops: ops(1) }, agentOf(B))).toMatchObject({ code: 'not-attached' });
    await w.run('dim.close', { dim });
    expect(await w.tool('dim-draw', { ops: ops(1) })).toMatchObject({ code: 'dim-ended' });
    expect(opRows(w)).toHaveLength(0);
  });

  it('the count row: closed keys from hostile field names, at most 8 per hsid and turn, and it still fits beside a full 4-row draw', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    const hostile = await w.tool('dim-draw', { ops: [rectOp(1, { ['__proto__x']: 1, 'text|secret': 2, constructor: 3 })] });
    expect(hostile.ok).toBe(false);
    expect(Object.keys(countRows(w)[0]!.payload.by as object)).toEqual(['unknown|field-unknown']);
    for (let i = 0; i < 10; i++) await w.tool('dim-draw', { ops: [rectOp(1, { link: 'x' })] });
    expect(countRows(w)).toHaveLength(8);
    // a new turn: a full draw (4 rows of 16 KiB) with one refusal still writes its count row
    const res = await w.tool('dim-draw', { ops: [...fullDraw(60), rectOp(1, { link: 'x' })] }, agentOf(A, 2));
    expect(res.ok).toBe(true);
    expect(opRows(w).length).toBe(4);
    expect(countRows(w)).toHaveLength(9);
  });
});

describe('#dimension-mod M4: a tool call writes two kinds only', () => {
  it('source: the tool path reaches only appendTool, whose allowlist is the op and draw.refused kinds', () => {
    const src = fs.readFileSync(path.join(DIMENSION_TREE, 'index.mjs'), 'utf8');
    const from = src.indexOf('async function runTool(');
    const to = src.indexOf('/* ── host → mod');
    expect(from).toBeGreaterThan(0);
    const tools = src.slice(from, to);
    expect(tools.match(/\bappend\(host/g)).toHaveLength(1); // inside appendTool only
    expect(/\bwrite\(/.test(tools)).toBe(false);
    for (const k of ['DIM_KINDS.start', 'DIM_KINDS.attach', 'DIM_KINDS.end', 'DIM_AUX_KINDS.grant']) expect(tools.includes(k)).toBe(false);
    expect(tools).toContain('const TOOL_KINDS = Object.freeze([DIM_KINDS.op, DIM_AUX_KINDS.drawRefused]);');
    expect(tools).toMatch(/async function appendTool\(host, kind, payload\) \{\n\s+if \(!TOOL_KINDS\.includes\(kind\)\) return null;/);
  });

  it('behaviour: no tool input yields a start, attach, end or grant row', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const before = w.log.rows.length;
    const hostile: unknown[] = [
      { ops: [{ type: 'start' }] },
      { ops: [{ type: 'attach', hsid: B }] },
      { ops: [{ type: 'end' }] },
      { ops: [{ type: 'grant', hsid: B, write: true }] },
      { ops: [{ type: 'add', node: { kind: DIM_AUX_KINDS.grant, x: 0, y: 0 } }] },
      { ops: [], kind: DIM_KINDS.end },
    ];
    for (const input of hostile) await w.tool('dim-draw', input);
    for (const input of hostile) await w.tool('dim-view', input);
    const kinds = new Set(w.log.rows.slice(before).map((r) => r.kind));
    expect([...kinds].every((k) => k === DIM_AUX_KINDS.drawRefused)).toBe(true);
    expect(w.log.fold(dim).attached).toEqual([A, B]);
  });
});

/** A 10,048-node board written straight into the log (157 human op rows), then a cold mod. */
async function bigBoard(w: Rig): Promise<string> {
  const dim = await board(w);
  for (let r = 0; r < 157; r++) w.inject(DIM_KINDS.op, { v: 1, dim, ops: ops(64, 1000 + r * 64), relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
  await w.restart();
  return dim;
}

describe('#dimension-mod M3: cancel is honoured, so an agent cannot take the board down', () => {
  it('a tool call held past the timeout is cancelled between log pages: no child restart, and a person\'s dim.op sent next succeeds', { timeout: 60_000 }, async () => {
    const w = await toolRig({ callTimeoutMs: 1_500 });
    const dim = await board(w);
    w.log.pad(200_000); // the cold open needs 21 pages of the log
    await w.run('dim.op', { dim, ops: [rectOp(1)] });
    await w.restart();
    w.log.readDelayMs = 150;
    const started = performance.now();
    const err = await w.tool('dim-view', {}).then(
      () => null,
      (e: { modCode?: string; detail?: { honoured?: boolean } }) => e,
    );
    expect(err).toMatchObject({ modCode: 'TIMEOUT', detail: { honoured: true } });
    // margin (Probe): the timeout is 1,500 ms and the grace 500 ms, so an honoured cancel answers in about
    // 1,500 to 1,650 ms (one 150 ms page at most); the bound is the timeout plus the grace
    expect(performance.now() - started).toBeLessThan(1_500 + 500);
    expect(w.r.events.filter((e) => e.kind === 'mod.health' && (e.payload as { why?: string }).why === 'cancel-timeout')).toHaveLength(0);
    w.log.readDelayMs = 0;
    expect(await w.run('dim.op', { dim, ops: [rectOp(2)] })).toMatchObject({ ok: true, applied: 1 });
  });

  it('the worst accepted input on a 10,048-node board answers inside the 5 s timeout; 4,096 ids do not fit the 64 KiB call and are refused before the validator', { timeout: 120_000 }, async () => {
    const w = await toolRig({ callTimeoutMs: 5_000 });
    await bigBoard(w);
    await w.tool('dim-view', { limit: 1 }); // the cold open of 157 rows is its own call
    const moves = (per: number) => Array.from({ length: 64 }, (_, i) => ({ type: 'move', ids: Array.from({ length: per }, (_, j) => ulid(1000 + i * 64 + j)), dx: 1, dy: 1 }));
    expect(await w.tool('dim-draw', { ops: moves(64) })).toMatchObject({ ok: false, code: 'call-too-large' });
    // 64 moves of 32 ids (2,048 strings, about 62 KiB) is the most that fits one call
    const started = performance.now();
    const res = await w.tool('dim-draw', { ops: moves(32) });
    const ms = performance.now() - started;
    // every move names a person's marks: an agent may edit any mark (S1.4 E0), so all 64 moves apply in one validation
    // 63 of them fill the call's 4 rows of 16 KiB; the 64th is refused call-too-large by index, never half-written
    expect(res).toMatchObject({ ok: true, applied: 63 });
    expect((res.refused as Array<{ index: number; code: string }>).map((r) => [r.index, r.code])).toEqual([[63, 'call-too-large']]);
    expect(ms).toBeLessThan(5_000);
  });
});

describe('#dimension-mod A4: a host APPEND_BUDGET refusal is a definite "not written" (REAL-WINDOW clock)', () => {
  it('two sessions drawing in the same second: the second is refused append-busy (tool-rows), the fold is kept (no cold re-read), and a person still draws', { timeout: 60_000 }, async () => {
    // the real monotonic clock: with the default test clock (a second per append) the budget never binds
    const w = await toolRig({ now: () => performance.now() });
    const dim = await board(w);
    await w.run('dim.grant', { dim, write: true }, B);
    await new Promise((res) => setTimeout(res, 1_100)); // the window is empty
    // one full draw: 4 op rows and its count row are the whole tool share of 5 rows a second
    const first = await w.tool('dim-draw', { ops: [...fullDraw(60), rectOp(1, { link: 'x' })] });
    expect(first.ok).toBe(true);
    expect(opRows(w)).toHaveLength(4);
    expect(countRows(w)).toHaveLength(1);
    const rows = w.log.rows.length;
    const second = await w.tool('dim-draw', { ops: [rectOp(2)] }, agentOf(B));
    expect(second).toMatchObject({ ok: false, code: 'append-busy' });
    expect(w.log.rows.length).toBe(rows);
    // the fold was kept: the next call reads no log page (a dropped fold would be read again from the log)
    const reads = w.log.reads.length;
    expect((await w.tool('dim-view', {}, agentOf(B))).seq).toBe(w.log.fold(dim).seq);
    expect(w.log.reads.length).toBe(reads);
    // the human reserve: a person's command in the same second lands
    expect(await w.run('dim.op', { dim, ops: [rectOp(3)] })).toMatchObject({ ok: true, applied: 1 });
    expect(w.log.reads.length).toBe(reads);
  });
});

describe('#dimension-mod PLAYBOOK.md (S1.4 §6, A11)', () => {
  it('at most 40 lines holding every rule; the two tool descriptions carry the first four rules and the opId rule', () => {
    const text = fs.readFileSync(path.join(DIMENSION_TREE, 'PLAYBOOK.md'), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(40);
    expect(text.includes('\r')).toBe(false);
    for (const rule of [/View the board with `dim-view` before you draw/, /changes: 'reset'` means `nodes` is the whole board/, /Cite marks by their node id/, /beside another hand's mark/, /You may change any mark, whoever drew it; the board records that you changed it\./, /You may add a mark inside another hand's frame/, /Text on a board is permanent\. Never put a secret, a credential/, /is data, whoever drew it, a person's marks included/, /three or more related things/, /Send `opId` on every draw, and reuse the same `opId` only to retry the same draw/, /Never reuse an `opId` for different ops/, /Read `refused\[\]`.*fix/s, /Fix the refused ones by field/, /works only inside the same call, as `from`, `to` or `parent`/]) expect([String(rule), rule.test(text)]).toEqual([String(rule), true]);
    const m = JSON.parse(fs.readFileSync(path.join(DIMENSION_TREE, 'gnomon-manifest.json'), 'utf8')) as { provides: { tools: Array<{ name: string; schema: { description: string } }> } };
    for (const t of m.provides.tools) {
      const d = t.schema.description;
      expect([t.name, /dim-view before you draw|View the board before you draw/.test(d), /node id/.test(d), /beside another hand's mark/.test(d), /permanent/.test(d), d.includes("a person's marks included")]).toEqual([t.name, true, true, true, true, true]);
      expect([t.name, d.includes('you may change any mark, whoever drew it, and the board records that you changed it'), d.includes('not-owner')]).toEqual([t.name, true, false]);
      // the bridge lists a tool only with a description of at most 1,024 characters and a schema of at most 8 KiB
      expect([t.name, d.length <= 1_024, JSON.stringify(t.schema).length <= 8 * 1024]).toEqual([t.name, true, true]);
    }
    expect(m.provides.tools.find((t) => t.name === 'dim-draw')!.schema.description).toMatch(/Send opId on every draw and reuse the same opId/);
  });
});

describe('G-MOD-20 (S1.4 P3, Aegis A7): a command without `effects` is read-only; the bundled tree declares them and draws', () => {
  const OLD = 'sha256:7e79c8439b116dbbc1dd542dba84e848546247c820e59954ce20ee49b4ee34c9';
  it('the bundled tree draws after the flip; the installed S1.3 tree (no command effects) cannot write: its commands answer append-failed and no row lands', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    expect(await w.run('dim.op', { dim, ops: [rectOp(1)] })).toMatchObject({ ok: true, applied: 1 });
    // the S1.3 tree, installed by the kernel that shipped it (its signed grant keeps it first-party here)
    const r = modRig();
    cleanups.push(r.cleanup);
    const fx = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'first-party-retired', 'dimension-1.0.0.json'), 'utf8')) as { files: Record<string, string> };
    const dir = path.join(r.root, 'old', 'dimension');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(fx.files)) fs.writeFileSync(path.join(dir, name), text);
    withPinTablesForTest((t) => {
      t.firstParty.add(OLD);
      t.retired.delete(OLD);
    }, () => installTree(r, dir, DIMENSION));
    const log = fakeLog();
    const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: 30_000, focusRepo: (hsid) => REPOS[hsid] ?? null });
    cleanups.push(() => h.stopAll());
    await h.start(DIMENSION);
    const res = (await h.relayCommand({ name: DIMENSION, commandId: 'dim.open', args: { dim, title: 'Plan', opened: 'command', focus: { hsid: A } }, ...GUI })) as Res;
    expect(res).toMatchObject({ ok: false, code: 'append-failed' });
    expect(log.rows).toEqual([]);
    expect(r.events.some((e) => e.kind === 'mod.effect.refused')).toBe(true);
  });
});

describe('S1.4 P3 review, Aegis Important (I-1, I-2, I-4)', () => {
  it('I-1: a tool naming a well-formed dimension this home does not know is refused dim-unknown with ZERO log pages read (tools never adopt)', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    w.log.pad(50_000);
    const reads = w.log.reads.length;
    for (let i = 0; i < 5; i++) {
      expect(await w.tool('dim-view', { dim: dimId(900 + i) })).toMatchObject({ ok: false, code: 'dim-unknown' });
      expect(await w.tool('dim-draw', { dim: dimId(900 + i), ops: ops(1) })).toMatchObject({ ok: false, code: 'dim-unknown' });
    }
    expect(w.log.reads.length).toBe(reads);
  });

  it('I-2: a budget refusal (written: false) refunds the turn: agent B refused append-busy in A\'s second keeps 64, and its retry after the window applies', { timeout: 60_000 }, async () => {
    const w = await toolRig({ now: () => performance.now() });
    const dim = await board(w);
    await w.run('dim.grant', { dim, write: true }, B);
    await new Promise((res) => setTimeout(res, 1_100));
    expect((await w.tool('dim-draw', { ops: [...fullDraw(60), rectOp(1, { link: 'x' })] })).ok).toBe(true);
    const busy = await w.tool('dim-draw', { ops: ops(64, 2000) }, agentOf(B));
    expect(busy).toMatchObject({ ok: false, code: 'append-busy', budgetLeft: 64 });
    await new Promise((res) => setTimeout(res, 1_100));
    expect(await w.tool('dim-draw', { ops: ops(64, 2000) }, agentOf(B))).toMatchObject({ ok: true, applied: 64, budgetLeft: 0 });
  });

  it('I-2: a revoke between rows refunds the rows never written; a failed (unknown) append is never refunded', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    let n = 0;
    w.log.afterAppend = (row) => {
      if (row.kind === DIM_KINDS.op && ++n === 2) w.inject(DIM_AUX_KINDS.grant, { v: 1, dim, hsid: A, write: false, relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
    };
    const res = await w.tool('dim-draw', { ops: fullDraw(60) });
    expect(res.budgetLeft).toBe(64 - (res.applied as number));
  });
});

/** Agent-owned marks written straight into the log: 32 rows of 64 rects stamped as A's agent. */
function agentRows(w: Rig, dim: string, from: number, rowsN: number): void {
  for (let r = 0; r < rowsN; r++) w.inject(DIM_KINDS.op, { v: 1, dim, ops: ops(64, from + r * 64), relayedFor: agentOf(A) });
}

describe('I-4: the worst ACCEPTED and APPLIED draws on a 10,048-node board answer inside the 5 s timeout', () => {
  it('64 moves of 32 agent-owned ids (63 fit one call and apply), then text adds at the text limit filling one call, both applied', { timeout: 180_000 }, async () => {
    const w = await toolRig({ callTimeoutMs: 5_000 });
    const dim = await board(w);
    for (let r = 0; r < 125; r++) w.inject(DIM_KINDS.op, { v: 1, dim, ops: ops(64, 100_000 + r * 64), relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
    agentRows(w, dim, 1000, 32);
    await w.restart();
    await w.tool('dim-view', { limit: 1 });
    expect(w.log.fold(dim).nodes.size).toBe(125 * 64 + 32 * 64);
    const moves = Array.from({ length: 64 }, (_, i) => ({ type: 'move', ids: Array.from({ length: 32 }, (_, j) => ulid(1000 + i * 32 + j)), dx: 1, dy: 1 }));
    let t = performance.now();
    const moved = await w.tool('dim-draw', { ops: moves });
    // the 64th move does not fit the 64 KiB call less the count-row reserve: it is refused call-too-large by index
    expect([moved.ok, moved.applied, performance.now() - t < 5_000]).toEqual([true, 63, true]);
    expect(moved.refused).toEqual([{ index: 63, field: 'op', code: 'call-too-large', fix: expect.any(String) }]);
    // text at the limit (4,000 characters of plain words): 15 are sent, 12 fit the 64 KiB call less the reserve
    const words = 'board notes on the auth handoff '.repeat(125);
    const texts = Array.from({ length: 15 }, (_, i) => ({ type: 'add', node: { kind: 'text', x: i, y: i, text: words } }));
    t = performance.now();
    const drawn = await w.tool('dim-draw', { ops: texts }, agentOf(A, 2));
    expect([drawn.ok, drawn.applied, performance.now() - t < 5_000]).toEqual([true, 12, true]);
  });
});

describe('S1.4 P3 review, Probe (F1 to F4) and the kept probe attacks', () => {
  it('F1, M8 under a REAL crash: the child is killed right after its first op row lands; the charge survives (budgetLeft 54, exactly one op row)', { timeout: 60_000 }, async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gdim-pid-')), 'pid');
    // the launcher seam: the child writes its own pid before the mod loads (no POSIX tool, works on every OS)
    const launcher = (i: Parameters<typeof unsandboxedModLauncher>[0]) => {
      const p = unsandboxedModLauncher(i);
      return { ...p, args: ['--import', `data:text/javascript,import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`, ...p.args] };
    };
    const w = await toolRig({ launcher });
    await board(w);
    w.log.afterAppend = (row) => {
      if (row.kind !== DIM_KINDS.op) return;
      w.log.afterAppend = null;
      process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
    };
    await w.tool('dim-draw', { ops: ops(10) }).catch(() => null);
    await w.h.stop(DIMENSION).catch(() => undefined);
    await w.h.start(DIMENSION);
    expect(opRows(w)).toHaveLength(1);
    expect((await w.tool('dim-view', {})).budgetLeft).toBe(54);
    expect(w.state().turns).toEqual([[A, 1, 10, 0]]);
  });

  it('F2: 100 dim.check calls on an unchanged 10,048-node fold take under 1 s in all (the hash is computed once per fold)', { timeout: 120_000 }, async () => {
    const w = await toolRig();
    const dim = await bigBoard(w);
    await w.run('dim.check', { dim });
    const t = performance.now();
    for (let i = 0; i < 100; i++) expect((await w.run('dim.check', { dim })).ok).toBe(true);
    expect(performance.now() - t).toBeLessThan(1_000);
  });

  it('F4: a new:<key> not defined earlier in the call is refused with its own fix, never the ULID sentence', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    const res = await w.tool('dim-draw', {
      ops: [
        { type: 'add', node: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, parent: 'new:later' } },
        { type: 'add', node: { id: 'new:later', kind: 'frame', x: 0, y: 0, w: 5, h: 5 } },
        { type: 'delete', id: 'new:later' },
      ],
    });
    const refused = res.refused as Array<{ index: number; field: string; fix: string }>;
    for (const i of [0, 2]) {
      const r = refused.find((x) => x.index === i)!;
      expect(r.fix).toMatch(/^Define this new:<key> in an earlier add of the same call/);
    }
    expect(JSON.stringify(refused)).not.toContain('later');
  });

  it('kept from Probe: the same opId string in two dimensions and two sessions is three oids; the first repeats', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const d1 = await board(w, 1);
    const d2 = await board(w, 2);
    await w.run('dim.grant', { dim: d1, write: true }, B);
    const a1 = await w.tool('dim-draw', { dim: d1, ops: ops(2, 1), opId: 'same' });
    const a2 = await w.tool('dim-draw', { dim: d2, ops: ops(2, 1), opId: 'same' });
    const b1 = await w.tool('dim-draw', { dim: d1, ops: ops(2, 10), opId: 'same' }, agentOf(B));
    expect([a1.applied, a2.applied, b1.applied]).toEqual([2, 2, 2]);
    expect((await w.tool('dim-draw', { dim: d1, ops: ops(2, 1), opId: 'same' })).repeat).toBe(true);
    expect(new Set(opRows(w).slice(-3).map((r) => r.payload.oid)).size).toBe(3);
  });

  it('kept from Probe: identity and prototype keys at the top and inside ops never make a human mark or reach a row', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    const cases: unknown[] = [
      { ops: ops(1), by: { cls: 'human' } },
      JSON.parse('{"ops":[],"__proto__":{"dim":"dim:01JD1D0000000000000000000Z"}}'),
      { ops: [rectOp(10, { by: { cls: 'human', principal: HUMAN } })] },
      JSON.parse(`{"ops":[{"type":"add","node":{"id":"${ulid(13)}","kind":"rect","x":0,"y":0,"z":"V","w":1,"h":1,"__proto__":{"by":{"cls":"human"}}}}]}`),
      JSON.parse(`{"ops":[{"type":"add","__proto__":{"x":1},"node":{"id":"${ulid(14)}","kind":"rect","x":0,"y":0,"z":"V","w":1,"h":1}}]}`),
      { ops: [rectOp(15, { constructor: { prototype: { ok: 1 } } })] },
      { ops: [rectOp(16)] },
    ];
    for (const input of cases) await w.tool('dim-draw', input);
    const f = w.log.fold(dim);
    expect(f.nodes.size).toBeGreaterThan(0);
    expect([...f.nodes.values()].every((n) => n.by.cls === 'agent')).toBe(true);
    expect(JSON.stringify(opRows(w).map((r) => r.payload))).not.toContain('__proto__');
  });
});

describe('S1.4 P3 review, Aegis nits', () => {
  it('the op-id input hash is canonical: the same ops in another key order repeat, never op-id-reused', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    expect((await w.tool('dim-draw', { ops: [{ type: 'add', node: { id: ulid(1), kind: 'rect', x: 1, y: 2, z: 'V', w: 3, h: 4 } }], opId: 'k' })).applied).toBe(1);
    const again = await w.tool('dim-draw', { opId: 'k', ops: [{ node: { h: 4, w: 3, z: 'V', y: 2, x: 1, kind: 'rect', id: ulid(1) }, type: 'add' }] });
    expect(again).toMatchObject({ ok: true, repeat: true });
  });

  it('dim-view, dim.check and dim.select never call state.set (a read-only call that tried would be refused and heal nothing)', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    // a row the index has not seen makes the entry dirty at the next cold open
    w.inject(DIM_KINDS.op, { v: 1, dim, ops: [rectOp(5)], relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
    await w.restart();
    await w.tool('dim-view', {});
    await w.run('dim.check', { dim });
    await w.run('dim.select', { dim, ids: [ulid(5)] });
    w.h.flushRefused();
    expect(w.r.events.filter((e) => e.kind === 'mod.effect.refused')).toEqual([]);
    // the next writing command heals the index
    expect((await w.run('dim.op', { dim, ops: [rectOp(6)] })).ok).toBe(true);
    expect((w.state()[`idx:${dim.slice(4)}`] as { lastSeq: number }).lastSeq).toBe(w.log.fold(dim).seq);
  });
});

describe('ruling on Probe Q1: an agent may add inside another hand\'s frame, and (S1.4 E0) may change the frame', () => {
  it('a child whose parent is a person\'s frame applies; the frame is unchanged by it; editing the frame applies', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [{ type: 'add', node: { id: ulid(900), kind: 'frame', x: 0, y: 0, z: 'V', w: 50, h: 50, title: 'Auth' } }] });
    const before = JSON.stringify(w.log.fold(dim).nodes.get(ulid(900)));
    const res = await w.tool('dim-draw', { ops: [{ type: 'add', node: { kind: 'rect', x: 1, y: 1, w: 5, h: 5, parent: ulid(900) } }] });
    expect(res).toMatchObject({ ok: true, applied: 1 });
    const child = (res.created as Array<{ id: string }>)[0]!.id;
    const f = w.log.fold(dim);
    expect(f.nodes.get(child)!.node.parent).toBe(ulid(900));
    expect(JSON.stringify(f.nodes.get(ulid(900)))).toBe(before);
    expect(await w.tool('dim-draw', { ops: [{ type: 'update', id: ulid(900), patch: { title: 'Mine' } }] })).toMatchObject({ ok: true, applied: 1 });
    expect(w.log.fold(dim).nodes.get(ulid(900))!.node.title).toBe('Mine');
  });
});

describe('I-3 at the mod: a resumed session continues its turn numbers, so it draws with a fresh budget', () => {
  it('drawn out at turn 40; the resumed run\'s turn 41 (the kernel continues after the last turn.sent) draws 64; turn 40 again has none', { timeout: 60_000 }, async () => {
    const w = await toolRig();
    await board(w);
    expect((await w.tool('dim-draw', { ops: ops(64, 1) }, agentOf(A, 40))).budgetLeft).toBe(0);
    await w.restart(); // the new kernel's mod: the charge is in state
    expect(await w.tool('dim-draw', { ops: ops(1, 200) }, agentOf(A, 40))).toMatchObject({ code: 'turn-budget' });
    expect(await w.tool('dim-draw', { ops: ops(64, 300) }, agentOf(A, 41))).toMatchObject({ ok: true, applied: 64 });
  });
});
