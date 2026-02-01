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
 * Attempt to auto-fix common issues
 * Returns the fixed content if fixable, or null if not
 */
function attemptFix(filePath: string, _errors: LintIssue[]): string | null {
  // For now, auto-fix is limited to safe operations
  // Future: Add more sophisticated fixes
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check if we can parse it at all
    const result = parsePurposeFileDetailed(filePath);
    if (!result.isYamlValid || !result.data) {
      return null; // Can't fix YAML syntax errors automatically
    }
    
    // Re-serialize to fix formatting issues
    const fixed = serializePurposeFile(result.data);
    
    // Only return if actually different
    if (fixed.trim() !== content.trim()) {
      return fixed;
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

/**
 * Main lint command
 */
export async function lintCommand(targetPath: string | undefined, options: LintOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const spinner = ora();
  
  if (!options.quiet && !options.json) {
    console.log(chalk.blue('\n🔍 Paradigm Lint\n'));
  }
  
  // Find all .purpose files
  spinner.start('Finding .purpose files...');
  const files = await findPurposeFiles(rootDir);
  spinner.stop();
  
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
    } else {
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
