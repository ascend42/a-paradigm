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
import { readLearningRows } from '../../../paradigm-mcp/src/utils/learning-stores.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// Scoped learning: actuals live in the user home (per repo), so read the union.
function readActuals(r: string): Array<Record<string, unknown>> {
  return readLearningRows<Record<string, unknown>>('estimate-actuals', r);
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
    // written to the user home, tagged, and not under the repo
    expect(lines[0].home).toBe('user');
    expect(fs.existsSync(path.join(root, ESTIMATE_ACTUALS_FILE))).toBe(false);

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

  it('is best-effort: an unwritable store returns false and never throws', () => {
    // A file (not a dir) at the learning-home path makes mkdir/append fail.
    const filePath = path.join(os.tmpdir(), `calibration-not-a-dir-${process.pid}`);
    fs.writeFileSync(filePath, 'x');
    const prev = process.env.PARADIGM_LEARNING_HOME;
    process.env.PARADIGM_LEARNING_HOME = filePath;
    try {
      const result = recordEstimateActual(root, {
        archetype: 'builder',
        taskType: 'feature',
        actualTokens: { input: 1, output: 1, total: 2 },
      });
      expect(result).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PARADIGM_LEARNING_HOME;
      else process.env.PARADIGM_LEARNING_HOME = prev;
      fs.rmSync(filePath, { force: true });
    }
  });

  it('refuses a user-home write into the repo (the guard) and returns false', () => {
    const prev = process.env.PARADIGM_LEARNING_HOME;
    process.env.PARADIGM_LEARNING_HOME = path.join(root, 'inside-repo');
    try {
      const result = recordEstimateActual(root, {
        archetype: 'builder',
        taskType: 'feature',
        actualTokens: { input: 1, output: 1, total: 2 },
      });
      expect(result).toBe(false);
      expect(fs.existsSync(path.join(root, 'inside-repo'))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PARADIGM_LEARNING_HOME;
      else process.env.PARADIGM_LEARNING_HOME = prev;
    }
  });
});
