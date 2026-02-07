/**
 * Navigator Generation - Generate navigator.yaml for AI exploration
 *
 * Creates a pre-indexed project structure that guides AI tools:
 * - structure: Maps code categories to directory locations
 * - key_files: Important files to know about
 * - skip_patterns: Patterns to avoid during exploration
 * - symbols: Direct symbol-to-path mapping
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';

/**
 * Symbol prefix to structure category mapping
 */
const SYMBOL_CATEGORIES: Record<string, { category: string; prefix: string }> = {
  '@': { category: 'features', prefix: '@' },
  '#': { category: 'components', prefix: '#' },
  '^': { category: 'gates', prefix: '^' },
  '$': { category: 'flows', prefix: '$' },
  '&': { category: 'integrations', prefix: '&' },
  '!': { category: 'signals', prefix: '!' },
  '%': { category: 'state', prefix: '%' },
};

/**
 * Common directory patterns for each category
 */
const DIRECTORY_PATTERNS: Record<string, string[]> = {
  features: ['src/features/', 'features/', 'app/', 'src/app/', 'src/modules/', 'modules/'],
  components: ['src/components/', 'components/', 'src/lib/', 'lib/', 'src/ui/', 'ui/'],
  gates: ['middleware/', 'src/middleware/', 'auth/', 'src/auth/', 'guards/', 'src/guards/'],
  flows: ['flows/', 'src/flows/', 'workflows/', 'src/workflows/', 'sagas/', 'src/sagas/'],
  integrations: ['integrations/', 'src/integrations/', 'external/', 'src/external/', 'vendors/'],
  signals: ['events/', 'src/events/', 'handlers/', 'src/handlers/'],
  state: ['stores/', 'src/stores/', 'state/', 'src/state/', 'reducers/', 'src/reducers/'],
};

/**
 * Common key file patterns
 */
const KEY_FILE_PATTERNS = {
  config: [
    '.paradigm/config.yaml',
    'package.json',
    'tsconfig.json',
    '.env.example',
  ],
  entry: [
    'src/index.ts',
    'src/index.tsx',
    'src/main.ts',
    'src/main.tsx',
    'index.ts',
    'main.ts',
    'src/app.ts',
    'src/app.tsx',
  ],
  types: [
    'src/types/',
    'types/',
    'src/types.ts',
    'types.ts',
  ],
};

/**
 * Default skip patterns
 */
const DEFAULT_SKIP_PATTERNS = {
  always: [
    'node_modules/',
    'dist/',
    'build/',
    '.git/',
    '.next/',
    '.nuxt/',
    '.cache/',
    '*.lock',
    '*.log',
  ],
  unless_testing: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '__tests__/',
    'test/',
    'tests/',
  ],
  unless_docs: [
    'docs/',
    '*.md',
    'README*',
    'CHANGELOG*',
  ],
};

interface NavigatorOptions {
  quiet?: boolean;
}

interface SymbolInfo {
  id: string;
  type: string;
  path?: string;
  directory?: string;
}

interface AggregationResult {
  symbols: SymbolInfo[];
  purposeFiles: string[];
}

/**
 * Generate navigator.yaml from scan data
 */
export async function generateNavigator(
  rootDir: string,
  aggregation: AggregationResult,
  options: NavigatorOptions = {}
): Promise<void> {
  const spinner = options.quiet ? null : ora();

  spinner?.start('Generating navigator.yaml...');

  // Build structure from existing directories
  const structure = buildStructure(rootDir);

  // Build key files from existing files
  const keyFiles = buildKeyFiles(rootDir);

  // Build skip patterns (incorporate .gitignore if exists)
  const skipPatterns = buildSkipPatterns(rootDir);

  // Build symbol to path mapping
  const symbols = buildSymbolMap(aggregation.symbols, aggregation.purposeFiles, rootDir);

  // Create navigator config
  const navigatorConfig = {
    version: '1.0',
    generated: new Date().toISOString(),
    structure,
    key_files: keyFiles,
    skip_patterns: skipPatterns,
    symbols,
  };

  // Write to .paradigm/navigator.yaml
  const outputDir = path.join(rootDir, '.paradigm');
  const outputPath = path.join(outputDir, 'navigator.yaml');

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    outputPath,
    yaml.dump(navigatorConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    }),
    'utf8'
  );

  spinner?.succeed(chalk.green('Navigator generated'));

  if (!options.quiet) {
    console.log(chalk.gray(`  Output: ${outputPath}`));
    console.log(chalk.gray(`  Structure categories: ${Object.keys(structure).length}`));
    console.log(chalk.gray(`  Symbol mappings: ${Object.keys(symbols).length}`));
    console.log();
  }
}

/**
 * Build structure map from existing directories
 */
function buildStructure(rootDir: string): Record<string, { paths: string[]; symbol: string }> {
  const structure: Record<string, { paths: string[]; symbol: string }> = {};

  for (const [category, patterns] of Object.entries(DIRECTORY_PATTERNS)) {
    const existingPaths = patterns.filter((p) => {
      const fullPath = path.join(rootDir, p);
      return fs.existsSync(fullPath);
    });

    if (existingPaths.length > 0) {
      const symbolInfo = Object.values(SYMBOL_CATEGORIES).find(
        (s) => s.category === category
      );
      structure[category] = {
        paths: existingPaths,
        symbol: symbolInfo?.prefix || '@',
      };
    }
  }

  return structure;
}

/**
 * Build key files map from existing files
 */
function buildKeyFiles(rootDir: string): Record<string, string[]> {
  const keyFiles: Record<string, string[]> = {};

  for (const [category, patterns] of Object.entries(KEY_FILE_PATTERNS)) {
    const existingPaths = patterns.filter((p) => {
      const fullPath = path.join(rootDir, p);
      return fs.existsSync(fullPath);
    });

    if (existingPaths.length > 0) {
      keyFiles[category] = existingPaths;
    }
  }

  // Ensure all categories exist even if empty
  if (!keyFiles.config) keyFiles.config = [];
  if (!keyFiles.entry) keyFiles.entry = [];
  if (!keyFiles.types) keyFiles.types = [];

  return keyFiles;
}

/**
 * Build skip patterns, incorporating .gitignore
 */
function buildSkipPatterns(rootDir: string): {
  always: string[];
  unless_testing: string[];
  unless_docs: string[];
} {
  const patterns = { ...DEFAULT_SKIP_PATTERNS };

  // Try to incorporate .gitignore patterns
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      const gitignorePatterns = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .filter((line) => {
          // Only include directory patterns and common ignore patterns
          return (
            line.endsWith('/') ||
            line.includes('*') ||
            ['node_modules', 'dist', 'build', '.cache'].some((p) =>
              line.includes(p)
            )
          );
        })
        .slice(0, 20); // Limit to avoid bloating

      // Add unique patterns
      for (const pattern of gitignorePatterns) {
        if (!patterns.always.includes(pattern)) {
          patterns.always.push(pattern);
        }
      }
    } catch {
      // Ignore errors reading .gitignore
    }
  }

  return patterns;
}

/**
 * Build symbol to path mapping
 */
function buildSymbolMap(
  symbols: SymbolInfo[],
  purposeFiles: string[],
  _rootDir: string
): Record<string, string> {
  const symbolMap: Record<string, string> = {};

  // First, map symbols to their purpose file directories
  const purposeDirs = new Map<string, string>();
  for (const pf of purposeFiles) {
    // Purpose files are stored with their relative path
    const dir = path.dirname(pf);
    purposeDirs.set(pf, dir);
  }

  // Map each symbol to its location
  for (const symbol of symbols) {
    const prefix = getSymbolPrefix(symbol.type);
    const symbolId = `${prefix}${symbol.id}`;

    // If symbol has explicit path, use it
    if (symbol.path) {
      symbolMap[symbolId] = symbol.path;
    } else if (symbol.directory) {
      symbolMap[symbolId] = symbol.directory;
    } else {
      // Try to find associated purpose file
      // This is a heuristic - we look for purpose files that might contain this symbol
      const matchingPurpose = purposeFiles.find((pf) => {
        // Check if the purpose file is in a directory that matches the symbol name
        const dir = path.dirname(pf);
        const symbolLower = symbol.id.toLowerCase();
        return dir.toLowerCase().includes(symbolLower);
      });

      if (matchingPurpose) {
        symbolMap[symbolId] = path.dirname(matchingPurpose) + '/';
      }
    }
  }

  return symbolMap;
}

/**
 * Get symbol prefix for a type
 */
function getSymbolPrefix(type: string): string {
  switch (type) {
    case 'feature':
      return '@';
    case 'component':
      return '#';
    case 'gate':
      return '^';
    case 'flow':
      return '$';
    case 'integration':
      return '&';
    case 'signal':
      return '!';
    case 'state':
      return '%';
    case 'idea':
      return '?';
    case 'deprecated':
      return '~';
    default:
      return '@';
  }
}

/**
 * Check if navigator.yaml exists
 */
export function navigatorExists(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, '.paradigm', 'navigator.yaml'));
}

/**
 * Get navigator.yaml path
 */
export function getNavigatorPath(rootDir: string): string {
  return path.join(rootDir, '.paradigm', 'navigator.yaml');
}
