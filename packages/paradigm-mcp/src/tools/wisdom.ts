/**
 * Wisdom MCP Tools - Actions AI can invoke on team wisdom
 *
 * Tools:
 * - paradigm_wisdom_context: Get relevant wisdom for symbols before implementing
 * - paradigm_wisdom_record: Record new preference/antipattern/decision
 * - paradigm_wisdom_expert: Find human experts for symbol/area
 */

import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { ensureWisdom } from '../utils/index-loader.js';
import {
  getWisdomForSymbols,
  findExperts,
  recordAntipattern,
  recordDecision,
  type ScopedAntipattern,
  type ScopedDecision,
} from '../utils/wisdom-loader.js';
import { loadLoreEntries, type LoreEntry } from '../utils/lore-loader.js';
import type { WisdomAntipattern, WisdomDecision } from '../types/wisdom.js';
import {
  recordGlobalAntipattern,
  recordGlobalDecision,
  loadGlobalAntipatterns,
  loadGlobalDecisions,
} from '../utils/global-store.js';
import { invalidateWisdomCache } from '../utils/wisdom-loader.js';
import { recordDecision as recordTeamDecision, writeCompanionLoreEntry } from '../utils/decision-loader.js';
import { log } from '../utils/mcp-logger.js';

// Session-scoped flag so the v6.0 deprecation warning fires at most once per
// MCP session (D3 locked — soft deprecation on wisdom, asymmetric to lore).
let wisdomDecisionDeprecationEmitted = false;

/**
 * Get list of wisdom tools
 */
export function getWisdomToolsList() {
  return [
    {
      name: 'paradigm_wisdom_context',
      description:
        'Get team wisdom (preferences, antipatterns, decisions) for symbols before implementing. Call this before making changes to understand team patterns. Returns preferences, antipatterns, and decisions relevant to the specified symbols. ~200 tokens.',
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_wisdom_record',
      description:
        'Record a new team learning: antipattern (what not to do) or decision (architectural choice). ~100 tokens.',
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
          scope: {
            type: 'string',
            enum: ['project', 'global'],
            description: 'Where to store: "project" (default) writes to .paradigm/wisdom/, "global" writes to ~/.paradigm/wisdom/',
          },
        },
        required: ['type', 'id', 'symbols'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_wisdom_promote',
      description: 'Promote a project-local antipattern or decision to global scope (~/.paradigm/wisdom/). Makes it available across all projects. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['antipattern', 'decision'],
            description: 'Type of wisdom to promote',
          },
          id: {
            type: 'string',
            description: 'ID of the antipattern or decision to promote',
          },
        },
        required: ['type', 'id'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_wisdom_promote',
      description: 'Promote a project-local antipattern or decision to global scope (~/.paradigm/wisdom/). Makes it available across all projects. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['antipattern', 'decision'],
            description: 'Type of wisdom to promote',
          },
          id: {
            type: 'string',
            description: 'ID of the antipattern or decision to promote',
          },
        },
        required: ['type', 'id'],
      },
    },
    {
      name: 'paradigm_wisdom_expert',
      description: 'Find human experts who know about specific symbols or areas. Returns names and contact info for relevant experts. ~100 tokens.',
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
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
            scope: (a as ScopedAntipattern).scope || 'project',
          })),
          decisions: sw.decisions.map((d) => ({
            id: d.id,
            title: d.title,
            status: d.status,
            decision: d.decision,
            scope: (d as ScopedDecision).scope || 'project',
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

      // Add calibration data from assessed lore entries
      try {
        const calibration: Record<string, { total: number; correct: number; partial: number; incorrect: number; avgConfidence: number | null }> = {};
        const calibration_warnings: string[] = [];

        for (const sym of symbols) {
          const assessed = await loadLoreEntries(ctx.rootDir, {
            symbol: sym,
            hasAssessment: true,
            limit: 100,
          });
          if (assessed.length === 0) continue;

          const breakdown = { correct: 0, partial: 0, incorrect: 0 };
          let confSum = 0;
          let confCount = 0;
          for (const e of assessed) {
            const v = e.assessment!.verdict;
            breakdown[v]++;
            if (e.confidence != null) {
              confSum += e.confidence;
              confCount++;
            }
          }

          calibration[sym] = {
            total: assessed.length,
            ...breakdown,
            avgConfidence: confCount > 0 ? Math.round(confSum / confCount * 1000) / 1000 : null,
          };

          // Warn on low accuracy (>30% incorrect with N>=3)
          const accuracyRate = (breakdown.correct + breakdown.partial * 0.5) / assessed.length;
          if (accuracyRate < 0.6 && assessed.length >= 3) {
            calibration_warnings.push(
              `Low historical accuracy for ${sym}: ${Math.round(accuracyRate * 100)}% across ${assessed.length} entries. Proceed with extra caution.`
            );
          }
        }

        if (Object.keys(calibration).length > 0) {
          result.calibration = calibration;
        }
        if (calibration_warnings.length > 0) {
          result.calibration_warnings = calibration_warnings;
        }
      } catch {
        // Calibration data is optional — don't fail the wisdom query
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
        scope: recordScope = 'project',
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
        scope?: 'project' | 'global';
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

        if (recordScope === 'global') {
          recordGlobalAntipattern(antipattern);
        } else {
          await recordAntipattern(ctx.rootDir, antipattern);
        }

        // Invalidate cache so merged wisdom is refreshed
        invalidateWisdomCache(ctx.rootDir);

        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            type: 'antipattern',
            id,
            scope: recordScope,
            message: `Antipattern recorded to ${recordScope} scope`,
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

        // v6.0 (D3 locked): route wisdom-decisions to the canonical
        // .paradigm/decisions/ stream store + emit a one-time-per-session
        // deprecation warning via the Paradigm logger. Keep wisdom write
        // as a fallback when recordScope === 'global' (global wisdom is
        // out of scope for the decision-store migration at v5.39.0).

        if (!wisdomDecisionDeprecationEmitted) {
          wisdomDecisionDeprecationEmitted = true;
          log.component('#wisdom').warn(
            'paradigm_wisdom_record({type:"decision"}) is deprecated. Use paradigm_decision_record instead.',
            {
              deprecation: 'v6.0',
              canonical_tool: 'paradigm_decision_record',
            },
          );
        }

        if (recordScope === 'global') {
          // Global wisdom decisions remain in the wisdom store for v5.39.0.
          const globalDec: WisdomDecision = {
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
          recordGlobalDecision(globalDec);
          invalidateWisdomCache(ctx.rootDir);
          return {
            handled: true,
            text: JSON.stringify({
              success: true,
              type: 'decision',
              id,
              scope: 'global',
              deprecation:
                'paradigm_wisdom_record({type:"decision"}) is deprecated; use paradigm_decision_record for project-scoped decisions.',
              message: 'Decision recorded to global scope',
            }),
          };
        }

        // Project scope → route to TD-streams store.
        const td = recordTeamDecision(ctx.rootDir, {
          title,
          decision: description,
          rationale: { factors: rationale.factors, conclusion: rationale.conclusion },
          participants: [{ id: 'wisdom-record', role: 'agent', stance: 'proposed' }],
          symbols_affected: symbols,
          status: (status === 'accepted' ? 'active' : status === 'proposed' ? 'proposed' : 'active'),
          context: reason || undefined,
          consequences,
          date: new Date().toISOString().split('T')[0],
          migrated_from: 'wisdom-decision',
        });

        const companionLoreId = writeCompanionLoreEntry(ctx.rootDir, td.id);
        invalidateWisdomCache(ctx.rootDir);

        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            type: 'decision',
            id: td.id,
            legacy_id: id,
            scope: 'project',
            deprecation:
              'paradigm_wisdom_record({type:"decision"}) is deprecated; use paradigm_decision_record going forward.',
            message: `Decision recorded (routed to decisions stream as ${td.id})`,
            ...(companionLoreId ? { companion_lore_id: companionLoreId } : {}),
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({ error: `Unknown type: ${type}` }),
      };
    }

    case 'paradigm_wisdom_promote': {
      const { type, id } = args as { type: 'antipattern' | 'decision'; id: string };
      const wisdom = await ensureWisdom(ctx);
      const projectName = path.basename(ctx.rootDir);

      if (type === 'antipattern') {
        const ap = wisdom.antipatterns.find(a => a.id === id);
        if (!ap) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Antipattern "${id}" not found in project` }),
          };
        }

        // Check if already exists globally
        const globalAps = loadGlobalAntipatterns();
        if (globalAps.some(g => g.id === id)) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Antipattern "${id}" already exists in global scope` }),
          };
        }

        recordGlobalAntipattern({
          ...ap,
          learned_from: `promoted from ${projectName}`,
        });

        invalidateWisdomCache(ctx.rootDir);

        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            type: 'antipattern',
            id,
            promoted_from: projectName,
            message: `Antipattern "${id}" promoted to global scope`,
          }),
        };
      }

      if (type === 'decision') {
        const dec = wisdom.decisions.find(d => d.id === id);
        if (!dec) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Decision "${id}" not found in project` }),
          };
        }

        // Check if already exists globally
        const globalDecs = loadGlobalDecisions();
        if (globalDecs.some(g => g.id === id)) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Decision "${id}" already exists in global scope` }),
          };
        }

        recordGlobalDecision(dec);
        invalidateWisdomCache(ctx.rootDir);

        return {
          handled: true,
          text: JSON.stringify({
            success: true,
            type: 'decision',
            id,
            promoted_from: projectName,
            message: `Decision "${id}" promoted to global scope`,
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
