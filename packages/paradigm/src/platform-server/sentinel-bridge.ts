/**
 * Sentinel Bridge — Mounts all Sentinel routes into the Platform server
 *
 * Dynamically imports @a-company/sentinel/server and creates an Express Router
 * with all observability routes mounted at sub-paths under /api/sentinel/.
 */

import { Router } from 'express';
import chalk from 'chalk';

const log = {
  component(name: string) {
    const symbol = chalk.magenta(`#${name}`);
    return {
      info: (msg: string) => console.log(`${chalk.blue('i')} ${symbol} ${msg}`),
      success: (msg: string) => console.log(`${chalk.green('+')} ${symbol} ${msg}`),
      warn: (msg: string) => console.log(`${chalk.yellow('!')} ${symbol} ${msg}`),
      error: (msg: string) => console.error(`${chalk.red('x')} ${symbol} ${msg}`),
    };
  },
};

/**
 * Create an Express Router with all Sentinel routes mounted.
 * Returns null if sentinel package is not available.
 */
export async function createSentinelBridge(
  projectDir: string,
  broadcast: (message: Record<string, unknown>) => void,
): Promise<Router | null> {
  try {
    // Dynamic import — graceful failure if sentinel not installed
    const sentinel = await import('@a-company/sentinel/server');
    const {
      SentinelStorage,
      loadServerConfig,
      loadSymbolIndex,
      PARADIGM_SCHEMA,
      SYMPHONY_SCHEMA,
      createLogsRouter,
      createServicesRouter,
      createStateRouter,
      createMetricsRouter,
      createTracesRouter,
      createSchemasRouter,
      createEventsRouter,
      createSymbolsRouter,
      createInfoRouter,
      createCommitsRouter,
      createIncidentsRouter,
      createPatternsRouter,
      createAuthMiddleware,
      createRateLimiter,
    } = sentinel;

    // Initialize storage
    const storage = new SentinelStorage();
    await storage.ensureReady();

    // Register builtin schemas
    storage.registerSchema(PARADIGM_SCHEMA);
    storage.registerSchema(SYMPHONY_SCHEMA);
    log.component('sentinel-bridge').info('Registered builtin schemas');

    // Load server config
    const serverConfig = loadServerConfig(projectDir);

    // Load symbol index for validation
    let symbolIndex: Array<{ symbol: string; type: string; filePath: string }> = [];
    try {
      symbolIndex = await loadSymbolIndex(projectDir);
    } catch {
      log.component('sentinel-bridge').warn('Could not load symbol index');
    }

    // Callbacks that broadcast to Platform WS clients
    function onLogReceived(entry: any, validation?: { known: boolean; suggestion?: string }): void {
      const message: Record<string, unknown> = { type: 'sentinel:log', entry };
      if (validation && !validation.known) {
        message.validation = validation;
      }
      broadcast(message);

      // Emit flow events for signal/gate/flow symbols
      if (entry.symbolType === 'signal' || entry.symbolType === 'gate' || entry.symbolType === 'flow') {
        broadcast({
          type: 'sentinel:flow_event',
          flowId: entry.symbolType === 'flow' ? entry.symbol : undefined,
          nodeSymbol: entry.symbol,
          event: entry.symbolType,
          timestamp: entry.timestamp,
          service: entry.service,
        });
      }
    }

    function onEventReceived(event: any): void {
      broadcast({ type: 'sentinel:event', event });
    }

    // Create router
    const router = Router();

    // Auth middleware + rate limiter
    const auth = createAuthMiddleware(serverConfig.auth);
    const rateLimiter = createRateLimiter(serverConfig.rateLimit);

    // Observability routes (auth + rate-limited)
    router.use('/logs', rateLimiter, auth('write'), createLogsRouter({
      storage,
      serverConfig,
      onLogReceived,
      symbolIndex,
    }));
    router.use('/services', rateLimiter, auth('write'), createServicesRouter({ storage }));
    router.use('/state', rateLimiter, auth('write'), createStateRouter({ storage }));
    router.use('/metrics', rateLimiter, auth('write'), createMetricsRouter({
      storage,
      serverConfig,
    }));
    router.use('/traces', rateLimiter, auth('write'), createTracesRouter({ storage }));
    router.use('/schemas', rateLimiter, auth('write'), createSchemasRouter({ storage }));
    router.use('/events', rateLimiter, auth('write'), createEventsRouter({
      storage,
      serverConfig,
      onEventReceived,
    }));

    // Disk-only routes (no auth needed)
    router.use('/symbols', createSymbolsRouter(projectDir));
    router.use('/info', createInfoRouter(projectDir));
    router.use('/commits', createCommitsRouter(projectDir));
    router.use('/incidents', createIncidentsRouter(projectDir));
    router.use('/patterns', createPatternsRouter(projectDir));

    return router;
  } catch (err) {
    log.component('sentinel-bridge').warn('Sentinel package not available — skipping');
    return null;
  }
}
