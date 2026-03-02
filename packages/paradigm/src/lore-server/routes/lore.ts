/**
 * Lore API Routes
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const LORE_DIR = '.paradigm/lore';
const ENTRIES_DIR = 'entries';

interface LoreEntry {
  id: string;
  type: string;
  timestamp: string;
  duration_minutes?: number;
  author: { type: string; id: string; model?: string };
  title: string;
  summary: string;
  symbols_touched: string[];
  symbols_created?: string[];
  files_created?: string[];
  files_modified?: string[];
  lines_added?: number;
  lines_removed?: number;
  commit?: string;
  decisions?: Array<{ id: string; decision: string; rationale: string }>;
  errors_encountered?: Array<{ description: string; resolution: string; time_to_fix?: string }>;
  learnings?: string[];
  verification?: { status: string; details?: Record<string, string> };
  review?: { reviewer: string; completeness: number; quality: number; notes?: string; reviewed_at: string };
  tags?: string[];
}

function loadAllEntries(projectDir: string): LoreEntry[] {
  const entriesPath = path.join(projectDir, LORE_DIR, ENTRIES_DIR);

  if (!fs.existsSync(entriesPath)) {
    return [];
  }

  const entries: LoreEntry[] = [];

  const dateDirs = fs.readdirSync(entriesPath)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    const dirPath = path.join(entriesPath, dateDir);
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.yaml'))
      .sort();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const entry = yaml.load(content) as LoreEntry;
        entries.push(entry);
      } catch {
        // Skip malformed
      }
    }
  }

  return entries;
}

export function createLoreRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/lore - List entries with filters
  router.get('/', (req: Request, res: Response) => {
    let entries = loadAllEntries(projectDir);

    // Apply filters
    const { author, authorType, symbol, type, from, to, tags, hasReview, limit, offset } = req.query;

    if (author) {
      entries = entries.filter(e => e.author.id === author);
    }
    if (authorType) {
      entries = entries.filter(e => e.author.type === authorType);
    }
    if (symbol) {
      entries = entries.filter(e =>
        e.symbols_touched?.includes(symbol as string) ||
        e.symbols_created?.includes(symbol as string)
      );
    }
    if (type) {
      entries = entries.filter(e => e.type === type);
    }
    if (from) {
      const fromDate = new Date(from as string).getTime();
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= fromDate);
    }
    if (to) {
      const toDate = new Date(to as string).getTime();
      entries = entries.filter(e => new Date(e.timestamp).getTime() <= toDate);
    }
    if (tags) {
      const tagList = (tags as string).split(',');
      entries = entries.filter(e => tagList.some(t => e.tags?.includes(t)));
    }
    if (hasReview === 'true') {
      entries = entries.filter(e => e.review != null);
    } else if (hasReview === 'false') {
      entries = entries.filter(e => e.review == null);
    }

    // Sort newest first
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Pagination
    const off = parseInt(offset as string || '0', 10);
    const lim = parseInt(limit as string || '100', 10);
    const total = entries.length;
    entries = entries.slice(off, off + lim);

    res.json({ total, offset: off, limit: lim, entries });
  });

  // GET /api/lore/timeline - Timeline metadata
  router.get('/timeline', (_req: Request, res: Response) => {
    const timelinePath = path.join(projectDir, LORE_DIR, 'timeline.yaml');

    if (!fs.existsSync(timelinePath)) {
      res.json({ version: '1.0', project: 'unknown', entries: 0, last_updated: '', authors: [] });
      return;
    }

    try {
      const content = fs.readFileSync(timelinePath, 'utf8');
      res.json(yaml.load(content));
    } catch {
      res.status(500).json({ error: 'Failed to load timeline' });
    }
  });

  // GET /api/lore/symbols - Symbols with entry counts
  router.get('/symbols', (_req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const symbolCounts: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.symbols_touched) {
        for (const sym of entry.symbols_touched) {
          symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;
        }
      }
      if (entry.symbols_created) {
        for (const sym of entry.symbols_created) {
          symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;
        }
      }
    }

    const symbols = Object.entries(symbolCounts)
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ symbols });
  });

  // GET /api/lore/authors - Authors with entry counts
  router.get('/authors', (_req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const authorMap: Record<string, { type: string; count: number; lastActive: string }> = {};

    for (const entry of entries) {
      const aid = entry.author.id;
      if (!authorMap[aid]) {
        authorMap[aid] = { type: entry.author.type, count: 0, lastActive: entry.timestamp };
      }
      authorMap[aid].count++;
      if (entry.timestamp > authorMap[aid].lastActive) {
        authorMap[aid].lastActive = entry.timestamp;
      }
    }

    const authors = Object.entries(authorMap)
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => b.count - a.count);

    res.json({ authors });
  });

  // GET /api/lore/:id - Single entry (MUST be after named routes)
  router.get('/:id', (req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const entry = entries.find(e => e.id === req.params.id);

    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    res.json(entry);
  });

  // PUT /api/lore/:id/review - Add/update review
  router.put('/:id/review', (req: Request, res: Response) => {
    const entryId = req.params.id;
    const entries = loadAllEntries(projectDir);
    const entry = entries.find(e => e.id === entryId);

    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    const dateStr = entry.timestamp.slice(0, 10);
    const entryPath = path.join(projectDir, LORE_DIR, ENTRIES_DIR, dateStr, `${entryId}.yaml`);

    if (!fs.existsSync(entryPath)) {
      res.status(404).json({ error: 'Entry file not found' });
      return;
    }

    entry.review = {
      reviewer: req.body.reviewer || 'anonymous',
      completeness: req.body.completeness || 3,
      quality: req.body.quality || 3,
      notes: req.body.notes,
      reviewed_at: new Date().toISOString(),
    };

    fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));
    res.json({ success: true, entry });
  });

  return router;
}
