/**
 * #lesson-evidence — the checkable lesson schema's evidence check (advisory).
 *
 * A lesson (journal entry or notebook entry) may carry `evidence`: refs to
 * ledger rows. Loid's rule: a verdict must be DERIVABLE from the ledger row,
 * never an author-asserted confidence. So the strength of a lesson's evidence
 * is computed by a pure function over the rows plus a resolver; the resolver
 * looks each ref up and returns what THE LEDGER says. The author's stored
 * verdict is never read by the resolver.
 *
 * Ruling 5 (strength):
 *   none            no row resolves
 *   cited           only source citations resolve (a citation is not an outcome)
 *   confounded-only derived outcomes exist, every one `confounded`
 *   contradicted    derived outcomes exist, only `hurt` / `no-effect`
 *   supported       at least one DERIVED `helped`
 *
 * Advisory only: gated promotion WARNS on confounded-only / contradicted and
 * returns an info note (debug log) on none / cited. It never refuses. The
 * human's refine/override path is unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  EvidenceStrength,
  LessonEvidence,
  LessonEvidenceKind,
  LessonEvidenceVerdict,
  StoredLessonEvidence,
} from '../types/notebooks.js';
import { makeFailureId, readExerciseEvents, readFieldFailures } from './field-failures.js';

const KINDS: readonly LessonEvidenceKind[] = ['scenario-outcome', 'probe-run', 'field-failure', 'source'];
const VERDICTS: readonly LessonEvidenceVerdict[] = ['helped', 'hurt', 'no-effect', 'confounded'];

/**
 * What the ledger says about one evidence row: a derived outcome verdict, or
 * `cited` when the ref is a source (decision / file) that exists but carries
 * no outcome.
 */
export type DerivedEvidence = LessonEvidenceVerdict | 'cited';

/**
 * Looks a row's ref up in the ledgers. Returns what the ledger derives, or null
 * when the ref does not resolve. Must ignore `row.verdict`. Must not throw.
 */
export type EvidenceResolver = (row: LessonEvidence) => DerivedEvidence | null;

/**
 * The lesson the evidence is checked FOR (F3). Probe runs and scenario outcomes
 * only count when they are about this lesson.
 */
export interface LessonContext {
  /** The notebook entry id the lesson is (or becomes) — the cert's entry id. */
  entryId: string;
  /** The lesson's symbols / concepts / tags, for scenario overlap. */
  symbols?: string[];
}

/**
 * Keep only well-formed evidence rows (system boundary: tool input, YAML on
 * disk). Returns undefined when nothing valid remains.
 */
export function normalizeLessonEvidence(input: unknown): LessonEvidence[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: LessonEvidence[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.ref !== 'string' || !r.ref.trim()) continue;
    if (!KINDS.includes(r.kind as LessonEvidenceKind)) continue;
    if (!VERDICTS.includes(r.verdict as LessonEvidenceVerdict)) continue;
    out.push({ ref: r.ref.trim(), kind: r.kind as LessonEvidenceKind, verdict: r.verdict as LessonEvidenceVerdict });
  }
  return out.length > 0 ? out : undefined;
}

function safeResolve(resolve: EvidenceResolver, row: LessonEvidence): DerivedEvidence | null {
  try {
    return resolve(row);
  } catch {
    return null;
  }
}

/**
 * Pure: the strength of a lesson's evidence (ruling 5). A row counts only if
 * `resolve` finds its ref; its verdict is the one `resolve` derives, never the
 * stored one.
 */
export function evidenceStrength(evidence: unknown, resolve: EvidenceResolver): EvidenceStrength {
  const rows = normalizeLessonEvidence(evidence) ?? [];
  let sawHelped = false;
  let sawContra = false;
  let sawConfounded = false;
  let sawCited = false;
  // Loid L1: scan EVERY row first; evidence that both helped and hurt must not read `supported` and hide the contradiction
  for (const row of rows) {
    const derived = safeResolve(resolve, row);
    if (derived === null) continue;
    if (derived === 'helped') sawHelped = true;
    else if (derived === 'hurt' || derived === 'no-effect') sawContra = true;
    else if (derived === 'confounded') sawConfounded = true;
    else if (derived === 'cited') sawCited = true;
  }
  if (sawContra) return 'contradicted';
  if (sawHelped) return 'supported';
  if (sawConfounded) return 'confounded-only';
  if (sawCited) return 'cited';
  return 'none';
}

/**
 * Pure (F6): the evidence a promotion stores on the notebook entry. Each row
 * keeps only {ref, kind} plus the DERIVED verdict (none for a source citation).
 * The author's verdict is never copied; rows that do not resolve are dropped.
 */
export function deriveLessonEvidence(evidence: unknown, resolve: EvidenceResolver): StoredLessonEvidence[] | undefined {
  const out: StoredLessonEvidence[] = [];
  for (const row of normalizeLessonEvidence(evidence) ?? []) {
    const derived = safeResolve(resolve, row);
    if (derived === null) continue;
    out.push(derived === 'cited' ? { ref: row.ref, kind: row.kind } : { ref: row.ref, kind: row.kind, verdict: derived });
  }
  return out.length > 0 ? out : undefined;
}

/** A ref that is safe to use as a single file-name segment. */
function isSafeId(ref: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(ref) && !ref.includes('..');
}

function norm(s: string): string {
  return s.trim().replace(/^[#$^!~]/, '').toLowerCase();
}

/**
 * The resolver over this project's ledgers, bound to ONE lesson. Each ledger is
 * read once, lazily. `row.verdict` is never read.
 *
 *   field-failure    ref = a failure id `ff-<orchestrationId>-<entryId>` of a
 *                    field-failures.jsonl row. Derives `confounded` for a
 *                    confounded row, else `hurt` (the lesson was applied and broke).
 *   probe-run        ref = the orchestrationId / scenario-run id of an
 *                    adversarial-probe or break-attempt row in
 *                    classroom-exercises.jsonl whose certEntryId is THIS
 *                    lesson's entry (indexed by certEntryId::orchestrationId).
 *                    An orchestration that also produced a field-failure row
 *                    naming this entry (attributable or confounded, the same
 *                    rule as exerciseIntensityFor) is dropped: it did not
 *                    demonstrably hold, so a break-attempt there never derives
 *                    `helped`. Otherwise derives `helped`.
 *   scenario-outcome ref = a scenario id in .paradigm/curriculum/scenarios with
 *                    at least one recorded outcome AND a target that overlaps
 *                    this lesson (a probe's learning_ref is the lesson's entry,
 *                    or the scenario's symbols meet the lesson's). Latest
 *                    outcome: `survived` derives `helped`, `broke` derives `hurt`.
 *   source           ref = a decision id (.paradigm/decisions/<id>.yaml) or a
 *                    path inside the project. A source is a citation, not an
 *                    outcome: it derives `cited`, never a verdict.
 */
export function ledgerEvidenceResolver(rootDir: string, lesson: LessonContext): EvidenceResolver {
  const root = path.resolve(rootDir);
  const entryId = lesson.entryId;
  const lessonSymbols = new Set((lesson.symbols ?? []).map(norm).filter(Boolean));
  let failures: Map<string, DerivedEvidence> | null = null;
  let probes: Set<string> | null = null;

  // Loid (re-review): a field failure is evidence ABOUT this lesson only when it names this lesson's entry; a failure
  // that names another entry is the lesson's provenance (what taught it), so it is a citation, never `hurt`.
  const failureIndex = (): Map<string, DerivedEvidence> => {
    if (failures) return failures;
    failures = new Map();
    for (const f of readFieldFailures(root)) {
      const verdict: LessonEvidenceVerdict = f.attribution === 'confounded' ? 'confounded' : 'hurt';
      for (const id of f.attributedEntryIds ?? []) failures.set(makeFailureId(f.orchestrationId, id), entryId && id === entryId ? verdict : 'cited');
    }
    return failures;
  };

  const probeKey = (orchestrationId: string): string => `${entryId}::${orchestrationId}`;

  const probeIndex = (): Set<string> => {
    if (probes) return probes;
    probes = new Set();
    const brokeIn = new Set<string>();
    for (const f of readFieldFailures(root)) {
      if ((f.attributedEntryIds ?? []).includes(entryId)) brokeIn.add(f.orchestrationId);
    }
    for (const ev of readExerciseEvents(root)) {
      if (ev.certEntryId !== entryId || !ev.orchestrationId) continue;
      if (ev.kind !== 'adversarial-probe' && ev.kind !== 'break-attempt') continue;
      if (brokeIn.has(ev.orchestrationId)) continue;
      probes.add(probeKey(ev.orchestrationId));
    }
    return probes;
  };

  const scenarioTargetsLesson = (sc: { probes?: Array<{ learning_ref?: unknown }>; symbols?: unknown }): boolean => {
    if ((sc.probes ?? []).some(p => p && p.learning_ref === entryId)) return true;
    if (Array.isArray(sc.symbols) && lessonSymbols.size > 0) {
      return sc.symbols.some(s => typeof s === 'string' && lessonSymbols.has(norm(s)));
    }
    return false;
  };

  return (row: LessonEvidence): DerivedEvidence | null => {
    switch (row.kind) {
      case 'field-failure':
        return failureIndex().get(row.ref) ?? null;
      case 'probe-run':
        if (!entryId) return null;
        return probeIndex().has(probeKey(row.ref)) ? 'helped' : null;
      case 'scenario-outcome': {
        if (!entryId || !isSafeId(row.ref)) return null;
        const file = path.join(root, '.paradigm', 'curriculum', 'scenarios', `${row.ref}.scenario`);
        try {
          if (!fs.existsSync(file)) return null;
          const sc = yaml.load(fs.readFileSync(file, 'utf8')) as {
            outcome_history?: Array<{ result?: string }>;
            probes?: Array<{ learning_ref?: unknown }>;
            symbols?: unknown;
          } | null;
          if (!sc || !scenarioTargetsLesson(sc)) return null;
          const last = sc.outcome_history?.[sc.outcome_history.length - 1];
          if (last?.result === 'survived') return 'helped';
          if (last?.result === 'broke') return 'hurt';
          return null;
        } catch {
          return null;
        }
      }
      case 'source': {
        if (isSafeId(row.ref) && fs.existsSync(path.join(root, '.paradigm', 'decisions', `${row.ref}.yaml`))) {
          return 'cited';
        }
        const target = path.resolve(root, row.ref);
        const rel = path.relative(root, target);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
        return fs.existsSync(target) ? 'cited' : null;
      }
      default:
        return null;
    }
  };
}
