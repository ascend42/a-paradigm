/**
 * Platform Server - Unified Express server for Paradigm Platform
 *
 * Mounts existing lore and graph route handlers under a single port,
 * serves the platform-ui SPA, and provides platform-specific endpoints.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

import { createLoreRouter } from '../lore-server/routes/lore.js';
import { createInfoRouter } from '../lore-server/routes/info.js';
import { createSessionsRouter } from '../lore-server/routes/sessions.js';
import { createSymbolsRouter } from '../graph-server/routes/symbols.js';
import { createGraphsRouter } from '../graph-server/routes/graphs.js';
import { attachWebSocket } from './ws/index.js';
import { createAgentRouter } from './routes/agent.js';
import { createOverviewHandler } from './routes/overview.js';
import { createGitRouter } from './routes/git.js';
import { createAmbientRouter } from './routes/ambient.js';
import { createTeamRouter } from './routes/team.js';
import { createTasksRouter } from './routes/tasks.js';
import { createTasksWriteRouter } from './routes/tasks-write.js';

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

export interface PlatformServerOptions {
  port: number;
  projectDir: string;
  open?: boolean;
  sections?: string[];
  /**
   * Interface to bind. Defaults to '127.0.0.1' (loopback only) — this ENFORCES
   * the portal.yaml ^local-only gate at the socket, since that gate has no
   * request-time middleware. Set to '0.0.0.0' ONLY to intentionally expose the
   * platform on the LAN (it serves unauthenticated local-tooling routes).
   */
  host?: string;
}

/**
 * Detect if an optional package is available
 */
function isPackageAvailable(packageName: string): boolean {
  try {
    // Check if the package can be resolved
    require.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the set of enabled sections based on config and available packages
 */
function resolveSections(options: PlatformServerOptions): Set<string> {
  const always = ['overview', 'tasks', 'lore', 'graph', 'git', 'ambient', 'team'];
  const requested = options.sections ?? [...always, 'sentinel', 'university', 'symphony', 'docs', 'warpline'];

  const enabled = new Set<string>();
  for (const section of requested) {
    if (always.includes(section)) {
      enabled.add(section);
      continue;
    }
    // Auto-detect optional sections
    if (section === 'warpline') {
      // The Warpline engine ships as a hard workspace dependency of the CLI and
      // is bundled into the dist (the router imports it in-process), so it is
      // always present — always-enable, like `university`. If the engine import
      // ever fails at mount time, the router mount in startPlatformServer is
      // try/caught and the section simply won't respond. Read-only Oracle/
      // forecast/diff over HTTP.
      enabled.add(section);
    } else if (section === 'sentinel') {
      // Check if sentinel server routes exist (bundled in same dist)
      const sentinelRoutesPath = path.join(options.projectDir, '.paradigm');
      if (fs.existsSync(sentinelRoutesPath)) {
        enabled.add(section);
      }
    } else if (section === 'university') {
      enabled.add(section);
    } else if (section === 'symphony') {
      // Check if Symphony mailbox directory exists
      const mailDir = path.join(process.env.HOME || '~', '.paradigm', 'score');
      if (fs.existsSync(mailDir)) {
        enabled.add(section);
      }
    } else {
      enabled.add(section);
    }
  }

  return enabled;
}

/**
 * Create the unified Express application
 */
export function createPlatformApp(options: PlatformServerOptions): Express {
  const app = express();
  const sections = resolveSections(options);

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

  // === Lore routes (always mounted) ===
  app.use('/api/lore', createLoreRouter(options.projectDir));
  app.use('/api/info', createInfoRouter(options.projectDir));
  app.use('/api/sessions', createSessionsRouter(options.projectDir));

  // === Graph routes (always mounted) ===
  app.use('/api/symbols', createSymbolsRouter(options.projectDir));
  app.use('/api/graphs', createGraphsRouter(options.projectDir));

  // === Overview aggregation ===
  app.get('/api/platform/overview', createOverviewHandler(options.projectDir));

  // === Git management ===
  app.use('/api/git', createGitRouter(options.projectDir));

  // === Platform-specific routes ===
  app.get('/api/platform/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      sections: Array.from(sections),
    });
  });

  app.get('/api/platform/sections', (_req: Request, res: Response) => {
    res.json({ sections: Array.from(sections) });
  });

  // === Health check ===
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // === Agent command route (mounted at start, wired to WS context later) ===
  // Placeholder — actual router attached in startPlatformServer after WS is ready
  app.set('agentRouterSlot', true);

  // === Serve platform-ui static files ===
  // After bundling, __dirname is dist/. In source, it's src/platform-server/.
  let uiDistPath = path.join(__dirname, '..', 'platform-ui', 'dist');
  if (!fs.existsSync(uiDistPath)) {
    uiDistPath = path.join(__dirname, '..', '..', 'platform-ui', 'dist');
  }
  if (fs.existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));

    // SPA fallback (Express 5 requires named wildcard param)
    app.get('{*path}', (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(uiDistPath, 'index.html'));
      } else {
        next();
      }
    });
  } else {
    // Dev fallback
    app.get('/', (_req: Request, res: Response) => {
      res.send(`
        <html>
        <head><title>Paradigm Platform</title></head>
        <body style="background:#0d1117;color:#e6edf3;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h1 style="font-size:2rem;margin-bottom:8px">Paradigm Platform</h1>
            <p style="color:#8b949e">UI not built yet. Run <code style="background:#21262d;padding:4px 8px;border-radius:4px">cd platform-ui && npx vite build</code></p>
            <p style="color:#8b949e;margin-top:16px">APIs available:</p>
            <p><a href="/api/lore" style="color:#58a6ff">/api/lore</a> &middot; <a href="/api/symbols" style="color:#58a6ff">/api/symbols</a> &middot; <a href="/api/platform/health" style="color:#58a6ff">/api/platform/health</a></p>
          </div>
        </body>
        </html>
      `);
    });
  }

  return app;
}

/**
 * Start the Platform server with WebSocket support
 */
export async function startPlatformServer(options: PlatformServerOptions): Promise<void> {
  const app = createPlatformApp(options);
  const sections = resolveSections(options);

  log.component('platform-server').info('Starting Paradigm Platform', { port: options.port });
  log.component('platform-server').info('Project directory', { path: options.projectDir });
  log.component('platform-server').info('Sections', { enabled: Array.from(sections).join(', ') });

  const httpServer = http.createServer(app);

  // Attach WebSocket server to the HTTP server
  const wsContext = attachWebSocket(httpServer);

  // Mount agent command route with WS context
  app.use('/api/platform/agent-command', createAgentRouter(wsContext));

  // Mount ambient coordination routes (always available)
  app.use('/api/ambient', createAmbientRouter(options.projectDir, wsContext));

  // Mount team routes (always available — Maestro orchestration display)
  app.use('/api/team', createTeamRouter(options.projectDir));

  // Mount Tasks routes (always available — the v7 claimant DAG, read-only over HTTP)
  app.use('/api/tasks', createTasksRouter(options.projectDir));

  // Mount Tasks WRITE routes (enforced action verbs — claim/start/done/block;
  // each proxies the same updateTask state-machine path the CLI/MCP use).
  app.use('/api/tasks', createTasksWriteRouter(options.projectDir, wsContext));

  // Background two-way GitHub sync poll. Every SYNC_POLL_MS, pull linked issues
  // and reconcile inbound through the SAME enforced writers (a poll never
  // bypasses the state machine), broadcasting `tasks:synced` when anything
  // changed so the board reflects GitHub without a manual sync. Self-skips when
  // no task is github-linked or gh is unavailable; non-overlapping; dies with
  // the process. Disable with PARADIGM_SYNC_POLL=off.
  if (process.env.PARADIGM_SYNC_POLL !== 'off') {
    const SYNC_POLL_MS = Math.max(30_000, parseInt(process.env.PARADIGM_SYNC_POLL_MS || '120000', 10) || 120_000);
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const { syncAllLinked } = await import('../../../paradigm-mcp/src/sync/sync-layer.js');
        const verdicts = await syncAllLinked(options.projectDir);
        const changed = verdicts.filter(v => v.status === 'synced');
        const conflicts = verdicts.filter(v => v.status === 'conflict');
        if (changed.length > 0) {
          wsContext.broadcast({ type: 'tasks:synced', count: changed.length, ids: changed.map(v => v.taskId), source: 'poll' });
          log.component('platform-server').info('GitHub sync poll applied changes', { changed: changed.length });
        }
        if (conflicts.length > 0) {
          wsContext.broadcast({ type: 'tasks:sync-conflict', count: conflicts.length, ids: conflicts.map(v => v.taskId) });
        }
      } catch {
        /* best-effort — a poll failure never disrupts the server */
      } finally {
        polling = false;
      }
    }, SYNC_POLL_MS);
    timer.unref?.();
  }

  // Mount Warpline routes if section is enabled (read-only Oracle/forecast/diff
  // over HTTP — no reachable write path; passes wsContext for the ledger watch
  // → !oracle-record-appended broadcast).
  if (sections.has('warpline')) {
    try {
      const { createWarplineRouter } = await import('./routes/warpline.js');
      app.use('/api/warpline', createWarplineRouter(options.projectDir, wsContext));
      log.component('platform-server').success('Warpline routes mounted');
    } catch (err) {
      log.component('platform-server').warn('Warpline routes failed to mount');
    }
  }

  // Mount Sentinel routes if section is enabled
  if (sections.has('sentinel')) {
    try {
      const { createSentinelBridge } = await import('./sentinel-bridge.js');
      const sentinelRouter = await createSentinelBridge(options.projectDir, wsContext.broadcast);
      if (sentinelRouter) {
        app.use('/api/sentinel', sentinelRouter);
        log.component('platform-server').success('Sentinel routes mounted');
      }
    } catch {
      log.component('platform-server').warn('Sentinel not available');
    }
  }

  // Mount Symphony routes if section is enabled
  if (sections.has('symphony')) {
    try {
      const { createSymphonyRouter } = await import('./routes/symphony.js');
      app.use('/api/symphony', createSymphonyRouter(options.projectDir, wsContext.broadcast));
      log.component('platform-server').success('Symphony routes mounted');
    } catch (err) {
      log.component('platform-server').warn('Symphony routes failed to mount');
    }
  }

  // Mount Docs routes if section is enabled
  if (sections.has('docs')) {
    try {
      const { createDocsRouter } = await import('./routes/docs.js');
      app.use('/api/docs', createDocsRouter(options.projectDir));
      log.component('platform-server').success('Docs routes mounted');
    } catch (err) {
      log.component('platform-server').warn('Docs routes failed to mount');
    }
  }

  // Mount University routes if section is enabled
  if (sections.has('university')) {
    try {
      const { createUniversityRouter } = await import('./routes/university.js');
      app.use('/api/university', createUniversityRouter(options.projectDir));
      log.component('platform-server').success('University routes mounted');
    } catch (err) {
      log.component('platform-server').warn('University routes failed to mount');
    }
  }

  // Bind loopback by default so the ^local-only portal gate is enforced at the
  // socket (there is no request-time hostname middleware). Override via options.host.
  const bindHost = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    httpServer.listen(options.port, bindHost, () => {
      log.component('platform-server').success('Platform running', { url: `http://localhost:${options.port}` });
      log.component('platform-ws').success('WebSocket ready', { url: `ws://localhost:${options.port}/ws` });
      console.log('');
      console.log(chalk.gray('  Sections:'));
      for (const section of sections) {
        console.log(chalk.gray(`    ${chalk.cyan('●')} ${section}`));
      }
      console.log('');

      if (options.open) {
        import('open').then((openModule) => {
          openModule.default(`http://localhost:${options.port}`);
          log.component('platform-server').info('Opened browser');
        }).catch(() => {
          log.component('platform-server').warn('Could not open browser automatically');
        });
      }

      resolve();
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.component('platform-server').error('Port already in use', { port: options.port });
      } else {
        log.component('platform-server').error('Server error', { error: err.message });
      }
      reject(err);
    });
  });
}
