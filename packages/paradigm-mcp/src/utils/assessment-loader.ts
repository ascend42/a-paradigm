/**
 * Assessment Loader — Arc + entry CRUD for .paradigm/assessments/
 *
 * Storage layout:
 *   .paradigm/assessments/
 *     index.yaml
 *     arcs/
 *       arc-telemetry/
 *         arc.yaml
 *         entries/
 *           A-2026-02-26-001.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ASSESSMENTS_DIR = '.paradigm/assessments';
const ARCS_DIR = 'arcs';
const INDEX_FILE = 'index.yaml';

// ── Types ─────────────────────────────────────────────────

export interface Arc {
  id: string;
  name: string;
  description?: string;
  created: string;
  status: 'active' | 'complete' | 'archived';
  tags?: string[];
}

export interface ArcWithStats extends Arc {
  entry_count: number;
  symbols: string[];
  latest_entry?: string;
}

export interface AssessmentEntry {
  id: string;
  arc_id: string;
  title: string;
  summary: string;
  body?: string;
  symbols?: string[];
  tags?: string[];
  linked_lore?: string[];
  linked_tasks?: string[];
  linked_commits?: string[];
  date: string;
  author: { type: 'human' | 'agent'; id: string; model?: string };
  type: 'retro' | 'insight' | 'decision' | 'milestone';
}

export interface AssessmentFilter {
  symbol?: string;
  tag?: string;
  type?: 'retro' | 'insight' | 'decision' | 'milestone';
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface AssessmentIndex {
  version: string;
  total_arcs: number;
  total_entries: number;
  active_arcs: number;
  last_updated: string;
  arcs: Array<{ id: string; name: string; status: string; entries: number }>;
}

// ── ID generation ─────────────────────────────────────────

/**
 * Generate a globally unique assessment entry ID.
 * Scans ALL arcs to find the max sequence for the given date.
 */
function generateAssessmentId(rootDir: string, dateStr: string): string {
  const arcsPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR);
  let maxSeq = 0;

  if (fs.existsSync(arcsPath)) {
    const arcDirs = fs.readdirSync(arcsPath).filter(d => {
      try { return fs.statSync(path.join(arcsPath, d)).isDirectory(); } catch { return false; }
    });

    for (const arcDir of arcDirs) {
      const entriesPath = path.join(arcsPath, arcDir, 'entries');
      if (!fs.existsSync(entriesPath)) continue;

      const files = fs.readdirSync(entriesPath).filter(f =>
        f.startsWith(`A-${dateStr}-`) && f.endsWith('.yaml'),
      );

      for (const file of files) {
        const match = file.match(/A-\d{4}-\d{2}-\d{2}-(\d+)\.yaml/);
        if (match) {
          const seq = parseInt(match[1], 10);
          if (seq > maxSeq) maxSeq = seq;
        }
      }
    }
  }

  return `A-${dateStr}-${String(maxSeq + 1).padStart(3, '0')}`;
}

// ── Arc operations ────────────────────────────────────────

function computeArcStats(rootDir: string, arc: Arc): ArcWithStats {
  const entriesPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR, arc.id, 'entries');
  const symbolSet = new Set<string>();
  let entryCount = 0;
  let latestDate: string | undefined;

  if (fs.existsSync(entriesPath)) {
    const files = fs.readdirSync(entriesPath).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      try {
        const entry = yaml.load(fs.readFileSync(path.join(entriesPath, file), 'utf8')) as AssessmentEntry;
        entryCount++;
        if (entry.symbols) entry.symbols.forEach(s => symbolSet.add(s));
        if (!latestDate || entry.date > latestDate) latestDate = entry.date;
      } catch {
        // Skip malformed
      }
    }
  }

  return { ...arc, entry_count: entryCount, symbols: Array.from(symbolSet), latest_entry: latestDate };
}

export async function loadArcs(rootDir: string, status?: string): Promise<ArcWithStats[]> {
  const arcsPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR);
  if (!fs.existsSync(arcsPath)) return [];

  const arcDirs = fs.readdirSync(arcsPath).filter(d => {
    try { return fs.statSync(path.join(arcsPath, d)).isDirectory(); } catch { return false; }
  });

  const arcs: ArcWithStats[] = [];
  for (const arcDir of arcDirs) {
    const arcFile = path.join(arcsPath, arcDir, 'arc.yaml');
    if (!fs.existsSync(arcFile)) continue;

    try {
      const arc = yaml.load(fs.readFileSync(arcFile, 'utf8')) as Arc;
      if (status && status !== 'all' && arc.status !== status) continue;
      arcs.push(computeArcStats(rootDir, arc));
    } catch {
      // Skip malformed
    }
  }

  arcs.sort((a, b) => {
    const aDate = a.latest_entry || a.created;
    const bDate = b.latest_entry || b.created;
    return bDate.localeCompare(aDate);
  });

  return arcs;
}

export async function loadArc(rootDir: string, arcId: string): Promise<ArcWithStats | null> {
  const arcFile = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR, arcId, 'arc.yaml');
  if (!fs.existsSync(arcFile)) return null;

  try {
    const arc = yaml.load(fs.readFileSync(arcFile, 'utf8')) as Arc;
    return computeArcStats(rootDir, arc);
  } catch {
    return null;
  }
}

const ARC_ID_PATTERN = /^arc-[a-z0-9-]+$/;

export async function createArc(
  rootDir: string,
  arc: { id: string; name: string; description?: string; tags?: string[] },
): Promise<string> {
  if (!ARC_ID_PATTERN.test(arc.id)) {
    throw new Error(`Invalid arc ID "${arc.id}": must match arc-{kebab-case} (lowercase alphanumeric + hyphens)`);
  }

  const arcPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR, arc.id);
  const entriesPath = path.join(arcPath, 'entries');
  fs.mkdirSync(entriesPath, { recursive: true });

  const arcData: Arc = {
    id: arc.id,
    name: arc.name,
    description: arc.description,
    created: new Date().toISOString(),
    status: 'active',
    tags: arc.tags,
  };

  fs.writeFileSync(path.join(arcPath, 'arc.yaml'), yaml.dump(arcData, { lineWidth: -1, noRefs: true }));
  await rebuildAssessmentIndex(rootDir);
  return arc.id;
}

export async function closeArc(rootDir: string, arcId: string, status: 'complete' | 'archived'): Promise<boolean> {
  const arcFile = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR, arcId, 'arc.yaml');
  if (!fs.existsSync(arcFile)) return false;

  try {
    const arc = yaml.load(fs.readFileSync(arcFile, 'utf8')) as Arc;
    arc.status = status;
    fs.writeFileSync(arcFile, yaml.dump(arc, { lineWidth: -1, noRefs: true }));
    await rebuildAssessmentIndex(rootDir);
    return true;
  } catch {
    return false;
  }
}

// ── Entry operations ──────────────────────────────────────

export async function loadEntries(rootDir: string, arcId: string): Promise<AssessmentEntry[]> {
  const entriesPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR, arcId, 'entries');
  if (!fs.existsSync(entriesPath)) return [];

  const entries: AssessmentEntry[] = [];
  const files = fs.readdirSync(entriesPath).filter(f => f.endsWith('.yaml')).sort();

  for (const file of files) {
    try {
      const entry = yaml.load(fs.readFileSync(path.join(entriesPath, file), 'utf8')) as AssessmentEntry;
      entries.push(entry);
    } catch {
      // Skip malformed
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

export async function loadEntry(rootDir: string, entryId: string): Promise<{ entry: AssessmentEntry; arc: Arc } | null> {
  const arcsPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR);
  if (!fs.existsSync(arcsPath)) return null;

  const arcDirs = fs.readdirSync(arcsPath).filter(d => {
    try { return fs.statSync(path.join(arcsPath, d)).isDirectory(); } catch { return false; }
  });

  for (const arcDir of arcDirs) {
    const entryFile = path.join(arcsPath, arcDir, 'entries', `${entryId}.yaml`);
    if (fs.existsSync(entryFile)) {
      try {
        const entry = yaml.load(fs.readFileSync(entryFile, 'utf8')) as AssessmentEntry;
        const arcFile = path.join(arcsPath, arcDir, 'arc.yaml');
        const arc = yaml.load(fs.readFileSync(arcFile, 'utf8')) as Arc;
        return { entry, arc };
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function recordEntry(
  rootDir: string,
  entry: {
    arc_id: string;
    title: string;
    summary: string;
    body?: string;
    symbols?: string[];
    tags?: string[];
    type?: string;
    linked_lore?: string[];
    linked_tasks?: string[];
    linked_commits?: string[];
  },
  arcName?: string,
  arcDescription?: string,
): Promise<string> {
  const arcPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR, entry.arc_id);
  if (!fs.existsSync(path.join(arcPath, 'arc.yaml'))) {
    if (!arcName) {
      throw new Error(`Arc "${entry.arc_id}" does not exist. Provide arc_name to create it.`);
    }
    await createArc(rootDir, { id: entry.arc_id, name: arcName, description: arcDescription, tags: entry.symbols });
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const id = generateAssessmentId(rootDir, dateStr);

  const fullEntry: AssessmentEntry = {
    id,
    arc_id: entry.arc_id,
    title: entry.title,
    summary: entry.summary,
    body: entry.body,
    symbols: entry.symbols,
    tags: entry.tags,
    linked_lore: entry.linked_lore,
    linked_tasks: entry.linked_tasks,
    linked_commits: entry.linked_commits,
    date: now.toISOString(),
    author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' },
    type: (entry.type as AssessmentEntry['type']) || 'retro',
  };

  const entriesPath = path.join(arcPath, 'entries');
  fs.mkdirSync(entriesPath, { recursive: true });
  fs.writeFileSync(path.join(entriesPath, `${id}.yaml`), yaml.dump(fullEntry, { lineWidth: -1, noRefs: true }));

  await rebuildAssessmentIndex(rootDir);
  return id;
}

// ── Search ────────────────────────────────────────────────

export async function searchEntries(rootDir: string, filter: AssessmentFilter): Promise<AssessmentEntry[]> {
  const arcsPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR);
  if (!fs.existsSync(arcsPath)) return [];

  const limit = filter.limit || 20;
  const results: AssessmentEntry[] = [];

  const arcDirs = fs.readdirSync(arcsPath).filter(d => {
    try { return fs.statSync(path.join(arcsPath, d)).isDirectory(); } catch { return false; }
  });

  for (const arcDir of arcDirs) {
    const entriesPath = path.join(arcsPath, arcDir, 'entries');
    if (!fs.existsSync(entriesPath)) continue;

    const files = fs.readdirSync(entriesPath).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      try {
        const entry = yaml.load(fs.readFileSync(path.join(entriesPath, file), 'utf8')) as AssessmentEntry;

        if (filter.symbol && !(entry.symbols || []).includes(filter.symbol)) continue;
        if (filter.tag && !(entry.tags || []).includes(filter.tag)) continue;
        if (filter.type && entry.type !== filter.type) continue;
        if (filter.dateFrom && entry.date < filter.dateFrom) continue;
        if (filter.dateTo && entry.date > filter.dateTo) continue;

        results.push(entry);
      } catch {
        // Skip malformed
      }
    }
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results.slice(0, limit);
}

// ── Index ─────────────────────────────────────────────────

export async function rebuildAssessmentIndex(rootDir: string): Promise<AssessmentIndex> {
  const arcsPath = path.join(rootDir, ASSESSMENTS_DIR, ARCS_DIR);
  const assessmentsPath = path.join(rootDir, ASSESSMENTS_DIR);

  let totalArcs = 0, totalEntries = 0, activeArcs = 0;
  const arcSummaries: Array<{ id: string; name: string; status: string; entries: number }> = [];

  if (fs.existsSync(arcsPath)) {
    const arcDirs = fs.readdirSync(arcsPath).filter(d => {
      try { return fs.statSync(path.join(arcsPath, d)).isDirectory(); } catch { return false; }
    });

    for (const arcDir of arcDirs) {
      const arcFile = path.join(arcsPath, arcDir, 'arc.yaml');
      if (!fs.existsSync(arcFile)) continue;

      try {
        const arc = yaml.load(fs.readFileSync(arcFile, 'utf8')) as Arc;
        const entriesPath = path.join(arcsPath, arcDir, 'entries');
        const entryCount = fs.existsSync(entriesPath)
          ? fs.readdirSync(entriesPath).filter(f => f.endsWith('.yaml')).length
          : 0;

        totalArcs++;
        totalEntries += entryCount;
        if (arc.status === 'active') activeArcs++;
        arcSummaries.push({ id: arc.id, name: arc.name, status: arc.status, entries: entryCount });
      } catch {
        // Skip malformed
      }
    }
  }

  const index: AssessmentIndex = {
    version: '1.0',
    total_arcs: totalArcs,
    total_entries: totalEntries,
    active_arcs: activeArcs,
    last_updated: new Date().toISOString(),
    arcs: arcSummaries,
  };

  fs.mkdirSync(assessmentsPath, { recursive: true });
  fs.writeFileSync(path.join(assessmentsPath, INDEX_FILE), yaml.dump(index, { lineWidth: -1, noRefs: true }));
  return index;
}
