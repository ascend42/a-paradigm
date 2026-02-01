/**
 * Symbol Resources - Expose Paradigm symbols via MCP
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  getSymbol,
  getSymbolsByType,
  getSymbolCounts,
  getAllSymbols,
  type SymbolIndex,
  type SymbolType,
} from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';

/**
 * Register symbol resources with the MCP server
 */
export function registerSymbolResources(server: Server, getContext: () => ProjectContext) {
  // Resource: List all symbols
  server.setRequestHandler(
    { method: 'resources/read' } as any,
    async (request: any) => {
      const uri = request.params?.uri as string;
      
      if (!uri?.startsWith('paradigm://')) {
        throw new Error(`Unknown URI scheme: ${uri}`);
      }
      
      const ctx = getContext();
      const path = uri.replace('paradigm://', '');
      
      // paradigm://symbols - Overview of all symbols
      if (path === 'symbols') {
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
                filePath: s.filePath,
              })),
            }, null, 2),
          }],
        };
      }
      
      // paradigm://symbol/@feature-name - Single symbol details
      if (path.startsWith('symbol/')) {
        const symbolStr = decodeURIComponent(path.replace('symbol/', ''));
        const entry = getSymbol(ctx.index, symbolStr);
        
        if (!entry) {
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                error: 'Symbol not found',
                symbol: symbolStr,
                suggestion: 'Use paradigm://symbols to list all available symbols',
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
      
      // paradigm://symbols/type/feature - Symbols by type
      if (path.startsWith('symbols/type/')) {
        const type = path.replace('symbols/type/', '') as SymbolType;
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
                references: s.references.length,
                referencedBy: s.referencedBy.length,
              })),
            }, null, 2),
          }],
        };
      }
      
      throw new Error(`Unknown resource path: ${path}`);
    }
  );
}
