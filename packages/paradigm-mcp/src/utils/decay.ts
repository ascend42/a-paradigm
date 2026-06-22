/**
 * The Classroom — the DECAY PASS (TD-2026-06-19-007, Phase 2).
 *
 * This pass is LOAD-BEARING FOR THE METRIC, not cosmetic cleanup. Until decay
 * runs, NOTHING ever flips a certification to `survived`: the reducer only ever
 * back-binds breaks to `overturned`. So `resolved` (= survived + overturned)
 * equals `overturned`, and repeat-failure-rate is structurally stuck at 1.0
 * (or null) — a LIE that says every certified learning eventually breaks. The
 * decay pass makes the denominator REAL by flipping aged-without-break certs to
 * `survived`. (See classroom-metrics.ts `computeRepeatFailureRate`.)
 *
 * It does two things, both conservative and idempotent:
 *
 *   1. SURVIVED FLIP — a `pending` cert whose entry has aged past the SURVIVAL
 *      WINDOW without any attributed field-failure overturning it flips to
 *      `survived`. (An overturned cert is never touched — overturn wins.)
 *
 *   2. UNUSED DECAY ("silence is signal") — an entry not applied in a long time
 *      (past the IDLE window) AND barely applied to begin with sheds a small,
 *      clamped amount of confidence. NEVER deletes anything.
 *
 * Runs at postflight, right after the field-failure reducer. ALL I/O best-effort:
 * a failure here must never break the session (mirrors the reducer's discipline).
 */

import { log } from './mcp-logger.js';
import {
  readClassroomCertifications,
  readFieldFailures,
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

/** A pending cert older than this (days) with no break → flips to `survived`. */
const SURVIVAL_WINDOW_DAYS = 14;

/** An entry idle (no apply) longer than this (days) is a decay candidate. */
const IDLE_WINDOW_DAYS = 30;

/** "Barely applied" — only entries at/below this appliedCount decay for silence. */
const LOW_APPLIED_THRESHOLD = 2;

/** Small, clamped confidence shed per decay pass for an unused entry. */
const DECAY_DECREMENT = 0.05;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DecayPassResult {
  /** Pending certs flipped to `survived` this pass. */
  certsSurvived: number;
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
  const result: DecayPassResult = { certsSurvived: 0, entriesDecayed: 0 };

  const now = opts.now ?? Date.now();
  const survivalWindow = opts.survivalWindowDays ?? SURVIVAL_WINDOW_DAYS;
  const idleWindow = opts.idleWindowDays ?? IDLE_WINDOW_DAYS;
  const lowApplied = opts.lowAppliedThreshold ?? LOW_APPLIED_THRESHOLD;
  const decrement = opts.decayDecrement ?? DECAY_DECREMENT;

  // ── 1. SURVIVED FLIP ───────────────────────────────────────────────
  try {
    const certs = readClassroomCertifications(rootDir);
    const failures = readFieldFailures(rootDir);

    // The set of entryIds that an attributed break ever landed on. A pending cert
    // for such an entry must NOT be flipped to survived — even if its own row is
    // still pending, the field DID break it (overturn would normally win; this is
    // belt-and-suspenders so a flip never contradicts the failure ledger).
    const brokenEntryIds = new Set<string>();
    for (const f of failures) {
      for (const id of f.attributedEntryIds ?? []) brokenEntryIds.add(id);
    }

    // Flip each DISTINCT entry at most once per pass: surviveCertification flips
    // the first pending row for an entryId, and a second flip would need another
    // pending row — but we only want the aged ones, and re-reading after each
    // write is wasteful. Track which entryIds we've flipped this pass.
    const flippedThisPass = new Set<string>();
    for (const cert of certs) {
      if (cert.outcome !== 'pending') continue;
      if (flippedThisPass.has(cert.entryId)) continue;
      if (brokenEntryIds.has(cert.entryId)) continue; // the field broke it — overturn wins

      const age = ageInDays(typeof cert.ts === 'string' ? cert.ts : undefined, now);
      if (age === null || age < survivalWindow) continue; // not aged enough yet

      if (surviveCertification(rootDir, cert.entryId)) {
        flippedThisPass.add(cert.entryId);
        result.certsSurvived++;
      }
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

  if (result.certsSurvived > 0 || result.entriesDecayed > 0) {
    log.flow('$classroom-fail-loop').info('decay pass complete', {
      certsSurvived: result.certsSurvived,
      entriesDecayed: result.entriesDecayed,
    });
  }

  return result;
}
