/**
 * Tests for the planner's learned-token-table loader (#calibration, v7.1
 * §2.4 / §L.3).
 *
 * The planner (planAgentSequence) reads the learned table FIRST when previewing
 * orchestration cost, falling back to the hardcoded AGENT_TOKEN_ESTIMATES
 * cold-start constant for any cell it hasn't learned. This covers the loader
 * contract:
 *  - missing file → {} (planner falls back to the constant)
 *  - malformed JSON → {} (best-effort, never throws)
 *  - non-object / array JSON → {}
 *  - a well-formed learned table loads its [archetype][taskType] cells
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  loadLearnedTokenTable,
  resolveAgentEstimate,
  estimateForTask,
  assembleCalibrationGrid,
} from './orchestration.js';

let root: string;

const LEARNED = (r: string) =>
  path.join(r, '.paradigm', 'learned', 'token-estimates.json');

function writeLearned(r: string, content: string): void {
  fs.mkdirSync(path.dirname(LEARNED(r)), { recursive: true });
  fs.writeFileSync(LEARNED(r), content, 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-loader-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('loadLearnedTokenTable', () => {
  it('returns {} when the file is missing (→ constant fallback)', () => {
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('returns {} on malformed JSON without throwing', () => {
    writeLearned(root, '{ this is not json');
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('returns {} when the JSON is an array (wrong shape)', () => {
    writeLearned(root, '[1,2,3]');
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('returns {} when the JSON is null', () => {
    writeLearned(root, 'null');
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('loads a well-formed learned table keyed by [archetype][taskType]', () => {
    writeLearned(
      root,
      JSON.stringify({
        builder: {
          feature: { min: 12000, max: 42000, n: 12 },
          bugfix: { min: 8000, max: 20000, n: 9 },
        },
        architect: {
          analysis: { min: 4000, max: 15000, n: 8 },
        },
      }),
    );

    const table = loadLearnedTokenTable(root);
    expect(table.builder.feature).toEqual({ min: 12000, max: 42000, n: 12 });
    expect(table.builder.bugfix.max).toBe(20000);
    expect(table.architect.analysis.n).toBe(8);
    // A cell the table doesn't have is simply absent → planner uses the constant.
    expect(table.builder.analysis).toBeUndefined();
    expect(table.tester).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// resolveAgentEstimate — widened to {min,max,n,source} (renaissance)
// ────────────────────────────────────────────────────────

describe('resolveAgentEstimate (n + source provenance)', () => {
  const LEARNED_TABLE = {
    builder: { feature: { min: 12000, max: 42000, n: 12 } },
  };

  it('a graduated cell → source:learned, with its sample count n', () => {
    const est = resolveAgentEstimate(LEARNED_TABLE, 'builder', 'feature');
    expect(est).toEqual({ min: 12000, max: 42000, n: 12, source: 'learned' });
  });

  it('an unlearned cell → cold-start prior (source:prior, n:0)', () => {
    const est = resolveAgentEstimate(LEARNED_TABLE, 'builder', 'refactor');
    expect(est.source).toBe('prior');
    expect(est.n).toBe(0);
    // builder's cold-start constant.
    expect(est.min).toBe(10000);
    expect(est.max).toBe(50000);
  });

  it('an unknown archetype → generic prior, never throws', () => {
    const est = resolveAgentEstimate({}, 'nobody', 'feature');
    expect(est).toEqual({ min: 5000, max: 20000, n: 0, source: 'prior' });
  });
});

// ────────────────────────────────────────────────────────
// estimateForTask — per-task estimate the Tasks UI renders
// ────────────────────────────────────────────────────────

describe('estimateForTask', () => {
  const table = { builder: { feature: { min: 12000, max: 42000, n: 12 } } };

  it('an archetype claimant resolves its learned cell', () => {
    const est = estimateForTask(table, { blurb: 'add a feature for users', claimant: { kind: 'archetype', ref: 'builder' } });
    expect(est.source).toBe('learned');
    expect(est.n).toBe(12);
  });

  it('a human claimant falls back to the archetype hint (else builder)', () => {
    const est = estimateForTask(table, { blurb: 'add a feature', claimant: { kind: 'human', ref: 'matt@x.com' } }, 'builder');
    // hint=builder, blurb classifies feature → the learned builder×feature cell.
    expect(est.source).toBe('learned');
  });

  it('defaults to the builder archetype when unclaimed and no hint', () => {
    const est = estimateForTask(table, { blurb: 'add a feature' });
    expect(est.source).toBe('learned'); // builder×feature is learned
  });
});

// ────────────────────────────────────────────────────────
// assembleCalibrationGrid — the hero-strip grid
// ────────────────────────────────────────────────────────

describe('assembleCalibrationGrid', () => {
  it('cold-start (no learned file) → a full all-prior grid, 0% coverage', () => {
    const grid = assembleCalibrationGrid(root);
    expect(grid.archetypes).toContain('builder');
    expect(grid.taskTypes).toContain('feature');
    expect(grid.coverage.graduated).toBe(0);
    expect(grid.coverage.total).toBe(grid.archetypes.length * grid.taskTypes.length);
    expect(grid.coverage.pct).toBe(0);
    expect(grid.cells.builder.feature.source).toBe('prior');
  });

  it('counts graduated (learned) cells toward coverage', () => {
    writeLearned(root, JSON.stringify({
      builder: { feature: { min: 12000, max: 42000, n: 12 }, bugfix: { min: 8000, max: 20000, n: 9 } },
    }));
    const grid = assembleCalibrationGrid(root);
    expect(grid.coverage.graduated).toBe(2);
    expect(grid.cells.builder.feature.source).toBe('learned');
    expect(grid.cells.builder.feature.n).toBe(12);
    expect(grid.coverage.pct).toBeGreaterThan(0);
  });
});
