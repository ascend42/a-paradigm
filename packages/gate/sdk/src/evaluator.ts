/**
 * Safe expression evaluator for Gate key expressions
 *
 * Uses a restricted subset of JavaScript for security.
 */

import { Parser } from 'expr-eval';

// Create a parser instance with safe defaults
const parser = new Parser({
  operators: {
    // Enable comparison operators
    comparison: true,
    // Enable logical operators
    logical: true,
    // Enable 'in' operator
    in: true,
    // Disable assignment for safety
    assignment: false,
  },
});

// Type for expr-eval functions
type ExprFunction = (...args: unknown[]) => unknown;

// Add common helper functions
(parser.functions as Record<string, ExprFunction>).includes = (arr: unknown, value: unknown) => {
  if (Array.isArray(arr)) {
    return arr.includes(value);
  }
  if (typeof arr === 'string') {
    return arr.includes(String(value));
  }
  return false;
};

(parser.functions as Record<string, ExprFunction>).length = (arr: unknown) => {
  if (Array.isArray(arr) || typeof arr === 'string') {
    return (arr as unknown[] | string).length;
  }
  return 0;
};

(parser.functions as Record<string, ExprFunction>).exists = (value: unknown) => {
  return value !== null && value !== undefined;
};

(parser.functions as Record<string, ExprFunction>).isEmpty = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
};

(parser.functions as Record<string, ExprFunction>).startsWith = (str: unknown, prefix: unknown) => {
  if (typeof str === 'string' && typeof prefix === 'string') {
    return str.startsWith(prefix);
  }
  return false;
};

(parser.functions as Record<string, ExprFunction>).endsWith = (str: unknown, suffix: unknown) => {
  if (typeof str === 'string' && typeof suffix === 'string') {
    return str.endsWith(suffix);
  }
  return false;
};

(parser.functions as Record<string, ExprFunction>).matches = (str: unknown, pattern: unknown) => {
  if (typeof str === 'string' && typeof pattern === 'string') {
    try {
      return new RegExp(pattern).test(str);
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Evaluate a key expression against an entity context
 */
export function evaluateExpression(
  expression: string,
  context: Record<string, unknown>
): { passed: boolean; error?: string } {
  try {
    // Convert JavaScript-style expressions to expr-eval compatible format
    let normalizedExpr = expression
      // Handle === (strict equality)
      .replace(/===/g, '==')
      // Handle !== (strict inequality)
      .replace(/!==/g, '!=')
      // Handle array.includes() method
      .replace(/(\w+)\.includes\(([^)]+)\)/g, 'includes($1, $2)')
      // Handle string.startsWith() method
      .replace(/(\w+)\.startsWith\(([^)]+)\)/g, 'startsWith($1, $2)')
      // Handle string.endsWith() method
      .replace(/(\w+)\.endsWith\(([^)]+)\)/g, 'endsWith($1, $2)');

    // Handle .length property access
    normalizedExpr = normalizedExpr.replace(/(\w+(?:\.\w+)*)\.length/g, 'length($1)');

    // Create a flattened context for expr-eval
    const flatContext = flattenContext(context);

    // Parse and evaluate
    const expr = parser.parse(normalizedExpr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = expr.evaluate(flatContext as any);

    return {
      passed: Boolean(result),
    };
  } catch (error: unknown) {
    return {
      passed: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Flatten nested object paths for expr-eval
 * e.g., { user: { role: 'admin' } } -> { 'user.role': 'admin', user: { role: 'admin' } }
 */
function flattenContext(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;

    // Keep the original nested structure
    result[key] = value;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively flatten nested objects
      const nested = flattenContext(value as Record<string, unknown>, fullKey);
      Object.assign(result, nested);
    }
  }

  return result;
}

/**
 * Create a context object from entity data
 * This normalizes the entity for expression evaluation
 */
export function createExpressionContext(entity: Record<string, unknown>): Record<string, unknown> {
  return flattenContext(entity);
}
