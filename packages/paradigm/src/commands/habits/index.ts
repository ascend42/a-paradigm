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
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import {
  loadHabits,
  getEnabledHabits,
  invalidateHabitsCache,
  type HabitDefinition,
  type HabitsConfig,
} from '../../core/habits/index.js';

const HABITS_FILE = '.paradigm/habits.yaml';

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
}): Promise<void> {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, HABITS_FILE);

  // Ensure config exists
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(`No ${HABITS_FILE} found. Run 'paradigm habits init' first.`));
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

  // Parse tools
  const tools = options.tools ? options.tools.split(',').map((t) => t.trim()) : [];

  const newHabit: HabitDefinition = {
    id: options.id,
    name: options.name,
    description: options.description,
    category: options.category as HabitDefinition['category'],
    trigger: options.trigger as HabitDefinition['trigger'],
    severity: (options.severity || 'advisory') as HabitDefinition['severity'],
    check: {
      type: 'tool-called',
      params: { tools },
    },
    enabled: true,
  };

  config.habits.push(newHabit);

  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 80, noRefs: true }), 'utf8');
  invalidateHabitsCache(rootDir);

  console.log(chalk.green(`Added habit: ${options.id}`));
  console.log(chalk.gray(`  Name: ${options.name}`));
  console.log(chalk.gray(`  Category: ${options.category} | Trigger: ${options.trigger} | Severity: ${options.severity || 'advisory'}`));
  if (tools.length > 0) {
    console.log(chalk.gray(`  Tools: ${tools.join(', ')}`));
  }
  console.log();
}
