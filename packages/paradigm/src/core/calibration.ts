/**
 * Calibration capture (#calibration, v7.1 §2.4 / §L.3)
 *
 * The "self-improving" payoff v7.0 deferred. v7.0 shipped `AGENT_TOKEN_ESTIMATES`
 * as a hardcoded constant; v7.1 makes that table learn from what the crew
 * actually spent.
 *
 * This module owns the CAPTURE half of the loop: the CLI orchestrator already
 * has per-agent token actuals (`result.relay.metrics.tokens_used`) right where
 * each stage settles. `recordEstimateActual` appends one JSONL line per
 * agent-step to `.paradigm/events/estimate-actuals.jsonl`. The `paradigm
 * calibrate` command (commands/calibrate.ts) later aggregates those actuals into
 * `.paradigm/learned/token-estimates.json`, which the MCP planner reads
 * learned-first with the constant as a cold-start fallback.
 *
 * ── Best-effort isolation ──
 * Capture must NEVER alter a run. `recordEstimateActual` is fully wrapped: any
 * write failure is logged via the Paradigm logger and swallowed.
 *
 * The estimate is intentionally NOT recorded here — the learned table is computed
 * purely from ACTUALS, so we avoid cross-package coupling to the MCP planner's
 * `AGENT_TOKEN_ESTIMATES` constant. `estTokens` stays a diagnostic the capture
 * path doesn't need.
 */

import * as fs from 'fs';
import * as path from 'path';

import { log } from '../../../paradigm-mcp/src/utils/mcp-logger.js';

/** Storage for captured per-agent token actuals (append-only). */
export const ESTIMATE_ACTUALS_FILE = '.paradigm/events/estimate-actuals.jsonl';

/** Token breakdown for one captured agent-step. */
export interface ActualTokens {
  input: number;
  output: number;
  total: number;
}

/** One captured agent-step actual, persisted as a single JSONL line. */
export interface EstimateActualRecord {
  /** Archetype / agent name that ran (e.g. 'builder'). The owner. */
  archetype: string;
  /** Task classification family (e.g. 'feature', 'bugfix'). Keys the learned table with archetype. */
  taskType: string;
  /** What the agent actually spent. */
  actualTokens: ActualTokens;
  /** Orchestration epic / parent task id, when known (diagnostic). */
  parentTaskId?: string;
  /** ISO timestamp; defaults to capture time when omitted. */
  ts?: string;
}

/**
 * Append one per-agent token-actual record to
 * `.paradigm/events/estimate-actuals.jsonl`.
 *
 * Best-effort: never throws. A capture failure is logged and swallowed so it can
 * never alter the orchestration run.
 *
 * @returns true when the line was written, false when capture degraded.
 */
export function recordEstimateActual(
  rootDir: string,
  record: EstimateActualRecord,
): boolean {
  try {
    const filePath = path.join(rootDir, ESTIMATE_ACTUALS_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const line: EstimateActualRecord = {
      archetype: record.archetype,
      taskType: record.taskType,
      actualTokens: record.actualTokens,
      ...(record.parentTaskId ? { parentTaskId: record.parentTaskId } : {}),
      ts: record.ts || new Date().toISOString(),
    };
    fs.appendFileSync(filePath, JSON.stringify(line) + '\n', 'utf8');
    return true;
  } catch (err) {
    log.component('#calibration').warn('estimate-actual capture failed (non-fatal)', {
      archetype: record.archetype,
      taskType: record.taskType,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
