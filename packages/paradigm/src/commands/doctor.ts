/**
 * paradigm doctor - Health check for Paradigm setup
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { log } from '../utils/logger.js';
import { parseParadigmConfig } from '../core/paradigm-config.js';
import { detectIDE, getAdapter } from '../core/ide-adapters/index.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'missing';
  message: string;
  fix?: string;
}

interface DoctorOptions {
  quiet?: boolean;
  rootDir?: string;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<boolean> {
  const cwd = options.rootDir || process.cwd();
  const results: CheckResult[] = [];
  const quiet = options.quiet;

  if (!quiet) {
    console.log(chalk.blue('\n🩺 Paradigm Doctor\n'));
    console.log(chalk.gray('Checking Paradigm setup...\n'));
  }

  const tracker = log.command('doctor').start('Running health checks');

  // Check .paradigm directory
  const paradigmDir = path.join(cwd, '.paradigm');

  if (fs.existsSync(paradigmDir)) {
    const stat = fs.statSync(paradigmDir);
    
    if (stat.isFile()) {
      results.push({
        name: '.paradigm',
        status: 'warn',
        message: 'Legacy file format (should be directory)',
        fix: 'paradigm upgrade --all',
      });
    } else {
      results.push({
        name: '.paradigm/',
        status: 'ok',
        message: 'Directory exists',
      });
      
      // Check config.yaml
      const configPath = path.join(paradigmDir, 'config.yaml');
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8');
          parseParadigmConfig(content);
          results.push({
            name: '.paradigm/config.yaml',
            status: 'ok',
            message: 'Valid YAML',
          });
        } catch (e) {
          results.push({
            name: '.paradigm/config.yaml',
            status: 'error',
            message: `Invalid YAML: ${(e as Error).message}`,
            fix: 'Check YAML syntax',
          });
        }
      } else {
        results.push({
          name: '.paradigm/config.yaml',
          status: 'missing',
          message: 'Config file not found',
          fix: 'paradigm init --force',
        });
      }
      
      // Check specs
      const specs = ['logger.md', 'scan.md', 'symbols.md'];
      const specsDir = path.join(paradigmDir, 'specs');
      
      if (fs.existsSync(specsDir)) {
        for (const spec of specs) {
          const specPath = path.join(specsDir, spec);
          if (fs.existsSync(specPath)) {
            results.push({
              name: `.paradigm/specs/${spec}`,
              status: 'ok',
              message: 'Present',
            });
          } else {
            results.push({
              name: `.paradigm/specs/${spec}`,
              status: 'missing',
              message: 'Spec file not found',
              fix: 'paradigm upgrade --all',
            });
          }
        }
      } else {
        results.push({
          name: '.paradigm/specs/',
          status: 'missing',
          message: 'Specs directory not found',
          fix: 'paradigm upgrade --all',
        });
      }
      
      // Check docs
      const docsDir = path.join(paradigmDir, 'docs');
      if (fs.existsSync(docsDir)) {
        results.push({
          name: '.paradigm/docs/',
          status: 'ok',
          message: 'Directory exists',
        });
      } else {
        results.push({
          name: '.paradigm/docs/',
          status: 'missing',
          message: 'Docs directory not found',
          fix: 'paradigm upgrade --all',
        });
      }
      
      // Check prompts
      const promptsDir = path.join(paradigmDir, 'prompts');
      if (fs.existsSync(promptsDir)) {
        results.push({
          name: '.paradigm/prompts/',
          status: 'ok',
          message: 'Directory exists',
        });
      } else {
        results.push({
          name: '.paradigm/prompts/',
          status: 'missing',
          message: 'Prompts directory not found',
          fix: 'paradigm upgrade --all',
        });
      }
      
      // Check scan index
      const scanIndexPath = path.join(paradigmDir, 'scan-index.json');
      const legacyScanIndex = path.join(cwd, '.paradigm-scan-index.json');
      
      if (fs.existsSync(scanIndexPath)) {
        const stat = fs.statSync(scanIndexPath);
        const ageMs = Date.now() - stat.mtime.getTime();
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        
        if (ageHours > 24) {
          results.push({
            name: '.paradigm/scan-index.json',
            status: 'warn',
            message: `Stale (${ageHours} hours old)`,
            fix: 'paradigm index',
          });
        } else {
          results.push({
            name: '.paradigm/scan-index.json',
            status: 'ok',
            message: ageHours > 0 ? `${ageHours} hours old` : 'Fresh',
          });
        }
      } else if (fs.existsSync(legacyScanIndex)) {
        results.push({
          name: 'scan-index',
          status: 'warn',
          message: 'Using legacy location',
          fix: 'paradigm index',
        });
      } else {
        results.push({
          name: '.paradigm/scan-index.json',
          status: 'missing',
          message: 'Not generated',
          fix: 'paradigm index',
        });
      }
    }
  } else {
    results.push({
      name: '.paradigm/',
      status: 'missing',
      message: 'Not initialized',
      fix: 'paradigm init',
    });
  }

  // Check IDE files
  const detection = detectIDE(cwd);
  if (detection.detected) {
    const adapter = getAdapter(detection.detected);
    if (adapter) {
      const idePath = path.join(cwd, adapter.outputPath);
      if (fs.existsSync(idePath)) {
        // Could check if it's in sync with config, for now just check existence
        results.push({
          name: adapter.outputPath,
          status: 'ok',
          message: `Present (${detection.detected})`,
        });
      } else {
        results.push({
          name: adapter.outputPath,
          status: 'missing',
          message: `Not generated for ${detection.detected}`,
          fix: 'paradigm sync',
        });
      }
    }
  }

  // Check .premise file
  const premisePath = path.join(cwd, '.premise');
  if (fs.existsSync(premisePath)) {
    results.push({
      name: '.premise',
      status: 'ok',
      message: 'Present',
    });
  } else {
    results.push({
      name: '.premise',
      status: 'missing',
      message: 'Not found (optional)',
    });
  }

  // Check .purpose file
  const purposePath = path.join(cwd, '.purpose');
  if (fs.existsSync(purposePath)) {
    results.push({
      name: '.purpose',
      status: 'ok',
      message: 'Present',
    });
  } else {
    results.push({
      name: '.purpose',
      status: 'warn',
      message: 'Root .purpose not found',
      fix: 'paradigm init',
    });
  }

  // Display results
  let errorCount = 0;
  let warnCount = 0;
  let missingCount = 0;

  for (const result of results) {
    let icon: string;
    let color: typeof chalk;

    switch (result.status) {
      case 'ok':
        icon = '✓';
        color = chalk.green;
        break;
      case 'warn':
        icon = '⚠';
        color = chalk.yellow;
        warnCount++;
        break;
      case 'error':
        icon = '✗';
        color = chalk.red;
        errorCount++;
        break;
      case 'missing':
        icon = '○';
        color = chalk.gray;
        missingCount++;
        break;
    }

    if (!quiet) {
      const namePadded = result.name.padEnd(30);
      console.log(`  ${color(icon)} ${namePadded} ${color(result.message)}`);

      if (result.fix) {
        console.log(chalk.gray(`    └─ Fix: ${result.fix}`));
      }
    }
  }

  // Summary
  const issueCount = errorCount + warnCount + missingCount;
  const healthy = issueCount === 0;

  if (!quiet) {
    console.log('');

    if (healthy) {
      console.log(chalk.green('✨ All checks passed!\n'));
    } else {
      const parts: string[] = [];
      if (errorCount > 0) parts.push(chalk.red(`${errorCount} error${errorCount > 1 ? 's' : ''}`));
      if (warnCount > 0) parts.push(chalk.yellow(`${warnCount} warning${warnCount > 1 ? 's' : ''}`));
      if (missingCount > 0) parts.push(chalk.gray(`${missingCount} missing`));

      console.log(`${parts.join(', ')} found.\n`);
      console.log(chalk.gray('Run the suggested commands to fix issues.\n'));
    }
  }

  if (healthy) {
    tracker.success('All health checks passed', { total: results.length });
  } else {
    tracker.error('Health checks found issues', { errors: errorCount, warnings: warnCount, missing: missingCount });
  }

  return healthy;
}
