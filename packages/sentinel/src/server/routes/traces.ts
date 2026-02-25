/**
 * Distributed Tracing API route
 *
 * POST /api/traces   — Submit a trace span
 * GET  /api/traces   — Query traces
 * GET  /api/traces/:traceId — Get full trace view
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';

export interface TracesRouterOptions {
  storage: SentinelStorage;
}

export function createTracesRouter(options: TracesRouterOptions): Router {
  const router = Router();
  const { storage } = options;

  // POST /api/traces — Submit a trace span
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body;

      if (!body.traceId || !body.service || !body.symbol || !body.operation) {
        res.status(400).json({
          error: 'Missing required fields: traceId, service, symbol, operation',
        });
        return;
      }

      const spanId = storage.insertSpan(body);
      res.json({ spanId, traceId: body.traceId });
    } catch {
      res.status(500).json({ error: 'Failed to insert trace span' });
    }
  });

  // GET /api/traces — Query traces
  router.get('/', (req: Request, res: Response) => {
    try {
      const traces = storage.queryTraces({
        service: req.query.service as string | undefined,
        symbol: req.query.symbol as string | undefined,
        since: req.query.since as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      });

      res.json({ count: traces.length, traces });
    } catch {
      res.status(500).json({ error: 'Failed to query traces' });
    }
  });

  // GET /api/traces/:traceId — Get full trace view
  router.get('/:traceId', (req: Request, res: Response) => {
    try {
      const trace = storage.getTrace(req.params.traceId);

      if (!trace) {
        res.status(404).json({ error: 'Trace not found' });
        return;
      }

      res.json(trace);
    } catch {
      res.status(500).json({ error: 'Failed to get trace' });
    }
  });

  return router;
}
