/**
 * Enforcement Presets — 3x13 severity grid
 *
 * Each preset defines a default severity for every check ID.
 * Users can override individual checks in config.yaml.
 *
 * - strict:   Maximum enforcement. All checks block or warn.
 * - balanced: Sensible defaults. Core checks block, advisory checks warn.
 * - minimal:  Lightweight. Only critical checks warn, most are off.
 */

import type { CheckId, CheckSeverity, EnforcementLevel } from './types.js';
import { CHECK_IDS } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// PRESET DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

const STRICT: Record<CheckId, CheckSeverity> = {
  'purpose-coverage':          'block',
  'purpose-exists':            'block',
  'portal-gates':              'block',
  'aspect-anchors':            'block',
  'purpose-freshness':         'warn',
  'aspect-advisory':           'warn',
  'lore-required':             'block',
  'habits-blocking':           'block',
  'purpose-required-patterns': 'block',
  'drift-detection':           'block',
  'portal-compliance':         'block',
  'graduation-tracking':       'warn',
  'orchestration-required':    'block',
};

const BALANCED: Record<CheckId, CheckSeverity> = {
  'purpose-coverage':          'block',
  'purpose-exists':            'warn',
  'portal-gates':              'warn',
  'aspect-anchors':            'warn',
  'purpose-freshness':         'warn',
  'aspect-advisory':           'off',
  'lore-required':             'warn',
  'habits-blocking':           'block',
  'purpose-required-patterns': 'warn',
  'drift-detection':           'warn',
  'portal-compliance':         'warn',
  'graduation-tracking':       'off',
  'orchestration-required':    'warn',
};

const MINIMAL: Record<CheckId, CheckSeverity> = {
  'purpose-coverage':          'warn',
  'purpose-exists':            'off',
  'portal-gates':              'off',
  'aspect-anchors':            'off',
  'purpose-freshness':         'off',
  'aspect-advisory':           'off',
  'lore-required':             'off',
  'habits-blocking':           'warn',
  'purpose-required-patterns': 'off',
  'drift-detection':           'off',
  'portal-compliance':         'off',
  'graduation-tracking':       'off',
  'orchestration-required':    'off',
};

// ═══════════════════════════════════════════════════════════════════
// LOOKUP
// ═══════════════════════════════════════════════════════════════════

const PRESETS: Record<EnforcementLevel, Record<CheckId, CheckSeverity>> = {
  strict: STRICT,
  balanced: BALANCED,
  minimal: MINIMAL,
};

/**
 * Get the full severity grid for a preset level.
 */
export function getPreset(level: EnforcementLevel): Record<CheckId, CheckSeverity> {
  return { ...PRESETS[level] };
}

/**
 * Get the preset severity for a single check.
 */
export function getPresetSeverity(level: EnforcementLevel, checkId: CheckId): CheckSeverity {
  return PRESETS[level][checkId];
}

/**
 * Validate that a check ID is known.
 */
export function isValidCheckId(id: string): id is CheckId {
  return (CHECK_IDS as readonly string[]).includes(id);
}

/**
 * Validate that a severity value is known.
 */
export function isValidSeverity(s: string): s is CheckSeverity {
  return s === 'block' || s === 'warn' || s === 'off';
}

/**
 * Validate that a level value is known.
 */
export function isValidLevel(l: string): l is EnforcementLevel {
  return l === 'strict' || l === 'balanced' || l === 'minimal';
}
