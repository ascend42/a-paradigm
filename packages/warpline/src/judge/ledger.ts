/**
 * #judge/ledger — tamper-evident custody for the run's denominator (expo-field-test-
 * protocol.md §3 LEDGER CUSTODY / §4 RECORDING). The run's entire denominator lives
 * here, so it gets FABRIC-GRADE custody rather than a plain append log:
 *
 *   - CONTENT-ADDRESSED, HASH-CHAINED. rowHash = sha256(canonical(rowBody) +
 *     prevRowHash); every row folds its predecessor, so a silent edit or reorder of
 *     any past row is detectable (the same v2 hash-chain discipline the fabric uses).
 *   - WRITE-BEFORE-REVEAL (§3/§4). The judge's verdict is sealed as its OWN
 *     `judge-verdict` row BEFORE any Warpline verdict is known; the join is a
 *     SEPARATE, LATER `warpline-join` row that references the sealed verdict row's
 *     rowHash. `joinWarplineVerdict` REFUSES to join a verdict that has not already
 *     been sealed — the rating provably predates knowledge of the answer.
 *   - EXTERNAL WITNESS (§3 A13). `head()` emits the current head rowHash for
 *     committing into git at block boundaries — git's independent history is the
 *     external clock the incentivized owner cannot silently rewind.
 *   - verify() walks the chain and reports the FIRST bad row (mirrors the fabric
 *     verify idiom conceptually; it does NOT import fabric internals — a judge-ledger
 *     row is a different, simpler shape).
 *   - MULTI-BATCH CONTINUITY (§3 A13). `persist` is APPEND-ONLY: it writes only the
 *     rows not yet on disk, after checking the on-disk rows are an exact prefix of
 *     memory. It NEVER truncates an existing ledger and REFUSES (LedgerContinuityError)
 *     if the on-disk rows diverge — a second batch chains forward from the first
 *     batch's head, never over it.
 *   - VERBATIM BINDING (§3 verbatim / §4 immutable at write time). A `judge-verdict`
 *     row carries `judgmentHash` = judgment:v1:sha256(canonical(Judgment)) over the FULL
 *     verbatim Judgment, so the plaintext judgments.jsonl is chain-bound: rewrite a
 *     sample there and `verifyJudgmentBinding` catches it.
 *   - §4 RECORDING provenance is sealed INTO the row (write-time-immutable) and
 *     `denominatorRows()` excludes planted / seeded / corpus rows from the denominator.
 *     Provenance never reaches the model prompt — it lives in the ledger only.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe } from '../fabric/strand.js';
import { provenanceExcludedFromDenominator, type Judgment, type LedgerRow, type LedgerRowBody, type Provenance } from './types.js';

export type { Provenance } from './types.js';

export const LEDGER_ROW_SCHEMA = 'judgeLedgerRow:v1' as const;
export const JUDGMENT_HASH_SCHEMA = 'judgment:v1' as const;

/**
 * The on-disk ledger does not chain forward from memory (or its chain is broken):
 * a later batch may only APPEND to an intact prefix. Raised by `persist` /
 * `appendPersist` on divergence, and by the enforcing runner when the loaded ledger
 * fails `verify()` — nothing is sealed over a bad chain.
 */
export class LedgerContinuityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerContinuityError';
  }
}

/**
 * judgmentHash = 'judgment:v1:' + sha256(canonical(Judgment)) over the FULL verbatim
 * Judgment — samples, parsedLabels, spread, majorityLabel, flags. Sealed into the
 * judge-verdict row so the raw model bytes are chain-bound at write time.
 */
export function judgmentHashOf(j: Judgment): string {
  const canon = canonicalSerialize(canonicalSafe(j as unknown));
  return JUDGMENT_HASH_SCHEMA + ':' + createHash('sha256').update(canon, 'utf8').digest('hex');
}

/**
 * Does this sealed `judge-verdict` row bind THIS judgment? True iff the row is a
 * judge-verdict for the same card, its sealed label equals the judgment's majority,
 * and its `judgmentHash` equals the recomputed hash of the verbatim judgment. A
 * plaintext judgments.jsonl row edited after the seal fails here.
 */
export function verifyJudgmentBinding(row: LedgerRow, judgment: Judgment): { ok: boolean; detail?: string } {
  if (row.kind !== 'judge-verdict') return { ok: false, detail: `row ${row.sealedOrdinal} is a ${row.kind}, not a judge-verdict` };
  if (row.cardId !== judgment.cardId) {
    return { ok: false, detail: `row ${row.sealedOrdinal}: cardId ${row.cardId} != judgment cardId ${judgment.cardId}` };
  }
  if (row.judgeVerdict !== judgment.majorityLabel) {
    return { ok: false, detail: `row ${row.sealedOrdinal}: sealed verdict ${row.judgeVerdict} != judgment majority ${judgment.majorityLabel}` };
  }
  if (!row.judgmentHash) return { ok: false, detail: `row ${row.sealedOrdinal}: no judgmentHash sealed (unbound verdict)` };
  const recomputed = judgmentHashOf(judgment);
  if (recomputed !== row.judgmentHash) {
    return { ok: false, detail: `row ${row.sealedOrdinal}: judgmentHash ${row.judgmentHash} != recomputed ${recomputed} (verbatim judgment altered after seal)` };
  }
  return { ok: true };
}

/**
 * True iff a sealed row is EXCLUDED from the denominator: a planted or seeded control,
 * or an injection-corpus card (§5 / A11, §9 A14). Rows with no provenance count.
 */
export function excludedFromDenominator(row: LedgerRow): boolean {
  return provenanceExcludedFromDenominator(row.provenance);
}

/** rowHash = 'judgeLedgerRow:v1:' + sha256(canonical(body) + (prevRowHash ?? '')). */
export function rowHashOf(body: LedgerRowBody): string {
  const canon = canonicalSerialize(canonicalSafe(body as unknown));
  return LEDGER_ROW_SCHEMA + ':' + createHash('sha256').update(canon + (body.prevRowHash ?? ''), 'utf8').digest('hex');
}

/** Split a sealed row back into its body (the exact bytes rowHash was computed over). */
function bodyOf(row: LedgerRow): LedgerRowBody {
  const { rowHash: _omit, ...body } = row;
  return body;
}

export interface LedgerVerifyResult {
  ok: boolean;
  /** the index of the first row that fails the chain, or null if intact. */
  firstBadIndex: number | null;
  detail?: string;
}

/**
 * Walk a chain and report the FIRST bad row: recompute each rowHash, check the
 * prevRowHash link to the preceding row, check the sealedOrdinal sequence, and
 * enforce that every `warpline-join` references an EARLIER `judge-verdict` row (the
 * write-before-reveal ordering, not just the hashes).
 */
export function verifyChain(rows: readonly LedgerRow[]): LedgerVerifyResult {
  const verdictHashes = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expectedPrev = i === 0 ? null : rows[i - 1].rowHash;
    if ((row.prevRowHash ?? null) !== expectedPrev) {
      return {
        ok: false,
        firstBadIndex: i,
        detail: `row ${i}: prevRowHash ${row.prevRowHash ?? '(null)'} != preceding row's rowHash ${expectedPrev ?? '(null)'} (chain break)`,
      };
    }
    const recomputed = rowHashOf(bodyOf(row));
    if (recomputed !== row.rowHash) {
      return {
        ok: false,
        firstBadIndex: i,
        detail: `row ${i}: recomputed ${recomputed} != stored ${row.rowHash} (tampered row body)`,
      };
    }
    if (row.sealedOrdinal !== i) {
      return { ok: false, firstBadIndex: i, detail: `row ${i}: sealedOrdinal ${row.sealedOrdinal} != position ${i}` };
    }
    if (row.kind === 'warpline-join') {
      // Write-before-reveal: the referenced verdict row must ALREADY be sealed
      // earlier in the chain — the answer is joined only after the rating exists.
      if (!row.judgeRowHash || !verdictHashes.has(row.judgeRowHash)) {
        return {
          ok: false,
          firstBadIndex: i,
          detail: `row ${i}: warpline-join references judgeRowHash ${row.judgeRowHash ?? '(none)'} which was not sealed earlier (write-before-reveal violated)`,
        };
      }
    } else if (row.kind === 'judge-verdict') {
      verdictHashes.add(row.rowHash);
    }
  }
  return { ok: true, firstBadIndex: null };
}

/**
 * The run's denominator ledger — an append-only, hash-chained sequence of rows with
 * write-before-reveal ordering. In-memory by default; `persist`/`load` give the
 * JSONL file custody the protocol requires.
 */
export class JudgeLedger {
  private rows: LedgerRow[] = [];

  /** The current head rowHash — commit this into git at each block boundary (§3 A13). */
  head(): string | null {
    return this.rows.length ? this.rows[this.rows.length - 1].rowHash : null;
  }

  /** A read-only snapshot of the sealed rows. */
  all(): readonly LedgerRow[] {
    return this.rows;
  }

  private seal(body: Omit<LedgerRowBody, 'prevRowHash' | 'sealedOrdinal'>): LedgerRow {
    const full: LedgerRowBody = {
      ...body,
      sealedOrdinal: this.rows.length,
      prevRowHash: this.head(),
    };
    const row: LedgerRow = { ...full, rowHash: rowHashOf(full) };
    this.rows.push(row);
    return row;
  }

  /**
   * Seal the blinded judge's verdict as its OWN row, BEFORE any Warpline verdict is
   * joined to it. Returns the sealed row — its `rowHash` is what a later join
   * references. (§4: "the blinded-rater verdict is sealed as its own row".)
   */
  sealJudgeVerdict(args: {
    cardId: string;
    judgeVerdict: string;
    /** chain-bind the verbatim Judgment (see `judgmentHashOf`) — set on every run-path seal. */
    judgmentHash?: string;
    /** the §4 RECORDING fields — sealed write-time-immutable; LEDGER ONLY, never the prompt. */
    provenance?: Provenance;
  }): LedgerRow {
    // Conditional spreads: an `undefined` key would hash differently from its absence
    // after a JSON round-trip (JSON drops undefined keys), breaking verify() on load.
    return this.seal({
      kind: 'judge-verdict',
      cardId: args.cardId,
      judgeVerdict: args.judgeVerdict,
      ...(args.judgmentHash !== undefined ? { judgmentHash: args.judgmentHash } : {}),
      ...(args.provenance !== undefined ? { provenance: args.provenance } : {}),
    });
  }

  /** True iff this sealed row is excluded from the denominator (planted / seeded / corpus). */
  excludedFromDenominator(row: LedgerRow): boolean {
    return excludedFromDenominator(row);
  }

  /** The rows that COUNT: every sealed row minus the planted / seeded / corpus controls. */
  denominatorRows(): LedgerRow[] {
    return this.rows.filter((r) => !excludedFromDenominator(r));
  }

  /**
   * Join Warpline's verdict to an ALREADY-SEALED judge-verdict row. Refuses if that
   * row is not present earlier in the chain — write-before-reveal is enforced at
   * write time, not only at verify time.
   */
  joinWarplineVerdict(args: { cardId: string; judgeRowHash: string; warplineVerdict: string }): LedgerRow {
    const sealed = this.rows.find((r) => r.kind === 'judge-verdict' && r.rowHash === args.judgeRowHash);
    if (!sealed) {
      throw new Error(
        `JudgeLedger.joinWarplineVerdict: judgeRowHash ${args.judgeRowHash} was never sealed — a Warpline verdict may only be joined AFTER the judge verdict it rates (write-before-reveal)`,
      );
    }
    return this.seal({
      kind: 'warpline-join',
      cardId: args.cardId,
      judgeRowHash: args.judgeRowHash,
      warplineVerdict: args.warplineVerdict,
    });
  }

  /** Walk the chain and report the first bad row. */
  verify(): LedgerVerifyResult {
    return verifyChain(this.rows);
  }

  /**
   * APPEND-ONLY durable custody (§3 A13). Writes only the rows not yet on disk, after
   * checking that every on-disk row is byte-identical (by rowHash AND ordinal) to the
   * in-memory row at the same position. NEVER truncates a non-empty ledger whose rows
   * are a prefix of memory; THROWS `LedgerContinuityError` if the on-disk rows diverge
   * from memory or run past it (the file holds rows this ledger never sealed).
   */
  persist(filePath: string): void {
    const onDisk = fs.existsSync(filePath) ? readRows(filePath) : [];
    if (onDisk.length > this.rows.length) {
      throw new LedgerContinuityError(
        `JudgeLedger.persist: ${filePath} holds ${onDisk.length} rows but memory holds ${this.rows.length} — refusing to truncate a ledger (load() it first and append)`,
      );
    }
    for (let i = 0; i < onDisk.length; i++) {
      const disk = onDisk[i];
      const mem = this.rows[i];
      // Do not trust the STORED rowHash — recompute from the disk body, so a row whose
      // body was edited while its recorded rowHash was preserved cannot pass the
      // prefix check and be silently appended over (reviewer finding, 2026-08-23).
      const diskRecomputed = rowHashOf(bodyOf(disk));
      if (diskRecomputed !== disk.rowHash) {
        throw new LedgerContinuityError(
          `JudgeLedger.persist: ${filePath} row ${i} body does not match its stored rowHash (${disk.rowHash}) — tampered on-disk row; refusing to append`,
        );
      }
      if (disk.rowHash !== mem.rowHash || disk.sealedOrdinal !== mem.sealedOrdinal) {
        throw new LedgerContinuityError(
          `JudgeLedger.persist: ${filePath} row ${i} (${disk.rowHash}) diverges from memory row ${i} (${mem.rowHash}) — refusing to overwrite a sealed chain`,
        );
      }
    }
    const fresh = this.rows.slice(onDisk.length);
    if (fresh.length === 0) return;
    fs.appendFileSync(filePath, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }

  /** Explicit alias of the append-only `persist` — reads as what it does at a batch boundary. */
  appendPersist(filePath: string): void {
    this.persist(filePath);
  }

  /** Load a ledger back from its JSONL file (the rows are re-verified by the caller). */
  static load(filePath: string): JudgeLedger {
    const ledger = new JudgeLedger();
    ledger.rows = readRows(filePath);
    return ledger;
  }
}

/** Parse a JSONL ledger file into rows (blank lines skipped; no verification here). */
function readRows(filePath: string): LedgerRow[] {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerRow);
}
