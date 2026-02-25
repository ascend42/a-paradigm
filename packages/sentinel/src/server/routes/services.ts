/**
 * Services & State API routes
 *
 * POST /api/services      — Register a service
 * GET  /api/services      — List registered services
 * POST /api/state         — Push app state snapshot
 * GET  /api/state         — Get all live app states
 * GET  /api/state/:service — Get state for specific service
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';

export interface ServicesRouterOptions {
  storage: SentinelStorage;
}

export function createServicesRouter(options: ServicesRouterOptions): Router {
  const router = Router();
  const { storage } = options;

  // POST /api/services — Register a service
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { name, version, pid, environment, metadata } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Missing required field: name' });
        return;
      }

      storage.registerService({ name, version, pid, environment, metadata });
      res.json({ success: true, service: name });
    } catch (error) {
      res.status(500).json({ error: 'Failed to register service' });
    }
  });

  // GET /api/services — List registered services
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const services = storage.getServices();
      res.json({ count: services.length, services });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list services' });
    }
  });

  return router;
}

export function createStateRouter(options: ServicesRouterOptions): Router {
  const router = Router();
  const { storage } = options;

  // POST /api/state — Push app state snapshot
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { service, sessionId, state, activeFlows, activeGates } = req.body;

      if (!service || !sessionId || !state) {
        res.status(400).json({ error: 'Missing required fields: service, sessionId, state' });
        return;
      }

      storage.upsertAppState({
        service,
        sessionId,
        timestamp: new Date().toISOString(),
        state,
        activeFlows,
        activeGates,
      });

      // Also update service last-seen
      storage.updateServiceLastSeen(service);

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update state' });
    }
  });

  // GET /api/state — Get all live app states
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const states = storage.getAllAppStates();
      res.json({ count: states.length, states });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get states' });
    }
  });

  // GET /api/state/:service — Get state for specific service
  router.get('/:service', async (req: Request, res: Response) => {
    try {
      const states = storage.getAppState(req.params.service);
      res.json({ count: states.length, states });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get service state' });
    }
  });

  return router;
}
