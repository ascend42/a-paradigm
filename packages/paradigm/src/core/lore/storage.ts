/**
 * Lore Storage - Read/write lore entries as date-partitioned YAML files
 *
 * Storage layout:
 *   .paradigm/lore/
 *     timeline.yaml          # index metadata
 *     entries/
 *       2026-02-21/
 *         L-2026-02-21-001.yaml
 *         L-2026-02-21-002.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { LoreEntry, LoreFilter, LoreTimeline } from './types.js';
import { applyLoreFilter } from './filter.js';

const LORE_DIR = '.paradigm/lore';
const ENTRIES_DIR = 'entries';
const TIMELINE_FILE = 'timeline.yaml';

/**
 * Record a new lore entry - writes to dated directory
 */
export async function recordLore(rootDir: string, entry: LoreEntry): Promise<void> {
  const lorePath = path.join(rootDir, LORE_DIR);
  const dateStr = entry.timestamp.slice(0, 10); // "2026-02-21"
  const datePath = path.join(lorePath, ENTRIES_DIR, dateStr);

  // Ensure directory exists
  if (!fs.existsSync(datePath)) {
    fs.mkdirSync(datePath, { recursive: true });
  }

  // Generate ID if not provided
  if (!entry.id) {
    entry.id = generateLoreId(rootDir, dateStr);
  }

  // Write entry YAML
  const entryPath = path.join(datePath, `${entry.id}.yaml`);
  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));

  // Rebuild timeline index
  await rebuildTimeline(rootDir);
}

/**
 * Load lore entries with optional filtering
 */
export async function loadLoreEntries(rootDir: string, filter?: LoreFilter): Promise<LoreEntry[]> {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);

  if (!fs.existsSync(entriesPath)) {
    return [];
  }

  const entries: LoreEntry[] = [];

  // Read all date directories
  const dateDirs = fs.readdirSync(entriesPath)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse(); // newest first

  for (const dateDir of dateDirs) {
    // Quick date range pruning
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

  return filter ? applyLoreFilter(entries, filter) : entries;
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

/**
 * Regenerate timeline.yaml from all entries
 */
export async function rebuildTimeline(rootDir: string): Promise<void> {
  const lorePath = path.join(rootDir, LORE_DIR);
  const entriesPath = path.join(lorePath, ENTRIES_DIR);

  if (!fs.existsSync(entriesPath)) {
    return;
  }

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
        // Skip malformed files
      }
    }
  }

  // Detect project name from config
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

  // Ensure lore directory exists
  if (!fs.existsSync(lorePath)) {
    fs.mkdirSync(lorePath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(lorePath, TIMELINE_FILE),
    yaml.dump(timeline, { lineWidth: -1, noRefs: true })
  );
}

/**
 * Add or update a review on an existing lore entry
 */
export async function addReview(
  rootDir: string,
  entryId: string,
  review: NonNullable<LoreEntry['review']>
): Promise<boolean> {
  const entries = await loadLoreEntries(rootDir);
  const entry = entries.find(e => e.id === entryId);

  if (!entry) {
    return false;
  }

  // Find the file
  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr, `${entryId}.yaml`);

  if (!fs.existsSync(entryPath)) {
    return false;
  }

  // Update entry with review
  entry.review = review;
  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));

  return true;
}

/**
 * Load a single entry by ID
 */
export async function loadLoreEntry(rootDir: string, entryId: string): Promise<LoreEntry | null> {
  // Extract date from ID: "L-2026-02-21-001" -> "2026-02-21"
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

  // Fallback: scan all entries
  const entries = await loadLoreEntries(rootDir);
  return entries.find(e => e.id === entryId) || null;
}

/**
 * Generate a unique lore entry ID for a given date
 */
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
