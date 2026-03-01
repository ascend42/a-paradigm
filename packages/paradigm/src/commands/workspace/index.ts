/**
 * paradigm workspace - Multi-project workspace commands
 *
 * Commands:
 *   paradigm workspace init     — Create a .paradigm-workspace file
 *   paradigm workspace status   — Show workspace member status
 *   paradigm workspace reindex  — Rebuild all member indices
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import { indexCommand } from '../scan/index.js';

// ============================================================================
// Types
// ============================================================================

interface WorkspaceMember {
  name: string;
  path: string;
  role?: 'api' | 'client' | 'shared' | 'service' | 'lib';
  exports?: string[];
}

interface WorkspaceConfig {
  version: string;
  name: string;
  members: WorkspaceMember[];
}

// ============================================================================
// paradigm workspace init
// ============================================================================

export interface WorkspaceInitOptions {
  name?: string;
  force?: boolean;
}

export async function workspaceInitCommand(options: WorkspaceInitOptions = {}) {
  const cwd = process.cwd();
  const workspaceFile = path.join(cwd, '.paradigm-workspace');

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  paradigm workspace init                         ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  Create a multi-project workspace               ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  const tracker = log.command('workspace-init').start('Creating workspace', { cwd });

  if (fs.existsSync(workspaceFile) && !options.force) {
    console.log(chalk.yellow('  .paradigm-workspace already exists. Use --force to overwrite.\n'));
    tracker.success('Workspace already exists');
    return;
  }

  // Discover sibling projects (directories with .paradigm/ or .purpose)
  const parentDir = cwd;
  const entries = fs.readdirSync(parentDir, { withFileTypes: true });
  const members: WorkspaceMember[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const dirPath = path.join(parentDir, entry.name);
    const hasParadigm = fs.existsSync(path.join(dirPath, '.paradigm'));
    const hasPurpose = fs.existsSync(path.join(dirPath, '.purpose'));

    if (hasParadigm || hasPurpose) {
      // Detect role from common patterns
      const role = detectProjectRole(entry.name, dirPath);
      members.push({
        name: entry.name,
        path: `./${entry.name}`,
        ...(role && { role }),
      });
    }
  }

  if (members.length === 0) {
    console.log(chalk.yellow('  No sibling projects with .paradigm/ or .purpose found.'));
    console.log(chalk.gray('  Create .purpose files in sibling directories first.\n'));
    tracker.error('No projects found');
    return;
  }

  const workspaceName = options.name || path.basename(cwd);

  const config: WorkspaceConfig = {
    version: '1.0',
    name: workspaceName,
    members,
  };

  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });

  fs.writeFileSync(workspaceFile, yamlContent, 'utf8');

  console.log(chalk.green(`  Created .paradigm-workspace with ${members.length} members:\n`));
  for (const member of members) {
    const roleTag = member.role ? chalk.gray(` [${member.role}]`) : '';
    console.log(chalk.white(`    ${member.name}`) + roleTag + chalk.gray(` → ${member.path}`));
  }
  console.log('');

  // Hint about adding workspace field to config.yaml
  console.log(chalk.white('  Next steps:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.white('  1. ') + chalk.gray('In each member project, add to ') + chalk.cyan('.paradigm/config.yaml') + chalk.gray(':'));
  console.log(chalk.gray('     ') + chalk.cyan('workspace: ../.paradigm-workspace'));
  console.log(chalk.white('  2. ') + chalk.gray('Run ') + chalk.cyan('paradigm workspace reindex') + chalk.gray(' to build all indices'));
  console.log(chalk.white('  3. ') + chalk.gray('Use ') + chalk.cyan('includeWorkspace: true') + chalk.gray(' in MCP tools for cross-project search'));
  console.log('');

  tracker.success('Workspace created', { members: members.length });
}

// ============================================================================
// paradigm workspace status
// ============================================================================

export interface WorkspaceStatusOptions {
  json?: boolean;
}

export async function workspaceStatusCommand(options: WorkspaceStatusOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('workspace-status').start('Getting workspace status');

  // Find workspace file — check current dir and parent
  const workspaceFile = findWorkspaceFile(cwd);
  if (!workspaceFile) {
    console.log(chalk.yellow('\n  No .paradigm-workspace found in current or parent directory.\n'));
    console.log(chalk.gray('  Run `paradigm workspace init` to create one.\n'));
    tracker.error('No workspace found');
    return;
  }

  const config = yaml.load(fs.readFileSync(workspaceFile, 'utf8')) as WorkspaceConfig;
  const workspaceDir = path.dirname(workspaceFile);

  if (options.json) {
    const results = config.members.map(m => getMemberStatus(workspaceDir, m));
    console.log(JSON.stringify({ workspace: config.name, members: results }, null, 2));
    tracker.success('Workspace status (JSON)');
    return;
  }

  console.log(chalk.blue(`\n  Workspace: ${chalk.white.bold(config.name)}`));
  console.log(chalk.gray(`  File: ${workspaceFile}`));
  console.log(chalk.gray('  ─────────────────────────────────────────────────\n'));

  for (const member of config.members) {
    const status = getMemberStatus(workspaceDir, member);
    const icon = status.hasIndex ? chalk.green('✓') : chalk.yellow('○');
    const roleTag = member.role ? chalk.gray(` [${member.role}]`) : '';

    console.log(`  ${icon} ${chalk.white.bold(member.name)}${roleTag}`);
    console.log(chalk.gray(`    Path: ${member.path}`));

    if (status.hasIndex) {
      console.log(chalk.gray(`    Symbols: ${status.symbolCount}`));
      console.log(chalk.gray(`    Last indexed: ${status.lastIndexed || 'unknown'}`));
    } else {
      console.log(chalk.yellow(`    No scan-index.json — run paradigm scan in this project`));
    }
    console.log('');
  }

  tracker.success('Workspace status shown', { members: config.members.length });
}

// ============================================================================
// paradigm workspace reindex
// ============================================================================

export interface WorkspaceReindexOptions {
  quiet?: boolean;
}

export async function workspaceReindexCommand(options: WorkspaceReindexOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('workspace-reindex').start('Reindexing workspace');

  const workspaceFile = findWorkspaceFile(cwd);
  if (!workspaceFile) {
    console.log(chalk.yellow('\n  No .paradigm-workspace found.\n'));
    tracker.error('No workspace found');
    return;
  }

  const config = yaml.load(fs.readFileSync(workspaceFile, 'utf8')) as WorkspaceConfig;
  const workspaceDir = path.dirname(workspaceFile);

  console.log(chalk.blue(`\n  Reindexing workspace: ${chalk.white.bold(config.name)}\n`));

  const spinner = ora();
  let totalSymbols = 0;

  for (const member of config.members) {
    const memberAbsPath = path.resolve(workspaceDir, member.path);

    if (!fs.existsSync(memberAbsPath)) {
      if (!options.quiet) {
        console.log(chalk.yellow(`  ⚠ ${member.name}: directory not found at ${member.path}`));
      }
      continue;
    }

    if (!options.quiet) {
      spinner.start(`Indexing ${member.name}...`);
    }

    try {
      await indexCommand(memberAbsPath, { quiet: true });

      // Read scan-index.json to get symbol count
      const scanIndexPath = path.join(memberAbsPath, '.paradigm', 'scan-index.json');
      let symbolCount = 0;
      if (fs.existsSync(scanIndexPath)) {
        try {
          const scanData = JSON.parse(fs.readFileSync(scanIndexPath, 'utf8'));
          const meta = scanData.$meta;
          if (meta?.sources) {
            symbolCount = (meta.sources.purposeFiles || 0) + (meta.sources.portalFiles || 0);
          }
        } catch {
          // Count estimation failed, non-fatal
        }
      }

      totalSymbols += symbolCount;
      if (!options.quiet) {
        spinner.succeed(chalk.green(`${member.name}: indexed`));
      }
    } catch (e) {
      if (!options.quiet) {
        spinner.fail(chalk.red(`${member.name}: ${(e as Error).message}`));
      }
    }
  }

  console.log(chalk.gray('\n  ─────────────────────────────────────────────────'));
  console.log(chalk.green(`  All members reindexed.`));
  console.log('');

  tracker.success('Workspace reindexed', { members: config.members.length, totalSymbols });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the .paradigm-workspace file — check cwd, then parent directories
 */
function findWorkspaceFile(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.paradigm-workspace');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Also check config.yaml for workspace path
  const configPath = path.join(startDir, '.paradigm', 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      if (typeof config?.workspace === 'string') {
        const wsPath = path.resolve(startDir, config.workspace);
        if (fs.existsSync(wsPath)) return wsPath;
      }
    } catch {
      // Non-fatal
    }
  }

  return null;
}

/**
 * Detect project role from directory name and contents
 */
export function detectProjectRole(name: string, dirPath: string): WorkspaceMember['role'] | undefined {
  const lowerName = name.toLowerCase();

  // Check directory name patterns
  if (lowerName.includes('api') || lowerName.includes('backend') || lowerName.includes('server')) {
    return 'api';
  }
  if (lowerName.includes('client') || lowerName.includes('frontend') || lowerName.includes('web') || lowerName.includes('app')) {
    return 'client';
  }
  if (lowerName.includes('shared') || lowerName.includes('common') || lowerName.includes('core')) {
    return 'shared';
  }
  if (lowerName.includes('lib') || lowerName.includes('packages')) {
    return 'lib';
  }
  if (lowerName.includes('service') || lowerName.includes('svc')) {
    return 'service';
  }

  // Check for package.json hints
  const pkgPath = path.join(dirPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['react'] || deps['vue'] || deps['@angular/core'] || deps['svelte']) {
        return 'client';
      }
      if (deps['express'] || deps['fastify'] || deps['koa'] || deps['hono']) {
        return 'api';
      }
    } catch {
      // Non-fatal
    }
  }

  return undefined;
}

/**
 * Get status information for a workspace member
 */
function getMemberStatus(workspaceDir: string, member: WorkspaceMember) {
  const memberAbsPath = path.resolve(workspaceDir, member.path);
  const scanIndexPath = path.join(memberAbsPath, '.paradigm', 'scan-index.json');

  const result = {
    name: member.name,
    path: member.path,
    role: member.role,
    exists: fs.existsSync(memberAbsPath),
    hasIndex: false,
    symbolCount: 0,
    lastIndexed: null as string | null,
  };

  if (result.exists && fs.existsSync(scanIndexPath)) {
    result.hasIndex = true;
    try {
      const scanData = JSON.parse(fs.readFileSync(scanIndexPath, 'utf8'));
      const meta = scanData.$meta;
      if (meta) {
        result.lastIndexed = meta.generatedAt || null;
        // Count symbols across categories
        for (const category of ['components', 'flows', 'gates', 'signals', 'aspects']) {
          const items = scanData[category];
          if (items && typeof items === 'object') {
            result.symbolCount += Object.keys(items).length;
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return result;
}
