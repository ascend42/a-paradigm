/**
 * migration-notices.ts — v6.0.4 one-time migration notices
 *
 * Emits a one-time notice on first `paradigm` CLI invocation for projects
 * that fall into "cohort C" of the v6.0.4 enforcement-model migration:
 * projects that define ~aspects in any .purpose file but do NOT have the
 * `compliance` archetype on their roster. Without a claimant, the Stop
 * hook no longer enforces aspect coverage/drift — users in this cohort
 * silently lose enforcement they previously had, so we surface the
 * change once and write a marker file so the message never repeats.
 *
 * The cohort-C predicate is exported so `paradigm shift` can reuse it
 * for its Step 2c-nominate-compliance prompt without duplicating the
 * .purpose-file walk.
 *
 * Symbol: #migration-notices
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';

const MIGRATION_MARKER = '.v6-0-4-migration-acknowledged';
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.paradigm',
  '.cache',
]);

/**
 * Walk a project root looking for any `.purpose` file containing an aspect
 * declaration. Matches both YAML mapping-key form (`  ~aspect:`) and
 * YAML list-item form (`  - ~aspect`) — the latter is the most common
 * shape in .purpose files (`aspects:\n  - ~name`). Walk is bounded —
 * skips heavy/irrelevant directories and exits early on first match.
 */
function projectHasAspectsDefined(projectRoot: string): boolean {
  function walk(dir: string, depth: number): boolean {
    // Defensive depth cap — prevents pathological symlink loops.
    if (depth > 8) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        if (walk(path.join(dir, entry.name), depth + 1)) return true;
      } else if (entry.isFile() && entry.name === '.purpose') {
        try {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
          if (/^\s*-?\s*~/m.test(content)) return true;
        } catch {
          // ignore unreadable files
        }
      }
    }
    return false;
  }
  return walk(projectRoot, 0);
}

/**
 * Read `.paradigm/roster.yaml` and return whether the `compliance` archetype
 * is present in `active`. Returns `false` on any read/parse error so callers
 * can treat "no roster" the same as "no claimant".
 */
function rosterHasCompliance(projectRoot: string): boolean {
  const rosterPath = path.join(projectRoot, '.paradigm', 'roster.yaml');
  if (!fs.existsSync(rosterPath)) return false;
  try {
    const content = fs.readFileSync(rosterPath, 'utf8');
    const parsed = yaml.load(content) as { active?: string[] } | null;
    return Array.isArray(parsed?.active) && parsed!.active!.includes('compliance');
  } catch {
    return false;
  }
}

/**
 * Cohort C predicate — true when the project defines ~aspects but has no
 * compliance-archetype claimant. Exported so `paradigm shift` can reuse it.
 */
export function isCohortC(projectRoot: string): boolean {
  if (rosterHasCompliance(projectRoot)) return false;
  return projectHasAspectsDefined(projectRoot);
}

/**
 * Emit the v6.0.4 migration notice once for cohort-C projects.
 *
 * No-ops when:
 * - Marker file `.paradigm/.v6-0-4-migration-acknowledged` exists
 * - `.paradigm/` directory does not exist (uninitialized project)
 * - Project is not in cohort C (compliance rostered, or no aspects defined)
 *
 * Writes the marker file after the first emission so the notice never
 * repeats. Failures are silent — this is advisory, never blocking.
 */
export async function checkAndEmitMigrationNotices(projectRoot: string): Promise<void> {
  try {
    const paradigmDir = path.join(projectRoot, '.paradigm');
    if (!fs.existsSync(paradigmDir)) return;

    const markerPath = path.join(paradigmDir, MIGRATION_MARKER);
    if (fs.existsSync(markerPath)) return;

    if (!isCohortC(projectRoot)) return;

    const notice = [
      '',
      chalk.yellow('[paradigm 6.0.4] Enforcement model changed.'),
      '',
      'This project defines ~aspects but has no compliance-archetype agent on',
      'the roster. Previously, the Stop hook blocked on aspect drift. As of',
      '6.0.4, the framework no longer enforces aspect coverage in absentia.',
      '',
      `Run \`${chalk.cyan('paradigm shift')}\` to nominate Rune (compliance) for this project, or`,
      'ignore this notice to opt out of aspect enforcement.',
      '',
      chalk.dim('This message will not appear again.'),
      '',
    ].join('\n');
    console.log(notice);

    try {
      fs.writeFileSync(
        markerPath,
        `Acknowledged at ${new Date().toISOString()}\n`,
        'utf8'
      );
    } catch {
      // If we cannot write the marker, the notice will fire again next run —
      // annoying but not broken. Stay silent.
    }
  } catch {
    // Never let migration-notice machinery crash the CLI.
  }
}
