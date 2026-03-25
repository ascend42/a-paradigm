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
}

interface ComplianceCheckResult {
  habits: HabitsResult | null;
  drift: DriftResult | null;
  portal: PortalResult | null;
  violations: string[];
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
    };
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
}): Promise<void> {
  const rootDir = process.cwd();
  const trigger = (options.trigger || 'on-stop') as HabitTrigger;
  const autoHeal = options.autoHeal !== false;
  const violations: string[] = [];

  // Run all three checks sequentially in the same process
  const habitsResult = await runHabitsCheck(rootDir, trigger);
  const driftResult = await runDriftCheck(rootDir, autoHeal);
  const portalResult = await runPortalCheck(rootDir);

  // Collect violations from habits
  if (habitsResult?.evaluation.blocksCompletion) {
    const blocking = habitsResult.habits
      .filter((h) => h.result === 'skipped' && h.severity === 'block')
      .map((h) => `Blocking habit not satisfied: ${h.name} — ${h.reason}`);
    violations.push(...blocking);
  }

  // Collect violations from drift
  if (driftResult && driftResult.driftedCount > 0) {
    violations.push(
      `${driftResult.driftedCount} aspect anchor(s) have drifted (content genuinely changed). Run paradigm_aspect_check to review.`
    );
  }

  // Collect violations from portal
  if (portalResult && portalResult.usedButUndeclaredCount > 0) {
    violations.push(
      `${portalResult.usedButUndeclaredCount} gate(s) used in code but not declared in portal.yaml: ${portalResult.usedButUndeclared.join(', ')}`
    );
  }

  const result: ComplianceCheckResult = {
    habits: habitsResult,
    drift: driftResult,
    portal: portalResult,
    violations,
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
