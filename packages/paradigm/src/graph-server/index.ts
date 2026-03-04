/**
 * Graph Server - Express server for the Symbol Graph UI
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

import { createSymbolsRouter } from './routes/symbols.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = {
  component(name: string) {
    const symbol = chalk.magenta(`#${name}`);
    return {
      info: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.blue('i')} ${symbol} ${msg}${dataStr}`);
      },
      success: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.green('+')} ${symbol} ${msg}${dataStr}`);
      },
      warn: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.yellow('!')} ${symbol} ${msg}${dataStr}`);
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.error(`${chalk.red('x')} ${symbol} ${msg}${dataStr}`);
      },
    };
  },
};

export interface GraphServerOptions {
  port: number;
  projectDir: string;
  open?: boolean;
}

/**
 * Create the Express application
 */
export function createGraphApp(options: GraphServerOptions): Express {
  const app = express();

  app.use(express.json());

  // CORS
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // API routes
  app.use('/api/symbols', createSymbolsRouter(options.projectDir));

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static UI files
  let uiDistPath = path.join(__dirname, '..', 'graph-ui', 'dist');
  if (!fs.existsSync(uiDistPath)) {
    uiDistPath = path.join(__dirname, '..', '..', 'graph-ui', 'dist');
  }
  if (fs.existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));

    // SPA fallback
    app.get('{*path}', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(uiDistPath, 'index.html'));
      }
    });
  } else {
    // Dev fallback
    app.get('/', (_req: Request, res: Response) => {
      res.send(`
        <html>
        <head><title>Paradigm Graph</title></head>
        <body style="background:#0a0a0f;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h1>Paradigm Graph</h1>
            <p style="color:#94a3b8">UI not built yet. Run <code style="background:#1e293b;padding:4px 8px;border-radius:4px">cd graph-ui && npx vite build</code></p>
            <p style="color:#94a3b8">API available at <a href="/api/symbols" style="color:#7dd3fc">/api/symbols</a></p>
          </div>
        </body>
        </html>
      `);
    });
  }

  return app;
}

/**
 * Start the Graph server
 */
export async function startGraphServer(options: GraphServerOptions): Promise<void> {
  const app = createGraphApp(options);

  log.component('graph-server').info('Starting server', { port: options.port });
  log.component('graph-server').info('Project directory', { path: options.projectDir });

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, () => {
      log.component('graph-server').success('Server running', { url: `http://localhost:${options.port}` });

      if (options.open) {
        import('open').then((openModule) => {
          openModule.default(`http://localhost:${options.port}`);
          log.component('graph-server').info('Opened browser');
        }).catch(() => {
          log.component('graph-server').warn('Could not open browser automatically');
        });
      }

      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.component('graph-server').error('Port already in use', { port: options.port });
      } else {
        log.component('graph-server').error('Server error', { error: err.message });
      }
      reject(err);
    });
  });
}
