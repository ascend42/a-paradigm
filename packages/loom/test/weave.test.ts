/**
 * weave.test — the pre-merge MEANING forecast and the semantic-diff report.
 *
 * Both surfaces ride the SAME engine the Oracle does (absorb → diff → predict),
 * so these tests build throwaway git repos (mkdtemp + git init — the user's
 * repo/HEAD/index are NEVER touched) and assert the founder-facing behavior:
 *
 *   - forecast on the dangle fixture → verdict DECISIONS, dangling surfaced.
 *   - forecast on disjoint branches → CLEAN TO WEAVE.
 *   - semanticDiff across a RENAME (same essence, new name) → renamed-noop, NOT
 *     a contract change (the zero-diff rename, made visible).
 *   - semanticDiff across a real CONTRACT change → contract-changed, right slot.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { forecast } from '../src/weave.js';
import { semanticDiff } from '../src/weave.js';

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
const gammaRefsAlpha = `version: 2.0.0
description: Gamma module
components:
  gamma:
    description: The gamma component, which also builds on #alpha
    path: index.ts
    related: ["#alpha"]
`;

describe('weave --preview — THE PRE-MERGE FORECAST (meaning-side)', () => {
  // ── DANGLE fixture: A retires #alpha, B adds #gamma→#alpha → decisions needed ──
  describe('dangle fixture (A retires #alpha, B references it) → decisions needed', () => {
    let repo: FixtureRepo;
    let f: Awaited<ReturnType<typeof forecast>>;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-weave-dangle-');
      await repo.purpose('alpha', alphaDefined);
      await repo.purpose('beta', betaRefsAlpha);
      await repo.commitAll('base: #alpha + #beta->#alpha');

      await repo.git('checkout', '-q', '-b', 'branchA');
      await repo.purpose('alpha', alphaRetired);
      await repo.commitAll('A: retire #alpha');

      await repo.git('checkout', '-q', 'base');
      await repo.git('checkout', '-q', '-b', 'branchB');
      await repo.purpose('gamma', gammaRefsAlpha);
      await repo.commitAll('B: add #gamma referencing #alpha');

      await repo.git('checkout', '-q', 'base');
      f = await forecast('branchA', 'branchB', { cwd: repo.dir });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    it('verdict is DECISIONS — the forecast flags work to do before the weave', () => {
      expect(f.verdict).toBe('DECISIONS');
      expect(f.decisions).toBeGreaterThan(0);
    });

    it('the forecast surfaces the dangling reference (#gamma → #alpha, retired by A)', () => {
      expect(f.dangling.length).toBeGreaterThan(0);
      const d = f.dangling.find((x) => x.fromSymbol === '#gamma');
      expect(d).toBeDefined();
      expect(d!.danglingTargetSymbol).toBe('#alpha');
      expect(d!.retiredBy).toBe('A');
    });
  });

  // ── DISJOINT fixture: independent additions → CLEAN TO WEAVE ──
  describe('disjoint branches (independent additions) → CLEAN TO WEAVE', () => {
    let repo: FixtureRepo;
    let f: Awaited<ReturnType<typeof forecast>>;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-weave-clean-');
      await repo.purpose('alpha', alphaDefined);
      await repo.commitAll('base: #alpha');

      await repo.git('checkout', '-q', '-b', 'branchA');
      await repo.purpose('delta', `version: 2.0.0
components:
  delta:
    description: The delta component, independent
    path: index.ts
`);
      await repo.commitAll('A: add #delta');

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
      f = await forecast('branchA', 'branchB', { cwd: repo.dir });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    it('verdict is CLEAN — no knots, no dangling', () => {
      expect(f.verdict).toBe('CLEAN');
      expect(f.decisions).toBe(0);
      expect(f.knots).toEqual([]);
      expect(f.dangling).toEqual([]);
    });
  });
});

describe('loom diff — SEMANTIC diff between two refs (rename is the empty delta)', () => {
  // ── MOVE/RENAME fixture: alpha/.purpose → moved/.purpose. The symbol #alpha
  //    keeps its stableKey (SymbolEntry.id = purpose-component-alpha) and its
  //    essence (which excludes filePath), so the move is the EMPTY delta — git
  //    shows a rename, Loom shows ZERO semantic weight. This is the literal
  //    "rename/move is the empty delta" property, made visible on real refs. ──
  describe('a moved/renamed symbol (same essence, new path) → renamed-noop, NOT a contract change', () => {
    let repo: FixtureRepo;
    let report: Awaited<ReturnType<typeof semanticDiff>>;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-diff-rename-');
      // refA tip: #alpha defined at alpha/.purpose.
      await repo.purpose('alpha', alphaDefined);
      await repo.commitAll('refA: #alpha at alpha/.purpose');
      const refA = await repo.git('rev-parse', 'HEAD');

      // refB tip: MOVE the file to moved/.purpose. Same component id, same
      // contract — only the filePath changed. stableKey + essence survive ⇒ a
      // zero-weight rename, NOT a contract change.
      await repo.git('mv', 'alpha', 'moved');
      await repo.commitAll('refB: move alpha/.purpose → moved/.purpose (no meaning change)');
      const refB = await repo.git('rev-parse', 'HEAD');

      report = await semanticDiff(refA, refB, { cwd: repo.dir });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    it('the move is surfaced as a renamed-noop (#alpha, no meaning change)', () => {
      expect(report.renamedNoopCount).toBe(1);
      const r = report.renamedNoop[0];
      expect(r.symbol).toBe('#alpha');
      // identical essence on both sides — the empty delta, provably zero weight.
      expect(r.essenceBefore).toBe(r.essenceAfter);
    });

    it('it is NOT counted as a contract change — the zero-diff rename', () => {
      expect(report.contractChanged).toEqual([]);
      expect(report.changedCount).toBe(0);
    });
  });

  // ── CONTRACT-CHANGE fixture: #alpha gains a gate → contract-changed [gates] ──
  describe('a real contract change (#alpha gains a gate) → contract-changed with the gates slot', () => {
    let repo: FixtureRepo;
    let report: Awaited<ReturnType<typeof semanticDiff>>;

    beforeAll(async () => {
      repo = await FixtureRepo.create('loom-diff-contract-');
      await repo.purpose('alpha', alphaDefined);
      await repo.commitAll('refA: #alpha (no gates)');
      const refA = await repo.git('rev-parse', 'HEAD');

      // refB: #alpha now sits behind a gate — a real meaning change in the gates slot.
      await repo.purpose('alpha', `version: 2.0.0
description: Alpha module
components:
  alpha:
    description: The alpha component, a foundational primitive
    path: index.ts
    gates: ["^authenticated"]
`);
      await repo.commitAll('refB: #alpha gains ^authenticated gate');
      const refB = await repo.git('rev-parse', 'HEAD');

      report = await semanticDiff(refA, refB, { cwd: repo.dir });
    });

    afterAll(async () => {
      await repo?.destroy();
    });

    it('#alpha is contract-changed with the gates slot moved', () => {
      const d = report.contractChanged.find((x) => x.symbol === '#alpha');
      expect(d).toBeDefined();
      expect(d!.changedSlots).toContain('gates');
      expect(d!.changeset?.gatesAdded).toContain('^authenticated');
    });

    it('it is NOT a renamed-noop (a real meaning change, zero renames)', () => {
      expect(report.renamedNoop).toEqual([]);
      expect(report.renamedNoopCount).toBe(0);
      // the referenced gate ^authenticated also materializes as a born symbol.
      expect(report.born.some((b) => b.symbol === '^authenticated')).toBe(true);
    });
  });
});
