/**
 * University Types — Per-project knowledge base
 *
 * Content types: notes, policies, quizzes, learning paths, diplomas
 * All stored in .paradigm/university/
 */

// ── Content Types ────────────────────────────────────────

export type UniversityContentType = 'note' | 'policy' | 'guide' | 'runbook';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type DiplomaType = 'plsat' | 'quiz' | 'path';

// ── Frontmatter (shared by notes and policies) ──────────

export interface UniversityFrontmatter {
  id: string;
  title: string;
  type: UniversityContentType;
  author: string;
  created: string;          // ISO date (YYYY-MM-DD)
  updated: string;          // ISO date (YYYY-MM-DD)
  tags: string[];
  symbols: string[];        // Paradigm symbols referenced
  difficulty: Difficulty;
  estimatedMinutes?: number;
  prerequisites: string[];  // IDs of prerequisite content
}

export interface UniversityNote {
  frontmatter: UniversityFrontmatter;
  body: string;             // Markdown content after frontmatter
}

// ── Quiz ─────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question: string;
  choices: Record<string, string>;  // { A: "...", B: "...", ... }
  correct: string;                  // Key into choices
  explanation?: string;
}

export interface UniversityQuiz {
  id: string;
  title: string;
  description?: string;
  author: string;
  created: string;
  updated: string;
  tags: string[];
  symbols: string[];
  difficulty: Difficulty;
  estimatedMinutes?: number;
  passThreshold: number;    // 0.0 to 1.0
  questions: QuizQuestion[];
}

// ── Learning Path ────────────────────────────────────────

export interface LearningPathStep {
  content: string;          // Content ID or "plsat:vX.X"
  required: boolean;
  passRequired?: boolean;   // For quizzes: must pass to proceed
  note?: string;
}

export interface LearningPath {
  id: string;
  title: string;
  description?: string;
  author: string;
  created: string;
  updated: string;
  tags: string[];
  ordered: boolean;
  steps: LearningPathStep[];
}

// ── Diploma ──────────────────────────────────────────────

export interface Diploma {
  id: string;
  type: DiplomaType;
  student: string;
  earnedAt: string;         // ISO 8601
  source: string;           // Quiz ID, path ID, or "plsat:vX.X"
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  details?: Record<string, unknown>;
}

// ── Index ────────────────────────────────────────────────

export interface UniversityIndexEntry {
  id: string;
  title: string;
  type: string;             // 'note' | 'policy' | 'guide' | 'runbook' | 'quiz' | 'path'
  author: string;
  created: string;
  updated: string;
  tags: string[];
  symbols: string[];
  difficulty?: Difficulty;
  file: string;             // Relative path from university dir
}

export interface UniversityIndex {
  version: string;
  generatedAt: string;
  totalContent: number;
  entries: UniversityIndexEntry[];
  diplomaCount: number;
}

// ── Filter ───────────────────────────────────────────────

export interface UniversityFilter {
  type?: string;
  tag?: string;
  difficulty?: Difficulty;
  symbol?: string;
  author?: string;
  query?: string;           // Free-text search in title/description
  limit?: number;
}

// ── Config ───────────────────────────────────────────────

export interface UniversityBranding {
  name: string;
  tagline?: string;
  logo?: string;
  institution?: string;
  favicon?: string;
}

export interface UniversityTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  success: string;
  error: string;
  font: string;
}

export interface UniversityContentCategory {
  id: string;
  label: string;
  icon?: string;
  description?: string;
}

export interface UniversityConfig {
  branding: UniversityBranding;
  theme: UniversityTheme;
  content: {
    categories: UniversityContentCategory[];
    defaultDifficulty: Difficulty;
    requireApproval: boolean;
  };
  diplomas: {
    includeGlobalPLSAT: boolean;
    customCertStyle?: string | null;
  };
}

// ── Validation ───────────────────────────────────────────

export interface UniversityValidationIssue {
  contentId: string;
  severity: 'error' | 'warning';
  check: string;
  message: string;
  fix?: string;
}

export interface UniversityValidationResult {
  status: 'healthy' | 'warnings' | 'errors';
  totalContent: number;
  checked: number;
  issues: UniversityValidationIssue[];
  symbolCoverage: {
    totalSymbols: number;
    coveredByContent: number;
    percentage: number;
  };
}
