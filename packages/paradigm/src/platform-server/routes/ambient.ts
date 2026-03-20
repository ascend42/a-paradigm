/**
 * Ambient Coordination Routes
 *
 * REST + SSE endpoints for the Platform ambient section:
 * event stream queries, nomination management, real-time streaming,
 * and data policy retrieval.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { PlatformWsContext } from '../ws/index.js';

// ── Types ────────────────────────────────────────────────────────────

interface AmbientEvent {
  id?: string;
  type?: string;
  source?: string;
  symbol?: string;
  agent?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Nomination {
  id?: string;
  agent?: string;
  symbol?: string;
  urgency?: string;
  reason?: string;
  timestamp?: string;
  engaged?: boolean;
  response?: string;
  [key: string]: unknown;
}

interface Debate {
  nominationId?: string;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────

function readJsonlSafe<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const results: T[] = [];

    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines
      }
    }

    return results;
  } catch {
    return [];
  }
}

function writeJsonl<T>(filePath: string, items: T[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = items.map(item => JSON.stringify(item)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Parse a relative time string like "1h", "30m", "2d" into a Date.
 * Returns null if the string is not a recognized format.
 */
function parseSince(since: string): Date | null {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Date.now();

  switch (unit) {
    case 'm': return new Date(now - value * 60 * 1000);
    case 'h': return new Date(now - value * 60 * 60 * 1000);
    case 'd': return new Date(now - value * 24 * 60 * 60 * 1000);
    default: return null;
  }
}

// ── Router ───────────────────────────────────────────────────────────

export function createAmbientRouter(projectDir: string, wsContext: PlatformWsContext): Router {
  const router = Router();

  const eventsPath = path.join(projectDir, '.paradigm', 'events', 'stream.jsonl');
  const nominationsPath = path.join(projectDir, '.paradigm', 'events', 'nominations.jsonl');
  const debatesPath = path.join(projectDir, '.paradigm', 'events', 'debates.jsonl');
  const policyPath = path.join(projectDir, '.paradigm', 'data-policy.yaml');

  // ── GET /events ─────────────────────────────────────────────

  router.get('/events', (req: Request, res: Response) => {
    try {
      const {
        type: typeFilter,
        source: sourceFilter,
        symbol: symbolFilter,
        agent: agentFilter,
        since: sinceParam,
        limit: limitParam,
      } = req.query as Record<string, string | undefined>;

      const limit = limitParam ? parseInt(limitParam, 10) : 50;
      const sinceDate = sinceParam ? parseSince(sinceParam) : null;

      let events = readJsonlSafe<AmbientEvent>(eventsPath);

      // Apply filters
      if (typeFilter) {
        events = events.filter(e => e.type === typeFilter);
      }
      if (sourceFilter) {
        events = events.filter(e => e.source === sourceFilter);
      }
      if (symbolFilter) {
        events = events.filter(e => e.symbol === symbolFilter);
      }
      if (agentFilter) {
        events = events.filter(e => e.agent === agentFilter);
      }
      if (sinceDate) {
        events = events.filter(e => {
          if (!e.timestamp) return false;
          return new Date(e.timestamp).getTime() >= sinceDate.getTime();
        });
      }

      // Take most recent entries up to the limit
      const result = events.slice(-limit);

      wsContext.broadcast({ type: 'ambient:event', action: 'query', count: result.length });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to query events', detail: String(err) });
    }
  });

  // ── GET /nominations ────────────────────────────────────────

  router.get('/nominations', (req: Request, res: Response) => {
    try {
      const {
        agent: agentFilter,
        urgency: urgencyFilter,
        pending_only: pendingOnlyParam,
        include_debates: includeDebatesParam,
        limit: limitParam,
      } = req.query as Record<string, string | undefined>;

      const limit = limitParam ? parseInt(limitParam, 10) : 20;
      const pendingOnly = pendingOnlyParam !== 'false';
      const includeDebates = includeDebatesParam === 'true';

      let nominations = readJsonlSafe<Nomination>(nominationsPath);

      // Apply filters
      if (agentFilter) {
        nominations = nominations.filter(n => n.agent === agentFilter);
      }
      if (urgencyFilter) {
        nominations = nominations.filter(n => n.urgency === urgencyFilter);
      }
      if (pendingOnly) {
        nominations = nominations.filter(n => !n.engaged);
      }

      nominations = nominations.slice(-limit);

      // Optionally attach debates
      let debateMap: Map<string, Debate[]> | undefined;
      if (includeDebates) {
        const debates = readJsonlSafe<Debate>(debatesPath);
        debateMap = new Map();
        for (const debate of debates) {
          if (debate.nominationId) {
            const existing = debateMap.get(debate.nominationId) || [];
            existing.push(debate);
            debateMap.set(debate.nominationId, existing);
          }
        }
      }

      const result = nominations.map(n => {
        const entry: Record<string, unknown> = { ...n };
        if (includeDebates && debateMap && n.id) {
          entry.debates = debateMap.get(n.id) || [];
        }
        return entry;
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to query nominations', detail: String(err) });
    }
  });

  // ── POST /nominations/:id/engage ───────────────────────────

  router.post('/nominations/:id/engage', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { response } = req.body as { response?: 'accepted' | 'dismissed' | 'deferred' };

      if (!response || !['accepted', 'dismissed', 'deferred'].includes(response)) {
        res.status(400).json({ error: 'response must be one of: accepted, dismissed, deferred' });
        return;
      }

      const nominations = readJsonlSafe<Nomination>(nominationsPath);
      const index = nominations.findIndex(n => n.id === id);

      if (index === -1) {
        res.status(404).json({ error: `Nomination not found: ${id}` });
        return;
      }

      nominations[index] = {
        ...nominations[index],
        engaged: true,
        response,
      };

      writeJsonl(nominationsPath, nominations);

      wsContext.broadcast({
        type: 'ambient:nomination',
        action: 'engaged',
        nominationId: id,
        response,
      });

      res.json(nominations[index]);
    } catch (err) {
      res.status(500).json({ error: 'Failed to engage nomination', detail: String(err) });
    }
  });

  // ── GET /stream (SSE) ──────────────────────────────────────

  router.get('/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Track the current file size so we only send new lines
    let lastSize = 0;
    try {
      const stat = fs.statSync(eventsPath);
      lastSize = stat.size;
    } catch {
      // File may not exist yet — start from zero
    }

    const pollInterval = 1000; // 1 second

    const watcher = setInterval(() => {
      try {
        if (!fs.existsSync(eventsPath)) return;

        const stat = fs.statSync(eventsPath);
        if (stat.size <= lastSize) {
          // File was truncated or unchanged
          if (stat.size < lastSize) lastSize = 0;
          else return;
        }

        // Read only the new bytes
        const fd = fs.openSync(eventsPath, 'r');
        const buffer = Buffer.alloc(stat.size - lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastSize);
        fs.closeSync(fd);

        lastSize = stat.size;

        const newContent = buffer.toString('utf-8');
        const lines = newContent.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // File read errors are non-fatal for SSE
      }
    }, pollInterval);

    // Send an initial keepalive comment
    res.write(': connected\n\n');

    req.on('close', () => {
      clearInterval(watcher);
    });
  });

  // ── GET /policy ────────────────────────────────────────────

  router.get('/policy', (_req: Request, res: Response) => {
    try {
      if (fs.existsSync(policyPath)) {
        const content = fs.readFileSync(policyPath, 'utf-8');
        const policy = yaml.load(content);
        res.json(policy as Record<string, unknown>);
      } else {
        // Return a sensible default policy
        res.json({
          version: '1.0',
          retention: { events: '30d', nominations: '90d', debates: '90d' },
          collection: { telemetry: false, usage: false },
          sharing: { external: false },
        });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to read data policy', detail: String(err) });
    }
  });

  return router;
}
