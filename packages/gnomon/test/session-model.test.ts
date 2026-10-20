/**
 * #session-runner model picker + mid-session switch with the FAKE claude (test/fixtures/fake-claude.mjs) under the
 * real session profile. Never the real claude binary, never Anthropic.
 *
 *   session.open{model}: an alias or strict id lands as `--model`; a flag-looking / unknown value is BAD_REQUEST
 *     before any row, permit or process; `default` opens with no --model.
 */
// @gnomon-platform: darwin
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
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
