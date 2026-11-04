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
  meetsSurvivalFloor,
  isEvidencedSurvival,
  K_MIN_EXERCISE,
  MIN_ADVERSARIAL_PROBES,
  SURVIVAL_WINDOW_DAYS,
  certEvidenceState,
  NO_EXERCISE_WRITER_NOTICE,
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

describe('survival floor (TD-2026-07-01-401)', () => {
  const floor = { timesExercised: K_MIN_EXERCISE, adversarialProbes: MIN_ADVERSARIAL_PROBES, breakAttempts: 0 };

  it('meetsSurvivalFloor needs both the exercise count and an adversarial probe', () => {
    expect(meetsSurvivalFloor(floor)).toBe(true);
    expect(meetsSurvivalFloor({ ...floor, adversarialProbes: 0 })).toBe(false);
    expect(meetsSurvivalFloor({ ...floor, timesExercised: K_MIN_EXERCISE - 1 })).toBe(false);
    expect(meetsSurvivalFloor(undefined)).toBe(false);
    expect(meetsSurvivalFloor('nope')).toBe(false);
  });

  it('isEvidencedSurvival is false for an aged-only survived row', () => {
    expect(isEvidencedSurvival({ outcome: 'survived' })).toBe(false);
    expect(isEvidencedSurvival({ outcome: 'survived', exercise: floor })).toBe(true);
    expect(isEvidencedSurvival({ outcome: 'pending', exercise: floor })).toBe(false);
  });

  it('requireExercise counts unexercised survived rows as unproven, not resolved', () => {
    const certs: ClassroomCertRow[] = [
      cert('builder', 'overturned'),
      cert('builder', 'survived'), // legacy, aged-only
      { ...cert('builder', 'survived'), exercise: floor },
      cert('aegis', 'survived'), // legacy only
    ];
    const r = computeRepeatFailureRate(certs, { requireExercise: true });
    expect(r.perAgent.builder).toEqual({ resolved: 2, overturned: 1, rate: 0.5, unproven: 1 });
    expect(r.perAgent.aegis).toEqual({ resolved: 0, overturned: 0, rate: null, unproven: 1 });
    expect(r.overall).toBe(0.5);
    expect(r.unproven).toBe(2);
  });

  it('default formula is unchanged (legacy callers)', () => {
    const r = computeRepeatFailureRate([cert('x', 'survived'), cert('x', 'overturned')]);
    expect(r.overall).toBe(0.5);
    expect(r.unproven).toBeUndefined();
    expect(r.perAgent.x).toEqual({ resolved: 2, overturned: 1, rate: 0.5 });
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

describe('certEvidenceState (shared read-time rule)', () => {
  const now = Date.parse('2026-11-03T00:00:00.000Z');
  const ago = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();
  const floor = { timesExercised: 2, adversarialProbes: 1, breakAttempts: 0 };

  it('overturned, evidenced survived, legacy aged-only survived (unproven), pending, aged pending (unproven)', () => {
    expect(certEvidenceState({ outcome: 'overturned', ts: ago(1) }, { now })).toBe('overturned');
    expect(certEvidenceState({ outcome: 'survived', ts: ago(1), exercise: floor }, { now })).toBe('survived');
    expect(certEvidenceState({ outcome: 'survived', ts: ago(40) }, { now })).toBe('unproven');
    expect(certEvidenceState({ outcome: 'pending', ts: ago(1) }, { now })).toBe('pending');
    expect(certEvidenceState({ outcome: 'pending', ts: ago(SURVIVAL_WINDOW_DAYS) }, { now })).toBe('unproven');
    expect(certEvidenceState({ outcome: 'pending', ts: 'garbage' }, { now })).toBe('pending');
    expect(certEvidenceState({ outcome: 'pending', ts: ago(3) }, { now, survivalWindowDays: 2 })).toBe('unproven');
  });

  it('the empty-exercises notice says plainly that no cert can survive', () => {
    expect(NO_EXERCISE_WRITER_NOTICE).toMatch(/no exercise events recorded yet \(spec sub-phase 1\): no cert can survive/);
  });
});
