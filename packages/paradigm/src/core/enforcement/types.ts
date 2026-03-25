/**
 * Enforcement Configuration — Type Definitions
 *
 * Defines the enforcement level presets, per-check severity overrides,
 * and orchestration thresholds for the Paradigm stop hook system.
 */

// ═══════════════════════════════════════════════════════════════════
// ENFORCEMENT LEVELS & SEVERITY
// ═══════════════════════════════════════════════════════════════════

export type EnforcementLevel = 'strict' | 'balanced' | 'minimal';

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
