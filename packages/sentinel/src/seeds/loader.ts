/**
 * Paradigm Sentinel - Seed Pattern Loader
 *
 * Loads built-in patterns from JSON files.
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { PatternExport } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load universal patterns that apply to most projects
 */
export function loadUniversalPatterns(): PatternExport {
  const filePath = path.join(__dirname, 'universal-patterns.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load Paradigm-specific patterns
 */
export function loadParadigmPatterns(): PatternExport {
  const filePath = path.join(__dirname, 'paradigm-patterns.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load all seed patterns combined
 */
export function loadAllSeedPatterns(): PatternExport {
  const universal = loadUniversalPatterns();
  const paradigm = loadParadigmPatterns();

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    patterns: [...universal.patterns, ...paradigm.patterns],
  };
}
