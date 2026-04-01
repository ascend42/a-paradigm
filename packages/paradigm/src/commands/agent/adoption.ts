/**
 * Agent adoption records and ceremony rendering.
 *
 * Manages .paradigm/adoptions.yaml — the authoritative record of all adopted
 * agents (core, ecosystem, marketplace). Provides rendering for the adoption
 * ceremony UX during `paradigm shift` and `paradigm agents install`.
 *
 * See docs/specs/agent-adoption.md for full specification.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { log } from '../../utils/logger.js';
import type {
  AdoptionRecord,
  AdoptionsFile,
  ConfigurableOption,
  AgentScopes,
} from './scopes-types.js';

const ADOPTIONS_FILE = '.paradigm/adoptions.yaml';
const ROSTER_FILE = '.paradigm/roster.yaml';

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Load adoptions from .paradigm/adoptions.yaml.
 * Returns null if the file does not exist.
 */
export async function loadAdoptions(rootDir: string): Promise<AdoptionsFile | null> {
  const filePath = path.join(rootDir, ADOPTIONS_FILE);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    // Map kebab-case YAML keys to camelCase interface fields
    return {
      version: (data.version as string) || '1.0',
      adoptedAt: (data['adopted-at'] as string) || (data.adoptedAt as string) || '',
      projectType: (data['project-type'] as string) || (data.projectType as string) || '',
      agents: normalizeAgents(data.agents as Record<string, unknown> | undefined),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    log.component('adoption').warn('Failed to parse adoptions.yaml', {
      error: String(err),
    });
    return null;
  }
}

/**
 * Save adoptions to .paradigm/adoptions.yaml.
 */
export async function saveAdoptions(rootDir: string, adoptions: AdoptionsFile): Promise<void> {
  const filePath = path.join(rootDir, ADOPTIONS_FILE);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  // Convert camelCase fields to kebab-case for YAML output
  const output: Record<string, unknown> = {
    version: adoptions.version,
    'adopted-at': adoptions.adoptedAt,
    'project-type': adoptions.projectType,
    agents: denormalizeAgents(adoptions.agents),
  };

  const content = yaml.dump(output, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });

  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Add or update a single agent's adoption record.
 */
export async function addAdoption(
  rootDir: string,
  agentId: string,
  record: AdoptionRecord,
): Promise<void> {
  let adoptions = await loadAdoptions(rootDir);
  if (!adoptions) {
    adoptions = createDefaultAdoptionsFile('unknown');
  }

  adoptions.agents[agentId] = record;
  await saveAdoptions(rootDir, adoptions);

  log.component('adoption').debug('Added adoption record', { agentId, source: record.source });
}

/**
 * Remove an agent's adoption record.
 */
export async function removeAdoption(rootDir: string, agentId: string): Promise<void> {
  const adoptions = await loadAdoptions(rootDir);
  if (!adoptions) return;

  if (!(agentId in adoptions.agents)) {
    log.component('adoption').debug('Agent not in adoptions, nothing to remove', { agentId });
    return;
  }

  delete adoptions.agents[agentId];
  await saveAdoptions(rootDir, adoptions);

  log.component('adoption').debug('Removed adoption record', { agentId });
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Migrate existing roster.yaml into an AdoptionsFile.
 *
 * Reads the roster, generates adoption records for each rostered agent with
 * defaultsAccepted: true. Returns the new adoptions file but does NOT save —
 * the caller decides when and whether to persist.
 */
export async function migrateFromRoster(rootDir: string): Promise<AdoptionsFile> {
  const rosterPath = path.join(rootDir, ROSTER_FILE);
  const now = new Date().toISOString();

  let rosterData: { version?: string; active?: string[]; type?: string } = {
    active: [],
  };

  try {
    const content = await fs.readFile(rosterPath, 'utf-8');
    const parsed = yaml.load(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      rosterData = {
        version: parsed.version as string | undefined,
        active: (parsed.active as string[]) || [],
        type: parsed.type as string | undefined,
      };
    }
  } catch {
    log.component('adoption').debug('No roster.yaml found for migration');
  }

  const adoptions: AdoptionsFile = {
    version: '1.0',
    adoptedAt: now,
    projectType: rosterData.type || 'unknown',
    agents: {},
  };

  for (const agentId of rosterData.active || []) {
    adoptions.agents[agentId] = {
      adopted: now,
      source: 'core',
      defaultsAccepted: true,
    };
  }

  log.component('adoption').debug('Migrated roster to adoptions', {
    count: Object.keys(adoptions.agents).length,
  });

  return adoptions;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a fresh, empty adoptions file with version, timestamp, and project type.
 */
export function createDefaultAdoptionsFile(projectType: string): AdoptionsFile {
  return {
    version: '1.0',
    adoptedAt: new Date().toISOString(),
    projectType,
    agents: {},
  };
}

// ============================================================================
// Rendering — Adoption Card (marketplace install)
// ============================================================================

/**
 * Render a single agent's adoption card for terminal display.
 *
 * Used by `paradigm agents install` for marketplace agents. Shows the agent's
 * identity, scopes requested, and configurable options with defaults.
 */
export function renderAdoptionCard(agent: {
  id: string;
  nickname?: string;
  role: string;
  description?: string;
  scopes?: AgentScopes;
  configurable?: Record<string, ConfigurableOption>;
}): string {
  const lines: string[] = [];
  const divider = chalk.dim('\u2500'.repeat(49));

  // Header
  const displayName = agent.nickname
    ? `${agent.id} (${agent.nickname})`
    : agent.id;
  lines.push('');
  lines.push(`  ${chalk.bold(displayName)} ${chalk.dim('\u2014')} ${chalk.gray(agent.role)}`);
  lines.push(`  ${divider}`);

  // Description
  if (agent.description) {
    lines.push('');
    lines.push(`  ${chalk.italic(`"${agent.description}"`)}`);
  }

  // Scopes
  if (agent.scopes && agent.scopes.permissions.length > 0) {
    lines.push('');
    lines.push(`  ${chalk.bold('Scopes requested:')}`);
    for (const perm of agent.scopes.permissions) {
      const isDangerous = agent.scopes.dangerous?.includes(perm.id);
      const idStr = isDangerous
        ? chalk.yellow(perm.id.padEnd(24))
        : chalk.white(perm.id.padEnd(24));
      lines.push(`    ${idStr}${chalk.gray(perm.description)}`);
    }

    if (agent.scopes.dangerous && agent.scopes.dangerous.length > 0) {
      lines.push('');
      lines.push(
        `  ${chalk.yellow('!')} ${chalk.yellow('Dangerous scopes require runtime confirmation')}`,
      );
    }
  }

  // Configurable options
  if (agent.configurable && Object.keys(agent.configurable).length > 0) {
    lines.push('');
    lines.push(`  ${chalk.bold('Configurable:')}`);
    for (const [key, opt] of Object.entries(agent.configurable)) {
      const defaultStr = chalk.cyan(`[${String(opt.default)}]`);
      const valuesStr =
        opt.type === 'enum' && opt.values
          ? chalk.gray(`(${opt.values.join(', ')})`)
          : chalk.gray(opt.type);
      lines.push(`    ${key.padEnd(18)}${defaultStr.padEnd(25)}${valuesStr}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ============================================================================
// Rendering — Batch Summary (paradigm shift)
// ============================================================================

/**
 * Render the batch adoption summary shown during `paradigm shift`.
 *
 * Groups agents by source (core vs ecosystem) and displays in the compact
 * format specified by the adoption ceremony UX.
 */
export function renderBatchSummary(
  agents: Array<{
    id: string;
    nickname?: string;
    role: string;
    source: 'core' | 'ecosystem';
  }>,
  projectType: string,
): string {
  const lines: string[] = [];
  const divider = chalk.dim('\u2500'.repeat(49));

  const coreAgents = agents.filter((a) => a.source === 'core');
  const ecosystemAgents = agents.filter((a) => a.source === 'ecosystem');

  // Header
  lines.push('');
  lines.push(`  ${chalk.bold('Agent Adoption')}`);
  lines.push(`  ${divider}`);
  lines.push(`  ${chalk.dim('Detected:')} ${projectType}`);

  // Core team
  if (coreAgents.length > 0) {
    lines.push('');
    lines.push(`  ${chalk.bold(`Core team (${coreAgents.length}):`)}`);
    for (const agent of coreAgents) {
      const nameStr = agent.nickname
        ? `${agent.id} (${agent.nickname})`
        : agent.id;
      lines.push(
        `    ${chalk.white(nameStr.padEnd(22))}${chalk.gray(agent.role)}`,
      );
    }
  }

  // Ecosystem
  if (ecosystemAgents.length > 0) {
    lines.push('');
    lines.push(
      `  ${chalk.bold(`Ecosystem (${ecosystemAgents.length} detected):`)}`,
    );
    for (const agent of ecosystemAgents) {
      const nameStr = agent.nickname
        ? `${agent.id} (${agent.nickname})`
        : agent.id;
      lines.push(
        `    ${chalk.white(nameStr.padEnd(22))}${chalk.gray(agent.role)}`,
      );
    }
  }

  // Footer
  lines.push('');
  lines.push(`  ${chalk.dim('All using default scopes.')}`);
  lines.push(
    `  ${chalk.dim('[Enter]')} accept all  ${chalk.dim('|')}  ${chalk.dim('[r]')} review individually  ${chalk.dim('|')}  ${chalk.dim('[c]')} customize`,
  );
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Normalize agent records from YAML (kebab-case) to TypeScript (camelCase).
 */
function normalizeAgents(
  raw: Record<string, unknown> | undefined,
): Record<string, AdoptionRecord> {
  if (!raw || typeof raw !== 'object') return {};

  const result: Record<string, AdoptionRecord> = {};

  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;

    result[id] = {
      adopted: (v.adopted as string) || '',
      source: (v.source as AdoptionRecord['source']) || 'core',
      defaultsAccepted:
        v['defaults-accepted'] != null
          ? Boolean(v['defaults-accepted'])
          : v.defaultsAccepted != null
            ? Boolean(v.defaultsAccepted)
            : true,
      ...(v.version != null && { version: v.version as string }),
      ...(v.overrides != null && { overrides: v.overrides as Record<string, unknown> }),
      ...(v['scopes-approved'] != null && { scopesApproved: v['scopes-approved'] as string }),
      ...(v.scopesApproved != null && { scopesApproved: v.scopesApproved as string }),
      ...(v['detected-from'] != null && { detectedFrom: v['detected-from'] as string[] }),
      ...(v.detectedFrom != null && { detectedFrom: v.detectedFrom as string[] }),
    };
  }

  return result;
}

/**
 * Denormalize agent records from TypeScript (camelCase) to YAML (kebab-case).
 */
function denormalizeAgents(
  agents: Record<string, AdoptionRecord>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [id, record] of Object.entries(agents)) {
    const entry: Record<string, unknown> = {
      adopted: record.adopted,
      source: record.source,
      'defaults-accepted': record.defaultsAccepted,
    };

    if (record.version != null) entry.version = record.version;
    if (record.overrides != null) entry.overrides = record.overrides;
    if (record.scopesApproved != null) entry['scopes-approved'] = record.scopesApproved;
    if (record.detectedFrom != null) entry['detected-from'] = record.detectedFrom;

    result[id] = entry;
  }

  return result;
}
