/**
 * Tests for #memory-steward-score (Memory Steward A1).
 *
 * Pure functions — no I/O. We synthesize ParsedMemoryEntry fixtures with a fixed
 * `now` so age math is deterministic.
 */

import { describe, it, expect } from 'vitest';
import type { ParsedMemoryEntry, MemoryEntryType } from '@a-company/premise-core';
import { scoreEntry, deriveFinding } from './score.js';

const NOW = Date.UTC(2026, 8, 19); // 2026-09-19
const DAY = 24 * 60 * 60 * 1000;

function entry(overrides: Partial<ParsedMemoryEntry> = {}): ParsedMemoryEntry {
  return {
    file: '/home/u/.claude/projects/-p/memory/x.md',
    kind: 'entry',
    name: 'x',
    description: 'd',
    type: 'reference' as MemoryEntryType,
    body: 'body',
    mtimeMs: NOW,
    symbolMentions: [],
    fileMentions: [],
    graphValidity: { deadSymbols: [], deadFiles: [], verdict: 'valid' },
    ...overrides,
  };
}

describe('scoreEntry', () => {
  it('a fresh, valid, durable entry scores near 0', () => {
    const s = scoreEntry(entry({ type: 'reference', mtimeMs: NOW }), { now: NOW });
    expect(s.ageDays).toBeCloseTo(0, 5);
    expect(s.graphPenalty).toBe(0);
    expect(s.score).toBeLessThan(0.05);
  });

  it('a provably-stale entry scores high regardless of age', () => {
    const s = scoreEntry(
      entry({ mtimeMs: NOW, graphValidity: { deadSymbols: ['#g'], deadFiles: ['a/b.ts'], verdict: 'provably-stale' } }),
      { now: NOW },
    );
    // graph penalty 1.0 * 0.6 weight = at least 0.6
    expect(s.graphPenalty).toBe(1.0);
    expect(s.score).toBeGreaterThanOrEqual(0.6);
  });

  it('project (fast-decay) ages faster than reference (slow-decay) at the same age', () => {
    const old = NOW - 90 * DAY;
    const proj = scoreEntry(entry({ type: 'project', mtimeMs: old }), { now: NOW });
    const ref = scoreEntry(entry({ type: 'reference', mtimeMs: old }), { now: NOW });
    expect(proj.typeDecayWeight).toBeGreaterThan(ref.typeDecayWeight);
    expect(proj.score).toBeGreaterThan(ref.score);
  });

  it('score is clamped to 0..1', () => {
    const s = scoreEntry(
      entry({ type: 'project', mtimeMs: NOW - 10000 * DAY, graphValidity: { deadSymbols: ['#g'], deadFiles: [], verdict: 'provably-stale' } }),
      { now: NOW },
    );
    expect(s.score).toBeLessThanOrEqual(1);
    expect(s.score).toBeGreaterThanOrEqual(0);
  });
});

describe('deriveFinding', () => {
  it('provably-stale status type → prune, target carries first dead symbol', () => {
    const s = scoreEntry(
      entry({ type: 'project', graphValidity: { deadSymbols: ['#ghost'], deadFiles: ['x.ts'], verdict: 'provably-stale' } }),
      { now: NOW },
    );
    const f = deriveFinding(s, { now: NOW })!;
    expect(f.suggestion).toBe('prune');
    expect(f.target.symbol).toBe('#ghost');
    expect(new Date(f.expiresAt).getTime()).toBeGreaterThan(NOW);
  });

  it('provably-stale DURABLE type (feedback) does NOT prune — routes for a reference update instead', () => {
    const s = scoreEntry(
      entry({ type: 'feedback', graphValidity: { deadSymbols: ['#ghost'], deadFiles: [], verdict: 'provably-stale' } }),
      { now: NOW },
    );
    const f = deriveFinding(s, { now: NOW })!;
    expect(f.suggestion).not.toBe('prune');
    expect(f.suggestion).toBe('route:habits');
  });

  it('feedback → route:habits', () => {
    const f = deriveFinding(scoreEntry(entry({ type: 'feedback' }), { now: NOW }), { now: NOW })!;
    expect(f.suggestion).toBe('route:habits');
  });

  it('project → route:task', () => {
    const f = deriveFinding(scoreEntry(entry({ type: 'project' }), { now: NOW }), { now: NOW })!;
    expect(f.suggestion).toBe('route:task');
  });

  it('reference citing a decision → route:decisions', () => {
    const f = deriveFinding(
      scoreEntry(entry({ type: 'reference', body: 'per TD-2026-09-19-110 we do X' }), { now: NOW }),
      { now: NOW },
    )!;
    expect(f.suggestion).toBe('route:decisions');
  });

  it('near-duplicate (clusterId set) → merge, before type routing', () => {
    const s = scoreEntry(entry({ type: 'feedback' }), { now: NOW });
    s.clusterId = 'dup:a.md';
    const f = deriveFinding(s, { now: NOW })!;
    expect(f.suggestion).toBe('merge');
  });

  it('fresh durable valid reference → pin', () => {
    const f = deriveFinding(scoreEntry(entry({ type: 'user', mtimeMs: NOW }), { now: NOW }), { now: NOW })!;
    expect(f.suggestion).toBe('pin');
  });

  it('no confident suggestion → null (an aging-but-valid untyped index)', () => {
    const s = scoreEntry(entry({ type: 'unknown', kind: 'index', mtimeMs: NOW - 30 * DAY }), { now: NOW });
    expect(deriveFinding(s, { now: NOW })).toBeNull();
  });
});
