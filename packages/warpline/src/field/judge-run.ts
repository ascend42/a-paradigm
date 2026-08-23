/**
 * #field-judge-run — `warpline field judge`'s library half (expo-field-test-
 * protocol.md §3 custody/witness, §4 audit sample, §5 interleave/blinded judge;
 * field-test-readiness §B7 increment 2).
 *
 * Assembles the WHOLE blinded card stream — KNOT cards (the #field-cards output
 * dir), oracle-FLAGGED CLEAN cards, the §4 random AUDIT-SAMPLE CLEAN cards, the
 * planted/genuine/over-block seeds, and the injection corpus — interleaves it
 * with the COMMITTED shuffle seed, and hands it to the enforcing runner
 * (#judge/judge-runner `runJudgeEnforced`): pre-flight FIRST, majority verdicts
 * SEALED into the hash-chained ledger with §4 provenance, head written to the
 * git witness file.
 *
 * LEDGER-FILE PAIRING (reviewer follow-on, 2026-08-23): THIS run path owns the
 * JUDGE custody ledger, which keeps the protocol's own name
 * `expo-field-audit.jsonl` (§3 LEDGER CUSTODY) under `.warpline/field/judge/`.
 * The ORACLE ledger is the SEPARATE `.warpline/field/expo-field-oracle.jsonl`
 * (one row per audited seal, §4 RECORDING — see src/field/oracle.ts). They chain
 * independently; only the judge ledger gets the §3 A13 git witness.
 *
 * IDEMPOTENT by cardId: a card that already has a judge-verdict row in the
 * loaded ledger is skipped — continuity across batches is the runner's §3 A13
 * contract, and `--batch-limit` caps how many NEW cards one invocation scores.
 *
 * THE MODEL CALL IS INJECTED: tests pass a deterministic fake and never hit the
 * network; the CLI passes `liveCallModel` (ANTHROPIC_API_KEY) or the dry-run
 * `fakeFieldCallModel` behind `--fake`.
 *
 * STANDALONE from src/daemon by construction. Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObjectStore } from '../warp/object-store.js';
import { runJudgeEnforced, LEDGER_FILENAME, type JudgeRunnerResult } from '../judge/judge-runner.js';
import { JudgeLedger } from '../judge/ledger.js';
import type { CallModel } from '../judge/judge-run.js';
import type { RatingCard } from '../judge/rating-card.js';
import type { Provenance } from '../judge/types.js';
import { readAuditLedger } from './oracle.js';
import { fieldCardsDirOf } from './cards.js';
import {
  selectAuditSample,
  buildCleanCardFromOracleRow,
  provenanceOfOracleRow,
  interleave,
  loadOrCommitShuffleSeed,
  loadSeedCards,
  AUDIT_SAMPLE_LEAK_CAVEAT,
  type TaggedCard,
} from './interleave.js';

export function fieldJudgeDirOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'judge');
}

/** The judge custody ledger (§3 protocol name — see the pairing note above). */
export function fieldJudgeLedgerPathOf(root: string): string {
  return path.join(fieldJudgeDirOf(root), LEDGER_FILENAME);
}

/** The §3 A13 git witness file for the judge ledger head (protocol name). */
export function fieldWitnessPathOf(root: string): string {
  return path.join(fieldJudgeDirOf(root), 'expo-field-audit.head');
}

export function fieldJudgeManifestPathOf(root: string): string {
  return path.join(fieldJudgeDirOf(root), 'field-judge-manifest.json');
}

/**
 * The deterministic DRY-RUN model (`--fake`): labels by cardKind — the knot
 * rubric's card answers GENUINE, the clean rubric's answers not-broken. Constant
 * per kind, so a card and its benign twin always agree (the twin-invariant
 * passes) and a corpus payload is never tracked (framed == honest). For
 * rehearsing the pipeline shape only — it measures nothing.
 */
export function fakeFieldCallModel(): CallModel {
  return async (prompt: string): Promise<string> => (prompt.includes('OVER-BLOCK') ? 'GENUINE' : 'not-broken');
}

/** Every RatingCard persisted by `warpline field cards` (the #field-cards dir). */
export function readKnotCardsDir(root: string): RatingCard[] {
  const dir = fieldCardsDirOf(root);
  if (!fs.existsSync(dir)) return [];
  const out: RatingCard[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const card = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as RatingCard;
    if (card.schemaVersion !== 'ratingCard:v1' || typeof card.cardId !== 'string') continue;
    out.push(card);
  }
  return out;
}

export interface FieldJudgeAssembly {
  knot: number;
  oracleFlagged: number;
  auditSample: number;
  planted: number;
  seededControls: number;
  corpus: number;
}

export interface FieldJudgeResult {
  /** the enforcing runner's full result (heads, witness reminder, pre-flight). */
  runner: JudgeRunnerResult;
  /** per-source counts of the ASSEMBLED stream (before skip/batch-limit). */
  assembled: FieldJudgeAssembly;
  /** cards skipped because their cardId already has a sealed judge-verdict row. */
  skippedAlreadyJudged: number;
  /** cards deferred past --batch-limit (continuity scores them next invocation). */
  batchDeferred: number;
  /** the committed shuffle seed this stream was interleaved with. */
  seed: string;
  manifestPath: string;
}

export interface RunFieldJudgeOptions {
  callModel: CallModel;
  store?: ObjectStore;
  /** proposed shuffle seed — refused if a DIFFERENT seed is already committed. */
  seed?: string;
  /** cap on NEW cards scored this invocation (continuity handles the rest). */
  batchLimit?: number;
  samplesPerCard?: number;
  now?: () => string;
  /** TEST-ONLY hatch passed through to the pre-flight (empty corpus otherwise DQs). */
  allowEmptyCorpus?: boolean;
}

/**
 * The whole `field judge` pass. Assemble → dedupe against the sealed ledger →
 * commit/reuse the shuffle seed → interleave → `runJudgeEnforced`. Writes the
 * run manifest (counts + seed + the F3c audit-sample leak caveat) next to the
 * ledger. The CLI adds only argv parsing + printing.
 */
export async function runFieldJudge(root: string, opts: RunFieldJudgeOptions): Promise<FieldJudgeResult> {
  const store = opts.store ?? new ObjectStore(root);

  // ── assemble the tagged stream ────────────────────────────────────────────────
  const knotCards: TaggedCard[] = readKnotCardsDir(root).map((card) => ({
    card,
    provenance: { source: 'knot' } as Provenance,
  }));

  const oracleRows = readAuditLedger(root);
  const flaggedRows = oracleRows.filter((r) => r.verdict === 'candidate-false-clean' && r.planted !== true);
  const sampleRows = selectAuditSample(oracleRows);
  const flagged: TaggedCard[] = flaggedRows.map((row) => ({
    card: buildCleanCardFromOracleRow(row, { store, root }),
    provenance: provenanceOfOracleRow(row),
  }));
  const sampled: TaggedCard[] = sampleRows.map((row) => ({
    card: buildCleanCardFromOracleRow(row, { store, root }),
    provenance: provenanceOfOracleRow(row),
  }));

  const seeds = loadSeedCards(root);

  const assembled: FieldJudgeAssembly = {
    knot: knotCards.length,
    oracleFlagged: flagged.length,
    auditSample: sampled.length,
    planted: seeds.planted.length,
    seededControls: seeds.genuine.length + seeds.overBlock.length,
    corpus: seeds.corpus.length,
  };

  // ── idempotency: skip cards already sealed in the loaded ledger ──────────────
  const ledgerPath = fieldJudgeLedgerPathOf(root);
  const alreadyJudged = new Set<string>();
  if (fs.existsSync(ledgerPath)) {
    for (const row of JudgeLedger.load(ledgerPath).all()) {
      if (row.kind === 'judge-verdict') alreadyJudged.add(row.cardId);
    }
  }
  const stream = [...knotCards, ...flagged, ...sampled, ...seeds.planted, ...seeds.genuine, ...seeds.overBlock];
  // Dedupe within the stream too (a card can be assembled twice across sources).
  const seen = new Set<string>();
  const fresh: TaggedCard[] = [];
  let skippedAlreadyJudged = 0;
  for (const t of stream) {
    if (seen.has(t.card.cardId)) continue;
    seen.add(t.card.cardId);
    if (alreadyJudged.has(t.card.cardId)) {
      skippedAlreadyJudged++;
      continue;
    }
    fresh.push(t);
  }

  // ── committed seed + deterministic interleave (§5 blinding) ──────────────────
  const seed = loadOrCommitShuffleSeed(root, opts.seed);
  const shuffled = interleave(fresh, seed);
  const batch = opts.batchLimit !== undefined ? shuffled.slice(0, Math.max(0, opts.batchLimit)) : shuffled;
  const batchDeferred = shuffled.length - batch.length;

  const cardProvenance = new Map<string, Provenance>(batch.map((t) => [t.card.cardId, t.provenance]));

  const runner = await runJudgeEnforced({
    cards: batch.map((t) => t.card),
    corpus: seeds.corpus,
    callModel: opts.callModel,
    outDir: fieldJudgeDirOf(root),
    witnessPath: fieldWitnessPathOf(root),
    cardProvenance,
    ...(opts.samplesPerCard !== undefined ? { samplesPerCard: opts.samplesPerCard } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.allowEmptyCorpus ? { allowEmptyCorpus: true } : {}),
  });

  // ── the run manifest (counts + seed + the F3c leak caveat, LOUD) ─────────────
  const manifestPath = fieldJudgeManifestPathOf(root);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const manifest = {
    ts: (opts.now ?? ((): string => new Date().toISOString()))(),
    seed,
    assembled,
    skippedAlreadyJudged,
    batchDeferred,
    scored: runner.scored,
    disqualified: runner.disqualified,
    ...(runner.disqualifyReason !== undefined ? { disqualifyReason: runner.disqualifyReason } : {}),
    auditSampleLeakCaveat: AUDIT_SAMPLE_LEAK_CAVEAT,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { runner, assembled, skippedAlreadyJudged, batchDeferred, seed, manifestPath };
}
