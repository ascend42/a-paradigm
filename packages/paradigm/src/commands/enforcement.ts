/**
 * paradigm enforcement — Manage enforcement configuration
 *
 * Subcommands:
 *   (default)                    Show enforcement status table
 *   set <level>                  Set preset level (strict/balanced/minimal)
 *   override <check-id> <sev>   Set a per-check severity override
 *   reset <check-id>            Remove a per-check override
 *   resolve --json               Output full resolved severity map
 */

import chalk from 'chalk';
import { out, success, warn, error, header, kv, json as jsonOut } from '../utils/cli-output.js';
import {
  CHECK_IDS,
  loadEnforcementConfig,
  resolveAllChecks,
  getCheckSeverity,
  setEnforcementLevel,
  setCheckOverride,
  resetCheckOverride,
  resetAllOverrides,
  isValidLevel,
  isValidCheckId,
  isValidSeverity,
  getPresetSeverity,
} from '../core/enforcement/index.js';
import type { CheckSeverity, EnforcementLevel } from '../core/enforcement/index.js';

// ═══════════════════════════════════════════════════════════════════
// STATUS (default)
// ═══════════════════════════════════════════════════════════════════

export async function enforcementStatusCommand(options: { json?: boolean }) {
  const cwd = process.cwd();
  const config = loadEnforcementConfig(cwd);
  const resolved = resolveAllChecks(config);
  const overrideKeys = Object.keys(config.checks);

  if (options.json) {
    jsonOut({
      level: config.level,
      orchestration: config.orchestration,
      overrides: config.checks,
      resolved,
    });
    return;
  }

  header('Enforcement Configuration');
  out('');
  kv('Level', colorLevel(config.level));
  kv('Orchestration threshold', String(config.orchestration.threshold) + ' files');
  kv('Detection', config.orchestration.detection);
  kv('Overrides', overrideKeys.length > 0 ? String(overrideKeys.length) : chalk.dim('none'));
  out('');

  // Table header
  const idCol = 30;
  const sevCol = 12;
  const srcCol = 12;
  out(
    '  ' +
    chalk.dim('Check ID'.padEnd(idCol)) +
    chalk.dim('Severity'.padEnd(sevCol)) +
    chalk.dim('Source')
  );
  out('  ' + chalk.dim('─'.repeat(idCol + sevCol + srcCol)));

  for (const id of CHECK_IDS) {
    const effective = resolved[id];
    const hasOverride = config.checks[id] !== undefined;
    const source = hasOverride ? chalk.cyan('override') : chalk.dim('preset');
    out(
      '  ' +
      id.padEnd(idCol) +
      colorSeverity(effective).padEnd(sevCol + 10) + // +10 for ANSI color codes
      source
    );
  }

  out('');
}

// ═══════════════════════════════════════════════════════════════════
// SET LEVEL
// ═══════════════════════════════════════════════════════════════════

export async function enforcementSetCommand(level: string) {
  if (!isValidLevel(level)) {
    error(`Invalid level: ${level}. Must be one of: strict, balanced, minimal`);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  try {
    setEnforcementLevel(cwd, level);
    success(`Enforcement level set to ${colorLevel(level)}`);
  } catch (e) {
    error(`Failed to set level: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// ═══════════════════════════════════════════════════════════════════
// OVERRIDE
// ═══════════════════════════════════════════════════════════════════

export async function enforcementOverrideCommand(checkId: string, severity: string) {
  if (!isValidCheckId(checkId)) {
    error(`Unknown check ID: ${checkId}`);
    out('  Valid IDs: ' + CHECK_IDS.join(', '));
    process.exitCode = 1;
    return;
  }

  if (!isValidSeverity(severity)) {
    error(`Invalid severity: ${severity}. Must be one of: block, warn, off`);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  try {
    setCheckOverride(cwd, checkId, severity);
    success(`Override set: ${checkId} = ${colorSeverity(severity)}`);
  } catch (e) {
    error(`Failed to set override: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// ═══════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════

export async function enforcementResetCommand(checkId: string | undefined) {
  const cwd = process.cwd();

  if (!checkId) {
    // Reset all overrides
    try {
      resetAllOverrides(cwd);
      success('All enforcement overrides cleared');
    } catch (e) {
      error(`Failed to reset overrides: ${(e as Error).message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (!isValidCheckId(checkId)) {
    error(`Unknown check ID: ${checkId}`);
    out('  Valid IDs: ' + CHECK_IDS.join(', '));
    process.exitCode = 1;
    return;
  }

  try {
    resetCheckOverride(cwd, checkId);
    success(`Override removed: ${checkId} (reverted to preset default)`);
  } catch (e) {
    error(`Failed to reset override: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// ═══════════════════════════════════════════════════════════════════
// RESOLVE
// ═══════════════════════════════════════════════════════════════════

export async function enforcementResolveCommand(options: { json?: boolean }) {
  const cwd = process.cwd();
  const config = loadEnforcementConfig(cwd);
  const resolved = resolveAllChecks(config);

  if (options.json) {
    jsonOut(resolved);
    return;
  }

  // Human-readable output
  header('Resolved Enforcement Checks');
  out('');
  for (const [id, severity] of Object.entries(resolved)) {
    out('  ' + id.padEnd(30) + colorSeverity(severity as CheckSeverity));
  }
  out('');
}

// ═══════════════════════════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════════

function colorSeverity(severity: CheckSeverity): string {
  switch (severity) {
    case 'block': return chalk.red('block');
    case 'warn':  return chalk.yellow('warn');
    case 'off':   return chalk.dim('off');
    default:      return String(severity);
  }
}

function colorLevel(level: string): string {
  switch (level) {
    case 'strict':   return chalk.red(level);
    case 'balanced': return chalk.yellow(level);
    case 'minimal':  return chalk.green(level);
    default:         return level;
  }
}
