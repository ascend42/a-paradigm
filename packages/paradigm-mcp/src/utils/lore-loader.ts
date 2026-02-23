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
  habit_compliance?: {
    rate: number;
    followed: number;
    skipped: number;
    partial: number;
    weakAreas?: string[];
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

  // Auto-migrate any legacy root-level entries first
  migrateLegacyEntries(rootDir);

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

  // Auto-migrate any legacy root-level entries first
  migrateLegacyEntries(rootDir);

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
// Legacy migration
// ────────────────────────────────────────────────────────

/**
 * Migrate old-format lore entries (root-level YAML without date partitioning)
 * to v2 schema in dated directories. Runs automatically on rebuild/load.
 */
function migrateLegacyEntries(rootDir: string): number {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);
  if (!fs.existsSync(entriesPath)) return 0;

  const rootFiles = fs.readdirSync(entriesPath)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('.'));

  let migrated = 0;
  for (const file of rootFiles) {
    const filePath = path.join(entriesPath, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const raw = yaml.load(content) as Record<string, unknown>;

      // Skip if already v2 format (has author block)
      if (raw.author && typeof raw.author === 'object') continue;

      // Extract date — old format uses `date: "2026-02-21"`
      const dateStr = typeof raw.date === 'string'
        ? raw.date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const datePath = path.join(entriesPath, dateStr);
      if (!fs.existsSync(datePath)) {
        fs.mkdirSync(datePath, { recursive: true });
      }

      // Generate ID
      const id = generateLoreId(rootDir, dateStr);

      // Map old type to v2 type
      const oldType = String(raw.type || 'agent-session');
      const v2Type = ['agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone'].includes(oldType)
        ? oldType
        : 'agent-session';

      // Convert test_results to verification
      let verification: Record<string, unknown> | undefined;
      if (raw.test_results && typeof raw.test_results === 'object') {
        const tr = raw.test_results as Record<string, number>;
        verification = {
          status: tr.total === tr.passed ? 'pass' : 'partial',
          details: { tests: tr.total === tr.passed ? 'pass' : 'fail' },
        };
      }

      const v2Entry: LoreEntry = {
        id,
        type: v2Type as LoreEntry['type'],
        timestamp: `${dateStr}T00:00:00.000Z`,
        author: { type: 'agent', id: 'unknown' },
        title: String(raw.title || file.replace('.yaml', '')),
        summary: String(raw.summary || ''),
        symbols_touched: Array.isArray(raw.symbols_touched) ? raw.symbols_touched : [],
        files_modified: Array.isArray(raw.files_modified) ? raw.files_modified : undefined,
        ...(verification ? { verification: verification as LoreEntry['verification'] } : {}),
        tags: ['migrated', oldType],
      };

      fs.writeFileSync(
        path.join(datePath, `${id}.yaml`),
        yaml.dump(v2Entry, { lineWidth: -1, noRefs: true })
      );
      fs.unlinkSync(filePath);
      migrated++;
    } catch {
      // Skip files that can't be parsed
    }
  }
  return migrated;
}

/**
 * Update an existing lore entry by merging provided fields
 */
export async function updateLoreEntry(
  rootDir: string,
  entryId: string,
  partial: Partial<Omit<LoreEntry, 'id' | 'timestamp' | 'author'>>
): Promise<boolean> {
  const entry = await loadLoreEntry(rootDir, entryId);
  if (!entry) return false;

  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr, `${entryId}.yaml`);
  if (!fs.existsSync(entryPath)) return false;

  // Merge provided fields
  if (partial.title !== undefined) entry.title = partial.title;
  if (partial.summary !== undefined) entry.summary = partial.summary;
  if (partial.type !== undefined) entry.type = partial.type;
  if (partial.duration_minutes !== undefined) entry.duration_minutes = partial.duration_minutes;
  if (partial.symbols_touched !== undefined) entry.symbols_touched = partial.symbols_touched;
  if (partial.symbols_created !== undefined) entry.symbols_created = partial.symbols_created;
  if (partial.files_created !== undefined) entry.files_created = partial.files_created;
  if (partial.files_modified !== undefined) entry.files_modified = partial.files_modified;
  if (partial.lines_added !== undefined) entry.lines_added = partial.lines_added;
  if (partial.lines_removed !== undefined) entry.lines_removed = partial.lines_removed;
  if (partial.commit !== undefined) entry.commit = partial.commit;
  if (partial.decisions !== undefined) entry.decisions = partial.decisions;
  if (partial.errors_encountered !== undefined) entry.errors_encountered = partial.errors_encountered;
  if (partial.learnings !== undefined) entry.learnings = partial.learnings;
  if (partial.verification !== undefined) entry.verification = partial.verification;
  if (partial.tags !== undefined) entry.tags = partial.tags;

  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));
  await rebuildTimeline(rootDir);
  return true;
}

/**
 * Delete a lore entry by ID
 */
export async function deleteLoreEntry(rootDir: string, entryId: string): Promise<boolean> {
  const entry = await loadLoreEntry(rootDir, entryId);
  if (!entry) return false;

  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr, `${entryId}.yaml`);
  if (!fs.existsSync(entryPath)) return false;

  fs.unlinkSync(entryPath);

  // Clean up empty date directory
  const dateDir = path.dirname(entryPath);
  const remaining = fs.readdirSync(dateDir).filter(f => f.endsWith('.yaml'));
  if (remaining.length === 0) {
    fs.rmdirSync(dateDir);
  }

  await rebuildTimeline(rootDir);
  return true;
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
