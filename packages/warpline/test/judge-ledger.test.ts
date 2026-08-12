/**
 * judge-ledger.test — tamper-evident custody (expo-field-test-protocol.md §3/§4).
 * Claims:
 *   - a tampered row breaks the chain (verify finds the FIRST bad row).
 *   - WRITE-BEFORE-REVEAL: the judge-verdict row is sealed BEFORE the join row, and a
 *     join to an un-sealed verdict is refused at write time and by verify.
 *   - head() emits the current head hash (the external-witness value, §3 A13).
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JudgeLedger, verifyChain } from '../src/judge/ledger.js';
import type { LedgerRow } from '../src/judge/types.js';

describe('#judge/ledger — hash-chained, write-before-reveal custody', () => {
  it('seals a verdict, then joins Warpline AFTER — order + linkage hold, verify ok', () => {
    const ledger = new JudgeLedger();
    const verdictRow = ledger.sealJudgeVerdict({ cardId: 'card-1', judgeVerdict: 'GENUINE' });
    const headAfterSeal = ledger.head();
    const joinRow = ledger.joinWarplineVerdict({
      cardId: 'card-1',
      judgeRowHash: verdictRow.rowHash,
      warplineVerdict: 'knot',
    });

    const rows = ledger.all();
    expect(rows).toHaveLength(2);
    // WRITE-BEFORE-REVEAL ordering: verdict sealed first, join references it, later ordinal.
    expect(rows[0].kind).toBe('judge-verdict');
    expect(rows[1].kind).toBe('warpline-join');
    expect(rows[1].judgeRowHash).toBe(verdictRow.rowHash);
    expect(rows[1].sealedOrdinal).toBeGreaterThan(rows[0].sealedOrdinal);
    expect(rows[1].prevRowHash).toBe(verdictRow.rowHash);
    // head() is the external-witness value.
    expect(headAfterSeal).toBe(verdictRow.rowHash);
    expect(ledger.head()).toBe(joinRow.rowHash);
    expect(ledger.verify().ok).toBe(true);
  });

  it('REFUSES to join a Warpline verdict to an un-sealed judge row (write-before-reveal)', () => {
    const ledger = new JudgeLedger();
    ledger.sealJudgeVerdict({ cardId: 'card-1', judgeVerdict: 'GENUINE' });
    expect(() =>
      ledger.joinWarplineVerdict({
        cardId: 'card-1',
        judgeRowHash: 'judgeLedgerRow:v1:deadbeef', // never sealed
        warplineVerdict: 'knot',
      }),
    ).toThrow(/write-before-reveal/);
  });

  it('a tampered row breaks the chain — verify reports the first bad row', () => {
    const ledger = new JudgeLedger();
    ledger.sealJudgeVerdict({ cardId: 'card-1', judgeVerdict: 'GENUINE' });
    ledger.sealJudgeVerdict({ cardId: 'card-2', judgeVerdict: 'OVER-BLOCK' });
    const v0 = ledger.sealJudgeVerdict({ cardId: 'card-3', judgeVerdict: 'GENUINE' });
    ledger.joinWarplineVerdict({ cardId: 'card-3', judgeRowHash: v0.rowHash, warplineVerdict: 'clean' });
    expect(ledger.verify().ok).toBe(true);

    // Silently rewrite row 1's sealed verdict — the classic answer-swap after the fact.
    const rows: LedgerRow[] = ledger.all().map((r) => ({ ...r }));
    rows[1] = { ...rows[1], judgeVerdict: 'GENUINE' }; // was OVER-BLOCK; rowHash now stale
    const result = verifyChain(rows);
    expect(result.ok).toBe(false);
    expect(result.firstBadIndex).toBe(1);
    expect(result.detail).toMatch(/tampered row body/);
  });

  it('a fabricated join to a hash never sealed earlier is caught by verify', () => {
    const ledger = new JudgeLedger();
    const v = ledger.sealJudgeVerdict({ cardId: 'card-1', judgeVerdict: 'GENUINE' });
    ledger.joinWarplineVerdict({ cardId: 'card-1', judgeRowHash: v.rowHash, warplineVerdict: 'knot' });
    const rows: LedgerRow[] = ledger.all().map((r) => ({ ...r }));
    // Point the join at a hash that is not a sealed judge-verdict, WITHOUT re-hashing:
    // verify recomputes the row body first, so this trips 'tampered row body' at index 1.
    rows[1] = { ...rows[1], judgeRowHash: 'judgeLedgerRow:v1:forged' };
    const result = verifyChain(rows);
    expect(result.ok).toBe(false);
    expect(result.firstBadIndex).toBe(1);
  });

  it('persist + load round-trips and re-verifies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-ledger-'));
    const file = path.join(dir, 'expo-field-audit.jsonl');

    const ledger = new JudgeLedger();
    const v = ledger.sealJudgeVerdict({ cardId: 'card-1', judgeVerdict: 'OVER-BLOCK' });
    ledger.joinWarplineVerdict({ cardId: 'card-1', judgeRowHash: v.rowHash, warplineVerdict: 'clean' });
    ledger.persist(file);

    const loaded = JudgeLedger.load(file);
    expect(loaded.verify().ok).toBe(true);
    expect(loaded.head()).toBe(ledger.head());
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
