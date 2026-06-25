/**
 * Academy (Classroom) Routes — the gated-learning ledger, made web-reachable.
 *
 * This is the Platform-section data layer for the Classroom engine
 * (TD-2026-06-19-007: provisional learnings + the field failure/reinforcement
 * loop). It mirrors `routes/ambient.ts`: a thin, READ-ONLY HTTP layer over the
 * Classroom's on-disk artifacts. It owns NO storage and performs NO writes — no
 * write endpoints, no engine calls that mutate. Every handler degrades to `[]`
 * / an empty rollup when a file is missing (never throws on missing/malformed
 * data — the wave-1 MVP is honest about absence, not crash-on-cold-start).
 *
 * Data sources (all optional):
 *   .paradigm/curriculum/<agent>.syllabus       — per-agent syllabus (YAML).
 *   .paradigm/curriculum/index.yaml             — syllabus index + health.
 *   .paradigm/events/classroom-certifications.jsonl — cert rows (the loop spine).
 *   .paradigm/events/field-failures.jsonl       — attributed field breaks.
 *   ~/.paradigm/agents/<agent>/journal/*.yaml   — per-agent study-hall journal
 *       entries; the REAL staged-candidate source (global, per-agent). NOT the
 *       legacy Ambient nominations firehose — the Academy is the GATED-truth
 *       counterpart to Ambient, so /staged must NOT conflate the two.
 *
 * `bootstrapped` = the curriculum dir exists with ≥1 *.syllabus. Until then the
 * UI renders the Bootstrap Doorway empty-state — a green checkmark that lies is
 * the enemy, so an un-bootstrapped Academy shows nothing green.
 *
 * The honest-denominator rule (classroom-experience.md): repeatFailureRate is
 * overturned / (survived + overturned), and is `null` when 0 certs have
 * resolved. A null scoreboard reads "not enough settled exams" — NOT healthy.
 *
 * Endpoints (all GET, all read-only):
 *   GET /status         — bootstrapped flag, per-agent syllabi, cert rollup.
 *   GET /staged         — staged candidates from ENROLLED agents' study-hall
 *                         journals (~/.paradigm/agents/<agent>/journal/*.yaml).
 *                         Excludes entries already promoted to the notebook
 *                         (promoted_to_notebook set) — they've graduated.
 *   GET /certifications — cert rows with a derived `loop: 'gated'|'legacy'`.
 *   GET /refinements    — field-failure rows (the overturned/refinement signal).
 *   GET /rapsheet       — per-entry learning lineage: born (cert) ⋈ applied
 *                         (notebook-refs) ⋈ broke (field-failures). `breaks: []`
 *                         means UNTESTED, never "passed".
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { PlatformWsContext } from '../ws/index.js';

// ── Types ────────────────────────────────────────────────────────────

interface SyllabusFile {
  id?: string;
  agent?: string;
  status?: 'current' | 'stale' | 'broken' | 'expired';
  [key: string]: unknown;
}

interface ClassroomCertRow {
  ts?: string;
  agent?: string;
  entryId?: string;
  concepts?: string[];
  confidenceAtCert?: number;
  certifiedBy?: 'gate' | 'peer' | 'quorum';
  outcome?: 'pending' | 'survived' | 'overturned';
  overturnedByFailureId?: string;
  boundAt?: string;
  survivedAt?: string;
  [key: string]: unknown;
}

interface FieldFailureRow {
  ts?: string;
  orchestrationId?: string;
  agent?: string;
  signal?: string;
  severity?: 'low' | 'medium' | 'high';
  attributedEntryIds?: string[];
  symbols?: string[];
  detail?: string;
  scenarioId?: string;
  sourceEvent?: string;
  [key: string]: unknown;
}

/**
 * A notebook-reference event — the "applied" join. Each row records that one
 * orchestration consulted a set of notebook entries. The Rap Sheet joins these
 * to certs (born) and field-failures (broke) by entryId / orchestrationId.
 */
interface NotebookRefRow {
  timestamp?: string;
  agentId?: string;
  notebookEntryIds?: string[];
  orchestrationId?: string;
  [key: string]: unknown;
}

/**
 * A study-hall journal entry as it sits on disk. The Classroom reads it
 * defensively — `provenance` is an optional, loosely-typed envelope (the
 * JournalEntry type doesn't declare it, but on-disk YAML may carry it), so we
 * fall back to sensible defaults (trust: 'provisional', source: 'study-hall').
 */
interface JournalEntryFile {
  id?: string;
  agent?: string;
  timestamp?: string;
  insight?: string;
  title?: string;
  concept?: string;
  confidence_after?: number;
  /** Set once an entry has been promoted to the notebook — such entries are no
   *  longer staged candidates and are excluded from GET /staged. */
  promoted_to_notebook?: string;
  provenance?: {
    trust?: string;
    source?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Read a JSONL file line-by-line, skipping malformed lines. Missing → []. */
function readJsonlSafe<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const results: T[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines — never throw on a single bad row.
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** Load every *.syllabus in the curriculum dir. Missing dir → []. */
function readSyllabi(curriculumDir: string): SyllabusFile[] {
  if (!fs.existsSync(curriculumDir)) return [];
  let files: string[];
  try {
    files = fs.readdirSync(curriculumDir).filter(f => f.endsWith('.syllabus')).sort();
  } catch {
    return [];
  }
  const out: SyllabusFile[] = [];
  for (const file of files) {
    try {
      const parsed = yaml.load(fs.readFileSync(path.join(curriculumDir, file), 'utf-8')) as SyllabusFile;
      if (parsed?.id && parsed?.agent) out.push(parsed);
    } catch {
      // Skip malformed syllabus files.
    }
  }
  return out;
}

/**
 * Read one enrolled agent's GLOBAL study-hall journal
 * (~/.paradigm/agents/<agent>/journal/*.yaml). Mirrors journal-loader's read
 * pattern (readdirSync → filter .yaml → js-yaml parse). Missing dir/file → [];
 * never throws on a single malformed entry.
 */
function readAgentJournal(agentId: string): JournalEntryFile[] {
  const dir = path.join(os.homedir(), '.paradigm', 'agents', agentId, 'journal');
  if (!fs.existsSync(dir)) return [];
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
  } catch {
    return [];
  }
  const out: JournalEntryFile[] = [];
  for (const file of files) {
    try {
      const parsed = yaml.load(fs.readFileSync(path.join(dir, file), 'utf-8')) as JournalEntryFile;
      if (parsed?.id) out.push(parsed);
    } catch {
      // Skip malformed journal files.
    }
  }
  return out;
}

/**
 * Derive the two-loop badge from how a cert was certified. `gate` is the
 * legacy auto-promotion path (un-interrogated, quarantined) → LEGACY; a `peer`
 * or `quorum` cert went through the gated trial → GATED. Unknown defaults to
 * legacy (the more honest, less-trusted reading).
 */
function deriveLoop(certifiedBy: string | undefined): 'gated' | 'legacy' {
  return certifiedBy === 'peer' || certifiedBy === 'quorum' ? 'gated' : 'legacy';
}

/**
 * Tally cert outcomes and compute the honest repeat-failure rate.
 * resolved = survived + overturned (the real denominator). Until a cert
 * resolves it is `pending` and contributes to NEITHER side — so a board with
 * only pending certs has a `null` rate, which the UI reads as "no settled exams
 * yet", never as healthy.
 */
function rollupCerts(certs: ClassroomCertRow[]): {
  total: number;
  pending: number;
  survived: number;
  overturned: number;
  resolved: number;
  repeatFailureRate: number | null;
} {
  let pending = 0;
  let survived = 0;
  let overturned = 0;
  for (const c of certs) {
    switch (c.outcome) {
      case 'survived': survived++; break;
      case 'overturned': overturned++; break;
      default: pending++; break;
    }
  }
  const resolved = survived + overturned;
  return {
    total: certs.length,
    pending,
    survived,
    overturned,
    resolved,
    repeatFailureRate: resolved > 0 ? overturned / resolved : null,
  };
}

// ── Router ───────────────────────────────────────────────────────────

export function createClassroomRouter(projectDir: string, _wsContext?: PlatformWsContext): Router {
  const router = Router();

  const curriculumDir = path.join(projectDir, '.paradigm', 'curriculum');
  const certsPath = path.join(projectDir, '.paradigm', 'events', 'classroom-certifications.jsonl');
  const failuresPath = path.join(projectDir, '.paradigm', 'events', 'field-failures.jsonl');
  const refsPath = path.join(projectDir, '.paradigm', 'events', 'notebook-refs.jsonl');

  // ── GET /status ────────────────────────────────────────────
  // The Academy's front door. `bootstrapped` gates the Doorway vs. the Board.
  // Per-agent syllabi carry status + their cert counts (certified = resolved
  // survived; provisional = still-pending). The rollup carries the honest
  // repeat-failure rate (null until something settles).
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const syllabi = readSyllabi(curriculumDir);
      const bootstrapped = syllabi.length > 0;
      const certs = readJsonlSafe<ClassroomCertRow>(certsPath);

      // Per-agent cert tallies: certified = survived (the field proved it),
      // provisional = pending (certified-pending, awaiting the field's veto).
      const byAgent = new Map<string, { certified: number; provisional: number }>();
      for (const c of certs) {
        if (!c.agent) continue;
        const bucket = byAgent.get(c.agent) ?? { certified: 0, provisional: 0 };
        if (c.outcome === 'survived') bucket.certified++;
        else if (c.outcome === 'pending' || c.outcome === undefined) bucket.provisional++;
        byAgent.set(c.agent, bucket);
      }

      const syllabiOut = syllabi.map(s => {
        const tally = byAgent.get(s.agent as string) ?? { certified: 0, provisional: 0 };
        return {
          agent: s.agent,
          status: s.status ?? 'current',
          certified: tally.certified,
          provisional: tally.provisional,
        };
      });

      res.json({
        bootstrapped,
        syllabi: syllabiOut,
        rollup: rollupCerts(certs),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to read classroom status', detail: String(err) });
    }
  });

  // ── GET /staged ────────────────────────────────────────────
  // The REAL staged candidates: study-hall JOURNAL entries from the ENROLLED
  // agents (= the agents that have a syllabus, the same set /status builds).
  // For each, read its GLOBAL journal dir (~/.paradigm/agents/<agent>/journal/
  // *.yaml) and emit one item per entry, newest-first. Already-promoted entries
  // (promoted_to_notebook set) are excluded — once an entry graduates to the
  // notebook it is no longer a staged candidate (T-007). This is the gated-truth
  // counterpart to Ambient — it deliberately does NOT read the Ambient
  // nominations firehose (that would flood the column with un-gated chatter).
  // compliance has no journal on this repo → [] → an honest empty column that
  // fills when study-hall / an Orientation Term stages a real candidate.
  router.get('/staged', (_req: Request, res: Response) => {
    try {
      const enrolledAgents = readSyllabi(curriculumDir)
        .map(s => s.agent)
        .filter((a): a is string => typeof a === 'string');

      const staged = enrolledAgents
        .flatMap(agent =>
          readAgentJournal(agent)
            // Exclude already-promoted entries — they've graduated to the
            // notebook and are no longer staged candidates (T-007).
            .filter(e => !e.promoted_to_notebook)
            .map(e => ({
            agent,
            insight: e.insight ?? e.title ?? e.concept ?? '',
            confidence: e.confidence_after,
            trust: e.provenance?.trust ?? 'provisional',
            source: e.provenance?.source ?? 'study-hall',
            ts: e.timestamp,
          })),
        )
        .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));

      res.json(staged);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read staged candidates', detail: String(err) });
    }
  });

  // ── GET /certifications ────────────────────────────────────
  // Cert rows, each tagged with the derived two-loop `loop` field (gated vs.
  // legacy). Newest-first so the board's columns read most-recent at the top.
  router.get('/certifications', (_req: Request, res: Response) => {
    try {
      const certs = readJsonlSafe<ClassroomCertRow>(certsPath);
      const out = certs
        .map(c => ({ ...c, loop: deriveLoop(c.certifiedBy) }))
        .reverse();
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read certifications', detail: String(err) });
    }
  });

  // ── GET /refinements ───────────────────────────────────────
  // Field-failure rows — the overturned/refinement signal. Each row is an
  // attributed break that flipped (or will flip) a cert to overturned. Newest
  // first. [] if no breaks recorded.
  router.get('/refinements', (_req: Request, res: Response) => {
    try {
      const failures = readJsonlSafe<FieldFailureRow>(failuresPath);
      res.json(failures.reverse());
    } catch (err) {
      res.status(500).json({ error: 'Failed to read refinements', detail: String(err) });
    }
  });

  // ── GET /rapsheet ──────────────────────────────────────────
  // The learning lineage: one row per certified entry, joining the three loop
  // spines — born (the cert), applied (notebook-refs by entryId), broke (field-
  // failures by entryId). This is the "why did this break" payload — and, just
  // as load-bearing, the honest null: a cert applied many times with ZERO breaks
  // is NOT proven safe, only UNTESTED, so `breaks: []` is surfaced as exactly
  // that, never as a pass. Sorted most-instructive-first: overturned, then
  // applied-but-pending, then never-applied. Read-only; [] on missing data.
  router.get('/rapsheet', (_req: Request, res: Response) => {
    try {
      const certs = readJsonlSafe<ClassroomCertRow>(certsPath);
      const refs = readJsonlSafe<NotebookRefRow>(refsPath);
      const failures = readJsonlSafe<FieldFailureRow>(failuresPath);

      const rows = certs
        .filter(c => typeof c.entryId === 'string')
        .map(c => {
          const entryId = c.entryId as string;

          // APPLIED: every orchestration whose ref-set named this entry.
          const applications = refs.filter(r => (r.notebookEntryIds ?? []).includes(entryId));
          const appliedTimes = applications
            .map(r => r.timestamp)
            .filter((t): t is string => typeof t === 'string')
            .sort();

          // BROKE: field-failures that attributed a break back to this entry.
          const breaks = failures
            .filter(f => (f.attributedEntryIds ?? []).includes(entryId))
            .map(f => ({
              ts: f.ts,
              signal: f.signal,
              severity: f.severity,
              scenarioId: f.scenarioId,
              detail: f.detail,
            }))
            .sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));

          return {
            entryId,
            agent: c.agent,
            concepts: c.concepts ?? [],
            certifiedBy: c.certifiedBy,
            loop: deriveLoop(c.certifiedBy),
            outcome: c.outcome ?? 'pending',
            bornTs: c.ts,
            appliedCount: applications.length,
            lastAppliedAt: appliedTimes.length ? appliedTimes[appliedTimes.length - 1] : undefined,
            breaks,
          };
        });

      // Most-instructive-first: overturned (broke) → applied-but-pending → rest.
      const rank = (r: { outcome: string; appliedCount: number }) =>
        r.outcome === 'overturned' ? 0 : r.appliedCount > 0 ? 1 : 2;
      rows.sort((a, b) => rank(a) - rank(b) || (b.bornTs ?? '').localeCompare(a.bornTs ?? ''));

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read rap sheet', detail: String(err) });
    }
  });

  return router;
}
