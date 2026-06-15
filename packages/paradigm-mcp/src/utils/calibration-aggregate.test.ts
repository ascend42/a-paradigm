/**
 * Tests for calibration-aggregate — the MCP-side learned-table rebuild that both
 * `paradigm calibrate` and the settlement chain (aggregate-on-settle, T-011) call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { rebuildLearnedTable, aggregateActuals, MIN_SAMPLES } from './calibration-aggregate.js';

let root: string;
const ACTUALS = (r: string) => path.join(r, '.paradigm', 'events', 'estimate-actuals.jsonl');
const LEARNED = (r: string) => path.join(r, '.paradigm', 'learned', 'token-estimates.json');

function writeActuals(r: string, records: Array<{ archetype: string; taskType: string; total: number }>): void {
  fs.mkdirSync(path.dirname(ACTUALS(r)), { recursive: true });
  const lines = records.map(rec => JSON.stringify({ archetype: rec.archetype, taskType: rec.taskType, actualTokens: { total: rec.total } }));
  fs.writeFileSync(ACTUALS(r), lines.join('\n') + '\n', 'utf8');
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-agg-test-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('rebuildLearnedTable', () => {
  it('returns null and writes nothing when there are no actuals', () => {
    expect(rebuildLearnedTable(root)).toBeNull();
    expect(fs.existsSync(LEARNED(root))).toBe(false);
  });

  it('graduates a cell at the sample floor and writes the learned table to disk', () => {
    // 8 builder×feature samples (the floor) → one learned cell.
    const recs = Array.from({ length: MIN_SAMPLES }, (_, i) => ({ archetype: 'builder', taskType: 'feature', total: 10000 + i * 1000 }));
    writeActuals(root, recs);

    const result = rebuildLearnedTable(root);
    expect(result).not.toBeNull();
    expect(result!.samplesRead).toBe(MIN_SAMPLES);

    // Persisted to disk in the shape loadLearnedTokenTable expects.
    expect(fs.existsSync(LEARNED(root))).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(LEARNED(root), 'utf8'));
    expect(onDisk.builder.feature.n).toBe(MIN_SAMPLES);
    expect(onDisk.builder.feature.min).toBeLessThanOrEqual(onDisk.builder.feature.max);
  });

  it('leaves a below-floor group unlearned (table written, cell absent)', () => {
    writeActuals(root, [
      { archetype: 'tester', taskType: 'bugfix', total: 5000 },
      { archetype: 'tester', taskType: 'bugfix', total: 6000 },
    ]);
    const result = rebuildLearnedTable(root);
    expect(result!.groups.find(g => g.archetype === 'tester')!.learned).toBe(false);
    const onDisk = JSON.parse(fs.readFileSync(LEARNED(root), 'utf8'));
    expect(onDisk.tester).toBeUndefined();
  });

  it('is idempotent — rebuilding twice yields the same table', () => {
    const recs = Array.from({ length: 10 }, (_, i) => ({ archetype: 'architect', taskType: 'design', total: 4000 + i * 500 }));
    writeActuals(root, recs);
    rebuildLearnedTable(root);
    const first = fs.readFileSync(LEARNED(root), 'utf8');
    rebuildLearnedTable(root);
    const second = fs.readFileSync(LEARNED(root), 'utf8');
    expect(second).toBe(first);
  });

  it('aggregateActuals skips malformed lines', () => {
    const { groups } = aggregateActuals(['not json', '', '{"archetype":"x"}', JSON.stringify({ archetype: 'b', taskType: 'feature', actualTokens: { total: 100 } })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].archetype).toBe('b');
  });
});
