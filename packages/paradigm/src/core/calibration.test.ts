/**
 * Tests for calibration capture (#calibration, v7.1 §2.4 / §L.3).
 *
 * Covers:
 *  - recordEstimateActual appends one JSONL line per call with the right shape
 *    (archetype, taskType, actualTokens, optional parentTaskId, ts).
 *  - the events dir is created on demand.
 *  - the optional estTokens is NOT recorded (learned table is actuals-only).
 *  - capture is best-effort: a write failure returns false and never throws.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { recordEstimateActual, ESTIMATE_ACTUALS_FILE } from './calibration.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function readActuals(r: string): Array<Record<string, unknown>> {
  const p = path.join(r, ESTIMATE_ACTUALS_FILE);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('recordEstimateActual', () => {
  it('appends one line per call and creates the events dir', () => {
    expect(fs.existsSync(path.join(root, ESTIMATE_ACTUALS_FILE))).toBe(false);

    const ok = recordEstimateActual(root, {
      archetype: 'builder',
      taskType: 'feature',
      actualTokens: { input: 1000, output: 2000, total: 3000 },
      parentTaskId: 'T-epic-1',
    });
    expect(ok).toBe(true);

    recordEstimateActual(root, {
      archetype: 'tester',
      taskType: 'bugfix',
      actualTokens: { input: 500, output: 700, total: 1200 },
    });

    const lines = readActuals(root);
    expect(lines).toHaveLength(2);

    expect(lines[0]).toMatchObject({
      archetype: 'builder',
      taskType: 'feature',
      actualTokens: { input: 1000, output: 2000, total: 3000 },
      parentTaskId: 'T-epic-1',
    });
    expect(typeof lines[0].ts).toBe('string');

    // optional parentTaskId omitted when not supplied
    expect(lines[1]).toMatchObject({
      archetype: 'tester',
      taskType: 'bugfix',
      actualTokens: { total: 1200 },
    });
    expect(lines[1].parentTaskId).toBeUndefined();
  });

  it('does NOT record estTokens (actuals-only table)', () => {
    recordEstimateActual(root, {
      archetype: 'architect',
      taskType: 'analysis',
      // @ts-expect-error — estTokens is intentionally not part of the record
      estTokens: { min: 5000, max: 20000 },
      actualTokens: { input: 100, output: 200, total: 300 },
    });
    const [line] = readActuals(root);
    expect(line.estTokens).toBeUndefined();
  });

  it('honors a supplied ts', () => {
    recordEstimateActual(root, {
      archetype: 'builder',
      taskType: 'feature',
      actualTokens: { input: 1, output: 1, total: 2 },
      ts: '2026-06-13T00:00:00.000Z',
    });
    expect(readActuals(root)[0].ts).toBe('2026-06-13T00:00:00.000Z');
  });

  it('is best-effort: a bad rootDir returns false and never throws', () => {
    // A file (not a dir) at the rootDir path makes mkdir/append fail.
    const filePath = path.join(root, 'not-a-dir');
    fs.writeFileSync(filePath, 'x');
    const result = recordEstimateActual(filePath, {
      archetype: 'builder',
      taskType: 'feature',
      actualTokens: { input: 1, output: 1, total: 2 },
    });
    expect(result).toBe(false);
  });
});
