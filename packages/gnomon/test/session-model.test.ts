/**
 * #session-runner model picker + mid-session switch with the FAKE claude (test/fixtures/fake-claude.mjs) under the
 * real session profile. Never the real claude binary, never Anthropic.
 *
 *   session.open{model}: an alias or strict id lands as `--model`; a flag-looking / unknown value is BAD_REQUEST
 *     before any row, permit or process; `default` opens with no --model.
 *   request.session.model (8.0:model-switch): success / error / timeout -> reconcile, the context guard (main chain
 *     only), send refused while switching, non-human / running-turn / local refused, the port's closed payload.
 */
// @gnomon-platform: darwin
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const HUMAN = 'p:abcdefgh/founder';
let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

export function modelRig() {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload });
  };
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const sup = new SessionSupervisor({ log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 200, allowScripts: true });
  live.push(() => children.stopAll('test-end'));
  const kinds = (k: string) => rows.filter((r) => r.kind === k);
  return { rows, fuse, sup, kinds };
}
const open = (s: SessionSupervisor, over: Record<string, unknown> = {}) => s.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd, ...over });
const argvOf = () => trace(w).filter((t) => t.t === 'argv').map((t) => t.args as string[]);
async function refusal(p: Promise<unknown>): Promise<RefusedError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  return e as RefusedError;
}

describe.skipIf(!SANDBOX_OK)('model picker: session.open{model}', () => {
  it.each(['opus', 'sonnet', 'haiku', 'fable', 'claude-opus-5-5'])('%s lands as --model and on session.open + the spawn permit', async (m) => {
    const r = modelRig();
    setMode(w, {});
    const o = await open(r.sup, { model: m });
    expect(await waitFor(() => argvOf().length > 0)).toBe(true);
    const a = argvOf()[0]!;
    expect(a[a.indexOf('--model') + 1]).toBe(m);
    expect(r.kinds('session.open')[0]!.payload.model).toBe(m);
    expect((r.kinds('permit.grant')[0]!.payload.permit as { model: string }).model).toBe(m);
    expect(r.sup.modelOf(o.hsid)).toBe(m);
  });
  it('default opens with no --model (Claude Code chooses)', async () => {
    const r = modelRig();
    setMode(w, {});
    await open(r.sup, { model: 'default' });
    expect(await waitFor(() => argvOf().length > 0)).toBe(true);
    expect(argvOf()[0]).not.toContain('--model');
  });
  it.each(['--dangerously-skip-permissions', '--verbose', '-p', 'opus --bare', 'gpt-5', '../../bin/x'])('%s is BAD_REQUEST before any row, permit or process', async (m) => {
    const r = modelRig();
    setMode(w, {});
    const e = await refusal(open(r.sup, { model: m }));
    expect(e.refusal.code).toBe('BAD_REQUEST');
    expect(r.kinds('session.open')).toEqual([]);
    expect(r.kinds('permit.reserve')).toEqual([]);
    expect(argvOf()).toEqual([]);
  });
});

/* ── 8.0:model-switch: request.session.model (the mid-session switch) ─────────────────────────────────────── */

function switchRig(over: Record<string, unknown> = {}) {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload });
  };
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const sup = new SessionSupervisor({ log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 200, allowScripts: true, modelSwitchTimeoutMs: 400, ...over });
  live.push(() => children.stopAll('test-end'));
  const kinds = (k: string) => rows.filter((r) => r.kind === k);
  const spawnGrants = () => kinds('permit.grant').map((g) => g.payload.permit as { permitId: string; kind: string; model: string; billing: string }).filter((p) => p.kind === 'session.spawn');
  const released = () => kinds('permit.release').map((x) => x.payload.permitId);
  const setModels = () => trace(w).filter((t) => t.t === 'set-model').map((t) => t.model);
  return { rows, fuse, sup, kinds, spawnGrants, released, setModels };
}
async function turn(r: ReturnType<typeof switchRig>, hsid: string, n: number): Promise<void> {
  await r.sup.send(HUMAN, { hsid, text: `turn ${n}` });
  expect(await waitFor(() => r.kinds('turn.result').length >= n)).toBe(true);
}

describe.skipIf(!SANDBOX_OK)('model switch: request.session.model', () => {
  it('success: request row, a NEW subscription spawn permit for the new model, set_model sent, the old permit released, session.model{switched}', async () => {
    const r = switchRig();
    setMode(w, {});
    const o = await open(r.sup, { model: 'haiku' });
    await turn(r, o.hsid, 1);
    const old = r.spawnGrants()[0]!;
    const res = await r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, 'human');
    const fresh = r.spawnGrants()[1]!;
    expect(res).toEqual({ hsid: o.hsid, from: 'haiku', to: 'sonnet', outcome: 'switched', permitId: fresh.permitId });
    expect(fresh).toMatchObject({ model: 'sonnet', billing: 'subscription' });
    expect(r.setModels()).toEqual(['sonnet']);
    expect(r.released()).toContain(old.permitId);
    expect(r.released()).not.toContain(fresh.permitId);
    expect(r.kinds('request.session.model').map((x) => x.payload)).toEqual([{ hsid: o.hsid, model: 'sonnet' }]);
    expect(r.kinds('session.model').map((x) => x.payload)).toEqual([{ hsid: o.hsid, from: 'haiku', to: 'sonnet', permitId: fresh.permitId, outcome: 'switched' }]);
    expect(r.kinds('session.inject').some((x) => x.payload.channel === 'model')).toBe(true);
    // the row order: request, then the permit, then the set_model inject, then the outcome
    const order = r.rows.map((x) => x.kind);
    expect(order.indexOf('request.session.model')).toBeLessThan(order.lastIndexOf('permit.grant'));
    expect(order.lastIndexOf('permit.grant')).toBeLessThan(order.indexOf('session.model'));
    expect(r.sup.modelOf(o.hsid)).toBe('sonnet');
    // the conversation continues on the same process: the next turn's usage is charged to the new spawn permit
    await turn(r, o.hsid, 2);
    const after = r.rows.slice(r.rows.findIndex((x) => x.kind === 'session.model'));
    const usage = after.filter((x) => x.kind === 'budget.usage' && !x.payload.malformed);
    expect(usage.length).toBeGreaterThan(0);
    expect(new Set(usage.map((u) => u.payload.permitId))).toEqual(new Set([fresh.permitId]));
    expect(r.sup.status().find((x) => x.hsid === o.hsid)).toMatchObject({ model: 'sonnet', permitId: fresh.permitId });
  });
  it('error: claude refuses the model -> MODEL_UNAVAILABLE{model-switch-failed} with its error code, the new permit released, nothing changed', async () => {
    const r = switchRig();
    setMode(w, { setModel: 'error' });
    const o = await open(r.sup, { model: 'haiku' });
    const old = r.spawnGrants()[0]!;
    const e = await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'claude-not-real-1' }, 'human'));
    expect(e.refusal.code).toBe('MODEL_UNAVAILABLE');
    expect(e.refusal.data).toMatchObject({ reason: 'model-switch-failed', errorCode: 'catalog_unknown' });
    const fresh = r.spawnGrants()[1]!;
    expect(r.released()).toContain(fresh.permitId);
    expect(r.released()).not.toContain(old.permitId);
    expect(r.kinds('session.model').map((x) => x.payload.outcome)).toEqual(['backend-refused']);
    expect(r.sup.modelOf(o.hsid)).toBe('haiku');
    expect(r.sup.status().find((x) => x.hsid === o.hsid)).toMatchObject({ permitId: old.permitId });
  });
  it('timeout -> ENGINE{model-switch-timeout}, modelUncertain in status, then the next message.model RECONCILES it (session.model{reconciled})', async () => {
    const r = switchRig();
    setMode(w, { setModel: 'silent' }); // claude switches but its answer is lost
    const o = await open(r.sup, { model: 'haiku' });
    await turn(r, o.hsid, 1);
    const old = r.spawnGrants()[0]!;
    const e = await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, 'human'));
    expect(e.refusal.code).toBe('ENGINE');
    expect(e.refusal.data).toMatchObject({ reason: 'model-switch-timeout', uncertain: true });
    const fresh = r.spawnGrants()[1]!;
    expect(r.released()).toContain(fresh.permitId);
    expect(r.kinds('session.model').map((x) => x.payload.outcome)).toEqual(['timeout']);
    expect(r.sup.modelOf(o.hsid)).toBe('haiku'); // the old model stays on record
    expect(r.sup.status().find((x) => x.hsid === o.hsid)).toMatchObject({ model: 'haiku', modelUncertain: true, modelTarget: 'sonnet' });
    await turn(r, o.hsid, 2);
    expect(await waitFor(() => r.kinds('session.model').length === 2)).toBe(true);
    expect(r.kinds('session.model')[1]!.payload).toEqual({ hsid: o.hsid, from: 'haiku', to: 'sonnet', permitId: old.permitId, outcome: 'reconciled' });
    expect(r.sup.modelOf(o.hsid)).toBe('sonnet');
    expect(r.sup.status().find((x) => x.hsid === o.hsid)).not.toHaveProperty('modelUncertain');
  });
  it('timeout where the switch never took -> reconciled back to the old model', async () => {
    const r = switchRig();
    setMode(w, { setModel: 'silent-keep' });
    const o = await open(r.sup);
    await turn(r, o.hsid, 1);
    await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'opus' }, 'human'));
    await turn(r, o.hsid, 2);
    expect(await waitFor(() => r.kinds('session.model').length === 2)).toBe(true);
    expect(r.kinds('session.model')[1]!.payload).toMatchObject({ from: 'claude', to: 'claude', outcome: 'reconciled' });
    expect(r.sup.modelOf(o.hsid)).toBe('claude');
  });
  it('send is refused model-switching while a switch is in flight', async () => {
    const r = switchRig({ modelSwitchTimeoutMs: 2_000 });
    setMode(w, { setModelDelayMs: 600 });
    const o = await open(r.sup, { model: 'haiku' });
    const sw = r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, 'human');
    expect(await waitFor(() => r.setModels().length === 1)).toBe(true);
    const e = await refusal(r.sup.send(HUMAN, { hsid: o.hsid, text: 'now' }));
    expect(e.refusal.data).toMatchObject({ reason: 'model-switching' });
    const e2 = await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'opus' }, 'human'));
    expect(e2.refusal.data).toMatchObject({ reason: 'model-switching' });
    expect(r.sup.status().find((x) => x.hsid === o.hsid)).toMatchObject({ modelSwitching: 'sonnet' });
    await expect(sw).resolves.toMatchObject({ outcome: 'switched' });
  });
  it('context guard: a [1m] session above 160k is refused context-too-large toward a 200k model (subagent usage never counts); a [1m] target passes', async () => {
    const r = switchRig();
    setMode(w, { contextTokens: 170_000 });
    const o = await open(r.sup, { model: 'opus[1m]' });
    await turn(r, o.hsid, 1);
    const e = await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, 'human'));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.data).toMatchObject({ reason: 'context-too-large', contextTokens: 170_000, maxTokens: 160_000 });
    expect(r.kinds('request.session.model')).toEqual([]);
    expect(r.spawnGrants()).toHaveLength(1);
    await expect(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet[1m]' }, 'human')).resolves.toMatchObject({ outcome: 'switched' });
  });
  it('context guard counts the main chain only: a big subagent message does not trip it', async () => {
    const r = switchRig();
    setMode(w, { subagentTokens: 500_000 });
    const o = await open(r.sup, { model: 'opus[1m]' });
    await turn(r, o.hsid, 1);
    await expect(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, 'human')).resolves.toMatchObject({ outcome: 'switched' });
  });
  it.each(['agent', 'session', 'voice', 'mod'])('a %s principal is refused FORBIDDEN before any row', async (cls) => {
    const r = switchRig();
    setMode(w, {});
    const o = await open(r.sup);
    const e = await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, cls));
    expect(e.refusal.code).toBe('FORBIDDEN');
    expect(r.kinds('request.session.model')).toEqual([]);
    expect(r.setModels()).toEqual([]);
  });
  it('a running turn is refused turn-running; a flag-looking model is BAD_REQUEST; another principal is NOT_FOUND', async () => {
    const r = switchRig();
    setMode(w, { permissionAsk: { steps: [], hold: true } });
    const o = await open(r.sup);
    await r.sup.send(HUMAN, { hsid: o.hsid, text: 'hold' });
    const e = await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: 'sonnet' }, 'human'));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.data).toMatchObject({ reason: 'turn-running' });
    expect((await refusal(r.sup.switchModel(HUMAN, { hsid: o.hsid, model: '--verbose' }, 'human'))).refusal.code).toBe('BAD_REQUEST');
    expect((await refusal(r.sup.switchModel('p:abcdefgh/other', { hsid: o.hsid, model: 'sonnet' }, 'human'))).refusal.code).toBe('NOT_FOUND');
    expect(r.kinds('request.session.model')).toEqual([]);
  });
  it('a gnomon-local session is refused local-session', async () => {
    const r = switchRig();
    const spy = vi.spyOn(LocalLane.prototype, 'has').mockReturnValue(true);
    try {
      const e = await refusal(r.sup.switchModel(HUMAN, { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', model: 'sonnet' }, 'human'));
      expect(e.refusal.code).toBe('UNSUPPORTED');
      expect(e.refusal.data).toMatchObject({ reason: 'local-session' });
    } finally {
      spy.mockRestore();
    }
    expect(r.kinds('request.session.model')).toEqual([]);
  });
  it('the session port takes {hsid, model} only', async () => {
    const r = switchRig();
    setMode(w, {});
    const port = createSessionPort(r.sup);
    const o = await open(r.sup);
    const ctx = { principal: HUMAN, principalClass: 'human' };
    expect((await refusal(port.model(ctx, { hsid: o.hsid, model: 'sonnet', permitId: 'x' }))).refusal.code).toBe('BAD_REQUEST');
    expect((await refusal(port.model({ ...ctx, principalClass: 'agent' }, { hsid: o.hsid, model: 'sonnet' }))).refusal.code).toBe('FORBIDDEN');
    await expect(port.model(ctx, { hsid: o.hsid, model: 'sonnet' })).resolves.toMatchObject({ outcome: 'switched' });
  });
});
