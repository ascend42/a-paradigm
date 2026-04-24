/**
 * Config Schema — Zod validation for .paradigm/config.yaml
 *
 * Validates known fields and warns on unrecognized keys.
 * Uses .passthrough() at top level so unknown fields don't error.
 */

import { z } from 'zod';
import * as yaml from 'js-yaml';

// ============================================================================
// Schema Definition
// ============================================================================

const disciplineEnum = z.enum([
  'web', 'backend', 'fullstack', 'api', 'cli', 'ml',
  'mobile', 'game', 'embedded', 'devops', 'data',
  'library', 'monorepo', 'custom',
]);

const agentProviderEnum = z.enum([
  'auto', 'claude', 'claude-code', 'cursor-cli', 'claude-cli', 'manual',
]);

const symbolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  examples: z.array(z.string()).optional(),
}).passthrough();

const tagBankSchema = z.object({
  file: z.string().optional(),
  'core-tags': z.array(z.string()).optional(),
  'allow-suggestions': z.boolean().optional(),
}).passthrough();

const agentGuidelinesSchema = z.object({
  overview: z.string().optional(),
  'how-to-use': z.array(z.string()).optional(),
  'update-rules': z.array(z.string()).optional(),
}).passthrough();

const loggingSchema = z.object({
  enforce: z.boolean().optional(),
  'default-level': z.enum(['debug', 'info', 'warn', 'error']).optional(),
  'symbol-mapping': z.record(z.string(), z.string()).optional(),
}).passthrough();

const purposeRequiredEntry = z.object({
  pattern: z.string(),
  depth: z.number().optional(),
});

const limitsSchema = z.object({
  toolCacheTtlMs: z.number().optional(),
}).passthrough();

const aiAgentSchema = z.object({
  model: z.string().optional(),
  'context-window': z.number().optional(),
}).passthrough();

const contextSchema = z.object({
  enabled: z.boolean().optional(),
  'index-file': z.string().optional(),
  'docs-path': z.string().optional(),
}).passthrough();

const probeSchema = z.object({
  enabled: z.boolean().optional(),
  'auto-include': z.boolean().optional(),
}).passthrough();

// v6.0 (D7): metrics — local snapshots opt-in seed + remote consent state.
// Mirrors `MetricsConfig` in `core/paradigm-config.ts` and the shape written
// by `seedMetricsConsent()` in `core/university/metrics.ts`.
const metricsSchema = z.object({
  remote_consent: z.enum(['pending', 'granted', 'declined']).optional(),
  local_snapshots_enabled: z.boolean().optional(),
}).passthrough();

export const paradigmConfigSchema = z.object({
  version: z.string(),
  project: z.string(),
  discipline: disciplineEnum.optional(),
  'agent-provider': agentProviderEnum.optional(),
  'agent-guidelines': agentGuidelinesSchema.optional(),
  'symbol-system': z.record(z.string(), symbolDefinitionSchema).optional(),
  'tag-bank': tagBankSchema.optional(),
  component_types: z.record(z.string(), z.string()).optional(),
  logging: loggingSchema.optional(),
  'purpose-required': z.array(purposeRequiredEntry).optional(),
  conventions: z.array(z.string()).optional(),
  workspace: z.string().optional(),
  limits: limitsSchema.optional(),
  'ai-agent': aiAgentSchema.optional(),
  context: contextSchema.optional(),
  probe: probeSchema.optional(),
  metrics: metricsSchema.optional(),
  states: z.record(z.string(), z.unknown()).optional(),
  'custom-symbols': z.record(z.string(), symbolDefinitionSchema).optional(),
}).passthrough(); // Allow unknown top-level keys (warn, don't error)

// ============================================================================
// Known top-level keys (for warning on unrecognized)
// ============================================================================

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'version', 'project', 'discipline', 'agent-provider',
  'agent-guidelines', 'symbol-system', 'tag-bank',
  'component_types', 'logging', 'purpose-required',
  'conventions', 'workspace', 'limits', 'ai-agent',
  'context', 'probe', 'metrics', 'states', 'custom-symbols',
  'docs', 'features', 'enforcement', 'model-resolution',
]);

// ============================================================================
// Validation
// ============================================================================

export interface ConfigValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate config.yaml content.
 * Returns warnings for unknown keys and errors for schema violations.
 */
export function validateConfig(content: string): ConfigValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (e) {
    return {
      valid: false,
      warnings: [],
      errors: [`YAML parse error: ${(e as Error).message}`],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      warnings: [],
      errors: ['Config must be a YAML object'],
    };
  }

  // Check for unrecognized top-level keys
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Unrecognized config key: "${key}"`);
    }
  }

  // Validate with Zod schema
  const result = paradigmConfigSchema.safeParse(parsed);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      errors.push(`${path}: ${issue.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
