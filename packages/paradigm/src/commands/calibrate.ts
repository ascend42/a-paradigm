/**
 * paradigm calibrate (#calibration, v7.1 §2.4 / §L.3)
 *
 * The aggregation half of the self-improving estimate loop. Reads the captured
 * per-agent actuals (`.paradigm/events/estimate-actuals.jsonl`, written by
 * core/calibration.ts during orchestration), groups them by (archetype,
 * taskType), and — for any group with enough samples — computes a robust
 * min/max band (p10/p90) into `.paradigm/learned/token-estimates.json`.
 *
 * The MCP planner reads that learned table FIRST when previewing orchestration
 * cost, falling back to its hardcoded `AGENT_TOKEN_ESTIMATES` constant (the
 * cold-start prior) for any group it hasn't learned yet. So the estimate the
 * crew is shown is computed from what the crew actually spent.
 *
 * Output uses the CLI cli-output helpers (per CLAUDE.md), not the Paradigm
 * logger (that's for library code).
 */

import * as path from 'path';

import { out, success, kv, dim, header, warn } from '../utils/cli-output.js';
// The aggregation now lives in the MCP package so the settlement chain can call
// it too (aggregate-on-settle, governance T-011). Re-exported here for tests +
// backward compat.
import {
  MIN_SAMPLES,
  aggregateActuals,
  percentile,
  rebuildLearnedTable,
  type LearnedBand,
  type LearnedTokenTable,
} from '../../../paradigm-mcp/src/utils/calibration-aggregate.js';

export { MIN_SAMPLES, aggregateActuals, percentile };
export type { LearnedBand, LearnedTokenTable };

const ACTUALS_FILE = '.paradigm/events/estimate-actuals.jsonl';
const LEARNED_FILE = '.paradigm/learned/token-estimates.json';

/**
 * `paradigm calibrate` — rebuild the learned token-estimate table from captured
 * actuals and report which (archetype, taskType) cells were learned.
 */
export async function calibrateCommand(options: {
  project?: string;
} = {}): Promise<void> {
  const rootDir = options.project ? path.resolve(options.project) : process.cwd();

  // Single write path (shared with aggregate-on-settle): rebuildLearnedTable
  // reads the actuals, aggregates, and writes token-estimates.json. Returns null
  // only when there are no captured actuals yet.
  const result = rebuildLearnedTable(rootDir);
  if (!result) {
    warn(`No captured actuals yet (${ACTUALS_FILE} not found).`);
    dim('Run some orchestrations first — actuals are captured per agent-step.');
    return;
  }
  const { groups, samplesRead, home, otherHomes, legacySamples, coldStartPrior } = result;

  const learned = groups.filter(g => g.learned);
  const pending = groups.filter(g => !g.learned);

  header('Calibration — learned token-estimate table');
  kv('Samples read', String(samplesRead));
  kv('Population', coldStartPrior ? `legacy repo rows (cold-start prior; no ${home}-home samples yet)` : `${home} home`);
  if (!coldStartPrior && legacySamples > 0) dim(`  Legacy repo rows (separate population, not pooled): ${legacySamples}`);
  const others = Object.entries(otherHomes).map(([h, n]) => `${h}: ${n}`);
  if (others.length > 0) dim(`  Not pooled (other homes): ${others.join(', ')}`);
  kv('Groups', String(groups.length));
  kv('Written to', LEARNED_FILE);

  if (learned.length > 0) {
    out('');
    success(`${learned.length} group(s) learned (n >= ${MIN_SAMPLES}):`);
    for (const g of learned) {
      kv(`${g.archetype} · ${g.taskType}`, `${g.band!.min}–${g.band!.max} tokens (n=${g.band!.n})`);
    }
  } else {
    out('');
    warn(`No group reached the ${MIN_SAMPLES}-sample floor — table written empty; planner uses the constant.`);
  }

  if (pending.length > 0) {
    out('');
    dim(`${pending.length} group(s) below floor (n < ${MIN_SAMPLES}) — still using the constant prior:`);
    for (const g of pending) {
      dim(`  ${g.archetype} · ${g.taskType} (n=${g.n})`);
    }
  }
}
