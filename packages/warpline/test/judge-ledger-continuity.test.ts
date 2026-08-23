/**
 * judge-ledger-continuity.test — MULTI-BATCH continuity of the enforcing run path
 * (expo-field-test-protocol.md §3 A13), FAKE model, no network. Claims:
 *   - two sequential `runJudgeEnforced` calls on the same outDir CHAIN: the second
 *     batch's first row has prevRowHash == the first batch's head; the on-disk ledger
 *     verifies; judgments.jsonl holds rows from BOTH batches; run-record cardIds is the
 *     UNION with a `batches[]` entry per call; `<witness>.log` has one head per batch.
 *   - a CORRUPTED on-disk ledger (a row edited) → the second call throws
 *     LedgerContinuityError and seals NOTHING (no new rows, no new judgments).
 *   - a MISMATCHED run-record (different samplesPerCard) → throws, nothing sampled.
 *   - `JudgeLedger.persist` is APPEND-ONLY: it never truncates a prefix and refuses a
 *     divergent file.
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { envelopeProse } from '../src/envelope.js';
import { RATING_CARD_SCHEMA, type RatingCard } from '../src/judge/rating-card.js';
import { rubricRefForCardKind } from '../src/judge/rubric.js';
import { JudgeLedger, LedgerContinuityError } from '../src/judge/ledger.js';
import { RunRecordMismatchError, type CallModel } from '../src/judge/judge-run.js';
import type { CorpusCard } from '../src/judge/preflight.js';
import { runJudgeEnforced, LEDGER_FILENAME } from '../src/judge/judge-runner.js';
import type { LedgerRow, RunRecord } from '../src/judge/types.js';

function plainCard(id: string): RatingCard {
  return {
    schemaVersion: RATING_CARD_SCHEMA,
    cardId: `${RATING_CARD_SCHEMA}:test-${id}`,
    kind: 'knot',
    filePaths: ['src/y.ts'],
    base: { files: [{ filePath: 'src/y.ts', body: 'export const Y = 1\n' }] },
    sides: [
      { role: 'ours', intent: envelopeProse('bump Y'), files: [{ filePath: 'src/y.ts', body: `export const Y = 2 // ${id}\n` }] },
      { role: 'theirs', intent: envelopeProse('bump Y again'), files: [{ filePath: 'src/y.ts', body: 'export const Y = 3\n' }] },
    ],
    rubricRef: rubricRefForCardKind('knot'),
  };
}

function markedCard(id: string, marker: string): RatingCard {
  return {
    schemaVersion: RATING_CARD_SCHEMA,
    cardId: `${RATING_CARD_SCHEMA}:test-${id}`,
    kind: 'knot',
    filePaths: ['src/x.ts'],
    base: { files: [{ filePath: 'src/x.ts', body: 'export const X = 1\n' }] },
    sides: [
      { role: 'ours', intent: envelopeProse('change X'), files: [{ filePath: 'src/x.ts', body: `export const X = 2\n// ${marker}\n` }] },
      { role: 'theirs', intent: envelopeProse('also change X'), files: [{ filePath: 'src/x.ts', body: 'export const X = 3\n' }] },
    ],
    rubricRef: rubricRefForCardKind('knot'),
  };
}

/** A benign corpus the honest model does not track — gate (b) passes on merit. */
const corpus: CorpusCard[] = [{ card: markedCard('inj', 'STEER:GENUINE'), steeredLabel: 'GENUINE' }];
const honestModel: CallModel = async () => 'OVER-BLOCK';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

describe('#judge/judge-runner — multi-batch ledger continuity (§3 A13)', () => {
  it('a second batch on the same outDir CHAINS forward from the first batch head', async () => {
    const outDir = tmp('judge-continuity-');
    const a = [plainCard('a1'), plainCard('a2')];
    const b = [plainCard('b1'), plainCard('a2')]; // a2 re-rated → cardIds union dedupes it

    const first = await runJudgeEnforced({ cards: a, corpus, callModel: honestModel, outDir, now: () => '2026-08-23T00:00:00.000Z' });
    expect(first.previousHead).toBeNull();
    expect(first.ledgerHead).not.toBeNull();
    expect(first.rawRun?.batchIndex).toBe(0);

    const second = await runJudgeEnforced({ cards: b, corpus, callModel: honestModel, outDir, now: () => '2026-08-23T01:00:00.000Z' });
    // The chain advanced: previousHead is batch 1's head, and the new head differs.
    expect(second.previousHead).toBe(first.ledgerHead);
    expect(second.ledgerHead).not.toBe(first.ledgerHead);
    expect(second.rawRun?.batchIndex).toBe(1);

    // The in-memory ledger is the LOADED first batch + this batch's rows.
    const rows = second.ledger.all();
    expect(rows).toHaveLength(4);
    expect(rows[2].prevRowHash).toBe(first.ledgerHead); // batch 2's first row links to batch 1's head
    expect(rows[2].sealedOrdinal).toBe(2);
    expect(second.ledger.verify().ok).toBe(true);

    // The ON-DISK ledger has all four rows and verifies.
    const onDisk = JudgeLedger.load(path.join(outDir, LEDGER_FILENAME));
    expect(onDisk.all()).toHaveLength(4);
    expect(onDisk.verify().ok).toBe(true);
    expect(onDisk.head()).toBe(second.ledgerHead);

    // judgments.jsonl holds rows from BOTH batches (appended, never truncated).
    const judgments = readJsonl<{ cardId: string }>(path.join(outDir, 'judgments.jsonl'));
    expect(judgments.map((j) => j.cardId)).toEqual([...a, ...b].map((c) => c.cardId));

    // run-record cardIds is the UNION; batches[] has one entry per call.
    const rr = JSON.parse(fs.readFileSync(path.join(outDir, 'run-record.json'), 'utf8')) as RunRecord;
    expect(rr.cardIds).toEqual([a[0].cardId, a[1].cardId, b[0].cardId]);
    expect(rr.batches).toHaveLength(2);
    expect(rr.batches![0]).toEqual({ createdAt: '2026-08-23T00:00:00.000Z', cardIds: a.map((c) => c.cardId) });
    expect(rr.batches![1]).toEqual({ createdAt: '2026-08-23T01:00:00.000Z', cardIds: b.map((c) => c.cardId) });
    expect(rr.createdAt).toBe('2026-08-23T00:00:00.000Z'); // the FIRST batch's date
    expect(rr.schemaVersion).toBe('runRecord:v1');

    // The witness file carries the LATEST head; the witness log carries EVERY batch head.
    expect(fs.readFileSync(second.witnessPath, 'utf8').trim()).toBe(second.ledgerHead);
    expect(fs.readFileSync(second.witnessLogPath, 'utf8')).toBe(
      `2026-08-23T00:00:00.000Z ${first.ledgerHead}\n2026-08-23T01:00:00.000Z ${second.ledgerHead}\n`,
    );
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('a CORRUPTED on-disk ledger → the second call throws LedgerContinuityError and seals NOTHING', async () => {
    const outDir = tmp('judge-continuity-corrupt-');
    await runJudgeEnforced({ cards: [plainCard('a1'), plainCard('a2')], corpus, callModel: honestModel, outDir });

    // Silently rewrite row 0's sealed verdict on disk (the classic after-the-fact swap).
    const ledgerFile = path.join(outDir, LEDGER_FILENAME);
    const rows = readJsonl<LedgerRow>(ledgerFile);
    rows[0] = { ...rows[0], judgeVerdict: 'GENUINE' };
    fs.writeFileSync(ledgerFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    const judgmentsBefore = fs.readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8');

    let calls = 0;
    const counting: CallModel = async () => {
      calls++;
      return 'OVER-BLOCK';
    };
    await expect(runJudgeEnforced({ cards: [plainCard('b1')], corpus, callModel: counting, outDir })).rejects.toBeInstanceOf(
      LedgerContinuityError,
    );
    // Nothing sealed, nothing sampled, nothing appended — the corrupt chain is left as evidence.
    expect(calls).toBe(0);
    expect(readJsonl<LedgerRow>(ledgerFile)).toHaveLength(2);
    expect(fs.readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8')).toBe(judgmentsBefore);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('a MISMATCHED run-record (different samplesPerCard) → throws, nothing sampled or sealed', async () => {
    const outDir = tmp('judge-continuity-mismatch-');
    const first = await runJudgeEnforced({ cards: [plainCard('a1')], corpus, callModel: honestModel, outDir, samplesPerCard: 3 });
    const ledgerFile = path.join(outDir, LEDGER_FILENAME);
    const judgmentsBefore = fs.readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8');

    await expect(
      runJudgeEnforced({ cards: [plainCard('b1')], corpus, callModel: honestModel, outDir, samplesPerCard: 5 }),
    ).rejects.toBeInstanceOf(RunRecordMismatchError);

    // The pinned record is untouched; the ledger did not advance; judgments.jsonl unchanged.
    const rr = JSON.parse(fs.readFileSync(path.join(outDir, 'run-record.json'), 'utf8')) as RunRecord;
    expect(rr.samplesPerCard).toBe(3);
    expect(rr.batches).toHaveLength(1);
    expect(JudgeLedger.load(ledgerFile).head()).toBe(first.ledgerHead);
    expect(fs.readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8')).toBe(judgmentsBefore);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});

describe('#judge/ledger — persist is APPEND-ONLY', () => {
  it('appends only the rows not yet on disk; a prefix is never truncated', () => {
    const dir = tmp('judge-ledger-append-');
    const file = path.join(dir, 'expo-field-audit.jsonl');
    const ledger = new JudgeLedger();
    ledger.sealJudgeVerdict({ cardId: 'c1', judgeVerdict: 'GENUINE' });
    ledger.persist(file);
    const afterFirst = fs.readFileSync(file, 'utf8');

    ledger.sealJudgeVerdict({ cardId: 'c2', judgeVerdict: 'OVER-BLOCK' });
    ledger.appendPersist(file);
    const afterSecond = fs.readFileSync(file, 'utf8');
    expect(afterSecond.startsWith(afterFirst)).toBe(true); // the first row's bytes are untouched
    expect(JudgeLedger.load(file).all()).toHaveLength(2);
    expect(JudgeLedger.load(file).verify().ok).toBe(true);

    // Persisting again with nothing new is a no-op.
    ledger.persist(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(afterSecond);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('REFUSES to append when a disk row body was edited but its stored rowHash preserved', () => {
    const dir = tmp('judge-ledger-tamper-');
    const file = path.join(dir, 'expo-field-audit.jsonl');
    const ledger = new JudgeLedger();
    ledger.sealJudgeVerdict({ cardId: 'c1', judgeVerdict: 'GENUINE' });
    ledger.persist(file);

    // Tamper: flip the verdict IN THE BODY but keep the recorded rowHash bytes —
    // the stored-hash prefix check alone would accept this row.
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    rows[0].judgeVerdict = 'OVER-BLOCK'; // body edited, rowHash untouched
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    ledger.sealJudgeVerdict({ cardId: 'c2', judgeVerdict: 'GENUINE' });
    expect(() => ledger.persist(file)).toThrow(/does not match its stored rowHash/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('REFUSES to persist over a divergent on-disk chain, and over a longer one', () => {
    const dir = tmp('judge-ledger-diverge-');
    const file = path.join(dir, 'expo-field-audit.jsonl');
    const onDisk = new JudgeLedger();
    onDisk.sealJudgeVerdict({ cardId: 'c1', judgeVerdict: 'GENUINE' });
    onDisk.sealJudgeVerdict({ cardId: 'c2', judgeVerdict: 'GENUINE' });
    onDisk.persist(file);

    // A fresh in-memory ledger that did NOT load the file — its row 0 differs.
    const divergent = new JudgeLedger();
    divergent.sealJudgeVerdict({ cardId: 'c1', judgeVerdict: 'OVER-BLOCK' });
    divergent.sealJudgeVerdict({ cardId: 'c2', judgeVerdict: 'GENUINE' });
    divergent.sealJudgeVerdict({ cardId: 'c3', judgeVerdict: 'GENUINE' });
    expect(() => divergent.persist(file)).toThrow(LedgerContinuityError);

    // A shorter in-memory ledger (the file holds rows it never sealed) is refused too — never truncate.
    const shorter = new JudgeLedger();
    shorter.sealJudgeVerdict({ cardId: 'c1', judgeVerdict: 'GENUINE' });
    expect(() => shorter.persist(file)).toThrow(/refusing to truncate/);

    // The file is byte-for-byte what the first ledger wrote.
    expect(JudgeLedger.load(file).head()).toBe(onDisk.head());
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
