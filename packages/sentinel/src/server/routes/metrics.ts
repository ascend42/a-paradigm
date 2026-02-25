/**
 * Metrics API route
 *
 * POST /api/metrics  — Accept single metric or batch {entries: [...]}
 * GET  /api/metrics  — Query with filters
 * GET  /api/metrics/aggregate/:name — Get aggregation for a metric
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';
import type { MetricInput, MetricType, SentinelServerConfig } from '../../types.js';

export interface MetricsRouterOptions {
  storage: SentinelStorage;
  serverConfig: SentinelServerConfig;
}

const VALID_METRIC_TYPES = ['counter', 'gauge', 'histogram'];

export function createMetricsRouter(options: MetricsRouterOptions): Router {
  const router = Router();
  const { storage, serverConfig } = options;

  // POST /api/metrics — Accept single metric or batch
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body;
      let entries: MetricInput[];

      if (Array.isArray(body.entries)) {
        entries = body.entries;
      } else if (body.name && body.type && body.value !== undefined && body.service) {
        entries = [body];
      } else {
        res.status(400).json({
          error: 'Expected {entries: [...]} or a single metric with name, type, value, service',
        });
        return;
      }

      if (entries.length > serverConfig.maxBatchSize) {
        res.status(413).json({
          error: `Batch too large: ${entries.length} entries, max ${serverConfig.maxBatchSize}`,
        });
        return;
      }

      // Validate required fields
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.name || !e.type || e.value === undefined || !e.service) {
          res.status(400).json({
            error: `Entry ${i}: missing required fields (name, type, value, service)`,
          });
          return;
        }
        if (!VALID_METRIC_TYPES.includes(e.type)) {
          res.status(400).json({
            error: `Entry ${i}: invalid type "${e.type}", must be counter|gauge|histogram`,
          });
          return;
        }
      }

      const result = storage.insertMetricBatch(entries);
      res.json({
        accepted: result.accepted,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch {
      res.status(500).json({ error: 'Failed to insert metrics' });
    }
  });

  // GET /api/metrics — Query with filters
  router.get('/', (req: Request, res: Response) => {
    try {
      const options = {
        name: req.query.name as string | undefined,
        type: req.query.type as MetricType | undefined,
        service: req.query.service as string | undefined,
        tag: req.query.tag as string | undefined,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const metrics = storage.queryMetrics(options);
      const total = storage.getMetricCount(options);

      res.json({ count: metrics.length, total, metrics });
    } catch {
      res.status(500).json({ error: 'Failed to query metrics' });
    }
  });

  // GET /api/metrics/aggregate/:name — Get aggregation for a metric
  router.get('/aggregate/:name', (req: Request, res: Response) => {
    try {
      const aggregation = storage.aggregateMetric(req.params.name, {
        service: req.query.service as string | undefined,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
      });

      res.json(aggregation);
    } catch {
      res.status(500).json({ error: 'Failed to aggregate metric' });
    }
  });

  return router;
}
