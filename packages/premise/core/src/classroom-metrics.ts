/**
 * #classroom-metrics — the ONE canonical repeat-failure-rate rollup.
 *
 * The Classroom (TD-2026-06-19-007) measures "is the team getting stronger?"
 * by the **repeat-failure-rate**: of the certifications that have RESOLVED
 * (survived | overturned), what fraction were overturned by a later field
 * break. A learning that breaks once and is refined should not break the same
 * way twice — so a falling rate means the loop is working.
 *
 * SOURCE OF TRUTH (the drift fix): this rate was previously computed inline in
 * packages/paradigm-mcp/src/tools/classroom.ts AND was about to be re-derived
 * by `paradigm doctor`. Two independent re-derivations drift. Both the MCP tool
 * and the CLI's `paradigm doctor` depend on `@a-company/premise-core` (the CLI
 * does NOT depend on paradigm-mcp), so the formula lives HERE, once.
 *
 * Reads mirror premise-core's graph-slice / .paradigm file access: tolerant,
 * best-effort, NEVER throws. A missing/corrupt ledger yields an empty array,
 * not an error — the doctor must degrade to a calm "no certifications yet" line.
 *
 * Library code: no console output here. Callers (CLI / MCP) do their own logging.
 *
 * The cert WRITER (appendClassroomCertification / overturnCertification) stays
 * in paradigm-mcp/utils/field-failures.ts — only the READ + ROLLUP is shared.
 */

import * as fs from 'fs';
import * as path from 'path';

// ────────────────────────────────────────────────────────
// Minimal row shapes (only the fields the rollup needs)
// ────────────────────────────────────────────────────────

/** A classroom certification row, narrowed to the fields the rollup reads. */
export interface ClassroomCertRow {
  agent: string;
  entryId: string;
  /** Later-bound by the failure loop; `pending` until the field resolves it. */
  outcome: 'pending' | 'survived' | 'overturned';
  /** Other columns (ts, concepts, …) may exist but are ignored here. */
  [key: string]: unknown;
}

/** A field-failure row, narrowed to the fields the applied/broke view reads. */
export interface FieldFailureRow {
  agent: string;
  /** Notebook entry ids the break is attributed to. */
  attributedEntryIds?: string[];
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────
// Tolerant .paradigm readers (mirror graph-slice's file access)
// ────────────────────────────────────────────────────────

const EVENTS_DIR = path.join('.paradigm', 'events');
const CLASSROOM_CERTS_FILE = 'classroom-certifications.jsonl';
const FIELD_FAILURES_FILE = 'field-failures.jsonl';

/** Best-effort JSONL line-parse: skips unparseable lines, never throws. */
function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as T;
        } catch {
          return null;
        }
      })
      .filter((r): r is T => r !== null);
  } catch {
    return [];
  }
}

/**
 * Read all classroom-certification rows from
 * `.paradigm/events/classroom-certifications.jsonl`. Tolerant — a missing or
 * corrupt ledger yields `[]`.
 */
export function readClassroomCertifications(rootDir: string): ClassroomCertRow[] {
  return readJsonl<ClassroomCertRow>(
    path.join(rootDir, EVENTS_DIR, CLASSROOM_CERTS_FILE),
  );
}

/**
 * Read all field-failure rows from `.paradigm/events/field-failures.jsonl`
 * (the applied/broke view). Tolerant — a missing or corrupt ledger yields `[]`.
 */
export function readFieldFailures(rootDir: string): FieldFailureRow[] {
  return readJsonl<FieldFailureRow>(
    path.join(rootDir, EVENTS_DIR, FIELD_FAILURES_FILE),
  );
}

// ────────────────────────────────────────────────────────
// The canonical formula
// ────────────────────────────────────────────────────────

export interface AgentRepeatFailure {
  /** Certs that have resolved: survived + overturned (pending excluded). */
  resolved: number;
  /** Resolved certs whose outcome is `overturned`. */
  overturned: number;
  /** overturned / resolved, rounded to 3dp; `null` until ≥1 cert resolves. */
  rate: number | null;
}

export interface RepeatFailureRate {
  /** Project-wide rate across all agents' resolved certs. */
  overall: number | null;
  /** Per-agent split, keyed by agent id. */
  perAgent: Record<string, AgentRepeatFailure>;
}

/** rate = overturned / resolved (3dp), or `null` when no cert has resolved. */
function rateOf(resolved: number, overturned: number): number | null {
  return resolved > 0 ? Number((overturned / resolved).toFixed(3)) : null;
}

/**
 * Compute the repeat-failure-rate — the ONE canonical formula.
 *
 * A cert is "resolved" once its `outcome` is `survived` or `overturned`
 * (`pending` certs don't count). The rate is `overturned / resolved`, and it is
 * `null` until at least one cert resolves (you cannot measure a team's
 * strengthening from zero settled exams).
 */
export function computeRepeatFailureRate(certs: ClassroomCertRow[]): RepeatFailureRate {
  let overallResolved = 0;
  let overallOverturned = 0;
  const perAgent: Record<string, AgentRepeatFailure> = {};

  for (const cert of certs) {
    const agent = cert.agent;
    if (!agent) continue;
    const isOverturned = cert.outcome === 'overturned';
    const isResolved = isOverturned || cert.outcome === 'survived';
    if (!isResolved) continue;

    const bucket = perAgent[agent] ?? { resolved: 0, overturned: 0, rate: null };
    bucket.resolved += 1;
    if (isOverturned) bucket.overturned += 1;
    perAgent[agent] = bucket;

    overallResolved += 1;
    if (isOverturned) overallOverturned += 1;
  }

  for (const agent of Object.keys(perAgent)) {
    const b = perAgent[agent];
    b.rate = rateOf(b.resolved, b.overturned);
  }

  return {
    overall: rateOf(overallResolved, overallOverturned),
    perAgent,
  };
}
