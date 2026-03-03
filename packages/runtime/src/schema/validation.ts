import type { EntityDefinition, GraphSchema } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// VALIDATION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Check if an entity exists in the schema by name */
export function hasEntity(schema: GraphSchema, name: string): boolean {
  return schema.entities.some((e) => e.name === name);
}

/** Get an entity definition by name, or undefined */
export function getEntity(
  schema: GraphSchema,
  name: string,
): EntityDefinition | undefined {
  return schema.entities.find((e) => e.name === name);
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════

/** Validate a GraphSchema for structural correctness */
export function validateSchema(schema: GraphSchema): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check for duplicate entity names
  const entityNames = new Set<string>();
  for (const entity of schema.entities) {
    if (entityNames.has(entity.name)) {
      errors.push({
        path: `entities.${entity.name}`,
        message: `Duplicate entity name: "${entity.name}"`,
      });
    }
    entityNames.add(entity.name);

    // Check for duplicate property names within entity
    const propNames = new Set<string>();
    for (const prop of entity.properties) {
      if (propNames.has(prop.name)) {
        errors.push({
          path: `entities.${entity.name}.properties.${prop.name}`,
          message: `Duplicate property name: "${prop.name}" in entity "${entity.name}"`,
        });
      }
      propNames.add(prop.name);

      // Check enum type has enumValues
      if (prop.type === 'enum' && (!prop.enumValues || prop.enumValues.length === 0)) {
        errors.push({
          path: `entities.${entity.name}.properties.${prop.name}`,
          message: `Enum property "${prop.name}" must have enumValues`,
        });
      }

      // Check array type has arrayItemType
      if (prop.type === 'array' && !prop.arrayItemType) {
        warnings.push({
          path: `entities.${entity.name}.properties.${prop.name}`,
          message: `Array property "${prop.name}" has no arrayItemType — defaults to json`,
        });
      }
    }
  }

  // Validate relationship endpoints reference existing entities
  const relationshipNames = new Set<string>();
  for (const rel of schema.relationships) {
    if (relationshipNames.has(rel.name)) {
      errors.push({
        path: `relationships.${rel.name}`,
        message: `Duplicate relationship name: "${rel.name}"`,
      });
    }
    relationshipNames.add(rel.name);

    if (!entityNames.has(rel.from)) {
      errors.push({
        path: `relationships.${rel.name}.from`,
        message: `Relationship "${rel.name}" references unknown entity: "${rel.from}"`,
      });
    }
    if (!entityNames.has(rel.to)) {
      errors.push({
        path: `relationships.${rel.name}.to`,
        message: `Relationship "${rel.name}" references unknown entity: "${rel.to}"`,
      });
    }
  }

  // Validate pattern engine watches reference existing entities
  for (const engine of schema.patternEngines) {
    for (const watch of engine.watches) {
      if (!entityNames.has(watch)) {
        errors.push({
          path: `patternEngines.${engine.name}.watches`,
          message: `Pattern engine "${engine.name}" watches unknown entity: "${watch}"`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
