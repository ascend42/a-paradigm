/**
 * Memory Routes — the Memory Steward ledger, made web-reachable (Phase C1,
 * TD-2026-09-20-669).
 *
 * Until now the Memory Steward (the curation surface over Claude Code's NATIVE
 * memory store) was CLI/MCP-only — `paradigm memory review` / `sync` printed to a
 * terminal and nothing rendered the advisory digest in the Platform. This is a
 * thin, READ-ONLY fs-over-HTTP layer over the SAME pure engines the CLI calls:
 *   - buildDigest  (commands/memory) — scan → score → cluster → derive findings.
 *   - computeSync  (core/memory/sync) — the lean-rewrite PREVIEW (before/after,
 *                  demotions, dedup, optional projection).
 *
 * It owns NO storage and writes NOTHING. Deliberately calls `buildDigest`
 * directly (NOT `reviewCommand`, which writes remediations + a review stamp) and
 * `computeSync` (pure — the only mutator is the separate `writeSyncResult`, not
 * reachable here). C1 is display-only; apply/write buttons arrive in C2/C3.
 *
 * Endpoints (all GET):
 *   /review               — the advisory digest ({ root, scanned, pinned, items })
 *   /sync?projection=…    — the lean-rewrite preview (+ unified diff string;
 *                           NEVER the full before/after bodies — only `diff`)
 *
 * Fail-open: every handler is wrapped so an engine throw becomes a 500
 * { error } and never crashes the server.
 */

import { Router, type Request, type Response } from 'express';
import * as path from 'node:path';

export function createMemoryRouter(projectDir: string): Router {
  const router = Router();

  // GET /review — the advisory hygiene digest. Returns the native buildDigest
  // shape verbatim: { root, scanned, pinned, items: DigestItem[] }. Calls
  // buildDigest DIRECTLY (not reviewCommand) so no remediations/stamp are written.
  router.get('/review', async (_req: Request, res: Response) => {
    try {
      const { buildDigest } = await import('../../commands/memory/index.js');
      const digest = await buildDigest(projectDir);
      // Basename any absolute ~/.claude memory path before it leaves the server —
      // the UI keys off `id`, never the path. `root` is the project dir (not a
      // memory path) and is preserved as-is.
      res.json({
        ...digest,
        items: digest.items.map((item) => ({
          ...item,
          entryFile: path.basename(item.entryFile),
          target: item.target
            ? { ...item.target, file: item.target.file ? path.basename(item.target.file) : item.target.file }
            : item.target,
        })),
      });
    } catch (err) {
      console.error('[memory] /review failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  // GET /sync?projection=true|false — the lean-rewrite PREVIEW. computeSync is
  // pure (no write); we return its scalar/summary fields + the unified diff
  // STRING only. The full before/after bodies are intentionally withheld (they
  // can be large and contain the user's raw memory prose) — `diff` is enough for
  // the read-only panel.
  router.get('/sync', async (req: Request, res: Response) => {
    try {
      const projection = req.query.projection === 'true';
      const { computeSync, unifiedDiff } = await import('../../core/memory/sync.js');
      const result = await computeSync(projectDir, { project: projection });
      res.json({
        root: projectDir,
        // Basename only — never leak the absolute ~/.claude MEMORY.md path.
        memoryFile: path.basename(result.memoryFile),
        existed: result.existed,
        changed: result.changed,
        bytesBefore: result.bytesBefore,
        bytesAfter: result.bytesAfter,
        linesBefore: result.linesBefore,
        linesAfter: result.linesAfter,
        demoted: result.demoted,
        deduped: result.deduped,
        projectionEnabled: projection,
        projectionItems: result.projectionItems,
        // Only the diff — never the full before/after bodies.
        diff: result.existed && result.changed ? unifiedDiff(result.before, result.after) : '',
      });
    } catch (err) {
      console.error('[memory] /sync failed:', err);
      res.status(500).json({ error: 'memory operation failed' });
    }
  });

  return router;
}
