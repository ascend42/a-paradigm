// @gnomon-platform: darwin
/**
 * #mod-tool-bridge attacks through the real kernel (Probe's S1.4 P5 review attacks X1 to X3, kept as regressions). The
 * production allowlist and pin rule (no modBridge seam), the bundled dimension tree, the fake claude:
 * - X1: an unattached session naming an attached one in arguments, params and _meta sees and draws nothing; an attached
 *   session naming another stays stamped as itself; non-allowlisted, case, space, qualified and prototype-key names
 *   are -32602; a draw or undo after the turn's result is noTurn and writes nothing;
 * - X2: 50 calls in one turn, parallel and then paced at the rate: at most 64 ops apply, exactly 64 when paced, and
 *   the person's dim.op lands both times;
 * - X3: a person's set named by a session never shown it is undo-set-bad (also after a later view); the session that
 *   was shown it may undo it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, foldDim } from '@a-company/gnomon-contracts';
import { modAnswerOf } from '../../gnomon-gui/src/core/dim-session.js';
import { gestureOf } from '../../gnomon-gui/src/core/gesture.js';
import { sendModCommand } from '../../gnomon-gui/src/core/mod-command.js';
import { MOD_BRIDGE_SENTENCES } from '../src/kernel/modhost/mcp-bridge.js';
import { agentAdd, answer, boardRig, cleanups, H, line, press, rectAt } from './bridge-rig.js';
import { DIMENSION, dimId } from './dimension-helpers.js';
import { guiPage } from './dim-gui-page.js';
import { e2eFloorsOk, setMode, waitFor } from './session-helpers.js';

const SANDBOX_OK = e2eFloorsOk('bridge-attacks');
afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
});

describe.skipIf(!SANDBOX_OK)('#mod-tool-bridge attacks through the real kernel (Probe, S1.4 P5 review; regressions)', () => {
  it('X1: cross-session focus/hsid, unattached dim-view, non-allowlisted tools, between-turn draw', async () => {
    const r = await boardRig('pxA-');
    const P = await guiPage(r.k, cleanups);
    const sA = (await r.k.client.call<{ hsid: string }>('session.open', { cwd: r.w.cwd, attended: true })).hsid;
    const dim = dimId(7);
    const a = P.sessions.open({ dim, hsid: sA, opened: 'command', title: 'probe' }, press('click'));
    expect(await a.opened(), JSON.stringify(a.lastNotice())).toBe(true);
    a.edit([rectAt(1, { label: 'secret-label' })], press());
    expect(await waitFor(() => a.status().pending === 0, 20_000, 5)).toBe(true);
    a.select([H(1)], press());
    expect(await waitFor(() => P.answered.includes('dim.select'), 5_000)).toBe(true);
    const sB = (await r.k.client.call<{ hsid: string }>('session.open', { cwd: r.w.cwd, attended: true })).hsid; // NOT attached
    const bridgeRows = () => r.rows([DIM_KINDS.op]).filter((x) => (x.event.payload.relayedFor as { surface?: string } | undefined)?.surface === 'bridge');
    const turnResults = () => r.rows(['turn.result']).length;
    const naming = { focus: { hsid: sA }, hsid: sA, session: sA, as: sA };
    /* B (unattached) names A in the arguments and the params */
    await r.turn(sB, [
      r.tool('bv0', 'dim-view', { dim }),
      r.tool('bv1', 'dim-view', { dim, ...naming }, { hsid: sA, _meta: { hsid: sA } }),
      r.tool('bd1', 'dim-draw', { dim, ops: [agentAdd(1)], ...naming }, { hsid: sA, _meta: { hsid: sA } }),
      r.tool('bd2', 'dim-draw', { dim, ops: [agentAdd(2)], focus: { hsid: sA } }),
      r.tool('bu1', 'dim-undo', { dim, of: { kind: 'turn', hsid: sA, turn: `turn:${sA}/1` } }),
    ]);
    expect(await r.answered(['bv0', 'bv1', 'bd1', 'bd2', 'bu1'])).toBe(true);
    for (const id of ['bv0', 'bv1', 'bd1', 'bd2', 'bu1'])
    for (const id of ['bv0', 'bv1']) expect([id, r.raw(id).includes('secret-label'), r.raw(id).includes(H(1))]).toEqual([id, false, false]);
    expect(bridgeRows()).toHaveLength(0);
    expect(await waitFor(() => turnResults() >= 1, 15_000)).toBe(true);
    /* A (attached, granted) names B: the stamp must stay A's */
    await r.turn(sA, [r.tool('ad1', 'dim-draw', { dim, ops: [agentAdd(3)], focus: { hsid: sB } }, { hsid: sB, _meta: { hsid: sB } })]);
    expect(await r.answered(['ad1'])).toBe(true);
    await r.turn(sA, [r.tool("ad2", "dim-draw", { dim, ops: [agentAdd(4)] }, { hsid: sB, session: sB, _meta: { hsid: sB, "claudecode/sessionId": sB } })]); expect(await r.answered(["ad2"])).toBe(true); expect(bridgeRows()).toHaveLength(1); for (const x of bridgeRows()) expect((x.event.payload.relayedFor as { hsid?: string }).hsid).toBe(sA);
    expect(await waitFor(() => turnResults() >= 3, 15_000)).toBe(true);
    /* non-allowlisted names: the mod's commands, case/space variants, prototype keys, a qualified name */
    const names = ['dim.op', 'dim.grant', 'dim.attach', 'dim.select', 'DIM-DRAW', 'dim-draw ', 'gnomon.dimension/dim-draw', 'mcp__gnomon-mods__dim-draw', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'bridge-echo', ''];
    const bare = (i: number, name: string, args: Record<string, unknown>) => [line(`m-n${i}`, { jsonrpc: '2.0', id: r.nextId(), method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': `toolu_n${i}` } } })];
    const before = r.rows([]).length;
    await r.turn(sA, names.map((n, i) => (n.startsWith('dim.') ? bare(i, n, { dim, write: true, hsid: sB, ops: [agentAdd(9)] }) : r.tool(`n${i}`, n, { dim, ops: [agentAdd(9)] }))));
    expect(await r.answered(names.map((_, i) => `n${i}`))).toBe(true);
    for (let i = 0; i < names.length; i++) {
      const ans = answer(r.w, `m-n${i}`)!;
      expect([names[i], ans.mcp?.error?.code ?? 'NO-ERROR']).toEqual([names[i], -32602]);
    }
    expect(bridgeRows().length).toBe(1);
    expect(a.grantKeys().find((x) => x.hsid === sB)?.write ?? false).toBe(false);
    expect(await waitFor(() => turnResults() >= 4, 15_000)).toBe(true);
    /* between turns: a dim-draw after the result (no turn) */
    const nOps = bridgeRows().length;
    setMode(r.w, { reloadPerTurn: true, permissionAsk: { hold: false, steps: [], afterResult: [line('m-late', { jsonrpc: '2.0', id: r.nextId(), method: 'tools/call', params: { name: 'dim-draw', arguments: { dim, ops: [agentAdd(40)] } } }).line, line('m-late2', { jsonrpc: '2.0', id: r.nextId(), method: 'tools/call', params: { name: 'dim-undo', arguments: { dim, of: { kind: 'turn', hsid: sA, turn: `turn:${sA}/1` } } } }).line] } });
    await r.send(sA);
    expect(await r.answered(['late', 'late2'])).toBe(true);
    expect([r.raw('late'), r.raw('late2')]).toEqual([MOD_BRIDGE_SENTENCES.noTurn, MOD_BRIDGE_SENTENCES.noTurn]);
    await new Promise((x) => setTimeout(x, 500));
    expect(bridgeRows().length).toBe(nOps);
    await r.k.client.call('session.stop', { hsid: sA });
    await r.k.client.call('session.stop', { hsid: sB });
  }, 180_000);

  it('X2: a burst of 50 calls in one turn, parallel and paced; the budget holds and the person\'s dim.op lands', async () => {
    const r = await boardRig('pxB-');
    const P = await guiPage(r.k, cleanups);
    const sA = (await r.k.client.call<{ hsid: string }>('session.open', { cwd: r.w.cwd, attended: true })).hsid;
    const dim = dimId(8);
    const a = P.sessions.open({ dim, hsid: sA, opened: 'command', title: 'burst' }, press('click'));
    expect(await a.opened(), JSON.stringify(a.lastNotice())).toBe(true);
    a.edit([rectAt(1)], press());
    expect(await waitFor(() => a.status().pending === 0, 20_000, 5)).toBe(true);
    const bridgeRows = () => r.rows([DIM_KINDS.op]).filter((x) => (x.event.payload.relayedFor as { surface?: string } | undefined)?.surface === 'bridge');
    const appliedOps = () => bridgeRows().reduce((n, x) => n + ((x.event.payload.ops as unknown[] | undefined)?.length ?? 1), 0);
    const turnResults = () => r.rows(['turn.result']).length;
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    /* parallel: all 50 written at once, each 2 ops */
    setMode(r.w, { reloadPerTurn: true, permissionAsk: { hold: false, awaitMcp: true, steps: ids.flatMap((id, i) => r.tool(id, 'dim-draw', { dim, ops: [agentAdd(i * 2), agentAdd(i * 2 + 1)] })) } });
    const t0 = Date.now();
    await r.send(sA);
    a.edit([rectAt(60)], press());
    expect(await r.answered(ids, 60_000)).toBe(true);
    expect(await waitFor(() => a.status().pending === 0, 10_000, 5)).toBe(true);
    const cls = new Map<string, number>();
    let applied = 0;
    for (const id of ids) {
      const t = r.raw(id);
      let k = t.slice(0, 50);
      try { const b = r.body<{ ok?: boolean; code?: string; applied?: number }>(id); k = b.ok ? 'ok' : `code:${b.code}`; applied += b.applied ?? 0; } catch { /* a bridge sentence */ }
      cls.set(k, (cls.get(k) ?? 0) + 1);
    }
    expect(applied).toBeLessThanOrEqual(64);
    expect(a.lastNotice()?.code ?? 'grant-default').not.toMatch(/busy|rate/);
    const has60 = () => foldDim(r.rows([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op]).filter((x) => x.event.payload.dim === dim).map((x) => ({ seq: x.seq, kind: x.event.kind, payload: x.event.payload })) as never).nodes.has(H(60));
    expect(has60()).toBe(true);
    expect(await waitFor(() => turnResults() >= 1, 15_000)).toBe(true);
    /* paced: 50 calls, 2 ops each, one at a time at the rate: exactly 64 apply */
    const ids2 = Array.from({ length: 50 }, (_, i) => `q${i}`);
    setMode(r.w, { reloadPerTurn: true, permissionAsk: { hold: false, awaitMcp: true, serial: true, gapMs: 260, steps: ids2.flatMap((id, i) => r.tool(id, 'dim-draw', { dim, ops: [agentAdd(500 + i * 2), agentAdd(501 + i * 2)] })) } });
    const rows0 = appliedOps();
    await r.send(sA);
    await new Promise((x) => setTimeout(x, 2_000));
    a.edit([rectAt(61)], press());
    expect(await r.answered(ids2, 90_000)).toBe(true);
    expect(await waitFor(() => a.status().pending === 0, 10_000, 5)).toBe(true);
    const cls2 = new Map<string, number>();
    let applied2 = 0;
    for (const id of ids2) {
      let k = r.raw(id).slice(0, 50);
      try { const b = r.body<{ ok?: boolean; code?: string; applied?: number }>(id); k = b.ok ? 'ok' : `code:${b.code}`; applied2 += b.applied ?? 0; } catch { /* sentence */ }
      cls2.set(k, (cls2.get(k) ?? 0) + 1);
    }
    expect(applied2).toBe(64);
    const has61 = () => foldDim(r.rows([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op]).filter((x) => x.event.payload.dim === dim).map((x) => ({ seq: x.seq, kind: x.event.kind, payload: x.event.payload })) as never).nodes.has(H(61));
    expect(has61()).toBe(true);
    await r.k.client.call('session.stop', { hsid: sA });
  }, 240_000);

  it('X3: dim-undo naming the person\'s set the caller was never shown (another session was)', async () => {
    const r = await boardRig('pxC-');
    const P = await guiPage(r.k, cleanups);
    const sA = (await r.k.client.call<{ hsid: string }>('session.open', { cwd: r.w.cwd, attended: true })).hsid;
    const dim = dimId(9);
    const a = P.sessions.open({ dim, hsid: sA, opened: 'command', title: 'undo' }, press('click'));
    expect(await a.opened(), JSON.stringify(a.lastNotice())).toBe(true);
    const sB = (await r.k.client.call<{ hsid: string }>('session.open', { cwd: r.w.cwd, attended: true })).hsid;
    const cmd = async (commandId: string, args: Record<string, unknown>, hsid: string) => modAnswerOf(await sendModCommand(P.client, gestureOf({ isTrusted: true, type: 'pointerup' }, Date.now()), DIMENSION, commandId, { ...args, dim, focus: { hsid } })) as Record<string, unknown>;
    expect(await cmd('dim.attach', {}, sB)).toMatchObject({ ok: true });
    expect(a.grant(sB, press())).toBe(true);
    expect(await waitFor(() => a.grantKeys().find((x) => x.hsid === sB)?.write === true, 10_000)).toBe(true);
    const dimFold = () => foldDim(r.rows([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op]).filter((x) => x.event.payload.dim === dim).map((x) => ({ seq: x.seq, kind: x.event.kind, payload: x.event.payload })) as never);
    const pre = dimFold().seq;
    a.edit([rectAt(1, { label: 'mine' })], press());
    expect(await waitFor(() => a.status().pending === 0, 20_000, 5)).toBe(true);
    const turnResults = () => r.rows(['turn.result']).length;
    const seq0 = Math.max(0, ...r.rows([DIM_KINDS.op]).map((x) => x.seq)) - 1;
    await r.turn(sA, [r.tool('av', 'dim-view', { dim, since: pre })]);
    expect(await r.answered(['av'])).toBe(true);
    const changes = r.body<{ changes: Array<{ set: Record<string, unknown> }> }>('av').changes;
    const personSet = changes.filter((c) => Object.hasOwn(c.set, 'act')).at(-1)!.set;
    expect(personSet).toBeTruthy();
    expect(await waitFor(() => turnResults() >= 1, 15_000)).toBe(true);
    /* B never viewed; it names the person's set A was shown */
    await r.turn(sB, [r.tool('bu', 'dim-undo', { dim, of: personSet })]);
    expect(await r.answered(['bu'])).toBe(true);
    expect(r.body<{ code: string }>('bu').code).toBe('undo-set-bad');
    expect(await waitFor(() => turnResults() >= 2, 15_000)).toBe(true);
    /* B views only AFTER the set (since past it), then names it */
    await r.turn(sB, [r.tool('bv', 'dim-view', { dim, since: dimFold().seq }), r.tool('bu2', 'dim-undo', { dim, of: personSet })]);
    expect(await r.answered(['bv', 'bu2'])).toBe(true);
    expect(r.body<{ code: string }>('bu2').code).toBe('undo-set-bad');
    const label = () => foldDim(r.rows([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op]).filter((x) => x.event.payload.dim === dim).map((x) => ({ seq: x.seq, kind: x.event.kind, payload: x.event.payload })) as never).nodes.get(H(1))?.node.label;
    expect(label()).toBe('mine');
    /* the control: A, who WAS shown the set, may undo it */
    expect(await waitFor(() => turnResults() >= 3, 15_000)).toBe(true);
    await r.turn(sA, [r.tool('au', 'dim-undo', { dim, of: personSet })]);
    expect(await r.answered(['au'])).toBe(true);
    expect(r.body('au'), r.raw('au')).toMatchObject({ ok: true });
    expect(await waitFor(() => label() === undefined, 10_000)).toBe(true);
    await r.k.client.call('session.stop', { hsid: sA });
    await r.k.client.call('session.stop', { hsid: sB });
  }, 180_000);
});
