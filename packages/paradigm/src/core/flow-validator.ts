/**
 * Flow Validator
 *
 * Validates flow definitions against the codebase.
 * Checks that gates, actions, and signals are properly defined and implemented.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';
import {
  FlowDefinition,
  FlowsConfig,
  FlowValidationResult,
  AllFlowsValidationResult,
  configToFlowDefinitions,
  validateFlowStructure,
  parseSymbol,
} from './flow-schema.js';
import { loadPortalConfig, extractDeclaredGates } from './portal-compliance.js';

// ============================================================================
// Types
// ============================================================================

export interface FlowValidateOptions {
  /** Flow ID to validate (if not provided, validates all) */
  flowId?: string;

  /** Check if steps are actually implemented in code */
  checkImplementation?: boolean;

  /** Project root directory */
  rootDir: string;
}

// ============================================================================
// Flow Loading
// ============================================================================

/**
 * Load flows configuration from .paradigm/flows.yaml
 */
export function loadFlowsConfig(rootDir: string): FlowsConfig | null {
  const flowsPath = path.join(rootDir, '.paradigm', 'flows.yaml');

  if (!fs.existsSync(flowsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(flowsPath, 'utf-8');
    return yaml.load(content) as FlowsConfig;
  } catch {
    return null;
  }
}

/**
 * Load flows from .purpose files (alternative location)
 */
export function loadFlowsFromPurpose(rootDir: string): FlowDefinition[] {
  const flows: FlowDefinition[] = [];

  // Find all .purpose files
  try {
    const result = execSync(
      `find "${rootDir}" -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null || true`,
      { encoding: 'utf-8' }
    );

    for (const purposePath of result.split('\n').filter(Boolean)) {
      try {
        const content = fs.readFileSync(purposePath, 'utf-8');

        // Look for flows section in YAML frontmatter or embedded YAML
        const flowsMatch = content.match(/flows:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
        if (flowsMatch) {
          const flowsYaml = yaml.load(`flows:\n${flowsMatch[1]}`);
          if (flowsYaml && typeof flowsYaml === 'object' && 'flows' in flowsYaml) {
            const flowsData = (flowsYaml as { flows: Record<string, unknown> }).flows;
            for (const [id, flow] of Object.entries(flowsData)) {
              flows.push({
                id,
                ...(flow as Omit<FlowDefinition, 'id'>),
                definedIn: path.relative(rootDir, purposePath),
              });
            }
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }
  } catch {
    // find command not available
  }

  return flows;
}

/**
 * Get all flow definitions from both flows.yaml and .purpose files
 */
export function getAllFlows(rootDir: string): FlowDefinition[] {
  const flows: FlowDefinition[] = [];

  // Load from flows.yaml
  const config = loadFlowsConfig(rootDir);
  if (config) {
    const configFlows = configToFlowDefinitions(config);
    for (const flow of configFlows) {
      flow.definedIn = '.paradigm/flows.yaml';
      flows.push(flow);
    }
  }

  // Load from .purpose files
  const purposeFlows = loadFlowsFromPurpose(rootDir);
  for (const flow of purposeFlows) {
    // Don't duplicate if already in flows.yaml
    if (!flows.some(f => f.id === flow.id)) {
      flows.push(flow);
    }
  }

  return flows;
}

// ============================================================================
// Symbol Detection
// ============================================================================

/**
 * Check if a symbol exists in the codebase
 */
function symbolExistsInCode(symbol: string, rootDir: string): boolean {
  try {
    const result = execSync(
      `grep -r --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.py" --include="*.go" -l "${symbol}" "${rootDir}" 2>/dev/null | head -1`,
      { encoding: 'utf-8' }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a signal is emitted somewhere
 */
function signalIsEmitted(signal: string, rootDir: string): boolean {
  // Search for common signal emission patterns
  const patterns = [
    signal,
    `emit.*${signal.replace(/^!/, '')}`,
    `dispatch.*${signal.replace(/^!/, '')}`,
    `send.*${signal.replace(/^!/, '')}`,
  ];

  for (const pattern of patterns) {
    try {
      const result = execSync(
        `grep -r --include="*.ts" --include="*.js" -l "${pattern}" "${rootDir}" 2>/dev/null | head -1`,
        { encoding: 'utf-8' }
      );
      if (result.trim().length > 0) return true;
    } catch {
      // Continue with next pattern
    }
  }

  return false;
}

// ============================================================================
// Flow Validation
// ============================================================================

/**
 * Validate a single flow definition
 */
export function validateFlow(
  flow: FlowDefinition,
  options: FlowValidateOptions
): FlowValidationResult {
  const { rootDir, checkImplementation = false } = options;

  const result: FlowValidationResult = {
    flowId: flow.id,
    status: 'valid',
    coverage: {
      gatesReferenced: [],
      gatesMissing: [],
      actionsReferenced: [],
      actionsMissing: [],
      signalsEmitted: [],
      signalsMissing: [],
    },
    issues: [],
    suggestions: [],
  };

  // Validate basic structure
  const structureErrors = validateFlowStructure(flow);
  for (const error of structureErrors) {
    result.issues.push({
      severity: 'error',
      message: error,
    });
  }

  if (structureErrors.length > 0) {
    result.status = 'invalid';
  }

  // Load portal.yaml for gate validation
  const portalConfig = loadPortalConfig(rootDir);
  const declaredGates = portalConfig ? extractDeclaredGates(portalConfig) : [];
  const declaredGatesSet = new Set(declaredGates);

  // Validate each step
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const parsed = parseSymbol(step.symbol);

    if (!parsed) {
      result.issues.push({
        severity: 'error',
        message: `Step ${i + 1}: Invalid symbol format "${step.symbol}"`,
        step: i,
        symbol: step.symbol,
      });
      continue;
    }

    const symbolName = parsed.name;

    switch (step.type) {
      case 'gate':
        result.coverage.gatesReferenced.push(step.symbol);

        // Check if gate is declared in portal.yaml
        if (!declaredGatesSet.has(symbolName)) {
          result.coverage.gatesMissing.push(step.symbol);
          result.issues.push({
            severity: 'error',
            message: `Step ${i + 1}: Gate ${step.symbol} not declared in portal.yaml`,
            step: i,
            symbol: step.symbol,
          });
        }
        break;

      case 'action':
        result.coverage.actionsReferenced.push(step.symbol);

        // Optionally check if action exists in codebase
        if (checkImplementation && !symbolExistsInCode(step.symbol, rootDir)) {
          result.coverage.actionsMissing.push(step.symbol);
          result.issues.push({
            severity: 'warning',
            message: `Step ${i + 1}: Action ${step.symbol} not found in codebase`,
            step: i,
            symbol: step.symbol,
          });
        }
        break;

      case 'signal':
        result.coverage.signalsEmitted.push(step.symbol);

        // Optionally check if signal is emitted
        if (checkImplementation && !signalIsEmitted(step.symbol, rootDir)) {
          result.coverage.signalsMissing.push(step.symbol);
          result.issues.push({
            severity: 'warning',
            message: `Step ${i + 1}: Signal ${step.symbol} not emitted anywhere`,
            step: i,
            symbol: step.symbol,
          });
        }
        break;
    }
  }

  // Check success signal
  if (flow.successSignal) {
    result.coverage.signalsEmitted.push(flow.successSignal);
    if (checkImplementation && !signalIsEmitted(flow.successSignal, rootDir)) {
      result.coverage.signalsMissing.push(flow.successSignal);
      result.issues.push({
        severity: 'warning',
        message: `Success signal ${flow.successSignal} not emitted anywhere`,
        symbol: flow.successSignal,
      });
    }
  }

  // Determine final status
  const hasErrors = result.issues.some(i => i.severity === 'error');
  const hasWarnings = result.issues.some(i => i.severity === 'warning');

  if (hasErrors) {
    result.status = 'invalid';
  } else if (hasWarnings) {
    result.status = 'warnings';
  }

  // Generate suggestions
  if (result.coverage.gatesMissing.length > 0) {
    result.suggestions.push(
      `Add missing gates to portal.yaml: ${result.coverage.gatesMissing.join(', ')}`
    );
  }

  if (result.coverage.actionsMissing.length > 0) {
    result.suggestions.push(
      `Implement missing actions or update flow: ${result.coverage.actionsMissing.join(', ')}`
    );
  }

  return result;
}

/**
 * Validate all flows in the project
 */
export function validateAllFlows(options: FlowValidateOptions): AllFlowsValidationResult {
  const flows = getAllFlows(options.rootDir);

  const result: AllFlowsValidationResult = {
    status: 'valid',
    totalFlows: flows.length,
    validFlows: 0,
    warningFlows: 0,
    invalidFlows: 0,
    results: [],
    crossFlowIssues: [],
  };

  if (flows.length === 0) {
    return result;
  }

  // Validate each flow
  for (const flow of flows) {
    const flowResult = validateFlow(flow, options);
    result.results.push(flowResult);

    switch (flowResult.status) {
      case 'valid':
        result.validFlows++;
        break;
      case 'warnings':
        result.warningFlows++;
        break;
      case 'invalid':
        result.invalidFlows++;
        break;
    }
  }

  // Check for cross-flow issues (circular dependencies)
  const flowIds = new Set(flows.map(f => f.id));
  for (const flow of flows) {
    if (flow.relatedFlows) {
      for (const relatedId of flow.relatedFlows) {
        if (!flowIds.has(relatedId)) {
          result.crossFlowIssues.push({
            severity: 'warning',
            message: `Flow ${flow.id} references unknown flow ${relatedId}`,
            flows: [flow.id, relatedId],
          });
        }
      }
    }
  }

  // Determine overall status
  if (result.invalidFlows > 0 || result.crossFlowIssues.some(i => i.severity === 'error')) {
    result.status = 'invalid';
  } else if (result.warningFlows > 0 || result.crossFlowIssues.some(i => i.severity === 'warning')) {
    result.status = 'warnings';
  }

  return result;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format flow validation result for display
 */
export function formatFlowValidationResult(result: FlowValidationResult): string {
  const lines: string[] = [];

  const statusIcon = result.status === 'valid' ? '✓' :
    result.status === 'warnings' ? '⚠' : '✗';

  lines.push(`${statusIcon} ${result.flowId}: ${result.status}`);

  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      const icon = issue.severity === 'error' ? '✗' :
        issue.severity === 'warning' ? '⚠' : 'ℹ';
      lines.push(`  ${icon} ${issue.message}`);
    }
  }

  if (result.suggestions.length > 0) {
    lines.push('  Suggestions:');
    for (const suggestion of result.suggestions) {
      lines.push(`    → ${suggestion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format all flows validation result for display
 */
export function formatAllFlowsValidation(result: AllFlowsValidationResult): string {
  const lines: string[] = [];

  lines.push('Flow Validation Summary');
  lines.push('======================');
  lines.push(`Total: ${result.totalFlows}`);
  lines.push(`Valid: ${result.validFlows}`);
  lines.push(`Warnings: ${result.warningFlows}`);
  lines.push(`Invalid: ${result.invalidFlows}`);
  lines.push('');

  for (const flowResult of result.results) {
    lines.push(formatFlowValidationResult(flowResult));
    lines.push('');
  }

  if (result.crossFlowIssues.length > 0) {
    lines.push('Cross-Flow Issues:');
    for (const issue of result.crossFlowIssues) {
      const icon = issue.severity === 'error' ? '✗' : '⚠';
      lines.push(`  ${icon} ${issue.message}`);
    }
  }

  return lines.join('\n');
}
