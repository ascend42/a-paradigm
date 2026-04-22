/**
 * Lore Loader - Reads/writes lore entries from .paradigm/lore/
 *
 * Storage layout:
 *   .paradigm/lore/
 *     timeline.yaml          # index metadata
 *     entries/
 *       2026-02-21/
 *         L-2026-02-21-001.yaml         (legacy)
 *         L-2026-03-02-ascend-143025-001.lore  (new)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';

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
  confidence?: number; // 0.0 to 1.0
}

export type AssessmentVerdict = 'correct' | 'partial' | 'incorrect';

export interface LoreAssessment {
  verdict: AssessmentVerdict;
  assessed_by: string;
  assessed_at: string; // ISO 8601
  notes?: string;
}

export interface LoreError {
  description: string;
  resolution: string;
  time_to_fix?: string;
}

export type LoreType = 'agent-session' | 'human-note' | 'decision' | 'review' | 'incident' | 'milestone' | 'retro' | 'insight';

export type KnowledgeStream = 'work-log' | 'journal' | 'decision' | 'auto';

export interface LoreEntry {
  id: string;
  type?: LoreType;
  timestamp: string;
  duration_minutes?: number;
  author: string;
  agent?: {
    provider: string;
    model: string;
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
  body?: string;
  linked_lore?: string[];
  linked_tasks?: string[];
  linked_commits?: string[];
  confidence?: number; // 0.0 to 1.0
  assessment?: LoreAssessment;
  assessment_delta?: number;
  tags?: string[];
  stream?: KnowledgeStream;
  meta?: Record<string, unknown>;
  git_context?: {
    ref: string;
    branch: string;
    dirty: boolean;
  };
  /**
   * v6.0 (D3 locked): cross-references to knowledge-store entries. Lore
   * keeps its role as the immutable narrative timeline while canonical
   * structured storage lives in the relevant store (decisions, wisdom,
   * notebooks, protocols). When a decision is recorded via
   * paradigm_decision_record, a companion lore entry with
   * type: 'insight' and references.decision_id is written automatically.
   */
  references?: {
    decision_id?: string;
    wisdom_id?: string;
    notebook_id?: string;
    protocol_id?: string;
  };
}

export interface LoreFilter {
  author?: string;
  hasAgent?: boolean;
  /** @deprecated Use hasAgent instead */
  authorType?: 'human' | 'agent';
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: LoreType;
  stream?: KnowledgeStream;
  tag?: string;
  hasBody?: boolean;
  tags?: string[];
  hasReview?: boolean;
  hasConfidence?: boolean;
  hasAssessment?: boolean;
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
// Normalization (inlined from core to avoid cross-package dep)
// ────────────────────────────────────────────────────────

interface OldAuthorBlock {
  type: 'human' | 'agent';
  id: string;
  model?: string;
}

function inferProvider(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o1') || lower.includes('o3')) return 'openai';
  if (lower.includes('gemini') || lower.includes('google') || lower.includes('palm')) return 'google';
  if (lower.includes('llama') || lower.includes('meta')) return 'meta';
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('cohere') || lower.includes('command')) return 'cohere';
  return 'unknown';
}

function normalizeLoreEntry(raw: Record<string, unknown>): LoreEntry {
  const entry = raw as Record<string, unknown>;
  const author = entry.author;

  // Default type if not set
  if (!entry.type) {
    entry.type = 'agent-session';
  }

  if (typeof author === 'string') {
    return raw as unknown as LoreEntry;
  }

  if (author && typeof author === 'object' && !Array.isArray(author)) {
    const old = author as OldAuthorBlock;
    if (old.type === 'agent') {
      entry.author = 'unknown';
      entry.agent = {
        provider: old.model ? inferProvider(old.model) : inferProvider(old.id),
        model: old.model || old.id,
      };
    } else {
      entry.author = old.id || 'unknown';
    }
    delete entry.assistedBy;
  }

  return entry as unknown as LoreEntry;
}

// ────────────────────────────────────────────────────────
// Author resolution (inlined from core)
// ────────────────────────────────────────────────────────

function sanitizeAuthor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'unknown';
}

function resolveAuthor(): string {
  const envAuthor = process.env.PARADIGM_AUTHOR;
  if (envAuthor) return sanitizeAuthor(envAuthor);

  try {
    const gitName = execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (gitName) return sanitizeAuthor(gitName);
  } catch {
    // git not available
  }

  try {
    const username = os.userInfo().username;
    if (username) return sanitizeAuthor(username);
  } catch {
    // userInfo can fail
  }

  return 'unknown';
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/** Matches both .yaml and .lore lore entry files */
function isLoreFile(filename: string): boolean {
  return filename.endsWith('.yaml') || filename.endsWith('.lore');
}

/**
 * Resolve the file path for a lore entry ID, trying .lore first then .yaml.
 */
function resolveEntryPath(rootDir: string, dateStr: string, entryId: string): string | null {
  const dirPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr);
  const lorePath = path.join(dirPath, `${entryId}.lore`);
  if (fs.existsSync(lorePath)) return lorePath;
  const yamlPath = path.join(dirPath, `${entryId}.yaml`);
  if (fs.existsSync(yamlPath)) return yamlPath;
  return null;
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
      .filter(isLoreFile)
      .sort();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const raw = yaml.load(content) as Record<string, unknown>;
        entries.push(normalizeLoreEntry(raw));
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
    const entryPath = resolveEntryPath(rootDir, dateStr, entryId);
    if (entryPath) {
      try {
        const content = fs.readFileSync(entryPath, 'utf8');
        const raw = yaml.load(content) as Record<string, unknown>;
        return normalizeLoreEntry(raw);
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
// Git context
// ────────────────────────────────────────────────────────

function captureGitContext(cwd: string): LoreEntry['git_context'] | undefined {
  try {
    const ref = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ref, branch, dirty: status.length > 0 };
  } catch {
    return undefined;
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

  // Resolve author if not set
  if (!entry.author) {
    entry.author = resolveAuthor();
  }

  // Auto-capture git context if not already provided
  if (!entry.git_context) {
    entry.git_context = captureGitContext(rootDir);
  }

  if (!entry.id) {
    entry.id = generateLoreId(rootDir, dateStr, entry.author, entry.timestamp);
  }

  const entryPath = path.join(datePath, `${entry.id}.lore`);
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
  const entryPath = resolveEntryPath(rootDir, dateStr, entryId);

  if (!entryPath) return false;

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
    const files = fs.readdirSync(dirPath).filter(isLoreFile);

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const raw = yaml.load(content) as Record<string, unknown>;
        const entry = normalizeLoreEntry(raw);
        authors.add(entry.author);
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

function migrateLegacyEntries(rootDir: string): number {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);
  if (!fs.existsSync(entriesPath)) return 0;

  const rootFiles = fs.readdirSync(entriesPath)
    .filter(f => isLoreFile(f) && !f.startsWith('.'));

  let migrated = 0;
  for (const file of rootFiles) {
    const filePath = path.join(entriesPath, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const raw = yaml.load(content) as Record<string, unknown>;

      // Skip if already v2 format
      if (raw.author && typeof raw.author === 'object') continue;
      if (typeof raw.author === 'string' && raw.timestamp) continue;

      const dateStr = typeof raw.date === 'string'
        ? raw.date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const datePath = path.join(entriesPath, dateStr);
      if (!fs.existsSync(datePath)) {
        fs.mkdirSync(datePath, { recursive: true });
      }

      const author = resolveAuthor();
      const timestamp = `${dateStr}T00:00:00.000Z`;
      const id = generateLoreId(rootDir, dateStr, author, timestamp);

      const oldType = String(raw.type || 'agent-session');
      const v2Type = ['agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone'].includes(oldType)
        ? oldType
        : 'agent-session';

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
        timestamp,
        author: 'unknown',
        agent: { provider: 'unknown', model: 'unknown' },
        title: String(raw.title || file.replace(/\.(yaml|lore)$/, '')),
        summary: String(raw.summary || ''),
        symbols_touched: Array.isArray(raw.symbols_touched) ? raw.symbols_touched : [],
        files_modified: Array.isArray(raw.files_modified) ? raw.files_modified : undefined,
        ...(verification ? { verification: verification as LoreEntry['verification'] } : {}),
        tags: ['migrated', oldType],
      };

      fs.writeFileSync(
        path.join(datePath, `${id}.lore`),
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
  const entryPath = resolveEntryPath(rootDir, dateStr, entryId);
  if (!entryPath) return false;

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
  if (partial.body !== undefined) entry.body = partial.body;
  if (partial.linked_lore !== undefined) entry.linked_lore = partial.linked_lore;
  if (partial.linked_tasks !== undefined) entry.linked_tasks = partial.linked_tasks;
  if (partial.linked_commits !== undefined) entry.linked_commits = partial.linked_commits;
  if (partial.confidence !== undefined) entry.confidence = partial.confidence;
  if (partial.assessment !== undefined) entry.assessment = partial.assessment;
  if (partial.assessment_delta !== undefined) entry.assessment_delta = partial.assessment_delta;

  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));
  await rebuildTimeline(rootDir);
  return true;
}

/**
 * Compute implied score from assessment verdict
 */
function verdictToScore(verdict: LoreAssessment['verdict']): number {
  switch (verdict) {
    case 'correct': return 1.0;
    case 'partial': return 0.5;
    case 'incorrect': return 0.0;
  }
}

/**
 * Add or update an assessment on an existing lore entry
 */
export async function addLoreAssessment(
  rootDir: string,
  entryId: string,
  assessment: LoreAssessment
): Promise<boolean> {
  const entry = await loadLoreEntry(rootDir, entryId);
  if (!entry) return false;

  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = resolveEntryPath(rootDir, dateStr, entryId);
  if (!entryPath) return false;

  entry.assessment = assessment;

  // Compute assessment_delta if confidence exists
  if (entry.confidence != null) {
    entry.assessment_delta = verdictToScore(assessment.verdict) - entry.confidence;
  }

  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));
  return true;
}

/**
 * Delete a lore entry by ID
 */
export async function deleteLoreEntry(rootDir: string, entryId: string): Promise<boolean> {
  const entry = await loadLoreEntry(rootDir, entryId);
  if (!entry) return false;

  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = resolveEntryPath(rootDir, dateStr, entryId);
  if (!entryPath) return false;

  fs.unlinkSync(entryPath);

  // Clean up empty date directory
  const dateDir = path.dirname(entryPath);
  const remaining = fs.readdirSync(dateDir).filter(isLoreFile);
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
    result = result.filter(e => e.author === filter.author);
  }
  if (filter.hasAgent !== undefined) {
    result = result.filter(e =>
      filter.hasAgent ? e.agent != null : e.agent == null
    );
  } else if (filter.authorType) {
    // Deprecated: map old authorType to hasAgent
    result = result.filter(e =>
      filter.authorType === 'agent' ? e.agent != null : e.agent == null
    );
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
  if (filter.tag) {
    const prefix = filter.tag;
    result = result.filter(e =>
      e.tags?.some(t => t === prefix || t.startsWith(prefix + ':') || (prefix.includes(':') && t === prefix))
    );
  }

  if (filter.tags && filter.tags.length > 0) {
    result = result.filter(e => filter.tags!.some(tag => e.tags?.includes(tag)));
  }

  if (filter.hasBody !== undefined) {
    result = result.filter(e =>
      filter.hasBody ? (e.body != null && e.body.length > 0) : (!e.body || e.body.length === 0)
    );
  }
  if (filter.hasReview !== undefined) {
    result = result.filter(e => filter.hasReview ? e.review != null : e.review == null);
  }
  if (filter.hasConfidence !== undefined) {
    result = result.filter(e => filter.hasConfidence ? e.confidence != null : e.confidence == null);
  }
  if (filter.hasAssessment !== undefined) {
    result = result.filter(e => filter.hasAssessment ? e.assessment != null : e.assessment == null);
  }

  result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (filter.offset) result = result.slice(filter.offset);
  if (filter.limit) result = result.slice(0, filter.limit);

  return result;
}

function generateLoreId(rootDir: string, dateStr: string, author: string, timestamp: string): string {
  const sanitized = sanitizeAuthor(author);
  const ts = new Date(timestamp);
  const hh = String(ts.getUTCHours()).padStart(2, '0');
  const mm = String(ts.getUTCMinutes()).padStart(2, '0');
  const ss = String(ts.getUTCSeconds()).padStart(2, '0');
  const timeStr = `${hh}${mm}${ss}`;
  const prefix = `L-${dateStr}-${sanitized}-${timeStr}`;

  const datePath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr);

  if (!fs.existsSync(datePath)) {
    return `${prefix}-001`;
  }

  const existing = fs.readdirSync(datePath)
    .filter(f => f.startsWith(prefix) && isLoreFile(f))
    .map(f => {
      const match = f.match(/-(\d{3})\.(yaml|lore)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}
