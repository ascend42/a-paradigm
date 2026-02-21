/**
 * Sentinel Express Adapter
 *
 * Express error-handling middleware that auto-captures errors
 * with route-derived symbolic context.
 *
 * Usage:
 *   import { Sentinel } from '@a-company/sentinel';
 *   import { createExpressErrorHandler } from '@a-company/sentinel/express';
 *
 *   const sentinel = new Sentinel({ project: 'my-app' });
 *   app.use(createExpressErrorHandler(sentinel));
 */

import type { Sentinel } from '../sdk.js';
import type { SymbolicContext } from '../types.js';

type ErrorRequestHandler = (
  err: Error,
  req: any,
  res: any,
  next: (err?: any) => void,
) => void;

/**
 * Route-to-symbol mapping configuration.
 * Maps route prefixes to component symbols.
 *
 * Example:
 *   { '/api/checkout': '#checkout', '/api/auth': '#auth-service' }
 */
export type RouteSymbolMap = Record<string, string>;

export interface ExpressAdapterOptions {
  /** Map route prefixes to component symbols */
  routeMap?: RouteSymbolMap;
  /** Whether to set X-Sentinel-Incident response header (default: true) */
  setHeader?: boolean;
}

/**
 * Create Express error-handling middleware.
 *
 * Automatically captures unhandled errors with:
 * - Route-derived component symbol (auto-detected or from routeMap)
 * - Request metadata (method, path)
 *
 * @param sentinel - Sentinel SDK instance
 * @param options - Adapter options
 */
export function createExpressErrorHandler(
  sentinel: Sentinel,
  options: ExpressAdapterOptions = {},
): ErrorRequestHandler {
  const { routeMap = {}, setHeader = true } = options;

  return (err: Error, req: any, res: any, next: (err?: any) => void) => {
    const context: Partial<SymbolicContext> = {};

    // Try route map first
    const path: string = req.path || req.url || '';
    let matched = false;
    for (const [prefix, symbol] of Object.entries(routeMap)) {
      if (path.startsWith(prefix)) {
        context.component = symbol;
        matched = true;
        break;
      }
    }

    // Fallback: auto-detect component from route path
    if (!matched) {
      const routeParts = path.split('/').filter(Boolean);
      if (routeParts.length >= 2) {
        context.component = `#${routeParts[1]}`;
      }
    }

    const incidentId = sentinel.capture(err, context);

    // Attach incident ID to response for debugging
    if (setHeader && res.setHeader && !res.headersSent) {
      res.setHeader('X-Sentinel-Incident', incidentId);
    }

    // Pass to next error handler (don't swallow the error)
    next(err);
  };
}
