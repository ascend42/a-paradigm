/**
 * Courses API routes
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export function createCoursesRouter(contentDir: string): Router {
  const router = Router();

  // GET /api/courses - List all courses (without full lesson content)
  router.get('/', (_req: Request, res: Response) => {
    const coursesDir = path.join(contentDir, 'courses');
    if (!fs.existsSync(coursesDir)) {
      return res.json({ courses: [] });
    }

    const files = fs.readdirSync(coursesDir).filter(f => f.endsWith('.json'));
    const courses = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(coursesDir, f), 'utf-8'));
      return {
        id: data.id,
        title: data.title,
        description: data.description,
        lessonCount: data.lessons?.length || 0,
        lessons: (data.lessons || []).map((l: { id: string; title: string }) => ({
          id: l.id,
          title: l.title,
        })),
      };
    });

    // Sort by course ID (para-101, para-201, etc.)
    courses.sort((a, b) => a.id.localeCompare(b.id));
    return res.json({ courses });
  });

  // GET /api/courses/:id - Get full course with lesson content and quizzes
  router.get('/:id', (req: Request, res: Response) => {
    const courseFile = path.join(contentDir, 'courses', `${req.params.id}.json`);
    if (!fs.existsSync(courseFile)) {
      return res.status(404).json({ error: `Course '${req.params.id}' not found` });
    }

    const data = JSON.parse(fs.readFileSync(courseFile, 'utf-8'));
    return res.json(data);
  });

  // GET /api/courses/:id/lessons/:lessonId - Get a single lesson
  router.get('/:id/lessons/:lessonId', (req: Request, res: Response) => {
    const courseFile = path.join(contentDir, 'courses', `${req.params.id}.json`);
    if (!fs.existsSync(courseFile)) {
      return res.status(404).json({ error: `Course '${req.params.id}' not found` });
    }

    const data = JSON.parse(fs.readFileSync(courseFile, 'utf-8'));
    const lesson = (data.lessons || []).find((l: { id: string }) => l.id === req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ error: `Lesson '${req.params.lessonId}' not found` });
    }

    return res.json(lesson);
  });

  return router;
}
