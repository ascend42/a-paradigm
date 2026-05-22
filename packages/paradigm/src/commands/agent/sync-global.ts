/**
 * paradigm agent sync-global — materialize the bundled canonical agent set
 * into the user's global agents directory (~/.paradigm/agents/).
 *
 * Why: Paradigm bundles ~67 canonical agent profiles at
 * <packageRoot>/templates/agents/*.agent (shipped via the package `files`
 * field). Before this command, the only writer of global agents was
 * `agent create --global` (one at a time), so users were frozen at whatever
 * they onboarded with and `npm update` never refreshed the set. This command
 * copies the bundled profiles into the global dir.
 *
 * Safety invariant: a normal sync NEVER destroys user customizations. Existing
 * destination files are skipped by default; only `--force` overwrites.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { log } from '../../utils/logger.js';
import { out, success, warn, dim, error } from '../../utils/cli-output.js';

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.paradigm', 'agents');
const AGENT_EXT = '.agent';

export interface AgentSyncGlobalOptions {
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Resolve the bundled templates/agents directory. At runtime the built module
 * lives in <packageRoot>/dist/ and templates/ is a sibling at the package root
 * (both listed in package.json `files`). We probe a small set of candidate
 * paths to stay robust against bundler layout changes (mirrors init.ts).
 */
function resolveBundledAgentsDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    // dist/ (tsup flat chunk) → ../templates/agents
    path.join(__dirname, '..', 'templates', 'agents'),
    // dist/commands/agent/ → ../../../templates/agents
    path.join(__dirname, '..', '..', '..', 'templates', 'agents'),
    // dist/commands/ → ../../templates/agents
    path.join(__dirname, '..', '..', 'templates', 'agents'),
    // running from src/ (ts-node / tests) → ../../../templates/agents
    path.join(__dirname, '..', '..', '..', 'templates', 'agents'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function agentSyncGlobalCommand(options: AgentSyncGlobalOptions = {}): Promise<void> {
  const tracker = log.command('agent-sync-global').start('Syncing bundled agents to global dir', {
    force: !!options.force,
    dryRun: !!options.dryRun,
  });

  const bundledDir = resolveBundledAgentsDir();
  if (!bundledDir) {
    error('Could not locate bundled agent templates (templates/agents/).');
    dim('  This usually means a broken or partial install. Try reinstalling @a-company/paradigm.');
    tracker.error('Bundled templates dir not found');
    return;
  }

  let bundledFiles: string[];
  try {
    bundledFiles = fs.readdirSync(bundledDir).filter((f) => f.endsWith(AGENT_EXT)).sort();
  } catch (err) {
    error(`Failed to read bundled templates: ${(err as Error).message}`);
    tracker.error('Read bundled dir failed');
    return;
  }

  if (bundledFiles.length === 0) {
    warn('No bundled .agent files found to sync.');
    tracker.success('Nothing to sync (0 bundled)');
    return;
  }

  const total = bundledFiles.length;
  const added: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];

  // Ensure destination exists (skip mkdir under dry-run — no writes).
  if (!options.dryRun && !fs.existsSync(GLOBAL_AGENTS_DIR)) {
    fs.mkdirSync(GLOBAL_AGENTS_DIR, { recursive: true });
  }

  for (const file of bundledFiles) {
    const name = file.replace(AGENT_EXT, '');
    const src = path.join(bundledDir, file);
    const dest = path.join(GLOBAL_AGENTS_DIR, file);
    const exists = fs.existsSync(dest);

    if (exists && !options.force) {
      skipped.push(name);
      continue;
    }

    if (exists) {
      // exists && force → overwrite
      if (!options.dryRun) fs.copyFileSync(src, dest);
      overwritten.push(name);
    } else {
      if (!options.dryRun) fs.copyFileSync(src, dest);
      added.push(name);
    }
  }

  // ── Output ──
  const prefix = options.dryRun ? 'Dry run — ' : '';

  if (options.force) {
    success(
      `${prefix}Added ${added.length}, overwrote ${overwritten.length}, ${total} total bundled.`
    );
  } else {
    success(
      `${prefix}Added ${added.length}, skipped ${skipped.length} (already present), ${total} total bundled.`
    );
  }

  if (added.length > 0) {
    out(options.dryRun ? '  Would add:' : '  Added:');
    dim('    ' + added.join(', '));
  }

  if (overwritten.length > 0) {
    out(options.dryRun ? '  Would overwrite:' : '  Overwrote:');
    dim('    ' + overwritten.join(', '));
  }

  if (skipped.length > 0) {
    dim(`  Skipped ${skipped.length} already-present agent${skipped.length === 1 ? '' : 's'} (use --force to overwrite).`);
  }

  if (!options.dryRun) {
    dim(`  Destination: ${GLOBAL_AGENTS_DIR}`);
  }

  tracker.success(
    `sync-global: added ${added.length}, overwrote ${overwritten.length}, skipped ${skipped.length} of ${total}`
  );
}
