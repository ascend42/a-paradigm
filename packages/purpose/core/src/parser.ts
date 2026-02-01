/**
 * YAML parser for Purpose files
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { PurposeFile, ParseResult, ParseError } from './types.js';

// ============================================
// Zod Schema for Validation
// ============================================

// Base schema for purpose items (features/components)
const PurposeItemSchema = z.object({
  description: z.string(),
  endpoints: z.array(z.string()).optional(),
  tests: z.array(z.string()).optional(),
  rules: z.record(z.unknown()).optional(),
  aspects: z.record(z.unknown()).optional(),
  // Symbol reference arrays
  flows: z.array(z.string()).optional(),
  gates: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
});

// Array format: [{ id, description, ... }]
const PurposeItemArraySchema = PurposeItemSchema.extend({
  id: z.string(),
});

// Signals defined in .purpose files
const SignalDefinitionSchema = z.object({
  description: z.string().optional(),
  category: z.string().optional(),
  severity: z.enum(['info', 'warn', 'error']).optional(),
  emitters: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  data: z.record(z.unknown()).optional(),
});

// Relationship can be an object or a string (shorthand like "@feature USES #component")
const RelationshipObjectSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  description: z.string().optional(),
});
const RelationshipSchema = z.union([RelationshipObjectSchema, z.string()]);

// Flow step can be an object or a string (simple description)
const FlowStepObjectSchema = z.object({
  component: z.string(),
  action: z.string(),
  description: z.string().optional(),
});
const FlowStepSchema = z.union([FlowStepObjectSchema, z.string()]);

// Array format: [{ name, steps }]
const FlowWithStepsSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(FlowStepSchema),
});

// Record format: { flow-name: { description, gates, signals } }
const FlowDefinitionSchema = z.object({
  description: z.string().optional(),
  gates: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  steps: z.array(FlowStepSchema).optional(),
});

// Gates defined in .purpose files
const GateDefinitionSchema = z.object({
  description: z.string().optional(),
  requires: z.array(z.string()).optional(),
  keys: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
});

// States defined in .purpose files
const StateDefinitionSchema = z.object({
  description: z.string().optional(),
  default: z.unknown().optional(),
  type: z.string().optional(),
});

const ReferenceSchema = z.object({
  target: z.string(),
  type: z.string(),
  path: z.string(),
});

const PurposeFileSchema = z.object({
  version: z.string().optional(),
  description: z.string().optional(),
  apiSpec: z.string().optional(),
  context: z.array(z.string()).optional(),
  rules: z.record(z.unknown()).optional(),
  // Support both array format [{ id, description }] and record format { id: { description } }
  features: z.union([
    z.array(PurposeItemArraySchema),
    z.record(PurposeItemSchema),
  ]).optional(),
  components: z.union([
    z.array(PurposeItemArraySchema),
    z.record(PurposeItemSchema),
  ]).optional(),
  gates: z.record(GateDefinitionSchema).optional(),
  states: z.record(StateDefinitionSchema).optional(),
  signals: z.record(SignalDefinitionSchema).optional(),
  relationships: z.array(RelationshipSchema).optional(),
  // Support both array format and record format for flows
  flows: z.union([
    z.array(FlowWithStepsSchema),
    z.record(FlowDefinitionSchema),
  ]).optional(),
  references: z.array(ReferenceSchema).optional(),
});

// ============================================
// Parser Functions
// ============================================

/**
 * Parse a .purpose file with basic error reporting
 */
export function parsePurposeFile(filePath: string): { data: PurposeFile | null; errors: string[] } {
  const result = parsePurposeFileDetailed(filePath);
  return { data: result.data, errors: result.errors };
}

/**
 * Parse a .purpose file with detailed error information
 */
export function parsePurposeFileDetailed(filePath: string): ParseResult {
  const errors: string[] = [];
  const detailedErrors: ParseError[] = [];
  let rawContent: string | undefined;

  // Read file
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (e: unknown) {
    const error = `Cannot read file: ${(e as Error).message}`;
    errors.push(error);
    detailedErrors.push({ message: error, type: 'file' });
    return { data: null, errors, detailedErrors, rawContent: undefined, isYamlValid: false };
  }

  // Parse YAML
  let data: unknown = null;
  try {
    data = yaml.load(rawContent);
  } catch (e: unknown) {
    const yamlError = e as yaml.YAMLException;
    const line = yamlError.mark?.line ? yamlError.mark.line + 1 : undefined;
    const message = `YAML syntax error: ${yamlError.reason || (e as Error).message}`;
    errors.push(`${message}${line ? ` (line ${line})` : ''}`);
    detailedErrors.push({
      message,
      line,
      type: 'yaml',
    });
    return { data: null, errors, detailedErrors, rawContent, isYamlValid: false };
  }

  // Handle empty files
  if (data === null || data === undefined) {
    return {
      data: {},
      errors: [],
      detailedErrors: [],
      rawContent,
      isYamlValid: true,
    };
  }

  // Validate against schema
  const parseResult = PurposeFileSchema.safeParse(data);

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join('.');
      const message = issue.message;
      errors.push(`Schema error at ${path || '/'}: ${message}`);
      detailedErrors.push({
        message,
        path: path || '/',
        type: 'schema',
      });
    }
    // Return data even with schema errors - allows raw editing
    return { data: data as PurposeFile, errors, detailedErrors, rawContent, isYamlValid: true };
  }

  return { data: parseResult.data as PurposeFile, errors: [], detailedErrors: [], rawContent, isYamlValid: true };
}

/**
 * Parse purpose file content from a string
 */
export function parsePurposeContent(content: string): ParseResult {
  const errors: string[] = [];
  const detailedErrors: ParseError[] = [];

  // Parse YAML
  let data: unknown = null;
  try {
    data = yaml.load(content);
  } catch (e: unknown) {
    const yamlError = e as yaml.YAMLException;
    const line = yamlError.mark?.line ? yamlError.mark.line + 1 : undefined;
    const message = `YAML syntax error: ${yamlError.reason || (e as Error).message}`;
    errors.push(`${message}${line ? ` (line ${line})` : ''}`);
    detailedErrors.push({
      message,
      line,
      type: 'yaml',
    });
    return { data: null, errors, detailedErrors, rawContent: content, isYamlValid: false };
  }

  // Handle empty content
  if (data === null || data === undefined) {
    return {
      data: {},
      errors: [],
      detailedErrors: [],
      rawContent: content,
      isYamlValid: true,
    };
  }

  // Validate against schema
  const parseResult = PurposeFileSchema.safeParse(data);

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join('.');
      const message = issue.message;
      errors.push(`Schema error at ${path || '/'}: ${message}`);
      detailedErrors.push({
        message,
        path: path || '/',
        type: 'schema',
      });
    }
    return { data: data as PurposeFile, errors, detailedErrors, rawContent: content, isYamlValid: true };
  }

  return { data: parseResult.data as PurposeFile, errors: [], detailedErrors: [], rawContent: content, isYamlValid: true };
}

/**
 * Serialize a PurposeFile back to YAML
 */
export function serializePurposeFile(data: PurposeFile): string {
  return yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Get default .purpose file content for initialization
 */
export function getDefaultPurposeContent(): string {
  const defaultFile: PurposeFile = {
    version: '1.0.0',
    description: 'Project purpose and context',
    context: [
      'Add contextual notes for AI agents here',
    ],
    features: {},
    components: {},
  };

  return serializePurposeFile(defaultFile);
}
