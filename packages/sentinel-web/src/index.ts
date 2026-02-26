/**
 * @a-company/sentinel-web
 *
 * Zero-dependency browser client for Sentinel schema-driven observability.
 *
 * @example
 * ```ts
 * import { SentinelWebClient } from '@a-company/sentinel-web';
 *
 * const sentinel = new SentinelWebClient({
 *   url: 'http://localhost:3838',
 *   schemaId: 'my-app',
 *   service: 'frontend',
 * });
 *
 * sentinel.emit('user:click', { target: 'button' }, { scopeValue: 42 });
 * ```
 *
 * @packageDocumentation
 */

export { SentinelWebClient } from './client.js';
export { RingBuffer } from './batch.js';
export type {
  SentinelWebClientOptions,
  EventSchemaDeclaration,
  BufferedEvent,
  EmitOptions,
  BatchEmitEvent,
} from './types.js';
