/**
 * Tasks WRITE Routes — narrow, enforced action verbs over the v7 claimant DAG.
 *
 * The read router (tasks.ts) owns no storage and never mutates. THIS router adds
 * the agent-face write verbs the team review asked for (claim / start / done /
 * block / unblock) — but every verb PROXIES the same `updateTask` writer the
 * CLI/MCP use, so the state-machine (`assertTransition`) and the settlement /
 * learning chain fire identically. No raw DAG mutation, no enforcement bypass:
 * a browser POST is just another caller of the one enforced write path.
 *
 * On a successful settle (→ done) the router broadcasts an `agent:annotate`
 * badge on the task's first symbol so the board reflects the change live —
 * the same agent-effect channel Cid uses (review item #8, minimal form: the
 * full estimate-vs-actual delta needs captured actuals, which only orchestration
 * produces, so a UI settle emits a plain "done" badge for now).
 *
 * Endpoints (all POST, body = JSON):
 *   /:id/claim   { ref, kind? }   — set claimant (guarded: won't displace a human/peer)
 *   /:id/start                    — open → in-progress
 *   /:id/done                     — → done (fires settlement)
 *   /:id/block   { reason }       — set blocked_on (present-tense annotation)
 *   /:id/unblock                  — clear blocked_on
 */

import { Router, type Request, type Response } from 'express';
import type { PlatformWsContext } from '../ws/index.js';

type ClaimantKind = 'archetype' | 'human' | 'peer';

/** A task's first symbol (from its tags), for the live annotation. */
function firstSymbol(tags: string[] | undefined): string | undefined {
  return (tags ?? []).find(t => /^[#$^!~]/.test(t)) ?? (tags ?? [])[0];
}

export function createTasksWriteRouter(projectDir: string, wsContext: PlatformWsContext): Router {
  const router = Router();

  const loader = () => import('../../../../paradigm-mcp/src/utils/task-loader.js');

  // Best-effort OUTBOUND GitHub projection of a just-applied transition. Fire-
  // and-forget: never blocks the HTTP response, never throws (the local write
  // already committed). Linked tasks only; unlinked = zero-cost no-op.
  const fireSync = (taskId: string, event: 'claim' | 'start' | 'done' | 'shelved' | 'reopen' | 'block' | 'unblock', reason?: string): void => {
    void import('../../../../paradigm-mcp/src/sync/sync-layer.js')
      .then(({ projectTransition }) => projectTransition(projectDir, taskId, event, { reason }))
      .catch(() => { /* best-effort */ });
  };

  // POST /:id/claim — set claimant. Guard: an archetype/peer claim must not
  // displace an existing human or peer claim (mirrors the captain claim guard);
  // pass force=true to override (a human reassigning their own board).
  router.post('/:id/claim', async (req: Request, res: Response) => {
    try {
      const { loadTask, updateTask } = await loader();
      const task = await loadTask(projectDir, req.params.id);
      if (!task) { res.status(404).json({ error: `Task "${req.params.id}" not found` }); return; }

      const { ref, kind, force } = req.body as { ref?: string; kind?: ClaimantKind; force?: boolean };
      if (!ref) { res.status(400).json({ error: 'claim requires a `ref`' }); return; }
      const newKind: ClaimantKind = kind ?? 'archetype';

      const cur = task.claimant;
      const displacingProtected = cur && (cur.kind === 'human' || cur.kind === 'peer');
      const incomingIsArchetype = newKind === 'archetype';
      if (displacingProtected && incomingIsArchetype && !force) {
        res.status(409).json({ error: `Task is claimed by ${cur!.kind} ${cur!.ref}; an archetype claim cannot displace it`, claimant: cur });
        return;
      }

      const ok = await updateTask(projectDir, req.params.id, { claimant: { kind: newKind, ref } });
      if (!ok) { res.status(500).json({ error: 'claim write failed' }); return; }
      fireSync(req.params.id, 'claim');
      res.json({ claimed: true, id: req.params.id, claimant: { kind: newKind, ref } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim task', detail: String(err) });
    }
  });

  // POST /:id/start — open → in-progress (assertTransition enforced in updateTask).
  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const { updateTask } = await loader();
      const ok = await updateTask(projectDir, req.params.id, { status: 'in-progress' });
      if (!ok) { res.status(409).json({ error: 'start rejected — task not found or illegal transition (must be open)' }); return; }
      fireSync(req.params.id, 'start');
      res.json({ started: true, id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to start task', detail: String(err) });
    }
  });

  // POST /:id/done — → done. completeTask fires the settlement/learning chain.
  router.post('/:id/done', async (req: Request, res: Response) => {
    try {
      const { loadTask, completeTask } = await loader();
      const task = await loadTask(projectDir, req.params.id);
      if (!task) { res.status(404).json({ error: `Task "${req.params.id}" not found` }); return; }

      const ok = await completeTask(projectDir, req.params.id);
      if (!ok) { res.status(409).json({ error: 'done rejected — illegal transition (already terminal?)' }); return; }

      // Live board feedback: badge the task's symbol via the agent-effect channel.
      const sym = firstSymbol(task.tags);
      if (sym && !wsContext.userState.isMuted()) {
        wsContext.broadcast({
          type: 'agent:annotate',
          annotation: { type: 'badge', message: 'done', symbol: sym, severity: 'success', id: `settle-${req.params.id}` },
        });
      }
      // Outbound: a done task closes its linked GitHub issue (completed).
      fireSync(req.params.id, 'done');
      res.json({ done: true, id: req.params.id, annotated: Boolean(sym) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to complete task', detail: String(err) });
    }
  });

  // POST /:id/block — set blocked_on (present-tense; v7.0 has no `blocked` status).
  router.post('/:id/block', async (req: Request, res: Response) => {
    try {
      const { updateTask } = await loader();
      const { reason } = req.body as { reason?: string };
      if (!reason) { res.status(400).json({ error: 'block requires a `reason`' }); return; }
      const ok = await updateTask(projectDir, req.params.id, { blocked_on: reason });
      if (!ok) { res.status(404).json({ error: `Task "${req.params.id}" not found` }); return; }
      fireSync(req.params.id, 'block', reason);
      res.json({ blocked: true, id: req.params.id, reason });
    } catch (err) {
      res.status(500).json({ error: 'Failed to block task', detail: String(err) });
    }
  });

  // POST /:id/unblock — clear blocked_on (pruned from the YAML on write).
  router.post('/:id/unblock', async (req: Request, res: Response) => {
    try {
      const { updateTask } = await loader();
      const ok = await updateTask(projectDir, req.params.id, { blocked_on: undefined });
      if (!ok) { res.status(404).json({ error: `Task "${req.params.id}" not found` }); return; }
      fireSync(req.params.id, 'unblock');
      res.json({ unblocked: true, id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to unblock task', detail: String(err) });
    }
  });

  // POST /sync — INBOUND two-way pull. Reconciles linked GitHub issues back into
  // the task store through the SAME enforced writers (a pull never bypasses the
  // state machine). Body { ids?: string[] } syncs specific tasks; omitted = all
  // linked. Returns per-task verdicts (synced / agree / conflict / offline / …).
  // No remote state is accepted from the client — the server pulls it itself.
  router.post('/sync', async (req: Request, res: Response) => {
    try {
      const { syncTask, syncAllLinked } = await import('../../../../paradigm-mcp/src/sync/sync-layer.js');
      const { ids } = (req.body ?? {}) as { ids?: string[] };
      const verdicts = Array.isArray(ids) && ids.length > 0
        ? await Promise.all(ids.map(id => syncTask(projectDir, id)))
        : await syncAllLinked(projectDir);

      // Live board nudge: if anything actually changed, agents/board should refresh.
      const changed = verdicts.filter(v => v.status === 'synced');
      if (changed.length > 0 && !wsContext.userState.isMuted()) {
        wsContext.broadcast({ type: 'tasks:synced', count: changed.length, ids: changed.map(v => v.taskId) });
      }
      const summary = {
        synced: verdicts.filter(v => v.status === 'synced').length,
        conflict: verdicts.filter(v => v.status === 'conflict').length,
        agree: verdicts.filter(v => v.status === 'agree').length,
        skipped: verdicts.filter(v => ['offline', 'remote-error', 'unlinked', 'no-pull'].includes(v.status)).length,
      };
      res.json({ summary, verdicts });
    } catch (err) {
      res.status(500).json({ error: 'Failed to sync', detail: String(err) });
    }
  });

  return router;
}
