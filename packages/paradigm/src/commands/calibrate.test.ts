/**
 * Tests for `paradigm calibrate` aggregation (#calibration, v7.1 §2.4 / §L.3).
 *
 * Covers:
 *  - percentile() linear interpolation (p10/p90).
 *  - aggregateActuals groups by (archetype, taskType), computes p10/p90, and
 *    respects the n>=8 floor — groups under 8 are NOT written to the table.
 *  - malformed / blank JSONL lines are skipped, not fatal.
 *  - records missing archetype/taskType/total are skipped.
 */

import { describe, it, expect } from 'vitest';

import { percentile, aggregateActuals } from './calibrate.js';

/** Build a JSONL line for an actual record. */
function line(archetype: string, taskType: string, total: number): string {
  return JSON.stringify({
    archetype,
    taskType,
    actualTokens: { input: 0, output: 0, total },
  });
}

describe('percentile', () => {
  it('returns 0 for an empty sample', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the single value for n=1', () => {
    expect(percentile([42], 0.1)).toBe(42);
    expect(percentile([42], 0.9)).toBe(42);
  });

  it('interpolates linearly between ranks', () => {
    const vals = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // 11 values, rank = p*10 → exact deciles
    expect(percentile(vals, 0.1)).toBe(10);
    expect(percentile(vals, 0.9)).toBe(90);
    expect(percentile(vals, 0.5)).toBe(50);
  });

  it('sorts internally (input order does not matter)', () => {
    expect(percentile([100, 0, 50], 0.5)).toBe(50);
  });
});

describe('aggregateActuals', () => {
  it('learns a group at the n>=8 floor with p10/p90 band', () => {
    // 10 builder/feature samples: 1000..10000 in 1000 steps.
    const lines: string[] = [];
    for (let i = 1; i <= 10; i++) lines.push(line('builder', 'feature', i * 1000));

    const { table, groups } = aggregateActuals(lines);

    expect(table.builder.feature.n).toBe(10);
    // p10 of [1000..10000] = 1900, p90 = 9100 (linear interp, rounded).
    expect(table.builder.feature.min).toBe(1900);
    expect(table.builder.feature.max).toBe(9100);

    const g = groups.find((x) => x.archetype === 'builder' && x.taskType === 'feature');
    expect(g?.learned).toBe(true);
  });

  it('does NOT write groups below the 8-sample floor', () => {
    const lines: string[] = [];
    for (let i = 0; i < 7; i++) lines.push(line('tester', 'bugfix', 5000));

    const { table, groups } = aggregateActuals(lines);

    expect(table.tester).toBeUndefined();
    const g = groups.find((x) => x.archetype === 'tester' && x.taskType === 'bugfix');
    expect(g?.learned).toBe(false);
    expect(g?.n).toBe(7);
  });

  it('keys by (archetype, taskType) — same archetype, different families are distinct cells', () => {
    const lines: string[] = [];
    for (let i = 0; i < 8; i++) lines.push(line('builder', 'feature', 4000));
    for (let i = 0; i < 8; i++) lines.push(line('builder', 'bugfix', 9000));

    const { table } = aggregateActuals(lines);

    expect(table.builder.feature.min).toBe(4000);
    expect(table.builder.feature.max).toBe(4000);
    expect(table.builder.bugfix.min).toBe(9000);
    expect(table.builder.bugfix.max).toBe(9000);
  });

  it('skips malformed and blank lines', () => {
    const lines = [
      '',
      '   ',
      'not json at all',
      '{ broken',
      ...Array.from({ length: 8 }, () => line('architect', 'analysis', 3000)),
    ];
    const { table } = aggregateActuals(lines);
    expect(table.architect.analysis.n).toBe(8);
  });

  it('skips records missing archetype, taskType, or a numeric total', () => {
    const lines = [
      JSON.stringify({ taskType: 'feature', actualTokens: { total: 1 } }), // no archetype
      JSON.stringify({ archetype: 'builder', actualTokens: { total: 1 } }), // no taskType
      JSON.stringify({ archetype: 'builder', taskType: 'feature', actualTokens: {} }), // no total
      JSON.stringify({ archetype: 'builder', taskType: 'feature' }), // no actualTokens
    ];
    const { table, groups } = aggregateActuals(lines);
    expect(table).toEqual({});
    expect(groups).toEqual([]);
  });
});
