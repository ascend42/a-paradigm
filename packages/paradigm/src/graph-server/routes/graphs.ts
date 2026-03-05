/**
 * Graph file API routes — list and serve saved .graph.json files
 * from .paradigm/graphs/
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const GRAPHS_DIR = '.paradigm/graphs';

export function createGraphsRouter(projectDir: string): Router {
  const router = Router();
  const graphsPath = path.join(projectDir, GRAPHS_DIR);

  // GET /api/graphs — list saved graphs
  router.get('/', (_req: Request, res: Response) => {
    if (!fs.existsSync(graphsPath)) {
      res.json({ graphs: [] });
      return;
    }

    try {
      const files = fs.readdirSync(graphsPath).filter((f) => f.endsWith('.graph.json'));
      const graphs = files.map((file) => {
        const filePath = path.join(graphsPath, file);
        const stat = fs.statSync(filePath);
        const slug = file.replace(/\.graph\.json$/, '');

        // Read just the top-level metadata without parsing all nodes
        let name = slug;
        let nodeCount = 0;
        let edgeCount = 0;
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          name = raw.name || slug;
          nodeCount = Array.isArray(raw.nodes) ? raw.nodes.length : 0;
          edgeCount = Array.isArray(raw.edges) ? raw.edges.length : 0;
        } catch { /* skip parse errors */ }

        return {
          slug,
          file,
          name,
          nodes: nodeCount,
          edges: edgeCount,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      });

      // Sort by most recently modified
      graphs.sort((a, b) => b.modified.localeCompare(a.modified));
      res.json({ graphs });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list graphs', details: (err as Error).message });
    }
  });

  // GET /api/graphs/:slug — load a specific graph
  router.get('/:slug', (req: Request, res: Response) => {
    const slug = req.params.slug;
    const filePath = path.join(graphsPath, `${slug}.graph.json`);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Graph "${slug}" not found` });
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      res.type('application/json').send(raw);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read graph', details: (err as Error).message });
    }
  });

  return router;
}
