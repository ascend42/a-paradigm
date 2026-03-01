/**
 * Sentinel Server - Express server with WebSocket for real-time log streaming
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { WebSocketServer, WebSocket } from 'ws';

import { createSymbolsRouter } from './routes/symbols.js';
import { createInfoRouter } from './routes/info.js';
import { createCommitsRouter } from './routes/commits.js';
import { createIncidentsRouter } from './routes/incidents.js';
import { createPatternsRouter } from './routes/patterns.js';
import { createLogsRouter } from './routes/logs.js';
import { createServicesRouter, createStateRouter } from './routes/services.js';
import { createMetricsRouter } from './routes/metrics.js';
import { createTracesRouter } from './routes/traces.js';
import { createSchemasRouter } from './routes/schemas.js';
import { createEventsRouter } from './routes/events.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { SentinelStorage } from '../storage.js';
import { loadServerConfig } from '../config.js';
import { loadSymbolIndex } from './loaders/symbols.js';
import type { LogEntry, GenericEvent, SentinelServerConfig } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paradigm-style logger for server
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
  projectDir: string;
  open?: boolean;
  dbPath?: string;
  logPruneLimit?: number;
}

/**
 * Create the Express application with all routes configured
 */
export function createApp(options: ServerOptions & {
  storage?: SentinelStorage;
  serverConfig?: SentinelServerConfig;
  symbolIndex?: Array<{ symbol: string; type: string; filePath: string }>;
  onLogReceived?: (entry: LogEntry, validation?: { known: boolean; suggestion?: string }) => void;
  onEventReceived?: (event: GenericEvent) => void;
}): Express {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '5mb' }));

  // CORS — configurable origin via serverConfig.cors, defaults to '*'
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const corsOrigin = options.serverConfig?.cors?.origin;
    const origin = Array.isArray(corsOrigin) ? corsOrigin.join(', ') : (corsOrigin ?? '*');
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (options.serverConfig?.cors?.credentials) {
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Existing API routes (keep their own storage instances)
  app.use('/api/symbols', createSymbolsRouter(options.projectDir));
  app.use('/api/info', createInfoRouter(options.projectDir));
  app.use('/api/commits', createCommitsRouter(options.projectDir));
  app.use('/api/incidents', createIncidentsRouter(options.projectDir));
  app.use('/api/patterns', createPatternsRouter(options.projectDir));

  // New observability routes (shared storage)
  if (options.storage && options.serverConfig) {
    const config = options.serverConfig;

    // Auth middleware (only applied to observability routes when enabled)
    const auth = createAuthMiddleware(config.auth);

    // Rate limiting middleware
    const rateLimiter = createRateLimiter(config.rateLimit);

    // Write endpoints: auth(write) + rate limit
    app.use('/api/logs', rateLimiter, auth('write'), createLogsRouter({
      storage: options.storage,
      serverConfig: config,
      onLogReceived: options.onLogReceived,
      symbolIndex: options.symbolIndex,
    }));
    app.use('/api/services', rateLimiter, auth('write'), createServicesRouter({ storage: options.storage }));
    app.use('/api/state', rateLimiter, auth('write'), createStateRouter({ storage: options.storage }));
    app.use('/api/metrics', rateLimiter, auth('write'), createMetricsRouter({
      storage: options.storage,
      serverConfig: config,
    }));
    app.use('/api/traces', rateLimiter, auth('write'), createTracesRouter({
      storage: options.storage,
    }));

    // Schema-driven observability routes
    app.use('/api/schemas', rateLimiter, auth('write'), createSchemasRouter({
      storage: options.storage,
    }));
    app.use('/api/events', rateLimiter, auth('write'), createEventsRouter({
      storage: options.storage,
      serverConfig: config,
      onEventReceived: options.onEventReceived,
    }));
  }

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static UI files in production
  // Try multiple paths: standalone sentinel package, then bundled-into-paradigm
  const uiCandidates = [
    path.join(__dirname, '..', '..', 'ui', 'dist'),                    // standalone: sentinel/dist/ → sentinel/ui/dist
    path.join(__dirname, '..', '..', 'sentinel', 'ui', 'dist'),        // bundled monorepo: paradigm/dist/ → sentinel/ui/dist
    path.join(__dirname, '..', 'node_modules', '@a-company', 'sentinel', 'ui', 'dist'), // npm installed: paradigm/ → node_modules/@a-company/sentinel/ui/dist
  ];
  const uiDistPath = uiCandidates.find(p => fs.existsSync(p));
  if (uiDistPath) {
    app.use(express.static(uiDistPath));

    // SPA fallback - serve index.html for non-API routes
    // Express v5 requires named wildcard params
    app.get('{*path}', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(uiDistPath, 'index.html'));
      }
    });
  }

  return app;
}

/**
 * Start the Sentinel server with WebSocket support
 */
export async function startServer(options: ServerOptions): Promise<void> {
  // Load server config
  const serverConfig = loadServerConfig(options.projectDir);
  if (options.logPruneLimit !== undefined) {
    serverConfig.maxLogs = options.logPruneLimit;
  }

  // Create shared storage
  const storage = new SentinelStorage(options.dbPath);
  await storage.ensureReady();

  // Load symbol index for validation
  let symbolIndex: Array<{ symbol: string; type: string; filePath: string }> = [];
  try {
    symbolIndex = await loadSymbolIndex(options.projectDir);
  } catch {
    log.component('sentinel-server').warn('Could not load symbol index for validation');
  }

  // WebSocket subscriber tracking
  const wsClients = new Set<WebSocket>();

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  function broadcast(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Called when a log entry is received — broadcasts to WS subscribers
   */
  function onLogReceived(entry: LogEntry, validation?: { known: boolean; suggestion?: string }): void {
    const message: Record<string, unknown> = { type: 'log', entry };
    if (validation && !validation.known) {
      message.validation = validation;
    }

    broadcast(message);

    // Emit flow events for flow/signal/gate symbols
    if (entry.symbolType === 'signal' || entry.symbolType === 'gate' || entry.symbolType === 'flow') {
      broadcast({
        type: 'flow_event',
        flowId: entry.symbolType === 'flow' ? entry.symbol : undefined,
        nodeSymbol: entry.symbol,
        event: entry.symbolType,
        timestamp: entry.timestamp,
        service: entry.service,
      });
    }
  }

  /**
   * Called when a generic event is received — broadcasts to WS subscribers
   */
  function onEventReceived(event: GenericEvent): void {
    broadcast({ type: 'event', event });
  }

  const app = createApp({
    ...options,
    storage,
    serverConfig,
    symbolIndex,
    onLogReceived,
    onEventReceived,
  });

  log.component('sentinel-server').info('Starting server', { port: options.port });
  log.component('sentinel-server').info('Project directory', { path: options.projectDir });

  return new Promise((resolve, reject) => {
    const httpServer = http.createServer(app);

    // Create WebSocket server attached to the HTTP server
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      if (wsClients.size >= serverConfig.wsMaxSubscribers) {
        ws.close(1013, 'Max subscribers reached');
        return;
      }

      wsClients.add(ws);
      log.component('sentinel-ws').info('Client connected', { total: wsClients.size });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          // JSON-RPC 2.0 style messages
          if (msg.method === 'ping') {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              result: { pong: true, timestamp: new Date().toISOString() },
              id: msg.id,
            }));
          } else if (msg.method === 'subscribe') {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              result: { subscribed: true },
              id: msg.id,
            }));
          } else if (msg.method === 'query_logs') {
            const logs = storage.queryLogs(msg.params || {});
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              result: { logs },
              id: msg.id,
            }));
          } else if (msg.method === 'query_events') {
            const events = storage.queryEvents(msg.params || {});
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              result: { events },
              id: msg.id,
            }));
          } else if (msg.method === 'query_scopes') {
            const { schemaId, ...rest } = msg.params || {};
            const scopes = schemaId ? storage.getEventScopes(schemaId, rest) : [];
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              result: { scopes },
              id: msg.id,
            }));
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        wsClients.delete(ws);
        log.component('sentinel-ws').info('Client disconnected', { total: wsClients.size });
      });

      ws.on('error', () => {
        wsClients.delete(ws);
      });
    });

    httpServer.listen(options.port, () => {
      log.component('sentinel-server').success('Server running', { url: `http://localhost:${options.port}` });
      log.component('sentinel-ws').success('WebSocket ready', { url: `ws://localhost:${options.port}` });

      if (options.open) {
        import('open').then((openModule) => {
          openModule.default(`http://localhost:${options.port}`);
          log.component('sentinel-server').info('Opened browser');
        }).catch(() => {
          log.component('sentinel-server').warn('Could not open browser automatically');
        });
      }

      resolve();
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.component('sentinel-server').error('Port already in use', { port: options.port });
      } else {
        log.component('sentinel-server').error('Server error', { error: err.message });
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
