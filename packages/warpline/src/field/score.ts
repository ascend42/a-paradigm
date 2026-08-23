/**
 * #field-score — `warpline field score`'s library half (expo-field-test-protocol.md
 * §7A/§7B/§7C thresholds, §9 report; field-test-readiness §B7 increment 2).
 *
 * PURE over recorded artifacts: the oracle ledger, the judge custody ledger
 * (verdict + join rows), judgments.jsonl, the git-fallback log, and an
 * admissions count. `scoreFieldRun` takes already-loaded rows and returns
 * numbers + per-falsifier verdicts; `renderFieldReport` builds the §9 report
 * STRINGS. The CLI does the loading, writing, and printing — nothing here
 * touches stdout.
 *
 * HONEST-SCOPE NOTES (all pre-committed, none post-hoc):
 *   - §7A: TWO bounds over TWO denominators, never blended (A12) — the return
 *     shape has no combined field by construction (scoring.twoDenominatorBounds).
 *   - §7B: the byte-baseline column is computed per audited MERGE target via the
 *     fabric's own merge3 over base/ours/theirs bodies; the FIRST divergence
 *     class (Warpline CLEAN ∧ byte-conflicted ∧ oracle true-clean) is COUNTED;
 *     the SECOND class (Warpline KNOT ∧ byte-merges-clean ∧ broken) needs the
 *     byte-merged tree run through the oracle — those are emitted as
 *     CATCH-CANDIDATES requiring oracle confirmation, never claimed.
 *   - The genuine-denominator correction formula is F3d founder-gated: BOTH the
 *     uncorrected and a naive-precision-corrected count are reported, labeled
 *     'correction formula pending pre-registration v2'.
 *   - Preconditions unmet default to VOID / not-tested, never to a pass:
 *     planted control not caught → (A) not tested; genuine < 20 → (B)/(C)
 *     INCONCLUSIVE.
 *
 * STANDALONE from src/daemon by construction. Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObjectStore } from '../warp/object-store.js';
import { warplineDirOf, readFabric } from '../fabric/fabric.js';
import { mergeText } from '../fabric/merge3.js';
import { listKnotPayloads, readFileFromTree } from '../fabric/knot-payload.js';
import { buildKnotRatingCard } from '../judge/rating-card.js';
import { JudgeLedger } from '../judge/ledger.js';
import {
  indeterminateFraction,
  meetsContestedFloor,
  seededControlPrecisionRecall,
  beatsPriorPrecision,
  subjectiveBoundInputs,
  scoreCleanAudits,
  twoDenominatorBounds,
  CONTESTED_FLOOR,
  type CleanAudit,
  type SeededControl,
  type FalseCleanBound,
} from '../judge/scoring.js';
import type { Judgment, LedgerRow, Provenance } from '../judge/types.js';
import { AGENTS_MODEL, PINNED_JUDGE_MODEL } from '../judge/types.js';
import { readAuditLedger, type OracleRow } from './oracle.js';
import { listGitFallbacks, type GitFallbackEntry } from './fallback.js';
import { selectAuditSample, AUDIT_SAMPLE_LEAK_CAVEAT } from './interleave.js';
import { fieldJudgeDirOf, fieldJudgeLedgerPathOf } from './judge-run.js';

/* ── §9 caveat strings (fixed here; the report carries them verbatim) ────────── */

/** The §9 correlated-priors caveat — the confirmed ≠-branch at its STRONGER end. */
export const CORRELATED_PRIORS_CAVEAT =
  `CORRELATED-PRIORS LIMITATION (§9, ≠-branch): agents = ${AGENTS_MODEL}, judge = ${PINNED_JUDGE_MODEL} — ` +
  'the SAME Opus line, different version. This selects the ≠-branch, but the separation is VERSION-ONLY, so the ' +
  'priors are closer than a cross-line pairing would give: the correlated-priors discount is applied at the ' +
  'STRONGER end (nearer "same model" than "unrelated"), and no (B)/(C) verdict may lean on judge-vs-agent ' +
  'agreement as corroboration. High agreement may reflect SHARED PRIORS rather than independent correctness; ' +
  'the OBJECTIVE oracle — not rater agreement — is the tie-breaker wherever objectivity applies.';

/** The §9 / TD-913 pre-fix baseline framing. */
export const PRE_FIX_BASELINE_FRAMING =
  'PRE-FIX BASELINE (TD-2026-08-11-913): both error classes were PRE-FIXED before the run; the priors ' +
  '(~10% false-CLEAN, 3/3 over-block) are the PRE-FIX BASELINE. This run VALIDATES THE FIXES and BOUNDS THE ' +
  'RESIDUAL — it does not measure the raw pre-fix rate. A residual bound reads "residual ≤ X% (95% CI) after ' +
  'the fix", never as the error rate of the system.';

/** The F3d-gated genuine-denominator correction label. */
export const CORRECTION_PENDING_NOTE =
  'correction formula pending pre-registration v2 (F3d founder-gated) — both the uncorrected and a ' +
  'naive-precision-corrected genuine count are reported; NEITHER is a ratified correction.';

/* ── the §7B byte baseline (git-equivalent three-way, per changed file) ──────── */

/** One audited MERGE target's byte-baseline column entry. */
export interface MergeByteBaseline {
  pickId: string;
  /** false when the recipe/base/changed-set needed to byte-merge is unrecorded. */
  computable: boolean;
  /** any changed file token-3-way-conflicts (computable targets only). */
  byteConflicted: boolean;
  conflictedFiles: string[];
  note?: string;
}

/** One KNOT payload's byte baseline — the CATCH-CANDIDATE precursor. */
export interface KnotByteBaseline {
  payloadId: string;
  cardId: string;
  computable: boolean;
  /** false = the byte merge composes cleanly where Warpline said KNOT. */
  byteConflicted: boolean;
}

/**
 * The byte-baseline column for every audited MERGE target: token-level 3-way
 * (fabric/merge3 mergeText) over base/ours/theirs bodies read from the strand's
 * OWN MergeRecipe trees, per changed path the oracle row recorded. An
 * unrecorded recipe/base/changed-set yields computable:false — NEVER a guessed
 * byteConflicted value (a fake baseline could flatter §7B in either direction).
 */
export function computeMergeByteBaselines(
  root: string,
  store: ObjectStore,
  oracleRows: readonly OracleRow[],
): MergeByteBaseline[] {
  const byPick = new Map(readFabric(warplineDirOf(root)).map((s) => [s.pickId, s]));
  const out: MergeByteBaseline[] = [];
  for (const row of oracleRows) {
    if (row.mode !== 'merge' || row.planted === true) continue;
    const strand = byPick.get(row.pickId);
    const recipe = strand?.merge;
    if (!recipe || !recipe.base || row.changedPaths === null) {
      out.push({
        pickId: row.pickId,
        computable: false,
        byteConflicted: false,
        conflictedFiles: [],
        note: !recipe
          ? 'no MergeRecipe on the strand'
          : !recipe.base
            ? 'recipe records no base tree'
            : 'oracle row recorded changedPaths:null',
      });
      continue;
    }
    const conflictedFiles: string[] = [];
    for (const p of row.changedPaths) {
      const base = readFileFromTree(store, recipe.base, p) ?? '';
      const ours = readFileFromTree(store, recipe.ours, p) ?? '';
      const theirs = readFileFromTree(store, recipe.theirs, p) ?? '';
      if (mergeText(base, ours, theirs).conflicts > 0) conflictedFiles.push(p);
    }
    out.push({ pickId: row.pickId, computable: true, byteConflicted: conflictedFiles.length > 0, conflictedFiles });
  }
  return out;
}

/**
 * The byte baseline per persisted KNOT payload: does the byte three-way compose
 * CLEANLY where Warpline refused? A clean byte merge here is a silent-mismerge
 * CATCH-CANDIDATE — confirming it a real catch requires running the byte-merged
 * state through the oracle, which this increment does NOT do (honest scope).
 */
export function computeKnotByteBaselines(root: string, store: ObjectStore): KnotByteBaseline[] {
  const out: KnotByteBaseline[] = [];
  for (const payload of listKnotPayloads(root)) {
    const card = buildKnotRatingCard(payload, { store });
    const baseTree = payload.base.treeId;
    const oursTree = payload.ours.treeId;
    const theirsTree = payload.theirs.treeId;
    if (!baseTree || !oursTree || !theirsTree) {
      out.push({ payloadId: payload.payloadId, cardId: card.cardId, computable: false, byteConflicted: false });
      continue;
    }
    let conflicted = false;
    for (const p of card.filePaths) {
      const base = readFileFromTree(store, baseTree, p) ?? '';
      const ours = readFileFromTree(store, oursTree, p) ?? '';
      const theirs = readFileFromTree(store, theirsTree, p) ?? '';
      if (mergeText(base, ours, theirs).conflicts > 0) {
        conflicted = true;
        break;
      }
    }
    out.push({ payloadId: payload.payloadId, cardId: card.cardId, computable: true, byteConflicted: conflicted });
  }
  return out;
}

/* ── the pure scoring core ───────────────────────────────────────────────────── */

export type FalsifierVerdict = 'FALSIFIED' | 'SURVIVES (this run)' | 'INCONCLUSIVE' | 'NOT TESTED';

export interface FieldScoreInputs {
  oracleRows: readonly OracleRow[];
  ledgerRows: readonly LedgerRow[];
  judgments: readonly Judgment[];
  fallbacks: readonly GitFallbackEntry[];
  mergeBaselines: readonly MergeByteBaseline[];
  knotBaselines: readonly KnotByteBaseline[];
  /** --admissions override; default = oracle-ledger seals (merge + single-parent, planted excluded). */
  admissionsOverride?: number;
}

export interface FieldScore {
  admissions: { n: number; source: 'oracle-ledger' | 'override' };
  sevenA: {
    bounds: { objective: FalseCleanBound; subjective: FalseCleanBound };
    nObjective: number;
    objectiveConfirmed: number;
    subjective: { nSubjective: number; subjectiveConfirmed: number; indeterminate: number; pending: number };
    auditSampleSize: number;
    /** §9: the SEPARATELY-stated dismissed-CLEAN false-CLEAN count. */
    dismissedCleanFalseCleanCount: number;
    blindUntested: number;
    coveredCleanCount: number;
    /** per-§8-reason tally of blind changed paths. */
    blindExclusionsByReason: Record<string, number>;
    plantedControl: 'caught' | 'not-caught' | 'absent';
    verdict: FalsifierVerdict;
    reason: string;
  };
  sevenB: {
    byteBaselines: MergeByteBaseline[];
    meaningDecisive: number;
    meaningDecisiveRate: number;
    catchCandidates: { count: number; payloadIds: string[]; note: string };
    genuineUncorrected: number;
    genuineNaiveCorrected: number | null;
    correctionNote: string;
    verdict: FalsifierVerdict;
    reason: string;
  };
  sevenC: {
    knotCount: number;
    fallbackCount: number;
    interventionCount: number;
    interventionRate: number;
    k2: { overBlock: number; genuine: number; falsified: boolean };
    verdict: FalsifierVerdict;
    reason: string;
  };
  seededControl: ReturnType<typeof seededControlPrecisionRecall> & {
    seedsRated: number;
    beatsPrior: boolean;
    uncalibrated: boolean;
  };
  indeterminate: ReturnType<typeof indeterminateFraction> & { meetsFloor: boolean; floor: number };
  kappa: { available: false; note: string };
  spread: { unanimous: number; split: number; noMajority: number };
  caveats: { correlatedPriors: string; preFixBaseline: string; auditSampleLeak: string };
}

const label = (l: string | undefined): 'broken' | 'not-broken' | 'indeterminate' =>
  l === 'broken' ? 'broken' : l === 'not-broken' ? 'not-broken' : 'indeterminate';

/** The whole §7 pass over recorded rows. Pure and deterministic. */
export function scoreFieldRun(inputs: FieldScoreInputs): FieldScore {
  const { oracleRows, ledgerRows, judgments, fallbacks, mergeBaselines, knotBaselines } = inputs;

  const verdictRows = ledgerRows.filter((r) => r.kind === 'judge-verdict');
  const provenanceByCard = new Map<string, Provenance>();
  for (const r of verdictRows) if (r.provenance) provenanceByCard.set(r.cardId, r.provenance);
  /** judge verdict row per §4 pickId (CLEAN provenance points back into the oracle ledger). */
  const cleanVerdictByPick = new Map<string, LedgerRow>();
  for (const r of verdictRows) {
    const p = r.provenance;
    if ((p?.source === 'oracle-flagged' || p?.source === 'audit-sample') && p.pickId !== undefined) {
      cleanVerdictByPick.set(p.pickId, r);
    }
  }
  // §3 WRITE-BEFORE-REVEAL: a rating counts as a CONFIRMATION only once the
  // Warpline answer was JOINED to it (a warpline-join row references the sealed
  // verdict row). A rated-but-UNJOINED audit is 'pending' — outside n_subjective.
  const joinedVerdictHashes = new Set<string>();
  for (const r of ledgerRows) {
    if (r.kind === 'warpline-join' && r.judgeRowHash !== undefined) joinedVerdictHashes.add(r.judgeRowHash);
  }

  const realRows = oracleRows.filter((r) => r.planted !== true);
  const admissions =
    inputs.admissionsOverride !== undefined
      ? { n: inputs.admissionsOverride, source: 'override' as const }
      : { n: realRows.length, source: 'oracle-ledger' as const };

  /* ── §7A ─────────────────────────────────────────────────────────────────── */
  const coveredCleanRows = realRows.filter(
    (r) => r.coveredClass && (r.verdict === 'true-clean' || r.verdict === 'candidate-false-clean'),
  );
  const nObjective = coveredCleanRows.length;
  const objectiveConfirmed = realRows.filter((r) => r.objectiveRegression).length;
  const blindUntested = realRows.filter((r) => r.verdict === 'blind-untested').length;
  const blindExclusionsByReason: Record<string, number> = {};
  for (const r of realRows) for (const b of r.blind) blindExclusionsByReason[b.reason] = (blindExclusionsByReason[b.reason] ?? 0) + 1;

  const flaggedRows = realRows.filter((r) => r.verdict === 'candidate-false-clean');
  const sampleRows = selectAuditSample(oracleRows);
  const auditOf = (row: OracleRow): CleanAudit => {
    const vrow = cleanVerdictByPick.get(row.pickId);
    // 'pending' when UNRATED **or UNJOINED** — the blinded confirmation only
    // enters the denominator after the join row proves write-before-reveal held.
    const joined = vrow !== undefined && joinedVerdictHashes.has(vrow.rowHash);
    return {
      cardId: vrow?.cardId ?? `pending:${row.pickId}`,
      objectiveRegression: row.objectiveRegression,
      blindedConfirmation: joined ? label(vrow!.judgeVerdict) : 'pending',
      coveredClass: row.coveredClass,
    };
  };
  const audits = [...flaggedRows, ...sampleRows].map(auditOf);
  const subjective = subjectiveBoundInputs(audits);
  const bounds = twoDenominatorBounds({
    nObjective,
    objectiveConfirmed,
    nSubjective: subjective.nSubjective,
    subjectiveConfirmed: subjective.subjectiveConfirmed,
  });
  const sampleAudits = sampleRows.map(auditOf);
  const dismissedCleanFalseCleanCount = scoreCleanAudits(sampleAudits).confirmedFalseClean;

  const plantedRows = verdictRows.filter((r) => r.provenance?.planted === true);
  const plantedControl: 'caught' | 'not-caught' | 'absent' =
    plantedRows.length === 0 ? 'absent' : plantedRows.some((r) => r.judgeVerdict === 'broken') ? 'caught' : 'not-caught';

  const confirmedTotal = objectiveConfirmed + subjective.subjectiveConfirmed;
  let verdictA: FalsifierVerdict;
  let reasonA: string;
  if (plantedControl !== 'caught') {
    verdictA = 'NOT TESTED';
    reasonA =
      plantedControl === 'absent'
        ? '(A) not tested — no planted-control verdict row is in the ledger; the pipeline-validity precondition (§4 PLANTED POSITIVE CONTROL) was never established'
        : '(A) not tested — instrument failed its planted control (§4): the pipeline did not catch the known-broken seed, so "zero false CLEANs observed" is VOID';
  } else if (confirmedTotal >= 1) {
    verdictA = 'FALSIFIED';
    reasonA = `≥1 confirmed false CLEAN (objective ${objectiveConfirmed}, subjective ${subjective.subjectiveConfirmed}) — one is sufficient (§7A, TD-838)`;
  } else if (nObjective < 30 || blindUntested > coveredCleanRows.length) {
    // §7A verbatim: "INCONCLUSIVE if: n_objective < 30 (objective bound too loose
    // to mean anything) or the audited CLEANs are dominated by blind classes" —
    // the 30 threshold is the protocol's own, not invented here. The '(A) not
    // tested' wording is reserved for the VOID/planted-control path above.
    verdictA = 'INCONCLUSIVE';
    reasonA = `INCONCLUSIVE — ${nObjective < 30 ? `n_objective ${nObjective} < 30 (§7A: objective bound too loose to mean anything)` : `blind-class CLEANs (${blindUntested}) dominate the covered set (${coveredCleanRows.length}) (§7A)`}; not reported as surviving`;
  } else {
    verdictA = 'SURVIVES (this run)';
    reasonA = `zero confirmed false CLEANs of either class; both bounds reported separately over their own denominators (n_objective ${nObjective}, n_subjective ${subjective.nSubjective})`;
  }

  /* ── seeded classifier control (§5 / A11) ─────────────────────────────────── */
  const seeds: SeededControl[] = verdictRows
    .filter(
      (r) =>
        r.provenance?.seededControl === true &&
        (r.provenance.groundTruth === 'GENUINE' || r.provenance.groundTruth === 'OVER-BLOCK'),
    )
    .map((r) => ({ groundTruth: r.provenance!.groundTruth as 'GENUINE' | 'OVER-BLOCK', judgeLabel: r.judgeVerdict ?? '' }));
  const pr = seededControlPrecisionRecall(seeds);
  const beatsPrior = beatsPriorPrecision(pr.genuinePrecision, 0.29, {
    successes: pr.trueGenuineAmongJudgeGenuine,
    n: pr.judgeSaidGenuine,
  });
  const seededControl = { ...pr, seedsRated: seeds.length, beatsPrior, uncalibrated: !beatsPrior };

  /* ── indeterminate drain (§9 / A14) — GENUINE-only floor, controls excluded ── */
  const indet = indeterminateFraction(judgments, { provenance: provenanceByCard });
  const indeterminate = {
    ...indet,
    meetsFloor: meetsContestedFloor(indet.genuineAfterDrain),
    floor: CONTESTED_FLOOR,
  };

  /* ── §7B ─────────────────────────────────────────────────────────────────── */
  const oracleByPick = new Map(realRows.map((r) => [r.pickId, r]));
  const meaningDecisive = mergeBaselines.filter(
    (b) => b.computable && b.byteConflicted && oracleByPick.get(b.pickId)?.verdict === 'true-clean',
  ).length;
  const meaningDecisiveRate = admissions.n > 0 ? meaningDecisive / admissions.n : 0;
  const catchList = knotBaselines.filter((b) => b.computable && !b.byteConflicted);
  const genuineUncorrected = indet.genuineAfterDrain;
  const genuineNaiveCorrected = pr.genuinePrecision === null ? null : genuineUncorrected * pr.genuinePrecision;

  let verdictB: FalsifierVerdict;
  let reasonB: string;
  if (!indeterminate.meetsFloor) {
    verdictB = 'INCONCLUSIVE';
    reasonB = `genuine (blinded) contested ${genuineUncorrected} < ${CONTESTED_FLOOR} (§3 floor) — underpowered; never reported as surviving`;
  } else if (meaningDecisiveRate < 0.02) {
    verdictB = 'FALSIFIED';
    reasonB = `meaning-decisive rate ${(meaningDecisiveRate * 100).toFixed(1)}% < 2% of admissions [ratified K1] — the layer is decoration`;
  } else if (meaningDecisiveRate >= 0.1) {
    verdictB = 'SURVIVES (this run)';
    reasonB = `meaning-decisive rate ${(meaningDecisiveRate * 100).toFixed(1)}% ≥ 10% (pre-committed) on a genuine denominator ≥ ${CONTESTED_FLOOR}`;
  } else {
    verdictB = 'INCONCLUSIVE';
    reasonB = `meaning-decisive rate ${(meaningDecisiveRate * 100).toFixed(1)}% is between the 2% falsification and 10% survival thresholds — neither pre-committed criterion fires`;
  }

  /* ── §7C ─────────────────────────────────────────────────────────────────── */
  const knotCount = verdictRows.filter((r) => r.provenance?.source === 'knot').length;
  const interventionCount = knotCount + fallbacks.length;
  const interventionRate = admissions.n > 0 ? interventionCount / admissions.n : 0;
  const k2 = {
    overBlock: indet.overBlockAfterDrain,
    genuine: indet.genuineAfterDrain,
    falsified: indet.overBlockAfterDrain > indet.genuineAfterDrain,
  };
  let verdictC: FalsifierVerdict;
  let reasonC: string;
  if (!indeterminate.meetsFloor) {
    verdictC = 'INCONCLUSIVE';
    reasonC = `genuine (blinded) contested ${genuineUncorrected} < ${CONTESTED_FLOOR} (§3 floor) — underpowered`;
  } else if (k2.falsified) {
    verdictC = 'FALSIFIED';
    reasonC = `over-block (${k2.overBlock}) > genuine (${k2.genuine}) [ratified K2]`;
  } else if (interventionRate > 0.25) {
    verdictC = 'FALSIFIED';
    reasonC = `intervention rate ${(interventionRate * 100).toFixed(1)}% > 25% ceiling`;
  } else {
    verdictC = 'SURVIVES (this run)';
    reasonC = `over-block ≤ genuine, intervention rate ${(interventionRate * 100).toFixed(1)}% ≤ 25%, fallbacks ${fallbacks.length}`;
  }

  /* ── spread summary (§9 per-card N=3 spread) ─────────────────────────────── */
  const spread = { unanimous: 0, split: 0, noMajority: 0 };
  for (const j of judgments) {
    if (j.noMajority) spread.noMajority++;
    else if (Object.keys(j.spread).length === 1) spread.unanimous++;
    else spread.split++;
  }

  return {
    admissions,
    sevenA: {
      bounds,
      nObjective,
      objectiveConfirmed,
      subjective,
      auditSampleSize: sampleRows.length,
      dismissedCleanFalseCleanCount,
      blindUntested,
      coveredCleanCount: coveredCleanRows.length,
      blindExclusionsByReason,
      plantedControl,
      verdict: verdictA,
      reason: reasonA,
    },
    sevenB: {
      byteBaselines: [...mergeBaselines],
      meaningDecisive,
      meaningDecisiveRate,
      catchCandidates: {
        count: catchList.length,
        payloadIds: catchList.map((b) => b.payloadId),
        note: 'catch-candidates ONLY: Warpline KNOT where the byte three-way composes cleanly. Confirming a silent-mismerge catch requires running the byte-merged state through the §4 oracle — NOT done this increment; these are NOT claimed.',
      },
      genuineUncorrected,
      genuineNaiveCorrected,
      correctionNote: CORRECTION_PENDING_NOTE,
      verdict: verdictB,
      reason: reasonB,
    },
    sevenC: {
      knotCount,
      fallbackCount: fallbacks.length,
      interventionCount,
      interventionRate,
      k2,
      verdict: verdictC,
      reason: reasonC,
    },
    seededControl,
    indeterminate,
    kappa: {
      available: false,
      note:
        'primary-vs-blinded Cohen\'s kappa NOT COMPUTABLE from this harness: the founder\'s resolve-time primary ' +
        'classifications are not captured in the recorded artifacts (habit (ii) rating cards carry no founder label ' +
        'by design). Reported as MISSING, never substituted.',
    },
    spread,
    caveats: {
      correlatedPriors: CORRELATED_PRIORS_CAVEAT,
      preFixBaseline: PRE_FIX_BASELINE_FRAMING,
      auditSampleLeak: AUDIT_SAMPLE_LEAK_CAVEAT,
    },
  };
}

/* ── the §9 report strings ───────────────────────────────────────────────────── */

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Build the §9 report markdown from a computed score. Pure string building. */
export function renderFieldReport(score: FieldScore): string {
  const L: string[] = [];
  L.push('# Warpline expo field-test report (§9)');
  L.push('');
  L.push(`- admissions: ${score.admissions.n} (${score.admissions.source})`);
  L.push(`- agents' exact model: ${AGENTS_MODEL} · judge (pinned): ${PINNED_JUDGE_MODEL}`);
  L.push('');
  L.push('## Baseline framing');
  L.push('');
  L.push(score.caveats.preFixBaseline);
  L.push('');
  L.push('## Falsifier (A) — false CLEAN (§7A)');
  L.push('');
  L.push(`VERDICT: ${score.sevenA.verdict} — ${score.sevenA.reason}`);
  L.push('');
  L.push(`- planted positive control: ${score.sevenA.plantedControl}`);
  const ob = score.sevenA.bounds.objective;
  const sb = score.sevenA.bounds.subjective;
  L.push(
    `- OBJECTIVE-class bound: ${ob.observed} observed in n_objective=${ob.n} covered CLEANs → 95% upper bound ${pct(ob.upper95)}${ob.ruleOfThree ? ' (rule of three)' : ''}`,
  );
  L.push(
    `- SUBJECTIVE-class bound: ${sb.observed} observed in n_subjective=${sb.n} rated CLEANs → 95% upper bound ${pct(sb.upper95)}${sb.ruleOfThree ? ' (rule of three)' : ''} — materially looser; the honest limit of a rater-sampled design`,
  );
  L.push('- The two bounds are reported SEPARATELY over their own denominators and are NEVER blended (§7A A12).');
  L.push(
    `- random audit sample: ${score.sevenA.auditSampleSize} dismissed CLEANs rated; dismissed-CLEAN false-CLEAN count: ${score.sevenA.dismissedCleanFalseCleanCount} (stated separately, §9)`,
  );
  L.push(
    '- floor scope: the 15-sample floor is applied GLOBALLY over the whole ledger; equivalent to the §4 per-block rule below 100 admissions — per-block flooring is required for multi-block runs.',
  );
  L.push(
    `- subjective bucket detail: pending ${score.sevenA.subjective.pending}, indeterminate ${score.sevenA.subjective.indeterminate} (outside every denominator, never rounded favorable)`,
  );
  L.push('');
  L.push('### Blind-class exclusions (§8)');
  L.push('');
  L.push(
    `- covered CLEANs: ${score.sevenA.coveredCleanCount} · blind-untested (excluded, reported separately as NOT TESTED): ${score.sevenA.blindUntested}`,
  );
  for (const [reason, n] of Object.entries(score.sevenA.blindExclusionsByReason)) {
    L.push(`  - ${n} path(s): ${reason}`);
  }
  L.push('');
  L.push('## Falsifier (B) — meaning adds nothing over bytes (§7B)');
  L.push('');
  L.push(`VERDICT: ${score.sevenB.verdict} — ${score.sevenB.reason}`);
  L.push('');
  L.push(
    `- meaning-decisive auto-resolves: ${score.sevenB.meaningDecisive} (Warpline CLEAN ∧ byte-conflicted ∧ oracle true-clean) → rate ${pct(score.sevenB.meaningDecisiveRate)} of admissions`,
  );
  L.push(`- catch-candidates: ${score.sevenB.catchCandidates.count} — ${score.sevenB.catchCandidates.note}`);
  L.push(
    `- genuine denominator: uncorrected ${score.sevenB.genuineUncorrected} · naive-precision-corrected ${score.sevenB.genuineNaiveCorrected === null ? 'n/a (no seed precision)' : score.sevenB.genuineNaiveCorrected.toFixed(1)} — ${score.sevenB.correctionNote}`,
  );
  L.push('');
  L.push('### Byte-baseline column (per audited merge target)');
  L.push('');
  for (const b of score.sevenB.byteBaselines) {
    L.push(
      `- ${b.pickId}: ${b.computable ? (b.byteConflicted ? `byte-CONFLICTED (${b.conflictedFiles.join(', ')})` : 'byte-merges-clean') : `NOT COMPUTABLE (${b.note ?? 'unrecorded'})`}`,
    );
  }
  if (score.sevenB.byteBaselines.length === 0) L.push('- (no audited merge targets)');
  L.push('');
  L.push('## Falsifier (C) — failing closed is unaffordable (§7C)');
  L.push('');
  L.push(`VERDICT: ${score.sevenC.verdict} — ${score.sevenC.reason}`);
  L.push('');
  L.push(
    `- interventions: ${score.sevenC.interventionCount} (${score.sevenC.knotCount} KNOTs + ${score.sevenC.fallbackCount} logged git fallbacks) over ${score.admissions.n} admissions → ${pct(score.sevenC.interventionRate)} (ceiling 25%)`,
  );
  L.push(
    `- K2: over-block ${score.sevenC.k2.overBlock} vs genuine ${score.sevenC.k2.genuine} → ${score.sevenC.k2.falsified ? 'FALSIFIED (over-block > genuine)' : 'not tripped'}`,
  );
  L.push('');
  L.push('## Seeded classifier control (§5 / A11)');
  L.push('');
  L.push(
    `- seeds rated: ${score.seededControl.seedsRated} · GENUINE precision: ${score.seededControl.genuinePrecision === null ? 'n/a' : pct(score.seededControl.genuinePrecision)} (Wilson 95% LB ${score.seededControl.genuinePrecisionLowerBound95 === null ? 'n/a' : pct(score.seededControl.genuinePrecisionLowerBound95)}) · OVER-BLOCK recall: ${score.seededControl.overBlockRecall === null ? 'n/a' : pct(score.seededControl.overBlockRecall)}`,
  );
  L.push(
    `- beats the ~29% prior (Wilson lower bound): ${score.seededControl.beatsPrior ? 'YES' : 'NO'}${score.seededControl.uncalibrated ? ' — the (B)/(C) denominator is reported UNCALIBRATED and no pass is claimed on it' : ''}`,
  );
  L.push('');
  L.push('## Indeterminate fraction (§9 / A14 — a DIRECTIONAL bias, not a neutral bucket)');
  L.push('');
  L.push(
    `- ${score.indeterminate.indeterminate}/${score.indeterminate.total} classified KNOTs indeterminate (${pct(score.indeterminate.fraction)}); ${score.indeterminate.excluded} control card(s) excluded from the denominator`,
  );
  L.push(
    `- genuine after drain: ${score.indeterminate.genuineAfterDrain} (floor ${score.indeterminate.floor} → ${score.indeterminate.meetsFloor ? 'met' : 'NOT met — (B)/(C) forced INCONCLUSIVE'}) · over-block after drain: ${score.indeterminate.overBlockAfterDrain} (reported separately, never folded into "contested")`,
  );
  L.push(
    '- A HIGH indeterminate rate means (B)/(C) were measured on an EASIER subset and their verdict is correspondingly weaker.',
  );
  L.push('');
  L.push('## Per-card N=3 spread');
  L.push('');
  L.push(
    `- unanimous: ${score.spread.unanimous} · split-with-majority: ${score.spread.split} · no-majority: ${score.spread.noMajority}`,
  );
  L.push('');
  L.push('## Agreement (kappa)');
  L.push('');
  L.push(`- ${score.kappa.note}`);
  L.push('');
  L.push('## Correlated-priors limitation (§9)');
  L.push('');
  L.push(score.caveats.correlatedPriors);
  L.push('');
  L.push('## Audit-sample leak caveat (F3c)');
  L.push('');
  L.push(score.caveats.auditSampleLeak);
  L.push('');
  L.push(
    '"SURVIVES (this run)" is always scoped to this run and this covered class set — never generalized to "Warpline works". Preconditions unmet default to VOID / not-tested, never to a pass.',
  );
  L.push('');
  return L.join('\n');
}

/* ── artifact loading (for the CLI; kept here so tests can reuse it) ─────────── */

export function fieldReportMarkdownPathOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'report.md');
}

export function fieldReportJsonPathOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'report.json');
}

/** Parse `<judgeDir>/judgments.jsonl` (verbatim §5 audit artifact). [] if absent. */
export function readFieldJudgments(root: string): Judgment[] {
  const p = path.join(fieldJudgeDirOf(root), 'judgments.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Judgment);
}

/** Load every recorded artifact + compute the byte baselines, then score. */
export function scoreFieldRunFromDisk(root: string, opts: { admissionsOverride?: number; store?: ObjectStore } = {}): FieldScore {
  const store = opts.store ?? new ObjectStore(root);
  const oracleRows = readAuditLedger(root);
  const ledgerPath = fieldJudgeLedgerPathOf(root);
  const ledgerRows = fs.existsSync(ledgerPath) ? JudgeLedger.load(ledgerPath).all() : [];
  return scoreFieldRun({
    oracleRows,
    ledgerRows,
    judgments: readFieldJudgments(root),
    fallbacks: listGitFallbacks(root),
    mergeBaselines: computeMergeByteBaselines(root, store, oracleRows),
    knotBaselines: computeKnotByteBaselines(root, store),
    ...(opts.admissionsOverride !== undefined ? { admissionsOverride: opts.admissionsOverride } : {}),
  });
}
