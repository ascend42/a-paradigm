/**
 * MCP Specs Resources - Serve reference specifications via MCP
 *
 * Resources:
 * - paradigm://specs - List all available reference specs
 * - paradigm://specs/{name} - Get specific spec content
 *
 * Reference specs (disciplines, scan, context-tracking) are served from package templates.
 * Project-specific specs remain in .paradigm/specs/ and are NOT served via MCP.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackResourceRead } from '../tools/context.js';

/**
 * Spec metadata
 */
interface SpecMeta {
  name: string;
  description: string;
  filename: string;
  size: number;
  tokens: number;
}

/**
 * Reference specs that should be served via MCP
 * These are discipline/process docs, not project-specific configuration
 */
const REFERENCE_SPECS: Record<string, string> = {
  'disciplines': 'Language and discipline-agnostic symbol mappings for different domains',
  'scan': 'Paradigm Probe protocol for visual discovery and UI-to-code mapping',
  'context-tracking': 'Context tracking system for session monitoring and handoffs',
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
 * Get the specs directory path
 */
function getSpecsDir(ctx: ProjectContext): string | null {
  return resolveTemplatePath('specs', ctx);
}

/**
 * Estimate tokens from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * List all available reference specs
 */
export function listReferenceSpecs(ctx: ProjectContext): SpecMeta[] {
  const specsDir = getSpecsDir(ctx);
  if (!specsDir) {
    return [];
  }

  const results: SpecMeta[] = [];

  for (const [name, description] of Object.entries(REFERENCE_SPECS)) {
    const filename = `${name}.md`;
    const filePath = path.join(specsDir, filename);

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
 * Get a specific reference spec's content
 */
export function getSpecContent(name: string, ctx: ProjectContext): { content: string; found: boolean; error?: string } {
  // Only serve reference specs
  if (!REFERENCE_SPECS[name]) {
    const available = Object.keys(REFERENCE_SPECS);
    return {
      found: false,
      content: '',
      error: `"${name}" is not a reference spec. Reference specs available via MCP: ${available.join(', ')}. Project-specific specs should be read from .paradigm/specs/ directly.`,
    };
  }

  const specsDir = getSpecsDir(ctx);
  if (!specsDir) {
    return {
      found: false,
      content: '',
      error: 'Specs directory not found. Ensure @a-company/paradigm is installed.',
    };
  }

  const filePath = path.join(specsDir, `${name}.md`);

  try {
    if (!fs.existsSync(filePath)) {
      return {
        found: false,
        content: '',
        error: `Spec "${name}" file not found at expected location.`,
      };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return { content, found: true };
  } catch (e) {
    return {
      found: false,
      content: '',
      error: `Error reading spec: ${(e as Error).message}`,
    };
  }
}

/**
 * Get specs resources list for MCP
 */
export function getSpecsResourcesList() {
  return [
    {
      uri: 'paradigm://specs',
      name: 'Reference Specs',
      description: 'List reference specifications (disciplines, scan, context-tracking)',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://specs/{name}',
      name: 'Spec Content',
      description: 'Get a reference spec. Available: disciplines, scan, context-tracking',
      mimeType: 'text/markdown',
    },
  ];
}

/**
 * Handle specs resource reads
 */
export async function handleSpecsResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string; mimeType: string }> {
  const uri = `paradigm://${resourcePath}`;

  // paradigm://specs - List all reference specs
  if (resourcePath === 'specs') {
    const specs = listReferenceSpecs(ctx);
    const totalSize = specs.reduce((sum, s) => sum + s.size, 0);
    const totalTokens = specs.reduce((sum, s) => sum + s.tokens, 0);

    const result = JSON.stringify({
      count: specs.length,
      totalSize,
      totalTokens,
      note: 'These are reference specs served via MCP. Project-specific specs (logger, symbols, etc.) should be read from .paradigm/specs/ directly.',
      specs: specs.map(s => ({
        name: s.name,
        description: s.description,
        size: s.size,
        tokens: s.tokens,
        uri: `paradigm://specs/${s.name}`,
      })),
    }, null, 2);

    trackResourceRead(result.length, uri);
    return { handled: true, text: result, mimeType: 'application/json' };
  }

  // paradigm://specs/{name} - Get specific spec
  if (resourcePath.startsWith('specs/') && resourcePath !== 'specs/') {
    const name = decodeURIComponent(resourcePath.replace('specs/', ''));
    const { content, found, error } = getSpecContent(name, ctx);

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
