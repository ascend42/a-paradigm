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
  /**
   * Portal load error (v5.37.12+). When portal.yaml exists but is unparseable,
   * this is populated with a redacted classifier (no file contents).
   * Consumers MUST treat this as a fail-closed violation.
   */
  portalError?: {
    kind: 'unparseable';
    errorClass: 'duplicate-key' | 'syntax' | 'other';
    /** Redacted short detail safe for logs/telemetry */
    detail: string;
  };
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
 * Result of attempting to load portal.yaml.
 *
 * Three states MUST be distinguished at every call site:
 *   - `missing`: no portal.yaml exists (legitimate "no portal" state)
 *   - `unparseable`: portal.yaml exists but js-yaml threw — FAIL CLOSED
 *   - `ok`: portal.yaml parsed successfully
 *
 * Security contract (2026-04-22 audit, v5.37.12):
 *   - `errorClass` is a short classifier; `detail` is a redacted summary.
 *     Neither contains raw file contents, gate names, or route paths.
 *   - Callers that surface errors to users MUST use `errorClass`/`detail`,
 *     never reformat the YAMLException.toString() (which leaks file context).
 */
export type PortalLoadResult =
  | { status: 'missing' }
  | { status: 'unparseable'; errorClass: 'duplicate-key' | 'syntax' | 'other'; detail: string }
  | { status: 'ok'; data: PortalConfig };

/**
 * Classify a js-yaml exception into a redacted category.
 * Mirrors `yaml-validator.ts` in paradigm-mcp; duplicated to avoid a
 * cross-package dep from paradigm CLI → paradigm-mcp.
 */
function classifyYamlError(err: unknown): { errorClass: 'duplicate-key' | 'syntax' | 'other'; detail: string } {
  if (err instanceof yaml.YAMLException) {
    const reason = (err.reason || '').toLowerCase();
    if (reason.includes('duplicated mapping key') || reason.includes('duplicate mapping key')) {
      return { errorClass: 'duplicate-key', detail: 'duplicate mapping key' };
    }
    const syntaxReasons = [
      'unexpected',
      'expected',
      'bad indentation',
      'mapping values',
      'cannot read a block mapping entry',
      'end of the stream',
      'while scanning',
      'while parsing',
    ];
    if (syntaxReasons.some(r => reason.includes(r))) {
      return { errorClass: 'syntax', detail: 'yaml syntax error' };
    }
    return { errorClass: 'other', detail: 'yaml parse error' };
  }
  return { errorClass: 'other', detail: 'yaml parse error' };
}

/**
 * Load and parse portal.yaml from the project root.
 *
 * Returns a discriminated union so callers cannot conflate "missing file"
 * with "file broken". See `PortalLoadResult` for the security contract.
 *
 * New in v5.37.12 (fail-closed). For one-minor back-compat with external
 * callers, see `loadPortalConfigLegacy`.
 */
export function loadPortalConfig(rootDir: string): PortalLoadResult {
  const portalPath = path.join(rootDir, 'portal.yaml');

  if (!fs.existsSync(portalPath)) {
    return { status: 'missing' };
  }

  let content: string;
  try {
    content = fs.readFileSync(portalPath, 'utf-8');
  } catch {
    return { status: 'unparseable', errorClass: 'other', detail: 'file read error' };
  }

  try {
    const parsed = yaml.load(content) as PortalConfig;
    return { status: 'ok', data: parsed };
  } catch (err) {
    const { errorClass, detail } = classifyYamlError(err);
    return { status: 'unparseable', errorClass, detail };
  }
}

/**
 * Legacy shim for callers that haven't migrated to the discriminated union.
 * Returns `null` on missing OR unparseable, losing the distinction — do not
 * use for security-relevant paths. Scheduled for removal in v5.39.0 or v6.0.
 *
 * @deprecated since v5.37.12. Use `loadPortalConfig` and switch on `status`.
 */
export function loadPortalConfigLegacy(rootDir: string): PortalConfig | null {
  const result = loadPortalConfig(rootDir);
  return result.status === 'ok' ? result.data : null;
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
 * Files that are valid sources for gate references.
 * Gate symbols (^name) should only be scanned in Paradigm-specific files,
 * NOT in arbitrary source code where ^ has other meanings (regex, JSX, etc.)
 */
const GATE_REFERENCE_GLOBS = [
  '**/.purpose',
  '**/portal.yaml',
  '**/.paradigm/**/*.yaml',
  '**/.paradigm/**/*.yml',
];

/**
 * False positive patterns to exclude from gate detection.
 * These match ^word in contexts that aren't Paradigm gate references.
 */
const GATE_FALSE_POSITIVE_PATTERNS = [
  /^\s*[/*#]/, // Comment lines (JS/TS/Python/Shell)
  /\[[\^]/, // Regex character class negation [^...]
  /\\[\^]/, // Escaped caret in regex
  /[A-Z][a-z]+[A-Z]/, // PascalCase (React components like ^SuperAdminRoute)
  /#[0-9A-Fa-f]{3,8}/, // CSS hex colors
  /https?:\/\//, // URLs
  /example|placeholder|e\.g\.|sample/i, // Documentation examples
];

/**
 * Find gate references in the codebase.
 *
 * Strategy: scan ONLY .purpose files, portal.yaml, and .paradigm YAML files
 * for ^gate-name symbol references. Then scan ALL code for function-based
 * gate checks (checkGate, requireGate, @Gate) which are unambiguous.
 */
export function findGateReferences(rootDir: string): GateReference[] {
  const references: GateReference[] = [];

  // 1. Search for ^gate symbol references ONLY in Paradigm-specific files
  const symbolPattern = '\\^[a-z][a-z0-9-]+';
  for (const glob of GATE_REFERENCE_GLOBS) {
    const globPattern = path.join(rootDir, glob);
    let files: string[];
    try {
      const result = execFileSync('find', [
        rootDir, '-path', '*/node_modules', '-prune', '-o',
        '-path', '*/.git', '-prune', '-o',
        '(', '-name', '.purpose', '-o', '-name', 'portal.yaml', ')',
        '-print',
      ], { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
      files = result.split('\n').filter(Boolean);
    } catch {
      files = [];
    }

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const gateMatches = line.matchAll(/\^([a-z][a-z0-9-]+)/g);
          for (const m of gateMatches) {
            references.push({
              gate: m[1],
              file: path.relative(rootDir, file),
              line: i + 1,
              context: line.trim().slice(0, 100),
              matchType: 'symbol',
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  // 2. Search for function-based gate checks in ALL code (these are unambiguous)
  const functionPatterns = [
    { pattern: "checkGate\\s*\\(['\"]([^'\"]+)['\"]", type: 'function' as const },
    { pattern: "requireGate\\s*\\(['\"]([^'\"]+)['\"]", type: 'function' as const },
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
  const loadResult = loadPortalConfig(rootDir);

  // FAIL-CLOSED: portal.yaml exists but cannot be parsed.
  // Per 2026-04-22 security audit, an unparseable portal must surface as
  // a violation, NEVER as "compliant" / "no portal.yaml". Error details are
  // redacted to avoid leaking gate names / route paths into LLM context.
  if (loadResult.status === 'unparseable') {
    const publicDetail =
      loadResult.errorClass === 'duplicate-key'
        ? 'duplicate mapping key detected'
        : loadResult.errorClass === 'syntax'
          ? 'YAML syntax error'
          : 'YAML parse error';
    return {
      status: 'violations',
      declaredButUnused: [],
      routeAttachedUnused: [],
      orphanUnused: [],
      // Sentinel entry so downstream consumers (stop hook) see a non-zero
      // usedButUndeclaredCount and block. The value is a fixed classifier,
      // not a real gate name — it will never match a live identifier.
      usedButUndeclared: ['__portal_unparseable__'],
      properlyDeclared: [],
      suggestions: [
        `portal.yaml unparseable: ${publicDetail} — run 'paradigm doctor' for details`,
      ],
      references: [],
      portalError: {
        kind: 'unparseable',
        errorClass: loadResult.errorClass,
        detail: loadResult.detail,
      },
    };
  }

  // If no portal.yaml exists, check if any gate references exist in code
  if (loadResult.status === 'missing') {
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

  const config = loadResult.data;

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

  // Portal unparseable — surface the redacted classifier, do not render the sentinel as a gate row
  if (report.portalError) {
    lines.push('Portal Unparseable:');
    lines.push(`  ✗ ${report.portalError.detail} — run 'paradigm doctor' for details`);
    lines.push('');
  }

  // Violations — filter out the __portal_unparseable__ sentinel; portalError above already surfaces it
  const realUndeclared = report.usedButUndeclared.filter(g => g !== '__portal_unparseable__');
  if (realUndeclared.length > 0) {
    lines.push('Undeclared Gates (used but not in portal.yaml):');
    for (const gate of realUndeclared) {
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
