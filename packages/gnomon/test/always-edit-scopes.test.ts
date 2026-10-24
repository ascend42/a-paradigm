// @gnomon-platform: darwin
/**
 * Scoped edit always rules (TD-2026-10-23-939 follow-up), Aegis re-review: H1 (a repo-edits rule is auto-edits by
 * another name, so it never passes where the strictness ceiling forbids auto-edits, and the emergency brake stops it)
 * and L3 (manual with an approved plan, match-time symlink / gate-class / flagged refusals, loop sessions). Live
 * sessions over the fake claude, a REAL broker, RunModeControl (with a strictness level) and a REAL RuleBook folded
 * from the rig's kernel-signed rows.
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
import { loopClampAllows } from '../src/kernel/supervisor/loop-clamp.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { RuleBook } from '../src/kernel/supervisor/rules.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';
import { ASK_GUI, controlRig, HUMAN, KP } from './run-mode-helpers.js';
import { PKG_ROOT } from './helpers.js';

const SANDBOX_OK = darwinFloor().ok;
let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function rig() {
  w = sessionWorld();
  const level: { v: 'L0' | 'L1' | 'L2' | 'L3' } = { v: 'L0' };
  const r = controlRig({ level: () => level.v });
  const rules = new RuleBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
  let folded = 0;
  const syncRules = (): RuleBook => {
    for (; folded < r.rows.length; folded++) rules.fold({ seq: folded + 1, kind: r.rows[folded]!.kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(r.rows[folded]!.payload) });
    return rules;
  };
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    r.rows.push({ kind, payload });
    r.book.fold({ seq: r.rows.length, kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(payload) });
  };
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({ kernel, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  // eslint-disable-next-line prefer-const
  let control: RunModeControl;
  const sup: SessionSupervisor = new SessionSupervisor({
    log, children, fuse, broker: r.broker, home: w.home, userHome: w.userHome, kernelPrincipal: KP, sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude,
    env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 10_000, allowScripts: true,
    runMode: (hsid, repoKey) => control.view(hsid, repoKey),
    alwaysRule: (repoKey, tool, hash, input, ctx) => syncRules().match(repoKey, tool, hash, input, ctx),
  });
  control = new RunModeControl({
    broker: r.broker, book: () => r.book, level: () => level.v,
    sessions: { scope: (h) => sup.scopeOf(h), live: () => sup.liveScopes() },
    logRequest: (payload, ids) => log('request.mode.set', { ...payload }, ids as never),
    repoKeyOfPath: (abs) => repoKeyOf([abs]), userHome: w.userHome, onChange: () => sup.noteModeChange(),
    editRule: (repo) => syncRules().repoEditsRule(repo)?.ruleId ?? null,
  });
  const port = createSessionPort(sup, control);
  live.push(() => children.stopAll('test-end'));
  const repo = repoKeyOf([w.cwd]);
  let n = 0;
  /** seed a kernel-signed always rule (learned at the current level) */
  const learn = async (scope: { kind: 'repo-edits' } | { kind: 'file'; path: string }): Promise<string> => {
    const cardId = `card:01HZZZZZZZZZZZZZZZZZZZZZ${String.fromCharCode(65 + n++)}${String.fromCharCode(65 + n)}`;
    await log('approval.request', { card: { cardId, kind: 'permission' }, tool: 'Write', tool_input: { file_path: path.join(w.cwd, 'seed.txt'), content: 's' } });
    await log('approval.decide', { cardId, decision: 'always', scope: { kind: scope.kind } });
    await log('approval.rule.learned', { cardId, tool: 'Write', match: scope.kind, ...(scope.kind === 'file' ? { path: scope.path } : {}), presence: 'fresh', repoKey: repo });
    return cardId;
  };
  const answers = () => trace(w).filter((t) => t.t === 'perm-answer');
  const pending = () => r.broker.cards().filter((c) => c.state === 'pending');
  const autos = () => r.rows.filter((x) => x.kind === 'approval.auto').map((x) => x.payload.modeRef);
  const run = async (steps: unknown[], hold = true) => {
    setMode(w, { permissionAsk: { steps, hold } });
    const s = (await port.open({ principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' }, { cwd: w.cwd, attended: true })) as { hsid: string };
    await sup.send(HUMAN, { hsid: s.hsid, text: 'go' });
    return s;
  };
  return { ...r, sup, control, level, learn, answers, pending, autos, run, repo, rules: syncRules };
}
const wr = (id: string, file: string, content = 'x') => ({ request: { id, tool: 'Write', input: { file_path: path.join(w.cwd, file), content } } });

describe.skipIf(!SANDBOX_OK)('Aegis H1: a repo-edits rule never passes where the ceiling forbids auto-edits', () => {
  it('at L2 a repo-edits rule raises a card, and the card offers only "this file"', async () => {
    const r = rig();
    r.level.v = 'L2';
    await r.learn({ kind: 'repo-edits' });
    await r.run([wr('l2', 'a.txt')]);
    expect(await waitFor(() => r.pending().length === 1, 10_000)).toBe(true);
    expect(r.autos()).toEqual([]);
    const node = JSON.stringify(r.pending()[0]!.block);
    expect(node).toContain('"editScopes":["file"]');
    expect(node).not.toContain('repo-edits');
    expect((r.control.status().sessions as Array<Record<string, unknown>>)[0]).not.toHaveProperty('editsByRule');
  }, 40_000);

  it('a rule learned at L0 passes there, then stops after a raise to L2 (and the chip says nothing)', async () => {
    const r = rig();
    const id = await r.learn({ kind: 'repo-edits' });
    await r.run([wr('l0', 'b.txt')]);
    expect(await waitFor(() => r.answers().some((a) => a.id === 'l0'), 10_000)).toBe(true);
    expect(r.autos()).toEqual([`rule:${id}`]);
    expect((r.control.status().sessions as Array<Record<string, unknown>>)[0]).toMatchObject({ editsByRule: id });
    r.level.v = 'L2';
    await r.run([wr('l2b', 'c.txt')]);
    expect(await waitFor(() => r.pending().length === 1, 10_000)).toBe(true);
    expect(r.autos()).toEqual([`rule:${id}`]);
  }, 40_000);

  it('the emergency brake (a repo tightened) stops the repo-edits rule; a file rule survives it', async () => {
    const r = rig();
    const repoRule = await r.learn({ kind: 'repo-edits' });
    const fileRule = await r.learn({ kind: 'file', path: path.join(w.cwd, 'keep.txt') });
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'ask' }); // the brake: tighten, no presence
    expect(r.rules().get(repoRule)).toBeNull();
    expect(r.rules().get(fileRule)).not.toBeNull();
    await r.run([wr('k', 'keep.txt'), wr('o', 'other.txt')]);
    expect(await waitFor(() => r.answers().some((a) => a.id === 'k') && r.pending().length === 1, 10_000)).toBe(true);
    expect(r.autos()).toEqual([`rule:${fileRule}`]);
  }, 40_000);
});

describe.skipIf(!SANDBOX_OK)('Aegis L3: scoped edit rules at match time', () => {
  it('manual with an approved plan: a standing repo-edits rule still raises a card', async () => {
    const r = rig();
    await r.learn({ kind: 'repo-edits' });
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'manual' });
    const s = await r.run([{ request: { tool: 'ExitPlanMode', input: { plan: '1. write m.txt' } } }, wr('m', 'm.txt')]);
    expect(await waitFor(() => r.pending().length === 1, 10_000)).toBe(true);
    await r.approve(r.pending()[0]!.cardId, 'approve-plan');
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'again' });
    expect(await waitFor(() => r.pending().some((c) => c.kind === 'permission'), 10_000)).toBe(true);
    expect(r.autos()).toEqual([]);
  }, 40_000);

  it('a symlinked component, a gate-class path and flagged lines raise cards under both a repo-edits and a file rule', async () => {
    const r = rig();
    fs.mkdirSync(path.join(w.cwd, 'real'));
    fs.symlinkSync(path.join(w.cwd, 'real'), path.join(w.cwd, 'link'));
    await r.learn({ kind: 'repo-edits' });
    await r.learn({ kind: 'file', path: path.join(w.cwd, 'flag.txt') });
    await r.learn({ kind: 'file', path: path.join(w.cwd, 'package.json') });
    await r.run([wr('sym', 'link/x.txt'), wr('gate', 'package.json', '{}'), wr('flag', 'flag.txt', 'evil ‮ txt')]);
    expect(await waitFor(() => r.pending().length === 3, 10_000)).toBe(true);
    expect(r.autos()).toEqual([]);
  }, 40_000);
});

describe('Aegis L3: a loop session never reaches a scoped edit rule', () => {
  const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'kernel', 'supervisor', 'supervisor.ts'), 'utf8');
  it('the rule pass sits behind mayAuto (the loop clamp refuses every rule: modeRef), and no scope is offered in a loop session', () => {
    expect(src).toMatch(/if \(plan\.cardKind === 'permission' && mayAuto\('rule:'\)/);
    expect(loopClampAllows('rule:', undefined)).toBe(false);
    expect(loopClampAllows('rule:card:01HZZZZZZZZZZZZZZZZZZZZZZZ', 'card:01HZZZZZZZZZZZZZZZZZZZZZZY')).toBe(false);
    expect(src).toMatch(/const offered = editPass\?\.ok && loopBy === null \?/);
  });
});
