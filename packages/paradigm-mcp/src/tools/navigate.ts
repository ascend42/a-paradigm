/**
 * Navigate Tool - MCP tool for targeted codebase exploration
 *
 * Provides three intents:
 * - find: Locate a specific symbol or path
 * - explore: Explore an area or category
 * - context: Get context for a task description
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectContext } from '../utils/index-loader.js';
import type { NavigateInput, NavigateResult } from '../types/navigator.js';
import { loadNavigatorContext, navigate, getSkipPatterns } from '../utils/navigator-loader.js';

/**
 * Navigate tool definition
 */
export const navigateTool: Tool = {
  name: 'paradigm_navigate',
  description:
    'Navigate the codebase efficiently. Use "find" to locate a symbol, "explore" to browse an area, or "context" to get relevant files for a task.',
  inputSchema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['find', 'explore', 'context'],
        description:
          'Navigation intent: "find" for symbol lookup, "explore" for area browsing, "context" for task-based discovery',
      },
      target: {
        type: 'string',
        description:
          'For "find": symbol (e.g., @checkout) or path. For "explore": category or area name (e.g., authentication, components)',
      },
      task: {
        type: 'string',
        description:
          'For "context" intent: describe the task (e.g., "add Apple Pay to checkout")',
      },
    },
    required: ['intent'],
  },
};

/**
 * Get navigate tool list
 */
export function getNavigateToolsList(): Tool[] {
  return [navigateTool];
}

/**
 * Handle navigate tool call
 */
export async function handleNavigateTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  if (name !== 'paradigm_navigate') {
    return { handled: false, text: '' };
  }

  const input: NavigateInput = {
    intent: (args.intent as 'find' | 'explore' | 'context') || 'find',
    target: args.target as string | undefined,
    task: args.task as string | undefined,
  };

  // Load navigator context
  const navCtx = await loadNavigatorContext(ctx.rootDir);

  if (!navCtx.config) {
    // Navigator not generated yet
    return {
      handled: true,
      text: JSON.stringify(
        {
          error: 'Navigator not found',
          suggestion:
            'Run "paradigm scan" to generate navigator.yaml for efficient exploration',
          fallback: {
            paths: ['.paradigm/config.yaml', 'package.json'],
            skip: ['node_modules/', 'dist/', '.git/'],
          },
        },
        null,
        2
      ),
    };
  }

  // Validate input
  if (!input.intent) {
    return {
      handled: true,
      text: JSON.stringify(
        {
          error: 'Missing intent',
          usage: {
            find: 'paradigm_navigate({ intent: "find", target: "@checkout" })',
            explore: 'paradigm_navigate({ intent: "explore", target: "authentication" })',
            context: 'paradigm_navigate({ intent: "context", task: "add Apple Pay" })',
          },
        },
        null,
        2
      ),
    };
  }

  if (input.intent === 'context' && !input.task) {
    return {
      handled: true,
      text: JSON.stringify(
        {
          error: 'Missing task for context intent',
          example: 'paradigm_navigate({ intent: "context", task: "add Apple Pay to checkout" })',
        },
        null,
        2
      ),
    };
  }

  if ((input.intent === 'find' || input.intent === 'explore') && !input.target) {
    return {
      handled: true,
      text: JSON.stringify(
        {
          error: `Missing target for ${input.intent} intent`,
          example:
            input.intent === 'find'
              ? 'paradigm_navigate({ intent: "find", target: "@checkout" })'
              : 'paradigm_navigate({ intent: "explore", target: "components" })',
        },
        null,
        2
      ),
    };
  }

  // Execute navigation
  const result = navigate(navCtx.config, input, ctx.rootDir);

  // Format response
  const response: Record<string, unknown> = {
    intent: input.intent,
    ...(input.target && { target: input.target }),
    ...(input.task && { task: input.task }),
    paths: result.paths,
    symbols: result.symbols,
    skip: result.skip.slice(0, 10), // Limit skip patterns in output
    suggested_order: result.suggested_order,
    ...(result.explanation && { explanation: result.explanation }),
  };

  // Add helpful metadata
  if (result.paths.length === 0) {
    response.note =
      'No paths found. Try a different search term or use paradigm_search for symbol lookup.';
  } else if (result.paths.length > 5) {
    response.tip = 'Many paths returned. Start with suggested_order for efficient exploration.';
  }

  return {
    handled: true,
    text: JSON.stringify(response, null, 2),
  };
}
