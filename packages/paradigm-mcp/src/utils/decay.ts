/**
 * The Classroom — the DECAY PASS (TD-2026-06-19-007, Phase 2; gated by
 * TD-2026-07-01-401 / T-2026-11-03-001).
 *
 * THE ONE PRINCIPLE (docs/specs/classroom-falsifiable-loop.md): wall-clock time
 * may DECAY a belief's confidence, but must never MINT evidence. The old pass
 * flipped aged-without-break certs to `survived` on age alone — a dead loop and
 * a healthy one were byte-identical. Now:
 *
 *   1. SURVIVAL SWEEP — for EVERY `pending` cert, whatever its age, ask
 *      surviveCertification, which flips it ONLY if the exercises ledger clears
 *      the floor (>= K_MIN_EXERCISE exercises AND >= MIN_ADVERSARIAL_PROBES
 *      probes) and no attributable break landed at/after the cert. Survival
 *      never waits on the clock. A cert aged past the SURVIVAL WINDOW that did
 *      not survive is counted `unproven` (derived at read time, never written):
 *      the window is only a label, and aging can only make a cert `unproven`.
 *
 *   2. UNUSED DECAY ("silence is signal") — an entry not applied in a long time
 *      (past the IDLE window) AND barely applied to begin with sheds a small,
 *      clamped amount of confidence. NEVER deletes anything.
 *
 * Runs at postflight, right after the field-failure reducer. ALL I/O best-effort:
 * a failure here must never break the session (mirrors the reducer's discipline).
 */

import { log } from './mcp-logger.js';
import { SURVIVAL_WINDOW_DAYS as SHARED_SURVIVAL_WINDOW_DAYS } from '@a-company/premise-core';
import {
  readClassroomCertifications,
  surviveCertification,
} from './field-failures.js';
import {
  listAllAgentNotebookEntries,
  decayUnusedEntry,
} from './notebook-loader.js';

// ── MVP windows / constants ──────────────────────────────────────────
//
// All in DAYS, measured against ISO timestamps already stamped on the data:
//   - cert age:   cert.ts (written at promotion).
//   - entry idle: entry.lastAppliedAt (stamped by incrementApplied on each apply).
//
// MVP-reasonable rationale: a survival window of ~14 days is the spec's own
// suggested default (classroom.md decay constant N). It is long enough that a
// genuinely-broken learning will have produced its `dismissed`/`revised` verdict
// (and thus an overturn) before the window closes, yet short enough that the
// metric gets a real denominator within roughly one sprint. The idle window is
// deliberately LONGER than the survival window so an entry isn't decayed for
// silence before its cert has even had a chance to settle.

/**
 * A pending cert older than this (days) that has not survived reads `unproven`.
 * A label only: survival is offered to every pending cert at every pass.
 * Exported for read-time derivation.
 */
export const SURVIVAL_WINDOW_DAYS = SHARED_SURVIVAL_WINDOW_DAYS;

/** An entry idle (no apply) longer than this (days) is a decay candidate. */
const IDLE_WINDOW_DAYS = 30;

/** "Barely applied" — only entries at/below this appliedCount decay for silence. */
const LOW_APPLIED_THRESHOLD = 2;

/** Small, clamped confidence shed per decay pass for an unused entry. */
const DECAY_DECREMENT = 0.05;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** certsUnproven from the previous pass per root (process lifetime): log the delta, not the count. */
const lastUnprovenByRoot = new Map<string, number>();

/**
 * Ruling 6: the log level of a decay pass's summary. `info` only when the pass
 * did something or the unproven count moved since the previous pass over the
 * same root; `debug` when the only news is the same unproven count again;
 * `none` when there is nothing to say. Pure.
 */
export function decayPassLogLevel(
  result: DecayPassResult,
  prevUnproven: number | undefined,
): 'info' | 'debug' | 'none' {
  const delta = result.certsUnproven - (prevUnproven ?? 0);
  if (result.certsSurvived > 0 || result.entriesDecayed > 0 || delta !== 0) return 'info';
  return result.certsUnproven > 0 ? 'debug' : 'none';
}

export interface DecayPassResult {
  /** Pending certs flipped to `survived` this pass (exercise floor cleared). */
  certsSurvived: number;
  /**
   * Aged pending certs left pending because their exercise evidence misses the
   * floor — `unproven` at read time. Not written; reported so a dead loop is
   * visibly different from a healthy one.
   */
  certsUnproven: number;
  /** Unused entries whose confidence was gently decayed this pass. */
  entriesDecayed: number;
}

export interface DecayPassOptions {
  /** Override the survival window (days). Test seam. */
  survivalWindowDays?: number;
  /** Override the idle window (days). Test seam. */
  idleWindowDays?: number;
  /** Override the appliedCount ceiling for unused-decay eligibility. Test seam. */
  lowAppliedThreshold?: number;
  /** Override the per-pass confidence decrement. Test seam. */
  decayDecrement?: number;
  /** Override "now" (ms). Test seam — lets a fixture age data deterministically. */
  now?: number;
}

/** Age in days between an ISO timestamp and `now`, or null if unparseable. */
function ageInDays(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now - t) / MS_PER_DAY;
}

/**
 * Run the decay pass over a project root.
 *
 * Best-effort: any error is logged and swallowed; the summary reflects only the
 * work that succeeded.
 */
export function runDecayPass(rootDir: string, opts: DecayPassOptions = {}): DecayPassResult {
  const result: DecayPassResult = { certsSurvived: 0, certsUnproven: 0, entriesDecayed: 0 };

  const now = opts.now ?? Date.now();
  const survivalWindow = opts.survivalWindowDays ?? SURVIVAL_WINDOW_DAYS;
  const idleWindow = opts.idleWindowDays ?? IDLE_WINDOW_DAYS;
  const lowApplied = opts.lowAppliedThreshold ?? LOW_APPLIED_THRESHOLD;
  const decrement = opts.decayDecrement ?? DECAY_DECREMENT;

  // ── 1. SURVIVAL SWEEP (exercise-gated) ─────────────────────────────
  try {
    const certs = readClassroomCertifications(rootDir);

    // Every pending cert is offered to surviveCertification, whatever its age:
    // survival is minted by exercise evidence, so it must not WAIT on the clock
    // either (F2). surviveCertification is the gate and owns the break rule (an
    // ATTRIBUTABLE failure at/after the cert's ts blocks; an older break, which
    // already overturned an earlier cert of the same entry, does not), so there
    // is no separate broken-entry pre-filter here (F8). The window only LABELS
    // an aged cert that did not survive as `unproven`.
    //
    // Each DISTINCT entry is offered at most once per pass: surviveCertification
    // considers only the first pending row for an entryId.
    const sweptThisPass = new Set<string>();
    for (const cert of certs) {
      if (cert.outcome !== 'pending') continue;
      if (sweptThisPass.has(cert.entryId)) continue;
      sweptThisPass.add(cert.entryId);

      if (surviveCertification(rootDir, cert.entryId)) {
        result.certsSurvived++;
        continue;
      }
      const age = ageInDays(typeof cert.ts === 'string' ? cert.ts : undefined, now);
      if (age !== null && age >= survivalWindow) result.certsUnproven++;
    }
  } catch (err) {
    log.component('#classroom-decay').warn('survived-flip pass failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 2. UNUSED DECAY ────────────────────────────────────────────────
  try {
    for (const located of listAllAgentNotebookEntries(rootDir)) {
      const { entry } = located;
      const applied = entry.appliedCount ?? 0;
      if (applied > lowApplied) continue; // well-used entries are exempt

      const idle = ageInDays(entry.lastAppliedAt, now);
      // An entry never applied (no lastAppliedAt) is NOT decayed here — silence
      // only counts once it has been used and then gone quiet. Fresh, never-used
      // entries get their chance first.
      if (idle === null || idle < idleWindow) continue;

      if (decayUnusedEntry(located, decrement)) {
        result.entriesDecayed++;
      }
    }
  } catch (err) {
    log.component('#classroom-decay').warn('unused-decay pass failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Ruling 6: the same unproven count every postflight is noise. Log at info
  // only when something happened this pass or the unproven count moved since
  // the previous pass over this root; otherwise debug.
  const prevUnproven = lastUnprovenByRoot.get(rootDir);
  lastUnprovenByRoot.set(rootDir, result.certsUnproven);
  const unprovenDelta = result.certsUnproven - (prevUnproven ?? 0);
  const level = decayPassLogLevel(result, prevUnproven);
  if (level === 'info') {
    log.flow('$classroom-fail-loop').info('decay pass complete', {
      certsSurvived: result.certsSurvived,
      certsUnproven: result.certsUnproven,
      certsUnprovenDelta: unprovenDelta,
      entriesDecayed: result.entriesDecayed,
    });
  } else if (level === 'debug') {
    log.flow('$classroom-fail-loop').debug('decay pass: unproven count unchanged', {
      certsUnproven: result.certsUnproven,
    });
  }

  return result;
}
