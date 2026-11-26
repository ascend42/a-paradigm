/**
 * #dimension-mod S1.4 E2 (spec §12.7, edit-anything): the agent's `dim-undo` tool. Undo is fully SYMMETRIC (the
 * founder's ruling of 2026-11-26; Aegis H1 and H2 not adopted): an agent may undo its own turn, another agent's and
 * a person's action. Bounded by Aegis's E2 conditions: grant, then the op-id memo, then the budget; every op charged
 * to the turn and, per id against the original hand, to the foreign sub-budgets before the first append; refunds
 * only for rows definitely not written; the grant asked again between rows; named from the agent's own view; one
 * person change-set per agent turn; a loop-origin session refused at the bridge (M2); the allowlist entry in tests
 * only (M1). The REAL mod tree runs as a child under the real ModHost with an in-memory log (dimension-helpers.ts).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_AUX_KINDS, DIM_KINDS } from '@a-company/gnomon-contracts';
import { readDeskMods } from '../src/kernel/desk/mcp-passthrough.js';
import { MOD_BRIDGE_SENTENCES, MOD_BRIDGE_TOOLS, modBridgeAnswer, modBridgeTools, newBridgeRate, type BridgeSession } from '../src/kernel/modhost/mcp-bridge.js';
import { hostDir } from '../src/kernel/modhost/state.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { DIMENSION, dimId, fakeLog, installDimension, rectOp, ulid } from './dimension-helpers.js';
import { host, rig as modRig, testModBridge } from './mod-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const REPO = 'repo:0123456789abcdef';
const HUMAN = 'p:00000000/founder';
const GUI = { principal: HUMAN, connId: 'conn:01JTESTGUI000000000000000', surface: 'gui' as const, principalClass: 'human' };
const GUI_STAMP = { principal: HUMAN, connId: GUI.connId, surface: 'gui' };

type Res = Record<string, unknown> & { ok?: boolean; code?: string; seq?: number; applied?: number; more?: boolean };

const agentOf = (hsid: string, turn = 1): Record<string, string> => ({ principal: `p:00000000/s-${hsid.slice(-8).toLowerCase()}`, surface: 'bridge', agent: 'claude', hsid, turn: `turn:${hsid}/${turn}` });
const turnOf = (hsid: string, n: number) => ({ hsid, turn: `turn:${hsid}/${n}` });
const actOf = (n: number) => ulid(n, '01JD1A');
const textOp = (n: number, text: string) => ({ type: 'add', node: { id: ulid(n), kind: 'text', x: n, y: n, z: 'V', text } });

async function undoRig(opts: { now?: () => number; callTimeoutMs?: number } = {}) {
  const r = modRig();
  cleanups.push(r.cleanup);
  installDimension(r);
  const log = fakeLog(opts.now ? { now: opts.now } : {});
  const stateFile = path.join(hostDir(r.home, DIMENSION), 'state.db');
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: opts.callTimeoutMs ?? 30_000, focusRepo: () => REPO });
  cleanups.push(() => h.stopAll());
  await h.start(DIMENSION);
  const run = async (commandId: string, args: Record<string, unknown>, hsid: string = A): Promise<Res> => (await h.relayCommand({ name: DIMENSION, commandId, args: { ...args, focus: { hsid } }, ...GUI })) as Res;
  const tool = async (name: string, input: unknown, rf: Record<string, string>): Promise<Res> => (await h.callTool(DIMENSION, name as 'dim-view', input, { hsid: rf.hsid, toolRelayedFor: rf as never })) as Res;
  const state = (): Record<string, unknown> => (fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>) : {});
  /** [hsid, turn, used, countRows, foreign, foreignDeletes, foreignWords] of one session */
  const turnsOf = (hsid: string) => (state().turns as unknown[][]).find((e) => e[0] === hsid)!;
  const opRows = () => log.rows.filter((x) => x.kind === DIM_KINDS.op);
  const restart = async (): Promise<void> => {
    await h.stop(DIMENSION);
    await h.start(DIMENSION);
  };
  return { r, h, log, run, tool, state, turnsOf, opRows, restart };
}
type Rig = Awaited<ReturnType<typeof undoRig>>;

/** A board opened by A (the first session, so it may draw), with B attached and allowed to draw. */
async function board(w: Rig): Promise<string> {
  const dim = dimId(1);
  expect(await w.run('dim.open', { dim, title: 'Plan', opened: 'command' })).toMatchObject({ ok: true });
  expect(await w.run('dim.attach', { dim }, B)).toMatchObject({ ok: true });
  expect(await w.run('dim.grant', { dim, write: true }, B)).toMatchObject({ ok: true });
  return dim;
}
const draw = (w: Rig, dim: string, hsid: string, n: number, ops: unknown[]) => w.tool('dim-draw', { dim, ops }, agentOf(hsid, n));
/** The agent's view of what changed since `since`: this is what lists change-sets to it (named from view). */
const view = (w: Rig, dim: string, hsid: string, n: number, since = 0) => w.tool('dim-view', { dim, since }, agentOf(hsid, n));
const undo = (w: Rig, dim: string, hsid: string, n: number, input: Record<string, unknown>) => w.tool('dim-undo', { dim, ...input }, agentOf(hsid, n));

describe('#dimension-mod E2: dim-undo is symmetric (the founder\'s ruling): own turn, another agent\'s turn, a person\'s action', () => {
  it('an agent undoes its own turn: the add removed, the edit reverted; the row is the agent\'s, with the mod\'s marker, no act and no oid; own marks are free of the foreign budget', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await draw(w, dim, B, 1, [rectOp(1, { label: 'one' })])).toMatchObject({ ok: true });
    expect(await draw(w, dim, B, 2, [{ type: 'update', id: ulid(1), patch: { label: 'ONE' } }, rectOp(2)])).toMatchObject({ ok: true });
    await view(w, dim, B, 2);
    const u = await undo(w, dim, B, 2, { of: turnOf(B, 2), opId: 'mine-1' });
    expect(u).toMatchObject({ ok: true, applied: 2, skipped: { changed: 0, gone: 0, refused: 0, partial: 0 } });
    expect(u.more).toBeUndefined();
    const page = w.log.fold(dim);
    expect([page.nodes.get(ulid(1))!.node.label, page.nodes.has(ulid(2))]).toEqual(['one', false]);
    const p = w.opRows().at(-1)!.payload as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(['dim', 'ops', 'relayedFor', 'undo', 'v']);
    expect(p.undo).toEqual({ of: turnOf(B, 2) });
    expect(p.relayedFor).toMatchObject({ surface: 'bridge', agent: 'claude', hsid: B, turn: `turn:${B}/2` });
    // turn 2: 2 drawn + 2 undone; nothing foreign
    expect(w.turnsOf(B).slice(1)).toEqual([2, 4, 0, 0, 0, 0]);
    expect(u.budgetLeft).toBe(60);
  });

  it('an agent undoes ANOTHER agent\'s turn it was shown: charged to the undoer, foreign per id against the original hand', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await draw(w, dim, B, 1, [rectOp(1), rectOp(2)])).toMatchObject({ ok: true });
    // not yet shown to A: refused, nothing written
    const rows = w.opRows().length;
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 1) })).toMatchObject({ ok: false, code: 'undo-set-bad' });
    expect(w.opRows()).toHaveLength(rows);
    await view(w, dim, A, 1);
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 1) })).toMatchObject({ ok: true, applied: 2 });
    expect([w.log.fold(dim).nodes.has(ulid(1)), w.log.fold(dim).nodes.has(ulid(2))]).toEqual([false, false]);
    // A: 2 ops, 2 foreign touches, both removals of B's marks
    expect(w.turnsOf(A).slice(1)).toEqual([1, 2, 0, 2, 2, 0]);
  });

  it('an agent undoes a PERSON\'s action (no undo-not-allowed, no skipped.person): the set is pinned; the person redoes it with dim.undo', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'theirs' })] })).toMatchObject({ ok: true });
    expect(await w.run('dim.op', { dim, ops: [{ type: 'delete', id: ulid(1) }, textOp(2, 'kept')], act: actOf(1) })).toMatchObject({ ok: true });
    await view(w, dim, B, 1);
    const u = await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } });
    expect(u).toMatchObject({ ok: true, applied: 2 });
    const page = w.log.fold(dim);
    expect(page.nodes.has(ulid(2))).toBe(false);
    const back = [...page.nodes.values()].find((n) => n.node.label === 'theirs')!;
    expect(back.restoredFrom).toEqual({ id: ulid(1), by: { cls: 'human', principal: HUMAN } });
    // the re-add of the person's mark and the removal of the person's text: 2 foreign touches, 1 of them a removal
    expect(w.turnsOf(B).slice(2, 6)).toEqual([2, 0, 2, 1]);
    // pinned (undidPerson): dim.seen releases it, so it was standing
    const p = w.opRows().at(-1)!.payload as Record<string, unknown>;
    expect(p.undo).toMatchObject({ of: { principal: HUMAN, act: actOf(1) } });
    // the person's redo: dim.undo of the agent's undo turn puts their action back
    const redo = await w.run('dim.undo', { dim, of: turnOf(B, 1) });
    expect(redo).toMatchObject({ ok: true, applied: 2 });
    const again = w.log.fold(dim);
    expect([...again.nodes.values()].some((n) => n.node.label === 'theirs')).toBe(false);
    expect([...again.nodes.values()].find((n) => n.node.text === 'kept')!.restoredFrom!.by).toEqual({ cls: 'human', principal: HUMAN });
  });

  it('pins: an agent\'s undo of a person\'s set stands as a notice (dim.seen releases it); so does an agent-on-agent undo while a person is present', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)], act: actOf(1) });
    await view(w, dim, B, 1);
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: true });
    expect(await w.run('dim.seen', { dim, of: turnOf(B, 1) })).toMatchObject({ ok: true, released: true });
    // agent-on-agent while the person is present (their commands above, within PRESENCE_MS)
    expect(await draw(w, dim, B, 2, [rectOp(5)])).toMatchObject({ ok: true });
    await view(w, dim, A, 1);
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 2) })).toMatchObject({ ok: true, applied: 1 });
    expect(await w.run('dim.seen', { dim, of: turnOf(A, 1) })).toMatchObject({ ok: true, released: true });
  });
});

describe('#dimension-mod E2: the order and the set rules (Aegis E2)', () => {
  it('one person change-set per agent turn: a second is undo-not-allowed with no row; the next turn may', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)], act: actOf(1) });
    await w.run('dim.op', { dim, ops: [rectOp(2)], act: actOf(2) });
    await view(w, dim, B, 1);
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: true, applied: 1 });
    const rows = w.opRows().length;
    const used = w.turnsOf(B)[2];
    const second = await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(2) } });
    expect(second).toMatchObject({ ok: false, code: 'undo-not-allowed', fix: 'You already undid one of a person\'s changes this turn; you may continue that one, or undo another in a later turn.' });
    expect([w.opRows().length, w.turnsOf(B)[2]]).toEqual([rows, used]);
    // an agent's turn is not a person's set: still allowed in the same turn
    expect(await draw(w, dim, A, 1, [rectOp(3)])).toMatchObject({ ok: true });
    await view(w, dim, B, 1, w.log.fold(dim).seq - 1);
    expect(await undo(w, dim, B, 1, { of: turnOf(A, 1) })).toMatchObject({ ok: true, applied: 1 });
    // the next turn of B may undo the second person set
    expect(await undo(w, dim, B, 2, { of: { principal: HUMAN, act: actOf(2) } })).toMatchObject({ ok: true, applied: 1 });
  });

  it('named from view: a set shown to ANOTHER session, or never shown, is undo-set-bad; ungranted is write-not-granted before anything; ended is dim-ended', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)], act: actOf(1) });
    await view(w, dim, A, 1);
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: false, code: 'undo-set-bad' });
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(9) } })).toMatchObject({ ok: false, code: 'undo-set-bad' });
    // input: of is required and closed
    expect(await undo(w, dim, B, 1, {})).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1), extra: 1 } })).toMatchObject({ ok: false, code: 'args-bad' });
    expect(await undo(w, dim, B, 1, { of: turnOf(B, 1), ops: [] })).toMatchObject({ ok: false, code: 'args-bad' });
    // the grant comes first: B revoked gets write-not-granted even for a set it was shown
    await view(w, dim, B, 1);
    expect(await w.run('dim.grant', { dim, write: false }, B)).toMatchObject({ ok: true });
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: false, code: 'write-not-granted' });
    expect(await w.run('dim.close', { dim })).toMatchObject({ ok: true });
    expect(await undo(w, dim, A, 1, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: false, code: 'dim-ended' });
    expect(w.opRows()).toHaveLength(1);
  });

  it('op-id memo (the same memo as dim-draw): a repeat writes nothing and answers repeat; another input under it is op-id-reused; a draw\'s opId is op-id-reused for an undo; grant before memo', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await draw(w, dim, B, 1, [rectOp(1)])).toMatchObject({ ok: true });
    expect(await w.tool('dim-draw', { dim, ops: [rectOp(2)], opId: 'drawn' }, agentOf(A, 1))).toMatchObject({ ok: true });
    await view(w, dim, A, 1);
    const first = await undo(w, dim, A, 1, { of: turnOf(B, 1), opId: 'u1' });
    expect(first).toMatchObject({ ok: true, applied: 1 });
    const rows = w.opRows().length;
    const used = w.turnsOf(A)[2];
    const again = await undo(w, dim, A, 1, { of: turnOf(B, 1), opId: 'u1' });
    expect(again).toMatchObject({ ok: true, applied: 1, repeat: true, seq: first.seq });
    expect([w.opRows().length, w.turnsOf(A)[2]]).toEqual([rows, used]);
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 1), ids: [ulid(1)], opId: 'u1' })).toMatchObject({ ok: false, code: 'op-id-reused' });
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 1), opId: 'drawn' })).toMatchObject({ ok: false, code: 'op-id-reused' });
    expect(await w.tool('dim-draw', { dim, ops: [rectOp(3)], opId: 'u1' }, agentOf(A, 1))).toMatchObject({ ok: false, code: 'op-id-reused' });
    expect(w.opRows()).toHaveLength(rows);
    // the grant runs before the memo: revoked, the stored answer is not handed back
    w.log.inject(DIM_AUX_KINDS.grant, { v: 1, dim, hsid: A, write: false, relayedFor: GUI_STAMP });
    await w.run('dim.check', { dim });
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 1), opId: 'u1' })).toMatchObject({ ok: false, code: 'write-not-granted' });
  });
});

describe('#dimension-mod E2: budgets charged before the append (M8), refunds only for rows not written', () => {
  it('a re-point of 5 foreign arrows charges 5 (the undoer\'s own re-add is free)', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await draw(w, dim, B, 1, [rectOp(1), rectOp(2)])).toMatchObject({ ok: true });
    const arrows = [11, 12, 13, 14, 15].map((n) => ({ type: 'add', node: { id: ulid(n), kind: 'arrow', x: 0, y: 0, z: 'V', points: [0, 0, 10, 10], from: ulid(1), to: ulid(2) } }));
    expect(await w.run('dim.op', { dim, ops: arrows })).toMatchObject({ ok: true, applied: 5 });
    expect(await draw(w, dim, B, 2, [{ type: 'delete', id: ulid(1) }])).toMatchObject({ ok: true });
    await view(w, dim, B, 2);
    const u = await undo(w, dim, B, 2, { of: turnOf(B, 2) });
    expect(u).toMatchObject({ ok: true });
    const page = w.log.fold(dim);
    const back = [...page.nodes.values()].find((n) => n.restoredFrom?.id === ulid(1))!;
    for (const n of [11, 12, 13, 14, 15]) expect(page.nodes.get(ulid(n))!.node.from).toBe(back.node.id);
    // turn 2: 1 delete + the undo's 6 ops (re-add + 5 re-points); foreign: the 5 person arrows, no removal, no words
    expect(w.turnsOf(B).slice(1)).toEqual([2, 7, 0, 5, 0, 0]);
  });

  it('over the foreign removals: the first 16 of 20 land, more: true, and nothing over the budget lands; the next turn finishes', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    const ids = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(await w.run('dim.op', { dim, ops: ids.map((n) => rectOp(n)), act: actOf(1) })).toMatchObject({ ok: true });
    await view(w, dim, B, 1);
    const u = await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } });
    expect(u).toMatchObject({ ok: true, applied: 16, more: true });
    expect(ids.filter((n) => w.log.fold(dim).nodes.has(ulid(n)))).toHaveLength(4);
    expect(w.turnsOf(B).slice(2, 6)).toEqual([16, 0, 16, 16]);
    // the same turn again: no removal left, refused foreign-budget, nothing lands
    const rows = w.opRows().length;
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: false, code: 'foreign-budget' });
    expect(w.opRows()).toHaveLength(rows);
    // the next turn continues the same set (one person set per turn: it is the same set)
    expect(await undo(w, dim, B, 2, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: true, applied: 4 });
    expect(ids.filter((n) => w.log.fold(dim).nodes.has(ulid(n)))).toEqual([]);
  });

  it('over the turn\'s 64 ops: only what is left lands, more: true; a spent turn is turn-budget before any plan', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await draw(w, dim, A, 1, Array.from({ length: 10 }, (_, i) => rectOp(200 + i)))).toMatchObject({ ok: true });
    expect(await draw(w, dim, B, 1, Array.from({ length: 60 }, (_, i) => rectOp(300 + i)))).toMatchObject({ ok: true, applied: 60 });
    await view(w, dim, B, 1);
    const u = await undo(w, dim, B, 1, { of: turnOf(A, 1) });
    expect(u).toMatchObject({ ok: true, applied: 4, more: true, budgetLeft: 0 });
    expect(Array.from({ length: 10 }, (_, i) => 200 + i).filter((n) => w.log.fold(dim).nodes.has(ulid(n)))).toHaveLength(6);
    expect(w.turnsOf(B).slice(2, 6)).toEqual([64, 0, 4, 4]);
    const rows = w.opRows().length;
    expect(await undo(w, dim, B, 1, { of: turnOf(A, 1) })).toMatchObject({ ok: false, code: 'turn-budget', budgetLeft: 0 });
    expect(w.opRows()).toHaveLength(rows);
  });

  /** A person's six long texts that agent B deleted in its turn 1: A's undo of that turn re-adds them in two rows. */
  async function longSet(w: Rig, dim: string): Promise<void> {
    for (let k = 0; k < 3; k++) expect(await w.run('dim.op', { dim, ops: [textOp(2 * k + 1, 'a'.repeat(4000)), textOp(2 * k + 2, 'b'.repeat(4000))] })).toMatchObject({ ok: true });
    expect(await draw(w, dim, B, 1, [1, 2, 3, 4, 5, 6].map((n) => ({ type: 'delete', id: ulid(n) })))).toMatchObject({ ok: true, applied: 6 });
    await view(w, dim, A, 1);
  }
  const undoRows = (w: Rig) => w.opRows().filter((r) => Object.hasOwn(r.payload, 'undo'));

  it('the grant revoked between rows stops the undo (M9): row 1 lands, the rest answers more and is refunded', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    await longSet(w, dim);
    let n = 0;
    w.log.afterAppend = (row) => {
      if (row.kind === DIM_KINDS.op && Object.hasOwn(row.payload, 'undo') && ++n === 1) w.log.inject(DIM_AUX_KINDS.grant, { v: 1, dim, hsid: A, write: false, relayedFor: GUI_STAMP });
    };
    const u = await undo(w, dim, A, 1, { of: turnOf(B, 1) });
    expect(undoRows(w)).toHaveLength(1);
    const landed = (undoRows(w)[0]!.payload.ops as unknown[]).length;
    expect(landed).toBeLessThan(6);
    expect(u).toMatchObject({ ok: true, applied: landed, more: true });
    // charged 6 ops and 6 foreign touches (re-adds of the person's marks) before row 1; the unwritten rest refunded
    expect(w.turnsOf(A).slice(2, 6)).toEqual([landed, 0, landed, 0]);
    expect(await undo(w, dim, A, 1, { of: turnOf(B, 1) })).toMatchObject({ ok: false, code: 'write-not-granted' });
  });

  it('append-busy on row 2: only row 2\'s ops and foreign touches are refunded; a failed (unknown) row 2 is never refunded', { timeout: 120_000 }, async () => {
    let T = 0;
    const w = await undoRig({ now: () => T });
    const dim = await board(w);
    await longSet(w, dim);
    // a fresh window: 19 rows of the person's, so the undo's first row is the 20th and its second is refused busy
    T += 2_000;
    for (let i = 0; i < 19; i++) expect(await w.run('dim.op', { dim, ops: [rectOp(100 + i)] })).toMatchObject({ ok: true });
    const busy = await undo(w, dim, A, 1, { of: turnOf(B, 1) });
    expect(undoRows(w)).toHaveLength(1);
    const first = (undoRows(w)[0]!.payload.ops as unknown[]).length;
    expect(busy).toMatchObject({ ok: true, applied: first, more: true });
    expect(w.turnsOf(A).slice(2, 6)).toEqual([first, 0, first, 0]);

    // a second board world: row 2 fails without a definite "not written"
    const v = await undoRig();
    const dim2 = await board(v);
    await longSet(v, dim2);
    let n = 0;
    v.log.afterAppend = (row) => {
      if (row.kind === DIM_KINDS.op && Object.hasOwn(row.payload, 'undo') && ++n === 1) v.log.failAppends = 1;
    };
    const failed = await undo(v, dim2, A, 1, { of: turnOf(B, 1) });
    expect(undoRows(v)).toHaveLength(1);
    const one = (undoRows(v)[0]!.payload.ops as unknown[]).length;
    expect(failed).toMatchObject({ ok: true, applied: one, more: true });
    // six texts make exactly two rows here: row 2 may have landed, so it stays charged (M8: never an undercount)
    expect(one).toBe(3);
    expect(v.turnsOf(A).slice(2, 6)).toEqual([6, 0, 6, 0]);
  });
});

describe('#dimension-mod E2 review fixes (Aegis I-1, I-2, N-1, N-3, N-4)', () => {
  it('I-1: a view whose change list is over its byte bound answers reset and shows no set: an undo of one of them is undo-set-bad', { timeout: 120_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    for (let k = 0; k < 40; k++) expect(await w.run('dim.op', { dim, ops: Array.from({ length: 64 }, (_, i) => rectOp(1000 + k * 64 + i)), act: actOf(k + 1) })).toMatchObject({ ok: true, applied: 64 });
    const v = await view(w, dim, B, 1);
    expect(v.changes).toBe('reset');
    // the newest set: still held (32 checkpoints) and within the 32 a view may note, so only I-1 refuses it
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(40) } })).toMatchObject({ ok: false, code: 'undo-set-bad' });
    // a view that carries it (since just before it) shows it, and the undo lands (16 foreign removals a turn)
    await view(w, dim, B, 1, w.log.fold(dim).seq - 1);
    expect(await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(40) } })).toMatchObject({ ok: true, applied: 16, more: true });
  });

  it('I-2: 20 re-adds of a person\'s deleted texts are 20 rewritten-words charges: 16 land, more: true', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    const ids = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(await w.run('dim.op', { dim, ops: ids.map((n) => textOp(n, `note ${n}`)) })).toMatchObject({ ok: true });
    expect(await w.run('dim.op', { dim, ops: ids.map((n) => ({ type: 'delete', id: ulid(n) })), act: actOf(1) })).toMatchObject({ ok: true });
    await view(w, dim, B, 1);
    const u = await undo(w, dim, B, 1, { of: { principal: HUMAN, act: actOf(1) } });
    expect(u).toMatchObject({ ok: true, applied: 16, more: true });
    expect([...w.log.fold(dim).nodes.values()].filter((n) => n.restoredFrom)).toHaveLength(16);
    expect(w.turnsOf(B).slice(2)).toEqual([16, 0, 16, 0, 16]);
  });

  it('N-3: a re-add of the undoer\'s OWN mark whose words came from a person is a words charge (not a touch)', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await draw(w, dim, B, 1, [rectOp(1)])).toMatchObject({ ok: true });
    expect(await w.run('dim.op', { dim, ops: [{ type: 'update', id: ulid(1), patch: { label: 'the person wrote this' } }] })).toMatchObject({ ok: true });
    expect(await w.run('dim.op', { dim, ops: [{ type: 'delete', id: ulid(1) }], act: actOf(1) })).toMatchObject({ ok: true });
    await view(w, dim, B, 2);
    expect(await undo(w, dim, B, 2, { of: { principal: HUMAN, act: actOf(1) } })).toMatchObject({ ok: true, applied: 1 });
    expect(w.turnsOf(B).slice(2)).toEqual([1, 0, 0, 0, 1]);
  });

  it('N-1: a call the host cancelled before the first row writes no row and charges nothing', { timeout: 60_000 }, async () => {
    const w = await undoRig({ callTimeoutMs: 1_500 });
    const dim = await board(w);
    expect(await draw(w, dim, B, 1, [rectOp(1)])).toMatchObject({ ok: true });
    await view(w, dim, A, 1);
    const rows = w.opRows().length;
    // the catch-up's one page answers after the timeout: the cancel arrived during it, and no later page is read
    w.log.readDelayMs = 1_700;
    const err = await undo(w, dim, A, 1, { of: turnOf(B, 1) }).then(
      () => null,
      (e: { modCode?: string }) => e,
    );
    w.log.readDelayMs = 0;
    expect(err).toMatchObject({ modCode: 'TIMEOUT' });
    expect(await w.run('dim.check', { dim })).toMatchObject({ ok: true });
    expect(w.opRows()).toHaveLength(rows);
    expect((w.state().turns as unknown[][]).find((e) => e[0] === A)).toBeUndefined();
  });

  it('N-4: an undo under the opId of an older draw (its oid in the rows, the memo gone after a restart) is op-id-reused, never that draw\'s repeat', { timeout: 60_000 }, async () => {
    const w = await undoRig();
    const dim = await board(w);
    expect(await w.tool('dim-draw', { dim, ops: [rectOp(1)], opId: 'd1' }, agentOf(A, 1))).toMatchObject({ ok: true });
    await w.restart();
    expect(await undo(w, dim, A, 1, { of: turnOf(A, 1), opId: 'd1' })).toMatchObject({ ok: false, code: 'op-id-reused' });
  });
});

describe('#dimension-mod E2: the bridge (M1 allowlist in tests only, M2 loop refusal)', () => {
  it('the production allowlist stays EMPTY; a test allowlist lists dim-undo; a loop-origin session\'s dim-undo and dim-draw are refused exactly alike and no row lands', { timeout: 60_000 }, async () => {
    expect(MOD_BRIDGE_TOOLS).toEqual({});
    const w = await undoRig();
    const dim = await board(w);
    await w.run('dim.op', { dim, ops: [rectOp(1)], act: actOf(1) });
    const allow = { [DIMENSION]: ['dim-view', 'dim-draw', 'dim-undo'] };
    const mods = readDeskMods(w.r.home, w.r.auth);
    expect(modBridgeTools(mods).map((t) => t.name)).toEqual([]);
    expect(modBridgeTools(mods, allow, () => true).map((t) => t.name)).toEqual(['dim-view', 'dim-draw', 'dim-undo']);
    let reached = 0;
    const bridge = testModBridge({
      mods: () => readDeskMods(w.r.home, w.r.auth),
      host: () => ({ admit: (n) => w.h.admit(n), callTool: (...a) => (reached++, w.h.callTool(...a)) }),
      ns: () => w.r.auth.ns,
      append: async () => undefined,
      now: () => 1_000,
      allow,
      currentPin: () => true,
    });
    const session = (o: Partial<BridgeSession> = {}): BridgeSession => ({ hsid: A, principal: `p:${w.r.auth.ns}/s-01hzzzzz`, agent: 'claude', turn: `turn:${A}/1`, surface: 'bridge', held: null, rate: newBridgeRate(), running: () => true, ...o });
    const call = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
    type Ans = { result?: { content?: Array<{ text: string }>; isError?: boolean } };
    const rows = w.opRows().length;
    const loop = session({ held: 'loop' });
    const u = (await modBridgeAnswer(call('dim-undo', { dim, of: { principal: HUMAN, act: actOf(1) } }), bridge, () => loop)) as Ans;
    const d = (await modBridgeAnswer(call('dim-draw', { dim, ops: [rectOp(2)] }), bridge, () => ({ ...loop, rate: newBridgeRate() }))) as Ans;
    expect([u.result!.isError, u.result!.content![0]!.text]).toEqual([true, MOD_BRIDGE_SENTENCES.loop]);
    expect([d.result!.isError, d.result!.content![0]!.text]).toEqual([true, MOD_BRIDGE_SENTENCES.loop]);
    expect([reached, w.opRows().length]).toEqual([0, rows]);
    // the same undo from a session that is not held reaches the mod (it answers by its own rules: not shown yet)
    const free = (await modBridgeAnswer(call('dim-undo', { dim, of: { principal: HUMAN, act: actOf(1) } }), bridge, () => session())) as Ans;
    expect(reached).toBe(1);
    expect(free.result!.content![0]!.text).toContain('undo-set-bad');
    expect(w.opRows()).toHaveLength(rows);
  });
});
