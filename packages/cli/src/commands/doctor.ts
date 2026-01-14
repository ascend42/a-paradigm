/**
 * horizon doctor - Health check for Horizon setup
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { parseHorizonConfig } from '../core/horizon-config.js';
import { detectIDE, getAdapter } from '../core/ide-adapters/index.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'missing';
  message: string;
  fix?: string;
}

export async function doctorCommand() {
  const cwd = process.cwd();
  const results: CheckResult[] = [];

  console.log(chalk.blue('\n🩺 Horizon Doctor\n'));
  console.log(chalk.gray('Checking Horizon setup...\n'));

  // Check .horizon directory
  const horizonDir = path.join(cwd, '.horizon');
  const horizonFile = path.join(cwd, '.horizon');
  
  if (fs.existsSync(horizonDir)) {
    const stat = fs.statSync(horizonDir);
    
    if (stat.isFile()) {
      results.push({
        name: '.horizon',
        status: 'warn',
        message: 'Legacy file format (should be directory)',
        fix: 'horizon upgrade --all',
      });
    } else {
      results.push({
        name: '.horizon/',
        status: 'ok',
        message: 'Directory exists',
      });
      
      // Check config.yaml
      const configPath = path.join(horizonDir, 'config.yaml');
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8');
          parseHorizonConfig(content);
          results.push({
            name: '.horizon/config.yaml',
            status: 'ok',
            message: 'Valid YAML',
          });
        } catch (e) {
          results.push({
            name: '.horizon/config.yaml',
            status: 'error',
            message: `Invalid YAML: ${(e as Error).message}`,
            fix: 'Check YAML syntax',
          });
        }
      } else {
        results.push({
          name: '.horizon/config.yaml',
          status: 'missing',
          message: 'Config file not found',
          fix: 'horizon init --force',
        });
      }
      
      // Check specs
      const specs = ['logger.md', 'scan.md', 'symbols.md'];
      const specsDir = path.join(horizonDir, 'specs');
      
      if (fs.existsSync(specsDir)) {
        for (const spec of specs) {
          const specPath = path.join(specsDir, spec);
          if (fs.existsSync(specPath)) {
            results.push({
              name: `.horizon/specs/${spec}`,
              status: 'ok',
              message: 'Present',
            });
          } else {
            results.push({
              name: `.horizon/specs/${spec}`,
              status: 'missing',
              message: 'Spec file not found',
              fix: 'horizon upgrade --all',
            });
          }
        }
      } else {
        results.push({
          name: '.horizon/specs/',
          status: 'missing',
          message: 'Specs directory not found',
          fix: 'horizon upgrade --all',
        });
      }
      
      // Check docs
      const docsDir = path.join(horizonDir, 'docs');
      if (fs.existsSync(docsDir)) {
        results.push({
          name: '.horizon/docs/',
          status: 'ok',
          message: 'Directory exists',
        });
      } else {
        results.push({
          name: '.horizon/docs/',
          status: 'missing',
          message: 'Docs directory not found',
          fix: 'horizon upgrade --all',
        });
      }
      
      // Check prompts
      const promptsDir = path.join(horizonDir, 'prompts');
      if (fs.existsSync(promptsDir)) {
        results.push({
          name: '.horizon/prompts/',
          status: 'ok',
          message: 'Directory exists',
        });
      } else {
        results.push({
          name: '.horizon/prompts/',
          status: 'missing',
          message: 'Prompts directory not found',
          fix: 'horizon upgrade --all',
        });
      }
      
      // Check scan index
      const scanIndexPath = path.join(horizonDir, 'scan-index.json');
      const legacyScanIndex = path.join(cwd, '.horizon-scan-index.json');
      
      if (fs.existsSync(scanIndexPath)) {
        const stat = fs.statSync(scanIndexPath);
        const ageMs = Date.now() - stat.mtime.getTime();
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        
        if (ageHours > 24) {
          results.push({
            name: '.horizon/scan-index.json',
            status: 'warn',
            message: `Stale (${ageHours} hours old)`,
            fix: 'horizon index',
          });
        } else {
          results.push({
            name: '.horizon/scan-index.json',
            status: 'ok',
            message: ageHours > 0 ? `${ageHours} hours old` : 'Fresh',
          });
        }
      } else if (fs.existsSync(legacyScanIndex)) {
        results.push({
          name: 'scan-index',
          status: 'warn',
          message: 'Using legacy location',
          fix: 'horizon index',
        });
      } else {
        results.push({
          name: '.horizon/scan-index.json',
          status: 'missing',
          message: 'Not generated',
          fix: 'horizon index',
        });
      }
    }
  } else {
    results.push({
      name: '.horizon/',
      status: 'missing',
      message: 'Not initialized',
      fix: 'horizon init',
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
          fix: 'horizon sync',
        });
      }
    }
  }

  // Check .dream file
  const dreamPath = path.join(cwd, '.dream');
  if (fs.existsSync(dreamPath)) {
    results.push({
      name: '.dream',
      status: 'ok',
      message: 'Present',
    });
  } else {
    results.push({
      name: '.dream',
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
      fix: 'horizon init',
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
    
    const namePadded = result.name.padEnd(30);
    console.log(`  ${color(icon)} ${namePadded} ${color(result.message)}`);
    
    if (result.fix) {
      console.log(chalk.gray(`    └─ Fix: ${result.fix}`));
    }
  }

  // Summary
  console.log('');
  
  const issueCount = errorCount + warnCount + missingCount;
  if (issueCount === 0) {
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
