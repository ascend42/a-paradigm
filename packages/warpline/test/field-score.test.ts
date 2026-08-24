/**
 * field-score.test — the §7/§9 scoring harness over synthetic recorded
 * artifacts (B7 increment 2). Everything is PURE input — no disk, no fabric.
 *
 *   §7A  : TWO bounds over TWO distinct denominators — never blended.
 *   §7B  : the byte-baseline column + meaning-decisive count; catch-candidates
 *          are emitted but NOT claimed.
 *   §7C  : intervention rate + the K2 over-block>genuine flag.
 *   SEEDS: Wilson lower-bound gate on the seeded-control precision.
 *   §9   : the report carries the caveat strings; genuine<20 → INCONCLUSIVE;
 *          a missing/uncaught planted control → '(A) not tested'.
 */

import { describe, it, expect } from 'vitest';
import { JudgeLedger } from '../src/judge/ledger.js';
import type { Judgment, Provenance } from '../src/judge/types.js';
import { FIELD_ORACLE_ROW_SCHEMA, type OracleRow } from '../src/field/oracle.js';
import type { GitFallbackEntry } from '../src/field/fallback.js';
import {
  scoreFieldRun,
  renderFieldReport,
  CORRELATED_PRIORS_CAVEAT,
  PRE_FIX_BASELINE_FRAMING,
  type MergeByteBaseline,
  type KnotByteBaseline,
} from '../src/field/score.js';
import { AUDIT_SAMPLE_LEAK_CAVEAT } from '../src/field/interleave.js';

function row(over: Partial<OracleRow>): OracleRow {
  return {
    schemaVersion: FIELD_ORACLE_ROW_SCHEMA,
    ts: 'T0',
    strandId: over.pickId ?? 'p?',
    pickId: 'p?',
    seq: null,
    mode: 'merge',
    agents: ['a', 'b'],
    parentStateIds: ['sa', 'sb'],
    mergedTreeId: 'tree:m',
    greengate: 'declared',
    oracle: { checks: { typecheck: 'pass' } },
    changedPaths: ['src/foo.ts'],
    coveredClass: true,
    blind: [],
    objectiveRegression: false,
    source: 'clean-sweep',
    verdict: 'true-clean',
    notes: [],
    prevRowHash: null,
    rowHash: 'fieldOracleRow:v1:x',
    ...over,
  };
}

function judgment(cardId: string, majorityLabel: string, kind: 'knot' | 'clean' = 'knot'): Judgment {
  const indeterminate = majorityLabel === 'INDETERMINATE' || majorityLabel === 'NO-MAJORITY';
  return {
    cardId,
    cardKind: kind,
    rubricHash: 'rubric:v1:x',
    samples: [majorityLabel, majorityLabel, majorityLabel],
    parsedLabels: [majorityLabel, majorityLabel, majorityLabel],
    spread: { [majorityLabel]: 3 },
    majorityLabel,
    indeterminate,
    noMajority: majorityLabel === 'NO-MAJORITY',
  };
}

/** Build a sealed in-memory ledger + matching judgments for the scenario. */
function buildLedger(spec: {
  cleans: Array<{ pickId: string; source: 'oracle-flagged' | 'audit-sample'; label: string; objectiveRegression?: boolean; joined?: boolean }>;
  knots: string[]; // judge labels, one knot card each
  genuineSeeds?: string[]; // judge labels on KNOWN-GENUINE seeds
  overBlockSeeds?: string[]; // judge labels on KNOWN-OVER-BLOCK seeds
  planted?: string[]; // judge labels on planted clean controls
}): { ledger: JudgeLedger; judgments: Judgment[] } {
  const ledger = new JudgeLedger();
  const judgments: Judgment[] = [];
  let n = 0;
  const seal = (label: string, provenance: Provenance, kind: 'knot' | 'clean'): ReturnType<JudgeLedger['sealJudgeVerdict']> => {
    const cardId = `ratingCard:v1:card-${n++}`;
    const row = ledger.sealJudgeVerdict({ cardId, judgeVerdict: label, provenance });
    judgments.push(judgment(cardId, label, kind));
    return row;
  };
  for (const c of spec.cleans) {
    const row = seal(c.label, {
      source: c.source,
      ...(c.source === 'audit-sample' ? { auditSample: true } : {}),
      pickId: c.pickId,
      objectiveRegression: c.objectiveRegression ?? false,
      coveredClass: true,
    }, 'clean');
    // write-before-reveal: the Warpline answer is joined AFTER the seal — a
    // rating only counts as a confirmation once its join row exists (§3).
    if (c.joined ?? true) {
      ledger.joinWarplineVerdict({
        cardId: row.cardId,
        judgeRowHash: row.rowHash,
        warplineVerdict: c.source === 'oracle-flagged' ? 'candidate-false-clean' : 'true-clean',
      });
    }
  }
  for (const label of spec.knots) seal(label, { source: 'knot' }, 'knot');
  for (const label of spec.genuineSeeds ?? []) seal(label, { source: 'seeded-control', seededControl: true, groundTruth: 'GENUINE' }, 'knot');
  for (const label of spec.overBlockSeeds ?? []) seal(label, { source: 'seeded-control', seededControl: true, groundTruth: 'OVER-BLOCK' }, 'knot');
  for (const label of spec.planted ?? []) seal(label, { source: 'planted-control', planted: true, groundTruth: 'broken' }, 'clean');
  return { ledger, judgments };
}

describe('FIELD SCORE — §7 over synthetic artifacts', () => {
  // 36 covered true-clean merge seals; the audit sample is the first 15 (every-5th < floor)
  const oracleRows: OracleRow[] = Array.from({ length: 36 }, (_, i) => row({ pickId: `p${i}`, strandId: `p${i}` }));
  const sampledPickIds = oracleRows.slice(0, 15).map((r) => r.pickId);

  const { ledger, judgments } = buildLedger({
    cleans: sampledPickIds.map((pickId) => ({ pickId, source: 'audit-sample' as const, label: 'not-broken' })),
    // 2 GENUINE, 3 OVER-BLOCK, 1 INDETERMINATE → K2 trips (3 > 2), floor unmet (2 < 20)
    knots: ['GENUINE', 'GENUINE', 'OVER-BLOCK', 'OVER-BLOCK', 'OVER-BLOCK', 'INDETERMINATE'],
    genuineSeeds: Array.from({ length: 8 }, () => 'GENUINE'), // 8/8 → Wilson LB ≈ .69 > .29
    overBlockSeeds: ['OVER-BLOCK', 'OVER-BLOCK', 'OVER-BLOCK'],
    planted: ['broken'], // planted control CAUGHT
  });

  const fallbacks: GitFallbackEntry[] = [
    { ts: 'T1', actor: 'op', message: 'git stash to escape a wedge' },
    { ts: 'T2', actor: 'op', message: 'manual merge outside warpline' },
  ];

  const mergeBaselines: MergeByteBaseline[] = [
    { pickId: 'p0', computable: true, byteConflicted: true, conflictedFiles: ['src/foo.ts'] },
    { pickId: 'p1', computable: true, byteConflicted: true, conflictedFiles: ['src/foo.ts'] },
    { pickId: 'p2', computable: true, byteConflicted: false, conflictedFiles: [] },
    { pickId: 'p3', computable: false, byteConflicted: false, conflictedFiles: [], note: 'no recipe base' },
  ];
  const knotBaselines: KnotByteBaseline[] = [
    { payloadId: 'knotPayload:v1:aa', cardId: 'ratingCard:v1:k1', computable: true, byteConflicted: false }, // catch-candidate
    { payloadId: 'knotPayload:v1:bb', cardId: 'ratingCard:v1:k2', computable: true, byteConflicted: true },
  ];

  const score = scoreFieldRun({
    oracleRows,
    ledgerRows: ledger.all(),
    judgments,
    fallbacks,
    mergeBaselines,
    knotBaselines,
  });

  it('§7A: two bounds over DISTINCT denominators, never blended', () => {
    expect(score.sevenA.bounds.objective.n).toBe(36);
    expect(score.sevenA.bounds.subjective.n).toBe(15); // the rated audit sample only
    expect(score.sevenA.bounds.objective.n).not.toBe(score.sevenA.bounds.subjective.n);
    expect(score.sevenA.bounds.objective.observed).toBe(0);
    expect(score.sevenA.bounds.subjective.observed).toBe(0);
    expect(score.sevenA.bounds.objective.ruleOfThree).toBe(true);
    // the shape has NO combined field — blending is impossible by construction
    expect('combined' in score.sevenA.bounds).toBe(false);
    expect(score.sevenA.auditSampleSize).toBe(15);
    expect(score.sevenA.dismissedCleanFalseCleanCount).toBe(0);
    expect(score.sevenA.plantedControl).toBe('caught');
    expect(score.sevenA.verdict).toBe('SURVIVES (this run)');
  });

  it('§7A: UNJOINED ratings are pending — outside n_subjective (write-before-reveal gate)', () => {
    const unjoined = buildLedger({
      cleans: sampledPickIds.map((pickId) => ({ pickId, source: 'audit-sample' as const, label: 'not-broken', joined: false })),
      knots: [],
      planted: ['broken'],
    });
    const sc = scoreFieldRun({
      oracleRows,
      ledgerRows: unjoined.ledger.all(),
      judgments: unjoined.judgments,
      fallbacks: [],
      mergeBaselines: [],
      knotBaselines: [],
    });
    // rated but never joined: every audit is 'pending', the subjective denominator is EMPTY
    expect(sc.sevenA.subjective.pending).toBe(15);
    expect(sc.sevenA.subjective.nSubjective).toBe(0);
    expect(sc.sevenA.bounds.subjective.n).toBe(0);
    expect(sc.sevenA.bounds.subjective.upper95).toBe(1); // rule of three over n=0 fails closed
  });

  it('§7B: byte-baseline column recorded; meaning-decisive counted; catch-candidates NOT claimed', () => {
    expect(score.sevenB.byteBaselines).toHaveLength(4);
    expect(score.sevenB.meaningDecisive).toBe(2); // p0+p1: CLEAN ∧ byte-conflicted ∧ oracle true-clean
    expect(score.sevenB.meaningDecisiveRate).toBeCloseTo(2 / 36);
    expect(score.sevenB.catchCandidates.count).toBe(1);
    expect(score.sevenB.catchCandidates.payloadIds).toEqual(['knotPayload:v1:aa']);
    expect(score.sevenB.catchCandidates.note).toContain('NOT claimed');
    // genuine (2) < 20 → INCONCLUSIVE regardless of the rate
    expect(score.sevenB.verdict).toBe('INCONCLUSIVE');
    // both genuine denominators reported, correction labeled pending
    expect(score.sevenB.genuineUncorrected).toBe(2);
    expect(score.sevenB.genuineNaiveCorrected).toBeCloseTo(2 * 1.0); // seed precision 8/8
    expect(score.sevenB.correctionNote).toContain('pending pre-registration v2');
  });

  it('§7C: intervention rate + the K2 flag (flag trips even when the floor forces INCONCLUSIVE)', () => {
    expect(score.sevenC.knotCount).toBe(6);
    expect(score.sevenC.fallbackCount).toBe(2);
    expect(score.sevenC.interventionRate).toBeCloseTo(8 / 36);
    expect(score.sevenC.k2).toEqual({ overBlock: 3, genuine: 2, falsified: true });
    expect(score.sevenC.verdict).toBe('INCONCLUSIVE'); // genuine < 20 wins
  });

  it('seeded-control Wilson gate: 8/8 GENUINE precision beats the ~29% prior', () => {
    expect(score.seededControl.genuinePrecision).toBe(1);
    expect(score.seededControl.overBlockRecall).toBe(1);
    expect(score.seededControl.beatsPrior).toBe(true);
    expect(score.seededControl.uncalibrated).toBe(false);
  });

  it('indeterminate drain is GENUINE-only and excludes controls from the denominator', () => {
    expect(score.indeterminate.total).toBe(6); // the 6 real knots; 11 seed knots excluded
    expect(score.indeterminate.excluded).toBe(11);
    expect(score.indeterminate.indeterminate).toBe(1);
    expect(score.indeterminate.genuineAfterDrain).toBe(2); // decisive GENUINE only — over-blocks never fold in
    expect(score.indeterminate.overBlockAfterDrain).toBe(3);
    expect(score.indeterminate.meetsFloor).toBe(false);
  });

  it('admissions override replaces the oracle-ledger denominator', () => {
    const withOverride = scoreFieldRun({
      oracleRows,
      ledgerRows: ledger.all(),
      judgments,
      fallbacks,
      mergeBaselines,
      knotBaselines,
      admissionsOverride: 100,
    });
    expect(withOverride.admissions).toEqual({ n: 100, source: 'override' });
    expect(withOverride.sevenC.interventionRate).toBeCloseTo(8 / 100);
  });

  it('§9 report: caveat strings verbatim, INCONCLUSIVE stated, bounds never blended', () => {
    const md = renderFieldReport(score);
    expect(md).toContain(CORRELATED_PRIORS_CAVEAT);
    expect(md).toContain(PRE_FIX_BASELINE_FRAMING);
    expect(md).toContain(AUDIT_SAMPLE_LEAK_CAVEAT);
    expect(md).toContain('claude-opus-4-8');
    expect(md).toContain('claude-opus-4-5-20251101');
    expect(md).toContain('VERSION-ONLY');
    expect(md).toContain('INCONCLUSIVE');
    expect(md).toContain('NEVER blended');
    expect(md).toContain('dismissed-CLEAN false-CLEAN count');
    expect(md).toContain('never generalized to "Warpline works"');
  });
});

describe('FIELD SCORE — VOID / not-tested defaults when preconditions are unmet', () => {
  it("no planted-control row → '(A) not tested' (absent instrument, not a pass)", () => {
    const oracleRows = Array.from({ length: 36 }, (_, i) => row({ pickId: `p${i}` }));
    const { ledger, judgments } = buildLedger({ cleans: [], knots: ['GENUINE'] });
    const score = scoreFieldRun({
      oracleRows,
      ledgerRows: ledger.all(),
      judgments,
      fallbacks: [],
      mergeBaselines: [],
      knotBaselines: [],
    });
    expect(score.sevenA.plantedControl).toBe('absent');
    expect(score.sevenA.verdict).toBe('NOT TESTED');
    const md = renderFieldReport(score);
    expect(md).toContain('(A) not tested');
    expect(score.sevenB.verdict).toBe('INCONCLUSIVE'); // genuine 1 < 20
    expect(score.sevenC.verdict).toBe('INCONCLUSIVE');
  });

  it("planted control rated not-broken → '(A) not tested — instrument failed its planted control' + VOID", () => {
    const oracleRows = Array.from({ length: 36 }, (_, i) => row({ pickId: `p${i}` }));
    const { ledger, judgments } = buildLedger({ cleans: [], knots: [], planted: ['not-broken'] });
    const score = scoreFieldRun({
      oracleRows,
      ledgerRows: ledger.all(),
      judgments,
      fallbacks: [],
      mergeBaselines: [],
      knotBaselines: [],
    });
    expect(score.sevenA.plantedControl).toBe('not-caught');
    expect(score.sevenA.verdict).toBe('NOT TESTED');
    expect(score.sevenA.reason).toContain('instrument failed its planted control');
    expect(score.sevenA.reason).toContain('VOID');
  });

  it('a confirmed false CLEAN falsifies (A) the moment the planted control is caught', () => {
    const oracleRows = [
      ...Array.from({ length: 36 }, (_, i) => row({ pickId: `p${i}` })),
      row({ pickId: 'pf', verdict: 'candidate-false-clean', objectiveRegression: true }),
    ];
    const { ledger, judgments } = buildLedger({
      cleans: [{ pickId: 'pf', source: 'oracle-flagged', label: 'broken', objectiveRegression: true }],
      knots: [],
      planted: ['broken'],
    });
    const score = scoreFieldRun({
      oracleRows,
      ledgerRows: ledger.all(),
      judgments,
      fallbacks: [],
      mergeBaselines: [],
      knotBaselines: [],
    });
    expect(score.sevenA.verdict).toBe('FALSIFIED');
    expect(score.sevenA.objectiveConfirmed).toBe(1);
  });

  it('planted oracle rows are excluded from every denominator (admissions, sample, bounds)', () => {
    const oracleRows = [
      ...Array.from({ length: 30 }, (_, i) => row({ pickId: `p${i}` })),
      row({ pickId: 'plant', planted: true }),
    ];
    const { ledger, judgments } = buildLedger({ cleans: [], knots: [], planted: ['broken'] });
    const score = scoreFieldRun({
      oracleRows,
      ledgerRows: ledger.all(),
      judgments,
      fallbacks: [],
      mergeBaselines: [],
      knotBaselines: [],
    });
    expect(score.admissions.n).toBe(30);
    expect(score.sevenA.nObjective).toBe(30);
    expect(score.sevenA.bounds.objective.n).toBe(30);
  });
});
