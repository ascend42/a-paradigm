/**
 * migration-notices.ts — v6.0.4 one-time migration notices
 *
 * Emits a one-time notice on first `paradigm` CLI invocation for projects
 * that fall into "cohort C" of the v6.0.4 enforcement-model migration:
 * projects that define ~aspects in any .purpose file but do NOT have the
 * `compliance` archetype on their roster. Without a claimant, the Stop
 * hook no longer enforces aspect coverage/drift — users in this cohort
 * silently lose enforcement they previously had, so we surface the
 * change and record an acknowledgement marker so the message stops.
 *
 * Read-only commands (core/command-policy.ts) never write: they print the
 * notice to stderr and leave the marker alone. The marker is written by the
 * first write command that shows the notice, or explicitly by
 * `paradigm notices ack <id>`. `PARADIGM_NO_NOTICES=1` hides notices for a
 * process without writing anything.
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
 * A one-time notice. `applies` is a pure read of the project; the notice is
 * pending while it applies and its marker file is absent.
 */
export interface MigrationNotice {
  /** Stable id a user passes to `paradigm notices ack <id>`. */
  id: string;
  /** Marker file under `.paradigm/` that records the acknowledgement. */
  marker: string;
  summary: string;
  applies(projectRoot: string): boolean;
  lines(): string[];
}

export const MIGRATION_NOTICES: readonly MigrationNotice[] = Object.freeze([
  {
    id: 'v6.0.4',
    marker: MIGRATION_MARKER,
    summary: 'Enforcement model changed: aspects are not enforced without a compliance agent on the roster',
    applies: isCohortC,
    lines: () => [
      chalk.yellow('[paradigm 6.0.4] Enforcement model changed.'),
      '',
      'This project defines ~aspects but has no compliance-archetype agent on',
      'the roster. Previously, the Stop hook blocked on aspect drift. As of',
      '6.0.4, the framework no longer enforces aspect coverage in absentia.',
      '',
      `Run \`${chalk.cyan('paradigm shift')}\` to nominate Rune (compliance) for this project, or`,
      'ignore this notice to opt out of aspect enforcement.',
      '',
      chalk.yellow('[paradigm 6.0.5+] Aspect anchor follow-up.'),
      '',
      'If you upgraded to v6.0.4 with aspect anchors that crossed directories',
      '(e.g., `../proxy-fetch.ts`), they may have appeared as "missing" when',
      'checked via paradigm_aspect_check or paradigm_aspect_drift. v6.0.5+',
      'fixes the reader to resolve under both project-root and .purpose-dir',
      'bases. No data migration required.',
    ],
  },
]);

/** Env var that hides every notice for the process (no print, no write). */
export const NO_NOTICES_ENV = 'PARADIGM_NO_NOTICES';

function noticesSuppressed(): boolean {
  const v = process.env[NO_NOTICES_ENV];
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Notices that apply to the project and are not yet acknowledged. Pure read:
 * never writes, safe from read-only commands.
 */
export function pendingNotices(projectRoot: string): MigrationNotice[] {
  try {
    const paradigmDir = path.join(projectRoot, '.paradigm');
    if (!fs.existsSync(paradigmDir)) return [];
    return MIGRATION_NOTICES.filter((n) => {
      if (fs.existsSync(path.join(paradigmDir, n.marker))) return false;
      try {
        return n.applies(projectRoot);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function findNotice(id: string): MigrationNotice | undefined {
  return MIGRATION_NOTICES.find((n) => n.id === id);
}

/**
 * Record the acknowledgement of one notice (writes its marker). Returns false
 * when the project has no `.paradigm/` directory or the write fails. Only
 * write paths call this.
 */
export function acknowledgeNotice(projectRoot: string, notice: MigrationNotice): boolean {
  const paradigmDir = path.join(projectRoot, '.paradigm');
  if (!fs.existsSync(paradigmDir)) return false;
  try {
    fs.writeFileSync(
      path.join(paradigmDir, notice.marker),
      `Acknowledged at ${new Date().toISOString()}\n`,
      'utf8'
    );
    return true;
  } catch {
    return false;
  }
}

/** Ids already printed by this process (a notice prints at most once per process). */
const printedThisProcess = new Set<string>();

export interface EmitOptions {
  /**
   * True when the running command is read-only (core/command-policy.ts). The
   * notice still prints, but nothing is written: the acknowledgement waits for
   * a write command or `paradigm notices ack <id>`.
   */
  readOnly: boolean;
  /** Where the notice goes. Default: stderr, so stdout (`--json`) stays clean. */
  write?: (text: string) => void;
}

/**
 * Print each pending notice (once per process) to stderr.
 *
 * - Read-only command: print only. The footer says how to silence it.
 * - Write command: print and write the marker, so it never repeats.
 * - `PARADIGM_NO_NOTICES=1`: do nothing.
 *
 * Failures are silent: this is advisory, never blocking.
 */
export async function checkAndEmitMigrationNotices(
  projectRoot: string,
  options: EmitOptions = { readOnly: false }
): Promise<void> {
  try {
    if (noticesSuppressed()) return;
    const write = options.write ?? ((text: string) => { process.stderr.write(text); });
    for (const notice of pendingNotices(projectRoot)) {
      if (printedThisProcess.has(notice.id)) continue;
      printedThisProcess.add(notice.id);
      const footer = options.readOnly
        ? chalk.dim(
            `Shown until acknowledged: run \`paradigm notices ack ${notice.id}\` (or any write command). ` +
            `${NO_NOTICES_ENV}=1 hides notices without writing.`
          )
        : chalk.dim('This message will not appear again.');
      write(['', ...notice.lines(), '', footer, '', ''].join('\n'));
      if (!options.readOnly) acknowledgeNotice(projectRoot, notice);
    }
  } catch {
    // Never let migration-notice machinery crash the CLI.
  }
}

/** Test hook: forget which notices this process has printed. */
export function resetPrintedNoticesForTests(): void {
  printedThisProcess.clear();
}
