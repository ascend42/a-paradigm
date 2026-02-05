/**
 * paradigm team agents suggest - Suggest agents for a task
 *
 * Analyzes a task description and suggests which agents should handle it
 * based on triggers defined in agents.yaml.
 */

import chalk from 'chalk';
import { loadAgentsManifest } from './loader.js';
import { suggestAgentsForTask } from '../../core/agent-matcher.js';

interface SuggestOptions {
  json?: boolean;
}

/**
 * paradigm team agents suggest <task>
 */
export async function agentsSuggestCommand(
  task: string,
  options: SuggestOptions
): Promise<void> {
  const rootDir = process.cwd();
  const manifest = loadAgentsManifest(rootDir);

  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No agents.yaml found' }));
    } else {
      console.log(
        chalk.red('\nNo agents.yaml found. Run `paradigm team init` first.\n')
      );
    }
    process.exit(1);
  }

  const suggestions = suggestAgentsForTask(task, manifest.agents);

  if (options.json) {
    console.log(JSON.stringify({ task, suggestions }, null, 2));
    return;
  }

  console.log(chalk.cyan('\nSuggested agents for this task:\n'));
  console.log(chalk.gray(`  Task: "${task}"\n`));

  if (suggestions.length === 0) {
    console.log(
      chalk.yellow('  No agents matched. Consider using architect → builder flow.\n')
    );
    console.log(chalk.gray('  Tip: Add keyword or symbol triggers to agents.yaml\n'));
    return;
  }

  for (const suggestion of suggestions) {
    const icon =
      suggestion.confidence === 'high'
        ? chalk.green('★')
        : suggestion.confidence === 'medium'
        ? chalk.yellow('◆')
        : chalk.gray('○');

    console.log(
      `  ${icon} ${chalk.white.bold(suggestion.name)} ${chalk.gray(`(${suggestion.confidence})`)}`
    );
    console.log(chalk.gray(`    ${suggestion.reason}`));
    console.log(
      chalk.gray(`    Matched: ${suggestion.triggers_matched.join(', ')}\n`)
    );
  }

  // Suggest workflow
  if (suggestions.length > 0) {
    console.log(chalk.cyan('  Suggested workflow:'));
    const agents = suggestions.map((s) => s.name);

    // Reorder to standard flow if applicable
    const orderedAgents = reorderToStandardFlow(agents);
    console.log(chalk.gray(`    ${orderedAgents.join(' → ')}\n`));

    console.log(chalk.gray('  Or use MCP orchestration:'));
    console.log(
      chalk.gray(
        `    paradigm_orchestrate_inline({ task: "${task.slice(0, 30)}${task.length > 30 ? '...' : ''}", mode: "plan" })\n`
      )
    );
  }
}

/**
 * Reorder agents to follow standard Paradigm flow:
 * architect → builder → reviewer → tester
 */
function reorderToStandardFlow(agents: string[]): string[] {
  const order = ['architect', 'security', 'builder', 'reviewer', 'tester'];
  const result: string[] = [];
  const remaining = new Set(agents);

  for (const agent of order) {
    if (remaining.has(agent)) {
      result.push(agent);
      remaining.delete(agent);
    }
  }

  // Add any remaining agents not in standard flow
  for (const agent of remaining) {
    result.push(agent);
  }

  return result;
}
