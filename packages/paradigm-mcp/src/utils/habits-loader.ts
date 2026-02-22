/**
 * Habits Loader - MCP-side habit loading and evaluation
 *
 * Loads habit definitions from:
 * 1. Built-in seed habits (embedded)
 * 2. Global habits (~/.paradigm/habits.yaml)
 * 3. Project habits (.paradigm/habits.yaml)
 *
 * Also provides the evaluator for checking session state against habits.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type HabitCategory =
  | 'discovery'
  | 'verification'
  | 'testing'
  | 'documentation'
  | 'collaboration'
  | 'security';

export type HabitTrigger = 'preflight' | 'postflight' | 'on-commit' | 'on-stop';
export type HabitSeverity = 'advisory' | 'warn' | 'block';
export type HabitCheckType =
  | 'tool-called'
  | 'file-exists'
  | 'lore-recorded'
  | 'symbols-registered'
  | 'gates-declared'
  | 'tests-exist';

export interface HabitCheck {
  type: HabitCheckType;
  params: {
    tools?: string[];
    patterns?: string[];
    minSymbols?: number;
    requireRoutes?: boolean;
  };
}

export interface HabitDefinition {
  id: string;
  name: string;
  description: string;
  category: HabitCategory;
  trigger: HabitTrigger;
  severity: HabitSeverity;
  check: HabitCheck;
  enabled: boolean;
}

export interface HabitOverride {
  severity?: HabitSeverity;
  enabled?: boolean;
}

export interface HabitsConfig {
  version: string;
  habits: HabitDefinition[];
  overrides?: Record<string, HabitOverride>;
}

export type PracticeResult = 'followed' | 'skipped' | 'partial';

export interface HabitEvaluation {
  habit: HabitDefinition;
  result: PracticeResult;
  reason: string;
  evidence?: string[];
}

export interface EvaluationContext {
  toolsCalled: string[];
  filesModified: string[];
  symbolsTouched: string[];
  loreRecorded: boolean;
  hasPortalRoutes: boolean;
  taskAddsRoutes: boolean;
  taskDescription?: string;
}

export interface EvaluationResult {
  trigger: HabitTrigger;
  evaluations: HabitEvaluation[];
  summary: {
    total: number;
    followed: number;
    skipped: number;
    partial: number;
    blockingViolations: number;
  };
  blocksCompletion: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// SEED HABITS (embedded to avoid cross-package imports)
// ═══════════════════════════════════════════════════════════════════

const SEED_HABITS: HabitDefinition[] = [
  {
    id: 'explore-before-implement',
    name: 'Explore Before Implementing',
    description: 'Call ripple/navigate/search before modifying existing symbols to understand impact',
    category: 'discovery',
    trigger: 'preflight',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_ripple', 'paradigm_navigate', 'paradigm_search', 'paradigm_related'] } },
    enabled: true,
  },
  {
    id: 'ripple-before-modify',
    name: 'Ripple Before Modifying',
    description: 'Run ripple analysis before modifying symbols with dependents',
    category: 'discovery',
    trigger: 'preflight',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_ripple'] } },
    enabled: true,
  },
  {
    id: 'check-fragility',
    name: 'Check Fragility',
    description: 'Check history fragility for symbols before modifying frequently-broken code',
    category: 'discovery',
    trigger: 'preflight',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_history_fragility'] } },
    enabled: true,
  },
  {
    id: 'wisdom-before-implement',
    name: 'Check Team Wisdom',
    description: 'Check team wisdom (preferences, antipatterns, decisions) before implementing',
    category: 'collaboration',
    trigger: 'preflight',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_wisdom_context', 'paradigm_wisdom_expert'] } },
    enabled: true,
  },
  {
    id: 'verify-before-done',
    name: 'Verify Before Done',
    description: 'Run postflight compliance checks before finishing a session',
    category: 'verification',
    trigger: 'on-stop',
    severity: 'warn',
    check: { type: 'tool-called', params: { tools: ['paradigm_pm_postflight'] } },
    enabled: true,
  },
  {
    id: 'postflight-compliance',
    name: 'Postflight Compliance',
    description: 'Ensure postflight checks pass without errors before finishing',
    category: 'verification',
    trigger: 'on-stop',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_pm_postflight', 'paradigm_reindex'] } },
    enabled: true,
  },
  {
    id: 'test-new-components',
    name: 'Test New Components',
    description: 'New components should have associated tests or test plan documented',
    category: 'testing',
    trigger: 'postflight',
    severity: 'advisory',
    check: { type: 'tests-exist', params: { patterns: ['**/*.test.*', '**/*.spec.*', '**/tests/**'] } },
    enabled: true,
  },
  {
    id: 'purpose-coverage',
    name: 'Purpose File Coverage',
    description: 'All modified source directories should have .purpose file coverage',
    category: 'documentation',
    trigger: 'postflight',
    severity: 'warn',
    check: { type: 'file-exists', params: { patterns: ['**/.purpose'] } },
    enabled: true,
  },
  {
    id: 'record-lore-for-significant',
    name: 'Record Lore for Significant Changes',
    description: 'Sessions modifying 3+ files should record a lore entry',
    category: 'documentation',
    trigger: 'on-stop',
    severity: 'warn',
    check: { type: 'lore-recorded', params: {} },
    enabled: true,
  },
  {
    id: 'gates-for-routes',
    name: 'Gates for Routes',
    description: 'API routes should have corresponding gate declarations in portal.yaml',
    category: 'security',
    trigger: 'postflight',
    severity: 'warn',
    check: { type: 'gates-declared', params: { requireRoutes: true } },
    enabled: true,
  },
];

// ═══════════════════════════════════════════════════════════════════
// LOADER
// ═══════════════════════════════════════════════════════════════════

const HABITS_CACHE_TTL_MS = 30 * 1000;

interface HabitsCacheEntry {
  habits: HabitDefinition[];
  loadedAt: number;
}

const habitsCache: Map<string, HabitsCacheEntry> = new Map();

export function loadHabits(rootDir: string): HabitDefinition[] {
  const absoluteRoot = path.resolve(rootDir);
  const cached = habitsCache.get(absoluteRoot);
  if (cached && Date.now() - cached.loadedAt < HABITS_CACHE_TTL_MS) {
    return cached.habits;
  }

  const habits = loadHabitsFresh(absoluteRoot);
  habitsCache.set(absoluteRoot, { habits, loadedAt: Date.now() });
  return habits;
}

function loadHabitsFresh(rootDir: string): HabitDefinition[] {
  const habitsById = new Map<string, HabitDefinition>();
  for (const seed of SEED_HABITS) {
    habitsById.set(seed.id, { ...seed });
  }

  // Load global habits
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  const globalConfig = loadHabitsYaml(path.join(home, '.paradigm', 'habits.yaml'));
  if (globalConfig) mergeHabits(habitsById, globalConfig);

  // Load project habits
  const projectConfig = loadHabitsYaml(path.join(rootDir, '.paradigm', 'habits.yaml'));
  if (projectConfig) mergeHabits(habitsById, projectConfig);

  return Array.from(habitsById.values());
}

function loadHabitsYaml(filePath: string): HabitsConfig | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) as HabitsConfig;
  } catch {
    return null;
  }
}

function mergeHabits(habitsById: Map<string, HabitDefinition>, config: HabitsConfig): void {
  if (config.habits) {
    for (const habit of config.habits) {
      habitsById.set(habit.id, { ...habit });
    }
  }
  if (config.overrides) {
    for (const [id, override] of Object.entries(config.overrides)) {
      const existing = habitsById.get(id);
      if (existing) {
        if (override.severity !== undefined) existing.severity = override.severity;
        if (override.enabled !== undefined) existing.enabled = override.enabled;
      }
    }
  }
}

export function getHabitsByTrigger(habits: HabitDefinition[], trigger: HabitTrigger): HabitDefinition[] {
  return habits.filter((h) => h.enabled && h.trigger === trigger);
}

export function invalidateHabitsCache(rootDir: string): void {
  habitsCache.delete(path.resolve(rootDir));
}

// ═══════════════════════════════════════════════════════════════════
// EVALUATOR
// ═══════════════════════════════════════════════════════════════════

export function evaluateHabits(
  habits: HabitDefinition[],
  trigger: HabitTrigger,
  context: EvaluationContext
): EvaluationResult {
  const activeHabits = getHabitsByTrigger(habits, trigger);
  const evaluations: HabitEvaluation[] = activeHabits.map((h) => evaluateHabit(h, context));

  const followed = evaluations.filter((e) => e.result === 'followed').length;
  const skipped = evaluations.filter((e) => e.result === 'skipped').length;
  const partial = evaluations.filter((e) => e.result === 'partial').length;
  const blockingViolations = evaluations.filter(
    (e) => e.result === 'skipped' && e.habit.severity === 'block'
  ).length;

  return {
    trigger,
    evaluations,
    summary: { total: evaluations.length, followed, skipped, partial, blockingViolations },
    blocksCompletion: blockingViolations > 0,
  };
}

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

function evaluateHabit(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  switch (habit.check.type) {
    case 'tool-called': return evalToolCalled(habit, ctx);
    case 'file-exists': return evalFileExists(habit, ctx);
    case 'lore-recorded': return evalLoreRecorded(habit, ctx);
    case 'symbols-registered': return evalSymbolsRegistered(habit, ctx);
    case 'gates-declared': return evalGatesDeclared(habit, ctx);
    case 'tests-exist': return evalTestsExist(habit, ctx);
    default: return { habit, result: 'partial', reason: `Unknown check: ${habit.check.type}` };
  }
}

function evalToolCalled(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  const required = habit.check.params.tools || [];
  if (required.length === 0) return { habit, result: 'followed', reason: 'No tools required' };

  const called = required.filter((t) => ctx.toolsCalled.includes(t));
  if (called.length > 0) return { habit, result: 'followed', reason: `Called: ${called.join(', ')}`, evidence: called };

  if (ctx.filesModified.length === 0 && ctx.symbolsTouched.length === 0) {
    return { habit, result: 'followed', reason: 'No modifications, habit not applicable' };
  }

  return { habit, result: 'skipped', reason: `None of [${required.join(', ')}] were called before modifying code` };
}

function evalFileExists(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (ctx.filesModified.length === 0) return { habit, result: 'followed', reason: 'No files modified' };

  const hasPurpose = ctx.filesModified.some((f) => f.endsWith('.purpose') || f.includes('.paradigm/'));
  if (hasPurpose) return { habit, result: 'followed', reason: 'Purpose files updated' };

  const src = ctx.filesModified.filter((f) =>
    !f.endsWith('.md') && !f.endsWith('.json') && !f.endsWith('.yaml') &&
    !f.endsWith('.yml') && !f.endsWith('.lock') && !f.endsWith('.purpose') &&
    !f.includes('.paradigm/')
  );
  if (src.length === 0) return { habit, result: 'followed', reason: 'Only non-source files modified' };

  return { habit, result: 'skipped', reason: `${src.length} source file(s) without .purpose updates`, evidence: src.slice(0, 5) };
}

function evalLoreRecorded(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  const src = ctx.filesModified.filter((f) =>
    !f.endsWith('.md') && !f.endsWith('.json') && !f.endsWith('.yaml') &&
    !f.endsWith('.yml') && !f.endsWith('.lock') && !f.endsWith('.purpose') &&
    !f.includes('.paradigm/')
  );
  if (src.length < 3) return { habit, result: 'followed', reason: 'Session not significant (< 3 source files)' };
  if (ctx.loreRecorded || ctx.toolsCalled.includes('paradigm_lore_record')) {
    return { habit, result: 'followed', reason: 'Lore recorded' };
  }
  return { habit, result: 'skipped', reason: `${src.length} source files modified, no lore entry`, evidence: src.slice(0, 5) };
}

function evalSymbolsRegistered(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (ctx.symbolsTouched.length === 0) return { habit, result: 'followed', reason: 'No symbols touched' };
  const purposeTools = ['paradigm_purpose_add_component', 'paradigm_purpose_add_signal',
    'paradigm_purpose_add_flow', 'paradigm_purpose_add_gate', 'paradigm_purpose_add_aspect',
    'paradigm_purpose_init'];
  const called = purposeTools.filter((t) => ctx.toolsCalled.includes(t));
  if (called.length > 0) return { habit, result: 'followed', reason: `Purpose tools called: ${called.join(', ')}`, evidence: called };
  return { habit, result: 'partial', reason: `${ctx.symbolsTouched.length} symbol(s) touched, no purpose registration` };
}

function evalGatesDeclared(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (!ctx.taskAddsRoutes) return { habit, result: 'followed', reason: 'No routes added' };
  if (ctx.hasPortalRoutes) return { habit, result: 'followed', reason: 'Portal.yaml has routes' };
  const gateTools = ['paradigm_gates_for_route', 'paradigm_portal_add_route', 'paradigm_portal_add_gate'];
  const called = gateTools.filter((t) => ctx.toolsCalled.includes(t));
  if (called.length > 0) return { habit, result: 'followed', reason: `Gate tools called: ${called.join(', ')}`, evidence: called };
  return { habit, result: 'skipped', reason: 'Routes added without gate declarations' };
}

function evalTestsExist(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (ctx.filesModified.length === 0) return { habit, result: 'followed', reason: 'No files modified' };
  const tests = ctx.filesModified.filter((f) =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('/tests/') ||
    f.includes('/test/') || f.includes('__tests__')
  );
  if (tests.length > 0) return { habit, result: 'followed', reason: `Test files: ${tests.length}`, evidence: tests.slice(0, 5) };
  const src = ctx.filesModified.filter((f) =>
    !f.endsWith('.md') && !f.endsWith('.json') && !f.endsWith('.yaml') &&
    !f.endsWith('.lock') && !f.endsWith('.purpose') && !f.includes('.paradigm/') &&
    !f.includes('node_modules/')
  );
  if (src.length === 0) return { habit, result: 'followed', reason: 'No source files to test' };
  return { habit, result: 'partial', reason: `${src.length} source file(s), no test files updated`, evidence: src.slice(0, 5) };
}
