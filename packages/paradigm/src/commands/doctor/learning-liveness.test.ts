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
