/**
 * Sentinel Fastify Adapter
 *
 * Fastify plugin that auto-captures errors with symbolic context.
 *
 * Usage:
 *   import { Sentinel } from '@a-company/sentinel';
 *   import { createFastifyPlugin } from '@a-company/sentinel/fastify';
 *
 *   const sentinel = new Sentinel({ project: 'my-app' });
 *   fastify.register(createFastifyPlugin(sentinel));
 */

import type { Sentinel } from '../sdk.js';

/**
 * Create a Fastify plugin that captures errors with symbolic context.
 *
 * @param sentinel - Sentinel SDK instance
 */
export function createFastifyPlugin(sentinel: Sentinel) {
  return async function sentinelPlugin(fastify: any) {
    fastify.setErrorHandler(async (error: Error, request: any, reply: any) => {
      const context: Record<string, string> = {};

      // Auto-detect component from route path
      const url: string = request.url || '';
      const routeParts = url.split('?')[0].split('/').filter(Boolean);
      if (routeParts.length >= 2) {
        context.component = `#${routeParts[1]}`;
      }

      sentinel.capture(error, context);

      reply.status(500).send({ error: 'Internal Server Error' });
    });
  };
}
