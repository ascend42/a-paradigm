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
  saveAgentProfile,
  queryExpertise,
  verifyIntegrity,
  loadProjectRoster,
  saveProjectRoster,
  listAllGlobalAgentIds,
} from '../utils/agent-loader.js';
import { loadAgentState, loadAllAgentStates } from '../utils/agent-state.js';

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
          response_format: {
            type: 'string',
            enum: ['concise', 'detailed'],
            description: 'Response detail level. "concise" returns only top agent (default: "detailed")',
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
    {
      name: 'paradigm_agent_bench',
      description:
        'Bench an agent — Maestro will skip this agent during orchestration and nomination scoring. Use when an agent is noisy or unhelpful. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Agent ID to bench (e.g., "architect")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_agent_activate',
      description:
        'Activate a benched agent — restore it to active Maestro orchestration. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Agent ID to activate (e.g., "architect")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: false,
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
      const roster = loadProjectRoster(ctx.rootDir);

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

      const activeProfiles = roster ? profiles.filter(p => roster.includes(p.id)) : profiles;
      const inactiveCount = roster ? profiles.length - activeProfiles.length : 0;

      // Load agent states for project context
      const allStates = loadAllAgentStates(ctx.rootDir);
      const stateMap = new Map(allStates.map(s => [s.id, s]));

      return {
        handled: true,
        text: JSON.stringify({
          count: activeProfiles.length,
          totalAvailable: profiles.length,
          ...(roster ? { rosterActive: true, inactiveCount } : { rosterActive: false }),
          agents: activeProfiles.map(p => {
            const state = stateMap.get(p.id);
            return {
            id: p.id,
            role: p.role,
            nickname: p.nickname,
            personality: p.personality,
            ...(state ? {
              lastSession: state.lastSession?.summary?.slice(0, 100),
              lastSessionAge: state.lastSession?.date,
              pendingWork: state.pendingWork?.length || 0,
              sessionsOnProject: state.sessionsOnProject || 0,
            } : {}),
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
            ...(p.attention?.threshold != null ? { threshold: p.attention.threshold } : {}),
          }}),
        }, null, 2),
      };
    }

    case 'paradigm_agent_expertise': {
      const symbol = args.symbol as string;
      const expertiseResponseFormat = args.response_format as 'concise' | 'detailed' | undefined;
      const results = queryExpertise(ctx.rootDir, symbol);

      if (expertiseResponseFormat === 'concise') {
        return {
          handled: true,
          text: JSON.stringify({
            symbol,
            topAgent: results.length > 0 ? {
              id: results[0].agentId,
              confidence: parseFloat(results[0].entry.confidence.toFixed(2)),
            } : null,
          }, null, 2),
        };
      }

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

      const integrityStatus = verifyIntegrity(profile);

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
          ...(profile.permissions ? { permissions: profile.permissions } : {}),
          integrity: integrityStatus,
        }, null, 2),
      };
    }

    case 'paradigm_agent_bench': {
      const benchId = args.id as string;
      const benchProfile = loadAgentProfile(ctx.rootDir, benchId);
      if (!benchProfile) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Agent "${benchId}" not found` }, null, 2),
        };
      }

      // Remove from project roster (roster-scoped, not global)
      let currentRoster = loadProjectRoster(ctx.rootDir);
      if (currentRoster) {
        currentRoster = currentRoster.filter(id => id !== benchId);
      } else {
        // No roster yet — create one with all agents MINUS this one
        currentRoster = listAllGlobalAgentIds().filter(id => id !== benchId);
      }
      saveProjectRoster(ctx.rootDir, currentRoster);

      return {
        handled: true,
        text: JSON.stringify({
          id: benchId,
          removedFromRoster: true,
          rosterCount: currentRoster.length,
          note: `${benchId} removed from this project's roster. Still available globally.`,
        }, null, 2),
      };
    }

    case 'paradigm_agent_activate': {
      const activateId = args.id as string;
      const activateProfile = loadAgentProfile(ctx.rootDir, activateId);
      if (!activateProfile) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Agent "${activateId}" not found` }, null, 2),
        };
      }

      // Add to project roster
      let activateRoster = loadProjectRoster(ctx.rootDir);
      if (activateRoster) {
        if (!activateRoster.includes(activateId)) {
          activateRoster.push(activateId);
          saveProjectRoster(ctx.rootDir, activateRoster);
        }
      } else {
        // No roster = all active already; create roster with all + this one explicitly
        // (no-op in practice, but makes roster explicit)
      }

      return {
        handled: true,
        text: JSON.stringify({
          id: activateId,
          addedToRoster: true,
          rosterCount: activateRoster?.length ?? 'all (no roster)',
          note: `${activateId} is active on this project's roster.`,
        }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
