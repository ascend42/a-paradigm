/**
 * Info API Route - Project info
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export function createInfoRouter(projectDir: string): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const configPath = path.join(projectDir, '.paradigm', 'config.yaml');
    let project = path.basename(projectDir);

    if (fs.existsSync(configPath)) {
      try {
        const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        project = (config.project as string) || (config.name as string) || project;
      } catch {
        // Use default
      }
    }

    res.json({
      project,
      projectDir,
      paradigmVersion: '2.0',
    });
  });

  return router;
}
