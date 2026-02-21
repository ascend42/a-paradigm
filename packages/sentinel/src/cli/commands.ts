/**
 * Sentinel CLI - Command Implementations
 */

import chalk from 'chalk';
import { SentinelStorage } from '../storage.js';
import { PatternMatcher } from '../matcher.js';
import { StatsCalculator } from '../stats.js';
import { TimelineBuilder } from '../timeline.js';
import { loadAllSeedPatterns } from '../seeds/loader.js';
import { startServer } from '../server/index.js';
import { writeConfig } from '../config.js';
import { generateConfig } from '../detector.js';
import {
  formatHeader,
  formatIncident,
  formatIncidentCompact,
  formatStats,
  formatSummaryBar,
} from './format.js';

/**
 * Get or initialize storage with seed patterns.
 */
async function getStorage(): Promise<SentinelStorage> {
  const storage = new SentinelStorage();
  await storage.ensureReady();

  // Load seed patterns (idempotent)
  try {
    const { patterns } = loadAllSeedPatterns();
    for (const pattern of patterns) {
      try {
        storage.addPattern(pattern);
      } catch {
        // Pattern already exists
      }
    }
  } catch {
    // Seed patterns are optional
  }

  return storage;
}

/**
 * Launch the Sentinel dashboard server.
 */
export async function launchDashboard(opts: { port: string; open: boolean }): Promise<void> {
  console.log(chalk.cyan('\n  Sentinel Dashboard\n'));

  await startServer({
    port: parseInt(opts.port, 10),
    projectDir: process.cwd(),
    open: opts.open,
  });
}

/**
 * Initialize Sentinel in the current project.
 */
export async function initProject(opts: { detect?: boolean }): Promise<void> {
  console.log(chalk.cyan('\n  Initializing Sentinel...\n'));

  const projectDir = process.cwd();
  const config = generateConfig(projectDir);
  writeConfig(projectDir, config);

  console.log(chalk.green('  Created .sentinel.yaml'));

  if (config.symbols) {
    const total =
      (config.symbols.components?.length || 0) +
      (config.symbols.gates?.length || 0) +
      (config.symbols.flows?.length || 0) +
      (config.symbols.signals?.length || 0);
    if (total > 0) {
      console.log(chalk.gray(`  Detected ${total} symbols`));
    }
  }

  // Init storage (creates DB directory + file)
  const storage = new SentinelStorage();
  await storage.ensureReady();
  storage.close();

  console.log(chalk.green('  Initialized database'));
  console.log(chalk.gray('\n  Run `sentinel` to launch the dashboard\n'));
}

/**
 * List incidents with filtering.
 */
export async function triageList(opts: {
  status?: string;
  env?: string;
  symbol?: string;
  limit: string;
}): Promise<void> {
  const storage = await getStorage();
  const matcher = new PatternMatcher(storage);

  const incidents = storage.getRecentIncidents({
    limit: parseInt(opts.limit, 10),
    status: (opts.status as any) || 'all',
    environment: opts.env,
    symbol: opts.symbol,
  });

  console.log(formatHeader());

  if (incidents.length === 0) {
    console.log(chalk.gray('  No incidents found.\n'));
    console.log(chalk.dim('  Record incidents via the SDK:'));
    console.log(chalk.dim('    sentinel.capture(error, { component: "#checkout" })'));
    console.log(chalk.dim('  Or via MCP:'));
    console.log(chalk.dim('    sentinel_record({ error: { message: "..." }, symbols: { component: "#checkout" }, environment: "production" })\n'));
    storage.close();
    return;
  }

  // Summary bar
  const all = storage.getRecentIncidents({ limit: 10000 });
  const today = new Date().toISOString().substring(0, 10);
  console.log(formatSummaryBar({
    open: all.filter((i) => i.status === 'open').length,
    investigating: all.filter((i) => i.status === 'investigating').length,
    resolved: all.filter((i) => i.status === 'resolved').length,
    today: all.filter((i) => i.timestamp.startsWith(today)).length,
  }));

  for (const incident of incidents) {
    const matches = matcher.match(incident, { maxResults: 3 });
    console.log(formatIncidentCompact(incident));
  }
  console.log('');

  storage.close();
}

/**
 * Show full incident details.
 */
export async function triageShow(id: string, opts: { timeline?: boolean }): Promise<void> {
  const storage = await getStorage();
  const matcher = new PatternMatcher(storage);

  const incident = storage.getIncident(id);
  if (!incident) {
    console.log(chalk.red(`\n  Incident ${id} not found\n`));
    storage.close();
    return;
  }

  const matches = matcher.match(incident, { maxResults: 5 });
  console.log('');
  console.log(formatIncident(incident, matches));

  if (opts.timeline && incident.flowPosition) {
    const builder = new TimelineBuilder();
    const timeline = builder.build(incident);
    if (timeline) {
      console.log('\n' + builder.renderAscii(timeline));
    }
  }

  console.log('');
  storage.close();
}

/**
 * Resolve an incident.
 */
export async function triageResolve(id: string, opts: {
  pattern?: string;
  commit?: string;
  notes?: string;
}): Promise<void> {
  const storage = await getStorage();

  const incident = storage.getIncident(id);
  if (!incident) {
    console.log(chalk.red(`\n  Incident ${id} not found\n`));
    storage.close();
    return;
  }

  storage.recordResolution({
    incidentId: id,
    patternId: opts.pattern,
    commitHash: opts.commit,
    notes: opts.notes,
  });

  console.log(chalk.green(`\n  Incident ${id} resolved\n`));
  storage.close();
}

/**
 * Show incident statistics.
 */
export async function triageStats(opts: { period: string }): Promise<void> {
  const storage = await getStorage();

  const calculator = new StatsCalculator(storage);
  const match = opts.period.match(/^(\d+)d$/);
  const days = match ? parseInt(match[1], 10) : 7;
  const stats = calculator.getStats(days);

  console.log(formatStats(stats));
  console.log('');

  storage.close();
}
