/**
 * paradigm agent - Agent identity management commands
 *
 * Commands:
 *   paradigm agent list    — List all agent profiles
 *   paradigm agent show    — Show full agent profile
 *   paradigm agent create  — Create a new .agent file
 *   paradigm agent sync    — Bootstrap expertise from project lore
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import type { AgentListOptions, AgentShowOptions, AgentCreateOptions, AgentSyncOptions } from './types.js';

// ============================================================================
// Types (duplicated from paradigm-mcp to avoid cross-package import)
// ============================================================================

interface AgentPermissions {
  paths?: { read?: string[]; write?: string[]; deny?: string[] };
  tools?: { allow?: string[]; deny?: string[] };
  dangerous_actions?: string[];
}

interface AgentProfile {
  id: string;
  role: string;
  description: string;
  version: string;
  personality: { style: string; risk: string; verbosity: string };
  expertise: Array<{ symbol: string; confidence: number; sessions: number; lastTouch: string }>;
  transferable: Array<{ id: string; description: string; learnedIn: string; appliedIn: string[]; successRate: number }>;
  contexts: Record<string, { focus: string[]; defaultModel?: string; lastActive?: string; sessionsInProject?: number }>;
  created: string;
  updated: string;
  permissions?: AgentPermissions;
  integrityHash?: string;
}

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.paradigm', 'agents');
const PROJECT_AGENTS_DIR = '.paradigm/agents';
const AGENT_EXT = '.agent';

const DEFAULT_PERSONALITIES: Record<string, { style: string; risk: string; verbosity: string }> = {
  architect: { style: 'deliberate', risk: 'conservative', verbosity: 'detailed' },
  builder: { style: 'rapid', risk: 'balanced', verbosity: 'concise' },
  tester: { style: 'methodical', risk: 'conservative', verbosity: 'concise' },
  reviewer: { style: 'deliberate', risk: 'conservative', verbosity: 'detailed' },
  security: { style: 'methodical', risk: 'conservative', verbosity: 'detailed' },
};

// ============================================================================
// paradigm agent list
// ============================================================================

export async function agentListCommand(options: AgentListOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-list').start('Listing agent profiles', { cwd });

  const profiles: AgentProfile[] = [];

  // Load global
  if (!options.project && fs.existsSync(GLOBAL_AGENTS_DIR)) {
    try {
      const files = fs.readdirSync(GLOBAL_AGENTS_DIR).filter(f => f.endsWith(AGENT_EXT));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(GLOBAL_AGENTS_DIR, file), 'utf-8');
          const p = yaml.load(content) as AgentProfile;
          if (p?.id) profiles.push(p);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Load project
  const projectDir = path.join(cwd, PROJECT_AGENTS_DIR);
  if (!options.global && fs.existsSync(projectDir)) {
    try {
      const files = fs.readdirSync(projectDir).filter(f => f.endsWith(AGENT_EXT));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(projectDir, file), 'utf-8');
          const p = yaml.load(content) as AgentProfile;
          if (p?.id) {
            // Override global with same id
            const idx = profiles.findIndex(e => e.id === p.id);
            if (idx >= 0) profiles[idx] = p;
            else profiles.push(p);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  if (options.json) {
    console.log(JSON.stringify({ count: profiles.length, agents: profiles.map(summarize) }, null, 2));
    tracker.success(`Found ${profiles.length} agents`);
    return;
  }

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  paradigm agent list                              ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  Persistent agent identity profiles              ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  if (profiles.length === 0) {
    console.log(chalk.yellow('  No .agent profiles found.'));
    console.log(chalk.gray('  Create one: paradigm agent create <id> --global\n'));
    tracker.success('No agents found');
    return;
  }

  for (const p of profiles) {
    const expertise = (p.expertise || []).sort((a, b) => b.confidence - a.confidence);
    const topSymbols = expertise.slice(0, 3).map(e =>
      `${e.symbol} (${(e.confidence * 100).toFixed(0)}%)`
    ).join(', ') || chalk.gray('none yet');

    console.log(`  ${chalk.white.bold(p.id)} — ${chalk.gray(p.role)}`);
    console.log(`    Style: ${p.personality?.style || '?'} | Risk: ${p.personality?.risk || '?'} | Verbosity: ${p.personality?.verbosity || '?'}`);
    console.log(`    Top expertise: ${topSymbols}`);
    console.log(`    Projects: ${Object.keys(p.contexts || {}).join(', ') || chalk.gray('none')}`);
    console.log('');
  }

  tracker.success(`Listed ${profiles.length} agents`);
}

// ============================================================================
// paradigm agent show
// ============================================================================

export async function agentShowCommand(id: string, options: AgentShowOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-show').start(`Showing agent ${id}`, { cwd });

  const profile = loadProfile(cwd, id);

  if (!profile) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Agent "${id}" not found` }));
    } else {
      console.log(chalk.red(`\n  Agent "${id}" not found.`));
      console.log(chalk.gray(`  Create: paradigm agent create ${id} --global\n`));
    }
    tracker.error(`Agent ${id} not found`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(profile, null, 2));
    tracker.success(`Showed agent ${id}`);
    return;
  }

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold(`  Agent: ${id}`.padEnd(50)) + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  console.log(`  ${chalk.white.bold('Role:')} ${profile.role}`);
  console.log(`  ${chalk.white.bold('Description:')} ${profile.description}`);
  console.log(`  ${chalk.white.bold('Version:')} ${profile.version}`);
  console.log(`  ${chalk.white.bold('Created:')} ${profile.created}`);
  console.log(`  ${chalk.white.bold('Updated:')} ${profile.updated}`);
  console.log('');

  // Personality
  if (profile.personality) {
    const p = profile.personality;
    console.log(`  ${chalk.white.bold('Personality')}`);
    console.log(`    Style: ${p.style}  |  Risk: ${p.risk}  |  Verbosity: ${p.verbosity}`);
    console.log('');
  }

  // Expertise table
  const expertise = (profile.expertise || []).sort((a, b) => b.confidence - a.confidence);
  if (expertise.length > 0) {
    console.log(`  ${chalk.white.bold('Expertise')} (${expertise.length} symbols)`);
    console.log(`  ${'Symbol'.padEnd(30)} ${'Confidence'.padEnd(12)} ${'Sessions'.padEnd(10)} Last Touch`);
    console.log(`  ${'-'.repeat(70)}`);
    for (const e of expertise.slice(0, 20)) {
      const conf = `${(e.confidence * 100).toFixed(0)}%`.padEnd(12);
      const sessions = String(e.sessions).padEnd(10);
      const date = e.lastTouch ? e.lastTouch.split('T')[0] : '—';
      console.log(`  ${e.symbol.padEnd(30)} ${conf} ${sessions} ${date}`);
    }
    if (expertise.length > 20) {
      console.log(chalk.gray(`  ... and ${expertise.length - 20} more`));
    }
    console.log('');
  } else {
    console.log(chalk.gray('  No expertise recorded. Run `paradigm agent sync` to bootstrap from lore.\n'));
  }

  // Transferable patterns
  const patterns = profile.transferable || [];
  if (patterns.length > 0) {
    console.log(`  ${chalk.white.bold('Transferable Patterns')} (${patterns.length})`);
    for (const p of patterns) {
      console.log(`    ${p.id}: ${(p.successRate * 100).toFixed(0)}% success — ${p.description}`);
      console.log(chalk.gray(`      Learned in: ${p.learnedIn} | Applied in: ${p.appliedIn.join(', ') || 'none'}`));
    }
    console.log('');
  }

  // Project contexts
  const contexts = Object.entries(profile.contexts || {});
  if (contexts.length > 0) {
    console.log(`  ${chalk.white.bold('Project Contexts')} (${contexts.length})`);
    for (const [name, ctx] of contexts) {
      console.log(`    ${chalk.white(name)}: ${ctx.sessionsInProject || 0} sessions, last active ${ctx.lastActive?.split('T')[0] || '—'}`);
      if (ctx.defaultModel) console.log(`      Model: ${ctx.defaultModel}`);
      if (ctx.focus?.length) console.log(`      Focus: ${ctx.focus.join(', ')}`);
    }
    console.log('');
  }

  // Permissions
  const perms = profile.permissions;
  if (perms) {
    console.log(`  ${chalk.white.bold('Permissions')}`);
    if (perms.paths?.read?.length) console.log(`    Read: ${perms.paths.read.join(', ')}`);
    if (perms.paths?.write?.length) console.log(`    Write: ${perms.paths.write.join(', ')}`);
    if (perms.paths?.deny?.length) console.log(`    Deny: ${chalk.red(perms.paths.deny.join(', '))}`);
    if (perms.tools?.allow?.length) console.log(`    Tools allow: ${perms.tools.allow.join(', ')}`);
    if (perms.tools?.deny?.length) console.log(`    Tools deny: ${chalk.red(perms.tools.deny.join(', '))}`);
    if (perms.dangerous_actions?.length) console.log(`    Requires approval: ${perms.dangerous_actions.join(', ')}`);
    console.log('');
  }

  tracker.success(`Showed agent ${id}`);
}

// ============================================================================
// paradigm agent create
// ============================================================================

export async function agentCreateCommand(id: string, options: AgentCreateOptions = {}) {
  const cwd = process.cwd();
  const scope = options.global ? 'global' : 'project';
  const tracker = log.command('agent-create').start(`Creating agent ${id} (${scope})`, { cwd });

  const dir = scope === 'global' ? GLOBAL_AGENTS_DIR : path.join(cwd, PROJECT_AGENTS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${id}${AGENT_EXT}`);
  if (fs.existsSync(filePath)) {
    console.log(chalk.yellow(`\n  Agent "${id}" already exists at ${filePath}`));
    console.log(chalk.gray('  Use `paradigm agent show` to view.\n'));
    tracker.error('Agent already exists');
    return;
  }

  const now = new Date().toISOString();
  const personality = DEFAULT_PERSONALITIES[id] || { style: 'deliberate', risk: 'balanced', verbosity: 'concise' };

  const profile: AgentProfile = {
    id,
    role: options.role || `${id.charAt(0).toUpperCase() + id.slice(1)} agent`,
    description: options.description || `Persistent identity for the ${id} agent role`,
    version: '1.0.0',
    personality,
    expertise: [],
    transferable: [],
    contexts: {},
    created: now,
    updated: now,
  };

  // Handle --deny-paths
  if (options.denyPaths) {
    const denyPatterns = options.denyPaths.split(',').map(p => p.trim());
    profile.permissions = {
      paths: { deny: denyPatterns },
    };
  }

  const content = yaml.dump(profile, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(filePath, content, 'utf-8');

  console.log(chalk.green(`\n  ✓ Created agent "${id}" at ${filePath}`));
  console.log(chalk.gray(`  Run \`paradigm agent sync\` to bootstrap expertise from lore.\n`));

  tracker.success(`Created agent ${id}`);
}

// ============================================================================
// paradigm agent sync
// ============================================================================

export async function agentSyncCommand(id: string, options: AgentSyncOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('agent-sync').start(`Syncing expertise for ${id}`, { cwd });

  // Load lore entries
  const lorePath = path.join(cwd, '.paradigm', 'lore', 'entries');
  if (!fs.existsSync(lorePath)) {
    console.log(chalk.yellow('\n  No lore directory found. Nothing to sync from.\n'));
    tracker.error('No lore found');
    return;
  }

  // Load or create profile
  let profile = loadProfile(cwd, id);
  if (!profile) {
    if (options.dryRun) {
      console.log(chalk.yellow(`\n  Agent "${id}" not found. Would create with --no-dry-run.\n`));
      tracker.success('Dry run — would create');
      return;
    }
    // Auto-create
    const scope = fs.existsSync(path.join(GLOBAL_AGENTS_DIR, `${id}${AGENT_EXT}`)) ? 'global' : 'project';
    const dir = scope === 'global' ? GLOBAL_AGENTS_DIR : path.join(cwd, PROJECT_AGENTS_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const now = new Date().toISOString();
    const personality = DEFAULT_PERSONALITIES[id] || { style: 'deliberate', risk: 'balanced', verbosity: 'concise' };
    profile = {
      id, role: `${id.charAt(0).toUpperCase() + id.slice(1)} agent`,
      description: `Persistent identity for the ${id} agent role`,
      version: '1.0.0', personality, expertise: [], transferable: [], contexts: {},
      created: now, updated: now,
    };
  }

  // Scan lore entries
  const expertise = profile.expertise || [];
  let entriesProcessed = 0;
  const symbolsUpdated = new Set<string>();

  const loreEntries = scanLoreDir(lorePath);
  for (const entry of loreEntries) {
    if (!entry.symbols_touched || entry.symbols_touched.length === 0) continue;
    entriesProcessed++;

    for (const symbol of entry.symbols_touched) {
      symbolsUpdated.add(symbol);
      const existing = expertise.find(e => e.symbol === symbol);
      if (existing) {
        existing.sessions++;
        existing.lastTouch = entry.timestamp || existing.lastTouch;
        if (entry.confidence != null) {
          existing.confidence = 0.7 * existing.confidence + 0.3 * entry.confidence;
        }
      } else {
        expertise.push({
          symbol,
          confidence: entry.confidence ?? 0.5,
          sessions: 1,
          lastTouch: entry.timestamp || new Date().toISOString(),
        });
      }
    }
  }

  profile.expertise = expertise;

  if (options.json) {
    console.log(JSON.stringify({
      agentId: id,
      entriesProcessed,
      symbolsUpdated: symbolsUpdated.size,
      dryRun: !!options.dryRun,
      topExpertise: expertise.sort((a, b) => b.confidence - a.confidence).slice(0, 10),
    }, null, 2));
  } else {
    console.log(chalk.blue(`\n  Syncing expertise for "${id}" from ${entriesProcessed} lore entries...`));
    console.log(`  ${chalk.green('✓')} ${symbolsUpdated.size} symbols updated`);
    console.log(`  ${chalk.green('✓')} ${entriesProcessed} entries processed`);

    if (expertise.length > 0) {
      console.log(`\n  Top expertise:`);
      for (const e of expertise.sort((a, b) => b.confidence - a.confidence).slice(0, 5)) {
        console.log(`    ${e.symbol}: ${(e.confidence * 100).toFixed(0)}% (${e.sessions} sessions)`);
      }
    }
  }

  if (!options.dryRun) {
    profile.updated = new Date().toISOString();
    const projectPath = path.join(cwd, PROJECT_AGENTS_DIR, `${id}${AGENT_EXT}`);
    const globalPath = path.join(GLOBAL_AGENTS_DIR, `${id}${AGENT_EXT}`);
    const scope = fs.existsSync(projectPath) ? 'project' : 'global';
    const dir = scope === 'global' ? GLOBAL_AGENTS_DIR : path.join(cwd, PROJECT_AGENTS_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = scope === 'global' ? globalPath : projectPath;
    fs.writeFileSync(filePath, yaml.dump(profile, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf-8');

    if (!options.json) {
      console.log(chalk.green(`\n  ✓ Saved to ${filePath}\n`));
    }
  } else if (!options.json) {
    console.log(chalk.yellow('\n  Dry run — no changes written.\n'));
  }

  tracker.success(`Synced ${symbolsUpdated.size} symbols from ${entriesProcessed} entries`);
}

// ============================================================================
// Helpers
// ============================================================================

function loadProfile(rootDir: string, id: string): AgentProfile | null {
  const projectPath = path.join(rootDir, PROJECT_AGENTS_DIR, `${id}${AGENT_EXT}`);
  if (fs.existsSync(projectPath)) {
    try {
      return yaml.load(fs.readFileSync(projectPath, 'utf-8')) as AgentProfile;
    } catch { /* fall through */ }
  }

  const globalPath = path.join(GLOBAL_AGENTS_DIR, `${id}${AGENT_EXT}`);
  if (fs.existsSync(globalPath)) {
    try {
      return yaml.load(fs.readFileSync(globalPath, 'utf-8')) as AgentProfile;
    } catch { /* fall through */ }
  }

  return null;
}

function summarize(p: AgentProfile) {
  return {
    id: p.id,
    role: p.role,
    personality: p.personality,
    expertiseCount: (p.expertise || []).length,
    topExpertise: (p.expertise || []).sort((a, b) => b.confidence - a.confidence).slice(0, 3).map(e => ({
      symbol: e.symbol,
      confidence: parseFloat(e.confidence.toFixed(2)),
    })),
    projectContexts: Object.keys(p.contexts || {}),
    transferableCount: (p.transferable || []).length,
  };
}

interface LoreEntryMinimal {
  symbols_touched: string[];
  confidence?: number;
  timestamp: string;
}

function scanLoreDir(lorePath: string): LoreEntryMinimal[] {
  const entries: LoreEntryMinimal[] = [];

  try {
    // Look for date directories
    const items = fs.readdirSync(lorePath, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;

      const dayDir = path.join(lorePath, item.name);
      try {
        const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(dayDir, file), 'utf-8');
            const data = yaml.load(content) as Record<string, unknown>;
            if (data?.symbols_touched && Array.isArray(data.symbols_touched)) {
              entries.push({
                symbols_touched: data.symbols_touched as string[],
                confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
                timestamp: (data.timestamp as string) || item.name,
              });
            }
          } catch { /* skip invalid */ }
        }
      } catch { /* skip dir read error */ }
    }
  } catch { /* no lore */ }

  return entries;
}
