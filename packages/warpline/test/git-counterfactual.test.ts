/**
 * git-counterfactual.test — "meaning caught what bytes missed", made MEASURABLE.
 *
 * The claim the product rests on has never had a denominator on this repo:
 * #oracle computes the git×meaning confusion matrix but is an offline manual
 * verb whose ledger has zero readers, and #shadow-gate — the only instrument
 * that fires on real work — never called git at all. Every shadow verdict now
 * records what `git merge-tree` would have decided about the same two sides.
 *
 * What is pinned here, and why each pin is not vacuous:
 *
 *  1. THE TAXONOMY IS ORACLE'S. `convergenceCellOf` is not asserted against a
 *     copy of the four names — the real `score()` from oracle.ts is driven
 *     through all four cells and the cell it POPULATES is compared with the cell
 *     this module NAMES. A rename or a re-partition in oracle fails this test.
 *  2. ALL FOUR CELLS ARE POSITIVELY EXERCISED THROUGH THE REAL PATH — real git
 *     repos, real `shadowAdmit`, real `git merge-tree`. "Asserted empty" is not
 *     evidence (oracle.ts:319-321 states the same rule for the same matrix), and
 *     divergeMeaningOnly — meaning KNOTs, git merges clean — is the headline
 *     cell the whole exercise exists to count.
 *  3. THE SIDES COME FROM THE VERDICT'S OWN AUTHORITY. `theirs` is asserted to
 *     be the sha of the branch the SELVAGE was sealed from, which the fixture
 *     knows independently — not re-derived from the same reader under test.
 *  4. `unavailable` IS TOTAL. Every arm of the enum is produced; the two that
 *     cannot be provoked with a healthy git (error, timeout) go through the
 *     documented test seam, which still runs this module's real mapping code.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { shadowAdmit, SHADOW_ROW_CAP } from '../src/fabric/shadow.js';
import {
  gitCounterfactual,
  convergenceCellOf,
  type ConvergenceCell,
} from '../src/fabric/counterfactual.js';
import { score } from '../src/oracle.js';
import { mergeTree } from '../src/git/git-exec.js';
import { WORKTREE_REF } from '../src/absorb.js';
import type { Prediction } from '../src/predict.js';
import type { WarpState } from '../src/warp/warp-state.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'cf@warpline.test');
    await r.git('config', 'user.name', 'Warpline CF');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async branchFromBase(name: string, rel: string, body: string): Promise<string> {
    await this.git('checkout', '-q', 'base');
    await this.git('checkout', '-q', '-b', name);
    await this.write(rel, body);
    await this.commitAll(name);
    const sha = await this.git('rev-parse', 'HEAD');
    await this.git('checkout', '-q', 'base');
    return sha;
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

/** A body whose edits at line 2 and line 9 are far enough apart that git merges them. */
const WIDE = (first: string, tail: string): string =>
  `export function wide(a: number, b: number): number {\n` +
  `  const one = ${first};\n` +
  `  const two = b + 1;\n` +
  `  const three = one + two;\n` +
  `  const four = three * 2;\n` +
  `  const five = four - 1;\n` +
  `  const six = five + 0;\n` +
  `  const seven = six + 0;\n` +
  `  return ${tail};\n` +
  `}\n`;

/** Two ADJACENT one-liners: distinct symbols, abutting lines. */
const PAIR = (a: string, b: string): string =>
  `export function alpha(): number { return ${a}; }\n` +
  `export function beta(): number { return ${b}; }\n`;

const TIGHT = (v: string): string => `export function tight(): number {\n  return ${v};\n}\n`;

/**
 * Build a repo, seal genesis at `base`, advance the selvage to branch A, and
 * shadow-admit branch B against a scratch pinned at genesis. That is the ONLY
 * shape in which a real re-base verdict is reachable (audit C-9): without a
 * scratch, base === selvage and FAST_ADMIT is structurally forced.
 */
async function contestedVerdict(
  prefix: string,
  file: string,
  baseBody: string,
  aBody: string,
  bBody: string,
): Promise<{ repo: Repo; shaA: string; shaB: string; row: Awaited<ReturnType<typeof shadowAdmit>>['row'] }> {
  const repo = await Repo.create(prefix);
  await repo.write('.gitignore', '.warpline/\n');
  await repo.write(file, baseBody);
  await repo.commitAll('base');
  const shaA = await repo.branchFromBase('sideA', file, aBody);
  const shaB = await repo.branchFromBase('sideB', file, bBody);

  await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
  forkScratch(repo.dir, 'agent');
  await recordPick(repo.dir, { cwd: repo.dir, ref: 'sideA', intent: 'selvage advances to A' });
  const { row } = await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'agent', ref: 'sideB' });
  return { repo, shaA, shaB, row };
}

describe('#git-counterfactual — the taxonomy is oracle\'s own', () => {
  /**
   * Drive the REAL confusion-matrix partition and read back which cell it filled.
   * Anything that renames a cell, or re-partitions on different predicates,
   * breaks the agreement with `convergenceCellOf` here.
   */
  function cellFromOracle(meaningContested: boolean, gitConflicted: boolean): ConvergenceCell {
    const SYM = '#probe';
    const prediction: Prediction = {
      autoClean: meaningContested ? [] : ['probe-key'],
      knots: meaningContested ? [{ stableKey: 'probe-key', symbol: SYM, conflictingSlots: ['body'] }] : [],
      dangling: [],
    };
    // one synthetic state so `score` can resolve the autoClean stableKey → name
    const state = {
      objects: new Map([['probe-key', { symbol: SYM, stableKey: 'probe-key', edges: [] }]]),
    } as unknown as WarpState;
    const conv = score(prediction, gitConflicted ? [SYM] : [], [state], {
      gitConflicted,
      unmappedConflictPaths: [],
      pathsEnumerated: gitConflicted,
    });
    const filled = (['agreeConflict', 'agreeClean', 'divergeGitOnly', 'divergeMeaningOnly'] as const).filter(
      (k) => conv[k].length > 0,
    );
    expect(filled, `oracle must fill exactly one cell for (${meaningContested}, ${gitConflicted})`).toHaveLength(1);
    return filled[0];
  }

  it('agrees with score() on every cell of the 2x2 (the binding, not a copy of the names)', () => {
    for (const meaning of [true, false]) {
      for (const git of [true, false]) {
        expect(convergenceCellOf(meaning, git), `(meaning=${meaning}, git=${git})`).toBe(
          cellFromOracle(meaning, git),
        );
      }
    }
  });
});

describe('#git-counterfactual — all four cells, through the real path', () => {
  const repos: Repo[] = [];
  afterAll(async () => {
    await Promise.all(repos.map((r) => r.destroy()));
  });

  it('★ divergeMeaningOnly — meaning KNOTs, git merges clean (THE headline)', async () => {
    const { repo, shaA, row } = await contestedVerdict(
      'warpline-cf-dmo-',
      'src/wide.ts',
      WIDE('a + 1', 'seven'),
      WIDE('a + 100', 'seven'), // A edits line 2
      WIDE('a + 1', 'seven * 3'), // B edits line 9
    );
    repos.push(repo);

    expect(row.status).toBe('KNOT');
    const cf = row.gitCounterfactual!;
    expect(cf.unavailable).toBeNull();
    expect(cf.gitConflicted).toBe(false);
    expect(cf.conflictPaths).toEqual([]);
    expect(cf.conflictPathsTotal).toBe(0);
    expect(cf.cell).toBe('divergeMeaningOnly');
    // (3) the second side is the commit the SELVAGE was sealed from, and the
    // fixture knows that sha independently of the code under test.
    expect(cf.theirs).toBe(shaA);
  }, 180_000);

  it('agreeConflict — meaning KNOTs and git conflicts on the same line', async () => {
    const { repo, row } = await contestedVerdict(
      'warpline-cf-ac-',
      'src/tight.ts',
      TIGHT('1'),
      TIGHT('10'),
      TIGHT('20'),
    );
    repos.push(repo);

    expect(row.status).toBe('KNOT');
    const cf = row.gitCounterfactual!;
    expect(cf.unavailable).toBeNull();
    expect(cf.gitConflicted).toBe(true);
    expect(cf.conflictPaths).toContain('src/tight.ts');
    expect(cf.conflictPathsTotal).toBe(cf.conflictPaths.length);
    expect(cf.cell).toBe('agreeConflict');
  }, 180_000);

  it('divergeGitOnly — meaning admits two independent symbols git refuses to merge', async () => {
    const { repo, row } = await contestedVerdict(
      'warpline-cf-dgo-',
      'src/pair.ts',
      PAIR('1', '2'),
      PAIR('11', '2'), // A edits alpha (line 1)
      PAIR('1', '22'), // B edits beta  (line 2) — abutting, so git conflicts
    );
    repos.push(repo);

    expect(row.status).toBe('CLEAN');
    const cf = row.gitCounterfactual!;
    expect(cf.unavailable).toBeNull();
    expect(cf.gitConflicted).toBe(true);
    expect(cf.conflictPaths).toContain('src/pair.ts');
    expect(cf.cell).toBe('divergeGitOnly');
  }, 180_000);

  it('agreeClean — a FAST_ADMIT over an unmoved selvage, which git fast-forwards', async () => {
    const repo = await Repo.create('warpline-cf-acl-');
    repos.push(repo);
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    const shaA = await repo.branchFromBase('sideA', 'src/tight.ts', TIGHT('7'));
    const baseSha = await repo.git('rev-parse', 'base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });

    const { row } = await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'agent', ref: 'sideA' });

    expect(row.status).toBe('FAST_ADMIT');
    const cf = row.gitCounterfactual!;
    expect(cf.unavailable).toBeNull();
    expect(cf.gitConflicted).toBe(false);
    expect(cf.cell).toBe('agreeClean');
    expect(cf.ours).toBe(shaA);
    expect(cf.theirs).toBe(baseSha);
    // The measurement is cheap enough to ride the auto-seal path.
    expect(cf.durationMs).toBeLessThan(20_000);
  }, 180_000);
});

describe('#git-counterfactual — `unavailable` is total and never absent', () => {
  const repos: Repo[] = [];
  afterAll(async () => {
    await Promise.all(repos.map((r) => r.destroy()));
  });

  it("'worktree-ref' — uncommitted work has no commit for git to merge", async () => {
    const repo = await Repo.create('warpline-cf-wt-');
    repos.push(repo);
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    await repo.write('src/tight.ts', TIGHT('5'));

    const { row } = await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'agent', ref: WORKTREE_REF });

    const cf = row.gitCounterfactual!;
    expect(cf.unavailable).toBe('worktree-ref');
    expect(cf.gitConflicted).toBeNull();
    expect(cf.cell).toBeNull();
    // present-and-explicit, never a hole: the KEY exists on every new row.
    expect(Object.keys(cf)).toContain('unavailable');
  }, 180_000);

  it("'no-two-refs' — a genesis admission has no second side to merge against", async () => {
    const repo = await Repo.create('warpline-cf-n2r-');
    repos.push(repo);
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    // NO genesis pick — the fabric is empty, so there is no selvage strand.
    const { row } = await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'agent', ref: 'base' });

    const cf = row.gitCounterfactual!;
    expect(cf.unavailable).toBe('no-two-refs');
    expect(cf.theirs).toBeNull();
    expect(cf.ours).not.toBeNull(); // ours resolved; the SECOND side is what was missing
    expect(cf.cell).toBeNull();
  }, 180_000);

  it("'git-error' — a git failure is never read as a clean merge (audit C-8)", async () => {
    const cf = await gitCounterfactual({
      ref: 'sideB',
      ours: 'a'.repeat(40),
      theirs: 'b'.repeat(40),
      meaningContested: true,
      cap: SHADOW_ROW_CAP,
      git: { revParse: async (r: string) => r, mergeTree: async () => { throw new Error('fatal: not a valid object name'); } },
    });
    expect(cf.unavailable).toBe('git-error');
    expect(cf.gitConflicted).toBeNull(); // NOT false
    expect(cf.cell).toBeNull(); // NOT 'divergeMeaningOnly'
  });

  /**
   * THE FABRICATED-EVIDENCE REGRESSION (found by mutation M18, 2026-08-10).
   *
   * `git merge-tree --write-tree` exits 1 for "not something we can merge" —
   * the SAME code as a conflict — so git-exec.ts hands back
   * `{conflicted:true, conflictPaths:[]}` for a ref that does not exist, with no
   * throw. Without the pre-flight this verdict would be filed as agreeConflict
   * on the strength of a git ERROR. A `provenance.gitCommit` naming a
   * rebased-away commit makes that an ordinary occurrence, not an exotic one.
   *
   * REAL git, REAL repo, a well-formed sha that was never created.
   */
  it('a well-formed but NONEXISTENT commit is an error, NOT a fabricated conflict', async () => {
    const repo = await Repo.create('warpline-cf-ghost-');
    repos.push(repo);
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    const ours = await repo.git('rev-parse', 'HEAD');
    const ghost = 'de1e7ed'.padEnd(40, '0'); // 40 hex chars, no such object

    // First: the raw plumbing really does lie, so this test is not theoretical.
    const raw = await mergeTree(ghost, ours, { cwd: repo.dir });
    expect(raw).toEqual({ conflicted: true, conflictPaths: [] });

    // And the counterfactual refuses to launder that into a measurement.
    const cf = await gitCounterfactual({
      cwd: repo.dir,
      ref: 'HEAD',
      ours,
      theirs: ghost,
      meaningContested: false,
      cap: SHADOW_ROW_CAP,
    });
    expect(cf.unavailable).toBe('git-error');
    expect(cf.gitConflicted).toBeNull(); // NOT true
    expect(cf.cell).toBeNull(); // NOT 'divergeGitOnly'
  }, 180_000);

  it("'timeout' — a slow git is bounded, because this rides the auto-seal hook", async () => {
    const cf = await gitCounterfactual({
      ref: 'sideB',
      ours: 'a'.repeat(40),
      theirs: 'b'.repeat(40),
      meaningContested: false,
      cap: SHADOW_ROW_CAP,
      timeoutMs: 25,
      git: { revParse: async (r: string) => r, mergeTree: () => new Promise<never>(() => {}) }, // never settles
    });
    expect(cf.unavailable).toBe('timeout');
    expect(cf.gitConflicted).toBeNull();
    expect(cf.cell).toBeNull();
  });
});

describe('#git-counterfactual — bounded like every other array on this row', () => {
  it('conflictPaths caps at SHADOW_ROW_CAP; the total stays exact', async () => {
    const many = Array.from({ length: SHADOW_ROW_CAP + 17 }, (_, i) => `p/${String(i).padStart(3, '0')}.txt`);
    const cf = await gitCounterfactual({
      ref: 'sideB',
      ours: 'a'.repeat(40),
      theirs: 'b'.repeat(40),
      meaningContested: false,
      cap: SHADOW_ROW_CAP,
      git: { revParse: async (r: string) => r, mergeTree: async () => ({ conflicted: true, conflictPaths: [...many].reverse() }) },
    });
    expect(cf.unavailable).toBeNull();
    expect(cf.conflictPathsTotal).toBe(SHADOW_ROW_CAP + 17);
    expect(cf.conflictPaths).toHaveLength(SHADOW_ROW_CAP);
    expect(cf.conflictPaths).toEqual([...cf.conflictPaths].sort()); // deterministic top-N
    expect(cf.cell).toBe('divergeGitOnly');
  });
});
