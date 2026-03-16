/**
 * Notebook Loader — CRUD for agent notebook entries
 *
 * Storage mirrors agent-loader pattern:
 *   ~/.paradigm/notebooks/{agent-id}/    (global, travels across projects)
 *   .paradigm/notebooks/{agent-id}/      (project-level)
 *
 * Each entry is a YAML file: nb-{concept}.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import type { NotebookEntry, NotebookProvenance } from '../types/notebooks.js';

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const GLOBAL_NOTEBOOKS_DIR = path.join(os.homedir(), '.paradigm', 'notebooks');
const PROJECT_NOTEBOOKS_DIR = '.paradigm/notebooks';
const NOTEBOOK_PREFIX = 'nb-';
const NOTEBOOK_EXT = '.yaml';

// ────────────────────────────────────────────────────────
// Read Operations
// ────────────────────────────────────────────────────────

/**
 * Load all notebook entries for an agent (global + project, deduplicated by id).
 */
export function loadNotebookEntries(
  agentId: string,
  rootDir: string,
  filter?: { concepts?: string[]; tags?: string[] }
): NotebookEntry[] {
  const entries = new Map<string, NotebookEntry>();

  // Load global entries first
  const globalDir = path.join(GLOBAL_NOTEBOOKS_DIR, agentId);
  loadEntriesFromDir(globalDir, entries);

  // Load project entries (override global with same id)
  const projectDir = path.join(rootDir, PROJECT_NOTEBOOKS_DIR, agentId);
  loadEntriesFromDir(projectDir, entries);

  let result = Array.from(entries.values());

  // Apply filters
  if (filter?.concepts && filter.concepts.length > 0) {
    const conceptSet = new Set(filter.concepts.map(c => c.toLowerCase()));
    result = result.filter(e =>
      e.concepts.some(c => conceptSet.has(c.toLowerCase()))
    );
  }

  if (filter?.tags && filter.tags.length > 0) {
    const tagSet = new Set(filter.tags.map(t => t.toLowerCase()));
    result = result.filter(e =>
      e.tags.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  return result.sort((a, b) => b.appliedCount - a.appliedCount);
}

function loadEntriesFromDir(dir: string, entries: Map<string, NotebookEntry>): void {
  if (!fs.existsSync(dir)) return;

  try {
    const files = fs.readdirSync(dir).filter(f =>
      f.startsWith(NOTEBOOK_PREFIX) && f.endsWith(NOTEBOOK_EXT)
    );

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const entry = yaml.load(content) as NotebookEntry;
        if (entry?.id) {
          entries.set(entry.id, entry);
        }
      } catch { /* skip invalid */ }
    }
  } catch { /* dir read error */ }
}

/**
 * Search notebook entries by query string across context, snippet, and concepts.
 */
export function searchNotebooks(
  agentId: string,
  query: string,
  rootDir: string
): NotebookEntry[] {
  const all = loadNotebookEntries(agentId, rootDir);
  const q = query.toLowerCase();

  return all.filter(e =>
    e.context.toLowerCase().includes(q) ||
    e.snippet.toLowerCase().includes(q) ||
    e.concepts.some(c => c.toLowerCase().includes(q)) ||
    e.tags.some(t => t.toLowerCase().includes(q))
  );
}

// ────────────────────────────────────────────────────────
// Write Operations
// ────────────────────────────────────────────────────────

/**
 * Add a new notebook entry.
 */
export function addNotebookEntry(
  agentId: string,
  entry: Omit<NotebookEntry, 'id' | 'created' | 'updated' | 'appliedCount'>,
  scope: 'global' | 'project',
  rootDir?: string
): { entry: NotebookEntry; filePath: string } {
  const now = new Date().toISOString();

  // Generate ID from first concept or context
  const conceptSlug = (entry.concepts[0] || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const timestamp = Date.now().toString(36);
  const id = `nb-${conceptSlug}-${timestamp}`;

  const fullEntry: NotebookEntry = {
    ...entry,
    id,
    appliedCount: 0,
    created: now,
    updated: now,
  };

  const dir = scope === 'global'
    ? path.join(GLOBAL_NOTEBOOKS_DIR, agentId)
    : path.join(rootDir || process.cwd(), PROJECT_NOTEBOOKS_DIR, agentId);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileName = `${id}${NOTEBOOK_EXT}`;
  const filePath = path.join(dir, fileName);

  const content = yaml.dump(fullEntry, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(filePath, content, 'utf-8');

  return { entry: fullEntry, filePath };
}

/**
 * Promote a lore entry into a notebook entry.
 */
export async function promoteFromLore(
  agentId: string,
  loreEntryId: string,
  rootDir: string,
  scope: 'global' | 'project' = 'global'
): Promise<{ entry: NotebookEntry; filePath: string } | null> {
  // Dynamic import to avoid circular deps
  const { loadLoreEntry } = await import('./lore-loader.js');

  const loreEntry = await loadLoreEntry(rootDir, loreEntryId);
  if (!loreEntry) return null;

  // Extract concepts from symbols and tags
  const concepts: string[] = [];
  if (loreEntry.symbols_touched) {
    for (const sym of loreEntry.symbols_touched) {
      // Strip prefix and convert to concept
      const clean = sym.replace(/^[#$^!~]/, '').toLowerCase();
      concepts.push(clean);
    }
  }

  // Build snippet from summary + body
  let snippet = loreEntry.summary || '';
  if (loreEntry.body) {
    snippet += '\n\n' + loreEntry.body;
  }

  const provenance: NotebookProvenance = {
    source: 'lore',
    loreEntryId,
    originProject: path.basename(rootDir),
    createdBy: agentId,
  };

  return addNotebookEntry(
    agentId,
    {
      context: loreEntry.title || `Promoted from ${loreEntryId}`,
      snippet,
      provenance,
      confidence: loreEntry.confidence ?? 0.7,
      concepts,
      tags: loreEntry.tags || [],
    },
    scope,
    rootDir
  );
}

/**
 * Increment the applied count for a notebook entry.
 */
export function incrementApplied(
  agentId: string,
  entryId: string,
  rootDir: string
): boolean {
  // Try project first, then global
  const projectDir = path.join(rootDir, PROJECT_NOTEBOOKS_DIR, agentId);
  const globalDir = path.join(GLOBAL_NOTEBOOKS_DIR, agentId);

  for (const dir of [projectDir, globalDir]) {
    const filePath = path.join(dir, `${entryId}${NOTEBOOK_EXT}`);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const entry = yaml.load(content) as NotebookEntry;
        if (entry) {
          entry.appliedCount = (entry.appliedCount || 0) + 1;
          entry.updated = new Date().toISOString();
          fs.writeFileSync(filePath, yaml.dump(entry, {
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
          }), 'utf-8');
          return true;
        }
      } catch { /* skip */ }
    }
  }

  return false;
}
