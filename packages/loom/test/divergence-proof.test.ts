/**
 * divergence-proof.test — THE DIVERGENCE PROOF for the Loom Oracle.
 *
 * The whole Phase-1 Oracle exists to run ONE experiment and exhibit ONE result
 * with data: a real branch-pair where GIT MERGES CLEAN but LOOM CATCHES A BREAK
 * git is structurally blind to. This file builds that branch-pair inside a
 * throwaway git repo (mkdtemp + git init — the user's repo/HEAD/index are NEVER
 * touched) and asserts the falsifiable claim on the REAL OracleRecord.
 *
 * The break is a CROSS-FILE SEMANTIC DANGLE — the case git cannot see:
 *   BASE   : #alpha  (alpha/.purpose)  and  #beta → #alpha (beta/.purpose)
 *   BRANCH A: retire #alpha            (touches ONLY alpha/.purpose)
 *   BRANCH B: a consumer → #alpha      (touches a DIFFERENT file)
 * A and B touch disjoint files ⇒ `git merge` is CLEAN (zero textual conflict).
 * But the merged MEANING is broken: a live edge → #alpha, which A retired ⇒ a
 * DANGLING reference. Only meaning carries that merge-information; bytes can't.
 *
 * INVARIANT under test: git clean AND Loom flags a dangle/knot (divergeMeaningOnly).
 *
 * Two scenarios:
 *  1. DANGLE-VIA-EXISTING-CONSUMER (the working proof, asserted GREEN): an
 *     existing symbol #gamma GAINS an edge → #alpha that A retired. Oracle catches it.
 *  2. DANGLE-VIA-BORN-CONSUMER (the headline scenario from the spec): a NEW
 *     symbol #gamma is born already referencing #alpha. The Oracle now CATCHES
 *     this too — a symbol-born delta carries an edgesAdded-only changeset, so its
 *     outgoing edges feed the dangle pass exactly like a gained edge. Asserted
 *     GREEN with the SAME divergence Scenario 1 gets.
 *  3. CONVERGENT positive control: disjoint symbols → git-clean AND meaning-clean,
 *     score 1 — the Oracle does not cry wolf.
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
    await repo.git('config', 'user.email', 'proof@loom.test');
    await repo.git('config', 'user.name', 'Loom Proof');
    await repo.git('config', 'commit.gpgsign', 'false');
    return repo;
  }

  async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' });
    return stdout.trim();
  }

  /** Write a `.purpose` at `<dir>/.purpose` with the given body. */
  async purpose(dir: string, body: string): Promise<void> {
    const d = path.join(this.dir, dir);
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(path.join(d, '.purpose'), body, 'utf8');
  }

  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }

  async destroy(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

// ── component .purpose bodies (kebab-case symbol ids; `related: ["#x"]` makes
//    the live parser resolve an outgoing reference edge → #x). ──
const alphaDefined = `version: 2.0.0
description: Alpha module
components:
  alpha:
    description: The alpha component, a foundational primitive
    path: index.ts
`;
const alphaRetired = `version: 2.0.0
description: Alpha module (component retired)
components: {}
`;
const betaRefsAlpha = `version: 2.0.0
description: Beta module
components:
  beta:
    description: The beta component, which builds on #alpha
    path: index.ts
    related: ["#alpha"]
`;
const gammaStandalone = `version: 2.0.0
description: Gamma module
components:
  gamma:
    description: The gamma component, standalone for now
    path: index.ts
`;
const gammaRefsAlpha = `version: 2.0.0
description: Gamma module
components:
  gamma:
    description: The gamma component, which also builds on #alpha
    path: index.ts
    related: ["#alpha"]
`;

describe('THE DIVERGENCE PROOF — git merges clean, Loom catches the meaning-break', () => {
  // ────────────────────────────────────────────────────────────────────────
  // Scenario 1 — DANGLE via an EXISTING consumer gaining the edge.
  // This is the working proof of the core thesis, asserted GREEN.
  // ────────────────────────────────────────────────────────────────────────
  describe('dangle via existing consumer (#gamma gains edge → retired #alpha)', () => {
    let repo: FixtureRepo;
    let record: OracleRecord;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-proof-dangle-');
      // BASE: #alpha + #beta→#alpha + #gamma (exists, no edge yet).
      await repo.purpose('alpha', alphaDefined);
      await repo.purpose('beta', betaRefsAlpha);
      await repo.purpose('gamma', gammaStandalone);
      await repo.commitAll('base: #alpha, #beta->#alpha, #gamma(standalone)');

      // BRANCH A (off base): retire #alpha — touches ONLY alpha/.purpose.
      await repo.git('checkout', '-q', '-b', 'branchA');
      await repo.purpose('alpha', alphaRetired);
      await repo.commitAll('A: retire #alpha');

      // BRANCH B (off base): #gamma GAINS edge → #alpha — touches ONLY gamma/.purpose.
      await repo.git('checkout', '-q', 'base');
      await repo.git('checkout', '-q', '-b', 'branchB');
      await repo.purpose('gamma', gammaRefsAlpha);
      await repo.commitAll('B: #gamma now references #alpha');

      await repo.git('checkout', '-q', 'base');
      record = await oracle('branchA', 'branchB', { cwd: repo.dir, noWrite: true });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    it('1. GIT REALITY IS CLEAN — A and B touch disjoint files, git merges with no conflict', () => {
      expect(record.gitReality.conflicted).toBe(false);
      expect(record.gitReality.conflictPaths).toEqual([]);
      expect(record.gitReality.conflictSymbols).toEqual([]);
    });

    it('2. LOOM CATCHES THE BREAK — prediction.dangling is non-empty (#gamma → #alpha)', () => {
      expect(record.prediction.dangling.length).toBeGreaterThan(0);
      const d = record.prediction.dangling[0];
      expect(d.fromSymbol).toBe('#gamma');
      expect(d.danglingTargetSymbol).toBe('#alpha');
      expect(d.retiredBy).toBe('A');
    });

    it('3. THE HEADLINE — git-clean-but-meaning-broken: divergeMeaningOnly flags #gamma, verdict DIVERGENT', () => {
      // The invariant: git clean (no agreeConflict, no divergeGitOnly from git's side)
      // AND meaning flags a real break git missed.
      expect(record.gitReality.conflicted).toBe(false);
      expect(record.convergence.divergeMeaningOnly).toContain('#gamma');
      expect(record.convergence.divergeGitOnly).toEqual([]);
      expect(record.convergence.verdict).toBe('DIVERGENT');
      // score < 1 because a divergence exists; the meaning carried merge-info bytes can't.
      expect(record.convergence.score).toBeLessThan(1);
    });

    it('confusion matrix partitions its universe (no symbol double-counted)', () => {
      const c = record.convergence;
      const all = [...c.agreeClean, ...c.agreeConflict, ...c.divergeGitOnly, ...c.divergeMeaningOnly];
      expect(new Set(all).size).toBe(all.length);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Scenario 2 — DANGLE via a BORN consumer (#gamma born already referencing
  // retired #alpha). This is the literal headline scenario in the spec
  // (A and B touch DIFFERENT files: alpha/.purpose vs gamma/.purpose).
  //
  // FIXED: a symbol-born delta now carries an edgesAdded-only changeset (sem-delta
  // attaches ALL of the born object's outgoing edges in the same {kind,
  // targetSymbol} shape the contract-changed path uses), so predict.addedEdges()
  // harvests them and the dangle pass catches the born-#gamma → retired-#alpha
  // break — exactly the divergence Scenario 1 (existing consumer) gets.
  // ────────────────────────────────────────────────────────────────────────
  describe('dangle via born consumer (#gamma born referencing retired #alpha)', () => {
    let repo: FixtureRepo;
    let record: OracleRecord;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-proof-born-');
      // BASE: #alpha + #beta→#alpha (no #gamma yet).
      await repo.purpose('alpha', alphaDefined);
      await repo.purpose('beta', betaRefsAlpha);
      await repo.commitAll('base: #alpha + #beta->#alpha');

      // BRANCH A: retire #alpha — touches ONLY alpha/.purpose.
      await repo.git('checkout', '-q', '-b', 'branchA');
      await repo.purpose('alpha', alphaRetired);
      await repo.commitAll('A: retire #alpha');

      // BRANCH B: ADD #gamma referencing #alpha — touches ONLY gamma/.purpose
      // (a DIFFERENT file than branch A).
      await repo.git('checkout', '-q', 'base');
      await repo.git('checkout', '-q', '-b', 'branchB');
      await repo.purpose('gamma', gammaRefsAlpha);
      await repo.commitAll('B: add #gamma referencing #alpha');

      await repo.git('checkout', '-q', 'base');
      record = await oracle('branchA', 'branchB', { cwd: repo.dir, noWrite: true });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    // Git reality is genuinely clean here too (disjoint files) — this assertion
    // is TRUE and stays as a plain `it`.
    it('GIT REALITY IS CLEAN (disjoint files alpha/.purpose vs gamma/.purpose)', () => {
      expect(record.gitReality.conflicted).toBe(false);
      expect(record.gitReality.conflictPaths).toEqual([]);
    });

    // The break is now CAUGHT: a born symbol's outgoing edges are surfaced to the
    // dangle pass (sem-delta attaches an edgesAdded-only changeset to symbol-born
    // deltas), so the born-#gamma → retired-#alpha dangle is detected exactly the
    // same way the existing-consumer scenario is. This asserts the SAME divergence
    // Scenario 1 gets.
    it('LOOM CATCHES THE BREAK — born-#gamma → retired-#alpha dangle flagged (#gamma → #alpha, retiredBy A)', () => {
      expect(record.prediction.dangling.length).toBeGreaterThan(0);
      const d = record.prediction.dangling.find((x) => x.fromSymbol === '#gamma');
      expect(d).toBeDefined();
      expect(d!.fromSymbol).toBe('#gamma');
      expect(d!.danglingTargetSymbol).toBe('#alpha');
      expect(d!.retiredBy).toBe('A');
    });

    it('THE HEADLINE — git-clean-but-meaning-broken: divergeMeaningOnly flags #gamma, verdict DIVERGENT', () => {
      expect(record.gitReality.conflicted).toBe(false);
      expect(record.convergence.divergeMeaningOnly).toContain('#gamma');
      expect(record.convergence.divergeGitOnly).toEqual([]);
      expect(record.convergence.verdict).toBe('DIVERGENT');
      expect(record.convergence.score).toBeLessThan(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Scenario 3 — CONVERGENT positive control. Two branches touch DISJOINT
  // symbols (no cross-edge to a retired target). Both git-clean and meaning-clean,
  // score 1. Proves the Oracle does not cry wolf.
  // ────────────────────────────────────────────────────────────────────────
  describe('convergent positive control (disjoint symbols → clean both ways)', () => {
    let repo: FixtureRepo;
    let record: OracleRecord;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-proof-convergent-');
      // BASE: #alpha + #beta (no cross-edges that anyone will break).
      await repo.purpose('alpha', alphaDefined);
      await repo.purpose('beta', gammaStandalone.replace(/gamma/g, 'beta'));
      await repo.commitAll('base: #alpha + #beta (independent)');

      // BRANCH A: add #delta in its own file (touches only delta/.purpose).
      await repo.git('checkout', '-q', '-b', 'branchA');
      await repo.purpose('delta', `version: 2.0.0
components:
  delta:
    description: The delta component, independent
    path: index.ts
`);
      await repo.commitAll('A: add #delta');

      // BRANCH B: add #epsilon in its own file (touches only epsilon/.purpose).
      await repo.git('checkout', '-q', 'base');
      await repo.git('checkout', '-q', '-b', 'branchB');
      await repo.purpose('epsilon', `version: 2.0.0
components:
  epsilon:
    description: The epsilon component, independent
    path: index.ts
`);
      await repo.commitAll('B: add #epsilon');

      await repo.git('checkout', '-q', 'base');
      record = await oracle('branchA', 'branchB', { cwd: repo.dir, noWrite: true });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    it('git clean AND meaning clean — no knots, no dangling, verdict CONVERGENT, score 1', () => {
      expect(record.gitReality.conflicted).toBe(false);
      expect(record.prediction.knots).toEqual([]);
      expect(record.prediction.dangling).toEqual([]);
      expect(record.convergence.divergeMeaningOnly).toEqual([]);
      expect(record.convergence.divergeGitOnly).toEqual([]);
      expect(record.convergence.verdict).toBe('CONVERGENT');
      expect(record.convergence.score).toBe(1);
    });
  });
});
