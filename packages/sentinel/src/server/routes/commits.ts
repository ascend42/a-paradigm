/**
 * Commits API route - Git history
 */

import { Router, type Request, type Response } from 'express';
import { loadGitHistory } from '../loaders/git.js';

export function createCommitsRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/commits - Get commit history
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const since = req.query.since as string | undefined;

      const commits = await loadGitHistory(projectDir, { limit, since });
      res.json({ commits });
    } catch (error) {
      console.error('Failed to load commits:', error);
      res.status(500).json({ error: 'Failed to load commits' });
    }
  });

  return router;
}
