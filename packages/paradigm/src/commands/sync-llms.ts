/**
 * paradigm sync-llms - Generate llms.txt file for LLM consumption
 *
 * Generates a plain-text llms.txt file at the project root that summarizes
 * the project following the llms.txt standard.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import { loadParadigmFiles } from '../core/ide-adapters/index.js';

interface SyncLlmsOptions {
  output?: string;
}

interface NavigatorYaml {
  version?: string;
  structure?: Record<string, unknown>;
  key_files?: Record<string, string[]>;
  symbols?: Record<string, string>;
  skip_patterns?: Record<string, string[]>;
}

interface FlowStep {
  type?: string;
  symbol?: string;
  action?: string;
  component?: string;
}

interface FlowDefinition {
  name?: string;
  trigger?: string;
  steps?: FlowStep[];
  successSignal?: string;
  description?: string;
}

interface FlowsYaml {
  version?: string;
  flows?: Record<string, FlowDefinition>;
}

interface GateDefinition {
  description?: string;
  check?: string;
  type?: string;
  prizes?: string[];
}

interface PortalYaml {
  version?: string;
  gates?: Record<string, GateDefinition>;
  routes?: Record<string, string[]>;
}

export async function syncLlmsCommand(options: SyncLlmsOptions) {
  const rootDir = process.cwd();
  const spinner = ora();

  console.log(chalk.blue('\n  Paradigm Sync LLMs\n'));

  // Load Paradigm files
  spinner.start('Loading .paradigm/ configuration...');
  const files = loadParadigmFiles(rootDir);

  if (!files) {
    spinner.fail('No .paradigm/ directory found');
    console.log(chalk.gray('\nRun `paradigm init` to initialize Paradigm in this project.\n'));
    log.command('sync-llms').error('Missing .paradigm/ directory');
    process.exit(1);
  }

  spinner.succeed(`Loaded configuration for ${chalk.cyan(files.projectName)}`);
  log.command('sync-llms').debug('Configuration loaded', { projectName: files.projectName });

  // Load navigator.yaml if it exists
  spinner.start('Reading navigator.yaml...');
  let navigator: NavigatorYaml | null = null;
  const navigatorPath = path.join(rootDir, '.paradigm', 'navigator.yaml');
  if (fs.existsSync(navigatorPath)) {
    try {
      const content = fs.readFileSync(navigatorPath, 'utf8');
      navigator = yaml.load(content) as NavigatorYaml;
      spinner.succeed('Loaded navigator.yaml');
    } catch {
      spinner.warn('Could not parse navigator.yaml, skipping key files section');
      log.command('sync-llms').warn('Failed to parse navigator.yaml');
    }
  } else {
    spinner.info('No navigator.yaml found, skipping key files section');
  }

  // Load flows.yaml if it exists
  let flows: FlowsYaml | null = null;
  const flowsPath = path.join(rootDir, '.paradigm', 'flows.yaml');
  if (fs.existsSync(flowsPath)) {
    try {
      const content = fs.readFileSync(flowsPath, 'utf8');
      flows = yaml.load(content) as FlowsYaml;
    } catch {
      log.command('sync-llms').warn('Failed to parse flows.yaml');
    }
  }

  // Load portal.yaml if it exists
  let portal: PortalYaml | null = null;
  const portalPath = path.join(rootDir, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const content = fs.readFileSync(portalPath, 'utf8');
      portal = yaml.load(content) as PortalYaml;
    } catch {
      log.command('sync-llms').warn('Failed to parse portal.yaml');
    }
  }

  // Generate llms.txt content
  spinner.start('Generating llms.txt...');
  const content = generateLlmsTxt(files, navigator, flows, portal);

  // Determine output path
  const outputPath = options.output
    ? path.resolve(rootDir, options.output)
    : path.join(rootDir, 'llms.txt');

  // Write the file
  try {
    fs.writeFileSync(outputPath, content, 'utf8');
    spinner.succeed(chalk.green(`Generated llms.txt`));
    console.log(chalk.gray(`\n  Path: ${path.relative(rootDir, outputPath)}`));
    console.log('');
    log.command('sync-llms').success('llms.txt generated', { path: outputPath });
  } catch (error) {
    spinner.fail(chalk.red(`Failed to write llms.txt`));
    log.command('sync-llms').error('Write failed', { error: (error as Error).message });
    process.exit(1);
  }
}

function generateLlmsTxt(
  files: { config: import('../core/paradigm-config.js').ParadigmConfig; projectName: string },
  navigator: NavigatorYaml | null,
  flows: FlowsYaml | null,
  portal: PortalYaml | null,
): string {
  const { config, projectName } = files;
  const sections: string[] = [];

  // Title
  sections.push(`# ${config.project || projectName}`);

  // Overview
  const overview = config['agent-guidelines']?.overview?.trim();
  if (overview) {
    sections.push(`> ${overview.replace(/\n/g, '\n> ')}`);
  }

  // Symbols
  const symbolSystem = config['symbol-system'];
  if (symbolSystem) {
    const symbolLines: string[] = ['## Symbols', ''];
    symbolLines.push('| Prefix | Name | Description |');
    symbolLines.push('|--------|------|-------------|');

    for (const [prefix, def] of Object.entries(symbolSystem)) {
      // Only include the 5 operational symbols
      if (['#', '$', '^', '!', '~'].includes(prefix)) {
        symbolLines.push(`| \`${prefix}\` | ${def.name} | ${def.description} |`);
      }
    }

    sections.push(symbolLines.join('\n'));
  }

  // Key Files from navigator.yaml
  if (navigator?.key_files) {
    const keyFileLines: string[] = ['## Key Files', ''];
    for (const [category, paths] of Object.entries(navigator.key_files)) {
      if (paths && paths.length > 0) {
        keyFileLines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
        keyFileLines.push('');
        for (const p of paths) {
          keyFileLines.push(`- \`${p}\``);
        }
        keyFileLines.push('');
      }
    }
    if (keyFileLines.length > 2) {
      sections.push(keyFileLines.join('\n').trimEnd());
    }
  }

  // Flows
  if (flows?.flows && Object.keys(flows.flows).length > 0) {
    const flowLines: string[] = ['## Flows', ''];
    for (const [id, flow] of Object.entries(flows.flows)) {
      const name = flow.name || flow.description || id;
      const trigger = flow.trigger ? ` (trigger: \`${flow.trigger}\`)` : '';
      flowLines.push(`- **$${id}**: ${name}${trigger}`);
    }
    sections.push(flowLines.join('\n'));
  }

  // Gates from portal.yaml
  if (portal?.gates && Object.keys(portal.gates).length > 0) {
    const gateLines: string[] = ['## Gates', ''];
    gateLines.push('| Gate | Description |');
    gateLines.push('|------|-------------|');
    for (const [id, gate] of Object.entries(portal.gates)) {
      const desc = gate.description || '';
      gateLines.push(`| \`^${id}\` | ${desc} |`);
    }

    // Include routes if present
    if (portal.routes && Object.keys(portal.routes).length > 0) {
      gateLines.push('');
      gateLines.push('### Protected Routes');
      gateLines.push('');
      for (const [route, gates] of Object.entries(portal.routes)) {
        gateLines.push(`- \`${route}\`: ${gates.join(', ')}`);
      }
    }

    sections.push(gateLines.join('\n'));
  }

  // Conventions
  const conventions = config.conventions;
  if (conventions && conventions.length > 0) {
    const convLines: string[] = ['## Conventions', ''];
    for (const conv of conventions) {
      convLines.push(`- ${conv}`);
    }
    sections.push(convLines.join('\n'));
  }

  // Further Reading
  const furtherReading = [
    '## Further Reading',
    '',
    '- `.paradigm/specs/` - Detailed specifications',
    '- `.paradigm/docs/` - Commands, patterns, troubleshooting',
    '- `CLAUDE.md` - AI agent instructions (Claude Code)',
    '- `AGENTS.md` - Universal agent instructions',
  ];
  sections.push(furtherReading.join('\n'));

  return sections.join('\n\n') + '\n';
}
