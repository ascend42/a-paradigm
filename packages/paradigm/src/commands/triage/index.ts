/**
 * Paradigm Sentinel - CLI Triage Commands
 *
 * Main command for incident triage, pattern management, and statistics.
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  SentinelStorage,
  PatternMatcher,
  TimelineBuilder,
  StatsCalculator,
  PatternSuggester,
  PatternImporter,
  loadAllSeedPatterns,
} from '@a-company/sentinel';
import type {
  IncidentStatus,
  CreatePatternInput,
  PatternSource,
} from '@a-company/sentinel';
import {
  formatHeader,
  formatSummaryBar,
  formatIncident,
  formatIncidentCompact,
  formatPattern,
  formatPatternCompact,
} from './utils/format.js';

let storage: SentinelStorage | null = null;

function getStorage(): SentinelStorage {
  if (!storage) {
    storage = new SentinelStorage();
  }
  return storage;
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage (list incidents)
// ═══════════════════════════════════════════════════════════════════

export interface TriageListOptions {
  limit?: string;
  status?: string;
  symbol?: string;
  env?: string;
  search?: string;
  from?: string;
  to?: string;
  json?: boolean;
}

export async function triageListCommand(options: TriageListOptions): Promise<void> {
  const store = getStorage();
  const matcher = new PatternMatcher(store);

  const limit = parseInt(options.limit || '10', 10);
  const status = options.status as IncidentStatus | 'all' | undefined;

  const incidents = store.getRecentIncidents({
    limit,
    status: status || 'all',
    symbol: options.symbol,
    environment: options.env,
    search: options.search,
    dateFrom: options.from,
    dateTo: options.to,
  });

  if (options.json) {
    const result = incidents.map((i) => ({
      incident: i,
      matches: matcher.match(i, { maxResults: 3 }),
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Get stats for summary
  const stats = new StatsCalculator(store).getStats(7);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = store.getIncidentCount({
    dateFrom: todayStart.toISOString(),
  });

  console.log(formatHeader());
  console.log(
    formatSummaryBar({
      open: stats.incidents.open,
      investigating:
        stats.incidents.total - stats.incidents.open - stats.incidents.resolved,
      resolved: stats.incidents.resolved,
      today: todayCount,
    })
  );
  console.log('');

  if (incidents.length === 0) {
    console.log(chalk.gray('No incidents found.'));
    return;
  }

  for (const incident of incidents) {
    const matches = matcher.match(incident, { maxResults: 3 });
    console.log(formatIncident(incident, matches));
    console.log('');
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage show <id>
// ═══════════════════════════════════════════════════════════════════

export interface TriageShowOptions {
  timeline?: boolean;
  json?: boolean;
}

export async function triageShowCommand(
  incidentId: string,
  options: TriageShowOptions
): Promise<void> {
  const store = getStorage();
  const matcher = new PatternMatcher(store);

  const incident = store.getIncident(incidentId);

  if (!incident) {
    console.log(chalk.red(`Incident ${incidentId} not found.`));
    return;
  }

  const matches = matcher.match(incident, { maxResults: 5 });

  if (options.json) {
    const result: Record<string, unknown> = { incident, matches };

    if (options.timeline && incident.flowPosition) {
      const timeline = new TimelineBuilder().build(incident);
      result.timeline = timeline
        ? new TimelineBuilder().renderStructured(timeline)
        : null;
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatIncident(incident, matches));

  // Show timeline if requested
  if (options.timeline && incident.flowPosition) {
    const timeline = new TimelineBuilder().build(incident);
    if (timeline) {
      console.log('');
      console.log(chalk.cyan.bold('Flow Timeline'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(new TimelineBuilder().renderAscii(timeline));
    }
  }

  // Show notes
  if (incident.notes.length > 0) {
    console.log('');
    console.log(chalk.cyan.bold('Notes'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const note of incident.notes) {
      console.log(
        chalk.gray(note.timestamp.substring(0, 16)) +
          ' ' +
          (note.author ? chalk.yellow(note.author + ': ') : '') +
          note.content
      );
    }
  }

  // Show related incidents
  if (incident.relatedIncidents.length > 0) {
    console.log('');
    console.log(chalk.cyan.bold('Related Incidents'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log('  ' + incident.relatedIncidents.join(', '));
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage resolve <id>
// ═══════════════════════════════════════════════════════════════════

export interface TriageResolveOptions {
  pattern?: string;
  commit?: string;
  pr?: string;
  notes?: string;
  wontFix?: boolean;
}

export async function triageResolveCommand(
  incidentId: string,
  options: TriageResolveOptions
): Promise<void> {
  const store = getStorage();

  const incident = store.getIncident(incidentId);
  if (!incident) {
    console.log(chalk.red(`Incident ${incidentId} not found.`));
    return;
  }

  if (incident.status === 'resolved' || incident.status === 'wont-fix') {
    console.log(chalk.yellow(`Incident ${incidentId} is already ${incident.status}.`));
    return;
  }

  if (options.wontFix) {
    store.updateIncident(incidentId, {
      status: 'wont-fix',
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'manual',
      resolution: {
        notes: options.notes,
      },
    });
    console.log(chalk.gray(`Incident ${incidentId} marked as won't fix.`));
    return;
  }

  store.recordResolution({
    incidentId,
    patternId: options.pattern,
    commitHash: options.commit,
    prUrl: options.pr,
    notes: options.notes,
  });

  console.log(chalk.green(`Incident ${incidentId} resolved.`));
  if (options.pattern) {
    console.log(chalk.gray(`  Pattern: ${options.pattern}`));
  }
  if (options.commit) {
    console.log(chalk.gray(`  Commit: ${options.commit}`));
  }
  if (options.pr) {
    console.log(chalk.gray(`  PR: ${options.pr}`));
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage note <id> <note>
// ═══════════════════════════════════════════════════════════════════

export async function triageNoteCommand(
  incidentId: string,
  note: string
): Promise<void> {
  const store = getStorage();

  const incident = store.getIncident(incidentId);
  if (!incident) {
    console.log(chalk.red(`Incident ${incidentId} not found.`));
    return;
  }

  store.addIncidentNote(incidentId, {
    timestamp: new Date().toISOString(),
    content: note,
  });

  console.log(chalk.green(`Note added to ${incidentId}.`));
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage link <id1> <id2>
// ═══════════════════════════════════════════════════════════════════

export async function triageLinkCommand(
  incidentId1: string,
  incidentId2: string
): Promise<void> {
  const store = getStorage();

  const inc1 = store.getIncident(incidentId1);
  const inc2 = store.getIncident(incidentId2);

  if (!inc1) {
    console.log(chalk.red(`Incident ${incidentId1} not found.`));
    return;
  }
  if (!inc2) {
    console.log(chalk.red(`Incident ${incidentId2} not found.`));
    return;
  }

  store.linkIncidents(incidentId1, incidentId2);
  console.log(chalk.green(`Linked ${incidentId1} and ${incidentId2}.`));
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage patterns
// ═══════════════════════════════════════════════════════════════════

export interface TriagePatternsOptions {
  source?: string;
  minConfidence?: string;
  json?: boolean;
}

export async function triagePatternsListCommand(
  options: TriagePatternsOptions
): Promise<void> {
  const store = getStorage();

  const patterns = store.getAllPatterns({
    source: options.source as PatternSource | undefined,
    minConfidence: options.minConfidence
      ? parseInt(options.minConfidence, 10)
      : undefined,
    includePrivate: true,
  });

  if (options.json) {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }

  console.log(chalk.cyan.bold('\nFailure Patterns'));
  console.log(chalk.gray('─'.repeat(70)));

  if (patterns.length === 0) {
    console.log(chalk.gray('No patterns found. Run `paradigm triage patterns seed` to load defaults.'));
    return;
  }

  for (const pattern of patterns) {
    console.log(formatPatternCompact(pattern));
    console.log('');
  }
}

export async function triagePatternsShowCommand(
  patternId: string,
  options: { json?: boolean }
): Promise<void> {
  const store = getStorage();

  const pattern = store.getPattern(patternId);
  if (!pattern) {
    console.log(chalk.red(`Pattern ${patternId} not found.`));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(pattern, null, 2));
    return;
  }

  console.log(formatPattern(pattern));
}

export async function triagePatternsAddCommand(
  options: {
    id: string;
    name: string;
    description?: string;
    symbols?: string;
    errorContains?: string;
    missingSignals?: string;
    strategy: string;
    priority?: string;
    codeHint?: string;
    tags?: string;
    fromIncident?: string;
  }
): Promise<void> {
  const store = getStorage();

  // If generating from incident
  if (options.fromIncident) {
    const incident = store.getIncident(options.fromIncident);
    if (!incident) {
      console.log(chalk.red(`Incident ${options.fromIncident} not found.`));
      return;
    }

    const suggester = new PatternSuggester(store);
    const suggested = suggester.suggestFromIncident(incident);

    console.log(chalk.cyan('\nSuggested Pattern:'));
    console.log(JSON.stringify(suggested, null, 2));
    console.log(
      chalk.gray(
        '\nEdit and add with: paradigm triage patterns add --id <id> --name "..." ...'
      )
    );
    return;
  }

  // Parse symbols
  const symbols: Record<string, string> = {};
  if (options.symbols) {
    const pairs = options.symbols.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split(':').map((s) => s.trim());
      if (key && value) {
        symbols[key] = value;
      }
    }
  }

  const input: CreatePatternInput = {
    id: options.id,
    name: options.name,
    description: options.description || '',
    pattern: {
      symbols,
      errorContains: options.errorContains?.split(',').map((s) => s.trim()),
      missingSignals: options.missingSignals?.split(',').map((s) => s.trim()),
    },
    resolution: {
      description: 'Resolution TBD',
      strategy: (options.strategy || 'fix-code') as any,
      priority: (options.priority || 'medium') as any,
      codeHint: options.codeHint,
    },
    source: 'manual',
    private: false,
    tags: options.tags?.split(',').map((s) => s.trim()) || [],
  };

  store.addPattern(input);
  console.log(chalk.green(`Pattern ${options.id} created.`));
}

export async function triagePatternsDeleteCommand(patternId: string): Promise<void> {
  const store = getStorage();

  const pattern = store.getPattern(patternId);
  if (!pattern) {
    console.log(chalk.red(`Pattern ${patternId} not found.`));
    return;
  }

  store.deletePattern(patternId);
  console.log(chalk.green(`Pattern ${patternId} deleted.`));
}

export async function triagePatternsTestCommand(
  patternId: string,
  options: { limit?: string; json?: boolean }
): Promise<void> {
  const store = getStorage();
  const matcher = new PatternMatcher(store);

  const pattern = store.getPattern(patternId);
  if (!pattern) {
    console.log(chalk.red(`Pattern ${patternId} not found.`));
    return;
  }

  const limit = parseInt(options.limit || '100', 10);
  const result = matcher.testPattern(pattern, limit);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.cyan.bold(`\nPattern Test: ${patternId}`));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`Would match: ${chalk.yellow(result.matchCount)} incidents`);
  console.log(`Average score: ${chalk.yellow(result.avgScore + '%')}`);

  if (result.wouldMatch.length > 0) {
    console.log('');
    console.log(chalk.cyan('Sample matches:'));
    for (const incident of result.wouldMatch.slice(0, 5)) {
      console.log(formatIncidentCompact(incident));
    }
  }
}

export async function triagePatternsSeedCommand(): Promise<void> {
  const store = getStorage();
  const spinner = ora('Loading seed patterns...').start();

  try {
    const seedData = loadAllSeedPatterns();
    const result = store.importPatterns(seedData, { overwrite: false });

    spinner.succeed(
      `Loaded ${result.imported} patterns (${result.skipped} skipped).`
    );
  } catch (error) {
    spinner.fail(`Failed to load seed patterns: ${error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage export/import
// ═══════════════════════════════════════════════════════════════════

import * as fs from 'fs';

export async function triageExportCommand(
  type: 'patterns' | 'backup',
  options: { output?: string; includePrivate?: boolean }
): Promise<void> {
  const store = getStorage();

  let data: unknown;
  let defaultFilename: string;

  if (type === 'patterns') {
    data = store.exportPatterns({
      includePrivate: options.includePrivate,
    });
    defaultFilename = 'sentinel-patterns.json';
  } else {
    data = store.exportBackup();
    defaultFilename = 'sentinel-backup.json';
  }

  const outputPath = options.output || defaultFilename;
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(chalk.green(`Exported to ${outputPath}`));
}

export async function triageImportCommand(
  filePath: string,
  options: { overwrite?: boolean }
): Promise<void> {
  const store = getStorage();
  const importer = new PatternImporter();

  const spinner = ora(`Importing from ${filePath}...`).start();

  try {
    const data = importer.loadFromFile(filePath);
    const result = store.importPatterns(data, {
      overwrite: options.overwrite,
    });

    spinner.succeed(
      `Imported ${result.imported} patterns (${result.skipped} skipped).`
    );
  } catch (error) {
    spinner.fail(`Import failed: ${error}`);
  }
}

export async function triageRestoreCommand(filePath: string): Promise<void> {
  const store = getStorage();

  const spinner = ora(`Restoring from ${filePath}...`).start();

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    store.importBackup(data);

    spinner.succeed('Backup restored.');
  } catch (error) {
    spinner.fail(`Restore failed: ${error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage stats
// ═══════════════════════════════════════════════════════════════════

export async function triageStatsCommand(options: {
  period?: string;
  symbol?: string;
  json?: boolean;
}): Promise<void> {
  const store = getStorage();
  const calculator = new StatsCalculator(store);

  // Parse period
  let periodDays = 7;
  if (options.period) {
    const match = options.period.match(/^(\d+)d$/);
    if (match) {
      periodDays = parseInt(match[1], 10);
    }
  }

  if (options.symbol) {
    const health = calculator.getSymbolHealth(options.symbol);
    if (options.json) {
      console.log(JSON.stringify(health, null, 2));
    } else {
      console.log(chalk.cyan.bold(`\nSymbol Health: ${options.symbol}`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Incidents: ${health.incidentCount}`);
      console.log(`  Avg Time to Resolve: ${health.avgTimeToResolve}m`);
      console.log('');
      console.log(chalk.cyan('  Top Patterns:'));
      for (const { patternId, count } of health.topPatterns) {
        console.log(`    ${patternId}: ${count} times`);
      }
    }
    return;
  }

  const stats = calculator.getStats(periodDays);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(calculator.generateDashboard(periodDays));
}

// ═══════════════════════════════════════════════════════════════════
// paradigm triage record
// ═══════════════════════════════════════════════════════════════════

export async function triageRecordCommand(options: {
  error: string;
  feature?: string;
  component?: string;
  flow?: string;
  gate?: string;
  signal?: string;
  state?: string;
  integration?: string;
  env: string;
  service?: string;
  version?: string;
  stack?: string;
  json?: boolean;
}): Promise<void> {
  const store = getStorage();
  const matcher = new PatternMatcher(store);

  const incidentId = store.recordIncident({
    error: {
      message: options.error,
      stack: options.stack,
    },
    symbols: {
      feature: options.feature,
      component: options.component,
      flow: options.flow,
      gate: options.gate,
      signal: options.signal,
      state: options.state,
      integration: options.integration,
    },
    environment: options.env,
    service: options.service,
    version: options.version,
  });

  const incident = store.getIncident(incidentId);
  const matches = incident ? matcher.match(incident, { maxResults: 3 }) : [];

  if (options.json) {
    console.log(JSON.stringify({ incidentId, matches }, null, 2));
    return;
  }

  console.log(chalk.green(`Recorded incident ${incidentId}`));

  if (matches.length > 0) {
    console.log('');
    console.log(chalk.cyan('Matched patterns:'));
    for (const match of matches) {
      console.log(
        `  ${chalk.yellow('★')} ${match.pattern.id} (${match.confidence}% confidence)`
      );
      console.log(chalk.gray(`     ${match.pattern.resolution.description}`));
    }
  }
}
