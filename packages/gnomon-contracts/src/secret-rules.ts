/**
 * @symbol #contract-secret-rules
 *
 * The secret pattern table, as data (S1.2, ruling O4). ONE table: the kernel's evidence scanner
 * (`gnomon/src/kernel/loops/secret-scan.ts`, G-LOOP-27) builds its redacting regexes from it, and the dimension
 * write validator (`dim.ts`) builds its detecting ones. It is not an input of the client API descriptor: a new
 * rule never moves `clientApiId`.
 *
 * Each rule is a regex `source` plus `flags` (every rule is global). `group` names the capture group that holds
 * the value when the rule also matches a visible key (`api_key=<value>`); without it the whole match is the value.
 * Order matters to a redactor (earlier rules replace first), so the list is ordered and frozen.
 *
 * Pure data and pure functions: no DOM, no node:*.
 */
import { deepFreeze } from './internal.js';

export interface SecretRule {
  /** the only thing ever reported about a match; never the matched text */
  kind: string;
  source: string;
  flags: string;
  /** replace or report only this capture group (the value), keeping the key visible */
  group?: number;
}

export const SECRET_RULES: readonly SecretRule[] = deepFreeze([
  { kind: 'private-key', source: String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)`, flags: 'g' },
  // a block whose BEGIN line fell outside a tail window: everything up to its END line
  { kind: 'private-key', source: String.raw`^[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----`, flags: 'g' },
  { kind: 'aws-access-key', source: String.raw`\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b`, flags: 'g' },
  { kind: 'aws-secret', source: String.raw`(aws_?secret_?access_?key|aws_?session_?token)(["']?\s*[:=]\s*["']?)([A-Za-z0-9/+=]{16,})`, flags: 'gi', group: 3 },
  { kind: 'github-token', source: String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b`, flags: 'g' },
  { kind: 'slack-token', source: String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}\b`, flags: 'g' },
  { kind: 'anthropic-key', source: String.raw`\bsk-ant-[A-Za-z0-9_-]{20,}\b`, flags: 'g' },
  { kind: 'openai-key', source: String.raw`\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b`, flags: 'g' },
  { kind: 'jwt', source: String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`, flags: 'g' },
  { kind: 'npm-token', source: String.raw`\bnpm_[A-Za-z0-9]{36}\b`, flags: 'g' },
  { kind: 'stripe-key', source: String.raw`\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b`, flags: 'g' },
  { kind: 'gitlab-token', source: String.raw`\bglpat-[A-Za-z0-9_-]{20,}\b`, flags: 'g' },
  { kind: 'url-password', source: String.raw`(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)`, flags: 'gi', group: 2 },
  { kind: 'google-api-key', source: String.raw`\bAIza[0-9A-Za-z_-]{35}\b`, flags: 'g' },
  { kind: 'bearer', source: String.raw`(\bAuthorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{8,})`, flags: 'gi', group: 2 },
  { kind: 'generic-secret', source: String.raw`(\b[A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|passwd|credential)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;]{8,})`, flags: 'gi', group: 3 },
]);

/** Every rule kind once, in table order. */
export const SECRET_RULE_KINDS: readonly string[] = Object.freeze([...new Set(SECRET_RULES.map((r) => r.kind))]);

/** Fresh regexes for the table (a global regex carries `lastIndex`, so callers that keep state build their own). */
export function compileSecretRules(): Array<{ kind: string; re: RegExp; group?: number }> {
  return SECRET_RULES.map((r) => ({ kind: r.kind, re: new RegExp(r.source, r.flags), ...(r.group !== undefined ? { group: r.group } : {}) }));
}

let compiled: Array<{ kind: string; re: RegExp; group?: number }> | undefined;

/**
 * The rule kinds that match `text`, each once, in table order. Detection only: nothing is redacted and the
 * matched text is never returned.
 */
export function secretKindsIn(text: string): string[] {
  compiled ??= compileSecretRules();
  const out: string[] = [];
  for (const r of compiled) {
    r.re.lastIndex = 0;
    if (r.re.test(text) && !out.includes(r.kind)) out.push(r.kind);
  }
  return out;
}
