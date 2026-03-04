/**
 * Symbol API routes for Graph UI
 * Reads scan-index.json and returns flattened symbol data
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export function createSymbolsRouter(projectDir: string): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const indexPath = path.join(projectDir, '.paradigm', 'scan-index.json');

    if (!fs.existsSync(indexPath)) {
      res.status(404).json({
        error: 'scan-index.json not found',
        hint: 'Run `paradigm scan` to generate the symbol index.',
      });
      return;
    }

    try {
      const raw = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(raw);

      const categoryMap: Record<string, string> = {
        components: 'component',
        features: 'component',
        flows: 'flow',
        state: 'component',
        gates: 'gate',
        signals: 'signal',
        aspects: 'aspect',
        screens: 'component',
      };

      const prefixMap: Record<string, string> = {
        component: '#',
        flow: '$',
        gate: '^',
        signal: '!',
        aspect: '~',
      };

      const symbols: Array<{
        id: string;
        name: string;
        category: string;
        prefix: string;
        description?: string;
        path?: string;
        tags?: string[];
        related?: string[];
      }> = [];

      const seen = new Set<string>();

      for (const [sectionKey, category] of Object.entries(categoryMap)) {
        const entries = index[sectionKey];
        if (!entries || typeof entries !== 'object') continue;

        const items = Array.isArray(entries) ? entries : Object.values(entries);

        for (const entry of items as Record<string, unknown>[]) {
          const name = (entry.name || entry.id || '') as string;
          if (!name || seen.has(name)) continue;
          seen.add(name);

          symbols.push({
            id: name,
            name,
            category,
            prefix: prefixMap[category] || '#',
            description: (entry.description || '') as string,
            path: (entry.path || entry.file || '') as string,
            tags: (entry.tags || []) as string[],
            related: (entry.related || []) as string[],
          });
        }
      }

      res.json({
        symbols,
        meta: {
          total: symbols.length,
          projectDir,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      res.status(500).json({
        error: 'Failed to read scan-index.json',
        details: (err as Error).message,
      });
    }
  });

  return router;
}
