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
  | 'security'
  | 'quality';

export type HabitTrigger = 'preflight' | 'postflight' | 'on-commit' | 'on-stop';
export type HabitSeverity = 'advisory' | 'warn' | 'block';
export type HabitCheckType =
  | 'tool-called'
  | 'file-exists'
  | 'file-modified'
  | 'lore-recorded'
  | 'symbols-registered'
  | 'gates-declared'
  | 'tests-exist'
  | 'git-clean'
  | 'commit-message-format'
  | 'flow-coverage'
  | 'context-checked'
  | 'aspect-anchored';

export interface HabitCheck {
  type: HabitCheckType;
  params: {
    tools?: string[];
    patterns?: string[];
    minSymbols?: number;
    requireRoutes?: boolean;
    messagePatterns?: string[];
    minSteps?: number;
    contextTools?: string[];
    checkAnchors?: boolean;
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
  /** Platforms this habit applies to (e.g. ['claude', 'cursor', 'cli']). Undefined = all platforms. */
  platforms?: string[];
}

export interface HabitOverride {
  severity?: HabitSeverity;
  enabled?: boolean;
}

export interface HabitValidationResult {
  valid: boolean;
  errors: string[];
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
  gitClean?: boolean;
  commitMessage?: string;
  hasFlowCoverage?: boolean;
  aspectAnchorsValid?: boolean;
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
    id: 'confidence-on-decisions',
    name: 'Confidence on Decisions',
    description: 'When recording lore, include a confidence score (0.0-1.0) to enable calibration tracking over time',
    category: 'documentation',
    trigger: 'on-stop',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_lore_record'] } },
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
  {
    id: 'university-content-valid',
    name: 'University Content Valid',
    description: 'Validate university content integrity when files in symbol-covered areas change',
    category: 'quality',
    trigger: 'on-stop',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_university_validate'] } },
    enabled: true,
  },
  {
    id: 'university-onboarded',
    name: 'University Onboarding',
    description: 'Call paradigm_university_onboard at session start for project-specific learning content',
    category: 'discovery',
    trigger: 'preflight',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_university_onboard'] } },
    enabled: false,
  },
  // ── Agent Orchestration Enforcement ──────────────────────────
  {
    id: 'orchestration-required',
    name: 'Orchestrate Complex Tasks',
    description: 'Tasks affecting 3+ files or touching security symbols should use paradigm_orchestrate_inline to determine which agents are needed. Ensures security review, test coverage, and documentation.',
    category: 'collaboration',
    trigger: 'preflight',
    severity: 'warn',
    check: { type: 'tool-called', params: { tools: ['paradigm_orchestrate_inline'] } },
    enabled: true,
  },
  {
    id: 'agent-coverage-validated',
    name: 'Validate Agent Involvement',
    description: 'After completing work, verify that agents with relevant expertise were consulted. Check nominations that were surfaced but not acted on.',
    category: 'collaboration',
    trigger: 'postflight',
    severity: 'advisory',
    check: { type: 'tool-called', params: { tools: ['paradigm_ambient_nominations', 'paradigm_agent_list'] } },
    enabled: true,
  },
  {
    id: 'hot-mode-incident',
    name: 'Incident Response Acknowledgment',
    description: 'During incident response, orchestration enforcement is waived. But a post-incident lore entry is required and a postflight review should be scheduled.',
    category: 'collaboration',
    trigger: 'on-stop',
    severity: 'advisory',
    check: { type: 'lore-recorded' },
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

  // 1. Seed habits (embedded)
  for (const seed of SEED_HABITS) {
    habitsById.set(seed.id, { ...seed });
  }

  const home = process.env.HOME || process.env.USERPROFILE || '~';

  // 2. Global habits.yaml
  const globalConfig = loadHabitsYaml(path.join(home, '.paradigm', 'habits.yaml'));
  if (globalConfig) mergeHabits(habitsById, globalConfig);

  // 3. Global .habit files
  const globalHabitFiles = loadHabitFiles(path.join(home, '.paradigm', 'habits'));
  for (const habit of globalHabitFiles) {
    habitsById.set(habit.id, habit);
  }

  // 4. Project habits.yaml
  const projectConfig = loadHabitsYaml(path.join(rootDir, '.paradigm', 'habits.yaml'));
  if (projectConfig) mergeHabits(habitsById, projectConfig);

  // 5. Project .habit files
  const projectHabitFiles = loadHabitFiles(path.join(rootDir, '.paradigm', 'habits'));
  for (const habit of projectHabitFiles) {
    habitsById.set(habit.id, habit);
  }

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
// .HABIT FILE LOADING
// ═══════════════════════════════════════════════════════════════════

function loadHabitFiles(dir: string): HabitDefinition[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.habit'))
      .sort();
    const habits: HabitDefinition[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const habit = yaml.load(content) as HabitDefinition;
        if (habit?.id && habit?.name) {
          habits.push(habit);
        }
      } catch {
        // Skip malformed files
      }
    }
    return habits;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════

const VALID_CATEGORIES: HabitCategory[] = [
  'discovery', 'verification', 'testing', 'documentation', 'collaboration', 'security',
];

const VALID_TRIGGERS: HabitTrigger[] = [
  'preflight', 'postflight', 'on-commit', 'on-stop',
];

const VALID_SEVERITIES: HabitSeverity[] = ['advisory', 'warn', 'block'];

const VALID_CHECK_TYPES: HabitCheckType[] = [
  'tool-called', 'file-exists', 'file-modified', 'lore-recorded',
  'symbols-registered', 'gates-declared', 'tests-exist', 'git-clean',
  'commit-message-format', 'flow-coverage', 'context-checked', 'aspect-anchored',
];

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateHabitDefinition(habit: Partial<HabitDefinition>): HabitValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!habit.id) errors.push('Missing required field: id');
  if (!habit.name) errors.push('Missing required field: name');
  if (!habit.description) errors.push('Missing required field: description');
  if (!habit.category) errors.push('Missing required field: category');
  if (!habit.trigger) errors.push('Missing required field: trigger');
  if (!habit.severity) errors.push('Missing required field: severity');
  if (!habit.check) errors.push('Missing required field: check');
  if (habit.enabled === undefined || habit.enabled === null) errors.push('Missing required field: enabled');

  // ID format
  if (habit.id && !KEBAB_CASE_RE.test(habit.id)) {
    errors.push(`Invalid id format: "${habit.id}" — must be kebab-case (lowercase, hyphens only)`);
  }

  // Enum validation
  if (habit.category && !VALID_CATEGORIES.includes(habit.category)) {
    errors.push(`Invalid category: "${habit.category}" — must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (habit.trigger && !VALID_TRIGGERS.includes(habit.trigger)) {
    errors.push(`Invalid trigger: "${habit.trigger}" — must be one of: ${VALID_TRIGGERS.join(', ')}`);
  }
  if (habit.severity && !VALID_SEVERITIES.includes(habit.severity)) {
    errors.push(`Invalid severity: "${habit.severity}" — must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  // Check type + param consistency
  if (habit.check) {
    if (!VALID_CHECK_TYPES.includes(habit.check.type)) {
      errors.push(`Invalid check.type: "${habit.check.type}" — must be one of: ${VALID_CHECK_TYPES.join(', ')}`);
    }
    const params = habit.check.params || {};
    switch (habit.check.type) {
      case 'tool-called':
        if (!params.tools || !Array.isArray(params.tools) || params.tools.length === 0) {
          errors.push('check.type "tool-called" requires check.params.tools[] (non-empty array)');
        }
        break;
      case 'file-exists':
      case 'file-modified':
        if (!params.patterns || !Array.isArray(params.patterns) || params.patterns.length === 0) {
          errors.push(`check.type "${habit.check.type}" requires check.params.patterns[] (non-empty array)`);
        }
        break;
      case 'commit-message-format':
        if (!params.messagePatterns || !Array.isArray(params.messagePatterns) || params.messagePatterns.length === 0) {
          errors.push('check.type "commit-message-format" requires check.params.messagePatterns[] (non-empty array)');
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

const SEED_HABIT_IDS = new Set(SEED_HABITS.map(h => h.id));

export function isSeedHabit(id: string): boolean {
  return SEED_HABIT_IDS.has(id);
}

export function saveHabit(rootDir: string, habit: HabitDefinition, scope: 'project' | 'global' = 'project'): string {
  const baseDir = scope === 'global'
    ? path.join(process.env.HOME || process.env.USERPROFILE || '~', '.paradigm', 'habits')
    : path.join(rootDir, '.paradigm', 'habits');

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const filePath = path.join(baseDir, `${habit.id}.habit`);
  const content = yaml.dump(habit, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(filePath, content, 'utf8');

  // Invalidate cache so next load picks up the change
  invalidateHabitsCache(rootDir);

  return filePath;
}

export function removeHabit(rootDir: string, id: string): { removed: boolean; reason?: string } {
  if (isSeedHabit(id)) {
    return { removed: false, reason: `"${id}" is a seed habit and cannot be removed. Use overrides in habits.yaml to disable it.` };
  }

  // Check project habits dir
  const projectPath = path.join(rootDir, '.paradigm', 'habits', `${id}.habit`);
  if (fs.existsSync(projectPath)) {
    fs.unlinkSync(projectPath);
    invalidateHabitsCache(rootDir);
    return { removed: true };
  }

  // Check global habits dir
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  const globalPath = path.join(home, '.paradigm', 'habits', `${id}.habit`);
  if (fs.existsSync(globalPath)) {
    fs.unlinkSync(globalPath);
    invalidateHabitsCache(rootDir);
    return { removed: true };
  }

  return { removed: false, reason: `No .habit file found for "${id}". It may be defined in habits.yaml — edit that file directly.` };
}

// ═══════════════════════════════════════════════════════════════════
// EVALUATOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Count of habits skipped because they are graduated to hooks.
 * Set during evaluateHabits() and read by callers for reporting.
 */
export let lastGraduatedSkipCount = 0;

export function evaluateHabits(
  habits: HabitDefinition[],
  trigger: HabitTrigger,
  context: EvaluationContext,
  platform?: string,
  rootDir?: string
): EvaluationResult {
  let activeHabits = getHabitsByTrigger(habits, trigger);
  if (platform) {
    activeHabits = activeHabits.filter((h) => !h.platforms || h.platforms.includes(platform));
  }

  // Skip habits that have been graduated to hooks (zero context cost)
  let graduatedCount = 0;
  if (rootDir) {
    try {
      const { isGraduated } = require('./graduation-store.js');
      const beforeCount = activeHabits.length;
      activeHabits = activeHabits.filter((h) => !isGraduated(rootDir, h.id));
      graduatedCount = beforeCount - activeHabits.length;
    } catch {
      // graduation-store not available — evaluate all habits
    }
  }
  lastGraduatedSkipCount = graduatedCount;

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
  gitClean?: boolean;
}): EvaluationContext {
  return {
    toolsCalled: params.toolsCalled || [],
    filesModified: params.filesModified || [],
    symbolsTouched: params.symbolsTouched || [],
    loreRecorded: params.loreRecorded || false,
    hasPortalRoutes: params.hasPortalRoutes || false,
    taskAddsRoutes: params.taskAddsRoutes || false,
    taskDescription: params.taskDescription,
    gitClean: params.gitClean,
  };
}

function evaluateHabit(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  switch (habit.check.type) {
    case 'tool-called': return evalToolCalled(habit, ctx);
    case 'file-exists': return evalFileExists(habit, ctx);
    case 'file-modified': return evalFileModified(habit, ctx);
    case 'lore-recorded': return evalLoreRecorded(habit, ctx);
    case 'symbols-registered': return evalSymbolsRegistered(habit, ctx);
    case 'gates-declared': return evalGatesDeclared(habit, ctx);
    case 'tests-exist': return evalTestsExist(habit, ctx);
    case 'git-clean': return evalGitClean(habit, ctx);
    case 'commit-message-format': return evalCommitMessageFormat(habit, ctx);
    case 'flow-coverage': return evalFlowCoverage(habit, ctx);
    case 'context-checked': return evalContextChecked(habit, ctx);
    case 'aspect-anchored': return evalAspectAnchored(habit, ctx);
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

function evalFileModified(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (ctx.filesModified.length === 0) return { habit, result: 'followed', reason: 'No files modified' };

  const patterns = habit.check.params.patterns || [];
  if (patterns.length === 0) return { habit, result: 'followed', reason: 'No patterns specified' };

  // file-modified checks on on-stop use git diff which only shows committed changes.
  // The agent may have modified the file but not committed yet — this is normal at session end.
  // Only block on on-commit trigger where files should already be staged.
  if (habit.trigger === 'on-stop' && habit.severity === 'block') {
    const matched = ctx.filesModified.filter((f) =>
      patterns.some((p) => f.includes(p) || path.basename(f) === p)
    );
    if (matched.length > 0) {
      return { habit, result: 'followed', reason: `Matching files: ${matched.join(', ')}`, evidence: matched };
    }
    // Downgrade to advisory on on-stop — file may exist but not yet be in git diff
    return { habit, result: 'partial', reason: `None of [${patterns.join(', ')}] in git diff yet (may not be committed). Use on-commit trigger for reliable check.` };
  }

  const matched = ctx.filesModified.filter((f) =>
    patterns.some((p) => f.includes(p) || path.basename(f) === p)
  );

  if (matched.length > 0) {
    return { habit, result: 'followed', reason: `Matching files: ${matched.join(', ')}`, evidence: matched };
  }

  return { habit, result: 'skipped', reason: `None of [${patterns.join(', ')}] found in modified files` };
}

function evalGitClean(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (ctx.filesModified.length === 0) return { habit, result: 'followed', reason: 'No files modified' };

  // git-clean is inherently incompatible with on-stop blocking — the stop hook
  // runs BEFORE the user commits, so uncommitted changes are expected.
  // Downgrade to 'followed' on on-stop to prevent false blocks.
  if (habit.trigger === 'on-stop') {
    return { habit, result: 'followed', reason: 'git-clean skipped on-stop (uncommitted changes expected before commit)' };
  }

  if (ctx.gitClean === undefined) {
    return { habit, result: 'partial', reason: 'Git status not available' };
  }
  if (ctx.gitClean) {
    return { habit, result: 'followed', reason: 'Working tree is clean — changes committed' };
  }
  return { habit, result: 'skipped', reason: 'Uncommitted changes in working tree' };
}

function evalCommitMessageFormat(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  if (!ctx.commitMessage) {
    return { habit, result: 'followed', reason: 'No commit message to check (not a commit trigger)' };
  }
  const patterns = habit.check.params.messagePatterns || [
    '^(feat|fix|refactor|chore|docs|test|style|perf|ci|build)\\(',
    'Symbols:',
  ];
  const matched = patterns.filter((p) => new RegExp(p, 'm').test(ctx.commitMessage!));
  if (matched.length === patterns.length) {
    return { habit, result: 'followed', reason: 'Commit message matches all required patterns', evidence: matched };
  }
  if (matched.length > 0) {
    const missing = patterns.filter((p) => !new RegExp(p, 'm').test(ctx.commitMessage!));
    return { habit, result: 'partial', reason: `Matches ${matched.length}/${patterns.length} patterns. Missing: ${missing.join(', ')}` };
  }
  return { habit, result: 'skipped', reason: 'Commit message does not match required format patterns' };
}

function evalFlowCoverage(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  const componentSymbols = ctx.symbolsTouched.filter((s) => s.startsWith('#'));
  if (componentSymbols.length < 3) {
    return { habit, result: 'followed', reason: 'Fewer than 3 components touched — flow not required' };
  }
  if (ctx.hasFlowCoverage) {
    return { habit, result: 'followed', reason: 'Flow coverage exists for multi-component changes' };
  }
  const flowTools = ['paradigm_flow_check', 'paradigm_flows_affected', 'paradigm_purpose_add_flow'];
  const called = flowTools.filter((t) => ctx.toolsCalled.includes(t));
  if (called.length > 0) {
    return { habit, result: 'followed', reason: `Flow tools called: ${called.join(', ')}`, evidence: called };
  }
  return { habit, result: 'skipped', reason: `${componentSymbols.length} components touched without flow coverage`, evidence: componentSymbols.slice(0, 5) };
}

function evalContextChecked(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  const contextTools = habit.check.params.contextTools || [
    'paradigm_session_health', 'paradigm_session_recover', 'paradigm_session_checkpoint',
  ];
  const called = contextTools.filter((t) => ctx.toolsCalled.includes(t));
  if (called.length > 0) {
    return { habit, result: 'followed', reason: `Context tools called: ${called.join(', ')}`, evidence: called };
  }
  if (ctx.filesModified.length === 0 && ctx.symbolsTouched.length === 0) {
    return { habit, result: 'followed', reason: 'No modifications, context check not applicable' };
  }
  return { habit, result: 'skipped', reason: 'No context/session tools called during session' };
}

function evalAspectAnchored(habit: HabitDefinition, ctx: EvaluationContext): HabitEvaluation {
  const aspects = ctx.symbolsTouched.filter((s) => s.startsWith('~'));
  if (aspects.length === 0) {
    return { habit, result: 'followed', reason: 'No aspects touched' };
  }
  if (ctx.aspectAnchorsValid === true) {
    return { habit, result: 'followed', reason: 'Aspect anchors validated and valid' };
  }
  if (ctx.toolsCalled.includes('paradigm_aspect_check')) {
    return { habit, result: 'followed', reason: 'paradigm_aspect_check was called to validate anchors' };
  }
  return { habit, result: 'skipped', reason: `${aspects.length} aspect(s) touched without anchor validation`, evidence: aspects.slice(0, 5) };
}
