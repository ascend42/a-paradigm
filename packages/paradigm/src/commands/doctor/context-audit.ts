/**
 * Context Audit — 9 quality checks for AI instruction files (CLAUDE.md, .cursorrules, AGENTS.md)
 *
 * Checks:
 *   1. stale-references     — dead file/dir paths in instruction files
 *   2. convention-contradictions — conflicting naming/style directives
 *   3. undocumented-stack    — major deps not mentioned in instructions
 *   4. purpose-coverage      — % of source dirs covered by .purpose
 *   5. orphaned-symbols      — symbols with zero cross-references
 *   6. stale-portal          — portal routes with no matching implementation
 *   7. instruction-vagueness — vague/hedging language in instruction files
 *   8. config-schema-validation — config.yaml schema validation
 *   9. purpose-file-health   — oversized/stale .purpose files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextAuditResult {
  check: string;
  status: 'ok' | 'warn' | 'error' | 'advisory';
  message: string;
  details?: string[];
  fix?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTRUCTION_FILES = ['CLAUDE.md', '.cursorrules', 'AGENTS.md'];

/**
 * Read instruction files that exist in the project root.
 * Returns an array of { name, content, lines }.
 */
function loadInstructionFiles(rootDir: string): { name: string; content: string; lines: string[] }[] {
  const results: { name: string; content: string; lines: string[] }[] = [];
  for (const name of INSTRUCTION_FILES) {
    const filePath = path.join(rootDir, name);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      results.push({ name, content, lines: content.split('\n') });
    }
  }
  return results;
}

/**
 * Recursively find directories that contain at least one source file.
 * Skips common non-source directories.
 */
function findSourceDirs(dir: string, extensions: string[]): Set<string> {
  const dirs = new Set<string>();
  const skipDirs = new Set(['node_modules', 'dist', '.git', '.paradigm', 'coverage', 'build', '__pycache__', 'target', '.next', '.nuxt']);

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    let hasSource = false;
    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          hasSource = true;
        }
      }
    }
    if (hasSource) {
      dirs.add(current);
    }
  }

  walk(dir);
  return dirs;
}

/**
 * Check if a directory has a .purpose file covering it — either in
 * the directory itself or in any parent up to (and including) rootDir.
 */
function hasPurposeCoverage(dir: string, rootDir: string): boolean {
  let current = dir;
  while (true) {
    if (fs.existsSync(path.join(current, '.purpose'))) return true;
    if (current === rootDir) break;
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return false;
}


// ---------------------------------------------------------------------------
// Check 1: Stale References
// ---------------------------------------------------------------------------

async function checkStaleReferences(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const files = loadInstructionFiles(rootDir);

  if (files.length === 0) {
    results.push({
      check: 'stale-references',
      status: 'advisory',
      message: 'No instruction files found (CLAUDE.md, .cursorrules, AGENTS.md)',
    });
    return results;
  }

  // Regex to find path-like references: must contain / or end with common ext
  // Matches things like `.paradigm/config.yaml`, `src/auth/`, `portal.yaml`
  const pathPattern = /(?:^|\s|`|"|')([.a-zA-Z0-9_-]+(?:\/[.a-zA-Z0-9_*{}-]+)+\/?)/gm;
  const extPattern = /(?:^|\s|`|"|')([a-zA-Z0-9_-]+\.(?:ts|js|py|rs|go|yaml|yml|json|md|toml))\b/gm;

  const stale: string[] = [];
  const checked = new Set<string>();

  for (const file of files) {
    const allMatches: string[] = [];

    // Path-like references (contain /)
    let match: RegExpExecArray | null;
    pathPattern.lastIndex = 0;
    while ((match = pathPattern.exec(file.content)) !== null) {
      allMatches.push(match[1]);
    }

    // Standalone file references (end with extension, no /)
    extPattern.lastIndex = 0;
    while ((match = extPattern.exec(file.content)) !== null) {
      // Only if it looks like a real file reference at project root
      allMatches.push(match[1]);
    }

    for (const ref of allMatches) {
      // Normalize: strip trailing / and backticks
      const cleaned = ref.replace(/\/+$/, '').replace(/`/g, '');

      // Skip obvious non-paths
      if (cleaned.startsWith('http') || cleaned.startsWith('//')) continue;
      if (cleaned.includes('*') || cleaned.includes('{')) continue; // globs
      if (cleaned.startsWith('paradigm://')) continue; // MCP resources
      if (cleaned.startsWith('node_modules/')) continue;
      if (checked.has(cleaned)) continue;
      checked.add(cleaned);

      // Skip parameter/option lists (e.g. "symbol/tag/groupBy", "approve/deny") — require
      // a file extension, leading dot, or common path prefix to be a real path reference
      const hasExt = /\.(ts|js|py|rs|go|yaml|yml|json|md|toml)(?:\/|$)/.test(cleaned);
      const hasPathPrefix = /^(\.|src\/|packages\/|lib\/|app\/|docs\/)/.test(cleaned);
      if (!hasExt && !hasPathPrefix) continue;

      const fullPath = path.join(rootDir, cleaned);
      if (!fs.existsSync(fullPath)) {
        stale.push(`${file.name}: ${cleaned}`);
      }
    }
  }

  if (stale.length > 0) {
    results.push({
      check: 'stale-references',
      status: 'error',
      message: `${stale.length} dead path reference${stale.length > 1 ? 's' : ''} in instruction files`,
      details: stale,
      fix: 'Update or remove dead paths from instruction files',
    });
  } else {
    results.push({
      check: 'stale-references',
      status: 'ok',
      message: 'All referenced paths exist',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 2: Convention Contradictions
// ---------------------------------------------------------------------------

interface ConventionRule {
  scope: string;
  directive: string;
  source: string;
  line: number;
}

async function checkConventionContradictions(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const files = loadInstructionFiles(rootDir);

  // Also load config.yaml conventions
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf8');
    files.push({ name: 'config.yaml', content, lines: content.split('\n') });
  }

  if (files.length === 0) {
    results.push({
      check: 'convention-contradictions',
      status: 'ok',
      message: 'No instruction files to check',
    });
    return results;
  }

  // Collect naming conventions mentioned
  const conventions: ConventionRule[] = [];
  const contradictions: string[] = [];

  // Known naming patterns to detect
  const namingPatterns: [RegExp, string][] = [
    [/\bcamelCase\b/i, 'camelCase'],
    [/\bkebab[- ]?case\b/i, 'kebab-case'],
    [/\bsnake[_ ]?case\b/i, 'snake_case'],
    [/\bPascalCase\b/i, 'PascalCase'],
  ];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];

      // Detect naming convention mentions with their context
      for (const [pattern, name] of namingPatterns) {
        if (pattern.test(line)) {
          // Try to determine scope from surrounding words
          const scopeMatch = line.match(/\b(file|variable|function|class|component|symbol|directory|folder|module|import)\s*nam/i);
          const scope = scopeMatch ? scopeMatch[1].toLowerCase() : 'general';
          conventions.push({ scope, directive: name, source: file.name, line: i + 1 });
        }
      }
    }
  }

  // Check for contradictions: same scope, different naming directive
  const byScope = new Map<string, ConventionRule[]>();
  for (const conv of conventions) {
    const existing = byScope.get(conv.scope) || [];
    existing.push(conv);
    byScope.set(conv.scope, existing);
  }

  for (const [scope, rules] of byScope) {
    const directives = new Set(rules.map(r => r.directive));
    // camelCase vs kebab-case or snake_case in the same scope is a contradiction
    const conflictPairs: [string, string][] = [
      ['camelCase', 'kebab-case'],
      ['camelCase', 'snake_case'],
      ['kebab-case', 'snake_case'],
    ];
    for (const [a, b] of conflictPairs) {
      if (directives.has(a) && directives.has(b)) {
        const ruleA = rules.find(r => r.directive === a)!;
        const ruleB = rules.find(r => r.directive === b)!;
        contradictions.push(
          `${scope} naming: ${a} (${ruleA.source}:${ruleA.line}) vs ${b} (${ruleB.source}:${ruleB.line})`
        );
      }
    }
  }

  if (contradictions.length > 0) {
    results.push({
      check: 'convention-contradictions',
      status: 'warn',
      message: `${contradictions.length} potential convention contradiction${contradictions.length > 1 ? 's' : ''}`,
      details: contradictions,
      fix: 'Reconcile conflicting naming/style conventions in instruction files',
    });
  } else {
    results.push({
      check: 'convention-contradictions',
      status: 'ok',
      message: 'No contradictions detected',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 3: Undocumented Stack
// ---------------------------------------------------------------------------

const SKIP_DEPS = new Set([
  'typescript', 'tsup', 'vitest', 'eslint', 'prettier', 'rimraf',
  'tsx', 'ts-node', 'nodemon', 'concurrently', 'husky', 'lint-staged',
  'unbuild', 'turbo', 'lerna', 'changesets',
]);

const SKIP_PREFIXES = ['@types/', '@typescript-eslint/', '@eslint/'];

async function checkUndocumentedStack(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const pkgPath = path.join(rootDir, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    results.push({
      check: 'undocumented-stack',
      status: 'ok',
      message: 'No package.json found (not a JS/TS project or monorepo root)',
    });
    return results;
  }

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    results.push({
      check: 'undocumented-stack',
      status: 'advisory',
      message: 'Could not parse package.json',
    });
    return results;
  }

  const allDeps = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);

  // Filter out common/obvious deps
  const majorDeps: string[] = [];
  for (const dep of allDeps) {
    if (SKIP_DEPS.has(dep)) continue;
    if (SKIP_PREFIXES.some(p => dep.startsWith(p))) continue;
    majorDeps.push(dep);
  }

  if (majorDeps.length === 0) {
    results.push({
      check: 'undocumented-stack',
      status: 'ok',
      message: 'No major dependencies to document',
    });
    return results;
  }

  // Collect all instruction file content
  const files = loadInstructionFiles(rootDir);
  const allContent = files.map(f => f.content).join('\n').toLowerCase();

  const undocumented: string[] = [];
  for (const dep of majorDeps) {
    // Check if dep name appears anywhere in instruction files (case-insensitive)
    const depLower = dep.toLowerCase();
    // Also check without scope prefix (@scope/name -> name)
    const shortName = dep.includes('/') ? dep.split('/').pop()! : dep;
    if (!allContent.includes(depLower) && !allContent.includes(shortName.toLowerCase())) {
      undocumented.push(dep);
    }
  }

  if (undocumented.length > 0) {
    results.push({
      check: 'undocumented-stack',
      status: 'advisory',
      message: `${undocumented.length} dependenc${undocumented.length > 1 ? 'ies' : 'y'} not mentioned in instruction files`,
      details: undocumented.slice(0, 20), // Cap at 20 to avoid noise
      fix: 'Consider documenting major dependencies in CLAUDE.md for AI context',
    });
  } else {
    results.push({
      check: 'undocumented-stack',
      status: 'ok',
      message: 'All major dependencies are documented',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 4: Purpose Coverage
// ---------------------------------------------------------------------------

async function checkPurposeCoverage(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const sourceExtensions = ['.ts', '.js', '.py', '.rs', '.go', '.tsx', '.jsx'];
  const sourceDirs = findSourceDirs(rootDir, sourceExtensions);

  if (sourceDirs.size === 0) {
    results.push({
      check: 'purpose-coverage',
      status: 'ok',
      message: 'No source directories found',
    });
    return results;
  }

  let covered = 0;
  const uncovered: string[] = [];

  for (const dir of sourceDirs) {
    if (hasPurposeCoverage(dir, rootDir)) {
      covered++;
    } else {
      const rel = path.relative(rootDir, dir);
      uncovered.push(rel);
    }
  }

  const total = sourceDirs.size;
  const pct = Math.round((covered / total) * 100);

  if (pct < 80) {
    results.push({
      check: 'purpose-coverage',
      status: 'warn',
      message: `${pct}% purpose coverage (${covered}/${total} source directories) — below 80% threshold`,
      details: uncovered.slice(0, 15),
      fix: 'Create .purpose files in uncovered source directories',
    });
  } else {
    results.push({
      check: 'purpose-coverage',
      status: 'ok',
      message: `${pct}% purpose coverage (${covered}/${total} source directories)`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 5: Orphaned Symbols
// ---------------------------------------------------------------------------

interface ScanIndex {
  $meta?: unknown;
  components?: Record<string, { id: string; symbol: string; path: string; related?: string[] }>;
  gates?: Record<string, { id: string; symbol: string; path: string; related?: string[] }>;
  signals?: Record<string, { id: string; symbol: string; path: string; related?: string[] }>;
  flows?: Record<string, { id: string; symbol: string; path: string; related?: string[] }>;
  aspects?: Record<string, { id: string; symbol: string; path: string; related?: string[] }>;
  [key: string]: unknown;
}

async function checkOrphanedSymbols(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const indexPath = path.join(rootDir, '.paradigm', 'scan-index.json');

  if (!fs.existsSync(indexPath)) {
    results.push({
      check: 'orphaned-symbols',
      status: 'advisory',
      message: 'No scan-index.json found — run paradigm scan first',
    });
    return results;
  }

  let index: ScanIndex;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    results.push({
      check: 'orphaned-symbols',
      status: 'advisory',
      message: 'Could not parse scan-index.json',
    });
    return results;
  }

  // Gather all symbols and their related references
  const categories = ['components', 'gates', 'signals', 'flows', 'aspects'] as const;
  const allSymbols = new Map<string, string>(); // symbol -> id
  const referencedSymbols = new Set<string>();

  for (const cat of categories) {
    const entries = index[cat];
    if (!entries || typeof entries !== 'object') continue;
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.symbol) {
        allSymbols.set(entry.symbol, id);
      }
      // Collect all symbols referenced by other entries
      if (entry.related && Array.isArray(entry.related)) {
        for (const ref of entry.related) {
          referencedSymbols.add(ref);
        }
      }
    }
  }

  // Build set of symbols that DO reference others (have outgoing refs)
  const hasOutgoingRefs = new Set<string>();
  for (const cat of categories) {
    const entries = index[cat];
    if (!entries || typeof entries !== 'object') continue;
    for (const [, entry] of Object.entries(entries)) {
      if (entry.symbol && entry.related && Array.isArray(entry.related) && entry.related.length > 0) {
        hasOutgoingRefs.add(entry.symbol);
      }
    }
  }

  // True isolates = not referenced AND don't reference anything.
  // Symbols with outgoing refs but no incoming are tree roots — expected.
  const isolated: string[] = [];
  for (const [symbol] of allSymbols) {
    if (!referencedSymbols.has(symbol) && !hasOutgoingRefs.has(symbol)) {
      isolated.push(symbol);
    }
  }

  if (isolated.length > 0) {
    results.push({
      check: 'orphaned-symbols',
      status: 'advisory',
      message: `${isolated.length} isolated symbol${isolated.length > 1 ? 's' : ''} (no connections to other symbols)`,
      details: isolated.slice(0, 20),
      fix: 'Wire isolated symbols into features or remove them from .purpose files',
    });
  } else {
    results.push({
      check: 'orphaned-symbols',
      status: 'ok',
      message: 'All symbols are connected',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 6: Stale Portal
// ---------------------------------------------------------------------------

async function checkStalePortal(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const portalPath = path.join(rootDir, 'portal.yaml');

  if (!fs.existsSync(portalPath)) {
    results.push({
      check: 'stale-portal',
      status: 'ok',
      message: 'No portal.yaml found (no routes to check)',
    });
    return results;
  }

  let portal: { routes?: Record<string, unknown> };
  try {
    portal = yaml.load(fs.readFileSync(portalPath, 'utf8')) as { routes?: Record<string, unknown> };
  } catch {
    results.push({
      check: 'stale-portal',
      status: 'error',
      message: 'Could not parse portal.yaml',
    });
    return results;
  }

  if (!portal?.routes || typeof portal.routes !== 'object') {
    results.push({
      check: 'stale-portal',
      status: 'ok',
      message: 'No routes defined in portal.yaml',
    });
    return results;
  }

  // Extract resource prefixes from route patterns
  // e.g., "GET /api/projects/:id" -> "projects"
  const routePatterns = Object.keys(portal.routes);
  const staleRoutes: string[] = [];

  // Build a list of all source files for heuristic matching
  const sourceExtensions = ['.ts', '.js', '.py', '.rs', '.go'];
  const allSourceFiles: string[] = [];

  function collectSourceFiles(dir: string): void {
    const skipDirs = new Set(['node_modules', 'dist', '.git', '.paradigm', 'coverage', 'build', 'target']);
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (skipDirs.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectSourceFiles(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (sourceExtensions.includes(ext)) {
            allSourceFiles.push(full);
          }
        }
      }
    } catch {
      // skip
    }
  }
  collectSourceFiles(rootDir);

  // Get all filenames and paths lowercased for matching
  const filenameLower = allSourceFiles.map(f => ({
    full: f,
    name: path.basename(f, path.extname(f)).toLowerCase(),
    relPath: path.relative(rootDir, f).toLowerCase(),
  }));

  for (const route of routePatterns) {
    // Extract resource name: "GET /api/projects/:id" -> "projects"
    const pathPart = route.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, '');
    const segments = pathPart.split('/').filter(s => s && !s.startsWith(':') && s !== 'api');

    if (segments.length === 0) continue;

    // Use the first meaningful segment as the resource name
    const resource = segments[0].toLowerCase();

    // Heuristic: check if any source file name or path contains the resource name
    const hasMatch = filenameLower.some(f =>
      f.name.includes(resource) || f.relPath.includes(resource)
    );

    if (!hasMatch) {
      staleRoutes.push(route);
    }
  }

  if (staleRoutes.length > 0) {
    results.push({
      check: 'stale-portal',
      status: 'error',
      message: `${staleRoutes.length} portal route${staleRoutes.length > 1 ? 's' : ''} with no matching implementation file`,
      details: staleRoutes,
      fix: 'Implement missing route handlers or remove stale routes from portal.yaml',
    });
  } else {
    results.push({
      check: 'stale-portal',
      status: 'ok',
      message: `All ${routePatterns.length} portal routes have matching implementation files`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 7: Instruction Vagueness
// ---------------------------------------------------------------------------

const VAGUE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\btry to\b/i, label: 'try to' },
  { pattern: /\bmaybe\b/i, label: 'maybe' },
  { pattern: /\bif possible\b/i, label: 'if possible' },
  { pattern: /\bconsider\b(?!-handoff)/i, label: 'consider' },
  { pattern: /\bmight want to\b/i, label: 'might want to' },
  { pattern: /\byou could\b/i, label: 'you could' },
  { pattern: /\boptionally\b/i, label: 'optionally' },
];

async function checkInstructionVagueness(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const files = loadInstructionFiles(rootDir);

  if (files.length === 0) {
    results.push({
      check: 'instruction-vagueness',
      status: 'ok',
      message: 'No instruction files to check',
    });
    return results;
  }

  const instances: string[] = [];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      // Skip code blocks
      if (line.trimStart().startsWith('```')) continue;
      // Skip table separators
      if (line.trim().startsWith('|---')) continue;

      for (const { pattern, label } of VAGUE_PATTERNS) {
        if (pattern.test(line)) {
          const trimmed = line.trim();
          const preview = trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;
          instances.push(`${file.name}:${i + 1} — "${label}" — ${preview}`);
        }
      }
    }
  }

  if (instances.length > 0) {
    results.push({
      check: 'instruction-vagueness',
      status: 'advisory',
      message: `${instances.length} vague phrase${instances.length > 1 ? 's' : ''} in instruction files`,
      details: instances.slice(0, 20),
      fix: 'Replace vague language with clear, actionable directives',
    });
  } else {
    results.push({
      check: 'instruction-vagueness',
      status: 'ok',
      message: 'No vague language detected',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 8: Config Schema Validation
// ---------------------------------------------------------------------------

async function checkConfigSchema(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    results.push({
      check: 'config-schema-validation',
      status: 'advisory',
      message: 'No .paradigm/config.yaml found',
    });
    return results;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const { validateConfig } = await import('../../core/config-schema.js');
    const validation = validateConfig(content);

    const details: string[] = [];
    for (const err of validation.errors) {
      details.push(`Error: ${err}`);
    }
    for (const warn of validation.warnings) {
      details.push(`Warning: ${warn}`);
    }

    if (validation.errors.length > 0) {
      results.push({
        check: 'config-schema-validation',
        status: 'error',
        message: `${validation.errors.length} schema error${validation.errors.length > 1 ? 's' : ''} in config.yaml`,
        details,
        fix: 'Fix invalid fields in .paradigm/config.yaml',
      });
    } else if (validation.warnings.length > 0) {
      results.push({
        check: 'config-schema-validation',
        status: 'warn',
        message: `${validation.warnings.length} unrecognized key${validation.warnings.length > 1 ? 's' : ''} in config.yaml`,
        details,
        fix: 'Check for typos in .paradigm/config.yaml field names',
      });
    } else {
      results.push({
        check: 'config-schema-validation',
        status: 'ok',
        message: 'config.yaml schema is valid',
      });
    }
  } catch (e) {
    results.push({
      check: 'config-schema-validation',
      status: 'error',
      message: `Could not validate config.yaml: ${(e as Error).message}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 9: Purpose File Health
// ---------------------------------------------------------------------------

async function checkPurposeFileHealth(rootDir: string): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];

  // Find all .purpose files
  const purposeFiles: string[] = [];
  function findPurpose(dir: string): void {
    const skipDirs = new Set(['node_modules', 'dist', '.git', '.paradigm', 'coverage', 'build']);
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (skipDirs.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findPurpose(full);
        } else if (entry.name === '.purpose') {
          purposeFiles.push(full);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }
  findPurpose(rootDir);

  if (purposeFiles.length === 0) {
    results.push({
      check: 'purpose-file-health',
      status: 'ok',
      message: 'No .purpose files to check',
    });
    return results;
  }

  const oversized: string[] = [];
  let maxLines = 0;
  let maxFile = '';

  for (const pf of purposeFiles) {
    try {
      const content = fs.readFileSync(pf, 'utf8');
      const lines = content.split('\n').length;
      if (lines > maxLines) {
        maxLines = lines;
        maxFile = path.relative(rootDir, pf);
      }
      if (lines > 500) {
        const severity = lines > 1000 ? '!!' : '!';
        oversized.push(`${severity} ${path.relative(rootDir, pf)} (${lines} lines)`);
      }
    } catch {
      continue;
    }
  }

  if (oversized.length > 0) {
    results.push({
      check: 'purpose-file-health',
      status: 'warn',
      message: `${oversized.length} oversized .purpose file${oversized.length > 1 ? 's' : ''} (largest: ${maxFile} at ${maxLines} lines)`,
      details: oversized,
      fix: 'Split large .purpose files by component type or subdirectory',
    });
  } else {
    results.push({
      check: 'purpose-file-health',
      status: 'ok',
      message: `${purposeFiles.length} .purpose files, all under 500 lines`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runContextAudit(rootDir: string, _options?: { quiet?: boolean }): Promise<ContextAuditResult[]> {
  const tracker = log.command('doctor:context-audit').start('Running context audit checks');
  const results: ContextAuditResult[] = [];

  results.push(...await checkStaleReferences(rootDir));
  results.push(...await checkConventionContradictions(rootDir));
  results.push(...await checkUndocumentedStack(rootDir));
  results.push(...await checkPurposeCoverage(rootDir));
  results.push(...await checkOrphanedSymbols(rootDir));
  results.push(...await checkStalePortal(rootDir));
  results.push(...await checkInstructionVagueness(rootDir));
  results.push(...await checkConfigSchema(rootDir));
  results.push(...await checkPurposeFileHealth(rootDir));

  const errorCount = results.filter(r => r.status === 'error').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const advisoryCount = results.filter(r => r.status === 'advisory').length;

  if (errorCount > 0) {
    tracker.error('Context audit found issues', { errors: errorCount, warnings: warnCount, advisories: advisoryCount });
  } else {
    tracker.success('Context audit complete', { warnings: warnCount, advisories: advisoryCount });
  }

  return results;
}
