/**
 * History Loader - Loads implementation history from .paradigm/history/ and git
 *
 * Sources ($history-derivation, T-2026-11-06-001):
 * - git: one row per commit carrying symbols, derived on read (#history-git),
 *   cached per SHA in the machine home. No hook writes history any more.
 * - log.jsonl (tracked, merge=union): tool-authored rows (history record /
 *   validate, the MCP tools) plus the frozen legacy rows the pre-v4
 *   post-commit hook appended.
 * - index.yaml: GENERATED and git-ignored. ensureHistoryIndex rebuilds it when
 *   missing or stale (stamp: HEAD, log.jsonl size/mtime, cache size) and only
 *   writes it when git ignores it, so a read never dirties the tree.
 * - validation.yaml: Validation config and summary
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import { deriveCommitEntries, gitHead, historyCachePath, historyGitEnv, writeFileAtomic, HISTORY_DERIVE_VERSION } from './history-git.js';
import type {
  HistoryContext,
  HistoryEntry,
  HistoryIndex,
  HistoryStamp,
  ValidationSummary,
  SymbolHistory,
  SymbolHistorySummary,
  FragilityCheck,
  FragileSymbol,
  FragilityLevel,
  CoChangePattern,
} from '../types/history.js';

const HISTORY_DIR = '.paradigm/history';

/**
 * Load all history data from a project directory. The index is the generated
 * one (ensureHistoryIndex): present on a fresh clone too, as long as the
 * project has a .paradigm/ folder.
 */
export async function loadHistoryContext(rootDir: string): Promise<HistoryContext> {
  if (!fs.existsSync(path.join(rootDir, '.paradigm'))) {
    return {
      index: null,
      validation: null,
    };
  }

  const historyPath = path.join(rootDir, HISTORY_DIR);
  const index = ensureHistoryIndex(rootDir);
  const validation = await loadValidationSummary(historyPath);

  return {
    index,
    validation,
    shallow: index.shallow === true,
  };
}

/** What the index for `rootDir` would be built from right now. Cheap: one rev-parse and two stats. */
export function currentHistoryStamp(rootDir: string): HistoryStamp {
  const logPath = path.join(rootDir, HISTORY_DIR, 'log.jsonl');
  let logSize = 0;
  let logMtimeMs = 0;
  try {
    const st = fs.statSync(logPath);
    logSize = st.size;
    logMtimeMs = Math.floor(st.mtimeMs);
  } catch { /* no log */ }
  let cacheCount = 0;
  try {
    cacheCount = fs.statSync(historyCachePath(rootDir)).size;
  } catch { /* no cache yet, or no home directory */ }
  return { v: HISTORY_DERIVE_VERSION, head: gitHead(rootDir), logSize, logMtimeMs, cacheCount, shallow: shallowFileStamp(rootDir) };
}

/** Size and mtime of `git rev-parse --git-path shallow` ("" when not shallow), so `fetch --unshallow` invalidates the index. */
function shallowFileStamp(rootDir: string): string {
  try {
    const rel = execFileSync('git', ['--no-optional-locks', 'rev-parse', '--git-path', 'shallow'], {
      cwd: rootDir, env: historyGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 5000,
    }).trim();
    const st = fs.statSync(path.resolve(rootDir, rel));
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    return '';
  }
}

function sameStamp(a: HistoryStamp | undefined, b: HistoryStamp): boolean {
  return !!a && a.v === b.v && a.head === b.head && a.logSize === b.logSize && a.logMtimeMs === b.logMtimeMs && a.cacheCount === b.cacheCount && (a.shallow ?? '') === (b.shallow ?? '');
}

/** True when the context's index was built from the repository's current state. */
export function isHistoryContextFresh(rootDir: string, history: HistoryContext | null | undefined): boolean {
  if (!history) return false;
  if (!history.index) return !fs.existsSync(path.join(rootDir, '.paradigm'));
  return sameStamp(history.index.stamp, currentHistoryStamp(rootDir));
}

/**
 * Whether the generated index may be written: git ignores it (after
 * `paradigm sync`), or the project is not in a git repository. A tracked or
 * not-yet-ignored index.yaml is never rewritten, so reading history never
 * dirties the tree of an unmigrated repository.
 */
export function canWriteHistoryIndex(rootDir: string, opts: { timeout?: number } = {}): boolean {
  try {
    execFileSync('git', ['--no-optional-locks', 'check-ignore', '-q', '--', `${HISTORY_DIR}/index.yaml`], {
      cwd: rootDir,
      env: historyGitEnv(), // a v3 pre-push calls `history reindex` inside a hook, with GIT_DIR set
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
      shell: false,
      timeout: opts.timeout ?? 5000,
    });
    return true; // exit 0: ignored
  } catch (err) {
    const e = err as { status?: number | null; code?: string; stderr?: string };
    if (e.code === 'ENOENT') return true; // no git at all: nothing can track the file
    if (e.status === 128 && /not a git repository/i.test(String(e.stderr ?? ''))) return true;
    return false; // 1 = not ignored or tracked; a signal, timeout or anything else: never risk a tracked file
  }
}

/**
 * The generated history index: read index.yaml when its stamp matches the
 * current state, else rebuild from loadMergedHistory and write it back when
 * canWriteHistoryIndex. Never throws.
 */
export function ensureHistoryIndex(rootDir: string): HistoryIndex {
  const stamp = currentHistoryStamp(rootDir);
  const filePath = path.join(rootDir, HISTORY_DIR, 'index.yaml');
  try {
    if (fs.existsSync(filePath)) {
      const data = yaml.load(fs.readFileSync(filePath, 'utf8')) as HistoryIndex | null;
      if (data && sameStamp(data.stamp, stamp)) return data;
    }
  } catch (error) {
    log.component('#history-loader').warn('Rebuilding unreadable index.yaml', { error: (error as Error).message });
  }
  return rebuildHistoryIndex(rootDir);
}

/** Test-only: runs between reading log.jsonl and stamping (simulates a concurrent append). */
let afterLogReadHook: (() => void) | null = null;
export function __setAfterLogReadHookForTests(fn: (() => void) | null): void {
  afterLogReadHook = fn;
}

function rebuildHistoryIndex(rootDir: string): HistoryIndex {
  // log.jsonl size/mtime BEFORE reading it: an append meanwhile then reads as stale.
  const before = currentHistoryStamp(rootDir);
  const merged = loadMergedHistory(rootDir);
  afterLogReadHook?.();
  const index = buildHistoryIndex(merged.entries);
  // Cache size after deriving (the derivation grows it); the HEAD the rows were
  // derived from. An incomplete derivation stamps head null, so the next read
  // rebuilds, and is never written.
  const after = currentHistoryStamp(rootDir);
  index.stamp = { ...before, cacheCount: after.cacheCount, head: merged.complete ? merged.head : null };
  if (merged.shallow) index.shallow = true;
  if (merged.complete && canWriteHistoryIndex(rootDir)) {
    try {
      writeFileAtomic(path.join(rootDir, HISTORY_DIR, 'index.yaml'), yaml.dump(index, { lineWidth: -1 }));
    } catch (error) {
      log.component('#history-loader').warn('Could not write index.yaml', { error: (error as Error).message });
    }
  }
  return index;
}

/**
 * Load validation.yaml
 */
async function loadValidationSummary(historyPath: string): Promise<ValidationSummary | null> {
  const filePath = path.join(historyPath, 'validation.yaml');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(content) as ValidationSummary;
    return data;
  } catch (error) {
    log.component('#history-loader').error('Error parsing validation.yaml', { error: (error as Error).message });
    return null;
  }
}

/**
 * Load entries from log.jsonl (can be memory-intensive for large logs).
 * Each row gets its `source`: rows written before derivation carry none and
 * read as 'legacy'.
 */
export async function loadHistoryLog(rootDir: string): Promise<HistoryEntry[]> {
  return readLogRows(rootDir);
}

function readLogRows(rootDir: string): HistoryEntry[] {
  const logPath = path.join(rootDir, HISTORY_DIR, 'log.jsonl');

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const entries: HistoryEntry[] = [];

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());

    let malformed = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
        if (!Array.isArray(entry.symbols)) entry.symbols = [];
        entry.source = entry.source === 'authored' ? 'authored' : 'legacy';
        entries.push(entry);
      } catch {
        malformed++; // e.g. legacy hook rows with unescaped quotes; skipped on every read, so not an error
      }
    }
    if (malformed > 0) log.component('#history-loader').debug('Skipped malformed log.jsonl lines', { malformed });
  } catch (error) {
    log.component('#history-loader').error('Error reading log.jsonl', { error: (error as Error).message });
  }

  return entries;
}

export interface MergedHistory {
  /** Oldest first. */
  entries: HistoryEntry[];
  shallow: boolean;
  /** The HEAD the derived rows were read at (null outside git). */
  head: string | null;
  /** False when some reachable commit could not be derived (see DerivedHistory.complete). */
  complete: boolean;
}

/**
 * log.jsonl rows (legacy + authored) ∪ rows derived from git, deduped by
 * `commit`: a log row for a commit wins over its derived row, so a legacy id
 * still resolves. Derived rows are only those reachable from HEAD. Legacy ids
 * that occur more than once (the old `wc -l + 1` rule minted the same id on
 * two branches) become `<id>@<sha7>` so each resolves to one row.
 */
export function loadMergedHistory(rootDir: string): MergedHistory {
  const logRows = readLogRows(rootDir);
  const covered = new Set(logRows.map((e) => e.commit).filter((c): c is string => typeof c === 'string' && c.length > 0));

  const legacyCount = new Map<string, number>();
  for (const e of logRows) if (e.source === 'legacy') legacyCount.set(e.id, (legacyCount.get(e.id) ?? 0) + 1);
  for (const e of logRows) {
    if (e.source === 'legacy' && (legacyCount.get(e.id) ?? 0) > 1 && e.commit) e.id = `${e.id}@${e.commit.slice(0, 7)}`;
  }

  const derived = deriveCommitEntries(rootDir);
  const entries = [...logRows, ...derived.entries.filter((e) => !e.commit || !covered.has(e.commit))];
  entries.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0));
  return { entries, shallow: derived.shallow, head: derived.head, complete: derived.complete };
}

/**
 * Find the entry `ref` names: an exact id (`h-…`, `h0042`, `h0042@abc1234`),
 * or a bare legacy id when exactly one row carries it. Null when unknown or
 * ambiguous.
 */
export function resolveHistoryId(entries: HistoryEntry[], ref: string): HistoryEntry | null {
  const exact = entries.find((e) => e.id === ref);
  if (exact) return exact;
  const byBare = entries.filter((e) => e.id.startsWith(`${ref}@`));
  return byBare.length === 1 ? byBare[0] : null;
}

/**
 * Load recent entries from log.jsonl (last N entries)
 */
export async function loadRecentHistory(
  rootDir: string,
  limit: number = 50
): Promise<HistoryEntry[]> {
  const logPath = path.join(rootDir, HISTORY_DIR, 'log.jsonl');

  if (!fs.existsSync(logPath)) {
    return [];
  }

  // Read from end of file for efficiency
  const entries: HistoryEntry[] = [];

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());

    // Get last N lines
    const recentLines = lines.slice(-limit);

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        entries.push(entry);
      } catch (error) {
        // Skip malformed lines
      }
    }
  } catch (error) {
    log.component('#history-loader').error('Error reading log.jsonl', { error: (error as Error).message });
  }

  return entries;
}

/**
 * Get history for specific symbols
 */
export function getHistoryForSymbols(
  history: HistoryContext,
  symbols: string[]
): SymbolHistory[] {
  return symbols.map((symbol) => getSymbolHistory(history, symbol));
}

/**
 * Get history for a single symbol
 */
export function getSymbolHistory(
  history: HistoryContext,
  symbol: string
): SymbolHistory {
  const summary = history.index?.by_symbol?.[symbol] || null;

  // Find co-change patterns that include this symbol
  const coChanges: string[] = [];
  if (history.index?.co_changes) {
    for (const pattern of history.index.co_changes) {
      if (pattern.symbols.includes(symbol)) {
        for (const s of pattern.symbols) {
          if (s !== symbol && !coChanges.includes(s)) {
            coChanges.push(s);
          }
        }
      }
    }
  }

  const validation = history.validation?.by_symbol?.[symbol] || null;

  return {
    symbol,
    summary,
    recent: summary?.recent || [],
    co_changes: coChanges,
    validation,
  };
}

/**
 * Check fragility for symbols before modifying them
 */
export function checkFragility(
  history: HistoryContext,
  symbols: string[]
): FragilityCheck {
  const fragile: FragileSymbol[] = [];
  const warnings: string[] = [];

  if (!history.index) {
    return {
      symbols,
      fragile: [],
      warnings: ['No history index available - cannot assess fragility'],
      safe_to_modify: true,
      recommendations: [],
    };
  }

  // Check each symbol
  for (const symbol of symbols) {
    const summary = history.index.by_symbol?.[symbol];

    if (summary && (summary.fragility === 'high' || summary.fragility === 'critical')) {
      fragile.push({
        symbol,
        fragility: summary.fragility,
        reason: `Stability score: ${summary.stability_score.toFixed(2)}`,
      });
    }

    // Check if symbol is in the fragile list
    const fragileEntry = history.index.fragile_symbols?.find((f) => f.symbol === symbol);
    if (fragileEntry && !fragile.find((f) => f.symbol === symbol)) {
      fragile.push(fragileEntry);
    }
  }

  // Check for co-change patterns
  for (const symbol of symbols) {
    const coChanges = history.index.co_changes?.filter((c) => c.symbols.includes(symbol));
    if (coChanges?.length) {
      for (const pattern of coChanges) {
        const otherSymbols = pattern.symbols.filter((s) => s !== symbol && !symbols.includes(s));
        if (otherSymbols.length > 0 && pattern.correlation > 0.7) {
          warnings.push(
            `${symbol} often changes with ${otherSymbols.join(', ')} (${Math.round(pattern.correlation * 100)}% correlation)`
          );
        }
      }
    }
  }

  if (history.shallow) {
    warnings.push('Shallow clone: history for commits beyond the clone depth is missing (git fetch --unshallow for the full record)');
  }

  const safeToModify = fragile.filter((f) => f.fragility === 'critical').length === 0;

  const recommendations: string[] = [];
  if (fragile.length > 0) {
    recommendations.push('Consider adding extra test coverage before modifying fragile symbols');
    recommendations.push('Review recent rollbacks and failures for these symbols');
  }
  if (warnings.length > 0) {
    recommendations.push('Check if co-changing symbols also need updates');
  }

  return {
    symbols,
    fragile,
    warnings,
    safe_to_modify: safeToModify,
    recommendations,
  };
}

/**
 * Record a new history entry
 */
export async function recordHistoryEntry(
  rootDir: string,
  entry: Omit<HistoryEntry, 'id' | 'ts'>
): Promise<string> {
  const historyPath = path.join(rootDir, HISTORY_DIR);
  const logPath = path.join(historyPath, 'log.jsonl');

  // Ensure directory exists
  if (!fs.existsSync(historyPath)) {
    fs.mkdirSync(historyPath, { recursive: true });
  }

  // Collision-free id (two branches recording at once never mint the same one)
  const id = newHistoryId();
  const ts = new Date().toISOString();

  const fullEntry: HistoryEntry = {
    id,
    ts,
    ...entry,
    source: 'authored',
  };

  // Append to log
  const line = JSON.stringify(fullEntry) + '\n';
  fs.appendFileSync(logPath, line);

  return id;
}

/**
 * Record a validation result
 */
export async function recordValidation(
  rootDir: string,
  implementationId: string,
  result: 'pass' | 'fail' | 'partial',
  tests?: { passed: number; failed: number; skipped?: number }
): Promise<string> {
  return recordHistoryEntry(rootDir, {
    type: 'validate',
    symbols: [],
    author: { type: 'agent', id: 'system' },
    ref: implementationId,
    result,
    tests,
  });
}

/**
 * A new authored history id: `h-<base36 ms><4 random base36>`. Time-sortable
 * and collision-free across branches and clones (no counter). The base36 ms
 * part starts with a non-hex letter until the 2050s, so it never equals a
 * derived `h-<sha12>` id.
 */
export function newHistoryId(now: number = Date.now()): string {
  const rand = randomBytes(4).readUInt32BE(0) % (36 ** 4);
  return `h-${now.toString(36)}${rand.toString(36).padStart(4, '0')}`;
}

/**
 * Regenerate the history index (log.jsonl merged with git), writing it when
 * git ignores index.yaml (canWriteHistoryIndex).
 */
export async function regenerateHistoryIndex(rootDir: string): Promise<HistoryIndex> {
  return rebuildHistoryIndex(rootDir);
}

/**
 * Build a history index from entries
 */
export function buildHistoryIndex(entries: HistoryEntry[]): HistoryIndex {
  const bySymbol: Record<string, SymbolHistorySummary> = {};
  const symbolChanges: Record<string, HistoryEntry[]> = {};

  // Group entries by symbol
  for (const entry of entries) {
    for (const symbol of entry.symbols) {
      if (!symbolChanges[symbol]) {
        symbolChanges[symbol] = [];
      }
      symbolChanges[symbol].push(entry);
    }
  }

  // Calculate summaries
  for (const [symbol, changes] of Object.entries(symbolChanges)) {
    const sorted = changes.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    // Calculate stability score
    const rollbacks = changes.filter((c) => c.type === 'rollback').length;
    const failures = changes.filter(
      (c) => c.type === 'validate' && c.result === 'fail'
    ).length;
    const total = changes.length;

    const stabilityScore = Math.max(
      0,
      1 - (rollbacks * 0.2 + failures * 0.1) / Math.max(1, total / 10)
    );

    // Determine fragility level
    let fragility: FragilityLevel = 'low';
    if (stabilityScore < 0.5) fragility = 'critical';
    else if (stabilityScore < 0.7) fragility = 'high';
    else if (stabilityScore < 0.85) fragility = 'medium';

    // Get contributors
    const humanContributors = new Set<string>();
    const agentContributors = new Set<string>();
    for (const change of changes) {
      if (change.author.type === 'human') {
        humanContributors.add(change.author.id);
      } else {
        agentContributors.add(change.author.id);
      }
    }

    bySymbol[symbol] = {
      symbol,
      total_changes: total,
      last_modified: sorted[0]?.ts || new Date().toISOString(),
      stability_score: stabilityScore,
      fragility,
      recent: sorted.slice(0, 5),
      contributors: {
        human: Array.from(humanContributors),
        agent: Array.from(agentContributors),
      },
    };
  }

  // Find co-change patterns
  const coChanges = findCoChangePatterns(entries);

  // Find fragile symbols
  const fragileSymbols: FragileSymbol[] = Object.values(bySymbol)
    .filter((s) => s.fragility === 'high' || s.fragility === 'critical')
    .map((s) => ({
      symbol: s.symbol,
      fragility: s.fragility,
      reason: `Stability score: ${s.stability_score.toFixed(2)}`,
    }));

  return {
    version: '1.0',
    generated: new Date().toISOString(),
    by_symbol: bySymbol,
    co_changes: coChanges,
    fragile_symbols: fragileSymbols,
  };
}

/**
 * Find co-change patterns from entries
 */
function findCoChangePatterns(entries: HistoryEntry[]): CoChangePattern[] {
  const pairCounts: Record<string, number> = {};
  const symbolCounts: Record<string, number> = {};

  // Count occurrences
  for (const entry of entries) {
    if (entry.symbols.length < 2) continue;

    for (const symbol of entry.symbols) {
      symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
    }

    // Count pairs
    const sorted = [...entry.symbols].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  }

  // Convert to patterns
  const patterns: CoChangePattern[] = [];

  for (const [key, frequency] of Object.entries(pairCounts)) {
    if (frequency < 3) continue; // Minimum threshold

    const [s1, s2] = key.split('|');
    const minCount = Math.min(symbolCounts[s1], symbolCounts[s2]);
    const correlation = frequency / minCount;

    if (correlation > 0.3) {
      patterns.push({
        symbols: [s1, s2],
        frequency,
        correlation,
      });
    }
  }

  // Sort by frequency
  patterns.sort((a, b) => b.frequency - a.frequency);

  return patterns.slice(0, 20); // Keep top 20
}
