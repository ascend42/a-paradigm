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
import { out, success, warn, dim, header, kv } from '../../utils/cli-output.js';
import {
  readClassroomCertifications,
  computeRepeatFailureRate,
} from '@a-company/premise-core';
// Relative-path import into bundled paradigm-mcp source (same pattern as core/task-bridge.ts).
import { listLearningStores } from '../../../../paradigm-mcp/src/utils/learning-stores.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'missing' | 'info';
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

/**
 * Learning-liveness rollup (T-2026-06-13-004; D7 in 7.12.0): journals-written
 * over a REAL denominator of completions, read from the UNION of both probe
 * files — postflight-liveness.jsonl (one row per postflight pass) and
 * settlement-liveness.jsonl (one row per task-DAG settlement). Before 7.12.0
 * doctor read only the postflight file, which was absent in practice, so the
 * alarm was blind while 13 settlements recorded journalsWritten:0.
 *
 * Levels (NO DATA IS NEVER GREEN):
 *   red    — 0 journals over ≥ FLATLINE_MIN_COMPLETIONS completions (flatline)
 *   amber  — journals/completions < AMBER_RATIO over ≥ AMBER_MIN_COMPLETIONS
 *   nodata — no rows at all (alarm: the probe itself may be dead)
 *   thin   — some rows but < FLATLINE_MIN_COMPLETIONS (too few to judge)
 *   green  — otherwise
 * Plus probeSilent: ≥ 5 settlement rows but ZERO postflight rows (the
 * postflight probe never fires). Pure + exported for unit tests.
 *
 * NO DOUBLE COUNTING: a task-DAG settlement runs runPostflightLearning, so one
 * completion can write BOTH a settlement row and a postflight row. Rows that
 * share a task id across the two files collapse into one completion (journals =
 * the max of the pair). Rows that cannot be paired — today postflight rows carry
 * only a sessionId, never a task id — are counted as max(postflight,
 * settlement) completions over each file's own window, never the sum; the
 * journals numerator comes from that same dominant file (tie → postflight, the
 * journal writer itself) so the ratio's numerator and denominator always come
 * from one probe.
 */
export interface LearningLivenessRecord {
  journalsWritten?: number;
  ts?: string;
  /** Which probe file the row came from. Unset rows count as postflight. */
  source?: 'postflight' | 'settlement';
  /** Task/orchestration id when the row carries one (settlement: parentTaskId). */
  taskId?: string;
}

export type LearningLivenessLevel = 'red' | 'amber' | 'nodata' | 'thin' | 'green';

export interface LearningLivenessSummary {
  /** Denominator: completions observed in the window. Always ≥ 0, never null. */
  completions: number;
  /** Numerator: journals written across the window. */
  journalsWritten: number;
  /** True when completions ≥ FLATLINE_MIN and journalsWritten === 0. */
  flatline: boolean;
  /** The window size applied. */
  windowSize: number;
  level: LearningLivenessLevel;
  /** ≥ PROBE_SILENT_MIN settlement rows and no postflight rows (whole input, not windowed). */
  probeSilent: boolean;
  postflightRows: number;
  settlementRows: number;
}

const FLATLINE_MIN_COMPLETIONS = 5;
const AMBER_MIN_COMPLETIONS = 10;
const AMBER_RATIO = 0.2;
const PROBE_SILENT_MIN = 5;

export function summarizeLearningLiveness(
  records: LearningLivenessRecord[],
  window = 20,
): LearningLivenessSummary {
  const jw = (r: LearningLivenessRecord) => (typeof r.journalsWritten === 'number' ? r.journalsWritten : 0);
  const sum = (rs: LearningLivenessRecord[]) => rs.reduce((n, r) => n + jw(r), 0);
  const pfWin = records.filter(r => r.source !== 'settlement').slice(-window);
  const stWin = records.filter(r => r.source === 'settlement').slice(-window);

  // Pair rows that share a task id across the two files (one completion).
  const stByKey = new Map<string, LearningLivenessRecord>();
  for (const r of stWin) if (r.taskId) stByKey.set(r.taskId, r);
  const pairedKeys = new Set<string>();
  let pairedJournals = 0;
  for (const r of pfWin) {
    const st = r.taskId ? stByKey.get(r.taskId) : undefined;
    if (st && r.taskId && !pairedKeys.has(r.taskId)) {
      pairedKeys.add(r.taskId);
      pairedJournals += Math.max(jw(r), jw(st));
    }
  }
  const isPaired = (r: LearningLivenessRecord) => !!r.taskId && pairedKeys.has(r.taskId);
  const pfRest = pfWin.filter(r => !isPaired(r));
  const stRest = stWin.filter(r => !isPaired(r));
  // Unpairable rows: max, not sum; numerator from the same dominant probe.
  const rest = stRest.length > pfRest.length ? stRest : pfRest;
  const completions = pairedKeys.size + rest.length;
  const journalsWritten = pairedJournals + sum(rest);
  const flatline = completions >= FLATLINE_MIN_COMPLETIONS && journalsWritten === 0;
  const postflightRows = records.filter(r => r.source === 'postflight').length;
  const settlementRows = records.filter(r => r.source === 'settlement').length;
  const probeSilent = settlementRows >= PROBE_SILENT_MIN && postflightRows === 0;

  let level: LearningLivenessLevel;
  if (completions === 0) level = 'nodata';
  else if (flatline) level = 'red';
  else if (completions >= AMBER_MIN_COMPLETIONS && journalsWritten / completions < AMBER_RATIO) level = 'amber';
  else if (completions < FLATLINE_MIN_COMPLETIONS) level = 'thin';
  else level = 'green';

  return { completions, journalsWritten, flatline, windowSize: window, level, probeSilent, postflightRows, settlementRows };
}

function readJsonlRows(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
}

/**
 * Read BOTH liveness probe files and return the union, ordered by ts. A row
 * without ts inherits the ts of the nearest preceding row in its OWN file
 * ('' before the first), so it keeps its file position; ties break on
 * postflight-first file order. That is a total order, so the comparator is
 * consistent even when only some rows carry ts. Exported for tests.
 */
export function readLearningLivenessRecords(rootDir: string): LearningLivenessRecord[] {
  const ev = path.join(rootDir, '.paradigm', 'events');
  const tag = (source: 'postflight' | 'settlement') => (r: Record<string, unknown>): LearningLivenessRecord => ({
    journalsWritten: typeof r.journalsWritten === 'number' ? r.journalsWritten : undefined,
    ts: typeof r.ts === 'string' ? r.ts : undefined,
    source,
    taskId: ['taskId', 'parentTaskId', 'orchestrationId']
      .map(k => r[k]).find((v): v is string => typeof v === 'string' && v.length > 0),
  });
  const withSortKey = (rows: LearningLivenessRecord[]) => {
    let last = '';
    return rows.map(r => ({ r, key: (last = r.ts ?? last) }));
  };
  const rows = [
    ...withSortKey(readJsonlRows(path.join(ev, 'postflight-liveness.jsonl')).map(tag('postflight'))),
    ...withSortKey(readJsonlRows(path.join(ev, 'settlement-liveness.jsonl')).map(tag('settlement'))),
  ];
  return rows
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.i - b.i)
    .map(x => x.r);
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

    // v6.0.4: Aspect coverage line — surfaces components/aspects ratio.
    // Status depends on whether the compliance archetype (Rune) is on the
    // roster. Rune-rostered → ok. No claimant → info (non-blocking metric).
    // Suppressed entirely when no components scanned (fresh init).
    {
      const scanIndexPath = path.join(cwd, '.paradigm', 'scan-index.json');
      const rosterPath = path.join(cwd, '.paradigm', 'roster.yaml');
      try {
        if (fs.existsSync(scanIndexPath)) {
          const scanRaw = fs.readFileSync(scanIndexPath, 'utf8');
          const scanIndex = JSON.parse(scanRaw) as {
            components?: Record<string, unknown>;
            aspects?: Record<string, unknown>;
          };
          const componentCount = Object.keys(scanIndex.components ?? {}).length;
          const aspectCount = Object.keys(scanIndex.aspects ?? {}).length;

          // Suppress entirely on a fresh-init project (no components scanned).
          if (componentCount > 0) {
            let complianceRostered = false;
            if (fs.existsSync(rosterPath)) {
              try {
                const rosterParsed = yaml.load(fs.readFileSync(rosterPath, 'utf8')) as {
                  active?: string[];
                } | null;
                complianceRostered =
                  Array.isArray(rosterParsed?.active) &&
                  rosterParsed!.active!.includes('compliance');
              } catch {
                // Treat unreadable roster as no-claimant.
              }
            }

            const ratio = `${componentCount}:${aspectCount} components:aspects`;
            if (complianceRostered) {
              results.push({
                name: 'Aspect coverage',
                status: 'ok',
                message: `${ratio} (claimant: rune)`,
              });
            } else if (aspectCount === 0) {
              results.push({
                name: 'Aspect coverage',
                status: 'info',
                message: `${ratio} ${chalk.dim('(no aspects defined)')}`,
              });
            } else {
              results.push({
                name: 'Aspect coverage',
                status: 'info',
                message: `${ratio} ${chalk.dim('(no claimant active)')}`,
              });
            }
          }
        }
      } catch {
        // Defensive: if scan-index is corrupt or unreadable, skip the line
        // entirely rather than emitting an error — this is an advisory metric.
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

    // Check university health (only when a project pack has content — a
    // missing .paradigm/university/ is never a finding as of 7.11.0)
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
          // 7.11.0: packs are opt-in. A missing or empty university dir (e.g.
          // the pre-7.11 empty scaffold `paradigm shift` used to create) is
          // not a finding — only real content gets validated below.
        } else {
          // Quick validation: check quiz answer validity
          const quizDir = path.join(contentDir, 'quizzes');
          if (fs.existsSync(quizDir)) {
            for (const file of fs.readdirSync(quizDir).filter(f => f.endsWith('.yaml'))) {
              try {
                const quiz = yaml.load(fs.readFileSync(path.join(quizDir, file), 'utf8')) as {
                  questions?: Array<{ choices?: Record<string, unknown>; correct?: string }>;
                } | null;
                if (Array.isArray(quiz?.questions)) {
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
                const lp = yaml.load(fs.readFileSync(path.join(pathDir, file), 'utf8')) as {
                  steps?: Array<{ content?: unknown }>;
                } | null;
                if (Array.isArray(lp?.steps)) {
                  for (const step of lp.steps) {
                    const content = step?.content;
                    if (typeof content === 'string' && !content.startsWith('plsat:')) {
                      // Check if referenced content exists
                      let found = false;
                      for (const sd of ['notes', 'policies', 'quizzes', 'paths']) {
                        const sdPath = path.join(contentDir, sd);
                        if (fs.existsSync(sdPath)) {
                          const files = fs.readdirSync(sdPath);
                          if (files.some(f => f.startsWith(content))) {
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

    // Agent profile keys + roster dispatchability (TD-2026-09-26-846)
    try {
      const { auditAgents } = await import('./agent-audit.js');
      const audit = auditAgents(cwd);

      if (audit.unknownKeys.length > 0) {
        const detail = audit.unknownKeys
          .map(u => `${path.basename(u.file)} (${u.keys.join(', ')})`)
          .join('; ');
        results.push({
          name: 'Agent profile keys',
          status: 'warn',
          message: `Unknown keys in ${audit.unknownKeys.length} profile(s): ${detail}`,
          fix: 'Remove or rename the unknown keys — they are ignored by the loader',
        });
      }
      // Reported independently of the unknown-keys warning
      if (audit.unreadKeys.length > 0) {
        results.push({
          name: 'Agent profile keys',
          status: 'info',
          message: `\`behaviors:\` present in ${audit.unreadKeys.length} profiles — unread until skills (Phase 1)`,
        });
      }
      for (const mb of audit.migratedBehaviors) {
        results.push({
          name: 'Agent profile keys',
          status: 'info',
          message: `${path.basename(mb.file)} \`behaviors.${mb.block}\` migrated to skill ${mb.skillId} — the block can be removed`,
        });
      }
      if (audit.unknownKeys.length === 0 && audit.unreadKeys.length === 0) {
        results.push({ name: 'Agent profile keys', status: 'ok', message: 'All profile keys recognized' });
      }

      if (audit.rosterGaps.length > 0 || audit.benchedOnRoster.length > 0) {
        const bits: string[] = [];
        if (audit.rosterGaps.length > 0) bits.push(`no profile: ${audit.rosterGaps.join(', ')}`);
        if (audit.benchedOnRoster.length > 0) bits.push(`benched: ${audit.benchedOnRoster.join(', ')}`);
        results.push({
          name: 'Roster dispatchability',
          status: 'warn',
          message: `${audit.rosterGaps.length + audit.benchedOnRoster.length} roster agent(s) cannot be dispatched — ${bits.join('; ')}`,
          fix: '`paradigm agent sync-global` to install bundled profiles, or deactivate the agent (remove it from .paradigm/roster.yaml; clear `benched: true` on benched profiles)',
        });
      } else {
        results.push({ name: 'Roster dispatchability', status: 'ok', message: 'Every roster agent is dispatchable' });
      }
    } catch {
      // Agent audit is advisory — never fail doctor on it.
    }

    // Legacy MCP tool names (7.13.0 surface cut — aliases removed in 7.15)
    try {
      const { auditLegacyToolNames } = await import('./legacy-names-audit.js');
      const legacy = auditLegacyToolNames(cwd);
      const permHits = legacy.hits.filter(h => h.permission);
      const textHits = legacy.hits.filter(h => !h.permission);
      if (permHits.length > 0) {
        const detail = permHits.slice(0, 5).map(h => `${h.legacy} → ${h.replacement}`).join('; ');
        results.push({
          name: 'Legacy tool names (permissions)',
          status: 'warn',
          message: `${permHits.length} legacy name(s) in .claude permission allowlists no longer match a listed tool: ${detail}${permHits.length > 5 ? '; …' : ''}`,
          fix: 'Replace `mcp__paradigm__paradigm_<family>_<op>` entries with the family tool, e.g. `mcp__paradigm__paradigm_lore`',
        });
      }
      if (textHits.length > 0) {
        const files = [...new Set(textHits.map(h => h.file))];
        const sample = textHits.slice(0, 3).map(h => `${h.legacy} → ${h.replacement}`).join('; ');
        results.push({
          name: 'Legacy tool names',
          status: 'warn',
          message: `${textHits.reduce((n, h) => n + h.count, 0)} pre-7.13 tool reference(s) in ${files.join(', ')} (hidden aliases until 7.15): ${sample}`,
          fix: '`paradigm sync` to regenerate managed sections; hand-edit the rest to `paradigm_<family>({op:\'<op>\'})`',
        });
      }
      if (legacy.hits.length === 0 && legacy.filesScanned > 0) {
        results.push({ name: 'Legacy tool names', status: 'ok', message: 'No pre-7.13 tool names in agent instructions or permissions' });
      }
    } catch {
      // Advisory — never fail doctor on it.
    }

    // Team-invocation funnel (Pillar 0 telemetry: eligible → orchestrated/solo/bypass)
    try {
      const { summarizeTeamFunnel } = await import('../../core/team-funnel.js');
      const funnel = summarizeTeamFunnel(cwd, 30);
      const resolved = funnel.orchestrated + funnel.soloDeclared + funnel.bypasses;
      if (resolved > 0 || funnel.eligible > 0) {
        const rate = funnel.invocationRate !== null ? `${Math.round(funnel.invocationRate * 100)}%` : 'n/a';
        const legible = funnel.legibleRate !== null ? `${Math.round(funnel.legibleRate * 100)}%` : 'n/a';
        const soloBits = Object.entries(funnel.soloByReason).map(([r, n]) => `${r}:${n}`).join(' ');
        results.push({
          name: 'Team funnel (30d)',
          // Bypasses outnumbering team runs = the gate is leaking; surface as warn
          status: funnel.bypasses > funnel.orchestrated ? 'warn' : 'info',
          message: `eligible ${funnel.eligible} · orchestrated ${funnel.orchestrated} · solo ${funnel.soloDeclared}${soloBits ? ` (${soloBits})` : ''} · bypass ${funnel.bypasses} · invocation ${rate} · legible ${legible}`,
          ...(funnel.bypasses > funnel.orchestrated
            ? { fix: 'Orchestrate eligible tasks (paradigm_orchestrate_inline) or declare `paradigm solo <reason>`' }
            : {}),
        });
      }
    } catch {
      // Telemetry is advisory — never fail doctor on it.
    }

    // Learning liveness — ONE check (T-2026-06-13-004, D7 7.12.0). Merges the
    // older "Learning-loop liveness" chain probe (v7 §2.3: per-stage
    // ok|threw|skipped + chainLive on each settlement row) with the journals-
    // over-completions rollup read from BOTH probe files. They used to be two
    // lines, so a FLATLINE ✗ printed right under a green "chain live" ✓. Now the
    // chain state is a sub-detail and the status is the WORST of the two: a
    // flatline can never display alongside a green liveness line. No data is an
    // alarm, never green — a missing probe must not pass as healthy.
    try {
      // Chain sub-detail from settlement rows (severed stages).
      type Chain = { status: CheckResult['status']; text: string; fix?: string };
      let chain: Chain | undefined;
      const settlementRows = readJsonlRows(path.join(cwd, '.paradigm', 'events', 'settlement-liveness.jsonl')) as Array<{
        chainLive?: boolean; stages?: Record<string, string>;
      }>;
      if (settlementRows.length > 0) {
        const window = settlementRows.slice(-20);
        const dead = window.filter(r => r.chainLive === false);
        const dead5 = settlementRows.slice(-5).filter(r => r.chainLive === false);
        // Name the failing stage(s) from the most recent dead record.
        const lastDead = dead.length > 0 ? dead[dead.length - 1] : undefined;
        const failingStages = lastDead?.stages
          ? Object.entries(lastDead.stages).filter(([, v]) => v === 'threw').map(([k]) => k)
          : [];
        const stageNote = failingStages.length > 0 ? ` (stage: ${failingStages.join(', ')})` : '';
        const chainFix = 'A settlement-chain stage is throwing. Inspect .paradigm/events/settlement-liveness.jsonl and the named stage.';
        if (dead5.length >= 3) {
          chain = { status: 'error', text: `DEAD CHAIN: ${dead5.length}/5 recent settlements severed${stageNote} — the learning loop is not closing`, fix: chainFix };
        } else if (dead.length > 0) {
          chain = { status: 'warn', text: `chain severed in ${dead.length}/${window.length} recent settlements${stageNote}`, fix: chainFix };
        } else {
          chain = { status: 'ok', text: `chain live (${window.length} recent settlements)` };
        }
      }

      const s = summarizeLearningLiveness(readLearningLivenessRecords(cwd));
      const ratio = `${s.journalsWritten} journals / ${s.completions} completions`;
      const src = `(postflight ${s.postflightRows}, settlement ${s.settlementRows} rows)`;
      const fix = 'Inspect .paradigm/events/{postflight,settlement}-liveness.jsonl. Check verdicts are recorded (paradigm_ambient_engage) and that postflight journals on completion.';
      let live: { status: CheckResult['status']; message: string; fix?: string };
      switch (s.level) {
        case 'nodata':
          live = {
            // Not 'ok' (never green), but not a doctor failure either — a fresh
            // project legitimately has no completions yet.
            status: 'info',
            message: 'NO DATA: neither liveness probe has recorded a completion — the loop cannot be shown to be alive',
            fix: 'Complete a task through the task DAG (settlement) or run postflight; if completions happen and this stays empty, a probe is dead.',
          };
          break;
        case 'red':
          live = { status: 'error', message: `FLATLINE: ${ratio} ${src} — the loop is turning but producing no learnings`, fix };
          break;
        case 'amber':
          live = { status: 'warn', message: `LOW: ${ratio} ${src} — below ${AMBER_RATIO} journals per completion`, fix };
          break;
        case 'thin':
          live = { status: 'info', message: `${ratio} ${src} — too few completions to judge (need ${FLATLINE_MIN_COMPLETIONS})` };
          break;
        default:
          live = { status: 'ok', message: `${ratio} over last ${s.completions} completion${s.completions === 1 ? '' : 's'} ${src}` };
      }

      const rank: Record<CheckResult['status'], number> = { ok: 0, info: 1, missing: 2, warn: 3, error: 4 };
      const chainWorse = !!chain && rank[chain.status] > rank[live.status];
      const status = chainWorse ? chain!.status : live.status;
      const message = chain?.status === 'error'
        ? `${chain.text} · ${live.message}`
        : chain ? `${live.message} · ${chain.text}` : live.message;
      const checkFix = chainWorse ? chain!.fix : (live.fix ?? chain?.fix);
      results.push({ name: 'Learning liveness', status, message, ...(checkFix ? { fix: checkFix } : {}) });
      if (s.probeSilent) {
        results.push({
          name: 'Learning liveness probe',
          status: 'warn',
          message: `probe silent: ${s.settlementRows} settlement rows but 0 postflight-liveness rows — the postflight probe is not firing`,
          fix: 'postflight-liveness.jsonl is written by runPostflightLearning on each non-dry-run pass; check it is reached.',
        });
      }
    } catch {
      // Probe read is advisory — never fail doctor on it.
    }

    // Learning-store census (D5, 7.12.0): every store the registry knows, with
    // class + count. Read-only; informational.
    try {
      const stores = listLearningStores(cwd);
      const parts = stores
        .filter(st => st.count() > 0)
        .map(st => `${st.id}[${st.class}]=${st.count()}`);
      const empty = stores.length - parts.length;
      results.push({
        name: 'Learning stores',
        status: 'info',
        message: `${stores.length} registered · ${parts.join(', ') || 'all empty'}${empty > 0 ? ` · ${empty} empty` : ''}`,
      });
      const legacy = path.join(cwd, '.paradigm', 'wisdom', 'decisions');
      if (fs.existsSync(legacy)) {
        results.push({
          name: 'Learning stores',
          status: 'warn',
          message: 'legacy .paradigm/wisdom/decisions/ still present — no longer read (7.12.0)',
          fix: 'paradigm migrate learning-stores --dry-run, then paradigm migrate learning-stores',
        });
      }
    } catch {
      // Census is advisory.
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Classroom / learning health (TD-2026-06-19-007)
  //
  // The "is the team getting stronger?" scoreboard. Computed by premise-core's
  // ONE canonical rollup — the SAME code the paradigm_classroom_status MCP tool
  // uses, so the doctor metric can never drift from the tool. Degrades calmly
  // to a "no certifications yet" line; never errors on absent/corrupt data.
  //
  // Rendered as its own block (below), but we push a CheckResult here for the
  // WARN case so a high/rising repeat-failure-rate counts toward exit health.
  // ──────────────────────────────────────────────────────────────────────
  const classroom = (() => {
    try {
      const certs = readClassroomCertifications(cwd);
      const rollup = computeRepeatFailureRate(certs);
      const resolvedTotal = Object.values(rollup.perAgent).reduce(
        (n, a) => n + a.resolved,
        0,
      );
      const overturnedTotal = Object.values(rollup.perAgent).reduce(
        (n, a) => n + a.overturned,
        0,
      );
      return {
        present: certs.length > 0,
        certCount: certs.length,
        rollup,
        resolvedTotal,
        overturnedTotal,
      };
    } catch {
      // Advisory metric — a read failure must never break doctor.
      return null;
    }
  })();

  // Thresholds (MVP): warn if the global rate is high once enough certs have
  // resolved to be meaningful. Floor avoids screaming over a single unlucky cert.
  const REPEAT_FAILURE_WARN_THRESHOLD = 0.5;
  const REPEAT_FAILURE_RESOLVED_FLOOR = 3;
  if (
    classroom &&
    classroom.rollup.overall !== null &&
    classroom.resolvedTotal >= REPEAT_FAILURE_RESOLVED_FLOOR &&
    classroom.rollup.overall > REPEAT_FAILURE_WARN_THRESHOLD
  ) {
    results.push({
      name: 'Repeat-failure-rate',
      status: 'warn',
      message: `High: ${classroom.rollup.overall} of resolved certs were overturned (${classroom.overturnedTotal}/${classroom.resolvedTotal})`,
      fix: 'Learnings are breaking repeatedly — review refinements via /paradigm:class review',
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Hook health (7.15.2, #doctor-hook-health): per-hook timings + kills from
  // the #hook-monitor ring, repo traits that slow hooks, plugin cache staleness.
  // Advisory: never throws into the doctor run.
  // ──────────────────────────────────────────────────────────────────────
  if (!contextOnly && fs.existsSync(path.join(cwd, '.paradigm'))) {
    try {
      const { hookHealthChecks } = await import('./hook-health.js');
      const os = await import('os');
      results.push(...hookHealthChecks({ rootDir: cwd, homeDir: os.homedir() }));
    } catch {
      // hook health is advisory
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
      case 'info':
        // v6.0.4: 'info' is a non-status indicator — surfaces metrics when
        // no claimant is active. Does not increment any counter and never
        // affects the healthy/exit-code calculation.
        icon = '⠂';
        color = chalk.gray;
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
  // Classroom / learning health — detailed block (cli-output helpers)
  //
  // Rendered only when classroom data could be read. The WARN line (high rate)
  // is already counted via the CheckResult above; this block is the human view
  // of the rollup — global rate, per-agent rates, and a healthy advisory when
  // a learning has been overturned (the loop is CORRECTING, which is good).
  // ──────────────────────────────────────────────────────────────────────
  if (!quiet && classroom) {
    header('Classroom / learning health');
    if (!classroom.present) {
      dim('  No certifications yet — the learning loop has not turned. This is normal for a fresh project.');
    } else {
      const { overall } = classroom.rollup;
      const rateLabel = overall === null
        ? 'n/a (no certs resolved yet)'
        : String(overall);
      kv('repeat-failure-rate (global)', rateLabel);
      kv('resolved / overturned', `${classroom.resolvedTotal} / ${classroom.overturnedTotal}`);

      // Per-agent split — only agents with at least one resolved cert.
      const agents = Object.keys(classroom.rollup.perAgent).sort();
      if (agents.length > 0) {
        out('  ' + chalk.dim('per-agent:'));
        for (const agent of agents) {
          const a = classroom.rollup.perAgent[agent];
          const rate = a.rate === null ? 'n/a' : String(a.rate);
          out(`    ${chalk.dim(agent + ':')} rate ${rate} (${a.overturned}/${a.resolved} overturned)`);
        }
      }

      // Healthy advisory: an overturned cert means the field caught a learning
      // and the loop is correcting — NOT a red flag on its own.
      if (classroom.overturnedTotal > 0) {
        dim(`  ${classroom.overturnedTotal} learning${classroom.overturnedTotal > 1 ? 's were' : ' was'} overturned by the field — the loop is correcting (healthy).`);
      }

      // High-rate WARN echoes the CheckResult so the block is self-contained.
      if (
        overall !== null &&
        classroom.resolvedTotal >= 3 &&
        overall > 0.5
      ) {
        warn(`  Repeat-failure-rate is high (${overall} > 0.5) — learnings are breaking repeatedly. Review refinements via /paradigm:class review.`);
      } else if (overall !== null) {
        success('  Repeat-failure-rate within healthy range.');
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
      const gapCheckResults: Parameters<typeof narrateAllGaps>[0] = [];

      for (const result of results) {
        if (result.status === 'ok') continue;
        // Map doctor check names to gap-narrator check types
        if (result.name === '.purpose' || result.name.startsWith('Purpose-required')) {
          gapCheckResults.push({ type: 'missing-purpose' as const, target: result.name, severity: 'improvement' as const });
        } else if (result.name === '.paradigm/scan-index.json' && result.status === 'warn') {
          gapCheckResults.push({ type: 'index-stale' as const, target: result.name, severity: 'improvement' as const });
        } else if (result.name === 'Portal compliance') {
          gapCheckResults.push({ type: 'portal-mismatch' as const, target: result.name, severity: result.status === 'error' ? 'blocking' : 'improvement' });
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


  return healthy;
}
