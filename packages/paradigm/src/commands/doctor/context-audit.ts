/**
 * Context Audit — 10 quality checks for AI instruction files (CLAUDE.md, .cursorrules, AGENTS.md)
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
 *  10. always-on-budget      — chars / est. tokens of text loaded into every
 *                              agent session (advisory, #always-on-budget)
 *  11. warpline-guidance     — the project uses Warpline but a generated
 *                              instruction file lacks the Warpline block
 *                              (advisory; silent without Warpline)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import { filterGitIgnored, resolvePurposeCoverage } from '@a-company/purpose-core';
import { measureAlwaysOn, ALWAYS_ON_CAP_KEY, type AlwaysOnEntry } from '../../core/always-on-budget.js';
import { detectWarpline, scanWarplineBlocks } from '../../core/warpline-detect.js';
import { listProjectFiles, hasDirSegment, type ProjectFileList } from '../../core/project-files.js';
import { collectProjectCounts } from '../../core/project-counts.js';
import type { IsolatedSymbol } from '@a-company/premise-core';

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
    try {
      // A directory (or unreadable file) with an instruction file's name is skipped, never thrown on.
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      results.push({ name, content, lines: content.split('\n') });
    } catch {
      continue;
    }
  }
  return results;
}

/**
 * Recursively find directories that contain at least one source file.
 * Skips common non-source directories, and gitignored ones (build and release
 * output such as packages/gnomon/release/Gnomon.app is never source). Outside
 * a git work tree, release/ is skipped by name.
 */
function findSourceDirs(dir: string, extensions: string[], projectFiles: ProjectFileList): Set<string> {
  const found = sourceDirsFromList(dir, extensions, projectFiles);
  // Trailing separator so directory-only patterns ("release/") match.
  const ignored = filterGitIgnored(dir, Array.from(found, (d) => d + path.sep));
  if (ignored) {
    for (const d of ignored) found.delete(d);
  } else {
    for (const d of Array.from(found)) {
      if (path.relative(dir, d).split(path.sep).includes('release')) found.delete(d);
    }
  }
  return found;
}

/** Directories holding at least one source file, from the shared #project-files list (no walk). */
function sourceDirsFromList(dir: string, extensions: string[], projectFiles: ProjectFileList): Set<string> {
  const dirs = new Set<string>();
  const skipDirs = new Set(['node_modules', 'dist', '.git', '.paradigm', 'coverage', 'build', '__pycache__', 'target', '.next', '.nuxt']);
  for (const rel of projectFiles.files) {
    if (!extensions.includes(path.extname(rel))) continue;
    if (hasDirSegment(rel, skipDirs)) continue;
    const slash = rel.lastIndexOf('/');
    dirs.add(slash === -1 ? dir : path.join(dir, ...rel.slice(0, slash).split('/')));
  }
  return dirs;
}

/**
 * Is a directory covered? The shared rule (#purpose-coverage, purpose-core
 * resolvePurposeCoverage), the same one Cid and the Stop hook use: its own
 * .purpose, or an ancestor .purpose that documents it. Placeholder stubs never
 * count.
 */
function hasPurposeCoverage(dir: string, rootDir: string): boolean {
  return resolvePurposeCoverage(rootDir, dir).covered;
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

async function checkPurposeCoverage(rootDir: string, projectFiles: ProjectFileList): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];
  const sourceExtensions = ['.ts', '.js', '.py', '.rs', '.go', '.tsx', '.jsx'];
  const sourceDirs = findSourceDirs(rootDir, sourceExtensions, projectFiles);

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
      fix: 'Document uncovered source directories: a .purpose of their own, or name their files or paths in an ancestor .purpose (placeholder stubs do not count)',
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
// Check 5: Isolated Symbols
// ---------------------------------------------------------------------------

/**
 * Isolated symbols, by the ONE definition `paradigm integrity` and `paradigm
 * status` use (premise-core findIsolatedSymbols on the live index): declared,
 * references nothing, referenced by nothing.
 *
 * This check used to read `related` from the generated scan-index.json, where
 * flows carry no edges, so it called every symbol reachable only through a flow
 * step isolated, disagreed with `integrity`, and could not run at all in a
 * checkout that had not been scanned.
 */
async function checkOrphanedSymbols(rootDir: string, isolated?: IsolatedSymbol[]): Promise<ContextAuditResult[]> {
  let found: IsolatedSymbol[];
  try {
    found = isolated ?? (await collectProjectCounts(rootDir)).isolated;
  } catch (e) {
    return [{
      check: 'orphaned-symbols',
      status: 'advisory',
      message: `Could not build the symbol index: ${(e as Error).message}`,
    }];
  }

  if (found.length === 0) {
    return [{ check: 'orphaned-symbols', status: 'ok', message: 'All symbols are connected' }];
  }
  return [{
    check: 'orphaned-symbols',
    status: 'advisory',
    message: `${found.length} isolated symbol${found.length > 1 ? 's' : ''} (declared, with no connection to another symbol)`,
    details: found.slice(0, 20).map((s) => s.symbol),
    fix: 'Wire isolated symbols into features or flows, or remove them from .purpose files (paradigm integrity lists them)',
  }];
}

// ---------------------------------------------------------------------------
// Check 6: Stale Portal
// ---------------------------------------------------------------------------

/**
 * The static part of a portal route key, lower-cased: the path with its method
 * removed (any upper-case verb: GET, DELETE, WS, SSE, ALL) up to the first
 * parameter. "GET /api/projects/:id/files" -> "/api/projects". Empty when the
 * route has no static segment to look for.
 */
export function routeStaticPrefix(route: string): string {
  const pathPart = route.trim().replace(/^[A-Z]+\s+/, '');
  const kept: string[] = [];
  for (const segment of pathPart.split('/')) {
    if (!segment) continue;
    if (/^[:{*<[]/.test(segment)) break;
    kept.push(segment.toLowerCase());
  }
  return kept.length > 0 ? `/${kept.join('/')}` : '';
}

/** Path literals found in source, by the package (or "" for the root) that holds them. */
type PathLiterals = Map<string, Set<string>>;

/** "packages/api/src/x.ts" -> "packages/api"; anything else -> "". */
function packageOf(rel: string): string {
  const parts = rel.split('/');
  return parts.length > 2 && (parts[0] === 'packages' || parts[0] === 'apps') ? `${parts[0]}/${parts[1]}` : '';
}

/**
 * Every string literal that starts with "/" in the given files, reduced to its
 * static prefix. One regex pass per file; files that cannot be read are skipped.
 */
function collectPathLiterals(rootDir: string, files: string[]): PathLiterals {
  const byPackage: PathLiterals = new Map();
  const literal = /['"`](\/[A-Za-z0-9_\-./:{}*]*)/g;
  for (const rel of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(rootDir, ...rel.split('/')), 'utf8');
    } catch {
      continue;
    }
    if (!content.includes('/')) continue;
    const pkg = packageOf(rel);
    let set = byPackage.get(pkg);
    let match: RegExpExecArray | null;
    literal.lastIndex = 0;
    while ((match = literal.exec(content)) !== null) {
      const prefix = routeStaticPrefix(match[1]);
      if (!prefix) continue;
      if (!set) byPackage.set(pkg, (set = new Set()));
      set.add(prefix);
    }
  }
  return byPackage;
}

function startsAtSegment(literal: string, prefix: string): boolean {
  return literal === prefix || literal.startsWith(`${prefix}/`);
}

/**
 * Is there a literal for this route? Either one literal covers the whole static
 * prefix (`'/api/projects'`, `'/api/projects/:id'`), or one package holds both
 * halves of a mounted router: a literal that ends with the head (`'/api'`, or
 * `'/api/metrics'` for a head of "/metrics") and one that starts with the rest
 * (`'/projects'`). Segments before the head are not required: a router package
 * mounted under a longer prefix by another package (a proxy at
 * `/api/sentinel`) still serves the route.
 */
export function hasRouteEvidence(prefix: string, literals: PathLiterals): boolean {
  for (const set of literals.values()) {
    for (const lit of set) if (startsAtSegment(lit, prefix)) return true;
  }
  const segments = prefix.split('/').filter(Boolean);
  for (let from = 0; from < segments.length - 1; from++) {
    for (let cut = from + 1; cut < segments.length; cut++) {
      const head = `/${segments.slice(from, cut).join('/')}`;
      const rest = `/${segments.slice(cut).join('/')}`;
      for (const set of literals.values()) {
        let mounted = false;
        for (const lit of set) {
          if (lit === head || lit.endsWith(head)) {
            mounted = true;
            break;
          }
        }
        if (!mounted) continue;
        for (const lit of set) if (startsAtSegment(lit, rest)) return true;
      }
    }
  }
  return false;
}

/** Directory names that hold server route handlers by convention. */
const HANDLER_DIRS: ReadonlySet<string> = new Set(['routes', 'route', 'api', 'handlers', 'controllers', 'endpoints']);
/** Those, plus the directories file-routing frameworks serve pages from. */
const ROUTING_DIRS: ReadonlySet<string> = new Set([...HANDLER_DIRS, 'pages', 'app']);

/**
 * File-based routing: does this source file's location spell the route? The
 * route's static segments must appear as consecutive path segments, the last
 * one being a directory or the file's own name.
 *
 * "/api/projects" is matched by "app/api/projects/[id]/route.ts" (the path
 * spells the route, "api" included) and by "src/routes/projects.ts" (a handler
 * directory, where the "api" mount is implied). It is not matched by
 * "src/models/projects.ts", nor by "app/learn/projects/page.tsx": a page that
 * shares a word with an API route is not its handler.
 */
export function isRouteFileFor(prefix: string, relLower: string): boolean {
  const parts = relLower.split('/');
  const file = parts[parts.length - 1];
  parts[parts.length - 1] = file.replace(/\.[a-z0-9]+$/, '');
  const wanted = prefix.split('/').filter(Boolean);
  const isApi = wanted[0] === 'api' && wanted.length > 1;

  const under = (segments: string[], dirs: ReadonlySet<string> | null): boolean => {
    for (let at = 0; at + segments.length <= parts.length; at++) {
      if (!segments.every((seg, i) => parts[at + i] === seg)) continue;
      if (dirs === null || parts.slice(0, at).some((dir) => dirs.has(dir))) return true;
    }
    return false;
  };

  if (isApi) return under(wanted, null) || under(wanted.slice(1), HANDLER_DIRS);
  return under(wanted, ROUTING_DIRS);
}

async function checkStalePortal(rootDir: string, projectFiles: ProjectFileList): Promise<ContextAuditResult[]> {
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

  const routePatterns = Object.keys(portal.routes);
  const staleRoutes: string[] = [];

  // Evidence that a route is implemented is its PATH written as a string
  // literal in source code: `app.get('/api/projects/:id')`, a router mounted at
  // `app.use('/api/projects', …)`, `new WebSocketServer({ path: '/ws' })`.
  // (The check used to accept any source file whose name or path contained the
  // route's first word, so a route under "reference" passed in any repository
  // with a file of that name, and it never matched a WS route at all.)
  const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.swift'];
  const sourceSkipDirs = new Set(['node_modules', 'dist', '.git', '.paradigm', 'coverage', 'build', 'target', '__tests__', 'tests', 'test', '__fixtures__', 'fixtures']);
  const sourceFiles = projectFiles.files.filter((rel) =>
    sourceExtensions.includes(path.extname(rel)) && !hasDirSegment(rel, sourceSkipDirs) && !/\.(test|spec)\.[a-z]+$/.test(rel),
  );
  const literals = collectPathLiterals(rootDir, sourceFiles);
  // File-based routing (a `routes/projects.ts`, an `app/api/projects/[id]/route.ts`)
  // writes no path literal: the file's own location is the route.
  const routeFiles = sourceFiles.map((rel) => rel.toLowerCase());

  for (const route of routePatterns) {
    const prefix = routeStaticPrefix(route);
    if (!prefix) continue;
    if (hasRouteEvidence(prefix, literals)) continue;
    if (routeFiles.some((rel) => isRouteFileFor(prefix, rel))) continue;
    staleRoutes.push(route);
  }

  if (staleRoutes.length > 0) {
    results.push({
      check: 'stale-portal',
      status: 'error',
      message: `${staleRoutes.length} portal route${staleRoutes.length > 1 ? 's' : ''} with no handler found (no source file writes the route's path, and no route file sits at it)`,
      details: staleRoutes,
      fix: 'Implement missing route handlers or remove stale routes from portal.yaml',
    });
  } else {
    results.push({
      check: 'stale-portal',
      status: 'ok',
      message: `All ${routePatterns.length} portal routes have a handler path in source`,
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

async function checkPurposeFileHealth(rootDir: string, projectFiles: ProjectFileList): Promise<ContextAuditResult[]> {
  const results: ContextAuditResult[] = [];

  // Find all .purpose files
  const purposeFiles: string[] = [];
  const purposeSkipDirs = new Set(['node_modules', 'dist', '.git', '.paradigm', 'coverage', 'build']);
  for (const rel of projectFiles.files) {
    if (rel !== '.purpose' && !rel.endsWith('/.purpose')) continue;
    if (hasDirSegment(rel, purposeSkipDirs)) continue;
    purposeFiles.push(path.join(rootDir, ...rel.split('/')));
  }

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
// Check 10: Always-On Budget (advisory)
// ---------------------------------------------------------------------------

function fmtEntry(e: AlwaysOnEntry): string {
  const skills = e.skillCount !== undefined ? `, ${e.skillCount} skill${e.skillCount === 1 ? '' : 's'}` : '';
  return `${e.label} [${e.surface}]: ${e.chars.toLocaleString('en-US')} chars, ~${e.estTokens.toLocaleString('en-US')} tokens est.${skills}`;
}

/**
 * Text Paradigm generates that loads into every agent session: one result per
 * surface (its files as details, so doctor's 5-detail cap rarely truncates),
 * plus a census line for user-owned text. An ADVISORY (never warn or error,
 * so doctor stays healthy) when a surface's Paradigm-generated total exceeds
 * the cap; census is never flagged.
 */
async function checkAlwaysOnBudget(rootDir: string, homeDir?: string): Promise<ContextAuditResult[]> {
  const budget = measureAlwaysOn(rootDir, { homeDir });
  const cap = budget.cap.toLocaleString('en-US');
  const results: ContextAuditResult[] = [];

  if (budget.surfaces.length === 0) {
    results.push({ check: 'always-on-budget', status: 'ok', message: 'No Paradigm-generated always-on text found' });
  }
  for (const s of budget.surfaces) {
    const total = `${s.surface}: ${s.chars.toLocaleString('en-US')} chars (~${s.estTokens.toLocaleString('en-US')} tokens est.)`;
    const details = budget.entries.filter((e) => e.surface === s.surface).map(fmtEntry);
    results.push(s.overCap
      ? {
          check: 'always-on-budget',
          // Advisory, not warn (Judge B1): the cap is an uncalibrated starting
          // estimate, so being over it must not turn doctor/shift unhealthy.
          status: 'advisory',
          message: `${total} over the ${cap}-char cap`,
          details,
          fix: `Trim generated sections or skill descriptions, or calibrate ${ALWAYS_ON_CAP_KEY} in .paradigm/config.yaml (default 12000 is a starting estimate)`,
        }
      : { check: 'always-on-budget', status: 'ok', message: `${total} under the ${cap}-char cap`, details });
  }
  const census = budget.census.map(fmtEntry);
  census.push('MCP tool schemas: not measured');
  results.push({ check: 'always-on-budget', status: 'ok', message: 'census outside Paradigm (informational, not capped)', details: census });
  return results;
}

// ---------------------------------------------------------------------------
// Check 11: Warpline guidance (advisory, T-2026-11-12-001)
// ---------------------------------------------------------------------------

/**
 * When the project is versioned by Warpline (and guidance is not opted out),
 * each generated instruction file that exists should carry the Warpline block,
 * or agents never learn how to save work. Advisory only; returns nothing when
 * Warpline is not detected.
 */
async function checkWarplineGuidance(rootDir: string): Promise<ContextAuditResult[]> {
  const warpline = detectWarpline(rootDir);
  if (!warpline) return [];
  const cursorRule = path.join('.cursor', 'rules', 'paradigm-warpline.mdc');
  const missing: string[] = [];
  const malformed: string[] = [];
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    let content: string;
    try {
      const full = path.join(rootDir, file);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue; // unreadable: other checks report it
    }
    const scan = scanWarplineBlocks(content);
    if (scan.malformed || scan.blocks.length > 1) malformed.push(`${file}: ${scan.malformed ? 'unpaired Warpline markers' : `${scan.blocks.length} Warpline blocks`}`);
    else if (scan.blocks.length === 0) missing.push(file);
  }
  // Cursor: a project with generated Paradigm rules but no Warpline rule.
  if (fs.existsSync(path.join(rootDir, '.cursor', 'rules', 'paradigm-core.mdc'))
    && !fs.existsSync(path.join(rootDir, cursorRule))) {
    missing.push(cursorRule);
  }
  const results: ContextAuditResult[] = [];
  if (malformed.length > 0) {
    results.push({
      check: 'warpline-guidance',
      status: 'advisory',
      message: `Warpline block markers are malformed in ${malformed.length} file${malformed.length > 1 ? 's' : ''}`,
      details: malformed,
      fix: 'Keep exactly one <!-- warpline:begin --> line and one <!-- warpline:end --> line per file, then run `paradigm sync` or `warpline init`',
    });
  }
  if (missing.length > 0) {
    results.push({
      check: 'warpline-guidance',
      status: 'advisory',
      message: `Project uses Warpline (${warpline.mode} mode) but ${missing.length} instruction file${missing.length > 1 ? 's lack' : ' lacks'} the Warpline block`,
      details: missing,
      fix: 'Run `paradigm sync` if Paradigm generates these files, or `warpline init` to add only the block',
    });
  }
  if (results.length === 0) {
    results.push({ check: 'warpline-guidance', status: 'ok', message: `Warpline block present (${warpline.mode} mode)` });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * options.projectFiles: the run's shared #project-files list (doctor passes its own); taken here when absent.
 */
export async function runContextAudit(rootDir: string, options?: { quiet?: boolean; homeDir?: string; projectFiles?: ProjectFileList; isolated?: IsolatedSymbol[] }): Promise<ContextAuditResult[]> {
  const tracker = log.command('doctor:context-audit').start('Running context audit checks');
  const results: ContextAuditResult[] = [];
  // One file list for every check that used to walk the tree itself
  const projectFiles = options?.projectFiles ?? listProjectFiles(rootDir);

  results.push(...await checkStaleReferences(rootDir));
  results.push(...await checkConventionContradictions(rootDir));
  results.push(...await checkUndocumentedStack(rootDir));
  results.push(...await checkPurposeCoverage(rootDir, projectFiles));
  results.push(...await checkOrphanedSymbols(rootDir, options?.isolated));
  results.push(...await checkStalePortal(rootDir, projectFiles));
  results.push(...await checkInstructionVagueness(rootDir));
  results.push(...await checkConfigSchema(rootDir));
  results.push(...await checkPurposeFileHealth(rootDir, projectFiles));
  results.push(...await checkAlwaysOnBudget(rootDir, options?.homeDir));
  results.push(...await checkWarplineGuidance(rootDir));

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
