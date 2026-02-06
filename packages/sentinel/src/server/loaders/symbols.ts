/**
 * Symbol index loader for the server
 *
 * Uses premise-core aggregator for symbol extraction, with fallback
 * to local scanning if premise-core is unavailable.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

// =============================================================================
// Paradigm Logger (inline for Sentinel)
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogData {
  [key: string]: unknown;
}

// Default to 'info' - set SENTINEL_LOG_LEVEL=error to quiet, =debug for verbose
const LOG_LEVEL = process.env.SENTINEL_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL as LogLevel];
}

function formatData(data?: LogData): string {
  if (!data) return '';
  const entries = Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return chalk.gray(` ${entries}`);
}

const log = {
  component(name: string) {
    const symbol = chalk.magenta(`#${name}`);
    return {
      debug: (msg: string, data?: LogData) => {
        if (shouldLog('debug')) console.log(`${chalk.gray('○')} ${symbol} ${msg}${formatData(data)}`);
      },
      info: (msg: string, data?: LogData) => {
        if (shouldLog('info')) console.log(`${chalk.blue('ℹ')} ${symbol} ${msg}${formatData(data)}`);
      },
      warn: (msg: string, data?: LogData) => {
        if (shouldLog('warn')) console.log(`${chalk.yellow('⚠')} ${symbol} ${msg}${formatData(data)}`);
      },
      error: (msg: string, data?: LogData) => {
        if (shouldLog('error')) console.error(`${chalk.red('✖')} ${symbol} ${msg}${formatData(data)}`);
      },
    };
  },
  flow(name: string) {
    const symbol = chalk.yellow(`$${name}`);
    return {
      debug: (msg: string, data?: LogData) => {
        if (shouldLog('debug')) console.log(`${chalk.gray('○')} ${symbol} ${msg}${formatData(data)}`);
      },
      info: (msg: string, data?: LogData) => {
        if (shouldLog('info')) console.log(`${chalk.blue('ℹ')} ${symbol} ${msg}${formatData(data)}`);
      },
      warn: (msg: string, data?: LogData) => {
        if (shouldLog('warn')) console.log(`${chalk.yellow('⚠')} ${symbol} ${msg}${formatData(data)}`);
      },
      error: (msg: string, data?: LogData) => {
        if (shouldLog('error')) console.error(`${chalk.red('✖')} ${symbol} ${msg}${formatData(data)}`);
      },
    };
  },
};

// =============================================================================
// Types
// =============================================================================

export interface SymbolEntry {
  id: string;
  symbol: string;
  type: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
  source: 'purpose' | 'gate' | 'dream' | 'premise';
  filePath: string;
  data: Record<string, unknown>;
  description?: string;
  references: string[];
  referencedBy: string[];
  tags?: string[];
}

export interface ParadigmConfig {
  name?: string;
  discipline?: string;
  version?: string;
  conventions?: Record<string, unknown>;
}

// Common framework aliases that look like symbols but aren't
const SYMBOL_BLOCKLIST = new Set([
  '$lib', '$env', '$app', '$service-worker',
  '$virtual', '$schema', '$ref', '$id', '$type',
]);

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load Paradigm configuration from .paradigm/config.yaml
 */
export async function loadParadigmConfig(projectDir: string): Promise<ParadigmConfig> {
  const configPath = path.join(projectDir, '.paradigm', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    // Try to extract name from package.json
    const packagePath = path.join(projectDir, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        return { name: pkg.name };
      } catch {
        // Ignore parse errors
      }
    }
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Simple YAML parsing for common fields
    const config: ParadigmConfig = {};

    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (nameMatch) config.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

    const disciplineMatch = content.match(/^discipline:\s*(.+)$/m);
    if (disciplineMatch) config.discipline = disciplineMatch[1].trim();

    const versionMatch = content.match(/^version:\s*(.+)$/m);
    if (versionMatch) config.version = versionMatch[1].trim();

    return config;
  } catch (error) {
    log.component('config-loader').error('Failed to load Paradigm config', { error: String(error) });
    return {};
  }
}

// =============================================================================
// Symbol Loading - Primary (premise-core)
// =============================================================================

/**
 * Load symbol index using premise-core aggregator
 */
async function loadWithPremiseCore(projectDir: string): Promise<SymbolEntry[] | null> {
  try {
    // Dynamic import to handle cases where premise-core isn't available
    const { aggregateFromDirectory } = await import('@a-company/premise-core');

    log.flow('load-symbols').info('Using premise-core aggregator', { path: projectDir });

    const result = await aggregateFromDirectory(projectDir);

    // Log what was found
    const counts: Record<string, number> = {};
    for (const sym of result.symbols) {
      counts[sym.type] = (counts[sym.type] || 0) + 1;
    }

    log.flow('load-symbols').info('Aggregation complete', {
      total: result.symbols.length,
      ...counts,
      purposeFiles: result.purposeFiles.length,
      gateFiles: result.gateFiles.length,
    });

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        log.component('aggregator').warn('Aggregation error', {
          source: err.source,
          file: err.filePath,
          message: err.message,
        });
      }
    }

    // Log each source file
    for (const file of result.purposeFiles) {
      log.component('purpose-loader').info('Loaded .purpose file', { file: path.relative(projectDir, file) });
    }
    for (const file of result.gateFiles) {
      log.component('gate-loader').info('Loaded portal.yaml', { file: path.relative(projectDir, file) });
    }

    return result.symbols as SymbolEntry[];
  } catch (error) {
    log.component('premise-core').warn('premise-core not available, using fallback scanner', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// =============================================================================
// Symbol Loading - Fallback (local scanner)
// =============================================================================

/**
 * Load symbol index from .paradigm/index.json or scan .purpose files
 */
export async function loadSymbolIndex(projectDir: string): Promise<SymbolEntry[]> {
  log.flow('load-symbols').info('Loading symbols', { projectDir });

  // First try to load from cached index
  const indexPath = path.join(projectDir, '.paradigm', 'index.json');

  if (fs.existsSync(indexPath)) {
    try {
      log.component('index-loader').info('Found cached index', { path: indexPath });
      const content = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(content);
      const entries = Array.isArray(index.entries) ? index.entries : (Array.isArray(index) ? index : null);

      if (entries) {
        log.flow('load-symbols').info('Loaded from cached index', { count: entries.length });
        return entries;
      }
    } catch (error) {
      log.component('index-loader').error('Failed to load cached index', { error: String(error) });
    }
  }

  // Try premise-core aggregator
  const premiseResult = await loadWithPremiseCore(projectDir);
  if (premiseResult) {
    return premiseResult;
  }

  // Fall back to local scanning
  log.flow('load-symbols').info('Using fallback scanner');
  return scanPurposeFiles(projectDir);
}

/**
 * Scan project for .purpose files and extract symbols (fallback)
 */
async function scanPurposeFiles(projectDir: string): Promise<SymbolEntry[]> {
  const symbols: SymbolEntry[] = [];
  const seenIds = new Set<string>();

  // Common directories to scan
  const scanDirs = ['src', 'lib', 'packages', 'apps', '.'];

  for (const dir of scanDirs) {
    const fullPath = path.join(projectDir, dir);
    if (fs.existsSync(fullPath)) {
      await scanDirectory(fullPath, symbols, seenIds, projectDir);
    }
  }

  // Also check for portal.yaml
  const portalPath = path.join(projectDir, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    log.component('gate-loader').debug('Found portal.yaml', { path: 'portal.yaml' });
    try {
      const content = fs.readFileSync(portalPath, 'utf-8');
      // Extract gates from portal.yaml (keys under 'gates:' section)
      const gatesSection = content.match(/^gates:\s*\n((?:  .+\n)*)/m);
      if (gatesSection) {
        const gateMatches = gatesSection[1].matchAll(/^  ([a-z][a-z0-9-]*):/gm);
        for (const match of gateMatches) {
          const gateName = match[1];
          const id = `gate-${gateName}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            symbols.push({
              id,
              symbol: `^${gateName}`,
              type: 'gate',
              source: 'gate',
              filePath: 'portal.yaml',
              data: {},
              references: [],
              referencedBy: [],
            });
            log.component('gate-loader').debug('Extracted gate', { symbol: `^${gateName}` });
          }
        }
      }
    } catch (error) {
      log.component('gate-loader').error('Failed to parse portal.yaml', { error: String(error) });
    }
  }

  log.flow('load-symbols').info('Fallback scan complete', { count: symbols.length });
  return symbols;
}

/**
 * Recursively scan a directory for .purpose files
 */
async function scanDirectory(
  dir: string,
  symbols: SymbolEntry[],
  seenIds: Set<string>,
  projectDir: string
): Promise<void> {
  // Skip common non-source directories
  const skipDirs = ['node_modules', '.git', 'dist', 'build', '.paradigm', 'coverage', '.next', '.svelte-kit'];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) {
        await scanDirectory(fullPath, symbols, seenIds, projectDir);
      }
    } else if (entry.name === '.purpose') {
      // Parse .purpose file
      const relativePath = path.relative(projectDir, fullPath);
      log.component('purpose-loader').debug('Scanning .purpose file', { path: relativePath });
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = parsePurposeFile(content, fullPath, projectDir);
        for (const symbol of parsed) {
          if (!seenIds.has(symbol.id)) {
            seenIds.add(symbol.id);
            symbols.push(symbol);
            log.component('purpose-loader').debug('Extracted symbol', {
              symbol: symbol.symbol,
              type: symbol.type,
              file: relativePath,
            });
          }
        }
      } catch (error) {
        log.component('purpose-loader').error('Failed to parse .purpose file', {
          path: relativePath,
          error: String(error),
        });
      }
    }
  }
}

/**
 * Parse a .purpose file and extract symbols (fallback parser)
 *
 * IMPORTANT: All regex patterns require a LETTER after the symbol prefix
 * to avoid false positives from prices ($420), imports ($lib), etc.
 */
function parsePurposeFile(content: string, filePath: string, projectDir: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const relativePath = path.relative(projectDir, filePath);

  // Extract components (#) - require letter after #
  // Pattern: #component-name at start of line or after whitespace
  const componentMatches = content.matchAll(/(?:^|\s)#([a-z][a-z0-9-]*)/gm);
  for (const match of componentMatches) {
    const name = match[1];
    symbols.push({
      id: `component-${name}`,
      symbol: `#${name}`,
      type: 'component',
      source: 'purpose',
      filePath: relativePath,
      data: {},
      description: extractDescription(content, `#${name}`),
      references: extractReferences(content),
      referencedBy: [],
      tags: extractTags(content),
    });
  }

  // Extract flows ($) - require letter after $
  // This prevents matching $420 (prices), $0 (variables), $lib (imports)
  const flowMatches = content.matchAll(/\$([a-z][a-z0-9-]*)/gm);
  for (const match of flowMatches) {
    const name = match[1];
    const symbol = `$${name}`;

    // Skip blocklisted symbols (framework aliases)
    if (SYMBOL_BLOCKLIST.has(symbol)) {
      log.component('purpose-loader').debug('Skipping blocklisted symbol', { symbol });
      continue;
    }

    if (!symbols.find((s) => s.symbol === symbol)) {
      symbols.push({
        id: `flow-${name}`,
        symbol,
        type: 'flow',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  // Extract signals (!) - require letter after !
  const signalMatches = content.matchAll(/!([a-z][a-z0-9-]*)/gm);
  for (const match of signalMatches) {
    const name = match[1];
    if (!symbols.find((s) => s.symbol === `!${name}`)) {
      symbols.push({
        id: `signal-${name}`,
        symbol: `!${name}`,
        type: 'signal',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  // Extract gates (^) - require letter after ^
  const gateMatches = content.matchAll(/\^([a-z][a-z0-9-]*)/gm);
  for (const match of gateMatches) {
    const name = match[1];
    if (!symbols.find((s) => s.symbol === `^${name}`)) {
      symbols.push({
        id: `gate-${name}`,
        symbol: `^${name}`,
        type: 'gate',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  // Extract aspects (~) - require letter after ~
  const aspectMatches = content.matchAll(/~([a-z][a-z0-9-]*)/gm);
  for (const match of aspectMatches) {
    const name = match[1];
    if (!symbols.find((s) => s.symbol === `~${name}`)) {
      symbols.push({
        id: `aspect-${name}`,
        symbol: `~${name}`,
        type: 'aspect',
        source: 'purpose',
        filePath: relativePath,
        data: {},
        references: [],
        referencedBy: [],
      });
    }
  }

  return symbols;
}

/**
 * Extract description for a symbol from .purpose content
 */
function extractDescription(content: string, symbol: string): string | undefined {
  // Look for description after the symbol
  const regex = new RegExp(`${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-:]?\\s*(.+)`, 'm');
  const match = content.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return undefined;
}

/**
 * Extract references to other symbols
 * Requires letter after prefix to avoid false positives
 */
function extractReferences(content: string): string[] {
  const refs: Set<string> = new Set();
  // Match symbols with letter after prefix
  const refMatches = content.matchAll(/[@#$!^~]([a-z][a-z0-9-]*)/g);
  for (const match of refMatches) {
    const symbol = match[0];
    // Skip blocklisted
    if (!SYMBOL_BLOCKLIST.has(symbol)) {
      refs.add(symbol);
    }
  }
  return Array.from(refs);
}

/**
 * Extract tags from content
 */
function extractTags(content: string): string[] {
  const tagMatch = content.match(/tags:\s*\[([^\]]+)\]/);
  if (tagMatch) {
    return tagMatch[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, ''));
  }
  return [];
}

/**
 * Get total symbol count for a project
 */
export async function getSymbolCount(projectDir: string): Promise<number> {
  const symbols = await loadSymbolIndex(projectDir);
  return symbols.length;
}

/**
 * Update a symbol's metadata in its .purpose file
 */
export interface SymbolUpdate {
  description?: string;
  tags?: string[];
}

export async function updateSymbol(
  projectDir: string,
  symbolId: string,
  updates: SymbolUpdate
): Promise<{ success: boolean; error?: string }> {
  // Load current symbols to find the target
  const symbols = await loadSymbolIndex(projectDir);
  const symbol = symbols.find((s) => s.id === symbolId);

  if (!symbol) {
    return { success: false, error: 'Symbol not found' };
  }

  // Get the full file path
  const filePath = path.join(projectDir, symbol.filePath);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'Source file not found' };
  }

  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // Update description
    if (updates.description !== undefined) {
      const symbolPattern = symbol.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Try to find and update existing description
      const descRegex = new RegExp(`(${symbolPattern})\\s*[-:]?\\s*(.*)`, 'm');
      const match = content.match(descRegex);

      if (match) {
        // Update existing description line
        const newLine = updates.description
          ? `${symbol.symbol}: ${updates.description}`
          : symbol.symbol;
        content = content.replace(descRegex, newLine);
        modified = true;
      }
    }

    // Update tags
    if (updates.tags !== undefined) {
      const tagsStr = updates.tags.length > 0
        ? `tags: [${updates.tags.map(t => `"${t}"`).join(', ')}]`
        : '';

      // Check if tags line exists
      const tagsRegex = /^tags:\s*\[[^\]]*\]\s*$/m;
      if (tagsRegex.test(content)) {
        // Update existing tags line
        if (tagsStr) {
          content = content.replace(tagsRegex, tagsStr);
        } else {
          // Remove tags line if empty
          content = content.replace(tagsRegex, '');
        }
        modified = true;
      } else if (tagsStr) {
        // Add tags line after the symbol definition
        const symbolPattern = symbol.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const symbolLineRegex = new RegExp(`(${symbolPattern}[^\\n]*\\n)`, 'm');
        const symbolMatch = content.match(symbolLineRegex);

        if (symbolMatch) {
          content = content.replace(symbolLineRegex, `$1${tagsStr}\n`);
          modified = true;
        }
      }
    }

    if (modified) {
      // Clean up any double newlines
      content = content.replace(/\n{3,}/g, '\n\n');

      // Write the file
      fs.writeFileSync(filePath, content, 'utf-8');
      log.component('symbol-updater').info('Updated symbol', { symbol: symbol.symbol, file: symbol.filePath });

      // Update the cached index if it exists
      const indexPath = path.join(projectDir, '.paradigm', 'index.json');
      if (fs.existsSync(indexPath)) {
        try {
          const indexContent = fs.readFileSync(indexPath, 'utf-8');
          const index = JSON.parse(indexContent);
          const entries = Array.isArray(index.entries) ? index.entries : index;

          const entryIndex = entries.findIndex((e: SymbolEntry) => e.id === symbolId);
          if (entryIndex >= 0) {
            if (updates.description !== undefined) {
              entries[entryIndex].description = updates.description;
            }
            if (updates.tags !== undefined) {
              entries[entryIndex].tags = updates.tags;
            }

            // Write updated index
            if (Array.isArray(index.entries)) {
              index.entries = entries;
              fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
            } else {
              fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
            }
          }
        } catch {
          // Ignore index update errors
        }
      }

      return { success: true };
    }

    return { success: true }; // No changes needed
  } catch (error) {
    log.component('symbol-updater').error('Failed to update symbol', { error: String(error) });
    return { success: false, error: 'Failed to write file' };
  }
}
