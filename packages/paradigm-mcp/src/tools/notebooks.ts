/**
 * Agent Notebook MCP Tools
 *
 * Tools:
 *   paradigm_notebook_search  — search by concept, tag, symbol
 *   paradigm_notebook_add     — create a new entry
 *   paradigm_notebook_promote — extract from lore entry
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadNotebookEntries,
  searchNotebooks,
  addNotebookEntry,
  promoteFromLore,
} from '../utils/notebook-loader.js';
import type { NotebookEntry } from '../types/notebooks.js';

/**
 * Get list of notebook tools
 */
export function getNotebookToolsList() {
  return [
    {
      name: 'paradigm_notebook_search',
      description:
        'Search agent notebook entries by concept, tag, or keyword. Notebooks are curated snippet libraries distilled from lore for reuse in orchestration. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Agent ID to search notebooks for (e.g., "architect", "builder")',
          },
          query: {
            type: 'string',
            description: 'Search query — matches concepts, tags, context, and snippet content',
          },
          concepts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by concept tags (e.g., ["auth", "middleware"])',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by classification tags',
          },
          response_format: {
            type: 'string',
            enum: ['concise', 'detailed'],
            description: 'Response detail level (default: "detailed")',
          },
        },
        required: ['agentId'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_notebook_add',
      description:
        'Add a new entry to an agent\'s notebook. Use for curated, reusable snippets that should be available across sessions. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Agent ID to add notebook entry for',
          },
          context: {
            type: 'string',
            description: 'When to apply this snippet — the retrieval context',
          },
          snippet: {
            type: 'string',
            description: 'The reusable code/knowledge snippet',
          },
          concepts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concept tags for retrieval (e.g., ["auth", "jwt", "middleware"])',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Classification tags',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score 0.0-1.0 (default: 0.7)',
          },
          scope: {
            type: 'string',
            enum: ['global', 'project'],
            description: 'Where to store: global travels across projects (default: "global")',
          },
          parentId: {
            type: 'string',
            description: 'Optional: ID of the parent notebook entry this was derived from (soft provenance, no validation)',
          },
          lineageType: {
            type: 'string',
            enum: ['fix', 'derive', 'capture', 'promote'],
            description: 'Optional: relationship to parent — fix (corrects parent), derive (modified from parent), capture (new observation), promote (promoted from lower confidence)',
          },
        },
        required: ['agentId', 'context', 'snippet', 'concepts'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_notebook_promote',
      description:
        'Extract a lore entry into a notebook entry. Distills the lore into a reusable snippet with provenance linking. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Agent ID to add the promoted entry to',
          },
          loreEntryId: {
            type: 'string',
            description: 'Lore entry ID to promote (e.g., "L-2026-03-15-...")',
          },
          scope: {
            type: 'string',
            enum: ['global', 'project'],
            description: 'Where to store (default: "global")',
          },
        },
        required: ['agentId', 'loreEntryId'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle notebook tool calls
 */
export async function handleNotebookTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_notebook_search': {
      const agentId = args.agentId as string;
      const query = args.query as string | undefined;
      const concepts = args.concepts as string[] | undefined;
      const tags = args.tags as string[] | undefined;
      const responseFormat = args.response_format as string | undefined;

      let entries;
      if (query) {
        entries = searchNotebooks(agentId, query, ctx.rootDir);
      } else {
        entries = loadNotebookEntries(agentId, ctx.rootDir, { concepts, tags });
      }

      if (responseFormat === 'concise') {
        return {
          handled: true,
          text: JSON.stringify({
            agentId,
            count: entries.length,
            entries: entries.map(e => ({
              id: e.id,
              context: e.context,
              concepts: e.concepts,
            })),
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          agentId,
          count: entries.length,
          entries: entries.map(e => ({
            id: e.id,
            context: e.context,
            snippet: e.snippet.length > 500 ? e.snippet.slice(0, 500) + '...' : e.snippet,
            concepts: e.concepts,
            tags: e.tags,
            appliedCount: e.appliedCount,
            confidence: e.confidence,
            provenance: e.provenance,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_notebook_add': {
      const agentId = args.agentId as string;
      const context = args.context as string;
      const snippet = args.snippet as string;
      const concepts = (args.concepts as string[]) || [];
      const tags = (args.tags as string[]) || [];
      const confidence = (args.confidence as number) ?? 0.7;
      const scope = (args.scope as 'global' | 'project') || (ctx.rootDir ? 'project' : 'global');
      const parentId = args.parentId as string | undefined;
      const lineageType = args.lineageType as NotebookEntry['lineageType'] | undefined;

      const entryData: Parameters<typeof addNotebookEntry>[1] = {
        context,
        snippet,
        provenance: { source: 'manual', createdBy: agentId },
        confidence,
        concepts,
        tags,
        ...(parentId ? { parentId } : {}),
        ...(lineageType ? { lineageType } : {}),
      };

      const result = addNotebookEntry(agentId, entryData, scope, ctx.rootDir);

      return {
        handled: true,
        text: JSON.stringify({
          action: 'notebook_add',
          id: result.entry.id,
          agentId,
          scope,
          filePath: result.filePath,
          concepts: result.entry.concepts,
          ...(parentId ? { parentId } : {}),
          ...(lineageType ? { lineageType } : {}),
        }, null, 2),
      };
    }

    case 'paradigm_notebook_promote': {
      const agentId = args.agentId as string;
      const loreEntryId = args.loreEntryId as string;
      const scope = (args.scope as 'global' | 'project') || (ctx.rootDir ? 'project' : 'global');

      const result = await promoteFromLore(agentId, loreEntryId, ctx.rootDir, scope);

      if (!result) {
        return {
          handled: true,
          text: JSON.stringify({
            error: `Lore entry "${loreEntryId}" not found`,
            suggestion: 'Check the lore entry ID with paradigm_lore_search',
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          action: 'notebook_promote',
          id: result.entry.id,
          agentId,
          loreEntryId,
          scope,
          filePath: result.filePath,
          concepts: result.entry.concepts,
          confidence: result.entry.confidence,
        }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
