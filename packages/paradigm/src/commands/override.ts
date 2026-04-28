/**
 * paradigm override — clear active soft-block remediations from the CLI.
 *
 * v6.1 Sprint 1 Wave 3 — symmetric to the bash hook's PARADIGM_OVERRIDE
 * env-var path. Both writers append to .paradigm/events/overrides.jsonl;
 * the only schema difference is `mechanism` (`cli` here, `env` in bash).
 *
 * Subcommands:
 *   paradigm override <id>              Clear single remediation
 *   paradigm override list              Show all active remediations
 *   paradigm override clear-all --force Bulk clear (destructive)
 *
 * Symbol: #paradigm-override-cli
 * Spec: .paradigm/research/v6.1-sprint-1-spec.md §5
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { success, dim, error, out, json } from '../utils/cli-output.js';
import {
  getActiveRemediations,
  type RemediationOutput,
} from './internal/active-remediations.js';

interface OverrideOptions {
  force?: boolean;
}

const REMEDIATIONS_DIR = '.paradigm/remediations';
const ARCHIVED_DIR = '.paradigm/remediations/.archived';
const EVENTS_DIR = '.paradigm/events';
const OVERRIDES_JSONL = '.paradigm/events/overrides.jsonl';

interface RemediationFile {
  id?: string;
  claimant?: string;
  severity?: string;
  reason?: string;
  expires_at?: string;
  created?: string;
  archived_at?: string;
  [key: string]: unknown;
}

/**
 * Append a single override-event row to .paradigm/events/overrides.jsonl.
 * Mirrors the bash writer in paradigm-common.sh exactly except for
 * `mechanism: 'cli'`. Schema per spec §3.
 */
async function appendOverrideEvent(
  cwd: string,
  remediationId: string,
  claimant: string
): Promise<void> {
  const eventsDir = path.join(cwd, EVENTS_DIR);
  await fs.mkdir(eventsDir, { recursive: true });

  const row = {
    timestamp: new Date().toISOString(),
    remediation_id: remediationId,
    claimant,
    mechanism: 'cli' as const,
    unblock_predicate_matched: false,
  };

  await fs.appendFile(
    path.join(cwd, OVERRIDES_JSONL),
    JSON.stringify(row) + '\n',
    'utf8'
  );
}

/**
 * Stamp `archived_at` on the YAML, then atomically rename into .archived/.
 * Returns the captured claimant for the override-event row.
 */
async function archiveRemediation(
  cwd: string,
  id: string
): Promise<{ claimant: string }> {
  const sourcePath = path.join(cwd, REMEDIATIONS_DIR, `${id}.yaml`);
  const archivePath = path.join(cwd, ARCHIVED_DIR, `${id}.yaml`);

  // Read + parse + re-stamp
  const raw = await fs.readFile(sourcePath, 'utf8');
  const parsed = (yaml.load(raw) as RemediationFile | null) ?? {};
  parsed.archived_at = new Date().toISOString();

  // Defensive — Wave 1 .gitkeep should have created this, but fresh repos
  // or hand-removed dirs need to round-trip cleanly.
  await fs.mkdir(path.join(cwd, ARCHIVED_DIR), { recursive: true });

  // Write the stamped YAML back to the source path first, then rename.
  // Rename is atomic on POSIX so a mid-op crash never leaves the file in
  // both directories.
  await fs.writeFile(sourcePath, yaml.dump(parsed), 'utf8');
  await fs.rename(sourcePath, archivePath);

  const claimant =
    typeof parsed.claimant === 'string' && parsed.claimant.length > 0
      ? parsed.claimant
      : 'unknown';

  return { claimant };
}

/**
 * Render a friendly relative-time string for `created` timestamps.
 * Example: "2 hours ago", "3 days ago", "just now".
 */
function relativeTime(iso?: string): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.floor((Date.now() - t) / 1000);
  if (deltaSec < 30) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

function truncate(str: string, max = 60): string {
  const firstLine = (str ?? '').split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= max) return firstLine;
  return firstLine.slice(0, max - 1) + '…';
}

/** `paradigm override <id>` — clear a single remediation. */
export async function overrideClearOne(id: string): Promise<void> {
  const cwd = process.cwd();
  const sourcePath = path.join(cwd, REMEDIATIONS_DIR, `${id}.yaml`);

  try {
    await fs.access(sourcePath);
  } catch {
    error(
      `Remediation ${id} not found. Run 'paradigm override list' to see active.`
    );
    process.exit(1);
  }

  const { claimant } = await archiveRemediation(cwd, id);
  await appendOverrideEvent(cwd, id, claimant);

  success(`${id} cleared`);
  dim(`  Override recorded → ${OVERRIDES_JSONL}`);
  dim('  Re-run your blocked operation.');
}

/** `paradigm override list` — show active remediations. */
export async function overrideList(): Promise<void> {
  const records = await getActiveRemediations();

  // Non-TTY → emit JSON for scripting consumers.
  if (!process.stdout.isTTY) {
    json(records);
    return;
  }

  if (records.length === 0) {
    dim('No active remediations.');
    return;
  }

  // Header row + per-record body. Manual columnization keeps us aligned
  // with the cli-output.ts conventions (no external table dep).
  const headers = ['ID', 'CLAIMANT', 'SEVERITY', 'CREATED', 'REASON'];
  const rows = records.map((r) => [
    r.id,
    r.claimant,
    r.severity,
    relativeTime(r.created),
    truncate(r.reason ?? ''),
  ]);

  // Compute column widths (clamp the reason column to keep table readable).
  const widths = headers.map((h, i) => {
    const dataMax = rows.reduce((max, row) => Math.max(max, row[i].length), 0);
    return Math.max(h.length, dataMax);
  });

  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  out(fmt(headers));
  out(fmt(headers.map((_, i) => '-'.repeat(widths[i]))));
  for (const row of rows) {
    out(fmt(row));
  }
}

/** `paradigm override clear-all --force` — bulk-clear destructive op. */
export async function overrideClearAll(options: OverrideOptions): Promise<void> {
  if (!options.force) {
    error(
      'Use --force to bulk-clear all active remediations. This is destructive.'
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const records: RemediationOutput[] = await getActiveRemediations(cwd);

  if (records.length === 0) {
    dim('No active remediations.');
    return;
  }

  let cleared = 0;
  for (const r of records) {
    try {
      const { claimant } = await archiveRemediation(cwd, r.id);
      await appendOverrideEvent(cwd, r.id, claimant);
      cleared++;
    } catch (err) {
      error(`Failed to clear ${r.id}: ${(err as Error).message}`);
      // Continue — best-effort bulk path; partial progress is preferable
      // to bailing on the first failure.
    }
  }

  success(`Cleared ${cleared} remediation${cleared === 1 ? '' : 's'}.`);
  dim(`  Override events recorded → ${OVERRIDES_JSONL}`);
}
