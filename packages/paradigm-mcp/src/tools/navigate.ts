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

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../utils/tool-registry.js';
import type { ProjectContext } from '../utils/index-loader.js';
import type { NavigateInput, NavigatorConfig } from '../types/navigator.js';
import { loadNavigatorContext, navigate } from '../utils/navigator-loader.js';
import { getAllSymbols, resolveSymbol } from '@a-company/premise-core';
import { toolCache } from '../utils/tool-cache.js';
import { searchWorkspace } from '../utils/workspace-loader.js';

/**
 * Navigate tool definition
 */
export const navigateTool: ToolDefinition = {
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
export function getNavigateToolsList(): ToolDefinition[] {
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

  // Load navigator config.
  // AUTO-GENERATE: If navigator.yaml missing, generate minimal config from symbols
  const config: NavigatorConfig =
    (await loadNavigatorContext(ctx.rootDir)).config ?? generateMinimalNavigator(ctx);

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

  // "find" takes a user-typed symbol: canonicalize it ("Checkout" / "checkout"
  // → "#checkout"); an ambiguous bare name lists candidates instead of a miss.
  if (input.intent === 'find' && input.target) {
    const { entry, candidates } = resolveSymbol(ctx.index, input.target);
    if (entry) {
      input.target = entry.symbol;
    } else if (candidates.length > 1) {
      return {
        handled: true,
        text: JSON.stringify(
          { error: 'Ambiguous symbol', target: input.target, candidates: candidates.map((c) => c.symbol) },
          null,
          2,
        ),
      };
    }
  }

  // Build cache key from input parameters
  const navCacheKey = `navigate:${input.intent}:${input.target || ''}:${input.task || ''}`;
  const cachedText = await toolCache.getOrCompute(navCacheKey, () => {
    // Execute navigation
    const result = navigate(config, input, ctx.rootDir);

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
    if (config.auto_generated) {
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

  // Write session sentinel so the PreToolUse navigate-remind hook stays silent
  // after navigate has been called at least once this session.
  try {
    const sentinelPath = path.join(ctx.rootDir, '.paradigm', '.nav-called');
    fs.writeFileSync(sentinelPath, new Date().toISOString(), 'utf8');
  } catch {
    // Non-fatal — sentinel is advisory only
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
  // v2 symbol types have no `feature`, so features.paths stays empty.
  const features = { paths: [] as string[], symbol: '@' as const };
  const components = { paths: [] as string[], symbol: '#' as const };
  const gates = { paths: [] as string[], symbol: '^' as const };
  const flows = { paths: [] as string[], symbol: '$' as const };
  const structure: NavigatorConfig['structure'] = { features, components, gates, flows };

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
        case 'component':
          if (!components.paths.includes(dir)) {
            components.paths.push(dir);
          }
          break;
        case 'gate':
          if (!gates.paths.includes(dir)) {
            gates.paths.push(dir);
          }
          break;
        case 'flow':
          if (!flows.paths.includes(dir)) {
            flows.paths.push(dir);
          }
          break;
      }
    }
  }

  // Collect config and entry files from purpose files
  const configFiles: string[] = [];
  const entryFiles: string[] = [];

  for (const pf of ctx.aggregation.purposeFiles) {
    configFiles.push(pf);
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
