/**
 * Tests for #classroom-metrics — the canonical repeat-failure-rate rollup.
 *
 * Guards the contract:
 *  1. no resolved certs (all pending / empty) → rate is null;
 *  2. some overturned → rate is overturned/resolved (3dp);
 *  3. per-agent split is independent of the overall rate;
 *  4. readers tolerate a missing ledger (yield [], never throw).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeRepeatFailureRate,
  readClassroomCertifications,
  type ClassroomCertRow,
} from './classroom-metrics.js';

function cert(
  agent: string,
  outcome: 'pending' | 'survived' | 'overturned',
  entryId = `e-${Math.random()}`,
): ClassroomCertRow {
  return { agent, entryId, outcome };
}

describe('computeRepeatFailureRate', () => {
  it('returns null overall + null per-agent rate when nothing has resolved', () => {
    const certs = [cert('builder', 'pending'), cert('builder', 'pending')];
    const r = computeRepeatFailureRate(certs);
    expect(r.overall).toBeNull();
    // pending-only agents contribute no resolved bucket at all
    expect(r.perAgent.builder).toBeUndefined();
  });

  it('returns null for the empty case', () => {
    const r = computeRepeatFailureRate([]);
    expect(r.overall).toBeNull();
    expect(r.perAgent).toEqual({});
  });

  it('computes overturned/resolved (pending excluded)', () => {
    // 1 overturned + 3 survived = 4 resolved → 1/4 = 0.25; 1 pending ignored.
    const certs = [
      cert('builder', 'overturned'),
      cert('builder', 'survived'),
      cert('builder', 'survived'),
      cert('builder', 'survived'),
      cert('builder', 'pending'),
    ];
    const r = computeRepeatFailureRate(certs);
    expect(r.overall).toBe(0.25);
    expect(r.perAgent.builder).toEqual({ resolved: 4, overturned: 1, rate: 0.25 });
  });

  it('splits per-agent independently of the overall rate', () => {
    const certs = [
      // builder: 2 overturned / 2 resolved = 1.0
      cert('builder', 'overturned'),
      cert('builder', 'overturned'),
      // aegis: 0 overturned / 2 resolved = 0.0
      cert('aegis', 'survived'),
      cert('aegis', 'survived'),
    ];
    const r = computeRepeatFailureRate(certs);
    // overall: 2 overturned / 4 resolved = 0.5
    expect(r.overall).toBe(0.5);
    expect(r.perAgent.builder.rate).toBe(1);
    expect(r.perAgent.aegis.rate).toBe(0);
    expect(r.perAgent.builder.resolved).toBe(2);
    expect(r.perAgent.aegis.overturned).toBe(0);
  });

  it('rounds to 3 decimal places', () => {
    // 1 overturned / 3 resolved = 0.333…
    const certs = [
      cert('x', 'overturned'),
      cert('x', 'survived'),
      cert('x', 'survived'),
    ];
    const r = computeRepeatFailureRate(certs);
    expect(r.overall).toBe(0.333);
  });

  it('ignores rows with no agent', () => {
    const certs = [
      { entryId: 'e1', outcome: 'overturned' } as unknown as ClassroomCertRow,
      cert('builder', 'survived'),
    ];
    const r = computeRepeatFailureRate(certs);
    // only the builder/survived row counts
    expect(r.overall).toBe(0);
    expect(Object.keys(r.perAgent)).toEqual(['builder']);
  });
});

describe('readClassroomCertifications', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-metrics-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('yields [] when the ledger does not exist (never throws)', () => {
    expect(readClassroomCertifications(tmp)).toEqual([]);
  });

  it('parses valid rows and skips corrupt lines', () => {
    const dir = path.join(tmp, '.paradigm', 'events');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'classroom-certifications.jsonl'),
      [
        JSON.stringify({ agent: 'builder', entryId: 'e1', outcome: 'overturned' }),
        'not json at all',
        JSON.stringify({ agent: 'builder', entryId: 'e2', outcome: 'survived' }),
      ].join('\n') + '\n',
      'utf8',
    );
    const rows = readClassroomCertifications(tmp);
    expect(rows).toHaveLength(2);
    const r = computeRepeatFailureRate(rows);
    expect(r.overall).toBe(0.5);
  });
});
