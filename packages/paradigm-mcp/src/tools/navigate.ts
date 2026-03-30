/**
 * Navigate Tool - MCP tool for targeted codebase exploration
 *
 * Provides three intents:
 * - find: Locate a specific symbol or path
 * - explore: Explore an area or category
 * - context: Get context for a task description
 *
 * ZERO-CONFIG: Auto-generates minimal navigator from .purpose files if navigator.yaml missing
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectContext } from '../utils/index-loader.js';
import type { NavigateInput, NavigateResult, NavigatorConfig } from '../types/navigator.js';
import { loadNavigatorContext, navigate, getSkipPatterns } from '../utils/navigator-loader.js';
import { getSymbolsByType, getAllSymbols } from '@a-company/premise-core';
import { toolCache } from '../utils/tool-cache.js';
import { searchWorkspace } from '../utils/workspace-loader.js';

/**
 * Navigate tool definition
 */
export const navigateTool: Tool = {
  name: 'paradigm_navigate',
  description:
    'Navigate the codebase efficiently. Use "find" to locate a symbol, "explore" to browse an area, or "context" to get relevant files for a task. Returns file paths, symbol locations, and context summaries. ~200 tokens.',
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
      response_format: {
        type: 'string',
        enum: ['concise', 'detailed'],
        description: 'Response detail level. "concise" returns minimal fields (default: "detailed")',
      },
    },
    required: ['intent'],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },
  aliases: ['go to', 'open', 'show me', 'find file', 'explore', 'browse', 'locate code'],
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
  let navCtx = await loadNavigatorContext(ctx.rootDir);

  // AUTO-GENERATE: If navigator.yaml missing, generate minimal config from symbols
  if (!navCtx.config) {
    const autoConfig = generateMinimalNavigator(ctx);
    navCtx = {
      config: autoConfig,
      configPath: null, // Mark as auto-generated
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

  // Build cache key from input parameters
  const navCacheKey = `navigate:${input.intent}:${input.target || ''}:${input.task || ''}`;
  const cachedText = await toolCache.getOrCompute(navCacheKey, () => {
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

    // Indicate if using auto-generated navigator
    if (navCtx.config?.auto_generated) {
      response.auto_generated = true;
      response.tip = 'Using auto-generated navigator from .purpose files. Run `paradigm scan` for more accurate results.';
    }

    // Add helpful metadata and recovery suggestions
    if (result.paths.length === 0) {
      response.note = 'No paths found.';
      response.recovery = [
        'Try a different search term',
        'Use `paradigm_search` to find symbols by name',
        'Check `.purpose` files exist in your project',
        'Run `paradigm scan` to build the full navigator index',
      ];
    } else if (result.paths.length > 5) {
      response.tip = response.tip || 'Many paths returned. Start with suggested_order for efficient exploration.';
    }

    // Workspace awareness: search siblings when relevant
    if (ctx.workspace) {
      if (input.intent === 'find' && input.target && result.paths.length === 0) {
        // Fallback: symbol not found locally, search workspace siblings
        const wsResults = searchWorkspace(ctx.workspace, input.target);
        if (wsResults.length > 0) {
          response.workspaceResults = wsResults.slice(0, 5).map(r => ({
            symbol: r.symbol,
            type: r.type,
            description: r.description,
            project: r.project,
          }));
          response.note = `Not found locally. Found in workspace siblings.`;
          response.recovery = undefined;
        }
      } else if (input.intent === 'context' && input.task) {
        // Include relevant sibling symbols for task context
        const wsResults = searchWorkspace(ctx.workspace, input.task);
        if (wsResults.length > 0) {
          response.workspaceContext = wsResults.slice(0, 5).map(r => ({
            symbol: r.symbol,
            type: r.type,
            description: r.description,
            project: r.project,
          }));
        }
      }
    }

    return JSON.stringify(response, null, 2);
  });

  // Trim for concise mode (post-cache to avoid cache key complexity)
  let navigateText = cachedText;
  if (args.response_format === 'concise') {
    try {
      const parsed = JSON.parse(cachedText);
      delete parsed.skip;
      delete parsed.tip;
      delete parsed.note;
      delete parsed.recovery;
      delete parsed.workspaceResults;
      delete parsed.workspaceContext;
      delete parsed.auto_generated;
      navigateText = JSON.stringify(parsed, null, 2);
    } catch {
      // Fall through with full text if parse fails
    }
  }

  return {
    handled: true,
    text: navigateText,
  };
}

/**
 * Generate a minimal navigator config from project symbols
 * Used when navigator.yaml doesn't exist - enables zero-config usage
 */
function generateMinimalNavigator(ctx: ProjectContext): NavigatorConfig {
  const symbols: Record<string, string> = {};
  const structure: NavigatorConfig['structure'] = {
    features: { paths: [], symbol: '@' },
    components: { paths: [], symbol: '#' },
    gates: { paths: [], symbol: '^' },
    flows: { paths: [], symbol: '$' },
  };

  // Build symbol-to-path mapping from index
  const allSymbols = getAllSymbols(ctx.index);
  const seenPaths = new Set<string>();

  for (const sym of allSymbols) {
    if (sym.filePath) {
      symbols[sym.symbol] = sym.filePath;
      seenPaths.add(sym.filePath);

      // Infer structure from symbol types
      const dir = sym.filePath.replace(/\/[^/]+$/, ''); // Get directory
      switch (sym.type) {
        case 'feature':
          if (!structure.features.paths.includes(dir)) {
            structure.features.paths.push(dir);
          }
          break;
        case 'component':
          if (!structure.components.paths.includes(dir)) {
            structure.components.paths.push(dir);
          }
          break;
        case 'gate':
          if (!structure.gates.paths.includes(dir)) {
            structure.gates.paths.push(dir);
          }
          break;
        case 'flow':
          if (!structure.flows.paths.includes(dir)) {
            structure.flows.paths.push(dir);
          }
          break;
      }
    }
  }

  // Collect config and entry files from purpose files
  const configFiles: string[] = [];
  const entryFiles: string[] = [];

  for (const pf of ctx.aggregation.purposeFiles) {
    configFiles.push(pf.filePath);
  }

  // Add standard config files if they might exist
  configFiles.push('.paradigm/config.yaml');
  if (ctx.gateConfig) {
    configFiles.push('portal.yaml');
  }

  return {
    version: '1.0',
    generated: new Date().toISOString(),
    auto_generated: true, // Mark as auto-generated
    structure,
    key_files: {
      config: configFiles.slice(0, 10), // Limit to avoid noise
      entry: entryFiles,
      types: [],
    },
    skip_patterns: {
      always: ['node_modules/', 'dist/', '.git/', 'build/', 'coverage/'],
      unless_testing: ['__tests__/', '*.test.*', '*.spec.*'],
      unless_docs: ['*.md', 'docs/'],
    },
    symbols,
  };
}
