/**
 * paradigm init - Initialize Paradigm in a project
 * 
 * Features:
 * - Smart detection of existing IDE instruction files
 * - Migration prompt generation for AI-assisted migration
 * - Interactive setup flow
 * - Multiple init modes (fresh, migrate, minimal)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import { getDefaultPurposeContent } from '@a-company/purpose-core';
import { getDefaultPremiseContent } from '@a-company/premise-core';
import { detectIDE, loadParadigmFiles, syncToIDE } from '../core/ide-adapters/index.js';
import { indexCommand } from './scan/index.js';
import { detectDiscipline, getDisciplineConfig, detectStack, getStackConfig, STACK_PRESETS } from '../core/discipline.js';

// ============================================
// Types
// ============================================

export interface InitOptions {
  force?: boolean;
  name?: string;
  ide?: string;
  migrate?: boolean;
  quick?: boolean;
  dryRun?: boolean;
  /** Explicit stack preset (e.g., 'nextjs', 'fastapi', 'swift-ios') */
  stack?: string;
}

interface DetectedFile {
  path: string;
  lines: number;
  type: 'legacy' | 'modern';
}

interface DetectedIDE {
  name: string;
  displayName: string;
  legacy?: DetectedFile;
  modern?: DetectedFile[];
}

interface DetectionResult {
  ides: DetectedIDE[];
  hasExisting: boolean;
  totalLines: number;
  projectType?: string;
  discipline?: string;
  stack?: string;
}

// ============================================
// Detection Functions
// ============================================

/**
 * Count lines in a file
 */
function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Detect project type for display purposes.
 * Uses stack presets first (precise), falls back to discipline name.
 */
function detectProjectType(rootDir: string): string | undefined {
  const stackId = detectStack(rootDir);
  if (stackId && STACK_PRESETS[stackId]) {
    return STACK_PRESETS[stackId].name;
  }

  const discipline = detectDiscipline(rootDir);
  if (discipline !== 'backend') {
    return discipline.charAt(0).toUpperCase() + discipline.slice(1);
  }
  return undefined;
}

/**
 * Detect existing IDE instruction files
 */
function detectExistingIDEFiles(rootDir: string): DetectionResult {
  const ides: DetectedIDE[] = [];
  let totalLines = 0;

  // Cursor detection
  const cursorIDE: DetectedIDE = { name: 'cursor', displayName: 'Cursor' };
  const cursorLegacy = path.join(rootDir, '.cursorrules');
  const cursorModernDir = path.join(rootDir, '.cursor', 'rules');
  
  if (fs.existsSync(cursorLegacy)) {
    const lines = countLines(cursorLegacy);
    cursorIDE.legacy = { path: '.cursorrules', lines, type: 'legacy' };
    totalLines += lines;
  }
  
  if (fs.existsSync(cursorModernDir)) {
    const files = fs.readdirSync(cursorModernDir).filter(f => f.endsWith('.mdc'));
    if (files.length > 0) {
      cursorIDE.modern = files.map(f => {
        const fullPath = path.join(cursorModernDir, f);
        const lines = countLines(fullPath);
        totalLines += lines;
        return { path: `.cursor/rules/${f}`, lines, type: 'modern' as const };
      });
    }
  }
  
  if (cursorIDE.legacy || cursorIDE.modern) {
    ides.push(cursorIDE);
  }

  // Copilot detection
  const copilotIDE: DetectedIDE = { name: 'copilot', displayName: 'GitHub Copilot' };
  const copilotLegacy = path.join(rootDir, '.github', 'copilot-instructions.md');
  const copilotModernDir = path.join(rootDir, '.github', 'instructions');
  
  if (fs.existsSync(copilotLegacy)) {
    const lines = countLines(copilotLegacy);
    copilotIDE.legacy = { path: '.github/copilot-instructions.md', lines, type: 'legacy' };
    totalLines += lines;
  }
  
  if (fs.existsSync(copilotModernDir)) {
    const files = fs.readdirSync(copilotModernDir).filter(f => f.endsWith('.md'));
    if (files.length > 0) {
      copilotIDE.modern = files.map(f => {
        const fullPath = path.join(copilotModernDir, f);
        const lines = countLines(fullPath);
        totalLines += lines;
        return { path: `.github/instructions/${f}`, lines, type: 'modern' as const };
      });
    }
  }
  
  if (copilotIDE.legacy || copilotIDE.modern) {
    ides.push(copilotIDE);
  }

  // Windsurf detection
  const windsurfPath = path.join(rootDir, '.windsurfrules');
  if (fs.existsSync(windsurfPath)) {
    const lines = countLines(windsurfPath);
    ides.push({
      name: 'windsurf',
      displayName: 'Windsurf',
      legacy: { path: '.windsurfrules', lines, type: 'legacy' },
    });
    totalLines += lines;
  }

  // Claude detection
  const claudePath = path.join(rootDir, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    const lines = countLines(claudePath);
    ides.push({
      name: 'claude',
      displayName: 'Claude',
      legacy: { path: 'CLAUDE.md', lines, type: 'legacy' },
    });
    totalLines += lines;
  }

  // AGENTS.md detection
  const agentsPath = path.join(rootDir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const lines = countLines(agentsPath);
    ides.push({
      name: 'agents',
      displayName: 'AGENTS.md',
      legacy: { path: 'AGENTS.md', lines, type: 'legacy' },
    });
    totalLines += lines;
  }

  const discipline = detectDiscipline(rootDir);
  const stack = detectStack(rootDir);

  return {
    ides,
    hasExisting: ides.length > 0,
    totalLines,
    projectType: detectProjectType(rootDir),
    discipline: discipline !== 'backend' ? discipline : undefined, // Only show if non-fallback
    stack: stack || undefined,
  };
}

// ============================================
// Migration Prompt Generator
// ============================================

/**
 * Generate a migration prompt for AI agents
 */
function generateMigrationPrompt(detection: DetectionResult, projectName: string): string {
  const lines: string[] = [];
  
  lines.push('# Migrate IDE Instructions to Paradigm Format');
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`Migrate existing IDE instruction files for **${projectName}** to Paradigm\'s managed, scoped format.`);
  lines.push('');
  
  // Source files
  lines.push('## Source Files Found');
  lines.push('');
  
  for (const ide of detection.ides) {
    if (ide.legacy) {
      lines.push(`- \`${ide.legacy.path}\` (${ide.legacy.lines} lines) - ${ide.displayName} ${ide.legacy.type} format`);
    }
    if (ide.modern) {
      for (const file of ide.modern) {
        lines.push(`- \`${file.path}\` (${file.lines} lines) - ${ide.displayName} modern format`);
      }
    }
  }
  lines.push('');
  
  // Target structure for Cursor
  if (detection.ides.some(i => i.name === 'cursor')) {
    lines.push('## Cursor Migration → `.cursor/rules/*.mdc`');
    lines.push('');
    lines.push('Split the existing `.cursorrules` into scoped `.mdc` files with YAML frontmatter:');
    lines.push('');
    lines.push('### File Structure');
    lines.push('');
    lines.push('```');
    lines.push('.cursor/rules/');
    lines.push('├── project-core.mdc      # Always applies - project overview, architecture');
    lines.push('├── code-style.mdc        # globs: **/*.{ts,tsx,js,jsx} - naming, formatting');
    lines.push('├── components.mdc        # globs: **/components/**/* - component patterns');
    lines.push('├── api-patterns.mdc      # globs: **/api/**/* - API conventions');
    lines.push('├── testing.mdc           # globs: **/*.test.* - testing guidelines');
    lines.push('└── custom.mdc            # Any project-specific rules');
    lines.push('```');
    lines.push('');
    lines.push('### Frontmatter Format');
    lines.push('');
    lines.push('```yaml');
    lines.push('---');
    lines.push('description: Brief description of what these rules cover');
    lines.push('globs: "**/*.ts"           # File pattern (OR use alwaysApply)');
    lines.push('alwaysApply: true          # Apply to all files (OR use globs)');
    lines.push('---');
    lines.push('```');
    lines.push('');
  }
  
  // Target structure for Copilot
  if (detection.ides.some(i => i.name === 'copilot')) {
    lines.push('## Copilot Migration → `.github/instructions/*.instructions.md`');
    lines.push('');
    lines.push('Split into scoped instruction files with `applyTo` frontmatter:');
    lines.push('');
    lines.push('### File Structure');
    lines.push('');
    lines.push('```');
    lines.push('.github/');
    lines.push('├── copilot-instructions.md              # Always applies - core rules');
    lines.push('└── instructions/');
    lines.push('    ├── typescript.instructions.md       # applyTo: **/*.ts');
    lines.push('    ├── react.instructions.md            # applyTo: **/*.tsx');
    lines.push('    ├── api.instructions.md              # applyTo: **/api/**');
    lines.push('    └── testing.instructions.md          # applyTo: **/*.test.*');
    lines.push('```');
    lines.push('');
    lines.push('### Frontmatter Format');
    lines.push('');
    lines.push('```yaml');
    lines.push('---');
    lines.push('applyTo: "**/*.ts"');
    lines.push('---');
    lines.push('```');
    lines.push('');
  }
  
  // Instructions
  lines.push('## Migration Steps');
  lines.push('');
  lines.push('1. **Read each source file** and identify logical sections:');
  lines.push('   - Project overview / architecture');
  lines.push('   - Code style / naming conventions');
  lines.push('   - Language-specific patterns');
  lines.push('   - Framework-specific rules');
  lines.push('   - Testing guidelines');
  lines.push('   - API patterns');
  lines.push('');
  lines.push('2. **Create scoped target files** with appropriate frontmatter');
  lines.push('');
  lines.push('3. **Backup originals** by renaming to `.bak`:');
  lines.push('   - `.cursorrules` → `.cursorrules.bak`');
  lines.push('   - `.github/copilot-instructions.md` → `.github/copilot-instructions.md.bak`');
  lines.push('');
  lines.push('4. **Verify** the migration by checking that rules apply correctly');
  lines.push('');
  
  // Tips
  lines.push('## Tips');
  lines.push('');
  lines.push('- **Prefer specific globs** over `alwaysApply` when possible');
  lines.push('- **Keep files focused** - one concern per file');
  lines.push('- **Use descriptive names** that indicate the scope');
  lines.push('- **Paradigm will generate its own rules** - keep custom rules separate');
  lines.push('- After migration, run `paradigm sync` to add Paradigm-managed rules');
  lines.push('');
  
  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*Generated by `paradigm init --migrate`*');
  
  return lines.join('\n');
}

// ============================================
// Template Functions
// ============================================

/**
 * Get templates directory
 */
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'templates', 'paradigm'),
    path.join(__dirname, '..', 'templates', 'paradigm'),
    path.join(__dirname, '..', '..', 'src', 'templates', 'paradigm'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return path.join(__dirname, '..', 'templates', 'paradigm');
}

/**
 * Files and directories to skip during template copying
 * These are served via MCP resources instead of being copied to projects
 */
const MCP_SERVED_CONTENT = {
  // Skip entire directories
  directories: ['prompts'],
  // Skip specific files (relative to .paradigm/)
  files: [
    'echoes.yaml',
    'docs/commands.md',
    'docs/queries.md',
    'specs/disciplines.md',
    'specs/scan.md',
    'specs/context-tracking.md',
  ],
};

/**
 * Check if a path should be skipped during template copying
 */
function shouldSkipPath(relativePath: string): boolean {
  // Check directories
  for (const dir of MCP_SERVED_CONTENT.directories) {
    if (relativePath === dir || relativePath.startsWith(dir + '/')) {
      return true;
    }
  }

  // Check files
  if (MCP_SERVED_CONTENT.files.includes(relativePath)) {
    return true;
  }

  return false;
}

/**
 * Copy directory recursively with template variable replacement
 * Skips MCP-served content (prompts, reference docs/specs)
 */
function copyDir(src: string, dest: string, projectName: string, relativePath: string = ''): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    // Skip MCP-served content
    if (shouldSkipPath(entryRelativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, projectName, entryRelativePath);
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');
      content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
      fs.writeFileSync(destPath, content, 'utf8');
    }
  }
}

// ============================================
// Display Functions
// ============================================

/**
 * Display detection results
 */
function displayDetectionResults(detection: DetectionResult, projectName: string): void {
  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  Welcome to Paradigm                            ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  Let\'s set up your project                      ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));
  
  // Project info
  console.log(chalk.white('  📁 Project: ') + chalk.cyan(projectName) +
    (detection.projectType ? chalk.gray(` (${detection.projectType} detected)`) : ''));
  if (detection.discipline) {
    console.log(chalk.white('  🎯 Discipline: ') + chalk.cyan(detection.discipline) +
      (detection.stack ? chalk.gray(` → stack: ${detection.stack}`) : ''));
  }
  console.log('');
  
  // Detection results
  if (detection.hasExisting) {
    console.log(chalk.white('  📄 Found existing IDE instructions:\n'));
    
    for (const ide of detection.ides) {
      if (ide.legacy) {
        console.log(chalk.green('     ✓ ') + chalk.white(ide.legacy.path) + 
          chalk.gray(` (${ide.legacy.lines} lines)`));
      }
      if (ide.modern) {
        for (const file of ide.modern) {
          console.log(chalk.green('     ✓ ') + chalk.white(file.path) + 
            chalk.gray(` (${file.lines} lines)`));
        }
      }
    }
    console.log('');
    console.log(chalk.gray(`     Total: ${detection.totalLines} lines of existing instructions`));
  } else {
    console.log(chalk.gray('  📄 No existing IDE instructions found'));
  }
  
  console.log('');
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log('');
}

/**
 * Display post-init summary
 */
function displaySummary(targetIDE: string, detection: DetectionResult): void {
  const outputFileMap: Record<string, string> = {
    cursor: '.cursor/rules/',
    copilot: '.github/instructions/',
    windsurf: '.windsurfrules',
    claude: 'CLAUDE.md',
  };
  const outputFile = outputFileMap[targetIDE] || '.cursor/rules/';
  
  console.log(chalk.blue('\n✨ Paradigm initialized!\n'));
  
  console.log(chalk.white('  Created:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.white('  📁 .paradigm/'));
  console.log(chalk.gray('     ├── config.yaml      Configuration'));
  console.log(chalk.gray('     ├── specs/           Logger, symbols, context'));
  console.log(chalk.gray('     └── docs/            Patterns, troubleshooting'));
  console.log(chalk.white('  📄 .premise             Project overview'));
  console.log(chalk.white('  📄 .purpose             Feature context'));
  console.log(chalk.white(`  📄 ${outputFile.padEnd(20)} IDE instructions`));
  console.log('');
  console.log(chalk.gray('  Reference content (prompts, commands, etc.) available via MCP'));
  
  if (detection.hasExisting) {
    console.log('');
    console.log(chalk.yellow('  ⚠  Your existing IDE files were preserved.'));
    console.log(chalk.gray('     Run `paradigm init --migrate` to get a migration prompt.'));
  }
  
  console.log('');
  console.log(chalk.white('  Next steps:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.white('  1. ') + chalk.gray('Review ') + chalk.cyan('.paradigm/config.yaml'));
  console.log(chalk.white('  2. ') + chalk.gray('Edit ') + chalk.cyan('.purpose') + chalk.gray(' to define your features'));
  console.log(chalk.white('  3. ') + chalk.gray('Run ') + chalk.cyan('paradigm beacon') + chalk.gray(' to generate AI context'));
  console.log(chalk.white('  4. ') + chalk.gray('Run ') + chalk.cyan('paradigm doctor') + chalk.gray(' to verify setup'));
  console.log(chalk.white('  5. ') + chalk.gray('Run ') + chalk.cyan('paradigm visualize') + chalk.gray(' to see your project'));
  console.log('');
  console.log(chalk.gray('  Maintenance cost: ~5 min per feature to update .purpose files.'));
  console.log(chalk.gray('  What you get: agents with accurate context, ripple analysis, and'));
  console.log(chalk.gray('  drift detection — without re-explaining your project every session.'));
  console.log('');
}

// ============================================
// First-Run Init Report
// ============================================

function writeInitReport(cwd: string, projectName: string, ide: string, detection: DetectionResult): void {
  const reportPath = path.join(cwd, '.paradigm', 'init-report.md');
  const date = new Date().toISOString().split('T')[0];

  // Scan for .purpose files created during init
  const purposeFiles: string[] = [];
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.purpose') purposeFiles.push('.purpose');
    }
    const paradigmDir = path.join(cwd, '.paradigm');
    if (fs.existsSync(paradigmDir)) {
      purposeFiles.push('.paradigm/ (config, specs, docs)');
    }
  } catch {
    // Non-fatal
  }

  const existingNote = detection.hasExisting
    ? `\n> **Note:** Existing IDE files were preserved. Run \`paradigm init --migrate\` to convert them.\n`
    : '';

  const report = `# Paradigm Init Report — ${projectName}

**Date:** ${date}
**IDE:** ${ide}

${existingNote}
## What Was Created

- \`.paradigm/config.yaml\` — project configuration
- \`.paradigm/specs/\` — symbol and logger specifications
- \`.paradigm/docs/\` — command reference and troubleshooting
- \`.premise\` — project overview (edit to describe your project)
- \`.purpose\` — root feature context (edit to register your components)
- IDE instructions for **${ide}**

## What You Get

| Tool | What it does |
|------|-------------|
| \`paradigm_navigate\` | Orients agents to your project structure |
| \`paradigm_ripple\` | Shows what breaks when you change a symbol |
| \`paradigm_status\` | Health check for context coverage |
| \`paradigm_aspect_check\` | Detects undocumented side effects |
| 30+ more | Full list: \`paradigm docs\` |

## Maintenance Contract

Each new feature costs ~5 minutes of \`.purpose\` file maintenance.
What you get: agents with accurate context, ripple analysis, and drift detection — without re-explaining your project every session.

## Next Steps

1. Edit \`.purpose\` — add your first component
2. Run \`paradigm scan\` — build the symbol index
3. Run \`paradigm beacon\` — generate AI orientation context
4. Run \`paradigm doctor\` — verify setup
5. Start a Claude Code session — the MCP tools and hooks are ready

---
*Generated by \`paradigm init\` · ${date}*
`;

  try {
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(chalk.gray('  Report: .paradigm/init-report.md'));
  } catch {
    // Non-fatal — report is a convenience artifact
  }
}

// ============================================
// Main Init Command
// ============================================

export async function initCommand(options: InitOptions) {
  const cwd = process.cwd();
  const projectName = options.name || path.basename(cwd);
  const spinner = ora();
  
  const tracker = log.command('init').start('Initializing Paradigm', { project: projectName, quick: !!options.quick });

  // Detect existing IDE files
  const detection = detectExistingIDEFiles(cwd);
  log.operation('detect-ide').debug('IDE detection complete', { hasExisting: detection.hasExisting });

  // --migrate flag: just output migration prompt
  if (options.migrate) {
    if (!detection.hasExisting) {
      console.log(chalk.yellow('\n  No existing IDE instruction files found.\n'));
      console.log(chalk.gray('  Run `paradigm init` to create a fresh setup.\n'));
      return;
    }
    
    console.log(chalk.blue('\n  Migration Prompt\n'));
    console.log(chalk.gray('  Copy the following prompt to an AI agent:\n'));
    console.log(chalk.gray('  ═══════════════════════════════════════════════════\n'));
    console.log(generateMigrationPrompt(detection, projectName));
    console.log(chalk.gray('\n  ═══════════════════════════════════════════════════\n'));
    return;
  }

  // --dry-run flag: show what would be created
  if (options.dryRun) {
    displayDetectionResults(detection, projectName);
    console.log(chalk.white('  Would create (dry run):'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────'));
    console.log(chalk.cyan('  📁 .paradigm/'));
    console.log(chalk.cyan('     ├── config.yaml'));
    console.log(chalk.cyan('     ├── specs/'));
    console.log(chalk.cyan('     └── docs/'));
    console.log(chalk.cyan('  📄 .premise'));
    console.log(chalk.cyan('  📄 .purpose'));
    console.log(chalk.cyan('  📁 .cursor/rules/*.mdc'));
    console.log('');
    console.log(chalk.gray('  Reference content (prompts, commands, etc.) served via MCP'));
    console.log(chalk.gray('  Run without --dry-run to create these files.\n'));
    return;
  }

  // Display detection results (skip for --quick)
  if (!options.quick) {
    displayDetectionResults(detection, projectName);
    
    // If existing files found, show available commands
    if (detection.hasExisting && !options.force) {
      console.log(chalk.white('  What would you like to do?\n'));
      console.log(chalk.cyan('  paradigm init --migrate'));
      console.log(chalk.gray('      Get an AI-ready prompt to convert your existing rules\n'));
      console.log(chalk.cyan('  paradigm init --force'));
      console.log(chalk.gray('      Create .paradigm/ alongside existing files\n'));
      console.log(chalk.cyan('  paradigm init --dry-run'));
      console.log(chalk.gray('      Preview what would be created\n'));
    }
  }

  const templatesDir = getTemplatesDir();
  const paradigmDir = path.join(cwd, '.paradigm');

  // Check for existing .paradigm
  if (fs.existsSync(paradigmDir)) {
    const stat = fs.statSync(paradigmDir);
    
    if (stat.isFile()) {
      if (!options.force) {
        console.log(chalk.yellow('  ⚠ Legacy .paradigm file found.'));
        console.log(chalk.gray('    Run `paradigm upgrade --all` to migrate.\n'));
        return;
      }
      fs.unlinkSync(paradigmDir);
    } else if (stat.isDirectory() && !options.force) {
      console.log(chalk.yellow('  ⚠ .paradigm/ already exists (use --force to overwrite)\n'));
      return;
    }
  }

  // Create .paradigm/ directory structure
  spinner.start('Creating .paradigm/ directory...');
  
  try {
    if (!fs.existsSync(paradigmDir)) {
      fs.mkdirSync(paradigmDir, { recursive: true });
    }
    
    if (fs.existsSync(templatesDir)) {
      copyDir(templatesDir, paradigmDir, projectName);
      // Create fixtures.yaml if not already in templates
      if (!fs.existsSync(path.join(paradigmDir, 'fixtures.yaml'))) {
        createFixturesTemplate(paradigmDir);
      }

      // Apply detected discipline and stack preset to config.yaml
      applyDisciplineToConfig(paradigmDir, cwd, options.stack);

      spinner.succeed(chalk.green('.paradigm/ created'));
    } else {
      spinner.warn(chalk.yellow('Templates not found, creating minimal structure'));
      createMinimalStructure(paradigmDir, projectName);
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed: ${(error as Error).message}`));
    return;
  }

  // Create .premise file
  const premisePath = path.join(cwd, '.premise');
  if (!fs.existsSync(premisePath) || options.force) {
    spinner.start('Creating .premise...');
    fs.writeFileSync(premisePath, getDefaultPremiseContent(projectName));
    spinner.succeed(chalk.green('.premise created'));
  }

  // Create root .purpose file
  const purposePath = path.join(cwd, '.purpose');
  if (!fs.existsSync(purposePath) || options.force) {
    spinner.start('Creating .purpose...');
    fs.writeFileSync(purposePath, getDefaultPurposeContent());
    spinner.succeed(chalk.green('.purpose created'));
  }

  // Check for portal.yaml
  const portalPath = path.join(cwd, 'portal.yaml');
  if (!fs.existsSync(portalPath)) {
    console.log(chalk.gray('  ○ No portal.yaml (optional - create manually if you need gate/auth definitions)'));
    console.log(chalk.gray('    See: https://github.com/a-company/paradigm/blob/main/docs/guides/portals.md'));
  }

  // Determine target IDE
  let targetIDE: string;
  
  if (options.ide) {
    const validIDEs = ['cursor', 'copilot', 'windsurf', 'claude'];
    targetIDE = validIDEs.includes(options.ide.toLowerCase()) ? options.ide.toLowerCase() : 'cursor';
  } else {
    spinner.start('Detecting IDE...');
    const ideDetection = detectIDE(cwd);
    targetIDE = ideDetection.detected || 'cursor';
    spinner.succeed(`Using ${chalk.cyan(targetIDE)}`);
  }
  
  // Sync IDE files
  const files = loadParadigmFiles(cwd);
  if (files) {
    spinner.start('Generating IDE instructions...');
    const result = syncToIDE(cwd, targetIDE, files, true);
    if (result.success) {
      spinner.succeed(chalk.green(result.message || 'IDE instructions generated'));
    } else {
      spinner.warn(chalk.yellow(result.message));
    }
  }

  // Auto-index unless --quick flag is set
  if (!options.quick) {
    spinner.start('Creating scan index for MCP tools...');
    try {
      await indexCommand(cwd, { quiet: true });
      spinner.succeed(chalk.green('Scan index created'));
    } catch (error) {
      // Graceful failure - warn but don't block init
      spinner.warn(chalk.yellow('Could not create scan index: ' + (error as Error).message));
      console.log(chalk.gray('    Run `paradigm scan` manually after adding .purpose files'));
    }
  }

  // Display summary
  displaySummary(targetIDE, detection);

  // Write first-run report
  writeInitReport(cwd, projectName, targetIDE, detection);

  tracker.success('Paradigm initialized', { project: projectName, ide: targetIDE });
}

/**
 * Detect the project discipline and stack, then update config.yaml with
 * discipline/stack-specific settings. Replaces `discipline: auto` with the
 * detected value, adds `stack:` if detected, and populates the symbol-mapping
 * and purpose-required sections.
 */
function applyDisciplineToConfig(paradigmDir: string, rootDir: string, explicitStack?: string): void {
  const configPath = path.join(paradigmDir, 'config.yaml');
  if (!fs.existsSync(configPath)) return;

  const discipline = detectDiscipline(rootDir);
  if (discipline === 'auto') return; // detection returned auto, nothing to do

  let content = fs.readFileSync(configPath, 'utf8');

  // Replace discipline: auto with the detected discipline
  content = content.replace(
    /^discipline:\s*auto\b.*$/m,
    `discipline: ${discipline}`
  );

  // Detect or use explicit stack preset
  const stackId = explicitStack || detectStack(rootDir);
  const config = stackId ? getStackConfig(stackId) : getDisciplineConfig(discipline);

  if (!config) {
    // Fallback to discipline config if stack ID is invalid
    const fallback = getDisciplineConfig(discipline);
    applyConfigToContent();
    return;

    function applyConfigToContent() {
      const mappingLines = Object.entries(fallback.symbolMapping)
        .map(([pattern, symbol]) => `    "${pattern}": "${symbol}"`)
        .join('\n');

      content = content.replace(
        /  symbol-mapping:\n(?:(?:    .*| *)\n)*/,
        `  symbol-mapping:\n${mappingLines}\n`
      );

      const purposeLines = fallback.purposeRequired
        .map((pr) => `  - pattern: "${pr.pattern}"\n    depth: ${pr.depth}`)
        .join('\n');

      content = content.replace(
        /purpose-required:\n(?:  - pattern:.*\n    depth:.*\n)*/,
        `purpose-required:\n${purposeLines}\n`
      );

      fs.writeFileSync(configPath, content, 'utf8');
    }
  }

  // Add stack field after discipline line
  if (stackId) {
    content = content.replace(
      /^(discipline:\s*.+)$/m,
      `$1\nstack: ${stackId}`
    );
  }

  // Replace the symbol-mapping section with stack/discipline-specific mappings
  const mappingLines = Object.entries(config.symbolMapping)
    .map(([pattern, symbol]) => `    "${pattern}": "${symbol}"`)
    .join('\n');

  content = content.replace(
    /  symbol-mapping:\n(?:(?:    .*| *)\n)*/,
    `  symbol-mapping:\n${mappingLines}\n`
  );

  // Replace the purpose-required section
  const purposeLines = config.purposeRequired
    .map((pr) => `  - pattern: "${pr.pattern}"\n    depth: ${pr.depth}`)
    .join('\n');

  content = content.replace(
    /purpose-required:\n(?:  - pattern:.*\n    depth:.*\n)*/,
    `purpose-required:\n${purposeLines}\n`
  );

  fs.writeFileSync(configPath, content, 'utf8');
}

/**
 * Create minimal structure when templates aren't available
 */
function createMinimalStructure(paradigmDir: string, projectName: string): void {
  fs.mkdirSync(path.join(paradigmDir, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(paradigmDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(paradigmDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(paradigmDir, 'lore'), { recursive: true });
  // Note: prompts/ not created - served via MCP resources

  const minimalConfig = `# Paradigm Configuration
version: "1.0"
project: "${projectName}"

agent-guidelines:
  overview: |
    This project uses Paradigm for structured AI-assisted development.
    All context, symbols, and specifications live in the .paradigm/ directory.
  how-to-use:
    - "Check .paradigm/specs/ for philosophy and patterns before making changes"
    - "Reference symbols using prefixes: #component ^gate !signal $flow ~aspect"
    - "Use the Paradigm logger instead of raw console.log/print statements"
    - "Check .paradigm/docs/ for command reference and troubleshooting"
  update-rules:
    - "When adding a feature, create/update the nearest .purpose file"
    - "When adding authorization, update portal.yaml"
    - "Always update references when renaming symbols"

symbol-system:
  "#":
    name: Component
    description: Any documented code unit (feature, service, module, integration)
    examples: ["#checkout", "#login-handler", "#Button", "#stripe-client"]
  "$":
    name: Flow
    description: Multi-step processes or user journeys
    examples: ["$checkout-flow", "$onboarding", "$auth-flow"]
  "^":
    name: Gate
    description: Access control points and authorization rules
    examples: ["^authenticated", "^admin-only", "^rate-limited"]
  "!":
    name: Signal
    description: Events emitted for side effects
    examples: ["!login-success", "!payment-failed", "!rate-limited"]
  "~":
    name: Aspect
    description: Cross-cutting rules with required code anchors
    examples: ["~audit-required", "~rate-limited", "~cached"]

logging:
  enforce: true
  default-level: debug

conventions:
  - "Use kebab-case for all symbol IDs (feature-name, not featureName)"
  - "Document flows when logic spans 3+ components"
  - "Reference related items using symbol prefixes (# $ ^ ! ~)"
  - "Update .purpose files when changing feature behavior"
  - "ALWAYS use Paradigm logger, NEVER raw console.log/print"
`;

  fs.writeFileSync(path.join(paradigmDir, 'config.yaml'), minimalConfig, 'utf8');

  // Create fixtures.yaml template
  createFixturesTemplate(paradigmDir);
}

/**
 * Create fixtures.yaml template for test fixtures
 */
function createFixturesTemplate(paradigmDir: string): void {
  const fixturesTemplate = `# Test Fixtures for Flow Validation
# Use with paradigm_test_fixtures MCP tool
version: "1.0"

# User fixtures for authentication testing
users:
  admin:
    id: "user-admin"
    email: "admin@test.com"
    role: "admin"
    token: "Bearer test-admin-token"
  member:
    id: "user-member"
    email: "member@test.com"
    role: "member"
    token: "Bearer test-member-token"
  outsider:
    id: "user-outsider"
    email: "outsider@test.com"
    token: "Bearer test-outsider-token"

# Resource fixtures for entity testing
resources:
  project:
    id: "project-1"
    name: "Test Project"
    members: ["user-member"]
    admins: ["user-admin"]
  task:
    id: "task-1"
    projectId: "project-1"
    title: "Sample Task"
    assignees: ["user-member"]

# Payload fixtures for API testing
payloads:
  createProject:
    name: "New Project"
    description: "Test project description"
  createTask:
    title: "New Task"
    description: "Task description"
    assignees: []
  updateTask:
    title: "Updated Task"
    status: "in-progress"
`;

  fs.writeFileSync(path.join(paradigmDir, 'fixtures.yaml'), fixturesTemplate, 'utf8');
}
