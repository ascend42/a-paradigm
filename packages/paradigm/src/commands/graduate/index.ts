/**
 * Graduate CLI Commands — #graduation-cli
 *
 * Commands:
 * - paradigm graduate status - Show current automation tier of every habit
 * - paradigm graduate promote <id> - Force-graduate a habit to hook tier
 * - paradigm graduate demote <id> - Force-demote a habit back to habit tier
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';

interface GraduationState {
  tier?: string;
  neverGraduate?: boolean;
  graduatedAt?: string;
  complianceAtGraduation?: number;
  demotedAt?: string;
  failureCount?: number;
  cooldownUntil?: string;
}

interface GraduationYaml {
  version?: string;
  config?: Record<string, unknown>;
  states?: Record<string, GraduationState>;
}

function loadGraduationYaml(rootDir: string): GraduationYaml {
  const filePath = path.join(rootDir, '.paradigm', 'graduation.yaml');
  if (!fs.existsSync(filePath)) return { states: {} };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return (yaml.load(content) as GraduationYaml) || { states: {} };
  } catch {
    return { states: {} };
  }
}

// Seed habit names for display
const SEED_HABIT_NAMES: Record<string, string> = {
  'explore-before-implement': 'Explore Before Implementing',
  'ripple-before-modify': 'Ripple Before Modifying',
  'check-fragility': 'Check Fragility',
  'wisdom-before-implement': 'Check Team Wisdom',
  'verify-before-done': 'Verify Before Done',
  'postflight-compliance': 'Postflight Compliance',
  'test-new-components': 'Test New Components',
  'purpose-coverage': 'Purpose File Coverage',
  'record-lore-for-significant': 'Record Lore for Significant Changes',
  'confidence-on-decisions': 'Confidence on Decisions',
  'gates-for-routes': 'Gates for Routes',
  'university-content-valid': 'University Content Valid',
  'university-onboarded': 'University Onboarding',
};

const TIER_COLORS: Record<string, (s: string) => string> = {
  hook: chalk.green,
  habit: chalk.yellow,
  mcp: chalk.red,
};

const TIER_ICONS: Record<string, string> = {
  hook: '⚡',   // zero cost
  habit: '💭',   // agent-reminded
  mcp: '🔧',    // agent-manual
};

/**
 * paradigm graduate status
 */
export async function graduateStatusCommand(options: { json?: boolean }) {
  const cwd = process.cwd();
  const data = loadGraduationYaml(cwd);
  const states = data.states || {};

  if (options.json) {
    console.log(JSON.stringify({ states }, null, 2));
    return;
  }

  console.log(chalk.blue('\n⚡ Automation Tier Status\n'));
  console.log(chalk.gray('─'.repeat(60)));

  // Group by tier
  const byTier: Record<string, Array<{ id: string; state: GraduationState }>> = {
    hook: [],
    habit: [],
    mcp: [],
  };

  // Include all known habits (seed + any with graduation state)
  const allIds = new Set([...Object.keys(SEED_HABIT_NAMES), ...Object.keys(states)]);

  for (const id of allIds) {
    const state = states[id] || {};
    const tier = (state.tier as string) || 'habit';
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push({ id, state });
  }

  // Summary counts
  const hookCount = byTier.hook.length;
  const habitCount = byTier.habit.length;
  const mcpCount = byTier.mcp.length;
  const total = hookCount + habitCount + mcpCount;

  console.log(`  ${chalk.green(`${hookCount} hook`)}  ${chalk.yellow(`${habitCount} habit`)}  ${chalk.red(`${mcpCount} mcp`)}  (${total} total)\n`);

  // Hooks tier
  if (byTier.hook.length > 0) {
    console.log(chalk.green.bold('  ⚡ Hooks (zero context cost)'));
    for (const { id, state } of byTier.hook) {
      const name = SEED_HABIT_NAMES[id] || id;
      const date = state.graduatedAt ? ` — graduated ${state.graduatedAt.split('T')[0]}` : '';
      console.log(`    ${chalk.green('●')} ${name} ${chalk.gray(`(${id})${date}`)}`);
    }
    console.log();
  }

  // Habits tier
  if (byTier.habit.length > 0) {
    console.log(chalk.yellow.bold('  💭 Habits (agent-reminded)'));
    for (const { id, state } of byTier.habit) {
      const name = SEED_HABIT_NAMES[id] || id;
      const lock = state.neverGraduate ? chalk.gray(' 🔒 never-graduate') : '';
      const cooldown = state.cooldownUntil && new Date(state.cooldownUntil) > new Date()
        ? chalk.gray(` ⏳ cooldown until ${state.cooldownUntil.split('T')[0]}`)
        : '';
      console.log(`    ${chalk.yellow('●')} ${name} ${chalk.gray(`(${id})`)}${lock}${cooldown}`);
    }
    console.log();
  }

  // MCP tier
  if (byTier.mcp.length > 0) {
    console.log(chalk.red.bold('  🔧 MCP Tools (manual, high token cost)'));
    for (const { id, state } of byTier.mcp) {
      const name = SEED_HABIT_NAMES[id] || id;
      console.log(`    ${chalk.red('●')} ${name} ${chalk.gray(`(${id})`)}`);
    }
    console.log();
  }

  // Token savings estimate
  if (hookCount > 0) {
    const estimatedSavings = hookCount * 150; // ~150 tokens per skipped habit evaluation
    console.log(chalk.gray(`  Estimated savings: ~${estimatedSavings} tokens/session from ${hookCount} graduated habit(s)`));
  }

  console.log();
}

function saveGraduationYaml(rootDir: string, data: GraduationYaml): void {
  const filePath = path.join(rootDir, '.paradigm', 'graduation.yaml');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * paradigm graduate promote <id>
 */
export async function graduatePromoteCommand(habitId: string) {
  const cwd = process.cwd();
  const data = loadGraduationYaml(cwd);
  if (!data.states) data.states = {};

  const state = data.states[habitId] || {};
  if (state.tier === 'hook') {
    console.log(chalk.yellow(`${habitId} is already graduated to hook tier.`));
    return;
  }
  if (state.neverGraduate) {
    console.log(chalk.red(`${habitId} is marked as never-graduate (requires agent cognition).`));
    return;
  }

  data.states[habitId] = {
    ...state,
    tier: 'hook',
    graduatedAt: new Date().toISOString(),
    complianceAtGraduation: 100,
    failureCount: 0,
  };
  saveGraduationYaml(cwd, data);

  const name = SEED_HABIT_NAMES[habitId] || habitId;
  console.log(chalk.green(`${chalk.bold('⚡')} Graduated "${name}" to hook tier.`));
  console.log(chalk.gray('  MCP evaluation will skip this habit. Stop hook enforces compliance.'));
}

/**
 * paradigm graduate demote <id>
 */
export async function graduateDemoteCommand(habitId: string, options: { cooldown?: string }) {
  const cwd = process.cwd();
  const data = loadGraduationYaml(cwd);
  if (!data.states) data.states = {};

  const state = data.states[habitId] || {};
  if (state.tier !== 'hook') {
    console.log(chalk.yellow(`${habitId} is not at hook tier (currently: ${state.tier || 'habit'}).`));
    return;
  }

  const cooldownDays = options.cooldown ? parseInt(options.cooldown) : 14;
  const cooldownUntil = new Date();
  cooldownUntil.setDate(cooldownUntil.getDate() + cooldownDays);

  data.states[habitId] = {
    ...state,
    tier: 'habit',
    demotedAt: new Date().toISOString(),
    cooldownUntil: cooldownUntil.toISOString(),
  };
  saveGraduationYaml(cwd, data);

  const name = SEED_HABIT_NAMES[habitId] || habitId;
  console.log(chalk.yellow(`${chalk.bold('💭')} Demoted "${name}" back to habit tier.`));
  console.log(chalk.gray(`  Cooldown: ${cooldownDays} days (until ${cooldownUntil.toISOString().split('T')[0]}).`));
  console.log(chalk.gray('  MCP evaluation will resume checking this habit.'));
}
