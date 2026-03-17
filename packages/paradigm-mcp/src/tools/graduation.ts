/**
 * Graduation MCP Tools — #graduation-tools
 *
 * Tools for checking graduation eligibility and viewing tier status.
 */

import {
  checkGraduationEligibility,
  getGraduationSummary,
  graduateHabit,
  demoteHabit,
} from '../utils/graduation-engine.js';
import { getConfig } from '../utils/graduation-store.js';
import type { GraduationCheckResult } from '../utils/graduation-types.js';

interface ToolContext {
  rootDir: string;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export const graduationToolDefinitions = [
  {
    name: 'paradigm_graduate_check',
    description: 'Check which habits are eligible for graduation from habit tier to hook tier. Returns eligibility status for each habit with compliance data and reasoning. ~300 tokens.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        habitId: {
          type: 'string',
          description: 'Check a specific habit by ID. Omit to check all.',
        },
      },
    },
  },
  {
    name: 'paradigm_graduate_status',
    description: 'Show the current automation tier of every habit. Returns tier map grouped by hook/habit/mcp with graduation dates and savings estimate. ~200 tokens.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════

export async function handleGraduateCheck(
  ctx: ToolContext,
  params: { habitId?: string }
): Promise<string> {
  const results = await checkGraduationEligibility(ctx.rootDir);

  let filtered = results;
  if (params.habitId) {
    filtered = results.filter(r => r.habitId === params.habitId);
    if (filtered.length === 0) {
      return JSON.stringify({ error: `No habit found with ID "${params.habitId}"` });
    }
  }

  const eligible = filtered.filter(r => r.eligible);
  const ineligible = filtered.filter(r => !r.eligible && !r.neverGraduate);
  const neverGrad = filtered.filter(r => r.neverGraduate);

  return JSON.stringify({
    summary: {
      checked: filtered.length,
      eligible: eligible.length,
      ineligible: ineligible.length,
      neverGraduate: neverGrad.length,
    },
    ...(eligible.length > 0 ? {
      eligible: eligible.map(formatResult),
      action: 'Run `paradigm graduate promote <id>` to graduate eligible habits.',
    } : {}),
    ...(ineligible.length > 0 ? {
      ineligible: ineligible.map(formatResult),
    } : {}),
    ...(neverGrad.length > 0 ? {
      neverGraduate: neverGrad.map(r => ({ id: r.habitId, name: r.habitName, reason: r.reason })),
    } : {}),
  }, null, 2);
}

export async function handleGraduateStatus(ctx: ToolContext): Promise<string> {
  const summary = getGraduationSummary(ctx.rootDir);
  const config = getConfig(ctx.rootDir);

  const byTier: Record<string, Array<{ id: string; graduatedAt?: string; neverGraduate?: boolean }>> = {
    hook: [],
    habit: [],
    mcp: [],
  };

  for (const [id, state] of Object.entries(summary.states)) {
    const tier = state.tier || 'habit';
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push({
      id,
      ...(state.graduatedAt ? { graduatedAt: state.graduatedAt } : {}),
      ...(state.neverGraduate ? { neverGraduate: true } : {}),
    });
  }

  return JSON.stringify({
    tiers: {
      hook: summary.hookCount,
      habit: summary.habitCount,
      mcp: summary.mcpCount,
    },
    neverGraduate: summary.neverGraduateCount,
    estimatedSavingsPerSession: `~${summary.hookCount * 150} tokens`,
    byTier,
    thresholds: config.thresholds,
  }, null, 2);
}

// ═══════════════════════════════════════════════════════════════════
// REGISTRATION (matches pattern used by other tool modules)
// ═══════════════════════════════════════════════════════════════════

export function getGraduationToolsList() {
  return graduationToolDefinitions;
}

export async function handleGraduationTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ handled: boolean; text: string }> {
  switch (name) {
    case 'paradigm_graduate_check':
      return { handled: true, text: await handleGraduateCheck(ctx, args as { habitId?: string }) };
    case 'paradigm_graduate_status':
      return { handled: true, text: await handleGraduateStatus(ctx) };
    default:
      return { handled: false, text: '' };
  }
}

function formatResult(r: GraduationCheckResult) {
  return {
    id: r.habitId,
    name: r.habitName,
    tier: r.currentTier,
    reason: r.reason,
    ...(r.complianceRate !== undefined ? { complianceRate: r.complianceRate } : {}),
    ...(r.eventCount !== undefined ? { eventCount: r.eventCount } : {}),
    ...(r.inCooldown ? { inCooldown: true } : {}),
  };
}
