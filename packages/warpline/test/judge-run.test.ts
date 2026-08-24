/**
 * judge-run.test — the INSTRUMENT (expo-field-test-protocol.md §5), all with a
 * FAKE deterministic model. NO network. Claims:
 *   - N=3 majority resolves correctly (2-of-3 → the majority label, decisive).
 *   - a 1/1/1 split → INDETERMINATE (noMajority true, indeterminate true).
 *   - raw outputs are captured VERBATIM (§3 verbatim capture).
 *   - run-record.json pins the model (and agents model, temp 0, N=3).
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { envelopeProse } from '../src/envelope.js';
import { RATING_CARD_SCHEMA, type RatingCard } from '../src/judge/rating-card.js';
import { rubricRefForCardKind } from '../src/judge/rubric.js';
import { judgeCard, runJudge, parseLabel, RunRecordMismatchError, type CallModel } from '../src/judge/judge-run.js';
import { PINNED_JUDGE_MODEL, AGENTS_MODEL } from '../src/judge/types.js';

/** A minimal, well-formed KNOT rating card (bodies + framed intents; id is arbitrary). */
function knotCard(id: string, oursBody = 'export const RATE = 100\n', theirsBody = 'export const RATE = 50\n'): RatingCard {
  return {
    schemaVersion: RATING_CARD_SCHEMA,
    cardId: `${RATING_CARD_SCHEMA}:test-${id}`,
    kind: 'knot',
    filePaths: ['src/rate.ts'],
    base: { files: [{ filePath: 'src/rate.ts', body: 'export const RATE = 75\n' }] },
    sides: [
      { role: 'ours', intent: envelopeProse('lower the cap'), files: [{ filePath: 'src/rate.ts', body: oursBody }] },
      { role: 'theirs', intent: envelopeProse('raise the cap'), files: [{ filePath: 'src/rate.ts', body: theirsBody }] },
    ],
    rubricRef: rubricRefForCardKind('knot'),
  };
}

/** A fake model that replays a fixed script of raw outputs, one per call, in order. */
function scriptedModel(script: string[]): CallModel {
  let i = 0;
  return async () => script[i++ % script.length];
}

describe('#judge/judge-run — the instrument, fake model, no network', () => {
  it('parseLabel is specificity-ordered (not-broken never swallowed by broken)', () => {
    expect(parseLabel('GENUINE', 'knot')).toBe('GENUINE');
    expect(parseLabel('OVER-BLOCK\n', 'knot')).toBe('OVER-BLOCK');
    expect(parseLabel('not-broken', 'clean')).toBe('not-broken');
    expect(parseLabel('The answer is broken.', 'clean')).toBe('broken');
    expect(parseLabel('mumble', 'knot')).toBeNull();
  });

  it('N=3 majority resolves correctly (2 GENUINE + 1 OVER-BLOCK → GENUINE, decisive)', async () => {
    const j = await judgeCard(knotCard('maj'), scriptedModel(['GENUINE', 'GENUINE', 'OVER-BLOCK']));
    expect(j.majorityLabel).toBe('GENUINE');
    expect(j.indeterminate).toBe(false);
    expect(j.noMajority).toBe(false);
    expect(j.spread).toEqual({ GENUINE: 2, 'OVER-BLOCK': 1 });
  });

  it('a 1/1/1 split → INDETERMINATE (no 2-of-3 majority)', async () => {
    const j = await judgeCard(knotCard('split'), scriptedModel(['GENUINE', 'OVER-BLOCK', 'INDETERMINATE']));
    expect(j.majorityLabel).toBe('NO-MAJORITY');
    expect(j.noMajority).toBe(true);
    expect(j.indeterminate).toBe(true);
  });

  it('a majority-INDETERMINATE is indeterminate but NOT no-majority (its own bucket, §5)', async () => {
    const j = await judgeCard(knotCard('indet'), scriptedModel(['INDETERMINATE', 'INDETERMINATE', 'GENUINE']));
    expect(j.majorityLabel).toBe('INDETERMINATE');
    expect(j.indeterminate).toBe(true);
    expect(j.noMajority).toBe(false);
  });

  it('captures the raw outputs VERBATIM (never a transcription)', async () => {
    const raw = ['GENUINE // with a trailing note', '  OVER-BLOCK  ', 'GENUINE'];
    const j = await judgeCard(knotCard('verbatim'), scriptedModel(raw));
    expect(j.samples).toEqual(raw); // byte-for-byte, in order
    expect(j.parsedLabels).toEqual(['GENUINE', 'OVER-BLOCK', 'GENUINE']);
    expect(j.majorityLabel).toBe('GENUINE');
  });

  it('runJudge writes run-record.json pinning the model + appends judgments verbatim', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-run-'));
    const cards = [knotCard('a'), knotCard('b')];
    const { runRecord, judgments } = await runJudge({
      cards,
      callModel: scriptedModel(['GENUINE', 'GENUINE', 'GENUINE']),
      outDir,
      now: () => '2026-08-11T00:00:00.000Z',
    });

    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, 'run-record.json'), 'utf8'));
    expect(onDisk.model).toBe(PINNED_JUDGE_MODEL);
    expect(onDisk.model).toBe('claude-opus-4-5-20251101');
    expect(onDisk.agentsModel).toBe(AGENTS_MODEL);
    expect(onDisk.temperature).toBe(0);
    expect(onDisk.samplesPerCard).toBe(3);
    expect(onDisk.cardIds).toEqual(cards.map((c) => c.cardId));
    expect(runRecord.model).toBe('claude-opus-4-5-20251101');

    const lines = fs
      .readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.samples).toEqual(['GENUINE', 'GENUINE', 'GENUINE']);
    expect(first.majorityLabel).toBe('GENUINE');
    expect(judgments).toHaveLength(2);
    expect(onDisk.batches).toEqual([{ createdAt: '2026-08-11T00:00:00.000Z', cardIds: cards.map((c) => c.cardId) }]);

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('runJudge on the same outDir APPENDS judgments and MERGES the run record; a pin mismatch throws (B1)', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-run-batch-'));
    const a = knotCard('a');
    const b = knotCard('b');
    const first = await runJudge({ cards: [a], callModel: scriptedModel(['GENUINE']), outDir, now: () => '2026-08-23T00:00:00.000Z' });
    expect(first.batchIndex).toBe(0);
    const second = await runJudge({ cards: [b, a], callModel: scriptedModel(['OVER-BLOCK']), outDir, now: () => '2026-08-23T01:00:00.000Z' });
    expect(second.batchIndex).toBe(1);

    const lines = fs.readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
    expect(lines.map((l) => JSON.parse(l).cardId)).toEqual([a.cardId, b.cardId, a.cardId]); // appended, not truncated
    const rr = JSON.parse(fs.readFileSync(path.join(outDir, 'run-record.json'), 'utf8'));
    expect(rr.cardIds).toEqual([a.cardId, b.cardId]); // union
    expect(rr.batches).toHaveLength(2);
    expect(rr.createdAt).toBe('2026-08-23T00:00:00.000Z');

    // A different N is a different instrument — refused before anything is written.
    await expect(runJudge({ cards: [b], callModel: scriptedModel(['GENUINE']), outDir, samplesPerCard: 1 })).rejects.toBeInstanceOf(
      RunRecordMismatchError,
    );
    expect(fs.readFileSync(path.join(outDir, 'judgments.jsonl'), 'utf8').split('\n').filter((l) => l.trim())).toHaveLength(3);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
