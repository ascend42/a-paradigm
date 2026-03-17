/**
 * Graduation Engine — #graduation-engine
 *
 * Core logic for evaluating habit graduation eligibility.
 * Queries practice event data from Sentinel DB and checks against thresholds.
 */

import type { HabitDefinition } from './habits-loader.js';
import { loadHabits } from './habits-loader.js';
import { getComplianceRate, getPracticeEvents } from './practice-store.js';
import {
  getConfig,
  getState,
  getAllStates,
  setTier,
  incrementFailure,
  isGraduated,
} from './graduation-store.js';
import type {
  GraduationCheckResult,
  GraduationConfig,
  GraduationState,
} from './graduation-types.js';
import { NON_GRADUATABLE_CHECK_TYPES } from './graduation-types.js';

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY CHECK
// ═══════════════════════════════════════════════════════════════════

/**
 * Check all habits for graduation eligibility.
 * Returns one result per habit with eligibility status and reasoning.
 */
export async function checkGraduationEligibility(
  rootDir: string
): Promise<GraduationCheckResult[]> {
  const config = getConfig(rootDir);
  if (!config.enabled) {
    return [];
  }

  const habits = loadHabits(rootDir);
  const results: GraduationCheckResult[] = [];

  for (const habit of habits) {
    if (!habit.enabled) continue;
    const result = await checkHabitEligibility(rootDir, habit, config);
    results.push(result);
  }

  return results;
}

/**
 * Check a single habit for graduation eligibility.
 */
async function checkHabitEligibility(
  rootDir: string,
  habit: HabitDefinition,
  config: GraduationConfig
): Promise<GraduationCheckResult> {
  const state = getState(rootDir, habit.id);
  const base = {
    habitId: habit.id,
    habitName: habit.name,
    currentTier: state.tier,
    neverGraduate: false,
    inCooldown: false,
  };

  // Already graduated
  if (state.tier === 'hook') {
    return { ...base, eligible: false, reason: 'Already graduated to hook' };
  }

  // Never-graduate (config list or state flag)
  if (state.neverGraduate || config.neverGraduate.includes(habit.id)) {
    return { ...base, eligible: false, reason: 'Marked as never-graduate (requires agent cognition)', neverGraduate: true };
  }

  // Non-graduatable check type
  if (NON_GRADUATABLE_CHECK_TYPES.has(habit.check.type)) {
    return { ...base, eligible: false, reason: `Check type "${habit.check.type}" cannot graduate — requires MCP tool output`, neverGraduate: true };
  }

  // Cooldown active
  if (state.cooldownUntil && new Date(state.cooldownUntil) > new Date()) {
    return {
      ...base,
      eligible: false,
      reason: `In cooldown until ${state.cooldownUntil.split('T')[0]} (demoted recently)`,
      inCooldown: true,
    };
  }

  // Query practice events
  const { thresholds } = config;
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - thresholds.timeWindowDays);

  try {
    const compliance = await getComplianceRate(rootDir, {
      habitId: habit.id,
      dateFrom: dateFrom.toISOString(),
    });

    // Insufficient data
    if (compliance.total < thresholds.minEvents) {
      return {
        ...base,
        eligible: false,
        reason: `Insufficient data: ${compliance.total}/${thresholds.minEvents} events in ${thresholds.timeWindowDays}d window`,
        complianceRate: compliance.rate,
        eventCount: compliance.total,
      };
    }

    // Compliance too low
    if (compliance.rate < thresholds.minComplianceRate) {
      return {
        ...base,
        eligible: false,
        reason: `Compliance ${compliance.rate.toFixed(0)}% < ${thresholds.minComplianceRate}% threshold`,
        complianceRate: compliance.rate,
        eventCount: compliance.total,
      };
    }

    // Check recency
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - thresholds.recencyDays);
    const recentCompliance = await getComplianceRate(rootDir, {
      habitId: habit.id,
      dateFrom: recentDate.toISOString(),
    });

    if (recentCompliance.total === 0) {
      return {
        ...base,
        eligible: false,
        reason: `No events in last ${thresholds.recencyDays} days — habit may be dormant`,
        complianceRate: compliance.rate,
        eventCount: compliance.total,
      };
    }

    // All thresholds met
    return {
      ...base,
      eligible: true,
      reason: `Ready: ${compliance.rate.toFixed(0)}% compliance over ${compliance.total} events in ${thresholds.timeWindowDays}d`,
      complianceRate: compliance.rate,
      eventCount: compliance.total,
    };
  } catch {
    return {
      ...base,
      eligible: false,
      reason: 'Unable to query practice events (Sentinel DB unavailable)',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// GRADUATION ACTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Graduate a habit to hook tier.
 */
export function graduateHabit(
  rootDir: string,
  habitId: string,
  complianceRate: number,
  hookScript?: string
): void {
  setTier(rootDir, habitId, 'hook', {
    complianceAtGraduation: Math.round(complianceRate),
    hookScript: hookScript || null,
  });
}

/**
 * Demote a habit from hook back to habit tier.
 */
export function demoteHabit(rootDir: string, habitId: string, cooldownDays?: number): void {
  const config = getConfig(rootDir);
  const days = cooldownDays ?? config.demotion.cooldownDays;
  const cooldownUntil = new Date();
  cooldownUntil.setDate(cooldownUntil.getDate() + days);

  setTier(rootDir, habitId, 'habit', {
    cooldownUntil: cooldownUntil.toISOString(),
  });
}

/**
 * Record a graduation failure and check if demotion is needed.
 * Returns true if the habit was demoted.
 */
export function recordGraduationFailure(rootDir: string, habitId: string): boolean {
  const config = getConfig(rootDir);
  const count = incrementFailure(rootDir, habitId);

  if (count >= config.demotion.failureThreshold) {
    demoteHabit(rootDir, habitId);
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get a summary of all graduation states for reporting.
 */
export function getGraduationSummary(rootDir: string): {
  hookCount: number;
  habitCount: number;
  mcpCount: number;
  neverGraduateCount: number;
  states: Record<string, GraduationState>;
} {
  const habits = loadHabits(rootDir);
  const config = getConfig(rootDir);
  const states = getAllStates(rootDir);

  let hookCount = 0;
  let habitCount = 0;
  let mcpCount = 0;
  let neverGraduateCount = 0;

  for (const habit of habits) {
    if (!habit.enabled) continue;
    const state = states[habit.id];
    const tier = state?.tier || 'habit';
    const isNever = state?.neverGraduate ||
      config.neverGraduate.includes(habit.id) ||
      NON_GRADUATABLE_CHECK_TYPES.has(habit.check.type);

    if (tier === 'hook') hookCount++;
    else if (tier === 'mcp') mcpCount++;
    else habitCount++;

    if (isNever) neverGraduateCount++;
  }

  return { hookCount, habitCount, mcpCount, neverGraduateCount, states };
}
