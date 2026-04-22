/**
 * near-match.test.ts — tests for the v5.38.0 Levenshtein-based
 * did-you-mean suggestion engine.
 */

import { describe, it, expect } from 'vitest';
import {
  levenshtein,
  findNearMatch,
  suggestForUndeclared,
  suggestForUnused,
} from '../src/core/near-match.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('foo', 'foo')).toBe(0);
  });

  it('returns length for empty comparisons', () => {
    expect(levenshtein('', 'foo')).toBe(3);
    expect(levenshtein('foo', '')).toBe(3);
  });

  it('counts single substitution', () => {
    expect(levenshtein('cat', 'car')).toBe(1);
  });

  it('counts single insertion/deletion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('handles transpositions as two edits', () => {
    // Classic Levenshtein counts 'ab' → 'ba' as 2 edits (not 1)
    expect(levenshtein('ab', 'ba')).toBe(2);
  });
});

describe('findNearMatch threshold', () => {
  it('accepts distance = 2 (authencated → authenticated)', () => {
    const match = findNearMatch('authencated', ['authenticated']);
    expect(match).toBeDefined();
    expect(match!.didYouMean).toBe('authenticated');
  });

  it('accepts distance = 1 (admin → admins)', () => {
    const match = findNearMatch('admin', ['admins']);
    expect(match).toBeDefined();
    expect(match!.didYouMean).toBe('admins');
  });

  it('accepts via ratio on longer strings (≤ 30%)', () => {
    // distance 3, longer length = 15 → ratio 0.2 passes
    const match = findNearMatch('authenticatedx', ['authenticated']);
    expect(match).toBeDefined();
  });

  it('rejects unrelated gates (distance > 2 AND ratio > 0.3)', () => {
    const match = findNearMatch('authenticated', ['rate-limit']);
    expect(match).toBeUndefined();
  });

  it('returns the closest when multiple candidates pass', () => {
    const match = findNearMatch('admin', ['admin-role', 'super-admin', 'admins']);
    expect(match?.didYouMean).toBe('admins');
    expect(match?.distance).toBe(1);
  });

  it('ignores exact matches (those are not "near" matches)', () => {
    const match = findNearMatch('authenticated', ['authenticated']);
    expect(match).toBeUndefined();
  });

  it('returns undefined for empty candidate list', () => {
    expect(findNearMatch('authenticated', [])).toBeUndefined();
  });
});

describe('suggestForUndeclared', () => {
  it('produces one suggestion per undeclared gate with a near-match', () => {
    const undeclared = ['authencated', 'rolee', 'xyz-unknown'];
    const declared = ['authenticated', 'role', 'admin'];
    const suggestions = suggestForUndeclared(undeclared, declared);
    const names = suggestions.map(s => s.gate);
    expect(names).toContain('authencated');
    expect(names).toContain('rolee');
    expect(names).not.toContain('xyz-unknown'); // no near-match
  });

  it('includes gate + didYouMean + distance', () => {
    const suggestions = suggestForUndeclared(['admn'], ['admin']);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].gate).toBe('admn');
    expect(suggestions[0].didYouMean).toBe('admin');
    expect(suggestions[0].distance).toBe(1);
  });
});

describe('suggestForUnused', () => {
  it('produces typo hints in the reverse direction', () => {
    const declaredButUnused = ['authentcated'];
    const usedButUndeclared = ['authenticated'];
    const suggestions = suggestForUnused(declaredButUnused, usedButUndeclared);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].gate).toBe('authentcated');
    expect(suggestions[0].didYouMean).toBe('authenticated');
  });
});

describe('no false positives on wildly different gates', () => {
  it('does not match long unrelated names', () => {
    const match = findNearMatch(
      'payment-processor',
      ['rate-limiter', 'authentication', 'admin-check'],
    );
    expect(match).toBeUndefined();
  });

  it('does not match when ratio is above threshold (distance/longer > 0.3)', () => {
    // distance = 5, longer length = 5 → ratio = 1.0, above 0.3, distance > 2
    const match = findNearMatch('admin', ['guest']);
    expect(match).toBeUndefined();
  });

  it('rejects totally unrelated 6+ char names', () => {
    const match = findNearMatch('checkout', ['database']);
    // distance = 7, longer = 8, ratio = 0.875 → reject
    expect(match).toBeUndefined();
  });
});
