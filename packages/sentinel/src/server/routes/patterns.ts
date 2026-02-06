/**
 * Patterns API route
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';

export function createPatternsRouter(_projectDir: string): Router {
  const router = Router();
  const storage = new SentinelStorage();

  // GET /api/patterns - Get all patterns
  router.get('/', async (req: Request, res: Response) => {
    try {
      const source = req.query.source as string | undefined;
      const symbol = req.query.symbol as string | undefined;
      const minConfidence = parseInt(req.query.minConfidence as string) || undefined;

      const options: {
        source?: 'manual' | 'suggested' | 'imported' | 'community';
        symbol?: string;
        minConfidence?: number;
      } = {};

      if (source && ['manual', 'suggested', 'imported', 'community'].includes(source)) {
        options.source = source as 'manual' | 'suggested' | 'imported' | 'community';
      }
      if (symbol) options.symbol = symbol;
      if (minConfidence) options.minConfidence = minConfidence;

      const patterns = storage.getAllPatterns(options);

      // Transform to summary format for the UI
      const summaries = patterns.map((pattern) => ({
        id: pattern.id,
        name: pattern.name,
        description: pattern.description,
        confidence: {
          score: pattern.confidence.score,
          timesMatched: pattern.confidence.timesMatched,
          timesResolved: pattern.confidence.timesResolved,
        },
        tags: pattern.tags,
      }));

      res.json({ patterns: summaries });
    } catch (error) {
      console.error('Failed to load patterns:', error);
      res.status(500).json({ error: 'Failed to load patterns' });
    }
  });

  // GET /api/patterns/:id - Get single pattern
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const pattern = storage.getPattern(req.params.id);
      if (!pattern) {
        res.status(404).json({ error: 'Pattern not found' });
        return;
      }
      res.json({ pattern });
    } catch (error) {
      console.error('Failed to load pattern:', error);
      res.status(500).json({ error: 'Failed to load pattern' });
    }
  });

  return router;
}
