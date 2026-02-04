/**
 * MCP Prompts Resources - Serve prompt templates via MCP
 *
 * Resources:
 * - paradigm://prompts - List all available prompts with metadata
 * - paradigm://prompts/{name} - Get specific prompt content
 *
 * Prompts are served from the package templates, not from project .paradigm/
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackResourceRead } from '../tools/context.js';

/**
 * Prompt metadata
 */
interface PromptMeta {
  name: string;
  description: string;
  filename: string;
  size: number;
  tokens: number;
}

/**
 * Known prompts with descriptions
 */
const PROMPT_DESCRIPTIONS: Record<string, string> = {
  'add-feature': 'Pathway for adding a new user-facing feature with proper symbol definitions',
  'add-gate': 'Add a new gate (portal) for authorization control',
  'debug-auth': 'Debug authentication and authorization issues',
  'implement-ftux': 'Implement First-Time User Experience (FTUX) flow',
  'implement-sandbox': 'Set up a sandbox environment for testing',
  'read-docs': 'Read and understand existing documentation',
  'refactor': 'Refactor existing code with proper planning',
  'run-e2e-tests': 'Run and debug end-to-end tests',
  'trace-flow': 'Trace a flow through the system',
  'validate-portals': 'Validate portal.yaml configuration',
};

/**
 * Resolve template path with multiple fallbacks
 */
function resolveTemplatePath(relativePath: string, ctx: ProjectContext): string | null {
  const candidates = [
    // Development (npm link) - relative to this file's location
    path.join(__dirname, '../../../../paradigm/templates/paradigm', relativePath),
    // Installed as dependency
    path.join(ctx.rootDir, 'node_modules/@a-company/paradigm/templates/paradigm', relativePath),
    // Workspace sibling (monorepo)
    path.join(ctx.rootDir, '../../packages/paradigm/templates/paradigm', relativePath),
    // Global install
    path.join(process.env.HOME || '', '.paradigm/templates', relativePath),
    // Fallback: Look in paradigm-mcp's own directory structure
    path.resolve(__dirname, '../../../paradigm/templates/paradigm', relativePath),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

/**
 * Get the prompts directory path
 */
function getPromptsDir(ctx: ProjectContext): string | null {
  return resolveTemplatePath('prompts', ctx);
}

/**
 * Estimate tokens from text (same algorithm as context.ts)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * List all available prompts with metadata
 */
export function listPrompts(ctx: ProjectContext): PromptMeta[] {
  const promptsDir = getPromptsDir(ctx);
  if (!promptsDir) {
    return [];
  }

  try {
    const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
    return files.map(filename => {
      const name = filename.replace('.md', '');
      const filePath = path.join(promptsDir, filename);
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');

      return {
        name,
        description: PROMPT_DESCRIPTIONS[name] || `Prompt template: ${name}`,
        filename,
        size: stats.size,
        tokens: estimateTokens(content),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get a specific prompt's content
 */
export function getPromptContent(name: string, ctx: ProjectContext): { content: string; found: boolean; error?: string } {
  const promptsDir = getPromptsDir(ctx);
  if (!promptsDir) {
    return {
      found: false,
      content: '',
      error: 'Prompts directory not found. Ensure @a-company/paradigm is installed.',
    };
  }

  const filePath = path.join(promptsDir, `${name}.md`);

  try {
    if (!fs.existsSync(filePath)) {
      const available = listPrompts(ctx).map(p => p.name);
      return {
        found: false,
        content: '',
        error: `Prompt "${name}" not found. Available prompts: ${available.join(', ')}`,
      };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return { content, found: true };
  } catch (e) {
    return {
      found: false,
      content: '',
      error: `Error reading prompt: ${(e as Error).message}`,
    };
  }
}

/**
 * Get prompts resources list for MCP
 */
export function getPromptsResourcesList() {
  return [
    {
      uri: 'paradigm://prompts',
      name: 'Prompts',
      description: 'List all available prompt templates with metadata (name, description, size)',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://prompts/{name}',
      name: 'Prompt Content',
      description: 'Get a specific prompt template content. Replace {name} with prompt name (e.g., add-feature)',
      mimeType: 'text/markdown',
    },
  ];
}

/**
 * Handle prompts resource reads
 */
export async function handlePromptsResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string; mimeType: string }> {
  const uri = `paradigm://${resourcePath}`;

  // paradigm://prompts - List all prompts
  if (resourcePath === 'prompts') {
    const prompts = listPrompts(ctx);
    const totalSize = prompts.reduce((sum, p) => sum + p.size, 0);
    const totalTokens = prompts.reduce((sum, p) => sum + p.tokens, 0);

    const result = JSON.stringify({
      count: prompts.length,
      totalSize,
      totalTokens,
      prompts: prompts.map(p => ({
        name: p.name,
        description: p.description,
        size: p.size,
        tokens: p.tokens,
        uri: `paradigm://prompts/${p.name}`,
      })),
      usage: 'Read a specific prompt with paradigm://prompts/{name}',
    }, null, 2);

    trackResourceRead(result.length, uri);
    return { handled: true, text: result, mimeType: 'application/json' };
  }

  // paradigm://prompts/{name} - Get specific prompt
  if (resourcePath.startsWith('prompts/')) {
    const name = decodeURIComponent(resourcePath.replace('prompts/', ''));
    const { content, found, error } = getPromptContent(name, ctx);

    if (!found) {
      const errorResult = JSON.stringify({ error, name }, null, 2);
      trackResourceRead(errorResult.length, uri);
      return { handled: true, text: errorResult, mimeType: 'application/json' };
    }

    trackResourceRead(content.length, uri);
    return { handled: true, text: content, mimeType: 'text/markdown' };
  }

  return { handled: false, text: '', mimeType: 'application/json' };
}
