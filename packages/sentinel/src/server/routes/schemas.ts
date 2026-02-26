/**
 * Schema Registry API routes
 *
 * POST /api/schemas       — Register/update schema (upsert by id)
 * GET  /api/schemas       — List all registered schemas
 * GET  /api/schemas/:id   — Get specific schema
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';
import type { EventSchemaDeclaration } from '../../schema/types.js';

export interface SchemasRouterOptions {
  storage: SentinelStorage;
}

export function createSchemasRouter(options: SchemasRouterOptions): Router {
  const router = Router();
  const { storage } = options;

  // POST /api/schemas — Register or update a schema
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body as EventSchemaDeclaration;

      if (!body.id || !body.version || !body.name || !body.scope || !body.eventTypes) {
        res.status(400).json({
          error: 'Missing required fields: id, version, name, scope, eventTypes',
        });
        return;
      }

      if (!body.scope.field || !body.scope.type || !body.scope.label || !body.scope.ordering) {
        res.status(400).json({
          error: 'Invalid scope: requires field, type, label, ordering',
        });
        return;
      }

      if (!Array.isArray(body.eventTypes) || body.eventTypes.length === 0) {
        res.status(400).json({
          error: 'eventTypes must be a non-empty array',
        });
        return;
      }

      for (let i = 0; i < body.eventTypes.length; i++) {
        const et = body.eventTypes[i];
        if (!et.type || !et.category) {
          res.status(400).json({
            error: `eventTypes[${i}]: missing required fields (type, category)`,
          });
          return;
        }
      }

      const schema = storage.registerSchema(body);
      res.status(201).json(schema);
    } catch (error) {
      res.status(500).json({ error: 'Failed to register schema' });
    }
  });

  // GET /api/schemas — List all schemas
  router.get('/', (_req: Request, res: Response) => {
    try {
      const schemas = storage.listSchemas();
      res.json({ count: schemas.length, schemas });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list schemas' });
    }
  });

  // GET /api/schemas/:id — Get specific schema
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const schema = storage.getSchema(req.params.id);
      if (!schema) {
        res.status(404).json({ error: 'Schema not found' });
        return;
      }
      res.json(schema);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get schema' });
    }
  });

  return router;
}
