export type {
  SchemaFormatVersion,
  PropertyType,
  Cardinality,
  PatternFrequency,
  PropertyDefinition,
  MemoryConfig,
  EntityDefinition,
  RelationshipDefinition,
  PatternEngineDefinition,
  GraphSchema,
  GraphMemoryConfig,
} from './types.js';

export {
  validateSchema,
  hasEntity,
  getEntity,
} from './validation.js';

export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './validation.js';
