/**
 * paradigm agent roster - Project-level agent roster management
 *
 * Manages .paradigm/roster.yaml which controls which of the 54 global
 * agents are active for this project.
 *
 * Commands:
 *   paradigm agent roster           — Show current roster
 *   paradigm agent roster init      — Create roster based on project type
 *   paradigm agent roster add <id>  — Add agents to the roster
 *   paradigm agent roster remove <id> — Remove agents from the roster
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import { out, success, warn, error, header, kv, dim } from '../../utils/cli-output.js';

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.paradigm', 'agents');
const AGENT_EXT = '.agent';

interface RosterFile {
  version: string;
  active: string[];
  project?: string;
  type?: string;
}

interface AgentSummary {
  id: string;
  nickname?: string;
  role: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getRosterPath(): string {
  return path.join(process.cwd(), '.paradigm', 'roster.yaml');
}

function loadRoster(): RosterFile | null {
  const rosterPath = getRosterPath();
  if (!fs.existsSync(rosterPath)) return null;
  try {
    return yaml.load(fs.readFileSync(rosterPath, 'utf-8')) as RosterFile;
  } catch {
    return null;
  }
}

function saveRoster(roster: RosterFile): void {
  const rosterPath = getRosterPath();
  const dir = path.dirname(rosterPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(rosterPath, yaml.dump(roster, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf-8');
}

function getAllAgentIds(): string[] {
  if (!fs.existsSync(GLOBAL_AGENTS_DIR)) return [];
  try {
    return fs.readdirSync(GLOBAL_AGENTS_DIR)
      .filter(f => f.endsWith(AGENT_EXT))
      .map(f => f.replace(AGENT_EXT, ''))
      .sort();
  } catch {
    return [];
  }
}

function loadAgentSummary(id: string): AgentSummary | null {
  const filePath = path.join(GLOBAL_AGENTS_DIR, `${id}${AGENT_EXT}`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = yaml.load(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    return {
      id: (data.id as string) || id,
      nickname: data.nickname as string | undefined,
      role: (data.role as string) || 'Unknown',
    };
  } catch {
    return null;
  }
}

// ============================================================================
// paradigm agent roster (show)
// ============================================================================

export async function rosterShowCommand(options: { json?: boolean } = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-roster-show').start('Showing project roster', { cwd });

  const allAgents = getAllAgentIds();
  const totalCount = allAgents.length;
  const roster = loadRoster();

  if (!roster) {
    if (options.json) {
      out(JSON.stringify({ roster: null, message: 'No roster configured', totalAgents: totalCount }));
    } else {
      header('Agent Roster');
      out('');
      warn(`No roster configured — all ${totalCount} agents are active.`);
      dim(`  Run ${chalk.cyan('paradigm agent roster init')} to create one.`);
      out('');
    }
    tracker.success('No roster found');
    return;
  }

  const activeIds = roster.active || [];

  if (options.json) {
    const agents = activeIds.map(id => {
      const summary = loadAgentSummary(id);
      return summary || { id, role: 'Unknown' };
    });
    out(JSON.stringify({
      count: activeIds.length,
      total: totalCount,
      project: roster.project,
      type: roster.type,
      agents,
    }, null, 2));
    tracker.success(`${activeIds.length} of ${totalCount} agents active`);
    return;
  }

  header('Agent Roster');
  out('');

  // Table header
  const idCol = 'ID'.padEnd(16);
  const nickCol = 'Nickname'.padEnd(12);
  const roleCol = 'Role';
  out(`  ${chalk.dim(idCol)} ${chalk.dim(nickCol)} ${chalk.dim(roleCol)}`);
  out(`  ${chalk.dim('-'.repeat(16))} ${chalk.dim('-'.repeat(12))} ${chalk.dim('-'.repeat(30))}`);

  for (const id of activeIds.sort()) {
    const summary = loadAgentSummary(id);
    const nickname = summary?.nickname || chalk.dim('—');
    const role = summary?.role || chalk.dim('Unknown');
    out(`  ${chalk.white.bold(id.padEnd(16))} ${(typeof nickname === 'string' ? nickname : nickname).toString().padEnd(12)} ${chalk.gray(role)}`);
  }

  out('');
  out(`  ${chalk.cyan(String(activeIds.length))} of ${chalk.cyan(String(totalCount))} agents active on this project`);

  if (roster.type) {
    kv('Project type', roster.type);
  }
  out('');

  tracker.success(`${activeIds.length} of ${totalCount} agents active`);
}

// ============================================================================
// paradigm agent roster init
// ============================================================================

export async function rosterInitCommand(options: { force?: boolean; json?: boolean } = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-roster-init').start('Initializing project roster', { cwd });

  const rosterPath = getRosterPath();
  if (fs.existsSync(rosterPath) && !options.force) {
    const existing = loadRoster();
    const count = existing?.active?.length ?? 0;
    if (options.json) {
      out(JSON.stringify({ error: 'Roster already exists', count }));
    } else {
      warn(`Roster already exists with ${count} agents.`);
      dim(`  Use ${chalk.cyan('--force')} to reinitialize, or ${chalk.cyan('paradigm agent roster add/remove')} to modify.`);
    }
    tracker.error('Roster already exists');
    return;
  }

  // Detect project type
  const { detectProjectType, ROSTER_SUGGESTIONS } = await import('../../core/project-type.js');
  const projectType = detectProjectType(cwd);
  const suggested = ROSTER_SUGGESTIONS[projectType] || ROSTER_SUGGESTIONS['generic'];

  // Read project name from config if available
  let projectName = path.basename(cwd);
  const configPath = path.join(cwd, '.paradigm', 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      if (config?.project && typeof config.project === 'string') {
        projectName = config.project;
      }
    } catch { /* use directory name */ }
  }

  const roster: RosterFile = {
    version: '1.0',
    project: projectName,
    type: projectType,
    active: suggested.sort(),
  };

  saveRoster(roster);

  const allAgents = getAllAgentIds();

  if (options.json) {
    out(JSON.stringify({
      created: true,
      project: projectName,
      type: projectType,
      active: suggested.sort(),
      count: suggested.length,
      total: allAgents.length,
    }, null, 2));
  } else {
    header('Agent Roster Initialized');
    out('');
    kv('Project', projectName);
    kv('Detected type', projectType);
    kv('Active agents', `${suggested.length} of ${allAgents.length}`);
    out('');
    out(`  ${chalk.cyan(suggested.sort().join(', '))}`);
    out('');
    success(`Roster written to ${chalk.dim('.paradigm/roster.yaml')}`);
    dim(`  Modify with ${chalk.cyan('paradigm agent roster add/remove <agent-id>')}`);
    out('');
  }

  tracker.success(`Created roster: ${suggested.length} agents for ${projectType}`);
}

// ============================================================================
// paradigm agent roster add
// ============================================================================

export async function rosterAddCommand(ids: string[], options: { json?: boolean } = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-roster-add').start(`Adding agents: ${ids.join(', ')}`, { cwd });

  let roster = loadRoster();
  if (!roster) {
    if (options.json) {
      out(JSON.stringify({ error: 'No roster found. Run `paradigm agent roster init` first.' }));
    } else {
      error('No roster found.');
      dim(`  Run ${chalk.cyan('paradigm agent roster init')} first.`);
    }
    tracker.error('No roster found');
    return;
  }

  const allAgents = getAllAgentIds();
  const invalid: string[] = [];
  const alreadyActive: string[] = [];
  const added: string[] = [];

  for (const id of ids) {
    if (!allAgents.includes(id)) {
      invalid.push(id);
      continue;
    }
    if (roster.active.includes(id)) {
      alreadyActive.push(id);
      continue;
    }
    roster.active.push(id);
    added.push(id);
  }

  if (added.length > 0) {
    roster.active.sort();
    saveRoster(roster);
  }

  if (options.json) {
    out(JSON.stringify({ added, alreadyActive, invalid, total: roster.active.length }, null, 2));
  } else {
    if (added.length > 0) {
      success(`Added: ${chalk.cyan(added.join(', '))}`);
    }
    if (alreadyActive.length > 0) {
      dim(`  Already active: ${alreadyActive.join(', ')}`);
    }
    if (invalid.length > 0) {
      error(`Unknown agent(s): ${invalid.join(', ')}`);
      dim(`  Available: ${allAgents.join(', ')}`);
    }
    if (added.length > 0) {
      out(`  Roster now has ${chalk.cyan(String(roster.active.length))} active agents.`);
    }
  }

  tracker.success(`Added ${added.length}, skipped ${alreadyActive.length}, invalid ${invalid.length}`);
}

// ============================================================================
// paradigm agent roster remove
// ============================================================================

export async function rosterRemoveCommand(ids: string[], options: { json?: boolean } = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-roster-remove').start(`Removing agents: ${ids.join(', ')}`, { cwd });

  let roster = loadRoster();
  if (!roster) {
    if (options.json) {
      out(JSON.stringify({ error: 'No roster found. Run `paradigm agent roster init` first.' }));
    } else {
      error('No roster found.');
      dim(`  Run ${chalk.cyan('paradigm agent roster init')} first.`);
    }
    tracker.error('No roster found');
    return;
  }

  const notFound: string[] = [];
  const removed: string[] = [];

  for (const id of ids) {
    const idx = roster.active.indexOf(id);
    if (idx < 0) {
      notFound.push(id);
      continue;
    }
    roster.active.splice(idx, 1);
    removed.push(id);
  }

  if (removed.length > 0) {
    saveRoster(roster);
  }

  if (options.json) {
    out(JSON.stringify({ removed, notFound, total: roster.active.length }, null, 2));
  } else {
    if (removed.length > 0) {
      success(`Removed: ${chalk.cyan(removed.join(', '))}`);
    }
    if (notFound.length > 0) {
      warn(`Not in roster: ${notFound.join(', ')}`);
    }
    if (removed.length > 0) {
      out(`  Roster now has ${chalk.cyan(String(roster.active.length))} active agents.`);
    }
  }

  tracker.success(`Removed ${removed.length}, not found ${notFound.length}`);
}
