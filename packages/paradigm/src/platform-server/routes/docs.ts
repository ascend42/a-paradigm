/**
 * Docs Platform Routes — REST API for the Platform UI docs section
 */

import { Router, type Request, type Response } from 'express';
import {
  buildDocsManifest,
  buildSymbolPage,
  buildFlowPage,
  buildPortalPage,
  loadCustomPage,
  searchDocs,
  loadDocsConfig,
} from '../../../../paradigm-mcp/src/utils/docs-loader.js';

export function createDocsRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/docs/manifest
  router.get('/manifest', (_req: Request, res: Response) => {
    try {
      const config = loadDocsConfig(projectDir);
      const manifest = buildDocsManifest(projectDir, config);
      res.json(manifest);
    } catch (err) {
      res.status(500).json({ error: 'Failed to build docs manifest', detail: String(err) });
    }
  });

  // GET /api/docs/symbol/:id
  router.get('/symbol/:id', (req: Request, res: Response) => {
    try {
      const page = buildSymbolPage(projectDir, req.params.id);
      if (!page) {
        res.status(404).json({ error: `Symbol "${req.params.id}" not found` });
        return;
      }
      res.json(page);
    } catch (err) {
      res.status(500).json({ error: 'Failed to build symbol page', detail: String(err) });
    }
  });

  // GET /api/docs/flow/:id
  router.get('/flow/:id', (req: Request, res: Response) => {
    try {
      const page = buildFlowPage(projectDir, req.params.id);
      if (!page) {
        res.status(404).json({ error: `Flow "${req.params.id}" not found` });
        return;
      }
      res.json(page);
    } catch (err) {
      res.status(500).json({ error: 'Failed to build flow page', detail: String(err) });
    }
  });

  // GET /api/docs/portal
  router.get('/portal', (_req: Request, res: Response) => {
    try {
      const page = buildPortalPage(projectDir);
      res.json(page);
    } catch (err) {
      res.status(500).json({ error: 'Failed to build portal page', detail: String(err) });
    }
  });

  // GET /api/docs/page/:slug
  router.get('/page/:slug', (req: Request, res: Response) => {
    try {
      const config = loadDocsConfig(projectDir);
      const page = loadCustomPage(projectDir, req.params.slug, config);
      if (!page) {
        res.status(404).json({ error: `Page "${req.params.slug}" not found` });
        return;
      }
      res.json(page);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load custom page', detail: String(err) });
    }
  });

  // GET /api/docs/search?q=...
  router.get('/search', (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      if (!q) {
        res.json({ count: 0, results: [] });
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const results = searchDocs(projectDir, q, limit);
      res.json({ count: results.length, results });
    } catch (err) {
      res.status(500).json({ error: 'Failed to search docs', detail: String(err) });
    }
  });

  return router;
}
