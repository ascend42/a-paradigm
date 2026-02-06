/**
 * Sentinel Server - Express server for the visualizer UI
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

import { createSymbolsRouter } from './routes/symbols.js';
import { createInfoRouter } from './routes/info.js';
import { createCommitsRouter } from './routes/commits.js';
import { createIncidentsRouter } from './routes/incidents.js';
import { createPatternsRouter } from './routes/patterns.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  port: number;
  projectDir: string;
  open?: boolean;
}

/**
 * Create the Express application with all routes configured
 */
export function createApp(options: ServerOptions): Express {
  const app = express();

  // Middleware
  app.use(express.json());

  // CORS for development
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // API routes
  app.use('/api/symbols', createSymbolsRouter(options.projectDir));
  app.use('/api/info', createInfoRouter(options.projectDir));
  app.use('/api/commits', createCommitsRouter(options.projectDir));
  app.use('/api/incidents', createIncidentsRouter(options.projectDir));
  app.use('/api/patterns', createPatternsRouter(options.projectDir));

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static UI files in production
  const uiDistPath = path.join(__dirname, '..', '..', 'ui', 'dist');
  if (fs.existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));

    // SPA fallback - serve index.html for non-API routes
    app.get('*', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(uiDistPath, 'index.html'));
      }
    });
  }

  return app;
}

/**
 * Start the Sentinel server
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const app = createApp(options);

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, () => {
      console.log(`Sentinel server running at http://localhost:${options.port}`);
      console.log(`Project: ${options.projectDir}`);

      if (options.open) {
        // Dynamic import for 'open' package
        import('open').then((openModule) => {
          openModule.default(`http://localhost:${options.port}`);
        }).catch(() => {
          console.log('Could not open browser automatically');
        });
      }

      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${options.port} is already in use`);
      }
      reject(err);
    });
  });
}

// Re-export loaders for use by CLI
export { loadSymbolIndex, loadParadigmConfig, getSymbolCount } from './loaders/symbols.js';
export { loadGitHistory, getSymbolsAtCommit } from './loaders/git.js';
export type { SymbolEntry, ParadigmConfig } from './loaders/symbols.js';
export type { CommitInfo } from './loaders/git.js';
