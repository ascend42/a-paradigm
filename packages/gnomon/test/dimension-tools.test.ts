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

