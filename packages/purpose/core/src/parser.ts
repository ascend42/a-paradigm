/**
 * YAML parser for Purpose files
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { PurposeFile, ParseResult, ParseError, ParseWarning } from './types.js';

// ============================================
// Zod Schema for Validation
// ============================================

// Base schema for purpose items (features/components)
// Uses passthrough() to allow extra fields like tags, location, uses, used-by, etc.
const PurposeItemSchema = z.object({
  description: z.string(),
  // Component type and hierarchy (v4)
  type: z.string().optional(),
  parent: z.string().optional(),
  anchors: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  // Standard fields
  endpoints: z.array(z.string()).optional(),
  tests: z.array(z.string()).optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
  aspects: z.array(z.string()).optional(),
  // Symbol reference arrays
  flows: z.array(z.string()).optional(),
  gates: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  // Extra fields preserved
  location: z.string().optional(),
  locations: z.array(z.string()).optional(),
  uses: z.array(z.string()).optional(),
  'used-by': z.array(z.string()).optional(),
  'used-for': z.array(z.string()).optional(),
  exports: z.array(z.string()).optional(),
  status: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  handles: z.array(z.string()).optional(),
}).passthrough();

// Array format: [{ id, description, ... }]
const PurposeItemArraySchema = PurposeItemSchema.extend({
  id: z.string(),
});

// Signals defined in .purpose files — support both object and string shorthand
const SignalDefinitionObjectSchema = z.object({
  description: z.string().optional(),
  category: z.string().optional(),
  severity: z.enum(['info', 'warn', 'error']).optional(),
  emitters: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
// Allow string shorthand: "signal-name: description string"
const SignalDefinitionSchema = z.union([
  SignalDefinitionObjectSchema,
  z.string().transform((desc) => ({ description: desc })),
]);

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
}).passthrough(); // a step may also name a gate or signal; keep those keys for the index
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

// Aspects defined in .purpose files (cross-cutting concerns with code anchors)
const AspectDefinitionSchema = z.object({
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  anchors: z.array(z.string()).optional(),
  'applies-to': z.array(z.string()).optional(),
  enforcement: z.string().optional(),
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
  rules: z.record(z.string(), z.unknown()).optional(),
  // Support both array format [{ id, description }] and record format { id: { description } }
  features: z.union([
    z.array(PurposeItemArraySchema),
    z.record(z.string(), PurposeItemSchema),
  ]).optional(),
  components: z.union([
    z.array(PurposeItemArraySchema),
    z.record(z.string(), PurposeItemSchema),
  ]).optional(),
  gates: z.record(z.string(), GateDefinitionSchema).optional(),
  states: z.record(z.string(), StateDefinitionSchema).optional(),
  signals: z.record(z.string(), SignalDefinitionSchema).optional(),
  aspects: z.record(z.string(), AspectDefinitionSchema).optional(),
  relationships: z.array(RelationshipSchema).optional(),
  // Support both array format and record format for flows
  flows: z.union([
    z.array(FlowWithStepsSchema),
    z.record(z.string(), FlowDefinitionSchema),
  ]).optional(),
  references: z.array(ReferenceSchema).optional(),
});

// ============================================
// Symbol key normalization (#purpose-key-normalizer)
// ============================================

/** Top-level section of a .purpose file for each symbol prefix. */
const SECTION_FOR_PREFIX: Record<string, string> = {
  '#': 'components', '$': 'flows', '^': 'gates', '!': 'signals', '~': 'aspects',
};
/** The prefix each section's keys take in the index. `features` are components. */
const PREFIX_FOR_SECTION: Record<string, string> = {
  components: '#', features: '#', flows: '$', gates: '^', signals: '!', aspects: '~',
};

/**
 * Normalize symbol keys in freshly loaded YAML, in place.
 *
 * 1. A prefixed top-level key moves into its section: `"#MCPServer": {...}`
 *    becomes `components: { MCPServer: {...} }`.
 * 2. A key inside a section that repeats the section's prefix loses it:
 *    `flows: { $checkout: … }` is the flow `checkout`, indexed as `$checkout`.
 *    Left alone, the index adds the prefix again and files it as `$$checkout`,
 *    so every reference to `$checkout` reads as undeclared. Array-format entries
 *    (`id:` for components and features, `name:` for flows) are treated the same.
 *
 * Returns one warning per redundant prefix; the file is still valid.
 */
export function normalizeSymbolKeys(data: unknown): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return warnings;
  const obj = data as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    const target = SECTION_FOR_PREFIX[key[0]];
    if (!target || key.length < 2) continue;
    const id = key.slice(1);
    const value = obj[key];
    if (typeof value !== 'object' || value === null) continue;
    const dict = (obj[target] as Record<string, unknown>) || {};
    if (!(target in obj)) obj[target] = dict;
    if (!(id in dict)) dict[id] = value;
    delete obj[key];
  }

  for (const [section, prefix] of Object.entries(PREFIX_FOR_SECTION)) {
    const block = obj[section];
    if (typeof block !== 'object' || block === null) continue;
    const strip = (raw: string): string => {
      let i = 0;
      while (raw[i] === prefix) i++;
      return raw.slice(i);
    };
    const warn = (raw: string, id: string, extra = ''): void => {
      warnings.push({
        type: 'redundant-prefix',
        path: `${section}.${raw}`,
        message: `"${raw}" under ${section}: repeats the section's "${prefix}" prefix; read as "${id}" (symbol ${prefix}${id}). Write the key as "${id}".${extra}`,
      });
    };

    if (Array.isArray(block)) {
      const field = section === 'flows' ? 'name' : 'id';
      for (const entry of block) {
        if (typeof entry !== 'object' || entry === null) continue;
        const rec = entry as Record<string, unknown>;
        const raw = rec[field];
        if (typeof raw !== 'string' || raw[0] !== prefix) continue;
        const id = strip(raw);
        if (!id) continue;
        rec[field] = id;
        warn(raw, id);
      }
      continue;
    }

    const dict = block as Record<string, unknown>;
    // Rebuilt in written order, so a serialized file does not shuffle its keys.
    const rebuilt: Record<string, unknown> = {};
    let changed = false;
    for (const raw of Object.keys(dict)) {
      const id = raw[0] === prefix ? strip(raw) : '';
      if (!id) {
        rebuilt[raw] = dict[raw];
        continue;
      }
      changed = true;
      if (id in dict || id in rebuilt) {
        // The same symbol is written twice in one section; the plain key wins.
        warn(raw, id, ` "${id}" is also defined in this section, so this entry is ignored.`);
        continue;
      }
      rebuilt[id] = dict[raw];
      warn(raw, id);
    }
    if (changed) obj[section] = rebuilt;
  }

  return warnings;
}

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

  return parseRawPurposeFileContent(rawContent);
}

/**
 * Parse the raw text of a .purpose file exactly as parsePurposeFileDetailed does
 * after reading it from disk (pre-processing, YAML load, symbol-key normalization,
 * Zod validation). Shared with #purpose-parse-cache so a cached parse is
 * byte-for-byte the same pipeline as a cold one. Internal — not re-exported.
 */
export function parseRawPurposeFileContent(rawContent: string): ParseResult {
  const errors: string[] = [];
  const detailedErrors: ParseError[] = [];

  // Pre-process: quote Paradigm symbol prefixes that conflict with YAML syntax.
  // 1. Keys: #Foo: → "#Foo": and ~foo: → "~foo": (# = comment, ! = tag)
  // 2. Array values: - !signal → - "!signal" (! = YAML tag prefix)
  // 3. Inline refs: - #component → - "#component" (# after whitespace = comment)
  const processedContent = rawContent
    .replace(/^([#~!$^][\w-]+):/gm, '"$1":')
    .replace(/^(\s*-\s+)([!#][\w-]+)$/gm, '$1"$2"');

  // Parse YAML
  let data: unknown = null;
  try {
    data = yaml.load(processedContent);
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

  // Normalize symbol keys: a prefixed top-level key moves into its section, and
  // a key that repeats its section's prefix loses it (with a warning).
  const warnings = normalizeSymbolKeys(data);

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
    return { data: data as PurposeFile, errors, detailedErrors, warnings, rawContent, isYamlValid: true };
  }

  return { data: parseResult.data as PurposeFile, errors: [], detailedErrors: [], warnings, rawContent, isYamlValid: true };
}

/**
 * Parse purpose file content from a string
 */
export function parsePurposeContent(content: string): ParseResult {
  const errors: string[] = [];
  const detailedErrors: ParseError[] = [];

  // Pre-process: quote Paradigm symbol prefixes that conflict with YAML syntax
  const processedContent = content
    .replace(/^([#~!$^][\w-]+):/gm, '"$1":')
    .replace(/^(\s*-\s+)([!#][\w-]+)$/gm, '$1"$2"');

  // Parse YAML
  let data: unknown = null;
  try {
    data = yaml.load(processedContent);
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

  // Same key normalization as parseRawPurposeFileContent
  const warnings = normalizeSymbolKeys(data);

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
    return { data: data as PurposeFile, errors, detailedErrors, warnings, rawContent: content, isYamlValid: true };
  }

  return { data: parseResult.data as PurposeFile, errors: [], detailedErrors: [], warnings, rawContent: content, isYamlValid: true };
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
