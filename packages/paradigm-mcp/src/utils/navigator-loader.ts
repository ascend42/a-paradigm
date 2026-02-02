/**
 * Navigator Loader - Loads project structure index from .paradigm/navigator.yaml
 *
 * The Navigator provides a pre-indexed project structure to guide AI exploration:
 * - structure: Maps code categories to directory locations
 * - key_files: Important files to know about
 * - skip_patterns: Patterns to avoid during exploration
 * - symbols: Direct symbol-to-path mapping
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  NavigatorConfig,
  NavigatorContext,
  NavigateInput,
  NavigateResult,
  StructureEntry,
} from '../types/navigator.js';

const NAVIGATOR_FILE = '.paradigm/navigator.yaml';

/**
 * Load navigator context from a project directory
 */
export async function loadNavigatorContext(rootDir: string): Promise<NavigatorContext> {
  const configPath = path.join(rootDir, NAVIGATOR_FILE);

  if (!fs.existsSync(configPath)) {
    return {
      config: null,
      configPath: null,
    };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(content) as NavigatorConfig;
    return {
      config,
      configPath,
    };
  } catch (error) {
    console.error('[navigator-loader] Error parsing navigator.yaml:', error);
    return {
      config: null,
      configPath,
    };
  }
}

/**
 * Navigate based on intent and target
 */
export function navigate(
  config: NavigatorConfig,
  input: NavigateInput,
  rootDir: string
): NavigateResult {
  switch (input.intent) {
    case 'find':
      return navigateFind(config, input.target || '', rootDir);
    case 'explore':
      return navigateExplore(config, input.target || '', rootDir);
    case 'context':
      return navigateContext(config, input.task || '', rootDir);
    default:
      return {
        paths: [],
        symbols: [],
        skip: config.skip_patterns.always,
        suggested_order: [],
        explanation: 'Unknown intent',
      };
  }
}

/**
 * Find a specific symbol or path
 */
function navigateFind(
  config: NavigatorConfig,
  target: string,
  rootDir: string
): NavigateResult {
  const result: NavigateResult = {
    paths: [],
    symbols: [],
    skip: config.skip_patterns.always,
    suggested_order: [],
  };

  // Check if target is a symbol
  if (target.match(/^[@#^$&!%?~]/)) {
    const symbolPath = config.symbols[target];
    if (symbolPath) {
      result.paths.push(symbolPath);
      result.symbols.push(target);
      result.explanation = `Found symbol ${target} at ${symbolPath}`;
    } else {
      // Try partial match
      const matches = Object.entries(config.symbols)
        .filter(([sym]) => sym.includes(target.slice(1)))
        .slice(0, 5);

      if (matches.length > 0) {
        result.paths = matches.map(([, p]) => p);
        result.symbols = matches.map(([s]) => s);
        result.explanation = `Found ${matches.length} symbols matching "${target}"`;
      } else {
        result.explanation = `Symbol ${target} not found in navigator`;
      }
    }
  } else {
    // Search by name in symbols
    const matches = Object.entries(config.symbols)
      .filter(([sym]) => sym.toLowerCase().includes(target.toLowerCase()))
      .slice(0, 5);

    if (matches.length > 0) {
      result.paths = matches.map(([, p]) => p);
      result.symbols = matches.map(([s]) => s);
      result.explanation = `Found ${matches.length} symbols matching "${target}"`;
    } else {
      // Check structure for category match
      const structureMatch = findStructureMatch(config, target);
      if (structureMatch) {
        result.paths = structureMatch.paths;
        result.explanation = `Found ${target} in structure: ${structureMatch.paths.join(', ')}`;
      } else {
        result.explanation = `No matches found for "${target}"`;
      }
    }
  }

  result.suggested_order = prioritizePaths(result.paths, config);
  return result;
}

/**
 * Explore an area or category
 */
function navigateExplore(
  config: NavigatorConfig,
  target: string,
  rootDir: string
): NavigateResult {
  const result: NavigateResult = {
    paths: [],
    symbols: [],
    skip: config.skip_patterns.always,
    suggested_order: [],
  };

  const targetLower = target.toLowerCase();

  // Check structure categories
  for (const [category, entry] of Object.entries(config.structure)) {
    if (!entry) continue;
    if (
      category.toLowerCase().includes(targetLower) ||
      targetLower.includes(category.toLowerCase())
    ) {
      result.paths.push(...entry.paths);
      // Find symbols in this category
      const categorySymbols = Object.entries(config.symbols)
        .filter(([sym]) => sym.startsWith(entry.symbol))
        .slice(0, 10);
      result.symbols.push(...categorySymbols.map(([s]) => s));
    }
  }

  // Check key_files
  for (const [category, files] of Object.entries(config.key_files)) {
    if (category.toLowerCase().includes(targetLower)) {
      result.paths.push(...files);
    }
  }

  // If no structure match, search symbols by area
  if (result.paths.length === 0) {
    const areaSymbols = Object.entries(config.symbols)
      .filter(
        ([sym, path]) =>
          sym.toLowerCase().includes(targetLower) ||
          path.toLowerCase().includes(targetLower)
      )
      .slice(0, 10);

    result.paths = [...new Set(areaSymbols.map(([, p]) => p))];
    result.symbols = areaSymbols.map(([s]) => s);
  }

  result.explanation = `Exploration paths for "${target}": ${result.paths.length} locations, ${result.symbols.length} symbols`;
  result.suggested_order = prioritizePaths(result.paths, config);
  return result;
}

/**
 * Get context for a task description
 */
function navigateContext(
  config: NavigatorConfig,
  task: string,
  rootDir: string
): NavigateResult {
  const result: NavigateResult = {
    paths: [],
    symbols: [],
    skip: config.skip_patterns.always,
    suggested_order: [],
  };

  const taskLower = task.toLowerCase();
  const keywords = extractKeywords(taskLower);

  // Match against structure
  for (const [category, entry] of Object.entries(config.structure)) {
    if (!entry) continue;
    if (keywords.some((kw) => category.toLowerCase().includes(kw))) {
      result.paths.push(...entry.paths);
    }
  }

  // Match against symbols
  for (const [symbol, symbolPath] of Object.entries(config.symbols)) {
    const symbolName = symbol.slice(1).toLowerCase();
    if (keywords.some((kw) => symbolName.includes(kw) || kw.includes(symbolName))) {
      result.paths.push(symbolPath);
      result.symbols.push(symbol);
    }
  }

  // Always include config files for context
  result.paths.push(...config.key_files.config);

  // Deduplicate
  result.paths = [...new Set(result.paths)];
  result.symbols = [...new Set(result.symbols)];

  // Adjust skip patterns based on task
  if (taskLower.includes('test')) {
    result.skip = config.skip_patterns.always;
  } else {
    result.skip = [...config.skip_patterns.always, ...config.skip_patterns.unless_testing];
  }

  if (!taskLower.includes('doc') && !taskLower.includes('readme')) {
    result.skip.push(...config.skip_patterns.unless_docs);
  }

  result.explanation = `Context for "${task}": ${result.paths.length} relevant files, ${result.symbols.length} symbols`;
  result.suggested_order = prioritizePaths(result.paths, config);
  return result;
}

/**
 * Find matching structure entry
 */
function findStructureMatch(
  config: NavigatorConfig,
  target: string
): StructureEntry | null {
  const targetLower = target.toLowerCase();

  for (const [category, entry] of Object.entries(config.structure)) {
    if (!entry) continue;
    if (
      category.toLowerCase().includes(targetLower) ||
      targetLower.includes(category.toLowerCase())
    ) {
      return entry;
    }
  }

  return null;
}

/**
 * Extract keywords from a task description
 */
function extractKeywords(task: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'add', 'create', 'make', 'update', 'change', 'fix', 'implement',
    'new', 'this', 'that', 'it', 'i', 'we', 'you', 'they',
  ]);

  return task
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Prioritize paths for suggested reading order
 */
function prioritizePaths(paths: string[], config: NavigatorConfig): string[] {
  const priority: Record<string, number> = {};

  for (const p of paths) {
    let score = 0;

    // Config files first
    if (config.key_files.config.some((c) => p.includes(c))) {
      score += 100;
    }

    // Entry points early
    if (config.key_files.entry.some((e) => p.includes(e))) {
      score += 80;
    }

    // Types before implementation
    if (config.key_files.types.some((t) => p.includes(t))) {
      score += 60;
    }

    // Shorter paths (more specific) rank higher
    score -= p.split('/').length * 2;

    priority[p] = score;
  }

  return [...paths].sort((a, b) => (priority[b] || 0) - (priority[a] || 0));
}

/**
 * Get all skip patterns (for MCP resource)
 */
export function getSkipPatterns(config: NavigatorConfig, context?: string): string[] {
  const patterns = [...config.skip_patterns.always];

  if (context !== 'testing') {
    patterns.push(...config.skip_patterns.unless_testing);
  }

  if (context !== 'docs') {
    patterns.push(...config.skip_patterns.unless_docs);
  }

  return [...new Set(patterns)];
}

/**
 * Get structure summary (for MCP resource)
 */
export function getStructureSummary(config: NavigatorConfig): Record<string, { paths: string[]; symbol: string }> {
  const summary: Record<string, { paths: string[]; symbol: string }> = {};

  for (const [category, entry] of Object.entries(config.structure)) {
    if (entry) {
      summary[category] = {
        paths: entry.paths,
        symbol: entry.symbol,
      };
    }
  }

  return summary;
}
