/**
 * Lore Loader - Reads/writes lore entries from .paradigm/lore/
 *
 * Storage layout:
 *   .paradigm/lore/
 *     timeline.yaml          # index metadata
 *     entries/
 *       2026-02-21/
 *         L-2026-02-21-001.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const LORE_DIR = '.paradigm/lore';
const ENTRIES_DIR = 'entries';
const TIMELINE_FILE = 'timeline.yaml';

// ────────────────────────────────────────────────────────
// Types (duplicated from core to avoid cross-package dep)
// ────────────────────────────────────────────────────────

export interface LoreDecision {
  id: string;
  decision: string;
  rationale: string;
}

export interface LoreError {
  description: string;
  resolution: string;
  time_to_fix?: string;
}

export interface LoreEntry {
  id: string;
  type: 'agent-session' | 'human-note' | 'decision' | 'review' | 'incident' | 'milestone';
  timestamp: string;
  duration_minutes?: number;
  author: {
    type: 'human' | 'agent';
    id: string;
    model?: string;
  };
  title: string;
  summary: string;
  symbols_touched: string[];
  symbols_created?: string[];
  files_created?: string[];
  files_modified?: string[];
  lines_added?: number;
  lines_removed?: number;
  commit?: string;
  decisions?: LoreDecision[];
  errors_encountered?: LoreError[];
  learnings?: string[];
  verification?: {
    status: 'pass' | 'fail' | 'partial' | 'untested';
    details?: Record<string, 'pass' | 'fail'>;
  };
  review?: {
    reviewer: string;
    completeness: 1 | 2 | 3 | 4 | 5;
    quality: 1 | 2 | 3 | 4 | 5;
    notes?: string;
    reviewed_at: string;
  };
  tags?: string[];
}

export interface LoreFilter {
  author?: string;
  authorType?: 'human' | 'agent';
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: LoreEntry['type'];
  tags?: string[];
  hasReview?: boolean;
  limit?: number;
  offset?: number;
}

export interface LoreTimeline {
  version: string;
  project: string;
  entries: number;
  last_updated: string;
  authors: string[];
}

// ────────────────────────────────────────────────────────
// Read operations
// ────────────────────────────────────────────────────────

/**
 * Load all lore entries with optional filtering
 */
export async function loadLoreEntries(rootDir: string, filter?: LoreFilter): Promise<LoreEntry[]> {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);

  if (!fs.existsSync(entriesPath)) {
    return [];
  }

  const entries: LoreEntry[] = [];

  const dateDirs = fs.readdirSync(entriesPath)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    if (filter?.dateFrom && dateDir < filter.dateFrom.slice(0, 10)) continue;
    if (filter?.dateTo && dateDir > filter.dateTo.slice(0, 10)) continue;

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
        // Skip malformed files
      }
    }
  }

  return filter ? applyFilter(entries, filter) : entries;
}

/**
 * Load a single lore entry by ID
 */
export async function loadLoreEntry(rootDir: string, entryId: string): Promise<LoreEntry | null> {
  const dateMatch = entryId.match(/^L-(\d{4}-\d{2}-\d{2})-/);
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const entryPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr, `${entryId}.yaml`);
    if (fs.existsSync(entryPath)) {
      try {
        const content = fs.readFileSync(entryPath, 'utf8');
        return yaml.load(content) as LoreEntry;
      } catch {
        return null;
      }
    }
  }

  // Fallback scan
  const entries = await loadLoreEntries(rootDir);
  return entries.find(e => e.id === entryId) || null;
}

/**
 * Load timeline metadata
 */
export async function loadLoreTimeline(rootDir: string): Promise<LoreTimeline | null> {
  const timelinePath = path.join(rootDir, LORE_DIR, TIMELINE_FILE);

  if (!fs.existsSync(timelinePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(timelinePath, 'utf8');
    return yaml.load(content) as LoreTimeline;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────
// Write operations
// ────────────────────────────────────────────────────────

/**
 * Record a new lore entry
 */
export async function recordLoreEntry(rootDir: string, entry: LoreEntry): Promise<string> {
  const lorePath = path.join(rootDir, LORE_DIR);
  const dateStr = entry.timestamp.slice(0, 10);
  const datePath = path.join(lorePath, ENTRIES_DIR, dateStr);

  if (!fs.existsSync(datePath)) {
    fs.mkdirSync(datePath, { recursive: true });
  }

  if (!entry.id) {
    entry.id = generateLoreId(rootDir, dateStr);
  }

  const entryPath = path.join(datePath, `${entry.id}.yaml`);
  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));

  // Rebuild timeline
  await rebuildTimeline(rootDir);

  return entry.id;
}

/**
 * Add review to an existing entry
 */
export async function addLoreReview(
  rootDir: string,
  entryId: string,
  review: NonNullable<LoreEntry['review']>
): Promise<boolean> {
  const entry = await loadLoreEntry(rootDir, entryId);
  if (!entry) return false;

  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr, `${entryId}.yaml`);

  if (!fs.existsSync(entryPath)) return false;

  entry.review = review;
  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));
  return true;
}

/**
 * Regenerate timeline.yaml from entries
 */
export async function rebuildTimeline(rootDir: string): Promise<void> {
  const lorePath = path.join(rootDir, LORE_DIR);
  const entriesPath = path.join(lorePath, ENTRIES_DIR);

  if (!fs.existsSync(entriesPath)) return;

  const authors = new Set<string>();
  let entryCount = 0;
  let lastUpdated = '';

  const dateDirs = fs.readdirSync(entriesPath)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

  for (const dateDir of dateDirs) {
    const dirPath = path.join(entriesPath, dateDir);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const entry = yaml.load(content) as LoreEntry;
        authors.add(entry.author.id);
        entryCount++;
        if (!lastUpdated || entry.timestamp > lastUpdated) {
          lastUpdated = entry.timestamp;
        }
      } catch {
        // Skip malformed
      }
    }
  }

  let project = 'unknown';
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      project = (config.project as string) || (config.name as string) || 'unknown';
    } catch {
      // Use default
    }
  }

  const timeline: LoreTimeline = {
    version: '1.0',
    project,
    entries: entryCount,
    last_updated: lastUpdated || new Date().toISOString(),
    authors: Array.from(authors),
  };

  if (!fs.existsSync(lorePath)) {
    fs.mkdirSync(lorePath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(lorePath, TIMELINE_FILE),
    yaml.dump(timeline, { lineWidth: -1, noRefs: true })
  );
}

// ────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────

function applyFilter(entries: LoreEntry[], filter: LoreFilter): LoreEntry[] {
  let result = entries;

  if (filter.author) {
    result = result.filter(e => e.author.id === filter.author);
  }
  if (filter.authorType) {
    result = result.filter(e => e.author.type === filter.authorType);
  }
  if (filter.symbol) {
    result = result.filter(e =>
      e.symbols_touched.includes(filter.symbol!) ||
      e.symbols_created?.includes(filter.symbol!)
    );
  }
  if (filter.dateFrom) {
    const from = new Date(filter.dateFrom).getTime();
    result = result.filter(e => new Date(e.timestamp).getTime() >= from);
  }
  if (filter.dateTo) {
    const to = new Date(filter.dateTo).getTime();
    result = result.filter(e => new Date(e.timestamp).getTime() <= to);
  }
  if (filter.type) {
    result = result.filter(e => e.type === filter.type);
  }
  if (filter.tags && filter.tags.length > 0) {
    result = result.filter(e => filter.tags!.some(tag => e.tags?.includes(tag)));
  }
  if (filter.hasReview !== undefined) {
    result = result.filter(e => filter.hasReview ? e.review != null : e.review == null);
  }

  result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (filter.offset) result = result.slice(filter.offset);
  if (filter.limit) result = result.slice(0, filter.limit);

  return result;
}

function generateLoreId(rootDir: string, dateStr: string): string {
  const datePath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr);

  if (!fs.existsSync(datePath)) {
    return `L-${dateStr}-001`;
  }

  const existing = fs.readdirSync(datePath)
    .filter(f => f.startsWith('L-') && f.endsWith('.yaml'))
    .map(f => {
      const match = f.match(/L-\d{4}-\d{2}-\d{2}-(\d+)\.yaml/);
      return match ? parseInt(match[1], 10) : 0;
    });

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `L-${dateStr}-${String(next).padStart(3, '0')}`;
}
