/**
 * paradigm team cost - Show cost summary for orchestrations
 *
 * Usage:
 *   paradigm team cost                    # Show all-time costs
 *   paradigm team cost --from 2026-02-01  # From date
 *   paradigm team cost --days 7           # Last 7 days
 */

import * as path from 'path';
import chalk from 'chalk';
import { AuditLogger } from '../../core/audit-logger.js';
import { formatCost, formatTokens } from '../../core/agent-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface CostCommandOptions {
  from?: string;
  to?: string;
  days?: string;
  json?: boolean;
  detailed?: boolean;
}

// ============================================================================
// Command
// ============================================================================

export async function teamCostCommand(
  targetPath: string | undefined,
  options: CostCommandOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  // Parse date range
  let from: Date | undefined;
  let to: Date | undefined;

  if (options.days) {
    const days = parseInt(options.days);
    from = new Date();
    from.setDate(from.getDate() - days);
  }

  if (options.from) {
    from = new Date(options.from);
  }

  if (options.to) {
    to = new Date(options.to);
  }

  // Load audit logs
  const auditLogger = new AuditLogger(rootDir);
  const summary = auditLogger.getCostSummary(from, to);

  // JSON output
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Display summary
  console.log();
  console.log(chalk.blue('━'.repeat(50)));
  console.log(chalk.blue('  Orchestration Cost Summary'));
  console.log(chalk.blue('━'.repeat(50)));
  console.log();

  // Date range
  if (from || to) {
    const fromStr = from ? from.toISOString().slice(0, 10) : 'beginning';
    const toStr = to ? to.toISOString().slice(0, 10) : 'now';
    console.log(chalk.gray(`  Period: ${fromStr} to ${toStr}`));
    console.log();
  }

  // Totals
  console.log(chalk.cyan('  Totals:'));
  console.log(chalk.white(`    Orchestrations: ${summary.orchestrationCount}`));
  console.log(chalk.white(`    Total tokens: ${formatTokens(summary.totalTokens)}`));
  console.log(chalk.white(`    Total cost: ${formatCost(summary.totalCost)}`));
  console.log();

  // By model
  if (Object.keys(summary.byModel).length > 0) {
    console.log(chalk.cyan('  By Model:'));
    for (const [model, data] of Object.entries(summary.byModel)) {
      const percent = ((data.cost / summary.totalCost) * 100).toFixed(1);
      console.log(chalk.gray(`    ${model.padEnd(8)} ${formatCost(data.cost).padStart(10)} (${percent}%) - ${data.count} calls`));
    }
    console.log();
  }

  // By agent
  if (Object.keys(summary.byAgent).length > 0 && options.detailed) {
    console.log(chalk.cyan('  By Agent:'));
    for (const [agent, data] of Object.entries(summary.byAgent)) {
      const percent = ((data.cost / summary.totalCost) * 100).toFixed(1);
      console.log(chalk.gray(`    ${agent.padEnd(12)} ${formatCost(data.cost).padStart(10)} (${percent}%) - ${data.count} calls`));
    }
    console.log();
  }

  // By day (last 7 days if detailed)
  if (summary.byDay.length > 0 && options.detailed) {
    console.log(chalk.cyan('  By Day (recent):'));
    const recentDays = summary.byDay.slice(-7);
    for (const day of recentDays) {
      const bar = '█'.repeat(Math.ceil((day.cost / summary.totalCost) * 20));
      console.log(chalk.gray(`    ${day.date} ${formatCost(day.cost).padStart(10)} ${chalk.blue(bar)}`));
    }
    console.log();
  }

  // Pricing reference
  if (options.detailed) {
    console.log(chalk.cyan('  Model Pricing Reference:'));
    console.log(chalk.gray('    opus:   $15.00 / $75.00 per 1M tokens (in/out)'));
    console.log(chalk.gray('    sonnet: $3.00 / $15.00 per 1M tokens (in/out)'));
    console.log(chalk.gray('    haiku:  $0.25 / $1.25 per 1M tokens (in/out)'));
    console.log();
  }

  // Tips
  if (summary.totalCost > 1) {
    console.log(chalk.yellow('  Tips to reduce costs:'));
    console.log(chalk.gray('    - Use haiku for builder/tester agents'));
    console.log(chalk.gray('    - Set budget limits: --budget "cost=5"'));
    console.log(chalk.gray('    - Compare modes: paradigm team orchestrate "..." --compare'));
    console.log();
  }
}
