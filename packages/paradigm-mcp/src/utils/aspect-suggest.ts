/**
 * Aspect Auto-Suggestion — Heuristic engine for Phase 4 of the Aspect Graph
 *
 * Scans a source code file line-by-line with regex patterns to detect lines
 * that likely encode undocumented business rules, configuration values, or
 * constraints. Each match becomes a candidate for creating a new aspect (~).
 *
 * Detection categories:
 *   - Magic numbers (configuration)
 *   - Hardcoded strings / URLs (configuration)
 *   - Rate limits / thresholds (constraint)
 *   - Time values / durations (configuration)
 *   - Environment checks (decision)
 *   - Feature flags (decision)
 *   - Complex regex patterns (rule/invariant)
 *   - Conditional business logic (rule)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AspectSuggestion } from '../types/aspect-graph.js';

// ============================================
// Test File Detection
// ============================================

/** Segments in file paths that indicate test files */
const TEST_PATH_SEGMENTS = [
  'test',
  'tests',
  'spec',
  'specs',
  '__tests__',
  '__mocks__',
  '__fixtures__',
];

/**
 * Check if a file path points to a test file.
 *
 * Matches paths containing test-related directory segments or filenames
 * ending with `.test.*`, `.spec.*`, or `_test.*`.
 */
function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/');

  for (const segment of segments) {
    if (TEST_PATH_SEGMENTS.includes(segment)) {
      return true;
    }
  }

  const basename = path.basename(normalized);
  return /\.(test|spec|_test)\.\w+$/.test(basename);
}

// ============================================
// Line Classification
// ============================================

/**
 * Check if a line is a comment or an import/require statement.
 *
 * Skips:
 * - Single-line comments: `//`, `#` (but not shebangs), `*` (JSDoc midline)
 * - Block comment openers: `/*`
 * - ES import/export: `import ...`, `export ... from`
 * - CommonJS require: `require(`
 */
function isCommentOrImport(line: string): boolean {
  const trimmed = line.trim();

  // Empty lines
  if (trimmed.length === 0) return true;

  // Comment-only lines
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*')) return true;
  if (trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) return true;

  // Import / require lines
  if (/^\s*import\s/.test(line)) return true;
  if (/^\s*export\s.*\sfrom\s/.test(line)) return true;
  if (/\brequire\s*\(/.test(line) && /^\s*(const|let|var|import)\s/.test(line)) return true;

  return false;
}

// ============================================
// Name Derivation Helpers
// ============================================

/**
 * Convert a camelCase, PascalCase, or snake_case string to kebab-case.
 *
 * @example
 * toKebabCase("maxRetries")     // "max-retries"
 * toKebabCase("MAX_RETRIES")    // "max-retries"
 * toKebabCase("MyComponent")    // "my-component"
 */
function toKebabCase(str: string): string {
  return str
    // Insert hyphen before uppercase letters preceded by lowercase
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    // Insert hyphen before uppercase letters preceded by other uppercase + lowercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    // Replace underscores and spaces with hyphens
    .replace(/[_\s]+/g, '-')
    // Collapse multiple hyphens
    .replace(/-+/g, '-')
    .toLowerCase()
    // Trim leading/trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract the left-hand side variable or property name from an assignment line.
 *
 * Handles:
 * - `const maxRetries = 3`
 * - `this.timeout = 5000`
 * - `config.apiUrl = "..."`
 * - `MAX_RETRIES: 3`  (object literal / TypeScript)
 *
 * @returns The extracted name in its original casing, or null if not found.
 */
function extractVariableName(line: string): string | null {
  const trimmed = line.trim();

  // const/let/var declarations: `const maxRetries = 3`
  const declMatch = trimmed.match(/(?:const|let|var)\s+(\w+)\s*[:=]/);
  if (declMatch) return declMatch[1];

  // Property assignment: `this.timeout = 5000` or `config.apiUrl = "..."`
  const propMatch = trimmed.match(/(?:\w+\.)+(\w+)\s*=/);
  if (propMatch) return propMatch[1];

  // Object property: `timeout: 5000` or `maxRetries: 3`
  const objMatch = trimmed.match(/^\s*['"]?(\w+)['"]?\s*:/);
  if (objMatch) return objMatch[1];

  // Bare assignment: `maxRetries = 3`
  const bareMatch = trimmed.match(/^(\w+)\s*=/);
  if (bareMatch) return bareMatch[1];

  return null;
}

/**
 * Build a suggested aspect name from a variable name and an optional value.
 *
 * @example
 * deriveName("maxRetries", "3")       // "max-retries-3"
 * deriveName("API_TIMEOUT", "5000")   // "api-timeout-5000"
 * deriveName(null, null, "magic-number", 42) // "magic-number-L42"
 */
function deriveName(
  varName: string | null,
  value: string | null,
  fallbackPrefix?: string,
  lineNumber?: number,
): string {
  if (varName) {
    const kebab = toKebabCase(varName);
    if (value && value.length <= 20) {
      return `${kebab}-${value.replace(/[^a-zA-Z0-9.-]/g, '')}`;
    }
    return kebab;
  }

  if (fallbackPrefix && lineNumber != null) {
    return `${fallbackPrefix}-L${lineNumber}`;
  }

  return `unnamed-L${lineNumber ?? 0}`;
}

// ============================================
// Detection Patterns
// ============================================

/** A single pattern detector function */
type PatternDetector = (
  line: string,
  lineNumber: number,
  filePath: string,
) => AspectSuggestion | null;

// --------------------------------------------------
// 1. Magic Numbers
// --------------------------------------------------

const detectMagicNumbers: PatternDetector = (line, lineNumber) => {
  // Numbers >= 10 after = or :
  const numMatch = line.match(/(?:=|:)\s*(\d{2,})\b/);
  if (!numMatch) {
    // Also check arithmetic expressions: `= 1000 * 60`
    const arithMatch = line.match(/(?:=|:)\s*(\d+\s*\*\s*\d+)/);
    if (!arithMatch) return null;

    const varName = extractVariableName(line);
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, null, 'time-expression', lineNumber),
      suggestedCategory: 'configuration',
      suggestedDescription: `Arithmetic expression that may encode a duration or size: ${arithMatch[1].trim()}`,
      confidence: 'low',
      reason: 'Arithmetic expression with multiplication — may encode a computed constant',
    };
  }

  // Check if it's in a named-constant context (max, min, limit, etc.)
  const namedMatch = line.match(
    /(max|min|limit|timeout|threshold|retry|retries|interval|duration|delay|size|count|length|ttl|expir)/i,
  );
  const confidence = namedMatch ? 'medium' : 'low';
  const varName = extractVariableName(line);
  const value = numMatch[1];

  return {
    line: lineNumber,
    code: line.trim(),
    suggestedName: deriveName(varName, value, 'magic-number', lineNumber),
    suggestedCategory: 'configuration',
    suggestedDescription: `Numeric literal ${value} that may be a tunable configuration value`,
    confidence,
    reason: namedMatch
      ? `Named constant with keyword "${namedMatch[1]}" and numeric value ${value}`
      : `Numeric literal ${value} assigned directly — consider extracting as a named constant`,
  };
};

// --------------------------------------------------
// 2. Hardcoded Strings (URLs, API paths)
// --------------------------------------------------

const detectHardcodedStrings: PatternDetector = (line, lineNumber) => {
  // URLs: "https://..." or 'http://...'
  const urlMatch = line.match(/(['"])(https?:\/\/[^'"]+)\1/);
  if (urlMatch) {
    const url = urlMatch[2];
    const varName = extractVariableName(line);
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, null, 'hardcoded-url', lineNumber),
      suggestedCategory: 'configuration',
      suggestedDescription: `Hardcoded URL "${url}" — should be externalized as configuration`,
      confidence: 'medium',
      reason: `URL literal found: ${url}`,
    };
  }

  // API paths: '/api/...'
  const apiMatch = line.match(/(['"])(\/api\/[^'"]+)\1/);
  if (apiMatch) {
    const apiPath = apiMatch[2];
    const varName = extractVariableName(line);
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, null, 'api-path', lineNumber),
      suggestedCategory: 'configuration',
      suggestedDescription: `Hardcoded API path "${apiPath}" — may belong in a route configuration`,
      confidence: 'low',
      reason: `API path literal found: ${apiPath}`,
    };
  }

  return null;
};

// --------------------------------------------------
// 3. Rate Limits / Thresholds
// --------------------------------------------------

const detectRateLimits: PatternDetector = (line, lineNumber) => {
  const match = line.match(/(rate|limit|max|throttle|quota|ceiling|cap)\w*\s*[:=]\s*(\d+)/i);
  if (!match) return null;

  const keyword = match[1];
  const value = match[2];
  const varName = extractVariableName(line);

  return {
    line: lineNumber,
    code: line.trim(),
    suggestedName: deriveName(varName, value, 'threshold', lineNumber),
    suggestedCategory: 'constraint',
    suggestedDescription: `${keyword}-related threshold set to ${value} — enforces a system constraint`,
    confidence: 'high',
    reason: `Rate/limit keyword "${keyword}" with explicit numeric value ${value}`,
  };
};

// --------------------------------------------------
// 4. Time Values / Durations
// --------------------------------------------------

const detectTimeValues: PatternDetector = (line, lineNumber) => {
  // Three-part multiplicative chains: `24 * 60 * 60`
  const tripleChain = line.match(/(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  if (tripleChain) {
    const expr = tripleChain[0];
    const varName = extractVariableName(line);
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, null, 'duration', lineNumber),
      suggestedCategory: 'configuration',
      suggestedDescription: `Multiplicative time expression "${expr}" — likely encodes a duration`,
      confidence: 'high',
      reason: `Three-part arithmetic chain "${expr}" — common pattern for seconds/milliseconds computation`,
    };
  }

  // Two-part chains with well-known multipliers: `1000 * 60`, `60 * 60`
  const knownMultiplier = line.match(/(\d+)\s*\*\s*(60|1000|3600|86400)/);
  if (knownMultiplier) {
    const expr = knownMultiplier[0];
    const varName = extractVariableName(line);
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, null, 'duration', lineNumber),
      suggestedCategory: 'configuration',
      suggestedDescription: `Time arithmetic "${expr}" — uses a well-known time multiplier`,
      confidence: 'high',
      reason: `Arithmetic with time multiplier (60/1000/3600/86400): "${expr}"`,
    };
  }

  // setTimeout / setInterval with numeric delay
  const timerMatch = line.match(/set(Timeout|Interval)\s*\([^,]+,\s*(\d+)\s*\)/);
  if (timerMatch) {
    const fn = `set${timerMatch[1]}`;
    const delay = timerMatch[2];
    const varName = extractVariableName(line);
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, delay, `${toKebabCase(fn)}-delay`, lineNumber),
      suggestedCategory: 'configuration',
      suggestedDescription: `${fn} with ${delay}ms delay — hardcoded timer value`,
      confidence: 'medium',
      reason: `Timer function ${fn} with hardcoded delay of ${delay}ms`,
    };
  }

  return null;
};

// --------------------------------------------------
// 5. Environment Checks
// --------------------------------------------------

const detectEnvironmentChecks: PatternDetector = (line, lineNumber) => {
  const match = line.match(/process\.env\.(\w+)(?:\s*===?\s*['"](\w+)['"])?/);
  if (!match) {
    // Also detect import.meta.env
    const metaMatch = line.match(/import\.meta\.env\.(\w+)/);
    if (!metaMatch) return null;

    const envVar = metaMatch[1];
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: `env-${toKebabCase(envVar)}`,
      suggestedCategory: 'decision',
      suggestedDescription: `Behavior depends on environment variable import.meta.env.${envVar}`,
      confidence: 'medium',
      reason: `Environment-dependent code path via import.meta.env.${envVar}`,
    };
  }

  const envVar = match[1];
  const comparison = match[2];

  return {
    line: lineNumber,
    code: line.trim(),
    suggestedName: comparison
      ? `env-${toKebabCase(envVar)}-${comparison.toLowerCase()}`
      : `env-${toKebabCase(envVar)}`,
    suggestedCategory: 'decision',
    suggestedDescription: comparison
      ? `Behavior branches when process.env.${envVar} === "${comparison}"`
      : `Behavior depends on environment variable process.env.${envVar}`,
    confidence: 'medium',
    reason: comparison
      ? `Environment check: process.env.${envVar} compared to "${comparison}"`
      : `Environment variable access: process.env.${envVar}`,
  };
};

// --------------------------------------------------
// 6. Feature Flags
// --------------------------------------------------

const detectFeatureFlags: PatternDetector = (line, lineNumber) => {
  // Named flag variables: `featureEnabled = true`, `FF_DARK_MODE: true`
  const flagVarMatch = line.match(/(feature|flag|toggle|enabled?|disabled?)\w*\s*[:=]\s*/i);
  if (flagVarMatch) {
    const varName = extractVariableName(line);
    const keyword = flagVarMatch[1];
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: deriveName(varName, null, `feature-flag`, lineNumber),
      suggestedCategory: 'decision',
      suggestedDescription: `Feature flag or toggle ("${keyword}") — gates functionality behind a boolean`,
      confidence: 'medium',
      reason: `Feature flag keyword "${keyword}" found in assignment`,
    };
  }

  // Conditional flag checks: `if (config.enableX)`, `if (features.isEnabled(...))`
  const condFlagMatch = line.match(/if\s*\(\s*(?:config|features|flags)\.(\w+)\s*\)/);
  if (condFlagMatch) {
    const flagName = condFlagMatch[1];
    return {
      line: lineNumber,
      code: line.trim(),
      suggestedName: `flag-${toKebabCase(flagName)}`,
      suggestedCategory: 'decision',
      suggestedDescription: `Conditional check on flag "${flagName}" — controls a code path`,
      confidence: 'medium',
      reason: `Feature flag conditional: config/features/flags.${flagName}`,
    };
  }

  return null;
};

// --------------------------------------------------
// 7. Complex Regex Patterns
// --------------------------------------------------

const detectRegexPatterns: PatternDetector = (line, lineNumber) => {
  // Regex literals with significant complexity (20+ chars between delimiters)
  const match = line.match(/\/([^/]{20,})\/[gimsy]*/);
  if (!match) return null;

  // Skip if it looks like a file path or URL division
  const body = match[1];
  if (body.startsWith('/') || body.includes('http')) return null;

  const varName = extractVariableName(line);

  return {
    line: lineNumber,
    code: line.trim(),
    suggestedName: deriveName(varName, null, 'validation-regex', lineNumber),
    suggestedCategory: 'rule',
    suggestedDescription: `Complex regex pattern that may encode a business validation rule`,
    confidence: 'low',
    reason: `Regex with ${body.length} chars of pattern — may encode domain-specific validation logic`,
  };
};

// --------------------------------------------------
// 8. Conditional Business Logic
// --------------------------------------------------

const detectConditionalLogic: PatternDetector = (line, lineNumber) => {
  const match = line.match(/if\s*\([^)]*(?:===?|!==?)\s*['"]([^'"]{2,})['"]\s*\)/);
  if (!match) return null;

  const comparedValue = match[1];
  const varName = extractVariableName(line);

  return {
    line: lineNumber,
    code: line.trim(),
    suggestedName: deriveName(
      varName,
      comparedValue.length <= 20 ? comparedValue : null,
      'business-rule',
      lineNumber,
    ),
    suggestedCategory: 'rule',
    suggestedDescription: `Conditional branch comparing to "${comparedValue}" — may encode a business rule`,
    confidence: 'low',
    reason: `String comparison in conditional: value "${comparedValue}" suggests a domain-specific check`,
  };
};

// ============================================
// Pattern Registry
// ============================================

/**
 * Ordered list of pattern detectors. When multiple patterns match the same
 * line, the one with the highest confidence wins. In case of a tie, the
 * first match in this array wins (rate limits and time values are checked
 * before generic magic numbers).
 */
const DETECTORS: PatternDetector[] = [
  detectRateLimits,       // high confidence — check first
  detectTimeValues,       // high confidence
  detectEnvironmentChecks,
  detectFeatureFlags,
  detectHardcodedStrings,
  detectMagicNumbers,     // lower confidence — checked after specific patterns
  detectRegexPatterns,
  detectConditionalLogic,
];

/** Map confidence levels to a numeric rank for comparison */
const CONFIDENCE_RANK: Record<AspectSuggestion['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// ============================================
// Main Entry Point
// ============================================

/**
 * Scan a source file and suggest potential aspects (~) from heuristic patterns.
 *
 * Reads the file line-by-line, applying regex-based detectors for magic numbers,
 * hardcoded URLs, rate limits, time values, environment checks, feature flags,
 * complex regex patterns, and conditional business logic.
 *
 * Skips test files, comment-only lines, and import statements. When multiple
 * patterns match the same line, the highest-confidence match is kept.
 *
 * @param filePath - Absolute or relative path to the source file to scan
 * @returns Array of aspect suggestions sorted by line number
 */
export function suggestAspects(filePath: string): AspectSuggestion[] {
  // Skip test files entirely
  if (isTestFile(filePath)) {
    return [];
  }

  // Read file; return empty if it doesn't exist
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split('\n');

  // Map from line number to the best suggestion for that line
  const bestByLine = new Map<number, AspectSuggestion>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-indexed

    // Skip empty, comment, and import lines
    if (isCommentOrImport(line)) {
      continue;
    }

    // Run all detectors against this line
    for (const detect of DETECTORS) {
      const suggestion = detect(line, lineNumber, filePath);
      if (!suggestion) continue;

      const existing = bestByLine.get(lineNumber);
      if (!existing) {
        bestByLine.set(lineNumber, suggestion);
      } else if (CONFIDENCE_RANK[suggestion.confidence] > CONFIDENCE_RANK[existing.confidence]) {
        // Higher confidence wins
        bestByLine.set(lineNumber, suggestion);
      }
      // If same confidence, keep the first match (earlier in DETECTORS array)
    }
  }

  // Collect results sorted by line number
  const suggestions = Array.from(bestByLine.values());
  suggestions.sort((a, b) => a.line - b.line);

  return suggestions;
}
