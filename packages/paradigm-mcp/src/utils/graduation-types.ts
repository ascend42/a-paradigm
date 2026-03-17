/**
 * Graduation Types — #graduation-types
 *
 * Data types for the automation tier graduation system.
 * Tiers: MCP tools (high cost) → Habits (medium) → Hooks (zero cost)
 */

// ═══════════════════════════════════════════════════════════════════
// GRADUATION STATE
// ═══════════════════════════════════════════════════════════════════

export type GraduationTier = 'mcp' | 'habit' | 'hook';

export interface GraduationState {
  habitId: string;
  tier: GraduationTier;
  previousTier: GraduationTier | null;
  graduatedAt: string | null;      // ISO timestamp
  demotedAt: string | null;        // ISO timestamp
  complianceAtGraduation: number;  // 0-100
  hookScript: string | null;       // Generated script path (null = hand-written hook)
  failureCount: number;            // Since last graduation
  cooldownUntil: string | null;    // Cannot re-graduate until
  neverGraduate: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// GRADUATION CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface GraduationThresholds {
  minComplianceRate: number;        // Default: 90
  minEvents: number;                // Default: 20
  timeWindowDays: number;           // Default: 30
  minConsecutiveSessions: number;   // Default: 5
  recencyDays: number;              // Default: 7
}

export interface DemotionConfig {
  failureThreshold: number;         // Default: 3
  failureWindowDays: number;        // Default: 7
  cooldownDays: number;             // Default: 14
}

export interface GraduationConfig {
  enabled: boolean;
  thresholds: GraduationThresholds;
  demotion: DemotionConfig;
  neverGraduate: string[];
}

export const DEFAULT_GRADUATION_CONFIG: GraduationConfig = {
  enabled: true,
  thresholds: {
    minComplianceRate: 90,
    minEvents: 20,
    timeWindowDays: 30,
    minConsecutiveSessions: 5,
    recencyDays: 7,
  },
  demotion: {
    failureThreshold: 3,
    failureWindowDays: 7,
    cooldownDays: 14,
  },
  neverGraduate: [
    'explore-before-implement',
    'ripple-before-modify',
    'check-fragility',
    'wisdom-before-implement',
    'confidence-on-decisions',
    'university-onboarded',
    'university-content-valid',
  ],
};

// ═══════════════════════════════════════════════════════════════════
// GRADUATION YAML FORMAT
// ═══════════════════════════════════════════════════════════════════

export interface GraduationYaml {
  version: string;
  config: Partial<GraduationConfig>;
  states: Record<string, Partial<GraduationState>>;
}

// ═══════════════════════════════════════════════════════════════════
// CHECK RESULTS
// ═══════════════════════════════════════════════════════════════════

export interface GraduationCheckResult {
  habitId: string;
  habitName: string;
  currentTier: GraduationTier;
  eligible: boolean;
  reason: string;
  complianceRate?: number;
  eventCount?: number;
  neverGraduate: boolean;
  inCooldown: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// CHECK TYPE GRADUATION RULES
// ═══════════════════════════════════════════════════════════════════

/**
 * Check types that can NEVER graduate to hooks because they require
 * the agent to call an MCP tool and reason about the result.
 */
export const NON_GRADUATABLE_CHECK_TYPES = new Set([
  'tool-called',
  'context-checked',
]);

/**
 * Check types that map to filesystem-verifiable checks and CAN graduate.
 */
export const GRADUATABLE_CHECK_TYPES = new Set([
  'file-exists',
  'file-modified',
  'lore-recorded',
  'gates-declared',
  'tests-exist',
  'git-clean',
  'symbols-registered',
  'aspect-anchored',
  'commit-message-format',
  'flow-coverage',
]);
