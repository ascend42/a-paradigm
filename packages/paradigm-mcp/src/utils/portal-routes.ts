/**
 * Portal routes — the one place that reads portal.yaml `routes`.
 *
 * T-2026-10-22-002: portal-core's parseGateConfig() returns a ParsedGateConfig
 * with gates/flows/settings only; it drops `routes`. So routes cannot be read
 * from ProjectContext.gateConfig, and portalRoutes() honestly returns [] until
 * the parser (or the context) carries them. Fix it here and every caller
 * (paradigm_gates_for_route, pm preflight/postflight, habits) picks it up.
 */

import type { ParsedGateConfig } from '@a-company/portal-core';

export interface PortalRoute {
  /** Route pattern as declared, e.g. "POST /api/orders" or "orders.create" */
  route: string;
  /** Gate ids protecting the route */
  gates: string[];
  method?: string;
}

/**
 * Routes declared in a project's parsed gate config.
 * Always [] today — ParsedGateConfig carries no routes (T-2026-10-22-002).
 */
export function portalRoutes(_gateConfig: ParsedGateConfig | null): PortalRoute[] {
  return [];
}

/**
 * Parse the `routes` map of a RAW portal.yaml document. A route maps to either
 * a gate list or `{ gates, method }`; anything else is skipped.
 */
export function parsePortalRoutes(rawPortal: unknown): PortalRoute[] {
  if (!rawPortal || typeof rawPortal !== 'object') return [];
  const routes: unknown = (rawPortal as { routes?: unknown }).routes;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return [];

  const out: PortalRoute[] = [];
  for (const [route, value] of Object.entries(routes)) {
    if (Array.isArray(value)) {
      out.push({ route, gates: value.filter((g): g is string => typeof g === 'string') });
    } else if (value && typeof value === 'object') {
      const { gates, method } = value as { gates?: unknown; method?: unknown };
      if (!Array.isArray(gates)) continue;
      out.push({
        route,
        gates: gates.filter((g): g is string => typeof g === 'string'),
        ...(typeof method === 'string' ? { method } : {}),
      });
    }
  }
  return out;
}
