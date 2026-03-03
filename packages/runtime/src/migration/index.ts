export type {
  SafetyLevel,
  MigrationOperation,
  AddEntityOp,
  RemoveEntityOp,
  ModifyEntityOp,
  AddPropertyOp,
  RemovePropertyOp,
  ModifyPropertyOp,
  AddRelationshipOp,
  RemoveRelationshipOp,
  ModifyRelationshipOp,
  AddEngineOp,
  RemoveEngineOp,
  Migration,
  MigrationResult,
  MigrationOptions,
  DiffAction,
  DiffEntry,
  SchemaDiff,
  MigrationHistoryEntry,
  MigrationHistory,
} from './types.js';

export { diffSchemas, diffToMigration } from './diff.js';
export { applyMigration, applyMigrations, validateMigration } from './engine.js';
export {
  createHistory,
  recordMigration,
  isMigrationApplied,
  getCurrentVersion,
  getPendingMigrations,
} from './history.js';
