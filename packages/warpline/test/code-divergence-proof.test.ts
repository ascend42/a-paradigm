/**
 * code-divergence-proof.test — THE DIVERGENCE PROOF, ON REAL CODE.
 *
 * The arc's original proof (divergence-proof.test.ts) exhibited the thesis on
 * `.purpose` symbols: git merges clean, Warpline catches a dangling reference.
 * This is the CAPSTONE: the SAME experiment on actual TypeScript CODE, now that
 * the A-v1 code-lens lifts code-units into the WARP.
 *
 * THE BREAK — a code-level DANGLE git is structurally blind to:
 *   BASE   : `caller()` (returns 0) + padding + `helper()` — all top-level in
 *            ONE file. caller does NOT yet call helper.
 *   BRANCH A: DELETE `helper` (edits the BOTTOM of the file).
 *   BRANCH B: `caller` gains a call → `helper()` (edits the TOP of the file).
 * A's hunk (bottom) and B's hunk (top) are textually DISJOINT with unchanged
 * padding between ⇒ `git merge-tree` is CLEAN (zero conflict). But the merged
 * MEANING is broken: caller() calls helper(), which A deleted ⇒ a DANGLING
 * call. git merged two files by text and produced broken code; only meaning
 * carried the merge-information that catches it.
 *
 * (Cross-file would be cleaner but a cross-file reference is an `import` → an
 * EXTERN ref, not a local code-unit edge; so the call + target live in one file,
 * and we exploit textually-distant hunks + a last-position target so removing it
 * shifts no ordinals — keeping the stableKeys clean.)
 *
 * INVARIANT under test: git clean AND Warpline flags the dangle (divergeMeaningOnly),
 * verdict DIVERGENT. Plus a CONVERGENT positive control so the Oracle isn't crying
 * wolf on benign disjoint code edits.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { oracle, type OracleRecord } from '../src/oracle.js';

const execFileAsync = promisify(execFile);

/** A self-contained throwaway git repo for fixture branches. Never the user's. */
class FixtureRepo {
  constructor(public readonly dir: string) {}

  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const repo = new FixtureRepo(dir);
    await repo.git('init', '-q', '-b', 'base');
    await repo.git('config', 'user.email', 'proof@warpline.test');
    await repo.git('config', 'user.name', 'Warpline Proof');
    await repo.git('config', 'commit.gpgsign', 'false');
    return repo;
  }

  async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' });
    return stdout.trim();
  }

  /** Write a `.ts` file at `<rel>` with the given body. */
  async tsfile(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }

  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }

  async destroy(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

const C = (file: string, qname: string) => `#code:${file}::${qname}`;
const MOD = 'src/mod.ts';

// ── module bodies. `caller` is fn#0 (top); `helper` is the LAST fn (bottom) so
//    deleting it shifts no other ordinal. Padding keeps the top/bottom hunks
//    textually disjoint ⇒ git auto-merges A (delete bottom) + B (edit top). ──
const baseMod = `export function caller(): number {
  return 0;
}

export function pad1(): number {
  return 1;
}

export function pad2(): number {
  return 2;
}

export function pad3(): number {
  return 3;
}

export function helper(): number {
  return 42;
}
`;

// BRANCH A: helper removed (bottom of file). caller + pads byte-identical.
const aMod = `export function caller(): number {
  return 0;
}

export function pad1(): number {
  return 1;
}

export function pad2(): number {
  return 2;
}

export function pad3(): number {
  return 3;
}
`;

// BRANCH B: caller now CALLS helper (top of file). pads + helper byte-identical.
const bMod = `export function caller(): number {
  return helper();
}

export function pad1(): number {
  return 1;
}

export function pad2(): number {
  return 2;
}

export function pad3(): number {
  return 3;
}

export function helper(): number {
  return 42;
}
`;

describe('THE DIVERGENCE PROOF (CODE) — git merges clean, Warpline catches the broken call', () => {
  let repo: FixtureRepo;
  let record: OracleRecord;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-code-proof-');
    await repo.tsfile(MOD, baseMod);
    await repo.commitAll('base: caller (no call) + pads + helper');

    // BRANCH A (off base): delete helper — edits ONLY the file's bottom.
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.tsfile(MOD, aMod);
    await repo.commitAll('A: delete helper()');

    // BRANCH B (off base): caller gains a call → helper — edits ONLY the top.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.tsfile(MOD, bMod);
    await repo.commitAll('B: caller now calls helper()');

    await repo.git('checkout', '-q', 'base');
    record = await oracle('branchA', 'branchB', { cwd: repo.dir, noWrite: true });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('1. GIT REALITY IS CLEAN — A (bottom) and B (top) are disjoint hunks, git merges with no conflict', () => {
    expect(record.gitReality.conflicted).toBe(false);
    expect(record.gitReality.conflictPaths).toEqual([]);
    expect(record.gitReality.conflictSymbols).toEqual([]);
  });

  it('2. WARPLINE CATCHES THE BREAK — a code-level dangle: caller → retired helper', () => {
    expect(record.prediction.dangling.length).toBeGreaterThan(0);
    const d = record.prediction.dangling.find((x) => x.fromSymbol === C(MOD, 'caller'));
    expect(d).toBeDefined();
    expect(d!.danglingTargetSymbol).toBe(C(MOD, 'helper'));
    expect(d!.retiredBy).toBe('A');
  });

  it('3. THE HEADLINE — git-clean-but-code-broken: divergeMeaningOnly flags caller, verdict DIVERGENT', () => {
    expect(record.gitReality.conflicted).toBe(false);
    expect(record.convergence.divergeMeaningOnly).toContain(C(MOD, 'caller'));
    expect(record.convergence.divergeGitOnly).toEqual([]);
    expect(record.convergence.verdict).toBe('DIVERGENT');
    expect(record.convergence.score).toBeLessThan(1);
  });

  it('confusion matrix partitions its universe (no symbol double-counted)', () => {
    const c = record.convergence;
    const all = [...c.agreeClean, ...c.agreeConflict, ...c.divergeGitOnly, ...c.divergeMeaningOnly];
    expect(new Set(all).size).toBe(all.length);
  });
});

// ── CONVERGENT positive control: two edits to DIFFERENT functions (top vs
//    bottom) commute. git-clean AND meaning-clean ⇒ the Oracle does not cry wolf
//    on benign disjoint code edits. ──
describe('CONVERGENT control (CODE) — disjoint code edits merge clean both ways', () => {
  let repo: FixtureRepo;
  let record: OracleRecord;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-code-convergent-');
    await repo.tsfile(MOD, baseMod);
    await repo.commitAll('base');

    // A: edit caller's body (top) — independent.
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.tsfile(MOD, baseMod.replace('return 0;', 'return 7;'));
    await repo.commitAll('A: caller returns 7');

    // B: edit helper's body (bottom) — independent of A's edit, no cross-ref.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.tsfile(MOD, baseMod.replace('return 42;', 'return 99;'));
    await repo.commitAll('B: helper returns 99');

    await repo.git('checkout', '-q', 'base');
    record = await oracle('branchA', 'branchB', { cwd: repo.dir, noWrite: true });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('git clean AND meaning clean — no knots, no dangling, verdict CONVERGENT', () => {
    expect(record.gitReality.conflicted).toBe(false);
    expect(record.prediction.knots).toEqual([]);
    expect(record.prediction.dangling).toEqual([]);
    expect(record.convergence.divergeMeaningOnly).toEqual([]);
    expect(record.convergence.divergeGitOnly).toEqual([]);
    expect(record.convergence.verdict).toBe('CONVERGENT');
  });
});
