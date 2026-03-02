/**
 * Sessions API Routes - Derives sessions from lore entries and breadcrumbs
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as os from 'os';

const LORE_DIR = '.paradigm/lore';
const ENTRIES_DIR = 'entries';
const SESSION_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours

interface LoreEntry {
  id: string;
  type: string;
  timestamp: string;
  author: { type: string; id: string; model?: string };
  title: string;
  summary: string;
  symbols_touched: string[];
  symbols_created?: string[];
}

interface SessionBreadcrumb {
  phase?: string;
  context?: string;
  timestamp?: string;
  modifiedFiles?: string[];
  symbolsTouched?: string[];
  decisions?: string[];
}

export interface DerivedSession {
  id: string;
  date: string;
  author: { type: string; id: string };
  startTime: string;
  endTime: string;
  entryCount: number;
  symbolsTouched: string[];
  entryIds: string[];
  breadcrumbs?: SessionBreadcrumb[];
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

function loadBreadcrumbs(projectDir: string): SessionBreadcrumb[] {
  // Try project-local breadcrumbs
  const localPath = path.join(projectDir, '.paradigm', 'session-breadcrumbs.json');
  if (fs.existsSync(localPath)) {
    try {
      return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } catch {
      // ignore
    }
  }

  // Try global breadcrumbs
  const globalDir = path.join(os.homedir(), '.paradigm', 'sessions');
  if (fs.existsSync(globalDir)) {
    try {
      const dirs = fs.readdirSync(globalDir).sort().reverse();
      for (const dir of dirs.slice(0, 5)) {
        const bcPath = path.join(globalDir, dir, 'breadcrumbs.json');
        if (fs.existsSync(bcPath)) {
          return JSON.parse(fs.readFileSync(bcPath, 'utf8'));
        }
      }
    } catch {
      // ignore
    }
  }

  return [];
}

function deriveSessionsFromEntries(entries: LoreEntry[], breadcrumbs: SessionBreadcrumb[]): DerivedSession[] {
  if (entries.length === 0) return [];

  // Sort by timestamp ascending
  const sorted = [...entries].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const sessions: DerivedSession[] = [];
  let currentGroup: LoreEntry[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
    const sameAuthor = curr.author.id === prev.author.id;

    if (gap <= SESSION_GAP_MS && sameAuthor) {
      currentGroup.push(curr);
    } else {
      sessions.push(groupToSession(currentGroup));
      currentGroup = [curr];
    }
  }

  // Push last group
  sessions.push(groupToSession(currentGroup));

  // Attach breadcrumbs to most recent session if they exist
  if (breadcrumbs.length > 0 && sessions.length > 0) {
    sessions[sessions.length - 1].breadcrumbs = breadcrumbs;
  }

  // Sort sessions newest first
  sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return sessions;
}

function groupToSession(group: LoreEntry[]): DerivedSession {
  const allSymbols = new Set<string>();
  for (const entry of group) {
    if (entry.symbols_touched) {
      for (const sym of entry.symbols_touched) allSymbols.add(sym);
    }
    if (entry.symbols_created) {
      for (const sym of entry.symbols_created) allSymbols.add(sym);
    }
  }

  const startTime = group[0].timestamp;
  const endTime = group[group.length - 1].timestamp;
  const date = startTime.slice(0, 10);

  return {
    id: `session-${date}-${group[0].author.id}-${group[0].id.slice(0, 8)}`,
    date,
    author: { type: group[0].author.type, id: group[0].author.id },
    startTime,
    endTime,
    entryCount: group.length,
    symbolsTouched: Array.from(allSymbols),
    entryIds: group.map(e => e.id),
  };
}

export function createSessionsRouter(projectDir: string): Router {
  const router = Router();

  // GET /api/sessions - List derived sessions
  router.get('/', (_req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const breadcrumbs = loadBreadcrumbs(projectDir);
    const sessions = deriveSessionsFromEntries(entries, breadcrumbs);
    res.json({ sessions });
  });

  // GET /api/sessions/:id - Single session detail
  router.get('/:id', (req: Request, res: Response) => {
    const entries = loadAllEntries(projectDir);
    const breadcrumbs = loadBreadcrumbs(projectDir);
    const sessions = deriveSessionsFromEntries(entries, breadcrumbs);

    const session = sessions.find(s => s.id === req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Include the full entries for this session
    const sessionEntries = entries.filter(e => session.entryIds.includes(e.id));
    res.json({ ...session, entries: sessionEntries });
  });

  return router;
}
