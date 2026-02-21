/**
 * Sentinel MCP Server
 *
 * Standalone Model Context Protocol server for Sentinel.
 * Provides AI agents with access to incident triage and pattern matching.
 *
 * Usage:
 *   sentinel-mcp [project-dir]
 *
 * Or in Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "sentinel": {
 *         "command": "npx",
 *         "args": ["@a-company/sentinel-mcp"],
 *         "cwd": "/path/to/project"
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { SentinelStorage } from './storage.js';
import { PatternMatcher } from './matcher.js';
import { TimelineBuilder } from './timeline.js';
import { StatsCalculator } from './stats.js';
import { PatternSuggester } from './suggester.js';
import { loadAllSeedPatterns } from './seeds/loader.js';
import type {
  IncidentStatus,
  PatternSource,
  CreatePatternInput,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════════

let storage: SentinelStorage | null = null;
let initialized = false;

function getStorage(): SentinelStorage {
  if (!storage) {
    storage = new SentinelStorage();
  }

  if (!initialized) {
    try {
      const { patterns } = loadAllSeedPatterns();
      for (const pattern of patterns) {
        try {
          storage.addPattern(pattern);
        } catch {
          // Pattern already exists
        }
      }
    } catch {
      // Seed patterns are optional
    }
    initialized = true;
  }

  return storage;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

function getToolsList() {
  return [
    {
      name: 'sentinel_triage',
      description:
        'View and filter incidents with pattern matches. Returns recent errors with symbolic context and resolution suggestions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          symbol: { type: 'string', description: 'Filter by symbol (e.g., #checkout, ^auth)' },
          status: {
            type: 'string',
            enum: ['open', 'investigating', 'resolved', 'wont-fix', 'all'],
            description: 'Filter by status (default: all)',
          },
          environment: { type: 'string', description: 'Filter by environment' },
          search: { type: 'string', description: 'Search in error messages' },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
      },
    },
    {
      name: 'sentinel_show',
      description: 'Get full details of a specific incident including timeline and matched patterns.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          incidentId: { type: 'string', description: 'Incident ID (e.g., INC-001)' },
          includeTimeline: { type: 'boolean', description: 'Include flow timeline' },
          includeSimilar: { type: 'boolean', description: 'Include similar incidents' },
        },
        required: ['incidentId'],
      },
    },
    {
      name: 'sentinel_resolve',
      description: 'Mark an incident as resolved with optional pattern and commit reference.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          incidentId: { type: 'string', description: 'Incident ID' },
          patternId: { type: 'string', description: 'Pattern that led to resolution' },
          commitHash: { type: 'string', description: 'Fix commit hash' },
          prUrl: { type: 'string', description: 'PR URL' },
          notes: { type: 'string', description: 'Resolution notes' },
          wontFix: { type: 'boolean', description: 'Mark as wont-fix instead of resolved' },
        },
        required: ['incidentId'],
      },
    },
    {
      name: 'sentinel_patterns',
      description: 'List and filter failure patterns with confidence scores.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          symbol: { type: 'string', description: 'Filter patterns for this symbol' },
          minConfidence: { type: 'number', description: 'Minimum confidence score' },
          source: {
            type: 'string',
            enum: ['manual', 'suggested', 'imported', 'community'],
            description: 'Filter by source',
          },
        },
      },
    },
    {
      name: 'sentinel_add_pattern',
      description: 'Create a new failure pattern.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Pattern ID (kebab-case)' },
          name: { type: 'string', description: 'Human-readable name' },
          description: { type: 'string', description: 'What this pattern matches' },
          pattern: {
            type: 'object',
            properties: {
              symbols: { type: 'object', description: 'Symbol criteria' },
              errorContains: { type: 'array', items: { type: 'string' }, description: 'Error keywords' },
              missingSignals: { type: 'array', items: { type: 'string' }, description: 'Expected missing signals' },
            },
          },
          resolution: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Resolution steps' },
              strategy: {
                type: 'string',
                enum: ['retry', 'fallback', 'fix-data', 'fix-code', 'ignore', 'escalate'],
              },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              codeHint: { type: 'string', description: 'Code fix hint' },
            },
            required: ['description', 'strategy'],
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        },
        required: ['id', 'name', 'pattern', 'resolution'],
      },
    },
    {
      name: 'sentinel_record',
      description: 'Manually record a new incident.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          error: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Error message' },
              stack: { type: 'string', description: 'Stack trace' },
              code: { type: 'string', description: 'Error code' },
              type: { type: 'string', description: 'Error type' },
            },
            required: ['message'],
          },
          symbols: {
            type: 'object',
            properties: {
              component: { type: 'string' },
              flow: { type: 'string' },
              gate: { type: 'string' },
              signal: { type: 'string' },
            },
          },
          environment: { type: 'string', description: 'Environment (required)' },
          service: { type: 'string', description: 'Service name' },
          version: { type: 'string', description: 'App version' },
          flowPosition: {
            type: 'object',
            properties: {
              flowId: { type: 'string' },
              expected: { type: 'array', items: { type: 'string' } },
              actual: { type: 'array', items: { type: 'string' } },
              missing: { type: 'array', items: { type: 'string' } },
              failedAt: { type: 'string' },
            },
          },
        },
        required: ['error', 'symbols', 'environment'],
      },
    },
    {
      name: 'sentinel_stats',
      description: 'Get statistics and health metrics.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          period: { type: 'string', description: 'Period: 1d, 7d, 30d, 90d (default: 7d)' },
          symbol: { type: 'string', description: 'Get health for specific symbol' },
        },
      },
    },
    {
      name: 'sentinel_suggest_pattern',
      description: 'Get AI suggestions for patterns based on incidents.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          incidentId: { type: 'string', description: 'Suggest from specific incident' },
          minOccurrences: { type: 'number', description: 'Min similar incidents for suggestion' },
        },
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// TOOL HANDLER
// ═══════════════════════════════════════════════════════════════════

async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const store = getStorage();
  const matcher = new PatternMatcher(store);

  switch (name) {
    case 'sentinel_triage': {
      const { symbol, status = 'all', environment, search, limit = 10 } = args as {
        symbol?: string;
        status?: string;
        environment?: string;
        search?: string;
        limit?: number;
      };

      const incidents = store.getRecentIncidents({
        limit,
        status: status as IncidentStatus | 'all',
        symbol,
        environment,
        search,
      });

      if (incidents.length === 0) {
        return JSON.stringify({
          count: 0,
          incidents: [],
          tip: 'No incidents recorded yet. Use sentinel_record to create incidents or integrate the SDK.',
        }, null, 2);
      }

      const results = incidents.map((incident) => {
        const matches = matcher.match(incident, { maxResults: 3 });
        return {
          id: incident.id,
          timestamp: incident.timestamp,
          status: incident.status,
          error: incident.error.message,
          symbols: incident.symbols,
          environment: incident.environment,
          matches: matches.map((m) => ({
            patternId: m.pattern.id,
            name: m.pattern.name,
            confidence: m.confidence,
            strategy: m.pattern.resolution.strategy,
            description: m.pattern.resolution.description,
          })),
        };
      });

      return JSON.stringify({ count: results.length, incidents: results }, null, 2);
    }

    case 'sentinel_show': {
      const { incidentId, includeTimeline, includeSimilar } = args as {
        incidentId: string;
        includeTimeline?: boolean;
        includeSimilar?: boolean;
      };

      const incident = store.getIncident(incidentId);
      if (!incident) {
        return JSON.stringify({ error: `Incident ${incidentId} not found` });
      }

      const matches = matcher.match(incident, { maxResults: 5 });
      const result: Record<string, unknown> = {
        incident,
        matches: matches.map((m) => ({
          patternId: m.pattern.id,
          name: m.pattern.name,
          confidence: m.confidence,
          matchedCriteria: m.matchedCriteria,
          resolution: m.pattern.resolution,
        })),
      };

      if (includeTimeline && incident.flowPosition) {
        const timeline = new TimelineBuilder().build(incident);
        if (timeline) {
          result.timeline = new TimelineBuilder().renderStructured(timeline);
        }
      }

      if (includeSimilar) {
        const similar = store
          .getRecentIncidents({ symbol: Object.values(incident.symbols)[0], limit: 5 })
          .filter((i) => i.id !== incidentId);
        result.similar = similar.map((i) => ({
          id: i.id,
          error: i.error.message,
          status: i.status,
        }));
      }

      return JSON.stringify(result, null, 2);
    }

    case 'sentinel_resolve': {
      const { incidentId, patternId, commitHash, prUrl, notes, wontFix } = args as {
        incidentId: string;
        patternId?: string;
        commitHash?: string;
        prUrl?: string;
        notes?: string;
        wontFix?: boolean;
      };

      const incident = store.getIncident(incidentId);
      if (!incident) {
        return JSON.stringify({ error: `Incident ${incidentId} not found` });
      }

      if (wontFix) {
        store.updateIncident(incidentId, {
          status: 'wont-fix',
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'manual',
          resolution: { notes },
        });
        return JSON.stringify({
          success: true,
          message: `Incident ${incidentId} marked as won't fix`,
        });
      }

      store.recordResolution({ incidentId, patternId, commitHash, prUrl, notes });

      return JSON.stringify({
        success: true,
        message: `Incident ${incidentId} resolved`,
        patternId,
        commitHash,
        prUrl,
      });
    }

    case 'sentinel_patterns': {
      const { symbol, minConfidence, source } = args as {
        symbol?: string;
        minConfidence?: number;
        source?: string;
      };

      const patterns = store.getAllPatterns({
        source: source as PatternSource | undefined,
        minConfidence,
        includePrivate: false,
      });

      let filtered = patterns;
      if (symbol) {
        filtered = patterns.filter((p) => {
          const symbols = p.pattern.symbols;
          return Object.values(symbols).some((v) => {
            if (!v) return false;
            if (Array.isArray(v)) return v.includes(symbol) || v.some((s) => symbol.match(s.replace('*', '.*')));
            return v === symbol || symbol.match(v.replace('*', '.*'));
          });
        });
      }

      return JSON.stringify(
        {
          count: filtered.length,
          patterns: filtered.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            confidence: p.confidence.score,
            resolution: p.resolution,
            tags: p.tags,
          })),
        },
        null,
        2
      );
    }

    case 'sentinel_add_pattern': {
      const { id, name, description, pattern, resolution, tags } = args as {
        id: string;
        name: string;
        description?: string;
        pattern: {
          symbols?: Record<string, string | string[]>;
          errorContains?: string[];
          missingSignals?: string[];
        };
        resolution: {
          description: string;
          strategy: string;
          priority?: string;
          codeHint?: string;
        };
        tags?: string[];
      };

      const input: CreatePatternInput = {
        id,
        name,
        description: description || '',
        pattern: {
          symbols: pattern.symbols || {},
          errorContains: pattern.errorContains,
          missingSignals: pattern.missingSignals,
        },
        resolution: {
          description: resolution.description,
          strategy: resolution.strategy as any,
          priority: (resolution.priority || 'medium') as any,
          codeHint: resolution.codeHint,
        },
        source: 'manual',
        private: false,
        tags: tags || [],
      };

      store.addPattern(input);

      return JSON.stringify({
        success: true,
        message: `Pattern ${id} created`,
        pattern: input,
      });
    }

    case 'sentinel_record': {
      const { error, symbols, environment, service, version, flowPosition } = args as {
        error: { message: string; stack?: string; code?: string; type?: string };
        symbols: Record<string, string | undefined>;
        environment: string;
        service?: string;
        version?: string;
        flowPosition?: {
          flowId: string;
          expected: string[];
          actual: string[];
          missing: string[];
          failedAt?: string;
        };
      };

      const incidentId = store.recordIncident({
        error,
        symbols,
        environment,
        service,
        version,
        flowPosition,
      });

      const incident = store.getIncident(incidentId);
      const matches = incident ? matcher.match(incident, { maxResults: 3 }) : [];

      return JSON.stringify(
        {
          success: true,
          incidentId,
          matches: matches.map((m) => ({
            patternId: m.pattern.id,
            confidence: m.confidence,
            resolution: m.pattern.resolution.description,
          })),
        },
        null,
        2
      );
    }

    case 'sentinel_stats': {
      const { period = '7d', symbol } = args as {
        period?: string;
        symbol?: string;
      };

      const calculator = new StatsCalculator(store);

      if (symbol) {
        const health = calculator.getSymbolHealth(symbol);
        return JSON.stringify({ symbol, health }, null, 2);
      }

      const match = period.match(/^(\d+)d$/);
      const periodDays = match ? parseInt(match[1], 10) : 7;
      const stats = calculator.getStats(periodDays);

      return JSON.stringify({ period: `${periodDays}d`, stats }, null, 2);
    }

    case 'sentinel_suggest_pattern': {
      const { incidentId, minOccurrences } = args as {
        incidentId?: string;
        minOccurrences?: number;
      };

      const suggester = new PatternSuggester(store);

      if (incidentId) {
        const incident = store.getIncident(incidentId);
        if (!incident) {
          return JSON.stringify({ error: `Incident ${incidentId} not found` });
        }

        const suggestion = suggester.suggestFromIncident(incident);
        return JSON.stringify({ source: 'incident', incidentId, suggestion }, null, 2);
      }

      const candidates = suggester.findPatternCandidates(minOccurrences || 3);
      return JSON.stringify(
        {
          source: 'analysis',
          candidates: candidates.slice(0, 5).map((c) => ({
            occurrences: c.occurrenceCount,
            sampleIncidents: c.incidents.slice(0, 3).map((i) => i.id),
            suggestion: c.suggestedPattern,
          })),
        },
        null,
        2
      );
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ═══════════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.error('[sentinel-mcp] Starting...');

  // Ensure storage is ready
  const store = getStorage();
  await store.ensureReady();
  console.error('[sentinel-mcp] Storage initialized');

  const server = new Server(
    { name: 'sentinel', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolsList(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await handleTool(name, (args as Record<string, unknown>) || {});
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  server.onerror = (error) => {
    console.error('[sentinel-mcp] Server error:', error);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[sentinel-mcp] Running on stdio');
}

main().catch((err) => {
  console.error('[sentinel-mcp] Fatal:', err);
  process.exit(1);
});
