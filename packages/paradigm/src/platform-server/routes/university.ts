/**
 * University Platform Routes — REST API for the Platform UI university section
 *
 * Serves course listings, course details, PLSAT exam versions, diplomas,
 * and reference content from the bundled university-content directory.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export function createUniversityRouter(projectDir: string): Router {
  const router = Router();

  // Resolve content directory — bundled at dist/university-content/
  const contentDir = path.join(__dirname, '..', '..', 'university-content');

  // GET /api/university/courses — List all courses (metadata only)
  router.get('/courses', (_req: Request, res: Response) => {
    try {
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
          quizCount: data.quizzes?.length || 0,
          lessons: (data.lessons || []).map((l: { id: string; title: string }) => ({
            id: l.id,
            title: l.title,
          })),
        };
      });

      courses.sort((a, b) => a.id.localeCompare(b.id));
      return res.json({ courses });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list courses', detail: String(err) });
    }
  });

  // GET /api/university/courses/:id — Full course with lessons + quizzes
  router.get('/courses/:id', (req: Request, res: Response) => {
    try {
      const courseFile = path.join(contentDir, 'courses', `${req.params.id}.json`);
      if (!fs.existsSync(courseFile)) {
        return res.status(404).json({ error: `Course '${req.params.id}' not found` });
      }
      const data = JSON.parse(fs.readFileSync(courseFile, 'utf-8'));
      return res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load course', detail: String(err) });
    }
  });

  // GET /api/university/plsat — Available PLSAT versions
  router.get('/plsat', (_req: Request, res: Response) => {
    try {
      const plsatDir = path.join(contentDir, 'plsat');
      if (!fs.existsSync(plsatDir)) {
        return res.json({ versions: [] });
      }

      const files = fs.readdirSync(plsatDir).filter(f => f.endsWith('.json'));
      const versions = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(plsatDir, f), 'utf-8'));
        return {
          version: data.version || f.replace('.json', ''),
          frameworkVersion: data.frameworkVersion,
          questionCount: data.questions?.length || 0,
          timeLimit: data.timeLimit,
          passThreshold: data.passThreshold,
        };
      });

      return res.json({ versions });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list PLSAT versions', detail: String(err) });
    }
  });

  // GET /api/university/diplomas — Earned diplomas for this project
  router.get('/diplomas', (_req: Request, res: Response) => {
    try {
      const diplomasDir = path.join(projectDir, '.paradigm', 'university', 'diplomas');
      if (!fs.existsSync(diplomasDir)) {
        return res.json({ diplomas: [] });
      }

      const files = fs.readdirSync(diplomasDir).filter(f => f.endsWith('.json') || f.endsWith('.yaml'));
      const diplomas = files.map(f => {
        const raw = fs.readFileSync(path.join(diplomasDir, f), 'utf-8');
        return f.endsWith('.json') ? JSON.parse(raw) : raw;
      }).filter(Boolean);

      return res.json({ diplomas });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load diplomas', detail: String(err) });
    }
  });

  // GET /api/university/reference — Reference content
  router.get('/reference', (_req: Request, res: Response) => {
    try {
      const refFile = path.join(contentDir, 'reference.json');
      if (!fs.existsSync(refFile)) {
        return res.json({});
      }
      const data = JSON.parse(fs.readFileSync(refFile, 'utf-8'));
      return res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load reference', detail: String(err) });
    }
  });

  return router;
}
