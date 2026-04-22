/**
 * paradigm compliance-check — Unified compliance checker for stop hooks
 *
 * Consolidates 3 separate Node.js subprocess calls into a single process:
 *   1. habits check (on-stop trigger with recording)
 *   2. drift check (aspect anchor drift detection with auto-heal)
 *   3. portal check (gate implementation compliance)
 *
 * Returns combined JSON result for shell hook consumption.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import {
  loadHabits,
  evaluateHabits,
  buildEvaluationContext,
  type HabitDefinition,
  type HabitTrigger,
} from '../core/habits/index.js';

// ════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════

interface HabitsResult {
  trigger: string;
  evaluation: {
    total: number;
    followed: number;
    skipped: number;
    partial: number;
    blockingViolations: number;
    blocksCompletion: boolean;
  };
  habits: Array<{
    id: string;
    name: string;
    category: string;
    severity: string;
    result: string;
    reason: string;
    evidence?: unknown;
  }>;
  recorded: number;
}

interface DriftResult {
  driftedCount: number;
  healedCount: number;
  cleanCount: number;
  missingCount: number;
  details: Array<{
    aspectId: string;
    path: string;
    startLine: number;
    endLine: number;
    status: string;
    autoHealed?: boolean;
  }>;
  error?: string;
}

interface PortalResult {
  status: string;
  declaredButUnusedCount: number;
  usedButUndeclaredCount: number;
  properlyDeclaredCount: number;
  declaredButUnused: string[];
  usedButUndeclared: string[];
  properlyDeclared: string[];
  /**
   * v5.37.12: surfaced when portal.yaml exists but cannot be parsed. Contains
   * a redacted classifier only — never raw file contents. Stop hook reads
   * errorClass to emit a redacted "portal.yaml unparseable (duplicate-key)"
   * message instead of listing the synthetic sentinel as a gate name.
   */
  portalError?: {
    kind: 'unparseable';
    errorClass: 'duplicate-key' | 'syntax' | 'other';
    detail: string;
  };
  /**
   * v5.38.0: near-match suggestions for undeclared / unused gates. Safe for
   * local CLI output (user has portal.yaml on disk) but must not leak into
   * telemetry.
   */
  suggestions?: Array<{ gate: string; didYouMean: string; distance: number }>;
}

interface PostflightResult {
  sessionEntries: number;
  agentsProcessed: string[];
  journalsWritten: number;
  journalsByAgent: Record<string, number>;
  promoted: number;
  promotedByAgent: Record<string, number>;
  dryRun: boolean;
}

interface Violation {
  message: string;
  source: 'habits' | 'drift' | 'portal';
  file?: string;
  severity: 'blocking' | 'advisory';
}

interface ComplianceCheckResult {
  habits: HabitsResult | null;
  drift: DriftResult | null;
  portal: PortalResult | null;
  violations: string[];
  structuredViolations: Violation[];
  postflight?: PostflightResult | null;
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

/**
 * Extract a file path from a violation message string, if one is present.
 * Matches common patterns like `/path/to/file.ts`, `src/foo/bar.js`, etc.
 */
function extractFilePath(message: string): string | undefined {
  // Match relative or absolute paths with file extensions
  const match = message.match(/(?:^|\s)((?:\/|\.\/|[a-zA-Z0-9_-]+\/)[^\s,;:'"]+\.[a-zA-Z]{1,10})\b/);
  return match?.[1];
}

// ════════════════════════════════════════════════════════════════════
// Habits check (inline — no subprocess)
// ════════════════════════════════════════════════════════════════════

async function runHabitsCheck(
  rootDir: string,
  trigger: HabitTrigger,
): Promise<HabitsResult | null> {
  try {
    const habits = loadHabits(rootDir);

    // Get modified files from git
    let filesModified: string[] = [];
    try {
      const output = execSync('git diff --name-only HEAD', {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      filesModified = output.trim().split('\n').filter(Boolean);
    } catch {
      // Git not available
    }

    // Check git clean status
    let gitClean: boolean | undefined;
    try {
      const status = execSync('git status --porcelain', {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      gitClean = status.trim() === '';
    } catch {
      // Git not available
    }

    // Check portal.yaml for routes
    const portalPath = path.join(rootDir, 'portal.yaml');
    let hasPortalRoutes = false;
    if (fs.existsSync(portalPath)) {
      try {
        const portalContent = fs.readFileSync(portalPath, 'utf8');
        const portal = yaml.load(portalContent) as Record<string, unknown>;
        hasPortalRoutes = portal?.routes != null && Object.keys(portal.routes as object).length > 0;
      } catch {
        // Ignore parse errors
      }
    }

    const evalContext = buildEvaluationContext({
      toolsCalled: [],
      filesModified,
      symbolsTouched: [],
      loreRecorded: false,
      hasPortalRoutes,
      taskAddsRoutes: false,
      gitClean,
    });

    const evaluation = evaluateHabits(habits, trigger, evalContext);

    // Record practice events (best-effort)
    let recordedCount = 0;
    if (evaluation.evaluations.length > 0) {
      try {
        const sentinelDir = path.join(rootDir, '.paradigm', 'sentinel');
        if (fs.existsSync(sentinelDir)) {
          const { SentinelStorage } = await import('@a-company/sentinel');
          const storage = new SentinelStorage(sentinelDir);

          for (const e of evaluation.evaluations) {
            storage.recordPracticeEvent({
              habitId: e.habit.id,
              habitCategory: e.habit.category,
              result: e.result,
              engineer: 'agent',
              sessionId: `cli-${Date.now().toString(36)}`,
              symbolsTouched: [],
              filesModified,
              notes: e.reason,
            });
            recordedCount++;
          }
        }
      } catch {
        // Recording is best-effort
      }
    }

    // Write/clear .habits-blocking marker
    const markerPath = path.join(rootDir, '.paradigm', '.habits-blocking');
    try {
      if (trigger === 'on-stop' && evaluation.blocksCompletion) {
        const blocking = evaluation.evaluations
          .filter((e) => e.result === 'skipped' && e.habit.severity === 'block')
          .map((e) => `${e.habit.name}: ${e.reason}`);
        fs.writeFileSync(markerPath, blocking.join('\n'), 'utf8');
      } else if (trigger === 'on-stop') {
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
      }
    } catch {
      // Marker file is best-effort
    }

    return {
      trigger,
      evaluation: {
        total: evaluation.summary.total,
        followed: evaluation.summary.followed,
        skipped: evaluation.summary.skipped,
        partial: evaluation.summary.partial,
        blockingViolations: evaluation.summary.blockingViolations,
        blocksCompletion: evaluation.blocksCompletion,
      },
      habits: evaluation.evaluations.map((e) => ({
        id: e.habit.id,
        name: e.habit.name,
        category: e.habit.category,
        severity: e.habit.severity,
        result: e.result,
        reason: e.reason,
        evidence: e.evidence,
      })),
      recorded: recordedCount,
    };
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Drift check (inline — no subprocess)
// ════════════════════════════════════════════════════════════════════

async function runDriftCheck(
  rootDir: string,
  autoHeal: boolean,
): Promise<DriftResult | null> {
  const dbPath = path.join(rootDir, '.paradigm', 'aspect-graph.db');

  if (!fs.existsSync(dbPath)) {
    return { driftedCount: 0, healedCount: 0, cleanCount: 0, missingCount: 0, details: [] };
  }

  try {
    // Import and run the drift check command in-process, capturing its JSON output
    const { driftCheckCommand } = await import('./drift.js');
    let capturedJson = '';
    const origLog = console.log;
    console.log = (msg: string) => { capturedJson = msg; };
    try {
      await driftCheckCommand({ json: true, autoHeal });
    } finally {
      console.log = origLog;
    }
    if (capturedJson) {
      return JSON.parse(capturedJson) as DriftResult;
    }
    return null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Portal check (inline — no subprocess)
// ════════════════════════════════════════════════════════════════════

async function runPortalCheck(rootDir: string): Promise<PortalResult | null> {
  if (!fs.existsSync(path.join(rootDir, 'portal.yaml'))) {
    return null;
  }

  try {
    const { checkPortalCompliance } = await import('../core/portal-compliance.js');
    const report = await checkPortalCompliance(rootDir);

    return {
      status: report.status,
      declaredButUnusedCount: report.declaredButUnused.length,
      usedButUndeclaredCount: report.usedButUndeclared.length,
      properlyDeclaredCount: report.properlyDeclared.length,
      declaredButUnused: report.declaredButUnused,
      usedButUndeclared: report.usedButUndeclared,
      properlyDeclared: report.properlyDeclared,
      portalError: report.portalError,
      // v5.38.0: propagate near-match suggestions (redacted-safe for local CLI).
      ...(report.nearMatches && report.nearMatches.length > 0
        ? {
            suggestions: report.nearMatches.map(m => ({
              gate: m.gate,
              didYouMean: m.didYouMean,
              distance: m.distance,
            })),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Postflight learning pass (inline — no subprocess)
// ════════════════════════════════════════════════════════════════════

async function runPostflightLearn(rootDir: string): Promise<PostflightResult | null> {
  try {
    const { runPostflightLearning } = await import('../../../paradigm-mcp/src/tools/ambient.js');
    const result = await runPostflightLearning(rootDir);
    return result as PostflightResult;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Combined compliance check command
// ════════════════════════════════════════════════════════════════════

export async function complianceCheckCommand(options: {
  json?: boolean;
  autoHeal?: boolean;
  trigger?: string;
  learn?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();
  const trigger = (options.trigger || 'on-stop') as HabitTrigger;
  const autoHeal = options.autoHeal !== false;
  const violations: string[] = [];
  const structuredViolations: Violation[] = [];

  // Run all three checks sequentially in the same process
  const habitsResult = await runHabitsCheck(rootDir, trigger);
  const driftResult = await runDriftCheck(rootDir, autoHeal);
  const portalResult = await runPortalCheck(rootDir);

  // Collect violations from habits
  if (habitsResult?.evaluation.blocksCompletion) {
    const blocking = habitsResult.habits
      .filter((h) => h.result === 'skipped' && h.severity === 'block');
    for (const h of blocking) {
      const msg = `Blocking habit not satisfied: ${h.name} — ${h.reason}`;
      violations.push(msg);
      structuredViolations.push({
        message: msg,
        source: 'habits',
        file: extractFilePath(h.reason),
        severity: 'blocking',
      });
    }
  }

  // Collect violations from drift
  if (driftResult && driftResult.driftedCount > 0) {
    const msg = `${driftResult.driftedCount} aspect anchor(s) have drifted (content genuinely changed). Run paradigm_aspect_check to review.`;
    violations.push(msg);
    // Add per-file violations for each drifted anchor
    for (const d of driftResult.details.filter((dd) => dd.status === 'drifted')) {
      structuredViolations.push({
        message: `Aspect ~${d.aspectId} drifted at lines ${d.startLine}-${d.endLine}`,
        source: 'drift',
        file: d.path,
        severity: 'advisory',
      });
    }
    if (structuredViolations.filter((v) => v.source === 'drift').length === 0) {
      structuredViolations.push({
        message: msg,
        source: 'drift',
        severity: 'advisory',
      });
    }
  }

  // Collect violations from portal
  // v5.37.12: handle the portal-unparseable sentinel separately so we emit a
  // redacted classifier-only message, never the sentinel or raw file contents.
  if (portalResult && portalResult.portalError?.kind === 'unparseable') {
    const cls = portalResult.portalError.errorClass;
    const msg = `portal.yaml unparseable: ${cls} — run 'paradigm doctor' for details`;
    violations.push(msg);
    structuredViolations.push({
      message: msg,
      source: 'portal',
      file: 'portal.yaml',
      severity: 'blocking',
    });
  } else if (portalResult && portalResult.usedButUndeclaredCount > 0) {
    // Filter the sentinel defensively in case portalError was not propagated.
    const realGates = portalResult.usedButUndeclared.filter(g => g !== '__portal_unparseable__');
    if (realGates.length > 0) {
      const msg = `${realGates.length} gate(s) used in code but not declared in portal.yaml: ${realGates.join(', ')}`;
      violations.push(msg);
      for (const gate of realGates) {
        structuredViolations.push({
          message: `Gate ^${gate} used in code but not declared in portal.yaml`,
          source: 'portal',
          file: 'portal.yaml',
          severity: 'blocking',
        });
      }
    }
  }

  // Run postflight learning pass (non-blocking, after compliance checks)
  let postflightResult: PostflightResult | null = null;
  if (options.learn) {
    postflightResult = await runPostflightLearn(rootDir);
  }

  const result: ComplianceCheckResult = {
    habits: habitsResult,
    drift: driftResult,
    portal: portalResult,
    violations,
    structuredViolations,
    postflight: options.learn ? postflightResult : undefined,
  };

  if (options.json) {
    console.log(JSON.stringify(result));
  } else {
    // Human-readable output
    console.log(chalk.magenta('\n  Paradigm Compliance Check\n'));

    if (habitsResult) {
      const { evaluation } = habitsResult;
      const statusColor = evaluation.blocksCompletion ? chalk.red : chalk.green;
      console.log(chalk.white('  Habits:'));
      console.log(`    ${statusColor(`${evaluation.followed} followed, ${evaluation.skipped} skipped, ${evaluation.partial} partial`)}`);
      if (evaluation.blockingViolations > 0) {
        console.log(chalk.red(`    ${evaluation.blockingViolations} blocking violation(s)`));
      }
      console.log();
    }

    if (driftResult) {
      console.log(chalk.white('  Drift:'));
      if (driftResult.healedCount > 0) {
        console.log(chalk.green(`    Auto-healed: ${driftResult.healedCount} shifted anchor(s)`));
      }
      if (driftResult.cleanCount > 0) {
        console.log(chalk.green(`    Clean: ${driftResult.cleanCount} anchor(s)`));
      }
      if (driftResult.driftedCount > 0) {
        console.log(chalk.red(`    Drifted: ${driftResult.driftedCount} anchor(s)`));
      }
      if (driftResult.missingCount > 0) {
        console.log(chalk.yellow(`    Missing: ${driftResult.missingCount} anchor file(s)`));
      }
      console.log();
    }

    if (portalResult) {
      console.log(chalk.white('  Portal:'));
      const statusColor = portalResult.status === 'compliant' ? chalk.green
        : portalResult.status === 'warnings' ? chalk.yellow
          : chalk.red;
      console.log(`    Status: ${statusColor(portalResult.status)}`);
      if (portalResult.usedButUndeclaredCount > 0) {
        console.log(chalk.red(`    ${portalResult.usedButUndeclaredCount} undeclared gate(s)`));
      }
      console.log();
    }

    if (postflightResult) {
      console.log(chalk.white('  Postflight Learning:'));
      if (postflightResult.journalsWritten > 0) {
        console.log(chalk.green(`    Journals written: ${postflightResult.journalsWritten}`));
        for (const [agent, count] of Object.entries(postflightResult.journalsByAgent)) {
          if (count > 0) console.log(chalk.gray(`      ${agent}: ${count} entries`));
        }
      } else {
        console.log(chalk.gray('    No verdicts to learn from'));
      }
      if (postflightResult.promoted > 0) {
        console.log(chalk.green(`    Promoted to notebooks: ${postflightResult.promoted}`));
      }
      console.log();
    }

    if (violations.length > 0) {
      console.log(chalk.red(`  ${violations.length} violation(s):`));
      for (const v of violations) {
        console.log(chalk.red(`    - ${v}`));
      }
    } else {
      console.log(chalk.green('  All checks passed.'));
    }

    console.log();
  }

  // Exit code 1 if violations
  if (violations.length > 0) {
    process.exitCode = 1;
  }
}
