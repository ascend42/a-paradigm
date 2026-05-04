/**
 * Enforcement Loader — reads config.yaml and resolves enforcement config
 *
 * Merge strategy:
 * 1. Start with the preset for the configured level (default: 'balanced')
 * 2. Apply per-check overrides from enforcement.checks
 * 3. Return the resolved severity for any check via getCheckSeverity()
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { CheckId, CheckSeverity, EnforcementConfig, EnforcementLevel } from './types.js';
import { CHECK_IDS } from './types.js';
import { getPreset, isValidLevel, isValidSeverity, isValidCheckId } from './presets.js';

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_LEVEL: EnforcementLevel = 'none';

const DEFAULT_ORCHESTRATION = {
  threshold: 3,
  detection: 'git-diff',
  exempt: ['*.md', '*.yaml', '*.yml', '.purpose'],
};

// ═══════════════════════════════════════════════════════════════════
// LOADER
// ═══════════════════════════════════════════════════════════════════

/**
 * Load enforcement configuration from .paradigm/config.yaml.
 * Returns a fully populated EnforcementConfig with defaults applied.
 */
export function loadEnforcementConfig(rootDir: string): EnforcementConfig {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    return buildDefault();
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(content) as Record<string, unknown> | null;

    if (!config || typeof config !== 'object') {
      return buildDefault();
    }

    const enforcement = config.enforcement as Record<string, unknown> | undefined;
    if (!enforcement || typeof enforcement !== 'object') {
      return buildDefault();
    }

    // Parse level
    const rawLevel = enforcement.level;
    const level: EnforcementLevel =
      typeof rawLevel === 'string' && isValidLevel(rawLevel) ? rawLevel : DEFAULT_LEVEL;

    // Parse per-check overrides
    const rawChecks = enforcement.checks as Record<string, unknown> | undefined;
    const checks: Partial<Record<CheckId, CheckSeverity>> = {};
    if (rawChecks && typeof rawChecks === 'object') {
      for (const [key, val] of Object.entries(rawChecks)) {
        if (isValidCheckId(key) && typeof val === 'string' && isValidSeverity(val)) {
          checks[key] = val;
        }
      }
    }

    // Parse orchestration
    const rawOrch = enforcement.orchestration as Record<string, unknown> | undefined;
    const orchestration = { ...DEFAULT_ORCHESTRATION };
    if (rawOrch && typeof rawOrch === 'object') {
      if (typeof rawOrch.threshold === 'number') {
        orchestration.threshold = rawOrch.threshold;
      }
      if (typeof rawOrch.detection === 'string') {
        orchestration.detection = rawOrch.detection;
      }
      if (Array.isArray(rawOrch.exempt)) {
        orchestration.exempt = rawOrch.exempt.filter((e): e is string => typeof e === 'string');
      }
    }

    return { level, checks, orchestration };
  } catch {
    return buildDefault();
  }
}

/**
 * Build a default enforcement config (balanced level, no overrides).
 */
function buildDefault(): EnforcementConfig {
  return {
    level: DEFAULT_LEVEL,
    checks: {},
    orchestration: { ...DEFAULT_ORCHESTRATION },
  };
}

// ═══════════════════════════════════════════════════════════════════
// RESOLVERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the effective severity for a single check.
 * Per-check override takes precedence over the preset.
 */
export function getCheckSeverity(config: EnforcementConfig, checkId: CheckId): CheckSeverity {
  // Per-check override wins
  const override = config.checks[checkId];
  if (override !== undefined) {
    return override;
  }

  // Fall back to preset
  const preset = getPreset(config.level);
  return preset[checkId];
}

/**
 * Resolve the full severity map for all checks.
 * Applies per-check overrides on top of the preset.
 */
export function resolveAllChecks(config: EnforcementConfig): Record<CheckId, CheckSeverity> {
  const preset = getPreset(config.level);

  // Apply overrides
  for (const id of CHECK_IDS) {
    const override = config.checks[id];
    if (override !== undefined) {
      preset[id] = override;
    }
  }

  return preset;
}
