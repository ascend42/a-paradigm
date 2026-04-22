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
import { classifyYamlError as sharedClassifyYamlError, type YamlErrorClass } from '@a-company/portal-core';
import { isStrictMode } from './strict-mode.js';

export type { YamlErrorClass } from '@a-company/portal-core';

export type LoadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'missing' }
  | { status: 'unparseable'; errorClass: YamlErrorClass; detail: string }
  | { status: 'invalid'; errorClass: 'schema'; detail: string };

/**
 * Classify a js-yaml exception into one of our safe categories.
 *
 * v5.38.0: delegates to `@a-company/portal-core` for a single source of truth
 * across paradigm-mcp (this file) and paradigm CLI (`portal-compliance.ts`).
 * Re-exported here for backward compatibility with existing imports.
 */
export function classifyYamlError(err: unknown): { errorClass: YamlErrorClass; detail: string } {
  return sharedClassifyYamlError(err);
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
  opts?: { schema?: ZodSchema<T>; strict?: boolean },
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
    const result: LoadResult<T> = { status: 'unparseable', errorClass: 'other', detail: 'file read error' };
    return enforceStrict(result, opts);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    const { errorClass, detail } = classifyYamlError(err);
    const result: LoadResult<T> = { status: 'unparseable', errorClass, detail };
    return enforceStrict(result, opts);
  }

  if (opts?.schema) {
    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      // zod error messages may mention field paths — those are schema keys,
      // not gate/route content, so we include a generic count-only message.
      const failure: LoadResult<T> = {
        status: 'invalid',
        errorClass: 'schema',
        detail: `schema validation failed (${result.error.issues.length} issue(s))`,
      };
      return enforceStrict(failure, opts);
    }
    return { status: 'ok', data: result.data };
  }

  return { status: 'ok', data: parsed as T };
}

/**
 * In strict mode (PARADIGM_STRICT=1 or `opts.strict === true`), throw on
 * any non-ok, non-missing status — including the `other` errorClass which
 * non-strict mode classifies as a parse-failure union variant. Missing
 * files are NOT fatal (a missing file is a legitimate state).
 *
 * Never include file contents, gate names, or route paths in the thrown
 * message — only classifier strings.
 */
function enforceStrict<T>(
  result: LoadResult<T>,
  opts?: { strict?: boolean },
): LoadResult<T> {
  const strict = opts?.strict ?? isStrictMode();
  if (!strict) return result;
  if (result.status === 'ok' || result.status === 'missing') return result;
  // Classifier-only message
  throw new Error(
    `yaml load failed under PARADIGM_STRICT=1 (${result.errorClass}: ${result.detail})`,
  );
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
