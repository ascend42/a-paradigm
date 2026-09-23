/**
 * Memory WRITE Routes — the Memory Steward apply/sync verbs, made web-reachable
 * (Phase C2/C3, TD-2026-09-20-669).
 *
 * The read router (memory.ts) owns no storage and never mutates. THIS router adds
 * the apply-by-id verbs (prune / route / merge / pin) and the gated sync write —
 * but every verb PROXIES the SAME return-shaped appliers the CLI wrappers call
 * (applyPrune / applyRoute / applyMerge / applyPin from commands/memory), so all
 * path-safety (isInsideMemoryDir), archive-not-delete, and fail-open discipline
 * live in ONE place. A browser POST is just another caller of the enforced core.
 *
 * Endpoints (all POST, body = JSON):
 *   /:id/prune              — applyPrune  → { ok, archived, file }
 *   /:id/route  { to }      — applyRoute  (to ∈ habits|decisions|task|lore; 400 bad)
 *   /merge      { ids[] }   — applyMerge  (≥2 ids in body, NOT a path param)
 *   /:id/pin                — applyPin    → { ok, pinned }
 *   /sync/write { projection? } — computeSync → writeSyncResult, gated on
 *                              existed && changed (backup-then-atomic; MEMORY.md).
 *
 * Every handler is wrapped so an engine throw becomes a 500 { error } and never
 * crashes the server. On a successful mutation the router best-effort broadcasts
 * `memory:changed` so an open ledger refreshes live.
 */

import { Router, type Request, type Response } from 'express';
import * as path from 'node:path';
import type { PlatformWsContext } from '../ws/index.js';
import type { RouteTarget } from '../../commands/memory/index.js';

const ROUTE_TARGETS: RouteTarget[] = ['habits', 'decisions', 'task', 'lore'];

export function createMemoryWriteRouter(projectDir: string, wsContext?: PlatformWsContext): Router {
  const router = Router();

  const loader = () => import('../../commands/memory/index.js');
  const notify = (): void => {
    try {
      wsContext?.broadcast?.({ type: 'memory:changed' });
    } catch {
      /* best-effort live nudge — never blocks the response */
    }
  };

  // POST /:id/prune — archive (never delete) a native-memory entry by id.
  router.post('/:id/prune', async (req: Request, res: Response) => {
    try {
      const { applyPrune } = await loader();
      const result = await applyPrune(projectDir, req.params.id);
      if (!result.ok) {
        const status = /No memory entry matches/.test(result.error ?? '') ? 404 : 409;
        res.status(status).json({ error: result.error });
        return;
      }
      notify();
      // `file` basenamed — never leak the absolute ~/.claude path.
      res.json({ ok: true, archived: result.archived, file: result.file ? path.basename(result.file) : result.file });
    } catch (err) {
      console.error('[memory] prune failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  // POST /:id/route { to } — route an entry into a typed home + archive source.
  router.post('/:id/route', async (req: Request, res: Response) => {
    try {
      const { to } = (req.body ?? {}) as { to?: string };
      if (!to || !ROUTE_TARGETS.includes(to as RouteTarget)) {
        res.status(400).json({ error: `route requires a \`to\` in: ${ROUTE_TARGETS.join(', ')}` });
        return;
      }
      const { applyRoute } = await loader();
      const result = await applyRoute(projectDir, req.params.id, to as RouteTarget);
      if (!result.ok) {
        const status = /No memory entry matches/.test(result.error ?? '') ? 404 : 409;
        res.status(status).json({ error: result.error });
        return;
      }
      notify();
      // `file` basenamed; `destination` is a project-relative home (lore/task id
      // or .paradigm-relative path), not a ~/.claude path — left as-is.
      res.json({ ok: true, destination: result.destination, archivedSource: result.archivedSource, file: result.file ? path.basename(result.file) : result.file });
    } catch (err) {
      console.error('[memory] route failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  // POST /merge { ids: string[] } — merge same-cluster near-duplicates. The ids
  // ride in the BODY (a merge is a set operation, not a single-resource verb).
  router.post('/merge', async (req: Request, res: Response) => {
    try {
      const { ids } = (req.body ?? {}) as { ids?: string[] };
      if (!Array.isArray(ids) || ids.length < 2) {
        res.status(400).json({ error: 'merge requires an `ids` array of at least two entries' });
        return;
      }
      const { applyMerge } = await loader();
      const result = await applyMerge(projectDir, ids);
      if (!result.ok) {
        const status = /No memory entry matches/.test(result.error ?? '') ? 404 : 409;
        res.status(status).json({ error: result.error });
        return;
      }
      notify();
      // primary/merged/archived are ids + basenames (no absolute path echoed).
      res.json({ ok: true, primary: result.primary, merged: result.merged, archived: result.archived });
    } catch (err) {
      console.error('[memory] merge failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  // POST /:id/pin — pin an entry so future reviews down-rank it.
  router.post('/:id/pin', async (req: Request, res: Response) => {
    try {
      const { applyPin } = await loader();
      const result = await applyPin(projectDir, req.params.id);
      if (!result.ok) {
        const status = /No memory entry matches/.test(result.error ?? '') ? 404 : 409;
        res.status(status).json({ error: result.error });
        return;
      }
      notify();
      // `file` basenamed — never leak the absolute ~/.claude path.
      res.json({ ok: true, pinned: result.pinned, file: result.file ? path.basename(result.file) : result.file });
    } catch (err) {
      console.error('[memory] pin failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  // POST /sync/write { projection? } — the gated lean-rewrite APPLY. computeSync
  // produces the plan; we write ONLY when there is a real MEMORY.md AND it would
  // change. writeSyncResult backs up MEMORY.md first, then writes atomically —
  // any error leaves the original byte-for-byte intact.
  router.post('/sync/write', async (req: Request, res: Response) => {
    try {
      const { projection } = (req.body ?? {}) as { projection?: boolean };
      const { computeSync, writeSyncResult } = await import('../../core/memory/sync.js');
      const result = await computeSync(projectDir, { project: projection === true });
      if (!result.existed || !result.changed) {
        res.json({ wrote: false, existed: result.existed, changed: result.changed });
        return;
      }
      const { backupPath } = writeSyncResult(result);
      notify();
      // backupPath basenamed — never leak the absolute ~/.claude path.
      res.json({ wrote: true, backupPath: path.basename(backupPath), bytesAfter: result.bytesAfter });
    } catch (err) {
      console.error('[memory] sync/write failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  return router;
}
