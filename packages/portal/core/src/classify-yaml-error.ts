/**
 * classify-yaml-error — shared redacted classifier for js-yaml exceptions.
 *
 * Extracted in v5.38.0 from duplicated copies in paradigm-mcp's yaml-validator
 * and paradigm CLI's portal-compliance. Single source of truth so the stop-hook
 * path (paradigm CLI) and MCP tool path never disagree on how a YAMLException
 * classifies.
 *
 * Security contract (carried over from v5.37.12):
 *   - Inspects only `err.reason` / `err.name` — never `err.message`,
 *     `err.toString()`, or `err.mark.buffer`.
 *   - Returned `detail` is a fixed classifier string safe for logs, stderr,
 *     LLM context windows, and telemetry.
 *   - Callers rendering line-specific diagnostics should do so locally via
 *     `paradigm doctor`, where the file is already on disk.
 */

import * as yaml from 'js-yaml';

export type YamlErrorClass = 'duplicate-key' | 'syntax' | 'other';

/**
 * Classify a js-yaml exception into one of our safe categories.
 */
export function classifyYamlError(err: unknown): { errorClass: YamlErrorClass; detail: string } {
  if (err instanceof yaml.YAMLException) {
    const reason = (err.reason || '').toLowerCase();
    if (reason.includes('duplicated mapping key') || reason.includes('duplicate mapping key')) {
      return { errorClass: 'duplicate-key', detail: 'duplicate mapping key' };
    }
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
