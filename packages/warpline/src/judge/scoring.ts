/**
 * #judge/scoring — the FALSIFIER HARNESS (expo-field-test-protocol.md §4, §5, §7A,
 * §9). Pure, deterministic; every function takes already-recorded labels and returns
 * numbers, so the scoring is reproducible from the sealed ledger alone.
 *
 * What it computes, and the protocol clause each honors:
 *   - Cohen's kappa (§5 / §9) — founder primary label vs judge blinded label, with the
 *     correlated-priors caveat reported ALONGSIDE, never folded in.
 *   - Confusion tables (§9) and judge-vs-Warpline for (B)/(C) on the BLINDED
 *     denominator (§5 — the second rater's classification is the denominator).
 *   - §4 false-CLEAN confirmation JOIN honoring the OBJECTIVE-NON-VETOABLE rule (A7/
 *     A10): an objective regression is a confirmed false CLEAN regardless of the LLM.
 *   - Seeded-classifier-control precision/recall (§5 / A11) — known-GENUINE precision,
 *     known-OVER-BLOCK recall — the required denominator correction.
 *   - Before/after pre-fix scoring against the FIXED judge label (A3).
 *   - §7A TWO-denominator false-CLEAN bounds (objective vs subjective, rule-of-three
 *     each) — NEVER a blended number (A12).
 *   - The INDETERMINATE fraction against the contested floor (§9 / A14).
 *
 * Library code: no console output.
 */

import { INDETERMINATE_LABEL, NO_MAJORITY, type Judgment } from './types.js';

/* ── Cohen's kappa + confusion ───────────────────────────────────────────────── */

/** A confusion table keyed [rowLabel][colLabel] → count. */
export type ConfusionTable = Record<string, Record<string, number>>;

/** Build a confusion table over paired labels (rater A rows × rater B cols). */
export function confusionTable(pairs: Array<{ a: string; b: string }>): ConfusionTable {
  const table: ConfusionTable = {};
  for (const { a, b } of pairs) {
    (table[a] ??= {})[b] = (table[a][b] ?? 0) + 1;
  }
  return table;
}

/**
 * Cohen's kappa over two raters' labels for the same N items. κ = (po − pe)/(1 − pe),
 * po = observed agreement, pe = chance agreement from the marginals. Returns 1 when
 * both raters are constant-and-equal (pe == 1 by convention). Throws on length mismatch.
 */
export function cohensKappa(a: readonly string[], b: readonly string[]): number {
  if (a.length !== b.length) throw new Error('cohensKappa: rater vectors differ in length');
  const n = a.length;
  if (n === 0) return 0;
  let agree = 0;
  const ca: Record<string, number> = {};
  const cb: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ca[a[i]] = (ca[a[i]] ?? 0) + 1;
    cb[b[i]] = (cb[b[i]] ?? 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  const labels = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  for (const l of labels) pe += ((ca[l] ?? 0) / n) * ((cb[l] ?? 0) / n);
  if (pe === 1) return po === 1 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

/* ── rule of three + INDETERMINATE fraction ──────────────────────────────────── */

/** The rule-of-three 95% upper bound on a rate when ZERO events are observed in n trials. */
export function ruleOfThree(n: number): number {
  if (n <= 0) return 1;
  return 3 / n;
}

/**
 * INDETERMINATE fraction against the contested floor (§9 / A14): a card is
 * INDETERMINATE when the N=3 samples produce no 2-of-3 majority OR the majority is the
 * rubric's own INDETERMINATE label. Reported as a share of ALL classified KNOTs; a
 * high fraction means (B)/(C) were measured on the easy tail.
 */
export function indeterminateFraction(judgments: readonly Judgment[]): {
  total: number;
  indeterminate: number;
  noMajority: number;
  fraction: number;
  /** genuine-contested count remaining after INDETERMINATE drains out. */
  contestedAfterDrain: number;
} {
  const knots = judgments.filter((j) => j.cardKind === 'knot');
  const total = knots.length;
  const indeterminate = knots.filter((j) => j.indeterminate).length;
  const noMajority = knots.filter((j) => j.noMajority).length;
  return {
    total,
    indeterminate,
    noMajority,
    fraction: total === 0 ? 0 : indeterminate / total,
    contestedAfterDrain: total - indeterminate,
  };
}

/* ── seeded classifier control (A11) ─────────────────────────────────────────── */

/** A seeded control card: its sealed ground-truth label and the judge's majority label. */
export interface SeededControl {
  groundTruth: 'GENUINE' | 'OVER-BLOCK';
  judgeLabel: string;
}

/**
 * Precision on GENUINE and recall on OVER-BLOCK against the seeds (§5 / A11). Precision:
 * of the cards the judge CALLED genuine, how many truly were. Recall: of the true
 * over-blocks, how many the judge CAUGHT. The measured precision is the required
 * correction the (B)/(C) genuine denominator is read AFTER — and it must materially
 * beat the ~29% prior or the denominator is reported uncalibrated.
 */
export function seededControlPrecisionRecall(seeds: readonly SeededControl[]): {
  genuinePrecision: number | null;
  overBlockRecall: number | null;
  judgeSaidGenuine: number;
  trueGenuineAmongJudgeGenuine: number;
  trueOverBlock: number;
  caughtOverBlock: number;
} {
  const judgeSaidGenuine = seeds.filter((s) => s.judgeLabel === 'GENUINE').length;
  const trueGenuineAmongJudgeGenuine = seeds.filter((s) => s.judgeLabel === 'GENUINE' && s.groundTruth === 'GENUINE').length;
  const trueOverBlock = seeds.filter((s) => s.groundTruth === 'OVER-BLOCK').length;
  const caughtOverBlock = seeds.filter((s) => s.groundTruth === 'OVER-BLOCK' && s.judgeLabel === 'OVER-BLOCK').length;
  return {
    genuinePrecision: judgeSaidGenuine === 0 ? null : trueGenuineAmongJudgeGenuine / judgeSaidGenuine,
    overBlockRecall: trueOverBlock === 0 ? null : caughtOverBlock / trueOverBlock,
    judgeSaidGenuine,
    trueGenuineAmongJudgeGenuine,
    trueOverBlock,
    caughtOverBlock,
  };
}

/** Does the judge's measured seed precision materially beat the prior study's ~29%? (§5 / A11) */
export function beatsPriorPrecision(genuinePrecision: number | null, prior = 0.29): boolean {
  return genuinePrecision !== null && genuinePrecision > prior;
}

/* ── §4 false-CLEAN confirmation JOIN (A7 / A10) ─────────────────────────────── */

/** One audited CLEAN's confirmation inputs (§4 RECORDING). */
export interface CleanAudit {
  cardId: string;
  /** green-gate OR frozen behavioral-oracle assertion regressed: passed on both parents, failed on merge. */
  objectiveRegression: boolean;
  /** the blinded rater's call on the SUBJECTIVE question — load-bearing ONLY where objectivity runs out. */
  blindedConfirmation: 'broken' | 'not-broken' | 'indeterminate' | 'pending';
  /** false when the merge touched only blind classes (§8) — excluded from the covered denominator. */
  coveredClass?: boolean;
}

export type CleanVerdict = 'confirmed-false-clean' | 'true-clean' | 'blind-untested';

/**
 * The §4 confirmation JOIN. An OBJECTIVE regression is a confirmed false CLEAN, FULL
 * STOP — the blinded LLM may NOT veto it, downgrade it, or launder it to
 * indeterminate (A7/A10). Only where objectivity runs out is the blinded rater
 * load-bearing: a SUBJECTIVE candidate is confirmed only when the rater says "broken".
 */
export function confirmCleanFalse(audit: CleanAudit): CleanVerdict {
  if (audit.objectiveRegression) return 'confirmed-false-clean'; // NON-VETOABLE
  if (audit.coveredClass === false) return 'blind-untested';
  return audit.blindedConfirmation === 'broken' ? 'confirmed-false-clean' : 'true-clean';
}

/** Roll up a set of audited CLEANs into their §4 verdicts + counts. */
export function scoreCleanAudits(audits: readonly CleanAudit[]): {
  verdicts: Array<{ cardId: string; verdict: CleanVerdict }>;
  confirmedFalseClean: number;
  trueClean: number;
  blindUntested: number;
} {
  const verdicts = audits.map((a) => ({ cardId: a.cardId, verdict: confirmCleanFalse(a) }));
  return {
    verdicts,
    confirmedFalseClean: verdicts.filter((v) => v.verdict === 'confirmed-false-clean').length,
    trueClean: verdicts.filter((v) => v.verdict === 'true-clean').length,
    blindUntested: verdicts.filter((v) => v.verdict === 'blind-untested').length,
  };
}

/* ── §7A TWO separate false-CLEAN bounds — NEVER blended (A12) ────────────────── */

export interface FalseCleanBound {
  denominator: 'objective' | 'subjective';
  /** n_objective ≈ 100 (every CLEAN seal) or n_subjective ≈ 15–20 (rater-sampled). */
  n: number;
  observed: number;
  /** 95% upper bound: rule of three when observed == 0, else the point rate (bound doesn't apply). */
  upper95: number;
  /** true when the bound rests on the rule of three (zero observed). */
  ruleOfThree: boolean;
}

/**
 * The §7A pair. Two DIFFERENT denominators, two SEPARATE bounds, reported side by
 * side — the return has no combined field BY DESIGN. Borrowing the large objective
 * denominator to flatter the small subjective one is FORBIDDEN (A12), so this
 * function cannot produce a blended number.
 */
export function twoDenominatorBounds(args: {
  nObjective: number;
  objectiveConfirmed: number;
  nSubjective: number;
  subjectiveConfirmed: number;
}): { objective: FalseCleanBound; subjective: FalseCleanBound } {
  const bound = (denominator: 'objective' | 'subjective', n: number, observed: number): FalseCleanBound => {
    const zero = observed === 0;
    return { denominator, n, observed, upper95: zero ? ruleOfThree(n) : observed / n, ruleOfThree: zero };
  };
  return {
    objective: bound('objective', args.nObjective, args.objectiveConfirmed),
    subjective: bound('subjective', args.nSubjective, args.subjectiveConfirmed),
  };
}

/* ── judge-vs-Warpline for (B)/(C) on the BLINDED denominator (§5, §7B/§7C) ───── */

/** One contested item joined AFTER seal: the blinded judge label and Warpline's verdict. */
export interface ContestedJoin {
  cardId: string;
  /** the blinded judge majority label — GENUINE / OVER-BLOCK / INDETERMINATE. */
  judgeLabel: string;
  /** Warpline's own verdict for the same unit — 'knot' (flagged) / 'clean' (auto-wove). */
  warplineVerdict: 'knot' | 'clean';
}

/**
 * (B)/(C) inputs on the BLINDED denominator (§5): the genuine count is the judge's
 * GENUINE calls, over-blocks count AGAINST meaning (§7B/§7C). INDETERMINATE is its
 * own bucket, never folded (§9). The confusion table is judge-label × Warpline-verdict.
 */
export function judgeVsWarpline(joins: readonly ContestedJoin[]): {
  genuine: number;
  overBlock: number;
  indeterminate: number;
  /** K2 shape (§7C): over-block (false) KNOTs must NOT exceed genuine (meaning-decisive). */
  overBlockExceedsGenuine: boolean;
  confusion: ConfusionTable;
} {
  const isIndet = (l: string): boolean => l === INDETERMINATE_LABEL.knot || l === NO_MAJORITY;
  const genuine = joins.filter((j) => j.judgeLabel === 'GENUINE').length;
  const overBlock = joins.filter((j) => j.judgeLabel === 'OVER-BLOCK').length;
  const indeterminate = joins.filter((j) => isIndet(j.judgeLabel)).length;
  const confusion = confusionTable(joins.map((j) => ({ a: j.judgeLabel, b: j.warplineVerdict })));
  return { genuine, overBlock, indeterminate, overBlockExceedsGenuine: overBlock > genuine, confusion };
}

/* ── before/after pre-fix scoring against the FIXED judge label (A3) ──────────── */

/** One item scored before AND after the pre-fix, against the SAME fixed judge label. */
export interface PreFixItem {
  cardId: string;
  /** the FIXED blinded judge label — the invariant reference both passes score against. */
  judgeLabel: string;
  warplineBefore: string;
  warplineAfter: string;
}

/**
 * Before/after the pre-fix (A3), scored against the FIXED judge label: agreement with
 * the judge before vs after, so the run VALIDATES THE FIX rather than re-measuring the
 * raw rate. The judge label is held constant across both passes by construction.
 */
export function beforeAfterPreFix(items: readonly PreFixItem[]): {
  n: number;
  agreeBefore: number;
  agreeAfter: number;
  agreementBefore: number;
  agreementAfter: number;
  improved: number;
  regressed: number;
} {
  const n = items.length;
  const agreeBefore = items.filter((i) => i.warplineBefore === i.judgeLabel).length;
  const agreeAfter = items.filter((i) => i.warplineAfter === i.judgeLabel).length;
  const improved = items.filter((i) => i.warplineBefore !== i.judgeLabel && i.warplineAfter === i.judgeLabel).length;
  const regressed = items.filter((i) => i.warplineBefore === i.judgeLabel && i.warplineAfter !== i.judgeLabel).length;
  return {
    n,
    agreeBefore,
    agreeAfter,
    agreementBefore: n === 0 ? 0 : agreeBefore / n,
    agreementAfter: n === 0 ? 0 : agreeAfter / n,
    improved,
    regressed,
  };
}
