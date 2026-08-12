/**
 * judge-scoring.test — the falsifier harness (expo-field-test-protocol.md §4/§5/§7A/
 * §9), pure functions, no model. Claims:
 *   - kappa computes on a known table (perfect agreement → 1; systematic disagreement → -1).
 *   - an OBJECTIVE regression counts as a false CLEAN even when the LLM says "not-broken".
 *   - the §7A bounds are TWO separate numbers, never blended.
 *   - seeded-control precision/recall are computed against ground truth.
 *   - the INDETERMINATE fraction is reported against the contested floor.
 */

import { describe, it, expect } from 'vitest';
import {
  cohensKappa,
  confusionTable,
  ruleOfThree,
  confirmCleanFalse,
  scoreCleanAudits,
  twoDenominatorBounds,
  seededControlPrecisionRecall,
  beatsPriorPrecision,
  indeterminateFraction,
  judgeVsWarpline,
  beforeAfterPreFix,
} from '../src/judge/scoring.js';
import type { Judgment } from '../src/judge/types.js';

describe('#judge/scoring — Cohen kappa + confusion', () => {
  it('perfect agreement → kappa 1', () => {
    expect(cohensKappa(['A', 'A', 'B', 'B'], ['A', 'A', 'B', 'B'])).toBe(1);
  });
  it('systematic total disagreement over two balanced labels → kappa -1', () => {
    expect(cohensKappa(['A', 'B', 'A', 'B'], ['B', 'A', 'B', 'A'])).toBeCloseTo(-1, 10);
  });
  it('a known mixed table computes the textbook value', () => {
    // a: G G O O ; b: G O O O → po=3/4; marginals a{G:2,O:2} b{G:1,O:3}
    // pe = (2/4)(1/4)+(2/4)(3/4) = 0.125+0.375 = 0.5 ; kappa=(0.75-0.5)/0.5 = 0.5
    expect(cohensKappa(['G', 'G', 'O', 'O'], ['G', 'O', 'O', 'O'])).toBeCloseTo(0.5, 10);
  });
  it('builds a confusion table keyed rater-a × rater-b', () => {
    const t = confusionTable([
      { a: 'GENUINE', b: 'knot' },
      { a: 'GENUINE', b: 'knot' },
      { a: 'OVER-BLOCK', b: 'clean' },
    ]);
    expect(t.GENUINE.knot).toBe(2);
    expect(t['OVER-BLOCK'].clean).toBe(1);
  });
});

describe('#judge/scoring — §4 confirmation JOIN (objective is non-vetoable)', () => {
  it('an objective regression is a confirmed false CLEAN even when the LLM says not-broken', () => {
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: true, blindedConfirmation: 'not-broken' })).toBe(
      'confirmed-false-clean',
    );
  });
  it('a subjective candidate is confirmed only when the rater says broken', () => {
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: false, blindedConfirmation: 'broken' })).toBe(
      'confirmed-false-clean',
    );
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: false, blindedConfirmation: 'not-broken' })).toBe(
      'true-clean',
    );
  });
  it('a blind-class CLEAN with no objective regression is blind-untested, not surviving', () => {
    expect(
      confirmCleanFalse({ cardId: 'c', objectiveRegression: false, blindedConfirmation: 'pending', coveredClass: false }),
    ).toBe('blind-untested');
  });
  it('rolls up counts across audited CLEANs', () => {
    const roll = scoreCleanAudits([
      { cardId: 'a', objectiveRegression: true, blindedConfirmation: 'not-broken' },
      { cardId: 'b', objectiveRegression: false, blindedConfirmation: 'broken' },
      { cardId: 'c', objectiveRegression: false, blindedConfirmation: 'not-broken' },
      { cardId: 'd', objectiveRegression: false, blindedConfirmation: 'pending', coveredClass: false },
    ]);
    expect(roll.confirmedFalseClean).toBe(2);
    expect(roll.trueClean).toBe(1);
    expect(roll.blindUntested).toBe(1);
  });
});

describe('#judge/scoring — §7A two-denominator bounds, never blended', () => {
  it('reports objective and subjective as SEPARATE rule-of-three bounds', () => {
    const b = twoDenominatorBounds({ nObjective: 100, objectiveConfirmed: 0, nSubjective: 18, subjectiveConfirmed: 0 });
    expect(b.objective.upper95).toBeCloseTo(0.03, 10); // 3/100
    expect(b.subjective.upper95).toBeCloseTo(3 / 18, 10); // ~0.1667 — materially looser
    expect(b.objective.ruleOfThree).toBe(true);
    expect(b.subjective.ruleOfThree).toBe(true);
    // The two bounds are NOT collapsed into one number.
    expect(b.objective.upper95).not.toBe(b.subjective.upper95);
    // The return shape carries NO blended field — only the two denominators.
    expect(Object.keys(b).sort()).toEqual(['objective', 'subjective']);
  });
  it('ruleOfThree is 3/n', () => {
    expect(ruleOfThree(100)).toBeCloseTo(0.03, 10);
    expect(ruleOfThree(0)).toBe(1);
  });
});

describe('#judge/scoring — seeded classifier control (A11)', () => {
  it('computes GENUINE precision and OVER-BLOCK recall against ground truth', () => {
    const pr = seededControlPrecisionRecall([
      { groundTruth: 'GENUINE', judgeLabel: 'GENUINE' }, // TP genuine
      { groundTruth: 'GENUINE', judgeLabel: 'GENUINE' }, // TP genuine
      { groundTruth: 'OVER-BLOCK', judgeLabel: 'GENUINE' }, // false-GENUINE (hurts precision)
      { groundTruth: 'OVER-BLOCK', judgeLabel: 'OVER-BLOCK' }, // caught over-block
    ]);
    expect(pr.genuinePrecision).toBeCloseTo(2 / 3, 10); // 2 true of 3 called genuine
    expect(pr.overBlockRecall).toBeCloseTo(1 / 2, 10); // 1 caught of 2 true over-blocks
    expect(beatsPriorPrecision(pr.genuinePrecision)).toBe(true); // 0.667 > 0.29
    expect(beatsPriorPrecision(0.2)).toBe(false);
  });
});

describe('#judge/scoring — INDETERMINATE fraction + (B)/(C) + before/after', () => {
  const knot = (majorityLabel: string, indeterminate: boolean, noMajority: boolean): Judgment => ({
    cardId: 'k',
    cardKind: 'knot',
    rubricHash: 'rubric:v1:x',
    samples: [],
    parsedLabels: [],
    spread: {},
    majorityLabel,
    indeterminate,
    noMajority,
  });

  it('reports the INDETERMINATE fraction against the contested floor', () => {
    const js = [
      knot('GENUINE', false, false),
      knot('GENUINE', false, false),
      knot('NO-MAJORITY', true, true),
      knot('INDETERMINATE', true, false),
    ];
    const f = indeterminateFraction(js);
    expect(f.total).toBe(4);
    expect(f.indeterminate).toBe(2);
    expect(f.noMajority).toBe(1);
    expect(f.fraction).toBeCloseTo(0.5, 10);
    expect(f.contestedAfterDrain).toBe(2);
  });

  it('(B)/(C): over-block counts against meaning; K2 shape flagged when over-block > genuine', () => {
    const r = judgeVsWarpline([
      { cardId: 'a', judgeLabel: 'OVER-BLOCK', warplineVerdict: 'knot' },
      { cardId: 'b', judgeLabel: 'OVER-BLOCK', warplineVerdict: 'knot' },
      { cardId: 'c', judgeLabel: 'GENUINE', warplineVerdict: 'knot' },
      { cardId: 'd', judgeLabel: 'INDETERMINATE', warplineVerdict: 'knot' },
    ]);
    expect(r.genuine).toBe(1);
    expect(r.overBlock).toBe(2);
    expect(r.indeterminate).toBe(1);
    expect(r.overBlockExceedsGenuine).toBe(true); // K2 tripped
  });

  it('before/after the pre-fix, scored against the FIXED judge label', () => {
    const ba = beforeAfterPreFix([
      { cardId: 'a', judgeLabel: 'clean', warplineBefore: 'knot', warplineAfter: 'clean' }, // improved
      { cardId: 'b', judgeLabel: 'clean', warplineBefore: 'clean', warplineAfter: 'clean' }, // held
      { cardId: 'c', judgeLabel: 'knot', warplineBefore: 'knot', warplineAfter: 'clean' }, // regressed
    ]);
    expect(ba.agreeBefore).toBe(2);
    expect(ba.agreeAfter).toBe(2);
    expect(ba.improved).toBe(1);
    expect(ba.regressed).toBe(1);
  });
});
