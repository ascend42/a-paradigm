/**
 * MCP Docs Resources - Serve reference documentation via MCP
 *
 * Resources:
 * - paradigm://docs - List all available reference docs
 * - paradigm://docs/{name} - Get specific doc content
 *
 * Reference docs (commands, queries) are served from package templates.
 * Project-specific docs remain in .paradigm/docs/ and are NOT served via MCP.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackResourceRead } from '../tools/context.js';

/**
 * Doc metadata
 */
interface DocMeta {
  name: string;
  description: string;
  filename: string;
  size: number;
  tokens: number;
}

/**
 * Reference docs that should be served via MCP
 * These are usage guides, not project-specific documentation
 */
const REFERENCE_DOCS: Record<string, string> = {
  'commands': 'Complete CLI command reference with examples and usage guidance',
  'queries': 'jq query examples for querying the constellation symbol graph',
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
 * Get the docs directory path
 */
function getDocsDir(ctx: ProjectContext): string | null {
  return resolveTemplatePath('docs', ctx);
}

/**
 * Estimate tokens from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * List all available reference docs
 */
export function listReferenceDocs(ctx: ProjectContext): DocMeta[] {
  const docsDir = getDocsDir(ctx);
  if (!docsDir) {
    return [];
  }

  const results: DocMeta[] = [];

  for (const [name, description] of Object.entries(REFERENCE_DOCS)) {
    const filename = `${name}.md`;
    const filePath = path.join(docsDir, filename);

    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');

        results.push({
          name,
          description,
          filename,
          size: stats.size,
          tokens: estimateTokens(content),
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}

/**
 * Get a specific reference doc's content
 */
export function getDocContent(name: string, ctx: ProjectContext): { content: string; found: boolean; error?: string } {
  // Only serve reference docs
  if (!REFERENCE_DOCS[name]) {
    const available = Object.keys(REFERENCE_DOCS);
    return {
      found: false,
      content: '',
      error: `"${name}" is not a reference doc. Reference docs available via MCP: ${available.join(', ')}. Project-specific docs (patterns, troubleshooting, etc.) should be read from .paradigm/docs/ directly.`,
    };
  }

  const docsDir = getDocsDir(ctx);
  if (!docsDir) {
    return {
      found: false,
      content: '',
      error: 'Docs directory not found. Ensure @a-company/paradigm is installed.',
    };
  }

  const filePath = path.join(docsDir, `${name}.md`);

  try {
    if (!fs.existsSync(filePath)) {
      return {
        found: false,
        content: '',
        error: `Doc "${name}" file not found at expected location.`,
      };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return { content, found: true };
  } catch (e) {
    return {
      found: false,
      content: '',
      error: `Error reading doc: ${(e as Error).message}`,
    };
  }
}

/**
 * Get docs resources list for MCP
 */
export function getDocsResourcesList() {
  return [
    {
      uri: 'paradigm://docs',
      name: 'Reference Docs',
      description: 'List reference documentation (commands, queries)',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://docs/{name}',
      name: 'Doc Content',
      description: 'Get a reference doc. Available: commands, queries',
      mimeType: 'text/markdown',
    },
  ];
}

/**
 * Handle docs resource reads
 */
export async function handleDocsResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string; mimeType: string }> {
  const uri = `paradigm://${resourcePath}`;

  // paradigm://docs - List all reference docs
  if (resourcePath === 'docs') {
    const docs = listReferenceDocs(ctx);
    const totalSize = docs.reduce((sum, d) => sum + d.size, 0);
    const totalTokens = docs.reduce((sum, d) => sum + d.tokens, 0);

    const result = JSON.stringify({
      count: docs.length,
      totalSize,
      totalTokens,
      note: 'These are reference docs served via MCP. Project-specific docs (patterns, troubleshooting, etc.) should be read from .paradigm/docs/ directly.',
      docs: docs.map(d => ({
        name: d.name,
        description: d.description,
        size: d.size,
        tokens: d.tokens,
        uri: `paradigm://docs/${d.name}`,
      })),
    }, null, 2);

    trackResourceRead(result.length, uri);
    return { handled: true, text: result, mimeType: 'application/json' };
  }

  // paradigm://docs/{name} - Get specific doc
  if (resourcePath.startsWith('docs/') && resourcePath !== 'docs/') {
    const name = decodeURIComponent(resourcePath.replace('docs/', ''));
    const { content, found, error } = getDocContent(name, ctx);

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
