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
 * Data sources (all under .paradigm/, all optional):
 *   .paradigm/curriculum/<agent>.syllabus       — per-agent syllabus (YAML).
 *   .paradigm/curriculum/index.yaml             — syllabus index + health.
 *   .paradigm/events/classroom-certifications.jsonl — cert rows (the loop spine).
 *   .paradigm/events/field-failures.jsonl       — attributed field breaks.
 *   .paradigm/events/nominations.jsonl          — staged-ish candidate signal.
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
 *   GET /staged         — staged candidates (best-effort, from nominations).
 *   GET /certifications — cert rows with a derived `loop: 'gated'|'legacy'`.
 *   GET /refinements    — field-failure rows (the overturned/refinement signal).
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
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

interface Nomination {
  id?: string;
  agent?: string;
  type?: string;
  urgency?: string;
  brief?: string;
  timestamp?: string;
  surfaced?: boolean;
  engaged?: boolean;
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
  const nominationsPath = path.join(projectDir, '.paradigm', 'events', 'nominations.jsonl');

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
  // Staged candidates surfaced from the nominations log — the "chattering"
  // signal that something wants to take the stand. Best-effort and read-only:
  // we surface un-engaged nominations as staged-ish candidates. [] if none.
  router.get('/staged', (_req: Request, res: Response) => {
    try {
      const nominations = readJsonlSafe<Nomination>(nominationsPath);
      const staged = nominations
        .filter(n => !n.engaged)
        .slice(-50)
        .map(n => ({
          id: n.id,
          agent: n.agent,
          type: n.type,
          urgency: n.urgency,
          brief: n.brief,
          timestamp: n.timestamp,
        }));
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

  return router;
}
