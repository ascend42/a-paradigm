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
  Difficulty,
} from './types.js';

const UNIVERSITY_DIR = '.paradigm/university';
const CONTENT_DIR = 'content';

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
  const indexPath = path.join(rootDir, UNIVERSITY_DIR, 'index.yaml');
  if (!fs.existsSync(indexPath)) return null;
  try {
    return yaml.load(fs.readFileSync(indexPath, 'utf8')) as UniversityIndex;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONTENT LOADING
// ═══════════════════════════════════════════════════════════════════

function resolveFile(rootDir: string, id: string, ext: string): string | null {
  const base = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR);
  for (const subdir of ['notes', 'policies', 'quizzes', 'paths']) {
    const fp = path.join(base, subdir, `${id}${ext}`);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

export function loadNote(rootDir: string, id: string): UniversityNote | null {
  const fp = resolveFile(rootDir, id, '.md');
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

export function loadQuiz(rootDir: string, id: string): UniversityQuiz | null {
  const fp = resolveFile(rootDir, id, '.yaml');
  if (!fp) return null;
  try {
    const data = yaml.load(fs.readFileSync(fp, 'utf8')) as UniversityQuiz;
    if (!data?.id) return null;
    return { ...data, tags: data.tags || [], symbols: data.symbols || [], questions: data.questions || [] };
  } catch {
    return null;
  }
}

export function loadPath(rootDir: string, id: string): LearningPath | null {
  const fp = resolveFile(rootDir, id, '.yaml');
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

export function saveNote(rootDir: string, frontmatter: UniversityFrontmatter, body: string): string {
  const subdir = frontmatter.type === 'policy' ? 'policies' : 'notes';
  const dir = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${frontmatter.id}.md`);
  fs.writeFileSync(fp, serializeFrontmatter(frontmatter as unknown as Record<string, unknown>, body), 'utf8');
  return fp;
}

export function saveQuiz(rootDir: string, quiz: UniversityQuiz): string {
  const dir = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR, 'quizzes');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${quiz.id}.yaml`);
  fs.writeFileSync(fp, yaml.dump(quiz, { lineWidth: -1, noRefs: true }), 'utf8');
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

export function rebuildUniversityIndex(rootDir: string): UniversityIndex {
  const uniDir = path.join(rootDir, UNIVERSITY_DIR);
  const contentBase = path.join(uniDir, CONTENT_DIR);
  const entries: UniversityIndexEntry[] = [];

  // Scan notes and policies
  for (const subdir of ['notes', 'policies']) {
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
            type: (fm.type as string) || (subdir === 'policies' ? 'policy' : 'note'),
            author: (fm.author as string) || 'unknown',
            created: (fm.created as string) || '',
            updated: (fm.updated as string) || '',
            tags: Array.isArray(fm.tags) ? fm.tags : [],
            symbols: Array.isArray(fm.symbols) ? fm.symbols : [],
            difficulty: fm.difficulty || 'beginner',
            file: `${CONTENT_DIR}/${subdir}/${file}`,
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Scan quizzes
  const quizDir = path.join(contentBase, 'quizzes');
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
            file: `${CONTENT_DIR}/quizzes/${file}`,
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Scan learning paths
  const pathDir = path.join(contentBase, 'paths');
  if (fs.existsSync(pathDir)) {
    try {
      for (const file of fs.readdirSync(pathDir).filter(f => f.endsWith('.yaml'))) {
        try {
          const data = yaml.load(fs.readFileSync(path.join(pathDir, file), 'utf8')) as LearningPath;
          if (!data?.id) continue;
          entries.push({
            id: data.id, title: data.title || file, type: 'path', author: data.author || 'unknown',
            created: data.created || '', updated: data.updated || '', tags: data.tags || [],
            symbols: [], file: `${CONTENT_DIR}/paths/${file}`,
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

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
  fs.writeFileSync(path.join(uniDir, 'index.yaml'), yaml.dump(index, { lineWidth: -1, noRefs: true }), 'utf8');
  return index;
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH & FILTER
// ═══════════════════════════════════════════════════════════════════

export function searchContent(rootDir: string, filter: UniversityFilter): UniversityIndexEntry[] {
  const index = loadUniversityIndex(rootDir);
  if (!index) return [];

  let results = [...index.entries];

  if (filter.type) results = results.filter(e => e.type === filter.type);
  if (filter.tag) results = results.filter(e => e.tags.some(t => t.startsWith(filter.tag!)));
  if (filter.difficulty) results = results.filter(e => e.difficulty === filter.difficulty);
  if (filter.symbol) results = results.filter(e => e.symbols.includes(filter.symbol!));
  if (filter.section) results = results.filter(e => e.section === filter.section);
  if (filter.query) {
    const q = filter.query.toLowerCase();
    results = results.filter(e => e.title.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
  }

  return results.slice(0, filter.limit || 20);
}
