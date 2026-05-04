/**
 * paradigm shift - Single command to fully initialize/sync a project
 *
 * Combines: init → scan → sync (all IDEs) → doctor
 *
 * Usage:
 *   paradigm shift              # Full setup for new or existing project
 *   paradigm shift --verify     # Also run verification checks
 *   paradigm shift --quick      # Skip slow operations
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'js-yaml';
import { log } from '../utils/logger.js';
import { initCommand } from './init.js';
import { indexCommand } from './scan/index.js';
import { syncCommand } from './sync.js';
import { doctorCommand } from './doctor/index.js';
import { teamInitCommand } from './team/index.js';
import { agentsConfigured } from './team/loader.js';
import { hooksInstallCommand } from './hooks/index.js';
import { detectDiscipline } from '../core/discipline.js';
import { detectProjectRole } from './workspace/index.js';
import { detectProjectType, ROSTER_SUGGESTIONS } from '../core/project-type.js';
import { ensureGuaranteedFiles } from './shift-files.js';
import { getRecommendations, formatRecommendations } from './shift-recommendations.js';
import {
  loadAdoptions,
  saveAdoptions,
  migrateFromRoster,
  createDefaultAdoptionsFile,
  renderBatchSummary,
} from './agent/adoption.js';
import type { AdoptionsFile } from './agent/scopes-types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * The 8 core agent IDs present in every Paradigm project.
 * Agents in the roster but not in this set are classified as "ecosystem".
 */
const CORE_AGENT_IDS = new Set([
  'architect',
  'builder',
  'reviewer',
  'security',
  'advocate',
  'tester',
  'compliance',
  'documentor',
]);

/**
 * Fallback metadata for core agents when .agent profiles are unavailable.
 * Maps agent ID → { nickname, role }.
 */
const CORE_AGENT_META: Record<string, { nickname: string; role: string }> = {
  architect: { nickname: 'Apex', role: 'System design, specifications' },
  builder: { nickname: 'Kit', role: 'Implementation, tests' },
  reviewer: { nickname: 'Judge', role: 'Code quality, compliance' },
  security: { nickname: 'Aegis', role: 'Auth flows, vulnerability scanning' },
  advocate: { nickname: 'Jinx', role: 'Stress testing, edge cases' },
  tester: { nickname: 'Probe', role: 'Unit and integration tests' },
  compliance: { nickname: 'Rune', role: 'Symbol compliance enforcement' },
  documentor: { nickname: 'Scribe', role: '.purpose, portal.yaml maintenance' },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build the agent summaries array for renderBatchSummary from an AdoptionsFile.
 * Loads .agent profiles from ~/.paradigm/agents/ when available for nickname/role,
 * falls back to CORE_AGENT_META or generic values.
 */
function buildAgentSummaries(
  adoptions: AdoptionsFile,
): Array<{ id: string; nickname?: string; role: string; source: 'core' | 'ecosystem' }> {
  const summaries: Array<{ id: string; nickname?: string; role: string; source: 'core' | 'ecosystem' }> = [];
  const globalAgentsDir = path.join(os.homedir(), '.paradigm', 'agents');

  for (const [agentId, record] of Object.entries(adoptions.agents)) {
    let nickname: string | undefined;
    let role = agentId;

    // Try loading from .agent profile
    const agentFile = path.join(globalAgentsDir, `${agentId}.agent`);
    if (fs.existsSync(agentFile)) {
      try {
        const content = fs.readFileSync(agentFile, 'utf8');
        const profile = yaml.load(content) as { nickname?: string; role?: string };
        if (profile?.nickname) nickname = profile.nickname;
        if (profile?.role) role = profile.role;
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback to known core agent metadata
    if (!nickname && CORE_AGENT_META[agentId]) {
      nickname = CORE_AGENT_META[agentId].nickname;
      role = CORE_AGENT_META[agentId].role;
    }

    const source: 'core' | 'ecosystem' =
      record.source === 'core' || record.source === 'ecosystem'
        ? record.source
        : CORE_AGENT_IDS.has(agentId)
          ? 'core'
          : 'ecosystem';

    summaries.push({ id: agentId, nickname, role, source });
  }

  return summaries;
}

/**
 * v6.0.4 — Step 2c-nominate-compliance.
 *
 * For existing-project upgrades that match cohort C (project defines
 * `~aspects` in any `.purpose` file but the `compliance` archetype is NOT
 * on the roster), prompt the user to add Rune (compliance) to the roster.
 * Without a claimant, paradigm 6.0.4 no longer enforces aspect coverage —
 * this nomination step is the recovery path.
 *
 * No-ops silently when:
 * - Predicate fails (cohort A or B)
 * - `.compliance-nomination-skipped` marker exists and not `--force`
 * - Non-TTY environment, or `--no-prompt` set (commander `prompt === false`)
 *
 * On Y: append `compliance` to roster.active, write authority.yaml defaults.
 * On N: write skip marker so we never re-prompt (clear with `--force`).
 *
 * Symbol: #compliance-nomination-step
 */
export async function runComplianceNominationStep(
  cwd: string,
  rosterPath: string,
  options: ShiftOptions,
): Promise<void> {
  // Predicate 1: roster.yaml must exist (existing-project upgrade case)
  if (!fs.existsSync(rosterPath)) return;

  // Predicate 2: roster.active must NOT include 'compliance'
  let rosterData: { active?: string[] } & Record<string, unknown>;
  try {
    rosterData = (yaml.load(fs.readFileSync(rosterPath, 'utf8')) as
      | ({ active?: string[] } & Record<string, unknown>)
      | null) ?? { active: [] };
  } catch {
    return;
  }
  const active = Array.isArray(rosterData.active) ? rosterData.active : [];
  if (active.includes('compliance')) return;

  // Predicate 3: at least one .purpose file with an aspect declaration.
  // Reuse the cohort-C predicate from migration-notices to avoid duplicating
  // the .purpose walk. isCohortC also checks roster, but we've already
  // confirmed compliance is absent so it reduces to the aspects-defined check.
  const { isCohortC } = await import('../core/migration-notices.js');
  if (!isCohortC(cwd)) return;

  // Skip-marker handling. `--force` clears the marker upstream (lines 374-386)
  // so the prompt re-fires; here we only need to honor the marker if present.
  const skipMarker = path.join(cwd, '.paradigm', '.compliance-nomination-skipped');
  if (fs.existsSync(skipMarker) && !options.force) return;

  // Non-TTY / --no-prompt: skip silently, write marker so subsequent runs
  // do not keep re-checking. Never auto-Y in CI.
  // commander maps `--no-prompt` to `options.prompt === false`.
  if (!process.stdin.isTTY || options.prompt === false) {
    try {
      fs.writeFileSync(skipMarker, '', 'utf8');
    } catch {
      // best effort
    }
    return;
  }

  // Interactive prompt — copy is verbatim from v6.0.4 plan §6.
  console.log('');
  console.log(chalk.cyan('Step 2c-nominate/6: Symbol enforcement'));
  console.log('');
  console.log('  This project defines ~aspects but no compliance-archetype agent');
  console.log('  (Rune) is on the roster.');
  console.log('');
  console.log('  Without a claimant, paradigm 6.0.4 no longer enforces aspect');
  console.log('  coverage. You can:');
  console.log('');
  console.log(`    ${chalk.green('[Y]')} Add Rune (compliance) to the roster — recommended`);
  console.log('        Authority defaults will be written to .paradigm/authority.yaml.');
  console.log('        Default mode: advise (Rune surfaces findings, never blocks).');
  console.log('');
  console.log(`    ${chalk.yellow('[N]')} Skip — opt out of aspect enforcement for this project`);
  console.log('        This decision is remembered. Re-run with --force to revisit.');
  console.log('');

  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer = '';
  try {
    answer = (await rl.question('  Add Rune to roster? [Y/n]: ')).trim().toLowerCase();
  } catch {
    answer = '';
  } finally {
    rl.close();
  }

  // Default key Y — Enter (empty) accepts.
  const accepted = answer === '' || answer === 'y' || answer === 'yes';

  if (accepted) {
    // Append 'compliance' to roster.active and rewrite roster.yaml.
    rosterData.active = [...active, 'compliance'].sort();
    try {
      fs.writeFileSync(
        rosterPath,
        yaml.dump(rosterData, { lineWidth: -1, noRefs: true }),
        'utf8',
      );
      console.log(chalk.green('  ✓ Rune (compliance) added to roster'));
    } catch (e) {
      log.operation('shift').debug('Roster update failed', { error: (e as Error).message });
      return;
    }

    // Write archetype-default authority.yaml claims (idempotent).
    try {
      const { writeArchetypeDefaults } = await import('../core/authority.js');
      await writeArchetypeDefaults(cwd, 'archetype-default');
      console.log(chalk.gray('  ✓ Authority defaults written to .paradigm/authority.yaml'));
    } catch (e) {
      log.operation('shift').debug('Authority defaults write failed', {
        error: (e as Error).message,
      });
    }

    // If a skip marker existed (e.g., user ran --force after previous N),
    // clear it now that they have opted in.
    if (fs.existsSync(skipMarker)) {
      try {
        fs.unlinkSync(skipMarker);
      } catch {
        // best effort
      }
    }
  } else {
    // N — write skip marker so we never re-prompt without --force.
    try {
      fs.writeFileSync(skipMarker, '', 'utf8');
    } catch {
      // best effort
    }
    console.log(chalk.gray('  Skipped — opt out of aspect enforcement for this project'));
  }
}

// ============================================================================
// Main
// ============================================================================

export interface ShiftOptions {
  force?: boolean;
  quick?: boolean;
  verify?: boolean;
  ide?: string;
  /** Force model configuration prompts during team init */
  configureModels?: boolean;
  /** Create or join a multi-project workspace with this name */
  workspace?: string;
  /** Custom workspace file location (default: ../.paradigm-workspace) */
  workspacePath?: string;
  /** Explicit stack preset (e.g., 'nextjs', 'fastapi', 'swift-ios') */
  stack?: string;
  /**
   * v6.0.4 — when false (set by `--no-prompt`), skip interactive prompts
   * (e.g., Step 2c-nominate-compliance) silently. Defaults to true.
   */
  prompt?: boolean;
}

export async function shiftCommand(options: ShiftOptions = {}) {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const paradigmDir = path.join(cwd, '.paradigm');
  const isInitialized = fs.existsSync(paradigmDir) && fs.statSync(paradigmDir).isDirectory();

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  paradigm shift                                 ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  Full project setup in one command              ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  console.log(chalk.white(`  📁 Project: ${chalk.cyan(projectName)}`));
  console.log(chalk.white(`  📍 Status: ${isInitialized ? chalk.green('Paradigm detected') : chalk.yellow('New project')}`));
  console.log('');

  const tracker = log.command('shift').start('Running paradigm shift', { project: projectName });

  // Step 1: Init (if needed)
  const spinner = ora();

  if (!isInitialized || options.force) {
    spinner.start('Step 1/6: Initializing Paradigm...');
    try {
      await initCommand({
        force: options.force,
        quick: true, // We'll scan separately for better UX
        name: projectName,
        stack: options.stack,
      });
      spinner.succeed(chalk.green('Paradigm initialized'));
    } catch (error) {
      spinner.fail(chalk.red(`Init failed: ${(error as Error).message}`));
      tracker.error('Shift failed at init', { error: (error as Error).message });
      return;
    }
  } else {
    spinner.succeed(chalk.gray('Step 1/6: Already initialized (use --force to reinit)'));

    // If already initialized, check if discipline is still 'auto' and offer to set it
    const configPath = path.join(paradigmDir, 'config.yaml');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent) as Record<string, unknown>;
        if (!config.discipline || config.discipline === 'auto') {
          const detected = detectDiscipline(cwd);
          if (detected !== 'backend') {
            // Update config.yaml with detected discipline
            const updated = configContent.replace(
              /^discipline:\s*auto\b.*$/m,
              `discipline: ${detected}`
            );
            if (updated !== configContent) {
              fs.writeFileSync(configPath, updated, 'utf8');
              console.log(chalk.green(`  ✓ Detected discipline: ${chalk.cyan(detected)} (updated config.yaml)`));
            }
          } else if (!config.discipline) {
            // No discipline field at all — add it after the project line
            const withDiscipline = configContent.replace(
              /^(project:\s*.+)$/m,
              `$1\ndiscipline: ${detected}`
            );
            if (withDiscipline !== configContent) {
              fs.writeFileSync(configPath, withDiscipline, 'utf8');
              console.log(chalk.green(`  ✓ Added discipline: ${chalk.cyan(detected)} to config.yaml`));
            }
          }
        }
      } catch (e) {
        log.operation('shift').debug('Discipline detection failed', { error: (e as Error).message });
      }
    }
  }

  // Step 1b: Auto-migrate (bring existing projects up to date)
  if (isInitialized) {
    spinner.start('Step 1b/6: Checking for migrations...');
    try {
      const { migrateCommand } = await import('./migrate/index.js');
      await migrateCommand({ apply: true, quiet: true, noSync: true });
      spinner.succeed(chalk.green('Migrations applied'));
    } catch (error) {
      spinner.warn(chalk.yellow(`Migration warning: ${(error as Error).message}`));
    }
  }

  // Workspace: create-or-join (--workspace flag) or auto-detect
  {
    const configPath = path.join(paradigmDir, 'config.yaml');
    if (options.workspace && fs.existsSync(configPath)) {
      // --workspace flag provided: create-or-join
      const wsFilePath = options.workspacePath
        ? path.resolve(cwd, options.workspacePath)
        : path.join(path.dirname(cwd), '.paradigm-workspace');

      if (fs.existsSync(wsFilePath)) {
        // JOIN: load existing workspace, add self if not already a member
        try {
          const wsConfig = yaml.load(fs.readFileSync(wsFilePath, 'utf8')) as {
            version: string;
            name: string;
            members: Array<{ name: string; path: string; role?: string }>;
          };
          const currentName = path.basename(cwd);
          const wsDir = path.dirname(wsFilePath);
          const relPath = './' + path.relative(wsDir, cwd);
          const alreadyMember = wsConfig.members.some(
            (m) => path.resolve(wsDir, m.path) === cwd
          );

          if (!alreadyMember) {
            const role = detectProjectRole(currentName, cwd);
            wsConfig.members.push({
              name: currentName,
              path: relPath,
              ...(role && { role }),
            });
            fs.writeFileSync(
              wsFilePath,
              yaml.dump(wsConfig, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false, quotingType: '"' }),
              'utf8'
            );
            console.log(chalk.green(`  ✓ Joined workspace: ${chalk.cyan(wsConfig.name)} (added as member)`));
          } else {
            console.log(chalk.green(`  ✓ Already a member of workspace: ${chalk.cyan(wsConfig.name)}`));
          }
        } catch (e) {
          console.log(chalk.yellow(`  ⚠ Failed to join workspace: ${(e as Error).message}`));
        }
      } else {
        // CREATE: new workspace file with self as first member
        try {
          const currentName = path.basename(cwd);
          const wsDir = path.dirname(wsFilePath);
          const relPath = './' + path.relative(wsDir, cwd);
          const role = detectProjectRole(currentName, cwd);
          const wsConfig = {
            version: '1.0',
            name: options.workspace,
            members: [{ name: currentName, path: relPath, ...(role && { role }) }],
          };
          fs.mkdirSync(path.dirname(wsFilePath), { recursive: true });
          fs.writeFileSync(
            wsFilePath,
            yaml.dump(wsConfig, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false, quotingType: '"' }),
            'utf8'
          );
          console.log(chalk.green(`  ✓ Created workspace: ${chalk.cyan(options.workspace)} at ${chalk.gray(path.relative(cwd, wsFilePath))}`));
        } catch (e) {
          console.log(chalk.yellow(`  ⚠ Failed to create workspace: ${(e as Error).message}`));
        }
      }

      // Update local config.yaml with workspace field
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent) as Record<string, unknown>;
        const relWsPath = path.relative(cwd, wsFilePath);
        if (config.workspace !== relWsPath) {
          if (config.workspace) {
            // Replace existing workspace field
            const updated = configContent.replace(
              /^workspace:\s*.*$/m,
              `workspace: "${relWsPath}"`
            );
            fs.writeFileSync(configPath, updated, 'utf8');
          } else {
            // Append workspace field
            const updated = configContent.trimEnd() + `\nworkspace: "${relWsPath}"\n`;
            fs.writeFileSync(configPath, updated, 'utf8');
          }
          console.log(chalk.green(`  ✓ Linked workspace in config.yaml`));
        }
      } catch (e) {
        log.operation('shift').debug('Workspace config link failed', { error: (e as Error).message });
      }
    } else if (fs.existsSync(configPath)) {
      // No --workspace flag: existing auto-detect behavior
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent) as Record<string, unknown>;
        if (!config.workspace) {
          // Search parent directories for .paradigm-workspace
          let searchDir = path.dirname(cwd);
          for (let i = 0; i < 3; i++) {
            const wsCandidate = path.join(searchDir, '.paradigm-workspace');
            if (fs.existsSync(wsCandidate)) {
              const relPath = path.relative(cwd, wsCandidate);
              // Add workspace field to config.yaml
              const updated = configContent.trimEnd() + `\nworkspace: "${relPath}"\n`;
              fs.writeFileSync(configPath, updated, 'utf8');
              console.log(chalk.green(`  ✓ Found workspace: ${chalk.cyan(relPath)} (added to config.yaml)`));
              break;
            }
            const parent = path.dirname(searchDir);
            if (parent === searchDir) break;
            searchDir = parent;
          }
        }
      } catch (e) {
        log.operation('shift').debug('Workspace auto-detect failed', { error: (e as Error).message });
      }
    }
  }

  // Step 2: Team init (if needed)
  // Auto-default models based on environment detection. Interactive prompts only if --configure-models is passed.
  const teamConfigured = agentsConfigured(cwd);
  if (!teamConfigured || options.force) {
    console.log(chalk.cyan('  Step 2/6: Initializing team configuration...'));
    try {
      await teamInitCommand(cwd, {
        force: options.force,
        json: false,
        configureModels: options.configureModels || false,
        noConfigureModels: !options.configureModels,
      });
      console.log(chalk.green('  ✓ Team configuration initialized\n'));
    } catch (error) {
      console.log(chalk.yellow(`  ⚠ Team init warning: ${(error as Error).message}\n`));
    }
  } else {
    spinner.succeed(chalk.gray('Step 2/6: Team already configured (use --force to reinit)'));
  }

  // v6.0.4 — `--force` clears the compliance-nomination skip marker so the
  // Step 2c-nominate-compliance prompt re-fires. Mirrors existing
  // re-initialization convention (lines 164, 352).
  if (options.force) {
    const skipMarker = path.join(cwd, '.paradigm', '.compliance-nomination-skipped');
    if (fs.existsSync(skipMarker)) {
      try {
        fs.unlinkSync(skipMarker);
      } catch {
        // best effort
      }
    }
  }

  // Step 2c: Agent roster setup
  const rosterPath = path.join(cwd, '.paradigm', 'roster.yaml');
  if (!fs.existsSync(rosterPath) || options.force) {
    try {
      const projectType = detectProjectType(cwd);
      const suggested = ROSTER_SUGGESTIONS[projectType] || ROSTER_SUGGESTIONS['generic'];
      const rosterData = { version: '1.0', project: projectName, type: projectType, active: suggested.sort() };
      fs.writeFileSync(rosterPath, yaml.dump(rosterData, { lineWidth: -1, noRefs: true }), 'utf8');
      console.log(chalk.green(`  ✓ Agent roster set: ${chalk.cyan(suggested.length)} agents for ${chalk.cyan(projectType)}`));
    } catch (e) {
      log.operation('shift').debug('Roster setup failed', { error: (e as Error).message });
    }
  } else {
    try {
      const existing = yaml.load(fs.readFileSync(rosterPath, 'utf8')) as { active?: string[] };
      const count = existing?.active?.length ?? 0;
      console.log(chalk.gray(`  ✓ Agent roster exists (${count} agents active)`));
    } catch {
      console.log(chalk.gray('  ✓ Agent roster exists'));
    }
  }

  // v6.0.4 — Step 2c-nominate-compliance.
  // For existing-project upgrades where the project defines ~aspects but the
  // compliance archetype (Rune) is NOT on the roster, prompt to add him.
  // Without a claimant, paradigm 6.0.4 no longer enforces aspect coverage.
  // Predicate matches the cohort-C definition in migration-notices.ts.
  await runComplianceNominationStep(cwd, rosterPath, options);

  // Step 2c-adopt: Adoption ceremony
  {
    const adoptionsPath = path.join(cwd, '.paradigm', 'adoptions.yaml');
    const adoptionsExist = fs.existsSync(adoptionsPath);

    try {
      const projectType = detectProjectType(cwd);
      let adoptions = adoptionsExist ? await loadAdoptions(cwd) : null;

      // Treat an existing file with no agents the same as no file
      const hasAgents = adoptions && Object.keys(adoptions.agents).length > 0;

      if (!hasAgents && fs.existsSync(rosterPath)) {
        // Roster exists without adoptions (or with empty adoptions) — migrate
        adoptions = await migrateFromRoster(cwd);
        await saveAdoptions(cwd, adoptions);
        log.operation('shift').debug('Migrated roster to adoptions', {
          count: Object.keys(adoptions.agents).length,
        });
      } else if (!hasAgents) {
        // Fresh project with no roster yet — create default adoptions
        // from the roster we just wrote above (if it exists)
        adoptions = createDefaultAdoptionsFile(projectType);
        const rosterContent = fs.existsSync(rosterPath)
          ? yaml.load(fs.readFileSync(rosterPath, 'utf8')) as { active?: string[] }
          : { active: [] };

        const now = new Date().toISOString();
        for (const agentId of rosterContent.active || []) {
          adoptions.agents[agentId] = {
            adopted: now,
            source: CORE_AGENT_IDS.has(agentId) ? 'core' : 'ecosystem',
            defaultsAccepted: true,
          };
        }
        if (Object.keys(adoptions.agents).length > 0) {
          await saveAdoptions(cwd, adoptions);
        }
      }

      // Render the batch summary
      if (adoptions && Object.keys(adoptions.agents).length > 0) {
        const agentSummaries = buildAgentSummaries(adoptions);
        const summary = renderBatchSummary(agentSummaries, projectType);
        console.log(summary);
        console.log(chalk.green(`  ✓ ${Object.keys(adoptions.agents).length} agents adopted`));
      }

      // v6.0.4 — when the compliance archetype was adopted in this run AND
      // .paradigm/authority.yaml does not yet exist, write the
      // archetype-default claims so v6.1's authority MCP tools have a
      // consistent shape to read. Idempotent: writeArchetypeDefaults no-ops
      // when the file already exists.
      if (adoptions && adoptions.agents['compliance']) {
        const authorityPath = path.join(cwd, '.paradigm', 'authority.yaml');
        if (!fs.existsSync(authorityPath)) {
          try {
            const { writeArchetypeDefaults } = await import('../core/authority.js');
            await writeArchetypeDefaults(cwd, 'archetype-default');
            log.operation('shift').debug('Wrote archetype-default authority.yaml', {
              source: 'default-adoption',
            });
          } catch (e) {
            log.operation('shift').debug('Authority defaults write failed', {
              error: (e as Error).message,
            });
          }
        }
      }
    } catch (e) {
      log.operation('shift').debug('Adoption ceremony failed', { error: (e as Error).message });
    }
  }

  // Step 2d: Model tier configuration
  {
    const configForTiers = path.join(paradigmDir, 'config.yaml');
    if (fs.existsSync(configForTiers)) {
      try {
        const configContent = fs.readFileSync(configForTiers, 'utf8');
        const config = yaml.load(configContent) as Record<string, unknown>;
        if (!config['model-resolution'] || options.force) {
          // Auto-configure based on environment detection
          const { ModelDiscovery } = await import('../core/model-discovery.js');
          const discovery = new ModelDiscovery(cwd);
          const env = discovery.detectEnvironment();

          let tierMap: Record<string, string>;
          if (env === 'claude-code') {
            tierMap = { 'tier-1': 'opus', 'tier-2': 'sonnet', 'tier-3': 'haiku' };
          } else if (env === 'cursor') {
            tierMap = { 'tier-1': 'sonnet', 'tier-2': 'sonnet', 'tier-3': 'haiku' };
          } else {
            tierMap = { 'tier-1': 'sonnet', 'tier-2': 'sonnet', 'tier-3': 'sonnet' };
          }

          config['model-resolution'] = tierMap;
          fs.writeFileSync(configForTiers, yaml.dump(config, { lineWidth: -1, noRefs: true }), 'utf8');
          console.log(chalk.green(`  ✓ Model tiers configured for ${chalk.cyan(env)}: tier-1=${tierMap['tier-1']}, tier-2=${tierMap['tier-2']}, tier-3=${tierMap['tier-3']}`));
        }
      } catch (e) {
        log.operation('shift').debug('Model tier config failed', { error: (e as Error).message });
      }
    }
  }

  // Step 2e: Enforcement defaults
  {
    try {
      const { ensureEnforcementDefaults } = await import('../core/enforcement/index.js');
      const wrote = ensureEnforcementDefaults(cwd);
      if (wrote) {
        console.log(chalk.green(`  ✓ Enforcement config initialized (${chalk.cyan('none')} preset)`));
        console.log(chalk.dim('  Enforcement: none — symbol tracking available when you\'re ready. Rune will guide you.'));
      }
    } catch (e) {
      log.operation('shift').debug('Enforcement config setup failed', { error: (e as Error).message });
    }
  }

  // Step 2f: Guaranteed files
  {
    spinner.start('Ensuring core files...');
    try {
      const { created, existed } = await ensureGuaranteedFiles(cwd);
      spinner.succeed(chalk.green(`Core files ensured: ${chalk.cyan(String(created.length))} created, ${chalk.cyan(String(existed.length))} already existed`));
    } catch (e) {
      spinner.warn(chalk.yellow(`Guaranteed files warning: ${(e as Error).message}`));
    }
  }

  // Step 3: Scan/Index
  if (!options.quick) {
    spinner.start('Step 3/6: Scanning and indexing symbols...');
    try {
      await indexCommand(cwd, { quiet: true });
      spinner.succeed(chalk.green('Symbols indexed'));
    } catch (error) {
      spinner.warn(chalk.yellow(`Scan warning: ${(error as Error).message}`));
      // Don't fail - scan is optional
    }
  } else {
    spinner.succeed(chalk.gray('Step 3/6: Skipped scan (--quick mode)'));
  }

  // Step 3b: Workspace reindex (if workspace configured)
  {
    const configPath = path.join(paradigmDir, 'config.yaml');
    if (fs.existsSync(configPath)) {
      try {
        const configForWs = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        if (configForWs.workspace) {
          spinner.start('Step 3b/6: Reindexing workspace members...');
          try {
            const { workspaceReindexCommand } = await import('./workspace/index.js');
            await workspaceReindexCommand({ quiet: true });
            spinner.succeed(chalk.green('Workspace members reindexed'));
          } catch (e) {
            spinner.warn(chalk.yellow(`Workspace reindex: ${(e as Error).message}`));
          }
        }
      } catch (e) {
        log.operation('shift').debug('Workspace config read failed', { error: (e as Error).message });
      }
    }
  }

  // Ensure portal.yaml exists (empty but valid — prevents doctor failures on first run)
  const portalPath = path.join(cwd, 'portal.yaml');
  if (!fs.existsSync(portalPath)) {
    const defaultPortal = { version: '1.0.0', gates: {}, routes: {} };
    fs.writeFileSync(portalPath, yaml.dump(defaultPortal, { lineWidth: -1, noRefs: true }), 'utf8');
  }

  // Ensure .paradigm/lore/ directory exists
  const lorePath = path.join(cwd, '.paradigm', 'lore');
  if (!fs.existsSync(lorePath)) {
    fs.mkdirSync(lorePath, { recursive: true });
  }

  // Ensure .paradigm/university/ directory structure exists
  const uniBase = path.join(cwd, '.paradigm', 'university');
  for (const subdir of ['content/notes', 'content/policies', 'content/quizzes', 'content/paths', 'diplomas']) {
    const dirPath = path.join(uniBase, subdir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  // Write default university config if missing
  const uniConfigPath = path.join(uniBase, 'config.yaml');
  if (!fs.existsSync(uniConfigPath)) {
    let projectName = 'Project';
    try {
      const configPath = path.join(cwd, '.paradigm', 'config.yaml');
      if (fs.existsSync(configPath)) {
        const configData = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        if (configData.project && typeof configData.project === 'string') {
          projectName = configData.project;
        }
      }
    } catch { /* skip */ }

    const uniConfig = {
      branding: {
        name: `${projectName} University`,
        tagline: `Learn the ${projectName} codebase`,
        institution: projectName,
      },
      theme: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        accent: '#f59e0b',
        background: '#0f172a',
        surface: '#1e293b',
        text: '#f8fafc',
        textMuted: '#94a3b8',
        success: '#22c55e',
        error: '#ef4444',
        font: 'Inter, system-ui, sans-serif',
      },
      content: {
        categories: [],
        defaultDifficulty: 'beginner',
        requireApproval: false,
      },
      diplomas: {
        includeGlobalPLSAT: true,
      },
    };
    fs.writeFileSync(uniConfigPath, yaml.dump(uniConfig, { lineWidth: -1, noRefs: true }), 'utf8');
  }

  // Step 4: Sync all IDEs
  // Always generate both CLAUDE.md and .cursor/rules/ since users often have multiple AI tools
  spinner.start('Step 4/6: Syncing IDE configurations...');
  try {
    const ideTargets = options.ide ? [options.ide] : ['claude', 'cursor', 'copilot', 'windsurf', 'agents'];
    const syncResults: string[] = [];

    for (const ide of ideTargets) {
      try {
        await syncCommand(ide, { quiet: true, force: true });
        syncResults.push(ide);
      } catch (e) {
        // Some IDEs may not be configured, that's fine
      }
    }

    if (syncResults.length > 0) {
      spinner.succeed(chalk.green(`IDE configs synced: ${syncResults.join(', ')}`));
    } else {
      spinner.warn(chalk.yellow('No IDE configs to sync'));
    }
  } catch (error) {
    spinner.warn(chalk.yellow(`Sync warning: ${(error as Error).message}`));
  }

  // Step 5: Install hooks (git + Claude Code)
  spinner.start('Step 5/6: Installing hooks...');
  try {
    await hooksInstallCommand({ force: options.force });
    spinner.succeed(chalk.green('Hooks installed (git + Claude Code + Cursor)'));
  } catch (error) {
    spinner.warn(chalk.yellow(`Hooks warning: ${(error as Error).message}`));
  }

  // Step 6: Doctor (verify)
  if (options.verify) {
    spinner.start('Step 6/6: Running health checks...');
    try {
      const healthy = await doctorCommand({ quiet: true });
      if (healthy) {
        spinner.succeed(chalk.green('All health checks passed'));
      } else {
        spinner.warn(chalk.yellow('Some health checks need attention'));
      }
    } catch (error) {
      spinner.warn(chalk.yellow(`Doctor warning: ${(error as Error).message}`));
    }
  } else {
    spinner.succeed(chalk.gray('Step 6/6: Skipped verify (use --verify to check health)'));
  }

  // Summary
  console.log('');
  console.log(chalk.blue('┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  ✨ Paradigm shift complete!                    ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘'));
  console.log('');

  // Show what was created/updated
  console.log(chalk.white('  Created/Updated:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));

  const files = [
    { path: '.paradigm/config.yaml', desc: 'Project configuration' },
    { path: '.paradigm/navigator.yaml', desc: 'Symbol navigation map' },
    { path: '.paradigm/agents.yaml', desc: 'Team agent configuration' },
    { path: '.paradigm/adoptions.yaml', desc: 'Agent adoption records' },
    { path: '.purpose', desc: 'Root feature definitions' },
    { path: '.paradigm/lore/', desc: 'Project lore timeline', isDir: true },
    { path: 'portal.yaml', desc: 'Authorization gates' },
    { path: '.paradigm/roster.yaml', desc: 'Agent roster for this project' },
    { path: 'CLAUDE.md', desc: 'Claude Code AI instructions' },
    { path: 'AGENTS.md', desc: 'Universal AI agent instructions' },
    { path: '.cursor/rules/', desc: 'Cursor AI instructions', isDir: true },
    { path: '.claude/hooks/', desc: 'Claude Code enforcement hooks', isDir: true, optional: true },
    { path: '.cursor/hooks/', desc: 'Cursor enforcement hooks', isDir: true, optional: true },
  ];

  // Add workspace file if it was configured
  const configPathForSummary = path.join(paradigmDir, 'config.yaml');
  if (fs.existsSync(configPathForSummary)) {
    try {
      const cfg = yaml.load(fs.readFileSync(configPathForSummary, 'utf8')) as Record<string, unknown>;
      if (typeof cfg.workspace === 'string') {
        const wsAbsPath = path.resolve(cwd, cfg.workspace);
        const wsRelPath = path.relative(cwd, wsAbsPath);
        files.push({ path: wsRelPath, desc: 'Multi-project workspace', optional: true });
      }
    } catch (e) {
      log.operation('shift').debug('Summary config read failed', { error: (e as Error).message });
    }
  }

  for (const file of files) {
    const fullPath = path.join(cwd, file.path);
    if (fs.existsSync(fullPath)) {
      console.log(chalk.green('  ✓ ') + chalk.white(file.path.padEnd(28)) + chalk.gray(file.desc));
    } else if (!file.optional) {
      console.log(chalk.yellow('  ○ ') + chalk.gray(file.path.padEnd(28)) + chalk.gray(`(${file.desc})`));
    }
  }

  // Post-shift recommendations
  try {
    const recs = await getRecommendations(cwd);
    const recsOutput = formatRecommendations(recs);
    if (recsOutput) {
      console.log(recsOutput);
    }
  } catch (e) {
    log.operation('shift').debug('Recommendations engine failed', { error: (e as Error).message });
    // Fallback: show minimal next steps if recommendations engine fails
    console.log('');
    console.log(chalk.white('  Next steps:'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(49)));
    console.log(chalk.white('  1. ') + chalk.gray('Edit ') + chalk.cyan('.purpose') + chalk.gray(' to define your features'));
    console.log(chalk.white('  2. ') + chalk.gray('Run ') + chalk.cyan('paradigm shift --verify') + chalk.gray(' to check health'));
    console.log('');
  }

  // v6.0 (D7): seed metrics.remote_consent: pending (idempotent) and capture
  // a privacy-preserving university metrics snapshot. Non-fatal on any error.
  try {
    const { captureSnapshot, seedMetricsConsent } = await import('../core/university/metrics.js');
    seedMetricsConsent(cwd);
    captureSnapshot(cwd);
  } catch (e) {
    log.operation('shift').debug('metrics snapshot failed', { error: (e as Error).message });
  }

  tracker.success('Paradigm shift complete', { project: projectName });
}
