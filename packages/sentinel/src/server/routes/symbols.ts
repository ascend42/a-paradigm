/**
 * Symbols API route
 */

import { Router, type Request, type Response } from 'express';
import { loadSymbolIndex, updateSymbol, type SymbolUpdate } from '../loaders/symbols.js';

export function createSymbolsRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/symbols - Get all symbols
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const symbols = await loadSymbolIndex(projectDir);
      res.json({ symbols });
    } catch (error) {
      console.error('Failed to load symbols:', error);
      res.status(500).json({ error: 'Failed to load symbols' });
    }
  });

  // PUT /api/symbols/:id - Update a symbol's metadata
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates: SymbolUpdate = req.body;

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
        res.json({ success: true, symbol: updatedSymbol });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      console.error('Failed to update symbol:', error);
      res.status(500).json({ error: 'Failed to update symbol' });
    }
  });

  return router;
}
