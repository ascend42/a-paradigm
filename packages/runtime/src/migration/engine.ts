import type { GraphSchema } from '../schema/types.js';
import type { Migration, MigrationOperation, MigrationOptions, MigrationResult } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// MIGRATION VALIDATION
// ═══════════════════════════════════════════════════════════════════

/** Validate that a migration is structurally sound and can be applied to the schema */
export function validateMigration(schema: GraphSchema, migration: Migration): string[] {
  const errors: string[] = [];

  if (migration.fromVersion !== schema.schemaVersion) {
    errors.push(
      `Migration expects schema version ${migration.fromVersion}, but schema is at version ${schema.schemaVersion}`,
    );
  }

  if (migration.toVersion <= migration.fromVersion) {
    errors.push(
      `Migration toVersion (${migration.toVersion}) must be greater than fromVersion (${migration.fromVersion})`,
    );
  }

  if (migration.operations.length === 0) {
    errors.push('Migration has no operations');
  }

  const entityNames = new Set(schema.entities.map((e) => e.name));

  for (const op of migration.operations) {
    switch (op.type) {
      case 'addEntity':
        if (entityNames.has(op.entity.name)) {
          errors.push(`Cannot add entity "${op.entity.name}" — already exists`);
        }
        break;
      case 'removeEntity':
        if (!entityNames.has(op.entityName)) {
          errors.push(`Cannot remove entity "${op.entityName}" — does not exist`);
        }
        break;
      case 'addProperty': {
        if (!entityNames.has(op.entityName)) {
          errors.push(`Cannot add property to "${op.entityName}" — entity does not exist`);
        } else {
          const entity = schema.entities.find((e) => e.name === op.entityName)!;
          if (entity.properties.some((p) => p.name === op.property.name)) {
            errors.push(
              `Cannot add property "${op.property.name}" to "${op.entityName}" — already exists`,
            );
          }
        }
        break;
      }
      case 'removeProperty': {
        if (!entityNames.has(op.entityName)) {
          errors.push(`Cannot remove property from "${op.entityName}" — entity does not exist`);
        } else {
          const entity = schema.entities.find((e) => e.name === op.entityName)!;
          if (!entity.properties.some((p) => p.name === op.propertyName)) {
            errors.push(
              `Cannot remove property "${op.propertyName}" from "${op.entityName}" — does not exist`,
            );
          }
        }
        break;
      }
      case 'modifyProperty': {
        if (!entityNames.has(op.entityName)) {
          errors.push(`Cannot modify property in "${op.entityName}" — entity does not exist`);
        } else {
          const entity = schema.entities.find((e) => e.name === op.entityName)!;
          if (!entity.properties.some((p) => p.name === op.propertyName)) {
            errors.push(
              `Cannot modify property "${op.propertyName}" in "${op.entityName}" — does not exist`,
            );
          }
        }
        break;
      }
      case 'addRelationship': {
        const relNames = new Set(schema.relationships.map((r) => r.name));
        if (relNames.has(op.relationship.name)) {
          errors.push(`Cannot add relationship "${op.relationship.name}" — already exists`);
        }
        break;
      }
      case 'removeRelationship': {
        if (!schema.relationships.some((r) => r.name === op.relationshipName)) {
          errors.push(`Cannot remove relationship "${op.relationshipName}" — does not exist`);
        }
        break;
      }
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION ENGINE
// ═══════════════════════════════════════════════════════════════════

/** Apply a single migration to a schema, returning the new schema */
export async function applyMigration(
  schema: GraphSchema,
  migration: Migration,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const { dryRun = false, force = false, onConfirm, onProgress } = options;

  // Validate first
  const validationErrors = validateMigration(schema, migration);
  if (validationErrors.length > 0) {
    return {
      success: false,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      operationsApplied: 0,
      errors: validationErrors,
      dryRun,
    };
  }

  // Work on a deep copy so we don't mutate the original
  const working: GraphSchema = dryRun ? schema : structuredClone(schema);
  let applied = 0;

  for (let i = 0; i < migration.operations.length; i++) {
    const op = migration.operations[i];
    onProgress?.(i, migration.operations.length, op);

    // Check if dangerous operation needs confirmation
    if (op.safety === 'dangerous' && !force && onConfirm) {
      const confirmed = await onConfirm(op);
      if (!confirmed) {
        return {
          success: false,
          fromVersion: migration.fromVersion,
          toVersion: migration.toVersion,
          operationsApplied: applied,
          errors: [`Operation ${i} (${op.type}) was not confirmed`],
          dryRun,
        };
      }
    }

    if (!dryRun) {
      applyOperation(working, op);
    }
    applied++;
  }

  if (!dryRun) {
    working.schemaVersion = migration.toVersion;
  }

  return {
    success: true,
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    operationsApplied: applied,
    errors: [],
    dryRun,
  };
}

/** Apply multiple migrations in sequence */
export async function applyMigrations(
  schema: GraphSchema,
  migrations: Migration[],
  options: MigrationOptions = {},
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  // Sort by fromVersion to ensure correct order
  const sorted = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);

  for (const migration of sorted) {
    const result = await applyMigration(schema, migration, options);
    results.push(result);
    if (!result.success) break;
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// OPERATION APPLIERS
// ═══════════════════════════════════════════════════════════════════

function applyOperation(schema: GraphSchema, op: MigrationOperation): void {
  switch (op.type) {
    case 'addEntity':
      schema.entities.push({ ...op.entity, properties: [...op.entity.properties] });
      break;

    case 'removeEntity': {
      const idx = schema.entities.findIndex((e) => e.name === op.entityName);
      if (idx !== -1) schema.entities.splice(idx, 1);
      // Also remove relationships referencing this entity
      schema.relationships = schema.relationships.filter(
        (r) => r.from !== op.entityName && r.to !== op.entityName,
      );
      break;
    }

    case 'modifyEntity': {
      const entity = schema.entities.find((e) => e.name === op.entityName);
      if (entity && op.changes.tags) entity.tags = op.changes.tags;
      break;
    }

    case 'addProperty': {
      const entity = schema.entities.find((e) => e.name === op.entityName);
      if (entity) entity.properties.push(op.property);
      break;
    }

    case 'removeProperty': {
      const entity = schema.entities.find((e) => e.name === op.entityName);
      if (entity) {
        entity.properties = entity.properties.filter((p) => p.name !== op.propertyName);
      }
      break;
    }

    case 'modifyProperty': {
      const entity = schema.entities.find((e) => e.name === op.entityName);
      if (entity) {
        const prop = entity.properties.find((p) => p.name === op.propertyName);
        if (prop) Object.assign(prop, op.changes);
      }
      break;
    }

    case 'addRelationship':
      schema.relationships.push(op.relationship);
      break;

    case 'removeRelationship':
      schema.relationships = schema.relationships.filter((r) => r.name !== op.relationshipName);
      break;

    case 'modifyRelationship': {
      const rel = schema.relationships.find((r) => r.name === op.relationshipName);
      if (rel && op.changes.cardinality) rel.cardinality = op.changes.cardinality;
      break;
    }

    case 'addEngine':
      schema.patternEngines.push(op.engine);
      break;

    case 'removeEngine':
      schema.patternEngines = schema.patternEngines.filter((e) => e.name !== op.engineName);
      break;
  }
}
