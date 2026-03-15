/**
 * University Loader - Reads/writes per-project university content
 *
 * Storage layout:
 *   .paradigm/university/
 *     config.yaml               # Branding & theme
 *     index.yaml                # Auto-generated catalog
 *     content/
 *       notes/    N-*.md        # Notes & policies (markdown + YAML frontmatter)
 *       policies/ P-*.md
 *       quizzes/  Q-*.yaml      # Quizzes (YAML)
 *       paths/    LP-*.yaml     # Learning paths (YAML)
 *     diplomas/   D-*.yaml      # Auto-generated diplomas
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  UniversityConfig,
  UniversityBranding,
  UniversityTheme,
  UniversityFrontmatter,
  UniversityNote,
  UniversityQuiz,
  LearningPath,
  Diploma,
  UniversityIndex,
  UniversityIndexEntry,
  UniversityFilter,
  UniversityValidationIssue,
  UniversityValidationResult,
  Difficulty,
} from '../types/university.js';

const UNIVERSITY_DIR = '.paradigm/university';
const CONTENT_DIR = 'content';
const NOTES_DIR = 'notes';
const POLICIES_DIR = 'policies';
const QUIZZES_DIR = 'quizzes';
const PATHS_DIR = 'paths';
const DIPLOMAS_DIR = 'diplomas';
const INDEX_FILE = 'index.yaml';
const CONFIG_FILE = 'config.yaml';

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_BRANDING: UniversityBranding = {
  name: 'Project University',
  tagline: 'Learn the codebase',
  institution: 'Paradigm',
};

const DEFAULT_THEME: UniversityTheme = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  accent: '#f59e0b',
  background: '#0f172a',
  surface: '#1e293b',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  success: '#22c55e',
  error: '#ef4444',
  font: 'Inter, system-ui, sans-serif',
};

const DEFAULT_CONFIG: UniversityConfig = {
  branding: DEFAULT_BRANDING,
  theme: DEFAULT_THEME,
  content: {
    categories: [],
    defaultDifficulty: 'beginner',
    requireApproval: false,
  },
  diplomas: {
    includeGlobalPLSAT: true,
    customCertStyle: null,
  },
};

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

export function loadUniversityConfig(rootDir: string): UniversityConfig {
  const configPath = path.join(rootDir, UNIVERSITY_DIR, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(raw) as Partial<UniversityConfig> | null;
    if (!data) return { ...DEFAULT_CONFIG };

    return {
      branding: { ...DEFAULT_BRANDING, ...(data.branding || {}) },
      theme: { ...DEFAULT_THEME, ...(data.theme || {}) },
      content: {
        categories: data.content?.categories || [],
        defaultDifficulty: data.content?.defaultDifficulty || 'beginner',
        requireApproval: data.content?.requireApproval ?? false,
      },
      diplomas: {
        includeGlobalPLSAT: data.diplomas?.includeGlobalPLSAT ?? true,
        customCertStyle: data.diplomas?.customCertStyle ?? null,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ═══════════════════════════════════════════════════════════════════
// INDEX
// ═══════════════════════════════════════════════════════════════════

export function loadUniversityIndex(rootDir: string): UniversityIndex | null {
  const indexPath = path.join(rootDir, UNIVERSITY_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;

  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    return yaml.load(raw) as UniversityIndex;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MARKDOWN PARSING (frontmatter + body)
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
// NOTES / POLICIES
// ═══════════════════════════════════════════════════════════════════

export function loadNote(rootDir: string, id: string): UniversityNote | null {
  const filePath = resolveContentFile(rootDir, id, '.md');
  if (!filePath) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    if (!parsed) return null;

    const fm = parsed.frontmatter as unknown as UniversityFrontmatter;
    return { frontmatter: normalizeFrontmatter(fm), body: parsed.body };
  } catch {
    return null;
  }
}

export function saveNote(rootDir: string, frontmatter: UniversityFrontmatter, body: string): string {
  const subdir = frontmatter.type === 'policy' ? POLICIES_DIR : NOTES_DIR;
  const dir = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${frontmatter.id}.md`);
  const content = serializeFrontmatter(frontmatter as unknown as Record<string, unknown>, body);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// QUIZZES
// ═══════════════════════════════════════════════════════════════════

export function loadQuiz(rootDir: string, id: string): UniversityQuiz | null {
  const filePath = resolveContentFile(rootDir, id, '.yaml');
  if (!filePath) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(raw) as UniversityQuiz;
    if (!data || !data.id) return null;
    return normalizeQuiz(data);
  } catch {
    return null;
  }
}

export function saveQuiz(rootDir: string, quiz: UniversityQuiz): string {
  const dir = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR, QUIZZES_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${quiz.id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(quiz, { lineWidth: -1, noRefs: true }), 'utf8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// LEARNING PATHS
// ═══════════════════════════════════════════════════════════════════

export function loadPath(rootDir: string, id: string): LearningPath | null {
  const filePath = resolveContentFile(rootDir, id, '.yaml');
  if (!filePath) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(raw) as LearningPath;
    if (!data || !data.id) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePath(rootDir: string, lp: LearningPath): string {
  const dir = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR, PATHS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${lp.id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(lp, { lineWidth: -1, noRefs: true }), 'utf8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// DIPLOMAS
// ═══════════════════════════════════════════════════════════════════

export function loadDiplomas(rootDir: string, filter?: { student?: string; type?: string }): Diploma[] {
  const dir = path.join(rootDir, UNIVERSITY_DIR, DIPLOMAS_DIR);
  if (!fs.existsSync(dir)) return [];

  const results: Diploma[] = [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const diploma = yaml.load(raw) as Diploma;
        if (!diploma || !diploma.id) continue;

        if (filter?.student && diploma.student !== filter.student) continue;
        if (filter?.type && diploma.type !== filter.type) continue;

        results.push(diploma);
      } catch {
        // Skip malformed
      }
    }
  } catch {
    // Directory read failed
  }

  return results.sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
}

export function saveDiploma(rootDir: string, diploma: Diploma): string {
  const dir = path.join(rootDir, UNIVERSITY_DIR, DIPLOMAS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${diploma.id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(diploma, { lineWidth: -1, noRefs: true }), 'utf8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH & FILTER
// ═══════════════════════════════════════════════════════════════════

export function searchContent(rootDir: string, filter: UniversityFilter): UniversityIndexEntry[] {
  const index = loadUniversityIndex(rootDir);
  if (!index) return [];

  let results = [...index.entries];

  if (filter.type) {
    results = results.filter(e => e.type === filter.type);
  }
  if (filter.tag) {
    results = results.filter(e => e.tags.some(t => t.startsWith(filter.tag!)));
  }
  if (filter.difficulty) {
    results = results.filter(e => e.difficulty === filter.difficulty);
  }
  if (filter.symbol) {
    results = results.filter(e => e.symbols.some(s => s === filter.symbol));
  }
  if (filter.author) {
    results = results.filter(e => e.author === filter.author);
  }
  if (filter.query) {
    const q = filter.query.toLowerCase();
    results = results.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q)),
    );
  }

  const limit = filter.limit || 20;
  return results.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// INDEX REBUILD
// ═══════════════════════════════════════════════════════════════════

export function rebuildUniversityIndex(rootDir: string): UniversityIndex {
  const uniDir = path.join(rootDir, UNIVERSITY_DIR);
  const contentDir = path.join(uniDir, CONTENT_DIR);
  const entries: UniversityIndexEntry[] = [];

  // Scan notes and policies (markdown with frontmatter)
  for (const subdir of [NOTES_DIR, POLICIES_DIR]) {
    const dir = path.join(contentDir, subdir);
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
            difficulty: (fm.difficulty as Difficulty) || 'beginner',
            file: `${CONTENT_DIR}/${subdir}/${file}`,
          });
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Directory read failed
    }
  }

  // Scan quizzes (YAML)
  const quizDir = path.join(contentDir, QUIZZES_DIR);
  if (fs.existsSync(quizDir)) {
    try {
      for (const file of fs.readdirSync(quizDir).filter(f => f.endsWith('.yaml'))) {
        try {
          const raw = fs.readFileSync(path.join(quizDir, file), 'utf8');
          const quiz = yaml.load(raw) as UniversityQuiz;
          if (!quiz || !quiz.id) continue;

          entries.push({
            id: quiz.id,
            title: quiz.title || file,
            type: 'quiz',
            author: quiz.author || 'unknown',
            created: quiz.created || '',
            updated: quiz.updated || '',
            tags: quiz.tags || [],
            symbols: quiz.symbols || [],
            difficulty: quiz.difficulty || 'beginner',
            file: `${CONTENT_DIR}/${QUIZZES_DIR}/${file}`,
          });
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Directory read failed
    }
  }

  // Scan learning paths (YAML)
  const pathDir = path.join(contentDir, PATHS_DIR);
  if (fs.existsSync(pathDir)) {
    try {
      for (const file of fs.readdirSync(pathDir).filter(f => f.endsWith('.yaml'))) {
        try {
          const raw = fs.readFileSync(path.join(pathDir, file), 'utf8');
          const lp = yaml.load(raw) as LearningPath;
          if (!lp || !lp.id) continue;

          entries.push({
            id: lp.id,
            title: lp.title || file,
            type: 'path',
            author: lp.author || 'unknown',
            created: lp.created || '',
            updated: lp.updated || '',
            tags: lp.tags || [],
            symbols: [],
            file: `${CONTENT_DIR}/${PATHS_DIR}/${file}`,
          });
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Directory read failed
    }
  }

  // Count diplomas
  let diplomaCount = 0;
  const diplomaDir = path.join(uniDir, DIPLOMAS_DIR);
  if (fs.existsSync(diplomaDir)) {
    try {
      diplomaCount = fs.readdirSync(diplomaDir).filter(f => f.endsWith('.yaml')).length;
    } catch {
      // Skip
    }
  }

  const index: UniversityIndex = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalContent: entries.length,
    entries,
    diplomaCount,
  };

  // Write index
  fs.mkdirSync(uniDir, { recursive: true });
  const indexPath = path.join(uniDir, INDEX_FILE);
  fs.writeFileSync(indexPath, yaml.dump(index, { lineWidth: -1, noRefs: true }), 'utf8');

  return index;
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════

export function validateUniversityContent(
  rootDir: string,
  options?: { id?: string; deep?: boolean },
): UniversityValidationResult {
  const index = loadUniversityIndex(rootDir) || rebuildUniversityIndex(rootDir);
  const issues: UniversityValidationIssue[] = [];
  let entriesToCheck = index.entries;

  if (options?.id) {
    entriesToCheck = entriesToCheck.filter(e => e.id === options.id);
  }

  // Load scan index for deep checks
  let knownSymbols: Set<string> | null = null;
  if (options?.deep) {
    knownSymbols = loadKnownSymbols(rootDir);
  }

  // All content IDs for prerequisite/path checks
  const allContentIds = new Set(index.entries.map(e => e.id));

  for (const entry of entriesToCheck) {
    // Schema checks
    if (!entry.title) {
      issues.push({
        contentId: entry.id,
        severity: 'error',
        check: 'missing-title',
        message: 'Content is missing a title',
        fix: 'Add a title field to the content frontmatter',
      });
    }

    if (entry.type === 'quiz') {
      validateQuizContent(rootDir, entry.id, issues);
    }

    if (entry.type === 'path') {
      validatePathContent(rootDir, entry.id, allContentIds, issues);
    }

    // Deep checks: symbol references
    if (knownSymbols && entry.symbols.length > 0) {
      for (const sym of entry.symbols) {
        if (!knownSymbols.has(sym)) {
          issues.push({
            contentId: entry.id,
            severity: 'warning',
            check: 'broken-symbol-ref',
            message: `Symbol "${sym}" not found in scan-index`,
            fix: `Remove or update the symbol reference in ${entry.id}`,
          });
        }
      }
    }

    // Deep checks: content freshness vs symbol .purpose mtime
    if (options?.deep && entry.symbols.length > 0 && entry.updated) {
      checkContentStaleness(rootDir, entry, issues);
    }
  }

  // Validate diplomas
  const diplomas = loadDiplomas(rootDir);
  for (const diploma of diplomas) {
    if (diploma.total > 0 && diploma.percentage !== Math.round((diploma.score / diploma.total) * 10000) / 100) {
      // Allow small floating point differences
      const expected = Math.round((diploma.score / diploma.total) * 10000) / 100;
      if (Math.abs(diploma.percentage - expected) > 0.1) {
        issues.push({
          contentId: diploma.id,
          severity: 'warning',
          check: 'diploma-score-mismatch',
          message: `Diploma percentage ${diploma.percentage} doesn't match score ${diploma.score}/${diploma.total} (expected ${expected})`,
        });
      }
    }
  }

  // Symbol coverage stats
  const symbolCoverage = computeSymbolCoverage(rootDir, index);

  return {
    status: issues.some(i => i.severity === 'error') ? 'errors' : issues.length > 0 ? 'warnings' : 'healthy',
    totalContent: index.totalContent,
    checked: entriesToCheck.length,
    issues,
    symbolCoverage,
  };
}

function validateQuizContent(rootDir: string, id: string, issues: UniversityValidationIssue[]): void {
  const quiz = loadQuiz(rootDir, id);
  if (!quiz) {
    issues.push({
      contentId: id,
      severity: 'error',
      check: 'unreadable-quiz',
      message: 'Quiz file could not be parsed',
    });
    return;
  }

  if (!quiz.passThreshold || quiz.passThreshold < 0 || quiz.passThreshold > 1) {
    issues.push({
      contentId: id,
      severity: 'warning',
      check: 'invalid-pass-threshold',
      message: `passThreshold should be between 0 and 1, got ${quiz.passThreshold}`,
      fix: 'Set passThreshold to a value between 0.0 and 1.0',
    });
  }

  for (const q of quiz.questions) {
    if (!q.choices || typeof q.choices !== 'object') {
      issues.push({
        contentId: id,
        severity: 'error',
        check: 'invalid-quiz-choices',
        message: `Question ${q.id} has no choices defined`,
      });
      continue;
    }

    if (!q.correct || !(q.correct in q.choices)) {
      issues.push({
        contentId: id,
        severity: 'error',
        check: 'invalid-quiz-answer',
        message: `Question ${q.id}: correct answer "${q.correct}" not found in choices [${Object.keys(q.choices).join(', ')}]`,
        fix: `Set correct to one of: ${Object.keys(q.choices).join(', ')}`,
      });
    }
  }
}

function validatePathContent(
  rootDir: string,
  id: string,
  allContentIds: Set<string>,
  issues: UniversityValidationIssue[],
): void {
  const lp = loadPath(rootDir, id);
  if (!lp) {
    issues.push({
      contentId: id,
      severity: 'error',
      check: 'unreadable-path',
      message: 'Learning path file could not be parsed',
    });
    return;
  }

  for (const step of lp.steps) {
    // Allow plsat: references
    if (step.content.startsWith('plsat:')) continue;

    if (!allContentIds.has(step.content)) {
      issues.push({
        contentId: id,
        severity: 'error',
        check: 'broken-path-step',
        message: `Learning path step references "${step.content}" which doesn't exist`,
        fix: `Create content with id "${step.content}" or remove this step`,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SYMBOL LINKING (for ripple integration)
// ═══════════════════════════════════════════════════════════════════

export interface AffectedUniversityContent {
  id: string;
  title: string;
  type: string;
  stale: boolean;
}

export function getAffectedUniversityContent(rootDir: string, symbol: string): AffectedUniversityContent[] {
  const index = loadUniversityIndex(rootDir);
  if (!index) return [];

  const affected: AffectedUniversityContent[] = [];

  for (const entry of index.entries) {
    if (entry.symbols.includes(symbol)) {
      const stale = isContentStale(rootDir, entry, symbol);
      affected.push({
        id: entry.id,
        title: entry.title,
        type: entry.type,
        stale,
      });
    }
  }

  return affected;
}

// ═══════════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════════

export interface OnboardingSequence {
  paths: Array<{ id: string; title: string; steps: number; completed: boolean }>;
  suggestedContent: UniversityIndexEntry[];
  diplomaCount: number;
  totalContent: number;
}

export function getOnboardingSequence(rootDir: string, student?: string): OnboardingSequence {
  const index = loadUniversityIndex(rootDir);
  if (!index) {
    return { paths: [], suggestedContent: [], diplomaCount: 0, totalContent: 0 };
  }

  // Find learning paths
  const pathEntries = index.entries.filter(e => e.type === 'path');
  const diplomas = student ? loadDiplomas(rootDir, { student }) : [];
  const diplomaSourceIds = new Set(diplomas.map(d => d.source));

  const paths = pathEntries.map(pe => {
    const lp = loadPath(rootDir, pe.id);
    return {
      id: pe.id,
      title: pe.title,
      steps: lp?.steps.length || 0,
      completed: diplomaSourceIds.has(pe.id),
    };
  });

  // Suggest beginner content for onboarding
  const suggestedContent = index.entries
    .filter(e => e.type !== 'path' && (e.difficulty === 'beginner' || e.tags.includes('onboarding')))
    .slice(0, 10);

  return {
    paths,
    suggestedContent,
    diplomaCount: diplomas.length,
    totalContent: index.totalContent,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function resolveContentFile(rootDir: string, id: string, ext: string): string | null {
  const contentDir = path.join(rootDir, UNIVERSITY_DIR, CONTENT_DIR);

  // Try each subdirectory
  for (const subdir of [NOTES_DIR, POLICIES_DIR, QUIZZES_DIR, PATHS_DIR]) {
    const filePath = path.join(contentDir, subdir, `${id}${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

function normalizeFrontmatter(fm: UniversityFrontmatter): UniversityFrontmatter {
  return {
    id: fm.id || '',
    title: fm.title || '',
    type: fm.type || 'note',
    author: fm.author || 'unknown',
    created: fm.created || '',
    updated: fm.updated || '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    symbols: Array.isArray(fm.symbols) ? fm.symbols : [],
    difficulty: fm.difficulty || 'beginner',
    estimatedMinutes: fm.estimatedMinutes,
    prerequisites: Array.isArray(fm.prerequisites) ? fm.prerequisites : [],
  };
}

function normalizeQuiz(quiz: UniversityQuiz): UniversityQuiz {
  return {
    ...quiz,
    tags: quiz.tags || [],
    symbols: quiz.symbols || [],
    difficulty: quiz.difficulty || 'beginner',
    passThreshold: quiz.passThreshold ?? 0.7,
    questions: quiz.questions || [],
  };
}

function loadKnownSymbols(rootDir: string): Set<string> {
  const symbols = new Set<string>();
  const scanIndexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
  if (!fs.existsSync(scanIndexPath)) return symbols;

  try {
    const raw = fs.readFileSync(scanIndexPath, 'utf8');
    const index = JSON.parse(raw);
    if (index.symbols && Array.isArray(index.symbols)) {
      for (const sym of index.symbols) {
        if (sym.symbol) symbols.add(sym.symbol);
      }
    }
  } catch {
    // Skip
  }

  return symbols;
}

function computeSymbolCoverage(rootDir: string, index: UniversityIndex): UniversityValidationResult['symbolCoverage'] {
  const knownSymbols = loadKnownSymbols(rootDir);
  const coveredSymbols = new Set<string>();

  for (const entry of index.entries) {
    for (const sym of entry.symbols) {
      if (knownSymbols.has(sym)) {
        coveredSymbols.add(sym);
      }
    }
  }

  const total = knownSymbols.size;
  return {
    totalSymbols: total,
    coveredByContent: coveredSymbols.size,
    percentage: total > 0 ? Math.round((coveredSymbols.size / total) * 100) : 0,
  };
}

function isContentStale(rootDir: string, entry: UniversityIndexEntry, _symbol: string): boolean {
  if (!entry.updated) return false;

  // Check if any .purpose file in the project was modified after this content
  const contentUpdated = new Date(entry.updated).getTime();
  if (isNaN(contentUpdated)) return false;

  // Find .purpose files that might define the symbol
  const scanIndexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
  if (!fs.existsSync(scanIndexPath)) return false;

  try {
    const raw = fs.readFileSync(scanIndexPath, 'utf8');
    const index = JSON.parse(raw);
    if (index.symbols && Array.isArray(index.symbols)) {
      for (const sym of index.symbols) {
        if (sym.symbol === _symbol && sym.filePath) {
          const purposePath = path.join(rootDir, sym.filePath);
          if (fs.existsSync(purposePath)) {
            const stat = fs.statSync(purposePath);
            if (stat.mtime.getTime() > contentUpdated) {
              return true;
            }
          }
        }
      }
    }
  } catch {
    // Skip
  }

  return false;
}

function checkContentStaleness(rootDir: string, entry: UniversityIndexEntry, issues: UniversityValidationIssue[]): void {
  for (const sym of entry.symbols) {
    if (isContentStale(rootDir, entry, sym)) {
      issues.push({
        contentId: entry.id,
        severity: 'warning',
        check: 'stale-content',
        message: `Content may be stale: symbol "${sym}" was updated after content was last modified`,
        fix: `Review and update ${entry.id} to reflect changes to ${sym}`,
      });
      break; // One staleness warning per content item is enough
    }
  }
}
