/**
 * Sentinel Hono Adapter
 *
 * Hono middleware that auto-captures errors with symbolic context.
 *
 * Usage:
 *   import { Sentinel } from '@a-company/sentinel';
 *   import { createHonoMiddleware } from '@a-company/sentinel/hono';
 *
 *   const sentinel = new Sentinel({ project: 'my-app' });
 *   app.use('*', createHonoMiddleware(sentinel));
 */

import type { Sentinel } from '../sdk.js';

/**
 * Create Hono middleware that captures errors with symbolic context.
 *
 * @param sentinel - Sentinel SDK instance
 */
export function createHonoMiddleware(sentinel: Sentinel) {
  return async (c: any, next: () => Promise<void>) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof Error) {
        const context: Record<string, string> = {};

        // Auto-detect component from route path
        const url: string = c.req?.url || '';
        try {
          const pathname = new URL(url, 'http://localhost').pathname;
          const routeParts = pathname.split('/').filter(Boolean);
          if (routeParts.length >= 2) {
            context.component = `#${routeParts[1]}`;
          }
        } catch {
          // URL parsing failed, skip auto-detection
        }

        sentinel.capture(error, context);
      }
      throw error;
    }
  };
}
