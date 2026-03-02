/**
 * PLSAT (Paradigm Licensure Standardized Assessment Test) API routes
 *
 * Supports v2.0 (flat questions) and v3.0 (items with variants + passages).
 * The server resolves variants and flattens passage groups so the client
 * always receives the same PLSATQuestion[] shape.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

// --- v3.0 source types (JSON shape) ---

interface V3Variant {
  id: string;
  scenario: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
}

interface V3StandaloneItem {
  type: 'standalone';
  slot: string;
  course: string;
  variants: V3Variant[];
}

interface V3PassageQuestion {
  slot: string;
  variants: V3Variant[];
}

interface V3PassageItem {
  type: 'passage';
  slot: string;
  course: string;
  passage: string;
  questions: V3PassageQuestion[];
}

interface V3VariantGroupItem {
  type: 'variant-group';
  slot: string;
  course: string;
  variants: V3Variant[];
}

type V3Item = V3StandaloneItem | V3PassageItem | V3VariantGroupItem;

interface V3Exam {
  version: string;
  frameworkVersion: string;
  timeLimit: number;
  passThreshold: number;
  title: string;
  description: string;
  items: V3Item[];
}

// --- client-facing types ---

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

// --- helpers ---

/** Pick a random variant from a variant array */
function pickVariant(variants: V3Variant[]): V3Variant {
  return variants[Math.floor(Math.random() * variants.length)];
}

/** Fisher-Yates shuffle (in-place, returns same array) */
function fisherYatesShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Resolve variants and flatten v3.0 items into the client question list.
 * Passage groups stay together but group order is shuffled.
 * Returns { questions, passages }.
 */
function resolveV3(data: V3Exam): { questions: ClientQuestion[]; passages: Record<string, string> } {
  const passages: Record<string, string> = {};

  // Build "blocks" – each block is either a single standalone question
  // or a group of passage questions that must stay together.
  const blocks: ClientQuestion[][] = [];

  for (const item of data.items) {
    if (item.type === 'standalone' || item.type === 'variant-group') {
      const v = pickVariant(item.variants);
      blocks.push([{
        id: v.id,
        course: item.course,
        scenario: v.scenario,
        question: v.question,
        choices: v.choices,
        correct: v.correct,
        explanation: v.explanation,
      }]);
    } else {
      // passage group
      passages[item.slot] = item.passage;
      const group: ClientQuestion[] = item.questions.map((pq) => {
        const v = pickVariant(pq.variants);
        return {
          id: v.id,
          course: item.course,
          scenario: v.scenario,
          question: v.question,
          choices: v.choices,
          correct: v.correct,
          explanation: v.explanation,
          passageId: item.slot,
        };
      });
      blocks.push(group);
    }
  }

  // Shuffle blocks (passage groups move as a unit)
  fisherYatesShuffle(blocks);

  return { questions: blocks.flat(), passages };
}

/** Count total questions in a v3.0 exam (one per slot, picking first variant) */
function countV3Questions(data: V3Exam): number {
  let count = 0;
  for (const item of data.items) {
    if (item.type === 'standalone' || item.type === 'variant-group') {
      count += 1;
    } else {
      count += item.questions.length;
    }
  }
  return count;
}

export function createPlsatRouter(contentDir: string): Router {
  const router = Router();

  // GET /api/plsat - Get available PLSAT versions
  router.get('/', (_req: Request, res: Response) => {
    const plsatDir = path.join(contentDir, 'plsat');
    if (!fs.existsSync(plsatDir)) {
      return res.json({ versions: [] });
    }

    const files = fs.readdirSync(plsatDir).filter(f => f.endsWith('.json'));
    const versions = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(plsatDir, f), 'utf-8'));

      // v3.0+ uses items[], legacy uses questions[]
      const questionCount = data.items
        ? countV3Questions(data)
        : (data.questions?.length || 0);

      return {
        version: data.version,
        frameworkVersion: data.frameworkVersion,
        questionCount,
        timeLimit: data.timeLimit,
        passThreshold: data.passThreshold,
      };
    });

    versions.sort((a, b) => b.version.localeCompare(a.version));
    return res.json({ versions });
  });

  // GET /api/plsat/:version - Get full exam for a specific version
  router.get('/:version', (req: Request, res: Response) => {
    try {
      const examFile = path.join(contentDir, 'plsat', `v${req.params.version}.json`);
      if (!fs.existsSync(examFile)) {
        return res.status(404).json({ error: `PLSAT version '${req.params.version}' not found` });
      }

      const data = JSON.parse(fs.readFileSync(examFile, 'utf-8'));

      // v3.0+ path: resolve variants + flatten passages
      if (data.items) {
        const { questions, passages } = resolveV3(data as V3Exam);
        return res.json({
          version: data.version,
          frameworkVersion: data.frameworkVersion,
          timeLimit: data.timeLimit,
          passThreshold: data.passThreshold,
          title: data.title,
          description: data.description,
          questions,
          ...(Object.keys(passages).length > 0 ? { passages } : {}),
        });
      }

      // Legacy v2.0 path: shuffle questions
      const shuffled = [...data.questions].sort(() => Math.random() - 0.5);
      return res.json({
        ...data,
        questions: shuffled,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: `Failed to load PLSAT exam: ${msg}` });
    }
  });

  return router;
}
