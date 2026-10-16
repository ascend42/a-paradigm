/**
 * Academy Routes — University content packs, made web-reachable (7.11.0,
 * T-2026-09-26-003). Replaces the old /api/university router, which read
 * JSON course files that no longer exist.
 *
 * A thin, READ-ONLY fs-over-HTTP layer over the SAME engine the CLI + MCP use
 * (`@a-company/university-core`): discoverPacks → pack list, loadPath /
 * loadNote / loadQuiz for bodies, searchContentWithMeta for search. Pack skills
 * come from #skill-loader listPackSkills (always trust:'external', never
 * script bodies).
 *
 * Safety contract:
 *   - `:packId` must match a DISCOVERED pack (else 404) — never a path.
 *   - entry ids must match ^[A-Za-z0-9-]+$ (else 400); bodies are loaded by id
 *     through the core loader with the discovered packRoot — request input is
 *     never path-joined here.
 *   - no absolute paths ever leave the server (pack roots, index `file`
 *     fields and skill dirs are stripped).
 *   - every handler is wrapped: an engine throw becomes 500 { error }.
 *
 * Endpoints (all GET):
 *   /packs                              — [{ id, title, description, tenant_kind, origin, counts, sections, skillCount }]
 *   /packs/:packId/paths                — path summaries
 *   /packs/:packId/paths/:id            — path with steps resolved to entry titles
 *   /packs/:packId/notes/:id            — { frontmatter, body }
 *   /packs/:packId/quizzes/:id          — quiz WITH answers (the client grades locally)
 *   /packs/:packId/skills               — [{ id, version, description, trust:'external', allowedTools, scriptCount }]
 *   /search?q=&type=&pack=              — entries across one or all packs
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackLocation, UniversityIndexEntry } from '@a-company/university-core';

const ENTRY_ID_RE = /^[A-Za-z0-9-]+$/;
const NOTE_TYPES = new Set(['note', 'policy', 'guide', 'runbook']);
const MAX_SEARCH_LIMIT = 100;
/** Longest accepted search query (chars) — longer → 400. */
const MAX_QUERY_LENGTH = 200;

type Core = typeof import('@a-company/university-core');

async function loadCore(): Promise<Core> {
  return import('@a-company/university-core');
}

/**
 * Discovered packs, deduped by id (first wins — discovery precedence is
 * first-party → npm → local). A local `.paradigm/university/` without a
 * pack.yaml (the pre-v6 layout) is surfaced as an implicit project pack when it
 * actually holds content, mirroring the CLI's `university list`.
 */
function listPacks(core: Core, projectDir: string): PackLocation[] {
  let packs: PackLocation[] = [];
  try {
    packs = core.discoverPacks(projectDir);
  } catch {
    packs = [];
  }
  const localRoot = path.join(projectDir, '.paradigm', 'university');
  if (
    !fs.existsSync(path.join(localRoot, core.PACK_MANIFEST_FILENAME)) &&
    fs.existsSync(localRoot) &&
    core.countPackEntries(localRoot) > 0
  ) {
    const manifest = core.loadOrFabricatePackManifest(localRoot);
    if (manifest) packs.push({ manifest, rootDir: localRoot, source: 'local' });
  }
  const seen = new Set<string>();
  return packs.filter((p) => {
    if (!p.manifest?.id || seen.has(p.manifest.id)) return false;
    seen.add(p.manifest.id);
    return true;
  });
}

function entriesOf(core: Core, pack: PackLocation, projectDir: string): UniversityIndexEntry[] {
  try {
    return core.loadPackIndex(pack.rootDir, projectDir).entries ?? [];
  } catch {
    return [];
  }
}

/** Strip the relative-but-internal `file` field from an index entry. */
function publicEntry(e: UniversityIndexEntry, packId?: string) {
  const { file: _file, ...rest } = e;
  return packId ? { ...rest, pack: packId } : rest;
}

/**
 * Resolve `:packId` (+ optional `:id`) or send the 400/404. Returns null when a
 * response has already been sent.
 */
async function resolveRequest(
  req: Request,
  res: Response,
  projectDir: string,
  opts: { needsId: boolean },
): Promise<{ core: Core; pack: PackLocation; id: string } | null> {
  const packId = String(req.params.packId ?? '');
  if (!ENTRY_ID_RE.test(packId)) {
    res.status(400).json({ error: 'invalid pack id' });
    return null;
  }
  const id = String(req.params.id ?? '');
  if (opts.needsId && !ENTRY_ID_RE.test(id)) {
    res.status(400).json({ error: 'invalid id' });
    return null;
  }
  const core = await loadCore();
  const pack = listPacks(core, projectDir).find((p) => p.manifest.id === packId);
  if (!pack) {
    res.status(404).json({ error: `pack '${packId}' not found` });
    return null;
  }
  return { core, pack, id };
}

function fail(res: Response, route: string, err: unknown): void {
  console.error(`[academy] ${route} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: 'academy operation failed' });
}

export function createAcademyRouter(projectDir: string): Router {
  const router = Router();

  // GET /packs — every discovered pack with per-type counts.
  router.get('/packs', async (_req: Request, res: Response) => {
    try {
      const core = await loadCore();
      const packs = listPacks(core, projectDir).map((p) => {
        const counts: Record<string, number> = {};
        for (const e of entriesOf(core, p, projectDir)) counts[e.type] = (counts[e.type] ?? 0) + 1;
        return {
          id: p.manifest.id,
          title: p.manifest.name || p.manifest.id,
          description: p.manifest.description ?? '',
          tenant_kind: p.manifest.tenant_kind,
          origin: p.source,
          ...(p.parentPackId ? { parentPackId: p.parentPackId } : {}),
          counts,
          sections: core.normalizeSections(p.manifest.sections).map((s) => ({
            id: s.id,
            name: s.name,
            order: s.order,
            style: s.style,
            ...(s.description ? { description: s.description } : {}),
          })),
          skillCount: p.skillDirs?.length ?? 0,
        };
      });
      res.json(packs);
    } catch (err) {
      fail(res, '/packs', err);
    }
  });

  // GET /packs/:packId/paths — learning-path summaries.
  router.get('/packs/:packId/paths', async (req: Request, res: Response) => {
    try {
      const r = await resolveRequest(req, res, projectDir, { needsId: false });
      if (!r) return;
      const paths = entriesOf(r.core, r.pack, projectDir)
        .filter((e) => e.type === 'path')
        .map((e) => {
          const lp = r.core.loadPath(projectDir, e.id, r.pack.rootDir);
          return {
            id: e.id,
            title: e.title,
            description: lp?.description ?? '',
            stepCount: Array.isArray(lp?.steps) ? lp!.steps.length : 0,
            ...(e.section ? { section: e.section } : {}),
            ...(typeof e.order === 'number' ? { order: e.order } : {}),
          };
        });
      res.json(paths);
    } catch (err) {
      fail(res, '/paths', err);
    }
  });

  // GET /packs/:packId/paths/:id — one path, steps resolved to entry titles.
  router.get('/packs/:packId/paths/:id', async (req: Request, res: Response) => {
    try {
      const r = await resolveRequest(req, res, projectDir, { needsId: true });
      if (!r) return;
      const entries = entriesOf(r.core, r.pack, projectDir);
      const entry = entries.find((e) => e.id === r.id && e.type === 'path');
      const lp = entry ? r.core.loadPath(projectDir, r.id, r.pack.rootDir) : null;
      if (!lp || !Array.isArray(lp.steps)) {
        res.status(404).json({ error: `path '${r.id}' not found` });
        return;
      }
      const byId = new Map(entries.map((e) => [e.id, e]));
      res.json({
        id: lp.id,
        title: lp.title,
        description: lp.description ?? '',
        ordered: lp.ordered !== false,
        tags: Array.isArray(lp.tags) ? lp.tags : [],
        steps: lp.steps.map((s) => {
          const target = byId.get(s.content);
          const kind = s.content?.startsWith('plsat:')
            ? 'plsat'
            : target
              ? target.type === 'quiz'
                ? 'quiz'
                : target.type === 'path'
                  ? 'path'
                  : 'note'
              : 'missing';
          return {
            content: s.content,
            kind,
            title: target?.title ?? s.content,
            required: s.required !== false,
            ...(s.passRequired ? { passRequired: true } : {}),
            ...(s.note ? { note: s.note } : {}),
          };
        }),
      });
    } catch (err) {
      fail(res, '/paths/:id', err);
    }
  });

  // GET /packs/:packId/notes/:id — { frontmatter, body } (markdown body).
  router.get('/packs/:packId/notes/:id', async (req: Request, res: Response) => {
    try {
      const r = await resolveRequest(req, res, projectDir, { needsId: true });
      if (!r) return;
      const entry = entriesOf(r.core, r.pack, projectDir).find((e) => e.id === r.id && NOTE_TYPES.has(e.type));
      const note = entry ? r.core.loadNote(projectDir, r.id, r.pack.rootDir) : null;
      if (!note) {
        res.status(404).json({ error: `note '${r.id}' not found` });
        return;
      }
      res.json({ frontmatter: note.frontmatter, body: note.body });
    } catch (err) {
      fail(res, '/notes/:id', err);
    }
  });

  // GET /packs/:packId/quizzes/:id — the quiz WITH answers. Grading is local
  // to the browser; nothing is recorded server-side.
  router.get('/packs/:packId/quizzes/:id', async (req: Request, res: Response) => {
    try {
      const r = await resolveRequest(req, res, projectDir, { needsId: true });
      if (!r) return;
      const entry = entriesOf(r.core, r.pack, projectDir).find((e) => e.id === r.id && e.type === 'quiz');
      const quiz = entry ? r.core.loadQuiz(projectDir, r.id, r.pack.rootDir) : null;
      if (!quiz) {
        res.status(404).json({ error: `quiz '${r.id}' not found` });
        return;
      }
      res.json({
        id: quiz.id,
        title: quiz.title,
        description: quiz.description ?? '',
        difficulty: quiz.difficulty,
        passThreshold: typeof quiz.passThreshold === 'number' ? quiz.passThreshold : 0.7,
        questions: (quiz.questions ?? []).map((q) => ({
          id: q.id,
          question: q.question,
          ...(q.scenario ? { scenario: q.scenario } : {}),
          choices: q.choices ?? {},
          correct: q.correct,
          ...(q.explanation ? { explanation: q.explanation } : {}),
          weight: typeof q.weight === 'number' ? q.weight : 1,
        })),
      });
    } catch (err) {
      fail(res, '/quizzes/:id', err);
    }
  });

  // GET /packs/:packId/skills — skills the pack ships. Always external, never
  // active until `paradigm skill import`; never script bodies or paths.
  router.get('/packs/:packId/skills', async (req: Request, res: Response) => {
    try {
      const r = await resolveRequest(req, res, projectDir, { needsId: false });
      if (!r) return;
      const dirs = (r.pack.skillDirs ?? []).map((dir) => ({ packId: r.pack.manifest.id, dir }));
      if (dirs.length === 0) {
        res.json([]);
        return;
      }
      const { listPackSkills } = await import('../../../../paradigm-mcp/src/utils/skill-loader.js');
      const packId = r.pack.manifest.id;
      const skills = listPackSkills({ rootDir: projectDir, packSkillDirs: dirs })
        .filter((e) => e.packId === packId)
        .map((e) => ({
        id: e.skill.metadata.paradigm.id,
        version: e.skill.metadata.paradigm.version,
        description: e.skill.description,
        trust: 'external' as const,
        allowedTools: e.skill['allowed-tools'] ?? '',
        scriptCount: e.scriptCount,
        ...(e.shadowedBy ? { shadowedBy: e.shadowedBy } : {}),
      }));
      res.json(skills);
    } catch (err) {
      fail(res, '/skills', err);
    }
  });

  // GET /search?q=&type=&pack=&limit= — one pack (when `pack` given) or all.
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const type = typeof req.query.type === 'string' ? req.query.type : '';
      const packParam = typeof req.query.pack === 'string' ? req.query.pack : '';
      if (q.length > MAX_QUERY_LENGTH) {
        res.status(400).json({ error: `query too long (max ${MAX_QUERY_LENGTH} characters)` });
        return;
      }
      if (type && !ENTRY_ID_RE.test(type)) {
        res.status(400).json({ error: 'invalid type' });
        return;
      }
      if (packParam && !ENTRY_ID_RE.test(packParam)) {
        res.status(400).json({ error: 'invalid pack id' });
        return;
      }
      const rawLimit = parseInt(String(req.query.limit ?? '20'), 10);
      const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));

      const core = await loadCore();
      let packs = listPacks(core, projectDir);
      if (packParam) {
        packs = packs.filter((p) => p.manifest.id === packParam);
        if (packs.length === 0) {
          res.status(404).json({ error: `pack '${packParam}' not found` });
          return;
        }
      }
      const entries: Array<ReturnType<typeof publicEntry>> = [];
      let total = 0;
      for (const p of packs) {
        const r = core.searchContentWithMeta(
          projectDir,
          { ...(q ? { query: q } : {}), ...(type ? { type } : {}), limit },
          p.rootDir,
        );
        total += r.total;
        for (const e of r.entries) entries.push(publicEntry(e, p.manifest.id));
      }
      const sliced = entries.slice(0, limit);
      res.json({ entries: sliced, total, returned: sliced.length });
    } catch (err) {
      fail(res, '/search', err);
    }
  });

  return router;
}
