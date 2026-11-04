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

/**
 * ExerciseIntensity — the evidence that a certified claim was actually EXERCISED,
 * not merely aged (docs/specs/classroom-falsifiable-loop.md). Lives here in
 * premise-core because it is the ONE shared contract across the boundary: the
 * paradigm-mcp cert row carries it as local per-cert counters, and the CLI's
 * registry `CalibrationPrior` carries the cross-project SUM of the same shape.
 * The CLI does NOT depend on paradigm-mcp, so this shared home is premise-core.
 *
 * Falsifiability contract: a cert may only resolve to `survived` when these
 * counters clear a floor (≥ K_MIN_EXERCISE exercises AND ≥1 adversarial probe).
 * Wall-clock time may DECAY confidence but must NEVER mint these — every
 * increment carries a real join receipt (an orchestrationId notebook-ref or a
 * scenario-run id).
 */
export interface ExerciseIntensity {
  /** Total real invocations of the claim that held (E1 apply-and-held + E2/E3 probes). */
  timesExercised: number;
  /** Deliberate scenario/poison-pill probes run against the claim that it held. */
  adversarialProbes: number;
  /** Applications under a break-attempt that the claim survived. */
  breakAttempts: number;
  /** ISO timestamp of the most recent exercise. */
  lastExercisedAt?: string;
}

/**
 * Survival floor (docs/specs/classroom-falsifiable-loop.md §1-2, human ruling
 * 2026-07-01, TD-2026-07-01-401). A cert may resolve to `survived` only with at
 * least K_MIN_EXERCISE exercises AND at least MIN_ADVERSARIAL_PROBES deliberate
 * adversarial probes (E2/E3). Passive apply-and-held (E1) accrues evidence but
 * cannot alone mint survival. Defined here (premise-core) so the writer
 * (paradigm-mcp) and every reader (MCP tool, CLI doctor) share ONE floor.
 */
export const K_MIN_EXERCISE = 2;
export const MIN_ADVERSARIAL_PROBES = 1;

/** True when exercise counters clear the survival floor. Tolerant of any input. */
export function meetsSurvivalFloor(exercise: unknown): boolean {
  if (!exercise || typeof exercise !== 'object') return false;
  const e = exercise as Partial<ExerciseIntensity>;
  const times = typeof e.timesExercised === 'number' ? e.timesExercised : 0;
  const probes = typeof e.adversarialProbes === 'number' ? e.adversarialProbes : 0;
  return times >= K_MIN_EXERCISE && probes >= MIN_ADVERSARIAL_PROBES;
}

/**
 * True for a `survived` row whose survival is backed by exercise evidence on the
 * row itself. A `survived` row WITHOUT qualifying `exercise` counters was minted
 * by the pre-gate decay timer (aging alone) and is, honestly, `unproven`. No data
 * migration rewrites those rows; readers tell them apart with this predicate.
 */
export function isEvidencedSurvival(cert: { outcome?: unknown; exercise?: unknown }): boolean {
  return cert.outcome === 'survived' && meetsSurvivalFloor(cert.exercise);
}

/**
 * Days after which a still-pending cert that has not survived reads `unproven`.
 * A LABEL only: survival is offered to every pending cert whatever its age, and
 * aging can never mint it. One constant so the decay pass, the MCP tool, the
 * doctor and the platform server label the same way.
 */
export const SURVIVAL_WINDOW_DAYS = 14;

/**
 * Read-time evidence state of a cert (no write). `unproven` is DERIVED, never
 * stored: a pending cert aged past the survival window without clearing the
 * floor, or a legacy `survived` row the pre-gate aging timer minted without
 * exercise evidence. A clock can age a cert into `unproven`; it can never make
 * one `survived`.
 */
export type CertEvidenceState = 'pending' | 'unproven' | 'survived' | 'overturned';

export function certEvidenceState(
  cert: { outcome?: unknown; ts?: unknown; exercise?: unknown },
  ctx: { now: number; survivalWindowDays?: number },
): CertEvidenceState {
  if (cert.outcome === 'overturned') return 'overturned';
  if (cert.outcome === 'survived') return isEvidencedSurvival(cert) ? 'survived' : 'unproven';
  const t = typeof cert.ts === 'string' ? Date.parse(cert.ts) : NaN;
  if (Number.isNaN(t)) return 'pending';
  const ageDays = (ctx.now - t) / (24 * 60 * 60 * 1000);
  return ageDays >= (ctx.survivalWindowDays ?? SURVIVAL_WINDOW_DAYS) ? 'unproven' : 'pending';
}

/**
 * Ruling 6: the plain-language status when the exercises ledger is empty. Until
 * the exercise writer ships (spec sub-phase 1) no cert can clear the survival
 * floor, so a null repeat-failure-rate means "cannot be measured yet", not
 * "nothing happened". Shared by the MCP tool and the doctor.
 */
export const NO_EXERCISE_WRITER_NOTICE = 'no exercise events recorded yet (spec sub-phase 1): no cert can survive';

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
 * Read all classroom-certification rows from the REPO ledger only,
 * `.paradigm/events/classroom-certifications.jsonl`. Tolerant — a missing or
 * corrupt ledger yields `[]`.
 *
 * @deprecated Scoped learning (TD-2026-10-28-820): certifications also live in
 * the user home. premise-core cannot depend on paradigm-mcp's resolver, so
 * Paradigm callers use paradigm-mcp `field-failures.readClassroomCertifications`
 * (the union of every home) and pass the rows to computeRepeatFailureRate.
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
  /**
   * Certs that aged past the survival window WITHOUT being exercised — the
   * honest floor (docs/specs/classroom-falsifiable-loop.md, TD-2026-06-26-881
   * amendment 4). Distinct from `pending` (young, not yet aged) and from
   * `survived` (aged AND tested-and-held). Optional/forward-compat until the
   * survival reducer populates it (sub-phase 1). "Merely aged" ≠ "survived".
   */
  unproven?: number;
}

export interface RepeatFailureRate {
  /** Project-wide rate across all agents' resolved certs. */
  overall: number | null;
  /**
   * Project-wide count of `survived` rows that lack exercise evidence and were
   * therefore excluded from `resolved`. Present only under `requireExercise`.
   */
  unproven?: number;
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
export interface RepeatFailureRateOptions {
  /**
   * Falsifiability gate (TD-2026-07-01-401): count a `survived` row as resolved
   * only when {@link isEvidencedSurvival} holds. A survived row without exercise
   * evidence (minted by the pre-gate aging timer) is counted as `unproven`
   * instead, per agent and overall. Default false keeps the legacy formula for
   * callers that have not opted in yet.
   */
  requireExercise?: boolean;
}

export function computeRepeatFailureRate(
  certs: ClassroomCertRow[],
  opts: RepeatFailureRateOptions = {},
): RepeatFailureRate {
  let overallResolved = 0;
  let overallOverturned = 0;
  let overallUnproven = 0;
  const perAgent: Record<string, AgentRepeatFailure> = {};
  const unprovenByAgent: Record<string, number> = {};

  for (const cert of certs) {
    const agent = cert.agent;
    if (!agent) continue;
    if (opts.requireExercise && cert.outcome === 'survived' && !isEvidencedSurvival(cert)) {
      unprovenByAgent[agent] = (unprovenByAgent[agent] ?? 0) + 1;
      overallUnproven += 1;
      continue;
    }
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

  if (!opts.requireExercise) {
    return { overall: rateOf(overallResolved, overallOverturned), perAgent };
  }

  for (const agent of Object.keys(unprovenByAgent)) {
    const b = perAgent[agent] ?? { resolved: 0, overturned: 0, rate: null };
    b.unproven = unprovenByAgent[agent];
    perAgent[agent] = b;
  }
  return {
    overall: rateOf(overallResolved, overallOverturned),
    unproven: overallUnproven,
    perAgent,
  };
}
