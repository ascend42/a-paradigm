/**
 * #field-interleave — the §5 card stream (expo-field-test-protocol.md §4 RANDOM
 * AUDIT SAMPLE, §5 interleave/blinding; field-test-readiness §B7 increment 2).
 *
 * Four pieces, all pure over recorded artifacts:
 *
 *   1. `selectAuditSample` — the §4 pre-registered rule VERBATIM: every 5th
 *      auto-wove CLEAN by LEDGER ORDER among dismissed CLEANs (verdict
 *      'true-clean', no oracle flag), floor 15 per block; planted rows excluded.
 *      The fraction/rule are FIXED (20% ≈ every 5th) and never adapt to the
 *      observed CLEAN count.
 *   2. `buildCleanCardFromOracleRow` — the bridge from an ORACLE ledger row to
 *      the #judge stripper's CleanAuditRow input: sides restored from the
 *      strand's own MergeRecipe trees for the CHANGED paths the row recorded.
 *   3. `interleave` — a deterministic Fisher–Yates keyed by sha256(seed‖index),
 *      with the seed COMMITTED to `.warpline/field/judge/shuffle-seed` before
 *      the first batch (a later batch must reuse it — a re-shuffle mid-run would
 *      let selection order leak the answer).
 *   4. `loadSeedCards` — operator-provided seed/corpus card sets under
 *      `.warpline/field/seeds/`, each directory sealed by a manifest.json
 *      carrying ground-truth labels + per-file sha256; any mismatch refuses.
 *
 * AUDIT-SAMPLE LEAK (F3c, founder-gated — DO NOT fix here): §5's clean rubric
 * card carries `failingCheck` (the NAME of the failing oracle check). An
 * audit-sample CLEAN has, by definition, NO failing check — but the frozen
 * rubric + `buildCleanRatingCard` require the field, so the sentinel
 * 'none-declared' is passed. That sentinel is VISIBLE to the judge and leaks
 * "this card was sampled, not flagged" — a provenance-shape leak the blinding
 * is supposed to prevent. The rubric change that would fix it is FOUNDER-GATED
 * (a rubric edit voids the frozen pin); until ratified, the leak is carried as
 * a LOUD caveat (`AUDIT_SAMPLE_LEAK_CAVEAT`) in the emitted run manifest and
 * the §9 report — stated, never hidden, never silently "fixed".
 *
 * STANDALONE from src/daemon by construction. Library code: no console output.
 */

import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe, type Strand } from '../fabric/strand.js';
import { warplineDirOf, readFabric } from '../fabric/fabric.js';
import { ObjectStore } from '../warp/object-store.js';
import {
  buildCleanRatingCard,
  RATING_CARD_SCHEMA,
  type RatingCard,
  type CleanAuditRow,
} from '../judge/rating-card.js';
import type { CorpusCard } from '../judge/preflight.js';
import type { Provenance } from '../judge/types.js';
import type { OracleRow, FieldCheckOutcome } from './oracle.js';

/* ── the audit-sample leak caveat (F3c — manifest/report text, NOT a rubric fix) ── */

/** The sentinel failingCheck an audit-sample card carries (see module header). */
export const AUDIT_SAMPLE_SENTINEL_FAILING_CHECK = 'none-declared' as const;

/** The §9 caveat the emitted manifest and report MUST carry verbatim (F3c). */
export const AUDIT_SAMPLE_LEAK_CAVEAT =
  "AUDIT-SAMPLE LEAK (F3c, founder-gated): audit-sample CLEAN cards carry failingCheck:'none-declared' " +
  'because the frozen clean rubric card requires a failingCheck; the sentinel is visible to the judge and ' +
  'leaks oracle-flagged vs audit-sample provenance shape. The rubric fix is founder-gated (a rubric edit ' +
  'voids the frozen pin) — this run carries the leak as a stated caveat, not a silent fix.';

/* ── 1. the §4 random audit sample ───────────────────────────────────────────── */

export interface AuditSampleOptions {
  /** the pre-registered fixed fraction (documentation of the rule; every-5th IS 20%). */
  fraction?: number;
  /** every Nth eligible CLEAN by ledger order (pre-registered: 5). */
  every?: number;
  /** floor per 100-admission block (pre-registered: 15). */
  floor?: number;
}

/**
 * The §4 rule verbatim: among rows with verdict 'true-clean' (dismissed CLEANs —
 * sealed CLEAN with no oracle flag), in LEDGER ORDER, take every 5th; if that
 * yields fewer than the floor of 15, take the FIRST 15 by ledger order; if fewer
 * than 15 exist, take all. Planted rows are calibration seeds, not field
 * admissions, and are excluded from selection. Deterministic and pure — the
 * scoring harness re-derives the same selection from the same ledger.
 *
 * FLOOR SCOPE (stated caveat): §4 words the floor as "15 per 100-admission
 * block"; this implementation applies it GLOBALLY over the ledger it is given —
 * EQUIVALENT below 100 admissions (one block), but a multi-block run (§3: a
 * second declared block) needs per-block flooring before this rule is reused.
 * The §9 report states the same caveat next to the audit-sample count.
 */
export function selectAuditSample(cleanRows: readonly OracleRow[], opts: AuditSampleOptions = {}): OracleRow[] {
  const every = opts.every ?? 5;
  const floor = opts.floor ?? 15;
  // `fraction` is the pre-registered rate the rule implements; the RULE (every
  // 5th) is what selects — the fraction never re-tunes it (§4: "do not change
  // with the observed CLEAN count").
  void (opts.fraction ?? 0.2);
  const eligible = cleanRows.filter((r) => r.verdict === 'true-clean' && r.planted !== true);
  const everyNth = eligible.filter((_, i) => (i + 1) % every === 0);
  if (everyNth.length >= floor) return everyNth;
  return eligible.slice(0, floor);
}

/* ── 2. OracleRow → blinded CLEAN rating card ────────────────────────────────── */

const UNRECORDED = '(unrecorded)';
const NO_RECORDED_INTENT = '(no recorded intent)';

/** The DAG/chain parents of a strand (same epoch-aware walk as #field-oracle). */
function parentPickIdsOf(s: Strand): string[] {
  if (s.parents !== undefined) return s.parents;
  const out: string[] = [];
  if (s.parentPickId) out.push(s.parentPickId);
  if (s.mergeParentPickId) out.push(s.mergeParentPickId);
  return out;
}

/** The first FAILED check/assertion name on a flagged row — the §4 failing check. */
function failingCheckNameOf(row: OracleRow): string {
  const firstFail = (m: Record<string, FieldCheckOutcome> | undefined): string | null => {
    for (const [name, outcome] of Object.entries(m ?? {})) if (outcome === 'fail') return name;
    return null;
  };
  return firstFail(row.oracle.checks) ?? firstFail(row.oracle.behavioral) ?? 'unrecorded-failing-check';
}

/**
 * Bridge one ORACLE ledger row to the judge stripper's `CleanAuditRow` input and
 * build the blinded CLEAN rating card. The sides' bodies come from the strand's
 * OWN MergeRecipe trees (ours/theirs — the exact trees the oracle audited), the
 * merged body from the row's mergedTreeId, and the file set is the CHANGED paths
 * the row recorded at audit time (never re-derived here — re-derivation could
 * disagree with what was sealed). Intents are the parent strands' recorded
 * `intent` prose. Throws precisely when the row cannot be carded (missing
 * strand/recipe/changedPaths) — a flagged candidate must never be silently
 * dropped from the stream.
 */
export function buildCleanCardFromOracleRow(
  row: OracleRow,
  ctx: { store: ObjectStore; root: string },
): RatingCard {
  const fabric = readFabric(warplineDirOf(ctx.root));
  const byPick = new Map<string, Strand>(fabric.map((s) => [s.pickId, s]));
  const strand = byPick.get(row.pickId);
  if (!strand) {
    throw new Error(
      `warpline: field interleave — oracle row ${row.pickId} has no strand in the fabric; a CLEAN card needs the sealed MergeRecipe trees`,
    );
  }
  if (!strand.merge) {
    throw new Error(
      `warpline: field interleave — strand ${row.pickId} carries no MergeRecipe; only merge seals produce CLEAN rating cards (single-parent seals have no two sides to blind-rate)`,
    );
  }
  if (row.changedPaths === null) {
    throw new Error(
      `warpline: field interleave — oracle row ${row.pickId} recorded changedPaths:null (underivable at audit time); refusing to build a card over an unknown file set`,
    );
  }

  const parentIds = parentPickIdsOf(strand);
  const parents = parentIds.map((id) => byPick.get(id) ?? null);
  const intents: [string, string] = [
    parents[0]?.intent ?? NO_RECORDED_INTENT,
    parents[1]?.intent ?? NO_RECORDED_INTENT,
  ];

  const auditRow: CleanAuditRow = {
    parentStateIds: [row.parentStateIds[0] ?? UNRECORDED, row.parentStateIds[1] ?? UNRECORDED],
    parentTreeIds: [strand.merge.ours, strand.merge.theirs],
    mergedTreeId: row.mergedTreeId,
    // Oracle-FLAGGED: the failing check's NAME (§5 — never the verdict).
    // Audit-sample: the F3c sentinel — see the module header + AUDIT_SAMPLE_LEAK_CAVEAT.
    failingCheck:
      row.verdict === 'candidate-false-clean' ? failingCheckNameOf(row) : AUDIT_SAMPLE_SENTINEL_FAILING_CHECK,
    filePaths: row.changedPaths,
    intents,
  };
  return buildCleanRatingCard(auditRow, { store: ctx.store });
}

/**
 * The §4 RECORDING provenance for a CLEAN card built from an oracle row — sealed
 * into the LEDGER only (never the card or the prompt). 'excluded-parent-red'
 * outcomes are dropped from the provenance oracle map (the judge-types
 * OracleOutcome vocabulary has no such value); the FULL record stays in the
 * hash-chained oracle ledger, which the provenance points back into via pickId.
 */
export function provenanceOfOracleRow(row: OracleRow): Provenance {
  const auditSample = row.verdict !== 'candidate-false-clean';
  const oracleMap: Record<string, 'pass' | 'fail' | 'absent'> = {};
  for (const [name, outcome] of Object.entries({ ...row.oracle.checks, ...(row.oracle.behavioral ?? {}) })) {
    if (outcome === 'pass' || outcome === 'fail' || outcome === 'absent') oracleMap[name] = outcome;
  }
  return {
    source: auditSample ? 'audit-sample' : 'oracle-flagged',
    ...(auditSample ? { auditSample: true } : {}),
    ...(row.planted === true ? { planted: true } : {}),
    coveredClass: row.coveredClass,
    objectiveRegression: row.objectiveRegression,
    strandId: row.strandId,
    pickId: row.pickId,
    agents: row.agents.filter((a): a is string => a !== null),
    parentStateIds: row.parentStateIds.filter((s): s is string => s !== null),
    ...(row.mergedTreeId !== null ? { mergedTreeId: row.mergedTreeId } : {}),
    oracle: oracleMap,
  };
}

/* ── 3. the committed-seed deterministic interleave ──────────────────────────── */

/** One card in the blinded stream: the card + its LEDGER-ONLY provenance. */
export interface TaggedCard {
  card: RatingCard;
  provenance: Provenance;
  /** present ONLY for injection-corpus cards — the label the payload demands. */
  steeredLabel?: string;
}

export function shuffleSeedPathOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'judge', 'shuffle-seed');
}

/**
 * The COMMITTED shuffle seed (§5 blinding): written before the first batch; a
 * later batch MUST reuse it — once the file exists, proposing a different seed
 * REFUSES (a mid-run re-shuffle would let card order leak or re-fit selection).
 * With no proposal and no file, a fresh 32-byte random hex seed is committed.
 */
export function loadOrCommitShuffleSeed(root: string, proposed?: string): string {
  const p = shuffleSeedPathOf(root);
  if (fs.existsSync(p)) {
    const committed = fs.readFileSync(p, 'utf8').trim();
    if (proposed !== undefined && proposed !== committed) {
      throw new Error(
        `warpline: field interleave — shuffle seed already committed at ${p} (${committed.slice(0, 16)}…); ` +
          `refusing a different seed mid-run (a re-shuffle would break the §5 blinding). Re-run without --seed, or with the committed value.`,
      );
    }
    return committed;
  }
  const seed = proposed ?? randomBytes(32).toString('hex');
  if (!/^[0-9a-fA-F]{8,}$/.test(seed)) {
    throw new Error(`warpline: field interleave — a shuffle seed must be hex (≥8 chars); got ${JSON.stringify(seed)}`);
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, seed + '\n', 'utf8');
  return seed;
}

/**
 * Deterministic Fisher–Yates keyed by sha256(seedHex‖index): same seed + same
 * card list ⇒ byte-identical order, no wall clock, no Math.random. Pure — the
 * input array is not mutated.
 */
export function interleave<T>(cards: readonly T[], seedHex: string): T[] {
  const out = cards.slice();
  for (let i = out.length - 1; i >= 1; i--) {
    const digest = createHash('sha256').update(`${seedHex}${i}`, 'utf8').digest('hex');
    const j = Number(BigInt('0x' + digest.slice(0, 12)) % BigInt(i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/* ── 4. operator seed/corpus card sets (sealed by manifest) ──────────────────── */

export function seedsDirOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'seeds');
}

/** One manifest entry: the file it seals, the card it must contain, its bytes' hash. */
export interface SeedManifestEntry {
  file: string;
  cardId: string;
  /** sha256 hex over the EXACT card-file bytes. */
  sha256: string;
  /** sealed ground truth (required in planted/genuine/over-block dirs). */
  groundTruth?: 'GENUINE' | 'OVER-BLOCK' | 'broken' | 'not-broken';
  /** the label the planted payload demands (required in corpus dir). */
  steeredLabel?: string;
}

export interface SeedManifest {
  cards: SeedManifestEntry[];
}

export interface SeedCardSets {
  /** §4 planted positive control (known-broken CLEAN) — provenance planted:true. */
  planted: TaggedCard[];
  /** §5/A11 KNOWN-GENUINE seeds — provenance seededControl:true, groundTruth GENUINE. */
  genuine: TaggedCard[];
  /** §5/A11 KNOWN-OVER-BLOCK seeds — provenance seededControl:true, groundTruth OVER-BLOCK. */
  overBlock: TaggedCard[];
  /** §5 blind injection corpus — fed to the pre-flight, never scored as data. */
  corpus: CorpusCard[];
}

/** Recompute a card's content address (the #judge/rating-card seal formula). */
function recomputeCardId(card: RatingCard): string {
  const { cardId: _omit, ...body } = card;
  return (
    RATING_CARD_SCHEMA +
    ':' +
    createHash('sha256').update(canonicalSerialize(canonicalSafe(body as unknown)), 'utf8').digest('hex')
  );
}

/** Load + verify ONE sealed seed directory. Absent dir → []. Any mismatch → throw. */
function loadSealedDir(
  dir: string,
  kindLabel: string,
  requiredGroundTruth: ReadonlyArray<SeedManifestEntry['groundTruth']> | null,
  requireSteeredLabel: boolean,
): Array<{ card: RatingCard; entry: SeedManifestEntry }> {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'manifest.json');
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    if (files.length === 0) return [];
    throw new Error(
      `warpline: field seeds — ${dir} holds ${files.length} card file(s) but no manifest.json; unsealed seed cards refuse (ground truth must be SEALED before the run)`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SeedManifest;
  if (!Array.isArray(manifest.cards)) {
    throw new Error(`warpline: field seeds — ${manifestPath} malformed: "cards" must be an array`);
  }
  const sealed = new Set(manifest.cards.map((e) => e.file));
  for (const f of files) {
    if (!sealed.has(f)) {
      throw new Error(
        `warpline: field seeds — ${path.join(dir, f)} is not in ${manifestPath}; a card the manifest never sealed refuses (it could have been added after the ground truth froze)`,
      );
    }
  }
  const out: Array<{ card: RatingCard; entry: SeedManifestEntry }> = [];
  for (const entry of manifest.cards) {
    const full = path.join(dir, entry.file);
    if (!fs.existsSync(full)) {
      throw new Error(`warpline: field seeds — ${manifestPath} seals ${entry.file}, but the file is absent`);
    }
    const bytes = fs.readFileSync(full);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256) {
      throw new Error(
        `warpline: field seeds — ${full} bytes hash ${digest.slice(0, 16)}… != sealed sha256 ${String(entry.sha256).slice(0, 16)}… (card altered after the manifest froze) — refusing`,
      );
    }
    const card = JSON.parse(bytes.toString('utf8')) as RatingCard;
    if (card.cardId !== entry.cardId) {
      throw new Error(
        `warpline: field seeds — ${full} carries cardId ${card.cardId.slice(0, 28)}… != sealed cardId ${entry.cardId.slice(0, 28)}… — refusing`,
      );
    }
    const recomputed = recomputeCardId(card);
    if (recomputed !== card.cardId) {
      throw new Error(
        `warpline: field seeds — ${full} cardId does not match its own content (recomputed ${recomputed.slice(0, 28)}…) — a forged content address refuses`,
      );
    }
    if (requiredGroundTruth !== null) {
      if (entry.groundTruth === undefined || !requiredGroundTruth.includes(entry.groundTruth)) {
        throw new Error(
          `warpline: field seeds — ${manifestPath} entry ${entry.file}: a ${kindLabel} seed must seal groundTruth ∈ ${JSON.stringify(requiredGroundTruth)} (got ${JSON.stringify(entry.groundTruth)})`,
        );
      }
    }
    if (requireSteeredLabel && (typeof entry.steeredLabel !== 'string' || entry.steeredLabel.length === 0)) {
      throw new Error(
        `warpline: field seeds — ${manifestPath} entry ${entry.file}: a corpus card must seal the steeredLabel its payload demands`,
      );
    }
    out.push({ card, entry });
  }
  return out;
}

/**
 * Load the operator-provided seed/corpus card sets from
 * `.warpline/field/seeds/{planted,genuine,over-block,corpus}/`. Each directory
 * carries RatingCard JSON files + a `manifest.json` sealing ground-truth labels
 * and per-file sha256; each card's content address is re-verified. Absent
 * directories yield empty sets (the RUN pre-flight then refuses on an empty
 * corpus — the correct fail-closed default, §5 gate (b)).
 */
export function loadSeedCards(root: string): SeedCardSets {
  return loadSeedCardsFromDir(seedsDirOf(root));
}

/**
 * Same loader, addressed by the seeds ROOT directly (the four sealed dirs live
 * under `base`). This is the ONE loader — `warpline field seed verify` calls it
 * so the operator's pre-freeze check exercises the exact code path the run
 * itself will use (a producer proving itself against a copy would prove nothing).
 */
export function loadSeedCardsFromDir(base: string): SeedCardSets {
  const planted = loadSealedDir(path.join(base, 'planted'), 'planted', ['broken'], false).map(
    ({ card, entry }): TaggedCard => ({
      card,
      provenance: { source: 'planted-control', planted: true, groundTruth: entry.groundTruth },
    }),
  );
  const genuine = loadSealedDir(path.join(base, 'genuine'), 'genuine', ['GENUINE'], false).map(
    ({ card, entry }): TaggedCard => ({
      card,
      provenance: { source: 'seeded-control', seededControl: true, groundTruth: entry.groundTruth },
    }),
  );
  const overBlock = loadSealedDir(path.join(base, 'over-block'), 'over-block', ['OVER-BLOCK'], false).map(
    ({ card, entry }): TaggedCard => ({
      card,
      provenance: { source: 'seeded-control', seededControl: true, groundTruth: entry.groundTruth },
    }),
  );
  const corpus = loadSealedDir(path.join(base, 'corpus'), 'corpus', null, true).map(
    ({ card, entry }): CorpusCard => ({ card, steeredLabel: entry.steeredLabel! }),
  );
  return { planted, genuine, overBlock, corpus };
}
