/**
 * #field-join — `warpline field join`'s library half (expo-field-test-protocol.md
 * §3 WRITE-BEFORE-REVEAL + A13 EXTERNAL WITNESS; T-2026-08-12-001).
 *
 * The join is the moment the ANSWER (Warpline's verdict) is attached to a sealed
 * judge rating. It is only meaningful if the rating provably predates it — and
 * a hash chain alone cannot prove that against the chain's own owner. So the
 * PRECONDITION here is the §3 A13 witness: the CURRENT ledger chain must contain,
 * at some row ordinal, a head that is GIT-COMMITTED (the witness file's content
 * at `git show HEAD:<witness>` equals that row's rowHash), and every row after it
 * is the only un-witnessed tail. No committed witness → NO JOIN — and a verdict
 * row sealed AFTER the witnessed ordinal is likewise NOT joined this pass
 * (reported `awaitingWitness`): only a head witnessed into git BEFORE the answer
 * is joined counts, so the un-witnessed tail must get its own witness commit
 * first. There is deliberately NO `--allow-unwitnessed` escape hatch: an
 * unwitnessed join is exactly the laundering the witness exists to prevent.
 *
 * JOIN SOURCES (never invented):
 *   - CLEAN cards → the ORACLE ledger row's sealed verdict
 *     ('true-clean' | 'candidate-false-clean' | 'blind-untested'), found via the
 *     §4 provenance pickId sealed in the judge-verdict row.
 *   - KNOT cards → the Warpline verdict 'KNOT'; when the fabric records a
 *     resolution strand pointing at the card's payload (resolves.knotPayloadId),
 *     the join carries 'KNOT:resolved' — the resolution outcome, recorded.
 *   - planted / seeded / corpus rows are CALIBRATION, not field data — they have
 *     no Warpline verdict and are skipped, counted, never guessed.
 *
 * After joining, the extended chain has a NEW head — persisted append-only and
 * written to the witness file again, with the same commit reminder the judge run
 * prints (the join rows need their own witness commit).
 *
 * STANDALONE from src/daemon by construction. Library code: no console output —
 * the CLI prints from the returned result.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObjectStore } from '../warp/object-store.js';
import { warplineDirOf, readFabric } from '../fabric/fabric.js';
import { listKnotPayloads } from '../fabric/knot-payload.js';
import { buildKnotRatingCard } from '../judge/rating-card.js';
import { JudgeLedger } from '../judge/ledger.js';
import { witnessReminder } from '../judge/judge-runner.js';
import type { LedgerRow } from '../judge/types.js';
import { provenanceExcludedFromDenominator } from '../judge/types.js';
import { readAuditLedger, type OracleRow } from './oracle.js';
import { fieldJudgeLedgerPathOf, fieldWitnessPathOf } from './judge-run.js';

/* ── the §3 A13 witnessed-head precondition ──────────────────────────────────── */

export interface WitnessCheck {
  /** the git-committed head hash (the witness file content at HEAD). */
  witnessedRowHash: string;
  /** the chain ordinal of the witnessed row. */
  witnessedOrdinal: number;
  /** rows sealed after the witnessed head — the only permitted un-witnessed tail. */
  unwitnessedTail: number;
  witnessRelPath: string;
}

/**
 * Enforce the A13 precondition: `git show HEAD:<witnessRelPath>` must yield a
 * head hash that equals SOME row's rowHash in the loaded chain. Refuses with a
 * precise message when git is absent, the witness file is not committed at HEAD,
 * or the committed content matches no chain row (a rewritten chain). The rows
 * AFTER the witnessed head are the un-witnessed tail — allowed, and reported.
 */
export function verifyWitnessedHead(root: string, rows: readonly LedgerRow[], witnessPath: string): WitnessCheck {
  const witnessRelPath = path.relative(root, witnessPath);
  let committed: string;
  try {
    committed = execFileSync('git', ['-C', root, 'show', `HEAD:${witnessRelPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new Error(
        `warpline: field join — git is absent; the §3 A13 witness precondition cannot be checked, so NOTHING is joined (there is no --allow-unwitnessed)`,
      );
    }
    throw new Error(
      `warpline: field join — the witness file ${witnessRelPath} is not committed at HEAD ` +
        `(git show HEAD:${witnessRelPath} failed: ${String(e.stderr ?? e.message).trim()}). ` +
        `Commit the witness FIRST — the judge ratings only provably predate the answers once git witnesses their head — then join. There is no --allow-unwitnessed.`,
    );
  }
  const witnessedRowHash = committed.trim().split('\n')[0]?.trim() ?? '';
  const witnessedOrdinal = rows.findIndex((r) => r.rowHash === witnessedRowHash);
  if (witnessedOrdinal === -1) {
    throw new Error(
      `warpline: field join — the git-committed witness (${witnessedRowHash.slice(0, 28)}…) matches NO row in the loaded ledger chain: ` +
        `the chain does not chain forward from its git-witnessed head, so the run is VOID under §3 A13. Refusing to join.`,
    );
  }
  return {
    witnessedRowHash,
    witnessedOrdinal,
    unwitnessedTail: rows.length - 1 - witnessedOrdinal,
    witnessRelPath,
  };
}

/* ── the join itself ─────────────────────────────────────────────────────────── */

export interface JoinUnjoinable {
  cardId: string;
  reason: string;
}

export interface FieldJoinResult {
  /** join rows sealed this pass. */
  joined: number;
  /** verdict rows already joined in an earlier pass (idempotent skip). */
  skippedAlreadyJoined: number;
  /** planted / seeded / corpus verdict rows — calibration, no Warpline verdict. */
  skippedControls: number;
  /**
   * Verdict rows sealed AFTER the git-witnessed ordinal (§3 A13): their ratings
   * are not yet provably pre-answer, so they are REFUSED this pass — commit the
   * current head into git, then re-run `field join`.
   */
  awaitingWitness: number;
  /** the operator instruction for the awaiting-witness rows (empty when none). */
  awaitingWitnessNote: string;
  /** rows with no join source on record — reported, never guessed. */
  unjoinable: JoinUnjoinable[];
  witness: WitnessCheck;
  ledgerHead: string | null;
  witnessPath: string;
  /** the verbatim §3 A13 commit reminder for the NEW head (join rows extend the chain). */
  witnessCommitReminder: string;
}

/**
 * Join Warpline's verdicts to the sealed judge-verdict rows (write-before-reveal:
 * every join references an EARLIER sealed rating). Idempotent — verdict rows
 * already referenced by a join row are skipped. See the module header for the
 * A13 precondition and the join sources.
 */
export function joinFieldVerdicts(
  root: string,
  opts: { store?: ObjectStore; now?: () => string } = {},
): FieldJoinResult {
  const ledgerPath = fieldJudgeLedgerPathOf(root);
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`warpline: field join — no judge ledger at ${ledgerPath}; run \`warpline field judge\` first`);
  }
  const ledger = JudgeLedger.load(ledgerPath);
  const v = ledger.verify();
  if (!v.ok) {
    throw new Error(
      `warpline: field join — the judge ledger fails verification at row ${v.firstBadIndex}: ${v.detail ?? '(no detail)'} — nothing is joined over a broken chain`,
    );
  }

  // ── PRECONDITION (§3 A13): the chain must contain a git-witnessed head ────────
  const witnessPath = fieldWitnessPathOf(root);
  const witness = verifyWitnessedHead(root, ledger.all(), witnessPath);

  // ── join sources ─────────────────────────────────────────────────────────────
  const oracleByPick = new Map<string, OracleRow>(readAuditLedger(root).map((r) => [r.pickId, r]));

  // KNOT cards: rebuild the (deterministic, content-addressed) card per payload
  // to recover cardId → payloadId, then look for a resolution strand.
  const store = opts.store ?? new ObjectStore(root);
  const cardIdToPayloadId = new Map<string, string>();
  for (const payload of listKnotPayloads(root)) {
    cardIdToPayloadId.set(buildKnotRatingCard(payload, { store }).cardId, payload.payloadId);
  }
  const resolvedPayloadIds = new Set<string>();
  for (const s of readFabric(warplineDirOf(root))) {
    if (s.resolves?.knotPayloadId) resolvedPayloadIds.add(s.resolves.knotPayloadId);
  }

  const alreadyJoined = new Set<string>();
  for (const row of ledger.all()) {
    if (row.kind === 'warpline-join' && row.judgeRowHash) alreadyJoined.add(row.judgeRowHash);
  }

  let joined = 0;
  let skippedAlreadyJoined = 0;
  let skippedControls = 0;
  let awaitingWitness = 0;
  const unjoinable: JoinUnjoinable[] = [];

  // Snapshot the verdict rows BEFORE sealing joins (the loop must not walk them).
  const verdictRows = ledger.all().filter((r) => r.kind === 'judge-verdict');
  for (const row of verdictRows) {
    if (alreadyJoined.has(row.rowHash)) {
      skippedAlreadyJoined++;
      continue;
    }
    // §3 A13: only a head witnessed into git BEFORE the answers are joined
    // counts. A verdict row sealed AFTER the witnessed ordinal is not yet
    // provably pre-answer — REFUSED this pass, never joined on credit.
    if (row.sealedOrdinal > witness.witnessedOrdinal) {
      awaitingWitness++;
      continue;
    }
    if (provenanceExcludedFromDenominator(row.provenance)) {
      skippedControls++;
      continue;
    }
    let warplineVerdict: string | null = null;
    const p = row.provenance;
    if (p?.source === 'oracle-flagged' || p?.source === 'audit-sample') {
      const orow = p.pickId !== undefined ? oracleByPick.get(p.pickId) : undefined;
      if (orow) warplineVerdict = orow.verdict;
      else {
        unjoinable.push({
          cardId: row.cardId,
          reason: `CLEAN card provenance points at pickId ${p.pickId ?? '(none)'} which has no oracle ledger row`,
        });
        continue;
      }
    } else if (p?.source === 'knot' || cardIdToPayloadId.has(row.cardId)) {
      const payloadId = cardIdToPayloadId.get(row.cardId);
      warplineVerdict = payloadId !== undefined && resolvedPayloadIds.has(payloadId) ? 'KNOT:resolved' : 'KNOT';
    } else {
      unjoinable.push({
        cardId: row.cardId,
        reason: `no join source on record (provenance source ${p?.source ?? '(none)'}, no matching KNOT payload) — not guessed`,
      });
      continue;
    }
    ledger.joinWarplineVerdict({ cardId: row.cardId, judgeRowHash: row.rowHash, warplineVerdict });
    joined++;
  }

  // ── persist + re-witness the NEW head (the join rows extend the chain) ───────
  ledger.appendPersist(ledgerPath);
  const head = ledger.head();
  if (joined > 0) {
    fs.mkdirSync(path.dirname(witnessPath), { recursive: true });
    fs.writeFileSync(witnessPath, (head ?? '') + '\n', 'utf8');
    const iso = (opts.now ?? ((): string => new Date().toISOString()))();
    fs.appendFileSync(witnessPath + '.log', `${iso} ${head ?? '(none)'}\n`, 'utf8');
  }

  return {
    joined,
    skippedAlreadyJoined,
    skippedControls,
    awaitingWitness,
    awaitingWitnessNote:
      awaitingWitness === 0
        ? ''
        : `${awaitingWitness} verdict row(s) were sealed AFTER the git-witnessed head (chain ordinal ${witness.witnessedOrdinal}) and were NOT joined (§3 A13: a rating only provably predates its answer once git witnesses it). Commit the CURRENT witness file into git, then re-run \`warpline field join\`.`,
    unjoinable,
    witness,
    ledgerHead: head,
    witnessPath,
    witnessCommitReminder: witnessReminder(witnessPath, joined > 0 ? head : null),
  };
}
