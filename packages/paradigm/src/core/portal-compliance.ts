/**
 * Portal Compliance Checker
 *
 * Validates that gates defined in portal.yaml are actually used in the codebase.
 * Language-agnostic: uses grep-based pattern matching to find gate references.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export interface GateDefinition {
  name: string;
  description?: string;
  check?: string;
}

export interface PortalConfig {
  version?: string;
  gates?: Record<string, GateDefinition | string>;
  routes?: Record<string, string[] | { gates: string[]; method?: string }>;
}

export interface GateReference {
  gate: string;
  file: string;
  line: number;
  context: string;
  matchType: 'symbol' | 'function' | 'config';
}

export interface ComplianceReport {
  /** Overall compliance status */
  status: 'compliant' | 'warnings' | 'violations';
  /** Gates declared in portal.yaml but never referenced in code */
  declaredButUnused: string[];
  /** Gate references found in code but not declared in portal.yaml */
  usedButUndeclared: string[];
  /** Gates that are both declared and used */
  properlyDeclared: string[];
  /** Suggestions for fixes */
  suggestions: string[];
  /** Detailed reference information */
  references: GateReference[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Patterns to search for gate references (language-agnostic)
 */
const GATE_REFERENCE_PATTERNS = [
  // Paradigm symbol: ^gateName
  '\\^[a-zA-Z][a-zA-Z0-9_-]*',
  // Common function patterns
  'checkGate\\s*\\(\\s*[\'"][^"\']+[\'"]',
  'requireGate\\s*\\(\\s*[\'"][^"\']+[\'"]',
  'Gate\\s*\\(\\s*[\'"][^"\']+[\'"]',
  'gate:\\s*[\'"][^"\']+[\'"]',
  'gates:\\s*\\[',
  '@Gate\\s*\\(',
  '@RequireGate',
  'useGate\\s*\\(',
];

/**
 * Directories to skip when searching
 */
const SKIP_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.paradigm',
  'vendor',
  '__pycache__',
];

// ============================================================================
// Portal Loading
// ============================================================================

/**
 * Load and parse portal.yaml from project root
 */
export function loadPortalConfig(rootDir: string): PortalConfig | null {
  const portalPath = path.join(rootDir, 'portal.yaml');

  if (!fs.existsSync(portalPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(portalPath, 'utf-8');
    return yaml.load(content) as PortalConfig;
  } catch {
    return null;
  }
}

/**
 * Extract gate names from portal.yaml config
 */
export function extractDeclaredGates(config: PortalConfig): string[] {
  const gates: Set<string> = new Set();

  // Gates from gates section
  if (config.gates) {
    for (const key of Object.keys(config.gates)) {
      // Normalize: remove ^ prefix if present
      const gateName = key.startsWith('^') ? key.slice(1) : key;
      gates.add(gateName);
    }
  }

  // Gates from routes section
  if (config.routes) {
    for (const routeConfig of Object.values(config.routes)) {
      const gateList = Array.isArray(routeConfig) ? routeConfig : routeConfig.gates || [];
      for (const gate of gateList) {
        const gateName = gate.startsWith('^') ? gate.slice(1) : gate;
        gates.add(gateName);
      }
    }
  }

  return Array.from(gates);
}

// ============================================================================
// Code Search
// ============================================================================

/**
 * Find gate references in the codebase using grep
 */
export function findGateReferences(rootDir: string): GateReference[] {
  const references: GateReference[] = [];
  const skipDirsArg = SKIP_DIRECTORIES.map(d => `--exclude-dir=${d}`).join(' ');

  // Search for Paradigm symbol pattern (^gateName)
  try {
    const symbolPattern = '\\^[a-zA-Z][a-zA-Z0-9_-]+';
    const symbolResult = execSync(
      `grep -rn ${skipDirsArg} -E "${symbolPattern}" "${rootDir}" 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    for (const line of symbolResult.split('\n').filter(Boolean)) {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        const [, file, lineNum, context] = match;
        const gateMatch = context.match(/\^([a-zA-Z][a-zA-Z0-9_-]+)/);
        if (gateMatch) {
          references.push({
            gate: gateMatch[1],
            file: path.relative(rootDir, file),
            line: parseInt(lineNum, 10),
            context: context.trim().slice(0, 100),
            matchType: 'symbol',
          });
        }
      }
    }
  } catch {
    // Grep not available or error, continue silently
  }

  // Search for function-based gate checks
  const functionPatterns = [
    { pattern: "checkGate\\s*\\(['\"]([^'\"]+)['\"]", type: 'function' as const },
    { pattern: "requireGate\\s*\\(['\"]([^'\"]+)['\"]", type: 'function' as const },
    { pattern: "gate:\\s*['\"]([^'\"]+)['\"]", type: 'config' as const },
    { pattern: "@Gate\\s*\\(['\"]?([^'\"\\)]+)['\"]?\\)", type: 'function' as const },
  ];

  for (const { pattern, type } of functionPatterns) {
    try {
      const result = execSync(
        `grep -rn ${skipDirsArg} -E "${pattern}" "${rootDir}" 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      for (const line of result.split('\n').filter(Boolean)) {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          const [, file, lineNum, context] = match;
          const gateMatch = context.match(new RegExp(pattern));
          if (gateMatch && gateMatch[1]) {
            const gateName = gateMatch[1].startsWith('^') ? gateMatch[1].slice(1) : gateMatch[1];
            references.push({
              gate: gateName,
              file: path.relative(rootDir, file),
              line: parseInt(lineNum, 10),
              context: context.trim().slice(0, 100),
              matchType: type,
            });
          }
        }
      }
    } catch {
      // Continue on error
    }
  }

  return references;
}

/**
 * Deduplicate gate names from references
 */
function extractUniqueGates(references: GateReference[]): string[] {
  return [...new Set(references.map(r => r.gate))];
}

// ============================================================================
// Compliance Check
// ============================================================================

/**
 * Check portal.yaml compliance against codebase
 *
 * @param rootDir - Project root directory
 * @returns Compliance report
 */
export async function checkPortalCompliance(rootDir: string): Promise<ComplianceReport> {
  const config = loadPortalConfig(rootDir);

  // If no portal.yaml exists, check if any gate references exist in code
  if (!config) {
    const references = findGateReferences(rootDir);
    const usedGates = extractUniqueGates(references);

    if (usedGates.length === 0) {
      return {
        status: 'compliant',
        declaredButUnused: [],
        usedButUndeclared: [],
        properlyDeclared: [],
        suggestions: ['No portal.yaml found, and no gate references detected in code.'],
        references: [],
      };
    }

    return {
      status: 'violations',
      declaredButUnused: [],
      usedButUndeclared: usedGates,
      properlyDeclared: [],
      suggestions: [
        'Gate references found in code but no portal.yaml exists.',
        'Create a portal.yaml file to declare these gates:',
        ...usedGates.map(g => `  - ^${g}`),
        '',
        'Run: paradigm portal init',
      ],
      references,
    };
  }

  // Extract declared gates and find references
  const declaredGates = extractDeclaredGates(config);
  const references = findGateReferences(rootDir);
  const usedGates = extractUniqueGates(references);

  // Compare declared vs used
  const declaredSet = new Set(declaredGates);
  const usedSet = new Set(usedGates);

  const declaredButUnused = declaredGates.filter(g => !usedSet.has(g));
  const usedButUndeclared = usedGates.filter(g => !declaredSet.has(g));
  const properlyDeclared = declaredGates.filter(g => usedSet.has(g));

  // Generate suggestions
  const suggestions: string[] = [];

  if (declaredButUnused.length > 0) {
    suggestions.push('Gates declared but never referenced:');
    for (const gate of declaredButUnused) {
      suggestions.push(`  - ^${gate} (consider removing from portal.yaml or implementing)`);
    }
    suggestions.push('');
  }

  if (usedButUndeclared.length > 0) {
    suggestions.push('Gates used in code but not declared in portal.yaml:');
    for (const gate of usedButUndeclared) {
      suggestions.push(`  - ^${gate} (add to portal.yaml with proper definition)`);
    }
    suggestions.push('');
  }

  // Determine status
  let status: ComplianceReport['status'] = 'compliant';
  if (usedButUndeclared.length > 0) {
    status = 'violations';
  } else if (declaredButUnused.length > 0) {
    status = 'warnings';
  }

  return {
    status,
    declaredButUnused,
    usedButUndeclared,
    properlyDeclared,
    suggestions,
    references,
  };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format compliance report for CLI output
 */
export function formatComplianceReport(report: ComplianceReport): string {
  const lines: string[] = [];

  // Status header
  const statusIcon = report.status === 'compliant' ? '✓' :
    report.status === 'warnings' ? '⚠' : '✗';
  const statusColor = report.status === 'compliant' ? 'green' :
    report.status === 'warnings' ? 'yellow' : 'red';

  lines.push(`Portal Compliance: ${statusIcon} ${report.status.toUpperCase()}`);
  lines.push('');

  // Summary counts
  lines.push(`Properly Declared: ${report.properlyDeclared.length}`);
  if (report.declaredButUnused.length > 0) {
    lines.push(`Declared but Unused: ${report.declaredButUnused.length}`);
  }
  if (report.usedButUndeclared.length > 0) {
    lines.push(`Used but Undeclared: ${report.usedButUndeclared.length}`);
  }
  lines.push('');

  // Properly declared gates
  if (report.properlyDeclared.length > 0) {
    lines.push('Gates in Use:');
    for (const gate of report.properlyDeclared) {
      lines.push(`  ✓ ^${gate}`);
    }
    lines.push('');
  }

  // Warnings
  if (report.declaredButUnused.length > 0) {
    lines.push('Unused Gates (declared but never referenced):');
    for (const gate of report.declaredButUnused) {
      lines.push(`  ⚠ ^${gate}`);
    }
    lines.push('');
  }

  // Violations
  if (report.usedButUndeclared.length > 0) {
    lines.push('Undeclared Gates (used but not in portal.yaml):');
    for (const gate of report.usedButUndeclared) {
      lines.push(`  ✗ ^${gate}`);

      // Show where it's used
      const refs = report.references.filter(r => r.gate === gate).slice(0, 3);
      for (const ref of refs) {
        lines.push(`      at ${ref.file}:${ref.line}`);
      }
    }
    lines.push('');
  }

  // Suggestions
  if (report.suggestions.length > 0 && report.status !== 'compliant') {
    lines.push('Suggestions:');
    for (const suggestion of report.suggestions) {
      if (suggestion) {
        lines.push(`  ${suggestion}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Get a quick summary for doctor command
 */
export function getComplianceSummary(report: ComplianceReport): {
  status: 'ok' | 'warn' | 'error';
  message: string;
} {
  if (report.status === 'compliant') {
    return {
      status: 'ok',
      message: `${report.properlyDeclared.length} gates properly declared`,
    };
  }

  if (report.status === 'warnings') {
    return {
      status: 'warn',
      message: `${report.declaredButUnused.length} unused gates`,
    };
  }

  return {
    status: 'error',
    message: `${report.usedButUndeclared.length} gates used but not declared`,
  };
}
