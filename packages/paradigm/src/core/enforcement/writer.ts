/**
 * Enforcement Writer — updates config.yaml enforcement section
 *
 * All write operations are surgical: they load config.yaml, modify
 * only the enforcement section, and re-serialize with comments preserved
 * as much as js-yaml allows.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { CheckId, CheckSeverity, EnforcementLevel } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Read and parse config.yaml, returning [parsed, raw] or throw.
 */
function readConfig(rootDir: string): [Record<string, unknown>, string] {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Config is not a valid YAML object');
  }
  return [parsed, raw];
}

/**
 * Write config back to disk.
 */
function writeConfig(rootDir: string, config: Record<string, unknown>): void {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  const content = yaml.dump(config, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: "'",
  });
  fs.writeFileSync(configPath, content, 'utf8');
}

/**
 * Ensure config has an enforcement section, returning it.
 */
function ensureEnforcement(config: Record<string, unknown>): Record<string, unknown> {
  if (!config.enforcement || typeof config.enforcement !== 'object') {
    config.enforcement = { level: 'none', checks: {} };
  }
  return config.enforcement as Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Set the enforcement level preset.
 * Writes `enforcement.level` in config.yaml.
 */
export function setEnforcementLevel(rootDir: string, level: EnforcementLevel): void {
  const [config] = readConfig(rootDir);
  const enforcement = ensureEnforcement(config);
  enforcement.level = level;
  writeConfig(rootDir, config);
}

/**
 * Set a per-check severity override.
 * Writes to `enforcement.checks.<checkId>`.
 */
export function setCheckOverride(rootDir: string, checkId: CheckId, severity: CheckSeverity): void {
  const [config] = readConfig(rootDir);
  const enforcement = ensureEnforcement(config);
  if (!enforcement.checks || typeof enforcement.checks !== 'object') {
    enforcement.checks = {};
  }
  (enforcement.checks as Record<string, string>)[checkId] = severity;
  writeConfig(rootDir, config);
}

/**
 * Remove a per-check override (reverts to preset default).
 */
export function resetCheckOverride(rootDir: string, checkId: CheckId): void {
  const [config] = readConfig(rootDir);
  const enforcement = ensureEnforcement(config);
  if (enforcement.checks && typeof enforcement.checks === 'object') {
    delete (enforcement.checks as Record<string, unknown>)[checkId];
  }
  writeConfig(rootDir, config);
}

/**
 * Remove all per-check overrides (revert entirely to preset).
 */
export function resetAllOverrides(rootDir: string): void {
  const [config] = readConfig(rootDir);
  const enforcement = ensureEnforcement(config);
  enforcement.checks = {};
  writeConfig(rootDir, config);
}

/**
 * Write the default enforcement section if it doesn't already exist.
 * Used by `paradigm shift` to seed new projects.
 */
export function ensureEnforcementDefaults(rootDir: string): boolean {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(raw) as Record<string, unknown>;
    if (!config || typeof config !== 'object') {
      return false;
    }

    if (config.enforcement) {
      return false; // Already present
    }

    config.enforcement = {
      level: 'none',
      checks: {},
      orchestration: {
        threshold: 3,
        detection: 'git-diff',
        exempt: ['*.md', '*.yaml', '*.yml', '.purpose'],
      },
    };

    writeConfig(rootDir, config);
    return true;
  } catch {
    return false;
  }
}
