/**
 * Tags MCP Tools - Actions AI can invoke on the Tag Bank
 *
 * Tools:
 * - paradigm_tags: List, search, and get tag details
 * - paradigm_tags_suggest: AI proposes a new tag for human review
 * - paradigm_aspect_check: Verify aspects have valid anchors
 *
 * Symbol System v2: Tags replace classification symbols (@, %, ?, &)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from '../utils/index-loader.js';
import { getSymbol, getAllSymbols } from '@a-company/premise-core';

/**
 * Tag definition from tags.yaml
 */
interface TagDefinition {
  description: string;
  color?: string;
  'applies-to'?: string[];
  aliases?: string[];
  'requires-aspect'?: string[];
}

/**
 * Suggested tag from AI
 */
interface SuggestedTag {
  tag: string;
  'proposed-by': string;
  'proposed-at': string;
  reason: string;
  'applies-to'?: string[];
  'example-symbols'?: string[];
}

/**
 * Tag bank structure
 */
interface TagBank {
  version: string;
  core: Record<string, TagDefinition>;
  project: Record<string, TagDefinition>;
  suggested: SuggestedTag[];
}

/**
 * Load tag bank from project
 */
function loadTagBank(rootDir: string): TagBank | null {
  const tagPath = path.join(rootDir, '.paradigm', 'tags.yaml');
  if (!fs.existsSync(tagPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(tagPath, 'utf-8');
    return yaml.load(content) as TagBank;
  } catch {
    return null;
  }
}

/**
 * Save tag bank to project
 */
function saveTagBank(rootDir: string, tagBank: TagBank): void {
  const tagPath = path.join(rootDir, '.paradigm', 'tags.yaml');
  const content = yaml.dump(tagBank, { lineWidth: -1 });
  fs.writeFileSync(tagPath, content, 'utf-8');
}

/**
 * Get list of tag tools
 */
export function getTagsToolsList() {
  return [
    {
      name: 'paradigm_tags',
      description:
        'List, search, and manage tags in the Tag Bank. Use to find available tags for classification.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'search', 'get'],
            description: 'Action: list all tags, search by query, or get specific tag details',
          },
          query: {
            type: 'string',
            description: 'For search action: query string to match tag names and descriptions',
          },
          tag: {
            type: 'string',
            description: 'For get action: specific tag name to get details for',
          },
          category: {
            type: 'string',
            enum: ['core', 'project', 'suggested', 'all'],
            description: 'Filter by tag category (default: all)',
          },
        },
        required: ['action'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_tags_suggest',
      description:
        'AI proposes a new tag for human review. Tag will be added to the suggested section for approval.',
      inputSchema: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'Tag name (kebab-case, e.g., "webhook-handler")',
          },
          description: {
            type: 'string',
            description: 'What this tag means and when to apply it',
          },
          reason: {
            type: 'string',
            description: 'Why this tag would be useful (e.g., "Found 5 components handling webhooks")',
          },
          appliesTo: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbol types this tag applies to (e.g., ["#", "$"])',
          },
          exampleSymbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Example symbols that would use this tag',
          },
        },
        required: ['tag', 'description', 'reason'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_check',
      description:
        'Verify an aspect has valid anchors and check coverage. Aspects (~) REQUIRE code anchors.',
      inputSchema: {
        type: 'object',
        properties: {
          aspect: {
            type: 'string',
            description: 'Aspect symbol to check (e.g., "~audit-required")',
          },
        },
        required: ['aspect'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle tag tool calls
 */
export async function handleTagsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_tags': {
      const { action, query, tag, category = 'all' } = args as {
        action: 'list' | 'search' | 'get';
        query?: string;
        tag?: string;
        category?: 'core' | 'project' | 'suggested' | 'all';
      };

      const tagBank = loadTagBank(ctx.rootDir);
      if (!tagBank) {
        return {
          handled: true,
          text: JSON.stringify({
            error: 'Tag bank not found',
            suggestion: 'Create .paradigm/tags.yaml or run `paradigm init` to set up tags',
          }),
        };
      }

      if (action === 'list') {
        const result: Record<string, unknown> = {};

        if (category === 'all' || category === 'core') {
          result.core = Object.entries(tagBank.core).map(([name, def]) => ({
            tag: name,
            description: def.description?.split('\n')[0].trim(),
            color: def.color,
            appliesTo: def['applies-to'],
          }));
        }

        if (category === 'all' || category === 'project') {
          result.project = Object.entries(tagBank.project || {}).map(([name, def]) => ({
            tag: name,
            description: def.description?.split('\n')[0].trim(),
            color: def.color,
            appliesTo: def['applies-to'],
          }));
        }

        if (category === 'all' || category === 'suggested') {
          result.suggested = (tagBank.suggested || []).map((s) => ({
            tag: s.tag,
            reason: s.reason,
            proposedBy: s['proposed-by'],
            proposedAt: s['proposed-at'],
          }));
        }

        result.summary = {
          coreCount: Object.keys(tagBank.core || {}).length,
          projectCount: Object.keys(tagBank.project || {}).length,
          suggestedCount: (tagBank.suggested || []).length,
        };

        return {
          handled: true,
          text: JSON.stringify(result, null, 2),
        };
      }

      if (action === 'search') {
        if (!query) {
          return {
            handled: true,
            text: JSON.stringify({ error: 'Query required for search action' }),
          };
        }

        const lowerQuery = query.toLowerCase();
        const matches: Array<{ tag: string; category: string; description: string }> = [];

        // Search core tags
        for (const [name, def] of Object.entries(tagBank.core || {})) {
          if (
            name.toLowerCase().includes(lowerQuery) ||
            def.description?.toLowerCase().includes(lowerQuery) ||
            def.aliases?.some((a) => a.toLowerCase().includes(lowerQuery))
          ) {
            matches.push({
              tag: name,
              category: 'core',
              description: def.description?.split('\n')[0].trim() || '',
            });
          }
        }

        // Search project tags
        for (const [name, def] of Object.entries(tagBank.project || {})) {
          if (
            name.toLowerCase().includes(lowerQuery) ||
            def.description?.toLowerCase().includes(lowerQuery) ||
            def.aliases?.some((a) => a.toLowerCase().includes(lowerQuery))
          ) {
            matches.push({
              tag: name,
              category: 'project',
              description: def.description?.split('\n')[0].trim() || '',
            });
          }
        }

        return {
          handled: true,
          text: JSON.stringify({
            query,
            count: matches.length,
            matches,
          }, null, 2),
        };
      }

      if (action === 'get') {
        if (!tag) {
          return {
            handled: true,
            text: JSON.stringify({ error: 'Tag name required for get action' }),
          };
        }

        // Check core tags
        if (tagBank.core?.[tag]) {
          const def = tagBank.core[tag];
          return {
            handled: true,
            text: JSON.stringify({
              tag,
              category: 'core',
              description: def.description,
              color: def.color,
              appliesTo: def['applies-to'],
              aliases: def.aliases,
              requiresAspect: def['requires-aspect'],
            }, null, 2),
          };
        }

        // Check project tags
        if (tagBank.project?.[tag]) {
          const def = tagBank.project[tag];
          return {
            handled: true,
            text: JSON.stringify({
              tag,
              category: 'project',
              description: def.description,
              color: def.color,
              appliesTo: def['applies-to'],
              aliases: def.aliases,
              requiresAspect: def['requires-aspect'],
            }, null, 2),
          };
        }

        // Check suggested tags
        const suggested = tagBank.suggested?.find((s) => s.tag === tag);
        if (suggested) {
          return {
            handled: true,
            text: JSON.stringify({
              tag,
              category: 'suggested',
              reason: suggested.reason,
              proposedBy: suggested['proposed-by'],
              proposedAt: suggested['proposed-at'],
              appliesTo: suggested['applies-to'],
              exampleSymbols: suggested['example-symbols'],
              status: 'pending approval',
            }, null, 2),
          };
        }

        return {
          handled: true,
          text: JSON.stringify({
            error: `Tag "${tag}" not found`,
            suggestion: 'Use paradigm_tags with action "list" to see available tags',
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({ error: `Unknown action: ${action}` }),
      };
    }

    case 'paradigm_tags_suggest': {
      const { tag, description, reason, appliesTo, exampleSymbols } = args as {
        tag: string;
        description: string;
        reason: string;
        appliesTo?: string[];
        exampleSymbols?: string[];
      };

      const tagBank = loadTagBank(ctx.rootDir);
      if (!tagBank) {
        return {
          handled: true,
          text: JSON.stringify({
            error: 'Tag bank not found',
            suggestion: 'Create .paradigm/tags.yaml first',
          }),
        };
      }

      // Check if tag already exists
      if (tagBank.core?.[tag] || tagBank.project?.[tag]) {
        return {
          handled: true,
          text: JSON.stringify({
            error: `Tag "${tag}" already exists`,
            existing: tagBank.core?.[tag] ? 'core' : 'project',
          }),
        };
      }

      // Check if already suggested
      if (tagBank.suggested?.some((s) => s.tag === tag)) {
        return {
          handled: true,
          text: JSON.stringify({
            error: `Tag "${tag}" is already in the suggested queue`,
            status: 'pending approval',
          }),
        };
      }

      // Add to suggested
      const suggestion: SuggestedTag = {
        tag,
        'proposed-by': 'claude',
        'proposed-at': new Date().toISOString(),
        reason,
        'applies-to': appliesTo || ['#'],
        'example-symbols': exampleSymbols,
      };

      if (!tagBank.suggested) {
        tagBank.suggested = [];
      }
      tagBank.suggested.push(suggestion);

      saveTagBank(ctx.rootDir, tagBank);

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          tag,
          status: 'pending approval',
          message: 'Tag suggestion added. Human review required before use.',
          nextSteps: [
            'Human can approve via Sentinel UI or CLI',
            'Once approved, tag moves to "project" section',
            'Then AI can use the tag for classification',
          ],
        }, null, 2),
      };
    }

    case 'paradigm_aspect_check': {
      const { aspect } = args as { aspect: string };

      // Normalize aspect symbol
      const aspectSymbol = aspect.startsWith('~') ? aspect : `~${aspect}`;

      // Get the aspect from the index
      const entry = getSymbol(ctx.index, aspectSymbol);

      if (!entry) {
        return {
          handled: true,
          text: JSON.stringify({
            error: `Aspect "${aspectSymbol}" not found`,
            suggestion: 'Use paradigm_search to find available aspects',
          }),
        };
      }

      if (entry.type !== 'aspect') {
        return {
          handled: true,
          text: JSON.stringify({
            error: `Symbol "${aspectSymbol}" is not an aspect (type: ${entry.type})`,
            note: 'Only ~ symbols are aspects',
          }),
        };
      }

      // Check anchors
      const anchors = entry.anchors || [];
      const anchorResults: Array<{
        path: string;
        lines: string;
        exists: boolean;
        lineCount?: number;
      }> = [];

      for (const anchor of anchors) {
        const filePath = path.isAbsolute(anchor.path)
          ? anchor.path
          : path.join(ctx.rootDir, anchor.path);

        const exists = fs.existsSync(filePath);
        let lineCount: number | undefined;

        if (exists) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            if (typeof anchor.lines === 'number') {
              lineCount = 1;
            } else if (Array.isArray(anchor.lines) && anchor.lines.length === 2) {
              lineCount = anchor.lines[1] - anchor.lines[0] + 1;
            } else if (Array.isArray(anchor.lines)) {
              lineCount = anchor.lines.length;
            }
          } catch {
            // Ignore read errors
          }
        }

        anchorResults.push({
          path: anchor.path,
          lines: anchor.raw.split(':')[1] || 'full file',
          exists,
          lineCount,
        });
      }

      const valid = anchors.length > 0 && anchorResults.every((a) => a.exists);

      // Check coverage - which symbols should have this aspect
      const appliesTo = entry.appliesTo || [];
      const allSymbols = getAllSymbols(ctx.index);

      const matchingSymbols: string[] = [];
      const symbolsWithAspect: string[] = [];

      for (const sym of allSymbols) {
        // Check if symbol matches any applies-to pattern
        for (const pattern of appliesTo) {
          const regex = new RegExp(
            '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
          );
          if (regex.test(sym.symbol)) {
            matchingSymbols.push(sym.symbol);

            // Check if symbol has this aspect in its aspects array or data
            const hasAspect =
              (sym.data as Record<string, unknown>)?.aspects?.includes?.(aspectSymbol) ||
              (sym.data as Record<string, unknown>)?.aspects?.includes?.(aspect);

            if (hasAspect) {
              symbolsWithAspect.push(sym.symbol);
            }
            break;
          }
        }
      }

      const missing = matchingSymbols.filter((s) => !symbolsWithAspect.includes(s));

      return {
        handled: true,
        text: JSON.stringify({
          aspect: aspectSymbol,
          valid,
          description: entry.description,
          enforcement: entry.enforcement,
          anchors: anchorResults,
          coverage: {
            appliesTo,
            matchingSymbols: matchingSymbols.length,
            symbolsWithAspect: symbolsWithAspect.length,
            missing: missing.slice(0, 10),
            missingCount: missing.length,
          },
          warnings: [
            ...(anchors.length === 0 ? ['CRITICAL: Aspect has no anchors - aspects MUST have code anchors'] : []),
            ...anchorResults.filter((a) => !a.exists).map((a) => `Anchor file not found: ${a.path}`),
            ...(missing.length > 0 ? [`${missing.length} symbols match applies-to but don't have this aspect`] : []),
          ],
          recommendation: valid
            ? missing.length > 0
              ? 'Aspect is valid but has coverage gaps - consider applying to matching symbols'
              : 'Aspect is valid and fully applied'
            : 'INVALID: Add code anchors to this aspect',
        }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
