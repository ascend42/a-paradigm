import { describe, it, expect } from 'vitest';
import type { OracleRecord } from './types';
import {
  CALM_DIVERGENCE_COPY,
  consequenceLine,
  forecastToRecord,
  gitChip,
  heroState,
  isCalm,
  isDivergentRow,
  isHeadlineDivergence,
  ledgerRowLabel,
  matrixCells,
  meaningChip,
  rawCounts,
} from './viewerState';

/**
 * Smoke + data-binding test for the Oracle Divergence Viewer's PURE layer.
 *
 * RTL/jsdom are NOT installed in platform-ui, and vitest runs node-env — so this
 * exercises the React-free binding/state functions (the same functions the .tsx
 * components consume) against TWO real sample records. It asserts the DIVERGENT
 * verdict + dangle target render decisions and the CONVERGENT calm copy. The
 * components import these helpers, so a passing helper = a faithful render input.
 */

// (a) DIVERGENT — git CLEAN ✓ but meaning caught a dangling caller→helper, A retired it.
const DIVERGENT: OracleRecord = {
  schemaVersion: 1,
  ts: '2026-06-24T12:00:00.000Z',
  repo: '/repo',
  branchA: 'feat-rename',
  branchB: 'feat-call',
  mergeBase: 'abc1234567890',
  prediction: {
    autoClean: [],
    knots: [],
    dangling: [
      {
        fromKey: '#code:src/x.ts::caller',
        fromSymbol: '#code:src/x.ts::caller',
        edgeKind: 'calls',
        danglingTargetSymbol: '#code:src/x.ts::helper',
        retiredBy: 'A',
      },
    ],
  },
  gitReality: {
    conflicted: false, // git merged CLEAN — the trap
    conflictSymbols: [],
    conflictPaths: [],
  },
  convergence: {
    agreeClean: [],
    agreeConflict: [],
    divergeGitOnly: [],
    divergeMeaningOnly: ['#code:src/x.ts::caller'],
    score: 0,
    verdict: 'DIVERGENT',
  },
  justifications: {
    A: { actor: 'alice', intent: 'rename helper → assist' },
    B: { actor: 'bob', intent: 'add a call into helper' },
  },
};

// CONVERGENT — nothing to see; the calm state.
const CONVERGENT: OracleRecord = {
  schemaVersion: 1,
  ts: '2026-06-24T13:00:00.000Z',
  repo: '/repo',
  branchA: 'main',
  branchB: 'feat-docs',
  mergeBase: 'def9876543210',
  prediction: { autoClean: ['#code:src/y.ts::doc'], knots: [], dangling: [] },
  gitReality: { conflicted: false, conflictSymbols: [], conflictPaths: [] },
  convergence: {
    agreeClean: ['#code:src/y.ts::doc'],
    agreeConflict: [],
    divergeGitOnly: [],
    divergeMeaningOnly: [],
    score: 1,
    verdict: 'CONVERGENT',
  },
  justifications: {
    A: { actor: 'alice', intent: 'main' },
    B: { actor: 'bob', intent: 'docs only' },
  },
};

describe('OracleDivergenceViewer — DIVERGENT record', () => {
  it('is the headline divergence (lights the ★ + pulses the seam)', () => {
    expect(heroState(DIVERGENT)).toBe('divergence');
    expect(isHeadlineDivergence(DIVERGENT)).toBe(true);
  });

  it('git chip shows the CLEAN ✓ trap while meaning verdict is DIVERGENT', () => {
    expect(gitChip(DIVERGENT)).toEqual({ label: 'CLEAN ✓', clean: true });
    expect(meaningChip(DIVERGENT)).toEqual({ verdict: 'DIVERGENT', knots: 0, dangles: 1 });
  });

  it('the ★ matrix cell carries the real meaning-only symbol key (falsifiable)', () => {
    const cells = matrixCells(DIVERGENT.convergence);
    const star = cells.find((c) => c.star)!;
    expect(star.id).toBe('divergeMeaningOnly');
    expect(star.symbols).toEqual(['#code:src/x.ts::caller']);
    // ★ cell is git-clean × meaning-knot (bottom-left of the literal 2×2)
    expect(star.gitConflict).toBe(false);
    expect(star.meaningKnot).toBe(true);
  });

  it('the verdict consequence line names the dangle target + who retired it', () => {
    const line = consequenceLine(DIVERGENT);
    expect(line).toContain('#code:src/x.ts::helper'); // the severed target renders
    expect(line).toContain('retired by A');
    // raw counts always accompany the score
    expect(rawCounts(DIVERGENT.convergence)).toEqual({
      agree: 0,
      divergeGitOnly: 0,
      divergeMeaningOnly: 1,
    });
  });

  it('ledger row is divergent (seam-violet dot) with the branchA→branchB label', () => {
    expect(isDivergentRow(DIVERGENT)).toBe(true);
    expect(ledgerRowLabel(DIVERGENT)).toBe('feat-rename→feat-call');
  });
});

describe('OracleDivergenceViewer — CONVERGENT record', () => {
  it('is calm — verdict CONVERGENT, no knots, no dangles', () => {
    expect(heroState(CONVERGENT)).toBe('convergent');
    expect(isCalm(CONVERGENT)).toBe(true);
    expect(isHeadlineDivergence(CONVERGENT)).toBe(false);
  });

  it('shows the "weave is clean" calm copy', () => {
    expect(consequenceLine(CONVERGENT)).toBe(CALM_DIVERGENCE_COPY);
    expect(CALM_DIVERGENCE_COPY).toBe('No knots. No dangles. The weave is clean.');
  });

  it('no matrix cell is lit (the ★ cell has zero symbols)', () => {
    const star = matrixCells(CONVERGENT.convergence).find((c) => c.star)!;
    expect(star.symbols).toEqual([]);
    expect(isDivergentRow(CONVERGENT)).toBe(false);
  });
});

describe('forecastToRecord — Preview adapts to a renderable record', () => {
  it('maps a vsGit forecast into a DIVERGENT OracleRecord', () => {
    const rec = forecastToRecord({
      branchA: 'a',
      branchB: 'b',
      mergeBase: 'base',
      autoClean: [],
      knots: [],
      dangling: DIVERGENT.prediction.dangling,
      vsGit: { ...DIVERGENT.convergence, gitConflicted: false, conflictSymbols: [] },
    });
    expect(rec.convergence.verdict).toBe('DIVERGENT');
    expect(heroState(rec)).toBe('divergence');
    expect(consequenceLine(rec)).toContain('#code:src/x.ts::helper');
  });
});
