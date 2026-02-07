/**
 * History CLI Commands - Implementation log, validation, fragility tracking
 *
 * Commands:
 * - paradigm history show [symbol] - Display history for symbols
 * - paradigm history fragile - Show fragile symbols
 * - paradigm history reindex - Regenerate index from log
 * - paradigm history validate - Record validation result
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';

interface HistoryEntry {
  id: string;
  ts: string;
  type: 'implement' | 'validate' | 'rollback' | 'refactor';
  symbols: string[];
  author: {
    type: 'human' | 'agent';
    id: string;
  };
  commit?: string;
  intent?: string;
  files?: string[];
  description?: string;
  ref?: string;
  result?: 'pass' | 'fail' | 'partial';
  tests?: { passed: number; failed: number; skipped?: number };
  reason?: string;
}

interface SymbolHistorySummary {
  symbol: string;
  total_changes: number;
  last_modified: string;
  stability_score: number;
  fragility: 'low' | 'medium' | 'high' | 'critical';
  recent: HistoryEntry[];
  contributors: {
    human: string[];
    agent: string[];
  };
}

interface HistoryIndex {
  version: string;
  generated: string;
  by_symbol: Record<string, SymbolHistorySummary>;
  co_changes: { symbols: string[]; frequency: number; correlation: number }[];
  fragile_symbols: { symbol: string; fragility: string; reason: string }[];
}

const HISTORY_DIR = '.paradigm/history';

/**
 * paradigm history show [symbol]
 */
export async function historyShowCommand(
  symbol?: string,
  options: { json?: boolean; limit?: number } = {}
): Promise<void> {
  const rootDir = process.cwd();
  const historyPath = path.join(rootDir, HISTORY_DIR);

  if (!fs.existsSync(historyPath)) {
    console.log(chalk.yellow('No history directory found.'));
    console.log(chalk.gray(`Run \`paradigm history init\` to create .paradigm/history/`));
    return;
  }

  const index = loadYaml<HistoryIndex>(path.join(historyPath, 'index.yaml'));
  const entries = loadLog(path.join(historyPath, 'log.jsonl'));

  if (options.json) {
    if (symbol) {
      const symbolData = index?.by_symbol?.[symbol];
      const symbolEntries = entries.filter((e) => e.symbols.includes(symbol));
      console.log(JSON.stringify({ symbol, summary: symbolData, entries: symbolEntries }, null, 2));
    } else {
      console.log(JSON.stringify({ index, entries: entries.slice(-(options.limit || 20)) }, null, 2));
    }
    return;
  }

  console.log(chalk.magenta('\n  History\n'));

  if (symbol) {
    const summary = index?.by_symbol?.[symbol];
    const symbolEntries = entries
      .filter((e) => e.symbols.includes(symbol))
      .slice(-(options.limit || 10));

    console.log(chalk.cyan(`  Symbol: ${symbol}\n`));

    if (summary) {
      const fragilityColor =
        summary.fragility === 'critical' || summary.fragility === 'high'
          ? chalk.red
          : summary.fragility === 'medium'
          ? chalk.yellow
          : chalk.green;

      console.log(chalk.white('  Summary:'));
      console.log(chalk.gray(`    Total changes: ${summary.total_changes}`));
      console.log(chalk.gray(`    Last modified: ${summary.last_modified}`));
      console.log(chalk.gray(`    Stability: ${(summary.stability_score * 100).toFixed(0)}%`));
      console.log(fragilityColor(`    Fragility: ${summary.fragility}`));
      console.log();
    }

    if (symbolEntries.length > 0) {
      console.log(chalk.white('  Recent changes:'));
      symbolEntries.forEach((e) => {
        const typeColor =
          e.type === 'rollback'
            ? chalk.red
            : e.type === 'validate'
            ? e.result === 'pass'
              ? chalk.green
              : chalk.red
            : chalk.blue;
        console.log(
          typeColor(`    [${e.type}] ${e.description || e.id}`) +
            chalk.gray(` - ${e.author.id} @ ${e.ts.split('T')[0]}`)
        );
      });
    }

    return;
  }

  // Overview
  const symbols = Object.keys(index?.by_symbol || {});
  console.log(chalk.white(`  Tracked symbols: ${symbols.length}`));
  console.log(chalk.white(`  Total entries: ${entries.length}`));
  console.log();

  // Fragile symbols
  const fragile = index?.fragile_symbols || [];
  if (fragile.length > 0) {
    console.log(chalk.red('  Fragile symbols:'));
    fragile.slice(0, 5).forEach((f) => {
      console.log(chalk.gray(`    [${f.fragility}] ${f.symbol}`));
    });
    console.log();
  }

  // Recent entries
  const recent = entries.slice(-10);
  if (recent.length > 0) {
    console.log(chalk.white('  Recent entries:'));
    recent.reverse().forEach((e) => {
      const typeColor =
        e.type === 'rollback'
          ? chalk.red
          : e.type === 'validate'
          ? e.result === 'pass'
            ? chalk.green
            : chalk.red
          : chalk.blue;
      console.log(
        typeColor(`    [${e.type}] ${e.symbols.join(', ')}`) +
          chalk.gray(` - ${e.ts.split('T')[0]}`)
      );
    });
  }
}

/**
 * paradigm history init
 */
export async function historyInitCommand(options: { force?: boolean } = {}): Promise<void> {
  const rootDir = process.cwd();
  const historyPath = path.join(rootDir, HISTORY_DIR);

  if (fs.existsSync(historyPath) && !options.force) {
    console.log(chalk.yellow('History directory already exists.'));
    console.log(chalk.gray('Use --force to reinitialize'));
    return;
  }

  fs.mkdirSync(historyPath, { recursive: true });

  // Create empty log
  fs.writeFileSync(path.join(historyPath, 'log.jsonl'), '');

  // Create empty index
  const index: HistoryIndex = {
    version: '1.0',
    generated: new Date().toISOString(),
    by_symbol: {},
    co_changes: [],
    fragile_symbols: [],
  };
  fs.writeFileSync(path.join(historyPath, 'index.yaml'), yaml.dump(index, { lineWidth: -1 }));

  // Create validation template
  const validation = {
    version: '1.0',
    total_validations: 0,
    pass_rate: 0,
    by_symbol: {},
  };
  fs.writeFileSync(path.join(historyPath, 'validation.yaml'), yaml.dump(validation, { lineWidth: -1 }));

  console.log(chalk.green('History directory initialized!'));
  console.log(chalk.gray(`  ${historyPath}/`));
  console.log(chalk.gray('    log.jsonl'));
  console.log(chalk.gray('    index.yaml'));
  console.log(chalk.gray('    validation.yaml'));
}

/**
 * paradigm history fragile
 */
export async function historyFragileCommand(options: { json?: boolean } = {}): Promise<void> {
  const rootDir = process.cwd();
  const indexPath = path.join(rootDir, HISTORY_DIR, 'index.yaml');

  if (!fs.existsSync(indexPath)) {
    console.log(chalk.yellow('No history index found.'));
    console.log(chalk.gray('Run `paradigm history reindex` to generate'));
    return;
  }

  const index = loadYaml<HistoryIndex>(indexPath);
  const fragile = index?.fragile_symbols || [];

  if (options.json) {
    console.log(JSON.stringify({ fragile }, null, 2));
    return;
  }

  console.log(chalk.magenta('\n  Fragile Symbols\n'));

  if (fragile.length === 0) {
    console.log(chalk.green('  No fragile symbols detected!'));
    return;
  }

  fragile.forEach((f) => {
    const color = f.fragility === 'critical' ? chalk.red : chalk.yellow;
    console.log(color(`  [${f.fragility}] ${f.symbol}`));
    console.log(chalk.gray(`    ${f.reason}`));
  });

  console.log();
  console.log(chalk.gray('  Recommendation: Add extra test coverage before modifying these symbols'));
}

/**
 * paradigm history reindex
 */
export async function historyReindexCommand(): Promise<void> {
  const rootDir = process.cwd();
  const historyPath = path.join(rootDir, HISTORY_DIR);
  const logPath = path.join(historyPath, 'log.jsonl');

  if (!fs.existsSync(logPath)) {
    console.log(chalk.yellow('No history log found.'));
    return;
  }

  const entries = loadLog(logPath);
  const index = buildIndex(entries);

  const indexPath = path.join(historyPath, 'index.yaml');
  fs.writeFileSync(indexPath, yaml.dump(index, { lineWidth: -1 }));

  console.log(chalk.green('History index regenerated!'));
  console.log(chalk.gray(`  Symbols: ${Object.keys(index.by_symbol).length}`));
  console.log(chalk.gray(`  Entries: ${entries.length}`));
  console.log(chalk.gray(`  Fragile: ${index.fragile_symbols.length}`));
}

/**
 * paradigm history record
 */
export async function historyRecordCommand(options: {
  type: 'implement' | 'refactor' | 'rollback';
  symbols: string;
  description: string;
  intent?: string;
  commit?: string;
  reason?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const logPath = path.join(rootDir, HISTORY_DIR, 'log.jsonl');

  fs.mkdirSync(path.join(rootDir, HISTORY_DIR), { recursive: true });

  // Count existing entries for ID
  let count = 1;
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    count = content.split('\n').filter((l) => l.trim()).length + 1;
  }

  const entry: HistoryEntry = {
    id: `h${String(count).padStart(4, '0')}`,
    ts: new Date().toISOString(),
    type: options.type,
    symbols: options.symbols.split(',').map((s) => s.trim()),
    author: { type: 'human', id: process.env.USER || 'unknown' },
    description: options.description,
    intent: options.intent as HistoryEntry['intent'],
    commit: options.commit,
    reason: options.reason,
  };

  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');

  console.log(chalk.green(`Entry ${entry.id} recorded!`));
}

/**
 * paradigm history validate
 */
export async function historyValidateCommand(options: {
  ref?: string;
  result: 'pass' | 'fail' | 'partial';
  passed?: number;
  failed?: number;
}): Promise<void> {
  const rootDir = process.cwd();
  const logPath = path.join(rootDir, HISTORY_DIR, 'log.jsonl');

  fs.mkdirSync(path.join(rootDir, HISTORY_DIR), { recursive: true });

  let count = 1;
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    count = content.split('\n').filter((l) => l.trim()).length + 1;
  }

  const entry: HistoryEntry = {
    id: `h${String(count).padStart(4, '0')}`,
    ts: new Date().toISOString(),
    type: 'validate',
    symbols: [],
    author: { type: 'agent', id: 'cli' },
    ref: options.ref,
    result: options.result,
    tests:
      options.passed !== undefined
        ? { passed: options.passed, failed: options.failed || 0 }
        : undefined,
  };

  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');

  console.log(chalk.green(`Validation ${entry.id} recorded: ${options.result}`));
}

// Helper functions
function loadYaml<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) as T;
  } catch {
    return null;
  }
}

function loadLog(logPath: string): HistoryEntry[] {
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as HistoryEntry;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as HistoryEntry[];
}

function buildIndex(entries: HistoryEntry[]): HistoryIndex {
  const bySymbol: Record<string, SymbolHistorySummary> = {};
  const symbolChanges: Record<string, HistoryEntry[]> = {};

  // Group by symbol
  for (const entry of entries) {
    for (const symbol of entry.symbols) {
      if (!symbolChanges[symbol]) symbolChanges[symbol] = [];
      symbolChanges[symbol].push(entry);
    }
  }

  // Calculate summaries
  for (const [symbol, changes] of Object.entries(symbolChanges)) {
    const sorted = changes.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    const rollbacks = changes.filter((c) => c.type === 'rollback').length;
    const failures = changes.filter((c) => c.type === 'validate' && c.result === 'fail').length;
    const total = changes.length;

    const stabilityScore = Math.max(0, 1 - (rollbacks * 0.2 + failures * 0.1) / Math.max(1, total / 10));

    let fragility: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (stabilityScore < 0.5) fragility = 'critical';
    else if (stabilityScore < 0.7) fragility = 'high';
    else if (stabilityScore < 0.85) fragility = 'medium';

    const humanContributors = new Set<string>();
    const agentContributors = new Set<string>();
    for (const change of changes) {
      if (change.author.type === 'human') humanContributors.add(change.author.id);
      else agentContributors.add(change.author.id);
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

  // Find fragile symbols
  const fragileSymbols = Object.values(bySymbol)
    .filter((s) => s.fragility === 'high' || s.fragility === 'critical')
    .map((s) => ({
      symbol: s.symbol,
      fragility: s.fragility,
      reason: `Stability score: ${(s.stability_score * 100).toFixed(0)}%`,
    }));

  return {
    version: '1.0',
    generated: new Date().toISOString(),
    by_symbol: bySymbol,
    co_changes: [],
    fragile_symbols: fragileSymbols,
  };
}
