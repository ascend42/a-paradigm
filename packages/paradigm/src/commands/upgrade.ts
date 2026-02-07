/**
 * paradigm upgrade - Patch existing projects with new Paradigm features
 * Handles migration from legacy .paradigm file to .paradigm/ directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { parseParadigmConfig, serializeParadigmConfig, type ParadigmConfig } from '../core/paradigm-config.js';
import { loadParadigmFiles, syncToIDE, detectIDE } from '../core/ide-adapters/index.js';

interface UpgradeOptions {
  features?: string[];
  all?: boolean;
  fromHorizon?: boolean;
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
    path.join(__dirname, '..', '..', 'templates', 'paradigm'),
    path.join(__dirname, '..', 'templates', 'paradigm'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return path.join(__dirname, '..', 'templates', 'paradigm');
}

export async function upgradeCommand(targetPath: string | undefined, options: UpgradeOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  const spinner = ora();

  console.log(chalk.blue('\n🔄 Paradigm Upgrade\n'));

  // Handle --from-horizon migration
  if (options.fromHorizon) {
    const result = await migrateFromHorizon(rootDir, projectName, options, spinner);
    console.log(chalk.blue('\n📋 Migration Summary\n'));
    const icon = result.status === 'added' || result.status === 'updated' 
      ? chalk.green('✓')
      : result.status === 'skipped'
      ? chalk.yellow('○')
      : chalk.red('✗');
    console.log(`  ${icon} ${chalk.bold(result.feature)}: ${result.message}`);
    console.log();
    
    if (result.status === 'updated' || result.status === 'added') {
      console.log(chalk.blue('Next steps:\n'));
      console.log(chalk.gray('  • Verify the migration:'));
      console.log(chalk.cyan('    paradigm doctor\n'));
      console.log(chalk.gray('  • Regenerate IDE files:'));
      console.log(chalk.cyan('    paradigm sync\n'));
    }
    return;
  }

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
    console.log(chalk.cyan('  migrate') + chalk.gray('      - Migrate from .paradigm file to .paradigm/ directory'));
    console.log(chalk.cyan('  scan') + chalk.gray('         - Add visual discovery (paradigm probe) support'));
    console.log(chalk.cyan('  logger') + chalk.gray('       - Add Paradigm logger specification'));
    console.log(chalk.cyan('  all') + chalk.gray('          - Apply all available upgrades'));
    console.log(chalk.cyan('  --from-horizon') + chalk.gray(' - Migrate from Horizon to Paradigm'));
    console.log();
    console.log(chalk.gray('Usage:'));
    console.log(chalk.gray('  paradigm upgrade --features scan'));
    console.log(chalk.gray('  paradigm upgrade --features logger'));
    console.log(chalk.gray('  paradigm upgrade --all'));
    console.log(chalk.gray('  paradigm upgrade --from-horizon'));
    console.log();
    return;
  }

  const results: UpgradeResult[] = [];
  const paradigmPath = path.join(rootDir, '.paradigm');
  
  // Check current state
  const exists = fs.existsSync(paradigmPath);
  const isLegacyFile = exists && fs.statSync(paradigmPath).isFile();
  const isDirectory = exists && fs.statSync(paradigmPath).isDirectory();

  // Process migration first if needed
  if (features.includes('migrate') || (isLegacyFile && options.all)) {
    if (isLegacyFile) {
      results.push(await migrateLegacy(rootDir, projectName, options, spinner));
    } else if (isDirectory) {
      results.push({
        feature: 'migrate',
        status: 'skipped',
        message: 'Already using .paradigm/ directory format',
      });
    } else {
      results.push({
        feature: 'migrate',
        status: 'error',
        message: 'No .paradigm found to migrate',
      });
    }
  }

  // Ensure we have a .paradigm directory for other upgrades
  const paradigmDir = path.join(rootDir, '.paradigm');
  const hasParadigmDir = fs.existsSync(paradigmDir) && fs.statSync(paradigmDir).isDirectory();

  if (!hasParadigmDir && !options.dryRun) {
    // Need to run init or migrate first
    if (!isLegacyFile) {
      console.log(chalk.yellow('⚠️  No .paradigm/ directory found.'));
      console.log(chalk.gray('   Run `paradigm init` first to initialize Paradigm.\n'));
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
    
    const files = loadParadigmFiles(rootDir);
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
        spinner.info('No IDE detected, run `paradigm sync` to generate IDE files');
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
      console.log(chalk.cyan('    paradigm index\n'));
    }
    
    if (addedFeatures.some(f => f.feature === 'logger')) {
      console.log(chalk.gray('  • Review the logger spec:'));
      console.log(chalk.cyan('    .paradigm/specs/logger.md\n'));
    }
    
    console.log(chalk.gray('  • Verify setup:'));
    console.log(chalk.cyan('    paradigm doctor\n'));
  }
}

/**
 * Migrate from .paradigm file to .paradigm/ directory
 */
async function migrateLegacy(
  rootDir: string,
  projectName: string,
  options: UpgradeOptions,
  spinner: ReturnType<typeof ora>
): Promise<UpgradeResult> {
  const paradigmFile = path.join(rootDir, '.paradigm');
  const paradigmDir = path.join(rootDir, '.paradigm');
  const templatesDir = getTemplatesDir();

  if (options.dryRun) {
    return {
      feature: 'migrate',
      status: 'updated',
      message: 'Would migrate .paradigm file to .paradigm/ directory',
    };
  }

  spinner.start('Migrating .paradigm file to directory...');

  try {
    // Read existing config
    const existingContent = fs.readFileSync(paradigmFile, 'utf8');
    let existingConfig: ParadigmConfig | null = null;
    
    try {
      existingConfig = parseParadigmConfig(existingContent);
    } catch {
      // Old config might not be valid, we'll use default
    }

    // Backup old file
    const backupPath = path.join(rootDir, '.paradigm.backup');
    fs.copyFileSync(paradigmFile, backupPath);

    // Remove old file
    fs.unlinkSync(paradigmFile);

    // Create new directory structure
    fs.mkdirSync(paradigmDir, { recursive: true });
    fs.mkdirSync(path.join(paradigmDir, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(paradigmDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(paradigmDir, 'prompts'), { recursive: true });

    // Copy templates or create minimal structure
    if (fs.existsSync(templatesDir)) {
      copyTemplates(templatesDir, paradigmDir, projectName);
    } else {
      // Create minimal config
      const config = existingConfig || parseParadigmConfig(`
version: "1.0"
project: "${projectName}"
agent-guidelines:
  overview: |
    This project uses Paradigm for structured AI-assisted development.
symbol-system:
  "@": { name: Feature, description: User-facing capabilities, owner: purpose, examples: ["@login"] }
logging:
  enforce: true
scan:
  enabled: true
conventions: []
`);
      fs.writeFileSync(
        path.join(paradigmDir, 'config.yaml'),
        serializeParadigmConfig(config),
        'utf8'
      );
    }

    // Migrate scan index if it exists
    const oldScanIndex = path.join(rootDir, '.paradigm-scan-index.json');
    const newScanIndex = path.join(paradigmDir, 'scan-index.json');
    if (fs.existsSync(oldScanIndex)) {
      fs.renameSync(oldScanIndex, newScanIndex);
    }

    spinner.succeed(chalk.green('Migrated to .paradigm/ directory'));
    
    return {
      feature: 'migrate',
      status: 'updated',
      message: 'Converted to directory format (backup at .paradigm.backup)',
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
  spinner: ReturnType<typeof ora>
): Promise<UpgradeResult> {
  const paradigmDir = path.join(rootDir, '.paradigm');
  const scanIndexPath = path.join(paradigmDir, 'scan-index.json');
  const scanSpecPath = path.join(paradigmDir, 'specs', 'scan.md');
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

  spinner.start('Setting up paradigm scan...');

  try {
    // Ensure directories exist
    fs.mkdirSync(path.join(paradigmDir, 'specs'), { recursive: true });

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
          paradigmVersion: '0.2.0',
          sources: { purposeFiles: 0, portalFiles: 0, premiseFiles: 0 },
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
        _message: 'Run `paradigm index` to populate this index',
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
  spinner: ReturnType<typeof ora>
): Promise<UpgradeResult> {
  const paradigmDir = path.join(rootDir, '.paradigm');
  const loggerSpecPath = path.join(paradigmDir, 'specs', 'logger.md');
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
    fs.mkdirSync(path.join(paradigmDir, 'specs'), { recursive: true });

    // Copy logger spec from templates
    const templateLoggerSpec = path.join(templatesDir, 'specs', 'logger.md');
    if (fs.existsSync(templateLoggerSpec)) {
      fs.copyFileSync(templateLoggerSpec, loggerSpecPath);
    } else {
      // Create minimal logger spec
      const minimalSpec = `# Paradigm Logger Specification

Use the Paradigm logger instead of raw console.log/print statements.

## API

\`\`\`
log.component('#login-handler').info('Starting login', { email })
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
 * Migrate from Horizon to Paradigm naming
 */
async function migrateFromHorizon(
  rootDir: string,
  _projectName: string,
  options: UpgradeOptions,
  spinner: ReturnType<typeof ora>
): Promise<UpgradeResult> {
  const horizonDir = path.join(rootDir, '.horizon');
  const paradigmDir = path.join(rootDir, '.paradigm');
  
  // Check if there's a Horizon setup to migrate
  if (!fs.existsSync(horizonDir)) {
    return {
      feature: 'from-horizon',
      status: 'skipped',
      message: 'No .horizon directory found to migrate',
    };
  }
  
  // Check if already migrated
  if (fs.existsSync(paradigmDir) && !options.force) {
    return {
      feature: 'from-horizon',
      status: 'skipped',
      message: '.paradigm already exists (use --force to overwrite)',
    };
  }
  
  if (options.dryRun) {
    console.log(chalk.cyan('\nDry run - would perform the following:\n'));
    console.log(chalk.gray('  • Rename .horizon/ → .paradigm/'));
    
    // Check for gate.yaml files
    const gateFiles = findFiles(rootDir, 'gate.yaml');
    if (gateFiles.length > 0) {
      console.log(chalk.gray(`  • Rename ${gateFiles.length} gate.yaml → portal.yaml`));
    }
    
    // Check for .dream files
    const dreamFiles = findFiles(rootDir, '.dream');
    if (dreamFiles.length > 0) {
      console.log(chalk.gray(`  • Rename ${dreamFiles.length} .dream → .premise`));
    }
    
    console.log(chalk.gray('  • Update content references (horizon→paradigm, gate→portal, dream→premise)'));
    console.log();
    
    return {
      feature: 'from-horizon',
      status: 'updated',
      message: 'Would migrate Horizon to Paradigm (dry run)',
    };
  }
  
  spinner.start('Migrating from Horizon to Paradigm...');
  
  try {
    // 1. Rename .horizon/ to .paradigm/
    if (fs.existsSync(horizonDir)) {
      if (fs.existsSync(paradigmDir)) {
        // Backup existing .paradigm
        const backupDir = path.join(rootDir, '.paradigm.backup-' + Date.now());
        fs.renameSync(paradigmDir, backupDir);
        spinner.text = 'Backed up existing .paradigm...';
      }
      fs.renameSync(horizonDir, paradigmDir);
      spinner.text = 'Renamed .horizon to .paradigm...';
    }
    
    // 2. Rename gate.yaml files to portal.yaml
    spinner.text = 'Renaming gate.yaml files...';
    const gateFiles = findFiles(rootDir, 'gate.yaml');
    for (const gateFile of gateFiles) {
      const dir = path.dirname(gateFile);
      const newPath = path.join(dir, 'portal.yaml');
      fs.renameSync(gateFile, newPath);
      
      // Update content
      let content = fs.readFileSync(newPath, 'utf8');
      content = updateContent(content);
      fs.writeFileSync(newPath, content, 'utf8');
    }
    
    // 3. Rename .dream files to .premise
    spinner.text = 'Renaming .dream files...';
    const dreamFiles = findFiles(rootDir, '.dream');
    for (const dreamFile of dreamFiles) {
      const dir = path.dirname(dreamFile);
      const newPath = path.join(dir, '.premise');
      fs.renameSync(dreamFile, newPath);
      
      // Update content
      let content = fs.readFileSync(newPath, 'utf8');
      content = updateContent(content);
      fs.writeFileSync(newPath, content, 'utf8');
    }
    
    // 4. Update content in .paradigm/ files
    spinner.text = 'Updating file contents...';
    if (fs.existsSync(paradigmDir)) {
      updateDirectoryContents(paradigmDir);
    }
    
    // 5. Rename scan-index.json to probe-index.json if exists
    const scanIndex = path.join(paradigmDir, 'scan-index.json');
    const probeIndex = path.join(paradigmDir, 'probe-index.json');
    if (fs.existsSync(scanIndex)) {
      let content = fs.readFileSync(scanIndex, 'utf8');
      content = updateContent(content);
      fs.writeFileSync(probeIndex, content, 'utf8');
      fs.unlinkSync(scanIndex);
    }
    
    // 6. Update .purpose files content (but don't rename)
    spinner.text = 'Updating .purpose file contents...';
    const purposeFiles = findFiles(rootDir, '.purpose');
    for (const purposeFile of purposeFiles) {
      let content = fs.readFileSync(purposeFile, 'utf8');
      const updated = updateContent(content);
      if (updated !== content) {
        fs.writeFileSync(purposeFile, updated, 'utf8');
      }
    }
    
    // 7. Update IDE instruction files
    spinner.text = 'Updating IDE instruction files...';
    const ideFiles = ['.cursorrules', '.windsurfrules', '.github/copilot-instructions.md'];
    for (const ideFile of ideFiles) {
      const fullPath = path.join(rootDir, ideFile);
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf8');
        content = updateContent(content);
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
    
    spinner.succeed(chalk.green('Migration complete!'));
    
    return {
      feature: 'from-horizon',
      status: 'updated',
      message: `Migrated: ${gateFiles.length} portal files, ${dreamFiles.length} premise files`,
    };
  } catch (err) {
    spinner.fail(chalk.red('Migration failed'));
    return {
      feature: 'from-horizon',
      status: 'error',
      message: (err as Error).message,
    };
  }
}

/**
 * Find files with a specific name recursively
 */
function findFiles(dir: string, filename: string): string[] {
  const results: string[] = [];
  
  // Skip node_modules and hidden dirs (except .horizon)
  const skipDirs = ['node_modules', '.git', 'dist', 'build', '.paradigm'];
  
  function walk(currentDir: string) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            walk(fullPath);
          }
        } else if (entry.name === filename) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
  
  walk(dir);
  return results;
}

/**
 * Update content with Horizon → Paradigm replacements
 */
function updateContent(content: string): string {
  return content
    // Framework name
    .replace(/Horizon/g, 'Paradigm')
    .replace(/horizon/g, 'paradigm')
    // Module names
    .replace(/Dreamscape/g, 'Prism')
    .replace(/dreamscape/g, 'prism')
    .replace(/Dream\b/g, 'Premise')
    .replace(/dream\b/g, 'premise')
    .replace(/\bGate\b/g, 'Portal')
    .replace(/\bgate\b/g, 'portal')
    .replace(/\bScan\b/g, 'Probe')
    .replace(/\bscan\b/g, 'probe')
    // File names
    .replace(/gate\.yaml/g, 'portal.yaml')
    .replace(/\.dream\b/g, '.premise')
    .replace(/scan-index\.json/g, 'probe-index.json')
    // Folder names
    .replace(/\.horizon\//g, '.paradigm/')
    .replace(/\.horizon$/g, '.paradigm')
    // Environment variables
    .replace(/HORIZON_SYMBOLS/g, 'PARADIGM_SYMBOLS');
}

/**
 * Recursively update file contents in a directory
 */
function updateDirectoryContents(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      updateDirectoryContents(fullPath);
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const updated = updateContent(content);
      if (updated !== content) {
        fs.writeFileSync(fullPath, updated, 'utf8');
      }
    }
  }
}

/**
 * Check which upgrades are available for a project
 */
export function getAvailableUpgrades(rootDir: string): UpgradeFeature[] {
  const available: UpgradeFeature[] = [];
  const paradigmPath = path.join(rootDir, '.paradigm');
  
  if (!fs.existsSync(paradigmPath)) {
    return available;
  }
  
  const isLegacyFile = fs.statSync(paradigmPath).isFile();
  
  if (isLegacyFile) {
    available.push('migrate');
    return available; // Migration is prerequisite for others
  }
  
  const paradigmDir = paradigmPath;
  
  // Check for scan
  const scanIndexPath = path.join(paradigmDir, 'scan-index.json');
  if (!fs.existsSync(scanIndexPath)) {
    available.push('scan');
  }
  
  // Check for logger
  const loggerSpecPath = path.join(paradigmDir, 'specs', 'logger.md');
  if (!fs.existsSync(loggerSpecPath)) {
    available.push('logger');
  }

  return available;
}
