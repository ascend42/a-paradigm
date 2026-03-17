/**
 * Docs MCP Tools — Auto-generated documentation from the symbol graph
 *
 * Tools:
 * - paradigm_docs_manifest: Returns sidebar structure and symbol counts
 * - paradigm_docs_page: Returns page data for a symbol, flow, gate, or custom page
 * - paradigm_docs_search: Search across all docs content
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  buildDocsManifest,
  buildSymbolPage,
  buildFlowPage,
  buildPortalPage,
  loadCustomPage,
  searchDocs,
  loadDocsConfig,
} from '../utils/docs-loader.js';
import { trackToolCall } from './context.js';

export function getDocsToolsList() {
  return [
    {
      name: 'paradigm_docs_manifest',
      description: 'Get the documentation sidebar manifest — all symbols grouped by type with counts. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_docs_page',
      description: 'Get page data for a symbol, flow, portal, or custom docs page. Returns structured data for rendering. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Symbol ID (e.g., "cli-commands", "checkout-flow", "authenticated"). Do not include the prefix (#, $, ^, !, ~).',
          },
          flow: {
            type: 'string',
            description: 'Flow ID (e.g., "$init-flow"). Include the $ prefix.',
          },
          portal: {
            type: 'boolean',
            description: 'Set to true to get the portal overview page (gates + routes).',
          },
          slug: {
            type: 'string',
            description: 'Custom page slug (e.g., "getting-started").',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_docs_search',
      description: 'Search across all documentation content — symbols, descriptions, tags, custom pages. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 20)',
          },
        },
        required: ['query'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

export async function handleDocsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {

  if (name === 'paradigm_docs_manifest') {
    const config = loadDocsConfig(ctx.rootDir);
    const manifest = buildDocsManifest(ctx.rootDir, config);
    const text = JSON.stringify(manifest, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  if (name === 'paradigm_docs_page') {
    // Priority: portal > flow > slug > symbol
    if (args.portal) {
      const page = buildPortalPage(ctx.rootDir);
      const text = JSON.stringify(page, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    if (args.flow) {
      const flowId = args.flow as string;
      const page = buildFlowPage(ctx.rootDir, flowId);
      if (!page) {
        const text = JSON.stringify({ error: `Flow "${flowId}" not found` });
        trackToolCall(text.length, name);
        return { handled: true, text };
      }
      const text = JSON.stringify(page, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    if (args.slug) {
      const config = loadDocsConfig(ctx.rootDir);
      const page = loadCustomPage(ctx.rootDir, args.slug as string, config);
      if (!page) {
        const text = JSON.stringify({ error: `Page "${args.slug}" not found` });
        trackToolCall(text.length, name);
        return { handled: true, text };
      }
      const text = JSON.stringify(page, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    if (args.symbol) {
      const page = buildSymbolPage(ctx.rootDir, args.symbol as string);
      if (!page) {
        const text = JSON.stringify({ error: `Symbol "${args.symbol}" not found` });
        trackToolCall(text.length, name);
        return { handled: true, text };
      }
      const text = JSON.stringify(page, null, 2);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }

    const text = JSON.stringify({ error: 'Provide one of: symbol, flow, portal, or slug' });
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  if (name === 'paradigm_docs_search') {
    const query = args.query as string;
    if (!query) {
      return { handled: true, text: JSON.stringify({ error: 'query is required' }) };
    }
    const results = searchDocs(ctx.rootDir, query, args.limit as number | undefined);
    const text = JSON.stringify({ count: results.length, results }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  return { handled: false, text: '' };
}
