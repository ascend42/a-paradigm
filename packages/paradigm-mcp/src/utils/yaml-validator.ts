/**
 * yaml-validator — fail-closed wrapper for YAML file reads
 *
 * Returns a discriminated union so callers cannot silently conflate "file
 * missing" with "file unparseable". Designed specifically for portal-adjacent
 * reads where a parse failure must block (not fall through).
 *
 * Security contract:
 *   - The `detail` string on `unparseable` is a short, classifier-style string.
 *   - It MUST NOT contain raw file contents, gate names, route paths, or the
 *     YAML exception's `mark` context (js-yaml's default toString includes
 *     2-3 lines around the error position — that context is the primary leak
 *     vector per the 2026-04-22 security audit).
 *   - Full line-local diagnostic info is reserved for local tools that run
 *     in the user's terminal (e.g. `paradigm doctor`), where the file is
 *     already on disk.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import type { ZodSchema } from 'zod';

export type YamlErrorClass = 'duplicate-key' | 'syntax' | 'other';

export type LoadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'missing' }
  | { status: 'unparseable'; errorClass: YamlErrorClass; detail: string }
  | { status: 'invalid'; errorClass: 'schema'; detail: string };

/**
 * Classify a js-yaml exception into one of our safe categories.
 *
 * We inspect only `reason` / `name` fields — never `mark.buffer` or the
 * formatted toString(), both of which leak file contents.
 */
export function classifyYamlError(err: unknown): { errorClass: YamlErrorClass; detail: string } {
  if (err instanceof yaml.YAMLException) {
    const reason = (err.reason || '').toLowerCase();
    if (reason.includes('duplicated mapping key') || reason.includes('duplicate mapping key')) {
      return { errorClass: 'duplicate-key', detail: 'duplicate mapping key' };
    }
    // Other YAMLException reasons we recognize as syntax errors
    const syntaxReasons = [
      'unexpected',
      'expected',
      'bad indentation',
      'mapping values',
      'cannot read a block mapping entry',
      'end of the stream',
      'while scanning',
      'while parsing',
    ];
    if (syntaxReasons.some(r => reason.includes(r))) {
      return { errorClass: 'syntax', detail: 'yaml syntax error' };
    }
    return { errorClass: 'other', detail: 'yaml parse error' };
  }
  return { errorClass: 'other', detail: 'yaml parse error' };
}

/**
 * Safely load a YAML file and return a discriminated union indicating
 * missing / unparseable / invalid / ok. The caller MUST switch exhaustively
 * on `status`.
 *
 * @param filePath Absolute path to the YAML file
 * @param opts Optional zod schema for post-parse validation
 */
export function safeLoad<T>(
  filePath: string,
  opts?: { schema?: ZodSchema<T> },
): LoadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { status: 'missing' };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Treat read errors as "other" parse failure. Do not echo error message
    // as it may include the file path plus OS strings.
    return { status: 'unparseable', errorClass: 'other', detail: 'file read error' };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    const { errorClass, detail } = classifyYamlError(err);
    return { status: 'unparseable', errorClass, detail };
  }

  if (opts?.schema) {
    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      // zod error messages may mention field paths — those are schema keys,
      // not gate/route content, so we include a generic count-only message.
      return {
        status: 'invalid',
        errorClass: 'schema',
        detail: `schema validation failed (${result.error.issues.length} issue(s))`,
      };
    }
    return { status: 'ok', data: result.data };
  }

  return { status: 'ok', data: parsed as T };
}

/**
 * Convenience: map an unparseable/invalid result to a safe public message.
 * Never includes file contents or identifiers — safe for logs, stderr, and
 * LLM context windows.
 */
export function formatLoadFailure(result: Exclude<LoadResult<unknown>, { status: 'ok' } | { status: 'missing' }>): string {
  switch (result.errorClass) {
    case 'duplicate-key':
      return "portal.yaml unparseable: duplicate mapping key detected — run 'paradigm doctor' for details";
    case 'syntax':
      return "portal.yaml unparseable: YAML syntax error — run 'paradigm doctor' for details";
    case 'schema':
      return "portal.yaml invalid: schema validation failed — run 'paradigm doctor' for details";
    case 'other':
    default:
      return "portal.yaml unparseable — run 'paradigm doctor' for details";
  }
}
