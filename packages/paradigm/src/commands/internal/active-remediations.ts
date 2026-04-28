/**
 * paradigm internal active-remediations — list non-expired remediation
 * blocks as JSON for the Stop hook (Check 14, v6.1 Sprint 1 spec §4).
 *
 * The bash hook calls this with `--json` so it never has to parse YAML
 * directly. Behavior is graceful — every error path returns `[]` and
 * exits 0 so a missing/broken paradigm install never breaks the user's
 * Stop hook.
 *
 * Symbol: #internal-active-remediations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface ActiveRemediationsOptions {
  json?: boolean;
}

interface RemediationFile {
  id?: string;
  claimant?: string;
  severity?: 'advise' | 'auto-author' | 'guard';
  reason?: string;
  expires_at?: string;
  created?: string;
  // ...other fields tolerated and ignored for the helper output
}

interface RemediationOutput {
  id: string;
  claimant: string;
  severity: string;
  reason: string;
  expires_at?: string;
  created?: string;
}

export async function activeRemediationsCommand(
  options: ActiveRemediationsOptions = {}
): Promise<void> {
  const cwd = process.cwd();
  const remediationsDir = path.join(cwd, '.paradigm', 'remediations');

  const records: RemediationOutput[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(remediationsDir);
  } catch {
    // Missing dir → empty list (graceful per spec §12 #10, §4)
    process.stdout.write(JSON.stringify(records) + '\n');
    return;
  }

  const nowIso = new Date().toISOString();

  for (const entry of entries) {
    // Skip hidden files (.gitkeep, .archived, dotfiles) and non-yaml
    if (entry.startsWith('.')) continue;
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

    const filePath = path.join(remediationsDir, entry);
    let raw: string;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      raw = await fs.readFile(filePath, 'utf8');
    } catch {
      continue; // unreadable individual file → skip silently
    }

    let parsed: RemediationFile | null;
    try {
      parsed = yaml.load(raw) as RemediationFile | null;
    } catch (err) {
      // Per spec §12 #3: log to stderr, continue with others, exit 0
      process.stderr.write(
        `paradigm internal active-remediations: skipping ${entry}: ${(err as Error).message}\n`
      );
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    // expires_at filtering — past timestamps are skipped (spec §4)
    if (parsed.expires_at && parsed.expires_at < nowIso) continue;

    if (!parsed.id || !parsed.claimant || !parsed.severity || !parsed.reason) {
      // Malformed but not parse-broken — skip silently
      continue;
    }

    records.push({
      id: parsed.id,
      claimant: parsed.claimant,
      severity: parsed.severity,
      reason: parsed.reason,
      ...(parsed.expires_at ? { expires_at: parsed.expires_at } : {}),
      ...(parsed.created ? { created: parsed.created } : {}),
    });
  }

  // --json is the only documented mode; default to JSON for safety.
  void options;
  process.stdout.write(JSON.stringify(records) + '\n');
}
