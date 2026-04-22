/**
 * University MCP Tools - Per-project knowledge base (v6.0 multi-tenant)
 *
 * Tools:
 * - paradigm_university_search: Search content by type/tag/difficulty/symbol
 * - paradigm_university_get: Fetch content item by ID (full body)
 * - paradigm_university_create: Create note/policy/quiz/path
 * - paradigm_university_update: Update existing content
 * - paradigm_university_onboard: Get recommended onboarding sequence
 * - paradigm_university_validate: Validate content integrity
 * - paradigm_university_pack_list: List discovered content packs (v6.0)
 *
 * v5.39.0 additive: all existing tools accept optional `pack` arg. Search
 * results now return `id` as `<pack-id>:<entry-id>` (documented breaking
 * change per spec §4.1). `get`/`update` accept either bare or qualified form.
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
  resolveDefaultPackRoot,
  loadOrFabricatePackManifest,
} from '../utils/university-loader.js';
import {
  discoverPacks,
  resolveEntryAddress,
} from '../utils/pack-loader.js';
import type {
  UniversityFrontmatter,
  UniversityQuiz,
  LearningPath,
  Difficulty,
  PackLocation,
} from '../types/university.js';
import { trackToolCall } from './context.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

// ─────────────────────────────────────────────────────────────
// v6.0 pack-aware helpers
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the active pack id + root dir for a tool invocation.
 *
 * Resolution order:
 *   1. Explicit `pack` arg → match discovered pack by id.
 *   2. Discovered project pack (tenant_kind === 'project'), if any.
 *   3. First-party pack (tenant_kind === 'first-party'), if any.
 *   4. Fall-back: implicit project-pack root at .paradigm/university/ even
 *      when no manifest is present (v5 layout preservation).
 */
function resolveActivePack(
  rootDir: string,
  explicitPackId?: string,
): { packId: string; packRoot: string; packs: PackLocation[] } {
  let packs: PackLocation[] = [];
  try {
    packs = discoverPacks(rootDir);
  } catch {
    // discovery failure → treat as no packs
  }

  if (explicitPackId) {
    const match = packs.find(p => p.manifest.id === explicitPackId);
    if (match) {
      return { packId: match.manifest.id, packRoot: match.rootDir, packs };
    }
    // Explicit pack not discovered. Fall through to implicit — the caller
    // may have passed a bare pack-id that matches the implicit project pack.
  }

  const project = packs.find(p => p.manifest.tenant_kind === 'project');
  if (project) {
    return { packId: project.manifest.id, packRoot: project.rootDir, packs };
  }

  const firstParty = packs.find(p => p.manifest.tenant_kind === 'first-party');
  if (firstParty) {
    return { packId: firstParty.manifest.id, packRoot: firstParty.rootDir, packs };
  }

  // Implicit project pack — fabricate an id from the directory.
  const packRoot = resolveDefaultPackRoot(rootDir);
  const manifest = loadOrFabricatePackManifest(packRoot);
  const packId = manifest?.id ?? 'project';
  return { packId, packRoot, packs };
}

/**
 * Count entries across the content subdirectories of a pack root. Used by
 * paradigm_university_pack_list for per-pack entry totals without loading
 * content bodies (privacy + budget). Probes both layouts:
 *   - `content/` (local project packs per spec §1.2)
 *   - `src/content/` (first-party @a-company/university)
 */
function countPackEntries(packRoot: string): number {
  const subdirs = ['notes', 'policies', 'quizzes', 'paths'];
  for (const contentSub of ['content', 'src/content']) {
    const contentDir = path.join(packRoot, contentSub);
    if (!fs.existsSync(contentDir)) continue;
    let total = 0;
    for (const sub of subdirs) {
      const dir = path.join(contentDir, sub);
      if (!fs.existsSync(dir)) continue;
      try {
        total += fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.yaml')).length;
      } catch {
        // skip
      }
    }
    if (total > 0) return total;
  }
  return 0;
}

/**
 * Get list of university tools with safety annotations
 */
export function getUniversityToolsList() {
  return [
    {
      name: 'paradigm_university_search',
      description: 'Search university content by type, tag, difficulty, or symbol. v6.0: result ids are <pack-id>:<entry-id> (minor-breaking). ~150 tokens.',
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
          pack: {
            type: 'string',
            description: 'v6.0: target a specific content pack by id (default: project pack if present, else first-party)',
          },
          discipline: {
            type: 'string',
            description: 'v6.0: filter by discipline sub-pack name',
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
      description: 'Fetch a content item by ID. Accepts bare id or <pack-id>:<entry-id>. Returns full content (body for notes/policies, questions for quizzes). ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID: bare (N-foo) or qualified (paradigm:N-foo)',
          },
          pack: {
            type: 'string',
            description: 'v6.0: disambiguate a bare id against a specific pack (optional)',
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
      description: 'Create a new university content item (note, policy, quiz, or path). v6.0: honors optional pack selector. ~100 tokens.',
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
          // v6.0 pack selector
          pack: {
            type: 'string',
            description: 'v6.0: target a specific pack by id (default: project pack)',
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
      description: 'Update an existing content item. id accepts bare or <pack-id>:<entry-id>. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID to update (bare or qualified)',
          },
          pack: {
            type: 'string',
            description: 'v6.0: disambiguate a bare id against a specific pack (optional)',
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
      description: 'Get recommended onboarding sequence. v6.0: honors optional pack selector. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          student: {
            type: 'string',
            description: 'Student name to check completion (auto-resolved if omitted)',
          },
          pack: {
            type: 'string',
            description: 'v6.0: target a specific pack (default: project pack)',
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
      description: 'Validate content integrity. v6.0: honors optional pack selector. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID to validate (bare or qualified; validates all if omitted)',
          },
          pack: {
            type: 'string',
            description: 'v6.0: target a specific pack (default: all packs)',
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
    {
      name: 'paradigm_university_pack_list',
      description: 'v6.0: List discovered content packs with manifest metadata. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          tenant_kind: {
            type: 'string',
            enum: ['first-party', 'project', 'external'],
            description: 'Filter by tenant kind',
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

  // ── Pack List ──────────────────────────────────────────
  if (name === 'paradigm_university_pack_list') {
    const tenantFilter = args.tenant_kind as 'first-party' | 'project' | 'external' | undefined;

    let packs: PackLocation[] = [];
    try {
      packs = discoverPacks(ctx.rootDir);
    } catch {
      packs = [];
    }

    const filtered = tenantFilter
      ? packs.filter(p => p.manifest.tenant_kind === tenantFilter)
      : packs;

    const result = {
      packs: filtered.map(p => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        tenant_kind: p.manifest.tenant_kind,
        ...(p.manifest.disciplines && p.manifest.disciplines.length > 0
          ? { discipline: p.manifest.disciplines[0] }
          : {}),
        entry_count: countPackEntries(p.rootDir),
        path: p.rootDir,
      })),
    };

    const text = JSON.stringify(result, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Search ─────────────────────────────────────────────
  if (name === 'paradigm_university_search') {
    const requestedPack = args.pack as string | undefined;
    const { packId } = resolveActivePack(ctx.rootDir, requestedPack);

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

    // v6.0 spec §4.1: result ids are <pack-id>:<entry-id>.
    const text = JSON.stringify({
      count: results.length,
      pack: packId,
      results: results.map(r => ({
        id: `${packId}:${r.id}`,
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
    const rawId = args.id as string;
    if (!rawId) return { handled: true, text: JSON.stringify({ error: 'id is required' }) };

    const requestedPack = args.pack as string | undefined;
    const { packId, packRoot } = resolveActivePack(ctx.rootDir, requestedPack);

    let entryId: string;
    try {
      const resolved = resolveEntryAddress(rawId, { activePack: packId });
      entryId = resolved.entryId;
    } catch {
      entryId = rawId;
    }

    // Try note/policy first
    const note = loadNote(ctx.rootDir, entryId, packRoot);
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
    const quiz = loadQuiz(ctx.rootDir, entryId, packRoot);
    if (quiz) {
      const text = JSON.stringify(quiz, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try path
    const lp = loadPath(ctx.rootDir, entryId, packRoot);
    if (lp) {
      const text = JSON.stringify(lp, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    const text = JSON.stringify({ error: `Content "${rawId}" not found` });
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

    const requestedPack = args.pack as string | undefined;
    const { packRoot } = resolveActivePack(ctx.rootDir, requestedPack);

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

      saveQuiz(ctx.rootDir, quiz, packRoot);
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

      savePath(ctx.rootDir, lp, packRoot);
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

    saveNote(ctx.rootDir, frontmatter, (args.body as string) || '', packRoot);
    rebuildUniversityIndex(ctx.rootDir);

    const subdir = contentType === 'policy' ? 'policies' : 'notes';
    const text = JSON.stringify({ created: id, type: contentType, file: `content/${subdir}/${id}.md` }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Update ─────────────────────────────────────────────
  if (name === 'paradigm_university_update') {
    const rawId = args.id as string;
    if (!rawId) return { handled: true, text: JSON.stringify({ error: 'id is required' }) };

    const requestedPack = args.pack as string | undefined;
    const { packId, packRoot } = resolveActivePack(ctx.rootDir, requestedPack);

    let entryId: string;
    try {
      const resolved = resolveEntryAddress(rawId, { activePack: packId });
      entryId = resolved.entryId;
    } catch {
      entryId = rawId;
    }

    const today = todayStr();

    // Try note/policy
    const note = loadNote(ctx.rootDir, entryId, packRoot);
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
      saveNote(ctx.rootDir, fm, body, packRoot);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ updated: entryId, type: fm.type }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try quiz
    const quiz = loadQuiz(ctx.rootDir, entryId, packRoot);
    if (quiz) {
      if (args.title) quiz.title = args.title as string;
      if (args.tags) quiz.tags = args.tags as string[];
      if (args.symbols) quiz.symbols = args.symbols as string[];
      if (args.difficulty) quiz.difficulty = args.difficulty as Difficulty;
      if (args.category !== undefined) quiz.category = args.category as string;
      quiz.updated = today;

      saveQuiz(ctx.rootDir, quiz, packRoot);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ updated: entryId, type: 'quiz' }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    // Try path
    const lp = loadPath(ctx.rootDir, entryId, packRoot);
    if (lp) {
      if (args.title) lp.title = args.title as string;
      if (args.tags) lp.tags = args.tags as string[];
      if (args.category !== undefined) lp.category = args.category as string;
      lp.updated = today;

      savePath(ctx.rootDir, lp, packRoot);
      rebuildUniversityIndex(ctx.rootDir);

      const text = JSON.stringify({ updated: entryId, type: 'path' }, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    const text = JSON.stringify({ error: `Content "${rawId}" not found` });
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Onboard ────────────────────────────────────────────
  if (name === 'paradigm_university_onboard') {
    const student = (args.student as string) || resolveAuthor();
    const requestedPack = args.pack as string | undefined;
    const { packId } = resolveActivePack(ctx.rootDir, requestedPack);

    const config = loadUniversityConfig(ctx.rootDir);
    const sequence = getOnboardingSequence(ctx.rootDir, student);

    const text = JSON.stringify({
      university: config.branding.name,
      pack: packId,
      student,
      ...sequence,
    }, null, 2);

    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Validate ───────────────────────────────────────────
  if (name === 'paradigm_university_validate') {
    const requestedPack = args.pack as string | undefined;
    const { packId } = resolveActivePack(ctx.rootDir, requestedPack);

    const rawId = args.id as string | undefined;
    let entryId: string | undefined = rawId;
    if (rawId) {
      try {
        const resolved = resolveEntryAddress(rawId, { activePack: packId });
        entryId = resolved.entryId;
      } catch {
        // fall through with raw id
      }
    }

    const result = validateUniversityContent(ctx.rootDir, {
      id: entryId,
      deep: args.deep as boolean | undefined,
    });

    const text = JSON.stringify({ pack: packId, ...result }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  return { handled: false, text: '' };
}
