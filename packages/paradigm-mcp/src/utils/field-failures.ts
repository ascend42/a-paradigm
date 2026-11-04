/**
 * The Classroom — fail-side event writers (TD-2026-06-19-007).
 *
 * Append-only JSONL channels. The first two mirror `appendPromotionDecision`
 * (nomination-engine.ts) including MAX_ENTRIES pruning; the exercises ledger
 * (classroom-exercises.jsonl) is a source of truth and is never pruned:
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
import {
  K_MIN_EXERCISE,
  MIN_ADVERSARIAL_PROBES,
  meetsSurvivalFloor,
  isEvidencedSurvival,
} from '@a-company/premise-core';
import {
  appendLearningRows,
  effectiveHome,
  readLearningRows,
  rewriteLearningRows,
  type LearningHome,
} from './learning-stores.js';

const EVENTS_DIR = '.paradigm/events';
const FIELD_FAILURES_FILE = 'field-failures.jsonl';
/**
 * Append-only ledger of exercise events (docs/specs/classroom-falsifiable-loop.md).
 * The rebuild source-of-truth for a cert's `exercise` counters; the survival
 * reducer (sub-phase 1) joins these to certs by `(certEntryId, orchestrationId)`
 * with the same durable-dedupe discipline as the field-failure reducer.
 */
export const EXERCISES_FILE = 'classroom-exercises.jsonl';
const MAX_ENTRIES = 500;

/**
 * Survival gate (docs/specs/classroom-falsifiable-loop.md §1-2, TD-2026-07-01-401).
 * A cert may resolve to `survived` only when it has been exercised at least
 * K_MIN_EXERCISE times AND faced at least MIN_ADVERSARIAL_PROBES deliberate
 * probes (human ruling 2026-07-01: passive apply-and-held alone cannot mint
 * survival). Aging alone never resolves — it renders `unproven`.
 *
 * The constants and the floor predicate live in premise-core so the writer here
 * and every reader (MCP tool, CLI doctor) share ONE floor; re-exported here.
 */
export { K_MIN_EXERCISE, MIN_ADVERSARIAL_PROBES, meetsSurvivalFloor, isEvidencedSurvival };

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
  | 'decision-diverged'
  /** T-2026-11-04-002: a human-confirmed scenario run (recordProbeRun) broke the entry. */
  | 'probe-break';

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
  /**
   * Attribution verdict (T-2026-11-03-002). `confounded` = more than one entry
   * was injected for this agent under this orchestration, so the break cannot be
   * pinned on any one of them: the row lists every injected id, but NO entry is
   * revised down and NO cert is overturned. Absent = `attributable` (legacy rows
   * and single-entry injections, which carry exactly one attributed id).
   */
  attribution?: 'attributable' | 'confounded';
  /** Loid L2: on a confounded row, every entry in scope that could have caused the break (across agents). */
  suspects?: string[];
}

/** True when a failure row pins its break on its attributed entries (legacy rows included). */
export function isAttributableFailure(row: Pick<FieldFailureRow, 'attribution'>): boolean {
  return row.attribution !== 'confounded';
}

/**
 * A classroom certification row. Written `pending` at promotion; later-bound to
 * `overturned` by the failure loop when an attributed break lands on `entryId`.
 */
export interface ClassroomCertRow {
  /**
   * Scoped learning: the home of the notebook entry this cert measures (repo for
   * a project notebook, user for a global one). Absent → registry default 'repo'.
   */
  home?: LearningHome;
  ts: string;
  agent: string;
  entryId: string;
  concepts: string[];
  confidenceAtCert: number;
  certifiedBy: 'gate' | 'peer' | 'quorum' | 'human';
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
   * GATED by the falsifiable loop (docs/specs/classroom-falsifiable-loop.md,
   * T-2026-11-03-001): survival is minted by EXERCISE, not by aging —
   * surviveCertification refuses unless the exercises ledger clears the floor,
   * and stamps `exercise` on the row. A legacy `survived` row without `exercise`
   * was minted by the old aging timer and reads as `unproven`.
   */
  survivedAt?: string;
  /**
   * Exercise evidence accrued by the survival reducer (sub-phase 1). Absent =
   * `unproven` (never exercised). The SAME shape the registry `CalibrationPrior`
   * publishes as a cross-project sum (one contract — TD-2026-06-26-881 amend 1).
   */
  exercise?: ExerciseIntensity;
  /**
   * Skills Phase 1: what `entryId` names. Absent = 'notebook' (back-compat).
   * Skill rows use entryId `skill:<id>@<version>`.
   */
  kind?: 'notebook' | 'skill';
  /** Skills Phase 1: the human (founder) who approved the certification at the TTY. */
  approvedBy?: string;
  /** Skills Phase 1: the certified skill's contentHash (`sha256:<hex>`). */
  contentHash?: string;
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
  /**
   * Scoped learning: the home this row was written to (stamped by
   * appendLearningRows; tagged by the reader). Survival counts only events in
   * the cert's own home (T-2026-11-04-002).
   */
  home?: LearningHome;
  /** Probe runs: who ran the probe (never the learner). */
  assessor?: string;
  /** Probe runs: the scenario the probe came from. */
  scenarioId?: string;
  /** Who wrote the row (currentAuthor), for provenance. */
  author?: string;
  /** A confounded exercise cannot be pinned on this entry: it never counts. Absent = attributable. */
  attribution?: 'attributable' | 'confounded';
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
 * Append one field-failure row. Never pruned: it is a source of truth (see below).
 */
export function appendFieldFailure(rootDir: string, row: FieldFailureRow): boolean {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, FIELD_FAILURES_FILE);
    fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8');
    // Loid (re-review): NEVER pruned, like the exercises ledger. surviveCertification's break check, the brokeIn
    // exclusions and the reducer's durable dedupe all read it: a pruned break would stop blocking survival, let its
    // orchestration count as an exercise, and let a still-present verdict record the break again.
    return true;
  } catch (err) {
    log.component('#field-failures').warn('failed to record field failure', {
      agent: row.agent,
      orchestrationId: row.orchestrationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
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

// ── classroom-exercises.jsonl ────────────────────────────────────────

/**
 * Append exercise events to the exercises ledger (same home as the cert they
 * measure). Best-effort. Every row needs a real join receipt: rows without a
 * `certEntryId` or `orchestrationId` are dropped, never written.
 *
 * NOT pruned (F7): this ledger is the source of truth a cert's survival is
 * rebuilt from, so trimming it to MAX_ENTRIES would silently erase the evidence
 * that minted a survival and make the floor unreachable on a busy project.
 *
 * @returns true when at least one row was written.
 */
export function appendExerciseEvents(
  rootDir: string,
  rows: ExerciseEvent[],
  opts: { home?: LearningHome } = {},
): boolean {
  const valid = rows.filter(r => r.certEntryId && r.orchestrationId);
  if (valid.length === 0) return false;
  try {
    appendLearningRows('classroom-exercises', rootDir, valid, { home: opts.home });
    return true;
  } catch (err) {
    log.component('#field-failures').warn('failed to record exercise events', {
      count: valid.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Read all exercise events (union of homes). Never throws. */
export function readExerciseEvents(rootDir: string): ExerciseEvent[] {
  try {
    return readLearningRows<ExerciseEvent>('classroom-exercises', rootDir);
  } catch {
    return [];
  }
}

/**
 * Exercise events as survival reads them (T-2026-11-04-002): the union of homes,
 * each row judged by its PHYSICAL home (the file it sits in, mapped through
 * effectiveHome: a non-git root's repo path holds user data). A row is kept only
 * when its stamped home, if any, is that physical home, and it is tagged with
 * it (never the configured default). So a committed repo file cannot carry a
 * row that claims to be user-home evidence.
 */
export function readHomedExerciseEvents(rootDir: string): ExerciseEvent[] {
  try {
    const out: ExerciseEvent[] = [];
    readLearningRows<ExerciseEvent>('classroom-exercises', rootDir, {
      filter: (row, at) => {
        const physical = effectiveHome(at, rootDir);
        const stamped = row.home === undefined ? physical : effectiveHome(row.home, rootDir);
        if (stamped !== physical) return false;
        out.push({ ...row, home: physical });
        return false; // collected here, with the physical home; the union tags are not used
      },
    });
    return out;
  } catch {
    return [];
  }
}

/**
 * Derive a cert's exercise counters from the exercises ledger — never from the
 * clock. One receipt counts once: events are deduped by
 * `(certEntryId, orchestrationId)`. Only events at or after `sinceIso` (the
 * cert's own timestamp) count, so evidence for an earlier, overturned cert of
 * the same entry is not reused. A receipt whose orchestration also produced a
 * field-failure row naming this entry (attributable OR confounded) did not
 * demonstrably hold, so it is excluded.
 *
 * T-2026-11-04-002: when `home` is given (the cert's home), only events whose
 * home matches count, so a committed repo row cannot mint survival for a
 * user-home cert. Confounded exercise rows never count.
 */
export function exerciseIntensityFor(
  entryId: string,
  exercises: ExerciseEvent[],
  failures: FieldFailureRow[],
  sinceIso?: string,
  home?: LearningHome,
): ExerciseIntensity {
  const since = sinceIso ? Date.parse(sinceIso) : NaN;
  const brokeIn = new Set<string>();
  for (const f of failures) {
    if ((f.attributedEntryIds ?? []).includes(entryId)) brokeIn.add(f.orchestrationId);
  }
  const receipts = new Map<string, { probe: boolean; breakAttempt: boolean; ts?: string }>();
  for (const ev of exercises) {
    if (ev.certEntryId !== entryId || !ev.orchestrationId) continue;
    if (ev.attribution === 'confounded') continue;
    if (home !== undefined && ev.home !== home) continue;
    if (brokeIn.has(ev.orchestrationId)) continue;
    if (!Number.isNaN(since)) {
      const t = Date.parse(ev.ts);
      if (Number.isNaN(t) || t < since) continue;
    }
    const r = receipts.get(ev.orchestrationId) ?? { probe: false, breakAttempt: false };
    if (ev.kind === 'adversarial-probe') r.probe = true;
    if (ev.kind === 'break-attempt') r.breakAttempt = true;
    if (!r.ts || ev.ts > r.ts) r.ts = ev.ts;
    receipts.set(ev.orchestrationId, r);
  }
  const intensity: ExerciseIntensity = { timesExercised: 0, adversarialProbes: 0, breakAttempts: 0 };
  for (const r of receipts.values()) {
    intensity.timesExercised++;
    if (r.probe) intensity.adversarialProbes++;
    if (r.breakAttempt) intensity.breakAttempts++;
    if (r.ts && (!intensity.lastExercisedAt || r.ts > intensity.lastExercisedAt)) intensity.lastExercisedAt = r.ts;
  }
  return intensity;
}

// Read-time evidence state of a cert (no write): the ONE rule lives in
// premise-core so the platform server and the doctor label the same way.
export { certEvidenceState, type CertEvidenceState } from '@a-company/premise-core';

// ── classroom-certifications.jsonl ───────────────────────────────────

/**
 * Append one classroom-certification row (always `outcome: 'pending'` at write).
 * Mirrors `appendPromotionDecision` incl. pruning.
 */
export function appendClassroomCertification(rootDir: string, row: ClassroomCertRow): void {
  try {
    appendLearningRows('classroom-certifications', rootDir, [row], { home: row.home, maxLines: MAX_ENTRIES });
  } catch (err) {
    log.component('#classroom-certifications').warn('failed to record certification', {
      agent: row.agent,
      entryId: row.entryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// certificationsByHome lives in learning-stores.ts (logger-free, so doctor can
// load it without @a-company/paradigm-logger); re-exported here.
export { certificationsByHome, type CertPopulation } from './learning-stores.js';

/** Read all classroom-certification rows (union of homes, each tagged with its home). */
export function readClassroomCertifications(rootDir: string): ClassroomCertRow[] {
  return readLearningRows<ClassroomCertRow>('classroom-certifications', rootDir);
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
    let flipped = false;
    rewriteLearningRows<ClassroomCertRow>('classroom-certifications', rootDir, row => {
      if (flipped || row.entryId !== entryId || row.outcome !== 'pending') return undefined;
      flipped = true;
      return {
        ...row,
        outcome: 'overturned',
        overturnedByFailureId,
        boundAt: new Date().toISOString(),
      } satisfies ClassroomCertRow;
    });
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
 * Later-bind: flip the FIRST matching `pending` cert for `entryId` to `survived`
 * — ONLY when the exercises ledger clears the survival floor (TD-2026-07-01-401,
 * T-2026-11-03-001). The gate lives HERE so every caller is gated: a caller that
 * only knows a cert is old cannot mint survival, because age is never consulted.
 *
 * Refuses (returns false, writes nothing) when:
 *   - the first pending row's exercise counters (from {@link exerciseIntensityFor},
 *     counting only receipts at/after the cert's ts and in the cert's own home)
 *     miss the floor
 *     (>= K_MIN_EXERCISE exercises AND >= MIN_ADVERSARIAL_PROBES probes);
 *   - an ATTRIBUTABLE field failure for `entryId` landed at/after the cert's ts
 *     (the field broke it; overturn wins). Confounded breaks do not block, but
 *     their orchestrations never count as exercises.
 *
 * On a flip the row is stamped with the `exercise` counters that minted it, so
 * readers can tell an evidenced survival from a legacy aged-only one
 * ({@link isEvidencedSurvival}). Idempotent: resolved rows are never touched.
 *
 * @returns true if a pending row was flipped to survived, false otherwise.
 */
export function surviveCertification(
  rootDir: string,
  entryId: string
): boolean {
  try {
    const exercises = readHomedExerciseEvents(rootDir);
    const failures = readFieldFailures(rootDir);
    let considered = false;
    let flipped = false;
    // Only the FIRST still-pending cert for the entry is considered: a later
    // pending row is younger, so it cannot have more qualifying receipts.
    rewriteLearningRows<ClassroomCertRow>('classroom-certifications', rootDir, (row, at) => {
      if (considered || row.entryId !== entryId || row.outcome !== 'pending') return undefined;
      considered = true;
      // The cert's own home: its stamped home, else the file it was read from,
      // mapped the way the writers map it (no repo home here → user).
      const certHome: LearningHome = effectiveHome(row.home ?? at, rootDir);
      const since = typeof row.ts === 'string' ? row.ts : undefined;
      const sinceMs = since ? Date.parse(since) : NaN;
      const broken = failures.some(f =>
        isAttributableFailure(f)
        && (f.attributedEntryIds ?? []).includes(entryId)
        && (Number.isNaN(sinceMs) || Number.isNaN(Date.parse(f.ts)) || Date.parse(f.ts) >= sinceMs));
      if (broken) return undefined;
      const exercise = exerciseIntensityFor(entryId, exercises, failures, since, certHome);
      if (!meetsSurvivalFloor(exercise)) return undefined;
      flipped = true;
      return {
        ...row,
        outcome: 'survived',
        survivedAt: new Date().toISOString(),
        exercise,
      } satisfies ClassroomCertRow;
    });
    if (considered && !flipped) {
      log.component('#classroom-certifications').debug('survival refused: exercise floor not met', { entryId });
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
