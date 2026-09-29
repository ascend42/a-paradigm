/**
 * University MCP Tools — read-only agent surface (v7.11: 7 → 2 tools)
 *
 * Tools:
 * - paradigm_university_search: Search content by type/tag/difficulty/symbol,
 *   or pass `id` (bare or <pack-id>:<entry-id>) to fetch one entry's full body
 *   (absorbs the former paradigm_university_get).
 * - paradigm_university_pack_list: List discovered content packs, incl. the
 *   skills each pack ships (`skills: [{ id, version, trust }]` — always external).
 *
 * Authoring/validation moved to the CLI (`paradigm university add|show|validate`).
 * For one release the removed tool names (get/create/update/onboard/validate)
 * still resolve to a `{ error: "moved to CLI: ..." }` response.
 *
 * Pack discovery is single-sourced in @a-company/university-core.
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  searchContentWithMeta,
  loadNote,
  loadQuiz,
  loadPath,
  resolveDefaultPackRoot,
  loadOrFabricatePackManifest,
  countPackEntries,
} from '../utils/university-loader.js';
import { discoverPacks, resolveEntryAddress } from '@a-company/university-core';
import type { Difficulty, PackLocation } from '../types/university.js';
import { listPackSkills } from '../utils/skill-loader.js';
import { trackToolCall } from './context.js';
import * as path from 'path';

/** `{ path }` relative to the project root, or `{}` when the pack lives outside it. */
function projectRelativePath(rootDir: string, packDir: string): { path?: string } {
  const rel = path.relative(rootDir, packDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return {};
  return { path: rel.split(path.sep).join('/') || '.' };
}

/** Tool names removed in v7.11 — calls get a moved-to-CLI error for one release. */
export const REMOVED_UNIVERSITY_TOOLS: ReadonlyArray<string> = [
  'paradigm_university_get',
  'paradigm_university_create',
  'paradigm_university_update',
  'paradigm_university_onboard',
  'paradigm_university_validate',
];

export const MOVED_TO_CLI_ERROR = 'moved to CLI: paradigm university add|show|validate';

// ─────────────────────────────────────────────────────────────
// Pack-aware helpers
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
  }

  const project = packs.find(p => p.manifest.tenant_kind === 'project');
  if (project) {
    return { packId: project.manifest.id, packRoot: project.rootDir, packs };
  }

  const firstParty = packs.find(p => p.manifest.tenant_kind === 'first-party');
  if (firstParty) {
    return { packId: firstParty.manifest.id, packRoot: firstParty.rootDir, packs };
  }

  const packRoot = resolveDefaultPackRoot(rootDir);
  const manifest = loadOrFabricatePackManifest(packRoot);
  const packId = manifest?.id ?? 'project';
  return { packId, packRoot, packs };
}

const PROJECT_UNIVERSITY_SUBDIR = path.join('.paradigm', 'university');

/**
 * Is the pack root the PROJECT university dir (`<rootDir>/.paradigm/university`)?
 * Only that pack owns a persisted `index.yaml`. Retained for CLI/Platform callers.
 */
export function isProjectUniversityRoot(rootDir: string, packRoot: string): boolean {
  return path.resolve(packRoot) === path.resolve(rootDir, PROJECT_UNIVERSITY_SUBDIR);
}

/**
 * Get list of university tools with safety annotations
 */
export function getUniversityToolsList() {
  return [
    {
      name: 'paradigm_university_search',
      description: 'Search university content by type, tag, difficulty, or symbol; result ids are <pack-id>:<entry-id>. Pass `id` (bare or <pack-id>:<entry-id>) to fetch one entry with its full body/questions instead. ~150 tokens (~300 with id).',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Fetch ONE entry by id (bare N-foo or qualified paradigm:N-foo) — returns full content (body for notes/policies, questions for quizzes, steps for paths). Other filters are ignored.',
          },
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
          section: {
            type: 'string',
            description: 'v6.5: filter by section id (within the active pack)',
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
      name: 'paradigm_university_pack_list',
      description: 'List discovered content packs with manifest metadata, sections, and the skills each pack ships (always trust external — import with `paradigm skill import <pack>:<id>`). ~200 tokens.',
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

    // Pack skills (scope pack — trust is ALWAYS external). Never script bodies.
    const skillsByPack = new Map<string, Array<{ id: string; version: string; trust: string }>>();
    try {
      for (const e of listPackSkills({ rootDir: ctx.rootDir })) {
        const list = skillsByPack.get(e.packId) ?? [];
        list.push({ id: e.skill.metadata.paradigm.id, version: e.skill.metadata.paradigm.version, trust: e.skill.metadata.paradigm.trust });
        skillsByPack.set(e.packId, list);
      }
    } catch {
      // skills are additive — a failure never hides the pack list
    }

    const result = {
      packs: filtered.map(p => {
        // v6.5: surface the pack's sections (always non-empty post-synthesis
        // — pack discovery synthesizes a default `main` section when omitted).
        // Sort by (order, id) ascending so UI consumers get a deterministic
        // order without re-sorting.
        const sections = (p.manifest.sections ?? []).slice().sort((a, b) =>
          (a.order - b.order) || a.id.localeCompare(b.id),
        );
        return {
          id: p.manifest.id,
          name: p.manifest.name,
          version: p.manifest.version,
          tenant_kind: p.manifest.tenant_kind,
          ...(p.manifest.disciplines && p.manifest.disciplines.length > 0
            ? { discipline: p.manifest.disciplines[0] }
            : {}),
          entry_count: countPackEntries(p.rootDir),
          sections,
          skills: skillsByPack.get(p.manifest.id) ?? [],
          // Project-relative only — never an absolute host path. Omitted when outside the project.
          ...projectRelativePath(ctx.rootDir, p.rootDir),
        };
      }),
    };

    const text = JSON.stringify(result, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Search ─────────────────────────────────────────────
  if (name === 'paradigm_university_search') {
    const requestedPack = args.pack as string | undefined;
    const rawId = args.id as string | undefined;

    // `id` → fetch ONE entry with full content (absorbs paradigm_university_get).
    if (typeof rawId === 'string' && rawId.length > 0) {
      let targetPack = requestedPack;
      let entryId = rawId;
      try {
        const resolved = resolveEntryAddress(rawId, { activePack: requestedPack ?? '' });
        entryId = resolved.entryId;
        if (resolved.packId) targetPack = resolved.packId;
      } catch {
        entryId = rawId;
      }
      const { packId, packRoot } = resolveActivePack(ctx.rootDir, targetPack || undefined);
      const text = JSON.stringify(getEntry(ctx.rootDir, packId, packRoot, entryId, rawId), null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    const { packId, packRoot } = resolveActivePack(ctx.rootDir, requestedPack);

    // v6.5: resolve the active pack's default-section id for synthesis on
    // results where `section` is absent in the entry frontmatter.
    const activeManifest = loadOrFabricatePackManifest(packRoot);
    const defaultSectionId =
      activeManifest?.sections?.find(s => s.default === true)?.id ?? 'main';

    // Only scope to packRoot when a pack was explicitly requested. Without a
    // `pack` arg, pass undefined so the default routes through the unchanged
    // project-index path (loadUniversityIndex) — byte-identical to v6.x.
    // C2: searchContentWithMeta also surfaces `total` (pre-slice) so callers
    // can tell whether the default limit silently truncated results.
    const { entries: results, total, returned } = searchContentWithMeta(ctx.rootDir, {
      type: args.type as string | undefined,
      tag: args.tag as string | undefined,
      difficulty: args.difficulty as Difficulty | undefined,
      symbol: args.symbol as string | undefined,
      query: args.query as string | undefined,
      category: args.category as string | undefined,
      track: args.track as 'core' | 'extracurricular' | undefined,
      section: args.section as string | undefined,
      limit: args.limit as number | undefined,
    }, requestedPack ? packRoot : undefined);

    // v6.0 spec §4.1: result ids are <pack-id>:<entry-id>.
    // v6.5: result items include `section` (always present, synthesized to
    // the active pack's default when not authored) and `order` (only when
    // set on the entry).
    // C2: `total` (post-filter, pre-slice) + `returned` (post-slice) expose
    // truncation. `count` is kept as an alias of `returned` for back-compat.
    const text = JSON.stringify({
      count: results.length,
      total,
      returned,
      truncated: total > returned,
      pack: packId,
      results: results.map(r => ({
        id: `${packId}:${r.id}`,
        title: r.title,
        type: r.type,
        difficulty: r.difficulty,
        tags: r.tags,
        symbols: r.symbols,
        section: r.section ?? defaultSectionId,
        ...(typeof r.order === 'number' ? { order: r.order } : {}),
      })),
    }, null, 2);

    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── Removed in v7.11 (one-release shim) ─────────────────
  if (REMOVED_UNIVERSITY_TOOLS.includes(name)) {
    const text = JSON.stringify({ error: MOVED_TO_CLI_ERROR });
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  return { handled: false, text: '' };
}

/** Full content for one entry (note/policy › quiz › path), or a not-found error. */
function getEntry(rootDir: string, packId: string, packRoot: string, entryId: string, rawId: string): unknown {
  const note = loadNote(rootDir, entryId, packRoot);
  if (note) {
    return {
      id: `${packId}:${note.frontmatter.id}`,
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
    };
  }
  const quiz = loadQuiz(rootDir, entryId, packRoot);
  if (quiz) return { ...quiz, id: `${packId}:${quiz.id}`, type: 'quiz' };
  const lp = loadPath(rootDir, entryId, packRoot);
  if (lp) return { ...lp, id: `${packId}:${lp.id}`, type: 'path' };
  return { error: `Content "${rawId}" not found` };
}
