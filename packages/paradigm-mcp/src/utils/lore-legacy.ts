/**
 * lore-legacy.ts — the one implementation of legacy lore-entry migration,
 * shared by the MCP lore-loader and the CLI's core/lore/storage.ts (which
 * imports this file by relative path, as it does task-loader).
 *
 * Legacy entries are root-level YAML files in `.paradigm/lore/entries/`
 * (no date partition). They migrate to `entries/<date>/<id>.lore`.
 *
 * - `planLegacyMigration` is PURE (reads only): read paths use it to show
 *   legacy entries exactly as they will look after migration.
 * - `migrateLegacyEntries` moves the files: write paths only (and
 *   `paradigm migrate`'s `lore-legacy-entries` step).
 *
 * Symbol: #lore-legacy
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const LORE_DIR = '.paradigm/lore';
const ENTRIES_DIR = 'entries';

/** Matches both .yaml and .lore lore entry files */
export function isLoreFile(filename: string): boolean {
  return filename.endsWith('.yaml') || filename.endsWith('.lore');
}

/** The v2 entry a legacy file becomes (structurally a LoreEntry in both packages). */
export interface MigratedLegacyEntry {
  id: string;
  type: string;
  timestamp: string;
  author: string;
  agent: { provider: string; model: string };
  title: string;
  summary: string;
  symbols_touched: unknown[];
  files_modified?: unknown[];
  verification?: { status: 'pass' | 'partial'; details: { tests: 'pass' | 'fail' } };
  tags: string[];
}

export interface PlannedLegacyEntry {
  sourcePath: string;
  dateStr: string;
  fileName: string;
  entry: MigratedLegacyEntry;
}

/**
 * Generate a unique lore entry ID for a given date: L-{date}-{author}-{HHMMSS}-{counter}.
 * `author` must already be sanitized. `reserved` holds ids a caller allocated but has not written yet.
 */
export function allocateLoreId(
  rootDir: string,
  dateStr: string,
  sanitizedAuthor: string,
  timestamp: string,
  reserved?: ReadonlySet<string>,
): string {
  const ts = new Date(timestamp);
  const hh = String(ts.getUTCHours()).padStart(2, '0');
  const mm = String(ts.getUTCMinutes()).padStart(2, '0');
  const ss = String(ts.getUTCSeconds()).padStart(2, '0');
  const prefix = `L-${dateStr}-${sanitizedAuthor}-${hh}${mm}${ss}`;

  const datePath = path.join(rootDir, LORE_DIR, ENTRIES_DIR, dateStr);
  const names = fs.existsSync(datePath) ? fs.readdirSync(datePath) : [];
  for (const r of reserved ?? []) names.push(`${r}.lore`);
  const existing = names
    .filter(f => f.startsWith(prefix) && isLoreFile(f))
    .map(f => {
      const match = f.match(/-(\d{3})\.(yaml|lore)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

/**
 * Plan the migration (PURE: reads only). Ids are allocated as
 * `migrateLegacyEntries` allocates them (disk files plus earlier planned ids).
 * `resolveAuthor` returns the sanitized author used in the id.
 */
export function planLegacyMigration(rootDir: string, resolveAuthor: () => string): PlannedLegacyEntry[] {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);
  if (!fs.existsSync(entriesPath)) return [];

  const rootFiles = fs.readdirSync(entriesPath)
    .filter(f => isLoreFile(f) && !f.startsWith('.'))
    .sort();

  const planned: PlannedLegacyEntry[] = [];
  const reserved = new Set<string>();
  let author: string | undefined;
  for (const file of rootFiles) {
    const filePath = path.join(entriesPath, file);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
      const raw = yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

      // Already v2 (author block as object — old style — or author string + timestamp): not legacy.
      if (raw.author && typeof raw.author === 'object') continue;
      if (typeof raw.author === 'string' && raw.timestamp) continue;

      // Old format uses `date: "2026-02-21"`
      const dateStr = typeof raw.date === 'string'
        ? raw.date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      author ??= resolveAuthor();
      const timestamp = `${dateStr}T00:00:00.000Z`;
      const id = allocateLoreId(rootDir, dateStr, author, timestamp, reserved);
      reserved.add(id);

      // v6.0: 'decision' is no longer a valid LoreType. v1 entries with
      // type:'decision' are remapped to 'insight' and tagged
      // `v6-migrated:from-decision` (the canonical decision record lives in
      // .paradigm/decisions/).
      const oldType = String(raw.type || 'agent-session');
      const wasDecision = oldType === 'decision';
      const v2Type = wasDecision
        ? 'insight'
        : (['agent-session', 'human-note', 'review', 'incident', 'milestone', 'insight'].includes(oldType)
          ? oldType
          : 'agent-session');

      let verification: MigratedLegacyEntry['verification'];
      if (raw.test_results && typeof raw.test_results === 'object') {
        const tr = raw.test_results as Record<string, number>;
        verification = {
          status: tr.total === tr.passed ? 'pass' : 'partial',
          details: { tests: tr.total === tr.passed ? 'pass' : 'fail' },
        };
      }

      const tags = ['migrated', oldType];
      if (wasDecision) tags.push('v6-migrated:from-decision');

      const entry: MigratedLegacyEntry = {
        id,
        type: v2Type,
        timestamp,
        author: 'unknown',
        agent: { provider: 'unknown', model: 'unknown' },
        title: String(raw.title || file.replace(/\.(yaml|lore)$/, '')),
        summary: String(raw.summary || ''),
        symbols_touched: Array.isArray(raw.symbols_touched) ? raw.symbols_touched : [],
        files_modified: Array.isArray(raw.files_modified) ? raw.files_modified : undefined,
        ...(verification ? { verification } : {}),
        tags,
      };
      planned.push({ sourcePath: filePath, dateStr, fileName: `${id}.lore`, entry });
    } catch {
      // Skip files that can't be parsed
    }
  }
  return planned;
}

/** The planned entry as the migrated file will hold it (YAML round-trip), still un-normalized. */
export function plannedEntryRaw(p: PlannedLegacyEntry): Record<string, unknown> {
  return yaml.load(yaml.dump(p.entry, { lineWidth: -1, noRefs: true })) as Record<string, unknown>;
}

/** Move legacy entries into dated v2 files. WRITE paths only. Returns the number moved. */
export function migrateLegacyEntries(rootDir: string, resolveAuthor: () => string): number {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);
  let migrated = 0;
  for (const p of planLegacyMigration(rootDir, resolveAuthor)) {
    try {
      const datePath = path.join(entriesPath, p.dateStr);
      if (!fs.existsSync(datePath)) fs.mkdirSync(datePath, { recursive: true });
      fs.writeFileSync(path.join(datePath, p.fileName), yaml.dump(p.entry, { lineWidth: -1, noRefs: true }));
      fs.unlinkSync(p.sourcePath);
      migrated++;
    } catch {
      // Leave the legacy file in place; reads still show it via the plan.
    }
  }
  return migrated;
}

/**
 * Read every lore entry file, newest date first, legacy entries included as
 * planned (PURE). `parse` turns raw YAML into the caller's entry type; it may
 * throw to skip a malformed file.
 */
export function readLoreEntriesWithLegacy<T>(
  rootDir: string,
  resolveAuthor: () => string,
  parse: (raw: Record<string, unknown>) => T,
  range?: { dateFrom?: string; dateTo?: string },
): T[] {
  const entriesPath = path.join(rootDir, LORE_DIR, ENTRIES_DIR);
  if (!fs.existsSync(entriesPath)) return [];

  const plannedByDate = new Map<string, PlannedLegacyEntry[]>();
  for (const p of planLegacyMigration(rootDir, resolveAuthor)) {
    const list = plannedByDate.get(p.dateStr) ?? [];
    list.push(p);
    plannedByDate.set(p.dateStr, list);
  }

  const dateDirs = [...new Set([
    ...fs.readdirSync(entriesPath).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ...plannedByDate.keys(),
  ])].sort().reverse();

  const out: T[] = [];
  for (const dateDir of dateDirs) {
    if (range?.dateFrom && dateDir < range.dateFrom.slice(0, 10)) continue;
    if (range?.dateTo && dateDir > range.dateTo.slice(0, 10)) continue;

    const dirPath = path.join(entriesPath, dateDir);
    const items: { name: string; load: () => Record<string, unknown> }[] = [];
    if (fs.existsSync(dirPath)) {
      for (const f of fs.readdirSync(dirPath).filter(isLoreFile)) {
        items.push({ name: f, load: () => yaml.load(fs.readFileSync(path.join(dirPath, f), 'utf8')) as Record<string, unknown> });
      }
    }
    for (const p of plannedByDate.get(dateDir) ?? []) items.push({ name: p.fileName, load: () => plannedEntryRaw(p) });
    items.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

    for (const item of items) {
      try {
        out.push(parse(item.load()));
      } catch {
        // Skip malformed files
      }
    }
  }
  return out;
}

/**
 * True when `id` may be joined into a file path: letters, digits, `-` and `_`
 * only (no path separator, no dot, so no `..`). A lookup by any other id must
 * not build a path from it; it may only compare it against stored ids.
 */
export function isPathSafeLoreId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,160}$/.test(id);
}
