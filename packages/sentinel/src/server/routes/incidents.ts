/**
 * Incidents API route
 */

import { Router, type Request, type Response } from 'express';
import { SentinelStorage } from '../../storage.js';

export function createIncidentsRouter(_projectDir: string): Router {
  const router = Router();
  const storage = new SentinelStorage();

  // GET /api/incidents - Get recent incidents
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const status = req.query.status as string | undefined;
      const environment = req.query.environment as string | undefined;
      const symbol = req.query.symbol as string | undefined;

      const options: {
        limit: number;
        status?: 'open' | 'investigating' | 'resolved' | 'wont-fix';
        environment?: string;
        symbol?: string;
      } = { limit };

      if (status && ['open', 'investigating', 'resolved', 'wont-fix'].includes(status)) {
        options.status = status as 'open' | 'investigating' | 'resolved' | 'wont-fix';
      }
      if (environment) options.environment = environment;
      if (symbol) options.symbol = symbol;

      const incidents = storage.getRecentIncidents(options);

      // Transform to summary format for the UI
      const summaries = incidents.map((incident) => ({
        id: incident.id,
        timestamp: incident.timestamp,
        status: incident.status,
        error: {
          message: incident.error.message,
          type: incident.error.type,
        },
        symbols: incident.symbols,
        environment: incident.environment,
        patternMatches: [], // Would need PatternMatcher to populate
      }));

      res.json({ incidents: summaries });
    } catch (error) {
      console.error('Failed to load incidents:', error);
      res.status(500).json({ error: 'Failed to load incidents' });
    }
  });

  // GET /api/incidents/:id - Get single incident
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const incident = storage.getIncident(req.params.id);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }
      res.json({ incident });
    } catch (error) {
      console.error('Failed to load incident:', error);
      res.status(500).json({ error: 'Failed to load incident' });
    }
  });

  // POST /api/incidents/:id/resolve - Resolve an incident
  router.post('/:id/resolve', async (req: Request, res: Response) => {
    try {
      const incident = storage.getIncident(req.params.id);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }

      storage.resolveIncident(req.params.id, {
        notes: req.body.notes,
        patternId: req.body.patternId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to resolve incident:', error);
      res.status(500).json({ error: 'Failed to resolve incident' });
    }
  });

  return router;
}
