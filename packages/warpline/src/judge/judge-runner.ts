/**
 * #judge/judge-runner — the ENFORCING RUN PATH (expo-field-test-protocol.md §3, §4,
 * §5). The foundation modules (#judge/preflight, #judge/ledger) had NO non-test
 * caller: the plain `runJudge` samples the model and appends `judgments.jsonl`, but it
 * neither GATES on the blocking pre-flight nor SEALS verdicts into the tamper-evident
 * ledger. This module is the real run path that wires all three together so nothing
 * real scores past an unvalidated judge and the denominator lives in the hash-chain,
 * not a plaintext log.
 *
 * THE THREE ENFORCED INVARIANTS:
 *
 *   1. PRE-FLIGHT FIRST (§5). `preflight` runs BEFORE any real card is scored: the
 *      per-card twin-invariant plus the blind injection corpus. If the judge is
 *      DISQUALIFIED, this runner HARD-REFUSES — no eligible card is sampled, nothing is
 *      sealed, no denominator is claimed. (`throwOnDisqualified` raises a
 *      `JudgeRefusedError`; the default returns a hard-fail result carrying the
 *      pre-flight diagnostics.) Only the twin-PASSING `eligibleCards` may score.
 *
 *   2. LEDGER IS THE DENOMINATOR (§3/§4). Each eligible card is sampled (via the plain
 *      `runJudge`, which keeps the verbatim raw model I/O as the §5 audit artifact —
 *      `run-record.json` + `judgments.jsonl`), and its MAJORITY verdict is SEALED
 *      through `JudgeLedger.sealJudgeVerdict` — the hash-chained, write-before-reveal
 *      custody. The plaintext `judgments.jsonl` is the raw-output AUDIT trail; the
 *      AUTHORITATIVE verdict record is the chained ledger. Any later Warpline-verdict
 *      join must go through `JudgeLedger.joinWarplineVerdict` (refused unless the
 *      verdict row was sealed first) — the seal provably predates the answer.
 *
 *   3. EXTERNAL WITNESS (§3 A13). A hash-chain is tamper-evident against a third party
 *      but NOT against the incentivized owner who controls the whole chain: whoever can
 *      append can re-hash every past row. So at each BLOCK BOUNDARY this runner writes
 *      the ledger's current `head()` to a git-tracked witness file (default
 *      `<outDir>/.warpline-judge/expo-field-audit.head`) AND surfaces it in the return
 *      value / injected logger. Committing (or GPG-signing) that head into git is a
 *      REQUIRED run-procedure step — the code writes and surfaces the head; the
 *      OPERATOR commits it, so git's independent history is the external clock the owner
 *      cannot silently rewind. A run whose final head does not chain forward from its
 *      git-witnessed intermediate heads is VOID. Every batch boundary head is ALSO
 *      appended to `<witness>.log` (`<iso> <head>`), so the intermediate heads survive,
 *      not only the latest.
 *
 *   4. MULTI-BATCH CONTINUITY (§3 A13). A run is scored across several invocations of
 *      the same outDir. If `<outDir>/expo-field-audit.jsonl` exists it is LOADED and
 *      VERIFIED first (a broken chain raises `LedgerContinuityError` and NOTHING is
 *      sealed), then this batch APPENDS to it — never `new JudgeLedger()` over an
 *      existing file. The result carries `previousHead` (loaded from disk) and
 *      `ledgerHead` (after this batch) so the operator can see the chain advance.
 *
 *   5. VERBATIM BINDING + §4 RECORDING. Every sealed verdict row carries
 *      `judgmentHash` over the FULL verbatim Judgment (chain-binds judgments.jsonl) and,
 *      when the caller supplies `cardProvenance`, the §4 RECORDING provenance — sealed
 *      into the LEDGER only; it never reaches the rating card or the model prompt.
 *
 * STANDALONE by construction (§5 SECOND-RATER IDENTITY): imports only the judge
 * foundation and node stdlib — NOTHING from src/daemon or the agent loader/roster.
 * The model call is INJECTABLE — unit tests pass a deterministic fake and never hit the
 * network.
 *
 * Library code: no console output — surfacing is via the return value or an injected
 * logger, never `console.*`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { preflight, type CorpusCard, type PreflightResult } from './preflight.js';
import { runJudge, type CallModel, type RunResult } from './judge-run.js';
import { JudgeLedger, LedgerContinuityError, judgmentHashOf } from './ledger.js';
import type { RatingCard } from './rating-card.js';
import type { LedgerRow, Provenance } from './types.js';

export { LedgerContinuityError } from './ledger.js';

/** The git-tracked witness file, relative to the run's outDir (§3 A13). */
export const DEFAULT_WITNESS_RELPATH = path.join('.warpline-judge', 'expo-field-audit.head');
/** The authoritative hash-chained denominator, persisted next to the raw artifacts (§3). */
export const LEDGER_FILENAME = 'expo-field-audit.jsonl';

/**
 * The judge REFUSED to score: the blocking pre-flight disqualified it (§5). Carries the
 * full `PreflightResult` so the caller sees WHY (the tracked corpus card, the voided
 * cards). Raised only when `throwOnDisqualified` is set; otherwise the runner returns a
 * hard-fail result instead.
 */
export class JudgeRefusedError extends Error {
  readonly preflight: PreflightResult;
  constructor(message: string, preflightResult: PreflightResult) {
    super(message);
    this.name = 'JudgeRefusedError';
    this.preflight = preflightResult;
  }
}

/**
 * Injected surfacing for the runner — the judge modules emit no `console.*`, so the
 * operator-facing head announcement flows through this callback (default: no-op). The
 * head is ALSO returned in the result, so a caller that ignores the logger still gets it.
 */
export interface JudgeRunnerLogger {
  /** a block was sealed and its head written to the witness file — commit it into git. */
  witnessed(head: string | null, witnessPath: string): void;
  /** the judge was disqualified by the pre-flight — nothing scored. */
  refused?(reason: string): void;
}

export interface JudgeRunnerResult {
  /** true iff the judge failed the injection pre-flight — nothing real scored (§5). */
  disqualified: boolean;
  disqualifyReason?: string;
  /** the full pre-flight outcome (voided cards, corpus results) — always present. */
  preflight: PreflightResult;
  /** how many eligible cards were sealed into the ledger (0 when disqualified). */
  scored: number;
  /** the AUTHORITATIVE hash-chained denominator — the sealed verdict rows (§3/§4). */
  ledger: JudgeLedger;
  /** the on-disk ledger head loaded BEFORE this batch (null for a fresh outDir). */
  previousHead: string | null;
  /** the ledger head written to the witness file (null when nothing was sealed). */
  ledgerHead: string | null;
  /** where the head was written — the REQUIRED-to-commit external witness (§3 A13). */
  witnessPath: string;
  /** `<witnessPath>.log` — every batch boundary head, one `<iso> <head>` line per batch. */
  witnessLogPath: string;
  /** operator-facing reminder: this head MUST be committed/signed into git. */
  witnessCommitReminder: string;
  /** the sealed judge-verdict row per cardId — a later join references its rowHash. */
  verdictRows: Map<string, LedgerRow>;
  /** the §5 raw-output audit artifact (run-record.json + judgments.jsonl); null if disqualified. */
  rawRun: RunResult | null;
}

/**
 * The operator-facing, git-commit reminder for the witnessed head (§3 A13).
 * Exported so `warpline field join` (src/field/join.ts) prints the IDENTICAL
 * wording after the join rows extend the chain to a new head.
 */
export function witnessReminder(witnessPath: string, head: string | null): string {
  if (!head) {
    return `EXTERNAL WITNESS (§3 A13): no verdict was sealed, so there is no ledger head to witness.`;
  }
  return (
    `EXTERNAL WITNESS (§3 A13) — REQUIRED run-procedure step: the ledger head is ` +
    `tamper-evident only once git witnesses it. Commit the witness file into the ` +
    `git-tracked repo NOW, before any Warpline verdict is joined:\n` +
    `  git add ${witnessPath} && git commit -m "witness: judge ledger head ${head.slice(0, 24)}…"\n` +
    `A run whose final ledger head does not chain forward from its git-witnessed ` +
    `intermediate heads is VOID.`
  );
}

/**
 * Run the judge over a card set WITH the pre-flight gate and the hash-chained ledger
 * enforced. See the module header for the three invariants.
 *
 * The returned `ledger` is the authoritative denominator; join Warpline's verdicts to
 * it LATER via `ledger.joinWarplineVerdict({ judgeRowHash: verdictRows.get(cardId).rowHash, … })`
 * — the seal (done here) provably predates that answer (write-before-reveal, §3/§4).
 */
export async function runJudgeEnforced(args: {
  cards: RatingCard[];
  corpus: CorpusCard[];
  callModel: CallModel;
  outDir: string;
  samplesPerCard?: number;
  now?: () => string;
  /** the git-tracked witness file; defaults to `<outDir>/.warpline-judge/expo-field-audit.head`. */
  witnessPath?: string;
  log?: JudgeRunnerLogger;
  /** raise `JudgeRefusedError` on disqualification instead of returning a hard-fail result. */
  throwOnDisqualified?: boolean;
  /**
   * §4 RECORDING provenance per cardId — sealed into the LEDGER row at seal time. It is
   * NEVER rendered into the card or the model prompt (blindness is structural: the
   * rating card has no provenance field).
   */
  cardProvenance?: Map<string, Provenance>;
  /** TEST-ONLY hatch passed through to `preflight` — an empty corpus otherwise DISQUALIFIES. */
  allowEmptyCorpus?: boolean;
}): Promise<JudgeRunnerResult> {
  const witnessPath = args.witnessPath ?? path.join(args.outDir, DEFAULT_WITNESS_RELPATH);
  const witnessLogPath = witnessPath + '.log';
  const ledgerPath = path.join(args.outDir, LEDGER_FILENAME);

  // ── INVARIANT 4: CONTINUITY — load + verify an existing ledger BEFORE anything (§3 A13) ──
  let ledger: JudgeLedger;
  if (fs.existsSync(ledgerPath)) {
    ledger = JudgeLedger.load(ledgerPath);
    const v = ledger.verify();
    if (!v.ok) {
      throw new LedgerContinuityError(
        `runJudgeEnforced: the on-disk ledger ${ledgerPath} fails verification at row ${v.firstBadIndex}: ${v.detail ?? '(no detail)'} — refusing to seal anything over a broken chain`,
      );
    }
  } else {
    ledger = new JudgeLedger();
  }
  const previousHead = ledger.head();

  // ── INVARIANT 1: PRE-FLIGHT FIRST (§5) ──────────────────────────────────────────
  const pf = await preflight({
    cards: args.cards,
    corpus: args.corpus,
    callModel: args.callModel,
    ...(args.samplesPerCard !== undefined ? { samplesPerCard: args.samplesPerCard } : {}),
    ...(args.allowEmptyCorpus ? { allowEmptyCorpus: true } : {}),
  });

  if (pf.disqualified) {
    const reason = pf.disqualifyReason ?? 'judge disqualified by the injection pre-flight (§5)';
    args.log?.refused?.(reason);
    if (args.throwOnDisqualified) {
      throw new JudgeRefusedError(`runJudgeEnforced: REFUSED to score — ${reason}`, pf);
    }
    // Hard-fail result: nothing sampled, nothing sealed, no denominator claimed.
    return {
      disqualified: true,
      disqualifyReason: reason,
      preflight: pf,
      scored: 0,
      ledger,
      previousHead,
      ledgerHead: null,
      witnessPath,
      witnessLogPath,
      witnessCommitReminder: witnessReminder(witnessPath, null),
      verdictRows: new Map(),
      rawRun: null,
    };
  }

  // Only twin-PASSING cards are eligible to score (§5 gate (a)).
  const eligible = pf.eligibleCards;

  // ── INVARIANT 2: sample (verbatim §5 audit artifact) + SEAL into the ledger (§3/§4) ──
  const rawRun = await runJudge({
    cards: eligible,
    callModel: args.callModel,
    outDir: args.outDir,
    ...(args.samplesPerCard !== undefined ? { samplesPerCard: args.samplesPerCard } : {}),
    ...(args.now ? { now: args.now } : {}),
  });

  const verdictRows = new Map<string, LedgerRow>();
  for (const j of rawRun.judgments) {
    // Seal the majority verdict as its OWN row BEFORE any Warpline answer is known —
    // chain-bound to the verbatim Judgment, with the §4 provenance (ledger-only).
    const provenance = args.cardProvenance?.get(j.cardId);
    const row = ledger.sealJudgeVerdict({
      cardId: j.cardId,
      judgeVerdict: j.majorityLabel,
      judgmentHash: judgmentHashOf(j),
      ...(provenance !== undefined ? { provenance } : {}),
    });
    verdictRows.set(j.cardId, row);
  }

  // APPEND the authoritative denominator alongside the raw artifacts (never truncate).
  ledger.appendPersist(ledgerPath);

  // ── INVARIANT 3: EXTERNAL WITNESS at the block boundary (§3 A13) ─────────────────
  const head = ledger.head();
  fs.mkdirSync(path.dirname(witnessPath), { recursive: true });
  fs.writeFileSync(witnessPath, (head ?? '') + '\n', 'utf8');
  const iso = (args.now ?? (() => new Date().toISOString()))();
  fs.appendFileSync(witnessLogPath, `${iso} ${head ?? '(none)'}\n`, 'utf8');
  args.log?.witnessed(head, witnessPath);

  return {
    disqualified: false,
    preflight: pf,
    scored: verdictRows.size,
    ledger,
    previousHead,
    ledgerHead: head,
    witnessPath,
    witnessLogPath,
    witnessCommitReminder: witnessReminder(witnessPath, head),
    verdictRows,
    rawRun,
  };
}
