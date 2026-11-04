/**
 * #probe-runs — the classroom exercise writer for human-run scenario probes
 * (T-2026-11-04-002 slice 1, designed by Loid).
 *
 * recordProbeRun records ONE scenario run against ONE learning. It always
 * records the outcome on the scenario (when the scenario resolves and targets
 * the learning), and it writes classroom evidence ONLY when the run is a real,
 * human-confirmed, cross-lens probe of a still-pending notebook certification:
 *
 *   held  → an `adversarial-probe` exercise event (plus a `break-attempt` when
 *           the scenario came from a field failure) under orchestrationId
 *           `scn:<scenarioId>`, in the cert's own home; then surviveCertification
 *           (the floor gate decides: two distinct scenarios clear it).
 *   broke → an attributable `probe-break` field-failure row, reviseDown of the
 *           entry, and the cert overturned.
 *
 * Founder rulings (2026-11-04): nothing here runs on its own or spends model
 * tokens; probes run inside a class term the human starts, so a confirmed run
 * with no class term counts nothing. The time stamped on
 * every row is the server clock; a caller-supplied timestamp is never read.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import {
  appendExerciseEvents,
  appendFieldFailure,
  makeFailureId,
  overturnCertification,
  readFieldFailures,
  readHomedExerciseEvents,
  surviveCertification,
  type ClassroomCertRow,
  type ExerciseEvent,
} from './field-failures.js';
import { currentAuthor, effectiveHome, rewriteLearningRows, type LearningHome } from './learning-stores.js';
import { appendScenarioOutcome, isSafeScenarioId, loadScenario, type Scenario } from './scenario-loader.js';
import { loadNotebookEntries, reviseDown } from './notebook-loader.js';

export interface ProbeRunInput {
  scenarioId: string;
  /** The learning the run targets: a NOTEBOOK entry id binds a cert; a journal id (the stand) binds nothing. */
  entryId: string;
  /** Who ran the probe. Must not be the learner. */
  assessor: string;
  result: 'held' | 'broke';
  /** True only after the human confirmed the result. Unconfirmed runs (drills) never count. */
  humanConfirmed: boolean;
  /** The class term the human started. A confirmed run without one (or with 'ad-hoc') counts nothing. */
  term?: string;
  reason?: string;
}

export interface ProbeRunResult {
  scenarioId: string;
  entryId: string;
  /** A pending notebook certification for the entry was found. */
  bound: boolean;
  /** Classroom evidence (an exercise event or a field-failure row) was written. */
  counted: boolean;
  /** Why the run did not count (absent when it did). */
  refusedReason?: string;
  /** The outcome row landed on the scenario. */
  outcomeRecorded: boolean;
  /** The bound cert flipped to survived on this run. */
  survived: boolean;
  /** The bound cert flipped to overturned on this run. */
  overturned: boolean;
  /** The home the evidence is written to (the cert's home, mapped through effectiveHome). */
  certHome?: LearningHome;
  /** Loid F2: a legacy scenario with no authored_by counted, but its author is unknown. */
  authorUnknown?: true;
  /** Loid ruling 2: advisory notes (e.g. the learner drilled this scenario before). */
  notes?: string[];
}

/** Term value that means "no class term". */
const NO_TERM = 'ad-hoc';

/** The orchestration id every probe run of a scenario shares (the receipt key). */
export function scenarioRunId(scenarioId: string): string {
  return `scn:${scenarioId}`;
}

/** Identity comparison for the self-probe guards: trimmed, lowercased. */
function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * The FIRST pending cert for `entryId`, found in the same order that
 * overturnCertification and surviveCertification later-bind it. Read-only.
 */
function firstPendingCert(rootDir: string, entryId: string): (ClassroomCertRow & { home: LearningHome }) | null {
  const hit: { cert?: ClassroomCertRow & { home: LearningHome } } = {};
  rewriteLearningRows<ClassroomCertRow>('classroom-certifications', rootDir, (row, at) => {
    if (hit.cert || row.entryId !== entryId || row.outcome !== 'pending') return undefined;
    hit.cert = { ...row, home: row.home ?? at };
    return undefined;
  }, { dryRun: true });
  return hit.cert ?? null;
}

function entryTrust(agent: string, entryId: string, rootDir: string): string | undefined {
  try {
    return loadNotebookEntries(agent, rootDir).find(e => e.id === entryId)?.provenance?.trust;
  } catch {
    return undefined;
  }
}

/** True when the learner drilled this scenario before (an unconfirmed outcome row of theirs). */
function learnerDrilled(scenario: Scenario, learner: string): boolean {
  return (scenario.outcome_history ?? []).some(o => norm(o.agent) === norm(learner) && o.human_confirmed === false);
}

/** The first guard a bound run fails, or undefined when it may count. */
function refusalFor(
  input: ProbeRunInput,
  scenario: Scenario,
  probeAgent: string,
  cert: ClassroomCertRow,
  nowMs: number,
  rootDir: string,
): string | undefined {
  if (cert.kind === 'skill') return 'skill certification: scenario runs bind notebook certs only';
  const learner = norm(cert.agent);
  if (norm(probeAgent) !== learner) return 'scenario probe targets a different agent than the certification';
  if (norm(input.assessor) === learner) return 'assessor is the learner: a probe must come from another lens';
  if (scenario.authored_by && norm(scenario.authored_by) === learner) return 'scenario authored by the learner: not a probe of it';
  if (entryTrust(cert.agent, input.entryId, rootDir) === 'external') return 'notebook entry is trust external: not certifiable evidence';
  const certMs = Date.parse(cert.ts);
  if (!Number.isNaN(certMs)) {
    if (nowMs < certMs) return 'run is before the certification';
    const prior = scenario.outcome_history ?? [];
    if (prior.some(o => { const t = Date.parse(o.at); return Number.isNaN(t) || t < certMs; })) {
      return 'scenario has an outcome before the certification: it was the certifying exam';
    }
  }
  if (scenario.origin === 'poison-pill' && learnerDrilled(scenario, cert.agent)) {
    return 'poison pill the learner already drilled: not a probe for this learner';
  }
  return undefined;
}

/** Exercise kinds a held run of `scenario` writes. */
function heldKinds(scenario: Scenario): ExerciseEvent['kind'][] {
  return scenario.origin === 'field-failure' ? ['adversarial-probe', 'break-attempt'] : ['adversarial-probe'];
}

/** Kinds still missing for (entry, orchestration) in `home`: the idempotency key is (certEntryId, orchestrationId, kind). */
function missingKinds(rootDir: string, entryId: string, orchestrationId: string, home: LearningHome, kinds: ExerciseEvent['kind'][]): ExerciseEvent['kind'][] {
  const have = new Set(readHomedExerciseEvents(rootDir)
    .filter(ev => ev.certEntryId === entryId && ev.orchestrationId === orchestrationId && ev.home === home)
    .map(ev => ev.kind));
  return kinds.filter(k => !have.has(k));
}

/** A probe-break row for this orchestration naming this entry, at/after the cert ts, already exists. */
function breakAlreadyRecorded(rootDir: string, entryId: string, orchestrationId: string, certTs: string): boolean {
  const since = Date.parse(certTs);
  return readFieldFailures(rootDir).some(f =>
    f.signal === 'probe-break'
    && f.orchestrationId === orchestrationId
    && (f.attributedEntryIds ?? []).includes(entryId)
    && (Number.isNaN(since) || Number.isNaN(Date.parse(f.ts)) || Date.parse(f.ts) >= since));
}

/**
 * Record one scenario run. See the module doc for what counts. Never throws on
 * a refusal; I/O errors on the evidence writers are logged by those writers and
 * reported here as `counted: false`.
 */
export async function recordProbeRun(rootDir: string, input: ProbeRunInput): Promise<ProbeRunResult> {
  const base: ProbeRunResult = {
    scenarioId: input.scenarioId,
    entryId: input.entryId,
    bound: false,
    counted: false,
    outcomeRecorded: false,
    survived: false,
    overturned: false,
  };
  if (!isSafeScenarioId(input.scenarioId)) return { ...base, refusedReason: 'invalid scenario id' };
  const scenario = await loadScenario(rootDir, input.scenarioId);
  if (!scenario || scenario.id !== input.scenarioId) return { ...base, refusedReason: 'scenario not found' };
  if (scenario.status === 'retired') return { ...base, refusedReason: 'scenario is retired' };
  const probe = (scenario.probes ?? []).find(p => p.learning_ref === input.entryId);
  if (!probe) return { ...base, refusedReason: 'scenario has no probe for this entry' };

  const now = new Date();
  const nowIso = now.toISOString();
  const cert = firstPendingCert(rootDir, input.entryId);
  // Judge 3: the home evidence is written to and read from. A cert whose home
  // has no repo home here (non-git root) maps to user, exactly as the writer does.
  const writeHome: LearningHome | undefined = cert ? effectiveHome(cert.home, rootDir) : undefined;
  const orchestrationId = scenarioRunId(scenario.id);
  const term = typeof input.term === 'string' ? input.term.trim() : '';

  let refusedReason: string | undefined;
  if (input.humanConfirmed !== true) refusedReason = 'not human-confirmed: drills never count';
  else if (!term || term === NO_TERM) refusedReason = 'no class term';
  else if (!cert) refusedReason = 'no pending certification for this entry';
  else refusedReason = refusalFor(input, scenario, probe.agent, cert, now.getTime(), rootDir);
  // Loid F4: idempotency is judged BEFORE the outcome row, so that row says so.
  if (!refusedReason && cert && writeHome) {
    if (input.result === 'held'
      && missingKinds(rootDir, input.entryId, orchestrationId, writeHome, heldKinds(scenario)).length === 0) {
      refusedReason = 'already counted';
    } else if (input.result === 'broke' && breakAlreadyRecorded(rootDir, input.entryId, orchestrationId, cert.ts)) {
      refusedReason = 'already counted';
    }
  }

  const notes: string[] = [];
  if (cert && scenario.origin !== 'poison-pill' && learnerDrilled(scenario, cert.agent)) {
    notes.push('the learner drilled this scenario before');
  }
  const authorUnknown = !refusedReason && !scenario.authored_by;

  // The outcome always lands on the scenario (guards were judged on the
  // history BEFORE this row, so a run never disqualifies itself).
  const outcomeRecorded = await appendScenarioOutcome(rootDir, scenario.id, {
    term: term || NO_TERM,
    agent: probe.agent,
    result: input.result === 'held' ? 'survived' : 'broke',
    assessor: input.assessor,
    human_confirmed: input.humanConfirmed === true,
    at: nowIso,
    learning_ref: input.entryId,
    ...(refusedReason ? { refused: refusedReason } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
  // Judge 8: a run whose outcome did not record does not count.
  if (!outcomeRecorded && !refusedReason) refusedReason = 'outcome not recorded on the scenario';

  const result: ProbeRunResult = {
    ...base,
    bound: cert !== null && cert.kind !== 'skill',
    outcomeRecorded,
    ...(writeHome ? { certHome: writeHome } : {}),
    ...(notes.length ? { notes } : {}),
  };
  if (refusedReason || !cert || !writeHome) {
    log.component('#probe-runs').info('scenario run recorded, not counted', {
      scenarioId: scenario.id, entryId: input.entryId, result: input.result, refusedReason,
    });
    return { ...result, refusedReason };
  }
  const counted = (extra: Partial<ProbeRunResult>): ProbeRunResult =>
    ({ ...result, counted: true, ...(authorUnknown ? { authorUnknown: true as const } : {}), ...extra });

  // Everything from here to the writes is synchronous: no other run of this
  // process can interleave between the re-checks and the appends (Judge 1).
  if (input.result === 'held') {
    const kinds = missingKinds(rootDir, input.entryId, orchestrationId, writeHome, heldKinds(scenario));
    if (kinds.length === 0) return { ...result, refusedReason: 'already counted' };
    const author = currentAuthor(rootDir);
    const rows: ExerciseEvent[] = kinds.map(kind => ({
      ts: nowIso,
      certEntryId: input.entryId,
      orchestrationId,
      agent: cert.agent,
      kind,
      home: writeHome,
      author,
      assessor: input.assessor,
      scenarioId: scenario.id,
    }));
    if (!appendExerciseEvents(rootDir, rows, { home: writeHome })) {
      return { ...result, refusedReason: 'exercise event could not be written' };
    }
    const survived = surviveCertification(rootDir, input.entryId);
    log.component('#probe-runs').info('probe held', {
      scenarioId: scenario.id, entryId: input.entryId, kinds, survived,
    });
    return counted({ survived });
  }

  // broke: an attributable field break, revised down and overturned.
  // Judge 1: re-check right before the write, so two racing breaks write one row.
  const still = firstPendingCert(rootDir, input.entryId);
  if (!still || still.ts !== cert.ts || breakAlreadyRecorded(rootDir, input.entryId, orchestrationId, cert.ts)) {
    return { ...result, refusedReason: 'already counted' };
  }
  const failureId = makeFailureId(orchestrationId, input.entryId);
  // Flag b: the field-failures ledger is committed; a user-home learning's
  // prose (the reason, the scenario text) never goes into it.
  const detail = writeHome === 'repo'
    ? (input.reason || scenario.scenario || `scenario ${scenario.id} broke`).slice(0, 200)
    : `scenario ${scenario.id} broke`;
  const wrote = appendFieldFailure(rootDir, {
    ts: nowIso,
    orchestrationId,
    agent: cert.agent,
    signal: 'probe-break',
    severity: 'high',
    attributedEntryIds: [input.entryId],
    symbols: [],
    detail,
    scenarioId: scenario.id,
    sourceEvent: `scenario:${scenario.id}`,
    attribution: 'attributable',
  });
  if (!wrote) return { ...result, refusedReason: 'field failure could not be written' };
  reviseDown(cert.agent, input.entryId, { failureId, signal: 'probe-break', detail, severity: 'high' }, rootDir);
  const overturned = overturnCertification(rootDir, input.entryId, failureId);
  log.component('#probe-runs').info('probe broke the learning', {
    scenarioId: scenario.id, entryId: input.entryId, overturned,
  });
  return counted({ overturned });
}

/**
 * Project config `classroom.reprobe` (.paradigm/config.yaml): `ask` (default)
 * or `off`. The class skill reads it before offering to re-probe pending certs.
 * Unknown or missing values read as `ask`.
 */
export function readReprobeMode(rootDir: string): 'ask' | 'off' {
  try {
    const file = path.join(rootDir, '.paradigm', 'config.yaml');
    if (!fs.existsSync(file)) return 'ask';
    const cfg = yaml.load(fs.readFileSync(file, 'utf8')) as { classroom?: { reprobe?: unknown } } | null;
    return cfg?.classroom?.reprobe === 'off' ? 'off' : 'ask';
  } catch {
    return 'ask';
  }
}
