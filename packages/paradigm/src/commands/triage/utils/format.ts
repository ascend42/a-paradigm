/**
 * Paradigm Sentinel - CLI Formatting Utilities
 */

import chalk from 'chalk';
import type {
  SymbolicIncidentRecord,
  PatternMatch,
  FailurePattern,
  SentinelStats,
} from '@a-company/sentinel';

export function formatHeader(): string {
  return `
${chalk.cyan('╔══════════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}                    ${chalk.bold.white('PARADIGM SENTINEL TRIAGE')}                      ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════════════════════╝')}
`;
}

export function formatSummaryBar(stats: {
  open: number;
  investigating: number;
  resolved: number;
  today: number;
}): string {
  return `${chalk.cyan('╔══════════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  Open: ${chalk.yellow(String(stats.open).padEnd(4))} │  Investigating: ${chalk.blue(String(stats.investigating).padEnd(3))} │  Resolved: ${chalk.green(String(stats.resolved).padEnd(4))} │  Today: ${chalk.magenta(`+${stats.today}`)}   ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════════════════════╝')}
`;
}

export function formatIncident(
  incident: SymbolicIncidentRecord,
  matches?: PatternMatch[]
): string {
  const lines: string[] = [];
  const statusColor = getStatusColor(incident.status);

  // Header
  lines.push(
    chalk.gray('┌─────────────────────────────────────────────────────────────────┐')
  );
  lines.push(
    chalk.gray('│ ') +
      chalk.bold(`[${incident.id}] `) +
      statusColor(incident.status.toUpperCase().padEnd(12)) +
      chalk.gray(incident.timestamp.substring(0, 19).replace('T', ' ').padStart(19)) +
      chalk.gray(' │')
  );
  lines.push(
    chalk.gray('├─────────────────────────────────────────────────────────────────┤')
  );

  // Error message
  lines.push(chalk.gray('│ ') + chalk.red('Error: ') + truncate(incident.error.message, 55) + chalk.gray(' │'));
  lines.push(chalk.gray('│') + ' '.repeat(65) + chalk.gray('│'));

  // Symbolic context
  lines.push(chalk.gray('│ ') + chalk.cyan('Symbolic Context:') + ' '.repeat(47) + chalk.gray('│'));
  const symbols = formatSymbols(incident.symbols as Record<string, string | undefined>);
  for (const sym of symbols) {
    lines.push(chalk.gray('│   ') + sym.padEnd(61) + chalk.gray(' │'));
  }
  lines.push(chalk.gray('│') + ' '.repeat(65) + chalk.gray('│'));

  // Environment
  const envLine = `Environment: ${chalk.yellow(incident.environment)}  │  Service: ${chalk.yellow(incident.service || 'N/A')}  │  v${incident.version || 'N/A'}`;
  lines.push(chalk.gray('│ ') + envLine.substring(0, 63).padEnd(63) + chalk.gray(' │'));

  // Matched patterns
  if (matches && matches.length > 0) {
    lines.push(chalk.gray('│') + ' '.repeat(65) + chalk.gray('│'));
    lines.push(
      chalk.gray('│ ┌─ ') +
        chalk.cyan('Matched Patterns') +
        chalk.gray(' ─'.repeat(22) + '┐ │')
    );

    for (let i = 0; i < Math.min(matches.length, 3); i++) {
      const match = matches[i];
      const icon = i === 0 ? chalk.yellow('★') : chalk.gray('○');
      const conf = `${match.confidence}% confidence`;
      lines.push(
        chalk.gray('│ │ ') +
          icon +
          ' ' +
          chalk.bold(truncate(match.pattern.id, 30).padEnd(30)) +
          chalk.gray(conf.padStart(15)) +
          chalk.gray('    │ │')
      );
      lines.push(
        chalk.gray('│ │   ') +
          chalk.italic(truncate(match.pattern.description, 45).padEnd(45)) +
          chalk.gray('     │ │')
      );
      lines.push(
        chalk.gray('│ │   Strategy: ') +
          chalk.cyan(match.pattern.resolution.strategy.padEnd(40)) +
          chalk.gray('     │ │')
      );
      if (i < Math.min(matches.length, 3) - 1) {
        lines.push(chalk.gray('│ │') + ' '.repeat(59) + chalk.gray('│ │'));
      }
    }
    lines.push(
      chalk.gray('│ └') + '─'.repeat(59) + chalk.gray('┘ │')
    );
  }

  // Actions
  lines.push(chalk.gray('│') + ' '.repeat(65) + chalk.gray('│'));
  lines.push(chalk.gray('│ ') + chalk.dim('Actions:') + ' '.repeat(56) + chalk.gray('│'));
  lines.push(
    chalk.gray('│   ') +
      chalk.dim(`paradigm triage resolve ${incident.id}`) +
      ' '.repeat(35 - incident.id.length) +
      chalk.gray('│')
  );
  lines.push(
    chalk.gray('│   ') +
      chalk.dim(`paradigm triage show ${incident.id} --timeline`) +
      ' '.repeat(28 - incident.id.length) +
      chalk.gray('│')
  );

  lines.push(
    chalk.gray('└─────────────────────────────────────────────────────────────────┘')
  );

  return lines.join('\n');
}

export function formatIncidentCompact(incident: SymbolicIncidentRecord): string {
  const statusColor = getStatusColor(incident.status);
  const status = statusColor(incident.status.substring(0, 4).toUpperCase().padEnd(4));
  const timestamp = incident.timestamp.substring(5, 16).replace('T', ' ');
  const error = truncate(incident.error.message, 40);
  const symbols = Object.values(incident.symbols).filter(Boolean).join(' ');

  return `${chalk.bold(incident.id)} ${status} ${chalk.gray(timestamp)} ${error}\n    ${chalk.cyan(truncate(symbols, 60))}`;
}

export function formatPattern(pattern: FailurePattern): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan(`Pattern: ${pattern.id}`));
  lines.push(chalk.white(`  Name: ${pattern.name}`));
  lines.push(chalk.gray(`  Description: ${pattern.description}`));
  lines.push('');
  lines.push(chalk.yellow('  Matching Criteria:'));

  if (pattern.pattern.symbols) {
    for (const [key, value] of Object.entries(pattern.pattern.symbols)) {
      if (value) {
        const v = Array.isArray(value) ? value.join(', ') : value;
        lines.push(`    ${chalk.cyan(key)}: ${v}`);
      }
    }
  }

  if (pattern.pattern.errorContains) {
    lines.push(
      `    ${chalk.cyan('errorContains')}: ${pattern.pattern.errorContains.join(', ')}`
    );
  }

  if (pattern.pattern.missingSignals) {
    lines.push(
      `    ${chalk.cyan('missingSignals')}: ${pattern.pattern.missingSignals.join(', ')}`
    );
  }

  lines.push('');
  lines.push(chalk.green('  Resolution:'));
  lines.push(`    ${chalk.white(pattern.resolution.description)}`);
  lines.push(
    `    Strategy: ${chalk.cyan(pattern.resolution.strategy)}  Priority: ${getPriorityColor(pattern.resolution.priority)(pattern.resolution.priority)}`
  );

  if (pattern.resolution.codeHint) {
    lines.push(`    ${chalk.dim('Hint: ' + pattern.resolution.codeHint)}`);
  }

  lines.push('');
  lines.push(chalk.blue('  Confidence:'));
  lines.push(
    `    Score: ${getConfidenceColor(pattern.confidence.score)(pattern.confidence.score + '%')}  Matched: ${pattern.confidence.timesMatched}  Resolved: ${pattern.confidence.timesResolved}  Recurred: ${pattern.confidence.timesRecurred}`
  );

  lines.push('');
  lines.push(
    chalk.gray(
      `  Source: ${pattern.source}  Tags: ${pattern.tags.join(', ') || 'none'}`
    )
  );

  return lines.join('\n');
}

export function formatPatternCompact(pattern: FailurePattern): string {
  const confidence = getConfidenceColor(pattern.confidence.score)(
    `${pattern.confidence.score}%`
  );
  const tags = pattern.tags.slice(0, 3).join(', ');

  return `${chalk.bold(pattern.id.padEnd(30))} ${confidence.padStart(8)}  ${chalk.gray(pattern.source.padEnd(10))} ${chalk.dim(tags)}
  ${chalk.white(truncate(pattern.name, 60))}`;
}

export function formatStats(stats: SentinelStats): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan('\nIncident Statistics'));
  lines.push(chalk.gray('─'.repeat(50)));
  lines.push(`  Total: ${chalk.white(stats.incidents.total)}`);
  lines.push(`  Open: ${chalk.yellow(stats.incidents.open)}`);
  lines.push(`  Resolved: ${chalk.green(stats.incidents.resolved)}`);
  lines.push('');

  lines.push(chalk.bold.cyan('By Environment'));
  for (const [env, count] of Object.entries(stats.incidents.byEnvironment)) {
    lines.push(`  ${env}: ${count}`);
  }
  lines.push('');

  lines.push(chalk.bold.cyan('Resolution Stats'));
  lines.push(chalk.gray('─'.repeat(50)));
  lines.push(`  Resolution Rate: ${chalk.green(Math.round(stats.resolution.resolutionRate) + '%')}`);
  lines.push(`  Resolved with Pattern: ${stats.resolution.resolvedWithPattern}`);
  lines.push(`  Resolved Manually: ${stats.resolution.resolvedManually}`);
  lines.push('');

  lines.push(chalk.bold.cyan('Top Affected Symbols'));
  lines.push(chalk.gray('─'.repeat(50)));
  for (const { symbol, count } of stats.symbols.mostIncidents.slice(0, 5)) {
    lines.push(`  ${chalk.cyan(symbol.padEnd(30))} ${count} incidents`);
  }
  lines.push('');

  lines.push(chalk.bold.cyan('Most Effective Patterns'));
  lines.push(chalk.gray('─'.repeat(50)));
  for (const { patternId, resolvedCount } of stats.patterns.mostEffective.slice(0, 5)) {
    lines.push(`  ${patternId.padEnd(30)} ${resolvedCount} resolved`);
  }

  return lines.join('\n');
}

function formatSymbols(symbols: Record<string, string | undefined>): string[] {
  const result: string[] = [];

  for (const [key, value] of Object.entries(symbols)) {
    if (value) {
      const color = getSymbolColor(key);
      result.push(`${color(value.padEnd(20))} ${chalk.dim(key)}`);
    }
  }

  return result;
}

function getStatusColor(status: string): typeof chalk.red {
  switch (status) {
    case 'open':
      return chalk.red;
    case 'investigating':
      return chalk.yellow;
    case 'resolved':
      return chalk.green;
    case 'wont-fix':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

function getSymbolColor(type: string): typeof chalk.red {
  switch (type) {
    case 'feature':
      return chalk.magenta;
    case 'component':
      return chalk.blue;
    case 'flow':
      return chalk.cyan;
    case 'gate':
      return chalk.yellow;
    case 'signal':
      return chalk.green;
    case 'state':
      return chalk.red;
    case 'integration':
      return chalk.white;
    default:
      return chalk.gray;
  }
}

function getPriorityColor(priority: string): typeof chalk.red {
  switch (priority) {
    case 'critical':
      return chalk.red.bold;
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

function getConfidenceColor(score: number): typeof chalk.red {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  if (score >= 40) return chalk.red;
  return chalk.gray;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}
