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
 *   /calibration   — the archetype×taskType learned-estimate grid (hero strip)
 *   /:id           — a single task by id
 *
 * `/` and `/board` attach a computed `estimate:{min,max,n,source}` per task —
 * the learned-calibration story-point the UI renders. Read-only: the estimate is
 * derived at read time from the learned token table, never persisted here.
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

      // Attach the learned-calibration estimate + the taskType family per task
      // (the story-point the UI renders + the calibration-grid column key, so a
      // cell can map back to the board). Load the table ONCE for the whole list.
      const { loadLearnedTokenTable, estimateForTask, classifyTaskLocal } = await import('../../../../paradigm-mcp/src/tools/orchestration.js');
      const learned = loadLearnedTokenTable(projectDir);
      const withEstimates = tasks.map(t => ({
        ...t,
        estimate: estimateForTask(learned, t),
        taskType: classifyTaskLocal(t.blurb).type,
      }));

      res.json({ tasks: withEstimates, count: withEstimates.length, filter });
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

      // Attach estimates + taskType: run nodes by their own claimant, unclaimed
      // cards by their proposedClaimant (the archetype that WOULD pick them up).
      const { loadLearnedTokenTable, estimateForTask, classifyTaskLocal } = await import('../../../../paradigm-mcp/src/tools/orchestration.js');
      const learned = loadLearnedTokenTable(projectDir);
      for (const run of board.runs ?? []) {
        for (const node of run.nodes ?? []) {
          (node as Record<string, unknown>).estimate = estimateForTask(learned, { blurb: node.blurb, claimant: node.claimant });
          (node as Record<string, unknown>).taskType = classifyTaskLocal(node.blurb).type;
        }
      }
      for (const u of board.unclaimed ?? []) {
        const hint = u.proposedClaimant?.kind === 'archetype' ? u.proposedClaimant.ref : undefined;
        (u as Record<string, unknown>).estimate = estimateForTask(learned, { blurb: u.blurb }, hint);
        (u as Record<string, unknown>).taskType = classifyTaskLocal(u.blurb).type;
      }

      res.json(board);
    } catch (err) {
      res.status(500).json({ error: 'Failed to assemble board', detail: String(err) });
    }
  });

  // GET /calibration — the archetype×taskType learned-estimate grid + coverage
  // for the hero strip. Renders fully even cold-start (all-prior grid).
  router.get('/calibration', async (_req: Request, res: Response) => {
    try {
      const { assembleCalibrationGrid } = await import('../../../../paradigm-mcp/src/tools/orchestration.js');
      res.json(assembleCalibrationGrid(projectDir));
    } catch (err) {
      res.status(500).json({ error: 'Failed to assemble calibration grid', detail: String(err) });
    }
  });

  // GET /whoami — the current human's claimant identity (git user.email-based),
  // so the Inbox "Me" lens can resolve its ref without browser-side git access.
  router.get('/whoami', async (_req: Request, res: Response) => {
    try {
      const { currentHumanRef } = await import('../../commands/task/index.js');
      res.json({ kind: 'human', ref: currentHumanRef() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to resolve identity', detail: String(err) });
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
