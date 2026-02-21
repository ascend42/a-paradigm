/**
 * Sentinel Auto-Symbol Detector
 *
 * Scans codebase structure to infer Paradigm symbols.
 * Works for any project — doesn't require Paradigm.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SentinelYamlConfig } from './config.js';

export interface DetectionResult {
  components: string[];
  gates: string[];
  flows: string[];
  signals: string[];
  routes: Record<string, string>;
}

/** Directory patterns → symbol type mapping */
const DIR_PATTERNS: { dirs: string[]; prefix: string; type: keyof Omit<DetectionResult, 'routes'> }[] = [
  { dirs: ['services', 'src/services'], prefix: '#', type: 'components' },
  { dirs: ['routes', 'src/routes', 'api', 'src/api'], prefix: '#', type: 'components' },
  { dirs: ['handlers', 'src/handlers'], prefix: '#', type: 'components' },
  { dirs: ['controllers', 'src/controllers'], prefix: '#', type: 'components' },
  { dirs: ['components', 'src/components'], prefix: '#', type: 'components' },
  { dirs: ['lib', 'src/lib'], prefix: '#', type: 'components' },
  { dirs: ['middleware', 'src/middleware'], prefix: '^', type: 'gates' },
  { dirs: ['guards', 'src/guards'], prefix: '^', type: 'gates' },
  { dirs: ['auth', 'src/auth'], prefix: '^', type: 'gates' },
  { dirs: ['events', 'src/events'], prefix: '!', type: 'signals' },
  { dirs: ['listeners', 'src/listeners'], prefix: '!', type: 'signals' },
  { dirs: ['flows', 'src/flows'], prefix: '$', type: 'flows' },
  { dirs: ['workflows', 'src/workflows'], prefix: '$', type: 'flows' },
  { dirs: ['pipelines', 'src/pipelines'], prefix: '$', type: 'flows' },
];

/** File extensions to scan */
const CODE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.mjs', '.mts']);

/**
 * Detect symbols from codebase structure.
 *
 * @param projectDir - Project root directory
 * @returns Detected symbols and route mappings
 */
export function detectSymbols(projectDir: string): DetectionResult {
  const result: DetectionResult = {
    components: [],
    gates: [],
    flows: [],
    signals: [],
    routes: {},
  };

  // 1. Check for .purpose files (Paradigm user)
  const purposeSymbols = readPurposeFiles(projectDir);
  if (purposeSymbols) {
    result.components.push(...purposeSymbols.components);
    result.gates.push(...purposeSymbols.gates);
    result.flows.push(...purposeSymbols.flows);
    result.signals.push(...purposeSymbols.signals);
  }

  // 2. Scan directory structure
  for (const pattern of DIR_PATTERNS) {
    for (const dir of pattern.dirs) {
      const fullPath = path.join(projectDir, dir);
      if (!fs.existsSync(fullPath)) continue;

      const files = safeReaddir(fullPath);
      for (const file of files) {
        const ext = path.extname(file);
        if (!CODE_EXTENSIONS.has(ext)) continue;

        const name = path.basename(file, ext);
        // Skip index files and test files
        if (name === 'index' || name.endsWith('.test') || name.endsWith('.spec')) continue;

        const symbol = `${pattern.prefix}${toKebabCase(name)}`;
        if (!result[pattern.type].includes(symbol)) {
          result[pattern.type].push(symbol);
        }
      }
    }
  }

  // 3. Scan for route definitions
  scanRoutes(projectDir, result);

  return result;
}

/**
 * Generate a .sentinel.yaml config from detected symbols.
 *
 * @param projectDir - Project root directory
 * @returns SentinelYamlConfig ready to write
 */
export function generateConfig(projectDir: string): SentinelYamlConfig {
  const detected = detectSymbols(projectDir);

  return {
    version: '1.0',
    project: path.basename(projectDir),
    symbols: {
      components: detected.components.length > 0 ? detected.components : undefined,
      gates: detected.gates.length > 0 ? detected.gates : undefined,
      flows: detected.flows.length > 0 ? detected.flows : undefined,
      signals: detected.signals.length > 0 ? detected.signals : undefined,
    },
    routes: Object.keys(detected.routes).length > 0 ? detected.routes : undefined,
  };
}

/**
 * Read symbols from .purpose files in the project.
 */
function readPurposeFiles(projectDir: string): DetectionResult | null {
  const paradigmDir = path.join(projectDir, '.paradigm');
  if (!fs.existsSync(paradigmDir)) return null;

  const result: DetectionResult = {
    components: [],
    gates: [],
    flows: [],
    signals: [],
    routes: {},
  };

  // Find all .purpose files recursively
  const purposeFiles = findFiles(projectDir, '.purpose');

  for (const file of purposeFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      extractPurposeSymbols(content, result);
    } catch {
      // Skip unreadable files
    }
  }

  const hasAny =
    result.components.length > 0 ||
    result.gates.length > 0 ||
    result.flows.length > 0 ||
    result.signals.length > 0;

  return hasAny ? result : null;
}

/**
 * Extract symbols from .purpose file content.
 */
function extractPurposeSymbols(content: string, result: DetectionResult): void {
  const lines = content.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Section headers
    if (trimmed === 'components:' || trimmed === 'features:') {
      currentSection = 'components';
      continue;
    }
    if (trimmed === 'gates:') {
      currentSection = 'gates';
      continue;
    }
    if (trimmed === 'flows:') {
      currentSection = 'flows';
      continue;
    }
    if (trimmed === 'signals:') {
      currentSection = 'signals';
      continue;
    }

    // Symbol ID lines (e.g. "  payment-service:")
    if (currentSection && /^\s{2}\S/.test(line)) {
      const idMatch = trimmed.match(/^([a-zA-Z][\w-]*):$/);
      if (idMatch) {
        const prefixes: Record<string, string> = {
          components: '#',
          gates: '^',
          flows: '$',
          signals: '!',
        };
        const prefix = prefixes[currentSection] || '#';
        const symbol = `${prefix}${idMatch[1]}`;
        if (!result[currentSection as keyof Omit<DetectionResult, 'routes'>]?.includes(symbol)) {
          (result[currentSection as keyof Omit<DetectionResult, 'routes'>] as string[])?.push(symbol);
        }
      }
    }

    // Reset section on unindented non-empty lines (new top-level key)
    if (trimmed && !line.startsWith(' ') && !trimmed.endsWith(':')) {
      currentSection = '';
    }
  }
}

/**
 * Scan for route definitions in source files.
 */
function scanRoutes(projectDir: string, result: DetectionResult): void {
  const routeDirs = ['routes', 'src/routes', 'api', 'src/api'];

  for (const dir of routeDirs) {
    const fullPath = path.join(projectDir, dir);
    if (!fs.existsSync(fullPath)) continue;

    const files = safeReaddir(fullPath);
    for (const file of files) {
      const ext = path.extname(file);
      if (!CODE_EXTENSIONS.has(ext)) continue;

      const name = path.basename(file, ext);
      if (name === 'index') continue;

      // Map route file to route prefix + component
      const routePrefix = `/api/${toKebabCase(name)}`;
      const component = `#${toKebabCase(name)}`;
      result.routes[routePrefix] = component;
    }
  }
}

/**
 * Convert a filename to kebab-case symbol name.
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')  // camelCase → camel-Case
    .replace(/[_\s]+/g, '-')               // underscores/spaces → dashes
    .replace(/\..*$/, '')                   // remove extensions
    .toLowerCase();
}

/**
 * Safely read directory contents.
 */
function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => {
      const fullPath = path.join(dir, f);
      try {
        return fs.statSync(fullPath).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Find files with a specific name recursively (limited depth).
 */
function findFiles(dir: string, filename: string, maxDepth = 4, depth = 0): string[] {
  if (depth > maxDepth) return [];

  const results: string[] = [];
  const skipDirs = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', '.nuxt']);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name === filename) {
        results.push(path.join(dir, entry.name));
      } else if (entry.isDirectory() && !skipDirs.has(entry.name)) {
        results.push(...findFiles(path.join(dir, entry.name), filename, maxDepth, depth + 1));
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return results;
}
