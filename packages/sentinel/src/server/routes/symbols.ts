/**
 * Symbols API route
 */

import { Router, type Request, type Response } from 'express';
import chalk from 'chalk';
import { loadSymbolIndex, updateSymbol, type SymbolUpdate } from '../loaders/symbols.js';

// Inline logger for routes
const LOG_LEVEL = process.env.SENTINEL_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
const shouldLog = (level: 'debug' | 'info' | 'warn' | 'error') => {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  return levels[level] >= levels[LOG_LEVEL as keyof typeof levels];
};

const log = {
  gate(name: string) {
    const symbol = chalk.cyan(`^${name}`);
    return {
      info: (msg: string, data?: Record<string, unknown>) => {
        if (shouldLog('info')) {
          const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
          console.log(`${chalk.blue('ℹ')} ${symbol} ${msg}${dataStr}`);
        }
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        if (shouldLog('error')) {
          const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
          console.error(`${chalk.red('✖')} ${symbol} ${msg}${dataStr}`);
        }
      },
    };
  },
};

export function createSymbolsRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/symbols - Get all symbols
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const symbols = await loadSymbolIndex(projectDir);
      log.gate('api-symbols').info('Symbols loaded', { count: symbols.length });
      res.json({ symbols });
    } catch (error) {
      log.gate('api-symbols').error('Failed to load symbols', { error: String(error) });
      res.status(500).json({ error: 'Failed to load symbols' });
    }
  });

  // PUT /api/symbols/:id - Update a symbol's metadata
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates: SymbolUpdate = req.body;

      log.gate('api-symbols').info('Update requested', { id, updates: JSON.stringify(updates) });

      // Validate updates
      if (updates.tags && !Array.isArray(updates.tags)) {
        res.status(400).json({ error: 'Tags must be an array' });
        return;
      }

      const result = await updateSymbol(projectDir, id, updates);

      if (result.success) {
        // Return updated symbol
        const symbols = await loadSymbolIndex(projectDir);
        const updatedSymbol = symbols.find((s) => s.id === id);
        log.gate('api-symbols').info('Symbol updated', { id });
        res.json({ success: true, symbol: updatedSymbol });
      } else {
        log.gate('api-symbols').error('Update failed', { id, error: result.error });
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.gate('api-symbols').error('Failed to update symbol', { error: String(error) });
      res.status(500).json({ error: 'Failed to update symbol' });
    }
  });

  return router;
}
