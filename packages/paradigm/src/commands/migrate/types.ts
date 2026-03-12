/**
 * paradigm migrate — types for version-aware project migration
 */

export interface MigrationStep {
  id: string;
  introducedIn: string;
  description: string;
  category: 'directory' | 'config' | 'template' | 'hook' | 'schema' | 'format';
  auto: boolean;
  check(rootDir: string): Promise<MigrationCheckResult>;
  apply(rootDir: string, options: MigrateOptions): Promise<MigrationApplyResult>;
}

export interface MigrationCheckResult {
  needed: boolean;
  reason: string;
  details?: string[];
}

export interface MigrationApplyResult {
  status: 'applied' | 'skipped' | 'error';
  message: string;
  filesCreated?: string[];
  filesModified?: string[];
}

export interface MigrationState {
  version: string;
  cliVersion: string;
  lastMigrated: string;
  applied: { id: string; appliedAt: string; cliVersion: string }[];
}

export interface MigrateOptions {
  dryRun?: boolean;
  apply?: boolean;
  force?: boolean;
  only?: string[];
  category?: string;
  noSync?: boolean;
  verbose?: boolean;
  list?: boolean;
  quiet?: boolean;
}

export interface DetectionResult {
  configVersion: string;
  cliVersion: string;
  pendingMigrations: MigrationStep[];
  appliedIds: string[];
  health: {
    missingDirectories: string[];
    missingConfigFields: string[];
    staleTemplates: string[];
    hooksOutdated: boolean;
  };
}
