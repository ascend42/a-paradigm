/**
 * judge-ledger.test — tamper-evident custody (expo-field-test-protocol.md §3/§4).
 * Claims:
 *   - a tampered row breaks the chain (verify finds the FIRST bad row).
 *   - WRITE-BEFORE-REVEAL: the judge-verdict row is sealed BEFORE the join row, and a
 *     join to an un-sealed verdict is refused at write time and by verify.
 *   - head() emits the current head hash (the external-witness value, §3 A13).
 *   - a judge-verdict row chain-binds the VERBATIM Judgment via judgmentHash (B2): an
 *     edited sample in judgments.jsonl fails verifyJudgmentBinding.
 *   - §4 provenance is sealed INTO the row (write-time-immutable): editing a flag on
 *     disk breaks verify(); planted / seeded / corpus rows are present in the chain but
 *     EXCLUDED from denominatorRows().
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JudgeLedger, verifyChain, judgmentHashOf, verifyJudgmentBinding, excludedFromDenominator } from '../src/judge/ledger.js';
import type { Judgment, LedgerRow, Provenance } from '../src/judge/types.js';

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

const judgment = (over: Partial<Judgment> = {}): Judgment => ({
  cardId: 'card-1',
  cardKind: 'knot',
  rubricHash: 'rubric:v1:x',
  samples: ['GENUINE', 'GENUINE // note', 'OVER-BLOCK'],
  parsedLabels: ['GENUINE', 'GENUINE', 'OVER-BLOCK'],
  spread: { GENUINE: 2, 'OVER-BLOCK': 1 },
  majorityLabel: 'GENUINE',
  indeterminate: false,
  noMajority: false,
  ...over,
});

describe('#judge/ledger — verbatim judgment binding (B2, §3 verbatim / §4 immutable at write time)', () => {
  it('judgmentHashOf is deterministic over the FULL judgment and changes when a sample is edited', () => {
    const j = judgment();
    const h = judgmentHashOf(j);
    expect(h).toMatch(/^judgment:v1:[0-9a-f]{64}$/);
    expect(judgmentHashOf(judgment())).toBe(h);
    // Editing a raw sample — even one that does not change the parsed label — moves the hash.
    expect(judgmentHashOf(judgment({ samples: ['GENUINE', 'GENUINE', 'OVER-BLOCK'] }))).not.toBe(h);
    expect(judgmentHashOf(judgment({ spread: { GENUINE: 3 } }))).not.toBe(h);
  });

  it('a sealed row binds its judgment; an after-the-fact edit of the verbatim sample fails the binding', () => {
    const ledger = new JudgeLedger();
    const j = judgment();
    const row = ledger.sealJudgeVerdict({ cardId: j.cardId, judgeVerdict: j.majorityLabel, judgmentHash: judgmentHashOf(j) });
    expect(row.judgmentHash).toBe(judgmentHashOf(j));
    expect(verifyJudgmentBinding(row, j).ok).toBe(true);
    // Rewrite the plaintext judgments.jsonl row (the raw bytes) — the chain-bound hash catches it.
    const edited = judgment({ samples: ['GENUINE', 'GENUINE', 'GENUINE'], parsedLabels: ['GENUINE', 'GENUINE', 'GENUINE'], spread: { GENUINE: 3 } });
    const r = verifyJudgmentBinding(row, edited);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/verbatim judgment altered after seal/);
    // A different card or a swapped majority is also refused.
    expect(verifyJudgmentBinding(row, judgment({ cardId: 'card-2' })).ok).toBe(false);
    expect(verifyJudgmentBinding(row, judgment({ majorityLabel: 'OVER-BLOCK' })).ok).toBe(false);
    // A row sealed WITHOUT a judgmentHash is an unbound verdict.
    const unbound = ledger.sealJudgeVerdict({ cardId: 'card-9', judgeVerdict: 'GENUINE' });
    expect(verifyJudgmentBinding(unbound, judgment({ cardId: 'card-9' })).detail).toMatch(/unbound/);
  });

  it('the judgmentHash is part of the chained body — editing it on disk breaks verify()', () => {
    const ledger = new JudgeLedger();
    const j = judgment();
    ledger.sealJudgeVerdict({ cardId: j.cardId, judgeVerdict: j.majorityLabel, judgmentHash: judgmentHashOf(j) });
    const rows: LedgerRow[] = ledger.all().map((r) => ({ ...r }));
    rows[0] = { ...rows[0], judgmentHash: judgmentHashOf(judgment({ samples: ['x', 'y', 'z'] })) };
    expect(verifyChain(rows).ok).toBe(false);
    expect(verifyChain(rows).firstBadIndex).toBe(0);
  });
});

describe('#judge/ledger — §4 provenance sealed into the row, excluded from the denominator', () => {
  const real: Provenance = { source: 'oracle-flagged', strandId: 's-1', agents: ['a', 'b'], oracle: { 'behavioral:x': { t1: 'pass', t2: 'fail' } } };
  const planted: Provenance = { source: 'planted-control', planted: true, groundTruth: 'OVER-BLOCK' };
  const seeded: Provenance = { source: 'seeded-control', seededControl: true, groundTruth: 'GENUINE' };
  const corpus: Provenance = { source: 'corpus' };
  const flaggedPlanted: Provenance = { source: 'oracle-flagged', planted: true }; // flag alone excludes

  it('planted / seeded / corpus rows are IN the chain but OUT of denominatorRows()', () => {
    const ledger = new JudgeLedger();
    ledger.sealJudgeVerdict({ cardId: 'real', judgeVerdict: 'GENUINE', provenance: real });
    ledger.sealJudgeVerdict({ cardId: 'planted', judgeVerdict: 'OVER-BLOCK', provenance: planted });
    ledger.sealJudgeVerdict({ cardId: 'seeded', judgeVerdict: 'GENUINE', provenance: seeded });
    ledger.sealJudgeVerdict({ cardId: 'corpus', judgeVerdict: 'GENUINE', provenance: corpus });
    ledger.sealJudgeVerdict({ cardId: 'flagged-planted', judgeVerdict: 'GENUINE', provenance: flaggedPlanted });
    ledger.sealJudgeVerdict({ cardId: 'no-provenance', judgeVerdict: 'GENUINE' });
    expect(ledger.verify().ok).toBe(true);
    expect(ledger.all()).toHaveLength(6);
    expect(ledger.all().map((r) => ledger.excludedFromDenominator(r))).toEqual([false, true, true, true, true, false]);
    expect(ledger.denominatorRows().map((r) => r.cardId)).toEqual(['real', 'no-provenance']);
    expect(excludedFromDenominator(ledger.all()[1])).toBe(true);
  });

  it('provenance survives persist + load and is write-time-immutable: editing a flag on disk breaks verify()', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-ledger-prov-'));
    const file = path.join(dir, 'expo-field-audit.jsonl');
    const ledger = new JudgeLedger();
    ledger.sealJudgeVerdict({ cardId: 'real', judgeVerdict: 'GENUINE', provenance: real });
    ledger.sealJudgeVerdict({ cardId: 'seeded', judgeVerdict: 'GENUINE', provenance: seeded });
    ledger.persist(file);

    const loaded = JudgeLedger.load(file);
    expect(loaded.verify().ok).toBe(true);
    expect(loaded.all()[0].provenance).toEqual(real);
    expect(loaded.denominatorRows().map((r) => r.cardId)).toEqual(['real']);

    // Flip the seed into a "real" card on disk — the classic denominator-padding edit.
    const rows = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerRow);
    rows[1] = { ...rows[1], provenance: { source: 'oracle-flagged' } };
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    const tampered = JudgeLedger.load(file).verify();
    expect(tampered.ok).toBe(false);
    expect(tampered.firstBadIndex).toBe(1);
    expect(tampered.detail).toMatch(/tampered row body/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
