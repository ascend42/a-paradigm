// @gnomon-platform: darwin
/**
 * P8-D86/D87 run modes in a LIVE session (spec §3.4 "Run modes (D87)"): the
 * #supervisor's permission channel with the run-mode control, a REAL
 * #approval-broker and the FAKE claude (test/fixtures/fake-claude.mjs
 * `permissionAsk`) under the real session profile, like
 * permission-session.test.ts. The pure half is test/run-modes.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunModeControl } from '../src/kernel/broker/index.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';
import { ASK_GUI, controlRig, errOf, HUMAN, KP } from './run-mode-helpers.js';

const SANDBOX_OK = darwinFloor().ok;

/* ── the session half (darwin: the real session profile, the fake claude) ─────────────────────── */

let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function sessionRig() {
  w = sessionWorld();
  const r = controlRig();
  const book = r.book;
  const log = async (kind: string, payload: Record<string, unknown>, ids?: Record<string, unknown>): Promise<void> => {
    r.rows.push({ kind, payload, ...(ids ? { ids } : {}) });
    book.fold({ seq: r.rows.length, kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(payload) });
  };
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({ kernel, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  // eslint-disable-next-line prefer-const
  let control: RunModeControl;
  const sup: SessionSupervisor = new SessionSupervisor({
    log,
    children,
    fuse,
    broker: r.broker,
    home: w.home,
    userHome: w.userHome,
    kernelPrincipal: KP,
    sock: path.join(w.home, 'gnomon.sock'),
    claudePath: w.claude,
    env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }),
    platform: 'darwin',
    watchMs: 10_000,
    allowScripts: true,
    runMode: (hsid, repoKey) => control.view(hsid, repoKey),
  });
  control = new RunModeControl({
    broker: r.broker,
    book: () => book,
    sessions: { scope: (h) => sup.scopeOf(h), live: () => sup.liveScopes() },
    logRequest: (payload, ids) => log('request.mode.set', { ...payload }, ids),
    repoKeyOfPath: (abs) => repoKeyOf([abs]),
  });
  const port = createSessionPort(sup, control);
  live.push(() => children.stopAll('test-end'));
  const answers = () => trace(w).filter((t) => t.t === 'perm-answer');
  const pending = () => r.broker.cards().filter((c) => c.state === 'pending');
  const open = async (steps: unknown[], extra: { runMode?: string; hold?: boolean } = { hold: true }) => {
    setMode(w, { permissionAsk: { steps, hold: extra.hold ?? true } });
    const s = (await port.open({ principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' }, { cwd: w.cwd, attended: true, ...(extra.runMode ? { runMode: extra.runMode } : {}) })) as { hsid: string; runModeCard?: string | null };
    await sup.send(HUMAN, { hsid: s.hsid, text: 'go' });
    return s;
  };
  const req = (id: string, tool: string, input: Record<string, unknown>) => ({ request: { id, tool, input } });
  return { ...r, sup, control, port, answers, pending, open, req, repo: repoKeyOf([w.cwd]) };
}

describe.skipIf(!SANDBOX_OK)('run modes in a live session (fake claude, the real session profile)', () => {
  it('auto-edits: a Write inside the worktree passes with NO card, after approval.auto{hsid, tool, path, inputHash, modeRef}', async () => {
    const r = sessionRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    const target = path.join(w.cwd, 'src.txt');
    const s = await r.open([r.req('ae-1', 'Write', { file_path: target, content: 'auto' })]);
    expect(await waitFor(() => r.answers().some((a) => a.id === 'ae-1'))).toBe(true);
    expect(r.answers().find((a) => a.id === 'ae-1')).toMatchObject({ behavior: 'allow' });
    expect(r.pending()).toHaveLength(0);
    expect(r.kinds('approval.auto')).toEqual([{ hsid: s.hsid, tool: 'Write', path: fs.realpathSync(w.cwd) + '/src.txt', inputHash: expect.stringMatching(/^sha256:/), modeRef: 'mode:auto-edits' }]);
    const autoAt = r.rows.findIndex((x) => x.kind === 'approval.auto');
    const injectAt = r.rows.findIndex((x) => x.kind === 'session.inject' && x.payload.requestId === 'ae-1');
    expect(autoAt).toBeGreaterThanOrEqual(0);
    expect(autoAt).toBeLessThan(injectAt); // log before effect
    expect(await waitFor(() => fs.existsSync(target))).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('auto');
  }, 30_000);

  it('auto-edits still cards Bash, a Write outside the worktree, .claude/settings.json, CLAUDE.md and package.json — never auto-approved', async () => {
    const r = sessionRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    const outside = path.join(w.root, 'outside.txt');
    await r.open([
      r.req('x-bash', 'Bash', { command: 'echo hi' }),
      r.req('x-out', 'Write', { file_path: outside, content: 'o' }),
      r.req('x-claude', 'Write', { file_path: path.join(w.cwd, '.claude', 'settings.json'), content: '{}' }),
      r.req('x-md', 'Edit', { file_path: path.join(w.cwd, 'CLAUDE.md'), old_string: 'a', new_string: 'b' }),
      r.req('x-pkg', 'Write', { file_path: path.join(w.cwd, 'package.json'), content: '{}' }),
    ]);
    // each is either a card (pending) or a deny with no card (a write under the policy's denyWrite) — never an allow
    expect(await waitFor(() => r.pending().length + r.answers().length >= 5, 10_000)).toBe(true);
    expect(r.kinds('approval.auto')).toHaveLength(0);
    expect(r.answers().filter((a) => a.behavior === 'allow')).toHaveLength(0);
    const carded = r.pending().map((c) => JSON.stringify(c.block));
    expect(carded.some((t) => t.includes('echo hi'))).toBe(true); // Bash: a card
    expect(carded.some((t) => t.includes('outside.txt'))).toBe(true); // outside the worktree: a card
    expect(carded.some((t) => t.includes('package.json'))).toBe(true); // gate-class, not denyWrite: a card
    expect(fs.existsSync(outside)).toBe(false);
  }, 30_000);

  it('tightening applies with no presence: auto-edits → ask and the next edit raises a card', async () => {
    const r = sessionRig();
    const s0 = await r.open([], { runMode: 'manual' }); // a stricter-than-repo runMode is set by the open itself
    expect(r.rows.find((x) => x.kind === 'session.open')?.payload).toMatchObject({ hsid: s0.hsid, runMode: 'manual' });
    expect(r.control.view(s0.hsid, r.repo)).toMatchObject({ chosen: 'manual', source: 'session' });
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    const prompts = r.prompts.length;
    const out = await r.control.request(ASK_GUI, { repo: r.repo, to: 'ask' });
    expect(out).toMatchObject({ changed: true, applied: true, presence: 'none' });
    expect(r.prompts.length).toBe(prompts); // no presence prompt
    await r.open([r.req('t-1', 'Write', { file_path: path.join(w.cwd, 'b.txt'), content: 'b' })]);
    expect(await waitFor(() => r.pending().length === 1)).toBe(true);
    expect(r.kinds('approval.auto')).toHaveLength(0);
  }, 30_000);

  it('session.open{runMode}: a looser mode than the repo opens at the repo\'s mode and raises the loosening card; allow applies it', async () => {
    const r = sessionRig();
    const s = await r.open([], { runMode: 'auto-edits' });
    expect(typeof s.runModeCard).toBe('string');
    expect(r.control.view(s.hsid, r.repo).effective).toBe('ask');
    expect(r.rows.find((x) => x.kind === 'session.open')?.payload.runMode).toBeUndefined();
    await r.approve(s.runModeCard!, 'allow');
    expect(r.control.view(s.hsid, r.repo)).toMatchObject({ chosen: 'auto-edits', source: 'session', effective: 'auto-edits' });
    // an unknown runMode on open is BAD_REQUEST and opens nothing
    const e = await errOf(r.port.open({ principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' }, { cwd: w.cwd, attended: true, runMode: 'bypassPermissions' }));
    expect(e.refusal.code).toBe('BAD_REQUEST');
    expect(r.rows.filter((x) => x.kind === 'session.open')).toHaveLength(1);
  }, 30_000);

  it('manual: writes and exec are denied with no card until a plan card in the session is approved; then they card', async () => {
    const r = sessionRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'manual' });
    await r.open([r.req('m-1', 'Write', { file_path: path.join(w.cwd, 'm.txt'), content: 'm' }), r.req('m-2', 'Bash', { command: 'echo x' }), r.req('m-plan', 'ExitPlanMode', { plan: 'do the thing' })]);
    expect(await waitFor(() => r.answers().filter((a) => a.id === 'm-1' || a.id === 'm-2').length === 2 && r.pending().length === 1)).toBe(true);
    expect(r.answers().filter((a) => a.id === 'm-1' || a.id === 'm-2').every((a) => a.behavior === 'deny' && String(a.message).includes('manual mode'))).toBe(true);
    const plan = r.pending()[0]!;
    expect(plan.kind).toBe('plan');
    await r.approve(plan.cardId, 'approve-plan');
    expect(await waitFor(() => r.answers().some((a) => a.id === 'm-plan'))).toBe(true);
    // the same session (the fake claude takes one more turn): a write now raises a card
    setMode(w, { permissionAsk: { steps: [r.req('m-3', 'Write', { file_path: path.join(w.cwd, 'm.txt'), content: 'm' })], hold: true } });
    const hsid = r.sup.liveScopes()[0]!.hsid;
    await r.sup.send(HUMAN, { hsid, text: 'again' }).catch(() => undefined);
    expect(await waitFor(() => r.pending().some((c) => c.kind === 'permission'))).toBe(true);
  }, 30_000);

  it('the repo mode persists across sessions: a second session in the same folder takes it', async () => {
    const r = sessionRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    await r.open([r.req('p-1', 'Write', { file_path: path.join(w.cwd, 'p1.txt'), content: '1' })]);
    expect(await waitFor(() => r.answers().some((a) => a.id === 'p-1'))).toBe(true);
    const s2 = await r.open([r.req('p-2', 'Write', { file_path: path.join(w.cwd, 'p2.txt'), content: '2' })]);
    expect(await waitFor(() => r.answers().some((a) => a.id === 'p-2'))).toBe(true);
    expect(r.control.view(s2.hsid, r.repo)).toMatchObject({ chosen: 'auto-edits', source: 'repo' });
    expect(r.kinds('approval.auto')).toHaveLength(2);
  }, 30_000);
});
