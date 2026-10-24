import { describe, it, expect } from 'vitest';
import { parsePortalRoutes, portalRoutes } from './portal-routes.js';

describe('parsePortalRoutes', () => {
  it('reads both the gate-list and { gates, method } route forms', () => {
    const raw = {
      routes: {
        'GET /api/orders': ['authenticated'],
        'POST /api/orders': { gates: ['authenticated', 'order-owner'], method: 'POST' },
        'GET /api/broken': { method: 'GET' },
        'GET /api/junk': 'nope',
      },
    };
    expect(parsePortalRoutes(raw)).toEqual([
      { route: 'GET /api/orders', gates: ['authenticated'] },
      { route: 'POST /api/orders', gates: ['authenticated', 'order-owner'], method: 'POST' },
    ]);
  });

  it('returns [] for missing or malformed documents', () => {
    expect(parsePortalRoutes(null)).toEqual([]);
    expect(parsePortalRoutes({ routes: ['x'] })).toEqual([]);
    expect(parsePortalRoutes({ gates: {} })).toEqual([]);
  });
});

describe('portalRoutes', () => {
  it('is empty until ParsedGateConfig carries routes (T-2026-10-22-002)', () => {
    expect(portalRoutes(null)).toEqual([]);
  });
});
