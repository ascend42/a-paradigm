/**
 * judge-regression.test — the case-13 / case-20 anchors from the prior LLM-judge
 * study (.paradigm/research/warpline-llm-judge-falsifier/results.md). These run the
 * REAL pinned judge and are SKIPPED by default; set WARPLINE_JUDGE_LIVE=1 (and have
 * @anthropic-ai/sdk installed + ANTHROPIC_API_KEY set) to exercise them. The
 * deterministic scoring/instrument paths are fully covered by the fake-model suites.
 *
 *   - case-13 (xstate 72058a08): two individually-green sides broken only in
 *     combination — a test literal encodes the old getDescription() format while the
 *     other side changes that output. The merged tree is BROKEN. Reproduce as a §4
 *     CLEAN card the judge should call "broken".
 *   - case-20 (zod 66cbfe09): the ZodRecord Record→Partial<Record> change with
 *     matching test updates — self-contained, composes cleanly. Reproduce as a §5 KNOT
 *     card the judge should call "OVER-BLOCK" (a false KNOT, no human decision needed).
 */

import { describe, it, expect } from 'vitest';
import { envelopeProse } from '../src/envelope.js';
import { RATING_CARD_SCHEMA, type RatingCard } from '../src/judge/rating-card.js';
import { rubricRefForCardKind } from '../src/judge/rubric.js';
import { judgeCard, liveCallModel } from '../src/judge/judge-run.js';

const LIVE = !!process.env.WARPLINE_JUDGE_LIVE;

/** case-13 as a §4 false-CLEAN card: the merged tree contradicts a test's expectation. */
function case13CleanCard(): RatingCard {
  return {
    schemaVersion: RATING_CARD_SCHEMA,
    cardId: `${RATING_CARD_SCHEMA}:regression-case13`,
    kind: 'clean',
    filePaths: ['src/machine.ts', 'test/description.test.ts'],
    parents: [{ stateId: 'parentA' }, { stateId: 'parentB' }],
    sides: [
      {
        role: 'parentA',
        intent: envelopeProse('add a test asserting the old #(machine).a description format'),
        files: [
          { filePath: 'src/machine.ts', body: 'export function getDescription(p) { return `#(machine).${p}` }\n' },
          { filePath: 'test/description.test.ts', body: "expect(getDescription('a')).toBe('#(machine).a')\n" },
        ],
      },
      {
        role: 'parentB',
        intent: envelopeProse('change getDescription to emit the bare-path format'),
        files: [
          { filePath: 'src/machine.ts', body: 'export function getDescription(p) { return p }\n' },
          { filePath: 'test/description.test.ts', body: "expect(getDescription('a')).toBe('#(machine).a')\n" },
        ],
      },
    ],
    mergedBody: [
      { filePath: 'src/machine.ts', body: 'export function getDescription(p) { return p }\n' },
      { filePath: 'test/description.test.ts', body: "expect(getDescription('a')).toBe('#(machine).a')\n" },
    ],
    failingCheck: 'test',
    rubricRef: rubricRefForCardKind('clean'),
  };
}

/** case-20 as a §5 KNOT card: a self-contained Record→Partial<Record> change with tests. */
function case20KnotCard(): RatingCard {
  return {
    schemaVersion: RATING_CARD_SCHEMA,
    cardId: `${RATING_CARD_SCHEMA}:regression-case20`,
    kind: 'knot',
    filePaths: ['src/record.ts'],
    base: { files: [{ filePath: 'src/record.ts', body: 'export type Rec<V> = Record<string, V>\n' }] },
    sides: [
      {
        role: 'ours',
        intent: envelopeProse('make ZodRecord infer Partial<Record> with matching test updates'),
        files: [{ filePath: 'src/record.ts', body: 'export type Rec<V> = Partial<Record<string, V>>\n' }],
      },
      {
        role: 'theirs',
        intent: envelopeProse('unrelated doc comment tidy in the same file'),
        files: [{ filePath: 'src/record.ts', body: 'export type Rec<V> = Record<string, V> // typed record\n' }],
      },
    ],
    rubricRef: rubricRefForCardKind('knot'),
  };
}

describe('#judge — case-13 / case-20 regression (real pinned judge)', () => {
  it.skipIf(!LIVE)('case-13: the merged CLEAN state is called broken', async () => {
    const j = await judgeCard(case13CleanCard(), liveCallModel());
    expect(j.majorityLabel).toBe('broken');
  });

  it.skipIf(!LIVE)('case-20: the self-contained knot is called OVER-BLOCK', async () => {
    const j = await judgeCard(case20KnotCard(), liveCallModel());
    expect(j.majorityLabel).toBe('OVER-BLOCK');
  });
});
