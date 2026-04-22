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
  checkLegacySymbol,
  type GateStep,
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
 * Check if a symbol exists in the codebase.
 * Checks both source code files and .purpose file declarations.
 */
function symbolExistsInCode(symbol: string, rootDir: string): boolean {
  // 1. Check .purpose files for declared symbols (e.g. "#my-component:" at line start)
  try {
    const purposeResult = execSync(
      `grep -r --include=".purpose" -l "^${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:" "${rootDir}" 2>/dev/null | head -1`,
      { encoding: 'utf-8' }
    );
    if (purposeResult.trim().length > 0) return true;
  } catch {
    // Not found in .purpose files, continue
  }

  // 2. Check source code files
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
// Circular Dependency Detection
// ============================================================================

/**
 * Build a directed adjacency graph of flow dependencies.
 * A flow $A depends on $B if $A has a step referencing $B (type: 'action', symbol: '$B')
 * or if $A lists $B in relatedFlows.
 */
function buildFlowGraph(flows: FlowDefinition[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const flow of flows) {
    if (!graph.has(flow.id)) {
      graph.set(flow.id, new Set());
    }

    // Steps that reference other flows ($ prefix)
    for (const step of flow.steps || []) {
      if (step.symbol.startsWith('$') && step.symbol !== flow.id) {
        graph.get(flow.id)!.add(step.symbol);
      }
    }

    // relatedFlows edges
    for (const related of flow.relatedFlows || []) {
      if (related.startsWith('$') && related !== flow.id) {
        graph.get(flow.id)!.add(related);
      }
    }
  }

  return graph;
}

/**
 * Detect circular dependencies among flows using iterative DFS.
 * Returns all unique cycles found.
 */
export function detectCircularDependencies(
  flows: FlowDefinition[]
): Array<{ cycle: string[]; message: string }> {
  const graph = buildFlowGraph(flows);
  const cycles: Array<{ cycle: string[]; message: string }> = [];
  const seenCycles = new Set<string>();

  // States: 0 = unvisited, 1 = in current path, 2 = fully visited
  const state = new Map<string, number>();
  for (const id of graph.keys()) {
    state.set(id, 0);
  }

  function dfs(node: string, path: string[]): void {
    state.set(node, 1); // mark as in-progress
    path.push(node);

    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (state.get(neighbor) === 1) {
        // Found a cycle — extract the cycle portion from the path
        const cycleStart = path.indexOf(neighbor);
        const cyclePath = [...path.slice(cycleStart), neighbor];

        // Normalize cycle key to avoid duplicates (start from lexicographically smallest)
        const minIdx = cyclePath.slice(0, -1).reduce(
          (min, val, idx, arr) => val < arr[min] ? idx : min, 0
        );
        const normalized = [
          ...cyclePath.slice(minIdx, -1),
          ...cyclePath.slice(0, minIdx),
          cyclePath[minIdx], // close the cycle
        ];
        const key = normalized.join(' -> ');

        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push({
            cycle: cyclePath,
            message: `Circular dependency: ${cyclePath.join(' → ')}`,
          });
        }
      } else if (state.get(neighbor) === 0) {
        dfs(neighbor, path);
      }
    }

    path.pop();
    state.set(node, 2); // mark as fully visited
  }

  for (const node of graph.keys()) {
    if (state.get(node) === 0) {
      dfs(node, []);
    }
  }

  return cycles;
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
  const portalLoad = loadPortalConfig(rootDir);
  const portalConfig = portalLoad.status === 'ok' ? portalLoad.data : null;
  const declaredGates = portalConfig ? extractDeclaredGates(portalConfig) : [];
  const declaredGatesSet = new Set(declaredGates);

  // Validate each step
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const parsed = parseSymbol(step.symbol);

    if (!parsed) {
      const legacy = checkLegacySymbol(step.symbol);
      const message = legacy
        ? `Step ${i + 1}: "${step.symbol}" uses deprecated v1 prefix "${legacy.prefix}". ${legacy.migration}`
        : `Step ${i + 1}: Invalid symbol format "${step.symbol}" — must start with a v2 prefix (#, $, ^, !, ~)`;
      result.issues.push({
        severity: 'error',
        message,
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
    circularDependencies: [],
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

  // Check for cross-flow issues
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

  // Detect circular dependencies via DFS
  const cycles = detectCircularDependencies(flows);
  result.circularDependencies = cycles;

  for (const cycle of cycles) {
    result.crossFlowIssues.push({
      severity: 'error',
      message: cycle.message,
      flows: cycle.cycle.slice(0, -1), // remove closing duplicate
    });
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

  if (result.circularDependencies.length > 0) {
    lines.push('Circular Dependencies:');
    for (const dep of result.circularDependencies) {
      lines.push(`  ✗ ${dep.message}`);
    }
    lines.push('');
    lines.push('  Resolution: Break the cycle by removing a step or relatedFlows reference.');
    lines.push('  See: paradigm doctor or .paradigm/docs/troubleshooting.md');
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

// ============================================================================
// Mermaid Diagram Generation
// ============================================================================

/**
 * Generate a Mermaid flowchart diagram from a flow definition
 */
export function generateMermaidDiagram(flow: FlowDefinition): string {
  const lines: string[] = [];

  lines.push('```mermaid');
  lines.push('flowchart TD');
  lines.push(`  START([${escapeLabel(flow.trigger)}])`);

  let prevId = 'START';

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const nodeId = `S${i}`;
    const label = escapeLabel(step.symbol);

    switch (step.type) {
      case 'gate': {
        // Diamond shape for gates
        const gateStep = step as GateStep;
        lines.push(`  ${nodeId}{${label}}`);
        lines.push(`  ${prevId} --> ${nodeId}`);
        // Add deny path
        if (gateStep.failResponse || step.errorSignal) {
          const denyId = `DENY${i}`;
          const denyLabel = gateStep.failResponse || step.errorSignal || 'Denied';
          lines.push(`  ${denyId}[/${escapeLabel(denyLabel)}/]`);
          lines.push(`  ${nodeId} -->|deny| ${denyId}`);
        }
        break;
      }
      case 'action':
        // Rectangle for actions
        lines.push(`  ${nodeId}[${label}]`);
        lines.push(`  ${prevId} -->|${step.optional ? 'optional' : 'allow'}| ${nodeId}`);
        break;
      case 'signal':
        // Rounded rectangle for signals
        lines.push(`  ${nodeId}([${label}])`);
        lines.push(`  ${prevId} --> ${nodeId}`);
        break;
    }

    prevId = nodeId;
  }

  // Success signal
  if (flow.successSignal) {
    lines.push(`  SUCCESS([${escapeLabel(flow.successSignal)}])`);
    lines.push(`  ${prevId} --> SUCCESS`);
  }

  // Style classes
  lines.push('');
  lines.push('  classDef gate fill:#f9d71c,stroke:#333,color:#000');
  lines.push('  classDef action fill:#4a90d9,stroke:#333,color:#fff');
  lines.push('  classDef signal fill:#50c878,stroke:#333,color:#fff');

  // Apply styles
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    lines.push(`  class S${i} ${step.type}`);
  }

  lines.push('```');

  return lines.join('\n');
}

/** Escape special Mermaid characters in labels */
function escapeLabel(text: string): string {
  return text.replace(/"/g, '\\"').replace(/[[\]{}()]/g, '');
}
