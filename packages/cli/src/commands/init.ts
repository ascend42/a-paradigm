/**
 * horizon init - Initialize Horizon in a project
 * Creates .horizon/ directory with config, specs, docs, and prompts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { getDefaultPurposeContent } from '@horizon/purpose-core';
import { getDefaultGateConfig } from '@horizon/gate-core';
import { getDefaultDreamContent } from '@horizon/dream-core';
import { detectIDE, loadHorizonFiles, syncToIDE } from '../core/ide-adapters/index.js';

interface InitOptions {
  force?: boolean;
  name?: string;
}

// Get templates directory
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // In dist, we're at dist/commands/init.js, templates are at templates/horizon/
  // But templates should be copied to dist during build or referenced from src
  // For now, try multiple possible locations
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'templates', 'horizon'),
    path.join(__dirname, '..', 'templates', 'horizon'),
    path.join(__dirname, '..', '..', 'src', 'templates', 'horizon'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // Fallback: return the expected location
  return path.join(__dirname, '..', 'templates', 'horizon');
}

/**
 * Copy directory recursively
 */
function copyDir(src: string, dest: string, projectName: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, projectName);
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');
      // Replace template variables
      content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
      fs.writeFileSync(destPath, content, 'utf8');
    }
  }
}

export async function initCommand(options: InitOptions) {
  const cwd = process.cwd();
  const projectName = options.name || path.basename(cwd);

  console.log(chalk.blue('\n🌅 Initializing Horizon...\n'));

  const spinner = ora();
  const templatesDir = getTemplatesDir();
  const horizonDir = path.join(cwd, '.horizon');
  const legacyHorizonFile = path.join(cwd, '.horizon');

  // Check for existing .horizon
  if (fs.existsSync(horizonDir)) {
    const stat = fs.statSync(horizonDir);
    
    if (stat.isFile()) {
      // Legacy .horizon file exists
      if (!options.force) {
        console.log(chalk.yellow('  ⚠ Legacy .horizon file found.'));
        console.log(chalk.gray('    Run `horizon upgrade --all` to migrate to new format.'));
        console.log(chalk.gray('    Or use --force to overwrite.\n'));
        return;
      }
      // Remove legacy file
      fs.unlinkSync(legacyHorizonFile);
    } else if (stat.isDirectory() && !options.force) {
      console.log(chalk.yellow('  ⚠ .horizon/ directory already exists (use --force to overwrite)'));
      return;
    }
  }

  // Create .horizon/ directory structure
  spinner.start('Creating .horizon/ directory...');
  
  try {
    // Create main directory
    if (!fs.existsSync(horizonDir)) {
      fs.mkdirSync(horizonDir, { recursive: true });
    }
    
    // Check if templates exist
    if (fs.existsSync(templatesDir)) {
      // Copy from templates
      copyDir(templatesDir, horizonDir, projectName);
      spinner.succeed(chalk.green('.horizon/ directory created with specs, docs, and prompts'));
    } else {
      // Create minimal structure manually
      spinner.warn(chalk.yellow('Templates not found, creating minimal structure'));
      
      // Create subdirectories
      fs.mkdirSync(path.join(horizonDir, 'specs'), { recursive: true });
      fs.mkdirSync(path.join(horizonDir, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(horizonDir, 'prompts'), { recursive: true });
      
      // Create minimal config
      const minimalConfig = `# Horizon Configuration
version: "1.0"
project: "${projectName}"

agent-guidelines:
  overview: |
    This project uses Horizon for structured AI-assisted development.
  how-to-use:
    - Check .horizon/specs/ for philosophy and patterns
    - Use symbol prefixes: @feature #component ^gate !signal %state $flow
    - Use the Horizon logger instead of raw console.log/print

symbol-system:
  "@":
    name: Feature
    description: User-facing capabilities
    owner: purpose
    examples: ["@login", "@checkout"]
  "#":
    name: Component
    description: Reusable code units
    owner: purpose
    examples: ["#Button", "#api-client"]
  "^":
    name: Gate
    description: Access control points
    owner: gate
    examples: ["^authenticated", "^admin-only"]
  "!":
    name: Signal
    description: Events and side effects
    owner: gate
    examples: ["!login-success", "!payment-failed"]
  "%":
    name: State
    description: Application state
    owner: purpose
    examples: ["%user.authenticated", "%cart.items"]
  "$":
    name: Flow
    description: Multi-step processes
    owner: shared
    examples: ["$checkout-flow", "$onboarding"]

logging:
  enforce: true
  default-level: debug

scan:
  enabled: true

conventions:
  - Use kebab-case for symbol IDs
  - ALWAYS use Horizon logger, NEVER raw console.log/print
`;
      fs.writeFileSync(path.join(horizonDir, 'config.yaml'), minimalConfig, 'utf8');
      spinner.succeed(chalk.green('.horizon/ directory created (minimal)'));
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed to create .horizon/: ${(error as Error).message}`));
    return;
  }

  // Create .dream file
  const dreamPath = path.join(cwd, '.dream');
  if (fs.existsSync(dreamPath) && !options.force) {
    console.log(chalk.yellow('  ⚠ .dream file already exists'));
  } else {
    spinner.start('Creating .dream file...');
    fs.writeFileSync(dreamPath, getDefaultDreamContent(projectName));
    spinner.succeed(chalk.green('.dream file created'));
  }

  // Create root .purpose file if it doesn't exist
  const purposePath = path.join(cwd, '.purpose');
  if (fs.existsSync(purposePath) && !options.force) {
    console.log(chalk.yellow('  ⚠ .purpose file already exists'));
  } else {
    spinner.start('Creating .purpose file...');
    fs.writeFileSync(purposePath, getDefaultPurposeContent());
    spinner.succeed(chalk.green('.purpose file created'));
  }

  // Check for gate.yaml
  const gatePath = path.join(cwd, 'gate.yaml');
  if (fs.existsSync(gatePath)) {
    console.log(chalk.green('  ✓ Detected existing gate.yaml'));
  } else if (options.force) {
    spinner.start('Creating gate.yaml...');
    fs.writeFileSync(gatePath, getDefaultGateConfig());
    spinner.succeed(chalk.green('gate.yaml created'));
  } else {
    console.log(chalk.gray('  ○ No gate.yaml found (optional)'));
  }

  // Auto-detect IDE and sync
  spinner.start('Detecting IDE...');
  const detection = detectIDE(cwd);
  
  if (detection.detected) {
    spinner.succeed(`Detected ${chalk.cyan(detection.detected)}`);
    
    // Load the newly created horizon files and sync
    const files = loadHorizonFiles(cwd);
    if (files) {
      spinner.start(`Generating IDE instructions...`);
      const result = syncToIDE(cwd, detection.detected, files, true);
      if (result.success) {
        spinner.succeed(chalk.green(`${result.outputPath} generated`));
      } else {
        spinner.warn(chalk.yellow(`Could not generate IDE file: ${result.message}`));
      }
    }
  } else {
    spinner.info('No IDE detected, skipping sync (run `horizon sync` later)');
  }

  // Summary
  console.log(chalk.blue('\n✨ Horizon initialized!\n'));
  console.log(chalk.gray('Created:'));
  console.log(chalk.white('  • .horizon/           - Configuration & specifications'));
  console.log(chalk.white('    ├── config.yaml     - Main configuration'));
  console.log(chalk.white('    ├── specs/          - Logger, scan, symbols specs'));
  console.log(chalk.white('    ├── docs/           - Commands, patterns, troubleshooting'));
  console.log(chalk.white('    └── prompts/        - Pre-written task prompts'));
  console.log(chalk.white('  • .dream              - Project overview & ideas'));
  console.log(chalk.white('  • .purpose            - Feature & component context'));
  if (detection.detected) {
    const outputFile = detection.detected === 'cursor' ? '.cursorrules' 
      : detection.detected === 'copilot' ? '.github/copilot-instructions.md'
      : '.windsurfrules';
    console.log(chalk.white(`  • ${outputFile}  - IDE instructions`));
  }
  console.log('');
  console.log(chalk.gray('Next steps:'));
  console.log(chalk.white('  1. Review ' + chalk.cyan('.horizon/config.yaml') + ' and customize'));
  console.log(chalk.white('  2. Check ' + chalk.cyan('.horizon/specs/') + ' for logging & scan specs'));
  console.log(chalk.white('  3. Edit ' + chalk.cyan('.purpose') + ' to define your project context'));
  console.log(chalk.white('  4. Run ' + chalk.cyan('horizon sync') + ' after config changes'));
  console.log(chalk.white('  5. Run ' + chalk.cyan('horizon doctor') + ' to verify setup\n'));
}
