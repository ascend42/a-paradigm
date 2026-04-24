import { describe, it, expect } from 'vitest';
import {
  parseParadigmConfig,
  serializeParadigmConfig,
  getDefaultParadigmConfig,
  DEFAULT_SYMBOL_SYSTEM,
  DEFAULT_CONVENTIONS,
} from './paradigm-config.js';
import { validateConfig } from './config-schema.js';

describe('parseParadigmConfig', () => {
  it('parses valid v2 YAML', () => {
    const yaml = `
version: "2.0"
project: my-app
agent-guidelines:
  overview: "My app uses Paradigm"
  how-to-use:
    - Check .purpose files
  update-rules:
    - Update .purpose when changing features
symbol-system:
  "#":
    name: Component
    description: Any code unit
    owner: purpose
    examples:
      - "#Button"
purpose-required:
  - pattern: "src/*"
    depth: 1
conventions:
  - Use kebab-case
`;
    const config = parseParadigmConfig(yaml);
    expect(config.version).toBe('2.0');
    expect(config.project).toBe('my-app');
    expect(config['agent-guidelines'].overview).toBe('My app uses Paradigm');
    expect(config['agent-guidelines']['how-to-use']).toHaveLength(1);
    expect(config['symbol-system']['#'].name).toBe('Component');
    expect(config.conventions).toEqual(['Use kebab-case']);
  });

  it('handles missing optional fields', () => {
    const yaml = `
version: "1.0"
agent-guidelines:
  overview: "Basic project"
  how-to-use: []
  update-rules: []
symbol-system:
  "#":
    name: Component
    description: Code unit
    owner: purpose
    examples: []
purpose-required: []
conventions: []
`;
    const config = parseParadigmConfig(yaml);
    expect(config.states).toBeUndefined();
    expect(config.scan).toBeUndefined();
    expect(config.logging).toBeUndefined();
  });

  it('throws on invalid YAML', () => {
    const badYaml = `
version: "1.0"
  broken indent: [
    unclosed
`;
    expect(() => parseParadigmConfig(badYaml)).toThrow();
  });

  it('handles empty string', () => {
    const config = parseParadigmConfig('');
    // yaml.load('') returns undefined
    expect(config).toBeUndefined();
  });
});

describe('serializeParadigmConfig', () => {
  it('round-trips correctly', () => {
    const original = getDefaultParadigmConfig('round-trip-test');
    const serialized = serializeParadigmConfig(original);
    const parsed = parseParadigmConfig(serialized);
    expect(parsed.version).toBe(original.version);
    expect(parsed['agent-guidelines'].overview).toBe(original['agent-guidelines'].overview);
    expect(parsed.conventions).toEqual(original.conventions);
    expect(parsed['symbol-system']['#'].name).toBe(original['symbol-system']['#'].name);
  });
});

describe('getDefaultParadigmConfig', () => {
  it('returns valid structure with all required fields', () => {
    const config = getDefaultParadigmConfig('my-project');
    expect(config.version).toBeDefined();
    expect(config['agent-guidelines']).toBeDefined();
    expect(config['agent-guidelines'].overview).toBeDefined();
    expect(config['agent-guidelines']['how-to-use']).toBeDefined();
    expect(config['agent-guidelines']['update-rules']).toBeDefined();
    expect(config['symbol-system']).toBeDefined();
    expect(config['purpose-required']).toBeDefined();
    expect(config.conventions).toBeDefined();
  });

  it('embeds project name in overview', () => {
    const config = getDefaultParadigmConfig('awesome-app');
    expect(config['agent-guidelines'].overview).toContain('awesome-app');
  });

  it('sets the project field from the projectName argument', () => {
    // Regression: getDefaultParadigmConfig used to drop `project` entirely,
    // producing a config that failed its own Zod schema (which requires
    // `project: z.string()`). Wire the argument through.
    const config = getDefaultParadigmConfig('my-project');
    expect(config.project).toBe('my-project');
  });

  it('produces a config that validates cleanly against the schema (no errors, no warnings)', () => {
    // Regression: a fresh `paradigm init` previously produced two issues —
    //   1. missing `project` (schema error)
    //   2. unrecognized top-level `scan` key (schema warning)
    // Both should now be absent. The default factory is the source of truth
    // for `paradigm cursorrules --init`, so its output must be schema-clean.
    const config = getDefaultParadigmConfig('regression-project');
    const yamlContent = serializeParadigmConfig(config);
    const result = validateConfig(yamlContent);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('config-schema metrics field (v6.0 D7)', () => {
  it('accepts a `metrics` block without warnings or errors', () => {
    // Regression: `metrics` is in the ParadigmConfig interface, written by
    // `seedMetricsConsent()` during `paradigm shift`, and emitted on every
    // fresh project — but `KNOWN_TOP_LEVEL_KEYS` in config-schema.ts did not
    // list it, so `paradigm doctor` warned "Unrecognized config key: metrics"
    // on every fresh project. Both the key allowlist and the Zod schema
    // entry must now accept this field.
    const yaml = `
version: "1.0"
project: metrics-test
agent-guidelines:
  overview: "Metrics regression test"
  how-to-use: []
  update-rules: []
symbol-system:
  "#":
    name: Component
    description: Code unit
    owner: purpose
    examples: []
purpose-required: []
conventions: []
metrics:
  remote_consent: pending
  local_snapshots_enabled: true
`;
    const result = validateConfig(yaml);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid `metrics.remote_consent` value', () => {
    // The enum guard is meaningful, not just decorative — a typo like
    // `granted-with-conditions` should fail validation, not silently pass.
    const yaml = `
version: "1.0"
project: metrics-test
agent-guidelines:
  overview: "Metrics regression test"
  how-to-use: []
  update-rules: []
symbol-system:
  "#":
    name: Component
    description: Code unit
    owner: purpose
    examples: []
purpose-required: []
conventions: []
metrics:
  remote_consent: maybe
`;
    const result = validateConfig(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('metrics.remote_consent'))).toBe(true);
  });
});

describe('DEFAULT_SYMBOL_SYSTEM', () => {
  it('has all 5 symbols', () => {
    const symbols = Object.keys(DEFAULT_SYMBOL_SYSTEM);
    expect(symbols).toContain('#');
    expect(symbols).toContain('$');
    expect(symbols).toContain('^');
    expect(symbols).toContain('!');
    expect(symbols).toContain('~');
  });

  it('each symbol has name, description, owner, and examples', () => {
    for (const [prefix, def] of Object.entries(DEFAULT_SYMBOL_SYSTEM)) {
      expect(def.name, `${prefix} should have name`).toBeDefined();
      expect(def.description, `${prefix} should have description`).toBeDefined();
      expect(def.owner, `${prefix} should have owner`).toBeDefined();
      expect(def.examples, `${prefix} should have examples`).toBeDefined();
      expect(Array.isArray(def.examples), `${prefix} examples should be array`).toBe(true);
    }
  });
});

describe('DEFAULT_CONVENTIONS', () => {
  it('is non-empty', () => {
    expect(DEFAULT_CONVENTIONS.length).toBeGreaterThan(0);
  });
});
