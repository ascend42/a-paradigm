/**
 * paradigm notebook — Agent notebook management commands
 *
 * Commands:
 *   paradigm notebook list    — List notebook entries for an agent
 *   paradigm notebook show    — Show a specific entry
 *   paradigm notebook export  — Export entries as YAML or JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';

// ============================================================================
// Types (duplicated from paradigm-mcp to avoid cross-package import)
// ============================================================================

interface NotebookEntry {
  id: string;
  context: string;
  snippet: string;
  provenance: { source: string; loreEntryId?: string; originProject?: string; createdBy?: string };
  appliedCount: number;
  confidence: number;
  concepts: string[];
  tags: string[];
  created: string;
  updated: string;
}

const GLOBAL_NOTEBOOKS_DIR = path.join(os.homedir(), '.paradigm', 'notebooks');
const PROJECT_NOTEBOOKS_DIR = '.paradigm/notebooks';
const NOTEBOOK_PREFIX = 'nb-';
const NOTEBOOK_EXT = '.yaml';

// ============================================================================
// paradigm notebook list
// ============================================================================

export interface NotebookListOptions {
  agent?: string;
  json?: boolean;
}

export async function notebookListCommand(options: NotebookListOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('notebook-list').start('Listing notebook entries', { cwd });

  const agentId = options.agent || 'all';
  const entries = loadEntries(cwd, agentId === 'all' ? undefined : agentId);

  if (options.json) {
    console.log(JSON.stringify({ count: entries.length, entries: entries.map(summarize) }, null, 2));
    tracker.success(`Found ${entries.length} entries`);
    return;
  }

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  paradigm notebook list                           ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray(`  Agent: ${agentId}`.padEnd(50)) + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  if (entries.length === 0) {
    console.log(chalk.yellow('  No notebook entries found.'));
    console.log(chalk.gray('  Add entries via paradigm_notebook_add or paradigm_notebook_promote.\n'));
    tracker.success('No entries found');
    return;
  }

  for (const e of entries) {
    const concepts = e.concepts.join(', ') || chalk.gray('none');
    const applied = e.appliedCount > 0 ? chalk.green(`${e.appliedCount}x applied`) : chalk.gray('unused');
    console.log(`  ${chalk.white.bold(e.id)}`);
    console.log(`    ${chalk.gray(e.context.slice(0, 80))}`);
    console.log(`    Concepts: ${concepts}  |  ${applied}  |  Confidence: ${(e.confidence * 100).toFixed(0)}%`);
    console.log('');
  }

  tracker.success(`Listed ${entries.length} entries`);
}

// ============================================================================
// paradigm notebook show
// ============================================================================

export interface NotebookShowOptions {
  agent?: string;
  json?: boolean;
}

export async function notebookShowCommand(id: string, options: NotebookShowOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('notebook-show').start(`Showing notebook ${id}`, { cwd });

  const entries = loadEntries(cwd, options.agent);
  const entry = entries.find(e => e.id === id);

  if (!entry) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Entry "${id}" not found` }));
    } else {
      console.log(chalk.red(`\n  Entry "${id}" not found.\n`));
    }
    tracker.error(`Entry ${id} not found`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(entry, null, 2));
    tracker.success(`Showed entry ${id}`);
    return;
  }

  console.log(chalk.blue(`\n  Notebook Entry: ${id}\n`));
  console.log(`  ${chalk.white.bold('Context:')} ${entry.context}`);
  console.log(`  ${chalk.white.bold('Concepts:')} ${entry.concepts.join(', ')}`);
  console.log(`  ${chalk.white.bold('Tags:')} ${entry.tags.join(', ') || '(none)'}`);
  console.log(`  ${chalk.white.bold('Confidence:')} ${(entry.confidence * 100).toFixed(0)}%`);
  console.log(`  ${chalk.white.bold('Applied:')} ${entry.appliedCount} times`);
  console.log(`  ${chalk.white.bold('Provenance:')} ${entry.provenance.source}${entry.provenance.loreEntryId ? ` (${entry.provenance.loreEntryId})` : ''}`);
  console.log(`  ${chalk.white.bold('Created:')} ${entry.created}`);
  console.log(`  ${chalk.white.bold('Updated:')} ${entry.updated}`);
  console.log(`\n  ${chalk.white.bold('Snippet:')}`);
  console.log(chalk.gray('  ─'.repeat(25)));
  for (const line of entry.snippet.split('\n')) {
    console.log(`  ${line}`);
  }
  console.log(chalk.gray('  ─'.repeat(25)));
  console.log('');

  tracker.success(`Showed entry ${id}`);
}

// ============================================================================
// paradigm notebook export
// ============================================================================

export interface NotebookExportOptions {
  agent?: string;
  format?: string;
}

export async function notebookExportCommand(options: NotebookExportOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('notebook-export').start('Exporting notebook entries', { cwd });

  const entries = loadEntries(cwd, options.agent);
  const format = options.format || 'yaml';

  if (format === 'json') {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    console.log(yaml.dump(entries, { lineWidth: 120, noRefs: true }));
  }

  tracker.success(`Exported ${entries.length} entries as ${format}`);
}

// ============================================================================
// Helpers
// ============================================================================

function loadEntries(rootDir: string, agentId?: string): NotebookEntry[] {
  const entries: NotebookEntry[] = [];
  const dirs: string[] = [];

  if (agentId) {
    dirs.push(path.join(GLOBAL_NOTEBOOKS_DIR, agentId));
    dirs.push(path.join(rootDir, PROJECT_NOTEBOOKS_DIR, agentId));
  } else {
    // Load all agents
    for (const base of [GLOBAL_NOTEBOOKS_DIR, path.join(rootDir, PROJECT_NOTEBOOKS_DIR)]) {
      if (fs.existsSync(base)) {
        try {
          const agentDirs = fs.readdirSync(base, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => path.join(base, d.name));
          dirs.push(...agentDirs);
        } catch { /* skip */ }
      }
    }
  }

  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter(f =>
        f.startsWith(NOTEBOOK_PREFIX) && f.endsWith(NOTEBOOK_EXT)
      );
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const entry = yaml.load(content) as NotebookEntry;
          if (entry?.id && !seen.has(entry.id)) {
            seen.add(entry.id);
            entries.push(entry);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return entries.sort((a, b) => b.appliedCount - a.appliedCount);
}

function summarize(e: NotebookEntry) {
  return {
    id: e.id,
    context: e.context.slice(0, 100),
    concepts: e.concepts,
    appliedCount: e.appliedCount,
    confidence: e.confidence,
    provenance: e.provenance.source,
  };
}
