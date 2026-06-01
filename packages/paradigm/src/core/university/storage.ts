/**
 * University Storage - Read/write per-project university content (CLI-side)
 *
 * Storage layout:
 *   .paradigm/university/
 *     config.yaml
 *     index.yaml
 *     content/
 *       notes/    N-*.md
 *       policies/ P-*.md
 *       quizzes/  Q-*.yaml
 *       paths/    LP-*.yaml
 *     diplomas/   D-*.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  UniversityFrontmatter,
  UniversityNote,
  UniversityQuiz,
  LearningPath,
  Diploma,
  UniversityIndex,
  UniversityIndexEntry,
  UniversityFilter,
} from './types.js';

const UNIVERSITY_DIR = '.paradigm/university';
const CONTENT_DIR = 'content';
const NOTES_DIR = 'notes';
const POLICIES_DIR = 'policies';
const QUIZZES_DIR = 'quizzes';
const PATHS_DIR = 'paths';
const INDEX_FILE = 'index.yaml';
const PACK_MANIFEST_FILENAME = 'pack.yaml';

// ═══════════════════════════════════════════════════════════════════
// CONTENT-BASE RESOLUTION (port of university-loader.ts, v6.6.4 contract)
//
// These are additive, optional-`packRoot` ports of the MCP loader so the
// CLI honors the pack selector. The no-`packRoot` paths below stay byte-
// identical to today. See spec §SURFACE 2.
// ═══════════════════════════════════════════════════════════════════

/**
 * Count content files under a content base — the "contains-content" probe
 * helper. Mirrors selectors.ts `countPackEntries`'s per-base counting so the
 * dual-base resolution agrees across CLI surfaces (spec §SURFACE 2.1 / C4).
 */
function countContentFiles(contentBase: string): number {
  let total = 0;
  for (const sub of [NOTES_DIR, POLICIES_DIR, QUIZZES_DIR, PATHS_DIR]) {
    const dir = path.join(contentBase, sub);
    if (!fs.existsSync(dir)) continue;
    try {
      total += fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.yaml')).length;
    } catch {
      // skip
    }
  }
  return total;
}

/**
 * Resolve the absolute content dir for a pack, probing both layouts:
 *   - `content/`     — local project packs + authored discipline packs
 *   - `src/content/` — first-party @a-company/university
 *
 * Spec §SURFACE 2.1 / C4: return the FIRST base that actually CONTAINS
 * content (not merely the first that exists), aligning with selectors.ts
 * `countPackEntries`. Returns null when neither base has content.
 */
export function resolveContentBase(packRoot: string): string | null {
  const label = resolveContentBaseLabel(packRoot);
  return label ? path.join(packRoot, label) : null;
}

/**
 * Same contains-content probe as {@link resolveContentBase} but returns the
 * relative sub-label (`'content'` | `'src/content'`) so entry `file` fields
 * are prefixed with the layout that actually exists on disk.
 */
function resolveContentBaseLabel(packRoot: string): string | null {
  for (const sub of [CONTENT_DIR, 'src/content']) {
    const dir = path.join(packRoot, sub);
    if (fs.existsSync(dir) && countContentFiles(dir) > 0) return sub;
  }
  return null;
}

/**
 * Derive a pack id from `<packRoot>/pack.yaml` via a raw-YAML read — used for
 * write-time `pack_id` stamping when a `packRoot` is explicitly provided.
 * Kept self-contained (no import of commands/selectors.ts) to avoid a
 * core→commands layering inversion. Returns null when the manifest is
 * missing/unparseable or carries no `id`.
 */
function safeLoadPackId(packRoot: string): string | null {
  const manifestPath = path.join(packRoot, PACK_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const data = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as { id?: unknown } | null;
    return data && typeof data.id === 'string' && data.id.length > 0 ? data.id : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MARKDOWN PARSING
// ═══════════════════════════════════════════════════════════════════

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  try {
    const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
    return { frontmatter, body: match[2].trim() };
  } catch {
    return null;
  }
}

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const fm = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false });
  return `---\n${fm}---\n\n${body}\n`;
}

// ═══════════════════════════════════════════════════════════════════
// INDEX
// ═══════════════════════════════════════════════════════════════════

export function loadUniversityIndex(rootDir: string): UniversityIndex | null {
  const indexPath = path.join(rootDir, UNIVERSITY_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;
  try {
    return yaml.load(fs.readFileSync(indexPath, 'utf8')) as UniversityIndex;
  } catch {
    return null;
  }
}

/**
 * Load a pack's index for the READ commands (list / search / status /
 * validate). Port of university-loader.ts `loadPackIndex`:
 *   - If `<packRoot>/index.yaml` exists → read it.
 *   - Else → build entries in-memory by scanning the pack's content dirs via
 *     {@link scanPackEntries} (probed base). Non-project packs ship no
 *     index.yaml and may live under node_modules, so we NEVER write one here.
 *
 * Always returns a non-null index (empty when no content base resolves).
 */
export function loadPackIndex(packRoot: string): UniversityIndex {
  const indexPath = path.join(packRoot, INDEX_FILE);
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(indexPath, 'utf8')) as UniversityIndex | null;
      if (parsed) return parsed;
    } catch {
      // fall through to scan
    }
  }

  const contentSubLabel = resolveContentBaseLabel(packRoot);
  if (!contentSubLabel) {
    return { version: '1.0', generatedAt: new Date().toISOString(), totalContent: 0, entries: [], diplomaCount: 0 };
  }
  const contentBase = path.join(packRoot, contentSubLabel);
  const entries = scanPackEntries(contentBase, contentSubLabel);

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalContent: entries.length,
    entries,
    diplomaCount: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CONTENT LOADING
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a content file path. Port of university-loader.ts `resolveContentFile`:
 * when `packRoot` is given, probe its dual content base (`content/` →
 * `src/content/`); when omitted, fall back to the legacy project `content/` dir
 * (byte-identical to today).
 */
function resolveFile(rootDir: string, id: string, ext: string, packRoot?: string): string | null {
  const base = packRoot
    ? (resolveContentBase(packRoot) ?? path.join(packRoot, CONTENT_DIR))
    : path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR);
  for (const subdir of [NOTES_DIR, POLICIES_DIR, QUIZZES_DIR, PATHS_DIR]) {
    const fp = path.join(base, subdir, `${id}${ext}`);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

export function loadNote(rootDir: string, id: string, packRoot?: string): UniversityNote | null {
  const fp = resolveFile(rootDir, id, '.md', packRoot);
  if (!fp) return null;
  try {
    const parsed = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
    if (!parsed) return null;
    const fm = parsed.frontmatter as unknown as UniversityFrontmatter;
    return {
      frontmatter: {
        ...fm,
        tags: fm.tags || [],
        symbols: fm.symbols || [],
        prerequisites: fm.prerequisites || [],
      },
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

export function loadQuiz(rootDir: string, id: string, packRoot?: string): UniversityQuiz | null {
  const fp = resolveFile(rootDir, id, '.yaml', packRoot);
  if (!fp) return null;
  try {
    const data = yaml.load(fs.readFileSync(fp, 'utf8')) as UniversityQuiz;
    if (!data?.id) return null;
    return { ...data, tags: data.tags || [], symbols: data.symbols || [], questions: data.questions || [] };
  } catch {
    return null;
  }
}

export function loadPath(rootDir: string, id: string, packRoot?: string): LearningPath | null {
  const fp = resolveFile(rootDir, id, '.yaml', packRoot);
  if (!fp) return null;
  try {
    const data = yaml.load(fs.readFileSync(fp, 'utf8')) as LearningPath;
    if (!data?.id) return null;
    return data;
  } catch {
    return null;
  }
}

export function loadDiplomas(rootDir: string, filter?: { student?: string; type?: string }): Diploma[] {
  const dir = path.join(rootDir, UNIVERSITY_DIR, 'diplomas');
  if (!fs.existsSync(dir)) return [];

  const results: Diploma[] = [];
  try {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
      try {
        const d = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')) as Diploma;
        if (!d?.id) continue;
        if (filter?.student && d.student !== filter.student) continue;
        if (filter?.type && d.type !== filter.type) continue;
        results.push(d);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results.sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
}

// ═══════════════════════════════════════════════════════════════════
// CONTENT WRITING
// ═══════════════════════════════════════════════════════════════════

export function saveNote(
  rootDir: string,
  frontmatter: UniversityFrontmatter,
  body: string,
  packRoot?: string,
): string {
  const subdir = frontmatter.type === 'policy' ? POLICIES_DIR : NOTES_DIR;
  // Default to the project pack when packRoot omitted → byte-identical write
  // path. Spec §SURFACE 2 note: thread packRoot ONLY for directory targeting;
  // stamp pack_id (raw-YAML manifest id) ONLY when packRoot was explicitly
  // passed — the no-packRoot path writes exactly as today (no stamping).
  const effectivePackRoot = packRoot ?? path.join(rootDir, UNIVERSITY_DIR);
  const dir = path.join(effectivePackRoot, CONTENT_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });

  let record = frontmatter as unknown as Record<string, unknown>;
  if (packRoot) {
    const packId = safeLoadPackId(packRoot);
    if (packId && !record.pack_id) record = { ...record, pack_id: packId };
  }

  const fp = path.join(dir, `${frontmatter.id}.md`);
  fs.writeFileSync(fp, serializeFrontmatter(record, body), 'utf8');
  return fp;
}

export function saveQuiz(rootDir: string, quiz: UniversityQuiz, packRoot?: string): string {
  const effectivePackRoot = packRoot ?? path.join(rootDir, UNIVERSITY_DIR);
  const dir = path.join(effectivePackRoot, CONTENT_DIR, QUIZZES_DIR);
  fs.mkdirSync(dir, { recursive: true });

  let toWrite: Record<string, unknown> = quiz as unknown as Record<string, unknown>;
  if (packRoot) {
    const packId = safeLoadPackId(packRoot);
    if (packId && !(toWrite as { pack_id?: unknown }).pack_id) {
      toWrite = { ...toWrite, pack_id: packId };
    }
  }

  const fp = path.join(dir, `${quiz.id}.yaml`);
  fs.writeFileSync(fp, yaml.dump(toWrite, { lineWidth: -1, noRefs: true }), 'utf8');
  return fp;
}

export function saveDiploma(rootDir: string, diploma: Diploma): string {
  const dir = path.join(rootDir, UNIVERSITY_DIR, 'diplomas');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${diploma.id}.yaml`);
  fs.writeFileSync(fp, yaml.dump(diploma, { lineWidth: -1, noRefs: true }), 'utf8');
  return fp;
}

// ═══════════════════════════════════════════════════════════════════
// INDEX REBUILD
// ═══════════════════════════════════════════════════════════════════

/**
 * Scan a pack's content directory into `UniversityIndexEntry[]`. Single source
 * of truth for frontmatter→entry mapping, including v6.5 `section`/`order`
 * propagation. Both `rebuildUniversityIndex` (forced `content/` label) and
 * `loadPackIndex` (probed base) call it so the two paths never diverge.
 *
 * Port of university-loader.ts `scanPackEntries`. NOTE: the CLI
 * `UniversityIndexEntry` type has no `category` field, so (unlike the MCP
 * loader) category is not surfaced here — keeps the CLI rebuild within its own
 * type shape. `section`/`order` ARE propagated (additive; the CLI type
 * supports them).
 *
 * @param contentBase absolute path to the resolved content dir
 * @param contentSubLabel relative sub-label (`content` / `src/content`) used to
 *   build each entry's `file` path so it round-trips for later body loads.
 */
function scanPackEntries(contentBase: string, contentSubLabel: string): UniversityIndexEntry[] {
  const entries: UniversityIndexEntry[] = [];

  // Scan notes and policies
  for (const subdir of [NOTES_DIR, POLICIES_DIR]) {
    const dir = path.join(contentBase, subdir);
    if (!fs.existsSync(dir)) continue;
    try {
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        try {
          const raw = fs.readFileSync(path.join(dir, file), 'utf8');
          const parsed = parseFrontmatter(raw);
          if (!parsed) continue;
          const fm = parsed.frontmatter as unknown as UniversityFrontmatter;
          entries.push({
            id: fm.id || file.replace('.md', ''),
            title: (fm.title as string) || file,
            type: (fm.type as string) || (subdir === POLICIES_DIR ? 'policy' : 'note'),
            author: (fm.author as string) || 'unknown',
            created: (fm.created as string) || '',
            updated: (fm.updated as string) || '',
            tags: Array.isArray(fm.tags) ? fm.tags : [],
            symbols: Array.isArray(fm.symbols) ? fm.symbols : [],
            difficulty: fm.difficulty || 'beginner',
            file: `${contentSubLabel}/${subdir}/${file}`,
            ...(typeof fm.section === 'string' && fm.section ? { section: fm.section } : {}),
            ...(typeof fm.order === 'number' && Number.isFinite(fm.order) ? { order: fm.order } : {}),
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Scan quizzes
  const quizDir = path.join(contentBase, QUIZZES_DIR);
  if (fs.existsSync(quizDir)) {
    try {
      for (const file of fs.readdirSync(quizDir).filter(f => f.endsWith('.yaml'))) {
        try {
          const data = yaml.load(fs.readFileSync(path.join(quizDir, file), 'utf8')) as UniversityQuiz;
          if (!data?.id) continue;
          entries.push({
            id: data.id, title: data.title || file, type: 'quiz', author: data.author || 'unknown',
            created: data.created || '', updated: data.updated || '', tags: data.tags || [],
            symbols: data.symbols || [], difficulty: data.difficulty || 'beginner',
            file: `${contentSubLabel}/${QUIZZES_DIR}/${file}`,
            ...(typeof data.section === 'string' && data.section ? { section: data.section } : {}),
            ...(typeof data.order === 'number' && Number.isFinite(data.order) ? { order: data.order } : {}),
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Scan learning paths
  const pathDir = path.join(contentBase, PATHS_DIR);
  if (fs.existsSync(pathDir)) {
    try {
      for (const file of fs.readdirSync(pathDir).filter(f => f.endsWith('.yaml'))) {
        try {
          const data = yaml.load(fs.readFileSync(path.join(pathDir, file), 'utf8')) as LearningPath;
          if (!data?.id) continue;
          entries.push({
            id: data.id, title: data.title || file, type: 'path', author: data.author || 'unknown',
            created: data.created || '', updated: data.updated || '', tags: data.tags || [],
            symbols: [], file: `${contentSubLabel}/${PATHS_DIR}/${file}`,
            ...(typeof data.section === 'string' && data.section ? { section: data.section } : {}),
            ...(typeof data.order === 'number' && Number.isFinite(data.order) ? { order: data.order } : {}),
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return entries;
}

export function rebuildUniversityIndex(rootDir: string): UniversityIndex {
  const uniDir = path.join(rootDir, UNIVERSITY_DIR);
  const contentBase = path.join(uniDir, CONTENT_DIR);

  // Project index is always built from the `content/` layout (forced label so
  // entry `file` paths stay project-relative).
  const entries = scanPackEntries(contentBase, CONTENT_DIR);

  // Count diplomas
  let diplomaCount = 0;
  const diplomaDir = path.join(uniDir, 'diplomas');
  if (fs.existsSync(diplomaDir)) {
    try { diplomaCount = fs.readdirSync(diplomaDir).filter(f => f.endsWith('.yaml')).length; } catch { /* skip */ }
  }

  const index: UniversityIndex = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalContent: entries.length,
    entries,
    diplomaCount,
  };

  fs.mkdirSync(uniDir, { recursive: true });
  fs.writeFileSync(path.join(uniDir, INDEX_FILE), yaml.dump(index, { lineWidth: -1, noRefs: true }), 'utf8');
  return index;
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH & FILTER
// ═══════════════════════════════════════════════════════════════════

/** Apply filters to a set of entries. Shared by searchContent + meta variant. */
function applyFilters(entries: UniversityIndexEntry[], filter: UniversityFilter): UniversityIndexEntry[] {
  let results = [...entries];

  if (filter.type) results = results.filter(e => e.type === filter.type);
  if (filter.tag) results = results.filter(e => e.tags.some(t => t.startsWith(filter.tag!)));
  if (filter.difficulty) results = results.filter(e => e.difficulty === filter.difficulty);
  if (filter.symbol) results = results.filter(e => e.symbols.includes(filter.symbol!));
  if (filter.section) results = results.filter(e => e.section === filter.section);
  if (filter.query) {
    const q = filter.query.toLowerCase();
    results = results.filter(e => e.title.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
  }

  return results;
}

export function searchContent(
  rootDir: string,
  filter: UniversityFilter,
  packRoot?: string,
): UniversityIndexEntry[] {
  // packRoot present → load the selected pack (its index.yaml or an in-memory
  // scan). Omitted → unchanged project-pack path (byte-identical).
  const index = packRoot ? loadPackIndex(packRoot) : loadUniversityIndex(rootDir);
  if (!index) return [];

  return applyFilters(index.entries, filter).slice(0, filter.limit || 20);
}

/**
 * Like {@link searchContent} but also returns the pre-slice count, so callers
 * can surface "showing N of TOTAL" without re-counting (spec §C2 CLI parity).
 * `searchContent`'s signature stays untouched for back-compat.
 */
export function searchContentWithMeta(
  rootDir: string,
  filter: UniversityFilter,
  packRoot?: string,
): { entries: UniversityIndexEntry[]; total: number } {
  const index = packRoot ? loadPackIndex(packRoot) : loadUniversityIndex(rootDir);
  if (!index) return { entries: [], total: 0 };

  const filtered = applyFilters(index.entries, filter);
  return { entries: filtered.slice(0, filter.limit || 20), total: filtered.length };
}
