/**
 * MCP Resources - Expose Paradigm data as read-only resources
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getSymbol,
  getSymbolsByType,
  getSymbolCounts,
  getAllSymbols,
  type SymbolType,
} from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackResourceRead } from '../tools/context.js';
import { getGatesData, getFlowsData } from './gates.js';
import { getWisdomResourcesList, handleWisdomResource } from './wisdom.js';
import { getHistoryResourcesList, handleHistoryResource } from './history.js';
import { getContextResourcesList, handleContextResource } from './context.js';
import { getPromptsResourcesList, handlePromptsResource } from './prompts.js';
import { getSpecsResourcesList, handleSpecsResource } from './specs.js';
import { getDocsResourcesList, handleDocsResource } from './docs.js';
import { getGuidanceResourcesList, handleGuidanceResource } from './guidance.js';

/**
 * Register all MCP resources
 */
export function registerResources(server: Server, getContext: () => ProjectContext) {
  // List available resources
  server.setRequestHandler(
    ListResourcesRequestSchema,
    async () => {
      return {
        resources: [
          {
            uri: 'paradigm://symbols',
            name: 'All Symbols',
            description: 'Overview of all Paradigm symbols in the project',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://symbols/type/feature',
            name: 'Features',
            description: 'All @feature symbols',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://symbols/type/component',
            name: 'Components',
            description: 'All #component symbols',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://symbols/type/gate',
            name: 'Gates',
            description: 'All ^gate symbols (authorization)',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://symbols/type/flow',
            name: 'Flows',
            description: 'All $flow symbols (processes)',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://symbols/type/signal',
            name: 'Signals',
            description: 'All !signal symbols (events)',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://symbols/type/state',
            name: 'States',
            description: 'All %state symbols',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://gates',
            name: 'Gates (Detailed)',
            description: 'All gates with locks, keys, and prizes from portal.yaml',
            mimeType: 'application/json',
          },
          {
            uri: 'paradigm://flows',
            name: 'Flows (Detailed)',
            description: 'All flows with gate sequences',
            mimeType: 'application/json',
          },
          // Wisdom resources
          ...getWisdomResourcesList(),
          // History resources
          ...getHistoryResourcesList(),
          // Context resources
          ...getContextResourcesList(),
          // Reference content (served from package templates)
          ...getPromptsResourcesList(),
          ...getSpecsResourcesList(),
          ...getDocsResourcesList(),
          // Guidance resources (on-demand behavioral guidance)
          ...getGuidanceResourcesList(),
        ],
      };
    }
  );

  // Read resources
  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request) => {
      const uri = request.params.uri;
      
      if (!uri?.startsWith('paradigm://')) {
        throw new Error(`Unknown URI scheme: ${uri}`);
      }
      
      const ctx = getContext();
      const resourcePath = uri.replace('paradigm://', '');
      
      // paradigm://symbols - Overview of all symbols
      if (resourcePath === 'symbols') {
        const counts = getSymbolCounts(ctx.index);
        const symbols = getAllSymbols(ctx.index);

        const text = JSON.stringify({
          project: ctx.projectName,
          counts,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
          symbols: symbols.map(s => ({
            symbol: s.symbol,
            type: s.type,
            description: s.description,
          })),
        }, null, 2);

        trackResourceRead(text.length, uri);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text,
          }],
        };
      }
      
      // paradigm://symbol/{symbol} - Single symbol details
      if (resourcePath.startsWith('symbol/')) {
        const symbolStr = decodeURIComponent(resourcePath.replace('symbol/', ''));
        const entry = getSymbol(ctx.index, symbolStr);

        if (!entry) {
          const text = JSON.stringify({
            error: 'Symbol not found',
            symbol: symbolStr,
            available: getAllSymbols(ctx.index)
              .filter(s => s.symbol.includes(symbolStr.slice(1)))
              .slice(0, 5)
              .map(s => s.symbol),
          }, null, 2);
          trackResourceRead(text.length, uri);
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text,
            }],
          };
        }

        const text = JSON.stringify({
          symbol: entry.symbol,
          type: entry.type,
          description: entry.description,
          filePath: entry.filePath,
          references: entry.references,
          referencedBy: entry.referencedBy,
          tags: entry.tags,
          data: entry.data,
        }, null, 2);

        trackResourceRead(text.length, uri);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text,
          }],
        };
      }
      
      // paradigm://symbols/type/{type} - Symbols by type
      if (resourcePath.startsWith('symbols/type/')) {
        const type = resourcePath.replace('symbols/type/', '') as SymbolType;
        const symbols = getSymbolsByType(ctx.index, type);

        const text = JSON.stringify({
          type,
          count: symbols.length,
          symbols: symbols.map(s => ({
            symbol: s.symbol,
            description: s.description,
            filePath: s.filePath,
            referencesCount: s.references.length,
            referencedByCount: s.referencedBy.length,
          })),
        }, null, 2);

        trackResourceRead(text.length, uri);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text,
          }],
        };
      }
      
      // paradigm://gates - Detailed gates from portal.yaml
      if (resourcePath === 'gates') {
        const gates = getGatesData(ctx);

        const text = JSON.stringify({
          count: gates.length,
          gates,
        }, null, 2);

        trackResourceRead(text.length, uri);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text,
          }],
        };
      }

      // paradigm://flows - Detailed flows
      if (resourcePath === 'flows') {
        const flows = getFlowsData(ctx);

        const text = JSON.stringify({
          count: flows.length,
          flows,
        }, null, 2);

        trackResourceRead(text.length, uri);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text,
          }],
        };
      }

      // Try wisdom resources
      if (resourcePath.startsWith('wisdom/')) {
        const result = await handleWisdomResource(resourcePath, ctx);
        if (result.handled) {
          trackResourceRead(result.text.length);
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: result.text,
            }],
          };
        }
      }

      // Try history resources
      if (resourcePath.startsWith('history/')) {
        const result = await handleHistoryResource(resourcePath, ctx);
        if (result.handled) {
          trackResourceRead(result.text.length);
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: result.text,
            }],
          };
        }
      }

      // Try context resources
      if (resourcePath.startsWith('context/')) {
        const result = await handleContextResource(resourcePath, ctx);
        if (result.handled) {
          trackResourceRead(result.text.length);
          return {
            contents: [{
              uri,
              mimeType: result.text.startsWith('#') ? 'text/markdown' : 'application/json',
              text: result.text,
            }],
          };
        }
      }

      // Try prompts resources
      if (resourcePath === 'prompts' || resourcePath.startsWith('prompts/')) {
        const result = await handlePromptsResource(resourcePath, ctx);
        if (result.handled) {
          return {
            contents: [{
              uri,
              mimeType: result.mimeType,
              text: result.text,
            }],
          };
        }
      }

      // Try specs resources
      if (resourcePath === 'specs' || resourcePath.startsWith('specs/')) {
        const result = await handleSpecsResource(resourcePath, ctx);
        if (result.handled) {
          return {
            contents: [{
              uri,
              mimeType: result.mimeType,
              text: result.text,
            }],
          };
        }
      }

      // Try docs resources
      if (resourcePath === 'docs' || resourcePath.startsWith('docs/')) {
        const result = await handleDocsResource(resourcePath, ctx);
        if (result.handled) {
          return {
            contents: [{
              uri,
              mimeType: result.mimeType,
              text: result.text,
            }],
          };
        }
      }

      // Try guidance resources
      if (resourcePath === 'guidance' || resourcePath.startsWith('guidance/')) {
        const result = await handleGuidanceResource(resourcePath, ctx);
        if (result.handled) {
          return {
            contents: [{
              uri,
              mimeType: result.mimeType,
              text: result.text,
            }],
          };
        }
      }

      throw new Error(`Unknown resource: ${resourcePath}`);
    }
  );
}
