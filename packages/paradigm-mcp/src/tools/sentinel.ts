/**
 * MCP Tools - Paradigm Sentinel Integration
 *
 * Provides AI agents with access to incident triage and pattern matching.
 *
 * ZERO-CONFIG: Auto-initializes sentinel storage and loads seed patterns on first use.
 */

import {
  SentinelStorage,
  PatternMatcher,
  TimelineBuilder,
  StatsCalculator,
  PatternSuggester,
  loadAllSeedPatterns,
} from '@a-company/sentinel';
import type {
  SymbolicIncidentRecord,
  PatternMatch,
  CreatePatternInput,
  IncidentStatus,
  PatternSource,
} from '@a-company/sentinel';
import type { ProjectContext } from '../utils/index-loader.js';

let storage: SentinelStorage | null = null;
let storageInitialized = false;

/**
 * Get or initialize sentinel storage
 * Lazy-initializes with seed patterns on first use
 */
function getStorage(ctx?: ProjectContext): SentinelStorage {
  if (!storage) {
    storage = new SentinelStorage();
  }

  // Load seed patterns on first use (idempotent)
  if (!storageInitialized) {
    try {
      const seedPatterns = loadAllSeedPatterns();
      for (const pattern of seedPatterns) {
        // Only add if pattern doesn't already exist
        try {
          storage.addPattern(pattern);
        } catch {
          // Pattern may already exist, ignore
        }
      }
      storageInitialized = true;
    } catch (e) {
      // Seed patterns are optional, continue without them
      storageInitialized = true;
    }
  }

  return storage;
}

/**
 * Get the list of Sentinel tools for MCP
 */
export function getSentinelToolsList() {
  return [
    {
      name: 'paradigm_sentinel_triage',
      description:
        'View and filter incidents with pattern matches. Returns recent errors with symbolic context and resolution suggestions. ~200-400 tokens depending on incident count.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Filter by symbol (e.g., @checkout, ^auth)',
          },
          status: {
            type: 'string',
            enum: ['open', 'investigating', 'resolved', 'wont-fix', 'all'],
            description: 'Filter by status (default: all)',
          },
          environment: {
            type: 'string',
            description: 'Filter by environment',
          },
          search: {
            type: 'string',
            description: 'Search in error messages',
          },
          limit: {
            type: 'number',
            description: 'Max results (default: 10)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_show',
      description:
        'Get full details of a specific incident including timeline and matched patterns. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          incidentId: {
            type: 'string',
            description: 'Incident ID (e.g., INC-001)',
          },
          includeTimeline: {
            type: 'boolean',
            description: 'Include flow timeline',
          },
          includeSimilar: {
            type: 'boolean',
            description: 'Include similar incidents',
          },
        },
        required: ['incidentId'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_resolve',
      description:
        'Mark an incident as resolved with optional pattern and commit reference. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          incidentId: { type: 'string', description: 'Incident ID' },
          patternId: {
            type: 'string',
            description: 'Pattern that led to resolution',
          },
          commitHash: { type: 'string', description: 'Fix commit hash' },
          prUrl: { type: 'string', description: 'PR URL' },
          notes: { type: 'string', description: 'Resolution notes' },
          wontFix: {
            type: 'boolean',
            description: 'Mark as wont-fix instead of resolved',
          },
        },
        required: ['incidentId'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_patterns',
      description: 'List and filter failure patterns with confidence scores. Returns pattern names, match counts, and confidence scores. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Filter patterns for this symbol',
          },
          minConfidence: {
            type: 'number',
            description: 'Minimum confidence score',
          },
          source: {
            type: 'string',
            enum: ['manual', 'suggested', 'imported', 'community'],
            description: 'Filter by source',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_add_pattern',
      description: 'Create a new failure pattern. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pattern ID (kebab-case)' },
          name: { type: 'string', description: 'Human-readable name' },
          description: { type: 'string', description: 'What this pattern matches' },
          pattern: {
            type: 'object',
            properties: {
              symbols: { type: 'object', description: 'Symbol criteria' },
              errorContains: {
                type: 'array',
                items: { type: 'string' },
                description: 'Error keywords',
              },
              missingSignals: {
                type: 'array',
                items: { type: 'string' },
                description: 'Expected missing signals',
              },
            },
          },
          resolution: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Resolution steps' },
              strategy: {
                type: 'string',
                enum: [
                  'retry',
                  'fallback',
                  'fix-data',
                  'fix-code',
                  'ignore',
                  'escalate',
                ],
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
              },
              codeHint: { type: 'string', description: 'Code fix hint' },
            },
            required: ['description', 'strategy'],
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization',
          },
        },
        required: ['id', 'name', 'pattern', 'resolution'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_record',
      description: 'Manually record a new incident. ~100 tokens.',
      inputSchema: {
        type: 'object',
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
              feature: { type: 'string' },
              component: { type: 'string' },
              flow: { type: 'string' },
              gate: { type: 'string' },
              signal: { type: 'string' },
              state: { type: 'string' },
              integration: { type: 'string' },
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_stats',
      description: 'Get statistics and health metrics. Returns open/resolved counts, MTTR, and symbol breakdown. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Period: 1d, 7d, 30d, 90d (default: 7d)',
          },
          symbol: {
            type: 'string',
            description: 'Get health for specific symbol',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_sentinel_suggest_pattern',
      description: 'Get AI suggestions for patterns based on incidents. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          incidentId: {
            type: 'string',
            description: 'Suggest from specific incident',
          },
          minOccurrences: {
            type: 'number',
            description: 'Min similar incidents for suggestion',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    // ─── Observability Tools ──────────────────────────────────────
    {
      name: 'paradigm_sentinel_logs',
      description: 'Query structured logs from connected apps. Filters by level, symbol, service, search text, time range. ~200-400 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Filter by log level' },
          symbol: { type: 'string', description: 'Filter by symbol (partial match)' },
          service: { type: 'string', description: 'Filter by service name' },
          search: { type: 'string', description: 'Search in log messages' },
          since: { type: 'string', description: 'ISO timestamp — logs after this time' },
          sessionId: { type: 'string', description: 'Filter by session ID' },
          correlationId: { type: 'string', description: 'Filter by correlation ID' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_services',
      description: 'List all registered services with version, environment, and last-seen time. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_app_state',
      description: 'Get live app state snapshots. Shows current state, active flows, and held gates for connected services. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Filter by service name' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_validate_symbol',
      description: 'Check if a symbol exists in the project index. Returns known/unknown status with suggestions for typos. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol to validate (e.g., #checkout, ^auth)' },
        },
        required: ['symbol'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_flow_activity',
      description: 'Get recent flow events — which flow nodes were hit, in what order, by which service. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          flowId: { type: 'string', description: 'Filter by flow ID (e.g., $checkout-flow)' },
          service: { type: 'string', description: 'Filter by service name' },
          since: { type: 'string', description: 'ISO timestamp — events after this time' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    // ─── Metrics + Traces ─────────────────────────────────────────
    {
      name: 'paradigm_sentinel_metrics',
      description: 'Query metrics (counters, gauges, histograms) from connected apps. Supports filtering and aggregation. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Metric name filter' },
          type: { type: 'string', enum: ['counter', 'gauge', 'histogram'], description: 'Metric type filter' },
          service: { type: 'string', description: 'Service name filter' },
          since: { type: 'string', description: 'ISO timestamp — metrics after this time' },
          aggregate: { type: 'boolean', description: 'If true and name is provided, return aggregation (count/sum/min/max/avg) instead of raw data' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_traces',
      description: 'Query distributed traces across services. Shows span trees with timing, status, and service hops. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          traceId: { type: 'string', description: 'Get a specific trace by ID' },
          service: { type: 'string', description: 'Filter by service name' },
          symbol: { type: 'string', description: 'Filter by symbol' },
          since: { type: 'string', description: 'ISO timestamp — traces after this time' },
          limit: { type: 'number', description: 'Max traces (default: 10, max: 20)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    // ─── Schema-Driven Observability ──────────────────────────────
    {
      name: 'paradigm_sentinel_schemas',
      description: 'List or get registered event schemas. Schemas define event types, scopes, causality, and visualization for application-agnostic observability. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Get a specific schema by ID. Omit to list all.' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_events',
      description: 'Query generic events from any registered schema. Filters by schema, event type, category, scope, service, severity, time range. ~200-400 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          schemaId: { type: 'string', description: 'Filter by schema ID (e.g., "pretend-engine")' },
          eventType: { type: 'string', description: 'Filter by event type (e.g., "rule:fire")' },
          category: { type: 'string', description: 'Filter by category (e.g., "rules")' },
          service: { type: 'string', description: 'Filter by service name' },
          scopeValue: { type: 'string', description: 'Filter by scope value (e.g., frame number)' },
          severity: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Filter by severity' },
          since: { type: 'string', description: 'ISO timestamp — events after this time' },
          search: { type: 'string', description: 'Full-text search in event data' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_sentinel_scopes',
      description: 'Get scope summaries for a schema — e.g., frame list with event counts, request list with category breakdown. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          schemaId: { type: 'string', description: 'Schema ID (required)' },
          sessionId: { type: 'string', description: 'Filter by session ID' },
          limit: { type: 'number', description: 'Max scopes (default: 50)' },
        },
        required: ['schemaId'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

/**
 * Handle Sentinel tool calls
 */
export async function handleSentinelTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  const store = getStorage(ctx);
  const matcher = new PatternMatcher(store);

  switch (name) {
    case 'paradigm_sentinel_triage': {
      const {
        symbol,
        status = 'all',
        environment,
        search,
        limit = 10,
      } = args as {
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

      // Return helpful message if no incidents
      if (incidents.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            incidents: [],
            tip: 'No incidents recorded yet. Incidents are created when errors occur in production or via paradigm_sentinel_record.',
            howToRecord: {
              description: 'Record incidents manually with paradigm_sentinel_record',
              example: {
                error: { message: 'Connection timeout', code: 'ETIMEDOUT' },
                symbols: { feature: '@checkout', integration: '&stripe' },
                environment: 'production',
              },
            },
          }, null, 2),
        };
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

      return {
        handled: true,
        text: JSON.stringify(
          {
            count: results.length,
            incidents: results,
          },
          null,
          2
        ),
      };
    }

    case 'paradigm_sentinel_show': {
      const { incidentId, includeTimeline, includeSimilar } = args as {
        incidentId: string;
        includeTimeline?: boolean;
        includeSimilar?: boolean;
      };

      const incident = store.getIncident(incidentId);
      if (!incident) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Incident ${incidentId} not found` }),
        };
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

      return {
        handled: true,
        text: JSON.stringify(result, null, 2),
      };
    }

    case 'paradigm_sentinel_resolve': {
      const { incidentId, patternId, commitHash, prUrl, notes, wontFix } =
        args as {
          incidentId: string;
          patternId?: string;
          commitHash?: string;
          prUrl?: string;
          notes?: string;
          wontFix?: boolean;
        };

      const incident = store.getIncident(incidentId);
      if (!incident) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Incident ${incidentId} not found` }),
        };
      }

      if (wontFix) {
        store.updateIncident(incidentId, {
          status: 'wont-fix',
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'manual',
          resolution: { notes },
        });
        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            message: `Incident ${incidentId} marked as won't fix`,
          }),
        };
      }

      store.recordResolution({
        incidentId,
        patternId,
        commitHash,
        prUrl,
        notes,
      });

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          message: `Incident ${incidentId} resolved`,
          patternId,
          commitHash,
          prUrl,
        }),
      };
    }

    case 'paradigm_sentinel_patterns': {
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

      // Filter by symbol if specified
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

      return {
        handled: true,
        text: JSON.stringify(
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
        ),
      };
    }

    case 'paradigm_sentinel_add_pattern': {
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

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          message: `Pattern ${id} created`,
          pattern: input,
        }),
      };
    }

    case 'paradigm_sentinel_record': {
      const { error, symbols, environment, service, version, flowPosition } =
        args as {
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

      return {
        handled: true,
        text: JSON.stringify(
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
        ),
      };
    }

    case 'paradigm_sentinel_stats': {
      const { period = '7d', symbol } = args as {
        period?: string;
        symbol?: string;
      };

      const calculator = new StatsCalculator(store);

      if (symbol) {
        const health = calculator.getSymbolHealth(symbol);
        return {
          handled: true,
          text: JSON.stringify(
            {
              symbol,
              health,
            },
            null,
            2
          ),
        };
      }

      const match = period.match(/^(\d+)d$/);
      const periodDays = match ? parseInt(match[1], 10) : 7;
      const stats = calculator.getStats(periodDays);

      return {
        handled: true,
        text: JSON.stringify(
          {
            period: `${periodDays}d`,
            stats,
          },
          null,
          2
        ),
      };
    }

    case 'paradigm_sentinel_suggest_pattern': {
      const { incidentId, minOccurrences } = args as {
        incidentId?: string;
        minOccurrences?: number;
      };

      const suggester = new PatternSuggester(store);

      if (incidentId) {
        const incident = store.getIncident(incidentId);
        if (!incident) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Incident ${incidentId} not found` }),
          };
        }

        const suggestion = suggester.suggestFromIncident(incident);
        return {
          handled: true,
          text: JSON.stringify(
            {
              source: 'incident',
              incidentId,
              suggestion,
            },
            null,
            2
          ),
        };
      }

      const candidates = suggester.findPatternCandidates(minOccurrences || 3);
      return {
        handled: true,
        text: JSON.stringify(
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
        ),
      };
    }

    // ─── Observability Tools ──────────────────────────────────────

    case 'paradigm_sentinel_logs': {
      const { level, symbol, service, search, since, sessionId, correlationId, limit = 50 } = args as {
        level?: string;
        symbol?: string;
        service?: string;
        search?: string;
        since?: string;
        sessionId?: string;
        correlationId?: string;
        limit?: number;
      };

      const logs = store.queryLogs({
        level: level as any,
        symbol,
        service,
        search,
        since,
        sessionId,
        correlationId,
        limit,
      });

      const total = store.getLogCount({ level: level as any, symbol, service, since });

      return {
        handled: true,
        text: JSON.stringify({
          count: logs.length,
          total,
          logs: logs.map((l) => ({
            timestamp: l.timestamp,
            level: l.level,
            symbol: l.symbol,
            service: l.service,
            message: l.message,
            data: l.data,
            sessionId: l.sessionId,
            correlationId: l.correlationId,
            durationMs: l.durationMs,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_services': {
      const services = store.getServices();

      return {
        handled: true,
        text: JSON.stringify({
          count: services.length,
          services: services.map((s) => ({
            name: s.name,
            version: s.version,
            environment: s.environment,
            lastSeen: s.lastSeenAt,
            startedAt: s.startedAt,
            pid: s.pid,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_app_state': {
      const { service: svc } = args as { service?: string };

      const states = svc ? store.getAppState(svc) : store.getAllAppStates();

      return {
        handled: true,
        text: JSON.stringify({
          states: states.map((s) => ({
            service: s.service,
            sessionId: s.sessionId,
            state: s.state,
            activeFlows: s.activeFlows,
            activeGates: s.activeGates,
            timestamp: s.timestamp,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_validate_symbol': {
      const { symbol: sym } = args as { symbol: string };

      // Check against stored logs to see if it's been used
      const logCount = store.getLogCount({ symbol: sym });

      return {
        handled: true,
        text: JSON.stringify({
          symbol: sym,
          usedInLogs: logCount > 0,
          logCount,
          tip: logCount === 0
            ? 'This symbol has not appeared in any logs. It may be a typo or unused.'
            : `This symbol has been used in ${logCount} log entries.`,
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_flow_activity': {
      const { flowId, service: flowSvc, since: flowSince } = args as {
        flowId?: string;
        service?: string;
        since?: string;
      };

      // Query logs that are flow/signal/gate type
      const flowLogs = store.queryLogs({
        symbol: flowId,
        service: flowSvc,
        since: flowSince,
        limit: 100,
      });

      // Filter to flow-related entries
      const flowEvents = flowLogs
        .filter((l) => ['flow', 'signal', 'gate'].includes(l.symbolType))
        .map((l) => ({
          timestamp: l.timestamp,
          symbol: l.symbol,
          symbolType: l.symbolType,
          service: l.service,
          message: l.message,
          level: l.level,
        }));

      return {
        handled: true,
        text: JSON.stringify({
          count: flowEvents.length,
          events: flowEvents,
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_metrics': {
      const { name: metricName, type: metricType, service: metricSvc, since: metricSince, aggregate, limit: metricLimit } = args as {
        name?: string;
        type?: string;
        service?: string;
        since?: string;
        aggregate?: boolean;
        limit?: number;
      };

      // Aggregation mode
      if (aggregate && metricName) {
        const agg = store.aggregateMetric(metricName, {
          service: metricSvc,
          since: metricSince,
        });
        return {
          handled: true,
          text: JSON.stringify(agg, null, 2),
        };
      }

      // Raw query mode
      const metrics = store.queryMetrics({
        name: metricName,
        type: metricType as any,
        service: metricSvc,
        since: metricSince,
        limit: Math.min(metricLimit || 50, 100),
      });

      return {
        handled: true,
        text: JSON.stringify({
          count: metrics.length,
          metrics: metrics.map((m) => ({
            timestamp: m.timestamp,
            name: m.name,
            type: m.type,
            value: m.value,
            tags: m.tags,
            service: m.service,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_traces': {
      const { traceId: tid, service: traceSvc, symbol: traceSym, since: traceSince, limit: traceLimit } = args as {
        traceId?: string;
        service?: string;
        symbol?: string;
        since?: string;
        limit?: number;
      };

      // Single trace lookup
      if (tid) {
        const trace = store.getTrace(tid);
        if (!trace) {
          return { handled: true, text: JSON.stringify({ error: 'Trace not found' }) };
        }
        return { handled: true, text: JSON.stringify(trace, null, 2) };
      }

      // Query traces
      const traces = store.queryTraces({
        service: traceSvc,
        symbol: traceSym,
        since: traceSince,
        limit: Math.min(traceLimit || 10, 20),
      });

      return {
        handled: true,
        text: JSON.stringify({
          count: traces.length,
          traces: traces.map((t) => ({
            traceId: t.traceId,
            services: t.services,
            spanCount: t.spans.length,
            totalDurationMs: t.totalDurationMs,
            startTime: t.startTime,
            endTime: t.endTime,
          })),
        }, null, 2),
      };
    }

    // ─── Schema-Driven Observability ──────────────────────────────
    // Note: cast to any for new v3.6 methods until types are rebuilt

    case 'paradigm_sentinel_schemas': {
      const { id: schemaId } = args as { id?: string };

      if (schemaId) {
        const schema = (store as any).getSchema(schemaId);
        if (!schema) {
          return { handled: true, text: JSON.stringify({ error: `Schema "${schemaId}" not found` }) };
        }
        return { handled: true, text: JSON.stringify(schema, null, 2) };
      }

      const schemas = (store as any).listSchemas();
      if (schemas.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            schemas: [],
            tip: 'No event schemas registered yet. Applications register schemas via POST /api/schemas or SentinelWebClient.registerSchema().',
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          count: schemas.length,
          schemas: schemas.map((s: any) => ({
            id: s.id,
            version: s.version,
            name: s.name,
            description: s.description,
            eventTypeCount: s.eventTypes.length,
            scope: s.scope.label,
            tags: s.tags,
            registeredAt: s.registeredAt,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_events': {
      const {
        schemaId: evSchemaId,
        eventType: evType,
        category: evCategory,
        service: evService,
        scopeValue: evScope,
        severity: evSeverity,
        since: evSince,
        search: evSearch,
        limit: evLimit,
      } = args as {
        schemaId?: string;
        eventType?: string;
        category?: string;
        service?: string;
        scopeValue?: string;
        severity?: string;
        since?: string;
        search?: string;
        limit?: number;
      };

      const events = (store as any).queryEvents({
        schemaId: evSchemaId,
        eventType: evType,
        category: evCategory,
        service: evService,
        scopeValue: evScope,
        severity: evSeverity,
        since: evSince,
        search: evSearch,
        limit: Math.min(evLimit || 50, 100),
      });

      if (events.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            events: [],
            tip: 'No events found. Events are ingested via POST /api/events or SentinelWebClient.emit().',
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          count: events.length,
          events: events.map((e: any) => ({
            id: e.id,
            schemaId: e.schemaId,
            eventType: e.eventType,
            category: e.category,
            timestamp: e.timestamp,
            scopeValue: e.scopeValue,
            service: e.service,
            severity: e.severity,
            data: e.data,
            parentEventId: e.parentEventId,
            depth: e.depth,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_sentinel_scopes': {
      const { schemaId: scopeSchemaId, sessionId: scopeSession, limit: scopeLimit } = args as {
        schemaId: string;
        sessionId?: string;
        limit?: number;
      };

      const scopes = (store as any).getEventScopes(scopeSchemaId, {
        limit: Math.min(scopeLimit || 50, 200),
        sessionId: scopeSession,
      });

      if (scopes.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            scopes: [],
            tip: `No scopes found for schema "${scopeSchemaId}". Events with scope values are required.`,
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          count: scopes.length,
          scopes,
        }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
