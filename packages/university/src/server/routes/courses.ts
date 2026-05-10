/**
 * Courses API routes — v6.0 content-pack layout.
 *
 * Reads from:
 *   content/notes/N-<course>-<lesson>.md       (lesson body + frontmatter)
 *   content/quizzes/Q-<course>-<lesson>.yaml   (lesson quiz)
 *   content/paths/LP-<course>.yaml             (course outline)
 *
 * API shape is preserved so the UI continues to consume the same
 * endpoints. The old JSON layout (content/courses/*.json) was removed
 * in v6.0 after the v5.39.0 bridge — only the new pack layout is read.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ────────────────────────────────────────────────────────────────
// Types (client-facing; unchanged from v5)
// ────────────────────────────────────────────────────────────────

interface ClientQuizQuestion {
  id: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation?: string;
}

interface ClientLesson {
  id: string;
  title: string;
  content: string;
  keyConcepts?: string[];
  quiz?: ClientQuizQuestion[];
}

interface ClientCourse {
  id: string;
  title: string;
  description: string;
  lessons: ClientLesson[];
}

interface ClientCourseSummary {
  id: string;
  title: string;
  description: string;
  lessonCount: number;
  lessons: Array<{ id: string; title: string }>;
}

// ────────────────────────────────────────────────────────────────
// v6 layout readers
// ────────────────────────────────────────────────────────────────

interface PathYaml {
  id: string;
  title: string;
  description?: string;
  steps?: Array<{ content: string; required?: boolean; passRequired?: boolean }>;
}

interface NoteFrontmatter {
  id: string;
  title: string;
  type?: string;
  tags?: string[];
}

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  try {
    // Lightweight YAML parse for frontmatter (no dep — keeps the server lean).
    const fm = parseSimpleYaml(match[1]);
    return { fm, body: match[2].trim() };
  } catch {
    return null;
  }
}

/** Minimal YAML frontmatter parser — handles scalar + flow-list shapes only. */
function parseSimpleYaml(src: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value: unknown = m[2];
    const v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      value = inner.length === 0
        ? []
        : inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    } else if (v.startsWith('"') && v.endsWith('"')) {
      value = v.slice(1, -1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
      value = v.slice(1, -1);
    } else if (/^\d+$/.test(v)) {
      value = parseInt(v, 10);
    } else if (v === 'true' || v === 'false') {
      value = v === 'true';
    } else {
      value = v;
    }
    result[key] = value;
  }
  return result;
}

/** Load a YAML file as plain object. Returns null on any error. */
function safeLoadYaml<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(raw) as T;
  } catch {
    return null;
  }
}

function listLearningPaths(contentDir: string): PathYaml[] {
  const pathsDir = path.join(contentDir, 'paths');
  if (!fs.existsSync(pathsDir)) return [];
  const files = fs.readdirSync(pathsDir).filter(f => f.startsWith('LP-') && f.endsWith('.yaml'));
  const out: PathYaml[] = [];
  for (const f of files) {
    const data = safeLoadYaml<PathYaml>(path.join(pathsDir, f));
    if (data?.id) out.push(data);
  }
  return out;
}

/**
 * Collect all content directories to scan: the bundled first-party dir plus
 * any project pack directories found under projectDir/.paradigm/university/.
 * Each directory that contains a paths/ subdirectory is included.
 */
function collectContentDirs(contentDir: string, projectDir?: string): string[] {
  const dirs: string[] = [contentDir];
  if (!projectDir) return dirs;

  const universityRoot = path.join(projectDir, '.paradigm', 'university');
  if (!fs.existsSync(universityRoot)) return dirs;

  // Root project pack
  if (fs.existsSync(path.join(universityRoot, 'paths'))) {
    dirs.push(universityRoot);
  }

  // Discipline sub-packs (subdirectories with their own paths/)
  try {
    for (const entry of fs.readdirSync(universityRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(universityRoot, entry.name);
      if (fs.existsSync(path.join(subDir, 'paths'))) {
        dirs.push(subDir);
      }
    }
  } catch {
    // ignore unreadable subdirs
  }

  return dirs;
}

function readLessonsForCourse(contentDir: string, courseId: string, pathYaml: PathYaml): ClientLesson[] {
  const notesDir = path.join(contentDir, 'notes');
  const quizzesDir = path.join(contentDir, 'quizzes');

  const lessons: ClientLesson[] = [];
  const seen = new Set<string>();
  const steps = pathYaml.steps || [];

  for (const step of steps) {
    // Path steps include both note and quiz ids (we want the note for
    // the lesson skeleton; quiz is joined below).
    const sc = step.content;
    if (!sc.startsWith('N-') || seen.has(sc)) continue;
    seen.add(sc);

    // Lesson id = the part after N-<course-id>-
    const lessonId = sc.slice(`N-${courseId}-`.length);
    const notePath = path.join(notesDir, `${sc}.md`);
    if (!fs.existsSync(notePath)) continue;
    const raw = fs.readFileSync(notePath, 'utf-8');
    const parsed = parseFrontmatter(raw);
    if (!parsed) continue;
    const fm = parsed.fm as unknown as NoteFrontmatter;

    const lesson: ClientLesson = {
      id: lessonId,
      title: fm.title || lessonId,
      content: parsed.body,
      keyConcepts: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
      quiz: [],
    };

    // Attach quiz if present
    const quizPath = path.join(quizzesDir, `Q-${courseId}-${lessonId}.yaml`);
    if (fs.existsSync(quizPath)) {
      const quizData = safeLoadYaml<{ questions?: ClientQuizQuestion[] }>(quizPath);
      if (quizData?.questions) {
        lesson.quiz = quizData.questions;
      }
    }

    lessons.push(lesson);
  }

  return lessons;
}

function loadCourse(contentDir: string, courseId: string): ClientCourse | null {
  // Read path file for course: LP-<courseId>.yaml
  const pathFile = path.join(contentDir, 'paths', `LP-${courseId}.yaml`);
  if (!fs.existsSync(pathFile)) return null;

  const pathData = safeLoadYaml<PathYaml>(pathFile);
  if (!pathData?.id) return null;

  const lessons = readLessonsForCourse(contentDir, courseId, pathData);

  return {
    id: courseId,
    title: pathData.title,
    description: pathData.description || '',
    lessons,
  };
}

// ────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────

export function createCoursesRouter(contentDir: string, projectDir?: string): Router {
  const router = Router();
  const allContentDirs = collectContentDirs(contentDir, projectDir);

  // GET /api/courses - List all courses across all packs
  router.get('/', (_req: Request, res: Response) => {
    const seen = new Set<string>();
    const courses: ClientCourseSummary[] = [];

    for (const dir of allContentDirs) {
      const paths = listLearningPaths(dir);
      for (const p of paths) {
        const courseId = p.id.startsWith('LP-') ? p.id.slice(3) : p.id;
        if (seen.has(courseId)) continue; // first-party wins on id collision
        seen.add(courseId);
        const lessons = readLessonsForCourse(dir, courseId, p);
        courses.push({
          id: courseId,
          title: p.title,
          description: p.description || '',
          lessonCount: lessons.length,
          lessons: lessons.map(l => ({ id: l.id, title: l.title })),
        });
      }
    }

    courses.sort((a, b) => a.id.localeCompare(b.id));
    return res.json({ courses });
  });

  // GET /api/courses/:id - Get full course with lesson content and quizzes
  router.get('/:id', (req: Request, res: Response) => {
    for (const dir of allContentDirs) {
      const course = loadCourse(dir, req.params.id);
      if (course) return res.json(course);
    }
    return res.status(404).json({ error: `Course '${req.params.id}' not found` });
  });

  // GET /api/courses/:id/lessons/:lessonId - Get a single lesson
  router.get('/:id/lessons/:lessonId', (req: Request, res: Response) => {
    for (const dir of allContentDirs) {
      const course = loadCourse(dir, req.params.id);
      if (!course) continue;
      const lesson = course.lessons.find(l => l.id === req.params.lessonId);
      if (lesson) return res.json(lesson);
    }
    return res.status(404).json({ error: `Lesson '${req.params.lessonId}' not found` });
  });

  return router;
}
