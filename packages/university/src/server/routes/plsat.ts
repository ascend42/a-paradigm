/**
 * PLSAT (Paradigm Licensure Standardized Assessment Test) API routes — v6.0.
 *
 * Reads from the v6 pack layout:
 *   content/quizzes/Q-plsat-v2.yaml
 *   content/quizzes/Q-plsat-v3.yaml
 *
 * API response shape is preserved: the client still receives questions +
 * optional passages, shuffled on each request. Old JSON files in
 * content/plsat/ are no longer read here (but remain on disk for the
 * bridge release).
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface PackQuizVariant {
  id: string;
  scenario: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
}

interface PackQuizQuestion {
  id: string;
  scenario?: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation?: string;
  slot?: string;
  section?: string;
  passageId?: string;
  passage?: string;
  variants?: PackQuizVariant[];
}

interface PackQuizYaml {
  id: string;
  title: string;
  description?: string;
  passThreshold: number;
  timeLimit: number;
  totalSlots?: number;
  exam?: { kind: string };
  questions: PackQuizQuestion[];
}

interface ClientQuestion {
  id: string;
  course: string;
  scenario: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
  passageId?: string;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function safeLoadYaml<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(raw) as T;
  } catch {
    return null;
  }
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick a variant: the canonical question itself + any remaining variants. */
function pickVariant(q: PackQuizQuestion): PackQuizQuestion | PackQuizVariant {
  if (!q.variants || q.variants.length === 0) return q;
  const all = [
    {
      id: q.id,
      scenario: q.scenario ?? '',
      question: q.question,
      choices: q.choices,
      correct: q.correct,
      explanation: q.explanation ?? '',
    },
    ...q.variants,
  ];
  return all[Math.floor(Math.random() * all.length)];
}

function countQuestions(quiz: PackQuizYaml): number {
  return quiz.questions.length;
}

function resolvePackLayout(quiz: PackQuizYaml): {
  questions: ClientQuestion[];
  passages: Record<string, string>;
} {
  const passages: Record<string, string> = {};

  // Group questions into blocks so passage questions stay together.
  const blocks: ClientQuestion[][] = [];
  const passageBlocks: Map<string, ClientQuestion[]> = new Map();

  for (const q of quiz.questions) {
    const variant = pickVariant(q);
    const client: ClientQuestion = {
      id: variant.id,
      course: q.section ?? '',
      scenario: (variant as PackQuizVariant).scenario ?? q.scenario ?? '',
      question: variant.question,
      choices: variant.choices,
      correct: variant.correct,
      explanation: (variant as PackQuizVariant).explanation ?? q.explanation ?? '',
      ...(q.passageId ? { passageId: q.passageId } : {}),
    };

    if (q.passageId) {
      if (q.passage) passages[q.passageId] = q.passage;
      if (!passageBlocks.has(q.passageId)) passageBlocks.set(q.passageId, []);
      passageBlocks.get(q.passageId)!.push(client);
    } else {
      blocks.push([client]);
    }
  }

  // Append passage blocks as a whole so they stay together
  for (const block of passageBlocks.values()) {
    blocks.push(block);
  }

  fisherYatesShuffle(blocks);

  return { questions: blocks.flat(), passages };
}

// ────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────

export function createPlsatRouter(contentDir: string, projectDir?: string): Router {
  const router = Router();

  const quizzesDir = path.join(contentDir, 'quizzes');

  // GET /api/plsat - Get available PLSAT versions
  router.get('/', (_req: Request, res: Response) => {
    if (!fs.existsSync(quizzesDir)) {
      return res.json({ versions: [] });
    }

    const files = fs.readdirSync(quizzesDir)
      .filter(f => f.startsWith('Q-plsat-v') && f.endsWith('.yaml'));

    const versions = files.map(f => {
      const data = safeLoadYaml<PackQuizYaml>(path.join(quizzesDir, f));
      if (!data) return null;
      const versionMatch = f.match(/^Q-plsat-v(\d+)\.yaml$/);
      const version = versionMatch ? `${versionMatch[1]}.0` : '0.0';
      return {
        version,
        frameworkVersion: '2.0',
        questionCount: countQuestions(data),
        timeLimit: data.timeLimit,
        passThreshold: data.passThreshold,
      };
    }).filter((v): v is NonNullable<typeof v> => v !== null);

    versions.sort((a, b) => b.version.localeCompare(a.version));
    return res.json({ versions });
  });

  // GET /api/plsat/:version - Get full exam for a specific version
  router.get('/:version', (req: Request, res: Response) => {
    try {
      const versionNum = req.params.version.split('.')[0];
      const examFile = path.join(quizzesDir, `Q-plsat-v${versionNum}.yaml`);
      if (!fs.existsSync(examFile)) {
        return res.status(404).json({ error: `PLSAT version '${req.params.version}' not found` });
      }

      const data = safeLoadYaml<PackQuizYaml>(examFile);
      if (!data) {
        return res.status(500).json({ error: 'Failed to parse PLSAT exam' });
      }

      const { questions, passages } = resolvePackLayout(data);
      return res.json({
        version: req.params.version,
        frameworkVersion: '2.0',
        timeLimit: data.timeLimit,
        passThreshold: data.passThreshold,
        title: data.title,
        description: data.description ?? '',
        questions,
        ...(Object.keys(passages).length > 0 ? { passages } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: `Failed to load PLSAT exam: ${msg}` });
    }
  });

  // POST /api/plsat/diploma - Save a PLSAT diploma to the project university
  router.post('/diploma', (req: Request, res: Response) => {
    if (!projectDir) {
      return res.status(400).json({ error: 'No project directory configured' });
    }

    const diplomaDir = path.join(projectDir, '.paradigm', 'university', 'diplomas');
    if (!fs.existsSync(diplomaDir)) {
      // University not set up — silently succeed
      return res.json({ saved: false, reason: 'university directory not found' });
    }

    try {
      const { student, version, score, total, percentage, passed } = req.body;
      if (!student || !version || score == null || total == null) {
        return res.status(400).json({ error: 'Missing required fields: student, version, score, total' });
      }

      const today = new Date().toISOString().slice(0, 10);
      const sanitizedStudent = String(student).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20);
      const id = `D-${today}-${sanitizedStudent}-plsat-v${version}`;

      const diploma = {
        id,
        type: 'plsat',
        student: sanitizedStudent,
        earnedAt: new Date().toISOString(),
        source: `plsat:v${version}`,
        score,
        total,
        percentage: percentage ?? (total > 0 ? Math.round((score / total) * 10000) / 100 : 0),
        passed: passed ?? false,
        details: { plsatVersion: version },
      };

      const filePath = path.join(diplomaDir, `${id}.yaml`);
      const yamlLines = Object.entries(diploma).map(([k, v]) => {
        if (typeof v === 'object' && v !== null) {
          const nested = Object.entries(v).map(([nk, nv]) => `  ${nk}: ${JSON.stringify(nv)}`).join('\n');
          return `${k}:\n${nested}`;
        }
        return `${k}: ${JSON.stringify(v)}`;
      });
      fs.writeFileSync(filePath, yamlLines.join('\n') + '\n', 'utf8');

      return res.json({ saved: true, diplomaId: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: `Failed to save diploma: ${msg}` });
    }
  });

  return router;
}
