// ═══════════════════════════════════════════════════════════════════
// Migration Types — forward-only schema migration system
// ═══════════════════════════════════════════════════════════════════

import type { PropertyDefinition, Cardinality, PatternFrequency } from '../schema/types.js';

/** Safety classification for migration operations */
export type SafetyLevel = 'safe' | 'cautious' | 'dangerous';

// ═══════════════════════════════════════════════════════════════════
// MIGRATION OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export type MigrationOperation =
  | AddEntityOp
  | RemoveEntityOp
  | ModifyEntityOp
  | AddPropertyOp
  | RemovePropertyOp
  | ModifyPropertyOp
  | AddRelationshipOp
  | RemoveRelationshipOp
  | ModifyRelationshipOp
  | AddEngineOp
  | RemoveEngineOp;

interface BaseMigrationOp {
  safety: SafetyLevel;
}

export interface AddEntityOp extends BaseMigrationOp {
  type: 'addEntity';
  entity: { name: string; properties: PropertyDefinition[]; tags?: string[] };
}

export interface RemoveEntityOp extends BaseMigrationOp {
  type: 'removeEntity';
  entityName: string;
}

export interface ModifyEntityOp extends BaseMigrationOp {
  type: 'modifyEntity';
  entityName: string;
  changes: { tags?: string[] };
}

export interface AddPropertyOp extends BaseMigrationOp {
  type: 'addProperty';
  entityName: string;
  property: PropertyDefinition;
}

export interface RemovePropertyOp extends BaseMigrationOp {
  type: 'removeProperty';
  entityName: string;
  propertyName: string;
}

export interface ModifyPropertyOp extends BaseMigrationOp {
  type: 'modifyProperty';
  entityName: string;
  propertyName: string;
  changes: Partial<Pick<PropertyDefinition, 'type' | 'required' | 'default' | 'indexed'>>;
}

export interface AddRelationshipOp extends BaseMigrationOp {
  type: 'addRelationship';
  relationship: {
    name: string;
    from: string;
    to: string;
    type: string;
    cardinality: Cardinality;
    edgeProperties?: PropertyDefinition[];
  };
}

export interface RemoveRelationshipOp extends BaseMigrationOp {
  type: 'removeRelationship';
  relationshipName: string;
}

export interface ModifyRelationshipOp extends BaseMigrationOp {
  type: 'modifyRelationship';
  relationshipName: string;
  changes: { cardinality?: Cardinality };
}

export interface AddEngineOp extends BaseMigrationOp {
  type: 'addEngine';
  engine: { name: string; watches: string[]; outputs: string[]; frequency: PatternFrequency };
}

export interface RemoveEngineOp extends BaseMigrationOp {
  type: 'removeEngine';
  engineName: string;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION
// ═══════════════════════════════════════════════════════════════════

export interface Migration {
  id: string;
  description: string;
  fromVersion: number;
  toVersion: number;
  operations: MigrationOperation[];
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION RESULT
// ═══════════════════════════════════════════════════════════════════

export interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  operationsApplied: number;
  errors: string[];
  /** True if this was a dry run — schema was not modified */
  dryRun: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION OPTIONS
// ═══════════════════════════════════════════════════════════════════

export interface MigrationOptions {
  /** If true, return result without modifying the schema */
  dryRun?: boolean;
  /** If true, apply dangerous operations without confirmation */
  force?: boolean;
  /** Called when a dangerous operation requires confirmation */
  onConfirm?: (operation: MigrationOperation) => boolean | Promise<boolean>;
  /** Called with progress updates */
  onProgress?: (index: number, total: number, operation: MigrationOperation) => void;
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA DIFF
// ═══════════════════════════════════════════════════════════════════

export type DiffAction = 'added' | 'removed' | 'modified';

export interface DiffEntry {
  path: string;
  action: DiffAction;
  safety: SafetyLevel;
  before?: unknown;
  after?: unknown;
}

export interface SchemaDiff {
  fromVersion: number;
  toVersion: number;
  entries: DiffEntry[];
  hasDangerous: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION HISTORY
// ═══════════════════════════════════════════════════════════════════

export interface MigrationHistoryEntry {
  migrationId: string;
  appliedAt: string;
  fromVersion: number;
  toVersion: number;
  operationsApplied: number;
}

export interface MigrationHistory {
  entries: MigrationHistoryEntry[];
}
