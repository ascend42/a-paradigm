/**
 * Tool Definition Helpers — shared utilities for defining MCP tools
 *
 * Reduces boilerplate in tool module files. Tool modules can optionally
 * adopt these helpers; they are not required for backward compatibility.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';

// ────────────────────────────────────────────────────────
// Tool definition helper
// ────────────────────────────────────────────────────────

/**
 * Define an MCP tool with sensible defaults.
 *
 * @param name - Tool name (e.g., 'paradigm_lore_search')
 * @param description - Human-readable description with token estimate
 * @param schema - JSON Schema properties and required fields
 * @param annotations - MCP safety annotations (defaults to read-only, non-destructive)
 */
export function defineTool(
  name: string,
  description: string,
  schema: { properties?: Record<string, unknown>; required?: string[] },
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean },
) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      ...schema,
    },
    annotations: annotations ?? { readOnlyHint: true, destructiveHint: false },
  };
}

// ────────────────────────────────────────────────────────
// Result formatting
// ────────────────────────────────────────────────────────

/**
 * Format a tool result into the { handled, text } shape expected by dispatchers.
 *
 * @param data - The response payload (string or JSON-serializable object)
 * @param error - If provided, returns an error result instead
 */
export function formatToolResult(
  data: unknown,
  error?: string,
): { handled: true; text: string } {
  if (error) {
    return { handled: true, text: `Error: ${error}` };
  }
  return {
    handled: true,
    text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  };
}

// ────────────────────────────────────────────────────────
// YAML file loading
// ────────────────────────────────────────────────────────

/**
 * Safely load and parse a YAML file. Returns null if the file does not exist
 * or cannot be parsed.
 *
 * @param filePath - Absolute path to the YAML file
 */
export function loadYamlFile<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as T;
  } catch {
    return null;
  }
}
