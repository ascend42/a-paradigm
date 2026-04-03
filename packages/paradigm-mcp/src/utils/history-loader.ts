/**
 * History Loader - Loads implementation history from .paradigm/history/
 *
 * Parses:
 * - log.jsonl: Append-only implementation log (one JSON object per line)
 * - index.yaml: Pre-computed symbol index (regenerated from log)
 * - validation.yaml: Validation config and summary
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import type {
  HistoryContext,
  HistoryEntry,
  HistoryIndex,
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
 * Load all history data from a project directory
 */
export async function loadHistoryContext(rootDir: string): Promise<HistoryContext> {
  const historyPath = path.join(rootDir, HISTORY_DIR);

  if (!fs.existsSync(historyPath)) {
    return {
      index: null,
      validation: null,
    };
  }

  const [index, validation] = await Promise.all([
    loadHistoryIndex(historyPath),
    loadValidationSummary(historyPath),
  ]);

  return {
    index,
    validation,
  };
}

/**
 * Load index.yaml
 */
async function loadHistoryIndex(historyPath: string): Promise<HistoryIndex | null> {
  const filePath = path.join(historyPath, 'index.yaml');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(content) as HistoryIndex;
    return data;
  } catch (error) {
    log.component('#history-loader').error('Error parsing index.yaml', { error: (error as Error).message });
    return null;
  }
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
 * Load entries from log.jsonl (can be memory-intensive for large logs)
 */
export async function loadHistoryLog(rootDir: string): Promise<HistoryEntry[]> {
  const logPath = path.join(rootDir, HISTORY_DIR, 'log.jsonl');

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const entries: HistoryEntry[] = [];

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        entries.push(entry);
      } catch (error) {
        log.component('#history-loader').error('Error parsing log line', { error: (error as Error).message });
      }
    }
  } catch (error) {
    log.component('#history-loader').error('Error reading log.jsonl', { error: (error as Error).message });
  }

  return entries;
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

  // Generate ID and timestamp
  const id = generateEntryId(logPath);
  const ts = new Date().toISOString();

  const fullEntry: HistoryEntry = {
    id,
    ts,
    ...entry,
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
 * Generate a unique entry ID
 */
function generateEntryId(logPath: string): string {
  let count = 1;

  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    count = content.split('\n').filter((line) => line.trim()).length + 1;
  }

  return `h${String(count).padStart(4, '0')}`;
}

/**
 * Regenerate the history index from the log
 */
export async function regenerateHistoryIndex(rootDir: string): Promise<HistoryIndex> {
  const entries = await loadHistoryLog(rootDir);
  const index = buildHistoryIndex(entries);

  // Save the index
  const indexPath = path.join(rootDir, HISTORY_DIR, 'index.yaml');
  fs.writeFileSync(indexPath, yaml.dump(index, { lineWidth: -1 }));

  return index;
}

/**
 * Build a history index from entries
 */
function buildHistoryIndex(entries: HistoryEntry[]): HistoryIndex {
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
