/**
 * #judge/types — the shared vocabulary of the LIVE HALF of the Warpline LLM-judge
 * (expo-field-test-protocol.md §3, §5, §9). Everything the instrument, the ledger,
 * the pre-flight, and the scoring harness pass between one another is typed here so
 * the four modules agree by construction rather than by convention.
 *
 * STANDALONE by construction: this module — and every module that imports it —
 * reaches for nothing in src/daemon or the agent loader/roster/notebooks. The
 * judge is a cold instrument (§2 A1 / §5 SECOND-RATER IDENTITY): identity and
 * ledger flow OUTWARD only, and no Warpline daemon token is ever in scope.
 *
 * Library code: no console output.
 */

/** The pinned judge model — an EXACT dated snapshot, never an alias (§5, §2 A2). */
export const PINNED_JUDGE_MODEL = 'claude-opus-4-5-20251101' as const;

/** The agents-under-test model (§2 A15 — the SUBJECT, alias-only, recorded with the run date). */
export const AGENTS_MODEL = 'claude-opus-4-8' as const;

/** N = 3 samples per card, majority label (§5 A2). */
export const SAMPLES_PER_CARD = 3 as const;

/** The judge runs at temperature 0 (deterministic-as-possible pin, §9 RUN-RECORD SPEC). */
export const JUDGE_TEMPERATURE = 0 as const;

/** The §5 GENUINE / OVER-BLOCK labels, in the rubric's declared order. */
export const KNOT_LABELS = ['GENUINE', 'OVER-BLOCK', 'INDETERMINATE'] as const;
export type KnotLabel = (typeof KNOT_LABELS)[number];

/** The §4 broken / not-broken labels, in the rubric's declared order. */
export const CLEAN_LABELS = ['broken', 'not-broken', 'indeterminate'] as const;
export type CleanLabel = (typeof CLEAN_LABELS)[number];

/** The rubric's own INDETERMINATE bucket, per card kind (§5 — its own bucket, never folded). */
export const INDETERMINATE_LABEL = { knot: 'INDETERMINATE', clean: 'indeterminate' } as const;

/**
 * The sentinel for a card the N=3 samples could not resolve to a 2-of-3 majority
 * (§5 "A card with no 2-of-3 majority is INDETERMINATE"; §9 directional bias). It
 * is DISTINCT from the rubric's own INDETERMINATE label, which a majority CAN pick.
 */
export const NO_MAJORITY = 'NO-MAJORITY' as const;

/** The bucket an unparseable sample lands in, so spread never silently drops one. */
export const UNPARSEABLE = 'UNPARSEABLE' as const;

/**
 * One card's verdict, captured verbatim (§3 custody: the exact bytes out). `samples`
 * is the raw model output per sample, IN ORDER, never a hand-transcription; the
 * derived fields are recomputed from it.
 */
export interface Judgment {
  /** the content address of the rated card (its render header carries this too). */
  cardId: string;
  cardKind: 'knot' | 'clean';
  /** the frozen rubric the card was rated under (rubric:v1:sha256, §5). */
  rubricHash: string;
  /** the N raw model outputs, verbatim and in order (§3 verbatim capture). */
  samples: string[];
  /** the label parsed from each sample (null = unparseable), positional to `samples`. */
  parsedLabels: (string | null)[];
  /** the 3-way (or N-way) label distribution — includes UNPARSEABLE when present. */
  spread: Record<string, number>;
  /** the label with ≥ ⌈N/2⌉ votes, or NO_MAJORITY (§5). */
  majorityLabel: string;
  /** true iff the card resolves to no DECISIVE label — no-majority OR majority-INDETERMINATE (§9). */
  indeterminate: boolean;
  /** true iff NO label reached the 2-of-3 threshold at all (§9's exact wording). */
  noMajority: boolean;
}

/**
 * One BATCH of a run (§3 A13 multi-batch continuity): a run may be scored across
 * several invocations; each appends a batch here, and the pinned instrument fields
 * (model / promptHash / rubricHash / samplesPerCard) must match across every batch.
 */
export interface RunBatch {
  createdAt: string;
  /** the cardIds THIS batch rated, in order (may overlap an earlier batch). */
  cardIds: string[];
}

/**
 * The frozen pin of one run (§9 RUN-RECORD SPEC). Written before any card scores;
 * on a later batch it is RE-READ, verified to match the pinned instrument, and its
 * `cardIds` MERGED (additive — schemaVersion stays 'runRecord:v1').
 */
export interface RunRecord {
  schemaVersion: 'runRecord:v1';
  /** the provider the judge is a direct API call to (§2 — Claude only). */
  provider: 'anthropic';
  /** the pinned judge model — exact dated snapshot (§5). */
  model: typeof PINNED_JUDGE_MODEL;
  /** the agents-under-test model (§2 A15 — selects the §9 ≠-branch caveat). */
  agentsModel: typeof AGENTS_MODEL;
  /** temperature 0 (§9). */
  temperature: typeof JUDGE_TEMPERATURE;
  /** N = 3 (§5 A2). */
  samplesPerCard: number;
  /** sha256 over the concatenated frozen rubric texts — a silent re-phrase is detectable. */
  promptHash: string;
  /** the two frozen rubric content addresses (§5). */
  rubricHash: { knot: string; clean: string };
  /** every cardId this run rates, in order (the UNION across batches) — the frozen denominator membership. */
  cardIds: string[];
  /** the run date of the FIRST batch (§2 — the JUDGE is the reproducible instrument; the date is provenance, not identity). */
  createdAt: string;
  /** per-batch membership, appended on every invocation (§3 A13 continuity). Absent on a pre-batch record. */
  batches?: RunBatch[];
}

/** Which kind of ledger row this is — the WRITE-BEFORE-REVEAL split (§3, §4). */
export type LedgerRowKind = 'judge-verdict' | 'warpline-join';

/** Where a rated card came from (§4 RECORDING) — sealed into the LEDGER, never shown to the judge. */
export type ProvenanceSource = 'oracle-flagged' | 'audit-sample' | 'planted-control' | 'seeded-control' | 'knot' | 'corpus';

/** A per-assertion oracle outcome map, or one outcome for the whole check. */
export type OracleOutcome = 'pass' | 'fail' | 'absent' | Record<string, 'pass' | 'fail'>;

/**
 * The §4 RECORDING fields for one rated card — WRITE-TIME-IMMUTABLE once sealed into
 * the hash-chained ledger row (a later edit of any flag breaks `verify()`). BLINDNESS:
 * provenance lives ONLY in the ledger; it is never rendered into the rating card or the
 * model prompt (#judge/card-render takes a RatingCard, which has no provenance field).
 */
export interface Provenance {
  source: ProvenanceSource;
  /** true when this card is a §4 audit sample drawn from the CLEAN seals. */
  auditSample?: boolean;
  /** true when this card is a PLANTED control (known answer, excluded from the denominator). */
  planted?: boolean;
  /** true when this card is a SEEDED classifier control (A11, excluded from the denominator). */
  seededControl?: boolean;
  /** the sealed ground truth for a control card (GENUINE / OVER-BLOCK for knots; broken / not-broken for cleans). */
  groundTruth?: 'GENUINE' | 'OVER-BLOCK' | 'broken' | 'not-broken';
  /** false when the merge touched only blind classes (§8). */
  coveredClass?: boolean;
  /** true when a green-gate / frozen-oracle assertion regressed on the merge (§4 objective, non-vetoable). */
  objectiveRegression?: boolean;
  strandId?: string;
  pickId?: string;
  agents?: string[];
  parentStateIds?: string[];
  mergedTreeId?: string;
  /** per-check oracle outcomes on the parents/merge (§4). */
  oracle?: Record<string, OracleOutcome>;
}

/** Provenance sources that are NEVER part of the blinded (B)/(C) or §4 denominator. */
export const EXCLUDED_PROVENANCE_SOURCES: readonly ProvenanceSource[] = ['planted-control', 'seeded-control', 'corpus'];

/**
 * True iff a card with this provenance is EXCLUDED from the denominator: planted or
 * seeded controls and injection-corpus cards are instrument calibration, not the
 * population being measured (§5 / A11, §9 A14).
 */
export function provenanceExcludedFromDenominator(p: Provenance | undefined): boolean {
  if (!p) return false;
  return p.planted === true || p.seededControl === true || EXCLUDED_PROVENANCE_SOURCES.includes(p.source);
}

/**
 * A hash-chained ledger row body (§3 custody). The `judge-verdict` row is sealed
 * BEFORE any Warpline verdict is known; the `warpline-join` row is written LATER and
 * references the sealed verdict row's `rowHash` — the judge's rating provably
 * predates knowledge of the answer it is rating.
 */
export interface LedgerRowBody {
  kind: LedgerRowKind;
  /** monotonic seal order — the position this row occupies in the chain. */
  sealedOrdinal: number;
  /** the card this row concerns. */
  cardId: string;
  /** the immediately-preceding row's rowHash (null at genesis). */
  prevRowHash: string | null;
  /** present on a `judge-verdict` row: the sealed majority label (the rating). */
  judgeVerdict?: string;
  /**
   * present on a `judge-verdict` row: `judgment:v1:sha256(canonical(Judgment))` over the
   * FULL verbatim Judgment (samples, parsedLabels, spread, majorityLabel, …) — chain-binds
   * the raw model bytes to the sealed verdict so the plaintext judgments.jsonl cannot be
   * silently rewritten under the ledger (§3 verbatim, §4 "immutable at write time").
   */
  judgmentHash?: string;
  /** present on a `judge-verdict` row: the §4 RECORDING fields, sealed at write time. */
  provenance?: Provenance;
  /** present on a `warpline-join` row: the sealed verdict row it joins to. */
  judgeRowHash?: string;
  /** present on a `warpline-join` row: the Warpline answer being joined AFTER the seal. */
  warplineVerdict?: string;
}

/** A sealed row = its body + its content address. rowHash = sha256(canonical(body) + prevRowHash). */
export interface LedgerRow extends LedgerRowBody {
  rowHash: string;
}
