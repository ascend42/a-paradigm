/**
 * validation.test.ts — pins validateInput's error formatting and the
 * optional().default() semantics across the zod 3 → 4 migration (zod 4
 * removed ZodError#errors in favour of #issues).
 */

import { describe, it, expect } from 'vitest';
import {
  validateInput,
  searchInputSchema,
  rippleInputSchema,
  gatesForRouteInputSchema,
  wisdomContextInputSchema,
} from './validation.js';

describe('validateInput (zod 4)', () => {
  it('applies defaults for omitted optional fields', () => {
    const r = validateInput(searchInputSchema, { query: 'checkout' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(10);
      expect(r.data.fuzzy).toBe(true);
    }
    const ripple = validateInput(rippleInputSchema, { symbol: '#checkout' });
    expect(ripple.success && ripple.data.depth).toBe(2);
  });

  it('joins issues as "path: message" with "; "', () => {
    const r = validateInput(searchInputSchema, { query: '', limit: 0 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const parts = r.error.split('; ');
      expect(parts[0]).toBe('query: Query cannot be empty');
      expect(parts[1]).toMatch(/^limit: /);
    }
  });

  it('reports custom messages for array minimums and enums', () => {
    const w = validateInput(wisdomContextInputSchema, { symbols: [] });
    expect(w).toEqual({ success: false, error: 'symbols: At least one symbol required' });

    const g = validateInput(gatesForRouteInputSchema, { route: '/x', method: 'TRACE' });
    expect(g.success).toBe(false);
    if (!g.success) expect(g.error).toMatch(/^method: /);
  });
});
