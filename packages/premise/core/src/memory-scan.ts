/**
 * #native-memory-scan — parse + graph-validity primitive for Claude Code's
 * NATIVE memory store (the `~/.claude/projects/<slug>/memory/` tree).
 *
 * This is the pure, testable core of the Memory Steward (design settled in
 * TD-2026-09-19-110, sub-phase A0). It:
 *
 *   1. Resolves a project root → its native memory directory (slug = the
 *      absolute root path with every "/" replaced by "-").
 *   2. Reads the MEMORY.md index (kind:'index') + each memory/*.md entry
 *      (kind:'entry'), parses YAML frontmatter (name / description / type),
 *      captures the freeform markdown body and the file's mtime.
 *   3. Extracts Paradigm symbol mentions (/[#$^!~][a-z0-9-]+/g, then validated
 *      with isValidSymbol) and best-effort file-path mentions from the body.
 *   4. Cross-checks those mentions against the LIVE symbol graph
 *      (loadLiveGraph → allSymbols) and the filesystem to classify each entry's
 *      graph validity: valid / partly-stale / provably-stale.
 *
 * FAIL-OPEN DISCIPLINE: this code runs (transitively) near a Stop hook. A
 * missing memory dir, an unreadable file, malformed frontmatter, or a
 * path-scheme surprise must SKIP that entry (or return []), never throw. It is
 * a read-only observer — it never mutates the native store.
 *
 * Library code: no console output here (mirrors graph-slice.ts). Callers log.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

import { isValidSymbol, parseSymbol } from './symbol-index.js';
import { loadLiveGraph } from './graph-slice.js';

// ────────────────────────────────────────────────────────
// Public contract
// ────────────────────────────────────────────────────────

export type MemoryEntryKind = 'index' | 'entry';
export type MemoryEntryType = 'feedback' | 'project' | 'reference' | 'user' | 'unknown';
export type GraphValidityVerdict = 'valid' | 'partly-stale' | 'provably-stale';

export interface MemoryGraphValidity {
  /** Mentioned symbols that are NOT present in the live symbol graph. */
  deadSymbols: string[];
  /** Mentioned file paths that do NOT exist on disk (relative to rootDir). */
  deadFiles: string[];
  verdict: GraphValidityVerdict;
}

export interface ParsedMemoryEntry {
  /** Absolute path to the source file. */
  file: string;
  kind: MemoryEntryKind;
  /** Frontmatter `name` (empty string if absent — e.g. the index). */
  name: string;
  /** Frontmatter `description` (empty string if absent). */
  description: string;
  /** Frontmatter `type`, normalized; 'unknown' when absent/unrecognized. */
  type: MemoryEntryType;
  /** Freeform markdown body (frontmatter stripped). */
  body: string;
  /** File modification time in ms since epoch — the canonical "age" source. */
  mtimeMs: number;
  /** Deduped, validated Paradigm symbol mentions found in the body. */
  symbolMentions: string[];
  /** Deduped, best-effort file-path mentions found in the body. */
  fileMentions: string[];
  graphValidity: MemoryGraphValidity;
}

// ────────────────────────────────────────────────────────
// Slug / path resolution
// ────────────────────────────────────────────────────────

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'feedback',
  'project',
  'reference',
  'user',
]);

const SYMBOL_MENTION_RE = /[#$^!~][a-z0-9-]+/g;
const MS_ZERO = 0;

/**
 * Resolve an absolute project root to its Claude Code native-memory slug: the
 * absolute path with every path separator "/" replaced by "-". A relative input
 * is first resolved against the process cwd so the slug is always derived from
 * an absolute path (matching how Claude Code names the directory).
 */
export function resolveMemorySlug(rootDir: string): string {
  const abs = path.resolve(rootDir);
  return abs.split(path.sep).join('-');
}

/**
 * Build the native-memory directory path for a project root:
 *   ~/.claude/projects/<slug>/memory
 */
export function resolveMemoryDir(rootDir: string): string {
  const slug = resolveMemorySlug(rootDir);
  return path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
}

// ────────────────────────────────────────────────────────
// Scan
// ────────────────────────────────────────────────────────

/**
 * Scan a project's native memory store into ParsedMemoryEntry[].
 *
 * Returns [] (never throws) when the memory dir is absent or unreadable. The
 * MEMORY.md index — if present — is returned as kind:'index'; every other *.md
 * file is kind:'entry'. A file that cannot be read or parsed is skipped, not
 * fatal.
 */
export async function scanNativeMemory(rootDir: string): Promise<ParsedMemoryEntry[]> {
  const memoryDir = resolveMemoryDir(rootDir);

  // FAIL-OPEN: no dir → nothing to scan.
  let dirents: fs.Dirent[];
  try {
    if (!fs.existsSync(memoryDir)) return [];
    dirents = fs.readdirSync(memoryDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Load the live graph ONCE for symbol validity. Fail-open: if the graph can't
  // be built we simply cannot prove a symbol dead, so no symbol is flagged.
  let allSymbols: Set<string> | null = null;
  try {
    const graph = await loadLiveGraph(rootDir);
    allSymbols = new Set(graph.allSymbols.map(collapsePrefix));
  } catch {
    allSymbols = null;
  }

  const entries: ParsedMemoryEntry[] = [];

  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    if (!dirent.name.toLowerCase().endsWith('.md')) continue;

    const file = path.join(memoryDir, dirent.name);
    const kind: MemoryEntryKind = dirent.name === 'MEMORY.md' ? 'index' : 'entry';

    const parsed = parseEntryFile(file, kind, rootDir, allSymbols);
    if (parsed) entries.push(parsed);
  }

  // Deterministic order: index first, then entries by filename.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'index' ? -1 : 1;
    return a.file.localeCompare(b.file);
  });

  return entries;
}

// ────────────────────────────────────────────────────────
// Per-file parsing (fail-open)
// ────────────────────────────────────────────────────────

function parseEntryFile(
  file: string,
  kind: MemoryEntryKind,
  rootDir: string,
  allSymbols: Set<string> | null,
): ParsedMemoryEntry | null {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = fs.readFileSync(file, 'utf-8');
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null; // unreadable → skip
  }

  const { frontmatter, body } = splitFrontmatter(raw);

  const name = readStringField(frontmatter, 'name');
  const description = readStringField(frontmatter, 'description');
  const type = normalizeType(readStringField(frontmatter, 'type'));

  const symbolMentions = extractSymbolMentions(body);
  const fileMentions = extractFileMentions(body);

  const graphValidity = computeGraphValidity(
    symbolMentions,
    fileMentions,
    rootDir,
    allSymbols,
  );

  return {
    file,
    kind,
    name,
    description,
    type,
    body,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : MS_ZERO,
    symbolMentions,
    fileMentions,
    graphValidity,
  };
}

/**
 * Split leading YAML frontmatter (delimited by "---" lines) from the body.
 * FAIL-OPEN: if there is no frontmatter, or the YAML is malformed, the WHOLE
 * content is treated as body and frontmatter is an empty object — never throws.
 */
function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  // Frontmatter must be the very first thing in the file.
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }

  // Match: opening "---\n", captured block, closing "\n---" on its own line.
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const [, fmText, body] = match;
  try {
    const loaded = yaml.load(fmText);
    const frontmatter =
      loaded && typeof loaded === 'object' && !Array.isArray(loaded)
        ? (loaded as Record<string, unknown>)
        : {};
    return { frontmatter, body: body ?? '' };
  } catch {
    // Malformed frontmatter → fail-open: keep body, drop frontmatter.
    return { frontmatter: {}, body: body ?? '' };
  }
}

function readStringField(fm: Record<string, unknown>, key: string): string {
  const v = fm[key];
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeType(value: string): MemoryEntryType {
  const v = value.toLowerCase();
  return KNOWN_TYPES.has(v) ? (v as MemoryEntryType) : 'unknown';
}

// ────────────────────────────────────────────────────────
// Mention extraction
// ────────────────────────────────────────────────────────

/**
 * Extract validated Paradigm symbol mentions from freeform text. Candidates are
 * matched by prefix + kebab body (/[#$^!~][a-z0-9-]+/g), then validated with the
 * canonical isValidSymbol/parseSymbol so heading hashes ("## foo") and noise are
 * rejected. Deduped, order-preserving.
 */
export function extractSymbolMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = text.match(SYMBOL_MENTION_RE) ?? [];
  for (const m of matches) {
    if (!isValidSymbol(m)) continue;
    // Defensive: parseSymbol must also succeed (keeps the two contracts aligned).
    if (!parseSymbol(m)) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

// A file-ish token: contains a "/" and ends with a short extension. Backtick
// spans are handled separately. URLs (scheme://) are excluded.
const BACKTICK_SPAN_RE = /`([^`\n]+)`/g;
const BARE_PATH_RE = /(?:^|[\s(,"'])([A-Za-z0-9_.\-/]+\/[A-Za-z0-9_.\-/]*\.[A-Za-z0-9]{1,6})/g;
const FILE_EXT_RE = /\.[A-Za-z0-9]{1,6}$/;

/**
 * Best-effort file-path mention extraction. Two sources:
 *   (a) inline code spans (`path/to/file.ts`) that look path-ish;
 *   (b) bare tokens containing "/" and a file extension.
 * Trailing punctuation is trimmed; URLs are skipped. Deduped, order-preserving.
 */
export function extractFileMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const consider = (candidateRaw: string) => {
    const candidate = trimPathPunctuation(candidateRaw);
    if (!candidate) return;
    if (candidate.includes('://')) return; // URL, not a repo path
    if (!candidate.includes('/')) return;
    if (/[*?{}[\]]/.test(candidate)) return; // glob pattern, not a concrete path — cannot be existence-checked
    if (!FILE_EXT_RE.test(candidate)) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  // (a) inline code spans
  let m: RegExpExecArray | null;
  BACKTICK_SPAN_RE.lastIndex = 0;
  while ((m = BACKTICK_SPAN_RE.exec(text)) !== null) {
    consider(m[1]);
  }

  // (b) bare path tokens
  BARE_PATH_RE.lastIndex = 0;
  while ((m = BARE_PATH_RE.exec(text)) !== null) {
    consider(m[1]);
  }

  return out;
}

function trimPathPunctuation(s: string): string {
  return s.trim().replace(/^[('"]+/, '').replace(/[)'".,;:]+$/, '');
}

// ────────────────────────────────────────────────────────
// Graph validity
// ────────────────────────────────────────────────────────

/**
 * Collapse a leading doubled symbol prefix run to a single prefix so the repo's
 * double-prefix flow form ("$$flow") compares equal to a single-prefix mention
 * ("$flow"). Avoids false "dead symbol" reports.
 */
function collapsePrefix(symbol: string): string {
  return symbol.replace(/^([#$^!~])\1+/, '$1');
}

function computeGraphValidity(
  symbolMentions: string[],
  fileMentions: string[],
  rootDir: string,
  allSymbols: Set<string> | null,
): MemoryGraphValidity {
  const deadSymbols: string[] = [];
  // Only classify symbols dead when we actually loaded the graph. Fail-open: an
  // unavailable graph proves nothing.
  if (allSymbols) {
    for (const sym of symbolMentions) {
      if (!allSymbols.has(collapsePrefix(sym))) deadSymbols.push(sym);
    }
  }

  const deadFiles: string[] = [];
  for (const cited of fileMentions) {
    if (!fileExists(rootDir, cited)) deadFiles.push(cited);
  }

  // Verdict. Symbols are validated against the canonical symbol set, so a dead
  // symbol is AUTHORITATIVE. File paths are extracted from freeform prose
  // (relative to an unknown package dir, monorepo-ambiguous, often illustrative)
  // so a "dead file" is only a SOFT signal — it must never, on its own, condemn
  // an entry to prune. Only all-symbols-dead reaches provably-stale.
  //   valid          — nothing mentioned is dead
  //   provably-stale — the entry has real symbol references and every one is gone
  //   partly-stale   — dead files, or some (not all) symbol references dead
  const anyDead = deadSymbols.length + deadFiles.length > 0;
  const haveSymbolCheck = !!allSymbols && symbolMentions.length > 0;
  const allSymbolsDead =
    haveSymbolCheck && deadSymbols.length === symbolMentions.length;

  let verdict: GraphValidityVerdict;
  if (!anyDead) {
    verdict = 'valid';
  } else if (allSymbolsDead) {
    verdict = 'provably-stale';
  } else {
    verdict = 'partly-stale';
  }

  return { deadSymbols, deadFiles, verdict };
}

/** Fail-open existence check for a cited path relative to (or absolute in) rootDir. */
function fileExists(rootDir: string, cited: string): boolean {
  try {
    const normalized = cited.replace(/^\.\//, '');
    const target = path.isAbsolute(normalized)
      ? normalized
      : path.join(rootDir, normalized);
    return fs.existsSync(target);
  } catch {
    // Path-scheme surprise → fail-open: assume it exists (don't flag as dead).
    return true;
  }
}
