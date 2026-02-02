/**
 * History MCP Resources - Expose implementation history as read-only resources
 *
 * Resources:
 * - paradigm://history/symbol/{symbol} - Full history for a symbol
 * - paradigm://history/symbol/{symbol}/recent - Last 5 changes only
 * - paradigm://history/fragile - List of fragile symbols
 * - paradigm://history/cochanges/{symbol} - Co-change patterns for a symbol
 * - paradigm://history/validation/summary - Validation statistics
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { ensureHistory } from '../utils/index-loader.js';
import { getSymbolHistory } from '../utils/history-loader.js';

/**
 * Get list of history resources
 */
export function getHistoryResourcesList() {
  return [
    {
      uri: 'paradigm://history/fragile',
      name: 'History - Fragile Symbols',
      description: 'Symbols with high fragility that need extra care when modifying',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://history/validation/summary',
      name: 'History - Validation Summary',
      description: 'Overall validation statistics and pass rates',
      mimeType: 'application/json',
    },
  ];
}

/**
 * Handle history resource reads
 */
export async function handleHistoryResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  // paradigm://history/symbol/{symbol}
  if (resourcePath.startsWith('history/symbol/') && !resourcePath.endsWith('/recent')) {
    const symbol = decodeURIComponent(resourcePath.replace('history/symbol/', ''));
    const history = await ensureHistory(ctx);
    const symbolHistory = getSymbolHistory(history, symbol);

    return {
      handled: true,
      text: JSON.stringify(
        {
          symbol,
          summary: symbolHistory.summary
            ? {
                total_changes: symbolHistory.summary.total_changes,
                last_modified: symbolHistory.summary.last_modified,
                stability_score: symbolHistory.summary.stability_score,
                fragility: symbolHistory.summary.fragility,
                contributors: symbolHistory.summary.contributors,
              }
            : null,
          recent: symbolHistory.recent,
          co_changes: symbolHistory.co_changes,
          validation: symbolHistory.validation,
        },
        null,
        2
      ),
    };
  }

  // paradigm://history/symbol/{symbol}/recent
  if (resourcePath.startsWith('history/symbol/') && resourcePath.endsWith('/recent')) {
    const symbol = decodeURIComponent(
      resourcePath.replace('history/symbol/', '').replace('/recent', '')
    );
    const history = await ensureHistory(ctx);
    const symbolHistory = getSymbolHistory(history, symbol);

    return {
      handled: true,
      text: JSON.stringify(
        {
          symbol,
          fragility: symbolHistory.summary?.fragility || 'unknown',
          stability_score: symbolHistory.summary?.stability_score,
          recent: symbolHistory.recent.slice(0, 5),
        },
        null,
        2
      ),
    };
  }

  // paradigm://history/fragile
  if (resourcePath === 'history/fragile') {
    const history = await ensureHistory(ctx);

    return {
      handled: true,
      text: JSON.stringify(
        {
          count: history.index?.fragile_symbols?.length || 0,
          fragile_symbols: history.index?.fragile_symbols || [],
          recommendation:
            'Consider adding extra test coverage and reviewing recent changes before modifying these symbols',
        },
        null,
        2
      ),
    };
  }

  // paradigm://history/cochanges/{symbol}
  if (resourcePath.startsWith('history/cochanges/')) {
    const symbol = decodeURIComponent(resourcePath.replace('history/cochanges/', ''));
    const history = await ensureHistory(ctx);

    const patterns =
      history.index?.co_changes?.filter((p) => p.symbols.includes(symbol)) || [];

    return {
      handled: true,
      text: JSON.stringify(
        {
          symbol,
          count: patterns.length,
          co_changes: patterns.map((p) => ({
            with: p.symbols.filter((s) => s !== symbol),
            frequency: p.frequency,
            correlation: p.correlation,
          })),
          recommendation:
            patterns.length > 0
              ? 'These symbols often change together - consider if they need updates too'
              : 'No strong co-change patterns detected',
        },
        null,
        2
      ),
    };
  }

  // paradigm://history/validation/summary
  if (resourcePath === 'history/validation/summary') {
    const history = await ensureHistory(ctx);

    return {
      handled: true,
      text: JSON.stringify(
        {
          last_run: history.validation?.last_run,
          total_validations: history.validation?.total_validations || 0,
          pass_rate: history.validation?.pass_rate || 0,
          by_symbol: history.validation?.by_symbol || {},
        },
        null,
        2
      ),
    };
  }

  return { handled: false, text: '' };
}
