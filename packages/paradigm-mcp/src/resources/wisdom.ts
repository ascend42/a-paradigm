/**
 * Wisdom MCP Resources - Expose team wisdom as read-only resources
 *
 * Resources:
 * - paradigm://wisdom/preferences - All preferences
 * - paradigm://wisdom/preferences/{symbol} - Symbol-specific preferences
 * - paradigm://wisdom/antipatterns - All antipatterns
 * - paradigm://wisdom/antipatterns/{symbol} - Symbol-specific antipatterns
 * - paradigm://wisdom/decisions - ADR index (summaries only)
 * - paradigm://wisdom/decision/{id} - Full ADR by ID
 * - paradigm://wisdom/expertise/{symbol} - Experts for a symbol
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { ensureWisdom } from '../utils/index-loader.js';
import { getSymbolWisdom, findExperts } from '../utils/wisdom-loader.js';

/**
 * Get list of wisdom resources
 */
export function getWisdomResourcesList() {
  return [
    {
      uri: 'paradigm://wisdom/preferences',
      name: 'Wisdom - Preferences',
      description: 'Team preferences for patterns, testing, and code style',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://wisdom/antipatterns',
      name: 'Wisdom - Antipatterns',
      description: 'What NOT to do, with reasons and alternatives',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://wisdom/decisions',
      name: 'Wisdom - Decisions',
      description: 'Architectural Decision Records (ADRs) index',
      mimeType: 'application/json',
    },
  ];
}

/**
 * Handle wisdom resource reads
 */
export async function handleWisdomResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  // paradigm://wisdom/preferences
  if (resourcePath === 'wisdom/preferences') {
    const wisdom = await ensureWisdom(ctx);

    return {
      handled: true,
      text: JSON.stringify(
        {
          version: wisdom.preferences?.version || '1.0',
          global: wisdom.preferences?.global || {},
          by_symbol: wisdom.preferences?.by_symbol || {},
          symbol_count: Object.keys(wisdom.preferences?.by_symbol || {}).length,
        },
        null,
        2
      ),
    };
  }

  // paradigm://wisdom/preferences/{symbol}
  if (resourcePath.startsWith('wisdom/preferences/')) {
    const symbol = decodeURIComponent(resourcePath.replace('wisdom/preferences/', ''));
    const wisdom = await ensureWisdom(ctx);
    const symbolWisdom = getSymbolWisdom(wisdom, symbol);

    return {
      handled: true,
      text: JSON.stringify(
        {
          symbol,
          preferences: symbolWisdom.preferences,
          global: wisdom.preferences?.global || {},
        },
        null,
        2
      ),
    };
  }

  // paradigm://wisdom/antipatterns
  if (resourcePath === 'wisdom/antipatterns') {
    const wisdom = await ensureWisdom(ctx);

    return {
      handled: true,
      text: JSON.stringify(
        {
          count: wisdom.antipatterns.length,
          antipatterns: wisdom.antipatterns,
        },
        null,
        2
      ),
    };
  }

  // paradigm://wisdom/antipatterns/{symbol}
  if (resourcePath.startsWith('wisdom/antipatterns/')) {
    const symbol = decodeURIComponent(resourcePath.replace('wisdom/antipatterns/', ''));
    const wisdom = await ensureWisdom(ctx);
    const symbolWisdom = getSymbolWisdom(wisdom, symbol);

    return {
      handled: true,
      text: JSON.stringify(
        {
          symbol,
          count: symbolWisdom.antipatterns.length,
          antipatterns: symbolWisdom.antipatterns,
        },
        null,
        2
      ),
    };
  }

  // paradigm://wisdom/decisions
  if (resourcePath === 'wisdom/decisions') {
    const wisdom = await ensureWisdom(ctx);

    return {
      handled: true,
      text: JSON.stringify(
        {
          count: wisdom.decisions.length,
          decisions: wisdom.decisions.map((d) => ({
            id: d.id,
            title: d.title,
            status: d.status,
            date: d.date,
            symbols: d.symbols,
          })),
        },
        null,
        2
      ),
    };
  }

  // paradigm://wisdom/decision/{id}
  if (resourcePath.startsWith('wisdom/decision/')) {
    const id = resourcePath.replace('wisdom/decision/', '');
    const wisdom = await ensureWisdom(ctx);
    const decision = wisdom.decisions.find((d) => d.id === id);

    if (!decision) {
      return {
        handled: true,
        text: JSON.stringify(
          {
            error: 'Decision not found',
            id,
            available: wisdom.decisions.map((d) => d.id),
          },
          null,
          2
        ),
      };
    }

    return {
      handled: true,
      text: JSON.stringify(decision, null, 2),
    };
  }

  // paradigm://wisdom/expertise/{symbol}
  if (resourcePath.startsWith('wisdom/expertise/')) {
    const symbol = decodeURIComponent(resourcePath.replace('wisdom/expertise/', ''));
    const wisdom = await ensureWisdom(ctx);
    const experts = findExperts(wisdom, { symbol });

    return {
      handled: true,
      text: JSON.stringify(
        {
          symbol,
          count: experts.length,
          experts: experts.map((e) => ({
            name: e.name,
            symbols: e.symbols,
            areas: e.areas,
            contact: e.contact,
          })),
        },
        null,
        2
      ),
    };
  }

  return { handled: false, text: '' };
}
