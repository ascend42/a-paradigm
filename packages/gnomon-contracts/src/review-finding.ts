/**
 * review-finding:v1 (spec §4.11, §7.3 convergence; A35-05, S35-10,
 * P8-D86–D88) and the `contract.claim{responses}` answer shape. Reserved in
 * M1.1 so `clientApiId` does not move in Move 2 (M2.10 uses it).
 *
 * `severity: pre-existing` is set by the KERNEL (never by the reviewer);
 * `fingerprint` = sha256(class ‖ (symbol ?? path) ‖ overlapping line range).
 * `instances[]` lists the other places the same class of bug occurs.
 * Severity and response values are ADDITIVE with fail-safe semantics
 * (orchestrator ruling, round 2): an unknown severity reads as `important`
 * (it blocks like one); an unknown response reads as no answer, so the finding
 * stays open (`failSafeFindingResponse` ⇒ undefined).
 */

import { Checker, SHA256_TAGGED, type ValidateOptions } from './internal.js';

export const REVIEW_FINDING_V1 = 'review-finding:v1' as const;

export const FINDING_SEVERITIES = ['important', 'nit', 'pre-existing'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
/** contract.claim `responses[].response` (§4.11, §5 verb 10). */
export const FINDING_RESPONSES = ['fixed', 'wrong', 'intentional', 'immaterial'] as const;
export type FindingResponse = (typeof FINDING_RESPONSES)[number];

export function failSafeFindingSeverity(s: unknown): FindingSeverity {
  return (FINDING_SEVERITIES as readonly unknown[]).includes(s) ? (s as FindingSeverity) : 'important';
}
/** Unknown response ⇒ undefined: not an answer, the finding stays open. */
export function failSafeFindingResponse(r: unknown): FindingResponse | undefined {
  return (FINDING_RESPONSES as readonly unknown[]).includes(r) ? (r as FindingResponse) : undefined;
}

/**
 * `lines` is a 1-based line or inclusive range, "12" or "12-30". The spec names
 * the field without a grammar; this is the narrowest form the fingerprint's
 * "overlapping line range" needs (judgment call, recorded in .purpose).
 */
export const LINE_RANGE_PATTERN = /^[1-9][0-9]*(-[1-9][0-9]*)?$/;

export interface FindingLocus {
  path: string;
  lines?: string;
  symbol?: string;
}

export interface ReviewFindingV1 {
  fid: string;
  round: number;
  class: string;
  severity: FindingSeverity;
  locus: FindingLocus;
  instances: FindingLocus[];
  claim: string;
  fingerprint: string;
}

export interface FindingResponseEntry {
  fid: string;
  response: FindingResponse;
  note?: string;
}

export const REVIEW_FINDING_V1_KEYS = ['fid', 'round', 'class', 'severity', 'locus', 'instances', 'claim', 'fingerprint'] as const;
export const FINDING_LOCUS_KEYS = ['path', 'lines', 'symbol'] as const;
export const FINDING_RESPONSE_KEYS = ['fid', 'response', 'note'] as const;

function locus(c: Checker, path: string, v: unknown): void {
  if (!c.obj(path, v)) return;
  c.closed(path, v, FINDING_LOCUS_KEYS);
  c.required(path, v, ['path']);
  if ('path' in v) c.str(`${path}.path`, v.path, /^.+$/, 'a non-empty path');
  if ('lines' in v) c.str(`${path}.lines`, v.lines, LINE_RANGE_PATTERN, '"<n>" or "<from>-<to>"');
  if ('symbol' in v) c.str(`${path}.symbol`, v.symbol, /^.+$/, 'a non-empty symbol');
  if (typeof v.lines === 'string' && LINE_RANGE_PATTERN.test(v.lines)) {
    const [from, to] = v.lines.split('-').map(Number);
    if (to !== undefined && to < from!) c.fail(`${path}.lines`, 'range end must be >= start');
  }
}

export function validateReviewFindingV1(value: unknown, opts: ValidateOptions = {}): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, REVIEW_FINDING_V1_KEYS);
  c.required('', v, REVIEW_FINDING_V1_KEYS);
  if ('fid' in v) c.str('fid', v.fid, /^.+$/, 'a non-empty id');
  if ('round' in v) c.int('round', v.round, 1);
  if ('class' in v) c.str('class', v.class, /^.+$/, 'a non-empty bug class');
  if ('severity' in v) c.additiveEnum('severity', v.severity, FINDING_SEVERITIES);
  if ('locus' in v) locus(c, 'locus', v.locus);
  if ('instances' in v && c.arr('instances', v.instances)) v.instances.forEach((u, i) => locus(c, `instances[${i}]`, u));
  if ('claim' in v) c.str('claim', v.claim);
  if ('fingerprint' in v) c.str('fingerprint', v.fingerprint, SHA256_TAGGED, 'sha256:<hex>');
  return c.errors;
}

export function isReviewFindingV1(value: unknown, opts: ValidateOptions = {}): value is ReviewFindingV1 {
  return validateReviewFindingV1(value, opts).length === 0;
}

/** contract.claim `responses` (§4.11): answers to open findings. */
export function validateFindingResponses(value: unknown, opts: ValidateOptions = {}): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.arr('', value)) return c.errors;
  value.forEach((r, i) => {
    const p = `[${i}]`;
    if (!c.obj(p, r)) return;
    c.closed(p, r, FINDING_RESPONSE_KEYS);
    c.required(p, r, ['fid', 'response']);
    if ('fid' in r) c.str(`${p}.fid`, r.fid, /^.+$/, 'a non-empty id');
    if ('response' in r) c.additiveEnum(`${p}.response`, r.response, FINDING_RESPONSES);
    if ('note' in r) c.str(`${p}.note`, r.note);
  });
  return c.errors;
}
