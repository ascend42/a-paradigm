/**
 * Lore Storage - Read/write lore entries as date-partitioned YAML files
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
import type { LoreEntry, LoreFilter, LoreTimeline, LoreAssessment } from './types.js';
import { applyLoreFilter } from './filter.js';
import { normalizeLoreEntry } from './normalize.js';
import { resolveAuthor, sanitizeAuthor } from './resolve-author.js';

const LORE_DIR = '.paradigm/lore';
const ENTRIES_DIR = 'entries';
const TIMELINE_FILE = 'timeline.yaml';

/** Matches both .yaml and .lore lore entry files */
function isLoreFile(filename: string): boolean {
  return filename.endsWith('.yaml') || filename.endsWith('.lore');
}

/**
 * Resolve the file path for a lore entry ID, trying .lore first then .yaml.
 */
function resolveEntryPath(rootDir: string, dateStr: string, entryId: string): string | null {
  const dirPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr);
  // Try .lore first (new format)
  const lorePath = path.join(dirPath, `${entryId}.lore`);
  if (fs.existsSync(lorePath)) return lorePath;
  // Fall back to .yaml (legacy)
  const yamlPath = path.join(dirPath, `${entryId}.yaml`);
  if (fs.existsSync(yamlPath)) return yamlPath;
  return null;
}

/**
 * Capture git context (ref, branch, dirty) from the working directory.
 * Returns undefined if not in a git repo or git is unavailable.
 */
export function captureGitContext(cwd: string): LoreEntry['git_context'] | undefined {
  try {
    const ref = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ref, branch, dirty: status.length > 0 };
  } catch {
    return undefined;
  }
}

/** Options for recording lore */
export interface RecordLoreOptions {
  /** When true, validate that symbols_touched/symbols_created exist in .purpose files or symbol index */
  validateSymbols?: boolean;
}

/** Result of symbol validation during lore recording */
export interface SymbolValidationResult {
  /** Symbols that were not found in .purpose files or index */
  unregistered: string[];
  /** Warning messages for the caller */
  warnings: string[];
}

/**
 * Validate that symbols referenced in a lore entry are registered in the project.
 * Checks .purpose files for symbol declarations.
 */
function validateLoreSymbols(rootDir: string, symbols: string[]): SymbolValidationResult {
  const result: SymbolValidationResult = { unregistered: [], warnings: [] };
  if (symbols.length === 0) return result;

  // Collect all declared symbols from .purpose files
  const declaredSymbols = new Set<string>();

  try {
    const findResult = require('child_process').execSync(
      `find "${rootDir}" -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null || true`,
      { encoding: 'utf-8' }
    ) as string;

    for (const purposePath of findResult.split('\n').filter(Boolean)) {
      try {
        const content = fs.readFileSync(purposePath, 'utf8');
        // Match v2 symbol declarations: lines starting with #name:, $name:, ^name:, !name:, ~name:
        const symbolMatches = content.matchAll(/^([#$^!~][\w-]+):/gm);
        for (const match of symbolMatches) {
          declaredSymbols.add(match[1]);
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // find not available — skip validation
    return result;
  }

  // Also check flows.yaml
  const flowsPath = path.join(rootDir, '.paradigm', 'flows.yaml');
  if (fs.existsSync(flowsPath)) {
    try {
      const content = fs.readFileSync(flowsPath, 'utf8');
      const symbolMatches = content.matchAll(/([#$^!~][\w-]+)/g);
      for (const match of symbolMatches) {
        declaredSymbols.add(match[1]);
      }
    } catch {
      // Skip
    }
  }

  // Also check portal.yaml for gates
  const portalPath = path.join(rootDir, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const content = fs.readFileSync(portalPath, 'utf8');
      const gateMatches = content.matchAll(/\^([\w-]+)/g);
      for (const match of gateMatches) {
        declaredSymbols.add(`^${match[1]}`);
      }
    } catch {
      // Skip
    }
  }

  for (const symbol of symbols) {
    if (!declaredSymbols.has(symbol)) {
      result.unregistered.push(symbol);
      result.warnings.push(`Symbol "${symbol}" not found in .purpose files or project index`);
    }
  }

  return result;
}

/**
 * Record a new lore entry - writes to dated directory
 *
 * When `options.validateSymbols` is true, checks symbols_touched and
 * symbols_created against .purpose files and logs warnings for unregistered symbols.
 * The entry is still recorded regardless of validation results.
 */
export async function recordLore(
  rootDir: string,
  entry: LoreEntry,
  options?: RecordLoreOptions,
): Promise<{ validation?: SymbolValidationResult }> {
  // Validate symbols if requested
  let validation: SymbolValidationResult | undefined;
  if (options?.validateSymbols) {
    const allSymbols = [
      ...(entry.symbols_touched || []),
      ...(entry.symbols_created || []),
    ];
    validation = validateLoreSymbols(rootDir, allSymbols);
  }

  const lorePath = path.join(rootDir, LORE_DIR);
  const dateStr = entry.timestamp.slice(0, 10); // "2026-02-21"
  const datePath = path.join(lorePath, ENTRIES_DIR, dateStr);

  // Ensure directory exists
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

  // Generate ID if not provided
  if (!entry.id) {
    entry.id = generateLoreId(rootDir, dateStr, entry.author, entry.timestamp);
  }

  // Write entry as .lore
  const entryPath = path.join(datePath, `${entry.id}.lore`);
  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));

  // Rebuild timeline index
  await rebuildTimeline(rootDir);

  return { validation };
}

/**
 * Draft a lore entry from session breadcrumbs (auto-lore).
 * Called when 3+ files were modified in a session.
 * Returns a partial entry that can be finalized by the user/agent.
 */
export function draftLoreFromBreadcrumbs(
  _rootDir: string,
  breadcrumbs: Array<{ tool: string; args?: Record<string, unknown>; timestamp?: string }>,
  modifiedFiles: string[],
  symbolsTouched: string[],
  sessionContext?: string,
): Partial<LoreEntry> {
  // Infer title from session context or modified files
  const title = sessionContext
    ? sessionContext.substring(0, 80)
    : `Session: ${modifiedFiles.length} files modified`;

  // Infer summary from breadcrumbs
  const toolCounts = new Map<string, number>();
  for (const bc of breadcrumbs) {
    toolCounts.set(bc.tool, (toolCounts.get(bc.tool) || 0) + 1);
  }
  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tool, count]) => `${tool} (${count}x)`)
    .join(', ');

  const summary = [
    `Modified ${modifiedFiles.length} files across ${symbolsTouched.length} symbols.`,
    topTools ? `Key tools used: ${topTools}.` : '',
    sessionContext ? `Context: ${sessionContext}` : '',
  ].filter(Boolean).join(' ');

  return {
    type: 'agent-session',
    title,
    summary,
    symbols_touched: symbolsTouched,
    files_modified: modifiedFiles,
    tags: ['auto-draft'],
  };
}

/**
 * Load lore entries with optional filtering
 */
export async function loadLoreEntries(rootDir: string, filter?: LoreFilter): Promise<LoreEntry[]> {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);

  if (!fs.existsSync(entriesPath)) {
    return [];
  }

  // Auto-migrate any legacy root-level entries first
  migrateLegacyEntries(rootDir);

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
  const entryPath = resolveEntryPath(rootDir, dateStr, entryId);

  if (!entryPath) {
    return false;
  }

  // Update entry with review
  entry.review = review;
  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));

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
export async function addAssessment(
  rootDir: string,
  entryId: string,
  assessment: LoreAssessment
): Promise<boolean> {
  const entries = await loadLoreEntries(rootDir);
  const entry = entries.find(e => e.id === entryId);

  if (!entry) {
    return false;
  }

  const dateStr = entry.timestamp.slice(0, 10);
  const entryPath = resolveEntryPath(rootDir, dateStr, entryId);

  if (!entryPath) {
    return false;
  }

  entry.assessment = assessment;

  // Compute assessment_delta if confidence exists
  if (entry.confidence != null) {
    entry.assessment_delta = verdictToScore(assessment.verdict) - entry.confidence;
  }

  fs.writeFileSync(entryPath, yaml.dump(entry, { lineWidth: -1, noRefs: true }));

  return true;
}

/**
 * Load a single entry by ID
 */
export async function loadLoreEntry(rootDir: string, entryId: string): Promise<LoreEntry | null> {
  // Extract date from ID: "L-2026-02-21-001" or "L-2026-03-02-ascend-143025-001"
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

  // Fallback: scan all entries
  const entries = await loadLoreEntries(rootDir);
  return entries.find(e => e.id === entryId) || null;
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

/**
 * Migrate old-format lore entries (root-level YAML without date partitioning)
 * to v2 schema in dated directories. Runs automatically on rebuild/load.
 */
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

      // Skip if already v2 format (has author block as object — old style)
      // or author as string (new style) — these should be in date dirs
      if (raw.author && typeof raw.author === 'object') continue;
      if (typeof raw.author === 'string' && raw.timestamp) continue;

      // Extract date — old format uses `date: "2026-02-21"`
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

      // Map old type to v2 type.
      // v6.0: 'decision' is no longer a valid LoreType. v1 entries with
      // type:'decision' are remapped to 'insight' on migration to preserve the
      // timeline. The canonical decision record lives in .paradigm/decisions/.
      // Forensic audit trail: when remapped, we add the `v6-migrated:from-decision`
      // tag so users can recover the original type via paradigm_lore_search
      // (mirrors migrate-assessments.ts's `assessment:decision` preservation).
      const oldType = String(raw.type || 'agent-session');
      const wasDecision = oldType === 'decision';
      const v2Type = wasDecision
        ? 'insight'
        : (['agent-session', 'human-note', 'review', 'incident', 'milestone', 'insight'].includes(oldType)
          ? oldType
          : 'agent-session');

      // Convert test_results to verification
      let verification: LoreEntry['verification'] | undefined;
      if (raw.test_results && typeof raw.test_results === 'object') {
        const tr = raw.test_results as Record<string, number>;
        verification = {
          status: tr.total === tr.passed ? 'pass' : 'partial',
          details: { tests: tr.total === tr.passed ? 'pass' : 'fail' },
        };
      }

      const migrationTags = ['migrated', oldType];
      if (wasDecision) migrationTags.push('v6-migrated:from-decision');

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
        ...(verification ? { verification } : {}),
        tags: migrationTags,
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
 * Generate a unique lore entry ID for a given date.
 * New format: L-{date}-{author}-{HHMMSS}-{counter}
 */
export function generateLoreId(rootDir: string, dateStr: string, author: string, timestamp: string): string {
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

  // Count existing entries with the same prefix
  const existing = fs.readdirSync(datePath)
    .filter(f => f.startsWith(prefix) && isLoreFile(f))
    .map(f => {
      const match = f.match(/-(\d{3})\.(yaml|lore)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}
