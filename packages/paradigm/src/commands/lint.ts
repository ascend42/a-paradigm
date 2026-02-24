/**
 * paradigm lint - Validate .purpose files
 * 
 * Checks all .purpose files for schema errors, provides suggestions,
 * and optionally auto-fixes common issues.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import {
  findPurposeFiles,
  parsePurposeFileDetailed,
  validatePurposeFile,
  serializePurposeFile,
  type ParseError,
  type ValidationIssue,
} from '@a-company/purpose-core';

interface LintOptions {
  fix?: boolean;
  strict?: boolean;
  quiet?: boolean;
  json?: boolean;
  autoPopulate?: boolean;
}

interface FileResult {
  path: string;
  relativePath: string;
  valid: boolean;
  errors: LintIssue[];
  warnings: LintIssue[];
  fixed: boolean;
}

interface LintIssue {
  message: string;
  line?: number;
  path?: string;
  type: 'error' | 'warning';
  suggestion?: string;
  fixable?: boolean;
}

interface LintSummary {
  totalFiles: number;
  validFiles: number;
  filesWithErrors: number;
  filesWithWarnings: number;
  totalErrors: number;
  totalWarnings: number;
  fixedFiles: number;
}

/**
 * Generate a suggestion for common errors
 */
function getSuggestion(error: ParseError | ValidationIssue): string | undefined {
  const msg = error.message.toLowerCase();
  
  // Features should be object, got array
  if (msg.includes('expected object, received array') && error.path?.includes('features')) {
    return 'Convert to object format: features: { feature-name: { description: "..." } }';
  }
  
  // Components should be object, got array
  if (msg.includes('expected object, received array') && error.path?.includes('components')) {
    return 'Convert to object format: components: { component-name: { description: "..." } }';
  }
  
  // Missing description
  if (msg.includes('has no description')) {
    return 'Add a description field to help AI understand this item';
  }
  
  // Invalid ID format
  if (msg.includes('should use alphanumeric')) {
    return 'Use kebab-case: my-feature-name (lowercase, hyphens)';
  }
  
  // Unknown symbol reference
  if (msg.includes('references unknown')) {
    return 'Define the symbol in a .purpose file or remove the reference';
  }
  
  // YAML syntax error
  if (msg.includes('yaml syntax') || msg.includes('bad indentation')) {
    return 'Check indentation (use 2 spaces) and YAML syntax';
  }
  
  return undefined;
}

/**
 * Check if content looks like markdown (not YAML)
 */
function isMarkdownFormat(content: string): boolean {
  const lines = content.trim().split('\n');
  // Check for markdown indicators
  const hasMarkdownHeader = lines.some(l => /^#+\s/.test(l));
  const hasNoYamlStructure = !content.includes(':') || lines[0].startsWith('#') || lines[0].startsWith('@');
  return hasMarkdownHeader || (hasNoYamlStructure && !content.trim().startsWith('---'));
}

/**
 * Convert markdown .purpose to YAML template
 */
function convertMarkdownToYaml(content: string, filePath: string): string {
  const lines = content.trim().split('\n');
  const dirName = path.basename(path.dirname(filePath));
  
  // Extract any useful info from markdown
  let description = '';
  for (const line of lines) {
    // Look for first non-header content
    if (!line.startsWith('#') && !line.startsWith('@') && line.trim()) {
      description = line.trim();
      break;
    }
    // Or use header as description
    if (line.startsWith('#')) {
      description = line.replace(/^#+\s*/, '').trim();
    }
  }
  
  return `# Auto-converted from markdown format
description: "${description || `Purpose file for ${dirName}`}"

# TODO: Add features and components
# features:
#   feature-name:
#     description: "What this feature does"

# components:
#   component-name:
#     description: "What this component does"
`;
}

/**
 * Auto-quote special YAML characters in arrays
 * Fixes: [#component, @feature] → ["#component", "@feature"]
 */
function autoQuoteSpecialChars(content: string): string {
  // Pattern to match unquoted symbols in arrays: [#foo, @bar, $baz]
  // This regex finds array items starting with special chars that aren't quoted
  return content.replace(
    /\[\s*([^\]]+)\s*\]/g,
    (_match, arrayContent) => {
      const items = arrayContent.split(',').map((item: string) => {
        const trimmed = item.trim();
        // If starts with special char and not already quoted
        if (/^[#@$^!%]/.test(trimmed) && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
          return `"${trimmed}"`;
        }
        return trimmed;
      });
      return `[${items.join(', ')}]`;
    }
  );
}

/**
 * Attempt to auto-fix common issues
 * Returns the fixed content if fixable, or null if not
 */
function attemptFix(filePath: string, errors: LintIssue[]): string | null {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Fix 1: Convert markdown to YAML template
    if (isMarkdownFormat(content)) {
      content = convertMarkdownToYaml(content, filePath);
      modified = true;
    }
    
    // Fix 2: Auto-quote special characters in arrays
    const hasUnquotedSymbols = errors.some(e => 
      e.message.includes('tag suffix') || 
      e.message.includes('flow indicator') ||
      e.message.includes('missed comma')
    );
    
    if (hasUnquotedSymbols || content.match(/\[[^\]]*[#@$^!%][^\]"']*\]/)) {
      const quoted = autoQuoteSpecialChars(content);
      if (quoted !== content) {
        content = quoted;
        modified = true;
      }
    }
    
    // Fix 3: If content is now valid YAML, re-serialize for consistent formatting
    if (modified) {
      // Try to parse the fixed content
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, content);
      const result = parsePurposeFileDetailed(tempPath);
      fs.unlinkSync(tempPath);
      
      if (result.isYamlValid && result.data) {
        // Re-serialize for clean formatting
        return serializePurposeFile(result.data);
      }
      
      // Return partially fixed content even if not fully valid
      return content;
    }
    
    // Fix 4: Try re-serialization for valid but messy YAML
    const result = parsePurposeFileDetailed(filePath);
    if (result.isYamlValid && result.data) {
      const fixed = serializePurposeFile(result.data);
      if (fixed.trim() !== content.trim()) {
        return fixed;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Lint a single .purpose file
 */
function lintFile(filePath: string, rootDir: string, options: LintOptions): FileResult {
  const relativePath = path.relative(rootDir, filePath);
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  let fixed = false;
  
  // Parse the file
  const parseResult = parsePurposeFileDetailed(filePath);
  
  // Collect parse errors
  for (const error of parseResult.detailedErrors || []) {
    const issue: LintIssue = {
      message: error.message,
      line: error.line,
      path: error.path,
      type: error.type === 'yaml' || error.type === 'file' ? 'error' : 'error',
      suggestion: getSuggestion(error),
      fixable: error.type === 'schema', // Schema errors might be fixable
    };
    errors.push(issue);
  }
  
  // If we have valid data, run semantic validation
  if (parseResult.data) {
    const validationResult = validatePurposeFile(parseResult.data, relativePath);
    
    for (const issue of validationResult.issues) {
      const lintIssue: LintIssue = {
        message: issue.message,
        path: issue.path,
        type: issue.type,
        suggestion: getSuggestion(issue),
        fixable: false,
      };
      
      if (issue.type === 'error') {
        errors.push(lintIssue);
      } else {
        warnings.push(lintIssue);
      }
    }
  }
  
  // Attempt auto-fix if requested
  if (options.fix && errors.length > 0) {
    const fixedContent = attemptFix(filePath, errors);
    if (fixedContent) {
      fs.writeFileSync(filePath, fixedContent);
      fixed = true;
      // Re-parse to get updated error count
      const reparse = parsePurposeFileDetailed(filePath);
      if (reparse.detailedErrors && reparse.detailedErrors.length < errors.length) {
        // Some errors were fixed
        errors.length = 0;
        warnings.length = 0;
        for (const error of reparse.detailedErrors || []) {
          errors.push({
            message: error.message,
            line: error.line,
            path: error.path,
            type: 'error',
            suggestion: getSuggestion(error),
          });
        }
      }
    }
  }
  
  const valid = errors.length === 0 && (!options.strict || warnings.length === 0);
  
  return {
    path: filePath,
    relativePath,
    valid,
    errors,
    warnings,
    fixed,
  };
}

/**
 * Format a single issue for display
 */
function formatIssue(issue: LintIssue, indent: string = '  '): string[] {
  const lines: string[] = [];
  const icon = issue.type === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
  const lineInfo = issue.line ? chalk.gray(` (line ${issue.line})`) : '';
  const pathInfo = issue.path ? chalk.gray(` at ${issue.path}`) : '';
  
  lines.push(`${indent}${icon} ${issue.message}${lineInfo}${pathInfo}`);
  
  if (issue.suggestion) {
    lines.push(`${indent}  ${chalk.cyan('→')} ${chalk.gray(issue.suggestion)}`);
  }
  
  return lines;
}

interface AutoPopulateSuggestion {
  dir: string;
  relativeDir: string;
  purposePath: string;
  relativePurposePath: string;
  components: string[];
  content: string;
}

/** Source directory patterns that should have .purpose coverage */
const SOURCE_DIR_PATTERNS = [
  'src', 'lib', 'features', 'components', 'services', 'utils',
  'routes', 'api', 'commands', 'core', 'middleware', 'models',
  'handlers', 'hooks', 'stores', 'config', 'plugins',
];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.paradigm', 'coverage',
  '__pycache__', '.next', '.nuxt', 'vendor', 'target',
]);

/**
 * Scan source directories for ones missing .purpose files.
 * Returns suggestions with draft .purpose content.
 */
function findUndocumentedDirs(rootDir: string, existingPurposeFiles: string[]): AutoPopulateSuggestion[] {
  const coveredDirs = new Set(existingPurposeFiles.map((f) => path.dirname(f)));
  const suggestions: AutoPopulateSuggestion[] = [];

  function scanDir(dir: string, depth: number) {
    if (depth > 4) return; // Don't go too deep
    if (coveredDirs.has(dir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirName = path.basename(dir);
    if (SKIP_DIRS.has(dirName)) return;

    // Check if this is a source directory worth documenting
    const isSourceDir =
      SOURCE_DIR_PATTERNS.includes(dirName) ||
      entries.some((e) => !e.isDirectory() && /\.(ts|tsx|js|jsx|rs|py|go)$/.test(e.name));

    if (isSourceDir && !entries.some((e) => e.name === '.purpose')) {
      // Discover components from source files
      const sourceFiles = entries
        .filter((e) => !e.isDirectory() && /\.(ts|tsx|js|jsx|rs|py|go)$/.test(e.name))
        .filter((e) => !e.name.endsWith('.test.ts') && !e.name.endsWith('.spec.ts') && e.name !== 'index.ts')
        .map((e) => e.name.replace(/\.[^.]+$/, ''));

      const components = sourceFiles.slice(0, 10).map((f) =>
        f.replace(/([A-Z])/g, (_, c, i) => (i > 0 ? '-' : '') + c.toLowerCase()),
      );

      if (components.length > 0) {
        const purposePath = path.join(dir, '.purpose');
        const relDir = path.relative(rootDir, dir);

        const content = generatePurposeDraft(dirName, components);

        suggestions.push({
          dir,
          relativeDir: relDir,
          purposePath,
          relativePurposePath: path.relative(rootDir, purposePath),
          components,
          content,
        });
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        scanDir(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  scanDir(rootDir, 0);
  return suggestions;
}

/**
 * Generate a draft .purpose file for an undocumented directory.
 */
function generatePurposeDraft(dirName: string, components: string[]): string {
  const lines = [
    `description: "Components in ${dirName}"`,
    '',
    'components:',
  ];

  for (const comp of components) {
    lines.push(`  ${comp}:`);
    lines.push(`    description: "TODO: describe #${comp}"`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Main lint command
 */
export async function lintCommand(targetPath: string | undefined, options: LintOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const spinner = ora();
  
  if (!options.quiet && !options.json) {
    console.log(chalk.blue('\n🔍 Paradigm Lint\n'));
  }
  
  const tracker = log.command('lint').start('Linting purpose files', { fix: !!options.fix });
  
  // Find all .purpose files
  spinner.start('Finding .purpose files...');
  const files = await findPurposeFiles(rootDir);
  spinner.stop();
  log.operation('find-files').debug('Purpose files found', { count: files.length });
  
  // Auto-populate mode: find source dirs without .purpose files
  if (options.autoPopulate) {
    spinner.start('Scanning for undocumented source directories...');
    const suggestions = findUndocumentedDirs(rootDir, files);
    spinner.stop();

    if (suggestions.length === 0) {
      if (!options.quiet && !options.json) {
        console.log(chalk.green('All source directories have .purpose coverage.\n'));
      }
      if (options.json) {
        console.log(JSON.stringify({ suggestions: [], populated: 0 }));
      }
      return;
    }

    if (options.json) {
      const populated = options.fix ? suggestions.length : 0;
      if (options.fix) {
        for (const s of suggestions) {
          fs.writeFileSync(s.purposePath, s.content, 'utf8');
        }
      }
      console.log(JSON.stringify({
        suggestions: suggestions.map((s) => ({
          dir: s.relativeDir,
          purposePath: s.relativePurposePath,
          components: s.components,
        })),
        populated,
      }));
      return;
    }

    console.log(chalk.yellow(`Found ${suggestions.length} source director${suggestions.length > 1 ? 'ies' : 'y'} without .purpose files:\n`));

    for (const s of suggestions) {
      console.log(`  ${chalk.cyan(s.relativeDir)}/`);
      for (const comp of s.components) {
        console.log(chalk.gray(`    #${comp}`));
      }
      if (options.fix) {
        fs.writeFileSync(s.purposePath, s.content, 'utf8');
        console.log(chalk.green(`    → Created ${s.relativePurposePath}`));
      }
      console.log('');
    }

    if (!options.fix) {
      console.log(chalk.gray(`Run ${chalk.cyan('paradigm lint --auto-populate --fix')} to create these .purpose files.\n`));
    } else {
      console.log(chalk.green(`Created ${suggestions.length} .purpose file${suggestions.length > 1 ? 's' : ''}.\n`));
    }
    return;
  }

  if (files.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ files: [], summary: { totalFiles: 0 } }));
    } else if (!options.quiet) {
      console.log(chalk.yellow('No .purpose files found.\n'));
      console.log(chalk.gray('Run `paradigm init` to create your first .purpose file.\n'));
    }
    return;
  }
  
  if (!options.quiet && !options.json) {
    console.log(chalk.gray(`Checking ${files.length} .purpose file${files.length > 1 ? 's' : ''}...\n`));
  }
  
  // Lint each file
  const results: FileResult[] = [];
  
  for (const file of files) {
    const result = lintFile(file, rootDir, options);
    results.push(result);
    
    // Print result for this file (if not quiet/json)
    if (!options.quiet && !options.json) {
      if (!result.valid || result.errors.length > 0 || result.warnings.length > 0) {
        const icon = result.errors.length > 0 
          ? chalk.red('✗') 
          : (result.warnings.length > 0 ? chalk.yellow('⚠') : chalk.green('✓'));
        const fixedBadge = result.fixed ? chalk.cyan(' [fixed]') : '';
        console.log(`${icon} ${result.relativePath}${fixedBadge}`);
        
        for (const error of result.errors) {
          for (const line of formatIssue(error)) {
            console.log(line);
          }
        }
        
        for (const warning of result.warnings) {
          for (const line of formatIssue(warning)) {
            console.log(line);
          }
        }
        
        console.log('');
      }
    }
  }
  
  // Calculate summary
  const summary: LintSummary = {
    totalFiles: results.length,
    validFiles: results.filter(r => r.valid).length,
    filesWithErrors: results.filter(r => r.errors.length > 0).length,
    filesWithWarnings: results.filter(r => r.warnings.length > 0).length,
    totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    totalWarnings: results.reduce((sum, r) => sum + r.warnings.length, 0),
    fixedFiles: results.filter(r => r.fixed).length,
  };
  
  // JSON output
  if (options.json) {
    const output = {
      files: results.map(r => ({
        path: r.relativePath,
        valid: r.valid,
        errors: r.errors,
        warnings: r.warnings,
        fixed: r.fixed,
      })),
      summary,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(summary.filesWithErrors > 0 ? 1 : 0);
    return;
  }
  
  // Summary output
  if (!options.quiet) {
    console.log(chalk.gray('─'.repeat(40)));
    
    if (summary.totalErrors === 0 && summary.totalWarnings === 0) {
      console.log(chalk.green(`\n✓ All ${summary.totalFiles} file${summary.totalFiles > 1 ? 's' : ''} valid\n`));
      tracker.success('All files valid', { files: summary.totalFiles });
    } else {
      tracker.error('Files have issues', { 
        errors: summary.totalErrors, 
        warnings: summary.totalWarnings, 
        fixed: summary.fixedFiles 
      });
      console.log('');
      
      if (summary.validFiles > 0) {
        console.log(chalk.green(`✓ ${summary.validFiles} file${summary.validFiles > 1 ? 's' : ''} valid`));
      }
      
      if (summary.filesWithErrors > 0) {
        console.log(chalk.red(`✗ ${summary.filesWithErrors} file${summary.filesWithErrors > 1 ? 's' : ''} with errors (${summary.totalErrors} total)`));
      }
      
      if (summary.filesWithWarnings > 0) {
        console.log(chalk.yellow(`⚠ ${summary.filesWithWarnings} file${summary.filesWithWarnings > 1 ? 's' : ''} with warnings (${summary.totalWarnings} total)`));
      }
      
      if (summary.fixedFiles > 0) {
        console.log(chalk.cyan(`↻ ${summary.fixedFiles} file${summary.fixedFiles > 1 ? 's' : ''} auto-fixed`));
      }
      
      console.log('');
      
      // Suggest --fix if there are fixable errors
      if (summary.totalErrors > 0 && !options.fix) {
        console.log(chalk.gray('Run `paradigm lint --fix` to auto-fix where possible.\n'));
      }
    }
  }
  
  // Exit with error code if there are errors
  if (summary.filesWithErrors > 0) {
    process.exit(1);
  }
  
  // In strict mode, also fail on warnings
  if (options.strict && summary.filesWithWarnings > 0) {
    process.exit(1);
  }
}
