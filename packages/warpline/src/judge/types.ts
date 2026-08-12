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
export const AGENTS_MODEL = 'claude-opus-5' as const;

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

/** The frozen pin of one run (§9 RUN-RECORD SPEC). Written once, before any card scores. */
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
  /** every cardId this run rates, in order — the frozen denominator membership. */
  cardIds: string[];
  /** the run date (§2 — the JUDGE is the reproducible instrument; the date is provenance, not identity). */
  createdAt: string;
}

/** Which kind of ledger row this is — the WRITE-BEFORE-REVEAL split (§3, §4). */
export type LedgerRowKind = 'judge-verdict' | 'warpline-join';

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
  /** present on a `warpline-join` row: the sealed verdict row it joins to. */
  judgeRowHash?: string;
  /** present on a `warpline-join` row: the Warpline answer being joined AFTER the seal. */
  warplineVerdict?: string;
}

/** A sealed row = its body + its content address. rowHash = sha256(canonical(body) + prevRowHash). */
export interface LedgerRow extends LedgerRowBody {
  rowHash: string;
}
