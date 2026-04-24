/**
 * paradigm doctor - Health check for Paradigm setup
 *
 * Runs core health checks and optional context audit checks.
 *   --context   Run ONLY context audit checks (CLAUDE.md quality)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { log } from '../../utils/logger.js';
import { parseParadigmConfig } from '../../core/paradigm-config.js';
import { detectIDE, getAdapter } from '../../core/ide-adapters/index.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'missing';
  message: string;
  fix?: string;
}

interface DoctorOptions {
  quiet?: boolean;
  rootDir?: string;
  context?: boolean;
  /** When true, include human-readable gap narrations in the output */
  explain?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<boolean> {
  const cwd = options.rootDir || process.cwd();
  const results: CheckResult[] = [];
  const quiet = options.quiet;
  const contextOnly = options.context;

  if (!quiet) {
    console.log(chalk.blue('\n🩺 Paradigm Doctor\n'));
    if (contextOnly) {
      console.log(chalk.gray('Running context audit checks...\n'));
    } else {
      console.log(chalk.gray('Checking Paradigm setup...\n'));
    }
  }

  const tracker = log.command('doctor').start('Running health checks');

  // ──────────────────────────────────────────────────────────────────────
  // Core health checks (skipped when --context is specified)
  // ──────────────────────────────────────────────────────────────────────

  if (!contextOnly) {
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
        const specs = ['logger.md', 'probe.md', 'symbols.md'];
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

        // Check docs-class directories for .index.yaml coverage
        const docsClassDirs = ['specs', 'implementation-guides', 'prompts', 'decisions'];
        const missingIndexDirs: string[] = [];

        for (const dirName of docsClassDirs) {
          const dirPath = path.join(paradigmDir, dirName);
          if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            const indexPath = path.join(dirPath, '.index.yaml');
            if (!fs.existsSync(indexPath)) {
              missingIndexDirs.push(`.paradigm/${dirName}/`);
            }
          }
        }

        if (missingIndexDirs.length > 0) {
          results.push({
            name: 'Docs-class indexes',
            status: 'warn',
            message: `${missingIndexDirs.length} director${missingIndexDirs.length === 1 ? 'y' : 'ies'} missing .index.yaml: ${missingIndexDirs.join(', ')}`,
            fix: 'paradigm docs scaffold',
          });
        } else {
          results.push({
            name: 'Docs-class indexes',
            status: 'ok',
            message: 'All docs-class directories have .index.yaml',
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
    const configPath = path.join(cwd, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent) as Record<string, unknown>;
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
        const portal = yaml.load(portalContent) as Record<string, unknown>;
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
        const { checkPortalCompliance, getComplianceSummary } = await import('../../core/portal-compliance.js');
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
    const flowsPath = path.join(cwd, '.paradigm', 'flows.yaml');
    if (fs.existsSync(flowsPath)) {
      try {
        const flowsContent = fs.readFileSync(flowsPath, 'utf8');
        const flows = yaml.load(flowsContent) as Record<string, unknown>;
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
    const loreDir = path.join(cwd, '.paradigm', 'lore');
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

    // Check university health
    const universityDir = path.join(cwd, '.paradigm', 'university');
    if (fs.existsSync(universityDir)) {
      try {
        const contentDir = path.join(universityDir, 'content');
        let contentCount = 0;
        let issues = 0;

        if (fs.existsSync(contentDir)) {
          // Count content files
          for (const subdir of ['notes', 'policies', 'quizzes', 'paths']) {
            const sd = path.join(contentDir, subdir);
            if (fs.existsSync(sd)) {
              contentCount += fs.readdirSync(sd).filter(f => f.endsWith('.md') || f.endsWith('.yaml')).length;
            }
          }
        }

        if (contentCount === 0) {
          results.push({
            name: 'University content',
            status: 'warn',
            message: 'University directory exists but no content found',
            fix: 'Add content: paradigm university add note --title "Getting Started"',
          });
        } else {
          // Quick validation: check quiz answer validity
          const quizDir = path.join(contentDir, 'quizzes');
          if (fs.existsSync(quizDir)) {
            for (const file of fs.readdirSync(quizDir).filter(f => f.endsWith('.yaml'))) {
              try {
                const quiz = yaml.load(fs.readFileSync(path.join(quizDir, file), 'utf8')) as Record<string, unknown>;
                if (quiz?.questions) {
                  for (const q of quiz.questions) {
                    if (q.choices && q.correct && !(q.correct in q.choices)) {
                      issues++;
                    }
                  }
                }
              } catch { /* skip */ }
            }
          }

          // Check learning path references
          const pathDir = path.join(contentDir, 'paths');
          if (fs.existsSync(pathDir)) {
            for (const file of fs.readdirSync(pathDir).filter(f => f.endsWith('.yaml'))) {
              try {
                const lp = yaml.load(fs.readFileSync(path.join(pathDir, file), 'utf8')) as Record<string, unknown>;
                if (lp?.steps) {
                  for (const step of lp.steps) {
                    if (step.content && !step.content.startsWith('plsat:')) {
                      // Check if referenced content exists
                      let found = false;
                      for (const sd of ['notes', 'policies', 'quizzes', 'paths']) {
                        const sdPath = path.join(contentDir, sd);
                        if (fs.existsSync(sdPath)) {
                          const files = fs.readdirSync(sdPath);
                          if (files.some(f => f.startsWith(step.content))) {
                            found = true;
                            break;
                          }
                        }
                      }
                      if (!found) issues++;
                    }
                  }
                }
              } catch { /* skip */ }
            }
          }

          if (issues > 0) {
            results.push({
              name: 'University content',
              status: 'warn',
              message: `${contentCount} items, ${issues} issue${issues > 1 ? 's' : ''}`,
              fix: 'Run: paradigm university validate --deep',
            });
          } else {
            results.push({
              name: 'University content',
              status: 'ok',
              message: `${contentCount} content item${contentCount > 1 ? 's' : ''}`,
            });
          }
        }
      } catch {
        results.push({
          name: 'University content',
          status: 'warn',
          message: 'Could not read university directory',
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
    const habitsPath = path.join(cwd, '.paradigm', 'habits.yaml');
    if (fs.existsSync(habitsPath)) {
      try {
        const habitsContent = fs.readFileSync(habitsPath, 'utf8');
        const habits = yaml.load(habitsContent) as Record<string, unknown>;
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
  }

  // ──────────────────────────────────────────────────────────────────────
  // Display core results
  // ──────────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────────
  // Context audit checks
  // ──────────────────────────────────────────────────────────────────────

  const { runContextAudit } = await import('./context-audit.js');
  const contextResults = await runContextAudit(cwd, { quiet });

  let contextErrorCount = 0;
  let contextWarnCount = 0;
  let contextAdvisoryCount = 0;

  if (!quiet && contextResults.length > 0) {
    console.log('');
    console.log(chalk.blue('  Context Audit'));
    console.log(chalk.gray('  ─────────────'));
  }

  for (const result of contextResults) {
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
        contextWarnCount++;
        break;
      case 'error':
        icon = '✗';
        color = chalk.red;
        contextErrorCount++;
        break;
      case 'advisory':
        icon = 'ℹ';
        color = chalk.cyan;
        contextAdvisoryCount++;
        break;
    }

    if (!quiet) {
      const namePadded = result.check.padEnd(30);
      console.log(`  ${color(icon)} ${namePadded} ${color(result.message)}`);

      if (result.details && result.details.length > 0) {
        const shown = result.details.slice(0, 5);
        for (const detail of shown) {
          console.log(chalk.gray(`    │ ${detail}`));
        }
        if (result.details.length > 5) {
          console.log(chalk.gray(`    │ ... and ${result.details.length - 5} more`));
        }
      }

      if (result.fix) {
        console.log(chalk.gray(`    └─ Fix: ${result.fix}`));
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────

  const totalErrors = errorCount + contextErrorCount;
  const totalWarns = warnCount + contextWarnCount;
  const issueCount = totalErrors + totalWarns + missingCount;
  const healthy = issueCount === 0;

  if (!quiet) {
    console.log('');

    if (healthy) {
      console.log(chalk.green('✨ All checks passed!\n'));
    } else {
      const parts: string[] = [];
      if (totalErrors > 0) parts.push(chalk.red(`${totalErrors} error${totalErrors > 1 ? 's' : ''}`));
      if (totalWarns > 0) parts.push(chalk.yellow(`${totalWarns} warning${totalWarns > 1 ? 's' : ''}`));
      if (missingCount > 0) parts.push(chalk.gray(`${missingCount} missing`));
      if (contextAdvisoryCount > 0) parts.push(chalk.cyan(`${contextAdvisoryCount} advisor${contextAdvisoryCount > 1 ? 'ies' : 'y'}`));

      console.log(`${parts.join(', ')} found.\n`);
      console.log(chalk.gray('Run the suggested commands to fix issues.'));
      console.log(chalk.gray('Troubleshooting guide: .paradigm/docs/troubleshooting.md\n'));
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Gap narrations (--explain flag)
  // ──────────────────────────────────────────────────────────────────────

  if (!quiet && options.explain && !healthy) {
    try {
      const { narrateAllGaps } = await import('../../utils/gap-narrator.js');

      // Map doctor results to gap-narrator CheckResults
      const gapCheckResults = [];

      for (const result of results) {
        if (result.status === 'ok') continue;
        // Map doctor check names to gap-narrator check types
        if (result.name === '.purpose' || result.name.startsWith('Purpose-required')) {
          gapCheckResults.push({ type: 'missing-purpose' as const, target: result.name, severity: 'improvement' as const });
        } else if (result.name === '.paradigm/scan-index.json' && result.status === 'warn') {
          gapCheckResults.push({ type: 'index-stale' as const, target: result.name, severity: 'improvement' as const });
        } else if (result.name === 'Portal compliance') {
          gapCheckResults.push({ type: 'portal-mismatch' as const, target: result.name, severity: (result.status === 'error' ? 'blocking' : 'improvement') as const });
        } else if (result.name === 'Clarification markers') {
          gapCheckResults.push({ type: 'missing-description' as const, target: result.name, severity: 'improvement' as const });
        }
      }

      if (gapCheckResults.length > 0) {
        const report = narrateAllGaps(gapCheckResults);
        console.log(chalk.blue('\n  Gap Narrations (--explain)\n'));
        console.log(chalk.gray(report.narrative));
        console.log('');
      }
    } catch {
      // Gap narrations are advisory — do not fail if narrator cannot load
    }
  }

  if (healthy) {
    tracker.success('All health checks passed', { total: results.length + contextResults.length });
  } else {
    tracker.error('Health checks found issues', {
      errors: totalErrors,
      warnings: totalWarns,
      missing: missingCount,
      advisories: contextAdvisoryCount,
    });
  }

  // v6.0 (D7): capture a privacy-preserving university metrics snapshot.
  // Non-fatal on any error — metrics never block doctor.
  try {
    const { captureSnapshot } = await import('../../core/university/metrics.js');
    captureSnapshot(cwd);
  } catch {
    // non-fatal
  }

  return healthy;
}
