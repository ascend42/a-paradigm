/**
 * Project info API route
 */

import { Router, type Request, type Response } from 'express';
import { loadParadigmConfig, getSymbolCount } from '../loaders/symbols.js';

export function createInfoRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/info - Get project info
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const config = await loadParadigmConfig(projectDir);
      const symbolCount = await getSymbolCount(projectDir);

      res.json({
        projectName: config.name || null,
        discipline: config.discipline || null,
        symbolCount,
        projectDir,
      });
    } catch (error) {
      console.error('Failed to load project info:', error);
      res.status(500).json({ error: 'Failed to load project info' });
    }
  });

  return router;
}
