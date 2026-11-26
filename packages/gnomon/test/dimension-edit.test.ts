/**
 * #dimension-mod S1.4 E1 (spec §12.7, edit-anything): keyframe v3 with attribution, the `act` and `undo` markers,
 * change-set checkpoints and pins (G6), `dim.undo` and `dim.seen`, `base` and `changed-since`, the foreign
 * sub-budgets, `attr` beside `hash` (G7), change-set ids in `dim-view` changes. The REAL mod tree runs as a child
 * under the real ModHost with an in-memory log behind the real mod bridge (test/dimension-helpers.ts), as in
 * dimension-tools.test.ts.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, dimAttrDigest, dimHash, type DimState } from '@a-company/gnomon-contracts';
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

type Res = Record<string, unknown> & { ok?: boolean; code?: string; seq?: number; hash?: string; attr?: string };

const agentOf = (hsid: string, turn = 1, agent = 'claude'): Record<string, string> => ({
  principal: `p:00000000/s-${hsid.slice(-8).toLowerCase()}`,
  surface: 'bridge',
  agent,
  hsid,
  turn: `turn:${hsid}/${turn}`,
});

async function editRig() {
  const r = modRig();
  cleanups.push(r.cleanup);
  installDimension(r);
  const log = fakeLog();
  const stateFile = path.join(hostDir(r.home, DIMENSION), 'state.db');
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: 30_000, focusRepo: (hsid) => REPOS[hsid] ?? null });
  cleanups.push(() => h.stopAll());
  await h.start(DIMENSION);
  const run = async (commandId: string, args: Record<string, unknown>, hsid: string | null = A, who: Record<string, unknown> = GUI): Promise<Res> =>
    (await h.relayCommand({ name: DIMENSION, commandId, args: hsid ? { ...args, focus: { hsid } } : args, ...(who as typeof GUI) })) as Res;
  const tool = async (name: string, input: unknown, rf: Record<string, string> = agentOf(A)): Promise<Res> =>
    (await h.callTool(DIMENSION, name as 'dim-view', input, { hsid: rf.hsid, toolRelayedFor: rf as never })) as Res;
  const restart = async (): Promise<void> => {
    await h.stop(DIMENSION);
    await h.start(DIMENSION);
  };
  const state = (): Record<string, unknown> => (fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>) : {});
  const editState = async (f: (s: Record<string, unknown>) => void): Promise<void> => {
    await h.stop(DIMENSION);
    const s = state();
    f(s);
    fs.writeFileSync(stateFile, JSON.stringify(s));
    await h.start(DIMENSION);
  };
  const opRows = () => log.rows.filter((x) => x.kind === DIM_KINDS.op);
  return { r, h, log, run, tool, restart, state, editState, opRows };
}
type Rig = Awaited<ReturnType<typeof editRig>>;

/** A board opened by A, with B attached and allowed to draw. */
async function board(w: Rig, n = 1): Promise<string> {
  const dim = dimId(n);
  expect(await w.run('dim.open', { dim, title: 'Plan', opened: 'command' })).toMatchObject({ ok: true });
  expect(await w.run('dim.attach', { dim }, B)).toMatchObject({ ok: true });
  expect(await w.run('dim.grant', { dim, write: true }, B)).toMatchObject({ ok: true });
  return dim;
}

const loadModel = async () => (await import(pathToFileURL(path.join(DIMENSION_TREE, 'model.mjs')).href)) as Record<string, (...a: unknown[]) => unknown>;
type ViewNode = Record<string, unknown> & { id: string };
const nodeOf = (v: Res, id: string): ViewNode | undefined => (v.nodes as ViewNode[]).find((n) => n.id === id);
/** A node's attribution with the compact hand indices resolved through the answer's `hands` (S1.4 E1 item 6). */
const handsOf = (v: Res, id: string): ViewNode | undefined => {
  const n = nodeOf(v, id);
  const hands = (v.hands ?? []) as unknown[];
  if (!n) return n;
  const out: ViewNode = { ...n };
  for (const f of ['changedBy', 'otherBy', 'wordsBy']) if (typeof out[f] === 'number') out[f] = hands[out[f] as number];
  const rf = out.restoredFrom as { id: string; by: unknown } | undefined;
  if (rf && typeof rf.by === 'number') out.restoredFrom = { id: rf.id, by: hands[rf.by] };
  return out;
};

describe('#dimension-mod E1 item 1: keyframe v3 carries attribution; v2 is ignored for every attribution consumer', () => {
  it('encode/decode keeps changedBy, otherBy, wordsBy and restoredFrom; the sum and the attr digest cover them', async () => {
    const m = await loadModel();
    const human = { cls: 'human', principal: HUMAN };
    const agent = { cls: 'agent', principal: 'p:00000000/s-a', agent: 'claude' };
    const node = { node: { id: ulid(1), kind: 'rect', x: 1, y: 1, z: 'V', w: 10, h: 10 }, by: human, hsid: A, addedSeq: 2 };
    const nodes = new Map<string, unknown>([
      [ulid(1), { ...node, changedBy: agent, changedSeq: 5, changedHsid: A, otherBy: agent, otherSeq: 5, wordsBy: agent, wordsSeq: 5 }],
      [ulid(2), { ...node, node: { ...node.node, id: ulid(2) }, by: agent, restoredFrom: { id: ulid(9), by: human } }],
      [ulid(3), { ...node, node: { ...node.node, id: ulid(3) } }],
    ]);
    const state = { dim: 'dim:x', title: 't', attached: [A], ended: false, nodes, gone: new Set([ulid(9)]), seq: 9, ops: 4, unapplied: 0 } as unknown as DimState;
    const enc = m.encodeKeyframe!(state, 'log:a', { grants: new Map(), oids: new Map() }) as { head: Record<string, unknown>; chunks: unknown[][][] };
    expect(enc.head.v).toBe(3);
    expect(enc.head.attr).toBe(dimAttrDigest(state));
    const dec = m.decodeKeyframe!(enc.head, enc.chunks, 'dim:x', 'log:a') as { state: DimState };
    expect(dimHash(dec.state)).toBe(dimHash(state));
    expect(dimAttrDigest(dec.state)).toBe(dimAttrDigest(state));
    expect(dec.state.nodes.get(ulid(1))).toMatchObject({ changedBy: agent, changedSeq: 5, changedHsid: A, otherBy: agent, otherSeq: 5, wordsBy: agent, wordsSeq: 5 });
    expect(dec.state.nodes.get(ulid(2))!.restoredFrom).toEqual({ id: ulid(9), by: human });
    expect(dec.state.nodes.get(ulid(3))!.changedBy).toBeUndefined();
    // integrity covers attribution: a forged attribution field with the sum recomputed is still refused by the digest
    const forged = structuredClone(enc.chunks);
    const item = forged[0]!.find((it) => it[1] === ulid(2))!;
    (item[6] as { rf: unknown[] }).rf = [ulid(9), agent];
    const head = { ...enc.head };
    delete head.sum;
    const resum = { ...head, sum: (m.sumOf as (t: string) => string)(JSON.stringify([head, forged])) };
    expect(m.decodeKeyframe!(resum, forged, 'dim:x', 'log:a')).toBeNull();
    // and without the recomputed sum the sum refuses it
    expect(m.decodeKeyframe!(enc.head, forged, 'dim:x', 'log:a')).toBeNull();
    // an unknown attribution key, or a by without its seq, refuses the keyframe
    for (const bad of [{ zz: 1 }, { cb: agent }, { ob: agent, os: -1 }, { rf: [ulid(9)] }, {}]) {
      const c = structuredClone(enc.chunks);
      c[0]![0]![6] = bad;
      const hd = { ...enc.head };
      delete hd.sum;
      expect(m.decodeKeyframe!({ ...hd, sum: (m.sumOf as (t: string) => string)(JSON.stringify([hd, c])) }, c, 'dim:x', 'log:a')).toBeNull();
    }
    // a v2 keyframe (6-item nodes, no attr) is ignored even with a correct sum
    const v2chunks = enc.chunks.map((ch) => ch.map((it) => (it[0] === 'n' ? it.slice(0, 6) : it)));
    const { attr: _a, sum: _s, ...rest } = enc.head;
    const v2head = { ...rest, v: 2 };
    expect(m.decodeKeyframe!({ ...v2head, sum: (m.sumOf as (t: string) => string)(JSON.stringify([v2head, v2chunks])) }, v2chunks, 'dim:x', 'log:a')).toBeNull();
  });

  it('a v2 keyframe present at the head is ignored at a cold open: the view and the attr digest come from the log fold', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    const id = ulid(1);
    expect(await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'mine' })] })).toMatchObject({ ok: true });
    // agent B rewrites the person's words
    expect(await w.tool('dim-draw', { ops: [{ type: 'update', id, patch: { label: 'theirs' } }], dim }, agentOf(B))).toMatchObject({ ok: true, applied: 1 });
    const closed = await w.run('dim.close', { dim });
    expect(closed).toMatchObject({ ok: true });
    const kid = dim.slice(4);
    const v3 = w.state()[`kf:${kid}`] as Record<string, unknown>;
    expect(v3.v).toBe(3);
    const m = await loadModel();
    // the same keyframe written the S1.4 P2 way (v2): no attribution in the items, a correct v2 sum
    await w.editState((s) => {
      const chunks = (s[`kf:${kid}:0`] as unknown[][]).map((it) => (it[0] === 'n' ? it.slice(0, 6) : it));
      const { attr: _a, sum: _s, ...rest } = s[`kf:${kid}`] as Record<string, unknown>;
      const head = { ...rest, v: 2 };
      s[`kf:${kid}:0`] = chunks;
      s[`kf:${kid}`] = { ...head, sum: (m.sumOf as (t: string) => string)(JSON.stringify([head, [chunks]])) };
    });
    const readsBefore = w.log.reads.length;
    const view = await w.tool('dim-view', { dim }, agentOf(A));
    const n = handsOf(view, id)!;
    expect(n.wordsBy).toMatchObject({ cls: 'agent', agent: 'claude', principal: agentOf(B).principal });
    expect(n.otherBy).toMatchObject({ cls: 'agent' });
    // the cold open read the log from before the first row: the v2 keyframe was not trusted
    const pages = w.log.reads.slice(readsBefore).filter((p) => Array.isArray(p.kinds));
    expect(((pages[0]!.since as { seq?: number } | undefined)?.seq ?? 0) < (w.opRows()[0]!.seq as number)).toBe(true);
    // the attribution the mod now holds is the page fold's
    expect(dimAttrDigest(w.log.fold(dim))).not.toBe(dimAttrDigest({ ...w.log.fold(dim), nodes: new Map([...w.log.fold(dim).nodes].map(([k, v]) => [k, { node: v.node, by: v.by, hsid: v.hsid, addedSeq: v.addedSeq }])) }));
  });
});

describe('#dimension-mod E1 item 2: `act` on dim.op; `undo`, `restored`, `of` refused on every args and input surface (Aegis ruling 3)', () => {
  it('dim.op writes a pattern-checked act on its row, honoured as the person\'s action; a bad act is args-bad with no row', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    const act = ulid(77, '01JDAC');
    const ok = await w.run('dim.op', { dim, ops: [rectOp(1)], act });
    expect(ok).toMatchObject({ ok: true, applied: 1 });
    const row = w.opRows().at(-1)!;
    expect((row.payload as Record<string, unknown>).act).toBe(act);
    const { dimActOf, dimChangeSetOf } = await import('@a-company/gnomon-contracts');
    expect(dimActOf({ seq: row.seq, kind: row.kind, payload: row.payload })).toEqual({ principal: HUMAN, act });
    expect(dimChangeSetOf({ seq: row.seq, kind: row.kind, payload: row.payload })).toEqual({ kind: 'act', principal: HUMAN, act });
    // without act: no act key on the row
    await w.run('dim.op', { dim, ops: [rectOp(2)] });
    expect(Object.hasOwn(w.opRows().at(-1)!.payload as object, 'act')).toBe(false);
    const before = w.opRows().length;
    for (const bad of ['01jdac0000000000000000000x', 'x', 7, null, { act }, [act], `${act}0`]) expect(await w.run('dim.op', { dim, ops: [rectOp(3)], act: bad })).toMatchObject({ ok: false, code: 'args-bad' });
    expect(w.opRows()).toHaveLength(before);
  });

  it('undo, restored and of are refused on dim.op args, dim-draw and dim-view input, and inside an op or a node; no row is written', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)] });
    const before = w.log.rows.length;
    const marker = { of: { principal: HUMAN, act: ulid(5, '01JDAC') }, restored: [[ulid(8), ulid(1), { cls: 'human', principal: HUMAN }]] };
    const extras: Record<string, unknown> = { undo: marker, restored: marker.restored, of: marker.of };
    for (const [k, v] of Object.entries(extras)) {
      // 1. dim.op args
      expect([k, await w.run('dim.op', { dim, ops: [rectOp(2)], [k]: v })]).toMatchObject([k, { ok: false, code: 'args-bad' }]);
      // 2. dim-draw input (and dim-view input)
      expect([k, await w.tool('dim-draw', { dim, ops: [rectOp(2)], [k]: v }, agentOf(B))]).toMatchObject([k, { ok: false, code: 'args-bad' }]);
      expect([k, await w.tool('dim-view', { dim, [k]: v }, agentOf(B))]).toMatchObject([k, { ok: false, code: 'args-bad' }]);
      // 3. inside an op, and inside a node
      const inOp = { ...rectOp(2), [k]: v };
      const inNode = { type: 'add', node: { ...(rectOp(2).node as object), [k]: v } };
      for (const op of [inOp, inNode, { type: 'update', id: ulid(1), patch: { [k]: v } }]) {
        const viaCommand = await w.run('dim.op', { dim, ops: [op] });
        expect(viaCommand).toMatchObject({ ok: false, code: 'ops-refused' });
        expect((viaCommand.refused as Array<{ code: string }>)[0]!.code).toBe('field-unknown');
        const viaTool = await w.tool('dim-draw', { dim, ops: [op] }, agentOf(B));
        expect(viaTool).toMatchObject({ ok: false, code: 'ops-refused' });
        expect((viaTool.refused as Array<{ code: string }>).some((r) => r.code === 'field-unknown')).toBe(true);
      }
    }
    // no op row at all (dim-draw's refusals write count rows only, and those carry closed keys)
    expect(w.log.rows.slice(before).filter((x) => x.kind === DIM_KINDS.op)).toHaveLength(0);
    for (const x of w.log.rows.slice(before)) expect(JSON.stringify(x.payload)).not.toContain('"undo"');
  });

  it('an act sent on dim-draw input never reaches a row (tool rows carry v, dim, ops and oid only)', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    expect(await w.tool('dim-draw', { dim, ops: [rectOp(1)], act: ulid(5, '01JDAC') }, agentOf(B))).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await w.tool('dim-draw', { dim, ops: [rectOp(1)] }, agentOf(B))).toMatchObject({ ok: true });
    expect(Object.keys(w.opRows().at(-1)!.payload as object).sort()).toEqual(['dim', 'ops', 'relayedFor', 'v']);
  });
});

const turnOf = (hsid: string, n: number) => ({ hsid, turn: `turn:${hsid}/${n}` });
/** Agent `hsid` draws in its turn `n` (session B may draw: board() granted it). */
const draw = (w: Rig, dim: string, hsid: string, n: number, ops: unknown[]) => w.tool('dim-draw', { dim, ops }, agentOf(hsid, n));
const textOp = (n: number, text: string) => ({ type: 'add', node: { id: ulid(n), kind: 'text', x: n, y: n, z: 'V', text } });

describe('#dimension-mod E1 items 3 and 4: dim.undo of a held change-set (Arky §3.1-§3.3; Aegis G3, G5, ruling 4)', () => {
  it('a person undoes an agent turn: field-level, the delete re-added under a new id with restoredFrom, the add removed; the answer is {ok, seq, hash, attr, applied, skipped}', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'one' }), rectOp(2), textOp(3, 'note')] });
    const t = await draw(w, dim, B, 1, [
      { type: 'update', id: ulid(1), patch: { label: 'ONE', color: 'cobalt' } },
      { type: 'move', ids: [ulid(2)], dx: 50, dy: 0 },
      { type: 'delete', id: ulid(3) },
      rectOp(4),
    ]);
    expect(t).toMatchObject({ ok: true, applied: 4 });
    const u = await w.run('dim.undo', { dim, of: turnOf(B, 1) });
    expect(Object.keys(u).sort()).toEqual(['applied', 'attr', 'dim', 'hash', 'ok', 'seq', 'skipped']);
    expect(u).toMatchObject({ ok: true, applied: 4, skipped: { changed: 0, gone: 0, refused: 0, partial: 0 } });
    const page = w.log.fold(dim);
    expect(u.hash).toBe(dimHash(page));
    expect(u.attr).toBe(dimAttrDigest(page));
    expect(u.seq).toBe(page.seq);
    expect(page.nodes.get(ulid(1))!.node).toMatchObject({ label: 'one' });
    expect(page.nodes.get(ulid(1))!.node.color).toBeUndefined();
    expect(page.nodes.get(ulid(2))!.node.x).toBe(2);
    expect(page.nodes.has(ulid(4))).toBe(false);
    const back = [...page.nodes.values()].find((n) => n.node.text === 'note')!;
    expect(back.restoredFrom).toEqual({ id: ulid(3), by: { cls: 'human', principal: HUMAN } });
    // the undo row: gui-stamped, a mod-minted act, the marker built by the mod; never charged to any turn
    const row = w.opRows().at(-1)!;
    const p = row.payload as Record<string, unknown>;
    expect(p.act).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(p.undo).toEqual({ of: turnOf(B, 1), restored: [[back.node.id, ulid(3), { cls: 'human', principal: HUMAN }]] });
    expect((p.relayedFor as Record<string, unknown>).surface).toBe('gui');
    const turns = w.state().turns as unknown[][];
    expect(turns.find((e) => e[0] === B)![2]).toBe(4);
  });

  it('later changes win: a field the person changed after the turn is left, the rest undone; the counts are per mark', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'one' }), rectOp(2), rectOp(3)] });
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { label: 'ONE', color: 'cobalt' } }, { type: 'update', id: ulid(2), patch: { color: 'graphite' } }, { type: 'update', id: ulid(3), patch: { color: 'graphite' } }]);
    await w.run('dim.op', { dim, ops: [{ type: 'update', id: ulid(1), patch: { label: 'mine again' } }, { type: 'update', id: ulid(2), patch: { color: 'leaf' } }, { type: 'delete', id: ulid(3) }] });
    const u = await w.run('dim.undo', { dim, of: turnOf(B, 1) });
    expect(u).toMatchObject({ ok: true, applied: 1, skipped: { changed: 1, gone: 1, refused: 0, partial: 1 } });
    const n1 = w.log.fold(dim).nodes.get(ulid(1))!.node;
    expect([n1.label, n1.color]).toEqual(['mine again', undefined]);
    expect(w.log.fold(dim).nodes.get(ulid(2))!.node.color).toBe('leaf');
  });

  it('G3: a re-add whose text now matches a secret rule is skipped (refused 1) while the rest of the undo applies', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)] });
    // a row no validator read (an older rule set): a person's text that the scan refuses today
    w.log.inject(DIM_KINDS.op, { v: 1, dim, ops: [textOp(2, 'key AKIAIOSFODNN7EXAMPLE')], relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
    expect(await w.run('dim.check', { dim })).toMatchObject({ ok: true });
    await draw(w, dim, B, 1, [{ type: 'delete', id: ulid(2) }, { type: 'update', id: ulid(1), patch: { color: 'graphite' } }]);
    const u = await w.run('dim.undo', { dim, of: turnOf(B, 1) });
    expect(u).toMatchObject({ ok: true, applied: 1, skipped: { refused: 1 } });
    expect(w.log.fold(dim).nodes.get(ulid(1))!.node.color).toBeUndefined();
    expect(JSON.stringify(w.opRows().at(-1)!.payload)).not.toContain('AKIA');
  });

  it('redo (U3): the person undoes their own undo set; the agent\'s add comes back under a new id, restoredFrom the agent (G5: dashed and sealed as the agent)', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'one' })] });
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { label: 'ONE' } }, rectOp(4, { label: 'agent idea' })]);
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: true, applied: 2 });
    const act = (w.opRows().at(-1)!.payload as { act: string }).act;
    const redo = await w.run('dim.undo', { dim, of: { principal: HUMAN, act } });
    expect(redo).toMatchObject({ ok: true, applied: 2 });
    const page = w.log.fold(dim);
    expect(page.nodes.get(ulid(1))!.node.label).toBe('ONE');
    const idea = [...page.nodes.values()].find((n) => n.node.label === 'agent idea')!;
    expect(idea.by.cls).toBe('human'); // the re-add is stamped by the undoer ...
    expect(idea.restoredFrom!.by).toMatchObject({ cls: 'agent', agent: 'claude' }); // ... and carries the agent's hand (G5)
    const view = await w.tool('dim-view', { dim }, agentOf(A));
    expect(handsOf(view, idea.node.id as string)!.restoredFrom).toMatchObject({ id: ulid(4), by: { cls: 'agent' } });
  });

  it('undo-expired after a restart, and after an append-failed dropped the fold (never a plan built on a stale fold); undo-nothing; undo-set-bad', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { color: 'graphite' } }]);
    await draw(w, dim, B, 2, [{ type: 'update', id: ulid(2), patch: { color: 'graphite' } }]);
    // an append that fails (the mod cannot tell whether it landed) drops the fold and its checkpoints
    w.log.failAppends = 1;
    expect(await w.run('dim.op', { dim, ops: [rectOp(3)] })).toMatchObject({ ok: false, code: 'append-failed' });
    const before = w.opRows().length;
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: false, code: 'undo-expired' });
    expect(w.opRows()).toHaveLength(before);
    await draw(w, dim, B, 3, [{ type: 'update', id: ulid(1), patch: { color: 'cobalt' } }]);
    await w.restart();
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 3) })).toMatchObject({ ok: false, code: 'undo-expired' });
    // a set whose rows straddle the reload is never undone in part: B's turn 3 continues after the restart
    await draw(w, dim, B, 3, [{ type: 'update', id: ulid(2), patch: { color: 'cobalt' } }]);
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 3) })).toMatchObject({ ok: false, code: 'undo-expired' });
    // nothing left: the turn's only mark was deleted since
    await draw(w, dim, B, 4, [{ type: 'update', id: ulid(1), patch: { color: 'leaf' } }]);
    await w.run('dim.op', { dim, ops: [{ type: 'delete', id: ulid(1) }] });
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 4) })).toMatchObject({ ok: false, code: 'undo-nothing', skipped: { gone: 1 } });
    // a turn of a session not attached here; a bad of; a base past the head
    const C = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZC';
    expect(await w.run('dim.undo', { dim, of: turnOf(C, 1) })).toMatchObject({ ok: false, code: 'undo-set-bad' });
    for (const of of [{ turn: 'turn:x/1' }, { hsid: B, turn: `turn:${A}/1` }, { principal: HUMAN, act: 'x' }, { principal: HUMAN, act: ulid(1), x: 1 }, null]) expect(await w.run('dim.undo', { dim, of })).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 4), base: 10_000 })).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 4) }, A, { ...GUI, surface: 'cli' })).toMatchObject({ ok: false, code: 'not-human-gui' });
    expect(w.opRows().length).toBe(before + 4);
  });

  it('G2: ids scopes the undo to one removed mark: only that mark comes back', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2), rectOp(3), rectOp(4), rectOp(5)] });
    await draw(w, dim, B, 1, [{ type: 'delete', id: ulid(1) }, { type: 'delete', id: ulid(2) }, ...[3, 4, 5].map((n) => ({ type: 'update', id: ulid(n), patch: { color: 'graphite' } }))]);
    const u = await w.run('dim.undo', { dim, of: turnOf(B, 1), ids: [ulid(1)] });
    expect(u).toMatchObject({ ok: true, applied: 1 });
    const page = w.log.fold(dim);
    expect([...page.nodes.values()].filter((n) => n.restoredFrom?.id === ulid(1))).toHaveLength(1);
    expect([...page.nodes.values()].filter((n) => n.restoredFrom?.id === ulid(2))).toHaveLength(0);
    expect(page.nodes.get(ulid(3))!.node.color).toBe('graphite');
    expect((w.opRows().at(-1)!.payload as { undo: { ids: string[] } }).undo.ids).toEqual([ulid(1)]);
  });
});

describe('#dimension-mod E1 item 3: pins (Aegis G6, N1; the orchestrator\'s ruling) and dim.seen (Aegis S1 to S3)', () => {
  /** n agent turns of A that only add A's own marks (no notice, no pin) */
  const traffic = async (w: Rig, dim: string, from: number, n: number) => {
    for (let i = 0; i < n; i++) expect(await draw(w, dim, A, from + i, [rectOp(1000 + from + i)])).toMatchObject({ ok: true });
  };

  it('40 later agent turns do not evict a set that touched the person\'s marks; an unpinned one is evicted (undo-expired)', { timeout: 120_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)] });
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { color: 'graphite' } }]);
    await draw(w, dim, A, 1, [rectOp(500)]);
    await traffic(w, dim, 2, 40);
    expect(await w.run('dim.undo', { dim, of: turnOf(A, 1) })).toMatchObject({ ok: false, code: 'undo-expired' });
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: true, applied: 1 });
  });

  it('a ninth pinned set unpins the oldest, which stays undoable until normal eviction (N1), then answers undo-expired', { timeout: 180_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => rectOp(n)) });
    for (let t = 1; t <= 9; t++) await draw(w, dim, B, t, [{ type: 'update', id: ulid(t), patch: { color: 'graphite' } }]);
    // N1: the pushed-out set is still held
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1), ids: [ulid(1)] })).toMatchObject({ ok: true, applied: 1 });
    await traffic(w, dim, 1, 40);
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: false, code: 'undo-expired' });
    for (let t = 2; t <= 9; t++) expect([t, await w.run('dim.undo', { dim, of: turnOf(B, t) })]).toMatchObject([t, { ok: true, applied: 1 }]);
  });

  it('agent-on-agent sets are pinned while a person has the board open, sharing the cap', { timeout: 120_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await draw(w, dim, A, 1, [rectOp(1)]);
    // the person's page checks the board (they have it open); B then edits A's mark
    await w.run('dim.check', { dim });
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { color: 'graphite' } }]);
    await traffic(w, dim, 2, 40);
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: true, applied: 1 });
  });

  it('dim.seen releases one pinned set only; an unknown or unpinned of is a no-op refusal; cli and tool surfaces are refused and the pin is held', { timeout: 180_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { color: 'graphite' } }]);
    await draw(w, dim, B, 2, [{ type: 'update', id: ulid(2), patch: { color: 'graphite' } }]);
    // S1: not a person on the window, not a tool
    expect(await w.run('dim.seen', { dim, of: turnOf(B, 1) }, A, { ...GUI, surface: 'cli' })).toMatchObject({ ok: false, code: 'not-human-gui' });
    await expect(w.tool('dim.seen', { dim, of: turnOf(B, 1) }, agentOf(B))).rejects.toThrow();
    await expect(w.tool('dim-seen', { dim, of: turnOf(B, 1) }, agentOf(B))).rejects.toThrow();
    expect(await w.tool('dim-draw', { dim, ops: [rectOp(9)], seen: turnOf(B, 1) }, agentOf(B))).toMatchObject({ ok: false, code: 'args-bad' });
    // S2: unknown and unpinned
    expect(await w.run('dim.seen', { dim, of: turnOf(B, 7) })).toMatchObject({ ok: false, code: 'not-pinned' });
    expect(await w.run('dim.seen', { dim, of: { principal: HUMAN, act: ulid(3, '01JDAC') } })).toMatchObject({ ok: false, code: 'not-pinned' });
    const rows = w.log.rows.length;
    expect(await w.run('dim.seen', { dim, of: turnOf(B, 1) })).toEqual({ ok: true, dim, released: true });
    expect(await w.run('dim.seen', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: false, code: 'not-pinned' });
    expect(w.log.rows.length).toBe(rows);
    await traffic(w, dim, 1, 40);
    // the released set went with normal traffic; the other one is still held
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: false, code: 'undo-expired' });
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 2) })).toMatchObject({ ok: true, applied: 1 });
  });
});

describe('#dimension-mod E1: a catch-up notes rows the mod did not answer for', () => {
  it('an agent turn read from the log by dim.check gets its checkpoint, and the person can undo it', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
    const rf = { ...agentOf(B, 5) };
    w.log.inject(DIM_KINDS.op, { v: 1, dim, ops: [{ type: 'update', id: ulid(1), patch: { color: 'graphite' } }], relayedFor: rf });
    w.log.inject(DIM_KINDS.op, { v: 1, dim, ops: [{ type: 'delete', id: ulid(2) }], relayedFor: rf });
    expect(await w.run('dim.check', { dim })).toMatchObject({ ok: true });
    const u = await w.run('dim.undo', { dim, of: turnOf(B, 5) });
    expect(u).toMatchObject({ ok: true, applied: 2 });
    expect(u.hash).toBe(dimHash(w.log.fold(dim)));
  });
});

describe('#dimension-mod E1 item 5: base and changed-since; the foreign sub-budgets per id (Aegis rulings 1 and 6; G-DDL-03)', () => {
  /** a board with n person marks */
  const marks = async (w: Rig, dim: string, n: number) => {
    for (let k = 0; k < n; k += 64) await w.run('dim.op', { dim, ops: Array.from({ length: Math.min(64, n - k) }, (_, i) => rectOp(k + i + 1, { x: 0, y: 0 })) });
  };
  const left = (w: Rig, hsid: string) => (w.state().turns as unknown[][]).find((e) => e[0] === hsid)!;

  it('the 33rd foreign touch is refused foreign-budget; a move of 40 foreign ids is charged 40 (refused whole); own marks are free', { timeout: 120_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await marks(w, dim, 64);
    // own marks: no foreign charge
    await draw(w, dim, B, 1, [rectOp(200), { type: 'update', id: ulid(200), patch: { color: 'graphite' } }]);
    // a move of 40 of the person's marks: 40 > 32, refused whole, nothing charged
    const m40 = await draw(w, dim, B, 1, [{ type: 'move', ids: Array.from({ length: 40 }, (_, i) => ulid(i + 1)), dx: 1, dy: 0 }]);
    expect(m40).toMatchObject({ ok: false });
    expect((m40.refused as Array<{ code: string }>)[0]!.code).toBe('foreign-budget');
    // 20 + 12 = 32 fit; the 33rd does not
    expect(await draw(w, dim, B, 1, [{ type: 'move', ids: Array.from({ length: 20 }, (_, i) => ulid(i + 1)), dx: 1, dy: 0 }])).toMatchObject({ ok: true, applied: 1 });
    const r = await draw(w, dim, B, 1, Array.from({ length: 13 }, (_, i) => ({ type: 'update', id: ulid(30 + i), patch: { color: 'graphite' } })));
    expect(r).toMatchObject({ ok: true, applied: 12 });
    expect(r.refused).toEqual([{ index: 12, field: 'op', code: 'foreign-budget', fix: expect.any(String) }]);
    expect(left(w, B).slice(4)).toEqual([32, 0, 0]);
    // a new turn starts again
    expect(await draw(w, dim, B, 2, [{ type: 'update', id: ulid(60), patch: { color: 'graphite' } }])).toMatchObject({ ok: true, applied: 1 });
  });

  it('the 17th foreign delete and the 17th foreign words update are refused; another agent\'s marks are foreign too', { timeout: 120_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await marks(w, dim, 40);
    const d = await draw(w, dim, B, 1, Array.from({ length: 17 }, (_, i) => ({ type: 'delete', id: ulid(i + 1) })));
    expect(d).toMatchObject({ ok: true, applied: 16 });
    expect((d.refused as Array<{ index: number; code: string }>).map((x) => [x.index, x.code])).toEqual([[16, 'foreign-budget']]);
    const t = await draw(w, dim, A, 1, Array.from({ length: 17 }, (_, i) => ({ type: 'update', id: ulid(20 + i), patch: { label: `w${i}` } })));
    expect(t).toMatchObject({ ok: true, applied: 16 });
    // agent A's own marks are foreign to agent B
    await draw(w, dim, A, 2, [rectOp(300)]);
    await draw(w, dim, B, 3, [{ type: 'update', id: ulid(300), patch: { color: 'graphite' } }]);
    expect(left(w, B).slice(1, 7)).toEqual([3, 1, 0, 1, 0, 0]);
  });

  it('a stale base refuses only the ops on marks changed since; a fresh base passes; base past the head is args-bad; a re-added mark counts from its add', { timeout: 120_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2), rectOp(3)] });
    const view = await w.tool('dim-view', { dim }, agentOf(B));
    const base = view.seq as number;
    await w.run('dim.op', { dim, ops: [{ type: 'update', id: ulid(2), patch: { color: 'leaf' } }] });
    const r = await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { color: 'graphite' } }, { type: 'update', id: ulid(2), patch: { color: 'graphite' } }, { type: 'move', ids: [ulid(3), ulid(2)], dx: 1, dy: 1 }], );
    expect(r).toMatchObject({ ok: true, applied: 3 }); // no base: last writer wins
    const stale = await w.tool('dim-draw', { dim, base, ops: [{ type: 'update', id: ulid(1), patch: { color: 'leaf' } }, { type: 'delete', id: ulid(3) }] }, agentOf(B, 2));
    expect(stale).toMatchObject({ ok: false, code: 'changed-since' });
    const mixed = await w.tool('dim-draw', { dim, base: w.log.fold(dim).seq, ops: [{ type: 'update', id: ulid(1), patch: { color: 'leaf' } }] }, agentOf(B, 2));
    expect(mixed).toMatchObject({ ok: true, applied: 1 });
    expect(await w.tool('dim-draw', { dim, base: 99_999, ops: [rectOp(9)] }, agentOf(B, 2))).toMatchObject({ ok: false, code: 'args-bad' });
    for (const b of [-1, 1.5, '3', null]) expect(await w.tool('dim-draw', { dim, base: b, ops: [rectOp(9)] }, agentOf(B, 2))).toMatchObject({ ok: false, code: 'args-bad' });
    // the person deletes a mark and undoes the delete: the new id counts from its add
    await w.run('dim.op', { dim, ops: [{ type: 'delete', id: ulid(1) }], act: ulid(1, '01JDAC') });
    const seen = w.log.fold(dim).seq;
    await w.run('dim.undo', { dim, of: { principal: HUMAN, act: ulid(1, '01JDAC') } });
    const back = [...w.log.fold(dim).nodes.entries()].find(([, n]) => n.restoredFrom?.id === ulid(1))![0];
    const re = await w.tool('dim-draw', { dim, base: seen, ops: [{ type: 'update', id: back, patch: { color: 'graphite' } }, rectOp(10)] }, agentOf(B, 3));
    expect(re).toMatchObject({ ok: true, applied: 1 });
    expect((re.refused as Array<{ index: number; code: string }>).map((x) => [x.index, x.code])).toEqual([[0, 'changed-since']]);
  });

  it('the turns state key: the 7-element form round-trips and the S1.4 P2 four-element form still decodes (no foreign use)', async () => {
    const m = await loadModel();
    // the tolerant decode: the S1.4 P2 four-element form still reads, with no foreign use
    const t = m.decodeTurns!([[A, 3, 10, 1], [B, 2, 5, 0, 7, 2, 1], [A, 'x']]) as Map<string, Record<string, number>>;
    expect(t.get(A)).toMatchObject({ turn: 3, used: 10, foreign: 0, fdel: 0, fwords: 0 });
    expect(t.get(B)).toMatchObject({ turn: 2, used: 5, foreign: 7, fdel: 2, fwords: 1 });
    expect(m.encodeTurns!(t)).toEqual([[A, 3, 10, 1, 0, 0, 0], [B, 2, 5, 0, 7, 2, 1]]);
  });
});

describe('#dimension-mod E1 item 6: attr beside hash (Aegis G7); change-set ids in dim-view changes; the view byte bound', () => {
  it('dim.check, dim.op and dim.undo answer attr = dimAttrDigest of the page fold; a row whose stamp was edited shows in attr while hash matches', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    const op = await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'mine' })] });
    expect(op.attr).toBe(dimAttrDigest(w.log.fold(dim)));
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { label: 'theirs' } }]);
    const chk = await w.run('dim.check', { dim });
    expect([chk.hash, chk.attr]).toEqual([dimHash(w.log.fold(dim)), dimAttrDigest(w.log.fold(dim))]);
    // the page's fold of the same rows with one stamp edited (another agent label): content and adder agree, attribution does not
    const { foldDim } = await import('@a-company/gnomon-contracts');
    const rows = w.log.dimRows().map((r) => {
      const p = r.payload as Record<string, unknown>;
      const rf = p.relayedFor as Record<string, unknown> | undefined;
      return rf?.agent ? { ...r, payload: { ...p, relayedFor: { ...rf, agent: 'mallory' } } } : r;
    });
    const page = foldDim(rows, undefined, { ...w.log.fold(dim), nodes: new Map(), gone: new Set(), seq: 0, ops: 0, unapplied: 0, attached: [], title: '', dim });
    expect(dimHash(page)).toBe(chk.hash);
    expect(dimAttrDigest(page)).not.toBe(chk.attr);
  });

  it('changes entries carry their set id and, on an honoured undo row, undo: {of}; attribution is compact (indices into hands)', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    const act = ulid(4, '01JDAC');
    await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'mine' })], act });
    const since = (await w.tool('dim-view', { dim }, agentOf(B))).seq as number;
    await draw(w, dim, B, 1, [{ type: 'update', id: ulid(1), patch: { label: 'theirs' } }]);
    await w.run('dim.undo', { dim, of: turnOf(B, 1) });
    const v = await w.tool('dim-view', { dim, since: since - 1 }, agentOf(B, 2));
    const ch = v.changes as Array<Record<string, unknown>>;
    expect(ch[0]!.set).toEqual({ principal: HUMAN, act });
    expect(ch[1]!.set).toEqual(turnOf(B, 1));
    expect(ch[1]!.undo).toBeUndefined();
    expect(ch[2]!.undo).toEqual({ of: turnOf(B, 1) });
    expect((ch[2]!.set as Record<string, unknown>).principal).toBe(HUMAN);
    const n = nodeOf(v, ulid(1))!;
    const hands = v.hands as Array<Record<string, unknown>>;
    expect(typeof n.changedBy).toBe('number');
    expect(hands[n.changedBy as number]).toEqual({ cls: 'human', principal: HUMAN });
    expect(hands[n.otherBy as number]).toMatchObject({ cls: 'agent', agent: 'claude' });
    expect(n.by).toEqual({ cls: 'human', principal: HUMAN });
  });

  it('the byte bound: 500 marks with full attribution fit one answer; a page of long texts is cut by bytes with truncated', async () => {
    const m = await loadModel();
    const human = { cls: 'human', principal: HUMAN };
    const ag = (k: string) => ({ cls: 'agent', principal: `p:00000000/s-${k}`, agent: `claude-${k}` });
    const mk = (big: boolean) => {
      const nodes = new Map<string, unknown>();
      for (let i = 0; i < 500; i++) {
        const node = big ? { id: ulid(i), kind: 'text', x: i, y: i, z: 'V', text: 'x'.repeat(4000) } : { id: ulid(i), kind: 'rect', x: i * 13, y: i * 7, z: 'V', w: 120, h: 60, label: `Label number ${i}`, color: 'graphite', fill: 'sky' };
        nodes.set(ulid(i), { node, by: human, hsid: A, addedSeq: i + 1, changedBy: ag('a'), changedSeq: 600, otherBy: ag('a'), otherSeq: 600, wordsBy: ag('b'), wordsSeq: 601, restoredFrom: { id: ulid(9000 + i), by: ag('c') } });
      }
      return { dim: dimId(1), title: 't', attached: [A], ended: false, nodes, gone: new Set(), seq: 700, ops: 0, unapplied: 0 };
    };
    const o = { hash: 'sha256:x', mayDraw: true, budgetLeft: 64, selection: [], limit: 500 };
    const full = m.viewAnswer!(mk(false), o) as Res;
    const bytes = Buffer.byteLength(JSON.stringify(full));
    expect((full.nodes as unknown[]).length).toBe(500);
    expect(full.truncated).toBeUndefined();
    expect(bytes).toBeLessThan(200 * 1024);
    const big = m.viewAnswer!(mk(true), o) as Res;
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThan(200 * 1024);
    expect((big.nodes as unknown[]).length).toBeLessThan(500);
    expect(big.truncated).toEqual({ nodes: 500 });
  });
});

describe('#dimension-mod E1 item 8: Aegis conditions at the mod', () => {
  it('every command and both tools, on every surface: a payload carrying undo, restored or of never reaches the log; a person\'s row naming an agent hand in restored never lands', { timeout: 120_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)] });
    await draw(w, dim, B, 1, [{ type: 'delete', id: ulid(1) }]);
    const agentHand = { cls: 'agent', principal: agentOf(B).principal, agent: 'claude' };
    const restored = [[ulid(50), ulid(1), agentHand]];
    const undo = { of: turnOf(B, 1), restored };
    const before = w.log.rows.length;
    const base: Record<string, Record<string, unknown>> = {
      'dim.open': { dim, opened: 'menu' },
      'dim.attach': { dim },
      'dim.op': { dim, ops: [{ type: 'add', node: { ...(rectOp(50).node as object) } }] },
      'dim.close': { dim },
      'dim.grant': { dim, write: true },
      'dim.select': { dim, ids: [] },
      'dim.check': { dim },
      'dim.undo': { dim, of: turnOf(B, 1) },
      'dim.seen': { dim, of: turnOf(B, 1) },
    };
    for (const [cmd, args] of Object.entries(base)) {
      for (const [k, v] of Object.entries({ undo, restored, of: { ...turnOf(B, 1), restored } })) {
        // of is an arg of dim.undo and dim.seen: there a forged of (with restored inside) is still refused
        const sent = { ...args, [k]: v };
        expect([cmd, k, (await w.run(cmd, sent)).code]).toEqual([cmd, k, 'args-bad']);
      }
      // the CLI surface (and so every non-gui caller) is refused before the args are read
      expect([cmd, (await w.run(cmd, { ...args, undo }, A, { ...GUI, surface: 'cli' })).code]).toEqual([cmd, 'not-human-gui']);
    }
    for (const t of ['dim-view', 'dim-draw']) for (const k of ['undo', 'restored', 'of']) expect([t, k, (await w.tool(t, { dim, ...(t === 'dim-draw' ? { ops: [rectOp(51)] } : {}), [k]: k === 'restored' ? restored : undo }, agentOf(B))).code]).toEqual([t, k, 'args-bad']);
    // the person's dim.op with the marker inside an op: refused by name, no row
    const inOp = await w.run('dim.op', { dim, ops: [{ ...rectOp(52), undo }] });
    expect(inOp).toMatchObject({ ok: false, code: 'ops-refused' });
    expect(w.log.rows.slice(before).filter((x) => x.kind === DIM_KINDS.op)).toHaveLength(0);
    for (const x of w.log.rows.slice(before)) expect(JSON.stringify(x.payload)).not.toContain('restored');
    // the only restored entry a person's row ever carries is the mod's own, from its checkpoint: the person's
    // undo of B's delete names the PERSON's hand (the mark's original), never the agent's
    expect(await w.run('dim.undo', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: true, applied: 1 });
    const u = w.opRows().at(-1)!.payload as { undo: { restored: unknown[][] } };
    expect(u.undo.restored[0]![2]).toEqual({ cls: 'human', principal: HUMAN });
  });

  it('keyframe v3 carries goneBy: after a cold open from it, a restore still keeps its provenance (the fold honours it)', { timeout: 60_000 }, async () => {
    const w = await editRig();
    const dim = await board(w);
    await draw(w, dim, B, 1, [rectOp(1, { label: 'b' })]);
    await draw(w, dim, A, 1, [{ type: 'delete', id: ulid(1) }]);
    await w.run('dim.grant', { dim, write: true }, B); // writes a keyframe
    const kf = w.state()[`kf:${dim.slice(4)}`] as Record<string, unknown>;
    expect(kf.v).toBe(3);
    expect((w.state()[`kf:${dim.slice(4)}:0`] as unknown[][]).find((it) => it[0] === 'g')).toEqual(['g', ulid(1), { cls: 'agent', principal: agentOf(B).principal, agent: 'claude' }]);
    await w.restart();
    await draw(w, dim, A, 2, [rectOp(2)]); // the fold is loaded from the keyframe
    // a restore row read in by a catch-up: the mod's fold (from the keyframe) honours it only if it knows the hand
    w.log.inject(DIM_KINDS.op, { v: 1, dim, ops: [{ type: 'add', node: { ...(rectOp(3).node as object), label: 'b' } }], act: ulid(9, '01JDAC'), undo: { of: turnOf(A, 1), restored: [[ulid(3), ulid(1), { cls: 'agent', principal: agentOf(B).principal, agent: 'claude' }]] }, relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
    const chk = await w.run('dim.check', { dim });
    expect(chk.attr).toBe(dimAttrDigest(w.log.fold(dim)));
    expect(handsOf(await w.tool('dim-view', { dim }, agentOf(A, 3)), ulid(3))!.restoredFrom).toMatchObject({ id: ulid(1), by: { cls: 'agent', agent: 'claude' } });
  });
});
