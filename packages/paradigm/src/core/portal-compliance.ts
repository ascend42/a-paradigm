/**
 * Portal Compliance Checker
 *
 * Validates that gates defined in portal.yaml are actually used in the codebase.
 * Language-agnostic: uses grep-based pattern matching to find gate references.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execFileSync } from 'child_process';

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
  /** Unused gates that are attached to routes (documented intent, may be middleware-enforced) */
  routeAttachedUnused: string[];
  /** Unused gates declared in gates section only, never in routes (orphans) */
  orphanUnused: string[];
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
  '.next',
  'target',
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

/**
 * Extract gates that appear in route definitions (documented on routes)
 */
function extractRouteAttachedGates(config: PortalConfig): Set<string> {
  const gates = new Set<string>();
  if (config.routes) {
    for (const routeConfig of Object.values(config.routes)) {
      const gateList = Array.isArray(routeConfig) ? routeConfig : routeConfig.gates || [];
      for (const gate of gateList) {
        const gateName = gate.startsWith('^') ? gate.slice(1) : gate;
        gates.add(gateName);
      }
    }
  }
  return gates;
}

// ============================================================================
// Code Search
// ============================================================================

/**
 * Run grep via execFileSync (avoids shell quoting issues with regex patterns).
 * Prefers ripgrep (rg) when available — much faster on large repos.
 */
function runGrep(rootDir: string, pattern: string): string {
  const options = {
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] as const,
  };

  // Try ripgrep first (faster on large codebases)
  try {
    const globArgs = SKIP_DIRECTORIES.flatMap(d => ['--glob', `!${d}/**`]);
    const rgArgs = ['-n', '--no-ignore-vcs', ...globArgs, '--engine', 'auto', pattern, rootDir];
    return execFileSync('rg', rgArgs, options);
  } catch {
    // rg not found or error — fall back to grep
  }

  const skipDirArgs = SKIP_DIRECTORIES.map(d => `--exclude-dir=${d}`);
  const grepArgs = ['-rn', ...skipDirArgs, '-E', pattern, '--', rootDir];

  try {
    return execFileSync('grep', grepArgs, options);
  } catch (err) {
    // grep exits 1 when no matches; treat as empty
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 1 || (err as NodeJS.ErrnoException)?.status === 1) {
      return '';
    }
    return '';
  }
}

/**
 * Find gate references in the codebase using grep
 */
export function findGateReferences(rootDir: string): GateReference[] {
  const references: GateReference[] = [];

  // Search for Paradigm symbol pattern (^gateName)
  const symbolPattern = '\\^[a-zA-Z][a-zA-Z0-9_-]+';
  const symbolResult = runGrep(rootDir, symbolPattern);

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

  // Search for function-based gate checks (patterns safe with execFileSync - no shell)
  const functionPatterns = [
    { pattern: "checkGate\\s*\\(['\"]([^'\"]+)['\"]", type: 'function' as const },
    { pattern: "requireGate\\s*\\(['\"]([^'\"]+)['\"]", type: 'function' as const },
    { pattern: "gate:\\s*['\"]([^'\"]+)['\"]", type: 'config' as const },
    { pattern: "@Gate\\s*\\(['\"]?([^'\"\\)]+)['\"]?\\)", type: 'function' as const },
  ];

  for (const { pattern, type } of functionPatterns) {
    const result = runGrep(rootDir, pattern);

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
        routeAttachedUnused: [],
        orphanUnused: [],
        usedButUndeclared: [],
        properlyDeclared: [],
        suggestions: ['No portal.yaml found, and no gate references detected in code.'],
        references: [],
      };
    }

    return {
      status: 'violations',
      declaredButUnused: [],
      routeAttachedUnused: [],
      orphanUnused: [],
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
  const routeAttachedGates = extractRouteAttachedGates(config);
  const references = findGateReferences(rootDir);
  const usedGates = extractUniqueGates(references);

  // Compare declared vs used
  const declaredSet = new Set(declaredGates);
  const usedSet = new Set(usedGates);

  const declaredButUnused = declaredGates.filter(g => !usedSet.has(g));
  const routeAttachedUnused = declaredButUnused.filter(g => routeAttachedGates.has(g));
  const orphanUnused = declaredButUnused.filter(g => !routeAttachedGates.has(g));

  const usedButUndeclared = usedGates.filter(g => !declaredSet.has(g));
  const properlyDeclared = declaredGates.filter(g => usedSet.has(g));

  // Generate suggestions
  const suggestions: string[] = [];

  if (routeAttachedUnused.length > 0) {
    suggestions.push('Gates documented on routes but no checkGate/requireGate in code:');
    for (const gate of routeAttachedUnused) {
      suggestions.push(`  - ^${gate} (documented on routes; if enforced by middleware, this may be intentional)`);
    }
    suggestions.push('');
  }

  if (orphanUnused.length > 0) {
    suggestions.push('Orphan gates (declared but never on a route or in code):');
    for (const gate of orphanUnused) {
      suggestions.push(`  - ^${gate} (add to a route or remove from portal.yaml)`);
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
    routeAttachedUnused,
    orphanUnused,
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
  lines.push(`Portal Compliance: ${statusIcon} ${report.status.toUpperCase()}`);
  lines.push('');

  // Summary counts
  lines.push(`Properly Declared: ${report.properlyDeclared.length}`);
  if (report.routeAttachedUnused.length > 0) {
    lines.push(`Route-Attached, No Code: ${report.routeAttachedUnused.length}`);
  }
  if (report.orphanUnused.length > 0) {
    lines.push(`Orphan Gates: ${report.orphanUnused.length}`);
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

  // Route-attached but no code (documented intent)
  if (report.routeAttachedUnused.length > 0) {
    lines.push('Route-Attached (no checkGate/requireGate in code):');
    for (const gate of report.routeAttachedUnused) {
      lines.push(`  ⚠ ^${gate}`);
    }
    lines.push('');
  }

  // Orphan gates
  if (report.orphanUnused.length > 0) {
    lines.push('Orphan Gates (declared but never on route or in code):');
    for (const gate of report.orphanUnused) {
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
    const parts: string[] = [];
    if (report.routeAttachedUnused.length > 0) {
      parts.push(`${report.routeAttachedUnused.length} route-attached`);
    }
    if (report.orphanUnused.length > 0) {
      parts.push(`${report.orphanUnused.length} orphan`);
    }
    return {
      status: 'warn',
      message: parts.length > 0 ? parts.join(', ') + ' gate(s)' : `${report.declaredButUnused.length} unused gates`,
    };
  }

  return {
    status: 'error',
    message: `${report.usedButUndeclared.length} gates used but not declared`,
  };
}
