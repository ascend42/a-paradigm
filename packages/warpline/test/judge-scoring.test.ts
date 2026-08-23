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
  wilsonLowerBound,
  indeterminateFraction,
  meetsContestedFloor,
  subjectiveBoundInputs,
  judgeVsWarpline,
  beforeAfterPreFix,
} from '../src/judge/scoring.js';
import type { Judgment, Provenance } from '../src/judge/types.js';

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
  it('indeterminate and pending are their OWN verdicts — never rounded into true-clean (B3, §5)', () => {
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: false, blindedConfirmation: 'indeterminate' })).toBe(
      'indeterminate',
    );
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: false, blindedConfirmation: 'pending' })).toBe('pending');
    // An objective regression still wins over either — non-vetoable.
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: true, blindedConfirmation: 'indeterminate' })).toBe(
      'confirmed-false-clean',
    );
    expect(confirmCleanFalse({ cardId: 'c', objectiveRegression: true, blindedConfirmation: 'pending' })).toBe(
      'confirmed-false-clean',
    );
  });
  it('rolls up counts across audited CLEANs — indeterminate / pending separate, n_subjective excludes them', () => {
    const audits = [
      { cardId: 'a', objectiveRegression: true, blindedConfirmation: 'not-broken' as const },
      { cardId: 'b', objectiveRegression: false, blindedConfirmation: 'broken' as const },
      { cardId: 'c', objectiveRegression: false, blindedConfirmation: 'not-broken' as const },
      { cardId: 'd', objectiveRegression: false, blindedConfirmation: 'pending' as const, coveredClass: false },
      { cardId: 'e', objectiveRegression: false, blindedConfirmation: 'indeterminate' as const },
      { cardId: 'f', objectiveRegression: false, blindedConfirmation: 'pending' as const },
    ];
    const roll = scoreCleanAudits(audits);
    expect(roll.confirmedFalseClean).toBe(2);
    expect(roll.trueClean).toBe(1);
    expect(roll.blindUntested).toBe(1);
    expect(roll.indeterminate).toBe(1);
    expect(roll.pending).toBe(1);
    expect(roll.nSubjective).toBe(3); // true-clean + confirmed-false-clean ONLY
    // The §7A subjective inputs: neither indeterminate nor pending enters the denominator.
    const inputs = subjectiveBoundInputs(audits);
    expect(inputs).toEqual({ nSubjective: 3, subjectiveConfirmed: 2, indeterminate: 1, pending: 1 });
    const b = twoDenominatorBounds({ nObjective: 100, objectiveConfirmed: 1, ...inputs });
    expect(b.subjective.n).toBe(3);
    expect(b.subjective.observed).toBe(2);
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
    // The lower bounds are reported alongside (B5) — 2/3 on n=3 is NOT materially above 0.29.
    expect(pr.genuinePrecisionLowerBound95).toBeCloseTo(wilsonLowerBound(2, 3), 10);
    expect(pr.overBlockRecallLowerBound95).toBeCloseTo(wilsonLowerBound(1, 2), 10);
    expect(beatsPriorPrecision(pr.genuinePrecision, 0.29, { successes: 2, n: 3 })).toBe(false);
    // A bare point estimate NEVER beats the prior — no counts, no bound (fail closed).
    expect(beatsPriorPrecision(0.9)).toBe(false);
    expect(beatsPriorPrecision(null, 0.29, { successes: 0, n: 0 })).toBe(false);
  });

  it('beatsPriorPrecision is the one-sided 95% Wilson LOWER bound vs the prior (B5)', () => {
    expect(beatsPriorPrecision(1 / 3, 0.29, { successes: 1, n: 3 })).toBe(false); // point 0.33 > 0.29, LB ≈ 0.08
    expect(beatsPriorPrecision(1, 0.29, { successes: 8, n: 8 })).toBe(true); // LB ≈ 0.75
    expect(beatsPriorPrecision(0.7, 0.29, { successes: 7, n: 10 })).toBe(true); // LB ≈ 0.44
    expect(beatsPriorPrecision(0.3, 0.29, { successes: 3, n: 10 })).toBe(false); // LB ≈ 0.13
  });

  it('wilsonLowerBound: known values, monotone in n, 0 at n=0', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(1, 3)).toBeCloseTo(0.078, 2);
    expect(wilsonLowerBound(8, 8)).toBeCloseTo(0.747, 2);
    expect(wilsonLowerBound(7, 10)).toBeCloseTo(0.442, 2);
    expect(wilsonLowerBound(3, 10)).toBeCloseTo(0.127, 2);
    // Same proportion, more evidence → tighter (higher) lower bound.
    expect(wilsonLowerBound(80, 100)).toBeGreaterThan(wilsonLowerBound(8, 10));
    // Never above the point estimate.
    expect(wilsonLowerBound(8, 8)).toBeLessThan(1);
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

  it('reports the INDETERMINATE fraction; after the drain GENUINE and OVER-BLOCK are SEPARATE (B6)', () => {
    const js = [
      knot('GENUINE', false, false),
      knot('GENUINE', false, false),
      knot('OVER-BLOCK', false, false),
      knot('NO-MAJORITY', true, true),
      knot('INDETERMINATE', true, false),
    ];
    const f = indeterminateFraction(js);
    expect(f.total).toBe(5);
    expect(f.excluded).toBe(0);
    expect(f.indeterminate).toBe(2);
    expect(f.noMajority).toBe(1);
    expect(f.fraction).toBeCloseTo(0.4, 10);
    expect(f.genuineAfterDrain).toBe(2); // NOT genuine+over-block
    expect(f.overBlockAfterDrain).toBe(1);
    expect('contestedAfterDrain' in f).toBe(false); // the mislabel is gone
    expect(meetsContestedFloor(f.genuineAfterDrain)).toBe(false); // 2 < 20
    expect(meetsContestedFloor(20)).toBe(true);
    expect(meetsContestedFloor(f.genuineAfterDrain, 2)).toBe(true);
  });

  it('excludes seeds / planted / corpus from the INDETERMINATE denominator (B6, §9 A14)', () => {
    const withId = (id: string, label: string, indet = false): Judgment => ({ ...knot(label, indet, false), cardId: id });
    const js = [
      withId('real-1', 'GENUINE'),
      withId('real-2', 'INDETERMINATE', true),
      withId('seed-1', 'GENUINE'),
      withId('planted-1', 'INDETERMINATE', true),
      withId('corpus-1', 'GENUINE'),
    ];
    const provenance = new Map<string, Provenance>([
      ['real-1', { source: 'oracle-flagged' }],
      ['real-2', { source: 'knot' }],
      ['seed-1', { source: 'seeded-control', seededControl: true, groundTruth: 'GENUINE' }],
      ['planted-1', { source: 'oracle-flagged', planted: true }],
      ['corpus-1', { source: 'corpus' }],
    ]);
    // With a provenance map: seeds / planted / corpus are out by default.
    const f = indeterminateFraction(js, { provenance });
    expect(f.total).toBe(2);
    expect(f.excluded).toBe(3);
    expect(f.indeterminate).toBe(1);
    expect(f.fraction).toBeCloseTo(0.5, 10);
    expect(f.genuineAfterDrain).toBe(1);
    // An explicit exclude predicate wins.
    const g = indeterminateFraction(js, { exclude: (id) => id.startsWith('seed-') });
    expect(g.total).toBe(4);
    expect(g.excluded).toBe(1);
    // Without either, nothing is excluded (the caller has asserted there are no controls).
    expect(indeterminateFraction(js).total).toBe(5);
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
