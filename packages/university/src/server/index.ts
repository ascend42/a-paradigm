/**
 * University Server - Express server for the learning platform UI
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

import { createCoursesRouter } from './routes/courses.js';
import { createPlsatRouter } from './routes/plsat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the package root by searching upward for package.json
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === '@a-company/university') return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const log = {
  component(name: string) {
    const symbol = chalk.magenta(`#${name}`);
    return {
      info: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.blue('ℹ')} ${symbol} ${msg}${dataStr}`);
      },
      success: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.green('✔')} ${symbol} ${msg}${dataStr}`);
      },
      warn: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.yellow('⚠')} ${symbol} ${msg}${dataStr}`);
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.error(`${chalk.red('✖')} ${symbol} ${msg}${dataStr}`);
      },
    };
  },
};

export interface ServerOptions {
  port: number;
  open?: boolean;
}

/**
 * Create the Express application with all routes configured
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // CORS for development
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // Content directory for JSON files — resolve relative to package root
  const packageRoot = findPackageRoot(__dirname);
  const contentDir = path.join(packageRoot, 'src', 'content');

  // API routes
  app.use('/api/courses', createCoursesRouter(contentDir));
  app.use('/api/plsat', createPlsatRouter(contentDir));

  // Reference cards
  app.get('/api/reference', (_req: Request, res: Response) => {
    const refPath = path.join(contentDir, 'reference.json');
    if (fs.existsSync(refPath)) {
      const data = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
      res.json(data);
    } else {
      res.status(404).json({ error: 'Reference data not found' });
    }
  });

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static UI files in production
  const uiDistPath = path.join(packageRoot, 'ui', 'dist');
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
 * Start the University server
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const app = createApp();

  log.component('university-server').info('Starting server', { port: options.port });

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, () => {
      log.component('university-server').success('Server running', { url: `http://localhost:${options.port}` });

      if (options.open) {
        import('open').then((openModule) => {
          openModule.default(`http://localhost:${options.port}`);
          log.component('university-server').info('Opened browser');
        }).catch(() => {
          log.component('university-server').warn('Could not open browser automatically');
        });
      }

      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.component('university-server').error('Port already in use', { port: options.port });
      } else {
        log.component('university-server').error('Server error', { error: err.message });
      }
      reject(err);
    });
  });
}
