/**
 * The Classroom — fail-side event writers (TD-2026-06-19-007).
 *
 * Two append-only JSONL channels, both mirroring `appendPromotionDecision`
 * (nomination-engine.ts) including MAX_ENTRIES pruning:
 *
 *   .paradigm/events/field-failures.jsonl
 *     One row per attributed field break. The LEFT∘RIGHT join product:
 *     a `dismissed`/`revised` verdict joined back to the notebook application
 *     receipt (notebook-refs.jsonl) by orchestrationId.
 *
 *   .paradigm/events/classroom-certifications.jsonl
 *     One `outcome: 'pending'` row per gated promotion; the failure loop
 *     LATER-BINDS the matching row to `outcome: 'overturned'`. The later-bound
 *     `outcome` column is the falsifier — a cert means nothing until the field
 *     either survives it or breaks it.
 *
 * All I/O is best-effort: a logging failure must NEVER break the loop.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from './mcp-logger.js';

const EVENTS_DIR = '.paradigm/events';
const FIELD_FAILURES_FILE = 'field-failures.jsonl';
const CLASSROOM_CERTS_FILE = 'classroom-certifications.jsonl';
const MAX_ENTRIES = 500;

// ── Types ────────────────────────────────────────────────────────────

/**
 * The cheapest field signals the MVP reducer can attribute. `'reviewer-reject'`
 * is the `dismissed`/`revised` verdict path; `'human-override'` rides the same
 * verdict log when an override is trivially present. The remaining signals
 * (test-fail, decision-reopened/diverged) are Phase 2.
 */
export type FieldFailureSignal =
  | 'reviewer-reject'
  | 'human-override'
  | 'test-fail'
  | 'decision-reopened'
  | 'decision-diverged';

export interface FieldFailureRow {
  ts: string;
  /** The attribution join key — links this break to a notebook application receipt. */
  orchestrationId: string;
  agent: string;
  signal: FieldFailureSignal;
  severity: 'low' | 'medium' | 'high';
  /** Notebook entry ids the break is attributed to (from the real notebook-refs join). */
  attributedEntryIds: string[];
  symbols: string[];
  detail: string;
  /** Optional scenario this break can seed (Phase 2 scenario bank). */
  scenarioId?: string;
  /** Provenance: which raw event produced this row (e.g. 'verdict:dismissed'). */
  sourceEvent: string;
}

/**
 * A classroom certification row. Written `pending` at promotion; later-bound to
 * `overturned` by the failure loop when an attributed break lands on `entryId`.
 */
export interface ClassroomCertRow {
  ts: string;
  agent: string;
  entryId: string;
  concepts: string[];
  confidenceAtCert: number;
  certifiedBy: 'gate' | 'peer' | 'quorum';
  outcome: 'pending' | 'survived' | 'overturned';
  /** Set when later-bound to `overturned`. */
  overturnedByFailureId?: string;
  /** ISO timestamp of the later-binding. */
  boundAt?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function pruneFile(filePath: string, maxLines: number): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length > maxLines) {
      fs.writeFileSync(filePath, lines.slice(-maxLines).join('\n') + '\n', 'utf8');
    }
  } catch { /* non-fatal */ }
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as T; } catch { return null; } })
      .filter((r): r is T => r !== null);
  } catch {
    return [];
  }
}

// ── field-failures.jsonl ─────────────────────────────────────────────

/**
 * Append one field-failure row. Mirrors `appendPromotionDecision` incl. pruning.
 */
export function appendFieldFailure(rootDir: string, row: FieldFailureRow): void {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, FIELD_FAILURES_FILE);
    fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8');
    pruneFile(filePath, MAX_ENTRIES);
  } catch (err) {
    log.component('#field-failures').warn('failed to record field failure', {
      agent: row.agent,
      orchestrationId: row.orchestrationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Read all field-failure rows (for the doctor metric + tests). */
export function readFieldFailures(rootDir: string): FieldFailureRow[] {
  return readJsonl<FieldFailureRow>(path.join(rootDir, EVENTS_DIR, FIELD_FAILURES_FILE));
}

/**
 * Generate a stable-ish failure id from its join coordinates. Deterministic
 * enough for back-binding without a uuid dependency.
 */
export function makeFailureId(orchestrationId: string, entryId: string): string {
  return `ff-${orchestrationId}-${entryId}`;
}

// ── classroom-certifications.jsonl ───────────────────────────────────

/**
 * Append one classroom-certification row (always `outcome: 'pending'` at write).
 * Mirrors `appendPromotionDecision` incl. pruning.
 */
export function appendClassroomCertification(rootDir: string, row: ClassroomCertRow): void {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, CLASSROOM_CERTS_FILE);
    fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8');
    pruneFile(filePath, MAX_ENTRIES);
  } catch (err) {
    log.component('#classroom-certifications').warn('failed to record certification', {
      agent: row.agent,
      entryId: row.entryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Read all classroom-certification rows. */
export function readClassroomCertifications(rootDir: string): ClassroomCertRow[] {
  return readJsonl<ClassroomCertRow>(path.join(rootDir, EVENTS_DIR, CLASSROOM_CERTS_FILE));
}

/**
 * Later-bind: flip the FIRST matching `pending` cert for `entryId` to
 * `overturned`. Idempotent — a row already `overturned` is left untouched, so
 * the same break never double-binds. Rewrites the file in place.
 *
 * @returns true if a pending row was flipped, false if none matched.
 */
export function overturnCertification(
  rootDir: string,
  entryId: string,
  overturnedByFailureId: string
): boolean {
  try {
    const filePath = path.join(rootDir, EVENTS_DIR, CLASSROOM_CERTS_FILE);
    if (!fs.existsSync(filePath)) return false;
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(l => l.trim());
    let flipped = false;
    const updated = lines.map(line => {
      if (flipped) return line;
      try {
        const row = JSON.parse(line) as ClassroomCertRow;
        if (row.entryId === entryId && row.outcome === 'pending') {
          flipped = true;
          return JSON.stringify({
            ...row,
            outcome: 'overturned',
            overturnedByFailureId,
            boundAt: new Date().toISOString(),
          } satisfies ClassroomCertRow);
        }
        return line;
      } catch {
        return line;
      }
    });
    if (flipped) {
      fs.writeFileSync(filePath, updated.join('\n') + '\n', 'utf8');
    }
    return flipped;
  } catch (err) {
    log.component('#classroom-certifications').warn('failed to overturn certification', {
      entryId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
