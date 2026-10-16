/**
 * paradigm skill sync-global — materialize the bundled seed skills
 * (<packageRoot>/templates/skills/<id>/, shipped via package.json `files`)
 * into the user's global skill sources (~/.paradigm/skills/<id>/). Part of
 * #skill-cli (Skills Phase 1).
 *
 * Safety invariant (mirrors `agent sync-global`): a normal sync NEVER destroys
 * user customizations. An existing destination skill directory is skipped;
 * only `--force` replaces it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../../utils/logger.js';
import { out, success, warn, dim, error } from '../../utils/cli-output.js';

export interface SkillSyncGlobalOptions {
  force?: boolean;
  dryRun?: boolean;
  /** Test seam — defaults to the bundled templates/skills dir. */
  bundledDir?: string;
  /** Test seam — defaults to ~/.paradigm/skills. */
  globalDir?: string;
}

export interface SkillSyncGlobalResult {
  added: string[];
  skipped: string[];
  overwritten: string[];
}

/**
 * Resolve the bundled templates/skills directory. Built code lives in
 * <packageRoot>/dist/ (tsup flat chunks) and templates/ is a sibling at the
 * package root; from src/commands/skill/ (tests) it is three levels up.
 */
export function resolveBundledSkillsDir(): string | null {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dist/ (tsup flat chunk) → ../templates/skills
    path.join(__dirname, '..', 'templates', 'skills'),
    // dist/commands/ → ../../templates/skills
    path.join(__dirname, '..', '..', 'templates', 'skills'),
    // dist/commands/skill/ or src/commands/skill/ → ../../../templates/skills
    path.join(__dirname, '..', '..', '..', 'templates', 'skills'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export async function skillSyncGlobalCommand(options: SkillSyncGlobalOptions = {}): Promise<SkillSyncGlobalResult | null> {
  const tracker = log.command('skill-sync-global').start('Syncing bundled skills to global dir', {
    force: !!options.force,
    dryRun: !!options.dryRun,
  });

  const bundledDir = options.bundledDir ?? resolveBundledSkillsDir();
  if (!bundledDir || !fs.existsSync(bundledDir)) {
    error('Could not locate bundled skill templates (templates/skills/).');
    dim('  This usually means a broken or partial install. Try reinstalling @a-company/paradigm.');
    tracker.error('Bundled skills dir not found');
    process.exitCode = 1;
    return null;
  }
  const globalDir = options.globalDir ?? path.join(os.homedir(), '.paradigm', 'skills');

  const ids = fs.readdirSync(bundledDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(bundledDir, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();

  const result: SkillSyncGlobalResult = { added: [], skipped: [], overwritten: [] };
  if (ids.length === 0) {
    warn('No bundled skills found to sync.');
    tracker.success('Nothing to sync (0 bundled)');
    return result;
  }

  for (const id of ids) {
    const src = path.join(bundledDir, id);
    const dest = path.join(globalDir, id);
    const exists = fs.existsSync(dest);
    if (exists && !options.force) {
      result.skipped.push(id);
      continue;
    }
    if (!options.dryRun) {
      if (exists) fs.rmSync(dest, { recursive: true, force: true });
      copyDir(src, dest);
    }
    (exists ? result.overwritten : result.added).push(id);
  }

  const prefix = options.dryRun ? 'Dry run — ' : '';
  success(`${prefix}${result.added.length} added, ${result.skipped.length} skipped (already present), ${result.overwritten.length} overwritten — ${ids.length} bundled`);
  if (result.added.length) out(`  added: ${result.added.join(', ')}`);
  if (result.overwritten.length) out(`  overwritten: ${result.overwritten.join(', ')}`);
  if (result.skipped.length) dim(`  skipped: ${result.skipped.join(', ')} (use --force to replace)`);
  dim(`  → ${globalDir}`);
  dim('  Seeds are provisional. Project with `paradigm skill project <id> --allow-provisional`, or certify first.');
  tracker.success('Synced bundled skills', { ...result, total: ids.length });
  return result;
}
