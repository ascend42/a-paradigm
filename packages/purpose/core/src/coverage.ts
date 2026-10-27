/**
 * Purpose coverage (#purpose-coverage)
 *
 * One definition of "is this directory covered by a .purpose?" shared by
 * Cid's captain brief/debrief (packages/paradigm-mcp) and any other caller that
 * scores coverage. It extends the ancestor-chain walk used by `paradigm doctor`
 * (context-audit hasPurposeCoverage) and the stop hook in two ways:
 *
 *   1. A placeholder never counts. A .purpose whose content is a generated stub
 *      (the "# Auto-generated .purpose stub" header written by Cid or the stop
 *      hook's auto-fix, "Stub created by Cid", only `TODO` descriptions, or
 *      under 50 chars) is skipped wherever it sits in the chain.
 *   2. An ANCESTOR .purpose covers a directory only when it documents it: one
 *      of its symbols points into the directory (path / paths / file / files /
 *      tests / anchors), a symbol path contains the directory, or the file
 *      mentions a path inside the directory (e.g. "Tests: test/foo.test.ts").
 *      The directory's OWN non-placeholder .purpose always covers it.
 *
 * Also exports filterGitIgnored, the gitignore check used by
 * findPurposeFiles({ respectGitignore: true }) so build and release output
 * (e.g. a .purpose copied into packages/gnomon/release/Gnomon.app) is never
 * read as a symbol source.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

/** Content shorter than this (trimmed) is never real documentation. */
export const MIN_PURPOSE_CONTENT_CHARS = 50;

/**
 * Lines that generated stubs carry: the comment header Cid's old debrief and
 * the stop hook's auto-fix write (a whole comment line, so documentation that
 * merely quotes it is not a placeholder), and the context line Cid wrote.
 */
export const PURPOSE_PLACEHOLDER_MARKERS: readonly RegExp[] = Object.freeze([
  /^\s*#\s*Auto-generated \.purpose stub\b/im,
  /^\s*-\s*["']?Stub created by Cid during coverage audit/im,
]);

const SYMBOL_COLLECTIONS = ['components', 'features', 'flows', 'gates', 'signals', 'aspects', 'states'] as const;
const PATH_KEYS = ['path', 'paths', 'file', 'files', 'tests', 'test', 'anchors', 'source'] as const;
const TODO_RE = /^\s*TODO\b/i;

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function loadYaml(content: string): Record<string, unknown> | null {
  try {
    // Same pre-processing as parsePurposeContent: quote symbol-prefixed keys.
    const processed = content
      .replace(/^([#~!$^][\w-]+):/gm, '"$1":')
      .replace(/^(\s*-\s+)([!#][\w-]+)$/gm, '$1"$2"');
    const data = yaml.load(processed);
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function itemsOf(collection: unknown): Array<Record<string, unknown>> {
  if (!collection || typeof collection !== 'object') return [];
  const values = Array.isArray(collection) ? collection : Object.values(collection as Record<string, unknown>);
  return values.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * True when a .purpose's content is a placeholder, not documentation:
 * shorter than MIN_PURPOSE_CONTENT_CHARS, carries a generated-stub marker, or
 * every description it has (top level and every symbol) starts with "TODO".
 */
export function isPlaceholderPurposeContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length <= MIN_PURPOSE_CONTENT_CHARS) return true;
  if (PURPOSE_PLACEHOLDER_MARKERS.some((m) => m.test(trimmed))) return true;

  const data = loadYaml(trimmed);
  if (!data) return false;
  const descriptions: string[] = [];
  if (typeof data.description === 'string') descriptions.push(data.description);
  for (const key of SYMBOL_COLLECTIONS) {
    for (const item of itemsOf(data[key])) {
      if (typeof item.description === 'string') descriptions.push(item.description);
    }
  }
  return descriptions.length > 0 && descriptions.every((d) => TODO_RE.test(d));
}

/** Path-like values a .purpose's symbols declare (path, files, tests, anchors…). */
function declaredPaths(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const take = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  };
  for (const key of PATH_KEYS) take(data[key]);
  for (const coll of SYMBOL_COLLECTIONS) {
    for (const item of itemsOf(data[coll])) {
      for (const key of PATH_KEYS) take(item[key]);
    }
  }
  return out;
}

/** Strip ./ prefix, :line anchors, trailing glob segments and slashes. */
function normalizeDeclaredPath(raw: string): string {
  let p = raw.trim().replace(/\\/g, '/');
  p = p.replace(/:\d+(-\d+)?$/, '');
  p = p.replace(/^\.\//, '');
  // Cut at the first glob segment: "src/cli/**/*.ts" → "src/cli"
  const segs = p.split('/');
  const globAt = segs.findIndex((s) => /[*?[{]/.test(s));
  if (globAt >= 0) p = segs.slice(0, globAt).join('/');
  return p.replace(/\/+$/, '');
}

function isSameOrInside(child: string, parent: string): boolean {
  if (!parent) return true;
  return child === parent || child.startsWith(parent + '/');
}

function mentionsPathInside(text: string, relDir: string): boolean {
  if (!relDir) return false;
  const escaped = relDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Preceded by a non-path character (or start), followed by "/" + a path char.
  return new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}/(?=[A-Za-z0-9_.-])`).test(text);
}

/**
 * Does the ancestor .purpose at `purposeDirAbs` (content `content`) document
 * the directory `targetDirAbs`?
 */
export function purposeDocumentsDir(
  rootDir: string,
  purposeDirAbs: string,
  content: string,
  targetDirAbs: string,
): boolean {
  const relFromPurpose = toPosix(path.relative(purposeDirAbs, targetDirAbs));
  const relFromRoot = toPosix(path.relative(path.resolve(rootDir), targetDirAbs));
  if (!relFromPurpose || relFromPurpose.startsWith('..')) return false;

  const data = loadYaml(content);
  if (data) {
    const absRoot = path.resolve(rootDir);
    for (const raw of declaredPaths(data)) {
      const p = normalizeDeclaredPath(raw);
      if (!p) continue;
      // A declared path may be relative to the .purpose's dir or to the root;
      // try both, expressed root-relative.
      const candidates = [toPosix(path.relative(absRoot, path.resolve(purposeDirAbs, p))), p];
      for (const c of candidates) {
        if (c.startsWith('..')) continue;
        // The symbol's path contains the dir, or names something inside it.
        if (isSameOrInside(relFromRoot, c) || isSameOrInside(c, relFromRoot)) return true;
      }
    }
  }

  // File mentions anywhere in the (non-comment) text.
  const text = content
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  return mentionsPathInside(text, relFromPurpose) || mentionsPathInside(text, relFromRoot);
}

export interface PurposeCoverage {
  /** Directory, relative to rootDir (posix). */
  dir: string;
  covered: boolean;
  /** 'own' = the directory's own .purpose; 'ancestor' = an ancestor documents it. */
  via: 'own' | 'ancestor' | null;
  /** The covering .purpose, relative to rootDir (posix). */
  purposeFile?: string;
  /** Placeholder .purpose files met on the chain (relative, posix). Never coverage. */
  placeholders: string[];
}

function readPurpose(dirAbs: string): string | null {
  const p = path.join(dirAbs, '.purpose');
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Resolve whether `dir` (relative to rootDir, or absolute) is covered: its own
 * non-placeholder .purpose, or the nearest non-placeholder ancestor (up to and
 * including rootDir) that documents it. Placeholders never count.
 */
export function resolvePurposeCoverage(rootDir: string, dir: string): PurposeCoverage {
  const absRoot = path.resolve(rootDir);
  const absDir = path.resolve(absRoot, dir);
  const relDir = toPosix(path.relative(absRoot, absDir));
  const result: PurposeCoverage = { dir: relDir, covered: false, via: null, placeholders: [] };
  const relPurpose = (d: string) => toPosix(path.relative(absRoot, path.join(d, '.purpose')));

  const own = readPurpose(absDir);
  if (own !== null) {
    if (isPlaceholderPurposeContent(own)) {
      result.placeholders.push(relPurpose(absDir));
    } else {
      return { ...result, covered: true, via: 'own', purposeFile: relPurpose(absDir) };
    }
  }

  // Walk ancestors, never above the root.
  if (relDir.startsWith('..')) return result;
  let current = absDir;
  while (current !== absRoot) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    const content = readPurpose(current);
    if (content === null) continue;
    if (isPlaceholderPurposeContent(content)) {
      result.placeholders.push(relPurpose(current));
      continue;
    }
    if (purposeDocumentsDir(absRoot, current, content, absDir)) {
      return { ...result, covered: true, via: 'ancestor', purposeFile: relPurpose(current) };
    }
  }
  return result;
}

/**
 * Of `absPaths`, return the ones git ignores (per .gitignore, .git/info/exclude
 * and the global excludes file), using `git check-ignore`. Outside a git work
 * tree, or when git is unavailable, returns null so callers can fall back.
 */
export function filterGitIgnored(rootDir: string, absPaths: readonly string[]): Set<string> | null {
  if (absPaths.length === 0) return new Set();
  const absRoot = path.resolve(rootDir);
  const res = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
    cwd: absRoot,
    input: absPaths.join('\0') + '\0',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // 0 = some ignored, 1 = none ignored, 128 = not a repo / fatal.
  if (res.error || (res.status !== 0 && res.status !== 1)) return null;
  const ignored = new Set<string>();
  for (const p of (res.stdout || '').split('\0')) {
    if (p) ignored.add(path.resolve(absRoot, p));
  }
  return ignored;
}
