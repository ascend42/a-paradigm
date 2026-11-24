/**
 * Enforcement Configuration — Type Definitions
 *
 * Defines the enforcement level presets, per-check severity overrides,
 * and orchestration thresholds for the Paradigm stop hook system.
 */

// ═══════════════════════════════════════════════════════════════════
// ENFORCEMENT LEVELS & SEVERITY
// ═══════════════════════════════════════════════════════════════════

/**
 * Every valid enforcement level, strictest first. The single source of truth:
 * the type, `isValidLevel`, CLI help and error messages all derive from it.
 * `none` (every check off) is the default.
 */
export const ENFORCEMENT_LEVELS = ['strict', 'balanced', 'minimal', 'none'] as const;

export type EnforcementLevel = typeof ENFORCEMENT_LEVELS[number];

/** Help text of `paradigm enforcement set <level>`: names every valid level. */
export const ENFORCEMENT_SET_DESCRIPTION =
  `Set enforcement level preset (${ENFORCEMENT_LEVELS.join(', ')}). none turns every check off and is the default`;

export type CheckSeverity = 'block' | 'warn' | 'off';

// ═══════════════════════════════════════════════════════════════════
// CHECK IDS — all enforceable checks in the system
// ═══════════════════════════════════════════════════════════════════

export const CHECK_IDS = [
  'purpose-coverage',
  'purpose-exists',
  'portal-gates',
  'aspect-anchors',
  'purpose-freshness',
  'aspect-advisory',
  'lore-required',
  'habits-blocking',
  'purpose-required-patterns',
  'drift-detection',
  'portal-compliance',
  'graduation-tracking',
  'orchestration-required',
] as const;

export type CheckId = typeof CHECK_IDS[number];

// ═══════════════════════════════════════════════════════════════════
// ENFORCEMENT CONFIG — the full configuration shape
// ═══════════════════════════════════════════════════════════════════

export interface OrchestrationConfig {
  /** Number of files that triggers orchestration requirement */
  threshold: number;
  /** Detection mode: 'git-diff' | 'session-files' */
  detection: string;
  /** Glob patterns exempt from orchestration requirement */
  exempt: string[];
}

export interface EnforcementConfig {
  /** Active preset level */
  level: EnforcementLevel;
  /** Per-check severity overrides (takes precedence over preset) */
  checks: Partial<Record<CheckId, CheckSeverity>>;
  /** Orchestration requirement settings */
  orchestration: OrchestrationConfig;
}
