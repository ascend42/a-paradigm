/**
 * protected-branch.test — THE PROTECTED-BRANCH LANDING GATE (M2.5 security,
 * TD-2026-08-12-813; Aegis's own finding). #protected closes the laundering route
 * branches opened: an agent isolates work on a private feature branch (guaranteed
 * CLEAN — it is alone there), then clean-MERGEs it into the integration line with
 * NO human, because the KNOT/resolve gate only trips on contest. That bypasses the
 * human gate that is the entire safety model. The fix: name the integration line
 * PROTECTED, and REFUSE an agent-class admit/merge that LANDS onto it — feature
 * branches stay agent-writable, main is a human/policy act.
 *
 * THE DEFAULT-PROTECTION POLICY (chosen to preserve the 1133-test baseline):
 * `selvage` (the trunk) is protected BY DEFAULT, but the agent-class gate ENGAGES
 * only once branching is IN USE (more than one named line exists). In the
 * single-line world (only the trunk) an agent admits onto the trunk EXACTLY as
 * before — there is no feature branch to launder FROM, so nothing to gate — which
 * is why every pre-branch single-line test and the daemon genesis cycle stay
 * green. The gate turns on the instant a feature branch opens, the exact state in
 * which the laundering route becomes reachable.
 *
 * No git anywhere — native fabric end to end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { createBranch } from '../src/fabric/branch.js';
import { mergeBranch } from '../src/fabric/merge.js';
import { readRef } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { RefusedError, type Refusal } from '../src/fabric/refusal.js';
import {
  isProtected,
  listProtected,
  protectBranch,
  unprotectBranch,
  branchingInUse,
  protectedLandingRefusal,
} from '../src/fabric/protected.js';
import { agentShellId, AGENT_ID_ENV } from '../src/agent-shell.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `warpline-protected-${prefix}-`));
  tmpDirs.push(d);
  return d;
}

/** Genesis a native fabric on selvage with one base file. Returns {root, wdir}. */
async function genesis(base: Record<string, string> = { 'src/mod.ts': 'export function foo() { return 1; }\n' }): Promise<{ root: string; wdir: string }> {
  const root = tmp('root');
  const wdir = warplineDirOf(root);
  for (const [rel, body] of Object.entries(base)) write(root, rel, body);
  await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
  await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
  return { root, wdir };
}

/** Fork off the base, apply edits, admit onto `onto`. */
async function branchWork(root: string, agentId: string, onto: string, edits: Record<string, string>): Promise<void> {
  const dir = tmp(agentId);
  forkNative(root, agentId, { into: dir });
  for (const [rel, body] of Object.entries(edits)) write(dir, rel, body);
  await proposeNative(root, { worktree: dir, agentId, intent: `${agentId} work` });
  await admitNative(root, { worktree: dir, agentId, onto, noRestore: true, principal: 'human' });
}

describe('#protected — the agent-class landing gate', () => {
  beforeEach(() => (tmpDirs.length = 0));
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  // ── (a) an AGENT merge into a protected branch is REFUSED ───────────────────
  it('(a) an AGENT merge into a PROTECTED branch is REFUSED — principal:human, ref unmoved', async () => {
    const { root, wdir } = await genesis();
    createBranch(root, 'feature'); // now 2 lines: selvage (protected default) + feature
    await branchWork(root, 'a', 'feature', { 'src/mod.ts': 'export function foo() { return 42; }\n' });

    const selvageBefore = readRef(wdir, 'selvage');
    expect(isProtected(root, 'selvage')).toBe(true);
    expect(branchingInUse(root)).toBe(true);

    let caught: RefusedError | null = null;
    try {
      await mergeBranch(root, { from: 'feature', into: 'selvage', principal: 'agent', noRestore: true });
    } catch (err) {
      caught = err as RefusedError;
    }
    expect(caught, 'agent merge into protected must throw').toBeInstanceOf(RefusedError);
    const refusal = caught!.refusal as Refusal;
    expect(refusal.code).toBe('FORBIDDEN');
    expect(refusal.retriable).toBe('never');
    // the recovery ladder names the HUMAN path (escalate, never self-retry).
    expect(refusal.next.some((n) => n.principal === 'human' && n.verb === 'merge')).toBe(true);
    // THE FALSIFIER: the protected ref did NOT move — nothing landed.
    expect(readRef(wdir, 'selvage')).toBe(selvageBefore);
  });

  // ── (b) a HUMAN merge into protected proceeds ───────────────────────────────
  it('(b) a HUMAN merge into a protected branch PROCEEDS (subject to the fail-closed rules)', async () => {
    const { root, wdir } = await genesis();
    createBranch(root, 'feature');
    await branchWork(root, 'a', 'feature', { 'src/mod.ts': 'export function foo() { return 42; }\n' });
    const featureTip = readRef(wdir, 'feature');

    // feature is strictly ahead of selvage → a human merge fast-forwards selvage.
    const res = await mergeBranch(root, { from: 'feature', into: 'selvage', principal: 'human', noRestore: true });
    expect(res.refusal, 'a human merge into protected is not refused by the gate').toBeUndefined();
    expect(readRef(wdir, 'selvage')).toBe(featureTip); // selvage advanced (the human landed it)
  });

  it('(b2) an ABSENT principal is treated as HUMAN — the operator console / existing callers are unaffected', async () => {
    const { root, wdir } = await genesis();
    createBranch(root, 'feature');
    await branchWork(root, 'a', 'feature', { 'src/mod.ts': 'export function foo() { return 42; }\n' });
    const featureTip = readRef(wdir, 'feature');
    // no `principal` at all — exactly how merge-falsifier.test and the CLI operator call it.
    const res = await mergeBranch(root, { from: 'feature', into: 'selvage', noRestore: true });
    expect(res.refusal).toBeUndefined();
    expect(readRef(wdir, 'selvage')).toBe(featureTip);
  });

  // ── (c) an agent merge into a NON-protected feature branch proceeds ─────────
  it('(c) an AGENT merge into a NON-protected feature branch PROCEEDS', async () => {
    const { root, wdir } = await genesis({
      'src/a.ts': 'export function alpha() { return 1; }\n',
      'src/b.ts': 'export function beta() { return 2; }\n',
    });
    createBranch(root, 'lineA');
    createBranch(root, 'lineB'); // neither is protected (only selvage is)
    await branchWork(root, 'a', 'lineA', { 'src/a.ts': 'export function alpha() { return 111; }\n' });
    await branchWork(root, 'b', 'lineB', { 'src/b.ts': 'export function beta() { return 222; }\n' });
    const lineBBefore = readRef(wdir, 'lineB');

    expect(isProtected(root, 'lineB')).toBe(false);
    // disjoint LIFTED functions → auto-fold CLEAN; the gate does NOT fire (lineB unprotected).
    const res = await mergeBranch(root, { from: 'lineA', into: 'lineB', principal: 'agent', noRestore: true });
    expect(res.refusal, 'agent merge into an unprotected branch is not gate-refused').toBeUndefined();
    expect(res.sealed).toBe(true);
    expect(res.decision.status).toBe('CLEAN');
    expect(readRef(wdir, 'lineB')).not.toBe(lineBBefore); // lineB advanced
  });

  // ── the ADMIT gate (the direct-land half of the same route) ─────────────────
  it('an AGENT admit ONTO a protected branch is REFUSED once branching is in use; onto a feature branch it proceeds', async () => {
    const { root, wdir } = await genesis();
    createBranch(root, 'feature'); // branching now in use

    // Agent admit ONTO selvage (protected) → refused, selvage unmoved.
    const selvageBefore = readRef(wdir, 'selvage');
    const dir = tmp('agent-sel');
    forkNative(root, 'ag', { into: dir });
    write(dir, 'src/mod.ts', 'export function foo() { return 9; }\n');
    await proposeNative(root, { worktree: dir, agentId: 'ag', intent: 'ag work' });
    let caught: RefusedError | null = null;
    try {
      await admitNative(root, { worktree: dir, agentId: 'ag', onto: 'selvage', principal: 'agent', noRestore: true });
    } catch (err) {
      caught = err as RefusedError;
    }
    expect(caught).toBeInstanceOf(RefusedError);
    expect((caught!.refusal as Refusal).code).toBe('FORBIDDEN');
    expect(readRef(wdir, 'selvage')).toBe(selvageBefore);

    // SAME agent, SAME proposal, admit ONTO the feature branch → proceeds.
    const res = await admitNative(root, { worktree: dir, agentId: 'ag', onto: 'feature', principal: 'agent', noRestore: true });
    expect(res.refusal).toBeUndefined();
    expect(res.sealed).toBe(true);
  });

  // ── (e) the DEFAULT does not break the single-line world ────────────────────
  it('(e) BASELINE — an AGENT admit onto selvage in the SINGLE-LINE world PROCEEDS (byte-identical to pre-gate)', async () => {
    const root = tmp('root');
    const wdir = warplineDirOf(root);
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
    // Genesis admit as an AGENT, onto the (default-protected) selvage, with NO
    // other branch: branchingInUse === false, so the gate does NOT engage.
    expect(branchingInUse(root)).toBe(false);
    await proposeNative(root, { worktree: root, agentId: 'solo', intent: 'genesis' });
    const res = await admitNative(root, { worktree: root, agentId: 'solo', principal: 'agent', noRestore: true });
    expect(res.refusal, 'single-line agent admit onto selvage must NOT be gated').toBeUndefined();
    expect(res.sealed).toBe(true);
    expect(readRef(wdir, 'selvage')).not.toBeNull();
    // The trunk IS protected by default — the gate simply does not engage alone.
    expect(isProtected(root, 'selvage')).toBe(true);
    expect(branchingInUse(root)).toBe(false);
  });

  it('protectedLandingRefusal — the three-part rule (agent × protected × branching)', async () => {
    const { root } = await genesis();
    const next = [{ verb: 'merge', params: {}, requires: [], principal: 'human' as const }];
    // single-line: no gate regardless of principal.
    expect(protectedLandingRefusal(root, { principal: 'agent', target: 'selvage', next })).toBeNull();
    createBranch(root, 'feature');
    // now branching is in use.
    expect(protectedLandingRefusal(root, { principal: 'agent', target: 'selvage', next })).not.toBeNull();
    expect(protectedLandingRefusal(root, { principal: 'human', target: 'selvage', next })).toBeNull();
    expect(protectedLandingRefusal(root, { principal: undefined, target: 'selvage', next })).toBeNull();
    expect(protectedLandingRefusal(root, { principal: 'agent', target: 'feature', next })).toBeNull();
  });
});

// ── (d) the registry: --protect/--unprotect changes the set; it is human-class ──
describe('#protected — the registry (protect/unprotect) and its human-class law', () => {
  beforeEach(() => (tmpDirs.length = 0));
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('(d) the DEFAULT protects the trunk; protect/unprotect change the set (authoritative once written)', async () => {
    const { root } = await genesis();
    // Default: selvage protected, no file written.
    expect(listProtected(root)).toEqual(['selvage']);
    expect(isProtected(root, 'selvage')).toBe(true);
    expect(isProtected(root, 'feature')).toBe(false);

    // PROTECT a feature branch.
    const p = protectBranch(root, 'release');
    expect(p.changed).toBe(true);
    expect(listProtected(root)).toContain('release');
    expect(listProtected(root)).toContain('selvage');
    expect(protectBranch(root, 'release').changed).toBe(false); // idempotent

    // UNPROTECT the trunk — the written file is AUTHORITATIVE, so the default
    // no longer re-adds selvage.
    const u = unprotectBranch(root, 'selvage');
    expect(u.changed).toBe(true);
    expect(isProtected(root, 'selvage')).toBe(false);
    expect(listProtected(root)).toEqual(['release']);
    expect(unprotectBranch(root, 'selvage').changed).toBe(false); // idempotent
  });

  it('(d) protect/unprotect is derived HUMAN-class by the same $WARPLINE_AGENT_ID credential the landing gate uses', () => {
    // The CLI classifies via agentShellId: an UNMARKED shell is the human
    // operator; a shell exporting $WARPLINE_AGENT_ID is an agent's (and is refused
    // from protect/unprotect). This pins the derivation the CLI guard rests on.
    expect(agentShellId({ [AGENT_ID_ENV]: 'bot-7' })).toBe('bot-7'); // → agent-class
    expect(agentShellId({})).toBeNull(); // unmarked → human-class
    expect(agentShellId({ [AGENT_ID_ENV]: '   ' })).toBeNull(); // whitespace-only → unmarked
  });

  it.skipIf(!haveDist)('(d) e2e — an AGENT shell is REFUSED `branch --protect`; an operator shell is not', async () => {
    const { root } = await genesis();
    const run = (env: NodeJS.ProcessEnv) =>
      execFileAsync(process.execPath, [distCli, 'branch', '--protect', 'release', '--root', root, '--json'], {
        env: { ...process.env, ...env },
      }).then(
        (r) => ({ code: 0, ...r }),
        (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }),
      );

    // AGENT shell → refused (FORBIDDEN, non-zero exit), the set unchanged.
    const agent = await run({ [AGENT_ID_ENV]: 'bot-7' });
    expect(agent.code).not.toBe(0);
    expect(isProtected(root, 'release')).toBe(false);

    // Operator (unmarked) shell → allowed, the set changes.
    const human = await run({ [AGENT_ID_ENV]: '' });
    expect(human.code).toBe(0);
    expect(isProtected(root, 'release')).toBe(true);
  });
});
