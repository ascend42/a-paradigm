/**
 * PLSAT (Paradigm Licensure Standardized Assessment Test) API routes
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export function createPlsatRouter(contentDir: string): Router {
  const router = Router();

  // GET /api/plsat - Get available PLSAT versions
  router.get('/', (_req: Request, res: Response) => {
    const plsatDir = path.join(contentDir, 'plsat');
    if (!fs.existsSync(plsatDir)) {
      return res.json({ versions: [] });
    }

    const files = fs.readdirSync(plsatDir).filter(f => f.endsWith('.json'));
    const versions = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(plsatDir, f), 'utf-8'));
      return {
        version: data.version,
        frameworkVersion: data.frameworkVersion,
        questionCount: data.questions?.length || 0,
        timeLimit: data.timeLimit,
        passThreshold: data.passThreshold,
      };
    });

    versions.sort((a, b) => b.version.localeCompare(a.version));
    res.json({ versions });
  });

  // GET /api/plsat/:version - Get full exam for a specific version
  router.get('/:version', (req: Request, res: Response) => {
    const examFile = path.join(contentDir, 'plsat', `v${req.params.version}.json`);
    if (!fs.existsSync(examFile)) {
      return res.status(404).json({ error: `PLSAT version '${req.params.version}' not found` });
    }

    const data = JSON.parse(fs.readFileSync(examFile, 'utf-8'));

    // Shuffle questions for each attempt
    const shuffled = [...data.questions].sort(() => Math.random() - 0.5);

    res.json({
      ...data,
      questions: shuffled,
    });
  });

  return router;
}
