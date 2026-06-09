/**
 * Iteration Revision Log
 *
 * Durable, auditable channel for agent belief-revisions emitted during an
 * iteration loop (TD-2026-06-09-522, guardrail #3).
 *
 * This is the EXTERNALIZATION step that keeps the learning loop intact: when a
 * round changes a specialist's belief, the revision is written here rather than
 * staying trapped in an ephemeral session. The paradigm-mcp postflight pass
 * (`runPostflightLearning`) reads this file and converts each record into a
 * `self_reflection` journal entry → notebook promotion.
 *
 * IMPORTANT: this is a SEPARATE channel from `verdicts.jsonl`. That channel is
 * human-provenance (user accepted/dismissed/revised a nomination) and feeds
 * agent expertise scoring. Agent self-revision must NOT pollute it — hence its
 * own file, its own record type, and its own `self_reflection` trigger.
 *
 * The JSONL shape here is the cross-package contract. The reader lives in
 * `packages/paradigm-mcp/src/utils/session-work-log.ts`
 * (`readPendingIterationRevisions`). Keep the two in sync.
 *
 * Storage: .paradigm/events/iteration-revisions.jsonl (durable — survives
 * session restart, consumed by postflight).
 */

import * as fs from 'fs';
import * as path from 'path';

const ITERATION_REVISIONS_FILE = '.paradigm/events/iteration-revisions.jsonl';

export interface IterationRevisionRecord {
  /** Unique id — used by postflight to mark the record consumed (dedup). */
  id: string;
  timestamp: string;
  type: 'iteration-revision';
  /** The specialist whose belief changed (e.g. 'builder', 'reviewer'). */
  agent: string;
  /** The belief revisions this round (was-X, now-Y). Non-empty by construction. */
  corrections: string[];
  /** Symbols in scope for this revision (for journal tagging). */
  symbols: string[];
  /** Which round produced the revision. */
  round: number;
}

/**
 * Append a belief-revision record to the durable iteration-revisions log.
 * Non-fatal — failure is silently ignored (the loop must not break on logging).
 */
export function appendIterationRevision(
  rootDir: string,
  record: Omit<IterationRevisionRecord, 'timestamp' | 'type'>,
): void {
  try {
    const filePath = path.join(rootDir, ITERATION_REVISIONS_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entry: IterationRevisionRecord = {
      timestamp: new Date().toISOString(),
      type: 'iteration-revision',
      ...record,
    };

    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Non-fatal — the revision channel is advisory; the loop continues.
  }
}

/** Generate a unique iteration-revision id. */
export function generateRevisionId(agent: string, round: number): string {
  const random = Math.random().toString(36).substring(2, 8);
  return `itrev-${agent}-r${round}-${Date.now()}-${random}`;
}
