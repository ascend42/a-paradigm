/**
 * Habits CLI Commands - Behavioral feedback loop for agent discipline
 *
 * Commands:
 * - paradigm habits list - List all configured habits
 * - paradigm habits status - Show practice profile with compliance rates
 * - paradigm habits init - Initialize habits.yaml with seed habits
 * - paradigm habits add - Add a custom habit
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import {
  loadHabits,
  getEnabledHabits,
  invalidateHabitsCache,
  evaluateHabits,
  buildEvaluationContext,
  type HabitDefinition,
  type HabitsConfig,
  type HabitTrigger,
} from '../../core/habits/index.js';

const HABITS_FILE = '.paradigm/habits.yaml';

const SEED_HABIT_IDS = new Set([
  'explore-before-implement',
  'ripple-before-modify',
  'check-fragility',
  'wisdom-before-implement',
  'verify-before-done',
  'postflight-compliance',
  'test-new-components',
  'purpose-coverage',
  'record-lore-for-significant',
  'gates-for-routes',
]);

const VALID_CATEGORIES = ['discovery', 'verification', 'testing', 'documentation', 'collaboration', 'security'] as const;
const VALID_TRIGGERS = ['preflight', 'postflight', 'on-stop', 'on-commit'] as const;
const VALID_SEVERITIES = ['advisory', 'warn', 'block'] as const;
const VALID_CHECK_TYPES = ['tool-called', 'file-exists', 'file-modified', 'lore-recorded', 'symbols-registered', 'gates-declared', 'tests-exist', 'git-clean'] as const;

// ════════════════════════════════════════════════════════════════════
// Helper: Resolve habit location
// ════════════════════════════════════════════════════════════════════

interface HabitLocation {
  source: 'seed' | 'project' | 'global';
  filePath: string;
  index: number;
}

function resolveHabitLocation(rootDir: string, habitId: string): HabitLocation | null {
  // Check project habits
  const projectPath = path.join(rootDir, HABITS_FILE);
  const projectLocation = findInConfig(projectPath, habitId);
  if (projectLocation) return { source: 'project', ...projectLocation };

  // Check global habits
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  const globalPath = path.join(home, '.paradigm', 'habits.yaml');
  const globalLocation = findInConfig(globalPath, habitId);
  if (globalLocation) return { source: 'global', ...globalLocation };

  // Check if it's a seed habit
  if (SEED_HABIT_IDS.has(habitId)) return { source: 'seed', filePath: '', index: -1 };

  return null;
}

function findInConfig(filePath: string, habitId: string): { filePath: string; index: number } | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = yaml.load(content) as HabitsConfig;
    if (!config?.habits) return null;
    const idx = config.habits.findIndex(h => h.id === habitId);
    if (idx === -1) return null;
    return { filePath, index: idx };
  } catch {
    return null;
  }
}

function loadConfigFile(filePath: string): HabitsConfig {
  const content = fs.readFileSync(filePath, 'utf8');
  const config = yaml.load(content) as HabitsConfig;
  if (!config.habits) config.habits = [];
  if (!config.overrides) config.overrides = {};
  return config;
}

function writeConfigFile(filePath: string, config: HabitsConfig): void {
  fs.writeFileSync(filePath, yaml.dump(config, { lineWidth: 80, noRefs: true }), 'utf8');
}

function ensureProjectConfig(rootDir: string): string {
  const configPath = path.join(rootDir, HABITS_FILE);
  if (!fs.existsSync(configPath)) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const initial: HabitsConfig = { version: '1.0', habits: [], overrides: {} };
    writeConfigFile(configPath, initial);
  }
  return configPath;
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits list
// ════════════════════════════════════════════════════════════════════

export async function habitsListCommand(options: {
  trigger?: string;
  category?: string;
  json?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();

  let habits: HabitDefinition[];
  try {
    habits = loadHabits(rootDir);
  } catch (err) {
    console.log(chalk.red('Failed to load habits:'), (err as Error).message);
    return;
  }

  // Filter
  if (options.trigger) {
    habits = habits.filter((h) => h.trigger === options.trigger);
  }
  if (options.category) {
    habits = habits.filter((h) => h.category === options.category);
  }

  if (options.json) {
    console.log(JSON.stringify(habits, null, 2));
    return;
  }

  const enabled = habits.filter((h) => h.enabled);
  const disabled = habits.filter((h) => !h.enabled);

  console.log(chalk.magenta(`\n  Habits (${enabled.length} active, ${disabled.length} disabled)\n`));

  // Group by trigger
  const triggers = ['preflight', 'postflight', 'on-stop', 'on-commit'] as const;
  for (const trigger of triggers) {
    const group = habits.filter((h) => h.trigger === trigger);
    if (group.length === 0) continue;

    console.log(chalk.cyan(`  ${trigger}:`));
    for (const h of group) {
      const status = h.enabled ? chalk.green('ON') : chalk.gray('OFF');
      const severity = h.severity === 'block'
        ? chalk.red(h.severity)
        : h.severity === 'warn'
          ? chalk.yellow(h.severity)
          : chalk.gray(h.severity);

      console.log(`    ${status} ${chalk.white(h.id)} [${severity}] - ${h.name}`);
      console.log(chalk.gray(`       ${h.description}`));
    }
    console.log();
  }

  // Show config file location
  const projectConfig = path.join(rootDir, HABITS_FILE);
  if (fs.existsSync(projectConfig)) {
    console.log(chalk.gray(`  Config: ${HABITS_FILE}`));
  } else {
    console.log(chalk.gray(`  Config: using seed habits only (run 'paradigm habits init' to customize)`));
  }
  console.log();
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits status
// ════════════════════════════════════════════════════════════════════

export async function habitsStatusCommand(options: {
  period?: string;
  json?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();

  // Load habits
  let habits: HabitDefinition[];
  try {
    habits = loadHabits(rootDir);
  } catch (err) {
    console.log(chalk.red('Failed to load habits:'), (err as Error).message);
    return;
  }

  const enabled = getEnabledHabits(habits);

  // Try to load practice events from Sentinel
  let practiceData: {
    total: number;
    followed: number;
    skipped: number;
    partial: number;
    rate: number;
    byCategory: Array<{ category: string; rate: number; total: number }>;
  } | null = null;

  try {
    const { SentinelStorage } = await import('@a-company/sentinel');
    const sentinelDir = path.join(rootDir, '.paradigm', 'sentinel');
    if (fs.existsSync(sentinelDir)) {
      const storage = new SentinelStorage(sentinelDir);
      const period = options.period || '30d';
      const days = parseInt(period.replace('d', ''), 10) || 30;
      const dateFrom = period === 'all'
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const compliance = storage.getComplianceRate({ dateFrom });
      const events = storage.getPracticeEvents({ dateFrom, limit: 500 });

      // Build category stats
      const catStats = new Map<string, { followed: number; skipped: number; partial: number }>();
      for (const event of events) {
        const cat = event.habitCategory;
        const existing = catStats.get(cat) || { followed: 0, skipped: 0, partial: 0 };
        existing[event.result]++;
        catStats.set(cat, existing);
      }

      const byCategory = Array.from(catStats.entries()).map(([category, stats]) => {
        const total = stats.followed + stats.skipped + stats.partial;
        const rate = total > 0 ? Math.round(((stats.followed + stats.partial * 0.5) / total) * 100) : 100;
        return { category, rate, total };
      }).sort((a, b) => a.rate - b.rate);

      practiceData = {
        total: compliance.total,
        followed: compliance.followed,
        skipped: compliance.skipped,
        partial: compliance.partial,
        rate: compliance.rate,
        byCategory,
      };
    }
  } catch {
    // Sentinel not available or no practice data
  }

  if (options.json) {
    console.log(JSON.stringify({
      habits: { total: habits.length, enabled: enabled.length },
      practice: practiceData,
    }, null, 2));
    return;
  }

  console.log(chalk.magenta('\n  Habits Practice Profile\n'));

  // Habits overview
  console.log(chalk.white(`  Total habits: ${habits.length} (${enabled.length} active)`));

  const byTrigger = new Map<string, number>();
  for (const h of enabled) {
    byTrigger.set(h.trigger, (byTrigger.get(h.trigger) || 0) + 1);
  }
  for (const [trigger, count] of byTrigger) {
    console.log(chalk.gray(`    ${trigger}: ${count} habit(s)`));
  }
  console.log();

  // Practice data
  if (practiceData && practiceData.total > 0) {
    const rateColor = practiceData.rate >= 80 ? chalk.green
      : practiceData.rate >= 60 ? chalk.yellow
        : chalk.red;

    console.log(chalk.white(`  Compliance Rate: ${rateColor(`${practiceData.rate}%`)}`));
    console.log(chalk.gray(`    Followed: ${practiceData.followed} | Skipped: ${practiceData.skipped} | Partial: ${practiceData.partial}`));
    console.log(chalk.gray(`    Total events: ${practiceData.total}\n`));

    if (practiceData.byCategory.length > 0) {
      console.log(chalk.white('  By Category:'));
      for (const cat of practiceData.byCategory) {
        const catColor = cat.rate >= 80 ? chalk.green
          : cat.rate >= 60 ? chalk.yellow
            : chalk.red;
        const bar = '█'.repeat(Math.round(cat.rate / 5)) + '░'.repeat(20 - Math.round(cat.rate / 5));
        console.log(`    ${cat.category.padEnd(15)} ${catColor(bar)} ${catColor(`${cat.rate}%`)} (${cat.total})`);
      }
    }
  } else {
    console.log(chalk.gray('  No practice events recorded yet.'));
    console.log(chalk.gray('  Call paradigm_habits_check via MCP to start recording.\n'));
  }

  console.log();
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits init
// ════════════════════════════════════════════════════════════════════

export async function habitsInitCommand(options: {
  force?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, HABITS_FILE);

  if (fs.existsSync(configPath) && !options.force) {
    console.log(chalk.yellow(`${HABITS_FILE} already exists. Use --force to overwrite.`));
    return;
  }

  // Ensure directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const defaultConfig: HabitsConfig = {
    version: '1.0',
    habits: [],
    overrides: {
      'verify-before-done': {
        severity: 'warn',
      },
    },
  };

  const content = `# Paradigm Habits Configuration
# See: paradigm habits list (for all seed habits)
#
# Seed habits are built-in and active by default.
# Use 'overrides' to tune severity or disable specific habits.
# Add custom habits in the 'habits' section.

${yaml.dump(defaultConfig, { lineWidth: 80, noRefs: true })}
# Example custom habit:
# habits:
#   - id: my-custom-check
#     name: "Custom Check"
#     description: "Describe what this habit enforces"
#     category: verification
#     trigger: postflight
#     severity: advisory
#     check:
#       type: tool-called
#       params:
#         tools: [paradigm_pm_postflight]
#     enabled: true
#
# Override seed habits:
# overrides:
#   verify-before-done:
#     severity: block      # Upgrade to blocking
#   check-fragility:
#     enabled: false        # Disable this habit
`;

  fs.writeFileSync(configPath, content, 'utf8');
  invalidateHabitsCache(rootDir);

  console.log(chalk.green(`Created ${HABITS_FILE}`));
  console.log(chalk.gray('  10 seed habits are active by default.'));
  console.log(chalk.gray('  Use overrides section to tune severity or disable habits.'));
  console.log(chalk.gray('  Run `paradigm habits list` to see all habits.\n'));
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits add
// ════════════════════════════════════════════════════════════════════

export async function habitsAddCommand(options: {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: string;
  severity?: string;
  tools?: string;
  checkType?: string;
  patterns?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, HABITS_FILE);

  // Ensure config exists
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(`No ${HABITS_FILE} found. Run 'paradigm habits init' first.`));
    return;
  }

  // Validate enums
  if (!VALID_CATEGORIES.includes(options.category as typeof VALID_CATEGORIES[number])) {
    console.log(chalk.red(`Invalid category: ${options.category}. Valid: ${VALID_CATEGORIES.join(', ')}`));
    return;
  }
  if (!VALID_TRIGGERS.includes(options.trigger as typeof VALID_TRIGGERS[number])) {
    console.log(chalk.red(`Invalid trigger: ${options.trigger}. Valid: ${VALID_TRIGGERS.join(', ')}`));
    return;
  }
  if (options.severity && !VALID_SEVERITIES.includes(options.severity as typeof VALID_SEVERITIES[number])) {
    console.log(chalk.red(`Invalid severity: ${options.severity}. Valid: ${VALID_SEVERITIES.join(', ')}`));
    return;
  }

  const checkType = (options.checkType || 'tool-called') as HabitDefinition['check']['type'];
  if (!VALID_CHECK_TYPES.includes(checkType as typeof VALID_CHECK_TYPES[number])) {
    console.log(chalk.red(`Invalid check-type: ${checkType}. Valid: ${VALID_CHECK_TYPES.join(', ')}`));
    return;
  }

  // Load existing
  let config: HabitsConfig;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    config = yaml.load(content) as HabitsConfig;
    if (!config.habits) config.habits = [];
  } catch (err) {
    console.log(chalk.red('Failed to parse habits.yaml:'), (err as Error).message);
    return;
  }

  // Check for duplicate
  const existingIds = new Set([
    ...config.habits.map((h) => h.id),
    ...loadHabits(rootDir).map((h) => h.id),
  ]);
  if (existingIds.has(options.id)) {
    console.log(chalk.yellow(`Habit "${options.id}" already exists.`));
    return;
  }

  // Parse tools and patterns
  const tools = options.tools ? options.tools.split(',').map((t) => t.trim()) : [];
  const patterns = options.patterns ? options.patterns.split(',').map((p) => p.trim()) : [];

  // Build check params based on check type
  const checkParams: HabitDefinition['check']['params'] = {};
  if (checkType === 'tool-called' && tools.length > 0) checkParams.tools = tools;
  if ((checkType === 'file-exists' || checkType === 'file-modified' || checkType === 'tests-exist') && patterns.length > 0) {
    checkParams.patterns = patterns;
  }

  const newHabit: HabitDefinition = {
    id: options.id,
    name: options.name,
    description: options.description,
    category: options.category as HabitDefinition['category'],
    trigger: options.trigger as HabitDefinition['trigger'],
    severity: (options.severity || 'advisory') as HabitDefinition['severity'],
    check: {
      type: checkType,
      params: checkParams,
    },
    enabled: true,
  };

  config.habits.push(newHabit);

  writeConfigFile(configPath, config);
  invalidateHabitsCache(rootDir);

  console.log(chalk.green(`Added habit: ${options.id}`));
  console.log(chalk.gray(`  Name: ${options.name}`));
  console.log(chalk.gray(`  Category: ${options.category} | Trigger: ${options.trigger} | Severity: ${options.severity || 'advisory'}`));
  console.log(chalk.gray(`  Check: ${checkType}`));
  if (tools.length > 0) console.log(chalk.gray(`  Tools: ${tools.join(', ')}`));
  if (patterns.length > 0) console.log(chalk.gray(`  Patterns: ${patterns.join(', ')}`));
  console.log();
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits edit <id>
// ════════════════════════════════════════════════════════════════════

export async function habitsEditCommand(
  id: string,
  options: {
    name?: string;
    description?: string;
    category?: string;
    trigger?: string;
    severity?: string;
    enabled?: string;
    checkType?: string;
    patterns?: string;
    tools?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();

  // Validate enum values if provided
  if (options.category && !VALID_CATEGORIES.includes(options.category as typeof VALID_CATEGORIES[number])) {
    console.log(chalk.red(`Invalid category: ${options.category}. Valid: ${VALID_CATEGORIES.join(', ')}`));
    return;
  }
  if (options.trigger && !VALID_TRIGGERS.includes(options.trigger as typeof VALID_TRIGGERS[number])) {
    console.log(chalk.red(`Invalid trigger: ${options.trigger}. Valid: ${VALID_TRIGGERS.join(', ')}`));
    return;
  }
  if (options.severity && !VALID_SEVERITIES.includes(options.severity as typeof VALID_SEVERITIES[number])) {
    console.log(chalk.red(`Invalid severity: ${options.severity}. Valid: ${VALID_SEVERITIES.join(', ')}`));
    return;
  }
  if (options.checkType && !VALID_CHECK_TYPES.includes(options.checkType as typeof VALID_CHECK_TYPES[number])) {
    console.log(chalk.red(`Invalid check-type: ${options.checkType}. Valid: ${VALID_CHECK_TYPES.join(', ')}`));
    return;
  }

  const location = resolveHabitLocation(rootDir, id);
  if (!location) {
    console.log(chalk.red(`Habit not found: ${id}`));
    return;
  }

  if (location.source === 'seed') {
    // Seed habits: only allow severity and enabled overrides
    const nonOverrideFields = ['name', 'description', 'category', 'trigger', 'checkType', 'patterns', 'tools'] as const;
    const hasNonOverride = nonOverrideFields.some(f => options[f] !== undefined);
    if (hasNonOverride) {
      console.log(chalk.yellow(`"${id}" is a seed habit. Only --severity and --enabled can be changed.`));
      console.log(chalk.gray('  Other fields require creating a custom habit with the same functionality.'));
      return;
    }

    if (!options.severity && options.enabled === undefined) {
      console.log(chalk.yellow('No changes specified. Use --severity or --enabled for seed habits.'));
      return;
    }

    const configPath = ensureProjectConfig(rootDir);
    const config = loadConfigFile(configPath);
    if (!config.overrides) config.overrides = {};
    if (!config.overrides[id]) config.overrides[id] = {};

    if (options.severity) config.overrides[id].severity = options.severity as HabitDefinition['severity'];
    if (options.enabled !== undefined) config.overrides[id].enabled = options.enabled === 'true';

    writeConfigFile(configPath, config);
    invalidateHabitsCache(rootDir);

    console.log(chalk.green(`Updated seed habit override: ${id}`));
    if (options.severity) console.log(chalk.gray(`  Severity: ${options.severity}`));
    if (options.enabled !== undefined) console.log(chalk.gray(`  Enabled: ${options.enabled}`));
    console.log();
    return;
  }

  // Custom habit (project or global)
  const config = loadConfigFile(location.filePath);
  const habit = config.habits[location.index];

  if (options.name) habit.name = options.name;
  if (options.description) habit.description = options.description;
  if (options.category) habit.category = options.category as HabitDefinition['category'];
  if (options.trigger) habit.trigger = options.trigger as HabitDefinition['trigger'];
  if (options.severity) habit.severity = options.severity as HabitDefinition['severity'];
  if (options.enabled !== undefined) habit.enabled = options.enabled === 'true';
  if (options.checkType) habit.check.type = options.checkType as HabitDefinition['check']['type'];
  if (options.tools) habit.check.params.tools = options.tools.split(',').map(t => t.trim());
  if (options.patterns) habit.check.params.patterns = options.patterns.split(',').map(p => p.trim());

  config.habits[location.index] = habit;
  writeConfigFile(location.filePath, config);
  invalidateHabitsCache(rootDir);

  const source = location.source === 'global' ? '(global)' : '(project)';
  console.log(chalk.green(`Updated habit: ${id} ${chalk.gray(source)}`));
  console.log();
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits remove <id>
// ════════════════════════════════════════════════════════════════════

export async function habitsRemoveCommand(
  id: string,
  options: { yes?: boolean }
): Promise<void> {
  const rootDir = process.cwd();
  const location = resolveHabitLocation(rootDir, id);

  if (!location) {
    console.log(chalk.red(`Habit not found: ${id}`));
    return;
  }

  if (location.source === 'seed') {
    console.log(chalk.yellow(`"${id}" is a seed habit and cannot be removed.`));
    console.log(chalk.gray(`  Use: paradigm habits edit ${id} --enabled false`));
    return;
  }

  // Load habit for display
  const config = loadConfigFile(location.filePath);
  const habit = config.habits[location.index];

  if (!options.yes) {
    console.log(chalk.yellow(`\nWill remove habit: ${habit.name} (${id})`));
    console.log(chalk.gray(`  Source: ${location.source} (${location.filePath})`));
    console.log(chalk.gray(`  Use --yes to confirm.\n`));
    return;
  }

  config.habits.splice(location.index, 1);
  writeConfigFile(location.filePath, config);
  invalidateHabitsCache(rootDir);

  console.log(chalk.green(`Removed habit: ${id}`));
  console.log();
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits enable/disable <id>
// ════════════════════════════════════════════════════════════════════

export async function habitsToggleCommand(
  id: string,
  action: 'enable' | 'disable'
): Promise<void> {
  const rootDir = process.cwd();
  const enabled = action === 'enable';
  const location = resolveHabitLocation(rootDir, id);

  if (!location) {
    console.log(chalk.red(`Habit not found: ${id}`));
    return;
  }

  if (location.source === 'seed') {
    // Write override
    const configPath = ensureProjectConfig(rootDir);
    const config = loadConfigFile(configPath);
    if (!config.overrides) config.overrides = {};
    if (!config.overrides[id]) config.overrides[id] = {};
    config.overrides[id].enabled = enabled;

    writeConfigFile(configPath, config);
    invalidateHabitsCache(rootDir);

    console.log(chalk.green(`${enabled ? 'Enabled' : 'Disabled'} seed habit: ${id}`));
    console.log();
    return;
  }

  // Custom habit
  const config = loadConfigFile(location.filePath);
  config.habits[location.index].enabled = enabled;
  writeConfigFile(location.filePath, config);
  invalidateHabitsCache(rootDir);

  console.log(chalk.green(`${enabled ? 'Enabled' : 'Disabled'} habit: ${id}`));
  console.log();
}

// ════════════════════════════════════════════════════════════════════
// paradigm habits check
// ════════════════════════════════════════════════════════════════════

export async function habitsCheckCommand(options: {
  trigger: string;
  record?: boolean;
  json?: boolean;
  files?: string;
  symbols?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const trigger = options.trigger as HabitTrigger;

  // Load habits
  let habits: HabitDefinition[];
  try {
    habits = loadHabits(rootDir);
  } catch (err) {
    console.log(chalk.red('Failed to load habits:'), (err as Error).message);
    process.exitCode = 1;
    return;
  }

  // Parse --files and --symbols
  const filesModified = options.files
    ? options.files.split(',').map((f) => f.trim()).filter(Boolean)
    : getGitModifiedFiles(rootDir);

  const symbolsTouched = options.symbols
    ? options.symbols.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // Check if git working tree is clean
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

  // Check portal.yaml
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

  // Build evaluation context
  const evalContext = buildEvaluationContext({
    toolsCalled: [],  // CLI has no session breadcrumbs
    filesModified,
    symbolsTouched,
    loreRecorded: false,
    hasPortalRoutes,
    taskAddsRoutes: false,
    gitClean,
  });

  // Evaluate
  const evaluation = evaluateHabits(habits, trigger, evalContext);

  // Record practice events if requested
  let recordedCount = 0;
  if (options.record && evaluation.evaluations.length > 0) {
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
            symbolsTouched,
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

  // Output
  if (options.json) {
    console.log(JSON.stringify({
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
    }, null, 2));
  } else {
    printHumanReadableResults(evaluation, recordedCount);
  }

  // Exit code 1 if blocking violations
  if (evaluation.blocksCompletion) {
    process.exitCode = 1;
  }
}

function getGitModifiedFiles(rootDir: string): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 5000,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function printHumanReadableResults(
  evaluation: ReturnType<typeof evaluateHabits>,
  recordedCount: number
): void {
  const { summary } = evaluation;

  console.log(chalk.magenta(`\n  Habits Check (${evaluation.trigger})\n`));

  for (const e of evaluation.evaluations) {
    const icon = e.result === 'followed'
      ? chalk.green('PASS')
      : e.result === 'skipped'
        ? (e.habit.severity === 'block' ? chalk.red('BLOCK') : chalk.yellow('SKIP'))
        : chalk.gray('PART');

    const severity = e.habit.severity === 'block'
      ? chalk.red(e.habit.severity)
      : e.habit.severity === 'warn'
        ? chalk.yellow(e.habit.severity)
        : chalk.gray(e.habit.severity);

    console.log(`  ${icon} ${chalk.white(e.habit.id)} [${severity}]`);
    console.log(chalk.gray(`       ${e.reason}`));
  }

  console.log();
  console.log(chalk.white(`  Summary: ${summary.followed} followed, ${summary.skipped} skipped, ${summary.partial} partial`));

  if (summary.blockingViolations > 0) {
    console.log(chalk.red(`  ${summary.blockingViolations} blocking violation(s) — exit code 1`));
  }

  if (recordedCount > 0) {
    console.log(chalk.gray(`  Recorded ${recordedCount} practice event(s) to Sentinel`));
  }

  console.log();
}
