/**
 * horizon upgrade - Patch existing projects with new Horizon features
 * Handles migration from legacy .horizon file to .horizon/ directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { parseHorizonConfig, serializeHorizonConfig, type HorizonConfig } from '../core/horizon-config.js';
import { loadHorizonFiles, syncToIDE, detectIDE } from '../core/ide-adapters/index.js';

interface UpgradeOptions {
  features?: string[];
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

interface UpgradeResult {
  feature: string;
  status: 'added' | 'skipped' | 'updated' | 'error';
  message: string;
}

// Available upgrade features
const AVAILABLE_FEATURES = ['scan', 'logger', 'migrate'] as const;
type UpgradeFeature = typeof AVAILABLE_FEATURES[number];

// Get templates directory
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'templates', 'horizon'),
    path.join(__dirname, '..', 'templates', 'horizon'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return path.join(__dirname, '..', 'templates', 'horizon');
}

export async function upgradeCommand(targetPath: string | undefined, options: UpgradeOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  const spinner = ora();

  console.log(chalk.blue('\n🔄 Horizon Upgrade\n'));

  // Determine which features to upgrade
  let features: UpgradeFeature[] = [];
  
  if (options.all) {
    features = ['migrate', 'scan', 'logger'];
  } else if (options.features && options.features.length > 0) {
    features = options.features.filter(f => 
      AVAILABLE_FEATURES.includes(f as UpgradeFeature)
    ) as UpgradeFeature[];
  } else {
    // Default: show available upgrades
    console.log(chalk.yellow('No features specified. Available upgrades:\n'));
    console.log(chalk.cyan('  migrate') + chalk.gray(' - Migrate from .horizon file to .horizon/ directory'));
    console.log(chalk.cyan('  scan') + chalk.gray('    - Add visual discovery (horizon scan) support'));
    console.log(chalk.cyan('  logger') + chalk.gray('  - Add Horizon logger specification'));
    console.log(chalk.cyan('  all') + chalk.gray('     - Apply all available upgrades'));
    console.log();
    console.log(chalk.gray('Usage:'));
    console.log(chalk.gray('  horizon upgrade --features scan'));
    console.log(chalk.gray('  horizon upgrade --features logger'));
    console.log(chalk.gray('  horizon upgrade --all'));
    console.log();
    return;
  }

  const results: UpgradeResult[] = [];
  const horizonPath = path.join(rootDir, '.horizon');
  
  // Check current state
  const exists = fs.existsSync(horizonPath);
  const isLegacyFile = exists && fs.statSync(horizonPath).isFile();
  const isDirectory = exists && fs.statSync(horizonPath).isDirectory();

  // Process migration first if needed
  if (features.includes('migrate') || (isLegacyFile && options.all)) {
    if (isLegacyFile) {
      results.push(await migrateLegacy(rootDir, projectName, options, spinner));
    } else if (isDirectory) {
      results.push({
        feature: 'migrate',
        status: 'skipped',
        message: 'Already using .horizon/ directory format',
      });
    } else {
      results.push({
        feature: 'migrate',
        status: 'error',
        message: 'No .horizon found to migrate',
      });
    }
  }

  // Ensure we have a .horizon directory for other upgrades
  const horizonDir = path.join(rootDir, '.horizon');
  const hasHorizonDir = fs.existsSync(horizonDir) && fs.statSync(horizonDir).isDirectory();

  if (!hasHorizonDir && !options.dryRun) {
    // Need to run init or migrate first
    if (!isLegacyFile) {
      console.log(chalk.yellow('⚠️  No .horizon/ directory found.'));
      console.log(chalk.gray('   Run `horizon init` first to initialize Horizon.\n'));
      return;
    }
  }

  // Process other features
  for (const feature of features) {
    if (feature === 'migrate') continue; // Already handled
    
    switch (feature) {
      case 'scan':
        results.push(await upgradeScan(rootDir, projectName, options, spinner));
        break;
      case 'logger':
        results.push(await upgradeLogger(rootDir, options, spinner));
        break;
    }
  }

  // Re-sync IDE files after upgrade
  if (!options.dryRun && results.some(r => r.status === 'added' || r.status === 'updated')) {
    spinner.start('Re-syncing IDE files...');
    
    const files = loadHorizonFiles(rootDir);
    if (files) {
      const detection = detectIDE(rootDir);
      if (detection.detected) {
        const result = syncToIDE(rootDir, detection.detected, files, true);
        if (result.success) {
          spinner.succeed(`IDE files synced (${detection.detected})`);
        } else {
          spinner.warn('Could not sync IDE files');
        }
      } else {
        spinner.info('No IDE detected, run `horizon sync` to generate IDE files');
      }
    }
  }

  // Summary
  console.log(chalk.blue('\n📋 Upgrade Summary\n'));
  
  for (const result of results) {
    const icon = result.status === 'added' || result.status === 'updated' 
      ? chalk.green('✓')
      : result.status === 'skipped'
      ? chalk.yellow('○')
      : chalk.red('✗');
    
    console.log(`  ${icon} ${chalk.bold(result.feature)}: ${result.message}`);
  }

  console.log();

  // Next steps
  const addedFeatures = results.filter(r => r.status === 'added' || r.status === 'updated');
  if (addedFeatures.length > 0) {
    console.log(chalk.blue('Next steps:\n'));
    
    if (addedFeatures.some(f => f.feature === 'scan')) {
      console.log(chalk.gray('  • Generate the scan index:'));
      console.log(chalk.cyan('    horizon index\n'));
    }
    
    if (addedFeatures.some(f => f.feature === 'logger')) {
      console.log(chalk.gray('  • Review the logger spec:'));
      console.log(chalk.cyan('    .horizon/specs/logger.md\n'));
    }
    
    console.log(chalk.gray('  • Verify setup:'));
    console.log(chalk.cyan('    horizon doctor\n'));
  }
}

/**
 * Migrate from .horizon file to .horizon/ directory
 */
async function migrateLegacy(
  rootDir: string,
  projectName: string,
  options: UpgradeOptions,
  spinner: ora.Ora
): Promise<UpgradeResult> {
  const horizonFile = path.join(rootDir, '.horizon');
  const horizonDir = path.join(rootDir, '.horizon');
  const templatesDir = getTemplatesDir();

  if (options.dryRun) {
    return {
      feature: 'migrate',
      status: 'updated',
      message: 'Would migrate .horizon file to .horizon/ directory',
    };
  }

  spinner.start('Migrating .horizon file to directory...');

  try {
    // Read existing config
    const existingContent = fs.readFileSync(horizonFile, 'utf8');
    let existingConfig: HorizonConfig | null = null;
    
    try {
      existingConfig = parseHorizonConfig(existingContent);
    } catch {
      // Old config might not be valid, we'll use default
    }

    // Backup old file
    const backupPath = path.join(rootDir, '.horizon.backup');
    fs.copyFileSync(horizonFile, backupPath);

    // Remove old file
    fs.unlinkSync(horizonFile);

    // Create new directory structure
    fs.mkdirSync(horizonDir, { recursive: true });
    fs.mkdirSync(path.join(horizonDir, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(horizonDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(horizonDir, 'prompts'), { recursive: true });

    // Copy templates or create minimal structure
    if (fs.existsSync(templatesDir)) {
      copyTemplates(templatesDir, horizonDir, projectName);
    } else {
      // Create minimal config
      const config = existingConfig || parseHorizonConfig(`
version: "1.0"
project: "${projectName}"
agent-guidelines:
  overview: |
    This project uses Horizon for structured AI-assisted development.
symbol-system:
  "@": { name: Feature, description: User-facing capabilities, owner: purpose, examples: ["@login"] }
logging:
  enforce: true
scan:
  enabled: true
conventions: []
`);
      fs.writeFileSync(
        path.join(horizonDir, 'config.yaml'),
        serializeHorizonConfig(config),
        'utf8'
      );
    }

    // Migrate scan index if it exists
    const oldScanIndex = path.join(rootDir, '.horizon-scan-index.json');
    const newScanIndex = path.join(horizonDir, 'scan-index.json');
    if (fs.existsSync(oldScanIndex)) {
      fs.renameSync(oldScanIndex, newScanIndex);
    }

    spinner.succeed(chalk.green('Migrated to .horizon/ directory'));
    
    return {
      feature: 'migrate',
      status: 'updated',
      message: 'Converted to directory format (backup at .horizon.backup)',
    };
  } catch (err) {
    spinner.fail(chalk.red('Migration failed'));
    return {
      feature: 'migrate',
      status: 'error',
      message: (err as Error).message,
    };
  }
}

/**
 * Upgrade: Add scan feature
 */
async function upgradeScan(
  rootDir: string,
  projectName: string,
  options: UpgradeOptions,
  spinner: ora.Ora
): Promise<UpgradeResult> {
  const horizonDir = path.join(rootDir, '.horizon');
  const scanIndexPath = path.join(horizonDir, 'scan-index.json');
  const scanSpecPath = path.join(horizonDir, 'specs', 'scan.md');
  const templatesDir = getTemplatesDir();

  // Check if scan is already set up
  if (fs.existsSync(scanIndexPath) && fs.existsSync(scanSpecPath) && !options.force) {
    return {
      feature: 'scan',
      status: 'skipped',
      message: 'Already configured (use --force to reconfigure)',
    };
  }

  if (options.dryRun) {
    return {
      feature: 'scan',
      status: 'added',
      message: 'Would add scan spec and index placeholder',
    };
  }

  spinner.start('Setting up horizon scan...');

  try {
    // Ensure directories exist
    fs.mkdirSync(path.join(horizonDir, 'specs'), { recursive: true });

    // Copy scan spec from templates
    const templateScanSpec = path.join(templatesDir, 'specs', 'scan.md');
    if (fs.existsSync(templateScanSpec)) {
      fs.copyFileSync(templateScanSpec, scanSpecPath);
    }

    // Create placeholder scan index
    if (!fs.existsSync(scanIndexPath)) {
      const placeholderIndex = {
        $meta: {
          version: '1.0.0',
          project: projectName,
          generatedAt: new Date().toISOString(),
          horizonVersion: '0.2.0',
          sources: { purposeFiles: 0, gateFiles: 0, dreamFiles: 0 },
        },
        components: {},
        features: {},
        flows: {},
        state: {},
        gates: {},
        signals: {},
        screens: {},
        symbolMap: {},
        _placeholder: true,
        _message: 'Run `horizon index` to populate this index',
      };

      fs.writeFileSync(scanIndexPath, JSON.stringify(placeholderIndex, null, 2), 'utf8');
    }

    spinner.succeed(chalk.green('Scan feature configured'));

    return {
      feature: 'scan',
      status: 'added',
      message: 'Added scan spec and index placeholder',
    };
  } catch (err) {
    spinner.fail(chalk.red('Failed to configure scan'));
    return {
      feature: 'scan',
      status: 'error',
      message: (err as Error).message,
    };
  }
}

/**
 * Upgrade: Add logger spec
 */
async function upgradeLogger(
  rootDir: string,
  options: UpgradeOptions,
  spinner: ora.Ora
): Promise<UpgradeResult> {
  const horizonDir = path.join(rootDir, '.horizon');
  const loggerSpecPath = path.join(horizonDir, 'specs', 'logger.md');
  const templatesDir = getTemplatesDir();

  // Check if logger spec exists
  if (fs.existsSync(loggerSpecPath) && !options.force) {
    return {
      feature: 'logger',
      status: 'skipped',
      message: 'Already configured (use --force to reconfigure)',
    };
  }

  if (options.dryRun) {
    return {
      feature: 'logger',
      status: 'added',
      message: 'Would add logger specification',
    };
  }

  spinner.start('Setting up logger spec...');

  try {
    // Ensure directories exist
    fs.mkdirSync(path.join(horizonDir, 'specs'), { recursive: true });

    // Copy logger spec from templates
    const templateLoggerSpec = path.join(templatesDir, 'specs', 'logger.md');
    if (fs.existsSync(templateLoggerSpec)) {
      fs.copyFileSync(templateLoggerSpec, loggerSpecPath);
    } else {
      // Create minimal logger spec
      const minimalSpec = `# Horizon Logger Specification

Use the Horizon logger instead of raw console.log/print statements.

## API

\`\`\`
log.feature('@login').info('Starting login', { email })
log.component('#database').debug('Query executed', { duration })
log.gate('^authenticated').warn('Access denied', { userId })
log.signal('!login-success').info('User authenticated')
\`\`\`

## Log Levels

- \`debug\` - Verbose debugging info
- \`info\` - General information
- \`warn\` - Warning conditions
- \`error\` - Error conditions

See full specification for implementation details.
`;
      fs.writeFileSync(loggerSpecPath, minimalSpec, 'utf8');
    }

    spinner.succeed(chalk.green('Logger spec configured'));

    return {
      feature: 'logger',
      status: 'added',
      message: 'Added logger specification',
    };
  } catch (err) {
    spinner.fail(chalk.red('Failed to configure logger'));
    return {
      feature: 'logger',
      status: 'error',
      message: (err as Error).message,
    };
  }
}

/**
 * Copy templates recursively
 */
function copyTemplates(src: string, dest: string, projectName: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyTemplates(srcPath, destPath, projectName);
    } else {
      // Don't overwrite existing files
      if (!fs.existsSync(destPath)) {
        let content = fs.readFileSync(srcPath, 'utf8');
        content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
        fs.writeFileSync(destPath, content, 'utf8');
      }
    }
  }
}

/**
 * Check which upgrades are available for a project
 */
export function getAvailableUpgrades(rootDir: string): UpgradeFeature[] {
  const available: UpgradeFeature[] = [];
  const horizonPath = path.join(rootDir, '.horizon');
  
  if (!fs.existsSync(horizonPath)) {
    return available;
  }
  
  const isLegacyFile = fs.statSync(horizonPath).isFile();
  
  if (isLegacyFile) {
    available.push('migrate');
    return available; // Migration is prerequisite for others
  }
  
  const horizonDir = horizonPath;
  
  // Check for scan
  const scanIndexPath = path.join(horizonDir, 'scan-index.json');
  if (!fs.existsSync(scanIndexPath)) {
    available.push('scan');
  }
  
  // Check for logger
  const loggerSpecPath = path.join(horizonDir, 'specs', 'logger.md');
  if (!fs.existsSync(loggerSpecPath)) {
    available.push('logger');
  }

  return available;
}
