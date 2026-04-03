/**
 * paradigm agent install | search | publish — nevr.land registry integration
 *
 * Wires the Paradigm CLI to the nevr.land agent registry via @a-company/registry-client.
 * Uses lazy imports so the registry client is only loaded when these commands run.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import { addAdoption } from './adoption.js';

const REGISTRY_URL = process.env.NEVR_REGISTRY_URL || 'https://nevr-api.onrender.com';
const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.paradigm', 'agents');
const PROJECT_AGENTS_DIR = '.paradigm/agents';

// ============================================================================
// paradigm agent search <query>
// ============================================================================

export async function agentSearchCommand(query: string, options: { limit?: string }) {
  const tracker = log.command('agent-search').start('Searching nevr.land registry', { query });

  const limit = parseInt(options.limit || '10', 10);

  try {
    const { RegistryClient } = await import('@a-company/registry-client');
    const client = new RegistryClient({ baseUrl: REGISTRY_URL });

    const result = await client.search(query, { page: 1 });
    const agents = result.agents.slice(0, limit);

    if (!agents || agents.length === 0) {
      console.log(chalk.dim('\n  No agents found.\n'));
      tracker.success('No results');
      return;
    }

    console.log(chalk.bold(`\n  ${agents.length} agent(s) found`) + chalk.dim(` (of ${result.total})\n`));

    for (const agent of agents) {
      const cleanScope = agent.scope.startsWith('@') ? agent.scope : `@${agent.scope}`;
      const nameStr = chalk.cyan(`${cleanScope}/${agent.name}`);
      const versionStr = chalk.dim('v' + (agent.latestVersion || '0.1.0'));
      const downloadsStr = agent.downloads > 0 ? chalk.dim(` | ${agent.downloads} downloads`) : '';
      const calibrationStr = agent.calibrationScore != null
        ? chalk.dim(` | calibration: ${(agent.calibrationScore * 100).toFixed(0)}%`)
        : '';

      console.log(`  ${nameStr} ${versionStr}${downloadsStr}${calibrationStr}`);
      if (agent.description) {
        console.log(`  ${agent.description}`);
      }
      if (agent.tags?.length) {
        console.log(`  ${chalk.dim('tags:')} ${agent.tags.join(', ')}`);
      }
      console.log();
    }

    console.log(chalk.dim('  Install: paradigm agent install @scope/name\n'));
    tracker.success(`Found ${agents.length} agents`);
  } catch (err) {
    console.error(chalk.red('\n  Search failed:'), err instanceof Error ? err.message : err);
    console.log('');
    tracker.error('Search failed');
  }
}

// ============================================================================
// paradigm agent install <source>
// ============================================================================

export async function agentInstallCommand(source: string, options: { global?: boolean }) {
  const tracker = log.command('agent-install').start('Installing agent from registry', { source });

  // Parse source: @scope/name or @scope/name@version
  let installSource = source;
  let version: string | undefined;

  // Check for @scope/name@version — find the last '@' that is not the scope prefix
  const atVersionIdx = installSource.lastIndexOf('@');
  if (atVersionIdx > 0 && installSource[atVersionIdx - 1] !== '/') {
    version = installSource.substring(atVersionIdx + 1);
    installSource = installSource.substring(0, atVersionIdx);
  }

  const slashIdx = installSource.indexOf('/');
  if (slashIdx === -1) {
    console.error(chalk.red('\n  Invalid agent name. Use @scope/name format.\n'));
    tracker.error('Invalid agent name format');
    return;
  }

  const scope = installSource.substring(0, slashIdx).replace(/^@/, '');
  const name = installSource.substring(slashIdx + 1);

  console.log(chalk.dim(`\n  Installing ${scope}/${name}${version ? '@' + version : ''}...`));

  try {
    const { RegistryClient } = await import('@a-company/registry-client');
    const client = new RegistryClient({ baseUrl: REGISTRY_URL });

    // 1. Get agent info from registry
    const agent = await client.getAgent(scope, name);
    if (!agent) {
      console.error(chalk.red(`\n  Agent @${scope}/${name} not found.\n`));
      tracker.error('Agent not found');
      return;
    }

    // 2. Determine install directory
    const agentsDir = options.global
      ? GLOBAL_AGENTS_DIR
      : path.join(process.cwd(), PROJECT_AGENTS_DIR);
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    // 3. Try downloading the package
    let downloaded = false;
    try {
      const pkg = await client.downloadPackage(scope, name, version || 'latest');
      // Write the tarball for future extraction
      const tarballPath = path.join(agentsDir, `${name}.nevr.tar.gz`);
      fs.writeFileSync(tarballPath, pkg.buffer);
      downloaded = true;
      log.component('#agent-registry').info('Package downloaded', {
        agent: `${scope}/${name}`,
        hash: pkg.hash.slice(0, 12),
        size: pkg.buffer.length,
      });
    } catch {
      // Package not available yet — fall through to metadata-only install
      log.component('#agent-registry').info('Package not available, creating metadata-only profile', {
        agent: `${scope}/${name}`,
      });
    }

    // 4. Write a .agent profile from registry metadata
    const agentFile: Record<string, unknown> = {
      id: name,
      nickname: agent.nickname || agent.displayName || name,
      role: agent.description || '',
      description: agent.description || '',
      version: version || agent.latestVersion || '0.1.0',
      scope: `@${scope}`,
      registry: REGISTRY_URL,
      distribution: agent.distribution,
      installedAt: new Date().toISOString(),
      personality: { style: 'deliberate', risk: 'balanced', verbosity: 'concise' },
      expertise: [],
      transferable: [],
      contexts: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    if (agent.brandColor) agentFile.brandColor = agent.brandColor;
    if (agent.tags?.length) agentFile.tags = agent.tags;

    const agentFilePath = path.join(agentsDir, `${name}.agent`);
    fs.writeFileSync(
      agentFilePath,
      yaml.dump(agentFile, { lineWidth: 120, noRefs: true, sortKeys: false }),
      'utf-8',
    );

    // 5. Record adoption
    try {
      await addAdoption(process.cwd(), name, {
        adopted: new Date().toISOString(),
        source: 'marketplace',
        defaultsAccepted: true,
        version: (version || agent.latestVersion || '0.1.0'),
      });
    } catch {
      // Non-fatal — adoption tracking is best-effort
      log.component('#agent-registry').info('Adoption record skipped (no .paradigm dir)', { agent: name });
    }

    // 6. Output
    if (downloaded) {
      console.log(chalk.green(`\n  ✓ Installed @${scope}/${name}`));
    } else {
      console.log(chalk.green(`\n  ✓ Installed @${scope}/${name} (metadata only)`));
      console.log(chalk.dim('    Package not yet available for download.'));
    }
    console.log(chalk.dim(`    Location: ${agentFilePath}`));
    console.log(chalk.dim(`    Run: paradigm agent show ${name}\n`));
    tracker.success(`Installed ${scope}/${name}`);
  } catch (err) {
    console.error(chalk.red('\n  Install failed:'), err instanceof Error ? err.message : err);
    console.log('');
    tracker.error('Install failed');
  }
}

// ============================================================================
// paradigm agent publish
// ============================================================================

export async function agentPublishCommand(options: { namespace?: string }) {
  const tracker = log.command('agent-publish').start('Agent publish info', {});

  console.log(chalk.bold('\n  Publishing agents to nevr.land\n'));
  console.log('  Use the nevr CLI to publish:');
  console.log(chalk.cyan('    npm install -g @a-company/nevr'));
  console.log(chalk.cyan('    nevr auth login'));
  console.log(chalk.cyan('    nevr publish'));
  console.log('');
  console.log(chalk.dim('  Full paradigm publish integration coming soon.\n'));

  tracker.success('Showed publish instructions');
}
