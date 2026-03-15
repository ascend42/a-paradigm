/**
 * University MCP Tools - Per-project knowledge base
 *
 * Tools:
 * - paradigm_university_search: Search content by type/tag/difficulty/symbol
 * - paradigm_university_get: Fetch content item by ID (full body)
 * - paradigm_university_create: Create note/policy/quiz/path
 * - paradigm_university_update: Update existing content
 * - paradigm_university_quiz: Get quiz for taking (no answers)
 * - paradigm_university_submit: Submit quiz answers, grade, save diploma
 * - paradigm_university_onboard: Get recommended onboarding sequence
 * - paradigm_university_diplomas: List earned diplomas
 * - paradigm_university_validate: Validate content integrity
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  searchContent,
  loadNote,
  loadQuiz,
  loadPath,
  loadDiplomas,
  saveNote,
  saveQuiz,
  savePath,
  saveDiploma,
  rebuildUniversityIndex,
  validateUniversityContent,
  getOnboardingSequence,
  loadUniversityConfig,
} from '../utils/university-loader.js';
import type {
  UniversityFrontmatter,
  UniversityQuiz,
  LearningPath,
  Diploma,
  Difficulty,
} from '../types/university.js';
import { trackToolCall } from './context.js';
import { execSync } from 'child_process';
import * as os from 'os';

/** Resolve author for MCP-created content */
function resolveAuthor(): string {
  const envAuthor = process.env.PARADIGM_AUTHOR;
  if (envAuthor) return sanitize(envAuthor);

  try {
    const gitName = execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (gitName) return sanitize(gitName);
  } catch {}

  try {
    const username = os.userInfo().username;
    if (username) return sanitize(username);
  } catch {}

  return 'unknown';
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'unknown';
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get list of university tools with safety annotations
 */
export function getUniversityToolsList() {
  return [
    {
      name: 'paradigm_university_search',
      description: 'Search project university content by type, tag, difficulty, or symbol. Returns matching content items. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['note', 'policy', 'guide', 'runbook', 'quiz', 'path'],
            description: 'Filter by content type',
          },
          tag: {
            type: 'string',
            description: 'Filter by tag prefix',
          },
          difficulty: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced'],
            description: 'Filter by difficulty level',
          },
          symbol: {
            type: 'string',
            description: 'Filter by Paradigm symbol (e.g., "#api-gateway")',
          },
          query: {
            type: 'string',
            description: 'Free-text search in title and tags',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 20)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_get',
      description: 'Fetch a university content item by ID. Returns full content including body for notes/policies and questions for quizzes. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID (e.g., "N-architecture-overview", "Q-onboarding-basics", "LP-new-engineer")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_create',
      description: 'Create a new university content item (note, policy, quiz, or learning path). Auto-generates timestamps and resolves author. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['note', 'policy', 'guide', 'runbook', 'quiz', 'path'],
            description: 'Content type to create',
          },
          title: {
            type: 'string',
            description: 'Content title',
          },
          body: {
            type: 'string',
            description: 'Markdown body for notes/policies. Quiz/path YAML content for those types.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for classification',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paradigm symbols referenced by this content',
          },
          difficulty: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced'],
            description: 'Difficulty level (default: beginner)',
          },
          estimatedMinutes: {
            type: 'number',
            description: 'Estimated reading/completion time in minutes',
          },
          prerequisites: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of prerequisite content items',
          },
          // Quiz-specific fields
          passThreshold: {
            type: 'number',
            description: 'For quizzes: pass threshold 0.0-1.0 (default: 0.7)',
          },
          questions: {
            type: 'array',
            description: 'For quizzes: array of {id, question, choices: {A:..., B:...}, correct, explanation?}',
          },
          // Path-specific fields
          ordered: {
            type: 'boolean',
            description: 'For learning paths: whether steps must be completed in order',
          },
          steps: {
            type: 'array',
            description: 'For learning paths: array of {content, required, passRequired?, note?}',
          },
        },
        required: ['type', 'title'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_update',
      description: 'Update an existing university content item. Specify only the fields to change. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID to update',
          },
          title: { type: 'string', description: 'New title' },
          body: { type: 'string', description: 'New body content' },
          tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'New symbols' },
          difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
          estimatedMinutes: { type: 'number' },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_quiz',
      description: 'Get a quiz for taking — returns questions WITHOUT answers. Use paradigm_university_submit to submit answers. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Quiz ID (e.g., "Q-onboarding-basics")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_submit',
      description: 'Submit quiz answers for grading. Returns score and saves diploma if passed. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          quizId: {
            type: 'string',
            description: 'Quiz ID',
          },
          answers: {
            type: 'object',
            description: 'Map of question ID to answer key (e.g., {"q1": "B", "q2": "A"})',
          },
          student: {
            type: 'string',
            description: 'Student name (auto-resolved if omitted)',
          },
        },
        required: ['quizId', 'answers'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_onboard',
      description: 'Get recommended onboarding sequence for the project university. Shows learning paths, suggested content, and completion status. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          student: {
            type: 'string',
            description: 'Student name to check completion (auto-resolved if omitted)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_diplomas',
      description: 'List earned diplomas (PLSAT, quiz completions, path completions). ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          student: {
            type: 'string',
            description: 'Filter by student name',
          },
          type: {
            type: 'string',
            enum: ['plsat', 'quiz', 'path'],
            description: 'Filter by diploma type',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_university_validate',
      description: 'Validate university content integrity: schema, symbol refs, prerequisites, quiz structure. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID to validate (validates all if omitted)',
          },
          deep: {
            type: 'boolean',
            description: 'Enable deep cross-reference checks against scan-index (default: false)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle university tool calls
 */
export async function handleUniversityTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {

  // ── Search ─────────────────────────────────────────────
  if (name === 'paradigm_university_search') {
    const results = searchContent(ctx.rootDir, {
      type: args.type as string | undefined,
      tag: args.tag as string | undefined,
      difficulty: args.difficulty as Difficulty | undefined,
      symbol: args.symbol as string | undefined,
      query: args.query as string | undefined,
      limit: args.limit as number | undefined,
    });

    const text = JSON.stringify({
      count: results.length,
      results: results.map(r => ({
        id: r.id,
        title: r.title,
        type: r.type,
        difficulty: r.difficulty,
        tags: r.tags,
        symbols: r.symbols,
      })),
    }, null, 2);

    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Get ────────────────────────────────────────────────
  if (name === 'paradigm_university_get') {
    const id = args.id as string;
    if (!id) return { handled: true, text: JSON.stringify({ error: 'id is required' }) };

    // Try note/policy first
    const note = loadNote(ctx.rootDir, id);
    if (note) {
      const text = JSON.stringify({
        id: note.frontmatter.id,
        title: note.frontmatter.title,
        type: note.frontmatter.type,
        author: note.frontmatter.author,
        created: note.frontmatter.created,
        updated: note.frontmatter.updated,
        tags: note.frontmatter.tags,
        symbols: note.frontmatter.symbols,
        difficulty: note.frontmatter.difficulty,
        prerequisites: note.frontmatter.prerequisites,
        body: note.body,
      }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try quiz
    const quiz = loadQuiz(ctx.rootDir, id);
    if (quiz) {
      const text = JSON.stringify(quiz, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try path
    const lp = loadPath(ctx.rootDir, id);
    if (lp) {
      const text = JSON.stringify(lp, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    const text = JSON.stringify({ error: `Content "${id}" not found` });
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Create ─────────────────────────────────────────────
  if (name === 'paradigm_university_create') {
    const contentType = args.type as string;
    const title = args.title as string;

    if (!contentType || !title) {
      return { handled: true, text: JSON.stringify({ error: 'type and title are required' }) };
    }

    const author = resolveAuthor();
    const today = todayStr();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

    if (contentType === 'quiz') {
      const id = `Q-${slug}`;
      const quiz: UniversityQuiz = {
        id,
        title,
        description: args.body as string || '',
        author,
        created: today,
        updated: today,
        tags: (args.tags as string[]) || [],
        symbols: (args.symbols as string[]) || [],
        difficulty: (args.difficulty as Difficulty) || 'beginner',
        estimatedMinutes: args.estimatedMinutes as number | undefined,
        passThreshold: (args.passThreshold as number) ?? 0.7,
        questions: (args.questions as UniversityQuiz['questions']) || [],
      };

      saveQuiz(ctx.rootDir, quiz);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ created: id, type: 'quiz', file: `content/quizzes/${id}.yaml` }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    if (contentType === 'path') {
      const id = `LP-${slug}`;
      const lp: LearningPath = {
        id,
        title,
        description: args.body as string || '',
        author,
        created: today,
        updated: today,
        tags: (args.tags as string[]) || [],
        ordered: (args.ordered as boolean) ?? true,
        steps: (args.steps as LearningPath['steps']) || [],
      };

      savePath(ctx.rootDir, lp);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ created: id, type: 'path', file: `content/paths/${id}.yaml` }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Note, policy, guide, runbook
    const prefix = contentType === 'policy' ? 'P' : 'N';
    const id = `${prefix}-${slug}`;
    const frontmatter: UniversityFrontmatter = {
      id,
      title,
      type: contentType as UniversityFrontmatter['type'],
      author,
      created: today,
      updated: today,
      tags: (args.tags as string[]) || [],
      symbols: (args.symbols as string[]) || [],
      difficulty: (args.difficulty as Difficulty) || 'beginner',
      estimatedMinutes: args.estimatedMinutes as number | undefined,
      prerequisites: (args.prerequisites as string[]) || [],
    };

    saveNote(ctx.rootDir, frontmatter, (args.body as string) || '');
    rebuildUniversityIndex(ctx.rootDir);

    const subdir = contentType === 'policy' ? 'policies' : 'notes';
    const text = JSON.stringify({ created: id, type: contentType, file: `content/${subdir}/${id}.md` }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Update ─────────────────────────────────────────────
  if (name === 'paradigm_university_update') {
    const id = args.id as string;
    if (!id) return { handled: true, text: JSON.stringify({ error: 'id is required' }) };

    const today = todayStr();

    // Try note/policy
    const note = loadNote(ctx.rootDir, id);
    if (note) {
      const fm = { ...note.frontmatter };
      if (args.title) fm.title = args.title as string;
      if (args.tags) fm.tags = args.tags as string[];
      if (args.symbols) fm.symbols = args.symbols as string[];
      if (args.difficulty) fm.difficulty = args.difficulty as Difficulty;
      if (args.estimatedMinutes !== undefined) fm.estimatedMinutes = args.estimatedMinutes as number;
      fm.updated = today;

      const body = (args.body as string) ?? note.body;
      saveNote(ctx.rootDir, fm, body);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ updated: id, type: fm.type }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try quiz
    const quiz = loadQuiz(ctx.rootDir, id);
    if (quiz) {
      if (args.title) quiz.title = args.title as string;
      if (args.tags) quiz.tags = args.tags as string[];
      if (args.symbols) quiz.symbols = args.symbols as string[];
      if (args.difficulty) quiz.difficulty = args.difficulty as Difficulty;
      quiz.updated = today;

      saveQuiz(ctx.rootDir, quiz);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ updated: id, type: 'quiz' }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try path
    const lp = loadPath(ctx.rootDir, id);
    if (lp) {
      if (args.title) lp.title = args.title as string;
      if (args.tags) lp.tags = args.tags as string[];
      lp.updated = today;

      savePath(ctx.rootDir, lp);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ updated: id, type: 'path' }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    const text = JSON.stringify({ error: `Content "${id}" not found` });
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Quiz (for taking — no answers) ────────────────────
  if (name === 'paradigm_university_quiz') {
    const id = args.id as string;
    const quiz = loadQuiz(ctx.rootDir, id);
    if (!quiz) {
      const text = JSON.stringify({ error: `Quiz "${id}" not found` });
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Strip answers
    const sanitized = {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      difficulty: quiz.difficulty,
      passThreshold: quiz.passThreshold,
      questionCount: quiz.questions.length,
      questions: quiz.questions.map(q => ({
        id: q.id,
        question: q.question,
        choices: q.choices,
      })),
    };

    const text = JSON.stringify(sanitized, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Submit quiz answers ────────────────────────────────
  if (name === 'paradigm_university_submit') {
    const quizId = args.quizId as string;
    const answers = args.answers as Record<string, string>;
    const student = (args.student as string) || resolveAuthor();

    const quiz = loadQuiz(ctx.rootDir, quizId);
    if (!quiz) {
      const text = JSON.stringify({ error: `Quiz "${quizId}" not found` });
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Grade
    let correct = 0;
    const total = quiz.questions.length;
    const feedback: Array<{ id: string; correct: boolean; expected?: string; explanation?: string }> = [];

    for (const q of quiz.questions) {
      const answer = answers[q.id];
      const isCorrect = answer === q.correct;
      if (isCorrect) correct++;
      feedback.push({
        id: q.id,
        correct: isCorrect,
        ...(isCorrect ? {} : { expected: q.correct }),
        ...(q.explanation ? { explanation: q.explanation } : {}),
      });
    }

    const percentage = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
    const passed = percentage / 100 >= quiz.passThreshold;

    // Save diploma
    const diplomaId = `D-${todayStr()}-${student}-${quizId.replace(/^Q-/, '')}`;
    const diploma: Diploma = {
      id: diplomaId,
      type: 'quiz',
      student,
      earnedAt: new Date().toISOString(),
      source: quizId,
      score: correct,
      total,
      percentage,
      passed,
    };

    saveDiploma(ctx.rootDir, diploma);

    const text = JSON.stringify({
      quizId,
      student,
      score: correct,
      total,
      percentage,
      passThreshold: quiz.passThreshold * 100,
      passed,
      diplomaId,
      feedback,
    }, null, 2);

    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Onboard ────────────────────────────────────────────
  if (name === 'paradigm_university_onboard') {
    const student = (args.student as string) || resolveAuthor();
    const config = loadUniversityConfig(ctx.rootDir);
    const sequence = getOnboardingSequence(ctx.rootDir, student);

    const text = JSON.stringify({
      university: config.branding.name,
      student,
      ...sequence,
    }, null, 2);

    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Diplomas ───────────────────────────────────────────
  if (name === 'paradigm_university_diplomas') {
    const diplomas = loadDiplomas(ctx.rootDir, {
      student: args.student as string | undefined,
      type: args.type as string | undefined,
    });

    const text = JSON.stringify({
      count: diplomas.length,
      diplomas: diplomas.map(d => ({
        id: d.id,
        type: d.type,
        student: d.student,
        source: d.source,
        score: d.score,
        total: d.total,
        percentage: d.percentage,
        passed: d.passed,
        earnedAt: d.earnedAt,
      })),
    }, null, 2);

    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Validate ───────────────────────────────────────────
  if (name === 'paradigm_university_validate') {
    const result = validateUniversityContent(ctx.rootDir, {
      id: args.id as string | undefined,
      deep: args.deep as boolean | undefined,
    });

    const text = JSON.stringify(result, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  return { handled: false, text: '' };
}
