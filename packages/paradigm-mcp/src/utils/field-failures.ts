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
import type { ExerciseIntensity } from '@a-company/premise-core';

const EVENTS_DIR = '.paradigm/events';
const FIELD_FAILURES_FILE = 'field-failures.jsonl';
const CLASSROOM_CERTS_FILE = 'classroom-certifications.jsonl';
/**
 * Append-only ledger of exercise events (docs/specs/classroom-falsifiable-loop.md).
 * The rebuild source-of-truth for a cert's `exercise` counters; the survival
 * reducer (sub-phase 1) joins these to certs by `(certEntryId, orchestrationId)`
 * with the same durable-dedupe discipline as the field-failure reducer.
 */
export const EXERCISES_FILE = 'classroom-exercises.jsonl';
const MAX_ENTRIES = 500;

/**
 * Survival gate (docs/specs/classroom-falsifiable-loop.md §1-2, TD-2026-07-01-…).
 * A cert may resolve to `survived` only when it has been exercised at least
 * K_MIN_EXERCISE times AND faced at least MIN_ADVERSARIAL_PROBES deliberate
 * probes (human ruling 2026-07-01: passive apply-and-held alone cannot mint
 * survival). Aging alone never resolves — it renders `unproven`.
 */
export const K_MIN_EXERCISE = 2;
export const MIN_ADVERSARIAL_PROBES = 1;

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
  /** ISO timestamp of the later-binding (overturn). */
  boundAt?: string;
  /**
   * The Classroom decay pass (TD-2026-06-19-007): set when a `pending` cert ages
   * past the survival window WITHOUT any attributed break — the field survived it.
   * This is what makes `resolved` (survived + overturned) a real denominator:
   * without survival flips, resolved == overturned and repeat-failure-rate is a
   * structural 1.0 (a lie).
   *
   * SUPERSEDED by the falsifiable loop (docs/specs/classroom-falsifiable-loop.md):
   * survival must be minted by EXERCISE, not by aging. Sub-phase 1 gates this on
   * `exercise` below; until then the field is retained for back-compat.
   */
  survivedAt?: string;
  /**
   * Exercise evidence accrued by the survival reducer (sub-phase 1). Absent =
   * `unproven` (never exercised). The SAME shape the registry `CalibrationPrior`
   * publishes as a cross-project sum (one contract — TD-2026-06-26-881 amend 1).
   */
  exercise?: ExerciseIntensity;
}

/**
 * One exercise event — a real invocation of a certified claim that held. The
 * append-only row behind `ClassroomCertRow.exercise`; joined to certs by
 * `(certEntryId, orchestrationId)`. `kind` distinguishes natural apply-and-held
 * (E1) from a deliberate adversarial probe (E2/E3) — only the latter can lift a
 * cert to `survived` (K_MIN_EXERCISE + MIN_ADVERSARIAL_PROBES).
 */
export interface ExerciseEvent {
  ts: string;
  /** The cert's notebook entry id this exercise attributes to. */
  certEntryId: string;
  /** The join receipt — an orchestration application, or a scenario-run id. */
  orchestrationId: string;
  agent: string;
  kind: 'application' | 'adversarial-probe' | 'break-attempt';
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

/**
 * Decay-pass later-bind: flip the FIRST matching `pending` cert for `entryId` to
 * `survived` (the field ran the survival window without breaking it). Mirrors
 * {@link overturnCertification}: idempotent (a row already resolved — survived OR
 * overturned — is left untouched, so overturn always wins and re-runs never
 * double-flip), rewrites the file in place.
 *
 * @returns true if a pending row was flipped to survived, false if none matched.
 */
export function surviveCertification(
  rootDir: string,
  entryId: string
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
        // Only a still-pending cert flips. An overturned row stays overturned
        // (overturn wins); an already-survived row is left untouched (idempotent).
        if (row.entryId === entryId && row.outcome === 'pending') {
          flipped = true;
          return JSON.stringify({
            ...row,
            outcome: 'survived',
            survivedAt: new Date().toISOString(),
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
    log.component('#classroom-certifications').warn('failed to survive certification', {
      entryId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
