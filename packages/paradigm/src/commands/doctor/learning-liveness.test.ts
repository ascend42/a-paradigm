/**
 * Unit tests for the doctor learning-liveness rollup (T-2026-06-13-004).
 *
 * Guards the falsifiable metric: the denominator is a REAL count of postflight
 * completions (never null), and a flatline — 0 journals over ≥ FLATLINE_MIN
 * passes — is detected so a silently-broken loop cannot pass as healthy.
 */

import { describe, it, expect } from 'vitest';
import { summarizeLearningLiveness } from './index.js';

describe('summarizeLearningLiveness', () => {
  it('has a non-null, real denominator equal to the completion count', () => {
    const s = summarizeLearningLiveness([
      { journalsWritten: 0 },
      { journalsWritten: 2 },
      { journalsWritten: 1 },
    ]);
    expect(s.completions).toBe(3);
    expect(s.journalsWritten).toBe(3);
    expect(s.flatline).toBe(false);
  });

  it('flags a flatline: 0 journals over ≥ 5 completions', () => {
    const s = summarizeLearningLiveness(
      Array.from({ length: 6 }, () => ({ journalsWritten: 0 })),
    );
    expect(s.completions).toBe(6);
    expect(s.journalsWritten).toBe(0);
    expect(s.flatline).toBe(true);
  });

  it('does NOT flag a flatline below the minimum-completions floor', () => {
    const s = summarizeLearningLiveness([
      { journalsWritten: 0 },
      { journalsWritten: 0 },
    ]);
    expect(s.flatline).toBe(false); // too few samples to call it dead
  });

  it('a single journaled pass among zeros is NOT a flatline (loop is alive)', () => {
    const s = summarizeLearningLiveness([
      { journalsWritten: 0 },
      { journalsWritten: 0 },
      { journalsWritten: 0 },
      { journalsWritten: 0 },
      { journalsWritten: 1 },
    ]);
    expect(s.flatline).toBe(false);
    expect(s.journalsWritten).toBe(1);
  });

  it('windows to the most recent N records', () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ journalsWritten: i < 25 ? 0 : 5 }));
    const s = summarizeLearningLiveness(records, 20);
    expect(s.completions).toBe(20);
    // last 20 include the five 5-journal tails
    expect(s.journalsWritten).toBe(25);
  });

  it('empty input yields a zero denominator, not null or a throw', () => {
    const s = summarizeLearningLiveness([]);
    expect(s.completions).toBe(0);
    expect(s.flatline).toBe(false);
  });
});

// ── D7 (7.12.0): union of both probe files; no data never green ──
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLearningLivenessRecords } from './index.js';

function fixtureRoot(files: Record<string, string[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liveness-'));
  const ev = path.join(root, '.paradigm', 'events');
  fs.mkdirSync(ev, { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    fs.writeFileSync(path.join(ev, name), rows.join('\n') + '\n');
  }
  return root;
}

describe('learning liveness over both probe files (D7)', () => {
  it('goes RED on 13 settlements × journalsWritten:0 with no postflight file (the blind case)', () => {
    const rows = Array.from({ length: 13 }, (_, i) =>
      JSON.stringify({ ts: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`, chainLive: true, journalsWritten: 0 }));
    const s = summarizeLearningLiveness(readLearningLivenessRecords(fixtureRoot({ 'settlement-liveness.jsonl': rows })));
    expect(s.completions).toBe(13);
    expect(s.level).toBe('red');
    expect(s.flatline).toBe(true);
    expect(s.probeSilent).toBe(true);
  });

  it('no data is "nodata", never green', () => {
    const s = summarizeLearningLiveness(readLearningLivenessRecords(fixtureRoot({})));
    expect(s.level).toBe('nodata');
  });

  it('AMBER when ratio < 0.2 over >= 10 completions', () => {
    const recs = Array.from({ length: 12 }, (_, i) => ({ journalsWritten: i === 0 ? 1 : 0, source: 'postflight' as const }));
    expect(summarizeLearningLiveness(recs).level).toBe('amber');
  });

  it('unions and ts-orders both files; green when journaling healthily', () => {
    const root = fixtureRoot({
      'postflight-liveness.jsonl': [1, 3, 5, 7, 9].map(d => JSON.stringify({ ts: `2026-08-0${d}T00:00:00Z`, journalsWritten: 1 })),
      'settlement-liveness.jsonl': [2, 4].map(d => JSON.stringify({ ts: `2026-08-0${d}T00:00:00Z`, journalsWritten: 1 })),
    });
    const recs = readLearningLivenessRecords(root);
    expect(recs.map(r => r.source)).toEqual(['postflight', 'settlement', 'postflight', 'settlement', 'postflight', 'postflight', 'postflight']);
    const s = summarizeLearningLiveness(recs);
    // Unpairable rows count max(postflight 5, settlement 2), never the sum.
    expect(s.completions).toBe(5);
    expect(s.level).toBe('green');
    expect(s.probeSilent).toBe(false);
  });

  it('one completion writing BOTH a settlement and a postflight row is not counted twice', () => {
    // No shared id (postflight rows carry only sessionId) → max, not sum.
    const both = Array.from({ length: 6 }, (_, i) => [
      { journalsWritten: 1, source: 'postflight' as const },
      { journalsWritten: 1, source: 'settlement' as const, taskId: `T-${i}` },
    ]).flat();
    const s = summarizeLearningLiveness(both);
    expect(s.completions).toBe(6);
    expect(s.journalsWritten).toBe(6);
  });

  it('pairs rows that share a task id across files (one completion, max journals)', () => {
    const s = summarizeLearningLiveness([
      { journalsWritten: 0, source: 'settlement', taskId: 'T-1' },
      { journalsWritten: 2, source: 'postflight', taskId: 'T-1' },
      { journalsWritten: 0, source: 'settlement', taskId: 'T-2' },
      { journalsWritten: 0, source: 'settlement', taskId: 'T-3' },
      { journalsWritten: 1, source: 'postflight' },
    ]);
    // T-1 paired (1, journals 2) + unpaired rest max(pf 1, st 2) → settlement's 2 rows (0 journals)
    expect(s.completions).toBe(3);
    expect(s.journalsWritten).toBe(2);
  });

  it('reads parentTaskId off settlement rows as the pairing key', () => {
    const root = fixtureRoot({
      'settlement-liveness.jsonl': [JSON.stringify({ ts: '2026-08-01T00:00:00Z', parentTaskId: 'T-9', journalsWritten: 0 })],
    });
    expect(readLearningLivenessRecords(root)[0].taskId).toBe('T-9');
  });

  it('orders consistently when only some rows carry ts (untimestamped rows keep their file position)', () => {
    const root = fixtureRoot({
      'postflight-liveness.jsonl': [
        JSON.stringify({ ts: '2026-08-01T00:00:00Z', journalsWritten: 1 }),
        JSON.stringify({ journalsWritten: 2 }), // no ts → sorts with 08-01
        JSON.stringify({ ts: '2026-08-05T00:00:00Z', journalsWritten: 3 }),
      ],
      'settlement-liveness.jsonl': [
        JSON.stringify({ journalsWritten: 9 }), // no ts before any ts → first
        JSON.stringify({ ts: '2026-08-03T00:00:00Z', journalsWritten: 4 }),
      ],
    });
    const recs = readLearningLivenessRecords(root);
    expect(recs.map(r => r.journalsWritten)).toEqual([9, 1, 2, 4, 3]);
    // Deterministic across repeated reads.
    expect(readLearningLivenessRecords(root).map(r => r.journalsWritten)).toEqual([9, 1, 2, 4, 3]);
  });
});
