import { describe, it, expect } from 'vitest';
import { applyLoreFilter, searchLoreEntries } from './filter.js';
import type { LoreEntry } from './types.js';

function makeLoreEntry(overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: 'L-2026-02-21-001',
    type: 'agent-session',
    timestamp: '2026-02-21T10:00:00Z',
    author: 'claude-opus-4',
    agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
    title: 'Test entry',
    summary: 'A test lore entry',
    symbols_touched: ['#test-component'],
    ...overrides,
  };
}

describe('applyLoreFilter', () => {
  const entries: LoreEntry[] = [
    makeLoreEntry({
      id: 'L-2026-02-21-001',
      timestamp: '2026-02-21T10:00:00Z',
      author: 'ascend',
      agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
      type: 'agent-session',
      symbols_touched: ['#auth'],
      symbols_created: ['#login-form'],
      tags: ['security', 'phase-1'],
      review: { reviewer: 'ascend', completeness: 5, quality: 4, reviewed_at: '2026-02-21T12:00:00Z' },
    }),
    // v6.0: 'decision' removed from LoreType. The decision is stored in
    // .paradigm/decisions/ as TD-2026-02-20-001 and surfaced here as the
    // companion lore insight (per D3 locked synthesis).
    makeLoreEntry({
      id: 'L-2026-02-20-001',
      timestamp: '2026-02-20T10:00:00Z',
      author: 'ascend',
      agent: undefined, // Human-only entry
      type: 'insight',
      references: { decision_id: 'TD-2026-02-20-001' },
      symbols_touched: ['#payment'],
      tags: ['architecture'],
    }),
    makeLoreEntry({
      id: 'L-2026-02-19-001',
      timestamp: '2026-02-19T10:00:00Z',
      author: 'matt',
      agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
      type: 'milestone',
      symbols_touched: ['#sentinel-sdk'],
      tags: ['phase-1'],
      review: { reviewer: 'ascend', completeness: 3, quality: 3, reviewed_at: '2026-02-19T12:00:00Z' },
    }),
  ];

  it('returns all when empty filter', () => {
    const result = applyLoreFilter(entries, {});
    expect(result.length).toBe(3);
  });

  it('filters by author', () => {
    const result = applyLoreFilter(entries, { author: 'ascend' });
    expect(result.length).toBe(2);
    result.forEach(e => expect(e.author).toBe('ascend'));
  });

  it('filters by hasAgent true', () => {
    const result = applyLoreFilter(entries, { hasAgent: true });
    expect(result.length).toBe(2);
    result.forEach(e => expect(e.agent).not.toBeUndefined());
  });

  it('filters by hasAgent false', () => {
    const result = applyLoreFilter(entries, { hasAgent: false });
    expect(result.length).toBe(1);
    expect(result[0].agent).toBeUndefined();
  });

  it('supports deprecated authorType filter', () => {
    const agentResult = applyLoreFilter(entries, { authorType: 'agent' });
    expect(agentResult.length).toBe(2);

    const humanResult = applyLoreFilter(entries, { authorType: 'human' });
    expect(humanResult.length).toBe(1);
  });

  it('hasAgent takes precedence over authorType', () => {
    // When both are provided, hasAgent wins
    const result = applyLoreFilter(entries, { hasAgent: false, authorType: 'agent' });
    expect(result.length).toBe(1);
    expect(result[0].agent).toBeUndefined();
  });

  it('filters by symbol (touched + created)', () => {
    const result = applyLoreFilter(entries, { symbol: '#login-form' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('L-2026-02-21-001');

    const touched = applyLoreFilter(entries, { symbol: '#auth' });
    expect(touched.length).toBe(1);
  });

  it('filters by dateFrom', () => {
    const result = applyLoreFilter(entries, { dateFrom: '2026-02-20' });
    expect(result.length).toBe(2);
  });

  it('filters by dateTo', () => {
    const result = applyLoreFilter(entries, { dateTo: '2026-02-20T23:59:59Z' });
    expect(result.length).toBe(2);
  });

  it('filters by type', () => {
    // v6.0: filter on 'insight' (the post-decision type). The architecture-
    // tagged fixture above is the companion lore for TD-2026-02-20-001.
    const result = applyLoreFilter(entries, { type: 'insight' });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('insight');
    expect(result[0].references?.decision_id).toBe('TD-2026-02-20-001');
  });

  it('filters by tags (OR)', () => {
    const result = applyLoreFilter(entries, { tags: ['security', 'architecture'] });
    expect(result.length).toBe(2);
  });

  it('filters by hasReview true', () => {
    const result = applyLoreFilter(entries, { hasReview: true });
    expect(result.length).toBe(2);
  });

  it('filters by hasReview false', () => {
    const result = applyLoreFilter(entries, { hasReview: false });
    expect(result.length).toBe(1);
    expect(result[0].review).toBeUndefined();
  });

  it('filters by minCompleteness', () => {
    const result = applyLoreFilter(entries, { minCompleteness: 4 });
    expect(result.length).toBe(1);
    expect(result[0].review!.completeness).toBe(5);
  });

  it('applies offset and limit', () => {
    const result = applyLoreFilter(entries, { offset: 1, limit: 1 });
    expect(result.length).toBe(1);
    // Sorted newest-first, offset 1 skips the first (newest)
    expect(result[0].id).toBe('L-2026-02-20-001');
  });

  it('sorts newest-first', () => {
    const result = applyLoreFilter(entries, {});
    expect(result[0].timestamp > result[1].timestamp).toBe(true);
    expect(result[1].timestamp > result[2].timestamp).toBe(true);
  });

  it('composes AND filters', () => {
    const result = applyLoreFilter(entries, {
      hasAgent: true,
      tags: ['phase-1'],
    });
    expect(result.length).toBe(2);
    result.forEach(e => {
      expect(e.agent).not.toBeUndefined();
      expect(e.tags).toContain('phase-1');
    });
  });
});

describe('searchLoreEntries', () => {
  const entries: LoreEntry[] = [
    makeLoreEntry({ title: 'Built Sentinel SDK', summary: 'Created the sentinel package', tags: ['sdk'] }),
    makeLoreEntry({ title: 'Auth refactor', summary: 'Rewrote the login flow', symbols_touched: ['#auth-handler'] }),
    makeLoreEntry({ title: 'Bug fix', summary: 'Fixed payment crash', tags: ['bugfix', 'payment'] }),
  ];

  it('matches title', () => {
    const result = searchLoreEntries(entries, 'sentinel');
    expect(result.length).toBe(1);
    expect(result[0].title).toContain('Sentinel');
  });

  it('matches summary', () => {
    const result = searchLoreEntries(entries, 'login');
    expect(result.length).toBe(1);
    expect(result[0].summary).toContain('login');
  });

  it('matches symbols', () => {
    const result = searchLoreEntries(entries, 'auth-handler');
    expect(result.length).toBe(1);
  });

  it('matches tags', () => {
    const result = searchLoreEntries(entries, 'payment');
    expect(result.length).toBe(1);
    expect(result[0].tags).toContain('payment');
  });

  it('case-insensitive', () => {
    const result = searchLoreEntries(entries, 'SENTINEL');
    expect(result.length).toBe(1);
  });

  it('returns empty for no match', () => {
    const result = searchLoreEntries(entries, 'nonexistent-xyz');
    expect(result).toEqual([]);
  });
});
