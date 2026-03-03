import type { Migration, MigrationHistory, MigrationHistoryEntry } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// MIGRATION HISTORY TRACKING
// ═══════════════════════════════════════════════════════════════════

/** Create an empty migration history */
export function createHistory(): MigrationHistory {
  return { entries: [] };
}

/** Record a completed migration in the history */
export function recordMigration(
  history: MigrationHistory,
  migration: Migration,
  operationsApplied: number,
): MigrationHistoryEntry {
  const entry: MigrationHistoryEntry = {
    migrationId: migration.id,
    appliedAt: new Date().toISOString(),
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    operationsApplied,
  };
  history.entries.push(entry);
  return entry;
}

/** Check if a specific migration has already been applied */
export function isMigrationApplied(history: MigrationHistory, migrationId: string): boolean {
  return history.entries.some((e) => e.migrationId === migrationId);
}

/** Get the current schema version from history (highest toVersion) */
export function getCurrentVersion(history: MigrationHistory): number {
  if (history.entries.length === 0) return 0;
  return Math.max(...history.entries.map((e) => e.toVersion));
}

/** Filter migrations to only those not yet applied, sorted by fromVersion */
export function getPendingMigrations(
  history: MigrationHistory,
  migrations: Migration[],
): Migration[] {
  const appliedIds = new Set(history.entries.map((e) => e.migrationId));
  return migrations
    .filter((m) => !appliedIds.has(m.id))
    .sort((a, b) => a.fromVersion - b.fromVersion);
}
