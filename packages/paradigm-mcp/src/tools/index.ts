/**
 * MCP Tools - Actions AI can invoke on Paradigm data
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  getSymbol,
  searchSymbols,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByType,
  getAllSymbols,
  getSymbolCounts,
} from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { getWisdomToolsList, handleWisdomTool } from './wisdom.js';
import { getHistoryToolsList, handleHistoryTool } from './history.js';
import { getNavigateToolsList, handleNavigateTool } from './navigate.js';

/**
 * Register all MCP tools
 */
export function registerTools(server: Server, getContext: () => ProjectContext) {
  // List available tools
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      return {
        tools: [
          {
            name: 'paradigm_search',
            description: 'Search for Paradigm symbols by name, description, or tags',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (matches symbol names, descriptions, tags)',
                },
                type: {
                  type: 'string',
                  enum: ['feature', 'component', 'gate', 'flow', 'signal', 'state', 'idea'],
                  description: 'Optional: filter by symbol type',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum results to return (default: 10)',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'paradigm_ripple',
            description: 'Analyze the impact of changing a symbol - what depends on it directly and indirectly',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: {
                  type: 'string',
                  description: 'Symbol to analyze (e.g., @checkout, ^authenticated, $onboarding)',
                },
              },
              required: ['symbol'],
            },
          },
          {
            name: 'paradigm_related',
            description: 'Get all symbols related to a given symbol (references to and from)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: {
                  type: 'string',
                  description: 'Symbol to find relations for',
                },
              },
              required: ['symbol'],
            },
          },
          {
            name: 'paradigm_status',
            description: 'Get overview of the project\'s Paradigm symbols and health',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'paradigm_gates_for_route',
            description: 'Suggest which gates should be applied to a route based on patterns in the project',
            inputSchema: {
              type: 'object',
              properties: {
                route: {
                  type: 'string',
                  description: 'Route path (e.g., /api/users, /admin/settings)',
                },
                method: {
                  type: 'string',
                  enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
                  description: 'HTTP method',
                },
              },
              required: ['route'],
            },
          },
          // Wisdom tools
          ...getWisdomToolsList(),
          // History tools
          ...getHistoryToolsList(),
          // Navigate tools
          ...getNavigateToolsList(),
        ],
      };
    }
  );

  // Handle tool calls
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name, arguments: args } = request.params;
      const ctx = getContext();

      switch (name) {
        case 'paradigm_search': {
          const { query, type, limit = 10 } = args;
          let results = searchSymbols(ctx.index, query);
          
          if (type) {
            results = results.filter(s => s.type === type);
          }
          
          results = results.slice(0, limit);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query,
                count: results.length,
                results: results.map(s => ({
                  symbol: s.symbol,
                  type: s.type,
                  description: s.description,
                  filePath: s.filePath,
                })),
              }, null, 2),
            }],
          };
        }

        case 'paradigm_ripple': {
          const { symbol } = args;
          const entry = getSymbol(ctx.index, symbol);
          
          if (!entry) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'Symbol not found',
                  symbol,
                  suggestion: 'Use paradigm_search to find valid symbols',
                }, null, 2),
              }],
            };
          }
          
          // Get direct dependencies
          const directDeps = getReferencesTo(ctx.index, symbol);
          
          // Get indirect dependencies (one level deep)
          const indirectDeps = new Set<string>();
          for (const dep of directDeps) {
            const secondLevel = getReferencesTo(ctx.index, dep.symbol);
            for (const s of secondLevel) {
              if (s.symbol !== symbol && !directDeps.find(d => d.symbol === s.symbol)) {
                indirectDeps.add(s.symbol);
              }
            }
          }
          
          // What this symbol depends on
          const dependsOn = getReferencesFrom(ctx.index, symbol);
          
          const totalAffected = directDeps.length + indirectDeps.size;
          let impact: 'low' | 'medium' | 'high' = 'low';
          if (totalAffected > 10) impact = 'high';
          else if (totalAffected > 3) impact = 'medium';
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                symbol: entry.symbol,
                type: entry.type,
                description: entry.description,
                impact,
                analysis: {
                  directlyAffected: directDeps.map(d => ({
                    symbol: d.symbol,
                    type: d.type,
                    description: d.description,
                  })),
                  indirectlyAffected: Array.from(indirectDeps),
                  dependsOn: dependsOn.map(d => ({
                    symbol: d.symbol,
                    type: d.type,
                  })),
                },
                summary: {
                  directCount: directDeps.length,
                  indirectCount: indirectDeps.size,
                  totalAffected,
                  dependsOnCount: dependsOn.length,
                },
                recommendation: impact === 'high' 
                  ? 'High impact change - review all affected symbols carefully before modifying'
                  : impact === 'medium'
                  ? 'Moderate impact - check direct dependencies for breaking changes'
                  : 'Low impact - safe to modify with standard review',
              }, null, 2),
            }],
          };
        }

        case 'paradigm_related': {
          const { symbol } = args;
          const entry = getSymbol(ctx.index, symbol);
          
          if (!entry) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'Symbol not found',
                  symbol,
                }, null, 2),
              }],
            };
          }
          
          const referencesTo = getReferencesTo(ctx.index, symbol);
          const referencesFrom = getReferencesFrom(ctx.index, symbol);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                symbol: entry.symbol,
                type: entry.type,
                description: entry.description,
                usedBy: referencesTo.map(s => ({
                  symbol: s.symbol,
                  type: s.type,
                  description: s.description,
                })),
                uses: referencesFrom.map(s => ({
                  symbol: s.symbol,
                  type: s.type,
                  description: s.description,
                })),
              }, null, 2),
            }],
          };
        }

        case 'paradigm_status': {
          const counts = getSymbolCounts(ctx.index);
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          
          // Get some example symbols for each type
          const examples: Record<string, string[]> = {};
          for (const type of Object.keys(counts) as Array<keyof typeof counts>) {
            const symbols = getSymbolsByType(ctx.index, type);
            examples[type] = symbols.slice(0, 3).map(s => s.symbol);
          }
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                project: ctx.projectName,
                counts: {
                  '@ features': counts.feature,
                  '# components': counts.component,
                  '$ flows': counts.flow,
                  '% states': counts.state,
                  '^ gates': counts.gate,
                  '! signals': counts.signal,
                  '? ideas': counts.idea,
                },
                total,
                examples,
                hasPortalYaml: ctx.gateConfig !== null,
                purposeFiles: ctx.aggregation.purposeFiles.length,
              }, null, 2),
            }],
          };
        }

        case 'paradigm_gates_for_route': {
          const { route, method = 'GET' } = args;
          
          // Get all gates
          const gates = getSymbolsByType(ctx.index, 'gate');
          
          // Simple heuristic-based suggestions
          const suggestions: Array<{ gate: string; reason: string; confidence: 'high' | 'medium' | 'low' }> = [];
          
          // Check for admin routes
          if (route.includes('/admin') || route.includes('/settings')) {
            const adminGate = gates.find(g => 
              g.symbol.includes('admin') || g.description?.toLowerCase().includes('admin')
            );
            if (adminGate) {
              suggestions.push({
                gate: adminGate.symbol,
                reason: 'Route appears to be admin-related',
                confidence: 'high',
              });
            }
          }
          
          // Check for authenticated routes (most API routes)
          if (route.startsWith('/api/') || route.includes('/user') || route.includes('/account')) {
            const authGate = gates.find(g => 
              g.symbol.includes('authenticated') || g.symbol.includes('auth')
            );
            if (authGate) {
              suggestions.push({
                gate: authGate.symbol,
                reason: 'API/user routes typically require authentication',
                confidence: 'high',
              });
            }
          }
          
          // Suggest subscription gate for premium-looking routes
          if (route.includes('/premium') || route.includes('/pro') || route.includes('/export')) {
            const subGate = gates.find(g => 
              g.symbol.includes('subscription') || g.symbol.includes('premium')
            );
            if (subGate) {
              suggestions.push({
                gate: subGate.symbol,
                reason: 'Route appears to be a premium feature',
                confidence: 'medium',
              });
            }
          }
          
          // Write operations should have auth
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            const authGate = gates.find(g => g.symbol.includes('authenticated'));
            if (authGate && !suggestions.find(s => s.gate === authGate.symbol)) {
              suggestions.push({
                gate: authGate.symbol,
                reason: 'Write operations typically require authentication',
                confidence: 'high',
              });
            }
          }
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                route,
                method,
                suggestions,
                availableGates: gates.map(g => ({
                  symbol: g.symbol,
                  description: g.description,
                })),
                note: 'These are suggestions based on route patterns. Review your portal.yaml for exact requirements.',
              }, null, 2),
            }],
          };
        }

        default: {
          // Try navigate tool
          if (name === 'paradigm_navigate') {
            const result = await handleNavigateTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try wisdom tools
          if (name.startsWith('paradigm_wisdom_')) {
            const result = await handleWisdomTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try history tools
          if (name.startsWith('paradigm_history_')) {
            const result = await handleHistoryTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          throw new Error(`Unknown tool: ${name}`);
        }
      }
    }
  );
}
