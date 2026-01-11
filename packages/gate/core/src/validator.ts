/**
 * Validator for Gate configurations
 */

import type { ParsedGateConfig, ValidationResult, ValidationIssue, Gate, Lock, Flow } from './types.js';

/**
 * Validate a parsed gate configuration
 */
export function validateGateConfig(config: ParsedGateConfig): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate version
  if (!config.version) {
    issues.push({
      type: 'error',
      message: 'Missing required "version" field',
      path: 'version',
    });
  }

  // Validate gates
  const gateIds = new Set<string>();
  for (const gate of config.gates) {
    validateGate(gate, gateIds, issues);
    gateIds.add(gate.id);
  }

  // Validate flows
  for (const flow of config.flows) {
    validateFlow(flow, gateIds, issues);
  }

  return {
    valid: issues.filter((i) => i.type === 'error').length === 0,
    issues,
  };
}

/**
 * Validate a single gate
 */
function validateGate(gate: Gate, existingIds: Set<string>, issues: ValidationIssue[]): void {
  const path = `gates.${gate.id}`;

  // Check for duplicate IDs
  if (existingIds.has(gate.id)) {
    issues.push({
      type: 'error',
      message: `Duplicate gate ID: "${gate.id}"`,
      path,
    });
  }

  // Validate ID format (kebab-case)
  if (!/^[a-z][a-z0-9-]*$/.test(gate.id)) {
    issues.push({
      type: 'warning',
      message: `Gate ID "${gate.id}" should use kebab-case (e.g., "my-gate")`,
      path,
    });
  }

  // Validate locks
  const lockIds = new Set<string>();
  for (const lock of gate.locks) {
    validateLock(lock, lockIds, `${path}.locks`, issues);
    lockIds.add(lock.id);
  }

  // Validate prizes
  const prizeIds = new Set<string>();
  for (const prize of gate.prizes) {
    if (prizeIds.has(prize.id)) {
      issues.push({
        type: 'error',
        message: `Duplicate prize ID "${prize.id}" in gate "${gate.id}"`,
        path: `${path}.prizes`,
      });
    }
    prizeIds.add(prize.id);

    // Validate prize ID format
    if (!/^[a-z][a-z0-9-]*$/.test(prize.id)) {
      issues.push({
        type: 'warning',
        message: `Prize ID "${prize.id}" should use kebab-case`,
        path: `${path}.prizes`,
      });
    }
  }

  // Warn if gate has no locks
  if (gate.locks.length === 0) {
    issues.push({
      type: 'warning',
      message: `Gate "${gate.id}" has no locks - any entity can pass through`,
      path,
    });
  }
}

/**
 * Validate a single lock
 */
function validateLock(lock: Lock, existingIds: Set<string>, basePath: string, issues: ValidationIssue[]): void {
  const path = `${basePath}.${lock.id}`;

  // Check for duplicate IDs
  if (existingIds.has(lock.id)) {
    issues.push({
      type: 'error',
      message: `Duplicate lock ID: "${lock.id}"`,
      path,
    });
  }

  // Validate ID format
  if (!/^[a-z][a-z0-9-]*$/.test(lock.id)) {
    issues.push({
      type: 'warning',
      message: `Lock ID "${lock.id}" should use kebab-case`,
      path,
    });
  }

  // Validate keys
  if (lock.keys.length === 0) {
    issues.push({
      type: 'error',
      message: `Lock "${lock.id}" has no keys - it can never be opened`,
      path,
    });
  }

  for (const key of lock.keys) {
    // Basic expression validation
    if (!key.expression || key.expression.trim() === '') {
      issues.push({
        type: 'error',
        message: `Key in lock "${lock.id}" has empty expression`,
        path: `${path}.keys`,
      });
    }

    // Check for common expression issues
    if (key.expression.includes('==') && !key.expression.includes('===')) {
      issues.push({
        type: 'warning',
        message: `Key expression uses "==" instead of "===" - consider using strict equality`,
        path: `${path}.keys`,
      });
    }
  }

  // Validate mode
  if (lock.mode && !['all', 'any'].includes(lock.mode)) {
    issues.push({
      type: 'error',
      message: `Invalid lock mode "${lock.mode}" - must be "all" or "any"`,
      path,
    });
  }
}

/**
 * Validate a flow
 */
function validateFlow(flow: Flow, gateIds: Set<string>, issues: ValidationIssue[]): void {
  const path = `flows.${flow.id}`;

  // Validate ID format
  if (!/^[a-z][a-z0-9-]*$/.test(flow.id)) {
    issues.push({
      type: 'warning',
      message: `Flow ID "${flow.id}" should use kebab-case`,
      path,
    });
  }

  // Validate gate references
  for (const gateId of flow.gates) {
    if (!gateIds.has(gateId)) {
      issues.push({
        type: 'error',
        message: `Flow "${flow.id}" references unknown gate "${gateId}"`,
        path: `${path}.gates`,
      });
    }
  }

  // Warn if flow has no gates
  if (flow.gates.length === 0) {
    issues.push({
      type: 'warning',
      message: `Flow "${flow.id}" has no gates`,
      path,
    });
  }

  // Check for duplicate gates in flow
  const seen = new Set<string>();
  for (const gateId of flow.gates) {
    if (seen.has(gateId)) {
      issues.push({
        type: 'warning',
        message: `Flow "${flow.id}" contains duplicate gate "${gateId}"`,
        path: `${path}.gates`,
      });
    }
    seen.add(gateId);
  }
}

/**
 * Format validation issues for console output
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.valid && result.issues.length === 0) {
    return '✅ Configuration is valid';
  }

  const lines: string[] = [];

  const errors = result.issues.filter((i) => i.type === 'error');
  const warnings = result.issues.filter((i) => i.type === 'warning');

  if (errors.length > 0) {
    lines.push(`\n❌ ${errors.length} error(s):`);
    for (const issue of errors) {
      lines.push(`  • ${issue.message}${issue.path ? ` (${issue.path})` : ''}`);
    }
  }

  if (warnings.length > 0) {
    lines.push(`\n⚠️  ${warnings.length} warning(s):`);
    for (const issue of warnings) {
      lines.push(`  • ${issue.message}${issue.path ? ` (${issue.path})` : ''}`);
    }
  }

  if (result.valid) {
    lines.push('\n✅ Configuration is valid (with warnings)');
  } else {
    lines.push('\n❌ Configuration is invalid');
  }

  return lines.join('\n');
}
