/**
 * Tasks Routes — the v7 claimant task DAG, made web-reachable for the first time.
 *
 * Until the renaissance, the claimant-owned task store + captain board were
 * MCP/CLI-only — no web surface read them, so the deepest v7 substrate (the DAG
 * agents execute, learned calibration, claimant ownership) was invisible to the
 * Platform. This is a thin fs-over-HTTP read layer over the existing loader; it
 * owns NO storage and writes nothing. Routes are read-only by design — task
 * mutation stays on the CLI/MCP write path with its state-machine enforcement.
 *
 * Endpoints (all GET):
 *   /              — filtered task list (status, priority, tag, claimant, limit)
 *   /board         — the captain run-DAG board (lifts assembleCaptainBoard onto HTTP)
 *   /inbox         — a claimant's inbox (?kind=&ref=) via tasksForClaimant
 *   /:id           — a single task by id
 */

import { Router, type Request, type Response } from 'express';

import type { TaskFilter, TaskFilterStatus, ClaimantKind } from '../../../../paradigm-mcp/src/utils/task-loader.js';

const VALID_STATUS: TaskFilterStatus[] = ['open', 'in-progress', 'done', 'shelved', 'active', 'all'];
const VALID_KIND: ClaimantKind[] = ['archetype', 'human', 'peer'];

/** Coerce a `?limit=` query value to a sane positive integer, or undefined. */
function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createTasksRouter(projectDir: string): Router {
  const router = Router();

  // GET / — filtered task list. Query: status, priority, tag, claimantRef,
  // claimantKind, limit. Mirrors the loader's TaskFilter 1:1.
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { loadTasks } = await import('../../../../paradigm-mcp/src/utils/task-loader.js');

      const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
      const priorityRaw = typeof req.query.priority === 'string' ? req.query.priority : undefined;
      const claimantRef = typeof req.query.claimantRef === 'string' ? req.query.claimantRef : undefined;
      const claimantKind = typeof req.query.claimantKind === 'string' ? req.query.claimantKind : undefined;

      const filter: TaskFilter = {
        status: VALID_STATUS.includes(statusRaw as TaskFilterStatus) ? (statusRaw as TaskFilterStatus) : 'active',
        limit: parseLimit(req.query.limit) ?? 100,
      };
      if (priorityRaw === 'high' || priorityRaw === 'medium' || priorityRaw === 'low') {
        filter.priority = priorityRaw;
      }
      if (typeof req.query.tag === 'string') filter.tag = req.query.tag;
      if (claimantRef) {
        filter.claimant = {
          ref: claimantRef,
          kind: VALID_KIND.includes(claimantKind as ClaimantKind) ? (claimantKind as ClaimantKind) : undefined,
        };
      }

      const tasks = await loadTasks(projectDir, filter);
      res.json({ tasks, count: tasks.length, filter });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load tasks', detail: String(err) });
    }
  });

  // GET /board — the captain run-DAG board. Called without a ProjectContext so
  // it stays fast (ripple scoring is skipped — scores 0, fragileSymbols empty);
  // proposeClaimants is on so unclaimed cards carry a suggested archetype, same
  // as the CLI `task --board` view.
  router.get('/board', async (_req: Request, res: Response) => {
    try {
      const { assembleCaptainBoard } = await import('../../../../paradigm-mcp/src/tools/captain.js');
      const board = await assembleCaptainBoard(projectDir, { proposeClaimants: true });
      res.json(board);
    } catch (err) {
      res.status(500).json({ error: 'Failed to assemble board', detail: String(err) });
    }
  });

  // GET /inbox?kind=&ref= — a claimant's inbox (active tasks they own). `ref` is
  // required; `kind` narrows when refs collide across kinds. Defaults to active.
  router.get('/inbox', async (req: Request, res: Response) => {
    try {
      const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;
      if (!ref) {
        res.status(400).json({ error: 'inbox requires a `ref` query param (the claimant ref)' });
        return;
      }
      const kindRaw = typeof req.query.kind === 'string' ? req.query.kind : undefined;
      const kind = VALID_KIND.includes(kindRaw as ClaimantKind) ? (kindRaw as ClaimantKind) : undefined;
      const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
      const status = VALID_STATUS.includes(statusRaw as TaskFilterStatus) ? (statusRaw as TaskFilterStatus) : undefined;

      const { tasksForClaimant } = await import('../../../../paradigm-mcp/src/utils/task-loader.js');
      const tasks = await tasksForClaimant(projectDir, { kind, ref }, { status });
      res.json({ claimant: { kind, ref }, tasks, count: tasks.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load inbox', detail: String(err) });
    }
  });

  // GET /:id — a single task by id. Declared last so /board and /inbox win.
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { loadTask } = await import('../../../../paradigm-mcp/src/utils/task-loader.js');
      const task = await loadTask(projectDir, req.params.id);
      if (!task) {
        res.status(404).json({ error: `Task "${req.params.id}" not found` });
        return;
      }
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load task', detail: String(err) });
    }
  });

  return router;
}
