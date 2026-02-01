/**
 * MCP Resources - Expose Paradigm data as read-only resources
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  getSymbol,
  getSymbolsByType,
  getSymbolCounts,
  getAllSymbols,
  type SymbolType,
} from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { getGatesData, getFlowsData } from './gates.js';

/**
 * Register all MCP resources
 */
export function registerResources(server: Server, getContext: () => ProjectContext) {
  // List available resources
  server.setRequestHandler(
    { method: 'resources/list' } as any,
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
        ],
      };
    }
  );

  // Read resources
  server.setRequestHandler(
    { method: 'resources/read' } as any,
    async (request: any) => {
      const uri = request.params?.uri as string;
      
      if (!uri?.startsWith('paradigm://')) {
        throw new Error(`Unknown URI scheme: ${uri}`);
      }
      
      const ctx = getContext();
      const resourcePath = uri.replace('paradigm://', '');
      
      // paradigm://symbols - Overview of all symbols
      if (resourcePath === 'symbols') {
        const counts = getSymbolCounts(ctx.index);
        const symbols = getAllSymbols(ctx.index);
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              project: ctx.projectName,
              counts,
              total: Object.values(counts).reduce((a, b) => a + b, 0),
              symbols: symbols.map(s => ({
                symbol: s.symbol,
                type: s.type,
                description: s.description,
              })),
            }, null, 2),
          }],
        };
      }
      
      // paradigm://symbol/{symbol} - Single symbol details
      if (resourcePath.startsWith('symbol/')) {
        const symbolStr = decodeURIComponent(resourcePath.replace('symbol/', ''));
        const entry = getSymbol(ctx.index, symbolStr);
        
        if (!entry) {
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                error: 'Symbol not found',
                symbol: symbolStr,
                available: getAllSymbols(ctx.index)
                  .filter(s => s.symbol.includes(symbolStr.slice(1)))
                  .slice(0, 5)
                  .map(s => s.symbol),
              }, null, 2),
            }],
          };
        }
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              symbol: entry.symbol,
              type: entry.type,
              description: entry.description,
              filePath: entry.filePath,
              references: entry.references,
              referencedBy: entry.referencedBy,
              tags: entry.tags,
              data: entry.data,
            }, null, 2),
          }],
        };
      }
      
      // paradigm://symbols/type/{type} - Symbols by type
      if (resourcePath.startsWith('symbols/type/')) {
        const type = resourcePath.replace('symbols/type/', '') as SymbolType;
        const symbols = getSymbolsByType(ctx.index, type);
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              type,
              count: symbols.length,
              symbols: symbols.map(s => ({
                symbol: s.symbol,
                description: s.description,
                filePath: s.filePath,
                referencesCount: s.references.length,
                referencedByCount: s.referencedBy.length,
              })),
            }, null, 2),
          }],
        };
      }
      
      // paradigm://gates - Detailed gates from portal.yaml
      if (resourcePath === 'gates') {
        const gates = getGatesData(ctx);
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              count: gates.length,
              gates,
            }, null, 2),
          }],
        };
      }
      
      // paradigm://flows - Detailed flows
      if (resourcePath === 'flows') {
        const flows = getFlowsData(ctx);
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              count: flows.length,
              flows,
            }, null, 2),
          }],
        };
      }
      
      throw new Error(`Unknown resource: ${resourcePath}`);
    }
  );
}
