import { describe, it, expect } from 'vitest';
import { draftLoreFromBreadcrumbs } from '../core/lore/storage.js';

describe('Auto-Lore Drafting', () => {
  it('generates a draft from breadcrumbs', () => {
    const breadcrumbs = [
      { tool: 'paradigm_search', args: { query: 'payment' } },
      { tool: 'paradigm_ripple', args: { symbol: '#payment-service' } },
      { tool: 'paradigm_search', args: { query: 'auth' } },
    ];
    const modifiedFiles = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const symbolsTouched = ['#payment-service', '^authenticated'];

    const draft = draftLoreFromBreadcrumbs(
      '/tmp/test-project',
      breadcrumbs,
      modifiedFiles,
      symbolsTouched,
      'Adding payment auth middleware'
    );

    expect(draft.type).toBe('agent-session');
    expect(draft.title).toContain('Adding payment auth middleware');
    expect(draft.summary).toContain('3 files');
    expect(draft.summary).toContain('2 symbols');
    expect(draft.symbols_touched).toEqual(['#payment-service', '^authenticated']);
    expect(draft.files_modified).toEqual(modifiedFiles);
    expect(draft.tags).toContain('auto-draft');
  });

  it('generates title from file count when no context', () => {
    const draft = draftLoreFromBreadcrumbs(
      '/tmp/test-project',
      [{ tool: 'paradigm_search' }],
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      ['#comp']
    );

    expect(draft.title).toContain('4 files modified');
  });

  it('includes tool usage stats in summary', () => {
    const breadcrumbs = [
      { tool: 'paradigm_ripple' },
      { tool: 'paradigm_ripple' },
      { tool: 'paradigm_ripple' },
      { tool: 'paradigm_search' },
    ];

    const draft = draftLoreFromBreadcrumbs(
      '/tmp/test-project',
      breadcrumbs,
      ['a.ts', 'b.ts', 'c.ts'],
      ['#comp']
    );

    expect(draft.summary).toContain('paradigm_ripple (3x)');
  });
});
