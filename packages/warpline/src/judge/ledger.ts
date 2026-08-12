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
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe } from '../fabric/strand.js';
import type { LedgerRow, LedgerRowBody } from './types.js';

export const LEDGER_ROW_SCHEMA = 'judgeLedgerRow:v1' as const;

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
  const sealedHashesSoFar = new Set<string>();
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
    sealedHashesSoFar.add(row.rowHash);
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
  sealJudgeVerdict(args: { cardId: string; judgeVerdict: string }): LedgerRow {
    return this.seal({ kind: 'judge-verdict', cardId: args.cardId, judgeVerdict: args.judgeVerdict });
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

  /** Write the ledger as JSONL (one sealed row per line) for durable custody. */
  persist(filePath: string): void {
    fs.writeFileSync(filePath, this.rows.map((r) => JSON.stringify(r)).join('\n') + (this.rows.length ? '\n' : ''), 'utf8');
  }

  /** Load a ledger back from its JSONL file (the rows are re-verified by the caller). */
  static load(filePath: string): JudgeLedger {
    const ledger = new JudgeLedger();
    const text = fs.readFileSync(filePath, 'utf8');
    ledger.rows = text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerRow);
    return ledger;
  }
}
