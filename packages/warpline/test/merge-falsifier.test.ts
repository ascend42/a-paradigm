/**
 * merge-falsifier.test — THE ACCEPTANCE GATE for M2.5 (TD-2026-08-12-813 spine,
 * TD-2026-08-12-351 fail-closed rule; Jinx's gate). M2.5 is NOT "done" until this
 * passes: the `merge` verb must catch the two canonical §8 breaks across a REAL
 * branch merge, and must NOT over-hold a genuinely disjoint meaning-decided fold.
 *
 * The rule under test: a branch merge must not silently auto-fold a change MEANING
 * WAS BLIND TO. After a CLEAN weave that would auto-seal, if ANY changed path is
 * BYTE-DECIDED (no lens lifted it), the merge HOLDS — names the path, escalates to
 * a human `--confirm`, and does NOT advance the target ref.
 *
 *   (a) CONFIG×CODE          — a `.js` config value (byte) rides one branch, code
 *                              on another → HOLD naming the config (or KNOT). A
 *                              silent independent-CLEAN here is a FAIL.
 *   (b) NO-SHARED-TOKEN INV. — `export const LIMIT = 100 → 50` (scalar const, NOT
 *                              lifted → byte-decided) on one branch, a loop
 *                              assuming 100 (lifted) on another → HOLD naming the
 *                              LIMIT file. A silent CLEAN is a FAIL.
 *   (c) CONTROL              — two unrelated LIFTED functions, no config/const →
 *                              auto-folds CLEAN, NO hold (the value prop survives;
 *                              the rule does not over-hold everything).
 *   (d) SAME-SYMBOL          — the same function contradicted across branches →
 *                              KNOT (the base case still holds).
 *
 * No git anywhere — native fabric end to end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { createBranch } from '../src/fabric/branch.js';
import { mergeBranch, type MergeBranchResult } from '../src/fabric/merge.js';
import { readRef } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';

type Files = Record<string, string>;

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

interface Scenario {
  res: MergeBranchResult;
  root: string;
  wdir: string;
  lineATip: string;
  lineBBefore: string;
}

/**
 * Build a native fabric with a genesis + two branches that DIVERGE off it, then
 * merge `lineA` (ours/from) INTO `lineB` (theirs/into). `aEdits`/`bEdits` are the
 * files each branch CHANGES relative to the genesis base (unchanged base files are
 * restored into each fork by `fork --into`).
 */
async function scenario(base: Files, aEdits: Files, bEdits: Files, tmpDirs: string[]): Promise<Scenario> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-merge-fals-'));
  tmpDirs.push(root);
  const wdir = warplineDirOf(root);

  // ── Genesis on selvage; two branches at it. ──────────────────────────────
  for (const [rel, body] of Object.entries(base)) write(root, rel, body);
  await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
  await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
  createBranch(root, 'lineA');
  createBranch(root, 'lineB');

  // ── lineA (OURS): fork off the base, apply A's edits, admit onto lineA. ───
  const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-merge-A-'));
  tmpDirs.push(aDir);
  forkNative(root, 'a', { into: aDir });
  for (const [rel, body] of Object.entries(aEdits)) write(aDir, rel, body);
  await proposeNative(root, { worktree: aDir, agentId: 'a', intent: 'A branch work' });
  await admitNative(root, { worktree: aDir, agentId: 'a', onto: 'lineA', noRestore: true });

  // ── lineB (THEIRS): fork off the base, apply B's edits, admit onto lineB. ─
  const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-merge-B-'));
  tmpDirs.push(bDir);
  forkNative(root, 'b', { into: bDir });
  for (const [rel, body] of Object.entries(bEdits)) write(bDir, rel, body);
  await proposeNative(root, { worktree: bDir, agentId: 'b', intent: 'B branch work' });
  await admitNative(root, { worktree: bDir, agentId: 'b', onto: 'lineB', noRestore: true });

  const lineATip = readRef(wdir, 'lineA')!;
  const lineBBefore = readRef(wdir, 'lineB')!;
  const res = await mergeBranch(root, { from: 'lineA', into: 'lineB', noRestore: true });
  return { res, root, wdir, lineATip, lineBBefore };
}

describe('M2.5 MERGE FALSIFIER — the fail-closed rule across a real branch merge', () => {
  const tmpDirs: string[] = [];
  beforeEach(() => tmpDirs.length = 0);
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('(a) CONFIG×CODE — a byte-decided .js config value does NOT auto-fold silently (HOLD or KNOT)', async () => {
    const { res, wdir, lineATip, lineBBefore } = await scenario(
      {
        'config.js': 'module.exports = { LIMIT: 100 };\n', // no lens lifts .js → byte-decided
        'src/a.ts': 'export function alpha() { return 1; }\n',
        'src/b.ts': 'export function beta() { return 2; }\n',
      },
      {
        // lineA (ours) lowers the config value (byte) AND carries a real meaning
        // change (so the merge reaches a CLEAN, not a byte-custody NOOP).
        'config.js': 'module.exports = { LIMIT: 50 };\n',
        'src/a.ts': 'export function alpha() { return 11; }\n',
      },
      { 'src/b.ts': 'export function beta() { return 22; }\n' }, // lineB (theirs) — disjoint code
      tmpDirs,
    );

    // THE FALSIFIER: a silent independent-CLEAN seal here is a FAIL.
    expect(res.sealed, 'a byte-decided config merge must NOT auto-seal').toBe(false);
    expect(['HELD', 'KNOT']).toContain(res.decision.status);
    // It is caught as the MEANING-BLIND HOLD, naming the config path.
    expect(res.meaningBlind?.bytePaths).toContain('config.js');
    expect(res.refusal).toBeDefined();
    // The target ref did NOT move — nothing sealed.
    expect(readRef(wdir, 'lineB')).toBe(lineBBefore);
    // Merge only advances `into`; the merged branch is untouched.
    expect(readRef(wdir, 'lineA')).toBe(lineATip);
  });

  it('(b) NO-SHARED-TOKEN INVARIANT — a scalar `const LIMIT` (byte-decided) HOLDS, naming the file', async () => {
    const { res, wdir, lineBBefore } = await scenario(
      {
        'src/limits.ts': 'export const LIMIT = 100;\n', // scalar const — NOT lifted → byte-decided
        'src/worker.ts': 'export function work() { return 0; }\n',
      },
      // lineA (ours) adds a loop assuming 100 (a LIFTED code change) — zero shared token.
      { 'src/worker.ts': 'export function work() { let n = 0; for (let i = 0; i < 100; i++) n += i; return n; }\n' },
      // lineB (theirs) lowers the invariant carrier (byte-only).
      { 'src/limits.ts': 'export const LIMIT = 50;\n' },
      tmpDirs,
    );

    expect(res.sealed, 'a scalar-const invariant break must NOT auto-seal').toBe(false);
    expect(res.decision.status).toBe('HELD');
    expect(res.meaningBlind?.bytePaths).toContain('src/limits.ts');
    expect(res.refusal?.verdict).toBe('HELD');
    expect(readRef(wdir, 'lineB')).toBe(lineBBefore);
  });

  it('(c) CONTROL — two disjoint LIFTED functions auto-fold CLEAN with NO hold (value prop survives)', async () => {
    const { res, wdir, lineBBefore } = await scenario(
      {
        'src/a.ts': 'export function alpha() { return 1; }\n',
        'src/b.ts': 'export function beta() { return 2; }\n',
      },
      { 'src/a.ts': 'export function alpha() { return 111; }\n' },
      { 'src/b.ts': 'export function beta() { return 222; }\n' },
      tmpDirs,
    );

    // The rule does NOT over-hold: a genuinely meaning-decided disjoint merge seals.
    expect(res.sealed, 'a fully meaning-decided disjoint merge must auto-fold').toBe(true);
    expect(res.decision.status).toBe('CLEAN');
    expect(res.meaningBlind).toBeUndefined();
    expect(res.strand).toBeDefined();
    // The target ref MOVED to the sealed weave.
    expect(readRef(wdir, 'lineB')).not.toBe(lineBBefore);
    expect(readRef(wdir, 'lineB')).toBe(res.strand!.pickId);
  });

  it('(d) SAME-SYMBOL — the same function contradicted across branches KNOTs (the base case)', async () => {
    const { res, wdir, lineBBefore } = await scenario(
      { 'src/shared.ts': 'export function foo() { return 1; }\n' },
      { 'src/shared.ts': 'export function foo() { return 2; }\n' },
      { 'src/shared.ts': 'export function foo() { return 3; }\n' },
      tmpDirs,
    );

    expect(res.sealed).toBe(false);
    expect(res.decision.status).toBe('KNOT');
    expect(res.refusal).toBeDefined();
    expect(readRef(wdir, 'lineB')).toBe(lineBBefore);
  });
});
