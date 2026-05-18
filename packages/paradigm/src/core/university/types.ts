/**
 * University Types — Per-project knowledge base (CLI-side)
 */

export type UniversityContentType = 'note' | 'policy' | 'guide' | 'runbook';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type DiplomaType = 'plsat' | 'quiz' | 'path';

export interface UniversityFrontmatter {
  id: string;
  title: string;
  type: UniversityContentType;
  author: string;
  created: string;
  updated: string;
  tags: string[];
  symbols: string[];
  difficulty: Difficulty;
  estimatedMinutes?: number;
  prerequisites: string[];
  // v6.5 sections
  section?: string;
  order?: number;
}

export interface UniversityNote {
  frontmatter: UniversityFrontmatter;
  body: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
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
  passThreshold: number;
  questions: QuizQuestion[];
  // v6.5 sections (top-level; distinct from QuizQuestion.section PLSAT slot)
  section?: string;
  order?: number;
}

export interface LearningPathStep {
  content: string;
  required: boolean;
  passRequired?: boolean;
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
  // v6.5 sections
  section?: string;
  order?: number;
}

export interface Diploma {
  id: string;
  type: DiplomaType;
  student: string;
  earnedAt: string;
  source: string;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  details?: Record<string, unknown>;
}

export interface UniversityIndexEntry {
  id: string;
  title: string;
  type: string;
  author: string;
  created: string;
  updated: string;
  tags: string[];
  symbols: string[];
  difficulty?: Difficulty;
  file: string;
  // v6.5 sections
  section?: string;
  order?: number;
}

export interface UniversityIndex {
  version: string;
  generatedAt: string;
  totalContent: number;
  entries: UniversityIndexEntry[];
  diplomaCount: number;
}

export interface UniversityFilter {
  type?: string;
  tag?: string;
  difficulty?: Difficulty;
  symbol?: string;
  query?: string;
  /** v6.5: filter entries to a single section id. */
  section?: string;
  limit?: number;
}
