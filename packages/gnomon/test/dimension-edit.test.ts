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
    const n = nodeOf(view, id)!;
    expect(n.wordsBy).toMatchObject({ cls: 'agent', agent: 'claude', principal: agentOf(B).principal });
    expect(n.otherBy).toMatchObject({ cls: 'agent' });
    // the cold open read the log from before the first row: the v2 keyframe was not trusted
    const pages = w.log.reads.slice(readsBefore).filter((p) => Array.isArray(p.kinds));
    expect(((pages[0]!.since as { seq?: number } | undefined)?.seq ?? 0) < (w.opRows()[0]!.seq as number)).toBe(true);
    // the attribution the mod now holds is the page fold's
    expect(dimAttrDigest(w.log.fold(dim))).not.toBe(dimAttrDigest({ ...w.log.fold(dim), nodes: new Map([...w.log.fold(dim).nodes].map(([k, v]) => [k, { node: v.node, by: v.by, hsid: v.hsid, addedSeq: v.addedSeq }])) }));
  });
});
