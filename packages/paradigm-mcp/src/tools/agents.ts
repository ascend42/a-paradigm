/**
 * Agent Identity MCP Tools — query and manage persistent agent profiles
 *
 * Tools:
 * - paradigm_agent_list: List all agent profiles with top expertise
 * - paradigm_agent_expertise: Find best agents for a symbol
 * - paradigm_agent_get: Get full agent profile detail
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadAllAgentProfiles,
  loadAgentProfile,
  queryExpertise,
} from '../utils/agent-loader.js';

/**
 * Get list of agent identity tools with safety annotations
 */
export function getAgentToolsList() {
  return [
    {
      name: 'paradigm_agent_list',
      description:
        'List all agent identity profiles with top expertise areas. Shows agents from both global (~/.paradigm/agents/) and project (.paradigm/agents/) scopes. Returns profile summaries with personality and top symbols. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['all', 'global', 'project'],
            description: 'Filter by scope (default: all)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_agent_expertise',
      description:
        'Find which agents are best qualified to work on a specific symbol. Returns agents ranked by confidence score from their expertise history. Use for symbol-to-agent routing. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Symbol to query (e.g., "#auth-middleware", "$checkout-flow")',
          },
        },
        required: ['symbol'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_agent_get',
      description:
        'Get full agent profile including personality, expertise table, transferable patterns, and per-project contexts. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Agent ID (e.g., "architect", "builder")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle agent identity tool calls
 */
export async function handleAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_agent_list': {
      const profiles = loadAllAgentProfiles(ctx.rootDir);

      if (profiles.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            agents: [],
            note: 'No .agent profiles found. Create one with `paradigm agent create <id> --global` or via paradigm_agent_create.',
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          count: profiles.length,
          agents: profiles.map(p => ({
            id: p.id,
            role: p.role,
            personality: p.personality,
            topExpertise: (p.expertise || [])
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, 5)
              .map(e => ({
                symbol: e.symbol,
                confidence: parseFloat(e.confidence.toFixed(2)),
                sessions: e.sessions,
              })),
            projectContexts: Object.keys(p.contexts || {}),
            transferableCount: (p.transferable || []).length,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_agent_expertise': {
      const symbol = args.symbol as string;
      const results = queryExpertise(ctx.rootDir, symbol);

      return {
        handled: true,
        text: JSON.stringify({
          symbol,
          agents: results.map(r => ({
            agentId: r.agentId,
            confidence: parseFloat(r.entry.confidence.toFixed(2)),
            sessions: r.entry.sessions,
            lastTouch: r.entry.lastTouch,
          })),
          count: results.length,
          ...(results.length === 0 ? {
            note: `No agents have recorded expertise on ${symbol}. Run \`paradigm agent sync\` to bootstrap from lore history.`,
          } : {}),
        }, null, 2),
      };
    }

    case 'paradigm_agent_get': {
      const id = args.id as string;
      const profile = loadAgentProfile(ctx.rootDir, id);

      if (!profile) {
        return {
          handled: true,
          text: JSON.stringify({
            error: `Agent profile "${id}" not found`,
            suggestion: `Create with \`paradigm agent create ${id} --global\``,
          }, null, 2),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          id: profile.id,
          role: profile.role,
          description: profile.description,
          version: profile.version,
          personality: profile.personality,
          expertise: (profile.expertise || [])
            .sort((a, b) => b.confidence - a.confidence)
            .map(e => ({
              symbol: e.symbol,
              confidence: parseFloat(e.confidence.toFixed(2)),
              sessions: e.sessions,
              lastTouch: e.lastTouch,
            })),
          transferable: (profile.transferable || []).map(p => ({
            id: p.id,
            description: p.description,
            learnedIn: p.learnedIn,
            appliedIn: p.appliedIn,
            successRate: p.successRate,
          })),
          contexts: profile.contexts,
          created: profile.created,
          updated: profile.updated,
        }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
