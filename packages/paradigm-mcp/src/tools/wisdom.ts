/**
 * Wisdom MCP Tools - Actions AI can invoke on team wisdom
 *
 * Tools:
 * - paradigm_wisdom_context: Get relevant wisdom for symbols before implementing
 * - paradigm_wisdom_record: Record new preference/antipattern/decision
 * - paradigm_wisdom_expert: Find human experts for symbol/area
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { ensureWisdom } from '../utils/index-loader.js';
import {
  getWisdomForSymbols,
  findExperts,
  recordAntipattern,
  recordDecision,
} from '../utils/wisdom-loader.js';
import type { WisdomAntipattern, WisdomDecision } from '../types/wisdom.js';

/**
 * Get list of wisdom tools
 */
export function getWisdomToolsList() {
  return [
    {
      name: 'paradigm_wisdom_context',
      description:
        'Get team wisdom (preferences, antipatterns, decisions) for symbols before implementing. Call this before making changes to understand team patterns.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols to get wisdom for (e.g., ["@checkout", "#payment-form"])',
          },
          include_global: {
            type: 'boolean',
            description: 'Include global preferences (default: true)',
          },
        },
        required: ['symbols'],
      },
    },
    {
      name: 'paradigm_wisdom_record',
      description:
        'Record a new team learning: antipattern (what not to do) or decision (architectural choice)',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['antipattern', 'decision'],
            description: 'Type of wisdom to record',
          },
          // Antipattern fields
          id: {
            type: 'string',
            description: 'Unique ID (for antipattern: e.g., "api-001", for decision: e.g., "001")',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Related symbols',
          },
          description: {
            type: 'string',
            description: 'What not to do (antipattern) or the decision made (decision)',
          },
          reason: {
            type: 'string',
            description: 'Why this is an antipattern / context for decision',
          },
          alternative: {
            type: 'string',
            description: 'What to do instead (for antipatterns)',
          },
          // Decision-specific fields
          title: {
            type: 'string',
            description: 'Decision title (for decisions)',
          },
          status: {
            type: 'string',
            enum: ['proposed', 'accepted', 'deprecated', 'superseded'],
            description: 'Decision status (for decisions)',
          },
          rationale: {
            type: 'object',
            properties: {
              factors: {
                type: 'array',
                items: { type: 'string' },
              },
              conclusion: { type: 'string' },
            },
            description: 'Decision rationale (for decisions)',
          },
          consequences: {
            type: 'object',
            properties: {
              positive: {
                type: 'array',
                items: { type: 'string' },
              },
              negative: {
                type: 'array',
                items: { type: 'string' },
              },
              mitigations: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            description: 'Expected consequences (for decisions)',
          },
        },
        required: ['type', 'id', 'symbols'],
      },
    },
    {
      name: 'paradigm_wisdom_expert',
      description: 'Find human experts who know about specific symbols or areas',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Symbol to find experts for (e.g., "@checkout")',
          },
          area: {
            type: 'string',
            description: 'General area to find experts for (e.g., "payments", "auth")',
          },
        },
      },
    },
  ];
}

/**
 * Handle wisdom tool calls
 */
export async function handleWisdomTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_wisdom_context': {
      const { symbols, include_global = true } = args as {
        symbols: string[];
        include_global?: boolean;
      };

      const wisdom = await ensureWisdom(ctx);
      const symbolWisdoms = getWisdomForSymbols(wisdom, symbols);

      const result: Record<string, unknown> = {
        symbols,
        wisdom: symbolWisdoms.map((sw) => ({
          symbol: sw.symbol,
          preferences: sw.preferences,
          antipatterns: sw.antipatterns.map((a) => ({
            id: a.id,
            description: a.description,
            reason: a.reason,
            alternative: a.alternative,
          })),
          decisions: sw.decisions.map((d) => ({
            id: d.id,
            title: d.title,
            status: d.status,
            decision: d.decision,
          })),
          experts: sw.experts.map((e) => e.name),
        })),
      };

      if (include_global && wisdom.preferences?.global) {
        result.global_preferences = wisdom.preferences.global;
      }

      // Add summary
      const totalAntipatterns = symbolWisdoms.reduce(
        (sum, sw) => sum + sw.antipatterns.length,
        0
      );
      const totalDecisions = symbolWisdoms.reduce(
        (sum, sw) => sum + sw.decisions.length,
        0
      );

      result.summary = {
        symbols_with_preferences: symbolWisdoms.filter((sw) => sw.preferences).length,
        total_antipatterns: totalAntipatterns,
        total_decisions: totalDecisions,
        has_experts: symbolWisdoms.some((sw) => sw.experts.length > 0),
      };

      if (totalAntipatterns > 0) {
        result.warning =
          'There are antipatterns for these symbols - review before implementing';
      }

      return {
        handled: true,
        text: JSON.stringify(result, null, 2),
      };
    }

    case 'paradigm_wisdom_record': {
      const {
        type,
        id,
        symbols,
        description,
        reason,
        alternative,
        title,
        status,
        rationale,
        consequences,
      } = args as {
        type: 'antipattern' | 'decision';
        id: string;
        symbols: string[];
        description?: string;
        reason?: string;
        alternative?: string;
        title?: string;
        status?: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
        rationale?: { factors: string[]; conclusion: string };
        consequences?: { positive: string[]; negative: string[]; mitigations?: string[] };
      };

      if (type === 'antipattern') {
        if (!description || !reason || !alternative) {
          return {
            handled: true,
            text: JSON.stringify({
              error: 'Antipattern requires description, reason, and alternative',
            }),
          };
        }

        const antipattern: Omit<WisdomAntipattern, 'added'> = {
          id,
          symbols,
          description,
          reason,
          alternative,
        };

        await recordAntipattern(ctx.rootDir, antipattern);

        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            type: 'antipattern',
            id,
            message: 'Antipattern recorded successfully',
          }),
        };
      }

      if (type === 'decision') {
        if (!title || !description || !rationale || !consequences) {
          return {
            handled: true,
            text: JSON.stringify({
              error:
                'Decision requires title, description (as the decision), rationale, and consequences',
            }),
          };
        }

        const decision: WisdomDecision = {
          id,
          title,
          status: status || 'proposed',
          date: new Date().toISOString().split('T')[0],
          symbols,
          context: reason || '',
          decision: description,
          rationale,
          consequences,
        };

        await recordDecision(ctx.rootDir, decision);

        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            type: 'decision',
            id,
            message: 'Decision recorded successfully',
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({ error: `Unknown type: ${type}` }),
      };
    }

    case 'paradigm_wisdom_expert': {
      const { symbol, area } = args as { symbol?: string; area?: string };

      if (!symbol && !area) {
        return {
          handled: true,
          text: JSON.stringify({
            error: 'Either symbol or area is required',
          }),
        };
      }

      const wisdom = await ensureWisdom(ctx);
      const experts = findExperts(wisdom, { symbol, area });

      return {
        handled: true,
        text: JSON.stringify({
          query: { symbol, area },
          count: experts.length,
          experts: experts.map((e) => ({
            name: e.name,
            symbols: e.symbols,
            areas: e.areas,
            contact: e.contact,
            notes: e.notes,
          })),
          suggestion:
            experts.length > 0
              ? 'Consider reaching out to these experts before making significant changes'
              : 'No experts found - consider documenting expertise when this area is worked on',
        }),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
