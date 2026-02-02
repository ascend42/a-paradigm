/**
 * History MCP Tools - Actions AI can invoke on implementation history
 *
 * Tools:
 * - paradigm_history_context: Get history for symbols before modifying
 * - paradigm_history_record: Record implementation event
 * - paradigm_history_validate: Record validation result
 * - paradigm_history_fragility: Check fragility before modifying
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { ensureHistory } from '../utils/index-loader.js';
import {
  getHistoryForSymbols,
  checkFragility,
  recordHistoryEntry,
  recordValidation,
} from '../utils/history-loader.js';
import type { HistoryEntryType, HistoryIntent, AuthorType } from '../types/history.js';

/**
 * Get list of history tools
 */
export function getHistoryToolsList() {
  return [
    {
      name: 'paradigm_history_context',
      description:
        'Get implementation history for symbols before modifying. Shows recent changes, stability, and who has worked on these areas.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols to get history for (e.g., ["@checkout", "#payment-form"])',
          },
        },
        required: ['symbols'],
      },
    },
    {
      name: 'paradigm_history_record',
      description:
        'Record an implementation event (feature, fix, refactor). Call this after making changes to track what was done.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['implement', 'refactor', 'rollback'],
            description: 'Type of change',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols affected by this change',
          },
          intent: {
            type: 'string',
            enum: ['feature', 'fix', 'refactor', 'experimental', 'confirmed'],
            description: 'Intent of the change',
          },
          description: {
            type: 'string',
            description: 'What was done',
          },
          commit: {
            type: 'string',
            description: 'Git commit hash (optional)',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files affected (optional)',
          },
          reason: {
            type: 'string',
            description: 'Reason for rollback (if type is rollback)',
          },
        },
        required: ['type', 'symbols', 'description'],
      },
    },
    {
      name: 'paradigm_history_validate',
      description:
        'Record a validation result (tests passed/failed). Call this after running tests.',
      inputSchema: {
        type: 'object',
        properties: {
          implementation_id: {
            type: 'string',
            description: 'ID of the implementation being validated (from paradigm_history_record)',
          },
          result: {
            type: 'string',
            enum: ['pass', 'fail', 'partial'],
            description: 'Validation result',
          },
          tests: {
            type: 'object',
            properties: {
              passed: { type: 'number' },
              failed: { type: 'number' },
              skipped: { type: 'number' },
            },
            description: 'Test counts',
          },
        },
        required: ['result'],
      },
    },
    {
      name: 'paradigm_history_fragility',
      description:
        'Check fragility of symbols before modifying. Returns stability scores and warnings for fragile areas.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols to check fragility for',
          },
        },
        required: ['symbols'],
      },
    },
  ];
}

/**
 * Handle history tool calls
 */
export async function handleHistoryTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_history_context': {
      const { symbols } = args as { symbols: string[] };

      const history = await ensureHistory(ctx);
      const symbolHistories = getHistoryForSymbols(history, symbols);

      const result = {
        symbols,
        history: symbolHistories.map((sh) => ({
          symbol: sh.symbol,
          summary: sh.summary
            ? {
                total_changes: sh.summary.total_changes,
                last_modified: sh.summary.last_modified,
                stability_score: sh.summary.stability_score,
                fragility: sh.summary.fragility,
                contributors: sh.summary.contributors,
              }
            : null,
          recent: sh.recent.slice(0, 3).map((e) => ({
            type: e.type,
            description: e.description,
            author: e.author,
            ts: e.ts,
          })),
          co_changes: sh.co_changes.slice(0, 5),
        })),
        summary: {
          total_symbols: symbols.length,
          with_history: symbolHistories.filter((sh) => sh.summary).length,
          fragile_count: symbolHistories.filter(
            (sh) =>
              sh.summary?.fragility === 'high' || sh.summary?.fragility === 'critical'
          ).length,
        },
      };

      return {
        handled: true,
        text: JSON.stringify(result, null, 2),
      };
    }

    case 'paradigm_history_record': {
      const { type, symbols, intent, description, commit, files, reason } = args as {
        type: HistoryEntryType;
        symbols: string[];
        intent?: HistoryIntent;
        description: string;
        commit?: string;
        files?: string[];
        reason?: string;
      };

      const id = await recordHistoryEntry(ctx.rootDir, {
        type,
        symbols,
        author: { type: 'agent' as AuthorType, id: 'claude' },
        intent,
        description,
        commit,
        files,
        reason,
      });

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          id,
          type,
          symbols,
          message: 'History entry recorded successfully',
          note: 'Run paradigm history reindex to update the index after multiple entries',
        }),
      };
    }

    case 'paradigm_history_validate': {
      const { implementation_id, result, tests } = args as {
        implementation_id?: string;
        result: 'pass' | 'fail' | 'partial';
        tests?: { passed: number; failed: number; skipped?: number };
      };

      const id = await recordValidation(
        ctx.rootDir,
        implementation_id || 'unknown',
        result,
        tests
      );

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          id,
          result,
          tests,
          message: 'Validation recorded successfully',
        }),
      };
    }

    case 'paradigm_history_fragility': {
      const { symbols } = args as { symbols: string[] };

      const history = await ensureHistory(ctx);
      const check = checkFragility(history, symbols);

      return {
        handled: true,
        text: JSON.stringify({
          symbols,
          safe_to_modify: check.safe_to_modify,
          fragile: check.fragile.map((f) => ({
            symbol: f.symbol,
            fragility: f.fragility,
            reason: f.reason,
          })),
          warnings: check.warnings,
          recommendations: check.recommendations,
          summary:
            check.fragile.length === 0
              ? 'All symbols are stable - safe to proceed'
              : check.safe_to_modify
              ? 'Some fragile symbols detected - proceed with extra testing'
              : 'Critical fragility detected - consider deferring changes or adding extensive tests',
        }),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
