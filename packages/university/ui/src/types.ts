/** Quiz question with ABCDE choices */
export interface Question {
  id: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
}

/** A single lesson within a course */
export interface Lesson {
  id: string;
  title: string;
  content: string;
  keyConcepts: string[];
  quiz: Question[];
}

/** Course summary (from list endpoint) */
export interface CourseSummary {
  id: string;
  title: string;
  description: string;
  lessonCount: number;
  lessons: { id: string; title: string }[];
  section: string;
}

/** Full course with lesson content */
export interface Course {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
}

/** PLSAT exam question (includes scenario) */
export interface PLSATQuestion {
  id: string;
  course: string;
  scenario: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
  passageId?: string;
}

/** PLSAT exam version summary */
export interface PLSATVersion {
  version: string;
  frameworkVersion: string;
  questionCount: number;
  timeLimit: number;
  passThreshold: number;
}

/** Full PLSAT exam */
export interface PLSATExam {
  version: string;
  frameworkVersion: string;
  timeLimit: number;
  passThreshold: number;
  title: string;
  description: string;
  questions: PLSATQuestion[];
  passages?: Record<string, string>;
}

/** PLSAT certificate stored in LocalStorage */
export interface Certificate {
  name: string;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  plsatVersion: string;
  frameworkVersion: string;
  date: string;
}

/** Quiz result for a lesson */
export interface QuizResult {
  courseId: string;
  lessonId: string;
  score: number;
  total: number;
  answers: Record<string, string>;
  date: string;
}

/** Per-course progress */
export interface CourseProgress {
  courseId: string;
  completedLessons: string[];
  quizResults: Record<string, QuizResult>;
}

/** Reference card */
export interface ReferenceCard {
  id: string;
  symbol?: string;
  name: string;
  description: string;
  examples?: string[];
  logger?: string;
  when?: string;
  command?: string;
  flags?: string[];
  input?: string;
  steps?: string[];
}

/** Reference section */
export interface ReferenceSection {
  id: string;
  title: string;
  cards: ReferenceCard[];
}

/** Full reference data */
export interface ReferenceData {
  sections: ReferenceSection[];
}

/** Branding config returned by /api/pack-config */
export interface PackConfigBranding {
  name: string;
  tagline: string;
  logo: string | null;
  institution: string | null;
  favicon: string | null;
  tabs: Array<'campus' | 'courses' | 'plsat' | 'library' | 'certificates'>;
  startCourse: string | null;
}

/** v6.5 University Section style */
export type SectionStyle = 'track' | 'index' | 'chronological' | 'featured';

/** v6.5 University Section (groups courses within a pack) */
export interface Section {
  id: string;
  name: string;
  order: number;
  style: SectionStyle;
  description?: string;
  default?: boolean;
}

/** Response shape for /api/pack-config */
export interface PackConfigResponse {
  mode: 'paradigm' | 'project';
  branding: PackConfigBranding;
  theme: Record<string, string> | null;
  version: string;
  hasProjectLibrary: boolean;
  sections: Section[];
}
