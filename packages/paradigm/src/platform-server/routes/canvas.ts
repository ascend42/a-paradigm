/**
 * Canvas API routes — discover, read, write, and delete *.canvas files
 *
 * Canvas files are YAML files with a .canvas extension that can live
 * anywhere in the project. They are discovered via recursive glob.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build', '.paradigm',
  '.turbo', '.cache', 'coverage', '.output',
]);

/**
 * Recursively find all *.canvas files under a directory
 */
function findCanvasFiles(dir: string, rootDir: string): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        results.push(...findCanvasFiles(path.join(dir, entry.name), rootDir));
      }
    } else if (entry.isFile() && entry.name.endsWith('.canvas')) {
      results.push(path.relative(rootDir, path.join(dir, entry.name)));
    }
  }

  // Also check root-level dotless .canvas files (project root)
  return results;
}

// Simple TTL cache for file discovery
let cachedFiles: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds

function getCanvasFiles(projectDir: string): string[] {
  const now = Date.now();
  if (cachedFiles && now - cacheTimestamp < CACHE_TTL) {
    return cachedFiles;
  }

  // Also check project root for .canvas files directly
  const rootFiles = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.canvas'))
    .map(f => f); // already relative

  const nestedFiles = findCanvasFiles(projectDir, projectDir)
    .filter(f => !rootFiles.includes(f)); // deduplicate

  cachedFiles = [...rootFiles, ...nestedFiles];
  cacheTimestamp = now;
  return cachedFiles;
}

/**
 * Validate that a resolved path stays within the project directory
 */
function safePath(projectDir: string, requestedPath: string): string | null {
  const resolved = path.resolve(projectDir, requestedPath);
  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
    return null;
  }
  if (!resolved.endsWith('.canvas')) {
    return null;
  }
  return resolved;
}

export function createCanvasRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/canvas/files — list all *.canvas files in the project
  router.get('/files', (_req: Request, res: Response) => {
    try {
      const relativePaths = getCanvasFiles(projectDir);

      const files = relativePaths.map((relPath) => {
        const absPath = path.join(projectDir, relPath);
        try {
          const stat = fs.statSync(absPath);
          let name = path.basename(relPath, '.canvas');
          let description = '';

          try {
            const raw = yaml.load(fs.readFileSync(absPath, 'utf8')) as Record<string, unknown>;
            if (raw && typeof raw.name === 'string') name = raw.name;
            if (raw && typeof raw.description === 'string') description = raw.description;
          } catch { /* skip parse errors */ }

          return {
            path: relPath,
            name,
            description,
            modified: stat.mtime.toISOString(),
            size: stat.size,
          };
        } catch {
          return null;
        }
      }).filter(Boolean);

      // Sort by most recently modified
      files.sort((a, b) => b!.modified.localeCompare(a!.modified));
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list canvas files', details: (err as Error).message });
    }
  });

  // GET /api/canvas/files/* — load a specific canvas file
  router.get('/files/*', (req: Request, res: Response) => {
    const requestedPath = (req.params as Record<string, string>)[0] || req.params['path'] || '';
    if (!requestedPath) {
      res.status(400).json({ error: 'File path required' });
      return;
    }

    const absPath = safePath(projectDir, requestedPath);
    if (!absPath) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: `Canvas file not found: ${requestedPath}` });
      return;
    }

    try {
      const raw = fs.readFileSync(absPath, 'utf8');
      const parsed = yaml.load(raw);
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read canvas file', details: (err as Error).message });
    }
  });

  // PUT /api/canvas/files/* — create or update a canvas file
  router.put('/files/*', (req: Request, res: Response) => {
    const requestedPath = (req.params as Record<string, string>)[0] || req.params['path'] || '';
    if (!requestedPath) {
      res.status(400).json({ error: 'File path required' });
      return;
    }

    const absPath = safePath(projectDir, requestedPath);
    if (!absPath) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    try {
      const data = req.body;
      if (!data || typeof data !== 'object') {
        res.status(400).json({ error: 'Request body must be a JSON object' });
        return;
      }

      // Ensure timestamps
      const now = new Date().toISOString();
      if (!data.created) data.created = now;
      data.updated = now;

      // Ensure parent directory exists
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const yamlStr = yaml.dump(data, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });

      fs.writeFileSync(absPath, yamlStr, 'utf8');

      // Invalidate cache
      cachedFiles = null;

      res.json({ saved: true, path: requestedPath });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save canvas file', details: (err as Error).message });
    }
  });

  // DELETE /api/canvas/files/* — delete a canvas file
  router.delete('/files/*', (req: Request, res: Response) => {
    const requestedPath = (req.params as Record<string, string>)[0] || req.params['path'] || '';
    if (!requestedPath) {
      res.status(400).json({ error: 'File path required' });
      return;
    }

    const absPath = safePath(projectDir, requestedPath);
    if (!absPath) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: `Canvas file not found: ${requestedPath}` });
      return;
    }

    try {
      fs.unlinkSync(absPath);

      // Invalidate cache
      cachedFiles = null;

      res.json({ deleted: true, path: requestedPath });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete canvas file', details: (err as Error).message });
    }
  });

  return router;
}
