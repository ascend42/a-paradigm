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
  type?: string;
  timestamp: string;
  duration_minutes?: number;
  author: string;
  agent?: { provider: string; model: string };
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
  body?: string;
  linked_lore?: string[];
  linked_tasks?: string[];
  linked_commits?: string[];
  tags?: string[];
  meta?: Record<string, unknown>;
  git_context?: { ref: string; branch: string; dirty: boolean };
}

/** Matches both .yaml and .lore lore entry files */
function isLoreFile(filename: string): boolean {
  return filename.endsWith('.yaml') || filename.endsWith('.lore');
}

/** Normalize old author format to new string format */
function normalizeEntry(raw: Record<string, unknown>): LoreEntry {
  const author = raw.author;
  if (typeof author === 'object' && author && !Array.isArray(author)) {
    const old = author as { type?: string; id?: string; model?: string };
    if (old.type === 'agent') {
      raw.author = 'unknown';
      const model = old.model || old.id || 'unknown';
      const lower = model.toLowerCase();
      let provider = 'unknown';
      if (lower.includes('claude') || lower.includes('anthropic')) provider = 'anthropic';
      else if (lower.includes('gpt') || lower.includes('openai')) provider = 'openai';
      raw.agent = { provider, model };
    } else {
      raw.author = old.id || 'unknown';
    }
    delete raw.assistedBy;
  }
  return raw as unknown as LoreEntry;
}

/** Resolve the file path for a lore entry ID, trying .lore first then .yaml */
function resolveEntryPath(projectDir: string, dateStr: string, entryId: string): string | null {
  const dirPath = path.join(projectDir, LORE_DIR, ENTRIES_DIR, dateStr);
  const lorePath = path.join(dirPath, `${entryId}.lore`);
  if (fs.existsSync(lorePath)) return lorePath;
  const yamlPath = path.join(dirPath, `${entryId}.yaml`);
  if (fs.existsSync(yamlPath)) return yamlPath;
  return null;
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
      .filter(isLoreFile)
      .sort();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const raw = yaml.load(content) as Record<string, unknown>;
        entries.push(normalizeEntry(raw));
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
    const { author, authorType, hasAgent, symbol, type, tag, from, to, tags, hasReview, hasBody, limit, offset } = req.query;

    if (author) {
      entries = entries.filter(e => e.author === author);
    }
    if (hasAgent !== undefined) {
      entries = entries.filter(e =>
        hasAgent === 'true' ? e.agent != null : e.agent == null
      );
    } else if (authorType) {
      // Deprecated: map old authorType to hasAgent logic
      entries = entries.filter(e =>
        authorType === 'agent' ? e.agent != null : e.agent == null
      );
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
    if (tag) {
      const prefix = tag as string;
      entries = entries.filter(e =>
        e.tags?.some(t => t === prefix || t.startsWith(prefix + ':') || (prefix.includes(':') && t === prefix))
      );
    }
    if (hasBody === 'true') {
      entries = entries.filter(e => e.body != null && e.body.length > 0);
    } else if (hasBody === 'false') {
      entries = entries.filter(e => !e.body || e.body.length === 0);
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

  // GET /api/lore/tags - Tags with entry counts
  router.get('/tags', (_req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const tagCounts: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.tags) {
        for (const tag of entry.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    const tags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ tags });
  });

  // GET /api/lore/authors - Authors with entry counts
  router.get('/authors', (_req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const authorMap: Record<string, { hasAgent: boolean; count: number; lastActive: string }> = {};

    for (const entry of entries) {
      const aid = entry.author;
      if (!authorMap[aid]) {
        authorMap[aid] = { hasAgent: entry.agent != null, count: 0, lastActive: entry.timestamp };
      }
      authorMap[aid].count++;
      if (entry.agent != null) authorMap[aid].hasAgent = true;
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
    const entryPath = resolveEntryPath(projectDir, dateStr, entryId);

    if (!entryPath) {
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
