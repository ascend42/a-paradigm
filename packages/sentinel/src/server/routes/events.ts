/**
 * Generic Events API routes
 *
 * POST /api/events              — Ingest event batch { schemaId, service, events: [...] }
 * GET  /api/events              — Query events with filters
 * GET  /api/events/scopes       — Scope summaries (frames with counts, etc.)
 * GET  /api/events/scope/:value — All events within a single scope value
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';
import type { GenericEventInput } from '../../schema/types.js';
import type { SentinelServerConfig, GenericEvent } from '../../types.js';

export interface EventsRouterOptions {
  storage: SentinelStorage;
  serverConfig: SentinelServerConfig;
  onEventReceived?: (event: GenericEvent) => void;
}

export function createEventsRouter(options: EventsRouterOptions): Router {
  const router = Router();
  const { storage, serverConfig, onEventReceived } = options;

  let insertsSincePrune = 0;

  // POST /api/events — Ingest event batch
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body;

      if (!body.schemaId || !body.service || !Array.isArray(body.events)) {
        res.status(400).json({
          error: 'Expected { schemaId, service, events: [...] }',
        });
        return;
      }

      const { schemaId, service, events } = body as {
        schemaId: string;
        service: string;
        events: GenericEventInput[];
      };

      // Verify schema exists
      const schema = storage.getSchema(schemaId);
      if (!schema) {
        res.status(404).json({
          error: `Schema "${schemaId}" not found. Register it first via POST /api/schemas.`,
        });
        return;
      }

      // Enforce max batch size
      if (events.length > serverConfig.maxBatchSize) {
        res.status(413).json({
          error: `Batch too large: ${events.length} events, max ${serverConfig.maxBatchSize}`,
        });
        return;
      }

      // Validate required fields
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!e.type) {
          res.status(400).json({
            error: `events[${i}]: missing required field "type"`,
          });
          return;
        }
      }

      const result = storage.insertEventBatch(schemaId, service, events);

      // Broadcast to WebSocket subscribers
      if (onEventReceived) {
        // Build type→category map from schema for broadcast
        const typeMap = new Map<string, string>();
        for (const et of schema.eventTypes) {
          typeMap.set(et.type, et.category);
        }

        for (const input of events) {
          const evt: GenericEvent = {
            id: input.id || '',
            schemaId,
            eventType: input.type,
            category: typeMap.get(input.type) || 'unknown',
            timestamp: input.timestamp || new Date().toISOString(),
            scopeValue: input.scopeValue != null ? String(input.scopeValue) : undefined,
            sessionId: input.sessionId,
            service,
            data: input.data,
            severity: input.severity || 'info',
            parentEventId: input.parentEventId,
            depth: input.depth,
          };
          onEventReceived(evt);
        }
      }

      // Periodic prune
      insertsSincePrune += result.accepted;
      if (serverConfig.maxLogs > 0 && insertsSincePrune >= serverConfig.pruneIntervalInserts) {
        insertsSincePrune = 0;
        storage.pruneEvents(serverConfig.maxLogs);
      }

      res.json({
        accepted: result.accepted,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to ingest events' });
    }
  });

  // GET /api/events — Query events with filters
  router.get('/', (req: Request, res: Response) => {
    try {
      const query = {
        schemaId: req.query.schemaId as string | undefined,
        eventType: req.query.eventType as string | undefined,
        category: req.query.category as string | undefined,
        service: req.query.service as string | undefined,
        sessionId: req.query.sessionId as string | undefined,
        scopeValue: req.query.scopeValue as string | undefined,
        scopeFrom: req.query.scopeFrom as string | undefined,
        scopeTo: req.query.scopeTo as string | undefined,
        severity: req.query.severity as string | undefined,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const events = storage.queryEvents(query);
      const total = storage.getEventCount(query);

      res.json({ count: events.length, total, events });
    } catch (error) {
      res.status(500).json({ error: 'Failed to query events' });
    }
  });

  // GET /api/events/scopes — Scope summaries
  router.get('/scopes', (req: Request, res: Response) => {
    try {
      const schemaId = req.query.schemaId as string;
      if (!schemaId) {
        res.status(400).json({ error: 'schemaId query parameter is required' });
        return;
      }

      const scopes = storage.getEventScopes(schemaId, {
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        sessionId: req.query.sessionId as string | undefined,
      });

      res.json({ count: scopes.length, scopes });
    } catch (error) {
      res.status(500).json({ error: 'Failed to query scopes' });
    }
  });

  // GET /api/events/scope/:value — All events within a single scope value
  router.get('/scope/:value', (req: Request, res: Response) => {
    try {
      const schemaId = req.query.schemaId as string;
      if (!schemaId) {
        res.status(400).json({ error: 'schemaId query parameter is required' });
        return;
      }

      const events = storage.queryEventsByScope(schemaId, req.params.value);
      res.json({ count: events.length, events });
    } catch (error) {
      res.status(500).json({ error: 'Failed to query scope events' });
    }
  });

  return router;
}
