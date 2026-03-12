/**
 * paradigm migrate — detect and apply migrations to bring project up to date
 *
 * Subsumes `paradigm upgrade` with a version-aware migration registry.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type { MigrateOptions } from './types.js';
import { detectProjectState, loadMigrationState } from './detector.js';
import { getOrCreateState, saveMigrationState, runMigrations } from './runner.js';
import { migrations } from './migrations.js';

export async function migrateCommand(options: MigrateOptions = {}) {
  const cwd = process.cwd();
  const paradigmDir = path.join(cwd, '.paradigm');

  // Check that .paradigm/ exists
  if (!fs.existsSync(paradigmDir) || !fs.statSync(paradigmDir).isDirectory()) {
    // Special case: .paradigm is a file (legacy)
    if (fs.existsSync(paradigmDir) && fs.statSync(paradigmDir).isFile()) {
      // Allow the legacy migration to handle this
    } else {
      if (!options.quiet) {
        console.log(chalk.yellow('\n  No .paradigm/ directory found. Run `paradigm init` or `paradigm shift` first.\n'));
      }
      return;
    }
  }

  const spinner = ora();

  // Detect project state
  if (!options.quiet) {
    spinner.start('Detecting project state...');
  }

  const detection = await detectProjectState(cwd);

  if (!options.quiet) {
    spinner.stop();
  }

  // Get or create migration state
  const state = await getOrCreateState(cwd);

  // Filter pending migrations by options
  let pending = detection.pendingMigrations;

  if (options.only && options.only.length > 0) {
    pending = pending.filter(m => options.only!.includes(m.id));
  }

  if (options.category) {
    pending = pending.filter(m => m.category === options.category);
  }

  if (options.force) {
    // Re-run all migrations (or filtered subset), even if applied
    const all = options.only
      ? migrations.filter(m => options.only!.includes(m.id))
      : options.category
        ? migrations.filter(m => m.category === options.category)
        : migrations;

    // Re-check all of them
    pending = [];
    for (const m of all) {
      const result = await m.check(cwd);
      if (result.needed || options.force) {
        pending.push(m);
      }
    }
  }

  const autoMigrations = pending.filter(m => m.auto);
  const manualMigrations = pending.filter(m => !m.auto);

  // ─── List mode ─────────────────────────────────────────────────────
  if (options.list) {
    printMigrationList(state, detection, options);
    return;
  }

  // ─── Quiet mode (shift integration) ────────────────────────────────
  if (options.quiet) {
    if (autoMigrations.length === 0) return;
    const summary = await runMigrations(cwd, autoMigrations, options, state);
    saveMigrationState(cwd, state);
    return summary;
  }

  // ─── Interactive mode ──────────────────────────────────────────────
  const existingState = loadMigrationState(cwd);

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  paradigm migrate                                ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  Bring your project up to date                  ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  console.log(chalk.white(`  Project:        ${chalk.cyan(path.basename(cwd))}`));
  console.log(chalk.white(`  Config version: ${chalk.cyan(detection.configVersion)}`));
  console.log(chalk.white(`  CLI version:    ${chalk.cyan(detection.cliVersion)}`));
  console.log(chalk.white(`  Last migrated:  ${chalk.cyan(existingState?.lastMigrated ?? 'never')}`));
  console.log('');

  if (pending.length === 0) {
    console.log(chalk.green('  All migrations are up to date.\n'));
    // Still save state if first run (bootstrap)
    if (!existingState) {
      saveMigrationState(cwd, state);
      if (options.verbose) {
        console.log(chalk.gray('  Created .paradigm/migrate.yaml with bootstrap state.\n'));
      }
    }
    return;
  }

  // Show health summary if verbose
  if (options.verbose) {
    const h = detection.health;
    if (h.missingDirectories.length > 0) {
      console.log(chalk.yellow(`  Missing directories: ${h.missingDirectories.join(', ')}`));
    }
    if (h.missingConfigFields.length > 0) {
      console.log(chalk.yellow(`  Missing config fields: ${h.missingConfigFields.join(', ')}`));
    }
    if (h.staleTemplates.length > 0) {
      console.log(chalk.yellow(`  New templates available: ${h.staleTemplates.join(', ')}`));
    }
    if (h.hooksOutdated) {
      console.log(chalk.yellow('  Hooks need installation'));
    }
    console.log('');
  }

  // Show pending migrations
  const autoCount = autoMigrations.length;
  const manualCount = manualMigrations.length;
  console.log(chalk.white(`  Pending Migrations (${autoCount} auto${manualCount > 0 ? `, ${manualCount} manual` : ''})`));
  console.log(chalk.gray('  ' + '─'.repeat(49)));

  if (autoMigrations.length > 0) {
    console.log(chalk.white('  AUTO:'));
    for (const m of autoMigrations) {
      const idPad = m.id.padEnd(30);
      console.log(chalk.green('  ✓ ') + chalk.white(idPad) + chalk.gray(m.description));
      if (options.verbose) {
        const checkResult = await m.check(cwd);
        if (checkResult.details) {
          for (const d of checkResult.details) {
            console.log(chalk.gray('    ↳ ') + chalk.gray(d));
          }
        }
      }
    }
  }

  if (manualMigrations.length > 0) {
    console.log('');
    console.log(chalk.white('  MANUAL (review recommended):'));
    for (const m of manualMigrations) {
      const idPad = m.id.padEnd(30);
      console.log(chalk.yellow('  ○ ') + chalk.white(idPad) + chalk.gray(m.description));
      const checkResult = await m.check(cwd);
      if (checkResult.details) {
        for (const d of checkResult.details) {
          console.log(chalk.gray('    → ') + chalk.cyan(d));
        }
      }
    }
  }

  console.log('');

  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.yellow('  Dry run — no changes applied.\n'));
    return;
  }

  // Apply auto migrations
  if (autoMigrations.length > 0) {
    if (!options.apply) {
      // Prompt for confirmation
      const prompts = (await import('prompts')).default;
      const { confirm } = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Apply ${autoMigrations.length} automatic migration(s)?`,
        initial: true,
      });
      if (!confirm) {
        console.log(chalk.gray('\n  Skipped. Run with --apply to auto-apply.\n'));
        return;
      }
    }

    spinner.start(`Applying ${autoMigrations.length} migration(s)...`);
    const summary = await runMigrations(cwd, autoMigrations, options, state);
    spinner.stop();

    // Show results
    for (const { id, result } of summary.results) {
      if (result.status === 'applied') {
        console.log(chalk.green('  ✓ ') + chalk.white(id) + chalk.gray(` — ${result.message}`));
      } else if (result.status === 'error') {
        console.log(chalk.red('  ✗ ') + chalk.white(id) + chalk.gray(` — ${result.message}`));
      } else {
        console.log(chalk.yellow('  ○ ') + chalk.white(id) + chalk.gray(` — ${result.message}`));
      }
    }

    console.log('');
    console.log(chalk.green(`  Applied ${summary.applied} migration(s).`));
    if (summary.errors > 0) {
      console.log(chalk.red(`  ${summary.errors} error(s).`));
    }
  }

  // Save state
  saveMigrationState(cwd, state);
  console.log(chalk.gray('  Updated .paradigm/migrate.yaml'));
  console.log('');
}

/**
 * Print a full list of all migrations with status.
 */
function printMigrationList(
  state: { applied: { id: string; appliedAt: string; cliVersion: string }[] },
  detection: { pendingMigrations: { id: string }[] },
  options: MigrateOptions,
) {
  const appliedIds = new Set(state.applied.map(a => a.id));
  const pendingIds = new Set(detection.pendingMigrations.map(m => m.id));

  console.log(chalk.blue('\n  All Migrations'));
  console.log(chalk.gray('  ' + '─'.repeat(70)));
  console.log(
    chalk.gray('  Status  ') +
    chalk.gray('ID'.padEnd(34)) +
    chalk.gray('Version'.padEnd(12)) +
    chalk.gray('Category'),
  );
  console.log(chalk.gray('  ' + '─'.repeat(70)));

  for (const m of migrations) {
    let status: string;
    if (appliedIds.has(m.id)) {
      status = chalk.green('  ✓     ');
    } else if (pendingIds.has(m.id)) {
      status = m.auto ? chalk.yellow('  ●     ') : chalk.yellow('  ○     ');
    } else {
      status = chalk.gray('  -     ');
    }

    const id = m.id.padEnd(34);
    const version = (m.introducedIn === 'evergreen' ? 'evergreen' : m.introducedIn).padEnd(12);
    const cat = m.category;

    console.log(status + chalk.white(id) + chalk.gray(version) + chalk.gray(cat));

    if (options.verbose) {
      console.log(chalk.gray(`          ${m.description}`));
    }
  }

  console.log('');
  console.log(chalk.gray(`  ✓ = applied  ● = pending (auto)  ○ = pending (manual)  - = not needed`));
  console.log('');
}
