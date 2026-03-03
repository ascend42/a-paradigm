import type { GraphSchema } from '../schema/types.js';
import type { DiffEntry, Migration, MigrationOperation, SafetyLevel, SchemaDiff } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// SCHEMA DIFF GENERATOR
// ═══════════════════════════════════════════════════════════════════

/** Compare two schemas and produce a diff with safety assessments */
export function diffSchemas(before: GraphSchema, after: GraphSchema): SchemaDiff {
  const entries: DiffEntry[] = [];

  const beforeEntities = new Map(before.entities.map((e) => [e.name, e]));
  const afterEntities = new Map(after.entities.map((e) => [e.name, e]));

  // Entities added
  for (const [name, entity] of afterEntities) {
    if (!beforeEntities.has(name)) {
      entries.push({
        path: `entities.${name}`,
        action: 'added',
        safety: 'safe',
        after: entity,
      });
    }
  }

  // Entities removed
  for (const [name, entity] of beforeEntities) {
    if (!afterEntities.has(name)) {
      entries.push({
        path: `entities.${name}`,
        action: 'removed',
        safety: 'dangerous',
        before: entity,
      });
    }
  }

  // Entities modified — compare properties
  for (const [name, beforeEntity] of beforeEntities) {
    const afterEntity = afterEntities.get(name);
    if (!afterEntity) continue;

    const beforeProps = new Map(beforeEntity.properties.map((p) => [p.name, p]));
    const afterProps = new Map(afterEntity.properties.map((p) => [p.name, p]));

    for (const [propName, prop] of afterProps) {
      if (!beforeProps.has(propName)) {
        const safety: SafetyLevel = prop.required && prop.default === undefined ? 'cautious' : 'safe';
        entries.push({
          path: `entities.${name}.properties.${propName}`,
          action: 'added',
          safety,
          after: prop,
        });
      }
    }

    for (const [propName, prop] of beforeProps) {
      if (!afterProps.has(propName)) {
        entries.push({
          path: `entities.${name}.properties.${propName}`,
          action: 'removed',
          safety: 'dangerous',
          before: prop,
        });
      }
    }

    for (const [propName, beforeProp] of beforeProps) {
      const afterProp = afterProps.get(propName);
      if (!afterProp) continue;
      if (beforeProp.type !== afterProp.type || beforeProp.required !== afterProp.required) {
        const safety: SafetyLevel = beforeProp.type !== afterProp.type ? 'dangerous' : 'cautious';
        entries.push({
          path: `entities.${name}.properties.${propName}`,
          action: 'modified',
          safety,
          before: beforeProp,
          after: afterProp,
        });
      }
    }
  }

  // Relationships
  const beforeRels = new Map(before.relationships.map((r) => [r.name, r]));
  const afterRels = new Map(after.relationships.map((r) => [r.name, r]));

  for (const [name, rel] of afterRels) {
    if (!beforeRels.has(name)) {
      entries.push({ path: `relationships.${name}`, action: 'added', safety: 'safe', after: rel });
    }
  }
  for (const [name, rel] of beforeRels) {
    if (!afterRels.has(name)) {
      entries.push({ path: `relationships.${name}`, action: 'removed', safety: 'dangerous', before: rel });
    }
  }
  for (const [name, beforeRel] of beforeRels) {
    const afterRel = afterRels.get(name);
    if (!afterRel) continue;
    if (beforeRel.cardinality !== afterRel.cardinality) {
      entries.push({
        path: `relationships.${name}`,
        action: 'modified',
        safety: 'cautious',
        before: beforeRel,
        after: afterRel,
      });
    }
  }

  // Pattern engines
  const beforeEngines = new Map(before.patternEngines.map((e) => [e.name, e]));
  const afterEngines = new Map(after.patternEngines.map((e) => [e.name, e]));

  for (const [name, engine] of afterEngines) {
    if (!beforeEngines.has(name)) {
      entries.push({ path: `patternEngines.${name}`, action: 'added', safety: 'safe', after: engine });
    }
  }
  for (const [name, engine] of beforeEngines) {
    if (!afterEngines.has(name)) {
      entries.push({ path: `patternEngines.${name}`, action: 'removed', safety: 'cautious', before: engine });
    }
  }

  return {
    fromVersion: before.schemaVersion,
    toVersion: after.schemaVersion,
    entries,
    hasDangerous: entries.some((e) => e.safety === 'dangerous'),
  };
}

// ═══════════════════════════════════════════════════════════════════
// DIFF → MIGRATION CONVERTER
// ═══════════════════════════════════════════════════════════════════

/** Convert a SchemaDiff into a Migration with auto-generated operations */
export function diffToMigration(diff: SchemaDiff, id: string, description: string): Migration {
  const operations: MigrationOperation[] = [];

  for (const entry of diff.entries) {
    const op = diffEntryToOperation(entry);
    if (op) operations.push(op);
  }

  return {
    id,
    description,
    fromVersion: diff.fromVersion,
    toVersion: diff.toVersion,
    operations,
    createdAt: new Date().toISOString(),
  };
}

function diffEntryToOperation(entry: DiffEntry): MigrationOperation | null {
  const parts = entry.path.split('.');

  if (parts[0] === 'entities' && parts.length === 2) {
    if (entry.action === 'added') {
      const entity = entry.after as { name: string; properties: never[]; tags?: string[] };
      return { type: 'addEntity', entity, safety: entry.safety };
    }
    if (entry.action === 'removed') {
      return { type: 'removeEntity', entityName: parts[1], safety: entry.safety };
    }
  }

  if (parts[0] === 'entities' && parts[2] === 'properties' && parts.length === 4) {
    if (entry.action === 'added') {
      return { type: 'addProperty', entityName: parts[1], property: entry.after as never, safety: entry.safety };
    }
    if (entry.action === 'removed') {
      return { type: 'removeProperty', entityName: parts[1], propertyName: parts[3], safety: entry.safety };
    }
    if (entry.action === 'modified') {
      const after = entry.after as Record<string, unknown>;
      return {
        type: 'modifyProperty',
        entityName: parts[1],
        propertyName: parts[3],
        changes: { type: after.type, required: after.required } as never,
        safety: entry.safety,
      };
    }
  }

  if (parts[0] === 'relationships') {
    if (entry.action === 'added') {
      return { type: 'addRelationship', relationship: entry.after as never, safety: entry.safety };
    }
    if (entry.action === 'removed') {
      return { type: 'removeRelationship', relationshipName: parts[1], safety: entry.safety };
    }
    if (entry.action === 'modified') {
      const after = entry.after as Record<string, unknown>;
      return {
        type: 'modifyRelationship',
        relationshipName: parts[1],
        changes: { cardinality: after.cardinality } as never,
        safety: entry.safety,
      };
    }
  }

  if (parts[0] === 'patternEngines') {
    if (entry.action === 'added') {
      return { type: 'addEngine', engine: entry.after as never, safety: entry.safety };
    }
    if (entry.action === 'removed') {
      return { type: 'removeEngine', engineName: parts[1], safety: entry.safety };
    }
  }

  return null;
}
