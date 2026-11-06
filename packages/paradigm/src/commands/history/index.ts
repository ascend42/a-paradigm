/**
 * History CLI Commands - Implementation log, validation, fragility tracking
 *
 * Commands:
 * - paradigm history show [symbol] - Display history for symbols
 * - paradigm history fragile - Show fragile symbols
 * - paradigm history reindex - Regenerate the generated index
 * - paradigm history record / validate - Append an authored row to log.jsonl
 *
 * Commit history is derived from git on read ($history-derivation); these
 * commands share the MCP server's loader (one id rule, one merge, one index
 * builder), so the CLI and the tools never disagree.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import {
  buildHistoryIndex,
  canWriteHistoryIndex,
  ensureHistoryIndex,
  loadMergedHistory,
  recordHistoryEntry,
  regenerateHistoryIndex,
} from '../../../../paradigm-mcp/src/utils/history-loader.js';
import type { HistoryIntent } from '../../../../paradigm-mcp/src/types/history.js';

const HISTORY_DIR = '.paradigm/history';

/**
 * paradigm history show [symbol]
 */
export async function historyShowCommand(
  symbol?: string,
  options: { json?: boolean; limit?: number } = {}
): Promise<void> {
  const rootDir = process.cwd();

  if (!fs.existsSync(path.join(rootDir, '.paradigm'))) {
    console.log(chalk.yellow('No .paradigm/ directory found.'));
    console.log(chalk.gray('Run `paradigm init` first.'));
    return;
  }

  // Derive once: the index for display is built from the same merged set.
  const { entries, shallow } = loadMergedHistory(rootDir);
  const index = buildHistoryIndex(entries);

  if (options.json) {
    if (symbol) {
      const symbolData = index?.by_symbol?.[symbol];
      const symbolEntries = entries.filter((e) => e.symbols.includes(symbol));
      console.log(JSON.stringify({ symbol, summary: symbolData, entries: symbolEntries }, null, 2));
    } else {
      console.log(JSON.stringify({ index, shallow, entries: entries.slice(-(options.limit || 20)) }, null, 2));
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
  const fromGit = entries.filter((e) => e.source === 'git').length;
  console.log(chalk.white(`  Tracked symbols: ${symbols.length}`));
  console.log(chalk.white(`  Total entries: ${entries.length}`) + chalk.gray(` (${fromGit} from git, ${entries.length - fromGit} in log.jsonl)`));
  if (shallow) console.log(chalk.yellow('  Shallow clone: commits beyond the clone depth are missing.'));
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

  // Create the authored log (commit history is derived from git; index.yaml is generated and git-ignored)
  if (!fs.existsSync(path.join(historyPath, 'log.jsonl')) || options.force) {
    fs.writeFileSync(path.join(historyPath, 'log.jsonl'), '');
  }

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
  console.log(chalk.gray('    log.jsonl        (authored rows; commit history is derived from git)'));
  console.log(chalk.gray('    validation.yaml'));
}

/**
 * paradigm history fragile
 */
export async function historyFragileCommand(options: { json?: boolean } = {}): Promise<void> {
  const rootDir = process.cwd();

  if (!fs.existsSync(path.join(rootDir, '.paradigm'))) {
    console.log(chalk.yellow('No .paradigm/ directory found.'));
    return;
  }

  const index = ensureHistoryIndex(rootDir);
  const fragile = index.fragile_symbols || [];

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

  if (!fs.existsSync(path.join(rootDir, '.paradigm'))) {
    console.log(chalk.yellow('No .paradigm/ directory found.'));
    return;
  }

  const index = await regenerateHistoryIndex(rootDir);
  const entries = Object.values(index.by_symbol).reduce((n, s) => n + s.total_changes, 0);

  if (canWriteHistoryIndex(rootDir)) {
    console.log(chalk.green('History index regenerated!'));
  } else {
    console.log(chalk.yellow('History index computed but not written: .paradigm/history/index.yaml is not git-ignored.'));
    console.log(chalk.gray('  Run `paradigm sync` (it ignores and untracks the generated index), then commit.'));
  }
  console.log(chalk.gray(`  Symbols: ${Object.keys(index.by_symbol).length}`));
  console.log(chalk.gray(`  Symbol changes: ${entries}`));
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

  const id = await recordHistoryEntry(rootDir, {
    type: options.type,
    symbols: options.symbols.split(',').map((s) => s.trim()).filter(Boolean),
    author: { type: 'human', id: process.env.USER || process.env.USERNAME || 'unknown' },
    description: options.description,
    intent: options.intent as HistoryIntent | undefined,
    commit: options.commit,
    reason: options.reason,
  });

  console.log(chalk.green(`Entry ${id} recorded!`));
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

  const id = await recordHistoryEntry(rootDir, {
    type: 'validate',
    symbols: [],
    author: { type: 'agent', id: 'cli' },
    ref: options.ref,
    result: options.result,
    tests:
      options.passed !== undefined
        ? { passed: options.passed, failed: options.failed || 0 }
        : undefined,
  });

  console.log(chalk.green(`Validation ${id} recorded: ${options.result}`));
}
