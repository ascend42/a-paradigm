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

  // Check purpose-required patterns from config.yaml
  const configPath = path.join(paradigmDir, 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const { parse } = await import('yaml');
      const config = parse(configContent);
      const purposeRequired = config?.['purpose-required'] as Array<{ pattern?: string; depth?: number }> | undefined;

      if (purposeRequired && Array.isArray(purposeRequired)) {
        const missingDirs: string[] = [];

        for (const entry of purposeRequired) {
          if (!entry.pattern) continue;
          // Expand glob pattern using simple directory listing
          const { glob } = await import('glob');
          const matches = await glob(entry.pattern, { cwd, nodir: false });

          for (const match of matches) {
            const fullPath = path.join(cwd, match);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory() && !fs.existsSync(path.join(fullPath, '.purpose'))) {
                missingDirs.push(match);
              }
            } catch {
              // Skip inaccessible paths
            }
          }
        }

        if (missingDirs.length > 0) {
          results.push({
            name: 'Purpose-required',
            status: 'warn',
            message: `${missingDirs.length} director${missingDirs.length === 1 ? 'y' : 'ies'} missing .purpose: ${missingDirs.join(', ')}`,
            fix: 'Create .purpose files with paradigm_purpose_init + paradigm_purpose_add_component',
          });
        } else {
          results.push({
            name: 'Purpose-required',
            status: 'ok',
            message: 'All required directories have .purpose files',
          });
        }
      }
    } catch {
      // Config parse error already caught above
    }
  }

  // Check for clarification markers in .purpose files
  const clarificationMarkerRegex = /\[NEEDS CLARIFICATION:\s*[^\]]+\]/gi;
  let clarificationCount = 0;

  function findPurposeFilesRecursive(dir: string): string[] {
    const found: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          found.push(...findPurposeFilesRecursive(fullPath));
        } else if (entry.name === '.purpose') {
          found.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
    return found;
  }

  const purposeFiles = findPurposeFilesRecursive(cwd);
  for (const pf of purposeFiles) {
    try {
      const content = fs.readFileSync(pf, 'utf8');
      const matches = content.match(clarificationMarkerRegex);
      if (matches) {
        clarificationCount += matches.length;
      }
    } catch {
      // Skip files we can't read
    }
  }

  if (clarificationCount > 0) {
    results.push({
      name: 'Clarification markers',
      status: 'warn',
      message: `${clarificationCount} [NEEDS CLARIFICATION] marker${clarificationCount > 1 ? 's' : ''} found in .purpose files`,
      fix: 'Resolve open clarification markers before shipping',
    });
  } else if (purposeFiles.length > 0) {
    results.push({
      name: 'Clarification markers',
      status: 'ok',
      message: 'No unresolved markers',
    });
  }

  // Check portal.yaml validity
  const portalPath = path.join(cwd, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const portalContent = fs.readFileSync(portalPath, 'utf8');
      const { parse } = await import('yaml');
      const portal = parse(portalContent);
      if (portal?.version && portal?.gates) {
        const gateCount = Object.keys(portal.gates || {}).length;
        const routeCount = Object.keys(portal.routes || {}).length;
        results.push({
          name: 'portal.yaml',
          status: 'ok',
          message: `Valid (${gateCount} gates, ${routeCount} routes)`,
        });
      } else {
        results.push({
          name: 'portal.yaml',
          status: 'warn',
          message: 'Missing version or gates section',
          fix: 'Add version: "1.0" and gates: {} to portal.yaml',
        });
      }
    } catch (e) {
      results.push({
        name: 'portal.yaml',
        status: 'error',
        message: `Invalid YAML: ${(e as Error).message}`,
        fix: 'Check YAML syntax in portal.yaml',
      });
    }
  }

  // Check portal gate compliance (declared vs used)
  if (fs.existsSync(portalPath)) {
    try {
      const { checkPortalCompliance, getComplianceSummary } = await import('../core/portal-compliance.js');
      const complianceReport = await checkPortalCompliance(cwd);
      const summary = getComplianceSummary(complianceReport);
      results.push({
        name: 'Portal compliance',
        status: summary.status,
        message: summary.message,
        fix: summary.status !== 'ok' ? 'paradigm portal check' : undefined,
      });
    } catch {
      // Skip if compliance check fails
    }
  }

  // Check flows.yaml validation
  const flowsPath = path.join(paradigmDir, 'flows.yaml');
  if (fs.existsSync(flowsPath)) {
    try {
      const flowsContent = fs.readFileSync(flowsPath, 'utf8');
      const { parse } = await import('yaml');
      const flows = parse(flowsContent);
      if (flows?.version && flows?.flows) {
        const flowCount = Object.keys(flows.flows || {}).length;
        const emptyFlows = Object.entries(flows.flows || {}).filter(
          ([, f]) => !(f as { steps?: unknown[] })?.steps || ((f as { steps?: unknown[] }).steps?.length ?? 0) === 0
        );
        if (emptyFlows.length > 0) {
          results.push({
            name: '.paradigm/flows.yaml',
            status: 'warn',
            message: `${flowCount} flows defined, ${emptyFlows.length} have no steps`,
            fix: 'Add steps to empty flow definitions',
          });
        } else {
          results.push({
            name: '.paradigm/flows.yaml',
            status: 'ok',
            message: `Valid (${flowCount} flows)`,
          });
        }
      } else {
        results.push({
          name: '.paradigm/flows.yaml',
          status: 'warn',
          message: 'Missing version or flows section',
          fix: 'Ensure flows.yaml has version: "1.0" and flows: {}',
        });
      }
    } catch (e) {
      results.push({
        name: '.paradigm/flows.yaml',
        status: 'error',
        message: `Invalid YAML: ${(e as Error).message}`,
        fix: 'Check YAML syntax in flows.yaml',
      });
    }
  }

  // Check lore health
  const loreDir = path.join(paradigmDir, 'lore');
  if (fs.existsSync(loreDir)) {
    try {
      const loreFiles = fs.readdirSync(loreDir).filter((f) => f.endsWith('.yaml'));
      if (loreFiles.length === 0) {
        results.push({
          name: 'Lore entries',
          status: 'warn',
          message: 'Lore directory exists but no entries found',
          fix: 'Record a lore entry: paradigm lore record',
        });
      } else {
        results.push({
          name: 'Lore entries',
          status: 'ok',
          message: `${loreFiles.length} lore file${loreFiles.length > 1 ? 's' : ''}`,
        });
      }
    } catch {
      results.push({
        name: 'Lore entries',
        status: 'warn',
        message: 'Could not read lore directory',
      });
    }
  }

  // Check hook freshness
  const hooksJsonPath = path.join(cwd, '.claude', 'hooks.json');
  const pluginHooksPath = path.join(cwd, 'plugins', 'paradigm', 'hooks.json');
  if (fs.existsSync(hooksJsonPath)) {
    const stat = fs.statSync(hooksJsonPath);
    const ageMs = Date.now() - stat.mtime.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (ageDays > 30) {
      results.push({
        name: 'Claude Code hooks',
        status: 'warn',
        message: `Hooks are ${ageDays} days old — may be outdated`,
        fix: 'paradigm hooks install',
      });
    } else {
      results.push({
        name: 'Claude Code hooks',
        status: 'ok',
        message: ageDays > 0 ? `${ageDays} days old` : 'Fresh',
      });
    }
  } else if (fs.existsSync(pluginHooksPath)) {
    results.push({
      name: 'Claude Code hooks',
      status: 'ok',
      message: 'Using plugin hooks',
    });
  } else {
    results.push({
      name: 'Claude Code hooks',
      status: 'missing',
      message: 'No hooks installed',
      fix: 'paradigm hooks install',
    });
  }

  // Check habits config validity
  const habitsPath = path.join(paradigmDir, 'habits.yaml');
  if (fs.existsSync(habitsPath)) {
    try {
      const habitsContent = fs.readFileSync(habitsPath, 'utf8');
      const { parse } = await import('yaml');
      const habits = parse(habitsContent);
      if (habits?.version && Array.isArray(habits?.habits)) {
        const enabled = habits.habits.filter((h: { enabled?: boolean }) => h.enabled !== false).length;
        results.push({
          name: 'Habits config',
          status: 'ok',
          message: `Valid (${enabled}/${habits.habits.length} enabled)`,
        });
      } else {
        results.push({
          name: 'Habits config',
          status: 'warn',
          message: 'Missing version or habits array',
          fix: 'Regenerate habits.yaml with paradigm habits init',
        });
      }
    } catch (e) {
      results.push({
        name: 'Habits config',
        status: 'error',
        message: `Invalid YAML: ${(e as Error).message}`,
        fix: 'Check YAML syntax in habits.yaml',
      });
    }
  }

  // Check AGENTS.md staleness
  const agentsMdPath = path.join(cwd, 'AGENTS.md');
  if (fs.existsSync(agentsMdPath)) {
    const stat = fs.statSync(agentsMdPath);
    const ageMs = Date.now() - stat.mtime.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (ageDays > 60) {
      results.push({
        name: 'AGENTS.md',
        status: 'warn',
        message: `${ageDays} days since last update — may be stale`,
        fix: 'paradigm sync',
      });
    } else {
      results.push({
        name: 'AGENTS.md',
        status: 'ok',
        message: ageDays > 0 ? `Updated ${ageDays} days ago` : 'Fresh',
      });
    }
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
