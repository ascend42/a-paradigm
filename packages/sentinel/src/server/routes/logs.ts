/**
 * Structured Logs API route
 *
 * POST /api/logs  — Accept single entry or batch {entries: [...]}
 * GET  /api/logs  — Query with filters
 */

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { SentinelStorage } from '../../storage.js';
import type {
  LogEntryInput,
  LogEntry,
  LogLevel,
  SentinelServerConfig,
} from '../../types.js';

export interface LogsRouterOptions {
  storage: SentinelStorage;
  serverConfig: SentinelServerConfig;
  onLogReceived?: (entry: LogEntry, validation?: { known: boolean; suggestion?: string }) => void;
  symbolIndex?: Array<{ symbol: string; type: string; filePath: string }>;
}

/**
 * Infer symbol type from prefix
 */
function inferSymbolType(symbol: string): LogEntry['symbolType'] {
  if (symbol.startsWith('#')) return 'component';
  if (symbol.startsWith('^')) return 'gate';
  if (symbol.startsWith('!')) return 'signal';
  if (symbol.startsWith('$')) return 'flow';
  if (symbol.startsWith('~')) return 'aspect';
  return 'raw';
}

/**
 * Validate a symbol against the project's .purpose index
 */
function validateSymbol(
  symbol: string,
  index: Array<{ symbol: string; type: string; filePath: string }>
): { known: boolean; suggestion?: string } {
  const entry = index.find((e) => e.symbol === symbol);
  if (entry) return { known: true };

  // Try fuzzy match for suggestion
  const symbolName = symbol.replace(/^[#^!$~]/, '');
  let bestMatch: string | undefined;
  let bestScore = 0;

  for (const e of index) {
    const eName = e.symbol.replace(/^[#^!$~]/, '');
    // Simple Levenshtein-ish: shared prefix length
    let shared = 0;
    for (let i = 0; i < Math.min(symbolName.length, eName.length); i++) {
      if (symbolName[i] === eName[i]) shared++;
      else break;
    }
    const score = shared / Math.max(symbolName.length, eName.length);
    if (score > bestScore && score > 0.5) {
      bestScore = score;
      bestMatch = e.symbol;
    }
  }

  return { known: false, suggestion: bestMatch };
}

/**
 * Auto-promote error logs to incidents
 */
function autoPromoteToIncident(entry: LogEntry, storage: SentinelStorage): void {
  try {
    const symbolType = inferSymbolType(entry.symbol);
    const symbols: Record<string, string | undefined> = {};

    if (symbolType === 'component') symbols.component = entry.symbol;
    else if (symbolType === 'gate') symbols.gate = entry.symbol;
    else if (symbolType === 'signal') symbols.signal = entry.symbol;
    else if (symbolType === 'flow') symbols.flow = entry.symbol;
    else symbols.component = entry.symbol;

    storage.recordIncident({
      error: {
        message: entry.message,
        type: 'LogError',
      },
      symbols,
      environment: entry.environment || 'unknown',
      service: entry.service,
    });
  } catch {
    // Best-effort, failures swallowed
  }
}

let insertsSincePrune = 0;

export function createLogsRouter(options: LogsRouterOptions): Router {
  const router = Router();
  const { storage, serverConfig, onLogReceived, symbolIndex } = options;

  // POST /api/logs — Accept single entry or batch
  router.post('/', async (req: Request, res: Response) => {
    try {
      const body = req.body;
      let entries: LogEntryInput[];

      if (Array.isArray(body.entries)) {
        entries = body.entries;
      } else if (body.level && body.symbol && body.message && body.service) {
        // Single entry posted directly
        entries = [body];
      } else {
        res.status(400).json({ error: 'Expected {entries: [...]} or a single log entry with level, symbol, message, service' });
        return;
      }

      // Enforce max batch size
      if (entries.length > serverConfig.maxBatchSize) {
        res.status(413).json({
          error: `Batch too large: ${entries.length} entries, max ${serverConfig.maxBatchSize}`,
        });
        return;
      }

      // Validate required fields
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.level || !e.symbol || !e.message || !e.service) {
          res.status(400).json({
            error: `Entry ${i}: missing required fields (level, symbol, message, service)`,
          });
          return;
        }
        if (!['debug', 'info', 'warn', 'error'].includes(e.level)) {
          res.status(400).json({
            error: `Entry ${i}: invalid level "${e.level}", must be debug|info|warn|error`,
          });
          return;
        }
      }

      const result = storage.insertLogBatch(entries);

      // Post-insert processing for each accepted entry
      for (const input of entries) {
        const entry: LogEntry = {
          id: input.id || uuidv4(),
          timestamp: input.timestamp || new Date().toISOString(),
          level: input.level,
          symbol: input.symbol,
          symbolType: input.symbolType || inferSymbolType(input.symbol),
          message: input.message,
          data: input.data,
          service: input.service,
          sessionId: input.sessionId,
          correlationId: input.correlationId,
          durationMs: input.durationMs,
          environment: input.environment,
        };

        // Symbol validation
        let validation: { known: boolean; suggestion?: string } | undefined;
        if (symbolIndex) {
          validation = validateSymbol(entry.symbol, symbolIndex);
        }

        // Auto-promote errors to incidents
        if (entry.level === 'error') {
          autoPromoteToIncident(entry, storage);
        }

        // Broadcast to WebSocket subscribers
        if (onLogReceived) {
          onLogReceived(entry, validation);
        }
      }

      // Periodic prune
      insertsSincePrune += result.accepted;
      if (serverConfig.maxLogs > 0 && insertsSincePrune >= serverConfig.pruneIntervalInserts) {
        insertsSincePrune = 0;
        storage.pruneLogs(serverConfig.maxLogs);
      }

      res.json({ accepted: result.accepted, errors: result.errors.length > 0 ? result.errors : undefined });
    } catch (error) {
      res.status(500).json({ error: 'Failed to insert logs' });
    }
  });

  // GET /api/logs — Query with filters
  router.get('/', async (req: Request, res: Response) => {
    try {
      const options = {
        level: req.query.level as LogLevel | undefined,
        symbol: req.query.symbol as string | undefined,
        service: req.query.service as string | undefined,
        sessionId: req.query.sessionId as string | undefined,
        correlationId: req.query.correlationId as string | undefined,
        search: req.query.search as string | undefined,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const logs = storage.queryLogs(options);
      const total = storage.getLogCount(options);

      res.json({ count: logs.length, total, logs });
    } catch (error) {
      res.status(500).json({ error: 'Failed to query logs' });
    }
  });

  return router;
}
