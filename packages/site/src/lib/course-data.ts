/**
 * Course Data Layer — reads university course JSON at build time.
 *
 * Courses live in two places:
 * - Core PARA courses: packages/university/src/content/courses/
 * - Extracurricular: packages/site/src/content/courses/
 *
 * Both formats are normalized into a shared Course/Lesson shape.
 */

import * as fs from 'fs';
import * as path from 'path';

/* ── Paths ──────────────────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const PARA_COURSES_DIR = path.join(REPO_ROOT, 'packages', 'university', 'src', 'content', 'courses');
const EXTRA_COURSES_DIR = path.join(process.cwd(), 'src', 'content', 'courses');

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface QuizQuestion {
  id: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation?: string;
}

export interface Lesson {
  id: string;
  title: string;
  content: string;
  keyConcepts?: string[];
  quiz?: QuizQuestion[];
}

export interface CourseManifest {
  id: string;
  title: string;
  description: string;
  lessons: { id: string; title: string }[];
  category?: string;
  nonCredit?: boolean;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  category?: string;
  nonCredit?: boolean;
}

/* ── Raw JSON shapes (before normalization) ─────────────────────────────── */

interface RawParaQuiz {
  id?: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation?: string;
}

interface RawExtraOption {
  label: string;
  text: string;
}

interface RawExtraQuiz {
  question: string;
  options: RawExtraOption[];
  answer: string;
  explanation?: string;
}

interface RawLesson {
  id: string;
  title: string;
  content: string;
  keyConcepts?: string[];
  quiz?: Array<RawParaQuiz | RawExtraQuiz>;
}

interface RawCourse {
  id: string;
  title: string;
  description: string;
  nonCredit?: boolean;
  lessons: RawLesson[];
}

/* ── Normalization ──────────────────────────────────────────────────────── */

function isExtraQuiz(q: RawParaQuiz | RawExtraQuiz): q is RawExtraQuiz {
  return 'options' in q && Array.isArray((q as RawExtraQuiz).options);
}

function normalizeQuiz(q: RawParaQuiz | RawExtraQuiz, index: number): QuizQuestion {
  if (isExtraQuiz(q)) {
    const choices: Record<string, string> = {};
    for (const opt of q.options) {
      choices[opt.label] = opt.text;
    }
    return {
      id: `q${index + 1}`,
      question: q.question,
      choices,
      correct: q.answer,
      explanation: q.explanation,
    };
  }

  return {
    id: q.id || `q${index + 1}`,
    question: q.question,
    choices: q.choices,
    correct: q.correct,
    explanation: q.explanation,
  };
}

function normalizeLesson(raw: RawLesson): Lesson {
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content,
    keyConcepts: raw.keyConcepts,
    quiz: raw.quiz?.map((q, i) => normalizeQuiz(q, i)),
  };
}

function normalizeCourse(raw: RawCourse, category?: string): Course {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    lessons: raw.lessons.map(normalizeLesson),
    category,
    nonCredit: raw.nonCredit,
  };
}

/* ── Loading ────────────────────────────────────────────────────────────── */

let courseCache: Map<string, Course> | null = null;

function loadAllCourses(): Map<string, Course> {
  if (courseCache) return courseCache;

  const courses = new Map<string, Course>();

  // Load PARA courses
  try {
    const files = fs.readdirSync(PARA_COURSES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw: RawCourse = JSON.parse(fs.readFileSync(path.join(PARA_COURSES_DIR, file), 'utf-8'));
      courses.set(raw.id, normalizeCourse(raw, 'core'));
    }
  } catch {
    // Directory not found — skip
  }

  // Load extracurricular courses
  try {
    const files = fs.readdirSync(EXTRA_COURSES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw: RawCourse = JSON.parse(fs.readFileSync(path.join(EXTRA_COURSES_DIR, file), 'utf-8'));
      courses.set(raw.id, normalizeCourse(raw, 'extracurricular'));
    }
  } catch {
    // Directory not found — skip
  }

  courseCache = courses;
  return courses;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Get all course IDs. */
export function getAllCourseIds(): string[] {
  const courses = loadAllCourses();
  return Array.from(courses.keys());
}

/** Get a course manifest (metadata + lesson list, without full content). */
export function getCourseManifest(courseId: string): CourseManifest | null {
  const courses = loadAllCourses();
  const course = courses.get(courseId);
  if (!course) return null;

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    lessons: course.lessons.map(l => ({ id: l.id, title: l.title })),
    category: course.category,
    nonCredit: course.nonCredit,
  };
}

/** Get all course manifests. */
export function getAllCourseManifests(): CourseManifest[] {
  const courses = loadAllCourses();
  return Array.from(courses.values()).map(course => ({
    id: course.id,
    title: course.title,
    description: course.description,
    lessons: course.lessons.map(l => ({ id: l.id, title: l.title })),
    category: course.category,
    nonCredit: course.nonCredit,
  }));
}

/** Get a specific lesson with its course context. */
export function getLesson(
  courseId: string,
  lessonId: string
): { course: CourseManifest; lesson: Lesson; lessonIndex: number } | null {
  const courses = loadAllCourses();
  const course = courses.get(courseId);
  if (!course) return null;

  const lessonIndex = course.lessons.findIndex(l => l.id === lessonId);
  if (lessonIndex === -1) return null;

  const manifest: CourseManifest = {
    id: course.id,
    title: course.title,
    description: course.description,
    lessons: course.lessons.map(l => ({ id: l.id, title: l.title })),
    category: course.category,
    nonCredit: course.nonCredit,
  };

  return { course: manifest, lesson: course.lessons[lessonIndex], lessonIndex };
}

/** Get all lesson params for generateStaticParams. */
export function getAllLessonParams(): { courseId: string; lessonId: string }[] {
  const courses = loadAllCourses();
  const params: { courseId: string; lessonId: string }[] = [];

  for (const course of courses.values()) {
    for (const lesson of course.lessons) {
      params.push({ courseId: course.id, lessonId: lesson.id });
    }
  }

  return params;
}
