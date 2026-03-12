/**
 * paradigm migrate — migration execution engine
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createRequire } from 'node:module';
import type { MigrationState, MigrationStep, MigrateOptions, MigrationApplyResult } from './types.js';
import { loadMigrationState, bootstrapAppliedList } from './detector.js';

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require('../package.json');

export interface RunSummary {
  applied: number;
  skipped: number;
  errors: number;
  manual: number;
  results: { id: string; result: MigrationApplyResult }[];
}

/**
 * Load or create migration state.
 */
export async function getOrCreateState(rootDir: string): Promise<MigrationState> {
  const existing = loadMigrationState(rootDir);
  if (existing) return existing;

  // First-run bootstrap: mark non-needed migrations as applied
  const applied = await bootstrapAppliedList(rootDir);

  const state: MigrationState = {
    version: '1.0',
    cliVersion: CLI_VERSION,
    lastMigrated: new Date().toISOString(),
    applied,
  };

  return state;
}

/**
 * Save migration state to .paradigm/migrate.yaml
 */
export function saveMigrationState(rootDir: string, state: MigrationState): void {
  const p = path.join(rootDir, '.paradigm', 'migrate.yaml');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  state.cliVersion = CLI_VERSION;
  state.lastMigrated = new Date().toISOString();
  fs.writeFileSync(p, yaml.dump(state, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  }), 'utf8');
}

/**
 * Run a set of pending migrations.
 */
export async function runMigrations(
  rootDir: string,
  pending: MigrationStep[],
  options: MigrateOptions,
  state: MigrationState,
): Promise<RunSummary> {
  const summary: RunSummary = { applied: 0, skipped: 0, errors: 0, manual: 0, results: [] };
  const now = new Date().toISOString();

  for (const migration of pending) {
    if (!migration.auto) {
      summary.manual++;
      summary.results.push({ id: migration.id, result: { status: 'skipped', message: 'Manual review recommended' } });
      continue;
    }

    try {
      const result = await migration.apply(rootDir, options);
      summary.results.push({ id: migration.id, result });

      if (result.status === 'applied') {
        summary.applied++;
        // Record immediately
        state.applied.push({ id: migration.id, appliedAt: now, cliVersion: CLI_VERSION });
      } else if (result.status === 'skipped') {
        summary.skipped++;
      } else {
        summary.errors++;
      }
    } catch (err) {
      summary.errors++;
      summary.results.push({
        id: migration.id,
        result: { status: 'error', message: (err as Error).message },
      });
    }
  }

  return summary;
}
