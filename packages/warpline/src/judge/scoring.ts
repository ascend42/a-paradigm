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
 *     known-OVER-BLOCK recall — the required denominator correction, with a ONE-SIDED
 *     95% Wilson LOWER bound: "materially beats the prior" means the lower bound
 *     clears it, never the point estimate (8/8 beats; 1/3 does not).
 *   - Before/after pre-fix scoring against the FIXED judge label (A3).
 *   - §7A TWO-denominator false-CLEAN bounds (objective vs subjective, rule-of-three
 *     each) — NEVER a blended number (A12). `indeterminate` and `pending` audits are
 *     their OWN verdicts — never rounded into true-clean (§5 "never rounded into a
 *     favorable bucket") and never in n_subjective.
 *   - The INDETERMINATE fraction against the contested floor (§9 / A14) — seeds,
 *     planted controls and corpus cards excluded from the denominator; the §3 floor is
 *     GENUINE-only (`genuineAfterDrain`, not genuine+over-block).
 *
 * Library code: no console output.
 */

import { INDETERMINATE_LABEL, NO_MAJORITY, provenanceExcludedFromDenominator, type Judgment, type Provenance } from './types.js';

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

/** The §3 contested floor: the minimum GENUINE KNOTs a (B)/(C) claim may rest on. */
export const CONTESTED_FLOOR = 20;

/**
 * INDETERMINATE fraction against the contested floor (§9 / A14): a card is
 * INDETERMINATE when the N=3 samples produce no 2-of-3 majority OR the majority is the
 * rubric's own INDETERMINATE label. Reported as a share of the REAL classified KNOTs —
 * seeded / planted controls and injection-corpus cards are EXCLUDED from the
 * denominator (by `opts.exclude`, or by default from `opts.provenance` when supplied).
 * A high fraction means (B)/(C) were measured on the easy tail. After INDETERMINATE
 * drains out, `genuineAfterDrain` (majority GENUINE) is what the §3 floor is read
 * against — over-blocks are reported SEPARATELY, never folded into "contested".
 */
export function indeterminateFraction(
  judgments: readonly Judgment[],
  opts: {
    /** exclude a card from the denominator by id (wins over `provenance`). */
    exclude?: (cardId: string) => boolean;
    /** per-card §4 provenance — when supplied, seeds / planted / corpus are excluded by default. */
    provenance?: Map<string, Provenance>;
  } = {},
): {
  /** real KNOTs in the denominator (after exclusions). */
  total: number;
  /** how many KNOTs were excluded as seeds / planted / corpus. */
  excluded: number;
  indeterminate: number;
  noMajority: number;
  fraction: number;
  /** majority-GENUINE KNOTs remaining after INDETERMINATE drains out — the §3 floor counts THESE. */
  genuineAfterDrain: number;
  /** majority-OVER-BLOCK KNOTs remaining after the drain — reported separately, never "contested". */
  overBlockAfterDrain: number;
} {
  const exclude =
    opts.exclude ??
    (opts.provenance
      ? (cardId: string): boolean => provenanceExcludedFromDenominator(opts.provenance!.get(cardId))
      : (): boolean => false);
  const allKnots = judgments.filter((j) => j.cardKind === 'knot');
  const knots = allKnots.filter((j) => !exclude(j.cardId));
  const total = knots.length;
  const indeterminate = knots.filter((j) => j.indeterminate).length;
  const noMajority = knots.filter((j) => j.noMajority).length;
  return {
    total,
    excluded: allKnots.length - total,
    indeterminate,
    noMajority,
    fraction: total === 0 ? 0 : indeterminate / total,
    genuineAfterDrain: knots.filter((j) => !j.indeterminate && j.majorityLabel === 'GENUINE').length,
    overBlockAfterDrain: knots.filter((j) => !j.indeterminate && j.majorityLabel === 'OVER-BLOCK').length,
  };
}

/** Does the post-drain GENUINE count reach the §3 contested floor (default 20)? */
export function meetsContestedFloor(genuineAfterDrain: number, floor = CONTESTED_FLOOR): boolean {
  return genuineAfterDrain >= floor;
}

/* ── Wilson lower bound ───────────────────────────────────────────────────────── */

/**
 * The one-sided Wilson score LOWER bound on a proportion (default z = 1.645 → 95%
 * one-sided). 0 when n == 0. This is what "materially beats the prior" is read
 * against — the point estimate is never enough (1/3 = 0.33 does not beat 0.29).
 */
export function wilsonLowerBound(successes: number, n: number, z = 1.645): number {
  if (n <= 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return Math.max(0, centre - half);
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
  /** one-sided 95% Wilson LOWER bound on the GENUINE precision (null when the judge called none genuine). */
  genuinePrecisionLowerBound95: number | null;
  /** one-sided 95% Wilson LOWER bound on the OVER-BLOCK recall (null when no true over-blocks were seeded). */
  overBlockRecallLowerBound95: number | null;
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
    genuinePrecisionLowerBound95: judgeSaidGenuine === 0 ? null : wilsonLowerBound(trueGenuineAmongJudgeGenuine, judgeSaidGenuine),
    overBlockRecallLowerBound95: trueOverBlock === 0 ? null : wilsonLowerBound(caughtOverBlock, trueOverBlock),
    judgeSaidGenuine,
    trueGenuineAmongJudgeGenuine,
    trueOverBlock,
    caughtOverBlock,
  };
}

/**
 * Does the judge's measured seed precision MATERIALLY beat the prior study's ~29%?
 * (§5 / A11). "Materially" = the one-sided 95% Wilson LOWER bound of `counts`
 * (successes = true-GENUINE among judge-GENUINE, n = judge-GENUINE) exceeds the prior.
 * The point estimate alone is NEVER sufficient: with no `counts` there is no bound,
 * so this returns false (fail closed — 1/3 = 0.33 must not "beat" 0.29).
 */
export function beatsPriorPrecision(
  genuinePrecision: number | null,
  prior = 0.29,
  counts?: { successes: number; n: number },
): boolean {
  if (genuinePrecision === null || !counts) return false;
  return wilsonLowerBound(counts.successes, counts.n) > prior;
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

/**
 * The §4 verdict buckets. `indeterminate` and `pending` are their OWN buckets: an
 * audit the rater could not decide, or has not yet rated, is NEVER rounded into
 * `true-clean` (§5 "never rounded into a favorable bucket").
 */
export type CleanVerdict = 'confirmed-false-clean' | 'true-clean' | 'blind-untested' | 'indeterminate' | 'pending';

/**
 * The §4 confirmation JOIN. An OBJECTIVE regression is a confirmed false CLEAN, FULL
 * STOP — the blinded LLM may NOT veto it, downgrade it, or launder it to
 * indeterminate (A7/A10). Only where objectivity runs out is the blinded rater
 * load-bearing: a SUBJECTIVE candidate is confirmed only when the rater says "broken",
 * survives only when it says "not-broken", and is otherwise `indeterminate` /
 * `pending` — never silently true-clean.
 */
export function confirmCleanFalse(audit: CleanAudit): CleanVerdict {
  if (audit.objectiveRegression) return 'confirmed-false-clean'; // NON-VETOABLE
  if (audit.coveredClass === false) return 'blind-untested';
  switch (audit.blindedConfirmation) {
    case 'broken':
      return 'confirmed-false-clean';
    case 'not-broken':
      return 'true-clean';
    case 'indeterminate':
      return 'indeterminate';
    case 'pending':
      return 'pending';
  }
}

/**
 * Roll up a set of audited CLEANs into their §4 verdicts + counts. `nSubjective` is
 * the ONLY number that may feed the §7A subjective denominator: true-clean +
 * confirmed-false-clean. `indeterminate` is reported separately; `pending` is
 * not-yet-rated and is in NO denominator.
 */
export function scoreCleanAudits(audits: readonly CleanAudit[]): {
  verdicts: Array<{ cardId: string; verdict: CleanVerdict }>;
  confirmedFalseClean: number;
  trueClean: number;
  blindUntested: number;
  indeterminate: number;
  pending: number;
  /** true-clean + confirmed-false-clean — the §7A subjective denominator (nothing else enters). */
  nSubjective: number;
} {
  const verdicts = audits.map((a) => ({ cardId: a.cardId, verdict: confirmCleanFalse(a) }));
  const count = (v: CleanVerdict): number => verdicts.filter((x) => x.verdict === v).length;
  const confirmedFalseClean = count('confirmed-false-clean');
  const trueClean = count('true-clean');
  return {
    verdicts,
    confirmedFalseClean,
    trueClean,
    blindUntested: count('blind-untested'),
    indeterminate: count('indeterminate'),
    pending: count('pending'),
    nSubjective: trueClean + confirmedFalseClean,
  };
}

/**
 * The §7A SUBJECTIVE-denominator inputs derived from audited CLEANs: n_subjective =
 * true-clean + confirmed-false-clean ONLY; indeterminate and pending audits never
 * enter the denominator (they would flatter the bound).
 */
export function subjectiveBoundInputs(audits: readonly CleanAudit[]): {
  nSubjective: number;
  subjectiveConfirmed: number;
  /** reported alongside, outside the denominator. */
  indeterminate: number;
  pending: number;
} {
  const roll = scoreCleanAudits(audits);
  return {
    nSubjective: roll.nSubjective,
    subjectiveConfirmed: roll.confirmedFalseClean,
    indeterminate: roll.indeterminate,
    pending: roll.pending,
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
  /** true-clean + confirmed-false-clean ONLY (see `subjectiveBoundInputs`) — never indeterminate / pending. */
  nSubjective: number;
  subjectiveConfirmed: number;
}): { objective: FalseCleanBound; subjective: FalseCleanBound } {
  if (args.subjectiveConfirmed > args.nSubjective || args.objectiveConfirmed > args.nObjective) {
    throw new Error('twoDenominatorBounds: observed exceeds its denominator');
  }
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
