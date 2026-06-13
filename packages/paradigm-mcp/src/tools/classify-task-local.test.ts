/**
 * Tests for classifyTaskLocal — T-002 classifier.
 *
 * The classifier scores task-family keyword hits × per-family weight, lets a
 * leading intent verb (audit/analyze/design/research/document) hard-gate the
 * task into a read-only-analyst family (flooring confidence at 0.7), and maps
 * read-only families to analyst rosters with NO builder/security. It returns
 * `{ type, confidence, alternativeType?, overrideHint }`.
 *
 * The headline guard is the "poison-pill" regression: an *audit* task whose
 * text mentions "broken/fails" must NOT be misrouted to a builder/security
 * fixer roster (the exact misroute that happened in the field).
 *
 * Seam choice: `classifyTaskLocal` was module-local; we added a single `export`
 * keyword (the minimal, lowest-risk change) so the pure function can be unit
 * tested directly without standing up the full orchestrate-inline plan path.
 */

import { describe, it, expect } from 'vitest';
import { classifyTaskLocal } from './orchestration.js';

describe('classifyTaskLocal — poison-pill regression (T-002 headline)', () => {
  const task = 'Audit the orchestration engine that is broken and fails';
  const result = classifyTaskLocal(task);

  it('classifies an audit-with-bug-language task as analyst work (audit|analysis), NOT bugfix', () => {
    expect(['audit', 'analysis']).toContain(result.type);
    expect(result.type).not.toBe('bugfix');
  });

  it('recommends NEITHER builder NOR security (no fixer roster for a read-only audit)', () => {
    expect(result.recommendedAgents).not.toContain('builder');
    expect(result.recommendedAgents).not.toContain('security');
  });

  it('anchors confidence at >= 0.7 via the leading intent verb', () => {
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('surfaces a non-empty overrideHint so a misroute stays visible and correctable', () => {
    expect(typeof result.overrideHint).toBe('string');
    expect(result.overrideHint.length).toBeGreaterThan(0);
  });
});

describe('classifyTaskLocal — genuine bugfix still routes to a fixer roster', () => {
  const result = classifyTaskLocal('fix the null pointer error in the login handler');

  it('classifies as bugfix', () => {
    expect(result.type).toBe('bugfix');
  });

  it('includes builder in the recommended roster', () => {
    expect(result.recommendedAgents).toContain('builder');
  });
});

describe('classifyTaskLocal — design task routes to an analyst roster', () => {
  const result = classifyTaskLocal('design the schema for the new payment flow');

  it('classifies as design', () => {
    expect(result.type).toBe('design');
  });

  it('uses an analyst roster with NO builder', () => {
    expect(result.recommendedAgents).not.toContain('builder');
  });
});

describe('classifyTaskLocal — alternativeType', () => {
  it('populates alternativeType when a second family also scores', () => {
    // "design" verb anchors the family; "research"/"investigate" keywords give a
    // runner-up family some score, so a runner-up must surface.
    const result = classifyTaskLocal(
      'Design and research the approaches to the new caching architecture',
    );
    expect(result.alternativeType).toBeTruthy();
    expect(typeof result.alternativeType).toBe('string');
    expect(result.alternativeType).not.toBe(result.type);
  });

  it('omits alternativeType when only one family scores', () => {
    const result = classifyTaskLocal('fix the crash');
    expect(result.type).toBe('bugfix');
    expect(result.alternativeType).toBeUndefined();
  });
});

describe('classifyTaskLocal — shape contract', () => {
  it('always returns confidence within [0,1] and a string overrideHint', () => {
    for (const task of [
      'Audit the broken engine',
      'fix the bug',
      'design a schema',
      'do something completely unclassifiable zzz',
    ]) {
      const r = classifyTaskLocal(task);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(typeof r.overrideHint).toBe('string');
      expect(r.overrideHint.length).toBeGreaterThan(0);
      expect(Array.isArray(r.recommendedAgents)).toBe(true);
    }
  });
});
