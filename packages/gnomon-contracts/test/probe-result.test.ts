import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PROBE_OSES,
  PROBE_RESULT_V1_KEYS,
  PROBE_VERDICTS,
  isProbeResultV1,
  validateProbeResultV1,
  type ProbeResultV1,
} from '../src/index.js';

const schemaPath = fileURLToPath(new URL('../schemas/probeResult.v1.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const good: ProbeResultV1 = {
  probe: 'p-harness',
  os: 'darwin',
  osVersion: '15.6',
  arch: 'arm64',
  toolVersions: { node: 'v24.0.0' },
  verdict: 'pass',
  evidence: { ok: true },
  specRefs: ['§19.1 M1.0'],
  at: '2026-10-17T12:00:00.000Z',
};

describe('probeResult:v1 schema ↔ TS validator lockstep', () => {
  it('schema is titled probeResult:v1 and closed', () => {
    expect(schema.title).toBe('probeResult:v1');
    expect(schema.additionalProperties).toBe(false);
  });

  it('schema required keys == validator keys', () => {
    expect([...schema.required].sort()).toEqual([...PROBE_RESULT_V1_KEYS].sort());
    expect(Object.keys(schema.properties).sort()).toEqual([...PROBE_RESULT_V1_KEYS].sort());
  });

  it('schema enums == TS enums', () => {
    expect(schema.properties.verdict.enum).toEqual([...PROBE_VERDICTS]);
    expect(schema.properties.os.enum).toEqual([...PROBE_OSES]);
  });
});

describe('validateProbeResultV1', () => {
  it('accepts a well-formed result', () => {
    expect(validateProbeResultV1(good)).toEqual([]);
    expect(isProbeResultV1(good)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isProbeResultV1(null)).toBe(false);
    expect(isProbeResultV1([])).toBe(false);
  });

  it('rejects missing and unknown properties', () => {
    const { at: _at, ...missing } = good;
    expect(validateProbeResultV1(missing)).toContain('missing property "at"');
    expect(validateProbeResultV1({ ...good, extra: 1 })).toContain('unknown property "extra"');
  });

  it.each([
    ['probe', '../escape'],
    ['os', 'freebsd'],
    ['osVersion', ''],
    ['verdict', 'maybe'],
    ['evidence', []],
    ['specRefs', ['']],
    ['at', 'yesterday'],
    ['toolVersions', { bun: '1.0' }],
  ])('rejects bad %s', (key, bad) => {
    expect(isProbeResultV1({ ...good, [key]: bad })).toBe(false);
  });
});
