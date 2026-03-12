/**
 * paradigm migrate — project state detection
 *
 * Reads migrate.yaml, config.yaml, and filesystem to determine
 * which migrations are pending.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createRequire } from 'node:module';
import type { MigrationState, MigrationStep, DetectionResult } from './types.js';
import { migrations } from './migrations.js';

const require = createRequire(import.meta.url);
// After tsup bundling, output lives in dist/ — so ../package.json resolves correctly
const { version: CLI_VERSION } = require('../package.json');

/**
 * Load migration state from .paradigm/migrate.yaml
 */
export function loadMigrationState(rootDir: string): MigrationState | null {
  const p = path.join(rootDir, '.paradigm', 'migrate.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    const content = fs.readFileSync(p, 'utf8');
    return yaml.load(content) as MigrationState;
  } catch {
    return null;
  }
}

/**
 * Detect the full project state and determine pending migrations.
 */
export async function detectProjectState(rootDir: string): Promise<DetectionResult> {
  const paradigmDir = path.join(rootDir, '.paradigm');
  const state = loadMigrationState(rootDir);
  const appliedIds = state?.applied.map(a => a.id) ?? [];

  // Read config version
  let configVersion = 'unknown';
  const configPath = path.join(paradigmDir, 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      configVersion = String(config.version ?? 'unknown');
    } catch { /* ignore */ }
  }

  // Health checks
  const expectedDirs = ['specs', 'docs', 'prompts', 'lore', 'tasks', 'protocols', 'personas'];
  const missingDirectories = expectedDirs.filter(d => !fs.existsSync(path.join(paradigmDir, d)));

  const expectedConfigFields = ['discipline', 'tag-bank', 'purpose-required', 'component_types'];
  let missingConfigFields: string[] = [];
  if (fs.existsSync(configPath)) {
    try {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      missingConfigFields = expectedConfigFields.filter(f => {
        const key = f.replace(/-/g, '_');
        return !(f in config) && !(key in config) && !(f.replace(/_/g, '-') in config);
      });
    } catch { /* ignore */ }
  }

  // Check template staleness
  const staleTemplates: string[] = [];
  const templatesDir = getTemplatesDir();
  if (templatesDir) {
    const templateSubdirs = ['specs', 'docs'];
    for (const sub of templateSubdirs) {
      const templateSub = path.join(templatesDir, sub);
      const projectSub = path.join(paradigmDir, sub);
      if (fs.existsSync(templateSub) && fs.existsSync(projectSub)) {
        const templateFiles = fs.readdirSync(templateSub).filter(f => !fs.statSync(path.join(templateSub, f)).isDirectory());
        for (const file of templateFiles) {
          const projectFile = path.join(projectSub, file);
          if (!fs.existsSync(projectFile)) {
            staleTemplates.push(`${sub}/${file}`);
          }
        }
      }
    }
  }

  // Check hooks
  const hooksOutdated = !fs.existsSync(path.join(rootDir, '.claude', 'hooks'));

  // Run all migration checks
  const pendingMigrations: MigrationStep[] = [];
  for (const migration of migrations) {
    // Skip if already applied (unless it's an evergreen migration — no introducedIn version)
    const isEvergreen = migration.introducedIn === 'evergreen';
    if (appliedIds.includes(migration.id) && !isEvergreen) continue;

    const result = await migration.check(rootDir);
    if (result.needed) {
      pendingMigrations.push(migration);
    }
  }

  // First-run bootstrap: if no migrate.yaml exists yet, auto-mark migrations
  // that check() says "not needed" as already applied (prevents false positives)
  if (!state) {
    // This will be handled when we save the state — we record all non-pending
    // migrations as implicitly applied
  }

  return {
    configVersion,
    cliVersion: CLI_VERSION,
    pendingMigrations,
    appliedIds,
    health: {
      missingDirectories,
      missingConfigFields,
      staleTemplates,
      hooksOutdated,
    },
  };
}

/**
 * Build the initial applied list for first-run bootstrap.
 * Auto-marks migrations whose check() returns needed=false as applied.
 */
export async function bootstrapAppliedList(rootDir: string): Promise<{ id: string; appliedAt: string; cliVersion: string }[]> {
  const applied: { id: string; appliedAt: string; cliVersion: string }[] = [];
  const now = new Date().toISOString();

  for (const migration of migrations) {
    if (migration.introducedIn === 'evergreen') continue;
    const result = await migration.check(rootDir);
    if (!result.needed) {
      applied.push({ id: migration.id, appliedAt: now, cliVersion: CLI_VERSION });
    }
  }

  return applied;
}

/**
 * Locate the templates directory shipped with the CLI.
 */
function getTemplatesDir(): string | null {
  const __filename = new URL(import.meta.url).pathname;
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'templates', 'paradigm'),
    path.join(__dirname, '..', '..', 'templates', 'paradigm'),
    path.join(__dirname, '..', 'templates', 'paradigm'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export { getTemplatesDir };
