/**
 * paradigm setup - Interactive setup wizard
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { log } from '../utils/logger.js';
import { 
  ParadigmConfig, 
  getDefaultParadigmConfig, 
  serializeParadigmConfig,
  DEFAULT_SYMBOL_SYSTEM,
  DEFAULT_CONVENTIONS
} from '../core/paradigm-config.js';
import { writeCursorrules, cursorrrulesExists, CursorRulesMode } from '../core/cursorrules.js';
import { getDefaultPurposeContent } from '@a-company/purpose-core';
import { getDefaultPremiseContent } from '@a-company/premise-core';

interface SetupAnswers {
  sourceDir?: string;
  directories?: string[];
  hasAuth?: string;
  hasSubscription?: string;
  hasGates?: string;
  customStates?: string;
  cursorMode?: string;
}

/**
 * Create readline interface
 */
function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askSelect(
  rl: readline.Interface, 
  message: string, 
  choices: { name: string; value: string }[]
): Promise<string> {
  console.log(`\n${chalk.cyan(message)}`);
  choices.forEach((choice, i) => {
    console.log(chalk.gray(`  ${i + 1}) `) + choice.name);
  });
  
  const answer = await ask(rl, chalk.white(`Enter number (1-${choices.length}): `));
  const index = parseInt(answer, 10) - 1;
  
  if (index >= 0 && index < choices.length) {
    return choices[index].value;
  }
  
  return choices[0].value;
}

async function askMultiSelect(
  rl: readline.Interface, 
  message: string, 
  choices: { name: string; value: string }[]
): Promise<string[]> {
  console.log(`\n${chalk.cyan(message)}`);
  choices.forEach((choice, i) => {
    console.log(chalk.gray(`  ${i + 1}) `) + choice.name);
  });
  
  const answer = await ask(rl, chalk.white(`Enter numbers separated by commas (e.g., 1,2,3): `));
  const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1);
  
  return indices
    .filter(i => i >= 0 && i < choices.length)
    .map(i => choices[i].value);
}

/**
 * Detect project structure
 */
function detectProjectStructure(rootDir: string): { sourceDir?: string; directories?: string[] } {
  const result: { sourceDir?: string; directories?: string[] } = {};
  
  // Check for common source directories
  for (const dir of ['src', 'app', 'lib', 'packages']) {
    if (fs.existsSync(path.join(rootDir, dir))) {
      result.sourceDir = dir;
      break;
    }
  }
  
  // Check for subdirectories
  if (result.sourceDir) {
    const srcPath = path.join(rootDir, result.sourceDir);
    try {
      const entries = fs.readdirSync(srcPath, { withFileTypes: true });
      result.directories = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(name => !name.startsWith('.') && !name.startsWith('_'));
    } catch {
      // Ignore errors
    }
  }
  
  return result;
}

/**
 * Generate config from answers
 */
function generateConfigFromAnswers(answers: SetupAnswers, projectName: string): ParadigmConfig {
  const config: ParadigmConfig = {
    version: '1.0',
    'agent-guidelines': {
      overview: `${projectName} uses Paradigm for structured AI context management.`,
      'how-to-use': [
        'Check .purpose files in directories before making changes',
        'Run `paradigm status` to see all symbols in the project',
        'Run `paradigm visualize` to explore the Dreamscape',
        'Reference symbols using @ # $ % ~ ^ ! ? prefixes'
      ],
      'update-rules': [
        'When adding a feature, create/update the nearest .purpose file',
        'When adding authorization, update portal.yaml',
        'When exploring ideas, add to .premise with ? prefix',
        'Run `paradigm cursorrules` after updating .paradigm'
      ]
    },
    'symbol-system': DEFAULT_SYMBOL_SYSTEM,
    states: {},
    'purpose-required': [],
    conventions: DEFAULT_CONVENTIONS
  };

  // Add states based on answers
  if (answers.hasAuth && answers.hasAuth !== 'none') {
    config.states.user = {
      authenticated: { type: 'boolean', default: false, description: 'User is logged in' },
      role: { type: 'enum', values: ['guest', 'user', 'admin'], description: 'User access level' }
    };
    
    if (answers.hasAuth === 'session') {
      config.states.user.sessionExpiry = { type: 'string', description: 'Session expiration time' };
    }
  }

  if (answers.hasSubscription && answers.hasSubscription !== 'none') {
    if (!config.states.user) config.states.user = {};
    
    if (answers.hasSubscription === 'tiers') {
      config.states.user.subscription = { 
        type: 'enum', 
        values: ['free', 'trial', 'pro', 'enterprise'], 
        description: 'Subscription tier' 
      };
    } else {
      config.states.user.isPremium = { type: 'boolean', default: false, description: 'Has premium access' };
    }
  }

  if (answers.hasGates === 'yes') {
    config['agent-guidelines']['how-to-use'].push(
      'Check portal.yaml for authorization rules before modifying access control'
    );
  }

  // Add purpose-required directories
  if (answers.directories && answers.directories.length > 0 && answers.sourceDir) {
    config['purpose-required'] = answers.directories.map(dir => ({
      pattern: `${answers.sourceDir}/${dir}/*`,
      depth: 1
    }));
  }

  // Add custom states
  if (answers.customStates) {
    const customParts = answers.customStates.split(',').map(s => s.trim()).filter(Boolean);
    for (const custom of customParts) {
      const parts = custom.split('.');
      if (parts.length >= 2) {
        const category = parts[0];
        const stateName = parts.slice(1).join('.');
        if (!config.states[category]) {
          config.states[category] = {};
        }
        (config.states[category] as Record<string, unknown>)[stateName] = { 
          type: 'boolean', 
          description: `Custom state: ${custom}` 
        };
      }
    }
  }

  return config;
}

/**
 * Run interactive setup
 */
async function runInteractiveSetup(rootDir: string): Promise<SetupAnswers> {
  const rl = createPrompt();
  const answers: SetupAnswers = {};
  
  console.log(chalk.blue('\n🌅 Paradigm Setup Wizard\n'));
  console.log(chalk.gray('─'.repeat(55)));
  
  // Detect existing structure
  const detected = detectProjectStructure(rootDir);
  console.log(chalk.white('\n📂 Detected project structure:'));
  if (detected.sourceDir) {
    console.log(chalk.gray(`   Source directory: ${detected.sourceDir}/`));
  }
  if (detected.directories?.length) {
    console.log(chalk.gray(`   Subdirectories: ${detected.directories.slice(0, 5).join(', ')}${detected.directories.length > 5 ? '...' : ''}`));
  }
  
  // Source directory
  console.log(chalk.gray('\n─'.repeat(55)));
  console.log(chalk.white('\n📁 Project Structure\n'));
  
  answers.sourceDir = await askSelect(rl, 'What is your main source directory?', [
    { name: `${detected.sourceDir || 'src'}/ (detected)`, value: detected.sourceDir || 'src' },
    { name: 'src/', value: 'src' },
    { name: 'app/', value: 'app' },
    { name: 'lib/', value: 'lib' },
    { name: 'packages/', value: 'packages' },
  ]);
  
  // Directories
  answers.directories = await askMultiSelect(rl, 'Which directories should have .purpose files?', [
    { name: 'features/ (user-facing capabilities)', value: 'features' },
    { name: 'components/ (reusable UI/code)', value: 'components' },
    { name: 'services/ (business logic)', value: 'services' },
    { name: 'routes/ or api/ (endpoints)', value: 'routes' },
    { name: 'pages/ (page components)', value: 'pages' },
    { name: 'lib/ (utilities)', value: 'lib' },
  ]);
  
  // States
  console.log(chalk.gray('\n─'.repeat(55)));
  console.log(chalk.white('\n🔐 State Tracking\n'));
  
  answers.hasAuth = await askSelect(rl, 'Does your app have user authentication?', [
    { name: 'Yes, with sessions/JWT', value: 'session' },
    { name: 'Yes, OAuth only', value: 'oauth' },
    { name: 'No authentication', value: 'none' },
  ]);
  
  answers.hasSubscription = await askSelect(rl, 'Do you have subscription tiers or paid features?', [
    { name: 'Yes (multiple tiers: free, pro, enterprise)', value: 'tiers' },
    { name: 'Yes (single paid tier)', value: 'single' },
    { name: 'No paid features', value: 'none' },
  ]);
  
  // Gates
  console.log(chalk.gray('\n─'.repeat(55)));
  console.log(chalk.white('\n🚪 Authorization Gates\n'));
  
  answers.hasGates = await askSelect(rl, 'Will you use Gate for authorization topology?', [
    { name: 'Yes - I have role-based or feature-gated access', value: 'yes' },
    { name: 'No - simple or no authorization', value: 'no' },
  ]);
  
  // Custom states
  console.log('\n');
  answers.customStates = await ask(
    rl, 
    chalk.cyan('Any custom states to track? ') + 
    chalk.gray('(comma-separated, e.g., app.maintenance, cart.items)\n') +
    chalk.white('> ')
  );
  
  // Cursor integration
  console.log(chalk.gray('\n─'.repeat(55)));
  console.log(chalk.white('\n🤖 Cursor Integration\n'));
  
  const hasCursorrules = cursorrrulesExists(rootDir);
  
  if (hasCursorrules) {
    answers.cursorMode = await askSelect(rl, 'A .cursorrules file exists. How should we handle it?', [
      { name: 'Append Paradigm section to existing file', value: 'append' },
      { name: 'Replace with new .cursorrules', value: 'create' },
      { name: 'Skip - do not modify .cursorrules', value: 'skip' },
    ]);
  } else {
    answers.cursorMode = await askSelect(rl, 'Generate a .cursorrules file for Cursor AI?', [
      { name: 'Yes - create .cursorrules with Paradigm context', value: 'create' },
      { name: 'No - skip Cursor integration', value: 'skip' },
    ]);
  }
  
  rl.close();
  return answers;
}

interface SetupOptions {
  yes?: boolean;
  force?: boolean;
}

export async function setupCommand(targetPath: string | undefined, options: SetupOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  
  // Check if already initialized
  const paradigmPath = path.join(rootDir, '.paradigm');
  if (fs.existsSync(paradigmPath) && !options.force) {
    console.log(chalk.yellow('\n⚠️  .paradigm already exists in this directory.'));
    console.log(chalk.gray('   Use --force to overwrite, or edit .paradigm directly.\n'));
    return;
  }
  
  let answers: SetupAnswers;
  
  if (options.yes) {
    // Use defaults
    const detected = detectProjectStructure(rootDir);
    answers = {
      sourceDir: detected.sourceDir || 'src',
      directories: ['features', 'components'],
      hasAuth: 'session',
      hasSubscription: 'none',
      hasGates: 'yes',
      cursorMode: 'create'
    };
    console.log(chalk.blue('\n🌅 Using default configuration...\n'));
  } else {
    // Interactive setup
    answers = await runInteractiveSetup(rootDir);
  }
  
  // Generate config
  const config = generateConfigFromAnswers(answers, projectName);
  
  // Write .paradigm
  fs.writeFileSync(paradigmPath, serializeParadigmConfig(config), 'utf8');
  console.log(chalk.green('\n✅ Created .paradigm configuration'));
  
  // Write .premise if it doesn't exist
  const premisePath = path.join(rootDir, '.premise');
  if (!fs.existsSync(premisePath)) {
    fs.writeFileSync(premisePath, getDefaultPremiseContent(projectName), 'utf8');
    console.log(chalk.green('✅ Created .premise file'));
  }
  
  // Write .purpose if it doesn't exist
  const purposePath = path.join(rootDir, '.purpose');
  if (!fs.existsSync(purposePath)) {
    fs.writeFileSync(purposePath, getDefaultPurposeContent(), 'utf8');
    console.log(chalk.green('✅ Created .purpose file'));
  }
  
  // Write portal.yaml if gates are enabled and doesn't exist
  const gatePath = path.join(rootDir, 'portal.yaml');
  if (answers.hasGates === 'yes' && !fs.existsSync(gatePath)) {
    const { getDefaultGateConfig } = await import('@a-company/portal-core');
    fs.writeFileSync(gatePath, getDefaultGateConfig(), 'utf8');
    console.log(chalk.green('✅ Created portal.yaml'));
  }
  
  // Generate .cursorrules
  const cursorMode = (answers.cursorMode || 'skip') as CursorRulesMode;
  if (cursorMode !== 'skip') {
    const result = writeCursorrules(rootDir, config, cursorMode, projectName);
    if (result.success && result.path) {
      console.log(chalk.green(`✅ ${result.message}`));
    }
  }
  
  // Summary
  console.log(chalk.gray('\n─'.repeat(55)));
  console.log(chalk.blue('\n🎉 Paradigm setup complete!\n'));
  console.log(chalk.white('Files created:'));
  console.log(chalk.gray('  • .paradigm      ') + chalk.white('AI guidelines, symbols, states'));
  console.log(chalk.gray('  • .premise        ') + chalk.white('Project overview & ideas'));
  console.log(chalk.gray('  • .purpose      ') + chalk.white('Root context & features'));
  if (answers.hasGates === 'yes') {
    console.log(chalk.gray('  • portal.yaml     ') + chalk.white('Authorization topology'));
  }
  if (cursorMode !== 'skip') {
    console.log(chalk.gray('  • .cursorrules  ') + chalk.white('Cursor AI integration'));
  }
  
  console.log(chalk.white('\nNext steps:'));
  console.log(chalk.gray('  1. ') + 'Review and customize ' + chalk.cyan('.paradigm'));
  console.log(chalk.gray('  2. ') + 'Edit ' + chalk.cyan('.purpose') + ' to define your project context');
  console.log(chalk.gray('  3. ') + 'Run ' + chalk.cyan('paradigm visualize') + ' to open the Dreamscape');
  console.log(chalk.gray('  4. ') + 'Run ' + chalk.cyan('paradigm cursorrules') + ' after changes to regenerate\n');
}
