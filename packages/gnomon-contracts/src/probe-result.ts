/**
 * probeResult:v1 — the shape every Gnomon M1.0 probe run produces
 * (spec §19.1 M1.0; research 29 §2). Mirrors schemas/probeResult.v1.schema.json;
 * test/probe-result.test.ts keeps the two in lockstep.
 *
 * Hard contract: additive changes or a version bump (spec §4 preamble).
 */

export const PROBE_RESULT_V1 = 'probeResult:v1' as const;

export const PROBE_VERDICTS = ['pass', 'fail', 'partial'] as const;
export type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

export const PROBE_OSES = ['darwin', 'win32', 'linux'] as const;
export type ProbeOs = (typeof PROBE_OSES)[number];

export const PROBE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface ProbeResultV1 {
  probe: string;
  os: ProbeOs;
  osVersion: string;
  arch: string;
  toolVersions: { node: string } & Record<string, string>;
  verdict: ProbeVerdict;
  evidence: Record<string, unknown>;
  specRefs: string[];
  /** ISO-8601 UTC timestamp. */
  at: string;
}

export const PROBE_RESULT_V1_KEYS = [
  'probe',
  'os',
  'osVersion',
  'arch',
  'toolVersions',
  'verdict',
  'evidence',
  'specRefs',
  'at',
] as const;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Zero-dependency structural validator for probeResult:v1. Returns the list of
 * problems (empty = valid). Kept hand-written so the contracts package stays at
 * zero runtime deps; it enforces the same rules as the JSON Schema.
 */
export function validateProbeResultV1(value: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(value)) return ['probeResult:v1 must be an object'];

  for (const key of Object.keys(value)) {
    if (!(PROBE_RESULT_V1_KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown property "${key}"`);
    }
  }
  for (const key of PROBE_RESULT_V1_KEYS) {
    if (!(key in value)) errors.push(`missing property "${key}"`);
  }

  const v = value;
  if ('probe' in v && (typeof v.probe !== 'string' || !PROBE_ID_PATTERN.test(v.probe))) {
    errors.push('probe must match ^[a-z0-9][a-z0-9-]*$');
  }
  if ('os' in v && !(PROBE_OSES as readonly unknown[]).includes(v.os)) {
    errors.push(`os must be one of ${PROBE_OSES.join('|')}`);
  }
  for (const key of ['osVersion', 'arch'] as const) {
    if (key in v && (typeof v[key] !== 'string' || (v[key] as string).length === 0)) {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if ('toolVersions' in v) {
    const tv = v.toolVersions;
    if (!isPlainObject(tv)) {
      errors.push('toolVersions must be an object');
    } else {
      if (!('node' in tv)) errors.push('toolVersions.node is required');
      for (const [k, ver] of Object.entries(tv)) {
        if (typeof ver !== 'string') errors.push(`toolVersions.${k} must be a string`);
      }
    }
  }
  if ('verdict' in v && !(PROBE_VERDICTS as readonly unknown[]).includes(v.verdict)) {
    errors.push(`verdict must be one of ${PROBE_VERDICTS.join('|')}`);
  }
  if ('evidence' in v && !isPlainObject(v.evidence)) {
    errors.push('evidence must be an object');
  }
  if ('specRefs' in v) {
    if (!Array.isArray(v.specRefs)) {
      errors.push('specRefs must be an array');
    } else if (v.specRefs.some((r) => typeof r !== 'string' || r.length === 0)) {
      errors.push('specRefs must contain non-empty strings');
    }
  }
  if ('at' in v && (typeof v.at !== 'string' || !ISO_DATE_TIME.test(v.at))) {
    errors.push('at must be an ISO-8601 date-time');
  }
  return errors;
}

export function isProbeResultV1(value: unknown): value is ProbeResultV1 {
  return validateProbeResultV1(value).length === 0;
}
