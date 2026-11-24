/**
 * @symbol #loop-check
 *
 * The evidence secret scanner (docs/specs/gnomon-loops.md §4 "Evidence", G-LOOP-27): check evidence is scanned
 * and redacted BEFORE it is stored, so no later escalation prompt or `log.read` can carry a planted credential.
 * Small and regex-based on purpose (zero dependencies): AWS access keys and secret assignments, GitHub tokens,
 * PEM private key blocks (also a block cut by the tail window), JWTs, npm, Stripe (sk_/rk_/pk_ live|test), GitLab
 * (glpat-), Slack, Anthropic, OpenAI and Google keys, passwords in URLs (scheme://user:pass@), bearer headers and generic `api_key=` / `secret:` / `token=` / `password=` assignments. A match is replaced by
 * `[REDACTED:<kind>]`; only kinds and counts are reported, never the matched text. Over-redaction is accepted.
 *
 * TD-2026-10-23-268 (Aegis F2): `literals` are the values a loop handed its children (from its env files, re-resolved
 * by the kernel, never stored). Each value of LITERAL_MIN_CHARS or more, and its URL-encoded form, is replaced FIRST by
 * `[REDACTED:env:<NAME>]` (kind `env:<NAME>`), whatever its shape.
 */
import { compileSecretRules } from '@a-company/gnomon-contracts';

/** A literal shorter than this is not redacted (it would shred ordinary text). */
export const LITERAL_MIN_CHARS = 6;

export interface Redaction {
  kind: string;
  count: number;
}

export interface ScanResult {
  text: string;
  redactions: Redaction[];
}

interface Rule {
  kind: string;
  re: RegExp;
  /** replace only this capture group (the value), keeping the key visible */
  group?: number;
}

/** Built from the ONE pattern table in `@a-company/gnomon-contracts` (`secret-rules.ts`, S1.2 ruling O4). */
const RULES: readonly Rule[] = compileSecretRules();

/** Replace every literal value (and its URL-encoded form) by `[REDACTED:env:NAME]`; counts per kind. */
export function redactLiterals(text: string, literals: ReadonlyArray<{ name: string; value: string }>, counts: Map<string, number> = new Map()): { text: string; counts: Map<string, number> } {
  const forms: Array<{ kind: string; form: string }> = [];
  for (const l of literals) {
    if (typeof l.value !== 'string' || l.value.length < LITERAL_MIN_CHARS) continue;
    forms.push({ kind: `env:${l.name}`, form: l.value });
    const enc = encodeURIComponent(l.value);
    if (enc !== l.value) forms.push({ kind: `env:${l.name}`, form: enc });
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  let out = text;
  for (const f of forms) {
    const parts = out.split(f.form);
    if (parts.length > 1) {
      counts.set(f.kind, (counts.get(f.kind) ?? 0) + parts.length - 1);
      out = parts.join(`[REDACTED:${f.kind}]`);
    }
  }
  return { text: out, counts };
}

/** Redact the loop's literal values (when given), then every secret-shaped match in `text`. */
export function scanSecrets(text: string, literals: ReadonlyArray<{ name: string; value: string }> = []): ScanResult {
  const counts = new Map<string, number>();
  let out = literals.length ? redactLiterals(text, literals, counts).text : text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...m: unknown[]) => {
      const whole = m[0] as string;
      if (whole.startsWith('[REDACTED:')) return whole;
      if (rule.group !== undefined) {
        const value = m[rule.group] as string | undefined;
        if (!value || value.startsWith('[REDACTED:')) return whole;
        counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
        const end = m.findIndex((x, i) => i > 0 && typeof x === 'number'); // the offset follows the capture groups
        const groups = m.slice(1, end) as Array<string | undefined>;
        return groups.map((g, i) => (i + 1 === rule.group ? `[REDACTED:${rule.kind}]` : g ?? '')).join('');
      }
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
      return `[REDACTED:${rule.kind}]`;
    });
  }
  return { text: out, redactions: [...counts].map(([kind, count]) => ({ kind, count })) };
}
