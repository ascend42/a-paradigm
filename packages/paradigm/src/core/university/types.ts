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
  limit?: number;
}
