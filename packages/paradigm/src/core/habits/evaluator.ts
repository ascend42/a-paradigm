/**
 * Habit Evaluator - Checks session state against habit definitions
 *
 * Uses session breadcrumbs (tool calls), file modifications, and other
 * context to determine whether habits were followed, skipped, or partially met.
 */

import type {
  HabitDefinition,
  HabitEvaluation,
  EvaluationContext,
  EvaluationResult,
  HabitTrigger,
} from './types.js';
import { getHabitsByTrigger } from './loader.js';

/**
 * Evaluate all habits for a given trigger point
 */
export function evaluateHabits(
  habits: HabitDefinition[],
  trigger: HabitTrigger,
  context: EvaluationContext
): EvaluationResult {
  const activeHabits = getHabitsByTrigger(habits, trigger);
  const evaluations: HabitEvaluation[] = [];

  for (const habit of activeHabits) {
    const evaluation = evaluateHabit(habit, context);
    evaluations.push(evaluation);
  }

  const followed = evaluations.filter((e) => e.result === 'followed').length;
  const skipped = evaluations.filter((e) => e.result === 'skipped').length;
  const partial = evaluations.filter((e) => e.result === 'partial').length;
  const blockingViolations = evaluations.filter(
    (e) => e.result === 'skipped' && e.habit.severity === 'block'
  ).length;

  return {
    trigger,
    evaluations,
    summary: {
      total: evaluations.length,
      followed,
      skipped,
      partial,
      blockingViolations,
    },
    blocksCompletion: blockingViolations > 0,
  };
}

/**
 * Evaluate a single habit against the session context
 */
function evaluateHabit(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  switch (habit.check.type) {
    case 'tool-called':
      return evaluateToolCalled(habit, context);
    case 'file-exists':
      return evaluateFileExists(habit, context);
    case 'lore-recorded':
      return evaluateLoreRecorded(habit, context);
    case 'symbols-registered':
      return evaluateSymbolsRegistered(habit, context);
    case 'gates-declared':
      return evaluateGatesDeclared(habit, context);
    case 'tests-exist':
      return evaluateTestsExist(habit, context);
    default:
      return {
        habit,
        result: 'partial',
        reason: `Unknown check type: ${habit.check.type}`,
      };
  }
}

/**
 * Check if any of the required tools were called during the session
 */
function evaluateToolCalled(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  const requiredTools = habit.check.params.tools || [];
  if (requiredTools.length === 0) {
    return { habit, result: 'followed', reason: 'No tools required' };
  }

  const calledTools = requiredTools.filter((tool) =>
    context.toolsCalled.includes(tool)
  );

  if (calledTools.length > 0) {
    return {
      habit,
      result: 'followed',
      reason: `Called: ${calledTools.join(', ')}`,
      evidence: calledTools,
    };
  }

  // No files modified or symbols touched = nothing to check
  if (
    context.filesModified.length === 0 &&
    context.symbolsTouched.length === 0
  ) {
    return {
      habit,
      result: 'followed',
      reason: 'No modifications made, habit not applicable',
    };
  }

  return {
    habit,
    result: 'skipped',
    reason: `None of [${requiredTools.join(', ')}] were called before modifying code`,
  };
}

/**
 * Check if required files exist (e.g., .purpose files for modified directories)
 */
function evaluateFileExists(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  if (context.filesModified.length === 0) {
    return {
      habit,
      result: 'followed',
      reason: 'No files modified, check not applicable',
    };
  }

  // For purpose-coverage: check that modified files have .purpose coverage
  // This is a simplified check - the real logic is in the stop hook
  // Here we just check if any paradigm files were touched
  const hasPurposeUpdates = context.filesModified.some(
    (f) => f.endsWith('.purpose') || f.includes('.paradigm/')
  );

  if (hasPurposeUpdates) {
    return {
      habit,
      result: 'followed',
      reason: 'Purpose files were updated alongside source changes',
    };
  }

  const sourceFiles = context.filesModified.filter(
    (f) =>
      !f.endsWith('.md') &&
      !f.endsWith('.json') &&
      !f.endsWith('.yaml') &&
      !f.endsWith('.yml') &&
      !f.endsWith('.lock') &&
      !f.endsWith('.purpose') &&
      !f.includes('.paradigm/')
  );

  if (sourceFiles.length === 0) {
    return {
      habit,
      result: 'followed',
      reason: 'Only non-source files modified',
    };
  }

  return {
    habit,
    result: 'skipped',
    reason: `${sourceFiles.length} source file(s) modified without .purpose updates`,
    evidence: sourceFiles.slice(0, 5),
  };
}

/**
 * Check if lore was recorded for significant sessions
 */
function evaluateLoreRecorded(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  // Only check if session was significant (3+ files modified)
  const sourceFiles = context.filesModified.filter(
    (f) =>
      !f.endsWith('.md') &&
      !f.endsWith('.json') &&
      !f.endsWith('.yaml') &&
      !f.endsWith('.yml') &&
      !f.endsWith('.lock') &&
      !f.endsWith('.purpose') &&
      !f.includes('.paradigm/')
  );

  if (sourceFiles.length < 3) {
    return {
      habit,
      result: 'followed',
      reason: 'Session not significant enough to require lore (< 3 source files)',
    };
  }

  if (context.loreRecorded) {
    return {
      habit,
      result: 'followed',
      reason: 'Lore entry was recorded for this session',
    };
  }

  if (context.toolsCalled.includes('paradigm_lore_record')) {
    return {
      habit,
      result: 'followed',
      reason: 'paradigm_lore_record was called during session',
    };
  }

  return {
    habit,
    result: 'skipped',
    reason: `${sourceFiles.length} source files modified but no lore entry recorded`,
    evidence: sourceFiles.slice(0, 5),
  };
}

/**
 * Check if new symbols are registered in .purpose files
 */
function evaluateSymbolsRegistered(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  if (context.symbolsTouched.length === 0) {
    return {
      habit,
      result: 'followed',
      reason: 'No symbols touched',
    };
  }

  // If purpose tools were called, assume symbols are being registered
  const purposeTools = [
    'paradigm_purpose_add_component',
    'paradigm_purpose_add_signal',
    'paradigm_purpose_add_flow',
    'paradigm_purpose_add_gate',
    'paradigm_purpose_add_aspect',
    'paradigm_purpose_add_state',
    'paradigm_purpose_init',
  ];

  const calledPurposeTools = purposeTools.filter((t) =>
    context.toolsCalled.includes(t)
  );

  if (calledPurposeTools.length > 0) {
    return {
      habit,
      result: 'followed',
      reason: `Purpose tools called: ${calledPurposeTools.join(', ')}`,
      evidence: calledPurposeTools,
    };
  }

  return {
    habit,
    result: 'partial',
    reason: `${context.symbolsTouched.length} symbol(s) touched but no purpose registration tools called`,
  };
}

/**
 * Check if routes have corresponding gate declarations
 */
function evaluateGatesDeclared(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  if (!context.taskAddsRoutes) {
    return {
      habit,
      result: 'followed',
      reason: 'Task does not add routes',
    };
  }

  if (context.hasPortalRoutes) {
    return {
      habit,
      result: 'followed',
      reason: 'Portal.yaml has route declarations',
    };
  }

  // Check if gate tools were called
  const gateTools = [
    'paradigm_gates_for_route',
    'paradigm_portal_add_route',
    'paradigm_portal_add_gate',
  ];
  const calledGateTools = gateTools.filter((t) =>
    context.toolsCalled.includes(t)
  );

  if (calledGateTools.length > 0) {
    return {
      habit,
      result: 'followed',
      reason: `Gate tools called: ${calledGateTools.join(', ')}`,
      evidence: calledGateTools,
    };
  }

  return {
    habit,
    result: 'skipped',
    reason: 'Task adds routes but no gate declarations or portal tools called',
  };
}

/**
 * Check if tests exist for new components
 */
function evaluateTestsExist(
  habit: HabitDefinition,
  context: EvaluationContext
): HabitEvaluation {
  if (context.filesModified.length === 0) {
    return {
      habit,
      result: 'followed',
      reason: 'No files modified',
    };
  }

  const testFiles = context.filesModified.filter(
    (f) =>
      f.includes('.test.') ||
      f.includes('.spec.') ||
      f.includes('/tests/') ||
      f.includes('/test/') ||
      f.includes('__tests__')
  );

  if (testFiles.length > 0) {
    return {
      habit,
      result: 'followed',
      reason: `Test files modified: ${testFiles.length}`,
      evidence: testFiles.slice(0, 5),
    };
  }

  // Only flag as skipped if new source files were created (not just modified)
  const newSourceFiles = context.filesModified.filter(
    (f) =>
      !f.endsWith('.md') &&
      !f.endsWith('.json') &&
      !f.endsWith('.yaml') &&
      !f.endsWith('.lock') &&
      !f.endsWith('.purpose') &&
      !f.includes('.paradigm/') &&
      !f.includes('node_modules/')
  );

  if (newSourceFiles.length === 0) {
    return {
      habit,
      result: 'followed',
      reason: 'No new source files to test',
    };
  }

  return {
    habit,
    result: 'partial',
    reason: `${newSourceFiles.length} source file(s) modified but no test files updated`,
    evidence: newSourceFiles.slice(0, 5),
  };
}

/**
 * Build evaluation context from available session data
 */
export function buildEvaluationContext(params: {
  toolsCalled?: string[];
  filesModified?: string[];
  symbolsTouched?: string[];
  loreRecorded?: boolean;
  hasPortalRoutes?: boolean;
  taskAddsRoutes?: boolean;
  taskDescription?: string;
}): EvaluationContext {
  return {
    toolsCalled: params.toolsCalled || [],
    filesModified: params.filesModified || [],
    symbolsTouched: params.symbolsTouched || [],
    loreRecorded: params.loreRecorded || false,
    hasPortalRoutes: params.hasPortalRoutes || false,
    taskAddsRoutes: params.taskAddsRoutes || false,
    taskDescription: params.taskDescription,
  };
}
