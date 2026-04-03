/**
 * University MCP Tools - Per-project knowledge base
 *
 * Tools:
 * - paradigm_university_search: Search content by type/tag/difficulty/symbol
 * - paradigm_university_get: Fetch content item by ID (full body)
 * - paradigm_university_create: Create note/policy/quiz/path
 * - paradigm_university_update: Update existing content
 * - paradigm_university_onboard: Get recommended onboarding sequence
 * - paradigm_university_validate: Validate content integrity
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  searchContent,
  loadNote,
  loadQuiz,
  loadPath,
  saveNote,
  saveQuiz,
  savePath,
  rebuildUniversityIndex,
  validateUniversityContent,
  getOnboardingSequence,
  loadUniversityConfig,
} from '../utils/university-loader.js';
import type {
  UniversityFrontmatter,
  UniversityQuiz,
  LearningPath,
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
          category: {
            type: 'string',
            description: 'Filter by category ID (e.g., "paradigm-core", "extracurricular")',
          },
          track: {
            type: 'string',
            enum: ['core', 'extracurricular'],
            description: 'Filter by track',
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
          category: {
            type: 'string',
            description: 'Category ID for the content (default: project defaultCategory)',
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
          category: { type: 'string', description: 'Category ID for the content' },
        },
        required: ['id'],
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
      category: args.category as string | undefined,
      track: args.track as 'core' | 'extracurricular' | undefined,
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
        ...(args.category ? { category: args.category as string } : {}),
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
        ...(args.category ? { category: args.category as string } : {}),
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
      ...(args.category ? { category: args.category as string } : {}),
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
      if (args.category !== undefined) fm.category = args.category as string;
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
      if (args.category !== undefined) quiz.category = args.category as string;
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
      if (args.category !== undefined) lp.category = args.category as string;
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
