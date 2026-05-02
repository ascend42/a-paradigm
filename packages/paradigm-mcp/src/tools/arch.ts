/**
 * Atlas (Cartographer) MCP Tools
 *
 * Tools:
 * - paradigm_arch_status: Get architectural layer map summary and drift report
 * - paradigm_arch_diagram: Render the architectural map as a Mermaid diagram
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadArchMap,
  getArchDrift,
  generateMermaid,
} from '../utils/arch-loader.js';
import { log } from '../utils/mcp-logger.js';

export function getArchToolsList() {
  return [
    {
      name: 'paradigm_arch_status',
      description:
        'Get the architectural layer map summary and drift report. Shows tiers, their components, and any symbols that are unassigned (not in any tier) or missing from the index. ~200 tokens.',
      inputSchema: { type: 'object' as const, properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_arch_diagram',
      description:
        'Render the architectural map as a Mermaid diagram. Returns a Mermaid graph TD string showing tiers and their links. ~150 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          format: {
            type: 'string',
            enum: ['mermaid'],
            description: 'Output format. Only "mermaid" supported (default: "mermaid").',
          },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

export async function handleArchTool(
  name: string,
  _args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  try {
    if (name === 'paradigm_arch_status') {
      const map = loadArchMap(ctx.rootDir);
      if (!map) {
        return {
          text: JSON.stringify({
            exists: false,
            message:
              'No arch.yaml found. Create .paradigm/arch.yaml to start mapping your architecture.',
          }),
          handled: true,
        };
      }
      const drift = getArchDrift(ctx.rootDir, ctx);
      return {
        text: JSON.stringify({
          exists: true,
          version: map.version,
          tierCount: map.tiers.length,
          tiers: map.tiers.map(tier => ({
            id: tier.id,
            label: tier.label,
            responsibility: tier.responsibility,
            framework: tier.tech?.framework ?? '',
            componentCount: tier.components.length,
            components: tier.components,
          })),
          links: map.links,
          drift: {
            unassigned: drift.unassigned,
            missing_purpose: drift.missing_purpose,
            clean:
              drift.unassigned.length === 0 && drift.missing_purpose.length === 0,
          },
        }),
        handled: true,
      };
    }

    if (name === 'paradigm_arch_diagram') {
      const map = loadArchMap(ctx.rootDir);
      if (!map) {
        return {
          text: JSON.stringify({
            error: 'No arch.yaml found. Cannot render diagram.',
          }),
          handled: true,
        };
      }
      const diagram = generateMermaid(map);
      return {
        text: JSON.stringify({ format: 'mermaid', diagram }),
        handled: true,
      };
    }

    return { handled: false, text: '' };
  } catch (e) {
    log.component('#arch-tools').warn(`Unexpected error in arch tool ${name}`, {
      error: String(e),
    });
    return {
      text: JSON.stringify({ error: String(e) }),
      handled: true,
    };
  }
}
