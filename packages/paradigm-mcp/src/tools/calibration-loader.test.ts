/**
 * Tests for the planner's learned-token-table loader (#calibration, v7.1
 * §2.4 / §L.3).
 *
 * The planner (planAgentSequence) reads the learned table FIRST when previewing
 * orchestration cost, falling back to the hardcoded AGENT_TOKEN_ESTIMATES
 * cold-start constant for any cell it hasn't learned. This covers the loader
 * contract:
 *  - missing file → {} (planner falls back to the constant)
 *  - malformed JSON → {} (best-effort, never throws)
 *  - non-object / array JSON → {}
 *  - a well-formed learned table loads its [archetype][taskType] cells
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { loadLearnedTokenTable } from './orchestration.js';

let root: string;

const LEARNED = (r: string) =>
  path.join(r, '.paradigm', 'learned', 'token-estimates.json');

function writeLearned(r: string, content: string): void {
  fs.mkdirSync(path.dirname(LEARNED(r)), { recursive: true });
  fs.writeFileSync(LEARNED(r), content, 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-loader-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('loadLearnedTokenTable', () => {
  it('returns {} when the file is missing (→ constant fallback)', () => {
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('returns {} on malformed JSON without throwing', () => {
    writeLearned(root, '{ this is not json');
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('returns {} when the JSON is an array (wrong shape)', () => {
    writeLearned(root, '[1,2,3]');
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('returns {} when the JSON is null', () => {
    writeLearned(root, 'null');
    expect(loadLearnedTokenTable(root)).toEqual({});
  });

  it('loads a well-formed learned table keyed by [archetype][taskType]', () => {
    writeLearned(
      root,
      JSON.stringify({
        builder: {
          feature: { min: 12000, max: 42000, n: 12 },
          bugfix: { min: 8000, max: 20000, n: 9 },
        },
        architect: {
          analysis: { min: 4000, max: 15000, n: 8 },
        },
      }),
    );

    const table = loadLearnedTokenTable(root);
    expect(table.builder.feature).toEqual({ min: 12000, max: 42000, n: 12 });
    expect(table.builder.bugfix.max).toBe(20000);
    expect(table.architect.analysis.n).toBe(8);
    // A cell the table doesn't have is simply absent → planner uses the constant.
    expect(table.builder.analysis).toBeUndefined();
    expect(table.tester).toBeUndefined();
  });
});
